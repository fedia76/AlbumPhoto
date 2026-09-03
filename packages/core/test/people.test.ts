import { describe, expect, it } from 'vitest';
import { clusterFaces, cosineSimilarity, l2Normalize, mergeClusters, peopleByPhoto, scorePhotos } from '../src';
import { analysis, embeddingFor, face } from './helpers';

describe('face clustering', () => {
  it('groups faces of the same person across photos', () => {
    const photos = [
      analysis('a', [face(0), face(1)]),
      analysis('b', [face(0)]),
      analysis('c', [face(1), face(2)]),
      analysis('d', [face(0, { headEulerAngleY: 30, rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 } })]),
      analysis('e', [face(2), face(3)]), // la personne 3 n'apparaît qu'une fois : ignorée (minMembers = 2)
      analysis('f', []),
    ];
    const clusters = clusterFaces(photos, { threshold: 0.8 });
    expect(clusters).toHaveLength(3);
    expect(clusters[0]!.members).toHaveLength(3); // personne 0, la plus fréquente
    expect(cosineSimilarity(clusters[0]!.centroid, embeddingFor(0))).toBeGreaterThan(0.95);
    // Le visage de face (a ou b) est préféré comme référence au visage tourné (d).
    expect(clusters[0]!.representative.photoId).not.toBe('d');
    const idx = peopleByPhoto(clusters);
    expect(idx.get('a')).toEqual(['person-1', 'person-2']);
    expect(idx.get('f')).toBeUndefined();
  });

  it('ignores tiny faces and faces without embeddings', () => {
    const photos = [analysis('a', [face(0, { rect: { x: 0, y: 0, w: 0.01, h: 0.01 } }), face(null)]), analysis('b', [face(0)])];
    expect(clusterFaces(photos)).toHaveLength(0);
  });
});

describe('scoring', () => {
  it('prefers sharp photos with the selected people', () => {
    const photos = [
      analysis('with-lea', [face(0)]),
      analysis('with-stranger', [face(1)]),
      analysis('blurry-lea', [face(0)], { sharpness: 0.05 }),
      analysis('scenery', []),
      analysis('lea-eyes-closed', [face(0, { leftEyeOpenProbability: 0.05, rightEyeOpenProbability: 0.05, smilingProbability: 0.1 })]),
    ];
    const byPhoto = new Map([
      ['with-lea', ['lea']],
      ['with-stranger', ['bob']],
      ['blurry-lea', ['lea']],
      ['lea-eyes-closed', ['lea']],
    ]);
    const scores = scorePhotos(photos, { selectedPeople: new Set(['lea']), peopleByPhoto: byPhoto });
    const order = scores.map((s) => s.photoId);
    expect(order[0]).toBe('with-lea');
    expect(order.indexOf('with-lea')).toBeLessThan(order.indexOf('lea-eyes-closed'));
    expect(order.indexOf('scenery')).toBeLessThan(order.indexOf('with-stranger'));
    expect(order.indexOf('with-lea')).toBeLessThan(order.indexOf('blurry-lea'));
    const stranger = scores.find((s) => s.photoId === 'with-stranger')!;
    expect(stranger.hasStrangers).toBe(true);
    expect(stranger.selectedPresent).toEqual([]);
  });

  it('stays neutral about people when none are selected', () => {
    const scores = scorePhotos([analysis('a', [face(0)]), analysis('b', [])], { selectedPeople: new Set(), peopleByPhoto: new Map() });
    expect(scores.every((s) => s.people === 0.5)).toBe(true);
  });
});

describe('merging people', () => {
  const cluster = (id: string, photos: string[]): import('../src').PersonCluster => ({
    id,
    members: photos.map((photoId) => ({ photoId, faceIndex: 0 })),
    centroid: l2Normalize(embeddingFor(Number(id.slice(-1)), 0)),
    representative: { photoId: photos[0]!, faceIndex: 0 },
  });

  it('merges two groups of the same person, keeping the richest identity', () => {
    const clusters = [cluster('p1', ['a', 'b']), cluster('p2', ['c', 'd', 'e']), cluster('p3', ['f'])];
    const merged = mergeClusters(clusters, ['p1', 'p2']);
    expect(merged).toHaveLength(2);
    // p2 est le plus fourni : il donne son id et son visage de référence.
    expect(merged[0]!.id).toBe('p2');
    expect(merged[0]!.representative.photoId).toBe('c');
    expect(merged[0]!.members.map((m) => m.photoId).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    // Le groupe fusionné prend la place du premier concerné, l'ordre du reste tient.
    expect(merged[1]!.id).toBe('p3');
    expect(Math.hypot(...merged[0]!.centroid)).toBeCloseTo(1);
  });

  it('drops duplicate faces and leaves the list alone when there is nothing to merge', () => {
    const a = cluster('p1', ['x', 'y']);
    const b = { ...cluster('p2', ['y', 'z']), members: [{ photoId: 'y', faceIndex: 0 }, { photoId: 'z', faceIndex: 0 }] };
    const merged = mergeClusters([a, b], ['p1', 'p2']);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.members).toHaveLength(3);
    const untouched = [a, b];
    expect(mergeClusters(untouched, ['p1'])).toBe(untouched);
    expect(mergeClusters(untouched, ['p1', 'inconnu'])).toBe(untouched);
  });
});
