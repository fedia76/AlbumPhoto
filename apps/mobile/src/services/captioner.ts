import type { LLMModule } from 'react-native-executorch';
import {
  DEFAULT_CAPTION_MAX_LENGTH,
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  buildDescriptionPrompt,
  buildVisionCaptionPrompt,
  hasEnoughDescription,
  hasEnoughText,
  isStuckThinking,
  sanitizeCaption,
  sanitizeDescription,
  stripThinking,
  type CaptionDraft,
  type CaptionGenerator,
  type CaptionRequest,
} from '@albumphoto/core';
import { log } from '../diagnostics/log';
import { isExecutorchLinked } from './nativeAvailability';
import { getPhotoThumbnail } from './photoThumbnails';
import { RemoteCaptionWriter, REMOTE_MODEL } from './remoteWriter';

type ExecutorchModule = typeof import('react-native-executorch');
type ResourceFetcherModule = typeof import('react-native-executorch-expo-resource-fetcher');
/** Preset de modèle tel qu'attendu par `LLMModule.fromModelName`. */
type ModelPreset = Parameters<(typeof LLMModule)['fromModelName']>[0];

/** `initExecutorch` n'est à appeler qu'une fois par session. */
let resourceFetcherReady = false;

/* --------------------------------- Modèles -------------------------------- */

/** Bornes de surveillance d'une génération, en millisecondes. */
export interface GenerationLimits {
  /** Attente du tout premier jeton : c'est la phase de lecture du prompt. */
  firstToken: number;
  /** Silence toléré entre deux lots de jetons, une fois l'écriture lancée. */
  silence: number;
  /** Durée totale, au-delà de laquelle le modèle est interrompu. */
  total: number;
}

/**
 * Un modèle de langage local utilisable pour les légendes. Le preset n'est lu
 * qu'au chargement : y toucher plus tôt embarquerait la partie native.
 */
export interface LocalCaptionModel {
  /** Identifiant du preset (sert aussi de `captionModel` dans l'album). */
  readonly name: string;
  /** Le modèle reçoit-il la photo, ou seulement les faits collectés ? */
  readonly vision: boolean;
  readonly preset: (mod: ExecutorchModule) => ModelPreset;
  readonly limits: GenerationLimits;
  /** Ajouté à la fin du message : `/no_think` désarme la réflexion de Qwen 3. */
  readonly promptSuffix?: string;
}

/**
 * Un modèle textuel n'écrit que quelques dizaines de jetons à partir d'un
 * prompt court : tout doit aller vite.
 */
const TEXT_LIMITS: GenerationLimits = { firstToken: 25_000, silence: 15_000, total: 40_000 };

/**
 * Un modèle vision-langage lit d'abord l'image : plusieurs centaines de jetons
 * visuels à ingérer avant le premier mot, ce qui peut demander une minute sur
 * un téléphone. Interrompre pendant cette phase gâcherait tout le travail.
 */
const VISION_LIMITS: GenerationLimits = { firstToken: 120_000, silence: 20_000, total: 180_000 };

/**
 * Côté long de la vignette envoyée au modèle vision. Au-delà de la tuile de
 * 512² du modèle : plus de pixels, c'est un visage lisible et un objet
 * reconnaissable là où la vignette carrée ne montrait qu'une tache — et la
 * description est toute la matière du rédacteur.
 */
const VISION_IMAGE_SIZE = 768;

/**
 * Moteurs de légendes proposés dans l'assistant.
 *
 * `llm` ne connaît de la photo que les étiquettes de ML Kit (« personne »,
 * « plage »…) : la matière est mince, et les légendes s'en ressentent. `vlm`
 * regarde la photo elle-même, au prix d'un modèle plus lourd et plus lent.
 */
export const CAPTION_MODELS = {
  llm: {
    name: 'qwen3-0.6b-quantized',
    vision: false,
    preset: (mod) => mod.QWEN3_0_6B_QUANTIZED,
    limits: TEXT_LIMITS,
    promptSuffix: '\n/no_think',
  },
  vlm: {
    name: 'lfm2.5-vl-1.6b-quantized',
    vision: true,
    preset: (mod) => mod.LFM2_5_VL_1_6B_QUANTIZED,
    limits: VISION_LIMITS,
  },
} as const satisfies Record<string, LocalCaptionModel>;

