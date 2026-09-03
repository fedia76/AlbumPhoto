import type { Template, TemplateSlot } from './types';

const G = 0.04; // marge extérieure (fraction de page)
const GAP = 0.03; // espace entre zones

const photo = (id: string, x: number, y: number, w: number, h: number): TemplateSlot => ({
  id,
  kind: 'photo',
  rect: { x, y, w, h },
});
const text = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  align: TemplateSlot['align'] = 'center',
): TemplateSlot => ({ id, kind: 'text', rect: { x, y, w, h }, align });

function make(id: string, name: string, slots: TemplateSlot[]): Template {
  return { id, name, slots, photoCount: slots.filter((s) => s.kind === 'photo').length };
}

/**
 * Gabarits intégrés. Ils sont copiés dans chaque album qui les utilise afin
 * que le fichier reste autonome (un renderer inconnu n'a pas besoin de cette liste).
 */
export const BUILTIN_TEMPLATES: readonly Template[] = Object.freeze([
  make('cover', 'Couverture', [
    photo('p1', G, G, 1 - 2 * G, 0.72),
    text('title', G, 0.78, 1 - 2 * G, 0.1, 'center'),
    text('subtitle', G, 0.88, 1 - 2 * G, 0.06, 'center'),
  ]),
  make('full-bleed', 'Pleine page', [photo('p1', 0, 0, 1, 1)]),
  make('single', 'Une photo', [photo('p1', G, G, 1 - 2 * G, 1 - 2 * G)]),
  make('single-caption', 'Une photo + légende', [
    photo('p1', G, G, 1 - 2 * G, 0.8),
    text('c1', G, 0.86, 1 - 2 * G, 0.1, 'center'),
  ]),
  make('two-columns', 'Deux colonnes', [
    photo('p1', G, G, (1 - 2 * G - GAP) / 2, 1 - 2 * G),
    photo('p2', G + (1 - 2 * G - GAP) / 2 + GAP, G, (1 - 2 * G - GAP) / 2, 1 - 2 * G),
  ]),
  make('two-rows', 'Deux lignes', [
    photo('p1', G, G, 1 - 2 * G, (1 - 2 * G - GAP) / 2),
    photo('p2', G, G + (1 - 2 * G - GAP) / 2 + GAP, 1 - 2 * G, (1 - 2 * G - GAP) / 2),
  ]),
  make('two-caption', 'Deux photos + légende', [
    photo('p1', G, G, (1 - 2 * G - GAP) / 2, 0.8),
    photo('p2', G + (1 - 2 * G - GAP) / 2 + GAP, G, (1 - 2 * G - GAP) / 2, 0.8),
    text('c1', G, 0.86, 1 - 2 * G, 0.1, 'center'),
  ]),
  make('one-plus-two', 'Une grande + deux petites', [
    photo('p1', G, G, 0.6, 1 - 2 * G),
    photo('p2', G + 0.6 + GAP, G, 1 - 2 * G - 0.6 - GAP, (1 - 2 * G - GAP) / 2),
    photo(
      'p3',
      G + 0.6 + GAP,
      G + (1 - 2 * G - GAP) / 2 + GAP,
      1 - 2 * G - 0.6 - GAP,
      (1 - 2 * G - GAP) / 2,
    ),
  ]),
  make('grid-2x2', 'Grille 2×2', [
    photo('p1', G, G, (1 - 2 * G - GAP) / 2, (1 - 2 * G - GAP) / 2),
    photo('p2', G + (1 - 2 * G - GAP) / 2 + GAP, G, (1 - 2 * G - GAP) / 2, (1 - 2 * G - GAP) / 2),
    photo('p3', G, G + (1 - 2 * G - GAP) / 2 + GAP, (1 - 2 * G - GAP) / 2, (1 - 2 * G - GAP) / 2),
    photo(
      'p4',
      G + (1 - 2 * G - GAP) / 2 + GAP,
      G + (1 - 2 * G - GAP) / 2 + GAP,
      (1 - 2 * G - GAP) / 2,
      (1 - 2 * G - GAP) / 2,
    ),
  ]),
  make('three-caption', 'Trois photos + légende', [
    photo('p1', G, G, 1 - 2 * G, 0.5),
    photo('p2', G, G + 0.5 + GAP, (1 - 2 * G - GAP) / 2, 0.8 - 0.5 - GAP),
    photo('p3', G + (1 - 2 * G - GAP) / 2 + GAP, G + 0.5 + GAP, (1 - 2 * G - GAP) / 2, 0.8 - 0.5 - GAP),
    text('c1', G, 0.86, 1 - 2 * G, 0.1, 'center'),
  ]),
  make('chapter', 'Titre de chapitre', [
    text('title', G, 0.4, 1 - 2 * G, 0.12, 'center'),
    text('subtitle', G, 0.53, 1 - 2 * G, 0.07, 'center'),
  ]),
]);

export function getBuiltinTemplate(id: string): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/** Zones photo d'un gabarit, dans l'ordre de déclaration. */
export function photoSlots(template: Template): TemplateSlot[] {
  return template.slots.filter((s) => s.kind === 'photo');
}

/** Zones texte d'un gabarit. */
export function textSlots(template: Template): TemplateSlot[] {
  return template.slots.filter((s) => s.kind === 'text');
}

/** Renvoie une copie profonde d'un gabarit (pour l'embarquer dans un album). */
export function cloneTemplate(t: Template): Template {
  return {
    id: t.id,
    name: t.name,
    photoCount: t.photoCount,
    slots: t.slots.map((s) => ({ ...s, rect: { ...s.rect } })),
  };
}
