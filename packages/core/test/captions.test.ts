import { describe, expect, it } from 'vitest';
import {
  CAPTION_STYLES,
  TemplateCaptionGenerator,
  buildCaptionPrompt,
  generateTemplateCaption,
  joinNames,
  sanitizeCaption,
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
    const scenery = generateTemplateCaption({ context: { ...ctx, people: [], faceCount: 0 }, style: 'minimal' });
    expect(scenery).toMatch(/Plage|juillet/);
  });

  it('sanitises LLM output', () => {
    expect(sanitizeCaption('Légende : « Un grand moment »\nExplication…')).toBe('Un grand moment');
    expect(sanitizeCaption('  "Hello world"  ')).toBe('Hello world');
    const long = sanitizeCaption('a'.repeat(50) + ' ' + 'b'.repeat(50), 60);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith('…')).toBe(true);
  });

  it('derives helpers', () => {
    expect(timeOfDayFromIso('2026-07-14T07:00:00Z')).toBe('morning');
    expect(timeOfDayFromIso('2026-07-14T23:10:00+02:00')).toBe('night');
    expect(timeOfDayFromIso(undefined)).toBeUndefined();
    expect(joinNames(['A', 'B', 'C'], 'fr-FR')).toBe('A, B et C');
    expect(joinNames(['A', 'B'], 'en-US')).toBe('A and B');
  });
});