/**
 * Moteurs proposés. `cloud` réutilise le modèle vision pour décrire la photo et
 * confie la rédaction à un modèle en ligne.
 */
export type CaptionEngine = 'template' | keyof typeof CAPTION_MODELS | 'cloud';

/**
 * Réglages de génération communs. La température et le `topP` sont laissés au
 * modèle : chaque preset porte les valeurs recommandées par ses auteurs, et les
 * écraser dégradait les légendes. `repetitionPenalty` borne les boucles, et les
 * lots de jetons courts servent de signe de vie.
 */
const GENERATION_CONFIG = {
  repetitionPenalty: 1.1,
  outputTokenBatchSize: 8,
  batchTimeInterval: 300,
} as const;

/** Délai laissé au moteur natif pour rendre la main après une interruption. */
const INTERRUPT_GRACE_MS = 15_000;
/** Cadence des signes de vie envoyés à l'interface pendant une génération. */
const HEARTBEAT_MS = 1_000;
/** Motif d'interruption normal : la légende est écrite, le reste est superflu. */
const ENOUGH = 'texte suffisant';
/**
 * Caractères de réflexion tolérés avant de conclure que le modèle n'en sortira
 * pas. Rien de ce qui suit un `<think>` jamais refermé n'est exploitable :
 * attendre le délai complet, c'est perdre quarante secondes pour rien.
 */
const THINKING_BUDGET = 600;
/** Échecs consécutifs avant de renoncer au modèle pour le reste de l'album. */
const MAX_CONSECUTIVE_FAILURES = 2;
/**
 * Tentatives de chargement. Le modèle pèse plusieurs centaines de mégaoctets :
 * sur un réseau mobile, la coupure en cours de téléchargement est la règle, pas
 * l'exception (« Software caused connection abort »).
 */
const LOAD_ATTEMPTS = 3;
/** Attente avant de retenter un chargement, en millisecondes. */
const LOAD_RETRY_MS = [2_000, 6_000];

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
  /** Le modèle lit encore la photo : aucun mot n'est attendu avant la fin. */
  reading?: boolean;
  /** Nouvel essai de chargement dans tant de millisecondes. */
  retryIn?: number;
}

/** Comptes de l'album, pour le journal et le message de fin. */
export interface CaptionStats {
  /** Légendes écrites par le modèle. */
  model: number;
  /** Légendes issues des gabarits (échec, blocage ou modèle abandonné). */
  template: number;
  /** Générations coupées court (silence, délai dépassé ou annulation). */
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
 * Légendes par modèle local (react-native-executorch). Le modèle est téléchargé
 * une fois puis exécuté sur l'appareil. En cas d'échec, repli sur les gabarits.
 *
 * Rien, côté natif, ne borne la longueur d'une réponse : la génération est donc
 * surveillée de bout en bout (signes de vie, budget de texte, délai) et
 * interrompue dès qu'une légende est complète. Chaque étape est journalisée :
 * sans ordinateur, le journal de l'application est le seul moyen de savoir où
 * une génération s'est arrêtée.
 */
export class LocalLlmCaptionGenerator implements CaptionGenerator {
  readonly name: string;
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
  /** Une seule plainte si les photos n'arrivent pas jusqu'au modèle vision. */
  private warnedMissingPhoto = false;
  readonly stats: CaptionStats = { model: 0, template: 0, interrupted: 0, stuck: 0, totalMs: 0 };

  constructor(
    private readonly model: LocalCaptionModel,
    private readonly onDownloadProgress?: (p: number) => void,
    private readonly onActivity?: (a: CaptionActivity) => void,
  ) {
    this.name = model.name;
  }

