/**
 * Journal de diagnostic écrit sur le disque de l'application.
 *
 * Sans ordinateur il n'y a pas de `logcat` : l'application enregistre donc
 * elle-même ses erreurs dans `<documents>/diagnostics/app.log`, consultable et
 * partageable depuis l'écran « Diagnostic ». Toutes les opérations sont
 * protégées : le journal ne doit jamais être la cause d'un plantage.
 */

/** Le journal est volontairement borné : il doit rester lisible et partageable. */
const MAX_LOG_CHARS = 40_000;
/** Une pile d'appel entière est illisible sur un téléphone et remplit le journal. */
const MAX_STACK_FRAMES = 12;

type Level = 'info' | 'warn' | 'error';

/**
 * Contenu du journal, en mémoire, reflet du fichier. Le garder ici évite de
 * relire le fichier à chaque ligne et rend le regroupement des répétitions
 * immédiat.
 */
let lines: string[] | null = null;
let fileBroken = false;
/** Signature de la dernière entrée, pour compter les répétitions. */
let lastSignature = '';
let lastRepeats = 1;

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
    // La pile est tronquée : au-delà d'une douzaine de niveaux elle n'apprend
    // plus rien et fait gonfler le journal de plusieurs kilo-octets par erreur.
    const frames = (error.stack ?? '').split('\n').slice(0, MAX_STACK_FRAMES + 1);
    const truncated = (error.stack ?? '').split('\n').length > frames.length ? '\n    …' : '';
    const stack = error.stack ? `\n${frames.join('\n')}${truncated}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  try {
    return typeof error === 'string' ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Charge le contenu existant, une seule fois par session. */
function ensureLines(): string[] {
  if (lines) return lines;
  lines = [];
  const file = logFile();
  if (file) {
    try {
      const text = file.text();
      if (text.length > 0) lines = text.split('\n').filter((l) => l.length > 0);
    } catch {
      fileBroken = true;
    }
  }
  return lines;
}

/** Écrit le journal sur le disque, après l'avoir ramené sous la taille maximale. */
function flush(): void {
  const current = ensureLines();
  let joined = current.join('\n');
  while (joined.length > MAX_LOG_CHARS && current.length > 1) {
    current.shift();
    joined = current.join('\n');
  }
  const file = logFile();
  if (!file) return;
  try {
    file.write(`${joined}\n`);
  } catch {
    fileBroken = true;
  }
}

/** Ajoute une ligne au journal (mémoire + disque). */
export function log(level: Level, message: string, error?: unknown): void {
  const detail = error === undefined ? '' : `\n${describeError(error)}`;
  const current = ensureLines();

  // Les erreurs identiques qui se suivent sont comptées plutôt que recopiées :
  // une boucle en échec remplissait sinon le journal de la même pile d'appel.
  const signature = `${level}|${message}|${detail.split('\n')[1] ?? ''}`;
  if (signature === lastSignature && current.length > 0) {
    lastRepeats += 1;
    current[current.length - 1] = `${current[current.length - 1]!.replace(/ \(×\d+\)$/, '')} (×${lastRepeats})`;
    flush();
    return;
  }
  lastSignature = signature;
  lastRepeats = 1;

  const line = `[${timestamp()}] ${level.toUpperCase()} ${message}${detail}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  current.push(line);
  flush();
}

/** Contenu complet du journal. */
export function readLog(): string {
  return ensureLines().join('\n');
}

/** Fin du journal, pour l'affichage : le tout est souvent trop long à rendre. */
export function readLogTail(maxChars = 6_000): { text: string; truncated: boolean; totalChars: number } {
  const full = readLog();
  if (full.length <= maxChars) return { text: full, truncated: false, totalChars: full.length };
  const cut = full.slice(full.length - maxChars);
  const start = cut.indexOf('\n');
  return { text: start >= 0 ? cut.slice(start + 1) : cut, truncated: true, totalChars: full.length };
}

export function clearLog(): void {
  lines = [];
  lastSignature = '';
  lastRepeats = 1;
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
