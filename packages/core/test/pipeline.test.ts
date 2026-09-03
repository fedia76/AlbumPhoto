import { describe, expect, it } from 'vitest';
import {
  TemplateCaptionGenerator,
  assembleAlbum,
  buildAlbum,
  chunkForPages,
  detectPeople,
  generateCaptions,
  pickTemplate,
  scanPhotos,
  selectBestPhotos,
  serializeAlbum,
  validateAlbum,
  type DetectedFace,
  type PipelineAdapters,
  type SourcePhoto,
} from '../src';
import { blurryImage, face, sharpImage } from './helpers';

/** Galerie factice : 3 personnes, rafales, une photo floue, un paysage. */
function fakeGallery(): { photos: SourcePhoto[]; faces: Map<string, DetectedFace[]>; blurry: Set<string> } {
  const photos: SourcePhoto[] = [];
  const faces = new Map<string, DetectedFace[]>();
  const blurry = new Set<string>();
  const day = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 7, d, h, m)).toISOString();
  const add = (id: string, takenAt: string, fs: DetectedFace[], opts: { blurry?: boolean; portrait?: boolean } = {}) => {
    photos.push({ id, uri: `file:///dcim/${id}.jpg`, width: opts.portrait ? 3000 : 4000, height: opts.portrait ? 4000 : 3000, takenAt, fileName: `${id}.jpg` });
    faces.set(id, fs);
    if (opts.blurry) blurry.add(id);
  };
  for (let i = 0; i < 6; i++) add(`d1-burst-${i}`, day(1, 10, i), [face(0), face(1)]);
  add('d1-lea', day(1, 12), [face(0)], { portrait: true });
  add('d1-blurry', day(1, 13), [face(0)], { blurry: true });
  add('d1-stranger', day(1, 14), [face(2)]);
  add('d1-scenery', day(1, 15), []);
  add('d2-tom', day(3, 9), [face(1)]);
  add('d2-lea-tom', day(3, 11), [face(0), face(1)]);
  add('d2-all', day(3, 12), [face(0), face(1), face(2)]);
  add('d2-tom-2', day(3, 18), [face(1)], { portrait: true });
  return { photos, faces, blurry };
}

function adapters(g: ReturnType<typeof fakeGallery>): PipelineAdapters {
  return {
    source: {
      async *list({ limit }) {
        let n = 0;
        for (const p of [...g.photos].reverse()) {
          if (limit && n++ >= limit) return;
          yield p;
        }
      },
    },
    pixels: { readThumbnail: async (p) => (g.blurry.has(p.id) ? blurryImage() : sharpImage(64, 64, g.photos.indexOf(p))) },
    // Le détecteur ne renvoie que la géométrie ; l'« embedder » fournit ensuite les vecteurs.
    faces: { detect: async (p) => (g.faces.get(p.id) ?? []).map(({ embedding: _e, ...f }) => ({ ...f })) },
    embedder: { embed: async (p, fs) => fs.map((_, i) => g.faces.get(p.id)![i]!.embedding!) },
    labeler: { label: async (p) => (p.id.includes('scenery') ? ['montagne', 'lac'] : ['personne']) },
    captions: new TemplateCaptionGenerator(),
    importer: { importPhoto: async (_albumId, p) => ({ src: `photos/${p.id}.jpg`, thumb: `thumbs/${p.id}.jpg`, mimeType: 'image/jpeg' }) },
  };
}

