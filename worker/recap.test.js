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

  it('puts the organiser’s note in the prompt, and says nothing when there is none', () => {
    const said = buildPrompt(facts({ said: 'Tom kicked the ball over the fence 5 times' }));
    expect(said).toContain('SOMETHING ELSE THAT HAPPENED TONIGHT');
    expect(said).toContain('Tom kicked the ball over the fence 5 times');
    // it must not become a licence to describe the football itself
    expect(said).toMatch(/do not treat it as permission to describe goals/i);
    // and a night without one carries no empty heading for the model to fill
    expect(p).not.toContain('SOMETHING ELSE THAT HAPPENED TONIGHT');
  });

  it('tells the reporter it saw the thing itself, and not to invent a culprit', () => {
    // Both from a real report. It wrote "according to the organisers of the
    // round, who revealed a remarkable statistic", and then blamed two players
    // the note never mentioned for a ball nobody was said to have kicked.
    const said = buildPrompt(facts({ said: 'the ball went over the fence about 5 times' }));
    expect(said).toContain('YOU SAW IT YOURSELF');
    expect(said).toMatch(/never say where this came from/i);
    // ...without killing the invented-source joke, which shares its
    // vocabulary and is one of the best things the reporter does
    expect(said).toMatch(/is a joke and is still very welcome/i);
    expect(said).toMatch(/if it names nobody, it belongs to nobody/i);
    expect(said).toMatch(/do not guess who did it/i);
    // The sign-off is where this leaks: it demands names, so the model names
    // players and hooks them to the nearest concrete event. A real report
    // closed by telling six people to aim for the pitch and not over the
    // fence, for a ball nobody was said to have kicked.
    expect(said).toMatch(/no player's name may appear anywhere near it/i);
    expect(said).toMatch(/this holds in EVERY paragraph/i);
    expect(said).toMatch(/if the line names nobody, next week is not about it/i);
  });

  it('rations the invented-source joke rather than banning or repeating it', () => {
    expect(p).toContain('Once, maybe twice in the whole report');
    expect(p).toMatch(/turned its best joke into a verbal tic/i);
  });

  it('points the sign-off at results rather than at an unattributed event', () => {
    expect(p).toMatch(/called out for \*\*their own results tonight\*\*/i);
    expect(p).toMatch(/never aim it at an event nobody was named for/i);
  });

  it('accepts a note in the facts, and refuses a wall of text', () => {
    expect(isValidFacts(facts({ said: 'a real thing that happened' }))).toBe(true);
    expect(isValidFacts(facts({ said: 'x'.repeat(401) }))).toBe(false);
    expect(isValidFacts(facts({ said: 7 }))).toBe(false);
  });

  it('says the shirts are redrawn, and keeps next week off the colours', () => {
    // The one thing about this club a model cannot infer from a night's
    // results: the colours are reassigned every week, so a sign-off promising
    // to come back for השחורים is aimed at five people who will not be in that
    // team. Reported from a real report that ended exactly that way.
    expect(p).toContain('THE SHIRTS ARE DRAWN FRESH EVERY WEEK');
    expect(p).toMatch(/never aim it at a shirt colour/i);
    expect(p).toMatch(/next week's teams do not exist yet/i);
  });

  it('asks for sharp rather than polite, and says who is reading', () => {
    expect(p).toMatch(/A polite report is a failed report/);
    expect(p).toMatch(/merciless about their results/);
  });

  it('keeps the one line that matters', () => {
    // everything mocked is a result; nothing mocked is a person
    expect(p).toMatch(/Everything you mock is a \*result\*/);
    for (const forbidden of ['body', 'weight', 'looks', 'health', 'family']) {
      expect(p).toContain(forbidden);
    }
    expect(p).toMatch(/Never write a realistic quotation and attribute it to a player/);
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

  it('does not quote a club table, which ranked a one-night player over regulars', () => {
    const withTable = buildPrompt(facts({ table: ['1. ניב — 47 wins from 20 nights'] }));
    expect(withTable).not.toContain('TOP OF THE CLUB');
    expect(withTable).not.toContain('47 wins');
  });

  it('asks for the rivalry as a story rather than as a record', () => {
    expect(p).toMatch(/stories, not statistics/);
    expect(p).toMatch(/do not print it as a record/);
  });

  it('asks for whole sentences and a length worth reading', () => {
    expect(p).toMatch(/280 to 380 words/);
    expect(p).toMatch(/Never stop mid-sentence/);
  });

  it('carries the stories, and says plainly when there are none', () => {
    const withNote = buildPrompt(facts({ notes: ['ניב nearly always comes off worse against ירין'] }));
    expect(withNote).toContain('comes off worse against ירין');
    expect(buildPrompt(facts({ notes: [] }))).toContain('none this week');
  });

  it('tells the model the notes are material rather than lines to print', () => {
    // they arrive as bare facts on purpose; a fact printed as written is the
    // statistical vibe this whole feature keeps sliding back into
    expect(p).toMatch(/written as bare facts on purpose/);
    expect(p).toMatch(/funniest true sentences/);
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
    // one per model in the waterfall, and none of them reachable
    expect((await writeRecap(env, facts())).error).toMatch(/every model refused/);
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
    expect(await writeRecap(env, facts())).toMatchObject({ text: 'ok' });
    // a different way of asking the second time, not the same request again
    expect(bodies[0].generationConfig.thinkingConfig).not.toEqual(
      bodies[1].generationConfig.thinkingConfig,
    );
    globalThis.fetch = original;
  });

  it('gives up once it has run out of ways to ask, rather than hammering', async () => {
    // Bounded, and worth knowing the bound: three ways of asking for thinking
    // off, times five models in the waterfall. Only ever reached when every
    // model rejects every shape of the request, which means the payload is
    // wrong rather than the quota — and a 400 costs no tokens, so fifteen fast
    // refusals is cheap next to never trying the model that would have said yes.
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'Bad argument' } }), { status: 400 });
    };
    const out = await writeRecap(env, facts());
    expect(calls).toBe(15);
    expect(out.error).toContain('Bad argument');
    globalThis.fetch = original;
  });

  // --- The waterfall (§2.24) ------------------------------------------------
  // The free tier's problem is that it is uneven, not that it is small: the
  // best model allows about twenty requests a day, the lite ones five hundred.
  // These are about what happens when the good one says no.

  const okReply = () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '<report>דוח</report>' }] } }] }),
    );

  // Answers `status` to the first `n` models and a real report to the next.
  const refuseFirst = (n, status, seen) => async (url) => {
    seen.push(String(url).match(/models\/([^:]+):/)[1]);
    return seen.length <= n ? new Response('{}', { status }) : okReply();
  };

  it('drops to the next model when the good one is out of quota', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = refuseFirst(1, 429, seen);
    const out = await writeRecap(env, facts());
    expect(out.text).toBe('דוח');
    // written by the second model, and it says which
    expect(out.model).toBe('gemini-3.5-flash');
    expect(seen).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash']);
    globalThis.fetch = original;
  });

  it('keeps falling until something takes it, best first', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = refuseFirst(3, 429, seen);
    const out = await writeRecap(env, facts());
    expect(out.model).toBe('gemini-3.1-flash-lite');
    // in order, no skipping: the best model that will take it writes the report
    expect(seen).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
    ]);
    globalThis.fetch = original;
  });

  it('falls through an outage and a retired model too', async () => {
    for (const status of [500, 503, 404]) {
      const original = globalThis.fetch;
      const seen = [];
      globalThis.fetch = refuseFirst(1, status, seen);
      const out = await writeRecap({ GEMINI_KEY: 'k' }, facts());
      expect(out.text, `status ${status}`).toBe('דוח');
      globalThis.fetch = original;
    }
  });

  it('says the free tier is spent when every model says 429', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 429 });
    // five identical numbers is a paragraph nobody can read; this is the
    // ordinary version of a total failure and gets the plain word for it
    expect(await writeRecap(env, facts())).toEqual({ error: 'quota' });
    globalThis.fetch = original;
  });

  it('names every model and its answer when they all refuse differently', async () => {
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let n = 0;
    globalThis.fetch = async () => {
      n++;
      return new Response('{}', { status: n === 1 ? 429 : 503 });
    };
    const out = await writeRecap(env, facts());
    expect(out.error).toContain('gemini-3.6-flash: 429');
    expect(out.error).toContain('gemini-3-flash: 503');
    globalThis.fetch = original;
  });

  it('lets GEMINI_MODEL jump the queue without becoming the whole queue', async () => {
    // The escape hatch for the day Google renames something. It used to
    // *replace* the list, which pinned the failure along with the model.
    const env = { GEMINI_KEY: 'k', GEMINI_MODEL: 'models/gemini-3.5-flash-lite' };
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = refuseFirst(1, 429, seen);
    const out = await writeRecap(env, facts());
    // the `models/` prefix Google's own docs use is accepted and stripped
    expect(seen[0]).toBe('gemini-3.5-flash-lite');
    // and the rest of the waterfall is still behind it, without a duplicate
    expect(seen[1]).toBe('gemini-3.6-flash');
    expect(out.text).toBe('דוח');
    globalThis.fetch = original;
  });

  it('stops at a 200, whatever the 200 contained', async () => {
    // A model that answers with its working out instead of a report is a
    // content failure, and asking four more models to have a go would spend
    // five quotas on one bad answer. Content failures have their own fixes.
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'let me check my work' }] } }] }),
      );
    };
    const out = await writeRecap(env, facts());
    expect(calls).toBe(1);
    expect(out.error).toContain('working out');
    globalThis.fetch = original;
  });

  it('does not walk the waterfall for a rejected key', async () => {
    // 401 is the one refusal every model gives identically. Falling through
    // would turn one clear answer into five slow copies of it.
    const env = { GEMINI_KEY: 'k' };
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), {
        status: 401,
      });
    };
    const out = await writeRecap(env, facts());
    expect(calls).toBe(1);
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
    expect(await writeRecap(env, facts())).toMatchObject({ text: 'ערב פרוע' });
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
    expect(await writeRecap(env, facts())).toMatchObject({ text: 'ערב פרוע' });
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
    expect(await writeRecap(env, facts())).toMatchObject({ text: 'ערב פרוע' });
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
