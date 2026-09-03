import type { DetectedFace, FaceDetector, SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';
import { log } from '../diagnostics/log';

type MlKitFaceModule = typeof import('@react-native-ml-kit/face-detection');

/**
 * Chargement paresseux : le module natif ne doit être touché qu'au moment de
 * l'analyse. Une exception à l'import fermerait sinon l'application au démarrage.
 */
function loadModule(): MlKitFaceModule['default'] {
  const mod = require('@react-native-ml-kit/face-detection') as MlKitFaceModule;
  const api = mod.default;
  if (!api || typeof api.detect !== 'function') {
    throw new Error("Le module natif de détection des visages n'est pas disponible.");
  }
  return api;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Détection de visages par Google ML Kit (100 % sur l'appareil). */
export class MlKitFaceDetector implements FaceDetector {
  private warned = false;

  async detect(photo: SourcePhoto): Promise<DetectedFace[]> {
    let api: MlKitFaceModule['default'];
    try {
      api = loadModule();
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        log('warn', 'Détection des visages indisponible : analyse sans visages', e);
      }
      return [];
    }
    const uri = await resolveFileUri(photo);
    const faces = await api.detect(uri, {
      performanceMode: 'accurate',
      classificationMode: 'all',
      landmarkMode: 'none',
      minFaceSize: 0.05,
    });
    return faces.map((f) => {
      const face: DetectedFace = {
        rect: {
          x: clamp01(f.frame.left / photo.width),
          y: clamp01(f.frame.top / photo.height),
          w: clamp01(f.frame.width / photo.width) || 0.01,
          h: clamp01(f.frame.height / photo.height) || 0.01,
        },
        headEulerAngleY: f.rotationY,
        headEulerAngleZ: f.rotationZ,
      };
      if (f.smilingProbability !== undefined) face.smilingProbability = f.smilingProbability;
      if (f.leftEyeOpenProbability !== undefined) face.leftEyeOpenProbability = f.leftEyeOpenProbability;
      if (f.rightEyeOpenProbability !== undefined) face.rightEyeOpenProbability = f.rightEyeOpenProbability;
      return face;
    });
  }
}
