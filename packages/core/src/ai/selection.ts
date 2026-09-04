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
  /** Écart, en heures, séparant deux événements (chapitres de l'album). */
  eventGapHours?: number;
  /**
   * Nombre de photos demandé pour un événement donné, par `TimeBucket.id`.
   * L'utilisateur règle ainsi le poids de chaque moment de son album. Un
   * événement doté d'un quota explicite échappe au plafond `maxPerMoment` :
   * demander dix photos d'un anniversaire n'a pas de sens si la règle
   * anti-rafale en refuse huit. Les autres filtres continuent de s'appliquer,
   * si bien qu'un quota reste un plafond, jamais une garantie.
   */
  eventQuotas?: ReadonlyMap<string, number>;
  /** Photos imposées par l'utilisateur : elles entrent sans passer les filtres. */
  keep?: ReadonlySet<string>;
  /** Photos refusées par l'utilisateur : elles n'entrent jamais. */
  drop?: ReadonlySet<string>;
  /**
   * Indice d'artificialité toléré (0..1). Au-delà, la photo est écartée comme
   * capture d'écran ou image enregistrée. 1 (défaut) désactive le filtre.
   */
  maxArtificiality?: number;
}

export interface SelectedPhoto {
  analysis: PhotoAnalysis;
  score: PhotoScore;
}

/** Pourquoi une photo n'a pas été retenue. */
export type RejectionReason =
  /** Ce n'est pas une photo prise par un appareil (capture d'écran, image enregistrée…). */
  | 'notPhoto'
  /** Trop floue pour être imprimée. */
  | 'sharpness'
  /** Note globale sous le seuil. */
  | 'score'
  /** Quasi identique à une photo déjà retenue (rafale). */
  | 'duplicate'
  /** Trop de photos déjà prises du même moment. */
  | 'moment'
  /** L'événement a atteint le nombre de photos demandé. */
  | 'event'
  /** L'album était déjà complet. */
  | 'quota'
  /** Écartée à la main par l'utilisateur. */
  | 'manual';

export interface RejectedPhoto {
  analysis: PhotoAnalysis;
  score: PhotoScore;
  reason: RejectionReason;
  /** Pour un doublon : la photo retenue à laquelle elle ressemble. */
  duplicateOf?: string;
}

/**
 * Tranche temporelle de photos contiguës. Sert deux fois, avec deux échelles :
 * le « moment » (quelques minutes, une rafale) qui limite les redites, et
 * l'« événement » (quelques heures, un chapitre) dont l'utilisateur règle la
 * part dans l'album.
 */
export interface TimeBucket {
  /**
   * Clé stable entre deux calculs : date ISO de la première photo de la
   * tranche. Les réglages de l'utilisateur y sont accrochés, ils survivent
   * donc à un changement de personnes ou de nombre de photos.
   */
  id: string;
  start?: string;
  end?: string;
  /** Photos de la tranche, dans l'ordre chronologique. */
  photoIds: string[];
}

/** Identifiant de la tranche qui réunit les photos sans date. */
export const UNDATED_BUCKET = 'undated';

export interface SelectionResult {
  selected: SelectedPhoto[];
  /** Toutes les photos écartées, avec le motif, triées par note décroissante. */
  rejected: RejectedPhoto[];
  /** Événements candidats, avant sélection : la matière des réglages de l'utilisateur. */
  eventBuckets: TimeBucket[];
  /** Moments candidats (rafales), avant sélection. */
  momentBuckets: TimeBucket[];
}

const takenTime = (a: PhotoAnalysis): number => (a.photo.takenAt ? Date.parse(a.photo.takenAt) : NaN);

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Découpe les photos en tranches temporelles : deux photos consécutives
 * séparées de moins de `gapMs` appartiennent à la même tranche. Les photos sans
 * date forment une dernière tranche à part, `UNDATED_BUCKET`.
 */
