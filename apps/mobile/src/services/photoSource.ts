import * as MediaLibrary from 'expo-media-library/legacy';
import type { PhotoSource, SourcePhoto } from '@albumphoto/core';

export function assetToSource(a: MediaLibrary.Asset): SourcePhoto {
  const src: SourcePhoto = {
    id: a.id,
    uri: a.uri,
    width: a.width,
    height: a.height,
    fileName: a.filename,
  };
  if (a.creationTime) src.takenAt = new Date(a.creationTime).toISOString();
  return src;
}

/** Galerie de l'appareil, de la plus récente à la plus ancienne. */
export class DevicePhotoSource implements PhotoSource {
  async *list(opts: { limit?: number; after?: string; before?: string }): AsyncIterable<SourcePhoto> {
    let cursor: string | undefined;
    let count = 0;
    for (;;) {
      const page = await MediaLibrary.getAssetsAsync({
        first: 100,
        after: cursor,
        mediaType: ['photo'],
        sortBy: [['creationTime', false]],
        ...(opts.after ? { createdAfter: Date.parse(opts.after) } : {}),
        ...(opts.before ? { createdBefore: Date.parse(opts.before) } : {}),
      });
      for (const asset of page.assets) {
        if (opts.limit && count >= opts.limit) return;
        count++;
        yield assetToSource(asset);
      }
      if (!page.hasNextPage || !page.endCursor) return;
      cursor = page.endCursor;
    }
  }
}

export async function ensureMediaPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(false, ['photo']);
  if (current.granted) return true;
  const asked = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  return asked.granted;
}
