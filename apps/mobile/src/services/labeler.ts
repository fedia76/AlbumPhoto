import type { ImageLabeler, LabelHit, SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';
import { log } from '../diagnostics/log';

type MlKitLabelModule = typeof import('@react-native-ml-kit/image-labeling');

/**
 * Étiquetage de contenu par ML Kit, sur l'appareil. Les étiquettes sont rendues
 * telles quelles : le cœur en tire les mots-clés des légendes d'un côté, les
 * indices de capture d'écran de l'autre.
 */
export class MlKitImageLabeler implements ImageLabeler {
  private warned = false;

  async label(photo: SourcePhoto): Promise<LabelHit[]> {
    let api: MlKitLabelModule['default'];
    try {
      // Chargement paresseux : un module natif manquant ne doit pas être fatal.
      const mod = require('@react-native-ml-kit/image-labeling') as MlKitLabelModule;
      if (!mod.default || typeof mod.default.label !== 'function') {
        throw new Error("Le module natif d'étiquetage n'est pas disponible.");
      }
      api = mod.default;
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        log('warn', 'Étiquetage de contenu indisponible : légendes sans mots-clés', e);
      }
      return [];
    }
    const uri = await resolveFileUri(photo);
    return api.label(uri);
  }
}
