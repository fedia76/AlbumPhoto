import type { CaptionOption, CaptionStyle } from '../../album/types';
import type { SourcePhoto } from '../types';

/** Tout ce que l'on sait d'une photo pour écrire sa légende. */
export interface CaptionContext {
  /** Prénoms des personnes reconnues (déjà sélectionnées par l'utilisateur). */
  people: string[];
  /** Nombre total de visages, inconnus compris. */
  faceCount: number;
  /** Étiquettes de contenu (IA locale), ex. « plage », « gâteau ». */
  labels: string[];
  /**
   * Ce que la photo montre, en une phrase. Renseigné quand un modèle
   * vision-langage l'a regardée : c'est une matière autrement plus riche que
   * les étiquettes, et le seul moyen pour un rédacteur qui ne voit pas l'image
   * d'écrire quelque chose de juste.
   */
  description?: string;
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
  /**
   * La photo elle-même, pour un générateur qui sait la regarder (modèle
   * vision-langage). Les générateurs textuels l'ignorent : ils ne disposent
   * que des faits rassemblés dans `context`.
   */
  photo?: SourcePhoto;
}

/**
 * Légende retenue, avec ce qui a servi à l'écrire. La description et les
 * propositions sont conservées dans l'album : elles expliquent la légende et
 * permettent d'en choisir une autre sans relancer aucun modèle.
 */
export interface CaptionDraft {
  text: string;
  /** Ce que le modèle vision a vu sur la photo. */
  description?: string;
  /** Légendes proposées, tous styles confondus. */
  options?: CaptionOption[];
}

/** Port : générateur de légendes (implémentations locale-LLM ou par gabarits). */
export interface CaptionGenerator {
  readonly name: string;
  /**
   * Variante détaillée de `generate` : la légende retenue accompagnée de la
   * description et des propositions. Les générateurs qui n'ont rien de plus à
   * dire s'en dispensent — `generate` suffit alors.
   */
  draft?(req: CaptionRequest, signal?: AbortSignal): Promise<CaptionDraft>;
  /**
   * Prépare ce qu'il faut avant la première légende — télécharger et charger un
   * modèle, par exemple. À appeler avant `generateCaptions` : cette attente-là
   * se compte en minutes et ne doit pas être imputée au délai d'une légende,
   * qui l'abandonnerait au moment même où elle allait servir.
   *
   * Ne lève pas : un générateur qui n'a pas pu se préparer se rabat sur ce
   * qu'il sait faire.
   */
  prepare?(signal?: AbortSignal): Promise<void>;
  generate(req: CaptionRequest, signal?: AbortSignal): Promise<string>;
}

export const DEFAULT_CAPTION_MAX_LENGTH = 90;
