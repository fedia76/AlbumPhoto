import { newId, nowIso } from './ids';
import { BUILTIN_TEMPLATES, cloneTemplate, getBuiltinTemplate, photoSlots } from './templates';
import type {
  Album,
  CaptionOption,
  Page,
  PageSize,
  Photo,
  PhotoTransform,
  Template,
  TextContent,
  Theme,
} from './types';
import { ALBUM_FORMAT, ALBUM_FORMAT_VERSION, IDENTITY_TRANSFORM } from './types';
import { clampTransform } from './geometry';
import { validateAlbum } from './validate';

export const DEFAULT_PAGE_SIZE: Readonly<PageSize> = Object.freeze({
  width: 210,
  height: 210,
  unit: 'mm',
  bleed: 3,
});

export const DEFAULT_THEME: Readonly<Theme> = Object.freeze({
  background: '#ffffff',
  textColor: '#222222',
  fontFamily: 'System',
});

export interface CreateAlbumOptions {
  title: string;
  id?: string;
  locale?: string;
  page?: PageSize;
  theme?: Theme;
  generator?: string;
}

/** Crée un album vide (aucune page). */
export function createAlbum(opts: CreateAlbumOptions): Album {
  const ts = nowIso();
  const album: Album = {
    format: ALBUM_FORMAT,
    formatVersion: ALBUM_FORMAT_VERSION,
    id: opts.id ?? newId(),
    title: opts.title,
    locale: opts.locale ?? 'fr-FR',
    createdAt: ts,
    updatedAt: ts,
    page: { ...(opts.page ?? DEFAULT_PAGE_SIZE) },
    theme: { ...(opts.theme ?? DEFAULT_THEME) },
    templates: [],
    photos: [],
    people: [],
    pages: [],
  };
  if (opts.generator) album.generator = opts.generator;
  return album;
}

/** Sérialise un album en JSON (indenté, clés stables). */
export function serializeAlbum(album: Album): string {
  return JSON.stringify(album, null, 2) + '\n';
}

/** Parse et valide un manifeste `album.json`. */
export function parseAlbum(json: string): Album {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`album.json illisible : ${(e as Error).message}`);
  }
  return validateAlbum(raw);
}

/** Copie profonde (le format est du JSON pur). */
export function cloneAlbum(album: Album): Album {
  return JSON.parse(JSON.stringify(album)) as Album;
}

export function touch(album: Album): Album {
  album.updatedAt = nowIso();
  return album;
}

/** Garantit que le gabarit est embarqué dans l'album ; renvoie le gabarit. */
export function ensureTemplate(album: Album, templateOrId: Template | string): Template {
  const id = typeof templateOrId === 'string' ? templateOrId : templateOrId.id;
  const existing = album.templates.find((t) => t.id === id);
  if (existing) return existing;
  const source = typeof templateOrId === 'string' ? getBuiltinTemplate(templateOrId) : templateOrId;
  if (!source) throw new Error(`Gabarit inconnu : ${id}`);
  const copy = cloneTemplate(source);
  album.templates.push(copy);
  return copy;
}

export function getTemplate(album: Album, id: string): Template | undefined {
  return album.templates.find((t) => t.id === id) ?? getBuiltinTemplate(id);
}

export function getPhoto(album: Album, id: string): Photo | undefined {
  return album.photos.find((p) => p.id === id);
}

export function getPage(album: Album, id: string): Page | undefined {
  return album.pages.find((p) => p.id === id);
}

/** Ajoute (ou remplace) une photo dans la bibliothèque de l'album. */
export function upsertPhoto(album: Album, photo: Photo): Photo {
  const idx = album.photos.findIndex((p) => p.id === photo.id);
  if (idx >= 0) album.photos[idx] = photo;
  else album.photos.push(photo);
  touch(album);
  return photo;
}

/** Ajoute une page vide utilisant `templateId` à la position `index` (fin par défaut). */
export function addPage(album: Album, templateId: string, index?: number): Page {
  ensureTemplate(album, templateId);
  const page: Page = { id: newId(), templateId, photos: {}, texts: {} };
  if (index === undefined || index >= album.pages.length) album.pages.push(page);
  else album.pages.splice(Math.max(0, index), 0, page);
  touch(album);
  return page;
}

export function removePage(album: Album, pageId: string): void {
  album.pages = album.pages.filter((p) => p.id !== pageId);
  touch(album);
}

export function movePage(album: Album, pageId: string, toIndex: number): void {
  const from = album.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return;
  const [page] = album.pages.splice(from, 1);
  album.pages.splice(Math.max(0, Math.min(toIndex, album.pages.length)), 0, page!);
  touch(album);
}

/**
 * Change le gabarit d'une page en conservant les photos : elles sont
 * réaffectées dans l'ordre aux zones photo du nouveau gabarit ; les photos en
 * surplus sont retirées de la page (elles restent dans la bibliothèque).
 */
export function changePageTemplate(album: Album, pageId: string, templateId: string): Page {
  const page = getPage(album, pageId);
  if (!page) throw new Error(`Page inconnue : ${pageId}`);
  const oldTemplate = getTemplate(album, page.templateId);
  const newTemplate = ensureTemplate(album, templateId);
  const orderedPlacements = oldTemplate
    ? photoSlots(oldTemplate).map((s) => page.photos[s.id]).filter((p): p is NonNullable<typeof p> => !!p)
    : Object.values(page.photos);
  const photos: Page['photos'] = {};
  photoSlots(newTemplate).forEach((slot, i) => {
    const pl = orderedPlacements[i];
    if (pl) photos[slot.id] = { photoId: pl.photoId, transform: { ...IDENTITY_TRANSFORM } };
  });
  const texts: Page['texts'] = {};
  const oldTexts = Object.values(page.texts);
  newTemplate.slots
    .filter((s) => s.kind === 'text')
    .forEach((slot, i) => {
      const existing = page.texts[slot.id] ?? oldTexts[i];
      if (existing) texts[slot.id] = { ...existing };
    });
  page.templateId = templateId;
  page.photos = photos;
  page.texts = texts;
  touch(album);
  return page;
}

