import type { CaptionStyle } from '../../album/types';
import type { CaptionContext, CaptionGenerator, CaptionRequest } from './types';
import { DEFAULT_CAPTION_MAX_LENGTH } from './types';
import { joinNames } from './context';
import { sanitizeCaption } from './prompt';

/**
 * Générateur de légendes par gabarits : fonctionne partout, sans modèle, et
 * sert de repli quand le LLM local n'est pas disponible.
 *
 * Deux principes pour éviter la monotonie :
 * - chaque gabarit peut exiger un contexte (une étiquette, une date, un moment
 *   de la journée) ; seuls les gabarits applicables entrent dans le tirage ;
 * - le tirage tourne avec le rang de la photo dans l'album, si bien que deux
 *   photos voisines ne reçoivent jamais la même tournure.
 */
export class TemplateCaptionGenerator implements CaptionGenerator {
  readonly name = 'template';

  async generate(req: CaptionRequest): Promise<string> {
    return generateTemplateCaption(req);
  }
}

interface Vars {
  /** « Léa et Tom » */
  names: string;
  /** Premier prénom, pour les tournures au singulier. */
  first: string;
  /** Nombre de personnes nommées. */
  n: number;
  faces: number;
  /** Première étiquette de contenu, ou chaîne vide. */
  label: string;
  /** « ce matin-là », ou « ce jour-là » à défaut. */
  time: string;
  hasTime: boolean;
  /** « 14 juillet 2026 » */
  date: string;
  hasDate: boolean;
  month: string;
  /** « d'août », « de juillet » : évite les élisions fautives. */
  ofMonth: string;
  year: string;
  /** « l'été » */
  season: string;
  smiling: boolean;
  event: string;
  hasEvent: boolean;
}

/** Un gabarit, éventuellement conditionné à la présence d'un contexte. */
interface Tpl {
  when?: (v: Vars) => boolean;
  make: (v: Vars) => string;
}

type Category = 'solo' | 'duo' | 'group' | 'strangers' | 'scenery';
type Pools = Record<Category, Tpl[]>;

const t = (make: (v: Vars) => string, when?: (v: Vars) => boolean): Tpl => (when ? { make, when } : { make });

const hasLabel = (v: Vars) => v.label.length > 0;
const hasTime = (v: Vars) => v.hasTime;
const hasDate = (v: Vars) => v.hasDate;
const smiles = (v: Vars) => v.smiling;

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/* --------------------------------- Français -------------------------------- */

