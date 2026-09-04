import type { AuthenticityVerdict, RgbaImage, SourcePhoto } from './types';

/**
 * Reconnaître ce qui n'est pas une vraie photo.
 *
 * Une pellicule ne contient pas que des photos : des captures d'écran, des
 * images reçues par messagerie, des mèmes, des affiches, la photo d'un
 * pense-bête. Rien de tout cela n'a sa place dans un album imprimé, et rien de
 * tout cela n'est écarté par la note technique — une capture d'écran est
 * parfaitement nette, bien exposée, bien contrastée.
 *
 * Aucun modèle ici : uniquement des indices croisés, tous gratuits ou presque.
 * Le plus sûr vient de la photothèque elle-même (iOS déclare ses captures) ;
 * viennent ensuite le nom de fichier, le dossier d'origine, l'absence d'EXIF
 * d'appareil, la ressemblance avec l'écran, puis la texture de l'image.
 */

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Un indice et son poids : la probabilité qu'il suffise à lui seul à trancher. */
interface Evidence {
  weight: number;
  reason: string;
}

/**
 * Combinaison « ou bruité » : chaque indice ronge ce qui reste de doute, sans
 * jamais dépasser 1. Deux indices moyens valent mieux qu'un seul, mais dix
 * indices faibles ne valent pas une preuve.
 */
function combine(evidence: Evidence[]): { score: number; reasons: string[] } {
  const kept = evidence.filter((e) => e.weight > 0).sort((a, b) => b.weight - a.weight);
  let doubt = 1;
  for (const e of kept) doubt *= 1 - clamp01(e.weight);
  return { score: 1 - doubt, reasons: kept.map((e) => e.reason) };
}

/* ------------------------------ Métadonnées ------------------------------- */

/** Noms de fichier que les systèmes donnent à leurs captures d'écran. */
const SCREENSHOT_NAME = /(screen[ _-]?shot|screen[ _-]?capture|scrnshot|capture[ _-]?d.?[ée]cran)/i;

/**
 * Dossiers qui ne contiennent jamais de photos prises par l'appareil. Le chemin
 * n'existe que sur Android ; iOS s'appuie sur `mediaSubtypes`, plus fiable.
 */
const SCREENSHOT_FOLDER = /\/(screenshots?|screen[ _-]?captures?|captures?)\//i;
const SAVED_FOLDER = /\/(downloads?|telegram|whatsapp|signal|messenger|instagram|snapchat|twitter|facebook|viber|pinterest|bluetooth|documents?|memes?|stickers?)\b/i;
/** Dossiers de l'appareil photo : un fort démenti. */
const CAMERA_FOLDER = /\/(dcim\/camera|dcim\/\d{3}[a-z]+|camera)\//i;

/** Formats qui trahissent une image de synthèse plutôt qu'un capteur. */
const SYNTHETIC_EXTENSION = /\.(png|gif|bmp|webp|svg)$/i;
const CAMERA_EXTENSION = /\.(jpe?g|heic|heif|dng|tiff?|raw|cr2|nef|arw)$/i;

/** Étiquettes qui, à elles seules, désignent presque sûrement un écran. */
const SCREEN_LABELS = new Set([
  'screenshot', 'web page', 'webpage', 'website', 'screen', 'display device', 'computer monitor',
  'software', 'operating system', 'web design', 'multimedia software', 'document', 'receipt',
  'invoice', 'spreadsheet', 'barcode', 'qr code', 'menu', 'ticket',
]);

/** Étiquettes qui pèsent dans le faisceau sans jamais trancher seules. */
const GRAPHIC_LABELS = new Set([
  'text', 'font', 'line', 'rectangle', 'number', 'logo', 'brand', 'graphics', 'icon', 'diagram',
  'chart', 'poster', 'illustration', 'cartoon', 'clip art', 'sketch', 'drawing', 'animated cartoon',
  'banner', 'calendar', 'handwriting', 'paper', 'paper product', 'colorfulness', 'circle',
  'parallel', 'symmetry', 'azure', 'aqua', 'magenta', 'electric blue', 'screenshot',
]);

/** Tout ce qui aide à juger si une image vient d'un appareil photo. */
export interface AuthenticitySignals {
  photo: SourcePhoto;
  /** Étiquettes brutes du modèle d'étiquetage, en anglais et en minuscules. */
  labels?: readonly string[];
  /** Résolution de l'écran en pixels, pour repérer une capture plein écran. */
  screen?: { width: number; height: number };
  /** Fabricant et modèle EXIF : absents de toute image qui n'a pas vu un capteur. */
  exif?: { make?: string; model?: string };
  /**
   * L'EXIF a bien été lu, même s'il s'est révélé vide. Sans cela, son absence
   * ne prouve rien : elle dit seulement qu'on n'a pas regardé.
   */
  exifRead?: boolean;
}

