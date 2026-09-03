import type { PhotoAnalysis } from './types';
import { technicalScore } from './quality';

export interface ScoringWeights {
  technical: number;
  people: number;
  expression: number;
  composition: number;
}

export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = Object.freeze({
  technical: 0.4,
  people: 0.3,
  expression: 0.15,
  composition: 0.15,
});

export interface ScoringContext {
  /** Personnes que l'utilisateur veut voir dans l'album. */
  selectedPeople: Set<string>;
  /** photoId → personnes reconnues. */
  peopleByPhoto: Map<string, string[]>;
  weights?: Partial<ScoringWeights>;
  /** Autoriser des photos sans aucune personne sélectionnée (paysages…). */
  allowScenery?: boolean;
}

export interface PhotoScore {
  photoId: string;
  score: number;
  technical: number;
  people: number;
  expression: number;
  composition: number;
  /** Personnes sélectionnées présentes. */
  selectedPresent: string[];
  /** La photo contient des visages d'inconnus (non sélectionnés). */
  hasStrangers: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Score d'expression moyen des visages : yeux ouverts et sourires. */
export function expressionScore(a: PhotoAnalysis): number {
  if (a.faces.length === 0) return 0.5;
  let sum = 0;
  for (const f of a.faces) {
    const eyes = ((f.leftEyeOpenProbability ?? 0.8) + (f.rightEyeOpenProbability ?? 0.8)) / 2;
    const smile = f.smilingProbability ?? 0.5;
    sum += 0.6 * eyes + 0.4 * smile;
  }
  return clamp01(sum / a.faces.length);
}

/**
 * Composition simple : visages ni minuscules ni coupés par le bord, et
 * proches des lignes des tiers. Sans visage : neutre.
 */
export function compositionScore(a: PhotoAnalysis): number {
  if (a.faces.length === 0) return 0.5;
  let sum = 0;
  for (const f of a.faces) {
    const cx = f.rect.x + f.rect.w / 2;
    const cy = f.rect.y + f.rect.h / 2;
    const dx = Math.min(Math.abs(cx - 1 / 3), Math.abs(cx - 2 / 3), Math.abs(cx - 0.5));
    const dy = Math.min(Math.abs(cy - 1 / 3), Math.abs(cy - 0.5));
    const thirds = 1 - clamp01((dx + dy) / 0.5);
    const cut = f.rect.x < 0.01 || f.rect.y < 0.01 || f.rect.x + f.rect.w > 0.99 || f.rect.y + f.rect.h > 0.99 ? 0.4 : 1;
    const size = clamp01(f.rect.w / 0.15);
    sum += 0.5 * thirds * cut + 0.5 * size;
  }
  return clamp01(sum / a.faces.length);
}

export function scorePhoto(a: PhotoAnalysis, ctx: ScoringContext): PhotoScore {
  const w = { ...DEFAULT_WEIGHTS, ...(ctx.weights ?? {}) };
  const present = ctx.peopleByPhoto.get(a.photo.id) ?? [];
  const selectedPresent = present.filter((p) => ctx.selectedPeople.has(p));
  const knownFaces = present.length;
  const hasStrangers = a.faces.length > knownFaces || present.some((p) => !ctx.selectedPeople.has(p));

  const technical = technicalScore(a.quality);

  let people: number;
  if (ctx.selectedPeople.size === 0) {
    people = 0.5;
  } else if (selectedPresent.length > 0) {
    // Récompense la couverture des personnes voulues, pénalise légèrement les inconnus.
    const coverage = selectedPresent.length / Math.min(ctx.selectedPeople.size, 4);
    people = clamp01(0.6 + 0.4 * coverage - (hasStrangers ? 0.15 : 0));
  } else if (a.faces.length === 0) {
    people = ctx.allowScenery === false ? 0 : 0.35;
  } else {
    people = 0.05; // des visages, mais aucun des nôtres
  }

  const expression = expressionScore(a);
  const composition = compositionScore(a);

  let score = w.technical * technical + w.people * people + w.expression * expression + w.composition * composition;
  // Une photo floue ou uniquement peuplée d'inconnus ne doit pas remonter.
  if (a.quality.sharpness < 0.15) score *= 0.5;
  if (ctx.selectedPeople.size > 0 && selectedPresent.length === 0 && a.faces.length > 0) score *= 0.5;

  return {
    photoId: a.photo.id,
    score: clamp01(score),
    technical,
    people,
    expression,
    composition,
    selectedPresent,
    hasStrangers,
  };
}

export function scorePhotos(analyses: PhotoAnalysis[], ctx: ScoringContext): PhotoScore[] {
  return analyses.map((a) => scorePhoto(a, ctx)).sort((a, b) => b.score - a.score);
}
