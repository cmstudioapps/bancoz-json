// engine/segment.js
// Gerenciamento de segmentos de dados (.bcz)
// Cada segmento é um arquivo append-only contendo registros binários serializados.
// Quando o segmento ativo atinge o limite de tamanho, um novo é criado (rotação).

import { promises as fs, existsSync, createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { serializeRecord, deserializeHeader, HEADER_SIZE } from './format.js';

// Tamanho máximo padrão de um segmento: 50 MB
const DEFAULT_MAX_SEGMENT_SIZE = 50 * 1024 * 1024;

/**
 * Gerencia os segmentos de dados de uma coleção.
 * Cada coleção tem seu próprio diretório de segmentos.
 */
export class SegmentManager {
  /**
   * @param {string} dataDir - Diretório dos segmentos (ex: .engine/usuarios/data/)
   * @param {Object} [options]
   * @param {number} [options.maxSegmentSize=52428800] - Tamanho máximo do segmento em bytes
   */
  constructor(dataDir, options = {}) {
    this._dataDir = dataDir;
    this._maxSegmentSize = options.maxSegmentSize || DEFAULT_MAX_SEGMENT_SIZE;
    this._activeFileId = 0;
    this._activeSize = 0;
    this._activeFd = null;
    this._initialized = false;
  }

  /**
   * Inicializa o gerenciador: garante diretório, descobre segmentos existentes.
   */
  async init() {
    await fs.mkdir(this._dataDir, { recursive: true });

    // Descobrir segmentos existentes
    const files = await fs.readdir(this._dataDir);
    const segments = files
      .filter(f => f.endsWith('.bcz'))
      .map(f => parseInt(f.replace('.bcz', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (segments.length > 0) {
      // Usar o último segmento como ativo
      this._activeFileId = segments[segments.length - 1];
      const activePath = this._segmentPath(this._activeFileId);
      const stat = await fs.stat(activePath);
      this._activeSize = stat.size;

      // Se o segmento ativo já está cheio, criar um novo
      if (this._activeSize >= this._maxSegmentSize) {
        this._activeFileId++;
        this._activeSize = 0;
      }
    } else {
      // Nenhum segmento existe ainda — começar do 1
      this._activeFileId = 1;
      this._activeSize = 0;
    }

    this._initialized = true;
  }

  /**
   * Appenda um registro no segmento ativo.
   * Se o segmento ultrapassar o limite, rotaciona para um novo.
   * 
   * @param {string} key - Chave do registro
   * @param {string} valueString - Valor já serializado como JSON string
   * @param {boolean} [tombstone=false] - Se true, marca como deletado
   * @returns {Promise<{ fileId: number, offset: number, size: number, timestamp: number }>}
   */
  async append(key, valueString, tombstone = false) {
    if (!this._initialized) await this.init();

    const { buffer, timestamp, totalSize } = serializeRecord(key, valueString, tombstone);

    // Verificar se precisa rotacionar
    if (this._activeSize > 0 && this._activeSize + totalSize > this._maxSegmentSize) {
      await this._rotate();
    }

    const offset = this._activeSize;
    const filePath = this._segmentPath(this._activeFileId);

    // Append no arquivo
    await fs.appendFile(filePath, buffer);
    this._activeSize += totalSize;

    return {
      fileId: this._activeFileId,
      offset,
      size: totalSize,
      timestamp
    };
  }

  /**
   * Lê um registro diretamente de um segmento usando offset e size.
   * Leitura O(1) — vai direto no byte necessário.
   * 
   * @param {number} fileId - ID do segmento
   * @param {number} offset - Offset em bytes dentro do arquivo
   * @param {number} size   - Tamanho do registro em bytes
   * @returns {Promise<Buffer>} Buffer contendo o registro serializado
   */
  async readAt(fileId, offset, size) {
    const filePath = this._segmentPath(fileId);
    const fd = await open(filePath, 'r');

    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await fd.read(buffer, 0, size, offset);

      if (bytesRead < size) {
        throw new Error(
          `[Bancoz Engine] Leitura parcial no segmento ${fileId}: ` +
          `esperado=${size} bytes, lido=${bytesRead} bytes no offset ${offset}`
        );
      }

      return buffer;
    } finally {
      await fd.close();
    }
  }

  /**
   * Lista todos os segmentos existentes no diretório, ordenados por ID.
   * @returns {Promise<Array<{ fileId: number, name: string, path: string, size: number }>>}
   */
  async listSegments() {
    let files;
    try {
      files = await fs.readdir(this._dataDir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    const segments = [];
    for (const f of files) {
      if (!f.endsWith('.bcz')) continue;

      const fileId = parseInt(f.replace('.bcz', ''), 10);
      if (isNaN(fileId)) continue;

      const filePath = path.join(this._dataDir, f);
      const stat = await fs.stat(filePath);

      segments.push({
        fileId,
        name: f,
        path: filePath,
        size: stat.size
      });
    }

    return segments.sort((a, b) => a.fileId - b.fileId);
  }

  /**
   * Lê todo o conteúdo de um segmento como Buffer.
   * Usado para rebuild do índice e compactação.
   * @param {number} fileId
   * @returns {Promise<Buffer>}
   */
  async readFullSegment(fileId) {
    const filePath = this._segmentPath(fileId);
    return fs.readFile(filePath);
  }

  /**
   * Escreve um novo segmento completo (usado pela compactação).
   * @param {number} fileId
   * @param {Buffer} data
   */
  async writeSegment(fileId, data) {
    const filePath = this._segmentPath(fileId);
    const tmpPath = filePath + `.tmp-${process.pid}-${Date.now()}`;

    try {
      await fs.writeFile(tmpPath, data);
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      try { await fs.unlink(tmpPath); } catch (_) {}
      throw err;
    }
  }

  /**
   * Remove segmentos antigos (pós-compactação).
   * @param {number[]} fileIds - IDs dos segmentos a remover
   */
  async removeSegments(fileIds) {
    for (const fileId of fileIds) {
      const filePath = this._segmentPath(fileId);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  /**
   * Retorna o ID do segmento ativo.
   * @returns {number}
   */
  get activeFileId() {
    return this._activeFileId;
  }

  /**
   * Retorna o tamanho atual do segmento ativo em bytes.
   * @returns {number}
   */
  get activeSize() {
    return this._activeSize;
  }

  /**
   * Retorna o tamanho máximo configurado para segmentos.
   * @returns {number}
   */
  get maxSegmentSize() {
    return this._maxSegmentSize;
  }

  /**
   * Retorna estatísticas dos segmentos.
   * @returns {Promise<{ totalSegments: number, totalSizeBytes: number, activeFileId: number, activeSize: number }>}
   */
  async stats() {
    const segments = await this.listSegments();
    const totalSizeBytes = segments.reduce((sum, s) => sum + s.size, 0);

    return {
      totalSegments: segments.length,
      totalSizeBytes,
      activeFileId: this._activeFileId,
      activeSize: this._activeSize
    };
  }

  // ─── Métodos Privados ───

  /**
   * Gera o caminho de um segmento pelo ID.
   * @param {number} fileId
   * @returns {string}
   */
  _segmentPath(fileId) {
    const name = String(fileId).padStart(6, '0') + '.bcz';
    return path.join(this._dataDir, name);
  }

  /**
   * Rotaciona para um novo segmento.
   */
  async _rotate() {
    this._activeFileId++;
    this._activeSize = 0;
  }
}
