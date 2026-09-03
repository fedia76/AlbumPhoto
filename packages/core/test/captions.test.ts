import { describe, expect, it } from 'vitest';
import {
  CAPTION_STYLES,
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  buildVisionCaptionPrompt,
  generateTemplateCaption,
  hasEnoughText,
  isStuckThinking,
  joinNames,
  sanitizeCaption,
  stripThinking,
  timeOfDayFromIso,
  type CaptionContext,
} from '../src';

const ctx: CaptionContext = {
  people: ['Léa', 'Tom'],
  faceCount: 2,
  labels: ['plage'],
  takenAt: '2026-07-14T18:30:00+02:00',
  timeOfDay: 'evening',
  smiling: true,
  albumTitle: 'Été 2026',
  locale: 'fr-FR',
};

describe('captions', () => {
  it('builds a compact, factual prompt in the right language', () => {
    const fr = buildCaptionPrompt({ context: ctx, style: 'funny' });
    expect(fr.system).toMatch(/légendes d'album photo en français/);
    expect(fr.system).toMatch(/drôle/);
    expect(fr.user).toContain('Léa et Tom');
    expect(fr.user).toContain('plage');
    expect(fr.user).toContain('en soirée');
    const en = buildCaptionPrompt({ context: { ...ctx, locale: 'en-US', people: [] }, style: 'formal', maxLength: 40 });
    expect(en.system).toMatch(/at most 40 characters/);
    expect(en.user).toContain('2 unidentified person(s)');
  });

  it('varies the wording from one photo to the next', () => {
    // Même contexte, rang différent : les tournures doivent tourner.
    const captions = new Set(
      Array.from({ length: 6 }, (_, variant) => generateTemplateCaption({ context: ctx, style: 'family', variant })),
    );
    expect(captions.size).toBeGreaterThanOrEqual(5);
    // Le contexte manquant écarte les gabarits qui en dépendent.
    const bare: CaptionContext = { people: ['Zoé'], faceCount: 1, labels: [], locale: 'fr-FR' };
    for (let variant = 0; variant < 8; variant++) {
      const text = generateTemplateCaption({ context: bare, style: 'family', variant });
      expect(text).not.toMatch(/undefined|, \.|  /);
      expect(text.length).toBeGreaterThan(3);
    }
  });

  it('generates deterministic template captions for every style and language', async () => {
    const gen = new TemplateCaptionGenerator();
    for (const style of CAPTION_STYLES) {
      for (const locale of ['fr-FR', 'en-GB']) {
        const a = await gen.generate({ context: { ...ctx, locale }, style });
        const b = await gen.generate({ context: { ...ctx, locale }, style });
        expect(a).toBe(b);
        expect(a.length).toBeGreaterThan(3);
        expect(a.length).toBeLessThanOrEqual(90);
      }
    }
    const withNames = generateTemplateCaption({ context: ctx, style: 'formal' });
    expect(withNames).toContain('Léa et Tom');
    // Sans personne, la légende parle du lieu, de la date ou de la saison.
    const scenery = generateTemplateCaption({ context: { ...ctx, people: [], faceCount: 0 }, style: 'minimal' });
    expect(scenery).toMatch(/Plage|juillet|été|La vue/);
  });

  it('sanitises LLM output', () => {
    expect(sanitizeCaption('Légende : « Un grand moment »\nExplication…')).toBe('Un grand moment');
    expect(sanitizeCaption('  "Hello world"  ')).toBe('Hello world');
    const long = sanitizeCaption('a'.repeat(50) + ' ' + 'b'.repeat(50), 60);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith('…')).toBe(true);
  });

  it('builds a vision prompt that leans on the image, not on labels', () => {
    const { system, user } = buildVisionCaptionPrompt({ context: ctx, style: 'family' });
    expect(system).toMatch(/Tu vois la photo/);
    expect(system).toMatch(/90 caractères maximum/);
    // Le modèle voit le contenu : lui répéter les étiquettes n'apporte rien et
    // l'induit en erreur quand ML Kit se trompe.
    expect(user).not.toMatch(/plage/i);
    expect(user).not.toMatch(/sourit/i);
    // Les prénoms, eux, ne se devinent pas.
    expect(user).toMatch(/Léa et Tom/);
    expect(user).toMatch(/Été 2026/);
    const english = buildVisionCaptionPrompt({ context: { ...ctx, locale: 'en-US' }, style: 'poetic' });
    expect(english.system).toMatch(/You can see the photo/);
  });

  it('strips thinking blocks, closed or still open', () => {
    expect(stripThinking('<think>Hmm…</think>\nUn grand moment')).toBe('Un grand moment');
    // Génération en cours : le bloc n'est pas encore refermé, rien n'est visible.
    expect(stripThinking('<think>Je réfléchis')).toBe('');
    expect(stripThinking('Un grand moment')).toBe('Un grand moment');
  });

  it('spots a model that never leaves its thinking block', () => {
    expect(isStuckThinking('<think>Je réfléchis encore')).toBe(true);
    expect(isStuckThinking('<think>Hmm</think>\nUn grand moment')).toBe(false);
    expect(isStuckThinking('Un grand moment')).toBe(false);
    // Un deuxième bloc ouvert après un premier refermé compte, lui aussi.
    expect(isStuckThinking('<think>a</think>b<think>c')).toBe(true);
  });

  it('knows when the model has written enough to stop it', () => {
    // Rien encore, ou seulement de la réflexion : il faut le laisser travailler.
    expect(hasEnoughText('')).toBe(false);
    expect(hasEnoughText('<think>' + 'a'.repeat(200))).toBe(false);
    expect(hasEnoughText('Un grand moment')).toBe(false);
    // Une première ligne complète suffit : la suite n'est que digression.
    expect(hasEnoughText('Un grand moment\nExplication…')).toBe(true);
    expect(hasEnoughText('<think>Hmm</think>\nUn grand moment\nEt encore')).toBe(true);
    // Un modèle qui part en boucle est coupé sur la longueur.
    expect(hasEnoughText('a'.repeat(600), 90)).toBe(true);
    expect(hasEnoughText('<think>' + 'a'.repeat(1200))).toBe(true);
  });

  it('derives helpers', () => {
    expect(timeOfDayFromIso('2026-07-14T07:00:00Z')).toBe('morning');
    expect(timeOfDayFromIso('2026-07-14T23:10:00+02:00')).toBe('night');
    expect(timeOfDayFromIso(undefined)).toBeUndefined();
    expect(joinNames(['A', 'B', 'C'], 'fr-FR')).toBe('A, B et C');
    expect(joinNames(['A', 'B'], 'en-US')).toBe('A and B');
  });
});
