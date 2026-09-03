import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import jpeg from 'jpeg-js';
import type { PixelReader, RgbaImage, SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';

export function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Décode un JPEG (base64) en RGBA via jpeg-js (pur JS, pas de module natif). */
export function decodeJpegBase64(b64: string): RgbaImage {
  const decoded = jpeg.decode(base64ToBytes(b64), { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

export interface RenderOptions {
  crop?: { originX: number; originY: number; width: number; height: number };
  resize?: { width?: number; height?: number };
  compress?: number;
}

/** Rend une image (rognage / redimensionnement) en JPEG base64. */
export async function renderJpegBase64(uri: string, opts: RenderOptions): Promise<{ base64: string; width: number; height: number }> {
  const ctx = ImageManipulator.manipulate(uri);
  if (opts.crop) ctx.crop(opts.crop);
  if (opts.resize) ctx.resize(opts.resize);
  const ref = await ctx.renderAsync();
  try {
    const res = await ref.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: opts.compress ?? 0.9 });
    return { base64: res.base64 ?? '', width: res.width, height: res.height };
  } finally {
    ref.release();
  }
}

/** Rend une image redimensionnée dans un fichier JPEG ; renvoie son URI. */
export async function renderJpegFile(uri: string, opts: RenderOptions): Promise<{ uri: string; width: number; height: number }> {
  const ctx = ImageManipulator.manipulate(uri);
  if (opts.crop) ctx.crop(opts.crop);
  if (opts.resize) ctx.resize(opts.resize);
  const ref = await ctx.renderAsync();
  try {
    const res = await ref.saveAsync({ format: SaveFormat.JPEG, compress: opts.compress ?? 0.85 });
    return { uri: res.uri, width: res.width, height: res.height };
  } finally {
    ref.release();
  }
}

/** Lecture de vignettes RGBA pour les métriques de qualité et le hash. */
export class ManipulatorPixelReader implements PixelReader {
  private cache = new Map<string, RgbaImage>();

  async readThumbnail(photo: SourcePhoto, maxSize: number): Promise<RgbaImage> {
    const key = `${photo.id}:${maxSize}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const uri = await resolveFileUri(photo);
    const resize = photo.width >= photo.height ? { width: maxSize } : { height: maxSize };
    const { base64 } = await renderJpegBase64(uri, { resize, compress: 0.92 });
    const img = decodeJpegBase64(base64);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, img);
    return img;
  }
}
