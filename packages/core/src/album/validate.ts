import type {
  Album,
  CaptionStyle,
  Page,
  PageSize,
  Person,
  Photo,
  Template,
  TemplateSlot,
  Theme,
  NormRect,
} from './types';
import { ALBUM_FORMAT, ALBUM_FORMAT_VERSION, CAPTION_STYLES } from './types';

export interface ValidationIssue {
  path: string;
  message: string;
}

export class AlbumValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Album invalide : ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    this.name = 'AlbumValidationError';
  }
}

type Ctx = { issues: ValidationIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function req<T>(ctx: Ctx, obj: Record<string, unknown>, key: string, path: string, pred: (v: unknown) => v is T, what: string): T | undefined {
  const v = obj[key];
  if (!pred(v)) {
    ctx.issues.push({ path: `${path}.${key}`, message: `${what} attendu` });
    return undefined;
  }
  return v;
}

function opt<T>(ctx: Ctx, obj: Record<string, unknown>, key: string, path: string, pred: (v: unknown) => v is T, what: string): T | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!pred(v)) {
    ctx.issues.push({ path: `${path}.${key}`, message: `${what} attendu` });
    return undefined;
  }
  return v;
}

function validateRect(ctx: Ctx, v: unknown, path: string): NormRect | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'rectangle attendu' });
    return undefined;
  }
  const x = req(ctx, v, 'x', path, isNum, 'nombre');
  const y = req(ctx, v, 'y', path, isNum, 'nombre');
  const w = req(ctx, v, 'w', path, isNum, 'nombre');
  const h = req(ctx, v, 'h', path, isNum, 'nombre');
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.000001 || y + h > 1.000001) {
    ctx.issues.push({ path, message: 'rectangle hors de la page (fractions 0..1 attendues)' });
  }
  return { x, y, w, h };
}

function validateSlot(ctx: Ctx, v: unknown, path: string): TemplateSlot | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'zone attendue' });
    return undefined;
  }
  const id = req(ctx, v, 'id', path, isStr, 'chaîne');
  const kind = v.kind;
  if (kind !== 'photo' && kind !== 'text') {
    ctx.issues.push({ path: `${path}.kind`, message: "'photo' ou 'text' attendu" });
  }
  const rect = validateRect(ctx, v.rect, `${path}.rect`);
  const align = v.align;
  if (align !== undefined && align !== 'left' && align !== 'center' && align !== 'right') {
    ctx.issues.push({ path: `${path}.align`, message: 'alignement inconnu' });
  }
  if (!id || !rect || (kind !== 'photo' && kind !== 'text')) return undefined;
  const slot: TemplateSlot = { id, kind, rect };
  if (align === 'left' || align === 'center' || align === 'right') slot.align = align;
  return slot;
}

function validateTemplate(ctx: Ctx, v: unknown, path: string): Template | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'gabarit attendu' });
    return undefined;
  }
  const id = req(ctx, v, 'id', path, isStr, 'chaîne');
  const name = req(ctx, v, 'name', path, isStr, 'chaîne');
  if (!Array.isArray(v.slots)) {
    ctx.issues.push({ path: `${path}.slots`, message: 'tableau attendu' });
    return undefined;
  }
  const slots: TemplateSlot[] = [];
  const seen = new Set<string>();
  v.slots.forEach((s, i) => {
    const slot = validateSlot(ctx, s, `${path}.slots[${i}]`);
    if (slot) {
      if (seen.has(slot.id)) ctx.issues.push({ path: `${path}.slots[${i}].id`, message: 'id de zone dupliqué' });
      seen.add(slot.id);
      slots.push(slot);
    }
  });
  if (!id || !name) return undefined;
  return { id, name, slots, photoCount: slots.filter((s) => s.kind === 'photo').length };
}

function validatePageSize(ctx: Ctx, v: unknown, path: string): PageSize | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'format de page attendu' });
    return undefined;
  }
  const width = req(ctx, v, 'width', path, isNum, 'nombre');
  const height = req(ctx, v, 'height', path, isNum, 'nombre');
  const unit = v.unit;
  if (unit !== 'mm' && unit !== 'in' && unit !== 'px') {
    ctx.issues.push({ path: `${path}.unit`, message: "'mm', 'in' ou 'px' attendu" });
    return undefined;
  }
  const bleed = opt(ctx, v, 'bleed', path, isNum, 'nombre');
  if (width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) ctx.issues.push({ path, message: 'dimensions positives attendues' });
  const ps: PageSize = { width, height, unit };
  if (bleed !== undefined) ps.bleed = bleed;
  return ps;
}

