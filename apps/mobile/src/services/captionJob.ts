import {
  applyPhotoCaptions,
  generateCaptions,
  type CaptionDiagnostic,
  type CaptionGenerator,
  type CaptionParams,
  type PhotoEvent,
} from '@albumphoto/core';
import { loadAlbum, saveAlbum } from '../storage/albumStore';
import { log } from '../diagnostics/log';
import type { CaptionActivity } from './captioner';

/**
 * Écriture des légendes en tâche de fond.
 *
 * L'album est assemblé et ouvert immédiatement avec des légendes de gabarit ;
 * le modèle les remplace ensuite une par une, pendant que l'utilisateur feuillette
 * ses pages. « Arrière-plan » s'entend au sens de l'application au premier plan :
 * le travail est du JavaScript, il s'interrompt si le système suspend l'app et
 * reprend à son retour.
 *
 * Le service est un singleton : un seul album est légendé à la fois, et le
 * modèle — plusieurs centaines de mégaoctets en mémoire — est libéré à la fin.
 */

export type CaptionJobStatus = 'running' | 'done' | 'cancelled' | 'failed';

export interface CaptionJobState {
  albumId: string;
  albumTitle: string;
  total: number;
  /** Légendes traitées, abandons compris. */
  done: number;
  /** Légendes effectivement écrites par le modèle. */
  written: number;
  status: CaptionJobStatus;
  /**
   * Étape en cours. La préparation — télécharger puis charger le modèle — peut
   * durer plusieurs minutes au premier lancement, sans qu'aucune légende
   * n'avance : le dire évite de la prendre pour un blocage.
   */
  phase: 'preparing' | 'writing';
  /** Signe de vie du modèle : « lecture de la photo, 12 s », « 47 % »… */
  detail?: string;
  /** Avancement du téléchargement du modèle (0..1), pendant la préparation. */
  download?: number;
  /** Renseigné quand le modèle a dû être abandonné. */
  reason?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface CaptionJobRequest {
  albumId: string;
  albumTitle: string;
  generator: CaptionGenerator;
  events: PhotoEvent[];
  byPhoto: Map<string, string[]>;
  params: Omit<CaptionParams, 'onProgress' | 'onDiagnostic' | 'onCaption' | 'signal'>;
  /** Photo de la galerie → photo de l'album : les identifiants diffèrent. */
  albumPhotoIdBySource: Map<string, string>;
  /** Légendes de départ (gabarits), par identifiant de photo de l'album. */
  seed: Map<string, string>;
}

type Listener = (state: CaptionJobState | null) => void;
/** Un écran qui tient l'album en mémoire applique les légendes lui-même. */
type Sink = (captions: Map<string, string>) => void;

function label(d: CaptionDiagnostic): string {
  switch (d.outcome) {
    case 'empty':
      return 'réponse vide';
    case 'error':
      return 'erreur du générateur';
    case 'timeout':
      return `aucune réponse en ${Math.round(d.elapsedMs / 1000)} s, gabarit utilisé`;
    case 'abandoned':
      return 'générateur abandonné, gabarit utilisé';
    default:
      return 'ok';
  }
}

class CaptionJob {
  private state: CaptionJobState | null = null;
  private readonly listeners = new Set<Listener>();
  /** Légendes courantes, par identifiant de photo de l'album. */
  private captions = new Map<string, string>();
  private controller: AbortController | null = null;
  private generator: CaptionGenerator | null = null;
  private sink: { albumId: string; apply: Sink } | null = null;
  /** Sauvegarde en cours : les écritures disque restent sérialisées. */
  private writing: Promise<void> = Promise.resolve();

  snapshot(): CaptionJobState | null {
    return this.state;
  }

