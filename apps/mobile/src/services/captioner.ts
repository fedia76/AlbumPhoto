import { LLMModule, QWEN3_0_6B_QUANTIZED } from 'react-native-executorch';
import {
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  sanitizeCaption,
  type CaptionGenerator,
  type CaptionRequest,
} from '@albumphoto/core';

/** Retire les blocs de réflexion des modèles « thinking » (Qwen 3). */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
}

/**
 * Légendes par LLM local (react-native-executorch). Le modèle est téléchargé
 * une fois puis exécuté sur l'appareil. En cas d'échec, repli sur les gabarits.
 */
export class LocalLlmCaptionGenerator implements CaptionGenerator {
  readonly name = QWEN3_0_6B_QUANTIZED.modelName;
  private llm?: LLMModule;
  private loading?: Promise<LLMModule>;
  private readonly fallback = new TemplateCaptionGenerator();

  constructor(private readonly onDownloadProgress?: (p: number) => void) {}

  load(): Promise<LLMModule> {
    if (!this.loading) {
      this.loading = LLMModule.fromModelName(QWEN3_0_6B_QUANTIZED, this.onDownloadProgress).then((llm) => {
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
      console.warn('LLM local indisponible, repli sur les gabarits', e);
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
