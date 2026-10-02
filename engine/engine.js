// engine/engine.js
// Classe principal do Bancoz Storage Engine
// Orquestra KeyDir, Segments, WAL e Compactor para fornecer CRUD O(1)
// Mantém uma instância isolada por coleção (lazy initialization)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deserializeRecord, iterateRecords } from './format.js';
import { KeyDir } from './keydir.js';
import { SegmentManager } from './segment.js';
import { WAL } from './wal.js';
import { Compactor } from './compactor.js';

/**
 * Estado de uma coleção individual gerenciada pelo engine.
 * Cada coleção (ex: "usuarios", "produtos") tem suas próprias instâncias.
 * @typedef {Object} CollectionState
 * @property {KeyDir} keyDir
 * @property {SegmentManager} segments
 * @property {WAL} wal
 * @property {Compactor} compactor
 * @property {boolean} initialized
 * @property {Promise<void>|null} initPromise
 */

export class BancozEngine {
  /**
   * @param {string} baseDir - Diretório base do banco (ex: "./BANCO Z")
   * @param {Object} [options]
   * @param {number} [options.maxSegmentSize] - Tamanho máximo de cada segmento em bytes
   * @param {boolean} [options.autoCompact=true] - Se true, compacta automaticamente quando necessário
   */
  constructor(baseDir, options = {}) {
    this._baseDir = baseDir;
    this._engineDir = path.join(baseDir, 'db');
    this._options = options;
    this._autoCompact = options.autoCompact !== false;

    /** @type {Map<string, CollectionState>} */
    this._collections = new Map();

    this._shutdownCalled = false;
  }

  // ─── CRUD Público ───

  /**
   * Insere ou substitui um registro na coleção.
   * Equivalente a bancoz.criar(arquivo, no, dados)
   * 
   * @param {string} collection - Nome da coleção (ex: "usuarios")
   * @param {string} key        - Chave do registro (ex: "caio")
   * @param {*} value            - Valor (será serializado como JSON)
   * @returns {Promise<{ key: string, timestamp: number }>}
   */
  async put(collection, key, value) {
    const state = await this._ensureCollection(collection);
    const valueString = JSON.stringify(value);

    // 1. WAL: registrar intenção
    const walEntry = {
      op: 'put',
      collection,
      key,
      value: valueString,
      timestamp: Date.now()
    };
    await state.wal.append(walEntry);

    // 2. Append no segmento ativo
    const location = await state.segments.append(key, valueString, false);

    // 3. Atualizar índice em memória
    state.keyDir.set(key, {
      fileId:    location.fileId,
      offset:    location.offset,
      size:      location.size,
      timestamp: location.timestamp
    });

    // 4. Commit no WAL
    await state.wal.commit(key, walEntry.timestamp);

    // 5. Compactação automática (background, não bloqueia)
    if (this._autoCompact) {
      this._maybeCompact(state).catch(() => {});
    }

    return { key, timestamp: location.timestamp };
  }

  /**
   * Lê um registro da coleção.
   * Leitura O(1): consulta o índice em memória e lê diretamente do offset no disco.
   * 
   * @param {string} collection - Nome da coleção
   * @param {string} key        - Chave do registro
   * @returns {Promise<* | null>} Valor deserializado ou null se não existe
   */
  async get(collection, key) {
    const state = await this._ensureCollection(collection);
    const entry = state.keyDir.get(key);

    if (!entry) return null;

    // Ler direto do offset no segmento
    const buffer = await state.segments.readAt(entry.fileId, entry.offset, entry.size);
    const record = deserializeRecord(buffer);

    if (!record || record.tombstone) {
      // Índice inconsistente — limpar
      state.keyDir.delete(key);
      return null;
    }

    // Deserializar o valor JSON
    try {
      return JSON.parse(record.value);
    } catch (_) {
      return record.value;
    }
  }

  /**
   * Remove um registro da coleção.
   * Grava um tombstone no segmento e remove do índice.
   * 
   * @param {string} collection - Nome da coleção
   * @param {string} key        - Chave do registro
   * @returns {Promise<boolean>} true se existia e foi removido
   */
  async delete(collection, key) {
    const state = await this._ensureCollection(collection);

    if (!state.keyDir.has(key)) return false;

    // 1. WAL: registrar intenção
    const walEntry = {
      op: 'delete',
      collection,
      key,
      timestamp: Date.now()
    };
    await state.wal.append(walEntry);

    // 2. Append tombstone no segmento
    await state.segments.append(key, '', true);

    // 3. Remover do índice
    state.keyDir.delete(key);

    // 4. Commit no WAL
    await state.wal.commit(key, walEntry.timestamp);

    return true;
  }

