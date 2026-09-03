/** Réglages de l'application (IA locale). */
export const APP_GENERATOR = 'albumphoto-mobile/0.1.0';

/**
 * URL facultative d'un modèle ONNX d'embedding de visage (MobileFaceNet /
 * ArcFace). Laisser `null` pour utiliser le repli par pixels. Le fichier est
 * téléchargé une fois dans le dossier documents de l'application.
 */
export const FACE_MODEL_URL: string | null = null;
export const FACE_MODEL_FILENAME = 'mobilefacenet.onnx';
export const FACE_MODEL_INPUT_SIZE = 112;

/** Taille des vignettes d'analyse (px, plus grand côté). */
export const ANALYSIS_THUMBNAIL = 256;
/** Taille des vignettes stockées dans le bundle d'album. */
export const BUNDLE_THUMBNAIL = 640;
/** Nombre max de photos parcourues par l'assistant (protège la batterie). */
export const DEFAULT_SCAN_LIMIT = 600;
