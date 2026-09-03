import type { LLMModule } from 'react-native-executorch';
import {
  DEFAULT_CAPTION_MAX_LENGTH,
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  hasEnoughText,
  sanitizeCaption,
  stripThinking,
  type CaptionGenerator,
  type CaptionRequest,
} from '@albumphoto/core';
import { log } from '../diagnostics/log';
import { isExecutorchLinked } from './nativeAvailability';

type ExecutorchModule = typeof import('react-native-executorch');
type ResourceFetcherModule = typeof import('react-native-executorch-expo-resource-fetcher');

/** `initExecutorch` n'est à appeler qu'une fois par session. */
let resourceFetcherReady = false;

/** Nom du modèle, en dur : le lire depuis le module chargerait sa partie native. */
const LLM_MODEL_NAME = 'qwen3-0.6b-quantized';

/**
 * Réglages d'échantillonnage. `repetitionPenalty` compte : rien ne borne le
 * nombre de jetons produits côté natif, et un petit modèle qui se répète peut
 * écrire jusqu'à saturer sa fenêtre de contexte — soit plusieurs minutes pour
 * une seule légende. Les lots de jetons sont volontairement courts et fréquents :
 * ils servent aussi de signe de vie et permettent de couper au bon moment.
 */
const GENERATION_CONFIG = {
  temperature: 0.7,
  topP: 0.9,
  repetitionPenalty: 1.1,
  outputTokenBatchSize: 8,
  batchTimeInterval: 300,
} as const;

/** Durée maximale d'une légende avant interruption du modèle. */
const GENERATION_TIMEOUT_MS = 40_000;
/** Silence maximal entre deux lots de jetons : au-delà, le modèle est bloqué. */
const TOKEN_SILENCE_MS = 15_000;
/** Délai laissé au moteur natif pour rendre la main après une interruption. */
const INTERRUPT_GRACE_MS = 15_000;
/** Cadence des signes de vie envoyés à l'interface pendant une génération. */
const HEARTBEAT_MS = 1_000;
/** Motif d'interruption normal : la légende est écrite, le reste est superflu. */
const ENOUGH = 'texte suffisant';
/** Échecs consécutifs avant de renoncer au modèle pour le reste de l'album. */
const MAX_CONSECUTIVE_FAILURES = 2;

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
  if (!resourceFetcherReady) {
    // Depuis la version 0.9, le téléchargement des modèles passe par un
    // « resource fetcher » explicite. Sans lui, tout chargement de modèle
    // échoue et l'application se rabat silencieusement sur les gabarits.
    const { ExpoResourceFetcher } = require('react-native-executorch-expo-resource-fetcher') as ResourceFetcherModule;
    mod.initExecutorch({ resourceFetcher: ExpoResourceFetcher });
    resourceFetcherReady = true;
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

/** Signe de vie pendant l'écriture d'une légende, pour l'affichage. */
export interface CaptionActivity {
  phase: 'loading' | 'generating';
  /** Rang de la légende en cours, à partir de 1. */
  index: number;
  /** Caractères déjà produits par le modèle pour cette légende. */
  chars: number;
  elapsedMs: number;
}

/** Comptes de l'album, pour le journal et le message de fin. */
export interface CaptionStats {
  /** Légendes écrites par le modèle. */
  model: number;
  /** Légendes issues des gabarits (échec, blocage ou modèle abandonné). */
  template: number;
  /** Générations coupées court (assez de texte, silence ou délai dépassé). */
  interrupted: number;
  /** Générations dont le moteur natif n'a jamais rendu la main. */
  stuck: number;
  /** Temps cumulé passé dans le modèle, en millisecondes. */
  totalMs: number;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Attend `promise` au plus `ms` millisecondes, sans la rejeter : une promesse
 * qui ne se dénoue jamais — c'est le cas d'une génération native bloquée —
 * doit pouvoir être laissée derrière soi.
 */
async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ done: true as const, value })), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Légendes par LLM local (react-native-executorch). Le modèle est téléchargé
 * une fois puis exécuté sur l'appareil. En cas d'échec, repli sur les gabarits.
 *
 * Rien, côté natif, ne borne la longueur d'une réponse : la génération est donc
 * surveillée de bout en bout (signes de vie, budget de texte, délai) et
 * interrompue dès qu'une légende est complète. Chaque étape est journalisée :
 * sans ordinateur, le journal de l'application est le seul moyen de savoir où
 * une génération s'est arrêtée.
 */