const FR: Record<CaptionStyle, Pools> = {
  funny: {
    solo: [
      t((v) => `${v.first} : 100 % naturel, 0 % posé. Ou presque.`),
      t((v) => `Personne n'a cligné des yeux. Un exploit signé ${v.first}.`),
      t((v) => `${v.first} fait semblant de ne pas voir l'objectif. On n'y croit pas.`),
      t((v) => `${v.first} ${v.time}, en pleine action.`, hasTime),
      t((v) => `${v.first} et ${v.label} : une grande histoire.`, hasLabel),
      t((v) => `Alerte : ${v.first} sourit. Encadrez cette photo.`, smiles),
      t((v) => `${v.first}, vedette involontaire ${v.ofMonth} ${v.year}.`, hasDate),
      t((v) => `Ni vu ni connu, ${v.first} vole la vedette.`),
      t((v) => `Le jour où ${v.first} a compris que ce serait dans l'album.`),
    ],
    duo: [
      t((v) => `${v.names} : 100 % naturel, 0 % posé. Ou presque.`),
      t((v) => `${v.names}, ou l'art de poser sans en avoir l'air.`),
      t((v) => `Deux sourires, zéro clignement. Bravo ${v.names}.`, smiles),
      t((v) => `${v.names} ${v.time} : mission accomplie.`, hasTime),
      t((v) => `${v.names} et ${v.label}, le duo du jour.`, hasLabel),
      t((v) => `Qui a proposé la photo ? Personne ne l'avouera.`),
      t((v) => `${v.names}. La suite au prochain épisode.`),
      t((v) => `Le ${v.date}, sans trucage ni filtre.`, hasDate),
    ],
    group: [
      t((v) => `${v.names} au complet. Faire tenir tout le monde : l'exploit du jour.`),
      t((v) => `${v.n} personnes, une photo, aucun regret.`),
      t((v) => `Tout le monde regarde l'objectif. Enfin, presque.`),
      t((v) => `Réunion au sommet pour ${v.names}.`),
      t((v) => `Le casting était complet ${v.time}.`, hasTime),
      t((v) => `${v.names} et ${v.label} : la totale.`, hasLabel),
      t((v) => `Photo de groupe du ${v.date}. Personne ne s'est enfui.`, hasDate),
    ],
    strangers: [
      t((v) => `Des figurants de luxe pour cette scène ${v.time}.`, hasTime),
      t(() => `On ne connaît personne, mais l'ambiance était bonne.`),
      t((v) => `${cap(v.label)} et compagnie.`, hasLabel),
      t((v) => `Le ${v.date}, quelque part entre deux éclats de rire.`, hasDate),
      t(() => `Beaucoup de monde, et nous au milieu.`),
    ],
    scenery: [
      t((v) => `Ici, même ${v.label} prend la pose.`, hasLabel),
      t(() => `La photo où tout le monde était derrière l'objectif.`),
      t((v) => `Pas un humain à l'horizon ${v.time}. Juste la vue.`, hasTime),
      t((v) => `${cap(v.season)} fait le travail toute seule.`),
      t(() => `Aucun figurant n'a été dérangé pendant cette prise.`),
      t((v) => `${v.date} : la vue, et rien d'autre.`, hasDate),
    ],
  },

  formal: {
    solo: [
      t((v) => `${v.first}, le ${v.date}.`, hasDate),
      t((v) => `Portrait de ${v.first}.`),
      t((v) => `${v.first}, ${v.label}.`, hasLabel),
      t((v) => `${v.first} ${v.time}.`, hasTime),
      t((v) => `${v.first}, ${v.month} ${v.year}.`, hasDate),
      t((v) => `${v.first}, ${v.event}.`, (v) => v.hasEvent),
    ],
    duo: [
      t((v) => `${v.names}, le ${v.date}.`, hasDate),
      t((v) => `${v.names}.`),
      t((v) => `${v.names}, ${v.label}.`, hasLabel),
      t((v) => `${v.names} ${v.time}.`, hasTime),
      t((v) => `${v.names}, ${v.month} ${v.year}.`, hasDate),
    ],
    group: [
      t((v) => `${v.names}, le ${v.date}.`, hasDate),
      t((v) => `${v.names} réunis.`),
      t((v) => `${v.names}, ${v.label}.`, hasLabel),
      t((v) => `${v.names} ${v.time}.`, hasTime),
      t((v) => `${v.names}, ${v.event}.`, (v) => v.hasEvent),
    ],
    strangers: [
      t((v) => `Instant partagé, le ${v.date}.`, hasDate),
      t((v) => `${cap(v.label)} ${v.time}.`, (v) => hasLabel(v) && hasTime(v)),
      t(() => `Scène du jour.`),
      t((v) => `${v.month} ${v.year}.`, hasDate),
    ],
    scenery: [
      t((v) => `${cap(v.label)}, le ${v.date}.`, (v) => hasLabel(v) && hasDate(v)),
      t((v) => `Vue prise ${v.time}.`, hasTime),
      t((v) => `${cap(v.label)}.`, hasLabel),
      t((v) => `${cap(v.month)} ${v.year}.`, hasDate),
      t((v) => `Paysage, ${v.season}.`),
    ],
  },

  poetic: {
    solo: [
      t((v) => `${v.first}, et la lumière qui s'attarde.`),
      t((v) => `Dans les yeux de ${v.first}, tout tient en un regard.`),
      t((v) => `${v.first}, comme une parenthèse dans ${v.season}.`),
      t((v) => `Un souffle de ${v.label} suspendu ${v.time}.`, (v) => hasLabel(v) && hasTime(v)),
      t((v) => `Le temps s'est arrêté sur ${v.first}.`),
      t((v) => `Rien que ${v.first}, et le silence autour.`),
      t((v) => `${v.first} ${v.time}, entre deux respirations.`, hasTime),
    ],
    duo: [
      t((v) => `${v.names}, deux silhouettes dans la même lumière.`),
      t((v) => `Entre ${v.names}, un fil que rien ne coupe.`),
      t((v) => `Ce que ${v.names} partagent ne tient pas en mots.`),
      t((v) => `${v.names}, et ${v.season} pour décor.`),
      t((v) => `Un instant de ${v.label}, à deux.`, hasLabel),
      t((v) => `${v.names}, ${v.time}, sans un mot.`, hasTime),
    ],
    group: [
      t((v) => `${v.names} réunis, comme une évidence.`),
      t(() => `Un cercle de visages, et le monde autour qui s'efface.`),
      t((v) => `${v.names}, ${v.time}, tous ensemble.`, hasTime),
      t((v) => `${v.season} nous avait donné rendez-vous.`),
      t((v) => `Ce que ${v.names} ont écrit ce jour-là.`),
    ],
    strangers: [
      t((v) => `Des vies qui se croisent ${v.time}.`, hasTime),
      t(() => `Un fragment de monde, saisi au vol.`),
      t(() => `Des inconnus, et pourtant ce jour-là.`),
      t((v) => `${cap(v.label)}, et tous ces gens.`, hasLabel),
    ],
    scenery: [
      t((v) => `Le silence de ${v.label}, ${v.time}.`, (v) => hasLabel(v) && hasTime(v)),
      t(() => `Là où le temps a bien voulu s'arrêter.`),
      t((v) => `${cap(v.season)} respire encore ici.`),
      t(() => `Un paysage qui n'attendait personne.`),
      t((v) => `${cap(v.label)}, sans un bruit.`, hasLabel),
    ],
  },

  minimal: {
    solo: [
      t((v) => `${v.first}.`),
      t((v) => `${v.first} — ${v.date}.`, hasDate),
      t((v) => `${v.first}, ${v.label}.`, hasLabel),
      t((v) => `${v.first}. ${cap(v.month)}.`, hasDate),
    ],
    duo: [
      t((v) => `${v.names}.`),
      t((v) => `${v.names} — ${v.date}.`, hasDate),
      t((v) => `${v.names}, ${v.label}.`, hasLabel),
    ],
    group: [
      t((v) => `${v.names}.`),
      t(() => `Tous ensemble.`),
      t((v) => `${v.names} — ${v.date}.`, hasDate),
    ],
    strangers: [
      t((v) => `${cap(v.label)}.`, hasLabel),
      t((v) => `${v.date}.`, hasDate),
      t(() => `Là-bas.`),
    ],
    scenery: [
      t((v) => `${cap(v.label)}.`, hasLabel),
      t((v) => `${v.date}.`, hasDate),
      t((v) => `${cap(v.season)}.`),
      t(() => `La vue.`),
    ],
  },

  family: {
    solo: [
      t((v) => `${v.first}, notre plus beau souvenir ${v.time}.`, hasTime),
      t((v) => `Avec ${v.first}, chaque instant compte.`),
      t((v) => `${v.first}, le ${v.date}. À garder.`, hasDate),
      t((v) => `Un moment avec ${v.first} qu'on n'oubliera pas.`),
      t((v) => `${v.first} et son ${v.label} préféré.`, hasLabel),
      t((v) => `${v.first}, tout simplement.`),
      t((v) => `Notre ${v.first} ${v.ofMonth} ${v.year}.`, hasDate),
      t((v) => `Ce sourire-là, ${v.first}, on le garde.`, smiles),
    ],
    duo: [
      t((v) => `${v.names}, complices comme toujours.`),
      t((v) => `${v.names} : un souvenir de plus.`),
      t((v) => `Avec ${v.names}, ${v.season} avait un goût particulier.`),
      t((v) => `${v.names}, le ${v.date}.`, hasDate),
      t((v) => `${v.names} et ${v.label}, rien que ça.`, hasLabel),
      t((v) => `Tous les deux ${v.time}.`, hasTime),
    ],
    group: [
      t((v) => `${v.names} réunis. Ce sont ces jours-là qu'on garde.`),
      t((v) => `Toute la petite bande, ${v.time}.`, hasTime),
      t((v) => `${v.names}. Une photo pour se souvenir.`),
      t((v) => `Le ${v.date}, tous ensemble.`, hasDate),
      t((v) => `${v.n} sourires sur la même photo.`, smiles),
    ],
    strangers: [
      t((v) => `Un moment de partage ${v.time}.`, hasTime),
      t(() => `Ensemble, tout simplement.`),
      t((v) => `Le ${v.date}, bien entourés.`, hasDate),
      t((v) => `${cap(v.label)} avec tout le monde.`, hasLabel),
    ],
    scenery: [
      t((v) => `Le décor de nos souvenirs ${v.time}.`, hasTime),
      t((v) => `${cap(v.label)} qu'on n'oubliera pas.`, hasLabel),
      t(() => `Un endroit qui nous a marqués.`),
      t((v) => `${cap(v.season)}, quelque part.`),
      t((v) => `Le ${v.date}, rien que pour nous.`, hasDate),
    ],
  },
};

