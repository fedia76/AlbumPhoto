/**
 * Journal de diagnostic écrit sur le disque de l'application.
 *
 * Sans ordinateur il n'y a pas de `logcat` : l'application enregistre donc
 * elle-même ses erreurs dans `<documents>/diagnostics/app.log`, consultable et
 * partageable depuis l'écran « Diagnostic ». Toutes les opérations sont
 * protégées : le journal ne doit jamais être la cause d'un plantage.
 */

const MAX_LOG_CHARS = 120_000;

type Level = 'info' | 'warn' | 'error';

/** Tampon mémoire, utilisable même si l'écriture disque échoue. */
const memory: string[] = [];
let fileBroken = false;

function timestamp(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '?';
  }
}

type LogFileHandle = { text(): string; write(s: string): void };
let cachedFile: LogFileHandle | null = null;

/** Le fichier de journal, ou `null` si le système de fichiers est indisponible. */
function logFile(): LogFileHandle | null {
  if (fileBroken) return null;
  if (cachedFile) return cachedFile;
  try {
    // Import paresseux : si expo-file-system échoue, on reste en mémoire.
    const fs = require('expo-file-system') as typeof import('expo-file-system');
    const dir = new fs.Directory(fs.Paths.document, 'diagnostics');
    dir.create({ intermediates: true, idempotent: true });
    const file = new fs.File(dir, 'app.log');
    if (!file.exists) file.create({ intermediates: true });
    cachedFile = {
      text: () => file.textSync(),
      write: (s: string) => file.write(s),
    };
    return cachedFile;
  } catch {
    fileBroken = true;
    return null;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack ? `\n${error.stack}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  try {
    return typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Ajoute une ligne au journal (mémoire + disque). */
export function log(level: Level, message: string, error?: unknown): void {
  const line = `[${timestamp()}] ${level.toUpperCase()} ${message}${error === undefined ? '' : `\n${describeError(error)}`}`;
  memory.push(line);
  if (memory.length > 500) memory.splice(0, memory.length - 500);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  const file = logFile();
  if (!file) return;
  try {
    const previous = file.text();
    const next = `${previous}${line}\n`;
    file.write(next.length > MAX_LOG_CHARS ? next.slice(next.length - MAX_LOG_CHARS) : next);
  } catch {
    fileBroken = true;
  }
}

/** Contenu complet du journal (disque si possible, sinon mémoire). */
export function readLog(): string {
  const file = logFile();
  if (file) {
    try {
      const text = file.text();
      if (text.trim().length > 0) return text;
    } catch {
      fileBroken = true;
    }
  }
  return memory.join('\n');
}

export function clearLog(): void {
  memory.length = 0;
  const file = logFile();
  try {
    file?.write('');
  } catch {
    fileBroken = true;
  }
}

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let onFatal: ((error: unknown) => void) | null = null;

/** Enregistre le rendu de secours appelé sur erreur fatale. */
export function setFatalHandler(handler: (error: unknown) => void): void {
  onFatal = handler;
}

let installed = false;

/**
 * Capture les erreurs JavaScript non rattrapées et les promesses rejetées.
 * Sans cela, une erreur fatale ferme l'application sans laisser de trace.
 */
export function installGlobalHandlers(): void {
  if (installed) return;
  installed = true;
  try {
    const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    const previous = eu?.getGlobalHandler?.();
    eu?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
      log('error', isFatal ? 'Erreur fatale non rattrapée' : 'Erreur non rattrapée', error);
      if (isFatal && onFatal) {
        try {
          onFatal(error);
          return; // on affiche l'erreur au lieu de fermer l'application
        } catch {
          // on retombe sur le comportement par défaut
        }
      }
      previous?.(error, isFatal);
    });
  } catch (e) {
    log('warn', "Impossible d'installer le gestionnaire d'erreurs global", e);
  }

  try {
    const tracking = require('promise/setimmediate/rejection-tracking') as {
      enable(options: { allRejections: boolean; onUnhandled(id: number, error: unknown): void; onHandled(): void }): void;
    };
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id, error) => log('error', 'Promesse rejetée sans traitement', error),
      onHandled: () => undefined,
    });
  } catch {
    // Le suivi des promesses n'est pas disponible : ce n'est pas bloquant.
  }
}
