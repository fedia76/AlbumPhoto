import type { CaptionStyle } from '../../album/types';
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
    ? `Tu écris des légendes d'album photo en français. Réponds uniquement par la légende, sans guillemets ni explication, ${maxLen} caractères maximum. Ton : ${STYLE_FR[style]}. N'invente pas de noms ni de lieux absents des faits.`
    : `You write photo album captions in English. Reply with the caption only, no quotes or explanation, at most ${maxLen} characters. Tone: ${STYLE_EN[style]}. Do not invent names or places not present in the facts.`;
  const user = (fr ? 'Faits sur la photo :\n' : 'Facts about the photo:\n') + facts.map((f) => `- ${f}`).join('\n');
  return { system, user };
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
    ? `Tu écris des légendes d'album photo en français. Tu vois la photo : appuie-toi sur ce qu'elle montre. Réponds uniquement par la légende, sur une seule ligne, sans guillemets ni explication, ${maxLen} caractères maximum. Ton : ${STYLE_FR[style]}. N'invente ni noms, ni lieux, ni détails absents de l'image.`
    : `You write photo album captions in English. You can see the photo: base the caption on what it shows. Reply with the caption only, on a single line, no quotes or explanation, at most ${maxLen} characters. Tone: ${STYLE_EN[style]}. Do not invent names, places or details absent from the image.`;
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
  return newline > 0 && visible.slice(0, newline).trim().length >= 3;
}

/** Nettoie la sortie d'un LLM : guillemets, préfixes, coupures propres. */
export function sanitizeCaption(raw: string, maxLength = DEFAULT_CAPTION_MAX_LENGTH): string {
  let s = raw.trim();
  s = s.replace(/^(légende|caption)\s*:\s*/i, '');
  s = s.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  s = s.replace(/^["'«“]+/, '').replace(/["'»”]+$/, '').trim();
  if (s.length > maxLength) {
    const cut = s.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    s = (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '') + '…';
  }
  return s;
}