  isRunning(): boolean {
    return this.state?.status === 'running';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /**
   * Un écran déclare tenir l'album en mémoire : tant qu'il est là, c'est lui qui
   * applique les légendes et les sauvegarde. Sans cela, l'écran travaillerait sur
   * une copie devenue périmée et écraserait les légendes à sa prochaine
   * sauvegarde automatique.
   */
  claim(albumId: string, apply: Sink): () => void {
    this.sink = { albumId, apply };
    if (this.state?.albumId === albumId && this.captions.size) apply(new Map(this.captions));
    return () => {
      if (this.sink?.apply === apply) this.sink = null;
    };
  }

  /** Progression du téléchargement du modèle, rapportée par le générateur. */
  reportDownload(progress: number): void {
    if (!this.isRunning()) return;
    this.update({
      download: progress,
      detail: progress < 1 ? `téléchargement du modèle ${Math.round(progress * 100)} %` : 'chargement du modèle en mémoire',
    });
  }

  /** Signe de vie pendant l'écriture d'une légende. */
  reportActivity(a: CaptionActivity): void {
    if (!this.isRunning()) return;
    const elapsed = `${Math.round(a.elapsedMs / 1000)} s`;
    if (a.retryIn) {
      return this.update({ detail: `téléchargement interrompu, nouvel essai dans ${Math.round(a.retryIn / 1000)} s` });
    }
    if (a.phase === 'loading') return this.update({ detail: `préparation du modèle, ${elapsed}` });
    this.update({ detail: a.reading ? `lecture de la photo, ${elapsed}` : `${a.chars} caractères, ${elapsed}` });
  }

  /** Lance l'écriture ; annule une tâche précédente le cas échéant. */
  start(req: CaptionJobRequest): void {
    this.cancel();
    const total = req.events.reduce((n, e) => n + e.photos.length, 0);
    this.captions = new Map(req.seed);
    const controller = new AbortController();
    this.controller = controller;
    this.generator = req.generator;
    this.state = {
      albumId: req.albumId,
      albumTitle: req.albumTitle,
      total,
      done: 0,
      written: 0,
      status: 'running',
      phase: 'preparing',
      startedAt: Date.now(),
    };
    this.emit();
    log('info', `Légendes en arrière-plan : ${total} photos, moteur « ${req.generator.name} ».`);
    void this.run(req, controller);
  }

  cancel(): void {
    if (!this.isRunning()) return;
    this.controller?.abort();
    // L'état passe à « arrêté » tout de suite pour l'affichage, mais le modèle
    // n'est libéré qu'à la sortie de la boucle : le supprimer pendant qu'il
    // génère encore est refusé par le moteur natif.
    this.update({ status: 'cancelled', finishedAt: Date.now() });
  }

  /** Efface le bandeau une fois la tâche terminée et lue. */
  dismiss(): void {
    if (this.isRunning()) return;
    this.state = null;
    this.emit();
  }

  private async run(req: CaptionJobRequest, controller: AbortController): Promise<void> {
    const startedAt = Date.now();
    /** Photos dont la légende n'est pas venue du modèle, par motif. */
    const failures = new Map<string, number>();
    try {
      // Le modèle est préparé ici, à part : son téléchargement se compte en
      // minutes et le décompter du délai d'une légende revenait à l'abandonner
      // pendant qu'il se chargeait encore.
      this.update({ phase: 'preparing', detail: 'préparation du modèle' });
      await req.generator.prepare?.(controller.signal);
      if (controller.signal.aborted) {
        this.finish('cancelled');
        return;
      }
      this.update({ phase: 'writing' });
      await generateCaptions(req.generator, req.events, req.byPhoto, {
        ...req.params,
        signal: controller.signal,
        onCaption: async (sourceId, text) => {
          const albumPhotoId = req.albumPhotoIdBySource.get(sourceId);
          if (!albumPhotoId) return;
          this.captions.set(albumPhotoId, text);
          await this.persist(req.albumId);
        },
        onProgress: (p) => {
          if (p.current) return; // annonce de départ : le compteur ne bouge pas encore
          this.update({ done: p.done });
        },
        onDiagnostic: (d) => {
          if (d.outcome === 'ok') {
            this.update({ written: (this.state?.written ?? 0) + 1 });
            return;
          }
          failures.set(d.outcome, (failures.get(d.outcome) ?? 0) + 1);
          log('warn', `Légende ${d.index}/${d.total} (${d.photoId}) : ${label(d)}`, d.error);
        },
      });
      const summary = (req.generator as { summary?: () => string }).summary?.();
      log(
        'info',
        `Légendes terminées en ${Math.round((Date.now() - startedAt) / 1000)} s : ${this.state?.written ?? 0}/${
          this.state?.total ?? 0
        } par le modèle${summary ? ` (${summary})` : ''}.`,
      );
      const reason = (req.generator as { fallbackReason?: string | null }).fallbackReason ?? this.reasonFor(failures);
      this.finish(controller.signal.aborted ? 'cancelled' : 'done', reason ?? undefined);
    } catch (e) {
      log('error', "Écriture des légendes interrompue par une erreur", e);
      this.finish('failed', e instanceof Error ? e.message : String(e));
    } finally {
      // Le modèle occupe plusieurs centaines de mégaoctets : le garder chargé
      // pendant que l'utilisateur feuillette son album ne sert à rien.
      (this.generator as { release?: () => void } | null)?.release?.();
      this.generator = null;
      this.controller = null;
    }
  }

  /**
   * Pourquoi le modèle n'a rien donné, quand lui-même ne le dit pas : un délai
   * dépassé n'est pas remonté au générateur, c'est le pipeline qui l'a coupé.
   */
  private reasonFor(failures: Map<string, number>): string | undefined {
    const timeouts = (failures.get('timeout') ?? 0) + (failures.get('abandoned') ?? 0);
    if (!timeouts || (this.state?.written ?? 0) > 0) return undefined;
    return `Le modèle n'a répondu à aucune photo dans le temps imparti (${timeouts} sur ${this.state?.total ?? timeouts}).`;
  }

  /**
   * Applique les légendes connues : à l'écran qui tient l'album s'il y en a un,
   * au fichier sinon. Les écritures sont sérialisées pour ne pas se croiser.
   */
  private persist(albumId: string): Promise<void> {
    const captions = new Map(this.captions);
    const sink = this.sink;
    if (sink && sink.albumId === albumId) {
      sink.apply(captions);
      return Promise.resolve();
    }
    this.writing = this.writing.then(async () => {
      try {
        const album = await loadAlbum(albumId);
        if (applyPhotoCaptions(album, captions)) await saveAlbum(album);
      } catch (e) {
        log('warn', "Légende impossible à enregistrer dans l'album", e);
      }
    });
    return this.writing;
  }

  private finish(status: CaptionJobStatus, reason?: string): void {
    if (!this.state) return;
    // Un arrêt demandé par l'utilisateur reste un arrêt, même si la dernière
    // légende a eu le temps d'aboutir.
    const final = this.state.status === 'cancelled' ? 'cancelled' : status;
    this.update({ status: final, finishedAt: Date.now(), ...(reason ? { reason } : {}) });
    if (this.state) delete this.state.detail;
  }

  private update(patch: Partial<CaptionJobState>): void {
    if (!this.state) return;
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

export const captionJob = new CaptionJob();
