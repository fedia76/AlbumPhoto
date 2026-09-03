import * as MediaLibrary from 'expo-media-library/legacy';
import type { SourcePhoto } from '@albumphoto/core';

const cache = new Map<string, string>();

/**
 * Renvoie une URI `file://` exploitable par les modules natifs (ML Kit,
 * manipulateur d'image). Sur iOS la galerie expose des `ph://` qu'il faut
 * résoudre via `getAssetInfoAsync`.
 */
export async function resolveFileUri(photo: SourcePhoto): Promise<string> {
  if (photo.uri.startsWith('file://')) return photo.uri;
  const hit = cache.get(photo.id);
  if (hit) return hit;
  const info = await MediaLibrary.getAssetInfoAsync(photo.id, { shouldDownloadFromNetwork: false });
  const uri = info.localUri ?? photo.uri;
  cache.set(photo.id, uri);
  return uri;
}

export function clearFileUriCache(): void {
  cache.clear();
}