describe('end-to-end pipeline (fake adapters)', () => {
  it('scans, finds people, selects, captions and assembles a valid album', async () => {
    const g = fakeGallery();
    const a = adapters(g);
    const progress: number[] = [];
    const analyses = await scanPhotos(a, { onProgress: (p) => progress.push(p.done) });
    expect(analyses).toHaveLength(g.photos.length);
    expect(progress[progress.length - 1]).toBe(g.photos.length);
    expect(analyses.find((x) => x.photo.id === 'd1-scenery')!.labels).toEqual(['montagne', 'lac']);
    expect(analyses.find((x) => x.photo.id === 'd1-blurry')!.quality.sharpness).toBeLessThan(0.2);

    const clusters = detectPeople(analyses, { threshold: 0.8 });
    expect(clusters).toHaveLength(3);
    // L'utilisateur garde les deux personnes les plus fréquentes et les nomme.
    const selectedPeople = new Set([clusters[0]!.id, clusters[1]!.id]);
    const personNames = new Map([
      [clusters[0]!.id, 'Léa'],
      [clusters[1]!.id, 'Tom'],
    ]);

    const { selected, rejected, events, byPhoto } = selectBestPhotos(analyses, clusters, { selectedPeople, targetCount: 8, locale: 'fr-FR' });
    const ids = selected.map((s) => s.analysis.photo.id);
    expect(ids.length).toBeLessThanOrEqual(8);
    expect(ids).not.toContain('d1-blurry');
    expect(ids).not.toContain('d1-stranger');
    expect(ids.filter((i) => i.startsWith('d1-burst')).length).toBeLessThanOrEqual(2);
    expect(ids).toContain('d2-lea-tom');
    expect(events).toHaveLength(2);
    // Toute photo analysée est soit retenue, soit écartée avec un motif.
    expect(selected.length + rejected.length).toBe(analyses.length);
    expect(rejected.find((r) => r.analysis.photo.id === 'd1-blurry')?.reason).toBe('sharpness');
    expect(events[0]!.title).toMatch(/août 2026/);

    const captions = await generateCaptions(a.captions, events, byPhoto, {
      style: 'funny',
      locale: 'fr-FR',
      albumTitle: 'Vacances',
      personNames,
      selectedPeople,
    });
    expect(captions.size).toBe(selected.length);
    expect(captions.get('d2-lea-tom')).toMatch(/Léa et Tom/);

    const album = await assembleAlbum(a.importer, {
      title: 'Vacances',
      subtitle: 'Août 2026',
      locale: 'fr-FR',
      style: 'funny',
      captionModel: 'template',
      selectedPeople,
      personNames,
      clusters,
      byPhoto,
      events,
      captions,
      generator: 'test',
    });

    // Le résultat est un fichier valide, autonome et rechargeable.
    const reparsed = validateAlbum(JSON.parse(serializeAlbum(album)));
    expect(reparsed.pages[0]!.templateId).toBe('cover');
    expect(reparsed.pages[0]!.texts.title?.text).toBe('Vacances');
    expect(reparsed.pages.filter((p) => p.templateId === 'chapter')).toHaveLength(2);
    expect(reparsed.people.map((p) => p.name).sort()).toEqual(['Léa', 'Tom']);
    expect(reparsed.people.every((p) => p.referencePhotoId && p.referenceFaceRect)).toBe(true);
    const leaId = reparsed.people.find((p) => p.name === 'Léa')!.id;
    const photosWithLea = reparsed.photos.filter((p) => p.people?.includes(leaId));
    expect(photosWithLea.length).toBeGreaterThan(0);
    expect(reparsed.photos.every((p) => p.src.startsWith('photos/') && p.score !== undefined)).toBe(true);
    expect(reparsed.ai?.captionStyle).toBe('funny');
    expect(reparsed.ai?.selectedPeople).toHaveLength(2);
    // Chaque photo sélectionnée apparaît exactement une fois dans les pages.
    const placed = reparsed.pages.filter((p) => p.templateId !== 'cover').flatMap((p) => Object.values(p.photos).map((pl) => pl.photoId));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(selected.length);
    const captionTexts = reparsed.pages.flatMap((p) => Object.values(p.texts)).filter((t) => t.role === 'caption');
    expect(captionTexts.length).toBeGreaterThan(0);
  });

  it('honours the scan limit and abort signal', async () => {
    const g = fakeGallery();
    const a = adapters(g);
    expect(await scanPhotos(a, { limit: 3 })).toHaveLength(3);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await scanPhotos(a, { signal: ctrl.signal })).toHaveLength(0);
  });
});

describe('builder', () => {
  it('chooses templates by count and orientation and paginates rhythmically', () => {
    const land = { id: 'l', src: 'photos/l.jpg', width: 4, height: 3 };
    const port = { id: 'p', src: 'photos/p.jpg', width: 3, height: 4 };
    expect(pickTemplate([land], false)).toBe('single');
    expect(pickTemplate([land], true)).toBe('single-caption');
    expect(pickTemplate([port, port], false)).toBe('two-columns');
    expect(pickTemplate([land, port], false)).toBe('two-rows');
    expect(pickTemplate([land, land, land], false)).toBe('one-plus-two');
    expect(pickTemplate([land, land, land, land], true)).toBe('grid-2x2');
    expect(chunkForPages(7)).toEqual([1, 2, 3, 1]);
    expect(chunkForPages(0)).toEqual([]);
    const album = buildAlbum({ title: 'T', events: [{ title: 'E', photos: [{ photo: land, caption: 'c' }] }] });
    expect(album.pages.map((p) => p.templateId)).toEqual(['cover', 'single-caption']);
    expect(album.pages[1]!.texts.c1?.text).toBe('c');
  });
});
