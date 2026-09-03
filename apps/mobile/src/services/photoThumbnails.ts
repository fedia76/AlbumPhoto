import type { SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';
import { renderJpegFile } from './pixels';

/** Vignettes déjà produites, pour ne pas refaire le travail en défilant. */
const cache = new Map<string, string>();

/**
 * Vignette d'une photo de l'appareil. Indispensable pour les listes : afficher
 * l'original (plusieurs milliers de pixels) dans une case de 80 px sature la
 * mémoire et hache le défilement.
 */
export async function getPhotoThumbnail(photo: SourcePhoto, size = 200): Promise<string> {
  const key = `${photo.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const uri = await resolveFileUri(photo);
  const resize = photo.width >= photo.height ? { width: size } : { height: size };
  const rendered = await renderJpegFile(uri, { resize, compress: 0.8 });
  cache.set(key, rendered.uri);
  return rendered.uri;
}
