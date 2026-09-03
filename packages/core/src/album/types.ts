/**
 * Types du format d'album AlbumPhoto (version 1).
 *
 * Le format est volontairement indépendant de toute plateforme : un album est
 * un dossier (« bundle ») contenant un manifeste `album.json` et les photos
 * référencées par des chemins relatifs. Toutes les coordonnées de mise en page
 * sont normalisées (fractions 0..1) afin qu'un moteur de rendu mobile, web ou
 * desktop reproduise exactement la même page.
 *
 * Voir `docs/album-format.md` pour la spécification complète.
 */

/** Identifiant du format, présent dans chaque manifeste. */
export const ALBUM_FORMAT = 'albumphoto' as const;

/** Version courante du format écrite par cette bibliothèque. */
export const ALBUM_FORMAT_VERSION = 1 as const;

/** Nom du fichier manifeste à la racine d'un bundle d'album. */
export const ALBUM_MANIFEST_FILENAME = 'album.json' as const;

/** Sous-dossier du bundle contenant les photos. */
export const ALBUM_PHOTOS_DIR = 'photos' as const;

/** Sous-dossier (optionnel, régénérable) contenant les vignettes. */
export const ALBUM_THUMBS_DIR = 'thumbs' as const;

export type LengthUnit = 'mm' | 'in' | 'px';

/** Dimensions physiques d'une page (hors fond perdu). */
export interface PageSize {
  width: number;
  height: number;
  unit: LengthUnit;
  /** Fond perdu ajouté sur chaque bord à l'impression, dans la même unité. */
  bleed?: number;
}

/** Rectangle normalisé : fractions 0..1 de la page (ou de la photo). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SlotKind = 'photo' | 'text';

/** Emplacement d'un gabarit (« template ») : une zone photo ou une zone texte. */
export interface TemplateSlot {
  id: string;
  kind: SlotKind;
  rect: NormRect;
  /** Pour un texte : alignement horizontal. */
  align?: 'left' | 'center' | 'right';
}

/** Gabarit de page. Les albums embarquent les gabarits utilisés (autonomie du fichier). */
export interface Template {
  id: string;
  name: string;
  /** Aspect conseillé (largeur / hauteur) ; informatif. */
  slots: TemplateSlot[];
  /** Nombre de zones photo, redondant mais pratique pour les sélecteurs. */
  photoCount: number;
}

/**
 * Transformation d'une photo dans une zone.
 *
 * - La photo est d'abord ajustée en mode « cover » (elle remplit la zone).
 * - `scale` (>= 1) agrandit la photo au-delà de ce recouvrement minimal (zoom).
 * - `offsetX`/`offsetY` ∈ [-1, 1] déplacent la fenêtre visible : -1 = bord
 *   gauche/haut de la photo, 0 = centrée, 1 = bord droit/bas. Exprimé ainsi,
 *   le déplacement reste valide quel que soit le zoom.
 * - `rotation` en degrés, sens horaire (0 par défaut ; l'éditeur mobile ne
 *   propose pas encore la rotation mais le format la réserve).
 */
export interface PhotoTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export const IDENTITY_TRANSFORM: Readonly<PhotoTransform> = Object.freeze({
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
});

/** Contenu placé dans une zone photo d'une page. */
export interface PhotoPlacement {
  photoId: string;
  transform: PhotoTransform;
}

/** Contenu d'une zone texte (légende, titre). */
export interface TextContent {
  text: string;
  /** Rôle sémantique, utile aux renderers et à l'IA. */
  role?: 'caption' | 'title' | 'subtitle' | 'body';
}

export interface Page {
  id: string;
  templateId: string;
  /** Contenu par id de zone. Une zone absente est vide. */
  photos: Record<string, PhotoPlacement>;
  texts: Record<string, TextContent>;
  /** Couleur de fond spécifique à la page (sinon celle du thème). */
  background?: string;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Une photo de l'album. Le fichier est stocké dans le bundle (`src`). */
export interface Photo {
  id: string;
  /** Chemin relatif au bundle, ex. `photos/3f2a….jpg`. */
  src: string;
  /** Chemin relatif d'une vignette (optionnel, régénérable). */
  thumb?: string;
  width: number;
  height: number;
  mimeType?: string;
  /** Date de prise de vue ISO 8601. */
  takenAt?: string;
  location?: GeoPoint;
  /** URI d'origine sur l'appareil (non portable, informatif). */
  sourceUri?: string;
  /** Empreinte perceptuelle (dHash hexadécimal) pour la déduplication. */
  hash?: string;
  /** Personnes reconnues sur la photo. */
  people?: string[];
  /** Score de sélection IA (0..1) si calculé. */
  score?: number;
  /** Étiquettes de contenu (IA locale) ex. « plage », « gâteau ». */
  labels?: string[];
}

export interface Person {
  id: string;
  name: string;
  /** Photo de référence et rectangle du visage (normalisé) pour l'affichage. */
  referencePhotoId?: string;
  referenceFaceRect?: NormRect;
}

export interface Theme {
  background: string;
  fontFamily?: string;
  textColor?: string;
  /** Marge intérieure appliquée par défaut aux zones, en fraction de page. */
  gutter?: number;
}

export type CaptionStyle = 'funny' | 'formal' | 'poetic' | 'minimal' | 'family';

export const CAPTION_STYLES: readonly CaptionStyle[] = Object.freeze([
  'funny',
  'formal',
  'poetic',
  'minimal',
  'family',
]);

/** Métadonnées sur l'assistance IA ayant produit l'album (informatif). */
export interface AiMetadata {
  captionStyle?: CaptionStyle;
  /** Identifiant libre du modèle de légende (ex. « template:fr », « llama-3.2-1b »). */
  captionModel?: string;
  /** Personnes retenues lors de l'assistant. */
  selectedPeople?: string[];
  generatedAt?: string;
}

export interface Album {
  format: typeof ALBUM_FORMAT;
  formatVersion: number;
  id: string;
  title: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  /** Application ayant écrit le fichier, informatif (`albumphoto-mobile/0.1.0`). */
  generator?: string;
  page: PageSize;
  theme: Theme;
  templates: Template[];
  photos: Photo[];
  people: Person[];
  pages: Page[];
  ai?: AiMetadata;
}
