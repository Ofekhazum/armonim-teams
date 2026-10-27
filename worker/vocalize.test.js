import { describe, expect, it, vi } from 'vitest';
import { MODELS } from './gemini.js';
import { POINTING_MODELS, buildVocalizePrompt, pointCount, sameLetters, stripPoints, vocalize } from './vocalize.js';

// Vowel points for the voice (§2.71). The one thing that must hold: whatever the
// model sends back, the recording is of the report's own words.

const SPOKEN = 'הכחולים לקחו את הערב.\nניב כבש שלושה שערים.';
const POINTED = 'הַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.\nנִיב כָּבַשׁ שְׁלוֹשָׁה שְׁעָרִים.';

const answer = (text) => ({ raw: `<nikud>\n${text}\n</nikud>`, model: 'm' });
const asking = (...answers) => {
  const ask = vi.fn(async () => answers.shift() ?? { error: 'empty' });
  return ask;
};

describe('stripPoints', () => {
  it('takes the vowels off and leaves the letters', () => {
    expect(stripPoints(POINTED)).toBe(SPOKEN);
  });

  it('leaves the maqaf, the Hebrew hyphen, where it is', () => {
    expect(stripPoints('מוֹרֵט־עֲצָבִים')).toBe('מורט־עצבים');
  });

  it('takes the shin dot and the cantillation off too', () => {
    expect(stripPoints('שָׁלוֹם')).toBe('שלום');
    expect(stripPoints('בְּרֵאשִׁ֖ית')).toBe('בראשית');
  });
});

describe('pointCount', () => {
  it('counts vowel points, and nothing in an unpointed text', () => {
    expect(pointCount(POINTED)).toBeGreaterThan(20);
    expect(pointCount(SPOKEN)).toBe(0);
  });
});

describe('sameLetters', () => {
  it('accepts the text with points added', () => {
    expect(sameLetters(SPOKEN, POINTED)).toBe(true);
  });

  it('does not mind how the model spaces its lines', () => {
    expect(sameLetters(SPOKEN, POINTED.replace('\n', '\n\n'))).toBe(true);
  });

  it('refuses a word changed', () => {
    expect(sameLetters(SPOKEN, POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ'))).toBe(false);
  });

  it('refuses a sentence dropped or added', () => {
    expect(sameLetters(SPOKEN, POINTED.split('\n')[0])).toBe(false);
    expect(sameLetters(SPOKEN, `${POINTED}\nוְעוֹד מִשְׁפָּט.`)).toBe(false);
  });

  it('refuses a letter swapped for its twin, or punctuation changed', () => {
    expect(sameLetters(SPOKEN, POINTED.replace('כָּבַשׁ', 'כָּבַס'))).toBe(false);
    expect(sameLetters(SPOKEN, POINTED.replace('הָעֶרֶב.', 'הָעֶרֶב!'))).toBe(false);
  });
});

describe('buildVocalizePrompt', () => {
  it('puts the text between the tags and forbids touching the letters', () => {
    const prompt = buildVocalizePrompt(SPOKEN);
    expect(prompt).toContain(`<nikud>\n${SPOKEN}\n</nikud>`);
    expect(prompt).toMatch(/THE LETTERS MUST NOT CHANGE/);
  });
});

describe('vocalize', () => {
  it('returns the pointed text when it checks out', async () => {
    const ask = asking(answer(POINTED));
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({ text: POINTED, pointed: true });
  });

  it('asks cold, and with room for text twice the length', async () => {
    const ask = asking(answer(POINTED));
    await vocalize({}, SPOKEN, { ask });
    const config = ask.mock.calls[0][2];
    expect(config.temperature).toBeLessThanOrEqual(0.3);
    expect(config.maxTokens).toBeGreaterThanOrEqual(10000);
  });

  it('asks its own models, never the recap writer’s first choice', async () => {
    const ask = asking(answer(POINTED));
    await vocalize({ GEMINI_MODEL: MODELS[0] }, SPOKEN, { ask });
    expect(ask.mock.calls[0][2].models).toBe(POINTING_MODELS);
    expect(POINTING_MODELS).not.toContain(MODELS[0]);
    expect(POINTING_MODELS.every((m) => MODELS.includes(m))).toBe(true);
  });

  it('tries once more when the first answer changed a word, and takes a good second', async () => {
    const ask = asking(answer(POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ')), answer(POINTED));
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({ text: POINTED, pointed: true });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('gives back the plain text, with a reason, rather than a changed one', async () => {
    const changed = POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ');
    const ask = asking(answer(changed), answer(changed));
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({
      text: SPOKEN,
      pointed: false,
      reason: 'the letters changed',
    });
  });

  it('gives back the plain text when the model added no points at all', async () => {
    const ask = asking(answer(SPOKEN), answer(SPOKEN));
    expect(await vocalize({}, SPOKEN, { ask })).toMatchObject({ text: SPOKEN, pointed: false });
  });

  it('gives back the plain text when the model forgot the tags', async () => {
    const ask = asking({ raw: POINTED }, { raw: POINTED });
    expect(await vocalize({}, SPOKEN, { ask })).toMatchObject({ text: SPOKEN, pointed: false, reason: 'no tags' });
  });

  it('does not ask again once the quota is spent', async () => {
    const ask = asking({ error: 'quota' });
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({ text: SPOKEN, pointed: false, reason: 'quota' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('accepts either order of a letter and its points', async () => {
    // a dagesh and a vowel on one letter can be emitted either way round
    const swapped = POINTED.replace('הַכְּחוּלִּים', 'הַכְּחוּלִּים'.normalize('NFD'));
    const ask = asking(answer(swapped));
    expect((await vocalize({}, SPOKEN, { ask })).pointed).toBe(true);
  });
});
