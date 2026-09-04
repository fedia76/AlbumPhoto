import { describe, expect, it } from 'vitest';
import {
  assessAuthenticity,
  pixelPatterns,
  scorePhotos,
  selectPhotos,
  syntheticScore,
  type SourcePhoto,
} from '../src';
import { analysis, face, sharpImage, synthImage } from './helpers';

/** Interface : barre d'état, en-tête, un bouton, un grand fond blanc. */
const screenshotImage = (w = 64, h = 64) =>
  synthImage(w, h, (x, y) => {
    if (y < 4) return [20, 20, 20];
    if (y < 12) return [240, 240, 245];
    if (x > 8 && x < 56 && y > 20 && y < 30) return [60, 110, 220];
    return [255, 255, 255];
  });

const photo = (over: Partial<SourcePhoto> = {}): SourcePhoto => ({
  id: 'p1',
  uri: 'file:///storage/emulated/0/DCIM/Camera/IMG_20260714_101500.jpg',
  width: 4032,
  height: 3024,
  fileName: 'IMG_20260714_101500.jpg',
  ...over,
});

describe('authenticité', () => {
  it('distingue une interface d’une scène, à partir des seuls pixels', () => {
    const ui = pixelPatterns(screenshotImage());
    const scene = pixelPatterns(sharpImage(64, 64, 3));
    // Une photo n'a jamais de ligne entière uniforme ; une interface, beaucoup.
    expect(ui.uniformLineRatio).toBeGreaterThan(0.2);
    expect(scene.uniformLineRatio).toBe(0);
    expect(ui.colorCount).toBeLessThan(scene.colorCount);
    expect(syntheticScore(ui)).toBeGreaterThan(0.8);
    expect(syntheticScore(scene)).toBeLessThan(0.15);
  });

  it('croit la photothèque sur parole quand elle déclare une capture', () => {
    const verdict = assessAuthenticity({ photo: photo({ mediaSubtypes: ['screenshot'] }) }, sharpImage());
    expect(verdict.artificiality).toBe(1);
    expect(verdict.reasons[0]).toMatch(/photothèque/);
  });

  it('laisse passer une photo d’appareil, même sans lire ses pixels', () => {
    const verdict = assessAuthenticity({
      photo: photo(),
      exif: { make: 'Google', model: 'Pixel 8' },
      exifRead: true,
      labels: ['dog', 'grass'],
    }, sharpImage(64, 64, 7));
    expect(verdict.artificiality).toBeLessThan(0.1);
    expect(verdict.reasons).toEqual([]);
  });

  it('démasque une capture d’écran Android par son nom et son dossier', () => {
    const verdict = assessAuthenticity({
      photo: photo({
        uri: 'file:///storage/emulated/0/Pictures/Screenshots/Screenshot_20260714-101500.png',
        fileName: 'Screenshot_20260714-101500.png',
        width: 1080,
        height: 2400,
      }),
      screen: { width: 1080, height: 2400 },
      labels: ['text', 'font', 'screenshot'],
    }, screenshotImage());
    expect(verdict.artificiality).toBeGreaterThan(0.9);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('écarte une image enregistrée, sans écarter une photo reçue', () => {
    const meme = assessAuthenticity({
      photo: photo({ uri: 'file:///storage/emulated/0/Download/drole.png', fileName: 'drole.png' }),
      exifRead: true,
      exif: {},
    }, screenshotImage());
    expect(meme.artificiality).toBeGreaterThan(0.6);

    // Une vraie photo de famille reçue par messagerie perd son EXIF au passage :
    // elle a pourtant toute sa place dans l'album.
    const received = assessAuthenticity({
      photo: photo({ uri: 'file:///storage/emulated/0/Pictures/WhatsApp/IMG-20260714.jpg', fileName: 'IMG-20260714.jpg' }),
      exifRead: true,
      exif: {},
    }, sharpImage(64, 64, 5));
    expect(received.artificiality).toBeLessThan(0.6);
  });

  it('ne conclut rien d’un EXIF qu’on n’a pas lu', () => {
    const base = { photo: photo({ uri: 'file:///storage/emulated/0/Pictures/divers.png', fileName: 'divers.png' }) };
    const unread = assessAuthenticity(base, sharpImage(64, 64, 2));
    const read = assessAuthenticity({ ...base, exifRead: true, exif: {} }, sharpImage(64, 64, 2));
    expect(read.artificiality).toBeGreaterThan(unread.artificiality);
  });

  it('écarte les images non photographiques au moment de la sélection', () => {
    const capture = analysis('capture', [], { takenAt: new Date(Date.UTC(2026, 6, 14, 10)).toISOString(), hash: '0000000000000000' });
    capture.authenticity = { artificiality: 0.95, reasons: ['capture'] };
    const vraie = analysis('vraie', [face(0)], { takenAt: new Date(Date.UTC(2026, 6, 14, 12)).toISOString(), hash: 'ffffffff00000000' });
    vraie.authenticity = { artificiality: 0.05, reasons: [] };
    const photos = [capture, vraie];
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });

    const filtered = selectPhotos(photos, scores, { targetCount: 10, maxArtificiality: 0.6 });
    expect(filtered.selected.map((s) => s.analysis.photo.id)).toEqual(['vraie']);
    expect(filtered.rejected.find((r) => r.analysis.photo.id === 'capture')?.reason).toBe('notPhoto');

    // Filtre désactivé : la capture repasse, l'utilisateur reste maître.
    expect(selectPhotos(photos, scores, { targetCount: 10 }).selected).toHaveLength(2);
  });
});