/** Vrai si la photothèque déclare elle-même l'image comme une capture d'écran. */
export function declaredScreenshot(photo: SourcePhoto): boolean {
  return (photo.mediaSubtypes ?? []).some((s) => s.toLowerCase() === 'screenshot');
}

/** Indices tirés des métadonnées, sans lire un seul pixel. */
export function metadataEvidence(signals: AuthenticitySignals): Evidence[] {
  const { photo, screen, exif, exifRead } = signals;
  const name = photo.fileName ?? '';
  const path = photo.uri ?? '';
  const out: Evidence[] = [];

  if (SCREENSHOT_NAME.test(name) || SCREENSHOT_NAME.test(path)) {
    out.push({ weight: 0.85, reason: 'Son nom de fichier annonce une capture d’écran' });
  }
  if (SCREENSHOT_FOLDER.test(path)) {
    out.push({ weight: 0.85, reason: 'Elle est rangée dans le dossier des captures d’écran' });
  } else if (SAVED_FOLDER.test(path)) {
    // Volontairement modéré : on reçoit aussi de vraies photos de famille par
    // messagerie, et elles ont toute leur place dans un album.
    out.push({ weight: 0.5, reason: 'Elle vient d’un dossier de téléchargements ou de messagerie' });
  }

  const extension = SYNTHETIC_EXTENSION.test(name) || SYNTHETIC_EXTENSION.test(path);
  if (extension) out.push({ weight: 0.3, reason: 'Son format n’est pas celui d’un appareil photo' });

  if (screen && screen.width > 0 && screen.height > 0) {
    const exact =
      (photo.width === screen.width && photo.height === screen.height) ||
      (photo.width === screen.height && photo.height === screen.width);
    if (exact) out.push({ weight: 0.5, reason: 'Ses dimensions sont exactement celles de l’écran' });
  }

  if (exifRead && !exif?.make && !exif?.model) {
    out.push({ weight: 0.45, reason: 'Aucun appareil photo n’est inscrit dans ses métadonnées' });
  }

  const labels = signals.labels ?? [];
  const screenLabel = labels.find((l) => SCREEN_LABELS.has(l));
  if (screenLabel) out.push({ weight: 0.45, reason: `Le contenu reconnu est « ${screenLabel} »` });
  const graphic = labels.filter((l) => GRAPHIC_LABELS.has(l));
  if (graphic.length >= 2) {
    out.push({ weight: Math.min(0.4, 0.15 * graphic.length), reason: `Contenu graphique plutôt que photographique (${graphic.slice(0, 3).join(', ')})` });
  }

  return out;
}

/**
 * Ce qui vient démentir le soupçon. Multiplicatif : un appareil photo inscrit
 * dans les métadonnées suffit à ramener presque tous les indices au silence.
 */
export function metadataMitigation(signals: AuthenticitySignals): number {
  const { photo, exif } = signals;
  let factor = 1;
  if (exif?.make || exif?.model) factor *= 0.25;
  if (CAMERA_FOLDER.test(photo.uri ?? '')) factor *= 0.4;
  if (CAMERA_EXTENSION.test(photo.fileName ?? '') && !SYNTHETIC_EXTENSION.test(photo.fileName ?? '')) factor *= 0.8;
  return factor;
}

/* -------------------------------- Pixels ---------------------------------- */

/**
 * Traces qu'une interface laisse dans les pixels, mesurées sur la vignette
 * d'analyse déjà décodée — le calcul ne coûte donc rien de plus.
 */
export interface PixelPatterns {
  /** Part des pixels identiques à leur voisin de droite et du dessous (aplats). */
  flatRatio: number;
  /**
   * Nombre de teintes distinctes (5 bits par canal). Un compte absolu, non un
   * ratio : une interface tient en quelques dizaines de teintes qu'elle occupe
   * dix mille pixels ou un million, alors qu'un ratio dépendrait de la taille
   * de la vignette.
   */
  colorCount: number;
  /** Nombre de pixels examinés, pour rapporter `colorCount` à ce qui est possible. */
  pixelCount: number;
  /** Part des pixels blancs ou noirs purs. */
  pureRatio: number;
  /** Part des lignes et colonnes uniformes : barres d'état, marges, séparateurs. */
  uniformLineRatio: number;
}