export function timeBuckets(analyses: PhotoAnalysis[], gapMs: number): TimeBucket[] {
  const dated = analyses
    .map((a) => ({ id: a.photo.id, t: takenTime(a), iso: a.photo.takenAt! }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((x, y) => x.t - y.t || (x.id < y.id ? -1 : 1));

  const out: TimeBucket[] = [];
  let current: TimeBucket | null = null;
  let last = NaN;
  for (const { id, t, iso } of dated) {
    if (!current || t - last > gapMs) {
      current = { id: iso, start: iso, end: iso, photoIds: [] };
      out.push(current);
    }
    current.photoIds.push(id);
    current.end = iso;
    last = t;
  }

  const undated = analyses.filter((a) => Number.isNaN(takenTime(a))).map((a) => a.photo.id);
  if (undated.length) out.push({ id: UNDATED_BUCKET, photoIds: undated });
  return out;
}

/** Index inverse d'un découpage : photoId → identifiant de tranche. */
export function bucketIndex(buckets: TimeBucket[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of buckets) for (const id of b.photoIds) out.set(id, b.id);
  return out;
}

/**
 * Sélectionne les meilleures photos en évitant les doublons (rafales) et en
 * limitant le nombre de photos issues d'un même moment, pour un album varié.
 *
 * Trois passes : les photos imposées à la main, puis les quotas réclamés
 * événement par événement, puis le remplissage au classement général jusqu'à
 * `targetCount`. L'album peut donc dépasser la cible si les choix explicites de
 * l'utilisateur l'exigent — son geste prime toujours sur le réglage global.
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
  const maxArtificiality = opts.maxArtificiality ?? 1;
  const momentMs = (opts.momentWindowSec ?? 180) * 1000;
  const eventMs = (opts.eventGapHours ?? 6) * 3600 * 1000;
  const quotas = opts.eventQuotas;
  const keep = opts.keep ?? EMPTY_SET;
  const drop = opts.drop ?? EMPTY_SET;

  const byId = new Map(analyses.map((a) => [a.photo.id, a]));
  const momentBuckets = timeBuckets(analyses, momentMs);
  const eventBuckets = timeBuckets(analyses, eventMs);
  // Une photo sans date n'appartient à aucun moment : impossible de dire si
  // elle relève d'une rafale, le plafond ne peut donc pas s'y appliquer.
  const momentOf = bucketIndex(momentBuckets.filter((b) => b.id !== UNDATED_BUCKET));
  const eventOf = bucketIndex(eventBuckets);

  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const chosen: SelectedPhoto[] = [];
  const rejected: RejectedPhoto[] = [];
  const perMoment = new Map<string, number>();
  const perEvent = new Map<string, number>();
  /** Photos déjà tranchées : retenues ou écartées, jamais examinées deux fois. */
  const settled = new Set<string>();

  const reject = (analysis: PhotoAnalysis, score: PhotoScore, reason: RejectionReason, duplicateOf?: string) => {
    settled.add(analysis.photo.id);
    rejected.push(duplicateOf ? { analysis, score, reason, duplicateOf } : { analysis, score, reason });
  };

  const accept = (analysis: PhotoAnalysis, score: PhotoScore) => {
    settled.add(analysis.photo.id);
    chosen.push({ analysis, score });
    const moment = momentOf.get(analysis.photo.id);
    if (moment !== undefined) perMoment.set(moment, (perMoment.get(moment) ?? 0) + 1);
    const event = eventOf.get(analysis.photo.id);
    if (event !== undefined) perEvent.set(event, (perEvent.get(event) ?? 0) + 1);
  };

  const isDuplicate = (analysis: PhotoAnalysis): SelectedPhoto | undefined =>
    chosen.find((c) => isNearDuplicate(c.analysis.hash, analysis.hash, dupThreshold));

  // Passe 0 : les refus de l'utilisateur, avant tout examen.
  for (const score of ranked) {
    const analysis = byId.get(score.photoId);
    if (analysis && drop.has(score.photoId)) reject(analysis, score, 'manual');
  }

  // Passe 1 : les photos imposées entrent telles quelles. Un choix explicite ne
  // se fait pas recaler par un seuil de netteté ni par un quota.
  for (const score of ranked) {
    if (settled.has(score.photoId) || !keep.has(score.photoId)) continue;
    const analysis = byId.get(score.photoId);
    if (analysis) accept(analysis, score);
  }

  // Passe 2 : les quotas réclamés événement par événement, servis avant le
  // classement général — sans quoi un petit événement serait toujours mangé par
  // les meilleures notes d'un grand.
  if (quotas) {
    for (const bucket of eventBuckets) {
      const quota = quotas.get(bucket.id);
      if (quota === undefined) continue;
      const wanted = new Set(bucket.photoIds);
      for (const score of ranked) {
        if ((perEvent.get(bucket.id) ?? 0) >= quota) break;
        if (settled.has(score.photoId) || !wanted.has(score.photoId)) continue;
        const analysis = byId.get(score.photoId);
        if (!analysis) continue;
        const reason = disqualify(analysis, score, { minSharpness, minScore, maxArtificiality });
        if (reason) {
          reject(analysis, score, reason);
          continue;
        }
        const duplicate = isDuplicate(analysis);
        if (duplicate) {
          reject(analysis, score, 'duplicate', duplicate.analysis.photo.id);
          continue;
        }
        accept(analysis, score);
      }
    }
  }

  // Passe 3 : remplissage au classement général jusqu'à la cible. Les motifs
  // sont testés du plus propre à la photo au plus circonstanciel : « trop
  // floue » renseigne mieux que « album complet », même si les deux sont vrais.
  for (const score of ranked) {
    if (settled.has(score.photoId)) continue;
    const analysis = byId.get(score.photoId);
    if (!analysis) continue;

    const reason = disqualify(analysis, score, { minSharpness, minScore, maxArtificiality });
    if (reason) {
      reject(analysis, score, reason);
      continue;
    }
    if (chosen.length >= opts.targetCount) {
      reject(analysis, score, 'quota');
      continue;
    }
    const event = eventOf.get(analysis.photo.id);
    if (event !== undefined && quotas?.has(event) && (perEvent.get(event) ?? 0) >= quotas.get(event)!) {
      reject(analysis, score, 'event');
      continue;
    }
    const duplicate = isDuplicate(analysis);
    if (duplicate) {
      reject(analysis, score, 'duplicate', duplicate.analysis.photo.id);
      continue;
    }
    const moment = momentOf.get(analysis.photo.id);
    if (moment !== undefined && (perMoment.get(moment) ?? 0) >= maxPerMoment) {
      reject(analysis, score, 'moment');
      continue;
    }
    accept(analysis, score);
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
  return { selected: chosen, rejected, eventBuckets, momentBuckets };
}

/** Motifs de rejet propres à la photo, indépendants de ce qui a déjà été retenu. */
function disqualify(
  analysis: PhotoAnalysis,
  score: PhotoScore,
  limits: { minSharpness: number; minScore: number; maxArtificiality: number },
): RejectionReason | undefined {
  if ((analysis.authenticity?.artificiality ?? 0) > limits.maxArtificiality) return 'notPhoto';
  if (analysis.quality.sharpness < limits.minSharpness) return 'sharpness';
  if (score.score < limits.minScore) return 'score';
  return undefined;
}

/**
 * Découpe chronologiquement les photos datées en « moments » : deux photos
 * consécutives séparées de moins de `windowMs` appartiennent au même moment.
 * Les photos non datées n'ont pas de moment.
 */
export function assignMoments(analyses: PhotoAnalysis[], windowMs: number): Map<string, number> {
  const out = new Map<string, number>();
  timeBuckets(analyses, windowMs)
    .filter((b) => b.id !== UNDATED_BUCKET)
    .forEach((bucket, index) => {
      for (const id of bucket.photoIds) out.set(id, index);
    });
  return out;
}

export interface PhotoEvent {
  /** Titre proposé (date). */
  title: string;
  start?: string;
  end?: string;
  photos: SelectedPhoto[];
  /** Tranche candidate dont l'événement est issu, quand il en vient une. */
  bucketId?: string;
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

/**
 * Chapitres de l'album calqués sur les tranches candidates, réduites aux photos
 * retenues. Regrouper à nouveau les seules photos retenues donnerait un
 * découpage différent — une photo écartée peut faire le pont entre deux
 * instants — et l'album ne correspondrait plus aux réglages de l'utilisateur.
 */
export function eventsFromBuckets(
  buckets: TimeBucket[],
  selected: SelectedPhoto[],
  locale = 'fr-FR',
): PhotoEvent[] {
  const byId = new Map(selected.map((s) => [s.analysis.photo.id, s]));
  const events: PhotoEvent[] = [];
  for (const bucket of buckets) {
    const photos = bucket.photoIds.map((id) => byId.get(id)).filter((p): p is SelectedPhoto => !!p);
    if (photos.length === 0) continue;
    const event: PhotoEvent = { title: '', photos, bucketId: bucket.id };
    const dates = photos.map((p) => p.analysis.photo.takenAt).filter((d): d is string => !!d);
    if (dates.length) {
      event.start = dates[0];
      event.end = dates[dates.length - 1];
    }
    event.title = formatEventTitle(event, locale);
    events.push(event);
  }
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