/* --------------------------------- English --------------------------------- */

const EN: Record<CaptionStyle, Pools> = {
  funny: {
    solo: [
      t((v) => `${v.first}: 100% candid, 0% staged. Almost.`),
      t((v) => `Nobody blinked. A ${v.first} achievement.`),
      t((v) => `${v.first} ${v.time}, mid-action.`, hasTime),
      t((v) => `${v.first} and ${v.label}: a love story.`, hasLabel),
      t((v) => `${v.first}, accidental star of ${v.month} ${v.year}.`, hasDate),
    ],
    duo: [
      t((v) => `${v.names}: 100% candid, 0% staged. Almost.`),
      t((v) => `Two smiles, zero blinks. Well done ${v.names}.`, smiles),
      t((v) => `${v.names} ${v.time}: mission accomplished.`, hasTime),
      t((v) => `Nobody will admit who suggested the photo.`),
    ],
    group: [
      t((v) => `${v.names}, all present. Fitting everyone in was the real feat.`),
      t((v) => `${v.n} people, one photo, no regrets.`),
      t(() => `Everyone is looking at the lens. Almost everyone.`),
    ],
    strangers: [
      t((v) => `Premium extras for this scene ${v.time}.`, hasTime),
      t(() => `We knew nobody, but the mood was good.`),
      t((v) => `${cap(v.label)} and company.`, hasLabel),
    ],
    scenery: [
      t((v) => `Even the ${v.label} is posing here.`, hasLabel),
      t(() => `The photo where everyone was behind the camera.`),
      t((v) => `${cap(v.season)} doing all the work.`),
    ],
  },
  formal: {
    solo: [
      t((v) => `${v.first}, ${v.date}.`, hasDate),
      t((v) => `Portrait of ${v.first}.`),
      t((v) => `${v.first}, ${v.label}.`, hasLabel),
      t((v) => `${v.first} ${v.time}.`, hasTime),
    ],
    duo: [t((v) => `${v.names}, ${v.date}.`, hasDate), t((v) => `${v.names}.`), t((v) => `${v.names} ${v.time}.`, hasTime)],
    group: [t((v) => `${v.names}, ${v.date}.`, hasDate), t((v) => `${v.names} together.`)],
    strangers: [t((v) => `A shared moment, ${v.date}.`, hasDate), t(() => `Scene of the day.`)],
    scenery: [t((v) => `${cap(v.label)}, ${v.date}.`, (v) => hasLabel(v) && hasDate(v)), t((v) => `View taken ${v.time}.`, hasTime), t((v) => `${cap(v.season)}.`)],
  },
  poetic: {
    solo: [
      t((v) => `${v.first}, and the light that lingers.`),
      t((v) => `In ${v.first}'s eyes, the whole day.`),
      t((v) => `${v.first}, a pause inside ${v.season}.`),
      t((v) => `A breath of ${v.label}, held ${v.time}.`, (v) => hasLabel(v) && hasTime(v)),
    ],
    duo: [
      t((v) => `${v.names}, two shapes in the same light.`),
      t((v) => `Between ${v.names}, a thread nothing cuts.`),
      t((v) => `${v.names}, with ${v.season} for a backdrop.`),
    ],
    group: [t((v) => `${v.names} together, like an obvious thing.`), t(() => `A circle of faces, the world fading around.`)],
    strangers: [t((v) => `Lives crossing ${v.time}.`, hasTime), t(() => `A fragment of world, caught in passing.`)],
    scenery: [
      t((v) => `The quiet of ${v.label}, ${v.time}.`, (v) => hasLabel(v) && hasTime(v)),
      t(() => `Where time kindly stood still.`),
      t((v) => `${cap(v.season)} still breathes here.`),
    ],
  },
  minimal: {
    solo: [t((v) => `${v.first}.`), t((v) => `${v.first} — ${v.date}.`, hasDate), t((v) => `${v.first}, ${v.label}.`, hasLabel)],
    duo: [t((v) => `${v.names}.`), t((v) => `${v.names} — ${v.date}.`, hasDate)],
    group: [t((v) => `${v.names}.`), t(() => `All together.`)],
    strangers: [t((v) => `${cap(v.label)}.`, hasLabel), t((v) => `${v.date}.`, hasDate), t(() => `Out there.`)],
    scenery: [t((v) => `${cap(v.label)}.`, hasLabel), t((v) => `${v.date}.`, hasDate), t((v) => `${cap(v.season)}.`)],
  },
  family: {
    solo: [
      t((v) => `${v.first}, our favourite memory ${v.time}.`, hasTime),
      t((v) => `With ${v.first}, every moment counts.`),
      t((v) => `${v.first}, ${v.date}. One to keep.`, hasDate),
      t((v) => `${v.first} and that ${v.label} again.`, hasLabel),
    ],
    duo: [t((v) => `${v.names}, partners in everything.`), t((v) => `${v.names}: one more memory.`), t((v) => `${v.names}, ${v.date}.`, hasDate)],
    group: [t((v) => `${v.names} together. These are the days we keep.`), t((v) => `The whole crew, ${v.time}.`, hasTime)],
    strangers: [t((v) => `A moment of togetherness ${v.time}.`, hasTime), t(() => `Together, simply.`)],
    scenery: [t((v) => `The backdrop of our memories ${v.time}.`, hasTime), t((v) => `${cap(v.label)} we won't forget.`, hasLabel), t(() => `A place that stayed with us.`)],
  },
};

