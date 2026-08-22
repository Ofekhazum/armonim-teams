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

  it('demands all three teams, so the quiet one is not skipped', () => {
    // the first real report covered one team and half of another
    expect(p).toMatch(/Neither team may be skipped/);
    expect(p).toMatch(/THE OTHER TWO TEAMS/);
  });

  it('tells the model where to put the report, and that the rest is thrown away', () => {
    expect(p).toContain('<report>');
    expect(p).toMatch(/Anything outside the tags is discarded/);
    expect(p).toMatch(/do not check your work inside those tags/i);
  });

  it('does not hand over the change index at all', () => {
    // It came back in a report as מדד השינוי — an internal name for an
    // internal number, quoted at a group who have seen neither. Softening the
    // instruction was tried; not sending it is the version that cannot fail.
    expect(p).not.toContain('Change index');
    expect(p).not.toContain('changed hands: 61');
    expect(p).not.toContain('61');
  });

  it('still asks for the shape of the night in plain words', () => {
    expect(p).toContain('Shape of the night');
    expect(p).toMatch(/never as a figure or under a name of its own/);
  });

  it('asks for a made-up reporter, and a different one each time', () => {
    expect(p).toContain('מדווח מהמגרש');
    expect(p).toMatch(/A different one every time/);
    // the byline must not be somebody who is playing
    expect(p).toMatch(/never use the name of anyone playing tonight/i);
  });

  it('carries where the club stands after tonight', () => {
    const withTable = buildPrompt(facts({ table: ['1. ניב — 47 wins from 20 nights'] }));
    expect(withTable).toContain('TOP OF THE CLUB AFTER TONIGHT');
    expect(withTable).toContain('47 wins from 20 nights');
  });

  it('asks for whole sentences and a length worth reading', () => {
    expect(p).toMatch(/280 to 380 words/);
    expect(p).toMatch(/Never stop mid-sentence/);
  });

  it('carries the personal stories, and says plainly when there are none', () => {
    const withNote = buildPrompt(
      facts({ notes: ['ניב came into tonight 2-8 down against ירין'] }),
    );
    expect(withNote).toContain('2-8 down against ירין');
    expect(buildPrompt(facts({ notes: [] }))).toContain('PERSONAL STORIES');
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

  it('asks for thinking off, so the budget pays for the answer', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let sent;
    globalThis.fetch = async (_url, init) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '<report>ok</report>' }] } }] }),
      );
    };
    await writeRecap(env, facts());
    expect(sent.generationConfig.thinkingConfig).toBeDefined();
    globalThis.fetch = original;
  });

  it('works down the ways of asking for thinking off, whatever the message says', async () => {
    // Models disagree about the thinking switch — some want a budget of zero,
    // some refuse zero, newer ones want a different field entirely — and the
    // refusal can be as unhelpful as "Request contains an invalid argument".
    // Matching on the message was tried and never fired on the real failure.
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Request contains an invalid argument.' } }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '<report>ok</report>' }] } }] }),
      );
    };
    expect(await writeRecap(env, facts())).toEqual({ text: 'ok' });
    // a different way of asking the second time, not the same request again
    expect(bodies[0].generationConfig.thinkingConfig).not.toEqual(
      bodies[1].generationConfig.thinkingConfig,
    );
    globalThis.fetch = original;
  });

  it('gives up once it has run out of ways to ask, rather than hammering', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), {
        status: 400,
      });
    };
    const out = await writeRecap(env, facts());
    expect(calls).toBe(3);
    expect(out.error).toContain('API key not valid');
    globalThis.fetch = original;
  });

  it('names the field when Google will only say "invalid argument"', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Request contains an invalid argument.',
            details: [
              {
                fieldViolations: [
                  { field: 'generation_config.thinking_config', description: 'not supported' },
                ],
              },
            ],
          },
        }),
        { status: 400 },
      );
    const out = await writeRecap(env, facts());
    expect(out.error).toContain('thinking_config');
    expect(out.error).toContain('not supported');
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

  it('leaves the model’s thinking out of the report', async () => {
    // a thought part is the model reasoning out loud; pasted into WhatsApp it
    // reads as something a person wrote
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: 'First I should work out who won...' },
                  { text: '<report>ערב פרוע</report>' },
                ],
              },
            },
          ],
        }),
      );
    expect(await writeRecap(env, facts())).toEqual({ text: 'ערב פרוע' });
    globalThis.fetch = original;
  });

  it('keeps only what is inside the tags', async () => {
    // the failure this exists for: the model checking its own work out loud,
    // as ordinary unflagged text, in the middle of the Hebrew
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Let's check every rule again: 1. Paragraphs: yes, 5.\n<report>ערב פרוע</report>\nThat covers everything.",
                  },
                ],
              },
            },
          ],
        }),
      );
    expect(await writeRecap(env, facts())).toEqual({ text: 'ערב פרוע' });
    globalThis.fetch = original;
  });

  it('refuses an answer with no report in it, rather than passing the working on', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Let's check every rule again..." }] } }],
        }),
      );
    const out = await writeRecap(env, facts());
    expect(out.error).toContain('working out');
    globalThis.fetch = original;
  });

  it('joins the parts of a good answer back together', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '<report>ערב ' }, { text: 'פרוע</report>' }] } }],
        }),
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
