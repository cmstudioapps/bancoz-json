// engine/compactor.js
// Compactação de segmentos — remove versões antigas e tombstones
// Mantém apenas a versão mais recente de cada chave.
// A compactação é feita de forma segura: gera novo segmento, atualiza índice, depois deleta os antigos.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { serializeRecord, iterateRecords } from './format.js';

/**
 * Compactador de segmentos do Bancoz Engine.
 * Lê segmentos antigos, mantém apenas a versão mais recente de cada chave,
 * gera segmentos novos compactos e limpa os antigos.
 */
export class Compactor {
  /**
   * @param {import('./segment.js').SegmentManager} segmentManager
   * @param {import('./keydir.js').KeyDir} keyDir
   * @param {Object} [options]
   * @param {number} [options.maxSegmentSize] - Tamanho máximo dos segmentos compactados
   * @param {number} [options.minSegmentsToCompact=3] - Mínimo de segmentos para disparar compactação
   * @param {number} [options.deadSpaceRatio=0.5] - Proporção de espaço morto para disparar compactação
   */
  constructor(segmentManager, keyDir, options = {}) {
    this._segmentManager = segmentManager;
    this._keyDir = keyDir;
    this._maxSegmentSize = options.maxSegmentSize || segmentManager.maxSegmentSize;
    this._minSegments = options.minSegmentsToCompact || 3;
    this._deadSpaceRatio = options.deadSpaceRatio || 0.5;
    this._running = false;
  }

  /**
   * Verifica se a compactação é necessária.
   * Critérios:
   * 1. Número de segmentos > threshold
   * 2. OU proporção de espaço morto > threshold
   * 
   * @returns {Promise<boolean>}
   */
  async shouldCompact() {
    const segments = await this._segmentManager.listSegments();

    // Não compactar se há poucos segmentos
    if (segments.length < this._minSegments) return false;

    // Calcular espaço morto (total no disco - dados vivos no índice)
    const totalDiskSize = segments.reduce((sum, s) => sum + s.size, 0);
    const liveSizeEstimate = this._estimateLiveSize();

    if (totalDiskSize === 0) return false;

    const deadRatio = 1 - (liveSizeEstimate / totalDiskSize);
    return deadRatio >= this._deadSpaceRatio;
  }

