// Clean-room TypeScript implementation of the pico object-detection runtime
// (format + algorithm from github.com/nenadmarkus/pico, MIT). The bundled
// cascade asset `apps/api/assets/facefinder` comes from the same MIT repo.
//
// A cascade is an ensemble of depth-`tdepth` binary decision trees over
// pixel-intensity comparisons inside a square window. A window survives the
// cascade when its running score stays above every stage threshold; the final
// score (margin over the last threshold) is the detection confidence.
//
// All functions here are pure — no I/O, no side effects — so they are unit
// testable with tiny hand-built cascades and synthetic frames.

/** Grayscale frame: row-major bytes, one byte per pixel. */
export interface GrayFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface PicoCascade {
  treeDepth: number;
  treeCount: number;
  /** 4 int8 pixel-offset codes per node, 4*2^depth per tree (node 0 unused). */
  codes: Int8Array;
  /** 2^depth leaf predictions per tree. */
  predictions: Float32Array;
  /** One stage threshold per tree. */
  thresholds: Float32Array;
}

/** Detection in pixel space: window center (row, col), size and score. */
export interface FaceDetection {
  row: number;
  col: number;
  size: number;
  score: number;
}

/**
 * Parse the pico binary cascade format: bytes 0–7 reserved, then int32 tree
 * depth, int32 tree count, then per tree: 4×(2^depth−1) int8 codes,
 * 2^depth float32 leaf predictions, one float32 stage threshold.
 * Node indexing is 1-based, so 4 zero bytes are prepended per tree to make
 * `codes[4*nodeIdx]` addressable directly (same trick as the reference impl).
 */
export function unpackCascade(buf: Buffer): PicoCascade {
  const treeDepth = buf.readInt32LE(8);
  const treeCount = buf.readInt32LE(12);
  const nodesPerTree = 2 ** treeDepth; // includes the unused root slot
  const codes = new Int8Array(treeCount * 4 * nodesPerTree);
  const predictions = new Float32Array(treeCount * nodesPerTree);
  const thresholds = new Float32Array(treeCount);

  let p = 16;
  for (let t = 0; t < treeCount; t++) {
    // leave codes[t*4*nodesPerTree .. +3] as the zeroed root placeholder
    const codeBase = t * 4 * nodesPerTree + 4;
    for (let i = 0; i < 4 * (nodesPerTree - 1); i++) codes[codeBase + i] = buf.readInt8(p + i);
    p += 4 * (nodesPerTree - 1);
    for (let i = 0; i < nodesPerTree; i++) predictions[t * nodesPerTree + i] = buf.readFloatLE(p + 4 * i);
    p += 4 * nodesPerTree;
    thresholds[t] = buf.readFloatLE(p);
    p += 4;
  }
  return { treeDepth, treeCount, codes, predictions, thresholds };
}

/**
 * Score one square window (center row/col, side `size`) against the cascade.
 * Returns -1 when rejected by any stage, otherwise the confidence margin.
 */
export function classifyWindow(
  cascade: PicoCascade,
  row: number,
  col: number,
  size: number,
  frame: GrayFrame,
): number {
  const { pixels, width, height } = frame;
  const { treeDepth, treeCount, codes, predictions, thresholds } = cascade;
  const nodesPerTree = 2 ** treeDepth;

  // Fixed-point (8-bit fraction) center, as in the reference runtime.
  const r = row * 256;
  const c = col * 256;

  // Reject windows that would sample outside the frame.
  if (row - size / 2 < 0 || col - size / 2 < 0 || row + size / 2 >= height || col + size / 2 >= width) {
    return -1;
  }

  let score = 0;
  for (let t = 0; t < treeCount; t++) {
    const codeBase = t * 4 * nodesPerTree;
    let node = 1;
    for (let d = 0; d < treeDepth; d++) {
      const o = codeBase + 4 * node;
      const p1 = (((r + codes[o]! * size) >> 8) * width + ((c + codes[o + 1]! * size) >> 8));
      const p2 = (((r + codes[o + 2]! * size) >> 8) * width + ((c + codes[o + 3]! * size) >> 8));
      node = 2 * node + (pixels[p1]! <= pixels[p2]! ? 1 : 0);
    }
    score += predictions[t * nodesPerTree + node - nodesPerTree]!;
    if (score <= thresholds[t]!) return -1;
  }
  return score - thresholds[treeCount - 1]!;
}

