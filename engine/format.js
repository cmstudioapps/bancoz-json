// engine/format.js
// Serialização e deserialização de registros binários para o Bancoz Engine
// Formato: [CRC32 4B][Timestamp 8B][KeySize 4B][ValSize 4B][Tombstone 1B][Key][Value]
// Header total: 21 bytes fixos

import { Buffer } from 'node:buffer';

// ─── CRC32 (Castagnoli, sem dependências externas) ───

const CRC32_TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Calcula CRC32 de um Buffer.
 * @param {Buffer} buffer
 * @returns {number} CRC32 como uint32
 */
export function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── Constantes ───

export const HEADER_SIZE = 21;

// Offsets dentro do header
const OFF_CRC       = 0;   // 4 bytes
const OFF_TIMESTAMP = 4;   // 8 bytes (BigUInt64LE)
const OFF_KEY_SIZE  = 12;  // 4 bytes (UInt32LE)
const OFF_VAL_SIZE  = 16;  // 4 bytes (UInt32LE)
const OFF_TOMBSTONE = 20;  // 1 byte  (UInt8)

// ─── Serialização ───

/**
 * Serializa um registro em Buffer binário.
 * @param {string} key - Chave do registro (ex: "caio")
 * @param {string} valueString - Valor já serializado como JSON string
 * @param {boolean} [tombstone=false] - Se true, marca o registro como deletado
 * @returns {{ buffer: Buffer, timestamp: number, totalSize: number }}
 */
export function serializeRecord(key, valueString, tombstone = false) {
  const keyBuf = Buffer.from(key, 'utf8');
  const valBuf = tombstone ? Buffer.alloc(0) : Buffer.from(valueString, 'utf8');

  const totalSize = HEADER_SIZE + keyBuf.length + valBuf.length;
  const buf = Buffer.alloc(totalSize);

  // Timestamp (milissegundos desde epoch)
  const timestamp = Date.now();
  buf.writeBigUInt64LE(BigInt(timestamp), OFF_TIMESTAMP);

  // Tamanhos
  buf.writeUInt32LE(keyBuf.length, OFF_KEY_SIZE);
  buf.writeUInt32LE(valBuf.length, OFF_VAL_SIZE);

  // Tombstone flag
  buf.writeUInt8(tombstone ? 1 : 0, OFF_TOMBSTONE);

  // Key + Value
  keyBuf.copy(buf, HEADER_SIZE);
  if (!tombstone) {
    valBuf.copy(buf, HEADER_SIZE + keyBuf.length);
  }

  // CRC32 sobre tudo exceto o próprio campo CRC (bytes 4 em diante)
  const crcValue = crc32(buf.subarray(4));
  buf.writeUInt32LE(crcValue, OFF_CRC);

  return { buffer: buf, timestamp, totalSize };
}

// ─── Deserialização ───

/**
 * Deserializa apenas o header de um registro.
 * @param {Buffer} buffer
 * @param {number} [offset=0]
 * @returns {{ storedCrc: number, timestamp: number, keySize: number, valSize: number, tombstone: boolean, totalSize: number } | null}
 */
export function deserializeHeader(buffer, offset = 0) {
  if (buffer.length - offset < HEADER_SIZE) return null;

  const storedCrc = buffer.readUInt32LE(offset + OFF_CRC);
  const timestamp = Number(buffer.readBigUInt64LE(offset + OFF_TIMESTAMP));
  const keySize   = buffer.readUInt32LE(offset + OFF_KEY_SIZE);
  const valSize   = buffer.readUInt32LE(offset + OFF_VAL_SIZE);
  const tombstone = buffer.readUInt8(offset + OFF_TOMBSTONE) === 1;

  const totalSize = HEADER_SIZE + keySize + valSize;

  return { storedCrc, timestamp, keySize, valSize, tombstone, totalSize };
}

/**
 * Deserializa um registro completo a partir de um Buffer.
 * Verifica integridade via CRC32.
 * @param {Buffer} buffer
 * @param {number} [offset=0]
 * @returns {{ key: string, value: string, tombstone: boolean, timestamp: number, totalSize: number } | null}
 */
export function deserializeRecord(buffer, offset = 0) {
  const header = deserializeHeader(buffer, offset);
  if (!header) return null;

  const { storedCrc, timestamp, keySize, valSize, tombstone, totalSize } = header;

  // Buffer não tem dados suficientes para o registro completo
  if (buffer.length - offset < totalSize) return null;

  // Verificação de integridade CRC32
  const computedCrc = crc32(buffer.subarray(offset + 4, offset + totalSize));
  if (storedCrc !== computedCrc) {
    throw new Error(
      `[Bancoz Engine] CRC inválido no offset ${offset}: ` +
      `esperado=${storedCrc}, calculado=${computedCrc}. Registro possivelmente corrompido.`
    );
  }

  const keyStart = offset + HEADER_SIZE;
  const valStart = keyStart + keySize;

  const key   = buffer.toString('utf8', keyStart, keyStart + keySize);
  const value = tombstone ? '' : buffer.toString('utf8', valStart, valStart + valSize);

  return { key, value, tombstone, timestamp, totalSize };
}

/**
 * Itera sobre todos os registros em um Buffer, chamando callback para cada um.
 * Útil para rebuild do índice e compactação.
 * @param {Buffer} buffer
 * @param {(record: { key: string, value: string, tombstone: boolean, timestamp: number, totalSize: number }, offset: number) => void} callback
 */
export function iterateRecords(buffer, callback) {
  let offset = 0;
  while (offset < buffer.length) {
    // Verificar se há header suficiente
    const header = deserializeHeader(buffer, offset);
    if (!header) break;

    // Verificar se há dados suficientes para o registro completo
    if (offset + header.totalSize > buffer.length) break;

    try {
      const record = deserializeRecord(buffer, offset);
      if (record) {
        callback(record, offset);
      }
      offset += record.totalSize;
    } catch (err) {
      // Registro corrompido — para a iteração neste ponto
      // (registros após corrupção podem estar desalinhados)
      break;
    }
  }
}