function validatePhoto(ctx: Ctx, v: unknown, path: string): Photo | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'photo attendue' });
    return undefined;
  }
  const id = req(ctx, v, 'id', path, isStr, 'chaîne');
  const src = req(ctx, v, 'src', path, isStr, 'chaîne');
  const width = req(ctx, v, 'width', path, isNum, 'nombre');
  const height = req(ctx, v, 'height', path, isNum, 'nombre');
  if (src && (src.startsWith('/') || src.includes('..'))) {
    ctx.issues.push({ path: `${path}.src`, message: 'chemin relatif au bundle attendu' });
  }
  if (!id || !src || width === undefined || height === undefined) return undefined;
  const p: Photo = { id, src, width, height };
  const thumb = opt(ctx, v, 'thumb', path, isStr, 'chaîne');
  if (thumb) p.thumb = thumb;
  const mime = opt(ctx, v, 'mimeType', path, isStr, 'chaîne');
  if (mime) p.mimeType = mime;
  const takenAt = opt(ctx, v, 'takenAt', path, isStr, 'chaîne');
  if (takenAt) p.takenAt = takenAt;
  const sourceUri = opt(ctx, v, 'sourceUri', path, isStr, 'chaîne');
  if (sourceUri) p.sourceUri = sourceUri;
  const hash = opt(ctx, v, 'hash', path, isStr, 'chaîne');
  if (hash) p.hash = hash;
  const score = opt(ctx, v, 'score', path, isNum, 'nombre');
  if (score !== undefined) p.score = score;
  if (isObj(v.location)) {
    const lat = req(ctx, v.location, 'latitude', `${path}.location`, isNum, 'nombre');
    const lon = req(ctx, v.location, 'longitude', `${path}.location`, isNum, 'nombre');
    if (lat !== undefined && lon !== undefined) p.location = { latitude: lat, longitude: lon };
  }
  if (Array.isArray(v.people)) p.people = v.people.filter(isStr);
  if (Array.isArray(v.labels)) p.labels = v.labels.filter(isStr);
  return p;
}

function validatePerson(ctx: Ctx, v: unknown, path: string): Person | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'personne attendue' });
    return undefined;
  }
  const id = req(ctx, v, 'id', path, isStr, 'chaîne');
  const name = req(ctx, v, 'name', path, isStr, 'chaîne');
  if (!id || name === undefined) return undefined;
  const person: Person = { id, name };
  const ref = opt(ctx, v, 'referencePhotoId', path, isStr, 'chaîne');
  if (ref) person.referencePhotoId = ref;
  if (v.referenceFaceRect !== undefined) {
    const r = validateRect(ctx, v.referenceFaceRect, `${path}.referenceFaceRect`);
    if (r) person.referenceFaceRect = r;
  }
  return person;
}

