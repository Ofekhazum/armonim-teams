import { describe, expect, it, vi } from 'vitest';
import { MODELS } from './gemini.js';
import {
  POINTING_MODELS,
  buildVocalizePrompt,
  lettersOf,
  mergePointed,
  pointCount,
  sameLetters,
  stripPoints,
  vocalize,
} from './vocalize.js';

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

  it('refuses a letter swapped for its twin', () => {
    expect(sameLetters(SPOKEN, POINTED.replace('כָּבַשׁ', 'כָּבַס'))).toBe(false);
  });

  it('refuses a digit changed', () => {
    expect(sameLetters('חמש 5 נקודות.', 'חָמֵשׁ 6 נְקֻדּוֹת.')).toBe(false);
  });

  it('lets punctuation differ — it decides a pause, not a word', () => {
    expect(sameLetters(SPOKEN, POINTED.replace('הָעֶרֶב.', 'הָעֶרֶב!'))).toBe(true);
    expect(sameLetters("ליגה ג'.", 'לִיגָה ג׳.')).toBe(true); // an apostrophe rewritten as a geresh
  });
});

describe('lettersOf', () => {
  it('keeps letters and digits, drops points, punctuation and spacing', () => {
    expect(lettersOf('חָמֵשׁ 5, נְקֻדּוֹת!')).toBe('חמש5נקדות');
  });
});

describe('mergePointed', () => {
  it('takes every line that kept its letters', () => {
    expect(mergePointed(SPOKEN, POINTED)).toEqual({ text: POINTED, ok: 2, of: 2 });
  });

  it('keeps the original for a line that changed, and the points on the rest', () => {
    const second = SPOKEN.split('\n')[1];
    const merged = mergePointed(SPOKEN, POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ'));
    expect(merged).toEqual({ text: `${POINTED.split('\n')[0]}\n${second}`, ok: 1, of: 2 });
    // and whatever is in `text` is still the report's own words
    expect(sameLetters(SPOKEN, merged.text)).toBe(true);
  });

  it('does not count a line the model returned without any points', () => {
    expect(mergePointed(SPOKEN, SPOKEN)).toEqual({ text: SPOKEN, ok: 0, of: 2 });
  });

  it('cannot line up an answer with a different number of lines', () => {
    expect(mergePointed(SPOKEN, POINTED.split('\n')[0])).toBeNull();
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
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({ text: POINTED, pointed: true, ok: 2, of: 2 });
    expect(ask).toHaveBeenCalledTimes(1);
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

  it('tries once more when a line changed, and takes the better answer', async () => {
    const ask = asking(answer(POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ')), answer(POINTED));
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({ text: POINTED, pointed: true, ok: 2, of: 2 });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('keeps the points on the lines that passed when a line never does', async () => {
    const changed = POINTED.replace('כָּבַשׁ', 'הִבְקִיעַ');
    const ask = asking(answer(changed), answer(changed));
    const out = await vocalize({}, SPOKEN, { ask });
    expect(out).toMatchObject({ pointed: true, ok: 1, of: 2 });
    expect(out.text).toBe(`${POINTED.split('\n')[0]}\n${SPOKEN.split('\n')[1]}`);
  });

  it('is not undone by a rewritten apostrophe or a changed full stop', async () => {
    const spoken = "רז זהבי מדווח מליגה ג'.\nהכחולים לקחו את הערב.";
    const pointed = 'רָז זָהָבִי מְדַוֵּוחַ מִלִּיגָה גִ׳!\nהַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.';
    const ask = asking(answer(pointed));
    expect(await vocalize({}, spoken, { ask })).toMatchObject({ pointed: true, ok: 2, of: 2 });
  });

  it('gives back the plain text, with a reason, when no line kept its letters', async () => {
    const wrong = 'שָׁלוֹם עוֹלָם.\nמַשֶּׁהוּ אַחֵר לְגַמְרֵי.';
    const ask = asking(answer(wrong), answer(wrong));
    expect(await vocalize({}, SPOKEN, { ask })).toEqual({
      text: SPOKEN,
      pointed: false,
      reason: 'no line kept its letters',
    });
  });

  it('says so when the answer has a different number of lines', async () => {
    const ask = asking(answer(POINTED.split('\n')[0]), answer(POINTED.split('\n')[0]));
    expect(await vocalize({}, SPOKEN, { ask })).toMatchObject({
      text: SPOKEN,
      pointed: false,
      reason: 'the lines did not match',
    });
  });

  it('gives back the plain text when the model added no points at all', async () => {
    const ask = asking(answer(SPOKEN), answer(SPOKEN));
    expect(await vocalize({}, SPOKEN, { ask })).toMatchObject({
      text: SPOKEN,
      pointed: false,
      reason: 'no line kept its letters',
    });
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