export class LocalLlmCaptionGenerator implements CaptionGenerator {
  readonly name = LLM_MODEL_NAME;
  private llm?: LLMModule;
  private loading?: Promise<LLMModule>;
  private readonly fallback = new TemplateCaptionGenerator();
  /** Renseigné dès l'abandon du modèle : inutile de retenter à chaque légende. */
  private unavailable: string | null = null;
  /** Génération encore en cours côté natif : la suivante doit l'attendre. */
  private pending: Promise<unknown> = Promise.resolve();
  /** Destinataire des lots de jetons de la génération en cours. */
  private sink: ((token: string) => void) | null = null;
  private index = 0;
  private consecutiveFailures = 0;
  readonly stats: CaptionStats = { model: 0, template: 0, interrupted: 0, stuck: 0, totalMs: 0 };

  constructor(
    private readonly onDownloadProgress?: (p: number) => void,
    private readonly onActivity?: (a: CaptionActivity) => void,
  ) {}

  load(): Promise<LLMModule> {
    if (!this.loading) {
      const { LLMModule: Module, QWEN3_0_6B_QUANTIZED } = loadExecutorch();
      const startedAt = Date.now();
      log('info', `Chargement du modèle de légendes « ${LLM_MODEL_NAME} »…`);
      this.loading = Module.fromModelName(QWEN3_0_6B_QUANTIZED, this.onDownloadProgress, (token) => this.sink?.(token)).then(
        (llm) => {
          llm.configure({ generationConfig: { ...GENERATION_CONFIG } });
          log('info', `Modèle de légendes prêt en ${seconds(Date.now() - startedAt)}.`);
          this.llm = llm;
          return llm;
        },
      );
    }
    return this.loading;
  }

  /** Raison pour laquelle le LLM local n'a pas pu servir, le cas échéant. */
  get fallbackReason(): string | null {
    return this.unavailable;
  }

  /** Bilan lisible de l'album, pour le journal et l'écran de fin. */
  summary(): string {
    const s = this.stats;
    const parts = [`${s.model} légende(s) par le modèle`, `${s.template} par gabarits`];
    if (s.interrupted) parts.push(`${s.interrupted} coupée(s) court`);
    if (s.stuck) parts.push(`${s.stuck} sans réponse du moteur`);
    if (s.model) parts.push(`${seconds(s.totalMs / s.model)} par légende en moyenne`);
    return parts.join(', ');
  }

  async generate(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    if (this.unavailable !== null) return this.useFallback(req);
    const index = ++this.index;
    const startedAt = Date.now();
    try {
      const llm = await this.loadWithHeartbeat(index, startedAt);
      if (signal?.aborted) throw new Error('Génération annulée.');
      // Une génération précédente peut encore occuper le moteur natif : le
      // relancer maintenant échouerait avec « ModelGenerating ».
      const free = await settleWithin(this.pending, INTERRUPT_GRACE_MS);
      if (!free.done) {
        // Un moteur qui ne se libère pas ne se libérera plus : toute légende
        // suivante échouerait sur « ModelGenerating » après la même attente.
        this.unavailable = `Le moteur de génération est resté bloqué sur la légende ${index - 1}.`;
        log('warn', `${this.unavailable} Gabarits pour la suite de l'album.`);
        return this.useFallback(req);
      }
      const text = await this.runOne(llm, req, index, signal);
      if (text.length >= 3) {
        this.consecutiveFailures = 0;
        this.stats.model++;
        this.stats.totalMs += Date.now() - startedAt;
        return text;
      }
      log('warn', `Légende ${index} : réponse inutilisable du modèle, repli sur le gabarit.`);
    } catch (e) {
      this.recordFailure(index, Date.now() - startedAt, e);
    }
    return this.useFallback(req);
  }

  /** Une seule génération, surveillée du premier au dernier jeton. */
  private async runOne(llm: LLMModule, req: CaptionRequest, index: number, signal?: AbortSignal): Promise<string> {
    const { system, user } = buildCaptionPrompt(req);
    const maxLength = req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH;
    const startedAt = Date.now();
    let raw = '';
    let lastToken = startedAt;
    let stopped: string | null = null;

    const interrupt = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      try {
        llm.interrupt();
      } catch (e) {
        log('warn', `Légende ${index} : interruption du modèle impossible`, e);
      }
    };

