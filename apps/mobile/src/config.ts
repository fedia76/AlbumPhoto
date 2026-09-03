/** Réglages de l'application (IA locale). */
export const APP_GENERATOR = 'albumphoto-mobile/0.1.0';

/**
 * Modèle ONNX d'embedding de visage : MobileFaceNet « w600k_mbf » du pack
 * insightface buffalo_sc (13,6 Mo, entrée 1×3×112×112 RGB normalisée
 * (x − 127.5) / 127.5, sortie 1×512). Publié comme asset de release de ce dépôt
 * par le workflow `.github/workflows/publish-model.yml`, téléchargé une fois
 * sur l'appareil au premier lancement de l'assistant.
 *
 * Licence : les modèles insightface sont réservés à un usage non commercial
 * (recherche / personnel). Mettre `null` pour désactiver et utiliser le repli.
 */
export const FACE_MODEL_URL: string | null = 'https://github.com/fedia76/AlbumPhoto/releases/download/models-v1/w600k_mbf.onnx';
export const FACE_MODEL_FILENAME = 'w600k_mbf.onnx';
/** Empreinte MD5 attendue du fichier (contrôle d'intégrité après téléchargement). */
export const FACE_MODEL_MD5 = 'c5b029527cb6f874e057613fc10bae1b';
export const FACE_MODEL_INPUT_SIZE = 112;
/** Similarité cosinus minimale pour réunir deux visages avec ce modèle. */
export const FACE_MODEL_CLUSTER_THRESHOLD = 0.5;

/** Taille des vignettes d'analyse (px, plus grand côté). */
export const ANALYSIS_THUMBNAIL = 256;
/** Taille des vignettes stockées dans le bundle d'album. */
export const BUNDLE_THUMBNAIL = 640;
/** Nombre max de photos parcourues par l'assistant (protège la batterie). */
export const DEFAULT_SCAN_LIMIT = 600;
