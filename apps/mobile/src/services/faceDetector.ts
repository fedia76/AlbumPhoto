import FaceDetection from '@react-native-ml-kit/face-detection';
import type { DetectedFace, FaceDetector, SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Détection de visages par Google ML Kit (100 % sur l'appareil). */
export class MlKitFaceDetector implements FaceDetector {
  async detect(photo: SourcePhoto): Promise<DetectedFace[]> {
    const uri = await resolveFileUri(photo);
    const faces = await FaceDetection.detect(uri, {
      performanceMode: 'accurate',
      classificationMode: 'all',
      landmarkMode: 'none',
      minFaceSize: 0.05,
    });
    return faces.map((f) => {
      const x = clamp01(f.frame.left / photo.width);
      const y = clamp01(f.frame.top / photo.height);
      const face: DetectedFace = {
        rect: {
          x,
          y,
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