/* --------------------------------- Contexte -------------------------------- */

const FR_TIME = { morning: 'ce matin-là', afternoon: 'cet après-midi-là', evening: 'ce soir-là', night: 'cette nuit-là' };
const EN_TIME = { morning: 'that morning', afternoon: 'that afternoon', evening: 'that evening', night: 'that night' };
const FR_SEASONS = ["l'hiver", 'le printemps', "l'été", "l'automne"];
const EN_SEASONS = ['winter', 'spring', 'summer', 'autumn'];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Élision de la préposition « de » devant une voyelle ou un h muet. */
function ofWord(word: string, locale: string): string {
  if (!locale.startsWith('fr')) return `of ${word}`;
  return /^[aeiouyéèêàâîïôöûüh]/i.test(word) ? `d'${word}` : `de ${word}`;
}

function seasonOf(month: number, locale: string): string {
  // 0 = janvier. Décembre à février : hiver, etc.
  const index = month === 11 || month <= 1 ? 0 : month <= 4 ? 1 : month <= 7 ? 2 : 3;
  return (locale.startsWith('fr') ? FR_SEASONS : EN_SEASONS)[index]!;
}

function buildVars(c: CaptionContext): Vars {
  const fr = c.locale.startsWith('fr');
  const date = c.takenAt ? new Date(c.takenAt) : null;
  const valid = date !== null && !Number.isNaN(date.getTime());
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    valid ? new Intl.DateTimeFormat(c.locale, { ...options, timeZone: 'UTC' }).format(date) : '';
  return {
    names: joinNames(c.people, c.locale),
    first: c.people[0] ?? '',
    n: c.people.length,
    faces: c.faceCount,
    label: c.labels[0] ?? '',
    time: c.timeOfDay ? (fr ? FR_TIME[c.timeOfDay] : EN_TIME[c.timeOfDay]) : fr ? 'ce jour-là' : 'that day',
    hasTime: c.timeOfDay !== undefined,
    date: fmt({ day: 'numeric', month: 'long', year: 'numeric' }),
    hasDate: valid,
    month: fmt({ month: 'long' }),
    ofMonth: ofWord(fmt({ month: 'long' }), c.locale),
    year: fmt({ year: 'numeric' }),
    season: valid ? seasonOf(date.getUTCMonth(), c.locale) : fr ? 'la saison' : 'the season',
    smiling: c.smiling === true,
    event: c.eventTitle ?? '',
    hasEvent: (c.eventTitle ?? '').length > 0,
  };
}

