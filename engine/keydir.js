// engine/keydir.js
// Índice em memória (KeyDir) — mapeia chave → localização no disco
// Inspirado no Bitcask KeyDir: toda chave viva aponta para {fileId, offset, size, timestamp}

import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} KeyDirEntry
 * @property {number} fileId    - ID numérico do segmento (ex: 1 → 000001.bcz)
 * @property {number} offset    - Offset em bytes no segmento
 * @property {number} size      - Tamanho total do registro em bytes
 * @property {number} timestamp - Timestamp da escrita (ms desde epoch)
 */

export class KeyDir {
  constructor() {
    /** @type {Map<string, KeyDirEntry>} */
    this._index = new Map();
  }

  /**
   * Obtém a localização de uma chave.
   * @param {string} key
   * @returns {KeyDirEntry | undefined}
   */
  get(key) {
    return this._index.get(key);
  }

  /**
   * Registra ou atualiza a localização de uma chave.
   * @param {string} key
   * @param {KeyDirEntry} entry
   */
  set(key, entry) {
    this._index.set(key, entry);
  }

  /**
   * Remove uma chave do índice.
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this._index.delete(key);
  }

  /**
   * Verifica se uma chave existe no índice.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this._index.has(key);
  }

  /**
   * Retorna um iterador de todas as chaves.
   * @returns {IterableIterator<string>}
   */
  keys() {
    return this._index.keys();
  }

  /**
   * Retorna um iterador de [chave, entry].
   * @returns {IterableIterator<[string, KeyDirEntry]>}
   */
  entries() {
    return this._index.entries();
  }

  /**
   * Quantidade de chaves no índice.
   * @returns {number}
   */
  get size() {
    return this._index.size;
  }

  /**
   * Limpa todo o índice.
   */
  clear() {
    this._index.clear();
  }

  /**
   * Retorna todos os fileIds únicos referenciados no índice.
   * Útil para saber quais segmentos estão ativos.
   * @returns {Set<number>}
   */
  activeFileIds() {
    const ids = new Set();
    for (const entry of this._index.values()) {
      ids.add(entry.fileId);
    }
    return ids;
  }

  /**
   * Persiste o índice em disco como JSON compacto (.bczi).
   * Formato: { version: 1, entries: { key: {fileId, offset, size, timestamp}, ... } }
   * @param {string} filePath - Caminho para o arquivo .bczi
   */
  async save(filePath) {
    const entries = {};
    for (const [key, entry] of this._index) {
      entries[key] = [entry.fileId, entry.offset, entry.size, entry.timestamp];
    }

    const data = JSON.stringify({
      version: 1,
      count: this._index.size,
      entries
    });

    // Escrita atômica: temp + rename
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.index.tmp-${process.pid}-${Date.now()}`);

    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmpPath, data, 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      // Cleanup do temp em caso de falha
      try { await fs.unlink(tmpPath); } catch (_) {}
      throw err;
    }
  }

  /**
   * Carrega o índice de um arquivo .bczi em disco.
   * @param {string} filePath - Caminho para o arquivo .bczi
   * @returns {boolean} true se carregou com sucesso, false se arquivo não existe
   */
  async load(filePath) {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      // Índice corrompido — será necessário rebuild
      return false;
    }

    if (!parsed || parsed.version !== 1 || !parsed.entries) {
      return false;
    }

    this._index.clear();

    for (const [key, arr] of Object.entries(parsed.entries)) {
      if (Array.isArray(arr) && arr.length === 4) {
        this._index.set(key, {
          fileId:    arr[0],
          offset:    arr[1],
          size:      arr[2],
          timestamp: arr[3]
        });
      }
    }

    return true;
  }

  /**
   * Reconstrói o índice escaneando todos os segmentos .bcz de um diretório.
   * Usado quando o arquivo .bczi não existe ou está corrompido.
   * 
   * @param {string} dataDir - Diretório contendo os segmentos .bcz
   * @param {function} iterateRecordsFn - Função iterateRecords do format.js
   * @returns {Promise<void>}
   */
  async rebuild(dataDir, iterateRecordsFn) {
    this._index.clear();

    let files;
    try {
      files = await fs.readdir(dataDir);
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    // Filtrar e ordenar segmentos por ID numérico
    const segments = files
      .filter(f => f.endsWith('.bcz'))
      .sort()
      .map(f => ({
        name: f,
        fileId: parseInt(f.replace('.bcz', ''), 10)
      }));

    for (const seg of segments) {
      const filePath = path.join(dataDir, seg.name);
      const buffer = await fs.readFile(filePath);

      iterateRecordsFn(buffer, (record, offset) => {
        if (record.tombstone) {
          // Tombstone: remove do índice
          this._index.delete(record.key);
        } else {
          // Registro vivo: atualiza (último vence)
          this._index.set(record.key, {
            fileId:    seg.fileId,
            offset:    offset,
            size:      record.totalSize,
            timestamp: record.timestamp
          });
        }
      });
    }
  }

  /**
   * Retorna estatísticas do índice para diagnóstico.
   * @returns {{ totalKeys: number, fileIds: number[], memoryEstimateBytes: number }}
   */
  stats() {
    const fileIds = [...this.activeFileIds()].sort((a, b) => a - b);

    // Estimativa grosseira de uso de memória:
    // Map overhead + ~100 bytes por entrada (key string + entry object)
    const memoryEstimateBytes = this._index.size * 100;

    return {
      totalKeys: this._index.size,
      fileIds,
      memoryEstimateBytes
    };
  }
}