function validatePage(
  ctx: Ctx,
  v: unknown,
  path: string,
  templates: Map<string, Template>,
  photoIds: Set<string>,
): Page | undefined {
  if (!isObj(v)) {
    ctx.issues.push({ path, message: 'page attendue' });
    return undefined;
  }
  const id = req(ctx, v, 'id', path, isStr, 'chaîne');
  const templateId = req(ctx, v, 'templateId', path, isStr, 'chaîne');
  const template = templateId ? templates.get(templateId) : undefined;
  if (templateId && !template) {
    ctx.issues.push({ path: `${path}.templateId`, message: `gabarit inconnu « ${templateId} »` });
  }
  const photos: Page['photos'] = {};
  const texts: Page['texts'] = {};
  const rawPhotos = v.photos ?? {};
  const rawTexts = v.texts ?? {};
  if (!isObj(rawPhotos)) ctx.issues.push({ path: `${path}.photos`, message: 'objet attendu' });
  else {
    for (const [slotId, pl] of Object.entries(rawPhotos)) {
      const p = `${path}.photos.${slotId}`;
      if (!isObj(pl)) {
        ctx.issues.push({ path: p, message: 'placement attendu' });
        continue;
      }
      const slot = template?.slots.find((s) => s.id === slotId);
      if (template && !slot) ctx.issues.push({ path: p, message: 'zone inconnue dans le gabarit' });
      else if (slot && slot.kind !== 'photo') ctx.issues.push({ path: p, message: "la zone n'est pas une zone photo" });
      const photoId = req(ctx, pl, 'photoId', p, isStr, 'chaîne');
      if (photoId && !photoIds.has(photoId)) ctx.issues.push({ path: `${p}.photoId`, message: `photo inconnue « ${photoId} »` });
      const tr = isObj(pl.transform) ? pl.transform : {};
      const scale = isNum(tr.scale) ? tr.scale : 1;
      const offsetX = isNum(tr.offsetX) ? tr.offsetX : 0;
      const offsetY = isNum(tr.offsetY) ? tr.offsetY : 0;
      const rotation = isNum(tr.rotation) ? tr.rotation : 0;
      if (scale < 1) ctx.issues.push({ path: `${p}.transform.scale`, message: 'scale >= 1 attendu' });
      if (Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1) ctx.issues.push({ path: `${p}.transform`, message: 'offsets dans [-1, 1] attendus' });
      if (photoId) photos[slotId] = { photoId, transform: { scale, offsetX, offsetY, rotation } };
    }
  }
  if (!isObj(rawTexts)) ctx.issues.push({ path: `${path}.texts`, message: 'objet attendu' });
  else {
    for (const [slotId, tc] of Object.entries(rawTexts)) {
      const p = `${path}.texts.${slotId}`;
      if (!isObj(tc)) {
        ctx.issues.push({ path: p, message: 'texte attendu' });
        continue;
      }
      const slot = template?.slots.find((s) => s.id === slotId);
      if (template && !slot) ctx.issues.push({ path: p, message: 'zone inconnue dans le gabarit' });
      else if (slot && slot.kind !== 'text') ctx.issues.push({ path: p, message: "la zone n'est pas une zone texte" });
      const textValue = req(ctx, tc, 'text', p, isStr, 'chaîne');
      if (textValue === undefined) continue;
      const role = tc.role;
      const entry: Page['texts'][string] = { text: textValue };
      if (role === 'caption' || role === 'title' || role === 'subtitle' || role === 'body') entry.role = role;
      texts[slotId] = entry;
    }
  }
  if (!id || !templateId) return undefined;
  const page: Page = { id, templateId, photos, texts };
  const bg = opt(ctx, v, 'background', path, isStr, 'chaîne');
  if (bg) page.background = bg;
  return page;
}

/**
 * Valide un objet JSON déjà parsé et renvoie un `Album` normalisé
 * (champs optionnels absents plutôt que `null`, transformations complétées).
 * Lève `AlbumValidationError` en cas de problème bloquant.
 */
