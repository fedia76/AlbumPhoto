import type { NormRect, PageSize, PhotoTransform, TemplateSlot } from './types';
import { IDENTITY_TRANSFORM } from './types';

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Ramène une transformation dans les bornes du format. */
export function clampTransform(t: Partial<PhotoTransform> | undefined): PhotoTransform {
  const scale = clamp(Number.isFinite(t?.scale) ? (t!.scale as number) : 1, MIN_SCALE, MAX_SCALE);
  const rotation = Number.isFinite(t?.rotation) ? (t!.rotation as number) : 0;
  return {
    scale,
    offsetX: clamp(Number.isFinite(t?.offsetX) ? (t!.offsetX as number) : 0, -1, 1),
    offsetY: clamp(Number.isFinite(t?.offsetY) ? (t!.offsetY as number) : 0, -1, 1),
    rotation: ((rotation % 360) + 360) % 360,
  };
}

/** Rectangle d'une zone en unités physiques de la page (mm, in ou px). */
export function slotRectInPageUnits(slot: TemplateSlot, page: PageSize): NormRect {
  return {
    x: slot.rect.x * page.width,
    y: slot.rect.y * page.height,
    w: slot.rect.w * page.width,
    h: slot.rect.h * page.height,
  };
}

/** Aspect (largeur / hauteur) d'une zone, compte tenu des proportions réelles de la page. */
export function slotAspect(slot: TemplateSlot, page: PageSize): number {
  const r = slotRectInPageUnits(slot, page);
  return r.h === 0 ? 1 : r.w / r.h;
}

/**
 * Fraction visible de la photo (largeur, hauteur) en mode « cover » puis zoom.
 * Les valeurs sont dans (0, 1].
 */
export function visibleFraction(
  photoAspect: number,
  slotAspectRatio: number,
  scale: number,
): { w: number; h: number } {
  const s = clamp(scale, MIN_SCALE, MAX_SCALE);
  if (photoAspect >= slotAspectRatio) {
    // Photo plus large que la zone : la hauteur remplit, on rogne la largeur.
    return { w: slotAspectRatio / photoAspect / s, h: 1 / s };
  }
  return { w: 1 / s, h: photoAspect / slotAspectRatio / s };
}

/**
 * Rectangle source (normalisé dans la photo) visible dans la zone.
 *
 * C'est LA fonction de référence du format : tout moteur de rendu doit
 * dessiner `cropRect` de la photo dans le rectangle de la zone. La rotation
 * n'est pas prise en compte ici (voir `transform.rotation`, réservé).
 */
export function computeCropRect(
  photoWidth: number,
  photoHeight: number,
  slot: TemplateSlot,
  page: PageSize,
  transform: PhotoTransform = IDENTITY_TRANSFORM,
): NormRect {
  const t = clampTransform(transform);
  const photoAspect = photoHeight === 0 ? 1 : photoWidth / photoHeight;
  const { w, h } = visibleFraction(photoAspect, slotAspect(slot, page), t.scale);
  const cx = 0.5 + (t.offsetX * (1 - w)) / 2;
  const cy = 0.5 + (t.offsetY * (1 - h)) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Convertit un déplacement en pixels-écran de la zone en delta d'offset.
 *
 * `slotPxW`/`slotPxH` : dimensions affichées de la zone. Faire glisser la photo
 * de toute la largeur cachée doit faire passer l'offset de -1 à 1.
 */
export function panToOffsetDelta(
  dxPx: number,
  dyPx: number,
  slotPxW: number,
  slotPxH: number,
  photoWidth: number,
  photoHeight: number,
  slot: TemplateSlot,
  page: PageSize,
  scale: number,
): { dOffsetX: number; dOffsetY: number } {
  const photoAspect = photoHeight === 0 ? 1 : photoWidth / photoHeight;
  const { w, h } = visibleFraction(photoAspect, slotAspect(slot, page), scale);
  // Largeur totale de la photo affichée, en px : slotPxW / w. Partie cachée : (1 - w) * (slotPxW / w).
  const hiddenW = ((1 - w) * slotPxW) / w;
  const hiddenH = ((1 - h) * slotPxH) / h;
  // Glisser la photo vers la droite (dx > 0) montre le côté gauche → offset diminue.
  return {
    dOffsetX: hiddenW <= 0 ? 0 : (-dxPx / hiddenW) * 2,
    dOffsetY: hiddenH <= 0 ? 0 : (-dyPx / hiddenH) * 2,
  };
}

/**
 * Applique un zoom autour du centre de la zone en conservant le point focal
 * approximatif : l'offset est inchangé (il est exprimé relativement à la
 * partie cachée), ce qui donne un comportement stable sous les doigts.
 */
export function applyZoom(transform: PhotoTransform, factor: number): PhotoTransform {
  return clampTransform({ ...transform, scale: transform.scale * factor });
}

/** Rectangle en pixels-écran d'une zone pour une page affichée en `pagePxW`×`pagePxH`. */
export function slotRectInPixels(slot: TemplateSlot, pagePxW: number, pagePxH: number): NormRect {
  return {
    x: slot.rect.x * pagePxW,
    y: slot.rect.y * pagePxH,
    w: slot.rect.w * pagePxW,
    h: slot.rect.h * pagePxH,
  };
}

/**
 * Transformation d'affichage de la photo dans une zone affichée en pixels :
 * la photo, redimensionnée à `imgW`×`imgH`, doit être translatée de (`left`, `top`)
 * par rapport au coin haut-gauche de la zone.
 */
export function imageLayoutInSlot(
  photoWidth: number,
  photoHeight: number,
  slot: TemplateSlot,
  page: PageSize,
  transform: PhotoTransform,
  slotPxW: number,
  slotPxH: number,
): { imgW: number; imgH: number; left: number; top: number } {
  const crop = computeCropRect(photoWidth, photoHeight, slot, page, transform);
  const imgW = slotPxW / crop.w;
  const imgH = slotPxH / crop.h;
  return { imgW, imgH, left: -crop.x * imgW, top: -crop.y * imgH };
}
