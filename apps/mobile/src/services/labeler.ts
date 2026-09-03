import ImageLabeling from '@react-native-ml-kit/image-labeling';
import { usefulLabels, type ImageLabeler, type SourcePhoto } from '@albumphoto/core';
import { resolveFileUri } from './fileUri';

/** Étiquetage de contenu par ML Kit (sur l'appareil), traduit pour les légendes. */
export class MlKitImageLabeler implements ImageLabeler {
  constructor(private readonly locale: string) {}

  async label(photo: SourcePhoto): Promise<string[]> {
    const uri = await resolveFileUri(photo);
    const labels = await ImageLabeling.label(uri);
    return usefulLabels(labels, this.locale);
  }
}
