import type { DetectedFace, PhotoAnalysis, RgbaImage, SourcePhoto } from '../src';

/** Image RGBA synthétique : `fn(x, y)` renvoie [r, g, b]. */
export function synthImage(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data };
}

/**
 * Image nette : grandes structures (sinusoïdes dépendant de `seed`, pour que
 * chaque photo ait sa propre empreinte) + fin damier (netteté).
 */
export const sharpImage = (w = 64, h = 64, seed = 0): RgbaImage =>
  synthImage(w, h, (x, y) => {
    const u = x / w;
    const v = y / h;
    const k = 1 + (seed % 5);
    const base = 128 + 90 * Math.sin(2 * Math.PI * (u * k + v * (seed % 3) + seed * 0.37)) * Math.cos(2 * Math.PI * v * ((seed >> 2) % 3 || 1));
    const fine = ((x + y) & 1 ? 40 : -40) * 1;
    return [clamp(base + fine + 30), clamp(base + fine - 10 * k), clamp(255 - base + fine)];
  });
const clamp = (v: number) => Math.max(0, Math.min(255, v));
/** Dégradé très doux (flou). */
export const blurryImage = (w = 64, h = 64) => synthImage(w, h, (x) => [100 + (x * 40) / w, 110 + (x * 40) / w, 120 + (x * 40) / w]);
/** Image presque blanche (surexposée). */
export const overexposed = (w = 64, h = 64) => synthImage(w, h, () => [254, 254, 254]);

let seed = 42;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

/** Vecteur d'identité déterministe pour une personne (pseudo-aléatoire par personne), avec un peu de bruit. */
export function embeddingFor(personIndex: number, noise = 0.15, dim = 32): Float32Array {
  const v = new Float32Array(dim);
  let s = (personIndex + 1) * 2654435761 >>> 0;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = (s / 0xffffffff - 0.5) * 2 + (rand() - 0.5) * noise;
  }
  return v;
}

export function face(personIndex: number | null, opts: Partial<DetectedFace> = {}): DetectedFace {
  const f: DetectedFace = {
    rect: { x: 0.35, y: 0.3, w: 0.2, h: 0.25 },
    smilingProbability: 0.8,
    leftEyeOpenProbability: 0.95,
    rightEyeOpenProbability: 0.95,
    headEulerAngleY: 3,
    ...opts,
  };
  if (personIndex !== null) f.embedding = embeddingFor(personIndex);
  return f;
}

export function source(id: string, takenAt?: string, w = 4000, h = 3000): SourcePhoto {
  return { id, uri: `file:///photos/${id}.jpg`, width: w, height: h, takenAt, mimeType: 'image/jpeg' };
}

export function analysis(
  id: string,
  faces: DetectedFace[],
  opts: { takenAt?: string; sharpness?: number; hash?: string; labels?: string[]; portrait?: boolean } = {},
): PhotoAnalysis {
  const sharpness = opts.sharpness ?? 0.8;
  return {
    photo: source(id, opts.takenAt, opts.portrait ? 3000 : 4000, opts.portrait ? 4000 : 3000),
    faces,
    quality: { sharpness, exposure: 0.8, contrast: 0.7, colorfulness: 0.5, meanLuma: 120, laplacianVariance: sharpness * 400 },
    hash: opts.hash ?? id.padEnd(16, '0').slice(0, 16).replace(/[^0-9a-f]/g, 'a'),
    labels: opts.labels ?? [],
  };
}
