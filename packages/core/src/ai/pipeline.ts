import type { Album, CaptionStyle, Person, Photo } from '../album/types';
import { newId } from '../album/ids';
import type { DetectedFace, PersonCluster, PhotoAnalysis, RgbaImage, SourcePhoto } from './types';
import { computeQuality, toGray } from './quality';
import { dHash } from './phash';
import { clusterFaces, peopleByPhoto, type ClusterOptions } from './clustering';
import { scorePhotos, type PhotoScore, type ScoringWeights } from './scoring';
import {
  eventsFromBuckets,
  selectPhotos,
  type PhotoEvent,
  type RejectedPhoto,
  type SelectedPhoto,
  type SelectionOptions,
  type TimeBucket,
} from './selection';
import type { CaptionDraft, CaptionGenerator, CaptionContext } from './captions/types';
import { timeOfDayFromIso } from './captions/context';
import { TemplateCaptionGenerator } from './captions/templateGenerator';
import { buildAlbum, eventsToBuildInput } from './builder';

/* ----------------------------- Ports (adapters) ---------------------------- */

/** Source de photos (galerie de l'appareil, dossier…). */
export interface PhotoSource {
  /** Itère sur les photos, de la plus récente à la plus ancienne. */
  list(opts: { limit?: number; after?: string; before?: string }): AsyncIterable<SourcePhoto>;
}

/** Fournit une version réduite décodée en RGBA (≈ 256–320 px de large). */
export interface PixelReader {
  readThumbnail(photo: SourcePhoto, maxSize: number): Promise<RgbaImage>;
}

export interface FaceDetector {
  detect(photo: SourcePhoto): Promise<DetectedFace[]>;
}

export interface FaceEmbedder {
  /** Calcule un vecteur d'identité pour chaque visage (même ordre). */
  embed(photo: SourcePhoto, faces: DetectedFace[]): Promise<Float32Array[]>;
}

export interface ImageLabeler {
  label(photo: SourcePhoto): Promise<string[]>;
}

/** Importe une photo source dans le bundle d'un album ; renvoie la `Photo` du format. */
export interface PhotoImporter {
  importPhoto(albumId: string, photo: SourcePhoto): Promise<Pick<Photo, 'src' | 'thumb' | 'mimeType'>>;
}

export interface PipelineAdapters {
  source: PhotoSource;
  pixels: PixelReader;
  faces: FaceDetector;
  embedder: FaceEmbedder;
  labeler?: ImageLabeler;
  captions: CaptionGenerator;
  importer: PhotoImporter;
}

/* ------------------------------- Progression ------------------------------- */

export type PipelineStage = 'scan' | 'cluster' | 'score' | 'caption' | 'build';

export interface Progress {
  stage: PipelineStage;
  done: number;
  total: number;
  message?: string;
  /**
   * Élément en cours (1 pour le premier), émis *avant* de le traiter. Sans lui,
   * une étape lente est indiscernable d'une étape bloquée : la progression ne
   * bouge qu'une fois l'élément terminé.
   */
  current?: number;
  /** Durée de l'élément qui vient de se terminer, en millisecondes. */
  elapsedMs?: number;
}

export type ProgressCallback = (p: Progress) => void;

/* ---------------------------------- Étapes --------------------------------- */

