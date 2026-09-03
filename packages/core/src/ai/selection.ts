import type { PhotoAnalysis } from './types';
import type { PhotoScore } from './scoring';
import { isNearDuplicate } from './phash';

export interface SelectionOptions {
  /** Nombre de photos souhaité dans l'album. */
  targetCount: number;
  /** Distance de Hamming max pour considérer deux photos comme doublons. */
  duplicateThreshold?: number;
  /** Score minimal absolu. */
  minScore?: number;
  /** Netteté minimale (0..1) : en dessous, la photo est écartée quoi qu'il arrive. */
  minSharpness?: number;
  /** Nombre maximal de photos par « moment » (rafale de quelques minutes). */
  maxPerMoment?: number;
  /** Durée d'un moment en secondes. */
  momentWindowSec?: number;
}

export interface SelectedPhoto {
  analysis: PhotoAnalysis;
  score: PhotoScore;
}

/** Pourquoi une photo n'a pas été retenue. */
export type RejectionReason =
  /** Trop floue pour être imprimée. */
  | 'sharpness'
  /** Note globale sous le seuil. */
  | 'score'
  /** Quasi identique à une photo déjà retenue (rafale). */
  | 'duplicate'
  /** Trop de photos déjà prises du même moment. */
  | 'moment'
  /** L'album était déjà complet. */
  | 'quota';

export interface RejectedPhoto {
  analysis: PhotoAnalysis;
  score: PhotoScore;
  reason: RejectionReason;
  /** Pour un doublon : la photo retenue à laquelle elle ressemble. */
  duplicateOf?: string;
}

export interface SelectionResult {
  selected: SelectedPhoto[];
  /** Toutes les photos écartées, avec le motif, triées par note décroissante. */
  rejected: RejectedPhoto[];
}

const takenTime = (a: PhotoAnalysis): number => (a.photo.takenAt ? Date.parse(a.photo.takenAt) : NaN);

/**
 * Sélectionne les meilleures photos en évitant les doublons (rafales) et en
 * limitant le nombre de photos issues d'un même moment, pour un album varié.
 */
export function selectPhotos(
  analyses: PhotoAnalysis[],
  scores: PhotoScore[],
  opts: SelectionOptions,
): SelectionResult {
  const dupThreshold = opts.duplicateThreshold ?? 10;
  const minScore = opts.minScore ?? 0.25;
  const minSharpness = opts.minSharpness ?? 0.08;
  const maxPerMoment = opts.maxPerMoment ?? 2;
  const windowMs = (opts.momentWindowSec ?? 180) * 1000;

  const byId = new Map(analyses.map((a) => [a.photo.id, a]));
  const momentOf = assignMoments(analyses, windowMs);
  const perMoment = new Map<number, number>();
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const chosen: SelectedPhoto[] = [];
  const rejected: RejectedPhoto[] = [];

  for (const score of ranked) {
    const analysis = byId.get(score.photoId);
    if (!analysis) continue;
    const reject = (reason: RejectionReason, duplicateOf?: string) => {
      rejected.push(duplicateOf ? { analysis, score, reason, duplicateOf } : { analysis, score, reason });
    };

    // Les motifs propres à la photo sont testés d'abord : dire « trop floue »
    // est plus utile que « album complet », même si les deux sont vrais.
    if (analysis.quality.sharpness < minSharpness) {
      reject('sharpness');
      continue;
    }
    if (score.score < minScore) {
      reject('score');
      continue;
    }
    if (chosen.length >= opts.targetCount) {
      reject('quota');
      continue;
    }
    const duplicate = chosen.find((c) => isNearDuplicate(c.analysis.hash, analysis.hash, dupThreshold));
    if (duplicate) {
      reject('duplicate', duplicate.analysis.photo.id);
      continue;
    }
    const moment = momentOf.get(analysis.photo.id);
    if (moment !== undefined) {
      const taken = perMoment.get(moment) ?? 0;
      if (taken >= maxPerMoment) {
        reject('moment');
        continue;
      }
      perMoment.set(moment, taken + 1);
    }
    chosen.push({ analysis, score });
  }

  // Ordre chronologique pour la narration ; les photos sans date à la fin.
  chosen.sort((x, y) => {
    const tx = takenTime(x.analysis);
    const ty = takenTime(y.analysis);
    if (Number.isNaN(tx) && Number.isNaN(ty)) return 0;
    if (Number.isNaN(tx)) return 1;
    if (Number.isNaN(ty)) return -1;
    return tx - ty;
  });
  return { selected: chosen, rejected };
}

/**
 * Découpe chronologiquement les photos datées en « moments » : deux photos
 * consécutives séparées de moins de `windowMs` appartiennent au même moment.
 * Les photos non datées n'ont pas de moment.
 */
export function assignMoments(analyses: PhotoAnalysis[], windowMs: number): Map<string, number> {
  const dated = analyses
    .map((a) => ({ id: a.photo.id, t: takenTime(a) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((x, y) => x.t - y.t);
  const out = new Map<string, number>();
  let moment = -1;
  let last = NaN;
  for (const { id, t } of dated) {
    if (Number.isNaN(last) || t - last > windowMs) moment++;
    out.set(id, moment);
    last = t;
  }
  return out;
}

export interface PhotoEvent {
  /** Titre proposé (date). */
  title: string;
  start?: string;
  end?: string;
  photos: SelectedPhoto[];
}

/**
 * Regroupe des photos (triées) en « événements » séparés par un écart temporel.
 * Sert à structurer l'album en chapitres.
 */
export function groupIntoEvents(
  photos: SelectedPhoto[],
  gapHours = 6,
  locale = 'fr-FR',
): PhotoEvent[] {
  const events: PhotoEvent[] = [];
  const gapMs = gapHours * 3600 * 1000;
  let current: PhotoEvent | null = null;
  let lastTime = NaN;
  for (const p of photos) {
    const t = takenTime(p.analysis);
    const newEvent = !current || Number.isNaN(t) !== Number.isNaN(lastTime) || (!Number.isNaN(t) && t - lastTime > gapMs);
    if (newEvent) {
      current = { title: '', photos: [] };
      if (!Number.isNaN(t)) current.start = p.analysis.photo.takenAt;
      events.push(current);
    }
    current!.photos.push(p);
    if (!Number.isNaN(t)) {
      current!.end = p.analysis.photo.takenAt;
      lastTime = t;
    } else lastTime = NaN;
  }
  for (const e of events) e.title = formatEventTitle(e, locale);
  return events;
}

export function formatEventTitle(e: PhotoEvent, locale = 'fr-FR'): string {
  if (!e.start) return locale.startsWith('fr') ? 'Souvenirs' : 'Memories';
  const start = new Date(e.start);
  const end = e.end ? new Date(e.end) : start;
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  if (sameDay) return fmt.format(start);
  const short = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${short.format(start)} – ${fmt.format(end)}`;
}