export function pixelPatterns(img: RgbaImage): PixelPatterns {
  const { width: w, height: h, data } = img;
  const n = w * h;
  if (n === 0) return { flatRatio: 0, colorCount: 0, pixelCount: 0, pureRatio: 0, uniformLineRatio: 0 };

  const at = (x: number, y: number) => (y * w + x) * 4;
  const seen = new Set<number>();
  let flat = 0;
  let flatTested = 0;
  let pure = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      if ((r >= 250 && g >= 250 && b >= 250) || (r <= 5 && g <= 5 && b <= 5)) pure++;
      if (x + 1 < w && y + 1 < h) {
        flatTested++;
        // Tolérance de 1 : la compression de la vignette fait vibrer les aplats.
        if (near(data, i, at(x + 1, y), 1) && near(data, i, at(x, y + 1), 1)) flat++;
      }
    }
  }

  let uniform = 0;
  for (let y = 0; y < h; y++) if (isUniformLine(img, y, true)) uniform++;
  for (let x = 0; x < w; x++) if (isUniformLine(img, x, false)) uniform++;

  return {
    flatRatio: flatTested ? flat / flatTested : 0,
    colorCount: seen.size,
    pixelCount: n,
    pureRatio: pure / n,
    uniformLineRatio: uniform / (w + h),
  };
}

function near(d: RgbaImage['data'], a: number, b: number, tolerance: number): boolean {
  return (
    Math.abs(d[a]! - d[b]!) <= tolerance &&
    Math.abs(d[a + 1]! - d[b + 1]!) <= tolerance &&
    Math.abs(d[a + 2]! - d[b + 2]!) <= tolerance
  );
}

/** Une ligne (ou colonne) est uniforme si toutes ses teintes tiennent en un cheveu. */
function isUniformLine(img: RgbaImage, index: number, horizontal: boolean): boolean {
  const { width: w, height: h, data } = img;
  const length = horizontal ? w : h;
  if (length < 8) return false;
  const first = horizontal ? index * w * 4 : index * 4;
  for (let k = 1; k < length; k++) {
    const i = horizontal ? (index * w + k) * 4 : (k * w + index) * 4;
    if (!near(data, first, i, 3)) return false;
  }
  return true;
}

/**
 * Ce que les pixels seuls laissent penser : 0 = photographique, 1 = interface.
 *
 * Les lignes uniformes pèsent le plus : une photo n'en a jamais une seule
 * entière, une interface en aligne des dizaines. Les couleurs pèsent peu — une
 * scène uniforme, un ciel, une photo de nuit en comptent peu elles aussi.
 */
export function syntheticScore(p: PixelPatterns): number {
  const bands = clamp01((p.uniformLineRatio - 0.02) / 0.18);
  // Un ciel lisse rend voisins beaucoup de pixels : le plancher est haut.
  const flat = clamp01((p.flatRatio - 0.25) / 0.45);
  const budget = Math.min(600, p.pixelCount / 8);
  const poor = budget > 0 ? clamp01((budget - p.colorCount) / budget) : 0;
  const pure = clamp01((p.pureRatio - 0.03) / 0.25);
  return clamp01(0.55 * bands + 0.3 * flat + 0.1 * poor + 0.05 * pure);
}

/* -------------------------------- Verdict --------------------------------- */

/**
 * Croise les indices et rend un verdict. `thumbnail` est la vignette d'analyse,
 * déjà décodée ailleurs : la passer ne coûte qu'un parcours de 256 × 256.
 */
export function assessAuthenticity(signals: AuthenticitySignals, thumbnail?: RgbaImage): AuthenticityVerdict {
  // La photothèque sait ce qu'elle range : quand elle le dit, rien à discuter.
  if (declaredScreenshot(signals.photo)) {
    return { artificiality: 1, reasons: ['La photothèque la déclare comme capture d’écran'] };
  }

  const evidence = metadataEvidence(signals);
  if (thumbnail) {
    const pixels = syntheticScore(pixelPatterns(thumbnail));
    if (pixels > 0.15) {
      evidence.push({ weight: 0.6 * pixels, reason: 'Aplats, lignes droites et couleurs pauvres : une interface, pas une scène' });
    }
  }

  const { score, reasons } = combine(evidence);
  const artificiality = clamp01(score * metadataMitigation(signals));
  // Un verdict tiède ne mérite pas d'être motivé : on ne montre les raisons que
  // lorsqu'elles pèsent vraiment sur le sort de la photo.
  return { artificiality, reasons: artificiality >= 0.3 ? reasons.slice(0, 3) : [] };
}

/** Seuil au-delà duquel une image est écartée par défaut. */
export const DEFAULT_MAX_ARTIFICIALITY = 0.6;
