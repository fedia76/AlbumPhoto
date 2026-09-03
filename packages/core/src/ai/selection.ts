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

const takenTime = (a: PhotoAnalysis): number => (a.photo.takenAt ? Date.parse(a.photo.takenAt) : NaN);

/**
 * Sélectionne les meilleures photos en évitant les doublons (rafales) et en
 * limitant le nombre de photos issues d'un même moment, pour un album varié.
 */
export function selectPhotos(
  analyses: PhotoAnalysis[],
  scores: PhotoScore[],
  opts: SelectionOptions,
): SelectedPhoto[] {
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

  for (const s of ranked) {
    if (chosen.length >= opts.targetCount) break;
    if (s.score < minScore) continue;
    const a = byId.get(s.photoId);
    if (!a) continue;
    if (a.quality.sharpness < minSharpness) continue;
    if (chosen.some((c) => isNearDuplicate(c.analysis.hash, a.hash, dupThreshold))) continue;
    const moment = momentOf.get(a.photo.id);
    if (moment !== undefined) {
      const n = perMoment.get(moment) ?? 0;
      if (n >= maxPerMoment) continue;
      perMoment.set(moment, n + 1);
    }
    chosen.push({ analysis: a, score: s });
  }

  // Ordre chronologique pour la narration ; les photos sans date à la fin.
  return chosen.sort((x, y) => {
    const tx = takenTime(x.analysis);
    const ty = takenTime(y.analysis);
    if (Number.isNaN(tx) && Number.isNaN(ty)) return 0;
    if (Number.isNaN(tx)) return 1;
    if (Number.isNaN(ty)) return -1;
    return tx - ty;
  });
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
