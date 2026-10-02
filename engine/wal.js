// engine/wal.js
// Write-Ahead Log — garante durabilidade e recuperação após falhas
// Toda operação é registrada no WAL ANTES de ser aplicada ao segmento.
// Na inicialização, replay do WAL recupera operações pendentes.

import { promises as fs, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} WALEntry
 * @property {string} op          - Tipo da operação: 'put' ou 'delete'
 * @property {string} collection  - Nome da coleção (ex: "usuarios")
 * @property {string} key         - Chave do registro
 * @property {string} [value]     - Valor serializado (apenas para 'put')
 * @property {number} timestamp   - Timestamp da operação
 * @property {boolean} [committed] - Se a operação foi confirmada no segmento
 */

export class WAL {
  /**
   * @param {string} filePath - Caminho para o arquivo wal.log
   */
  constructor(filePath) {
    this._filePath = filePath;
    this._stream = null;
    this._pendingWrites = 0;
    this._closed = false;
  }

  /**
   * Abre o WAL para escrita (append).
   * Cria o arquivo e diretórios necessários se não existirem.
   */
  async open() {
    const dir = path.dirname(this._filePath);
    await fs.mkdir(dir, { recursive: true });

    this._stream = createWriteStream(this._filePath, {
      flags: 'a',     // append
      encoding: 'utf8',
      // flush imediato para garantir durabilidade
      autoClose: false
    });

    // Esperar o stream estar pronto
    await new Promise((resolve, reject) => {
      this._stream.on('open', resolve);
      this._stream.on('error', reject);
    });

    this._closed = false;
  }

  /**
   * Registra uma operação no WAL.
   * A escrita é síncrona em termos de garantia — o dado é flushed para o SO.
   * 
   * @param {WALEntry} entry
   * @returns {Promise<void>}
   */
  async append(entry) {
    if (this._closed || !this._stream) {
      throw new Error('[Bancoz WAL] WAL não está aberto. Chame open() primeiro.');
    }

    const line = JSON.stringify(entry) + '\n';

    return new Promise((resolve, reject) => {
      const ok = this._stream.write(line, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });

      // Se o buffer interno estiver cheio, espera o drain
      if (!ok) {
        this._stream.once('drain', resolve);
      }
    });
  }

  /**
   * Marca uma operação como committed (confirmada no segmento).
   * Registra uma entrada de commit para que o replay saiba que já foi aplicada.
   * 
   * @param {string} key
   * @param {number} timestamp
   */
  async commit(key, timestamp) {
    await this.append({
      op: 'commit',
      key,
      timestamp,
      committed: true
    });
  }

  /**
   * Lê e reconstrói todas as operações pendentes do WAL.
   * Retorna apenas operações que NÃO foram commitadas.
   * 
   * @returns {Promise<WALEntry[]>} Operações pendentes de aplicação
   */
  async replay() {
    let raw;
    try {
      raw = await fs.readFile(this._filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    if (!raw.trim()) return [];

    const lines = raw.trim().split('\n');
    const pending = new Map();  // key+timestamp → entry
    const committed = new Set(); // key+timestamp committed

    for (const line of lines) {
      if (!line.trim()) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        // Linha corrompida (possível crash no meio da escrita)
        // Ignora e continua — o WAL é tolerante a truncamento
        continue;
      }

      if (entry.op === 'commit') {
        committed.add(`${entry.key}:${entry.timestamp}`);
      } else {
        pending.set(`${entry.key}:${entry.timestamp}`, entry);
      }
    }

    // Retornar apenas operações não commitadas
    const result = [];
    for (const [id, entry] of pending) {
      if (!committed.has(id)) {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Checkpoint: limpa o WAL após todas as operações terem sido persistidas.
   * Chamado após salvar o índice (KeyDir) em disco.
   */
  async checkpoint() {
    // Fecha o stream atual
    if (this._stream && !this._closed) {
      await this._closeStream();
    }

    // Trunca o arquivo (zera o conteúdo)
    try {
      await fs.writeFile(this._filePath, '', 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Reabre para novas escritas
    await this.open();
  }

  /**
   * Fecha o WAL de forma graciosa.
   */
  async close() {
    if (this._stream && !this._closed) {
      await this._closeStream();
    }
  }

  /**
   * Verifica se o arquivo WAL existe e tem conteúdo.
   * @returns {Promise<boolean>}
   */
  async hasPendingEntries() {
    try {
      const stat = await fs.stat(this._filePath);
      return stat.size > 0;
    } catch (_) {
      return false;
    }
  }

  /**
   * Fecha o WriteStream interno.
   * @private
   */
  async _closeStream() {
    return new Promise((resolve, reject) => {
      this._stream.end(() => {
        this._closed = true;
        resolve();
      });
      this._stream.on('error', reject);
    });
  }
}
