import type { CaptionStyle } from '../../album/types';
import type { CaptionContext, CaptionGenerator, CaptionRequest } from './types';
import { DEFAULT_CAPTION_MAX_LENGTH } from './types';
import { joinNames } from './context';
import { sanitizeCaption } from './prompt';

/**
 * Générateur de légendes par gabarits : fonctionne partout, sans modèle.
 * Sert de repli quand le LLM local n'est pas disponible, et de base pour
 * les tests. Déterministe pour une même photo (graine dérivée du contexte).
 */
export class TemplateCaptionGenerator implements CaptionGenerator {
  readonly name = 'template';

  async generate(req: CaptionRequest): Promise<string> {
    return generateTemplateCaption(req);
  }
}

type Vars = { names: string; n: number; label: string; time: string; date: string };
type Tpl = (v: Vars) => string;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const FR_TIME = { morning: 'ce matin-là', afternoon: 'cet après-midi-là', evening: 'ce soir-là', night: 'cette nuit-là' };
const EN_TIME = { morning: 'that morning', afternoon: 'that afternoon', evening: 'that evening', night: 'that night' };

const FR: Record<CaptionStyle, { people: Tpl[]; scenery: Tpl[]; strangers: Tpl[] }> = {
  funny: {
    people: [
      (v) => `${v.names} : 100 % naturel, 0 % posé. Ou presque.`,
      (v) => `Quand ${v.names} décide${v.n > 1 ? 'nt' : ''} que la photo sera parfaite. Elle l'est.`,
      (v) => `${v.names}, en pleine mission ${v.label || 'sourire'} ${v.time}.`,
      (v) => `Personne n'a cligné des yeux. Un exploit signé ${v.names}.`,
    ],
    scenery: [
      (v) => `Ici, même le ${v.label || 'paysage'} prend la pose.`,
      (v) => `Pas un humain à l'horizon ${v.time} : juste ${v.label || 'la vue'}.`,
      () => `La photo où tout le monde était derrière l'objectif.`,
    ],
    strangers: [
      (v) => `Des figurants de luxe pour cette scène ${v.time}.`,
      (v) => `Ambiance ${v.label || 'du jour'} : les sourires sont de sortie.`,
    ],
  },
  formal: {
    people: [
      (v) => `${v.names}, ${v.date}.`,
      (v) => `${v.names} ${v.time}${v.label ? `, ${v.label}` : ''}.`,
      (v) => `Portrait de ${v.names}.`,
    ],
    scenery: [(v) => `${cap(v.label || 'Paysage')}, ${v.date}.`, (v) => `Vue ${v.time}.`],
    strangers: [(v) => `Instant partagé, ${v.date}.`, (v) => `${cap(v.label || 'Scène')} ${v.time}.`],
  },
  poetic: {
    people: [
      (v) => `${v.names}, et la lumière qui s'attarde.`,
      (v) => `Un souffle de ${v.label || 'bonheur'} suspendu ${v.time}.`,
      (v) => `Dans les yeux de ${v.names}, tout ${v.time} tient en un regard.`,
    ],
    scenery: [
      (v) => `Le silence de ${v.label || 'ce lieu'}, ${v.time}.`,
      () => `Là où le temps a bien voulu s'arrêter.`,
    ],
    strangers: [(v) => `Des vies qui se croisent ${v.time}.`, (v) => `Un fragment de ${v.label || 'monde'}, saisi au vol.`],
  },
  minimal: {
    people: [(v) => `${v.names}.`, (v) => `${v.names} — ${v.date}.`, (v) => `${v.names}${v.label ? `, ${v.label}` : ''}.`],
    scenery: [(v) => `${cap(v.label || 'Vue')}.`, (v) => `${v.date}.`],
    strangers: [(v) => `${cap(v.label || 'Scène')}.`, (v) => `${v.date}.`],
  },
  family: {
    people: [
      (v) => `${v.names}, notre plus beau souvenir ${v.time}.`,
      (v) => `Avec ${v.names}, chaque instant compte.`,
      (v) => `${v.names} et ${v.label ? `un moment ${v.label}` : 'un moment de bonheur'} à garder précieusement.`,
    ],
    scenery: [(v) => `Le décor de nos souvenirs ${v.time}.`, (v) => `${cap(v.label || 'Un endroit')} qu'on n'oubliera pas.`],
    strangers: [(v) => `Un moment de partage ${v.time}.`, (v) => `Ensemble, tout simplement.`],
  },
};

const EN: Record<CaptionStyle, { people: Tpl[]; scenery: Tpl[]; strangers: Tpl[] }> = {
  funny: {
    people: [
      (v) => `${v.names}: 100% candid, 0% staged. Almost.`,
      (v) => `Nobody blinked. A ${v.names} achievement.`,
      (v) => `${v.names} on a serious ${v.label || 'smile'} mission ${v.time}.`,
    ],
    scenery: [(v) => `Even the ${v.label || 'scenery'} is posing here.`, () => `The photo where everyone was behind the camera.`],
    strangers: [(v) => `Extras of the finest quality ${v.time}.`, (v) => `${cap(v.label || 'The day')}: smiles included.`],
  },
  formal: {
    people: [(v) => `${v.names}, ${v.date}.`, (v) => `${v.names} ${v.time}${v.label ? `, ${v.label}` : ''}.`],
    scenery: [(v) => `${cap(v.label || 'Landscape')}, ${v.date}.`],
    strangers: [(v) => `A shared moment, ${v.date}.`],
  },
  poetic: {
    people: [(v) => `${v.names}, and the light that lingers.`, (v) => `A breath of ${v.label || 'joy'}, held ${v.time}.`],
    scenery: [(v) => `The quiet of ${v.label || 'this place'}, ${v.time}.`, () => `Where time kindly stood still.`],
    strangers: [(v) => `Lives crossing ${v.time}.`],
  },
  minimal: {
    people: [(v) => `${v.names}.`, (v) => `${v.names} — ${v.date}.`],
    scenery: [(v) => `${cap(v.label || 'View')}.`, (v) => `${v.date}.`],
    strangers: [(v) => `${cap(v.label || 'Scene')}.`],
  },
  family: {
    people: [(v) => `${v.names}, our favourite memory ${v.time}.`, (v) => `With ${v.names}, every moment counts.`],
    scenery: [(v) => `The backdrop of our memories ${v.time}.`],
    strangers: [(v) => `A moment of togetherness ${v.time}.`],
  },
};

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function formatDate(iso: string | undefined, locale: string): string {
  if (!iso) return locale.startsWith('fr') ? 'un jour à retenir' : 'a day to remember';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function vars(c: CaptionContext): Vars {
  const fr = c.locale.startsWith('fr');
  const time = c.timeOfDay ? (fr ? FR_TIME[c.timeOfDay] : EN_TIME[c.timeOfDay]) : fr ? 'ce jour-là' : 'that day';
  return {
    names: joinNames(c.people, c.locale),
    n: c.people.length,
    label: c.labels[0] ?? '',
    time,
    date: formatDate(c.takenAt, c.locale),
  };
}

export function generateTemplateCaption(req: CaptionRequest): string {
  const c = req.context;
  const table = c.locale.startsWith('fr') ? FR : EN;
  const set = table[req.style] ?? table.minimal;
  const pool = c.people.length > 0 ? set.people : c.faceCount > 0 ? set.strangers : set.scenery;
  const seed = hashString(`${c.people.join('|')}|${c.takenAt ?? ''}|${c.labels.join('|')}|${req.style}`);
  const tpl = pool[seed % pool.length]!;
  return sanitizeCaption(tpl(vars(c)), req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH);
}
