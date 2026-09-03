import type { InferenceSession } from 'onnxruntime-react-native';
import { Directory, File, Paths } from 'expo-file-system';
import {
  PIXEL_EMBEDDING_THRESHOLD,
  cropRgba,
  pixelFaceEmbedding,
  type DetectedFace,
  type FaceEmbedder,
  type PixelReader,
  type SourcePhoto,
} from '@albumphoto/core';
import { ANALYSIS_THUMBNAIL, FACE_MODEL_CLUSTER_THRESHOLD, FACE_MODEL_FILENAME, FACE_MODEL_INPUT_SIZE, FACE_MODEL_MD5, FACE_MODEL_URL } from '../config';
import { resolveFileUri } from './fileUri';
import { decodeJpegBase64, renderJpegBase64 } from './pixels';
import { log } from '../diagnostics/log';
import { isOnnxRuntimeLinked } from './nativeAvailability';

type OnnxModule = typeof import('onnxruntime-react-native');

/**
 * Chargement paresseux d'ONNX Runtime, précédé d'une vérification du module
 * natif : son import exécute `install()` dessus, et une exception à
 * l'évaluation d'un module est fatale (voir `nativeAvailability`).
 */
function loadOnnx(): OnnxModule {
  if (!isOnnxRuntimeLinked()) {
    throw new Error("ONNX Runtime n'est pas lié dans cette version de l'application.");
  }
  const mod = require('onnxruntime-react-native') as OnnxModule;
  if (typeof mod.InferenceSession?.create !== 'function') {
    throw new Error("ONNX Runtime n'est pas disponible sur cet appareil.");
  }
  return mod;
}

export interface EmbedderWithThreshold extends FaceEmbedder {
  readonly name: string;
  /** Seuil de similarité cosinus conseillé pour le regroupement. */
  readonly clusterThreshold: number;
}

/** Embedding de repli (sans modèle) : pixels du visage normalisés. */
export class PixelFaceEmbedder implements EmbedderWithThreshold {
  readonly name = 'pixels';
  readonly clusterThreshold = PIXEL_EMBEDDING_THRESHOLD;
  constructor(private readonly pixels: PixelReader) {}

  async embed(photo: SourcePhoto, faces: DetectedFace[]): Promise<Float32Array[]> {
    const img = await this.pixels.readThumbnail(photo, ANALYSIS_THUMBNAIL);
    return faces.map((f) => pixelFaceEmbedding(cropRgba(img, f.rect, 0.1)));
  }
}

function modelsDir(): Directory {
  return new Directory(Paths.document, 'models');
}

export function faceModelFile(): File {
  return new File(modelsDir(), FACE_MODEL_FILENAME);
}

function modelIsValid(file: File): boolean {
  if (!file.exists) return false;
  const md5 = file.md5;
  // Sans MD5 disponible (rare), on fait confiance à la taille non nulle.
  return md5 ? md5.toLowerCase() === FACE_MODEL_MD5 : file.size > 0;
}

/**
 * Télécharge le modèle ONNX s'il est configuré et absent (ou corrompu).
 * Renvoie `true` si un modèle valide est disponible. Ne lève jamais : sans
 * réseau, l'application se rabat sur l'embedding par pixels.
 */
export async function ensureFaceModel(onProgress?: (p: number) => void): Promise<boolean> {
  const file = faceModelFile();
  if (modelIsValid(file)) return true;
  if (!FACE_MODEL_URL) return false;
  try {
    if (file.exists) file.delete();
    modelsDir().create({ intermediates: true, idempotent: true });
    onProgress?.(0);
    await File.downloadFileAsync(FACE_MODEL_URL, file, { idempotent: true });
    onProgress?.(1);
    if (modelIsValid(file)) return true;
    log('warn', 'Modèle de visage téléchargé mais invalide (MD5), suppression');
    if (file.exists) file.delete();
    return false;
  } catch (e) {
    log('warn', 'Téléchargement du modèle de visage impossible', e);
    return false;
  }
}

/**
 * Embedding par réseau de neurones (ONNX Runtime, sur l'appareil).
 * Contrat du modèle : entrée `1×3×S×S` float32 RGB normalisée (x − 127.5) / 127.5, sortie `1×D`.
 */
export class OnnxFaceEmbedder implements EmbedderWithThreshold {
  readonly name = 'onnx-mobilefacenet';
  readonly clusterThreshold = FACE_MODEL_CLUSTER_THRESHOLD;
  private session?: InferenceSession;

  static async createIfAvailable(): Promise<OnnxFaceEmbedder | null> {
    const file = faceModelFile();
    if (!modelIsValid(file)) return null;
    const { InferenceSession } = loadOnnx();
    const e = new OnnxFaceEmbedder();
    e.session = await InferenceSession.create(file.uri.replace(/^file:\/\//, ''));
    return e;
  }

  async embed(photo: SourcePhoto, faces: DetectedFace[]): Promise<Float32Array[]> {
    const session = this.session;
    if (!session) throw new Error('Modèle non chargé');
    const uri = await resolveFileUri(photo);
    const S = FACE_MODEL_INPUT_SIZE;
    const out: Float32Array[] = [];
    for (const f of faces) {
      const margin = 0.15;
      const originX = Math.max(0, Math.round((f.rect.x - f.rect.w * margin) * photo.width));
      const originY = Math.max(0, Math.round((f.rect.y - f.rect.h * margin) * photo.height));
      const width = Math.min(photo.width - originX, Math.round(f.rect.w * (1 + 2 * margin) * photo.width));
      const height = Math.min(photo.height - originY, Math.round(f.rect.h * (1 + 2 * margin) * photo.height));
      const { base64 } = await renderJpegBase64(uri, { crop: { originX, originY, width, height }, resize: { width: S, height: S }, compress: 0.95 });
      const img = decodeJpegBase64(base64);
      const input = new Float32Array(3 * S * S);
      for (let i = 0; i < S * S; i++) {
        input[i] = (img.data[i * 4]! - 127.5) / 127.5;
        input[S * S + i] = (img.data[i * 4 + 1]! - 127.5) / 127.5;
        input[2 * S * S + i] = (img.data[i * 4 + 2]! - 127.5) / 127.5;
      }
      const { Tensor } = loadOnnx();
      const inputName = session.inputNames[0]!;
      const result = await session.run({ [inputName]: new Tensor('float32', input, [1, 3, S, S]) });
      const first = result[session.outputNames[0]!];
      const data = first?.data as Float32Array | undefined;
      out.push(data ? Float32Array.from(data) : new Float32Array(0));
    }
    return out;
  }
}

/** Choisit le meilleur embedder disponible (télécharge le modèle si besoin). */
export async function createFaceEmbedder(pixels: PixelReader, onModelDownload?: (p: number) => void): Promise<EmbedderWithThreshold> {
  try {
    await ensureFaceModel(onModelDownload);
    const onnx = await OnnxFaceEmbedder.createIfAvailable();
    if (onnx) return onnx;
  } catch (e) {
    log('warn', 'Modèle de reconnaissance indisponible, repli sur les pixels', e);
  }
  return new PixelFaceEmbedder(pixels);
}
