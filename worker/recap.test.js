import { describe, expect, it } from 'vitest';
import { buildPrompt, isValidFacts, recapKey, writeRecap } from './recap.js';

// The reporter's job is to write, and its one hard constraint is to write only
// about what happened. These tests are mostly about the guard rails: what the
// prompt refuses to leave out, and what the route refuses to forward.

const facts = (over = {}) => ({
  date: '2026-08-11',
  matches: 18,
  penalties: 3,
  leadChanges: 4,
  chaos: 61,
  flavour: 'tug-of-war',
  winners: ['Blue'],
  mvp: 'ניב',
  teams: [
    { team: 'Black', points: 5, played: 12, longestRun: 3, players: ['אופק', 'שגב'] },
    { team: 'White', points: 5.5, played: 11, longestRun: 2, players: ['ירין'] },
    { team: 'Blue', points: 7, played: 13, longestRun: 5, players: ['ניב'] },
  ],
  players: [{ name: 'ניב', team: 'Blue', played: 13, won: 7 }],
  moments: ['Blue ended Black’s run of 4 at match 9'],
  milestones: ['ניב reached 50 career match wins'],
  duos: [],
  ...over,
});

describe('isValidFacts', () => {
  it('accepts what recapFacts produces', () => {
    expect(isValidFacts(facts())).toBe(true);
  });

  it('accepts a night with no MVP picked yet', () => {
    expect(isValidFacts(facts({ mvp: null }))).toBe(true);
  });

  it('refuses anything that is not the shape', () => {
    // this payload decides what our API key gets spent on, so it is checked
    // the way a live fixture is — not because our own client is suspect
    expect(isValidFacts(null)).toBe(false);
    expect(isValidFacts('the lads had a good night')).toBe(false);
    expect(isValidFacts(facts({ matches: 'lots' }))).toBe(false);
    expect(isValidFacts(facts({ teams: [] }))).toBe(false);
    expect(isValidFacts(facts({ winners: [1, 2] }))).toBe(false);
  });

  it('refuses a payload padded out to spend tokens', () => {
    expect(isValidFacts(facts({ moments: Array(50).fill('a moment') }))).toBe(false);
    expect(isValidFacts(facts({ moments: ['x'.repeat(500)] }))).toBe(false);
  });
});

describe('buildPrompt', () => {
  const p = buildPrompt(facts());

  it('asks for Hebrew and for names left alone', () => {
    expect(p).toContain('WRITE IN HEBREW');
    expect(p).toMatch(/never translate, transliterate or shorten a name/);
    expect(p).toContain('השחורים');
  });

  it('says what the data does not contain, in as many words', () => {
    // the failure mode is confident invention: a sports-writer prompt with no
    // guard will supply scorers, assists and saves out of nothing
    for (const missing of ['NO goal counts', 'NO scorers', 'NO assists', 'NO saves']) {
      expect(p).toContain(missing);
    }
    expect(p).toMatch(/must not invent/);
  });

  it('explains the rotation, which nothing else would make sense without', () => {
    expect(p).toMatch(/winner stays on/);
  });

  it('carries every number it is allowed to use', () => {
    expect(p).toContain('Matches played: 18');
    expect(p).toContain('Decided on penalties: 3');
    expect(p).toContain('Blue: 7 points from 13 matches');
    expect(p).toContain('ניב reached 50 career match wins');
  });

  it('says so plainly when a section is empty, rather than leaving a gap', () => {
    // a blank list under a heading is an invitation to fill it in
    const quiet = buildPrompt(facts({ moments: [], milestones: [], duos: [] }));
    expect(quiet).toContain('nothing out of the ordinary happened');
    expect(quiet).toContain('nothing was reached');
  });

  it('handles a night nobody won without claiming somebody did', () => {
    expect(buildPrompt(facts({ winners: [] }))).toContain('nobody');
  });
});

describe('writeRecap', () => {
  it('says so when no key is configured, rather than failing obscurely', async () => {
    expect(await writeRecap({}, facts())).toEqual({ error: 'not-configured' });
  });

  it('reports a quota refusal as itself', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    expect(await writeRecap(env, facts())).toEqual({ error: 'quota' });
    globalThis.fetch = original;
  });

  it('reports a blocked generation as blocked', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 });
    expect(await writeRecap(env, facts())).toEqual({ error: 'blocked: SAFETY' });
    globalThis.fetch = original;
  });

  it('never throws when the network is gone — a recap is decoration', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    expect(await writeRecap(env, facts())).toEqual({ error: 'unreachable' });
    globalThis.fetch = original;
  });

  it('says why an answer came back empty, which is never obvious', async () => {
    // the one that actually happened: 2.5 Flash thinks by default and spends
    // the output budget doing it, so the reply arrives with no content at all
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: {} }] }), {
        status: 200,
      });
    expect(await writeRecap(env, facts())).toEqual({ error: 'empty (MAX_TOKENS)' });
    globalThis.fetch = original;
  });

  it('turns thinking off, so the budget pays for the answer', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let sent;
    globalThis.fetch = async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }));
    };
    await writeRecap(env, facts());
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    globalThis.fetch = original;
  });

  it('passes on what Google said when it refused', async () => {
    // a wrong model name and a key with the API disabled are both "upstream
    // 404" until the message comes with them
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'models/gemini-9 is not found' } }), {
        status: 404,
      });
    const out = await writeRecap(env, facts());
    expect(out.error).toContain('404');
    expect(out.error).toContain('gemini-9 is not found');
    globalThis.fetch = original;
  });

  it('joins the parts of a good answer back together', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ערב ' }, { text: 'פרוע' }] } }] }),
        { status: 200 },
      );
    expect(await writeRecap(env, facts())).toEqual({ text: 'ערב פרוע' });
    globalThis.fetch = original;
  });
});

describe('recapKey', () => {
  it('keeps recaps in their own key, well away from the history record', () => {
    // a recap is generated prose that can be thrown away and written again;
    // the fixture record is what happened. They do not share a schema.
    expect(recapKey('f123')).toBe('recap:f123');
  });
});