  load(): Promise<LLMModule> {
    if (!this.loading) {
      const mod = loadExecutorch();
      const startedAt = Date.now();
      log('info', `Chargement du modèle de légendes « ${this.model.name} »…`);
      this.loading = mod.LLMModule.fromModelName(this.model.preset(mod), this.onDownloadProgress, (token) =>
        this.sink?.(token),
      ).then((llm) => {
        // Seuls les réglages de cadence et de répétition sont imposés : la
        // température du preset est celle que ses auteurs recommandent.
        llm.configure({ generationConfig: { ...GENERATION_CONFIG } });
        log('info', `Modèle de légendes prêt en ${seconds(Date.now() - startedAt)}.`);
        this.llm = llm;
        return llm;
      });
    }
    return this.loading;
  }

  /**
   * Télécharge et charge le modèle. À appeler avant la première légende : cette
   * attente se compte en minutes sur un premier lancement, et elle ne doit pas
   * être imputée au délai d'une légende — c'est ce qui condamnait le moteur
   * vision, abandonné pendant son propre téléchargement.
   *
   * Ne lève jamais : un échec bascule l'album sur les gabarits, ce que
   * `fallbackReason` explique.
   */
  async prepare(signal?: AbortSignal): Promise<void> {
    if (this.llm || this.unavailable !== null) return;
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      if (signal?.aborted) return;
      try {
        await this.load();
        return;
      } catch (e) {
        this.loading = undefined;
        const message = e instanceof Error ? e.message : String(e);
        const wait = LOAD_RETRY_MS[attempt - 1];
        if (attempt < LOAD_ATTEMPTS && wait !== undefined) {
          log('warn', `Chargement du modèle échoué (tentative ${attempt}/${LOAD_ATTEMPTS}), nouvel essai dans ${Math.round(wait / 1000)} s`, e);
          this.onActivity?.({ phase: 'loading', index: 0, chars: 0, elapsedMs: 0, retryIn: wait });
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        this.unavailable = message;
        log('warn', `Modèle de légendes impossible à charger après ${attempt} tentatives, gabarits pour tout l'album`, e);
        return;
      }
    }
  }

  /** Raison pour laquelle le modèle local n'a pas pu servir, le cas échéant. */
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

  /**
   * Le modèle, chargé et libre. `null` quand il ne le sera plus : un moteur qui
   * ne rend pas la main ne la rendra pas davantage à la photo suivante.
   */
  private async ready(index: number, startedAt: number, signal?: AbortSignal): Promise<LLMModule | null> {
    const llm = await this.loadWithHeartbeat(index, startedAt);
    if (signal?.aborted) throw new Error('Génération annulée.');
    // Une génération précédente peut encore occuper le moteur natif : le
    // relancer maintenant échouerait avec « ModelGenerating ».
    const free = await settleWithin(this.pending, INTERRUPT_GRACE_MS);
    if (free.done) return llm;
    this.unavailable = `Le moteur de génération est resté bloqué sur la légende ${index - 1}.`;
    log('warn', `${this.unavailable} Gabarits pour la suite de l'album.`);
    return null;
  }

  /**
   * Ce que le modèle voit sur la photo, en une phrase — sans style ni longueur
   * imposée. Sert à nourrir un rédacteur qui, lui, ne voit pas l'image.
   * Renvoie une chaîne vide s'il n'a rien pu en tirer.
   */
  async describe(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    if (this.unavailable !== null || !this.model.vision) return '';
    const index = ++this.index;
    const startedAt = Date.now();
    try {
      const llm = await this.ready(index, startedAt, signal);
      if (!llm) return '';
      return await this.runOne(llm, req, index, signal, 'description');
    } catch (e) {
      this.recordFailure(index, Date.now() - startedAt, e);
      return '';
    }
  }

  /**
   * Légende et description en un seul passage : quand le modèle voit la photo,
   * la description est ce qui explique la légende — la garder ne coûte rien.
   */
  async draft(req: CaptionRequest, signal?: AbortSignal): Promise<CaptionDraft> {
    if (!this.model.vision || this.unavailable !== null) return { text: await this.generate(req, signal) };
    const description = await this.describe(req, signal);
    const enriched: CaptionRequest = description ? { ...req, context: { ...req.context, description } } : req;
    const text = await this.generate(enriched, signal);
    return description ? { text, description } : { text };
  }

