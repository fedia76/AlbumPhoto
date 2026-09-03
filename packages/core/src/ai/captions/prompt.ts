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
