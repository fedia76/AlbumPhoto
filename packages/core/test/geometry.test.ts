import { describe, expect, it } from 'vitest';
import {
  applyZoom,
  clampTransform,
  computeCropRect,
  imageLayoutInSlot,
  panToOffsetDelta,
  slotAspect,
  visibleFraction,
  type PageSize,
  type TemplateSlot,
} from '../src';

const page: PageSize = { width: 200, height: 100, unit: 'mm' };
const square: TemplateSlot = { id: 's', kind: 'photo', rect: { x: 0, y: 0, w: 0.5, h: 1 } }; // 100×100 mm

describe('geometry', () => {
  it('computes slot aspect from real page proportions', () => {
    expect(slotAspect(square, page)).toBeCloseTo(1);
    expect(slotAspect({ ...square, rect: { x: 0, y: 0, w: 1, h: 1 } }, page)).toBeCloseTo(2);
  });

  it('cover-fits a landscape photo into a square slot', () => {
    const r = computeCropRect(4000, 3000, square, page);
    expect(r.h).toBeCloseTo(1);
    expect(r.w).toBeCloseTo(0.75);
    expect(r.x).toBeCloseTo(0.125);
    expect(r.y).toBeCloseTo(0);
  });

  it('cover-fits a portrait photo into a square slot', () => {
    const r = computeCropRect(3000, 4000, square, page);
    expect(r.w).toBeCloseTo(1);
    expect(r.h).toBeCloseTo(0.75);
    expect(r.y).toBeCloseTo(0.125);
  });

  it('zooms around the centre and pans to the edges', () => {
    const r = computeCropRect(4000, 3000, square, page, { scale: 2, offsetX: 0, offsetY: 0, rotation: 0 });
    expect(r.w).toBeCloseTo(0.375);
    expect(r.h).toBeCloseTo(0.5);
    expect(r.x + r.w / 2).toBeCloseTo(0.5);
    const left = computeCropRect(4000, 3000, square, page, { scale: 2, offsetX: -1, offsetY: -1, rotation: 0 });
    expect(left.x).toBeCloseTo(0);
    expect(left.y).toBeCloseTo(0);
    const right = computeCropRect(4000, 3000, square, page, { scale: 2, offsetX: 1, offsetY: 1, rotation: 0 });
    expect(right.x + right.w).toBeCloseTo(1);
    expect(right.y + right.h).toBeCloseTo(1);
  });

  it('never exposes empty area: crop rect stays inside the photo', () => {
    for (const scale of [1, 1.3, 2.7, 6]) {
      for (const ox of [-1, -0.3, 0, 0.8, 1]) {
        const r = computeCropRect(4000, 3000, square, page, { scale, offsetX: ox, offsetY: ox, rotation: 0 });
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('clamps transforms into format bounds', () => {
    expect(clampTransform({ scale: 0.2, offsetX: 5, offsetY: -9, rotation: 450 })).toEqual({ scale: 1, offsetX: 1, offsetY: -1, rotation: 90 });
    expect(clampTransform(undefined)).toEqual({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 });
    expect(applyZoom({ scale: 5, offsetX: 0, offsetY: 0, rotation: 0 }, 3).scale).toBe(6);
  });

  it('converts a full drag of the hidden width into an offset swing of 2', () => {
    // Landscape 4:3 in square slot at scale 1: visible w = 0.75, hidden = 1/3 of slot px.
    const slotPx = 300;
    const hidden = ((1 - 0.75) * slotPx) / 0.75; // 100 px
    const d = panToOffsetDelta(-hidden, 0, slotPx, slotPx, 4000, 3000, square, page, 1);
    expect(d.dOffsetX).toBeCloseTo(2);
    expect(d.dOffsetY).toBe(0);
  });

  it('produces a pixel layout consistent with the crop rect', () => {
    const t = { scale: 1.5, offsetX: 0.4, offsetY: -0.2, rotation: 0 };
    const crop = computeCropRect(4000, 3000, square, page, t);
    const l = imageLayoutInSlot(4000, 3000, square, page, t, 300, 300);
    expect(l.imgW).toBeCloseTo(300 / crop.w);
    expect(-l.left / l.imgW).toBeCloseTo(crop.x);
    expect(-l.top / l.imgH).toBeCloseTo(crop.y);
    expect(visibleFraction(4 / 3, 1, 1.5).w).toBeCloseTo(0.5);
  });
});
