import type { GrayImage, QualityMetrics, RgbaImage } from './types';

/** Convertit une image RGBA en niveaux de gris (Rec. 601). */
export function toGray(img: RgbaImage): GrayImage {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  const d = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = (d[j]! * 299 + d[j + 1]! * 587 + d[j + 2]! * 114) / 1000;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Réduit une image en niveaux de gris par moyenne de blocs (box filter). */
export function downscaleGray(img: GrayImage, targetW: number, targetH: number): GrayImage {
  const out = new Uint8Array(targetW * targetH);
  const sx = img.width / targetW;
  const sy = img.height / targetH;
  for (let ty = 0; ty < targetH; ty++) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < targetW; tx++) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        const row = y * img.width;
        for (let x = x0; x < x1 && x < img.width; x++) {
          sum += img.data[row + x]!;
          cnt++;
        }
      }
      out[ty * targetW + tx] = cnt ? sum / cnt : 0;
    }
  }
  return { width: targetW, height: targetH, data: out };
}

/** Variance du laplacien (mesure classique de netteté). */
export function laplacianVariance(img: GrayImage): number {
  const { width: w, height: h, data } = img;
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/** Statistiques de luminance : moyenne, écart-type, proportions de pixels brûlés / bouchés. */
export function lumaStats(img: GrayImage): { mean: number; std: number; clippedHigh: number; clippedLow: number } {
  const d = img.data;
  const n = d.length;
  if (n === 0) return { mean: 0, std: 0, clippedHigh: 0, clippedLow: 0 };
  let sum = 0;
  let sumSq = 0;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < n; i++) {
    const v = d[i]!;
    sum += v;
    sumSq += v * v;
    if (v >= 250) hi++;
    else if (v <= 5) lo++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { mean, std: Math.sqrt(variance), clippedHigh: hi / n, clippedLow: lo / n };
}

/** Indice de « colorfulness » de Hasler & Süsstrunk, ramené à 0..1. */
export function colorfulness(img: RgbaImage): number {
  const d = img.data;
  const n = img.width * img.height;
  if (n === 0) return 0;
  let rgSum = 0;
  let rgSq = 0;
  let ybSum = 0;
  let ybSq = 0;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = d[j]!;
    const g = d[j + 1]!;
    const b = d[j + 2]!;
    const rg = r - g;
    const yb = (r + g) / 2 - b;
    rgSum += rg;
    rgSq += rg * rg;
    ybSum += yb;
    ybSq += yb * yb;
  }
  const rgMean = rgSum / n;
  const ybMean = ybSum / n;
  const rgStd = Math.sqrt(Math.max(0, rgSq / n - rgMean * rgMean));
  const ybStd = Math.sqrt(Math.max(0, ybSq / n - ybMean * ybMean));
  const c = Math.sqrt(rgStd * rgStd + ybStd * ybStd) + 0.3 * Math.sqrt(rgMean * rgMean + ybMean * ybMean);
  // ~0 pour du gris, ~40 pour une image « colorée », >80 très saturée.
  return Math.min(1, c / 80);
}

/**
 * Calcule les métriques de qualité technique à partir d'une image RGBA réduite
 * (≈ 256 px de côté suffisent). Toutes les sorties sont dans 0..1.
 */
export function computeQuality(img: RgbaImage): QualityMetrics {
  const gray = toGray(img);
  const lapVar = laplacianVariance(gray);
  const { mean, std, clippedHigh, clippedLow } = lumaStats(gray);

  // Netteté : on sature autour de 400 (variance de laplacien sur une image 256 px).
  const sharpness = 1 - Math.exp(-lapVar / 250);

  // Exposition : luminance moyenne idéale ≈ 118 ; pénalité pour les zones écrêtées.
  const meanScore = Math.max(0, 1 - Math.abs(mean - 118) / 118);
  const clipPenalty = Math.min(1, (clippedHigh + clippedLow) * 4);
  const exposure = Math.max(0, meanScore * (1 - clipPenalty));

  // Contraste : écart-type ~ 60 est confortable.
  const contrast = Math.min(1, std / 60);

  return {
    sharpness,
    exposure,
    contrast,
    colorfulness: colorfulness(img),
    meanLuma: mean,
    laplacianVariance: lapVar,
  };
}

/** Score technique agrégé 0..1. */
export function technicalScore(q: QualityMetrics): number {
  return 0.5 * q.sharpness + 0.3 * q.exposure + 0.15 * q.contrast + 0.05 * q.colorfulness;
}
