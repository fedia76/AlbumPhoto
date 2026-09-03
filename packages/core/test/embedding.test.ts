import { describe, expect, it } from 'vitest';
import { PIXEL_EMBEDDING_THRESHOLD, cosineSimilarity, cropRgba, pixelFaceEmbedding, translateLabel, usefulLabels } from '../src';
import { sharpImage, synthImage } from './helpers';

describe('pixel face embedding (fallback)', () => {
  it('matches the same face at different scales and separates different ones', () => {
    const a = pixelFaceEmbedding(sharpImage(40, 40, 1));
    const b = pixelFaceEmbedding(sharpImage(80, 80, 1));
    const c = pixelFaceEmbedding(sharpImage(40, 40, 2));
    expect(cosineSimilarity(a, b)).toBeGreaterThan(PIXEL_EMBEDDING_THRESHOLD);
    expect(cosineSimilarity(a, c)).toBeLessThan(PIXEL_EMBEDDING_THRESHOLD);
    expect(a).toHaveLength(256);
  });

  it('crops a normalised rectangle with margin, clamped to the image', () => {
    const img = synthImage(100, 50, (x, y) => [x, y, 0]);
    const crop = cropRgba(img, { x: 0.5, y: 0.5, w: 0.2, h: 0.4 }, 0.5);
    expect(crop.width).toBe(40); // 0.4 … 0.8 → 40 px
    expect(crop.height).toBe(35); // 0.3 … 1.1 → y0 = 15, y1 borné à 50
  });
});

describe('labels', () => {
  it('translates and filters', () => {
    expect(translateLabel('Beach')).toBe('plage');
    expect(translateLabel('Beach', 'en-US')).toBe('beach');
    expect(translateLabel('Zebra')).toBe('zebra');
    expect(usefulLabels([{ text: 'Person', confidence: 0.9 }, { text: 'Cake', confidence: 0.8 }, { text: 'Dog', confidence: 0.2 }])).toEqual(['gâteau']);
  });
});
