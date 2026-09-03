import type { NormRect, SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';
import { renderJpegFile } from './pixels';

/** Côté (px) des vignettes de visage affichées dans l'assistant. */
export const FACE_THUMB_SIZE = 200;

/**
 * Découpe le visage d'une photo en une petite vignette réutilisable.
 *
 * Sans cela, l'assistant afficherait la photo d'origine (plusieurs milliers de
 * pixels de côté) dans une pastille de 96 px, pour chaque personne détectée :
 * autant d'images pleine résolution décodées en mémoire, d'où les à-coups.
 */
export async function renderFaceThumbnail(photo: SourcePhoto, faceRect: NormRect, size = FACE_THUMB_SIZE): Promise<string> {
  const uri = await resolveFileUri(photo);
  // Marge autour du visage pour un cadrage agréable.
  const margin = 0.6;
  const centerX = (faceRect.x + faceRect.w / 2) * photo.width;
  const centerY = (faceRect.y + faceRect.h / 2) * photo.height;
  const side = Math.max(faceRect.w * photo.width, faceRect.h * photo.height) * (1 + margin);
  const originX = Math.max(0, Math.round(centerX - side / 2));
  const originY = Math.max(0, Math.round(centerY - side / 2));
  const width = Math.max(1, Math.round(Math.min(side, photo.width - originX)));
  const height = Math.max(1, Math.round(Math.min(side, photo.height - originY)));
  const rendered = await renderJpegFile(uri, {
    crop: { originX, originY, width, height },
    resize: { width: size },
    compress: 0.85,
  });
  return rendered.uri;
}