  async generate(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    if (this.unavailable !== null) return this.useFallback(req);
    const index = ++this.index;
    const startedAt = Date.now();
    try {
      const llm = await this.ready(index, startedAt, signal);
      if (!llm) return this.useFallback(req);
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

  /**
   * Vignette de la photo à soumettre au modèle vision. Elle est réduite à
   * `VISION_IMAGE_SIZE` : l'original coûterait des milliers de jetons visuels
   * pour aucun gain, le modèle travaillant de toute façon par tuiles de 512².
   */
  private async photoForVision(req: CaptionRequest, index: number): Promise<string | undefined> {
    if (!this.model.vision) return undefined;
    if (!req.photo) {
      if (!this.warnedMissingPhoto) {
        this.warnedMissingPhoto = true;
        log('warn', 'Modèle vision sans photo à regarder : légendes écrites à partir des seuls faits.');
      }
      return undefined;
    }
    try {
      return await getPhotoThumbnail(req.photo, VISION_IMAGE_SIZE);
    } catch (e) {
      log('warn', `Légende ${index} : vignette illisible, le modèle écrira sans voir la photo`, e);
      return undefined;
    }
  }

  /** Une seule génération, surveillée du premier au dernier jeton. */
  private async runOne(
    llm: LLMModule,
    req: CaptionRequest,
    index: number,
    signal?: AbortSignal,
    mode: 'caption' | 'description' = 'caption',
  ): Promise<string> {
    const startedAt = Date.now();
    const mediaPath = await this.photoForVision(req, index);
    const describing = mode === 'description' && !!mediaPath;
    const { system, user } = describing
      ? buildDescriptionPrompt(req)
      : mediaPath
        ? buildVisionCaptionPrompt(req)
        : buildCaptionPrompt(req);
    const maxLength = req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH;
    const limits = this.model.limits;
    let raw = '';
    let lastToken = 0;
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
      if (describing ? hasEnoughDescription(raw) : hasEnoughText(raw, maxLength)) interrupt(ENOUGH);
      else if (raw.length >= THINKING_BUDGET && isStuckThinking(raw)) interrupt('réflexion sans fin');
    };
    const heartbeat = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      // Tant qu'aucun jeton n'est arrivé, le modèle lit le prompt (et l'image) :
      // c'est la phase la plus longue, et elle a son propre délai.
      const reading = lastToken === 0;
      this.onActivity?.({ phase: 'generating', index, chars: stripThinking(raw).length, elapsedMs: elapsed, reading });
      if (elapsed >= limits.total) interrupt(`délai de ${seconds(limits.total)} dépassé`);
      else if (reading && elapsed >= limits.firstToken) interrupt(`aucun mot après ${seconds(limits.firstToken)} de lecture`);
      else if (!reading && Date.now() - lastToken >= limits.silence) interrupt(`aucun jeton depuis ${seconds(limits.silence)}`);
    }, HEARTBEAT_MS);
    const onAbort = () => interrupt('annulation');
    signal?.addEventListener('abort', onAbort);