export function validateAlbum(input: unknown): Album {
  const ctx: Ctx = { issues: [] };
  if (!isObj(input)) throw new AlbumValidationError([{ path: '$', message: 'objet attendu' }]);
  const root = '$';
  if (input.format !== ALBUM_FORMAT) ctx.issues.push({ path: '$.format', message: `« ${ALBUM_FORMAT} » attendu` });
  const formatVersion = req(ctx, input, 'formatVersion', root, isNum, 'nombre');
  if (formatVersion !== undefined && formatVersion > ALBUM_FORMAT_VERSION) {
    ctx.issues.push({ path: '$.formatVersion', message: `version ${formatVersion} plus récente que la version supportée (${ALBUM_FORMAT_VERSION})` });
  }
  const id = req(ctx, input, 'id', root, isStr, 'chaîne');
  const title = req(ctx, input, 'title', root, isStr, 'chaîne');
  const locale = opt(ctx, input, 'locale', root, isStr, 'chaîne') ?? 'fr-FR';
  const createdAt = opt(ctx, input, 'createdAt', root, isStr, 'chaîne') ?? new Date(0).toISOString();
  const updatedAt = opt(ctx, input, 'updatedAt', root, isStr, 'chaîne') ?? createdAt;
  const generator = opt(ctx, input, 'generator', root, isStr, 'chaîne');
  const page = validatePageSize(ctx, input.page, '$.page');

  const theme: Theme = { background: '#ffffff' };
  if (isObj(input.theme)) {
    const bg = opt(ctx, input.theme, 'background', '$.theme', isStr, 'chaîne');
    if (bg) theme.background = bg;
    const ff = opt(ctx, input.theme, 'fontFamily', '$.theme', isStr, 'chaîne');
    if (ff) theme.fontFamily = ff;
    const tc = opt(ctx, input.theme, 'textColor', '$.theme', isStr, 'chaîne');
    if (tc) theme.textColor = tc;
    const gutter = opt(ctx, input.theme, 'gutter', '$.theme', isNum, 'nombre');
    if (gutter !== undefined) theme.gutter = gutter;
  }

  const templates: Template[] = [];
  const templateMap = new Map<string, Template>();
  if (!Array.isArray(input.templates)) ctx.issues.push({ path: '$.templates', message: 'tableau attendu' });
  else
    input.templates.forEach((t, i) => {
      const tpl = validateTemplate(ctx, t, `$.templates[${i}]`);
      if (tpl) {
        if (templateMap.has(tpl.id)) ctx.issues.push({ path: `$.templates[${i}].id`, message: 'id de gabarit dupliqué' });
        templateMap.set(tpl.id, tpl);
        templates.push(tpl);
      }
    });

  const photos: Photo[] = [];
  const photoIds = new Set<string>();
  if (!Array.isArray(input.photos)) ctx.issues.push({ path: '$.photos', message: 'tableau attendu' });
  else
    input.photos.forEach((p, i) => {
      const ph = validatePhoto(ctx, p, `$.photos[${i}]`);
      if (ph) {
        if (photoIds.has(ph.id)) ctx.issues.push({ path: `$.photos[${i}].id`, message: 'id de photo dupliqué' });
        photoIds.add(ph.id);
        photos.push(ph);
      }
    });

  const people: Person[] = [];
  if (input.people !== undefined) {
    if (!Array.isArray(input.people)) ctx.issues.push({ path: '$.people', message: 'tableau attendu' });
    else
      input.people.forEach((p, i) => {
        const person = validatePerson(ctx, p, `$.people[${i}]`);
        if (person) people.push(person);
      });
  }
  const personIds = new Set(people.map((p) => p.id));
  photos.forEach((p, i) => {
    p.people?.forEach((pid) => {
      if (!personIds.has(pid)) ctx.issues.push({ path: `$.photos[${i}].people`, message: `personne inconnue « ${pid} »` });
    });
  });

  const pages: Page[] = [];
  if (!Array.isArray(input.pages)) ctx.issues.push({ path: '$.pages', message: 'tableau attendu' });
  else
    input.pages.forEach((p, i) => {
      const pg = validatePage(ctx, p, `$.pages[${i}]`, templateMap, photoIds);
      if (pg) pages.push(pg);
    });

  let ai: Album['ai'];
  if (isObj(input.ai)) {
    ai = {};
    const style = input.ai.captionStyle;
    if (style !== undefined) {
      if (isStr(style) && (CAPTION_STYLES as readonly string[]).includes(style)) ai.captionStyle = style as CaptionStyle;
      else ctx.issues.push({ path: '$.ai.captionStyle', message: 'style de légende inconnu' });
    }
    const model = opt(ctx, input.ai, 'captionModel', '$.ai', isStr, 'chaîne');
    if (model) ai.captionModel = model;
    const gen = opt(ctx, input.ai, 'generatedAt', '$.ai', isStr, 'chaîne');
    if (gen) ai.generatedAt = gen;
    if (Array.isArray(input.ai.selectedPeople)) ai.selectedPeople = input.ai.selectedPeople.filter(isStr);
  }

  if (ctx.issues.length > 0 || !id || title === undefined || !page || formatVersion === undefined) {
    throw new AlbumValidationError(ctx.issues.length ? ctx.issues : [{ path: '$', message: 'album incomplet' }]);
  }

  const album: Album = {
    format: ALBUM_FORMAT,
    formatVersion,
    id,
    title,
    locale,
    createdAt,
    updatedAt,
    page,
    theme,
    templates,
    photos,
    people,
    pages,
  };
  if (generator) album.generator = generator;
  if (ai) album.ai = ai;
  return album;
}
