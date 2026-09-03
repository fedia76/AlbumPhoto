import type { PipelineAdapters } from '@albumphoto/core';
import { DevicePhotoSource } from './photoSource';
import { ManipulatorPixelReader } from './pixels';
import { MlKitFaceDetector } from './faceDetector';
import { createFaceEmbedder, type EmbedderWithThreshold } from './faceEmbedder';
import { MlKitImageLabeler } from './labeler';
import { createCaptionGenerator, type CaptionEngine } from './captioner';
import { BundlePhotoImporter } from './importer';

export interface AppAdapters extends PipelineAdapters {
  embedder: EmbedderWithThreshold;
}

/** Assemble les adaptateurs natifs pour le pipeline IA du cœur. */
export async function createAdapters(opts: { locale: string; captionEngine: CaptionEngine; onModelDownload?: (p: number) => void }): Promise<AppAdapters> {
  const pixels = new ManipulatorPixelReader();
  const embedder = await createFaceEmbedder(pixels);
  return {
    source: new DevicePhotoSource(),
    pixels,
    faces: new MlKitFaceDetector(),
    embedder,
    labeler: new MlKitImageLabeler(opts.locale),
    captions: createCaptionGenerator(opts.captionEngine, opts.onModelDownload),
    importer: new BundlePhotoImporter(),
  };
}

export { ensureMediaPermission } from './photoSource';
export { resolveFileUri } from './fileUri';
