import { File } from 'expo-file-system';
import { ALBUM_PHOTOS_DIR, ALBUM_THUMBS_DIR, type Photo, type PhotoImporter, type SourcePhoto } from '@albumphoto/core';
import { BUNDLE_THUMBNAIL } from '../config';
import { resolveFileUri } from './fileUri';
import { renderJpegFile } from './pixels';
import { bundleDir, ensureBundle } from '../storage/albumStore';

function extensionFor(uri: string, fileName?: string): string {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(fileName ?? uri);
  const ext = (m?.[1] ?? 'jpg').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

/** Copie une photo de l'appareil dans le bundle d'album et produit une vignette. */
export class BundlePhotoImporter implements PhotoImporter {
  async importPhoto(albumId: string, photo: SourcePhoto): Promise<Pick<Photo, 'src' | 'thumb' | 'mimeType'>> {
    const dir = bundleDir(albumId);
    ensureBundle(albumId);
    const ext = extensionFor(photo.uri, photo.fileName);
    const src = `${ALBUM_PHOTOS_DIR}/${photo.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
    const dest = new File(dir, src);
    const sourceUri = await resolveFileUri(photo);
    if (!dest.exists) await new File(sourceUri).copy(dest);

    const thumbRel = `${ALBUM_THUMBS_DIR}/${photo.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
    const thumbFile = new File(dir, thumbRel);
    if (!thumbFile.exists) {
      const resize = photo.width >= photo.height ? { width: BUNDLE_THUMBNAIL } : { height: BUNDLE_THUMBNAIL };
      const rendered = await renderJpegFile(sourceUri, { resize });
      await new File(rendered.uri).move(thumbFile);
    }
    const mimeType = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { src, thumb: thumbRel, mimeType };
  }
}
