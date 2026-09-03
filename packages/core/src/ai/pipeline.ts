import type { Album, CaptionStyle, Person, Photo } from '../album/types';
import { newId } from '../album/ids';
import type { DetectedFace, PersonCluster, PhotoAnalysis, RgbaImage, SourcePhoto } from './types';
import { computeQuality, toGray } from './quality';
import { dHash } from './phash';
import { clusterFaces, peopleByPhoto, type ClusterOptions } from './clustering';
import { scorePhotos, type PhotoScore, type ScoringWeights } from './scoring';
import { groupIntoEvents, selectPhotos, type PhotoEvent, type RejectedPhoto, type SelectedPhoto } from './selection';
import type { CaptionGenerator, CaptionContext } from './captions/types';
import { timeOfDayFromIso } from './captions/context';
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
}

/** Étape 3 : scoring et sélection des meilleures photos, regroupées en événements. */
export function selectBestPhotos(
  analyses: PhotoAnalysis[],
  clusters: PersonCluster[],
  params: SelectionParams,
): {
  selected: SelectedPhoto[];
  /** Photos écartées et motif, pour expliquer la sélection à l'utilisateur. */
  rejected: RejectedPhoto[];
  events: PhotoEvent[];
  byPhoto: Map<string, string[]>;
  scores: PhotoScore[];
} {
  const byPhoto = peopleByPhoto(clusters);
  const scores = scorePhotos(analyses, {
    selectedPeople: params.selectedPeople,
    peopleByPhoto: byPhoto,
    weights: params.weights,
    allowScenery: params.allowScenery,
  });
  const { selected, rejected } = selectPhotos(analyses, scores, { targetCount: params.targetCount });
  const events = groupIntoEvents(selected, params.eventGapHours, params.locale);
  return { selected, rejected, events, byPhoto, scores };
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

/** Étape 4 : légendes dans le style choisi. */
export async function generateCaptions(
  generator: CaptionGenerator,
  events: PhotoEvent[],
  byPhoto: Map<string, string[]>,
  params: CaptionParams,
): Promise<Map<string, string>> {
  const captions = new Map<string, string>();
  const total = events.reduce((n, e) => n + e.photos.length, 0);
  let done = 0;
  for (const event of events) {
    for (const sel of event.photos) {
      if (params.signal?.aborted) return captions;
      const context = captionContextFor(sel, byPhoto, params, event.title);
      try {
        // `variant` fait tourner les tournures d'une photo à l'autre.
        const text = await generator.generate({ context, style: params.style, variant: done }, params.signal);
        if (text) captions.set(sel.analysis.photo.id, text);
      } catch {
        // Légende manquante : la page restera sans texte.
      }
      done++;
      params.onProgress?.({ stage: 'caption', done, total });
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
