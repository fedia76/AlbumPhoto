/**
 * Sondes des modules natifs : chaque module est chargé isolément et l'erreur
 * éventuelle est capturée. C'est ce qui permet, depuis le téléphone, de savoir
 * lequel manque ou échoue sans avoir accès à `logcat`.
 */
import { Platform } from 'react-native';
import { describeError } from './log';

export interface ProbeResult {
  name: string;
  /** Rôle du module dans l'application. */
  role: string;
  ok: boolean;
  detail: string;
  /** Le module est-il indispensable au démarrage ? */
  required: boolean;
}

function probe(name: string, role: string, required: boolean, fn: () => string): ProbeResult {
  try {
    return { name, role, required, ok: true, detail: fn() };
  } catch (e) {
    return { name, role, required, ok: false, detail: describeError(e).split('\n')[0] ?? 'échec' };
  }
}

/** Exécute toutes les sondes. Ne lève jamais. */
export function runProbes(): ProbeResult[] {
  return [
    probe('expo-file-system', 'Stockage des albums', true, () => {
      const fs = require('expo-file-system') as typeof import('expo-file-system');
      return fs.Paths.document.uri;
    }),
    probe('expo-media-library', 'Accès à la galerie', true, () => {
      const ml = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
      return typeof ml.getAssetsAsync === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('expo-image-manipulator', 'Vignettes et recadrage', true, () => {
      const im = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
      return typeof im.ImageManipulator?.manipulate === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('jpeg-js', 'Décodage des pixels', true, () => {
      const jpeg = require('jpeg-js') as { decode: unknown };
      return typeof jpeg.decode === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('@react-native-ml-kit/face-detection', 'Détection des visages', false, () => {
      const mod = require('@react-native-ml-kit/face-detection') as { default?: { detect?: unknown } };
      return typeof mod.default?.detect === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('@react-native-ml-kit/image-labeling', 'Étiquettes de contenu', false, () => {
      const mod = require('@react-native-ml-kit/image-labeling') as { default?: { label?: unknown } };
      return typeof mod.default?.label === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('onnxruntime-react-native', 'Reconnaissance des personnes', false, () => {
      const ort = require('onnxruntime-react-native') as { InferenceSession?: { create?: unknown } };
      return typeof ort.InferenceSession?.create === 'function' ? 'disponible' : 'API inattendue';
    }),
    probe('react-native-executorch', 'Légendes par LLM local', false, () => {
      const rne = require('react-native-executorch') as { isAvailable?: boolean };
      return rne.isAvailable ? 'disponible' : 'runtime natif absent (repli sur les gabarits)';
    }),
  ];
}

export function environmentSummary(): string {
  const lines = [
    `Plateforme : ${Platform.OS} ${String(Platform.Version)}`,
    `Moteur JS : ${typeof (globalThis as { HermesInternal?: unknown }).HermesInternal === 'object' ? 'Hermes' : 'JSC'}`,
  ];
  try {
    const c = require('../config') as { APP_GENERATOR: string };
    lines.push(`Application : ${c.APP_GENERATOR}`);
  } catch {
    // sans importance
  }
  return lines.join('\n');
}
