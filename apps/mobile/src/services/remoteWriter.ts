import Anthropic from '@anthropic-ai/sdk';
import {
  buildCaptionPrompt,
  buildProposalsPrompt,
  parseCaptionProposals,
  sanitizeCaption,
  type CaptionOption,
  type CaptionRequest,
} from '@albumphoto/core';
import { log } from '../diagnostics/log';
import { readApiKey } from './apiKey';

/**
 * Rédacteur de légendes en ligne (Claude Haiku 4.5).
 *
 * Ce qui sort de l'appareil : la description que le modèle vision a produite,
 * les prénoms que vous avez saisis, la date, l'événement et le titre de
 * l'album. **Jamais la photo.** Rien n'est envoyé si le moteur en ligne n'est
 * pas explicitement choisi dans l'assistant.
 *
 * Écrire une légende de 90 caractères ne demande ni réflexion étendue ni
 * réglage d'effort — Haiku 4.5 ne les accepte d'ailleurs pas.
 */

/** Haiku 4.5 : le plus rapide et le moins cher, largement suffisant ici. */
export const REMOTE_MODEL = 'claude-haiku-4-5';
/** Une légende tient en quelques dizaines de jetons ; le reste est du gâchis. */
const MAX_TOKENS = 200;
/** Vingt propositions demandent de la place, mais restent brèves. */
const PROPOSALS_MAX_TOKENS = 1_500;
/** Au-delà, le réseau est en cause : la légende locale prendra le relais. */
const TIMEOUT_MS = 20_000;

export class RemoteCaptionWriter {
  private client: Anthropic | null = null;
  private unavailable: string | null = null;
  /** Jetons consommés sur l'album, pour dire ce que cela a coûté. */
  readonly usage = { requests: 0, inputTokens: 0, outputTokens: 0 };

  /** Raison pour laquelle le rédacteur en ligne n'a pas pu servir. */
  get failureReason(): string | null {
    return this.unavailable;
  }

  /** Charge la clé et prépare le client. Ne lève jamais. */
  async prepare(): Promise<boolean> {
    if (this.client) return true;
    if (this.unavailable) return false;
    const apiKey = await readApiKey();
    if (!apiKey) {
      this.unavailable = "Aucune clé d'API enregistrée.";
      return false;
    }
    // React Native n'est pas un navigateur (pas de `window.document`), mais
    // l'usage reste côté client : la clé est celle de l'utilisateur, sur son
    // propre appareil, et c'est lui qui l'y a mise.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: TIMEOUT_MS, maxRetries: 1 });
    return true;
  }

  /**
   * Écrit la légende à partir de la description et des faits. Renvoie une
   * chaîne vide si le rédacteur n'a rien pu produire — l'appelant se rabat
   * alors sur ce qu'il a sous la main.
   */
  async write(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    if (!(await this.prepare()) || !this.client) return '';
    const { system, user } = buildCaptionPrompt(req);
    try {
      const response = await this.client.messages.create(
        {
          model: REMOTE_MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: user }],
        },
        signal ? { signal } : {},
      );
      this.record(response);
      if (response.stop_reason === 'refusal') {
        log('warn', `Légende refusée par le rédacteur en ligne (${response.stop_details?.category ?? 'sans motif'}).`);
        return '';
      }
      return sanitizeCaption(this.textOf(response), req.maxLength);
    } catch (e) {
      this.recordFailure(e);
      return '';
    }
  }

  /**
   * Demande une série de légendes — plusieurs par style — en un seul appel.
   * Un appel par photo plutôt que cinq : le rédacteur voit l'éventail qu'il
   * produit et se répète moins d'un style à l'autre, pour un coût moindre.
   */
  async propose(req: CaptionRequest, signal?: AbortSignal): Promise<CaptionOption[]> {
    if (!(await this.prepare()) || !this.client) return [];
    const { system, user } = buildProposalsPrompt(req);
    try {
      const response = await this.client.messages.create(
        {
          model: REMOTE_MODEL,
          max_tokens: PROPOSALS_MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: user }],
        },
        signal ? { signal } : {},
      );
      this.record(response);
      if (response.stop_reason === 'refusal') return [];
      return parseCaptionProposals(this.textOf(response), req.maxLength);
    } catch (e) {
      this.recordFailure(e);
      return [];
    }
  }

  private record(response: Anthropic.Message): void {
    this.usage.requests++;
    this.usage.inputTokens += response.usage.input_tokens;
    this.usage.outputTokens += response.usage.output_tokens;
  }

  private textOf(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }

  /** Coût de l'album, pour le journal. Tarifs Haiku 4.5 : 1 $ / 5 $ le million. */
  costSummary(): string {
    const dollars = (this.usage.inputTokens / 1e6) * 1 + (this.usage.outputTokens / 1e6) * 5;
    return `${this.usage.requests} appel(s), ${this.usage.inputTokens} jetons d'entrée / ${this.usage.outputTokens} de sortie, environ ${dollars.toFixed(3)} $`;
  }

  /**
   * Une clé invalide ou un quota épuisé condamnent tout l'album : inutile de
   * relancer douze fois. Une panne réseau ponctuelle, en revanche, n'empêche
   * pas la photo suivante d'aboutir.
   */
  private recordFailure(error: unknown): void {
    if (error instanceof Anthropic.AuthenticationError) {
      this.unavailable = "Clé d'API refusée. Vérifiez-la dans l'assistant.";
    } else if (error instanceof Anthropic.PermissionDeniedError) {
      this.unavailable = "Cette clé d'API n'a pas accès au modèle.";
    } else if (error instanceof Anthropic.RateLimitError) {
      this.unavailable = 'Quota ou limite de débit atteint sur votre compte.';
    } else if (error instanceof Anthropic.BadRequestError) {
      this.unavailable = `Requête refusée : ${error.message}`;
    }
    log(this.unavailable ? 'warn' : 'info', `Rédacteur en ligne : ${this.unavailable ?? 'échec ponctuel, la photo suivante réessaiera'}`, error);
  }
}