  /**
   * Retorna todos os registros de uma coleção como um objeto {chave: valor}.
   * Útil para compatibilidade com o modo JSON do Bancoz.
   * 
   * @param {string} collection - Nome da coleção
   * @returns {Promise<Object>} Objeto com todos os registros
   */
  async getAll(collection) {
    const state = await this._ensureCollection(collection);
    const result = {};

    for (const key of state.keyDir.keys()) {
      const value = await this.get(collection, key);
      if (value !== null) {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Verifica se uma chave existe na coleção.
   * Consulta apenas o índice em memória — O(1).
   * 
   * @param {string} collection
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async has(collection, key) {
    const state = await this._ensureCollection(collection);
    return state.keyDir.has(key);
  }

  /**
   * Retorna todas as chaves de uma coleção.
   * @param {string} collection
   * @returns {Promise<string[]>}
   */
  async keys(collection) {
    const state = await this._ensureCollection(collection);
    return [...state.keyDir.keys()];
  }

  /**
   * Retorna o número de registros em uma coleção.
   * @param {string} collection
   * @returns {Promise<number>}
   */
  async count(collection) {
    const state = await this._ensureCollection(collection);
    return state.keyDir.size;
  }

  // ─── Pesquisa ───

  /**
   * Pesquisa um termo em todos os registros de uma coleção.
   * Usa o índice para iterar apenas sobre as chaves existentes.
   * 
   * @param {string} term - Termo de busca
   * @param {string} collection - Nome da coleção
   * @returns {Promise<Object>} Resultados com paths encontrados
   */
  async search(term, collection) {
    const state = await this._ensureCollection(collection);
    const normalizedTerm = this._normalizeSearch(term);
    const results = [];

    for (const key of state.keyDir.keys()) {
      // Verificar se a chave contém o termo
      if (this._normalizeSearch(key).includes(normalizedTerm)) {
        results.push({ path: `$.${key}`, match: 'key' });
      }

      // Verificar no valor
      const value = await this.get(collection, key);
      if (value !== null) {
        const valuePaths = this._searchInValue(value, normalizedTerm, `$.${key}`);
        results.push(...valuePaths);
      }
    }

    return results;
  }

  // ─── Controle ───

  /**
   * Força o salvamento dos índices e checkpoint do WAL de todas as coleções.
   * Deve ser chamado antes de encerrar o processo.
   */
  async shutdown() {
    if (this._shutdownCalled) return;
    this._shutdownCalled = true;

    for (const [name, state] of this._collections) {
      if (!state.initialized) continue;

      try {
        // Salvar o índice
        const indexPath = path.join(this._collectionDir(name), 'index.bczi');
        await state.keyDir.save(indexPath);

        // Checkpoint do WAL
        await state.wal.checkpoint();
        await state.wal.close();
      } catch (err) {
        // Log do erro mas não impede o shutdown de outras coleções
        console.error(`[Bancoz Engine] Erro ao salvar coleção "${name}":`, err.message);
      }
    }
  }

  /**
   * Força a compactação de uma coleção específica.
   * @param {string} collection
   * @returns {Promise<Object>} Estatísticas da compactação
   */
  async compact(collection) {
    const state = await this._ensureCollection(collection);
    return state.compactor.run();
  }

  /**
   * Retorna estatísticas completas de uma coleção.
   * @param {string} collection
   * @returns {Promise<Object>}
   */
  async stats(collection) {
    const state = await this._ensureCollection(collection);

    const keyDirStats = state.keyDir.stats();
    const segmentStats = await state.segments.stats();
    const compactorStats = await state.compactor.stats();

    return {
      collection,
      keys: keyDirStats.totalKeys,
      segments: segmentStats,
      compaction: compactorStats,
      index: keyDirStats
    };
  }

  /**
   * Lista todas as coleções que possuem dados no engine.
   * @returns {Promise<string[]>}
   */
  async listCollections() {
    try {
      const entries = await fs.readdir(this._engineDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory())
        .map(e => e.name);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Verifica se o engine tem dados para uma coleção.
   * @param {string} collection
   * @returns {Promise<boolean>}
   */
  async hasCollection(collection) {
    const colDir = this._collectionDir(collection);
    try {
      await fs.access(colDir);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ─── Migração JSON → Engine ───

  /**
   * Importa dados de um objeto JSON (como os do Bancoz atual) para o engine.
   * @param {string} collection - Nome da coleção
   * @param {Object} data - Objeto com {chave: valor, ...}
   * @returns {Promise<number>} Número de registros importados
   */
  async importFromJSON(collection, data) {
    let count = 0;
    for (const [key, value] of Object.entries(data)) {
      await this.put(collection, key, value);
      count++;
    }

    // Salvar índice após importação em massa
    const state = this._collections.get(this._normalizeCollectionName(collection));
    if (state && state.initialized) {
      const indexPath = path.join(this._collectionDir(collection), 'index.bczi');
      await state.keyDir.save(indexPath);
      await state.wal.checkpoint();
    }

    return count;
  }

  // ─── Internos ───

  /**
   * Garante que uma coleção está inicializada.
   * Lazy: só cria as estruturas quando a coleção é usada pela primeira vez.
   * 
   * @param {string} collection
   * @returns {Promise<CollectionState>}
   * @private
   */
  async _ensureCollection(collection) {
    const name = this._normalizeCollectionName(collection);

    let state = this._collections.get(name);
    if (state && state.initialized) return state;

    // Se já está inicializando, esperar
    if (state && state.initPromise) {
      await state.initPromise;
      return state;
    }

    // Criar novo estado
    state = {
      keyDir: null,
      segments: null,
      wal: null,
      compactor: null,
      initialized: false,
      initPromise: null
    };

    this._collections.set(name, state);

    // Inicialização assíncrona
    state.initPromise = this._initCollection(name, state);
    await state.initPromise;

    return state;
  }

  /**
   * Inicializa todas as estruturas de uma coleção.
   * @param {string} name
   * @param {CollectionState} state
   * @private
   */
  async _initCollection(name, state) {
    const colDir = this._collectionDir(name);
    const dataDir = path.join(colDir, 'data');

    // Criar diretórios
    await fs.mkdir(dataDir, { recursive: true });

    // Inicializar componentes
    state.keyDir = new KeyDir();
    state.segments = new SegmentManager(dataDir, {
      maxSegmentSize: this._options.maxSegmentSize
    });
    state.wal = new WAL(path.join(colDir, 'wal.log'));
    state.compactor = new Compactor(state.segments, state.keyDir, {
      maxSegmentSize: this._options.maxSegmentSize
    });

    // 1. Inicializar segmentos
    await state.segments.init();

    // 2. Tentar carregar índice persistido
    const indexPath = path.join(colDir, 'index.bczi');
    const loaded = await state.keyDir.load(indexPath);

    if (!loaded) {
      // Índice não disponível — rebuild a partir dos segmentos
      await state.keyDir.rebuild(dataDir, iterateRecords);
    }

    // 3. Abrir WAL e fazer replay de operações pendentes
    await state.wal.open();
    const pending = await state.wal.replay();

    if (pending.length > 0) {
      // Reaplicar operações pendentes
      for (const entry of pending) {
        if (entry.op === 'put') {
          const location = await state.segments.append(
            entry.key, entry.value, false
          );
          state.keyDir.set(entry.key, {
            fileId:    location.fileId,
            offset:    location.offset,
            size:      location.size,
            timestamp: location.timestamp
          });
        } else if (entry.op === 'delete') {
          await state.segments.append(entry.key, '', true);
          state.keyDir.delete(entry.key);
        }
      }

      // Salvar índice e fazer checkpoint do WAL
      await state.keyDir.save(indexPath);
      await state.wal.checkpoint();
    }

    state.initialized = true;
  }

  /**
   * Dispara compactação se necessário (background, não bloqueia).
   * @param {CollectionState} state
   * @private
   */
  async _maybeCompact(state) {
    const needed = await state.compactor.shouldCompact();
    if (needed) {
      await state.compactor.run();

      // Após compactação, salvar índice atualizado
      // Encontrar o nome da coleção para o state
      for (const [name, s] of this._collections) {
        if (s === state) {
          const indexPath = path.join(this._collectionDir(name), 'index.bczi');
          await state.keyDir.save(indexPath);
          await state.wal.checkpoint();
          break;
        }
      }
    }
  }

  /**
   * Normaliza o nome de uma coleção (converte barras para subdiretórios).
   * Ex: "loja/clientes" → "loja/clientes"
   * @param {string} collection
   * @returns {string}
   * @private
   */
  _normalizeCollectionName(collection) {
    return collection.replace(/\\/g, '/').replace(/\.json$/i, '');
  }

  /**
   * Retorna o diretório de uma coleção.
   * @param {string} name
   * @returns {string}
   * @private
   */
  _collectionDir(name) {
    return path.join(this._engineDir, name);
  }

  /**
   * Normaliza texto para busca (lowercase + sem acentos).
   * @param {string} str
   * @returns {string}
   * @private
   */
  _normalizeSearch(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Busca recursiva dentro de um valor JSON.
   * @param {*} value
   * @param {string} term - Termo normalizado
   * @param {string} currentPath - Path JSONPath atual
   * @returns {Array<{path: string, match: string}>}
   * @private
   */
  _searchInValue(value, term, currentPath) {
    const results = [];

    if (value === null || value === undefined) return results;

    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) {
        const subPath = `${currentPath}.${k}`;

        // Verificar chave
        if (this._normalizeSearch(k).includes(term)) {
          results.push({ path: subPath, match: 'key' });
        }

        // Recursão no valor
        if (typeof v === 'object' && v !== null) {
          results.push(...this._searchInValue(v, term, subPath));
        } else if (v !== null && v !== undefined) {
          if (this._normalizeSearch(String(v)).includes(term)) {
            results.push({ path: subPath, match: 'value' });
          }
        }
      }
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const subPath = `${currentPath}[${i}]`;
        if (typeof value[i] === 'object' && value[i] !== null) {
          results.push(...this._searchInValue(value[i], term, subPath));
        } else if (value[i] !== null && value[i] !== undefined) {
          if (this._normalizeSearch(String(value[i])).includes(term)) {
            results.push({ path: subPath, match: 'value' });
          }
        }
      }
    } else {
      if (this._normalizeSearch(String(value)).includes(term)) {
        results.push({ path: currentPath, match: 'value' });
      }
    }

    return results;
  }
}
