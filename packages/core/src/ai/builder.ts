import type { Album, CaptionStyle, Photo, Template } from '../album/types';
import { addPage, createAlbum, ensureTemplate, placePhoto, setText, upsertPhoto } from '../album/album';
import { BUILTIN_TEMPLATES, photoSlots, textSlots } from '../album/templates';
import type { PhotoEvent, SelectedPhoto } from './selection';
import { nowIso } from '../album/ids';

export interface BuiltPhotoRef {
  /** Photo de l'album (déjà copiée / référencée dans le bundle). */
  photo: Photo;
  caption?: string;
}

export interface BuildAlbumOptions {
  title: string;
  subtitle?: string;
  locale?: string;
  captionStyle?: CaptionStyle;
  captionModel?: string;
  selectedPeople?: string[];
  /** Événements dans l'ordre, chaque photo avec sa légende. */
  events: { title: string; photos: BuiltPhotoRef[] }[];
  /** Insérer une page de chapitre entre les événements (si plusieurs). */
  chapterPages?: boolean;
  /** Priorité aux mises en page avec légende. */
  withCaptions?: boolean;
  generator?: string;
}

const isPortrait = (p: Photo): boolean => p.height > p.width;

/**
 * Choisit un gabarit pour un groupe de 1 à 4 photos selon leurs orientations.
 * Renvoie l'id d'un gabarit intégré.
 */
export function pickTemplate(group: Photo[], withCaptions: boolean): string {
  const portraits = group.filter(isPortrait).length;
  switch (group.length) {
    case 1:
      return withCaptions ? 'single-caption' : 'single';
    case 2:
      if (withCaptions) return 'two-caption';
      return portraits === 2 ? 'two-columns' : 'two-rows';
    case 3:
      return withCaptions ? 'three-caption' : 'one-plus-two';
    default:
      return 'grid-2x2';
  }
}

/**
 * Découpe une liste de photos en groupes de tailles variées (1 à 4) pour un
 * rythme de page agréable ; déterministe.
 */
export function chunkForPages(count: number): number[] {
  const pattern = [1, 2, 3, 1, 4, 2];
  const out: number[] = [];
  let remaining = count;
  let i = 0;
  while (remaining > 0) {
    const n = Math.min(pattern[i % pattern.length]!, remaining);
    out.push(n);
    remaining -= n;
    i++;
  }
  return out;
}

/** Assemble un album complet (couverture, chapitres, pages) à partir de photos sélectionnées. */
export function buildAlbum(opts: BuildAlbumOptions): Album {
  const withCaptions = opts.withCaptions ?? true;
  const album = createAlbum({ title: opts.title, locale: opts.locale, generator: opts.generator });
  const allPhotos = opts.events.flatMap((e) => e.photos);
  for (const ref of allPhotos) upsertPhoto(album, ref.photo);

  // Couverture : meilleure photo (score) ou première.
  const coverRef = [...allPhotos].sort((a, b) => (b.photo.score ?? 0) - (a.photo.score ?? 0))[0];
  if (coverRef) {
    const cover = addPage(album, 'cover');
    placePhoto(album, cover.id, 'p1', coverRef.photo.id);
    setText(album, cover.id, 'title', { text: opts.title, role: 'title' });
    if (opts.subtitle) setText(album, cover.id, 'subtitle', { text: opts.subtitle, role: 'subtitle' });
  }

  const multi = opts.events.length > 1 && (opts.chapterPages ?? true);
  for (const event of opts.events) {
    if (multi) {
      const chapter = addPage(album, 'chapter');
      setText(album, chapter.id, 'title', { text: event.title, role: 'title' });
    }
    const sizes = chunkForPages(event.photos.length);
    let cursor = 0;
    for (const n of sizes) {
      const group = event.photos.slice(cursor, cursor + n);
      cursor += n;
      const templateId = pickTemplate(group.map((g) => g.photo), withCaptions);
      const template: Template = ensureTemplate(album, templateId);
      const page = addPage(album, templateId);
      const slots = photoSlots(template);
      group.forEach((ref, i) => {
        const slot = slots[i];
        if (slot) placePhoto(album, page.id, slot.id, ref.photo.id);
      });
      const caption = group.map((g) => g.caption).filter((c): c is string => !!c);
      const tSlot = textSlots(template)[0];
      if (tSlot && caption.length) {
        setText(album, page.id, tSlot.id, { text: caption.join(' · '), role: 'caption' });
      }
    }
  }

  album.ai = {
    generatedAt: nowIso(),
    ...(opts.captionStyle ? { captionStyle: opts.captionStyle } : {}),
    ...(opts.captionModel ? { captionModel: opts.captionModel } : {}),
    ...(opts.selectedPeople ? { selectedPeople: opts.selectedPeople } : {}),
  };
  return album;
}

/** Utilitaire : transforme des événements de sélection en entrée du builder. */
export function eventsToBuildInput(
  events: PhotoEvent[],
  toPhoto: (sel: SelectedPhoto) => Photo,
  captions: Map<string, string>,
): BuildAlbumOptions['events'] {
  return events.map((e) => ({
    title: e.title,
    photos: e.photos.map((sel) => {
      const photo = toPhoto(sel);
      const caption = captions.get(sel.analysis.photo.id);
      return caption ? { photo, caption } : { photo };
    }),
  }));
}

export { BUILTIN_TEMPLATES };
