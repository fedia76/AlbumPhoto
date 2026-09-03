import type { DetectedFace, PersonCluster, PhotoAnalysis } from './types';

export function l2Normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('dimensions différentes');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export interface ClusterOptions {
  /** Similarité cosinus minimale pour fusionner (≈ 0.6 pour MobileFaceNet/ArcFace). */
  threshold?: number;
  /** Taille minimale d'un groupe pour être proposé à l'utilisateur. */
  minMembers?: number;
  /** Ignore les visages trop petits (fraction de la largeur de la photo). */
  minFaceWidth?: number;
}

interface FaceRef {
  photoId: string;
  faceIndex: number;
  face: DetectedFace;
  embedding: Float32Array;
}

/** Qualité d'un visage comme « portrait de référence » : grand, de face, yeux ouverts. */
export function faceRepresentativeness(face: DetectedFace): number {
  const size = Math.min(1, face.rect.w * 4);
  const yaw = Math.abs(face.headEulerAngleY ?? 0);
  const frontal = Math.max(0, 1 - yaw / 45);
  const eyes = ((face.leftEyeOpenProbability ?? 0.8) + (face.rightEyeOpenProbability ?? 0.8)) / 2;
  return 0.4 * size + 0.4 * frontal + 0.2 * eyes;
}

/**
 * Regroupement agglomératif (lien moyen via centroïdes) des visages par identité.
 * Déterministe : parcours des visages par photo puis par index.
 */
export function clusterFaces(analyses: PhotoAnalysis[], opts: ClusterOptions = {}): PersonCluster[] {
  const threshold = opts.threshold ?? 0.6;
  const minMembers = opts.minMembers ?? 2;
  const minFaceWidth = opts.minFaceWidth ?? 0.04;

  const refs: FaceRef[] = [];
  for (const a of analyses) {
    a.faces.forEach((face, faceIndex) => {
      if (!face.embedding || face.rect.w < minFaceWidth) return;
      refs.push({ photoId: a.photo.id, faceIndex, face, embedding: l2Normalize(face.embedding) });
    });
  }

  type Work = { members: FaceRef[]; sum: Float32Array };
  const clusters: Work[] = [];
  const dim = refs[0]?.embedding.length ?? 0;

  for (const ref of refs) {
    let best = -1;
    let bestSim = threshold;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosineSimilarity(ref.embedding, clusters[i]!.sum);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    }
    if (best >= 0) {
      const c = clusters[best]!;
      c.members.push(ref);
      for (let i = 0; i < dim; i++) c.sum[i]! += ref.embedding[i]!;
    } else {
      clusters.push({ members: [ref], sum: Float32Array.from(ref.embedding) });
    }
  }

  // Passe de fusion : deux groupes dont les centroïdes sont très proches sont réunis.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (cosineSimilarity(clusters[i]!.sum, clusters[j]!.sum) > threshold + 0.1) {
          const a = clusters[i]!;
          const b = clusters[j]!;
          a.members.push(...b.members);
          for (let k = 0; k < dim; k++) a.sum[k]! += b.sum[k]!;
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  return clusters
    .filter((c) => c.members.length >= minMembers)
    .sort((a, b) => b.members.length - a.members.length)
    .map((c, i) => {
      const rep = c.members.reduce((best, m) =>
        faceRepresentativeness(m.face) > faceRepresentativeness(best.face) ? m : best,
      );
      return {
        id: `person-${i + 1}`,
        members: c.members.map((m) => ({ photoId: m.photoId, faceIndex: m.faceIndex })),
        centroid: l2Normalize(c.sum),
        representative: { photoId: rep.photoId, faceIndex: rep.faceIndex },
      };
    });
}

/**
 * Fusionne plusieurs groupes en un seul : l'IA sépare parfois la même personne
 * en plusieurs visages (profil, lunettes, âge différent), l'utilisateur peut
 * alors les réunir.
 *
 * Le groupe résultat garde l'identifiant du plus fourni, réunit les membres
 * sans doublon, recalcule le centroïde pondéré par le nombre de membres et
 * conserve le visage représentatif du plus fourni. L'ordre des autres groupes
 * est préservé.
 */
export function mergeClusters(clusters: PersonCluster[], idsToMerge: readonly string[]): PersonCluster[] {
  const ids = new Set(idsToMerge);
  const targets = clusters.filter((c) => ids.has(c.id));
  if (targets.length < 2) return clusters;

  // Le plus fourni donne son identité (id et visage de référence).
  const primary = targets.reduce((best, c) => (c.members.length > best.members.length ? c : best));
  const dim = primary.centroid.length;
  const sum = new Float32Array(dim);
  const members: PersonCluster['members'] = [];
  const seen = new Set<string>();
  for (const c of targets) {
    for (let i = 0; i < dim; i++) sum[i]! += (c.centroid[i] ?? 0) * c.members.length;
    for (const m of c.members) {
      const key = `${m.photoId}#${m.faceIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      members.push(m);
    }
  }

  const merged: PersonCluster = {
    id: primary.id,
    members,
    centroid: l2Normalize(sum),
    representative: primary.representative,
  };

  // On remet le groupe fusionné à la place du premier des groupes concernés.
  const out: PersonCluster[] = [];
  let inserted = false;
  for (const c of clusters) {
    if (!ids.has(c.id)) {
      out.push(c);
      continue;
    }
    if (!inserted) {
      out.push(merged);
      inserted = true;
    }
  }
  return out;
}

/** Index inverse : photoId → ids des personnes présentes. */
export function peopleByPhoto(clusters: PersonCluster[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of clusters) {
    for (const m of c.members) {
      const list = map.get(m.photoId) ?? [];
      if (!list.includes(c.id)) list.push(c.id);
      map.set(m.photoId, list);
    }
  }
  return map;
}
