import type { CaptionStyle } from '../../album/types';

/** Tout ce que l'on sait d'une photo pour écrire sa légende. */
export interface CaptionContext {
  /** Prénoms des personnes reconnues (déjà sélectionnées par l'utilisateur). */
  people: string[];
  /** Nombre total de visages, inconnus compris. */
  faceCount: number;
  /** Étiquettes de contenu (IA locale), ex. « plage », « gâteau ». */
  labels: string[];
  takenAt?: string;
  /** Moment de la journée dérivé de `takenAt`. */
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Tout le monde sourit ? */
  smiling?: boolean;
  /** Titre de l'album / de l'événement pour donner du contexte. */
  albumTitle?: string;
  eventTitle?: string;
  locale: string;
}

export interface CaptionRequest {
  context: CaptionContext;
  style: CaptionStyle;
  /** Longueur maximale (caractères) ; par défaut 90. */
  maxLength?: number;
  /**
   * Rang de la photo dans l'album. Sert à faire tourner les tournures : deux
   * photos voisines ne doivent pas recevoir la même formulation.
   */
  variant?: number;
}

/** Port : générateur de légendes (implémentations locale-LLM ou par gabarits). */
export interface CaptionGenerator {
  readonly name: string;
  generate(req: CaptionRequest, signal?: AbortSignal): Promise<string>;
}

export const DEFAULT_CAPTION_MAX_LENGTH = 90;