export interface ScanOptions {
  /** Nombre max de photos à parcourir. */
  limit?: number;
  after?: string;
  before?: string;
  thumbnailSize?: number;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/** Étape 1 : parcours et analyse locale (visages, qualité, hash, étiquettes). */
export async function scanPhotos(adapters: PipelineAdapters, opts: ScanOptions = {}): Promise<PhotoAnalysis[]> {
  const out: PhotoAnalysis[] = [];
  const total = opts.limit ?? 0;
  let done = 0;
  for await (const photo of adapters.source.list({ limit: opts.limit, after: opts.after, before: opts.before })) {
    if (opts.signal?.aborted) break;
    try {
      const analysis = await analyzePhoto(adapters, photo, opts.thumbnailSize ?? 256);
      out.push(analysis);
    } catch {
      // Une photo illisible ne doit pas interrompre le parcours.
    }
    done++;
    opts.onProgress?.({ stage: 'scan', done, total, message: photo.fileName ?? photo.id });
  }
  return out;
}

export async function analyzePhoto(adapters: PipelineAdapters, photo: SourcePhoto, thumbnailSize = 256): Promise<PhotoAnalysis> {
  const [rgba, faces, labels] = await Promise.all([
    adapters.pixels.readThumbnail(photo, thumbnailSize),
    adapters.faces.detect(photo),
    adapters.labeler ? adapters.labeler.label(photo).catch(() => []) : Promise.resolve([]),
  ]);
  if (faces.length) {
    const embeddings = await adapters.embedder.embed(photo, faces);
    faces.forEach((f, i) => {
      const e = embeddings[i];
      if (e) f.embedding = e;
    });
  }
  return {
    photo,
    faces,
    quality: computeQuality(rgba),
    hash: dHash(toGray(rgba)),
    labels,
  };
}

/** Étape 2 : regroupement des visages en personnes candidates. */
export function detectPeople(analyses: PhotoAnalysis[], opts?: ClusterOptions): PersonCluster[] {
  return clusterFaces(analyses, opts);
}

export interface SelectionParams {
  selectedPeople: Set<string>;
  targetCount: number;
  weights?: Partial<ScoringWeights>;
  allowScenery?: boolean;
  eventGapHours?: number;
  locale?: string;
  /**
   * Réglages fins de la sélection : quotas par événement, photos imposées ou
   * refusées, seuils. Sans eux, l'assistant restait cantonné aux valeurs par
   * défaut : deux photos par moment, quels que soient les moments.
   */
  selection?: Omit<SelectionOptions, 'targetCount' | 'eventGapHours'>;
}

export interface SelectionOutcome {
  selected: SelectedPhoto[];
  /** Photos écartées et motif, pour expliquer la sélection à l'utilisateur. */
  rejected: RejectedPhoto[];
  events: PhotoEvent[];
  /** Événements candidats, y compris ceux dont aucune photo n'a été retenue. */
  eventBuckets: TimeBucket[];
  /** Moments candidats (rafales). */
  momentBuckets: TimeBucket[];
  byPhoto: Map<string, string[]>;
  scores: PhotoScore[];
}

/** Étape 3 : scoring et sélection des meilleures photos, regroupées en événements. */
export function selectBestPhotos(
  analyses: PhotoAnalysis[],
  clusters: PersonCluster[],
  params: SelectionParams,
): SelectionOutcome {
  const byPhoto = peopleByPhoto(clusters);
  const scores = scorePhotos(analyses, {
    selectedPeople: params.selectedPeople,
    peopleByPhoto: byPhoto,
    weights: params.weights,
    allowScenery: params.allowScenery,
  });
  const { selected, rejected, eventBuckets, momentBuckets } = selectPhotos(analyses, scores, {
    ...params.selection,
    targetCount: params.targetCount,
    ...(params.eventGapHours === undefined ? {} : { eventGapHours: params.eventGapHours }),
  });
  // Les chapitres suivent les tranches que l'utilisateur a réglées, pas un
  // nouveau découpage des seules photos retenues.
  const events = eventsFromBuckets(eventBuckets, selected, params.locale);
  return { selected, rejected, events, eventBuckets, momentBuckets, byPhoto, scores };
}

/** Issue d'une légende, pour le journal de diagnostic. */
export interface CaptionDiagnostic {
  /** Rang de la photo dans l'album, à partir de 1. */
  index: number;
  total: number;
  photoId: string;
  /** Durée de l'appel au générateur, en millisecondes. */
  elapsedMs: number;
  outcome:
    | 'ok'
    /** Le générateur a répondu une chaîne vide : la page restera sans texte. */
    | 'empty'
    | 'error'
    /** Le générateur n'a pas répondu dans le délai imparti. */
    | 'timeout'
    /** Trop de blocages : les photos suivantes passent aux gabarits. */
    | 'abandoned';
  error?: unknown;
}

export interface CaptionParams {
  style: CaptionStyle;
  locale: string;
  albumTitle: string;
  /** Noms choisis par l'utilisateur pour chaque personne (clusterId → nom). */
  personNames: Map<string, string>;
  selectedPeople: Set<string>;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  /**
   * Délai maximal accordé à une légende, en millisecondes (0 ou absent : sans
   * limite). Un générateur qui ne rend jamais la main — un LLM sur appareil qui
   * se bloque, par exemple — figerait sinon l'assistant sans aucun message.
   */
  timeoutMs?: number;
  /**
   * Nombre de blocages tolérés avant de renoncer au générateur pour le reste de
   * l'album. Au-delà, les légendes restantes viennent des gabarits, sans
   * attendre à nouveau le délai à chaque photo. Par défaut : 2.
   */
  maxTimeouts?: number;
  /** Appelé pour chaque photo, avec le détail de ce qui s'est passé. */
  onDiagnostic?: (d: CaptionDiagnostic) => void;
  /**
   * Appelé dès qu'une légende est prête, avant de passer à la suivante. Permet
   * de l'appliquer sans attendre la fin de l'album — l'écriture peut durer
   * plusieurs minutes, et l'utilisateur regarde ses pages pendant ce temps.
   * L'attente est incluse dans le cycle : une écriture lente ralentit la suite
   * plutôt que de s'empiler.
   */
  onCaption?: (photoId: string, draft: CaptionDraft) => void | Promise<void>;
}

export function captionContextFor(
  sel: SelectedPhoto,
  byPhoto: Map<string, string[]>,
  params: Pick<CaptionParams, 'locale' | 'albumTitle' | 'personNames' | 'selectedPeople'>,
  eventTitle?: string,
): CaptionContext {
  const a = sel.analysis;
  const people = (byPhoto.get(a.photo.id) ?? [])
    .filter((id) => params.selectedPeople.has(id))
    .map((id) => params.personNames.get(id) ?? '')
    .filter(Boolean);
  const smiles = a.faces.map((f) => f.smilingProbability).filter((p): p is number => p !== undefined);
  const ctx: CaptionContext = {
    people,
    faceCount: a.faces.length,
    labels: a.labels,
    locale: params.locale,
    albumTitle: params.albumTitle,
  };
  if (a.photo.takenAt) {
    ctx.takenAt = a.photo.takenAt;
    const tod = timeOfDayFromIso(a.photo.takenAt);
    if (tod) ctx.timeOfDay = tod;
  }
  if (smiles.length) ctx.smiling = smiles.every((p) => p > 0.6);
  if (eventTitle) ctx.eventTitle = eventTitle;
  return ctx;
}

/** Erreur d'un générateur de légendes qui a dépassé son délai. */
class CaptionTimeout extends Error {
  constructor(readonly ms: number) {
    super(`Le générateur de légendes n'a pas répondu en ${Math.round(ms / 1000)} s.`);
    this.name = 'CaptionTimeout';
  }
}

/**
 * Attend `promise` au plus `ms` millisecondes. La promesse abandonnée continue
 * de vivre : c'est au générateur, prévenu par `onTimeout`, d'arrêter son
 * travail (un LLM sur appareil s'interrompt, par exemple).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  if (!ms || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new CaptionTimeout(ms));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Étape 4 : légendes dans le style choisi. */
export async function generateCaptions(
  generator: CaptionGenerator,
  events: PhotoEvent[],
  byPhoto: Map<string, string[]>,
  params: CaptionParams,
): Promise<Map<string, string>> {
  const captions = new Map<string, string>();
  const total = events.reduce((n, e) => n + e.photos.length, 0);
  const maxTimeouts = params.maxTimeouts ?? 2;
  let done = 0;
  let timeouts = 0;
  /** Passe à `false` quand le générateur a trop tardé : on ne l'attend plus. */
  let generatorAlive = true;
  /** Secours instantané : mieux vaut une légende de gabarit qu'une page nue. */
  const fallback = new TemplateCaptionGenerator();
  for (const event of events) {
    for (const sel of event.photos) {
      if (params.signal?.aborted) return captions;
      const photoId = sel.analysis.photo.id;
      const context = captionContextFor(sel, byPhoto, params, event.title);
      // La photo en cours est annoncée avant d'être traitée : sinon un blocage
      // ressemble à s'y méprendre à une étape terminée.
      params.onProgress?.({ stage: 'caption', done, total, current: done + 1, message: photoId });
      const startedAt = Date.now();
      let outcome: CaptionDiagnostic['outcome'] = 'ok';
      let failure: unknown;
      const keep = async (draft: CaptionDraft) => {
        captions.set(photoId, draft.text);
        await params.onCaption?.(photoId, draft);
      };
      if (!generatorAlive) {
        outcome = 'abandoned';
        await keep({ text: await fallback.generate({ context, style: params.style, variant: done }) });
      } else {
        // Le délai prévient aussi le générateur : `abort` lui donne l'occasion
        // d'interrompre proprement une génération partie trop loin.
        const timer = new AbortController();
        const relay = () => timer.abort();
        params.signal?.addEventListener('abort', relay);
        try {
          // `variant` fait tourner les tournures d'une photo à l'autre.
          const request = { context, style: params.style, variant: done, photo: sel.analysis.photo };
          // Un générateur qui sait rendre la description et les propositions le
          // fait ici : ce sont les mêmes appels de modèle, autant tout garder.
          const call = generator.draft
            ? generator.draft(request, timer.signal)
            : generator.generate(request, timer.signal).then((text) => ({ text }));
          const draft = await withTimeout(call, params.timeoutMs ?? 0, relay);
          if (draft.text) await keep(draft);
          else outcome = 'empty';
        } catch (e) {
          failure = e;
          if (e instanceof CaptionTimeout) {
            outcome = 'timeout';
            timeouts++;
            await keep({ text: await fallback.generate({ context, style: params.style, variant: done }) });
            // Inutile de perdre le même délai sur chaque photo restante.
            if (timeouts >= maxTimeouts) generatorAlive = false;
          } else {
            // Légende manquante : la page restera sans texte.
            outcome = 'error';
          }
        } finally {
          params.signal?.removeEventListener('abort', relay);
        }
      }
      done++;
      const elapsedMs = Date.now() - startedAt;
      params.onDiagnostic?.({ index: done, total, photoId, elapsedMs, outcome, ...(failure === undefined ? {} : { error: failure }) });
      params.onProgress?.({ stage: 'caption', done, total, elapsedMs });
    }
  }
  return captions;
}

export interface AssembleParams {
  title: string;
  subtitle?: string;
  locale: string;
  style: CaptionStyle;
  captionModel: string;
  selectedPeople: Set<string>;
  personNames: Map<string, string>;
  clusters: PersonCluster[];
  byPhoto: Map<string, string[]>;
  events: PhotoEvent[];
  captions: Map<string, string>;
  scoresById?: Map<string, number>;
  generator?: string;
  onProgress?: ProgressCallback;
}

/** Étape 5 : import des fichiers et assemblage de l'album au format. */
export async function assembleAlbum(importer: PhotoImporter, params: AssembleParams): Promise<Album> {
  const albumId = newId();
  const total = params.events.reduce((n, e) => n + e.photos.length, 0);
  let done = 0;
  const imported = new Map<string, Photo>();
  const personIds = new Map<string, string>(); // clusterId → personId du format
  for (const c of params.clusters) if (params.selectedPeople.has(c.id)) personIds.set(c.id, newId());

  for (const event of params.events) {
    for (const sel of event.photos) {
      const src = sel.analysis.photo;
      const files = await importer.importPhoto(albumId, src);
      const photo: Photo = {
        id: newId(),
        src: files.src,
        width: src.width,
        height: src.height,
        hash: sel.analysis.hash,
        score: sel.score.score,
      };
      if (files.thumb) photo.thumb = files.thumb;
      if (files.mimeType ?? src.mimeType) photo.mimeType = files.mimeType ?? src.mimeType;
      if (src.takenAt) photo.takenAt = src.takenAt;
      if (src.location) photo.location = src.location;
      photo.sourceUri = src.uri;
      if (sel.analysis.labels.length) photo.labels = sel.analysis.labels;
      const people = (params.byPhoto.get(src.id) ?? [])
        .map((cid) => personIds.get(cid))
        .filter((id): id is string => !!id);
      if (people.length) photo.people = people;
      imported.set(src.id, photo);
      done++;
      params.onProgress?.({ stage: 'build', done, total });
    }
  }

  const album = buildAlbum({
    title: params.title,
    subtitle: params.subtitle,
    locale: params.locale,
    captionStyle: params.style,
    captionModel: params.captionModel,
    selectedPeople: [...personIds.values()],
    generator: params.generator,
    events: eventsToBuildInput(params.events, (sel) => imported.get(sel.analysis.photo.id)!, params.captions),
  });
  album.id = albumId;

  const people: Person[] = [];
  for (const c of params.clusters) {
    const pid = personIds.get(c.id);
    if (!pid) continue;
    const person: Person = { id: pid, name: params.personNames.get(c.id) ?? c.id };
    const repPhoto = imported.get(c.representative.photoId);
    if (repPhoto) {
      person.referencePhotoId = repPhoto.id;
      const analysis = params.events.flatMap((e) => e.photos).find((s) => s.analysis.photo.id === c.representative.photoId);
      const rect = analysis?.analysis.faces[c.representative.faceIndex]?.rect;
      if (rect) person.referenceFaceRect = { ...rect };
    }
    people.push(person);
  }
  album.people = people;
  return album;
}
