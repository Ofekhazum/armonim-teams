import { describe, expect, it } from 'vitest';
import { buildPrompt, isValidFacts, recapKey, splitEvents, writeRecap } from './recap.js';

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

  it('names the club’s word for a night, so the model does not translate one', () => {
    // The facts are counted in "nights" and the model rendered that as "לילות".
    // This club has always called one a מחזור.
    expect(p).toContain('מחזור');
    expect(p).toMatch(/Never "לילה"/);
  });

  it('bans every other language outright, not just by asking for Hebrew', () => {
    expect(p).toMatch(/NOT ONE WORD OF ANY OTHER LANGUAGE/);
    expect(p).toContain('finalmente'); // the real one that got through
  });

  it('forbids dates in any shape', () => {
    expect(p).toMatch(/NEVER WRITE A DATE/);
  });

  it('tells the reporter to build on a fact rather than recite it', () => {
    expect(p).toMatch(/A FACT IS RAW MATERIAL, NOT A SENTENCE/);
    expect(p).toMatch(/never put two people's facts in the same sentence as a list/);
    // dropping is explicitly better than listing — there are always more facts
    // than a 380-word report can carry
    expect(p).toMatch(/better than reciting it/);
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

  // Naming a team's players is the team sheet, and the group wants it. An
  // earlier pass read a complaint about the bench line as a complaint about
  // name lists and capped every sentence at two names, which took the squads
  // out of the team paragraphs — the opposite of what was asked for. The rule
  // against listing is about *facts* with nothing made of them, never names.
  it('still asks for the squads by name', () => {
    expect(p).toMatch(/the players in that team by name/i);
    expect(p).toMatch(/at least one player named from each/i);
    expect(p).toMatch(/Naming the five players in a team is not a list/i);
  });

  // The teams take turns, so their match counts are close by design. Reporting
  // one as a story produced "הלבנים הציגו יעילות משונה... בילו יותר זמן בצפייה
  // מהצד מאשר במשחק עצמו" about a team that played six of ten and took two and
  // a half points from them.
  it('tells the reporter that matches played is usually not a story', () => {
    expect(p).toMatch(/MATCHES PLAYED IS USUALLY NOT A STORY/);
    expect(p).toMatch(/never tell a team they watched more football than they played/i);
  });

  // The reported complaint, and the one the prompt was quietly working
  // against: with four events it named all four and built on none. Two clauses
  // were doing the damage — "use as many as you can carry" and "dropping one
  // entirely is better than welding it onto another" — inside a word budget
  // that could not have paid for four anyway.
  describe('the organiser’s events, when there are several', () => {
    const four = facts({ said: '@over the fence@ @a dog came on@ @the lights failed@ @nets missing@' });

    it('demands writing about each, not a mention of each', () => {
      const d = buildPrompt(four);
      expect(d).toMatch(/EVERY EVENT GETS TALKED ABOUT\. NOT ONE OF THEM GETS ANNOUNCED\./);
      expect(d).toMatch(/must do something with ALL 4/);
      expect(d).toMatch(/at least two sentences of its own/i);
      expect(d).toMatch(/do not merge two into one sentence/i);
      expect(d).toMatch(/do not summarise several/i);
    });

    // Shows the model the difference rather than asserting it. "Announced" and
    // "talked about" are the same fact, and a rule that only names them leaves
    // the model to guess which side of the line a sentence is on.
    it('shows the failure and the fix on the same invented fact', () => {
      const d = buildPrompt(four);
      expect(d).toMatch(/ANNOUNCED, and wrong/);
      expect(d).toMatch(/TALKED ABOUT, and right/);
    });

    // A rule asking for eight extra sentences inside an unchanged budget is a
    // rule the model will break on the side it can count.
    it('buys the room it just asked for', () => {
      expect(buildPrompt(facts())).toContain('280 to 380 words');
      expect(buildPrompt(facts({ said: 'one thing' }))).toContain('280 to 380 words');
      expect(buildPrompt(four)).toContain('400 to 500 words');
    });

    it('says how many there are in the paragraph plan too', () => {
      expect(buildPrompt(four)).toMatch(/There are 4 of them and each gets/);
      expect(buildPrompt(facts({ said: 'one thing' }))).toMatch(/There is 1 of them and it gets/);
    });
  });

  describe('the derby', () => {
    const line = 'אופק and ירין were tonight’s derby; their teams met 4 times and it finished 1-3';

    it('gets its own section and is pointed at the people paragraph', () => {
      const d = buildPrompt(facts({ derby: line }));
      expect(d).toContain("TONIGHT'S DERBY");
      expect(d).toContain(line);
      expect(d).toMatch(/the group was already waiting on/i);
    });

    // A heading with nothing under it is an invitation to invent a rivalry,
    // and this is the one fact the club reads before kick-off — inventing it
    // would be worse than omitting it.
    it('leaves no empty heading on a night that had none', () => {
      expect(p).not.toContain("TONIGHT'S DERBY");
    });

    it('is accepted by the payload check, and is optional', () => {
      expect(isValidFacts(facts({ derby: line }))).toBe(true);
      expect(isValidFacts(facts())).toBe(true);
      expect(isValidFacts(facts({ derby: 'x'.repeat(501) }))).toBe(false);
    });

    // The line grew when it started naming the winner (§2.33.1), and the cap
    // is the one place that costs a whole report rather than a few words.
    // Measured, not estimated: two long Hebrew names with a three-figure
    // head-to-head and a level finish.
    it('takes the longest line the app can build', () => {
      const a = 'מקסימיליאן בן-אברהם';
      const b = 'אלכסנדר רוזנצוויג';
      const longest =
        `${a} and ${b} were tonight's derby (going in, 120-118 to ${a} across 238 matches ` +
        `— which is why they were picked); their teams met 12 times, 6 of them on penalties, ` +
        `${a} took 7 and ${b} took 5 — tonight's derby finished level, so neither of them ` +
        `took it and nothing was settled`;
      expect(longest.length).toBeGreaterThan(300); // would have been refused before
      expect(isValidFacts(facts({ derby: longest }))).toBe(true);
    });

    // A report went out saying both of them won it. The fact line now carries
    // the verdict outright (see `recapFacts`), so the prompt's job is to stop
    // the model deriving a second opinion from the numbers beside it.
    it('forbids the one outcome that cannot have happened', () => {
      const d = buildPrompt(facts({ derby: line }));
      expect(d).toMatch(/already says who won/i);
      expect(d).toMatch(/cannot both have won/i);
      // and level is named as a real result rather than a gap to fill
      expect(d).toMatch(/finished level/i);
    });
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

  describe('splitting the organiser’s note into events', () => {
    // Done in code rather than left to the prompt, because every ownership
    // rule downstream depends on the split: one event naming a player is what
    // hands the reporter permission to go after them, and the next event
    // naming nobody must stay unattributed. A model's reading of a comma was
    // the weak link in that chain.

    it('reads @…@ markers as the explicit separator', () => {
      expect(splitEvents('@one thing@ @and another@')).toEqual(['one thing', 'and another']);
    });

    it('lets the markers win outright, so a half-marked note cannot mix', () => {
      // Marked and unmarked in the same note is a mistake, not a format —
      // taking only the marked ones is the predictable answer.
      expect(splitEvents('@marked one@\nan unmarked line')).toEqual(['marked one']);
    });

    it('falls back to one event per line, with the bullet trimmed off', () => {
      expect(splitEvents('- first\n- second\n* third')).toEqual(['first', 'second', 'third']);
      expect(splitEvents('1. first\n2) second')).toEqual(['first', 'second']);
      // both markers, not just the outer one
      expect(splitEvents('- 3. doubled up')).toEqual(['doubled up']);
    });

    it('keeps prose in one piece rather than guessing at "and"', () => {
      // "X and Y" is genuinely undecidable between one event and two.
      // Splitting on it would break more notes than it fixed, so an
      // unseparated note stays a single event.
      const said = 'the ball went over the fence and somebody brought a dog';
      expect(splitEvents(said)).toEqual([said]);
    });

    it('drops the empty lines a textarea collects', () => {
      expect(splitEvents('first\n\n\nsecond\n  \n')).toEqual(['first', 'second']);
    });

    it('says nothing when there is nothing', () => {
      expect(splitEvents('')).toEqual([]);
      expect(splitEvents(undefined)).toEqual([]);
    });

    it('hands the model a numbered list it does not have to derive', () => {
      const p = buildPrompt(facts({ said: '@Tom kicked it out@ @somebody brought a dog@' }));
      expect(p).toContain('2 separate things happened');
      expect(p).toContain('EVENT 1: "Tom kicked it out"');
      expect(p).toContain('EVENT 2: "somebody brought a dog"');
      expect(p).toMatch(/that split is not a suggestion and it is not yours to revisit/i);
      expect(p).toMatch(/Run this check once per event, not once for the note/i);
    });

    it('leaves a single event quoted plainly, with no list scaffolding', () => {
      // The common case must not grow a numbered list of one.
      const p = buildPrompt(facts({ said: 'Tom kicked it over the fence' }));
      expect(p).toContain('"Tom kicked it over the fence"');
      expect(p).not.toContain('EVENT 1:');
      expect(p).not.toContain('separate things happened');
    });
  });

  it('forbids merging the events it was handed, and checks ownership per event', () => {
    // The note is one free-text field and an organiser will reasonably put two
    // things in it. The ownership rule used to be written in the singular
    // ("read the line and see whether it names a player"), which has no answer
    // when one half names somebody and the other names nobody — and merging
    // them is how a named player gets attached to an event nobody was named
    // for. The split is now done in code; what the prompt still has to do is
    // stop the model undoing it.
    const said = buildPrompt(facts({ said: '@the ball went over the fence@ @Tom brought a dog@' }));
    expect(said).toMatch(/separate facts with separate owners/i);
    expect(said).toMatch(/do not merge two of them into one story/i);
    expect(said).toMatch(/never assume the person named in one had anything to do with any of the others/i);
    expect(said).toMatch(/one of them naming a player tells you nothing about who the next one belongs to/i);
    // Dropping one used to be the sanctioned escape hatch — "better than
    // welding it onto another" — and between that and "use as many as you can
    // carry", the prompt was licensing exactly the under-service that was
    // reported: four events, four mentions, nothing made of any of them. Every
    // event now gets written about, and the word budget grows to pay for it.
    expect(said).toMatch(/do not drop an event/i);
    expect(said).toMatch(/every event gets talked about/i);
    expect(said).toMatch(/must do something with ALL 2/);
  });

  it('asks for the note to be built on rather than just reported', () => {
    // It is the only actual event in a record that is otherwise all
    // scorelines, and a single flat sentence spends it.
    const said = buildPrompt(facts({ said: 'somebody drove home in their boots' }));
    expect(said).toMatch(/two or three sentences, not one/i);
    expect(said).toMatch(/absurd consequence, a mock investigation/i);
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
    expect(isValidFacts(facts({ said: 'x'.repeat(1601) }))).toBe(false);
    expect(isValidFacts(facts({ said: 7 }))).toBe(false);
  });

  it('takes a full six-event note without calling it bad facts', () => {
    // The app's own cap is `NOTE_MAX` = 1432: six events of 220 characters,
    // delimiters and slack. This end has to sit above it, because the failure
    // mode here is not a shortened note — it is `400 bad facts` and a night
    // with no report — so a note filed right at the app's limit must pass with
    // room to spare rather than exactly.
    const full = Array.from({ length: 6 }, () => `@${'א'.repeat(220)}@`).join(' ');
    expect(full.length).toBeLessThanOrEqual(1432);
    expect(isValidFacts(facts({ said: full }))).toBe(true);
  });

  it('says the shirts are redrawn, and keeps next week off the colours', () => {
    // The one thing about this club a model cannot infer from a night's
    // results: the colours are reassigned every week, so a sign-off promising
    // to come back for השחורים is aimed at five people who will not be in that
    // team. Reported from a real report that ended exactly that way.
    expect(p).toContain('THE SHIRTS ARE DRAWN FRESH EVERY WEEK');
    expect(p).toMatch(/next week's teams do not exist yet/i);
    // Told three times over and still coming back, so the sign-off now names
    // itself as the place it goes wrong rather than only stating the rule.
    expect(p).toMatch(/this is also the paragraph where the shirt rule gets broken/i);
    expect(p).toMatch(/may only be made to a named player about themselves/i);
  });

  it('shows the sign-off mistake and its fix, rather than only forbidding it', () => {
    // Three separate statements of the rule had not stopped it. A wrong
    // example and a right one give the model something to pattern-match
    // against, which an abstract prohibition does not.
    expect(p).toMatch(/Wrong, and the exact mistake to avoid/i);
    expect(p).toContain('להגן על התואר'); // "defend the title" — the wrong one
    expect(p).toMatch(/what a colour will do, want, defend or avenge/i);
    expect(p).toMatch(/Right:/);
    expect(p).toMatch(/no assumption about what shirt anybody will be wearing/i);
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
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '<report>דוח תקין</report>' }] } }] }),
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
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '<report>דוח תקין</report>' }] } }] }),
      );
    };
    expect(await writeRecap(env, facts())).toMatchObject({ text: 'דוח תקין' });
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

  // --- Staying in Hebrew (§2.47) --------------------------------------------
  //
  // The prompt has asked for Hebrew-only from the beginning and a report still
  // came back with the Italian "finalmente" in the middle of a sentence. One
  // word in four hundred is exactly what nobody notices until it is in the
  // group, so the rule has a check behind it now.

  const replies = (text) => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
    return () => {
      globalThis.fetch = original;
    };
  };

  it('refuses a report that slipped into another language', async () => {
    const restore = replies('<report>יועד שבר את הבצורת, finalmente הוא ניצח.</report>');
    const out = await writeRecap({ GEMINI_KEY: 'k' }, facts());
    expect(out.text).toBeUndefined();
    // and says which word, so the organiser knows what they are pressing again for
    expect(out.error).toContain('finalmente');
    restore();
  });

  it('still allows a player whose name is in Latin letters', async () => {
    // A guest called "Guy" is a real case, and the record names everybody who
    // played — so a name that was handed to us is the one legitimate source of
    // Latin characters in the output.
    const restore = replies('<report>Guy לקח את המחזור לבדו.</report>');
    const out = await writeRecap(
      { GEMINI_KEY: 'k' },
      facts({ players: [{ name: 'Guy', team: 'Blue', played: 13, won: 7 }] }),
    );
    expect(out).toMatchObject({ text: 'Guy לקח את המחזור לבדו.' });
    restore();
  });

  it('refuses a report that printed a raw date', async () => {
    // What the screenshot showed: "ושי חזר לשחק לראשונה מאז 2026-08-06".
    // The fact no longer carries a date, and this is the backstop for the day
    // some other fact does.
    const restore = replies('<report>שי חזר לראשונה מאז 2026-08-06.</report>');
    const out = await writeRecap({ GEMINI_KEY: 'k' }, facts());
    expect(out.text).toBeUndefined();
    expect(out.error).toContain('2026-08-06');
    restore();
  });

  it('lets an ordinary Hebrew report through untouched', async () => {
    const restore = replies('<report>📻 קובי שדרן מדווח\n\nערב פרוע במיוחד.</report>');
    const out = await writeRecap({ GEMINI_KEY: 'k' }, facts());
    expect(out.text).toContain('ערב פרוע במיוחד');
    restore();
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
