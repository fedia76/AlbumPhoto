import type { CaptionContext } from './types';

export function timeOfDayFromIso(iso: string | undefined): CaptionContext['timeOfDay'] | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  // Heure locale de l'ISO si un décalage est fourni, sinon heure UTC.
  const m = /T(\d{2}):/.exec(iso);
  const hour = m ? parseInt(m[1]!, 10) : d.getUTCHours();
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

/** Formule une liste de prénoms en langue naturelle : « Léa, Tom et Zoé ». */
export function joinNames(names: string[], locale: string): string {
  const and = locale.startsWith('fr') ? 'et' : 'and';
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`;
}
