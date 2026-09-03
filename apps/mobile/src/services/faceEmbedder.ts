import { InferenceSession, Tensor } from 'onnxruntime-react-native';
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
import { ANALYSIS_THUMBNAIL, FACE_MODEL_FILENAME, FACE_MODEL_INPUT_SIZE, FACE_MODEL_URL } from '../config';
import { resolveFileUri } from './fileUri';
import { decodeJpegBase64, renderJpegBase64 } from './pixels';

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

/** Télécharge le modèle ONNX s'il est configuré et absent. Renvoie `true` s'il est disponible. */
export async function ensureFaceModel(onProgress?: (p: number) => void): Promise<boolean> {
  const file = faceModelFile();
  if (file.exists) return true;
  if (!FACE_MODEL_URL) return false;
  modelsDir().create({ intermediates: true, idempotent: true });
  onProgress?.(0);
  await File.downloadFileAsync(FACE_MODEL_URL, file, { idempotent: true });
  onProgress?.(1);
  return file.exists;
}

/**
 * Embedding par réseau de neurones (ONNX Runtime, sur l'appareil).
 * Contrat du modèle : entrée `1×3×S×S` float32 normalisée (x − 127.5) / 128, sortie `1×D`.
 */
export class OnnxFaceEmbedder implements EmbedderWithThreshold {
  readonly name = 'onnx-mobilefacenet';
  readonly clusterThreshold = 0.6;
  private session?: InferenceSession;

  static async createIfAvailable(): Promise<OnnxFaceEmbedder | null> {
    const file = faceModelFile();
    if (!file.exists) return null;
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
        input[i] = (img.data[i * 4]! - 127.5) / 128;
        input[S * S + i] = (img.data[i * 4 + 1]! - 127.5) / 128;
        input[2 * S * S + i] = (img.data[i * 4 + 2]! - 127.5) / 128;
      }
      const inputName = session.inputNames[0]!;
      const result = await session.run({ [inputName]: new Tensor('float32', input, [1, 3, S, S]) });
      const first = result[session.outputNames[0]!];
      const data = first?.data as Float32Array | undefined;
      out.push(data ? Float32Array.from(data) : new Float32Array(0));
    }
    return out;
  }
}

/** Choisit le meilleur embedder disponible. */
export async function createFaceEmbedder(pixels: PixelReader): Promise<EmbedderWithThreshold> {
  try {
    const onnx = await OnnxFaceEmbedder.createIfAvailable();
    if (onnx) return onnx;
  } catch (e) {
    console.warn('Modèle de visage indisponible, repli sur les pixels', e);
  }
  return new PixelFaceEmbedder(pixels);
}
