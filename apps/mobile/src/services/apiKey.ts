import { log } from '../diagnostics/log';

/**
 * Clé d'API du rédacteur en ligne, conservée sur l'appareil.
 *
 * Le magasin sécurisé du système est utilisé quand il est disponible (Keystore
 * Android / Trousseau iOS) ; à défaut, un fichier du dossier privé de
 * l'application prend le relais — moins bien protégé, mais l'alternative
 * serait de redemander la clé à chaque album.
 */

const KEY_NAME = 'anthropic-api-key';
const FILE_NAME = 'anthropic-api-key.txt';

type SecureStore = typeof import('expo-secure-store');

/** Le magasin sécurisé, ou `null` si le module natif n'est pas là. */
function secureStore(): SecureStore | null {
  try {
    const mod = require('expo-secure-store') as SecureStore;
    return typeof mod.getItemAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
}

function keyFile() {
  const fs = require('expo-file-system') as typeof import('expo-file-system');
  return new fs.File(fs.Paths.document, FILE_NAME);
}

/** Clé enregistrée, ou une chaîne vide. Ne lève jamais. */
export async function readApiKey(): Promise<string> {
  const store = secureStore();
  if (store) {
    try {
      return (await store.getItemAsync(KEY_NAME)) ?? '';
    } catch (e) {
      log('warn', 'Clé d\'API illisible dans le magasin sécurisé', e);
    }
  }
  try {
    const file = keyFile();
    return file.exists ? file.textSync().trim() : '';
  } catch {
    return '';
  }
}

/** Enregistre (ou efface, si vide) la clé. Renvoie `false` en cas d'échec. */
export async function writeApiKey(key: string): Promise<boolean> {
  const value = key.trim();
  const store = secureStore();
  if (store) {
    try {
      if (value) await store.setItemAsync(KEY_NAME, value);
      else await store.deleteItemAsync(KEY_NAME);
      return true;
    } catch (e) {
      log('warn', "Clé d'API impossible à enregistrer dans le magasin sécurisé", e);
    }
  }
  try {
    const file = keyFile();
    if (!value) {
      if (file.exists) file.delete();
      return true;
    }
    if (!file.exists) file.create({ intermediates: true });
    file.write(value);
    return true;
  } catch (e) {
    log('warn', "Clé d'API impossible à enregistrer", e);
    return false;
  }
}

/** Une clé d'API Anthropic commence par `sk-ant-`. Contrôle de saisie. */
export function looksLikeApiKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

/** Les derniers caractères seulement, pour confirmer sans réafficher la clé. */
export function maskApiKey(key: string): string {
  const value = key.trim();
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}
