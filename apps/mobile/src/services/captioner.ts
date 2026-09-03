import type { LLMModule } from 'react-native-executorch';
import {
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  sanitizeCaption,
  type CaptionGenerator,
  type CaptionRequest,
} from '@albumphoto/core';
import { log } from '../diagnostics/log';
import { isExecutorchLinked } from './nativeAvailability';

type ExecutorchModule = typeof import('react-native-executorch');

/** Nom du modèle, en dur : le lire depuis le module chargerait sa partie native. */
const LLM_MODEL_NAME = 'qwen3-0.6b-quantized';

/**
 * Chargement paresseux de react-native-executorch, précédé d'une vérification
 * du module natif : son import lève une exception quand le runtime est absent
 * (ABI non gérée), et une telle exception est fatale (voir `nativeAvailability`).
 */
function loadExecutorch(): ExecutorchModule {
  if (!isExecutorchLinked()) {
    throw new Error("Le module natif ExecuTorch n'est pas disponible sur cet appareil.");
  }
  const mod = require('react-native-executorch') as ExecutorchModule;
  if (!mod.isAvailable) {
    throw new Error("Le runtime ExecuTorch n'est pas disponible sur cet appareil.");
  }
  return mod;
}

/** Le LLM local peut-il fonctionner ici ? Ne lève jamais. */
export function isLocalLlmAvailable(): boolean {
  try {
    loadExecutorch();
    return true;
  } catch {
    return false;
  }
}

/** Retire les blocs de réflexion des modèles « thinking » (Qwen 3). */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
}

/**
 * Légendes par LLM local (react-native-executorch). Le modèle est téléchargé
 * une fois puis exécuté sur l'appareil. En cas d'échec, repli sur les gabarits.
 */
export class LocalLlmCaptionGenerator implements CaptionGenerator {
  readonly name = LLM_MODEL_NAME;
  private llm?: LLMModule;
  private loading?: Promise<LLMModule>;
  private readonly fallback = new TemplateCaptionGenerator();

  constructor(private readonly onDownloadProgress?: (p: number) => void) {}

  load(): Promise<LLMModule> {
    if (!this.loading) {
      const { LLMModule: Module, QWEN3_0_6B_QUANTIZED } = loadExecutorch();
      this.loading = Module.fromModelName(QWEN3_0_6B_QUANTIZED, this.onDownloadProgress).then((llm) => {
        llm.configure({ generationConfig: { temperature: 0.7, topP: 0.9 } });
        this.llm = llm;
        return llm;
      });
    }
    return this.loading;
  }

  async generate(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    try {
      const llm = await this.load();
      if (signal?.aborted) throw new Error('aborted');
      const { system, user } = buildCaptionPrompt(req);
      const onAbort = () => llm.interrupt();
      signal?.addEventListener('abort', onAbort);
      let raw: string;
      try {
        raw = await llm.generate([
          { role: 'system', content: system },
          { role: 'user', content: user + '\n/no_think' },
        ]);
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
      const text = sanitizeCaption(stripThinking(raw), req.maxLength);
      if (text.length >= 3) return text;
    } catch (e) {
      this.loading = undefined;
      log('warn', 'LLM local indisponible, repli sur les gabarits', e);
    }
    return this.fallback.generate(req);
  }

  release(): void {
    try {
      this.llm?.delete();
    } catch {
      // déjà libéré
    }
    this.llm = undefined;
    this.loading = undefined;
  }
}

export type CaptionEngine = 'llm' | 'template';

export function createCaptionGenerator(engine: CaptionEngine, onDownloadProgress?: (p: number) => void): CaptionGenerator {
  return engine === 'llm' ? new LocalLlmCaptionGenerator(onDownloadProgress) : new TemplateCaptionGenerator();
}