/** Place une photo dans une zone (remplace le contenu précédent). */
export function placePhoto(
  album: Album,
  pageId: string,
  slotId: string,
  photoId: string,
  transform: Partial<PhotoTransform> = {},
): void {
  const page = getPage(album, pageId);
  if (!page) throw new Error(`Page inconnue : ${pageId}`);
  const template = getTemplate(album, page.templateId);
  const slot = template?.slots.find((s) => s.id === slotId);
  if (!slot || slot.kind !== 'photo') throw new Error(`Zone photo inconnue : ${slotId}`);
  if (!getPhoto(album, photoId)) throw new Error(`Photo inconnue : ${photoId}`);
  page.photos[slotId] = { photoId, transform: clampTransform({ ...IDENTITY_TRANSFORM, ...transform }) };
  touch(album);
}

export function clearSlot(album: Album, pageId: string, slotId: string): void {
  const page = getPage(album, pageId);
  if (!page) return;
  delete page.photos[slotId];
  delete page.texts[slotId];
  touch(album);
}

/** Met à jour la transformation (zoom / déplacement) d'une photo placée. */
export function updateTransform(
  album: Album,
  pageId: string,
  slotId: string,
  patch: Partial<PhotoTransform>,
): PhotoTransform {
  const page = getPage(album, pageId);
  const pl = page?.photos[slotId];
  if (!page || !pl) throw new Error(`Aucune photo dans la zone ${slotId}`);
  pl.transform = clampTransform({ ...pl.transform, ...patch });
  touch(album);
  return pl.transform;
}

export function setText(album: Album, pageId: string, slotId: string, content: TextContent): void {
  const page = getPage(album, pageId);
  if (!page) throw new Error(`Page inconnue : ${pageId}`);
  const template = getTemplate(album, page.templateId);
  const slot = template?.slots.find((s) => s.id === slotId);
  if (!slot || slot.kind !== 'text') throw new Error(`Zone texte inconnue : ${slotId}`);
  page.texts[slotId] = { ...content };
  touch(album);
}

/**
 * Repose les légendes d'un album déjà assemblé, à partir des textes par photo.
 *
 * Sert à écrire les légendes après coup : l'album est ouvert immédiatement avec
 * des légendes de gabarit, qu'un modèle remplace ensuite une par une. Seules
 * les zones portant déjà une légende sont touchées — jamais un titre, jamais
 * une zone que l'utilisateur a remplie autrement. Une page peut réunir
 * plusieurs photos : leurs légendes sont alors jointes comme à l'assemblage.
 *
 * @param captions - Légende par identifiant de photo *de l'album*.
 * @param protectedText - Textes à ne pas écraser (une retouche manuelle).
 * @returns Le nombre de zones effectivement modifiées.
 */
export function applyPhotoCaptions(album: Album, captions: Map<string, string>, protectedText?: (text: string) => boolean): number {
  let changed = 0;
  for (const page of album.pages) {
    const template = getTemplate(album, page.templateId);
    if (!template) continue;
    const slot = template.slots.find((s) => s.kind === 'text' && page.texts[s.id]?.role === 'caption');
    if (!slot) continue;
    const current = page.texts[slot.id];
    if (current && protectedText?.(current.text)) continue;
    const parts = template.slots
      .filter((s) => s.kind === 'photo')
      .map((s) => page.photos[s.id]?.photoId)
      .filter((id): id is string => !!id)
      .map((id) => captions.get(id))
      .filter((text): text is string => !!text);
    if (!parts.length) continue;
    const text = parts.join(' · ');
    if (current?.text === text) continue;
    page.texts[slot.id] = { ...current, text, role: 'caption' };
    changed++;
  }
  if (changed) touch(album);
  return changed;
}

/**
 * Repose les légendes *et* ce qui a servi à les écrire : la description de la
 * photo et les propositions restent dans l'album, consultables et
 * interchangeables sans relancer le moindre modèle.
 *
 * @returns Le nombre de zones de texte modifiées.
 */
export function applyPhotoDrafts(
  album: Album,
  drafts: Map<string, { text: string; description?: string; options?: CaptionOption[] }>,
  protectedText?: (text: string) => boolean,
): number {
  for (const [photoId, draft] of drafts) {
    const photo = getPhoto(album, photoId);
    if (!photo) continue;
    if (draft.description) photo.description = draft.description;
    if (draft.options?.length) photo.captionOptions = draft.options;
  }
  const captions = new Map([...drafts].map(([photoId, draft]) => [photoId, draft.text]));
  return applyPhotoCaptions(album, captions, protectedText);
}

/** Photos de la bibliothèque non utilisées par aucune page. */
export function unusedPhotos(album: Album): Photo[] {
  const used = new Set<string>();
  album.pages.forEach((pg) => Object.values(pg.photos).forEach((pl) => used.add(pl.photoId)));
  return album.photos.filter((p) => !used.has(p.id));
}

/** Supprime les gabarits embarqués qui ne sont plus référencés. */
export function pruneTemplates(album: Album): void {
  const used = new Set(album.pages.map((p) => p.templateId));
  album.templates = album.templates.filter((t) => used.has(t.id));
}

export { BUILTIN_TEMPLATES };