export interface DetectOptions {
  /** Smallest window side in pixels. */
  minSize?: number;
  /** Largest window side in pixels (defaults to min(frame dims)). */
  maxSize?: number;
  /** Multiplicative scale step between window sizes. */
  scaleFactor?: number;
  /** Window stride as a fraction of the window size. */
  strideFactor?: number;
}

/** Slide the cascade over the frame at multiple scales; returns raw (unclustered) detections. */
export function detectFaces(cascade: PicoCascade, frame: GrayFrame, opts: DetectOptions = {}): FaceDetection[] {
  const minSize = opts.minSize ?? 20;
  const maxSize = opts.maxSize ?? Math.min(frame.width, frame.height);
  const scaleFactor = opts.scaleFactor ?? 1.1;
  const strideFactor = opts.strideFactor ?? 0.1;

  const detections: FaceDetection[] = [];
  for (let size = minSize; size <= maxSize; size = Math.max(size + 1, Math.floor(size * scaleFactor))) {
    const stride = Math.max(1, Math.floor(size * strideFactor));
    for (let row = Math.ceil(size / 2); row + size / 2 < frame.height; row += stride) {
      for (let col = Math.ceil(size / 2); col + size / 2 < frame.width; col += stride) {
        const score = classifyWindow(cascade, row, col, size, frame);
        if (score > 0) detections.push({ row, col, size, score });
      }
    }
  }
  return detections;
}

/**
 * Greedy overlap clustering (the reference runtime's approach): detections
 * whose windows overlap by IoU > `iouThreshold` merge into one cluster whose
 * position is the score-weighted mean and whose score is the sum — so a face
 * confirmed by many overlapping windows outranks a single spurious hit.
 */
export function clusterDetections(detections: FaceDetection[], iouThreshold = 0.2): FaceDetection[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const used = new Array<boolean>(sorted.length).fill(false);
  const clusters: FaceDetection[] = [];

  const iou = (a: FaceDetection, b: FaceDetection): number => {
    const half = (d: FaceDetection) => d.size / 2;
    const x1 = Math.max(a.col - half(a), b.col - half(b));
    const y1 = Math.max(a.row - half(a), b.row - half(b));
    const x2 = Math.min(a.col + half(a), b.col + half(b));
    const y2 = Math.min(a.row + half(a), b.row + half(b));
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.size * a.size + b.size * b.size - inter;
    return union > 0 ? inter / union : 0;
  };

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    let sumScore = 0;
    let row = 0;
    let col = 0;
    let size = 0;
    for (let j = i; j < sorted.length; j++) {
      if (used[j] || iou(sorted[i]!, sorted[j]!) <= iouThreshold) continue;
      used[j] = true;
      const w = sorted[j]!.score;
      sumScore += w;
      row += sorted[j]!.row * w;
      col += sorted[j]!.col * w;
      size += sorted[j]!.size * w;
    }
    clusters.push({ row: row / sumScore, col: col / sumScore, size: size / sumScore, score: sumScore });
  }
  return clusters.sort((a, b) => b.score - a.score);
}

/**
 * Movement detection: absolute frame difference against the previous frame,
 * returning the difference-mass centroid (normalized 0..1) and total mass.
 * Small differences (< noiseFloor) are ignored so sensor noise and encoding
 * artifacts don't pull the centroid toward the frame center.
 */
export function motionCentroid(
  prev: GrayFrame,
  cur: GrayFrame,
  noiseFloor = 16,
): { cx: number; cy: number; mass: number } {
  const { width, height } = cur;
  let mass = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = Math.abs(cur.pixels[i]! - prev.pixels[i]!);
      if (d < noiseFloor) continue;
      mass += d;
      sx += x * d;
      sy += y * d;
    }
  }
  if (mass === 0) return { cx: 0.5, cy: 0.5, mass: 0 };
  return { cx: sx / mass / width, cy: sy / mass / height, mass };
}

/** Parse a binary PGM (P5, maxval ≤255) file as written by ffmpeg's image2 muxer. */
export function parsePgm(buf: Buffer): GrayFrame {
  // Header: "P5" <ws> width <ws> height <ws> maxval <single ws> data
  const header = buf.subarray(0, 64).toString('latin1');
  const m = header.match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!m) throw new Error('Not a binary PGM (P5) file');
  const width = parseInt(m[1]!, 10);
  const height = parseInt(m[2]!, 10);
  const dataStart = m[0]!.length;
  const pixels = new Uint8Array(buf.subarray(dataStart, dataStart + width * height));
  if (pixels.length !== width * height) throw new Error('PGM data truncated');
  return { pixels, width, height };
}
