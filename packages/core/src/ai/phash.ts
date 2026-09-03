import type { GrayImage } from './types';
import { downscaleGray } from './quality';

/**
 * dHash (difference hash) 64 bits : image réduite à 9×8, chaque bit compare
 * deux pixels horizontaux adjacents. Robuste aux redimensionnements et à la
 * compression, idéal pour repérer les rafales et doublons.
 */
export function dHash(img: GrayImage): string {
  const small = downscaleGray(img, 9, 8);
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      const left = small.data[y * 9 + x]!;
      const right = small.data[y * 9 + x + 1]!;
      byte = (byte << 1) | (left > right ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Distance de Hamming entre deux hashs hexadécimaux de même longueur. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hashs de longueurs différentes');
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Deux hashs désignent-ils des images quasi identiques ? (seuil par défaut : 10 bits sur 64) */
export function isNearDuplicate(a: string, b: string, threshold = 10): boolean {
  return hammingDistance(a, b) <= threshold;
}
