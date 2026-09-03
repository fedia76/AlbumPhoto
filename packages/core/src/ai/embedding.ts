import type { NormRect } from '../album/types';
import type { RgbaImage } from './types';
import { downscaleGray, toGray } from './quality';

/** Extrait un rectangle normalisé d'une image RGBA (avec marge optionnelle). */
export function cropRgba(img: RgbaImage, rect: NormRect, margin = 0): RgbaImage {
  const x0 = Math.max(0, Math.floor((rect.x - rect.w * margin) * img.width));
  const y0 = Math.max(0, Math.floor((rect.y - rect.h * margin) * img.height));
  const x1 = Math.min(img.width, Math.ceil((rect.x + rect.w * (1 + margin)) * img.width));
  const y1 = Math.min(img.height, Math.ceil((rect.y + rect.h * (1 + margin)) * img.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/**
 * Vecteur d'identité de repli, sans modèle : visage en niveaux de gris 16×16,
 * centré-réduit. Bien moins discriminant qu'un réseau (MobileFaceNet/ArcFace)
 * mais permet un regroupement grossier quand aucun modèle n'est disponible.
 */
export function pixelFaceEmbedding(faceCrop: RgbaImage, size = 16): Float32Array {
  const g = downscaleGray(toGray(faceCrop), size, size);
  const n = size * size;
  const v = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += g.data[i]!;
  mean /= n;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    v[i] = g.data[i]! - mean;
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < n; i++) v[i]! /= norm;
  return v;
}

/** Seuil de similarité conseillé pour `pixelFaceEmbedding` (plus strict qu'un vrai modèle). */
export const PIXEL_EMBEDDING_THRESHOLD = 0.85;
