import { describe, expect, it } from 'vitest';
import {
  ALBUM_FORMAT_VERSION,
  AlbumValidationError,
  BUILTIN_TEMPLATES,
  addPage,
  changePageTemplate,
  clearSlot,
  createAlbum,
  movePage,
  parseAlbum,
  placePhoto,
  pruneTemplates,
  removePage,
  serializeAlbum,
  setText,
  unusedPhotos,
  updateTransform,
  upsertPhoto,
  validateAlbum,
} from '../src';

function sample() {
  const album = createAlbum({ title: 'Été 2026', generator: 'test/0' });
  upsertPhoto(album, { id: 'ph1', src: 'photos/ph1.jpg', width: 4000, height: 3000, takenAt: '2026-07-14T10:00:00Z' });
  upsertPhoto(album, { id: 'ph2', src: 'photos/ph2.jpg', width: 3000, height: 4000 });
  upsertPhoto(album, { id: 'ph3', src: 'photos/ph3.jpg', width: 3000, height: 3000 });
  const p = addPage(album, 'two-caption');
  placePhoto(album, p.id, 'p1', 'ph1', { scale: 1.4, offsetX: 0.2 });
  placePhoto(album, p.id, 'p2', 'ph2');
  setText(album, p.id, 'c1', { text: 'Bonjour', role: 'caption' });
  return { album, page: p };
}

describe('album format', () => {
  it('round-trips through JSON without loss', () => {
    const { album } = sample();
    const json = serializeAlbum(album);
    const parsed = parseAlbum(json);
    expect(parsed).toEqual(album);
    expect(parsed.formatVersion).toBe(ALBUM_FORMAT_VERSION);
    expect(parsed.templates.map((t) => t.id)).toEqual(['two-caption']);
  });

  it('embeds templates so the file is self-contained', () => {
    const { album } = sample();
    const tpl = album.templates[0]!;
    expect(tpl.slots.length).toBe(BUILTIN_TEMPLATES.find((t) => t.id === 'two-caption')!.slots.length);
    // Mutating the album copy must not touch the built-in.
    tpl.slots[0]!.rect.x = 0.5;
    expect(BUILTIN_TEMPLATES.find((t) => t.id === 'two-caption')!.slots[0]!.rect.x).not.toBe(0.5);
  });

  it('all built-in templates are valid and inside the page', () => {
    const album = createAlbum({ title: 'x' });
    for (const t of BUILTIN_TEMPLATES) addPage(album, t.id);
    expect(() => validateAlbum(JSON.parse(serializeAlbum(album)))).not.toThrow();
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.photoCount).toBe(t.slots.filter((s) => s.kind === 'photo').length);
      for (const s of t.slots) {
        expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(1.0001);
        expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('rejects broken manifests with useful paths', () => {
    const { album } = sample();
    const raw = JSON.parse(serializeAlbum(album));
    raw.pages[0].photos.p1.photoId = 'nope';
    raw.pages[0].photos.p1.transform.scale = 0.5;
    raw.photos[1].src = '../escape.jpg';
    try {
      validateAlbum(raw);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AlbumValidationError);
      const paths = (e as AlbumValidationError).issues.map((i) => i.path);
      expect(paths).toContain('$.pages[0].photos.p1.photoId');
      expect(paths).toContain('$.pages[0].photos.p1.transform.scale');
      expect(paths).toContain('$.photos[1].src');
    }
    expect(() => validateAlbum({ ...raw, formatVersion: 99 })).toThrow(/plus récente/);
    expect(() => parseAlbum('{not json')).toThrow(/illisible/);
  });

  it('fills defaults for optional fields', () => {
    const minimal = {
      format: 'albumphoto',
      formatVersion: 1,
      id: 'a',
      title: 't',
      page: { width: 100, height: 100, unit: 'mm' },
      templates: [],
      photos: [],
      pages: [],
    };
    const a = validateAlbum(minimal);
    expect(a.locale).toBe('fr-FR');
    expect(a.theme.background).toBe('#ffffff');
    expect(a.people).toEqual([]);
  });

  it('supports page operations', () => {
    const { album, page } = sample();
    expect(updateTransform(album, page.id, 'p1', { scale: 9 }).scale).toBe(6);
    const p2 = addPage(album, 'single', 0);
    expect(album.pages[0]!.id).toBe(p2.id);
    movePage(album, p2.id, 5);
    expect(album.pages[1]!.id).toBe(p2.id);
    expect(unusedPhotos(album).map((p) => p.id)).toEqual(['ph3']);
    clearSlot(album, page.id, 'p2');
    expect(page.photos.p2).toBeUndefined();
    removePage(album, p2.id);
    pruneTemplates(album);
    expect(album.templates.map((t) => t.id)).toEqual(['two-caption']);
    expect(() => placePhoto(album, page.id, 'c1', 'ph1')).toThrow(/Zone photo/);
    expect(() => placePhoto(album, page.id, 'p1', 'zzz')).toThrow(/Photo inconnue/);
  });

  it('keeps photos in order when switching template', () => {
    const { album, page } = sample();
    placePhoto(album, page.id, 'p2', 'ph2');
    changePageTemplate(album, page.id, 'grid-2x2');
    expect(page.photos.p1?.photoId).toBe('ph1');
    expect(page.photos.p2?.photoId).toBe('ph2');
    expect(page.photos.p1?.transform.scale).toBe(1);
    expect(Object.keys(page.texts)).toEqual([]);
    changePageTemplate(album, page.id, 'single-caption');
    expect(page.photos.p1?.photoId).toBe('ph1');
    expect(page.photos.p2).toBeUndefined();
    expect(album.templates.map((t) => t.id).sort()).toEqual(['grid-2x2', 'single-caption', 'two-caption']);
  });
});
