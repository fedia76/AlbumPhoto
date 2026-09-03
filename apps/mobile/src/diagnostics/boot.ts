/**
 * Détection des plantages au démarrage.
 *
 * Un jeton est écrit au tout début du démarrage et effacé dès que l'interface
 * s'affiche. S'il est encore présent au lancement suivant, c'est que
 * l'application s'est fermée avant d'afficher quoi que ce soit : on le signale
 * à l'utilisateur avec le journal correspondant.
 */
import { log } from './log';

let pendingCrashAtBoot = false;

function tokenFile(): { exists: boolean; create(o: { intermediates: boolean }): void; write(s: string): void; delete(): void } | null {
  try {
    const fs = require('expo-file-system') as typeof import('expo-file-system');
    const dir = new fs.Directory(fs.Paths.document, 'diagnostics');
    dir.create({ intermediates: true, idempotent: true });
    return new fs.File(dir, 'booting.flag');
  } catch {
    return null;
  }
}

/** À appeler au tout début du démarrage. */
export function markBootStart(): void {
  const file = tokenFile();
  try {
    if (file?.exists) {
      pendingCrashAtBoot = true;
      log('error', "Le lancement précédent s'est interrompu avant l'affichage de l'interface.");
    }
    if (file && !file.exists) file.create({ intermediates: true });
    file?.write(new Date().toISOString());
  } catch {
    // sans jeton, on perd seulement la détection
  }
  log('info', 'Démarrage de AlbumPhoto');
}

/** À appeler dès que l'interface est montée. */
export function markBootSucceeded(): void {
  try {
    const file = tokenFile();
    if (file?.exists) file.delete();
  } catch {
    // sans importance
  }
}

/** Le lancement précédent s'est-il interrompu avant l'affichage ? */
export function crashedAtPreviousBoot(): boolean {
  return pendingCrashAtBoot;
}

export function acknowledgeBootCrash(): void {
  pendingCrashAtBoot = false;
}
