import { describe, expect, it } from 'vitest';
import { groupIntoEvents, scorePhotos, selectPhotos } from '../src';
import { analysis, face } from './helpers';

describe('selection', () => {
  it('drops near-duplicates and limits photos per moment, then sorts chronologically', () => {
    const t = (min: number) => new Date(Date.UTC(2026, 6, 14, 10, min)).toISOString();
    const photos = [
      analysis('p1', [face(0)], { takenAt: t(0), hash: 'ffffffffffffffff' }),
      analysis('p1-dup', [face(0)], { takenAt: t(0), hash: 'fffffffffffffffe' }),
      analysis('p2', [face(0)], { takenAt: t(1), hash: '0000000000000000' }),
      analysis('p3', [face(0)], { takenAt: t(2), hash: '00000000ffffffff' }),
      analysis('p4', [face(0)], { takenAt: t(60), hash: 'ff00ff00ff00ff00' }),
      analysis('old', [face(0)], { takenAt: new Date(Date.UTC(2026, 6, 13)).toISOString(), hash: '0f0f0f0f0f0f0f0f' }),
      analysis('undated', [face(0)], { hash: 'f0f0f0f0f0f0f0f0' }),
      analysis('bad', [face(0)], { takenAt: t(90), hash: 'aaaaaaaaaaaaaaaa', sharpness: 0.01 }),
    ];
    const byPhoto = new Map(photos.map((p) => [p.photo.id, ['x']]));
    const scores = scorePhotos(photos, { selectedPeople: new Set(['x']), peopleByPhoto: byPhoto });
    const sel = selectPhotos(photos, scores, { targetCount: 10, maxPerMoment: 2 });
    const ids = sel.map((s) => s.analysis.photo.id);
    expect(ids).not.toContain('p1-dup');
    expect(ids.filter((i) => ['p1', 'p2', 'p3'].includes(i))).toHaveLength(2);
    expect(ids).toContain('p4');
    expect(ids[0]).toBe('old');
    expect(ids[ids.length - 1]).toBe('undated');
    expect(ids).not.toContain('bad');

    const events = groupIntoEvents(sel, 6);
    expect(events).toHaveLength(3); // 13 juillet, 14 juillet, sans date
    expect(events[0]!.title).toMatch(/13 juillet 2026/);
    expect(events[2]!.title).toBe('Souvenirs');
    expect(groupIntoEvents(sel, 6, 'en-US')[2]!.title).toBe('Memories');
  });

  it('respects the target count', () => {
    const photos = Array.from({ length: 30 }, (_, i) =>
      analysis(`p${i}`, [face(0)], { takenAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), hash: (i * 2654435761 >>> 0).toString(16).padStart(16, '0') }),
    );
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });
    expect(selectPhotos(photos, scores, { targetCount: 12 })).toHaveLength(12);
  });
});