    const call = llm.generate([
      { role: 'system', content: system },
      {
        role: 'user',
        content: `${user}${this.model.promptSuffix ?? ''}`,
        ...(mediaPath ? { mediaPath } : {}),
      },
    ]);
    // Retenue même en cas d'échec : la légende suivante doit attendre que le
    // moteur natif se soit vraiment libéré.
    this.pending = call.catch(() => undefined);
    try {
      // Après une interruption le moteur peut encore rendre un jeton ou deux ;
      // passé ce délai supplémentaire, il ne répondra plus.
      const answer = await settleWithin(call, limits.total + INTERRUPT_GRACE_MS);
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
        return describing ? sanitizeDescription(raw) : sanitizeCaption(stripThinking(raw), maxLength);
      }
      const thinking = isStuckThinking(answer.value);
      log(
        thinking ? 'warn' : 'info',
        `${describing ? 'Description' : 'Légende'} ${index} : ${seconds(elapsed)}${mediaPath ? ' (photo lue)' : ''}, ${this.tokenCounts(llm)}, ${raw.length} car.${
          stopped ? ` — coupée (${stopped})` : ''
        }${thinking ? " — le modèle n'est jamais sorti de sa réflexion, rien d'exploitable" : ''}`,
      );
      return describing ? sanitizeDescription(answer.value) : sanitizeCaption(stripThinking(answer.value), maxLength);
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

/**
 * Le modèle local regarde la photo, un modèle en ligne écrit la légende.
 *
 * Chacun fait ce qu'il sait faire : un modèle de 1,6 milliard de paramètres
 * décrit correctement une scène, mais écrit un français plat ; l'inverse est
 * vrai d'un modèle distant, qui écrit bien mais ne voit rien. Seule la
 * description sort de l'appareil — jamais la photo.
 *
 * Si le rédacteur en ligne fait défaut (pas de clé, pas de réseau, quota), la
 * légende du modèle local prend le relais, et le gabarit après elle.
 */
export class HybridCaptionGenerator implements CaptionGenerator {
  readonly name: string;

  constructor(
    private readonly local: LocalLlmCaptionGenerator,
    private readonly writer: RemoteCaptionWriter = new RemoteCaptionWriter(),
  ) {
    this.name = `${local.name} + ${REMOTE_MODEL}`;
  }

  async prepare(signal?: AbortSignal): Promise<void> {
    await this.local.prepare(signal);
    // La clé est vérifiée tout de suite : sans elle, autant le savoir avant
    // d'avoir décrit douze photos pour rien.
    if (!(await this.writer.prepare())) {
      log('warn', `Rédacteur en ligne indisponible : ${this.writer.failureReason}`);
    }
  }

  async generate(req: CaptionRequest, signal?: AbortSignal): Promise<string> {
    return (await this.draft(req, signal)).text;
  }

  /**
   * Le modèle local décrit la photo, le rédacteur en ligne propose plusieurs
   * légendes par style en un appel. Celle du style choisi pour l'album habille
   * la page ; les autres restent disponibles dans l'éditeur.
   */
  async draft(req: CaptionRequest, signal?: AbortSignal): Promise<CaptionDraft> {
    // Rédacteur définitivement hors jeu : inutile de décrire puis d'échouer,
    // le modèle local écrit directement sa propre légende.
    if (this.writer.failureReason) return this.local.draft(req, signal);
    const description = await this.local.describe(req, signal);
    const enriched: CaptionRequest = description
      ? { ...req, context: { ...req.context, description } }
      : req;
    const options = await this.writer.propose(enriched, signal);
    const chosen = options.find((o) => o.style === req.style)?.text ?? '';
    if (chosen) return { text: chosen, ...(description ? { description } : {}), options };
    // Aucune proposition exploitable : une rédaction simple, puis le local.
    const single = await this.writer.write(enriched, signal);
    const text = single.length >= 3 ? single : await this.local.generate(enriched, signal);
    return { text, ...(description ? { description } : {}), ...(options.length ? { options } : {}) };
  }

  /** Ce qui a manqué, le rédacteur en ligne d'abord. */
  get fallbackReason(): string | null {
    return this.writer.failureReason ?? this.local.fallbackReason;
  }

  summary(): string {
    return `${this.local.summary()} · en ligne : ${this.writer.costSummary()}`;
  }

  release(): void {
    this.local.release();
  }
}

export function createCaptionGenerator(
  engine: CaptionEngine,
  onDownloadProgress?: (p: number) => void,
  onActivity?: (a: CaptionActivity) => void,
): CaptionGenerator {
  if (engine === 'template') return new TemplateCaptionGenerator();
  if (engine === 'cloud') {
    return new HybridCaptionGenerator(new LocalLlmCaptionGenerator(CAPTION_MODELS.vlm, onDownloadProgress, onActivity));
  }
  return new LocalLlmCaptionGenerator(CAPTION_MODELS[engine], onDownloadProgress, onActivity);
}
