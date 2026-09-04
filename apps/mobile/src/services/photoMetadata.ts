import * as MediaLibrary from 'expo-media-library/legacy';
import { Dimensions, PixelRatio } from 'react-native';
import type { DeviceContext, PhotoMetadataReader, SourcePhoto } from '@albumphoto/core';
import { log } from '../diagnostics/log';

/**
 * Clés EXIF du fabricant et du modèle. Android rend un objet plat, iOS range
 * les mêmes valeurs sous le bloc TIFF ; les deux formes sont acceptées.
 */
const MAKE_KEYS = ['Make', 'make', 'TIFF:Make'];
const MODEL_KEYS = ['Model', 'model', 'TIFF:Model'];

function pick(exif: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!exif) return undefined;
  for (const key of keys) {
    const value = exif[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const tiff = exif['{TIFF}'] ?? exif.TIFF;
  if (tiff && typeof tiff === 'object') return pick(tiff as Record<string, unknown>, keys);
  return undefined;
}

/**
 * Lit le fabricant et le modèle inscrits par l'appareil au moment du
 * déclenchement. Leur absence est le signe le plus général qu'une image n'est
 * pas sortie d'un capteur : capture d'écran, image reçue, mème, illustration.
 */
export class MediaLibraryMetadataReader implements PhotoMetadataReader {
  private warned = false;

  async read(photo: SourcePhoto): Promise<{ make?: string; model?: string }> {
    try {
      const info = await MediaLibrary.getAssetInfoAsync(photo.id, { shouldDownloadFromNetwork: false });
      const exif = info.exif as Record<string, unknown> | undefined;
      const make = pick(exif, MAKE_KEYS);
      const model = pick(exif, MODEL_KEYS);
      return { ...(make ? { make } : {}), ...(model ? { model } : {}) };
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        log('warn', 'Métadonnées EXIF illisibles : tri des captures d’écran moins sûr', e);
      }
      // Un EXIF illisible n'est pas un EXIF vide : ne rien conclure.
      throw e;
    }
  }
}

/**
 * Résolution de l'écran en pixels réels. Une capture d'écran a exactement ces
 * dimensions ; `Dimensions` les donne en points, d'où la multiplication.
 */
export function deviceContext(): DeviceContext {
  const { width, height } = Dimensions.get('screen');
  const scale = PixelRatio.get() || 1;
  return { screen: { width: Math.round(width * scale), height: Math.round(height * scale) } };
}
