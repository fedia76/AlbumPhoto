import { CAPTION_STYLES, type CaptionOption, type CaptionStyle } from '../../album/types';
import type { CaptionRequest } from './types';
import { DEFAULT_CAPTION_MAX_LENGTH } from './types';
import { joinNames } from './context';

const STYLE_FR: Record<CaptionStyle, string> = {
  funny: 'drôle et légère, avec une pointe d\'humour bienveillant',
  formal: 'sobre et élégante, comme dans un album officiel',
  poetic: 'poétique et évocatrice, en une image sensible',
  minimal: 'minimaliste : quelques mots, sans verbe si possible',
  family: 'chaleureuse et affectueuse, comme un souvenir de famille',
};

const STYLE_EN: Record<CaptionStyle, string> = {
  funny: 'funny and light, with kind humour',
  formal: 'sober and elegant, like an official album',
  poetic: 'poetic and evocative, one sensitive image',
  minimal: 'minimalist: a few words, no verb if possible',
  family: 'warm and affectionate, like a family memory',
};

/**
 * Deux exemples par ton. Un modèle de moins de deux milliards de paramètres
 * n'a que faire d'un adjectif de style — « chaleureuse et affectueuse » ne lui
 * dit rien — mais il imite très bien ce qu'on lui montre. Les exemples ne
 * nomment personne, pour qu'il n'en recopie pas les prénoms.
 */
const EXAMPLES_FR: Record<CaptionStyle, [string, string]> = {
  funny: ['Le pyjama de la victoire, porté avec conviction.', 'Trois secondes avant la catastrophe.'],
  formal: ['Un après-midi de septembre, au jardin.', 'Réunis pour l\'occasion, en fin de journée.'],
  poetic: ['La lumière s\'attarde sur les épaules de l\'été.', 'Un matin qui ne dit rien et raconte tout.'],
  minimal: ['Fin d\'après-midi.', 'Premiers pas.'],
  family: ['Le goûter, très sérieusement.', 'Inséparables, comme toujours.'],
};

const EXAMPLES_EN: Record<CaptionStyle, [string, string]> = {
  funny: ['The victory pyjamas, worn with conviction.', 'Three seconds before disaster.'],
  formal: ['A September afternoon in the garden.', "Together for the occasion, at day's end."],
  poetic: ["The light lingers on summer's shoulders.", 'A morning that says nothing and tells everything.'],
  minimal: ['Late afternoon.', 'First steps.'],
  family: ['Snack time, very seriously.', 'Inseparable, as always.'],
};

/** Consigne de ton, montrée plutôt que décrite. */
function toneInstruction(style: CaptionStyle, fr: boolean): string {
  const [a, b] = fr ? EXAMPLES_FR[style] : EXAMPLES_EN[style];
  return fr
    ? `Ton : ${STYLE_FR[style]}. Exemples du ton attendu, dont tu ne reprends ni les mots ni les situations : « ${a} » ; « ${b} »`
    : `Tone: ${STYLE_EN[style]}. Examples of the expected tone, whose words and situations you must not reuse: "${a}"; "${b}"`;
}

const TIME_FR = { morning: 'le matin', afternoon: "l'après-midi", evening: 'en soirée', night: 'la nuit' };
const TIME_EN = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'at night' };

/**
 * Construit le prompt destiné au LLM local. Sortie volontairement courte :
 * les petits modèles (1–3 B) suivent mieux des instructions compactes.
 */
