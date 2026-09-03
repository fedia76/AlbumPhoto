import type { NormRect } from '../album/types';

/** Image décodée en niveaux de gris (une valeur 0..255 par pixel). */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Image décodée RGBA (4 octets par pixel). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Photo de l'appareil telle que vue par la source (avant analyse). */
export interface SourcePhoto {
  /** Identifiant stable côté source (asset id). */
  id: string;
  uri: string;
  width: number;
  height: number;
  takenAt?: string;
  location?: { latitude: number; longitude: number };
  mimeType?: string;
  fileName?: string;
}

/** Visage détecté sur une photo (rectangle normalisé dans la photo). */
export interface DetectedFace {
  rect: NormRect;
  /** Probabilités 0..1 si le détecteur les fournit. */
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  /** Rotation de la tête (degrés) autour de l'axe vertical : 0 = de face. */
  headEulerAngleY?: number;
  headEulerAngleZ?: number;
  /** Vecteur d'identité (issu du modèle d'embedding). */
  embedding?: Float32Array;
}

export interface QualityMetrics {
  /** Netteté 0..1 (variance du laplacien normalisée). */
  sharpness: number;
  /** Exposition 0..1 (1 = luminance moyenne idéale, sans zones brûlées/bouchées). */
  exposure: number;
  /** Contraste 0..1. */
  contrast: number;
  /** Richesse des couleurs 0..1 (0 pour du niveau de gris). */
  colorfulness: number;
  /** Luminance moyenne brute 0..255 (diagnostic). */
  meanLuma: number;
  /** Variance du laplacien brute (diagnostic). */
  laplacianVariance: number;
}

/** Résultat complet de l'analyse d'une photo par l'IA locale. */
export interface PhotoAnalysis {
  photo: SourcePhoto;
  faces: DetectedFace[];
  quality: QualityMetrics;
  /** dHash hexadécimal 16 caractères. */
  hash: string;
  labels: string[];
}

/** Regroupement de visages jugés être la même personne. */
export interface PersonCluster {
  id: string;
  /** Visages membres : index de photo et index de visage. */
  members: { photoId: string; faceIndex: number }[];
  /** Vecteur moyen (normalisé). */
  centroid: Float32Array;
  /** Visage le plus représentatif (net, de face, grand). */
  representative: { photoId: string; faceIndex: number };
}
