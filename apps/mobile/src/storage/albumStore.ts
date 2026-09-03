import { Directory, File, Paths } from 'expo-file-system';
import {
  ALBUM_MANIFEST_FILENAME,
  ALBUM_PHOTOS_DIR,
  ALBUM_THUMBS_DIR,
  parseAlbum,
  serializeAlbum,
  touch,
  type Album,
  type Photo,
} from '@albumphoto/core';

/** Dossier racine des albums : `<documents>/albums/<id>.album/`. */
export function albumsDir(): Directory {
  return new Directory(Paths.document, 'albums');
}

export function bundleDir(albumId: string): Directory {
  return new Directory(albumsDir(), `${albumId}.album`);
}

export function ensureBundle(albumId: string): Directory {
  const dir = bundleDir(albumId);
  dir.create({ intermediates: true, idempotent: true });
  new Directory(dir, ALBUM_PHOTOS_DIR).create({ intermediates: true, idempotent: true });
  new Directory(dir, ALBUM_THUMBS_DIR).create({ intermediates: true, idempotent: true });
  return dir;
}

export interface AlbumSummary {
  id: string;
  title: string;
  updatedAt: string;
  pageCount: number;
  photoCount: number;
  coverUri?: string;
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  const root = albumsDir();
  if (!root.exists) return [];
  const out: AlbumSummary[] = [];
  for (const entry of root.list()) {
    if (!(entry instanceof Directory) || !entry.uri.replace(/\/$/, '').endsWith('.album')) continue;
    const manifest = new File(entry, ALBUM_MANIFEST_FILENAME);
    if (!manifest.exists) continue;
    try {
      const album = parseAlbum(await manifest.text());
      const cover = album.pages[0] ? Object.values(album.pages[0].photos)[0] : undefined;
      const coverPhoto = cover ? album.photos.find((p) => p.id === cover.photoId) : album.photos[0];
      out.push({
        id: album.id,
        title: album.title,
        updatedAt: album.updatedAt,
        pageCount: album.pages.length,
        photoCount: album.photos.length,
        ...(coverPhoto ? { coverUri: photoUri(album, coverPhoto, true) } : {}),
      });
    } catch (e) {
      console.warn('Album illisible', entry.uri, e);
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadAlbum(albumId: string): Promise<Album> {
  const manifest = new File(bundleDir(albumId), ALBUM_MANIFEST_FILENAME);
  return parseAlbum(await manifest.text());
}

export async function saveAlbum(album: Album): Promise<void> {
  ensureBundle(album.id);
  touch(album);
  new File(bundleDir(album.id), ALBUM_MANIFEST_FILENAME).write(serializeAlbum(album));
}

export async function deleteAlbum(albumId: string): Promise<void> {
  const dir = bundleDir(albumId);
  if (dir.exists) dir.delete();
}

/** URI absolue d'une photo (ou de sa vignette) du bundle, pour l'affichage. */
export function photoUri(album: Album, photo: Photo, preferThumb = false): string {
  const rel = preferThumb && photo.thumb ? photo.thumb : photo.src;
  return new File(bundleDir(album.id), rel).uri;
}
