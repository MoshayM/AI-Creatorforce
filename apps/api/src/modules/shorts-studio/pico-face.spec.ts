import * as path from 'path';
import { readFileSync } from 'fs';
import {
  classifyWindow,
  clusterDetections,
  motionCentroid,
  parsePgm,
  unpackCascade,
  type GrayFrame,
} from './pico-face';

/**
 * Hand-built single-tree cascade (depth 1): the tree compares the pixel at
 * the window center against the pixel one half-window to the right, predicts
 * +2 when center <= right, -2 otherwise, stage threshold 0.
 */
function tinyCascade(): Buffer {
  const treeDepth = 1;
  const treeCount = 1;
  const buf = Buffer.alloc(16 + 4 * (2 ** treeDepth - 1) + 4 * 2 ** treeDepth + 4);
  buf.writeInt32LE(treeDepth, 8);
  buf.writeInt32LE(treeCount, 12);
  let p = 16;
  // node 1 codes: (dr1, dc1, dr2, dc2) in 1/256 window units
  buf.writeInt8(0, p); // r offset of pixel A
  buf.writeInt8(0, p + 1); // c offset of pixel A → window center
  buf.writeInt8(0, p + 2); // r offset of pixel B
  buf.writeInt8(100, p + 3); // c offset of pixel B → right of center
  p += 4;
  buf.writeFloatLE(-2, p); // leaf 0: center > right
  buf.writeFloatLE(2, p + 4); // leaf 1: center <= right
  p += 8;
  buf.writeFloatLE(0, p); // stage threshold
  return buf;
}

function frame(width: number, height: number, fill: (x: number, y: number) => number): GrayFrame {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = fill(x, y);
  return { pixels, width, height };
}

describe('unpackCascade', () => {
  it('parses depth/count and per-tree codes, predictions, thresholds', () => {
    const c = unpackCascade(tinyCascade());
    expect(c.treeDepth).toBe(1);
    expect(c.treeCount).toBe(1);
    expect(c.codes).toHaveLength(8); // root placeholder + node 1
    expect(Array.from(c.codes.slice(4))).toEqual([0, 0, 0, 100]);
    expect(Array.from(c.predictions)).toEqual([-2, 2]);
    expect(Array.from(c.thresholds)).toEqual([0]);
  });

  it('parses the bundled facefinder asset', () => {
    const buf = readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'facefinder'));
    const c = unpackCascade(buf);
    expect(c.treeDepth).toBe(6);
    expect(c.treeCount).toBe(468);
    // Consumed exactly the whole file: 16-byte header + per-tree payload.
    const perTree = 4 * (2 ** 6 - 1) + 4 * 2 ** 6 + 4;
    expect(buf.length).toBe(16 + 468 * perTree);
  });
});

describe('classifyWindow', () => {
  const cascade = unpackCascade(tinyCascade());

  it('accepts a window whose center is darker than its right side', () => {
    // Brightness increases left→right, so center <= right everywhere.
    const f = frame(64, 64, (x) => x * 3);
    expect(classifyWindow(cascade, 32, 32, 20, f)).toBeGreaterThan(0);
  });

  it('rejects a window whose center is brighter than its right side', () => {
    const f = frame(64, 64, (x) => 255 - x * 3);
    expect(classifyWindow(cascade, 32, 32, 20, f)).toBe(-1);
  });

  it('rejects windows extending past the frame edge', () => {
    const f = frame(64, 64, () => 128);
    expect(classifyWindow(cascade, 2, 2, 20, f)).toBe(-1);
  });
});

describe('clusterDetections', () => {
  it('merges overlapping detections into a score-weighted cluster', () => {
    const clusters = clusterDetections([
      { row: 50, col: 50, size: 40, score: 3 },
      { row: 52, col: 52, size: 40, score: 1 },
      { row: 200, col: 200, size: 40, score: 2 },
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.score).toBe(4); // summed cluster outranks the lone hit
    expect(clusters[0]!.col).toBeCloseTo(50.5); // weighted toward the stronger hit
  });
});

describe('motionCentroid', () => {
  it('finds the centroid of the changed region', () => {
    const a = frame(100, 100, () => 0);
    // A bright moving blob near the right edge.
    const b = frame(100, 100, (x, y) => (x >= 80 && x < 90 && y >= 40 && y < 50 ? 200 : 0));
    const m = motionCentroid(a, b);
    expect(m.mass).toBeGreaterThan(0);
    expect(m.cx).toBeCloseTo(0.845, 1);
    expect(m.cy).toBeCloseTo(0.445, 1);
  });

  it('ignores sub-noise-floor differences and reports zero mass', () => {
    const a = frame(50, 50, () => 100);
    const b = frame(50, 50, () => 105); // diff 5 < noise floor 16
    const m = motionCentroid(a, b);
    expect(m.mass).toBe(0);
    expect(m.cx).toBe(0.5);
  });
});

describe('parsePgm', () => {
  it('parses a binary P5 file', () => {
    const header = Buffer.from('P5\n4 2\n255\n', 'latin1');
    const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const f = parsePgm(Buffer.concat([header, data]));
    expect(f.width).toBe(4);
    expect(f.height).toBe(2);
    expect(Array.from(f.pixels)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('rejects non-PGM data', () => {
    expect(() => parsePgm(Buffer.from('JFIF....'))).toThrow(/P5/);
  });
});
