import * as zlib from 'zlib';

// ── WAV (16-bit PCM mono) ─────────────────────────────────────────────────────

export function encodeWav(samples: Float32Array, sampleRate = 44100): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

// ── PNG (truecolor, no dependencies) ─────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]!) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(0); // placeholder — PNG uses big-endian
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/**
 * Encode a vertical-gradient RGB image as PNG. Pure Node (zlib), no native
 * deps — used by the offline image adapter so the pipeline always produces a
 * real file even with no image provider configured.
 */
export function encodeGradientPng(
  width: number,
  height: number,
  top: [number, number, number],
  bottom: [number, number, number],
): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter: none
    const t = y / Math.max(1, height - 1);
    const r = Math.round((top[0] ?? 0) + ((bottom[0] ?? 0) - (top[0] ?? 0)) * t);
    const g = Math.round((top[1] ?? 0) + ((bottom[1] ?? 0) - (top[1] ?? 0)) * t);
    const b = Math.round((top[2] ?? 0) + ((bottom[2] ?? 0) - (top[2] ?? 0)) * t);
    for (let x = 0; x < width; x++) {
      raw[off++] = r;
      raw[off++] = g;
      raw[off++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic color pair from a string seed — scene N always gets the same gradient. */
export function seededGradient(seed: string): { top: [number, number, number]; bottom: [number, number, number] } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  const toRgb = (hDeg: number, s: number, l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hDeg / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
      hDeg < 60 ? [c, x, 0] : hDeg < 120 ? [x, c, 0] : hDeg < 180 ? [0, c, x]
      : hDeg < 240 ? [0, x, c] : hDeg < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  return { top: toRgb(hue, 0.45, 0.25), bottom: toRgb((hue + 40) % 360, 0.5, 0.45) };
}