function categoryOf(v: Vars): Category {
  if (v.n >= 3) return 'group';
  if (v.n === 2) return 'duo';
  if (v.n === 1) return 'solo';
  return v.faces > 0 ? 'strangers' : 'scenery';
}

export function generateTemplateCaption(req: CaptionRequest): string {
  const c = req.context;
  const table = c.locale.startsWith('fr') ? FR : EN;
  const vars = buildVars(c);
  const pool = (table[req.style] ?? table.minimal)[categoryOf(vars)];
  if (pool.length === 0) return '';

  // Le rang de la photo fait tourner le choix, et le parcours part du gabarit
  // visé puis avance jusqu'au premier applicable. Filtrer d'abord puis tourner
  // ferait varier la taille du tableau selon le contexte, et deux photos
  // presque semblables retomberaient sur la même tournure.
  const seed = hashString(`${c.albumTitle ?? ''}|${req.style}|${c.locale}`);
  const start = (seed + (req.variant ?? 0)) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const tpl = pool[(start + i) % pool.length]!;
    if (!tpl.when || tpl.when(vars)) {
      return sanitizeCaption(tpl.make(vars), req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH);
    }
  }
  // Aucun gabarit applicable : le premier sans condition fait l'affaire.
  const plain = pool.find((tpl) => !tpl.when);
  return plain ? sanitizeCaption(plain.make(vars), req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH) : '';
}
