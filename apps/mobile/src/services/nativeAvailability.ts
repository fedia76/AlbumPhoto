import { NativeModules, TurboModuleRegistry } from 'react-native';

/**
 * Disponibilité des modules natifs, testée **sans les importer**.
 *
 * C'est essentiel : quand un module lève une exception pendant son évaluation,
 * Metro ne la propage pas à l'appelant mais la signale comme erreur fatale
 * (`guardedLoadModule` appelle `ErrorUtils.reportFatalError`). Un `try/catch`
 * autour du `require` ne protège donc de rien. La seule parade est de ne
 * charger un module que si sa partie native répond.
 */

/** ONNX Runtime : `binding.ts` appelle `Module.install()` dès l'import. */
export function isOnnxRuntimeLinked(): boolean {
  try {
    return NativeModules.Onnxruntime != null;
  } catch {
    return false;
  }
}

/** ExecuTorch : son `index.js` lève une exception si `ETInstaller` est absent. */
export function isExecutorchLinked(): boolean {
  try {
    return TurboModuleRegistry.get('ETInstaller') != null;
  } catch {
    return false;
  }
}

/** ML Kit : l'import est sûr, l'accès à l'API lève si le module manque. */
export function isMlKitFaceDetectionLinked(): boolean {
  try {
    return NativeModules.FaceDetection != null;
  } catch {
    return false;
  }
}

export function isMlKitImageLabelingLinked(): boolean {
  try {
    return NativeModules.ImageLabeling != null;
  } catch {
    return false;
  }
}
