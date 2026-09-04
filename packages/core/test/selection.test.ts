import { describe, expect, it } from 'vitest';
import { UNDATED_BUCKET, eventsFromBuckets, groupIntoEvents, scorePhotos, selectPhotos, timeBuckets } from '../src';
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
    const { selected: sel, rejected } = selectPhotos(photos, scores, { targetCount: 10, maxPerMoment: 2 });
    const ids = sel.map((s) => s.analysis.photo.id);
    const reasonOf = (id: string) => rejected.find((r) => r.analysis.photo.id === id)?.reason;
    expect(ids).not.toContain('p1-dup');
    expect(ids.filter((i) => ['p1', 'p2', 'p3'].includes(i))).toHaveLength(2);
    expect(ids).toContain('p4');
    expect(ids[0]).toBe('old');
    expect(ids[ids.length - 1]).toBe('undated');
    expect(ids).not.toContain('bad');
    // Chaque photo écartée porte son motif, base de l'écran de revue.
    expect(reasonOf('p1-dup')).toBe('duplicate');
    expect(rejected.find((r) => r.analysis.photo.id === 'p1-dup')?.duplicateOf).toBe('p1');
    expect(reasonOf('bad')).toBe('sharpness');
    expect(new Set([...ids, ...rejected.map((r) => r.analysis.photo.id)]).size).toBe(photos.length);

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
    const { selected, rejected } = selectPhotos(photos, scores, { targetCount: 12 });
    expect(selected).toHaveLength(12);
    // Toute photo est classée : retenue, ou écartée avec un motif.
    expect(rejected).toHaveLength(photos.length - 12);
    expect(rejected.some((r) => r.reason === 'quota')).toBe(true);
  });
});

describe('tranches temporelles', () => {
  const t = (h: number, min = 0) => new Date(Date.UTC(2026, 6, 14, h, min)).toISOString();

  it('découpe en tranches, accroche une clé stable et isole les photos sans date', () => {
    const photos = [
      analysis('a1', [], { takenAt: t(10, 0) }),
      analysis('a2', [], { takenAt: t(10, 2) }),
      analysis('b1', [], { takenAt: t(18, 0) }),
      analysis('nodate', [], {}),
    ];
    const moments = timeBuckets(photos, 180_000);
    expect(moments.map((m) => m.photoIds)).toEqual([['a1', 'a2'], ['b1'], ['nodate']]);
    expect(moments[0]!.id).toBe(t(10, 0));
    expect(moments[0]!.end).toBe(t(10, 2));
    expect(moments[2]!.id).toBe(UNDATED_BUCKET);
    // La clé ne dépend pas de l'ordre de parcours : les réglages y survivent.
    expect(timeBuckets([...photos].reverse(), 180_000).map((m) => m.id)).toEqual(moments.map((m) => m.id));
    // Une fenêtre assez large réunit les deux tranches du jour ; les photos sans
    // date restent à part, elles ne peuvent se ranger nulle part.
    expect(timeBuckets(photos, 10 * 3600_000).map((m) => m.photoIds)).toEqual([['a1', 'a2', 'b1'], ['nodate']]);
  });

  it('honore un quota par événement, par-dessus le plafond anti-rafale', () => {
    // Un anniversaire très photographié (une seule rafale) et une sortie plus tard.
    const party = Array.from({ length: 6 }, (_, i) =>
      analysis(`party${i}`, [face(0)], { takenAt: t(10, i), hash: (i * 0x9e3779b1 >>> 0).toString(16).padStart(16, '0') }),
    );
    const walk = Array.from({ length: 6 }, (_, i) =>
      analysis(`walk${i}`, [face(0)], { takenAt: t(20, i), hash: ((i + 40) * 0x9e3779b1 >>> 0).toString(16).padStart(16, '0') }),
    );
    const photos = [...party, ...walk];
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });

    const plain = selectPhotos(photos, scores, { targetCount: 12 });
    const partyCount = (r: { selected: { analysis: { photo: { id: string } } }[] }) =>
      r.selected.filter((s) => s.analysis.photo.id.startsWith('party')).length;
    // Sans quota, la règle des 3 minutes plafonne l'anniversaire à deux photos.
    expect(partyCount(plain)).toBe(2);

    const eventId = plain.eventBuckets.find((b) => b.photoIds[0]!.startsWith('party'))!.id;
    const withQuota = selectPhotos(photos, scores, {
      targetCount: 12,
      eventQuotas: new Map([[eventId, 5]]),
    });
    expect(partyCount(withQuota)).toBe(5);
    // Le plafond redescendu écarte les photos excédentaires avec le bon motif.
    const tight = selectPhotos(photos, scores, { targetCount: 12, eventQuotas: new Map([[eventId, 1]]) });
    expect(partyCount(tight)).toBe(1);
    expect(tight.rejected.filter((r) => r.reason === 'event').length).toBeGreaterThan(0);
  });

  it('impose et retire les photos choisies à la main, malgré les seuils', () => {
    const photos = [
      analysis('flou', [face(0)], { takenAt: t(10), sharpness: 0.01, hash: '1111111111111111' }),
      analysis('net', [face(0)], { takenAt: t(12), hash: '2222222222222222' }),
    ];
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });
    const result = selectPhotos(photos, scores, {
      targetCount: 10,
      keep: new Set(['flou']),
      drop: new Set(['net']),
    });
    expect(result.selected.map((s) => s.analysis.photo.id)).toEqual(['flou']);
    expect(result.rejected.find((r) => r.analysis.photo.id === 'net')?.reason).toBe('manual');
  });

  it("dépasse la cible quand les choix explicites l'exigent", () => {
    const photos = Array.from({ length: 5 }, (_, i) =>
      analysis(`p${i}`, [face(0)], { takenAt: t(10 + i), hash: (i * 0x85ebca6b >>> 0).toString(16).padStart(16, '0') }),
    );
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });
    const result = selectPhotos(photos, scores, {
      targetCount: 1,
      keep: new Set(['p0', 'p1', 'p2']),
    });
    expect(result.selected).toHaveLength(3);
    // Une photo non imposée trouve encore l'album complet.
    expect(result.rejected.every((r) => r.reason === 'quota')).toBe(true);
  });

  it('calque les chapitres sur les tranches candidates', () => {
    const photos = [
      analysis('m1', [face(0)], { takenAt: t(9), hash: '0000000000000000' }),
      analysis('m2', [face(0)], { takenAt: t(12), hash: 'ffffffff00000000' }),
      analysis('soir', [face(0)], { takenAt: t(21), hash: '00000000ffffffff' }),
    ];
    const scores = scorePhotos(photos, { selectedPeople: new Set(), peopleByPhoto: new Map() });
    const { selected, eventBuckets } = selectPhotos(photos, scores, { targetCount: 10 });
    const events = eventsFromBuckets(eventBuckets, selected);
    expect(events).toHaveLength(2);
    expect(events[0]!.photos.map((p) => p.analysis.photo.id)).toEqual(['m1', 'm2']);
    expect(events[0]!.bucketId).toBe(t(9));
    expect(events[1]!.title).toMatch(/14 juillet 2026/);
    // Un chapitre vide de photos retenues disparaît, il ne laisse pas de page nue.
    expect(eventsFromBuckets(eventBuckets, [selected[0]!])).toHaveLength(1);
  });
});