  /**
   * Executa a compactação.
   * 
   * Processo:
   * 1. Identifica segmentos antigos (tudo exceto o ativo)
   * 2. Para cada chave viva no índice, lê o registro atual
   * 3. Reescreve todos os registros vivos em novos segmentos compactos
   * 4. Atualiza o KeyDir com as novas posições
   * 5. Remove os segmentos antigos
   * 
   * @returns {Promise<{ segmentsRemoved: number, bytesSaved: number, keysProcessed: number }>}
   */
  async run() {
    if (this._running) {
      return { segmentsRemoved: 0, bytesSaved: 0, keysProcessed: 0 };
    }

    this._running = true;

    try {
      const segments = await this._segmentManager.listSegments();
      const activeFileId = this._segmentManager.activeFileId;

      // Segmentos candidatos à compactação (tudo exceto o ativo)
      const oldSegments = segments.filter(s => s.fileId !== activeFileId);

      if (oldSegments.length === 0) {
        return { segmentsRemoved: 0, bytesSaved: 0, keysProcessed: 0 };
      }

      // IDs dos segmentos antigos
      const oldFileIds = new Set(oldSegments.map(s => s.fileId));
      const oldTotalSize = oldSegments.reduce((sum, s) => sum + s.size, 0);

      // Coletar todos os registros vivos que estão nos segmentos antigos
      const liveRecords = [];

      for (const [key, entry] of this._keyDir.entries()) {
        if (oldFileIds.has(entry.fileId)) {
          // Este registro vive em um segmento antigo — precisa ser movido
          try {
            const buffer = await this._segmentManager.readAt(
              entry.fileId, entry.offset, entry.size
            );

            // Extrair o valor do registro
            const { deserializeRecord } = await import('./format.js');
            const record = deserializeRecord(buffer);

            if (record && !record.tombstone) {
              liveRecords.push({
                key: record.key,
                value: record.value,
                timestamp: record.timestamp
              });
            }
          } catch (err) {
            // Registro corrompido — será perdido na compactação
            // (o índice será atualizado para removê-lo)
            this._keyDir.delete(key);
          }
        }
      }

      // Calcular o próximo ID de segmento compactado
      // Usar IDs altos para não conflitar com o ativo
      const maxExistingId = segments.reduce((max, s) => Math.max(max, s.fileId), 0);
      let compactFileId = maxExistingId + 1;

      // Reescrever registros vivos em novos segmentos compactos
      let currentBuffer = [];
      let currentSize = 0;
      let newTotalSize = 0;
      const newSegmentIds = [];

      for (const { key, value, timestamp } of liveRecords) {
        const { buffer, totalSize } = serializeRecord(key, value, false);

        // Se o segmento compacto ficou grande, flush e cria outro
        if (currentSize > 0 && currentSize + totalSize > this._maxSegmentSize) {
          const merged = Buffer.concat(currentBuffer);
          await this._segmentManager.writeSegment(compactFileId, merged);
          newSegmentIds.push(compactFileId);

          // Atualizar KeyDir para apontar para as novas posições
          this._updateKeyDirForSegment(merged, compactFileId);

          compactFileId++;
          currentBuffer = [];
          currentSize = 0;
        }

        currentBuffer.push(buffer);
        currentSize += totalSize;
        newTotalSize += totalSize;
      }

      // Flush do último segmento compacto
      if (currentBuffer.length > 0) {
        const merged = Buffer.concat(currentBuffer);
        await this._segmentManager.writeSegment(compactFileId, merged);
        newSegmentIds.push(compactFileId);
        this._updateKeyDirForSegment(merged, compactFileId);
      }

      // Remover segmentos antigos
      await this._segmentManager.removeSegments([...oldFileIds]);

      // Remover do índice qualquer chave que apontava para segmentos antigos
      // mas não foi reescrita (ex: tombstones)
      for (const [key, entry] of this._keyDir.entries()) {
        if (oldFileIds.has(entry.fileId)) {
          this._keyDir.delete(key);
        }
      }

      const bytesSaved = oldTotalSize - newTotalSize;

      return {
        segmentsRemoved: oldSegments.length,
        segmentsCreated: newSegmentIds.length,
        bytesSaved: Math.max(0, bytesSaved),
        keysProcessed: liveRecords.length
      };
    } finally {
      this._running = false;
    }
  }

  /**
   * Atualiza o KeyDir com as posições dos registros em um segmento recém-escrito.
   * @param {Buffer} segmentBuffer
   * @param {number} fileId
   * @private
   */
  _updateKeyDirForSegment(segmentBuffer, fileId) {
    iterateRecords(segmentBuffer, (record, offset) => {
      if (!record.tombstone) {
        this._keyDir.set(record.key, {
          fileId,
          offset,
          size: record.totalSize,
          timestamp: record.timestamp
        });
      }
    });
  }

  /**
   * Estima o tamanho dos dados vivos no índice.
   * @returns {number} bytes estimados
   * @private
   */
  _estimateLiveSize() {
    let total = 0;
    for (const entry of this._keyDir.entries()) {
      total += entry[1].size;
    }
    return total;
  }

  /**
   * Retorna estatísticas para decidir se compactação é necessária.
   * @returns {Promise<{ totalDiskSize: number, liveDataSize: number, deadSpaceBytes: number, deadSpaceRatio: number, segmentCount: number }>}
   */
  async stats() {
    const segments = await this._segmentManager.listSegments();
    const totalDiskSize = segments.reduce((sum, s) => sum + s.size, 0);
    const liveDataSize = this._estimateLiveSize();
    const deadSpaceBytes = Math.max(0, totalDiskSize - liveDataSize);
    const deadSpaceRatio = totalDiskSize > 0 ? deadSpaceBytes / totalDiskSize : 0;

    return {
      totalDiskSize,
      liveDataSize,
      deadSpaceBytes,
      deadSpaceRatio: Math.round(deadSpaceRatio * 100) / 100,
      segmentCount: segments.length
    };
  }
}