export function buildCaptionPrompt(req: CaptionRequest): { system: string; user: string } {
  const { context: c, style } = req;
  const fr = c.locale.startsWith('fr');
  const maxLen = req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH;
  const facts: string[] = [];
  // La description passe en premier : c'est le seul fait qui décrit vraiment la
  // photo, les autres ne font que la situer.
  if (c.description) facts.push(fr ? `La photo montre : ${c.description}` : `The photo shows: ${c.description}`);
  if (c.people.length) facts.push(fr ? `Personnes : ${joinNames(c.people, c.locale)}` : `People: ${joinNames(c.people, c.locale)}`);
  else if (c.faceCount > 0) facts.push(fr ? `${c.faceCount} personne(s) non identifiée(s)` : `${c.faceCount} unidentified person(s)`);
  else facts.push(fr ? 'Aucune personne (paysage ou objet)' : 'No people (scenery or object)');
  if (c.labels.length) facts.push(fr ? `Contenu : ${c.labels.slice(0, 5).join(', ')}` : `Content: ${c.labels.slice(0, 5).join(', ')}`);
  if (c.timeOfDay) facts.push(fr ? `Moment : ${TIME_FR[c.timeOfDay]}` : `Time: ${TIME_EN[c.timeOfDay]}`);
  if (c.takenAt) facts.push(fr ? `Date : ${c.takenAt.slice(0, 10)}` : `Date: ${c.takenAt.slice(0, 10)}`);
  if (c.smiling) facts.push(fr ? 'Tout le monde sourit' : 'Everyone is smiling');
  if (c.eventTitle) facts.push(fr ? `Événement : ${c.eventTitle}` : `Event: ${c.eventTitle}`);
  if (c.albumTitle) facts.push(fr ? `Album : ${c.albumTitle}` : `Album: ${c.albumTitle}`);

  const system = fr
    ? `Tu écris des légendes d'album photo en français. Réponds uniquement par la légende, sur une seule ligne, sans préambule, sans guillemets et sans explication, ${maxLen} caractères maximum. ${toneInstruction(style, true)}. N'invente pas de noms ni de lieux absents des faits.`
    : `You write photo album captions in English. Reply with the caption only, on a single line, with no preamble, quotes or explanation, at most ${maxLen} characters. ${toneInstruction(style, false)}. Do not invent names or places not present in the facts.`;
  const user = (fr ? 'Faits sur la photo :\n' : 'Facts about the photo:\n') + facts.map((f) => `- ${f}`).join('\n');
  return { system, user };
}

/**
 * Prompt de description : le modèle vision dit ce qu'il voit, sans style ni
 * consigne de longueur. C'est ce qu'un petit modèle sait faire de mieux —
 * décrire — quand écrire une jolie phrase française le dépasse.
 *
 * La consigne est en anglais à dessein : ces modèles sont entraînés
 * majoritairement en anglais et y décrivent nettement mieux. La description
 * n'est pas montrée à l'utilisateur, elle nourrit le rédacteur.
 */
export function buildDescriptionPrompt(req?: CaptionRequest): { system: string; user: string } {
  const c = req?.context;
  // Ce que l'appareil sait déjà : le modèle n'a pas à le deviner, et le lui
  // dire l'empêche de se tromper sur ce qui est vérifiable. Un petit modèle
  // compte mal les personnes et invente volontiers un décor plausible.
  const known: string[] = [];
  if (c?.faceCount) known.push(`Face detection found ${c.faceCount} face(s) — trust this count over your own.`);
  else if (c && c.faceCount === 0) known.push('Face detection found nobody — this is probably a scene or an object.');
  if (c?.timeOfDay) known.push(`Taken in the ${c.timeOfDay}.`);
  if (c?.labels.length) known.push(`Automatic tags (may be wrong): ${c.labels.join(', ')}.`);

  const system = [
    'You describe photographs for a caption writer who cannot see them.',
    'Answer in English, in two or three sentences, covering in this order:',
    '1. WHO is in frame — adults, children, babies, nobody — and their apparent ages.',
    '2. WHAT they are doing, and where their attention goes.',
    '3. WHERE it is: indoors or outdoors, the setting, notable objects.',
    '4. What makes this particular moment worth a caption: an expression, a gesture, a detail, the light.',
    'Report only what you can see. Never invent names, places or events.',
    'Say "unclear" rather than guessing. No preamble, no bullet points, no commentary.',
  ].join(' ');
  const user = ['Describe this photo.', ...known].join('\n');
  return { system, user };
}

/** Amorces bavardes des modèles instruits, à ne pas prendre pour la légende. */
const PREAMBLE = /^(bien s[ûu]r|voici|voil[àa]|d'accord|okay|ok|sure|certainly|here('s| is)|of course)\b/i;

