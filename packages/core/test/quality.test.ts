import { describe, expect, it } from 'vitest';
import { computeQuality, dHash, hammingDistance, isNearDuplicate, technicalScore, toGray } from '../src';
import { blurryImage, overexposed, sharpImage, synthImage } from './helpers';

describe('quality metrics', () => {
  it('ranks a sharp checkerboard above a soft gradient', () => {
    const sharp = computeQuality(sharpImage());
    const blurry = computeQuality(blurryImage());
    expect(sharp.sharpness).toBeGreaterThan(0.6);
    expect(blurry.sharpness).toBeLessThan(0.1);
    expect(sharp.contrast).toBeGreaterThan(blurry.contrast);
    expect(technicalScore(sharp)).toBeGreaterThan(technicalScore(blurry));
  });

  it('penalises clipped exposure and rewards colour', () => {
    const over = computeQuality(overexposed());
    expect(over.exposure).toBe(0);
    expect(over.colorfulness).toBe(0);
    expect(computeQuality(sharpImage()).colorfulness).toBeGreaterThan(0.5);
    const mid = computeQuality(synthImage(32, 32, () => [118, 118, 118]));
    expect(mid.exposure).toBeCloseTo(1);
  });
});

describe('dHash', () => {
  it('is stable under scaling and detects duplicates', () => {
    const a = dHash(toGray(sharpImage(64, 64)));
    const b = dHash(toGray(sharpImage(128, 128)));
    expect(a).toHaveLength(16);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(6);
    expect(isNearDuplicate(a, b)).toBe(true);
    const c = dHash(toGray(sharpImage(64, 64, 3)));
    expect(hammingDistance(a, c)).toBeGreaterThan(10);
    expect(() => hammingDistance('ab', 'abc')).toThrow();
  });
});
