import type { QualityMetrics } from './types';
import type { PhotoScore } from './scoring';
import type { RejectionReason } from './selection';

/**
 * Mise en mots des décisions de l'IA : pourquoi telle photo a été retenue,
 * pourquoi telle autre a été écartée. Sert l'écran de revue de l'application,
 * et pourra servir aux versions web et desktop.
 */

export interface ScoreExplanation {
  /** Ce qui a joué en faveur de la photo, du plus déterminant au moins. */
  strengths: string[];
  /** Ce qui a joué contre elle. */
  weaknesses: string[];
}

const FR_REASONS: Record<RejectionReason, string> = {
  notPhoto: "Ce n'est pas une photo",
  sharpness: 'Trop floue',
  score: 'Note trop basse',
  duplicate: 'Quasi identique à une photo retenue',
  moment: 'Déjà assez de photos de ce moment',
  event: 'Ce moment a le nombre de photos demandé',
  quota: 'Album déjà complet',
  manual: 'Écartée à la main',
};

const EN_REASONS: Record<RejectionReason, string> = {
  notPhoto: 'Not a real photo',
  sharpness: 'Too blurry',
  score: 'Score too low',
  duplicate: 'Near-duplicate of a selected photo',
  moment: 'Enough photos from that moment already',
  event: 'That moment has the requested number of photos',
  quota: 'Album already full',
  manual: 'Removed by hand',
};

export function rejectionLabel(reason: RejectionReason, locale = 'fr-FR'): string {
  return (locale.startsWith('fr') ? FR_REASONS : EN_REASONS)[reason];
}

/** Explication détaillée du motif de rejet, en une phrase. */
export function rejectionDetail(reason: RejectionReason, locale = 'fr-FR'): string {
  const fr = locale.startsWith('fr');
  switch (reason) {
    case 'notPhoto':
      return fr
        ? "Capture d'écran, image enregistrée ou document : rien qui soit sorti d'un appareil photo."
        : 'A screenshot, a saved image or a document: nothing that came out of a camera.';
    case 'sharpness':
      return fr
        ? "La netteté mesurée est sous le seuil : la photo paraîtrait floue une fois imprimée."
        : 'Measured sharpness is below the threshold: it would look blurry in print.';
    case 'score':
      return fr
        ? 'La note globale reste sous le seuil de sélection, malgré les autres critères.'
        : 'The overall score stays below the selection threshold.';
    case 'duplicate':
      return fr
        ? "Son empreinte visuelle est presque identique à celle d'une photo déjà retenue (rafale)."
        : 'Its visual fingerprint is nearly identical to a photo already selected (burst).';
    case 'moment':
      return fr
        ? 'Deux photos du même moment sont déjà retenues, pour varier le récit de l’album.'
        : 'Two photos from the same moment are already in, to keep the album varied.';
    case 'event':
      return fr
        ? 'Ce moment a déjà le nombre de photos que vous lui avez accordé.'
        : 'That moment already has the number of photos you granted it.';
    case 'quota':
      return fr
        ? "Le nombre de photos demandé était atteint : elle serait entrée avec un album plus grand."
        : 'The requested photo count was reached: a larger album would have included it.';
    case 'manual':
      return fr
        ? "Vous l'avez retirée de l'album."
        : 'You removed it from the album.';
  }
}

/**
 * Points forts et réserves d'une photo, en langage courant.
 * `peopleNames` : prénoms des personnes choisies présentes sur la photo.
 */
export function explainScore(
  score: PhotoScore,
  quality: QualityMetrics,
  peopleNames: string[] = [],
  locale = 'fr-FR',
): ScoreExplanation {
  const fr = locale.startsWith('fr');
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (peopleNames.length > 0) {
    const list = peopleNames.join(', ');
    strengths.push(fr ? `Personnes choisies présentes : ${list}` : `Selected people present: ${list}`);
  }
  if (quality.sharpness > 0.7) strengths.push(fr ? 'Très nette' : 'Very sharp');
  else if (quality.sharpness > 0.45) strengths.push(fr ? 'Nette' : 'Sharp');
  if (quality.exposure > 0.75) strengths.push(fr ? 'Bien exposée' : 'Well exposed');
  if (quality.contrast > 0.6) strengths.push(fr ? 'Bon contraste' : 'Good contrast');
  if (quality.colorfulness > 0.5) strengths.push(fr ? 'Couleurs riches' : 'Rich colours');
  if (score.expression > 0.75) strengths.push(fr ? 'Yeux ouverts et sourires' : 'Open eyes and smiles');
  if (score.composition > 0.7) strengths.push(fr ? 'Cadrage réussi' : 'Well framed');

  if (quality.sharpness < 0.3) weaknesses.push(fr ? 'Manque de netteté' : 'Lacks sharpness');
  if (quality.exposure < 0.4) weaknesses.push(fr ? 'Exposition difficile' : 'Difficult exposure');
  if (quality.contrast < 0.25) weaknesses.push(fr ? 'Peu de contraste' : 'Low contrast');
  if (score.expression < 0.4) weaknesses.push(fr ? 'Yeux fermés ou visages fermés' : 'Closed eyes or flat expressions');
  if (score.composition < 0.4) weaknesses.push(fr ? 'Cadrage perfectible' : 'Framing could be better');
  if (score.hasStrangers) weaknesses.push(fr ? 'Visages non identifiés' : 'Unidentified faces');
  if (peopleNames.length === 0 && score.selectedPresent.length === 0) {
    weaknesses.push(fr ? 'Aucune personne choisie' : 'None of the chosen people');
  }

  return { strengths, weaknesses };
}

/** Étiquette d'un critère de notation, pour l'affichage du détail. */
export function criterionLabel(key: 'technical' | 'people' | 'expression' | 'composition', locale = 'fr-FR'): string {
  const fr = locale.startsWith('fr');
  switch (key) {
    case 'technical':
      return fr ? 'Technique' : 'Technical';
    case 'people':
      return fr ? 'Personnes' : 'People';
    case 'expression':
      return fr ? 'Expression' : 'Expression';
    case 'composition':
      return fr ? 'Composition' : 'Composition';
  }
}