/** Nettoie une ligne : puce, numérotation, préfixe « Légende : », guillemets. */
function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^(légende|caption)\s*:\s*/i, '')
    .replace(/^["'«“]+/, '')
    .replace(/["'»”]+$/, '')
    .trim();
}

/**
 * Une ligne peut-elle servir de légende ? Les amorces (« Bien sûr ! »), les
 * en-têtes (« Légende : ») et les lignes sans un mot sont écartées : un petit
 * modèle en produit souvent avant d'écrire ce qu'on lui demande.
 */
function usableLine(line: string): boolean {
  if (line.length < 3 || line.endsWith(':')) return false;
  if (PREAMBLE.test(line)) return false;
  return /\p{L}{2,}/u.test(line);
}

/** Longueur maximale d'une description, avant coupure à la phrase. */
const DESCRIPTION_LIMIT = 700;
/**
 * Caractères visibles au-delà desquels une description est jugée complète. Une
 * description tient en deux ou trois phrases ; passé cela le modèle brode.
 */
const DESCRIPTION_BUDGET = 900;

/**
 * Le modèle en a-t-il assez dit sur la photo ? Contrairement à une légende, une
 * description court sur plusieurs phrases et parfois plusieurs lignes :
 * s'arrêter au premier retour à la ligne la mutilerait.
 */
export function hasEnoughDescription(raw: string): boolean {
  if (raw.length >= RAW_BUDGET) return true;
  return stripThinking(raw).length >= DESCRIPTION_BUDGET;
}

/**
 * Nettoie une description : amorces retirées, lignes réunies, coupure à la
 * dernière phrase complète. À la différence d'une légende, tout le texte
 * compte — le rédacteur n'a que cela pour se représenter la photo.
 */
export function sanitizeDescription(raw: string, maxLength = DESCRIPTION_LIMIT): string {
  const lines = stripThinking(raw)
    .split('\n')
    .map(cleanLine)
    .filter((line) => line.length > 0 && !PREAMBLE.test(line) && !line.endsWith(':'));
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  // Couper au milieu d'une phrase donnerait au rédacteur une image tronquée ;
  // mieux vaut rendre une phrase de moins mais entière.
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > maxLength * 0.4) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/** Nombre de propositions demandées par style. */
export const PROPOSALS_PER_STYLE = 4;

/**
 * Demande une série de légendes — plusieurs par style — en un seul appel.
 * Grouper les styles vaut mieux que cinq requêtes : le rédacteur voit d'un coup
 * l'éventail qu'il produit et se répète moins d'un style à l'autre.
 */
export function buildProposalsPrompt(req: CaptionRequest): { system: string; user: string } {
  const { context: c } = req;
  const fr = c.locale.startsWith('fr');
  const maxLen = req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH;
  const styles = CAPTION_STYLES.map((style) => {
    const [a, b] = fr ? EXAMPLES_FR[style] : EXAMPLES_EN[style];
    const tone = fr ? STYLE_FR[style] : STYLE_EN[style];
    return `- "${style}" : ${tone}. ${fr ? 'Par exemple' : 'For example'} « ${a} » ; « ${b} »`;
  }).join('\n');

  const system = fr
    ? [
        `Tu écris des légendes d'album photo en français, ${maxLen} caractères maximum chacune.`,
        `Pour chacun des cinq styles ci-dessous, propose ${PROPOSALS_PER_STYLE} légendes nettement différentes entre elles — pas cinq variantes de la même phrase.`,
        styles,
        "N'invente ni noms, ni lieux, ni détails absents des faits. N'utilise que les prénoms fournis.",
        `Réponds uniquement par un objet JSON : {${CAPTION_STYLES.map((s) => `"${s}": [${PROPOSALS_PER_STYLE} légendes]`).join(', ')}}. Aucun texte autour.`,
      ].join('\n')
    : [
        `You write photo album captions in English, at most ${maxLen} characters each.`,
        `For each of the five tones below, propose ${PROPOSALS_PER_STYLE} clearly different captions — not five variants of one sentence.`,
        styles,
        'Do not invent names, places or details absent from the facts. Use only the first names given.',
        `Reply with a JSON object only: {${CAPTION_STYLES.map((s) => `"${s}": [${PROPOSALS_PER_STYLE} captions]`).join(', ')}}. No surrounding text.`,
      ].join('\n');

  return { system, user: buildCaptionPrompt(req).user };
}

/**
 * Lit la réponse du rédacteur. Tolérante à dessein : un modèle encadre parfois
 * son JSON de texte ou de balises, et perdre vingt propositions pour une accolade
 * de trop serait dommage.
 */
export function parseCaptionProposals(raw: string, maxLength = DEFAULT_CAPTION_MAX_LENGTH): CaptionOption[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const out: CaptionOption[] = [];
  const seen = new Set<string>();
  for (const style of CAPTION_STYLES) {
    const values = (parsed as Record<string, unknown>)[style];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const text = sanitizeCaption(value, maxLength);
      // Deux styles proposent parfois la même phrase : la garder deux fois
      // n'apporte rien à qui choisit.
      const key = `${style}|${text.toLowerCase()}`;
      if (text.length < 3 || seen.has(key)) continue;
      seen.add(key);
      out.push({ style, text });
    }
  }
  return out;
}

/**
 * Prompt destiné à un modèle vision-langage : il a la photo sous les yeux, on
 * ne lui décrit donc pas ce qu'elle montre. Seuls comptent les faits qu'aucune
 * image ne porte — les prénoms, la date, l'événement — et la consigne de style.
 */
export function buildVisionCaptionPrompt(req: CaptionRequest): { system: string; user: string } {
  const { context: c, style } = req;
  const fr = c.locale.startsWith('fr');
  const maxLen = req.maxLength ?? DEFAULT_CAPTION_MAX_LENGTH;
  const facts: string[] = [];
  if (c.people.length) {
    facts.push(
      fr
        ? `Sur la photo : ${joinNames(c.people, c.locale)}. N'utilise aucun autre prénom.`
        : `In the photo: ${joinNames(c.people, c.locale)}. Use no other name.`,
    );
  }
  if (c.takenAt) facts.push(fr ? `Prise le ${c.takenAt.slice(0, 10)}` : `Taken on ${c.takenAt.slice(0, 10)}`);
  if (c.eventTitle) facts.push(fr ? `Événement : ${c.eventTitle}` : `Event: ${c.eventTitle}`);
  if (c.albumTitle) facts.push(fr ? `Album : ${c.albumTitle}` : `Album: ${c.albumTitle}`);

  const system = fr
    ? `Tu écris des légendes d'album photo en français. Tu vois la photo : appuie-toi sur ce qu'elle montre. Réponds uniquement par la légende, sur une seule ligne, sans préambule, sans guillemets et sans explication, ${maxLen} caractères maximum. ${toneInstruction(style, true)}. N'invente ni noms, ni lieux, ni détails absents de l'image.`
    : `You write photo album captions in English. You can see the photo: base the caption on what it shows. Reply with the caption only, on a single line, with no preamble, quotes or explanation, at most ${maxLen} characters. ${toneInstruction(style, false)}. Do not invent names, places or details absent from the image.`;
  const user =
    (fr ? 'Écris la légende de cette photo.' : 'Write the caption for this photo.') +
    (facts.length ? `\n${facts.map((f) => `- ${f}`).join('\n')}` : '');
  return { system, user };
}

/**
 * Le modèle est-il resté enfermé dans sa réflexion ? Un bloc ouvert et jamais
 * refermé ne laisse aucun texte exploitable : c'est un échec, pas une légende
 * trop longue, et cela mérite d'être dit tel quel dans le journal.
 */
export function isStuckThinking(raw: string): boolean {
  const opened = raw.lastIndexOf('<think>');
  return opened >= 0 && !raw.includes('</think>', opened);
}

/** Retire les blocs de réflexion des modèles « thinking » (Qwen 3, etc.). */
export function stripThinking(text: string): string {
  // Un bloc encore ouvert est retiré lui aussi : pendant une génération en
  // cours, tout ce qui suit `<think>` peut n'être que de la réflexion.
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/g, '').trim();
}

/** Une légende passé ce multiple de sa longueur cible : le modèle digresse. */
const LENGTH_BUDGET = 6;
/**
 * Longueur minimale d'une première ligne pour y voir une légende. En deçà,
 * c'est un préambule (« Bien sûr ! », « Voici la légende : ») ou un fragment :
 * couper là revenait à garder le préambule et à jeter la légende.
 */
const MIN_CAPTION_LINE = 25;
/**
 * Caractères bruts tolérés, blocs de réflexion compris, avant de couper. Une
 * réflexion qui dépasse cette taille ne débouchera pas : mieux vaut rendre la
 * main en quelques secondes que d'attendre le délai complet pour rien.
 */
const RAW_BUDGET = 1_200;

/**
 * Le modèle en a-t-il assez écrit ? Une légende tient sur une ligne : dès que
 * la première est complète, la suite n'est que digression et coûte de longues
 * secondes sur un téléphone. `raw` peut être partiel (génération en cours).
 */
export function hasEnoughText(raw: string, maxLength = DEFAULT_CAPTION_MAX_LENGTH): boolean {
  if (raw.length >= RAW_BUDGET) return true;
  const visible = stripThinking(raw);
  if (visible.length >= maxLength * LENGTH_BUDGET) return true;
  const newline = visible.indexOf('\n');
  return newline > 0 && visible.slice(0, newline).trim().length >= MIN_CAPTION_LINE;
}

/** Nettoie la sortie d'un LLM : guillemets, préfixes, coupures propres. */
export function sanitizeCaption(raw: string, maxLength = DEFAULT_CAPTION_MAX_LENGTH): string {
  const lines = raw.trim().split('\n').map(cleanLine).filter(Boolean);
  // La première ligne exploitable, à défaut la première tout court : mieux vaut
  // une légende maladroite que le « Bien sûr ! » qui la précédait.
  let s = lines.find(usableLine) ?? lines[0] ?? '';
  if (s.length > maxLength) {
    const cut = s.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}