    this.sink = (token) => {
      raw += token;
      lastToken = Date.now();
      if (hasEnoughText(raw, maxLength)) interrupt(ENOUGH);
    };
    const heartbeat = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      this.onActivity?.({ phase: 'generating', index, chars: stripThinking(raw).length, elapsedMs: elapsed });
      if (elapsed >= GENERATION_TIMEOUT_MS) interrupt(`délai de ${seconds(GENERATION_TIMEOUT_MS)} dépassé`);
      else if (Date.now() - lastToken >= TOKEN_SILENCE_MS) interrupt(`aucun jeton depuis ${seconds(TOKEN_SILENCE_MS)}`);
    }, HEARTBEAT_MS);
    const onAbort = () => interrupt('annulation');
    signal?.addEventListener('abort', onAbort);

    const call = llm.generate([
      { role: 'system', content: system },
      { role: 'user', content: `${user}\n/no_think` },
    ]);
    // Retenue même en cas d'échec : la légende suivante doit attendre que le
    // moteur natif se soit vraiment libéré.
    this.pending = call.catch(() => undefined);
    try {
      // Après une interruption le moteur peut encore rendre un jeton ou deux ;
      // passé ce délai supplémentaire, il ne répondra plus.
      const answer = await settleWithin(call, GENERATION_TIMEOUT_MS + INTERRUPT_GRACE_MS);
      const elapsed = Date.now() - startedAt;
      // Couper une digression est anormal ; couper une légende finie ne l'est pas.
      if (stopped && stopped !== ENOUGH) this.stats.interrupted++;
      if (!answer.done) {
        this.stats.stuck++;
        // Le texte déjà reçu peut suffire : mieux vaut cette légende que rien.
        log(
          'warn',
          `Légende ${index} : le moteur n'a pas répondu en ${seconds(elapsed)} (${raw.length} car. reçus, interruption : ${stopped ?? 'aucune'}).`,
        );
        return sanitizeCaption(stripThinking(raw), req.maxLength);
      }
      log(
        'info',
        `Légende ${index} : ${seconds(elapsed)}, ${this.tokenCounts(llm)}, ${raw.length} car.${stopped ? ` — coupée (${stopped})` : ''}`,
      );
      return sanitizeCaption(stripThinking(answer.value), req.maxLength);
    } finally {
      clearInterval(heartbeat);
      signal?.removeEventListener('abort', onAbort);
      this.sink = null;
    }
  }

  /** Charge le modèle en signalant régulièrement que l'attente est normale. */
  private async loadWithHeartbeat(index: number, startedAt: number): Promise<LLMModule> {
    if (this.llm) return this.llm;
    const heartbeat = setInterval(
      () => this.onActivity?.({ phase: 'loading', index, chars: 0, elapsedMs: Date.now() - startedAt }),
      HEARTBEAT_MS,
    );
    try {
      return await this.load();
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Compteurs de jetons du moteur, s'il accepte de les donner. */
  private tokenCounts(llm: LLMModule): string {
    try {
      return `${llm.getPromptTokensCount()} jetons d'entrée / ${llm.getGeneratedTokenCount()} générés`;
    } catch {
      return 'jetons inconnus';
    }
  }

  /**
   * Un échec de chargement condamne tout l'album ; un échec ponctuel de
   * génération ne condamne que sa photo, jusqu'à ce qu'ils s'enchaînent.
   */
  private recordFailure(index: number, elapsedMs: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (!this.llm) {
      this.loading = undefined;
      this.unavailable = message;
      log('warn', "Modèle de légendes impossible à charger, repli sur les gabarits pour tout l'album", error);
      return;
    }
    this.consecutiveFailures++;
    log('warn', `Légende ${index} : échec après ${seconds(elapsedMs)} (${this.consecutiveFailures} d'affilée)`, error);
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.unavailable = `${message} (après ${this.consecutiveFailures} échecs consécutifs)`;
      log('warn', `Modèle de légendes abandonné après ${this.consecutiveFailures} échecs : gabarits pour la suite de l'album.`);
    }
  }

  private useFallback(req: CaptionRequest): Promise<string> {
    this.stats.template++;
    return this.fallback.generate(req);
  }

  release(): void {
    try {
      // Le moteur refuse d'être libéré pendant qu'il génère.
      this.llm?.interrupt();
    } catch {
      // rien en cours
    }
    try {
      this.llm?.delete();
    } catch (e) {
      log('warn', 'Libération du modèle de légendes impossible', e);
    }
    this.llm = undefined;
    this.loading = undefined;
    this.sink = null;
  }
}

export type CaptionEngine = 'llm' | 'template';

export function createCaptionGenerator(
  engine: CaptionEngine,
  onDownloadProgress?: (p: number) => void,
  onActivity?: (a: CaptionActivity) => void,
): CaptionGenerator {
  return engine === 'llm' ? new LocalLlmCaptionGenerator(onDownloadProgress, onActivity) : new TemplateCaptionGenerator();
}
