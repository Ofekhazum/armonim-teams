import { describe, expect, it, vi } from 'vitest';
import {
  buildGradesPrompt,
  gradesKey,
  isValidGradeFacts,
  readAllMarks,
  writeGrades,
} from './grades.js';

// The grades prompt (§2.39). The mark is arithmetic and tested in
// src/grades.test.ts; what matters here is what the model is told — that it is
// one request for everybody, that it cannot key on a Hebrew name, that no
// rating has crept into the payload, and that it may not decide for itself who
// a loose fact belongs to.

const player = (over = {}) => ({
  key: 'p1',
  id: 'id1',
  name: 'ניב',
  grade: 10,
  team: 'black',
  teamWins: 9.5,
  place: 1,
  wonNight: true,
  isMvp: true,
  nightsBefore: 30,
  trend: 'hot',
  runBefore: 3,
  droughtBefore: 0,
  ...over,
});

const facts = (over = {}) => ({
  date: '2026-08-20',
  matches: 11.5,
  winners: ['black'],
  mvp: 'ניב',
  said: null,
  milestones: [],
  derby: null,
  players: [
    player(),
    player({
      key: 'p2',
      id: 'id2',
      name: 'אופק',
      grade: 4.5,
      team: 'blue',
      teamWins: 2,
      place: 2,
      wonNight: false,
      isMvp: false,
      trend: 'cold',
      runBefore: 0,
      droughtBefore: 7,
    }),
    player({
      key: 'p3',
      id: 'id3',
      name: 'בר',
      grade: 3.5,
      team: 'white',
      teamWins: 0,
      place: 3,
      wonNight: false,
      isMvp: false,
      nightsBefore: 0,
      trend: null,
      runBefore: 0,
      droughtBefore: 0,
    }),
  ],
  ...over,
});

const derby = (over = {}) => ({
  aKey: 'p1',
  aName: 'ניב',
  bKey: 'p2',
  bName: 'אופק',
  aBefore: 7,
  bBefore: 7,
  faced: 14,
  met: 3,
  aTook: 2,
  bTook: 1,
  penalties: 0,
  ...over,
});

describe('buildGradesPrompt', () => {
  it('is one request covering everybody, not one per player', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/ONE request covering every player/);
    expect(p).toMatch(/covering all 3 players in one answer/);
  });

  it('keys the output on an ascii code rather than a Hebrew name', () => {
    // A single altered character in a Hebrew name would orphan that line, and
    // a model rewriting one is far more likely than it rewriting "p2".
    const p = buildGradesPrompt(facts());
    for (const key of ['[p1]', '[p2]', '[p3]']) expect(p).toContain(key);
    expect(p).toMatch(/Use the key, never the name/);
  });

  it('never puts a player id in front of the model', () => {
    // The id is in the payload so the answer can be mapped back onto a person;
    // it has no business in the prompt, where it is meaningless and billable.
    const p = buildGradesPrompt(facts());
    for (const id of ['id1', 'id2', 'id3']) expect(p).not.toContain(id);
  });

  it('carries no rating into the payload', () => {
    // §2.28 — ratings never leave the Worker, and a grade is far more pointed
    // than a price tag. The payload is counts only.
    const p = buildGradesPrompt(facts());
    expect(p).not.toMatch(/rating|כוכב|דירוג/i);
  });

  it('forbids inventing anything that happened on the pitch', () => {
    // The failure the night reporter took four rounds to stop (§2.24), and the
    // one that matters most here because banter invites it.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/NO goals, NO scorers, NO assists/);
    expect(p).toMatch(/making it up about a real person/);
  });

  it('asks for exactly one sentence, and not the number', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/ONE sentence in Hebrew\. One\./);
    expect(p).toMatch(/Do not write the mark itself/);
  });

  it('draws the line at the football, not the person', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/Mock the football, never the person/);
  });

  it('refuses a scoreline in nicer words as a joke', () => {
    // A real spike came back as fact restatement with a nicer verb — "scraped
    // a single win" — dressed as banter. Named directly so the model cannot
    // satisfy the letter of "be funny" while missing the point of it.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/A SCORELINE IN NICER WORDS IS NOT A JOKE/);
    expect(p).toMatch(/If your sentence would work as a caption under a stats table/);
  });

  it('tells the model not to write every line in the same shape', () => {
    // The first real sheet came back with fifteen of sixteen lines in the
    // identical construction — third person, past tense, name then a mild
    // metaphor. Each was fine alone; the set read like a form letter. Being
    // one batched request is what makes this fixable at all: the model can
    // see the whole sheet before it answers.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/NO TWO LINES THE SAME SHAPE/);
    expect(p).toMatch(/the same trick twice in a row is a failed sheet/);
    // and the place the repetition actually showed up worst
    expect(p).toMatch(/three debutants/);
  });

  it('tells the model not to write a shared team result as a line about the team', () => {
    // Real published lines addressed a whole shirt at once — "השחורים סיימו
    // אחרונים", "לפחות סיימתם" — next to one player's name. The sentence has
    // to land on the one person it sits beside, even off a fact all five
    // teammates share.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/EVERY LINE LANDS ON ONE NAMED PLAYER, NEVER ON THE TEAM/);
    expect(p).toMatch(/never the plural "you" and never a comment aimed at the team as a whole/);
  });

  it('asks the model to make sense before it tries to be clever', () => {
    // Some published lines did not parse as one coherent thought in Hebrew —
    // a metaphor reaching further than one sentence can hold.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/MAKE SENSE FIRST, CLEVER SECOND/);
  });

  it('tells the model to praise a high mark instead of undercutting it', () => {
    // A real published line gave a player on an 8.5 a "hitching a ride on the
    // team" dig — a coat-tail joke, which is the wrong register for a mark
    // that says this person is personally doing well. The mark, not just the
    // win flag or the MVP pick, has to set the tone.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/THE PLAYER'S OWN MARK DECIDES WHICH OF THESE YOU REACH FOR/);
    expect(p).toMatch(/NOT the moment for a dig about luck, freeloading, riding the team's coat-tails/);
  });

  it('says whether a winning run survived tonight, not just that they arrived on one', () => {
    // A player came in on three straight, their team was beaten, and the mark
    // was still decent — so the line congratulated them on the run. The fact
    // said "arrived with 3 in a row" and stopped there, leaving the model to
    // notice the loss on its own. It now says which way it went.
    const ended = buildGradesPrompt(
      facts({
        players: [player({ runBefore: 3, wonNight: false, place: 3, teamWins: 1 })],
      }),
    );
    expect(ended).toContain('והרצף נגמר הלילה');
    expect(ended).not.toContain('והרצף ממשיך');

    const kept = buildGradesPrompt(
      facts({ players: [player({ runBefore: 3, wonNight: true })] }),
    );
    expect(kept).toContain('והרצף ממשיך');
    expect(kept).not.toContain('והרצף נגמר הלילה');
  });

  it('tells the model that what somebody arrived with can be reversed by tonight', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/WHAT SOMEBODY ARRIVED WITH IS NOT WHAT HAPPENED TONIGHT/);
    expect(p).toMatch(/not a run to congratulate somebody on/i);
    expect(p).toMatch(/the last clause on it often reverses the first/i);
  });

  it('keeps the banter from promising anything about next week’s shirts', () => {
    // Same failure the night report had: a colour is a team for one evening,
    // so a line about what the blues will do next week is aimed at five people
    // who will not be in that team.
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/THE SHIRTS ARE DRAWN FRESH EVERY WEEK, AND NO LINE MAY POINT PAST TONIGHT/);
    expect(p).toMatch(/would still make sense only if the teams stayed the same/i);
    // but a player's own luck in a colour still belongs to them
    expect(p).toMatch(/follows them into whatever they wear next/i);
  });

  it('hands the model concrete devices rather than only an adjective', () => {
    // "Funny, sharp, a bit rude" alone produced flat prose in the field — one
    // sentence is a harder format to be funny in than five paragraphs, and it
    // needs more to reach for, not less.
    const p = buildGradesPrompt(facts());
    for (const device of ['EXAGGERATE WILDLY', 'INVENT A NAME FOR THE NIGHT', 'MOCK DEMAND', 'RHETORICAL']) {
      expect(p).toContain(device);
    }
  });

  it('says what each player brought in, so the joke has material', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toContain('נבחר לשחקן הערב'); // the MVP
    expect(p).toContain('לא לקח ערב כבר 7 ערבים'); // the drought
    expect(p).toContain('בירידת כושר'); // the cold run
    expect(p).toContain('סיימו אחרונים'); // the team that finished bottom
    expect(p).toContain('ערב ראשון במועדון'); // the debut
  });

  it('names the winning team in Hebrew, from a colour code', () => {
    expect(buildGradesPrompt(facts())).toContain('Winner of the night: השחורים');
    expect(buildGradesPrompt(facts({ winners: [] }))).toMatch(/nobody — the top was level/);
  });

  // --- The rule the first spike earned ------------------------------------
  // Given an unassigned note and a player who had lost every match, the model
  // put the two together and named him. Nothing in the record said it was him.

  it('refuses to attribute a loose fact to anybody', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/WHO A FACT BELONGS TO/);
    expect(p).toMatch(/If a note is unassigned, do not assign it/);
    expect(p).toMatch(/Do not guess and do not infer who did what/);
  });

  it('names the exact wrong inference, rather than only the rule', () => {
    const p = buildGradesPrompt(facts());
    expect(p).toMatch(/A bad night is not evidence/);
    expect(p).toMatch(/The player with the lowest mark did not do it/);
  });

  it('sends an unassigned note back to that rule', () => {
    const withNote = buildGradesPrompt(facts({ said: 'הכדור עף מעל הגדר' }));
    expect(withNote).toMatch(/WHAT THE ORGANISER SAID/);
    expect(withNote).toContain('הכדור עף מעל הגדר');
    expect(withNote).toMatch(/If it names nobody, it is nobody's/);
    expect(withNote).toMatch(/Do not pin it on the worst night/);
  });

  it('includes the organiser’s note only when there is one', () => {
    expect(buildGradesPrompt(facts())).not.toMatch(/WHAT THE ORGANISER SAID/);
  });

  it('marks milestones as belonging to whoever they name', () => {
    const p = buildGradesPrompt(facts({ milestones: ['ניב reached 50 career match wins'] }));
    expect(p).toMatch(/WHAT PLAYERS REACHED TONIGHT/);
    expect(p).toMatch(/It belongs to nobody else/);
  });

  // --- The derby ----------------------------------------------------------

  it('says nothing about a derby when there was none', () => {
    expect(buildGradesPrompt(facts())).not.toMatch(/TONIGHT'S DERBY/);
  });

  it('gives the derby to both players, and to nobody else', () => {
    const p = buildGradesPrompt(facts({ derby: derby() }));
    expect(p).toMatch(/TONIGHT'S DERBY/);
    expect(p).toContain('ניב against [p2] אופק, 7–7 across 14 matches');
    expect(p).toMatch(/met 3 times and ניב came out ahead, 2–1/);
    expect(p).toMatch(/whoever came out ahead gets to enjoy it/);
    expect(p).toMatch(/whoever came off worse hears about it/);
    expect(p).toMatch(/do not mention it in anybody else's line/);
  });

  it('reads the derby from the loser’s side when the loser is player a', () => {
    const p = buildGradesPrompt(facts({ derby: derby({ aTook: 0, bTook: 3 }) }));
    expect(p).toMatch(/אופק came out ahead, 3–0/);
  });

  it('calls a split derby a split', () => {
    const p = buildGradesPrompt(facts({ derby: derby({ met: 4, aTook: 2, bTook: 2 }) }));
    expect(p).toMatch(/they split it 2–2, which settles precisely nothing/);
  });

  it('mentions penalties when the derby needed them', () => {
    const p = buildGradesPrompt(facts({ derby: derby({ penalties: 2 }) }));
    expect(p).toMatch(/2 of those meetings went to penalties/);
  });

  it('makes a night the two never met into the joke itself', () => {
    const p = buildGradesPrompt(facts({ derby: derby({ met: 0, aTook: 0, bTook: 0 }) }));
    expect(p).toMatch(/the two shirts never met/);
    expect(p).toMatch(/billed against each other and then spent the night waiting/);
  });
});

describe('isValidGradeFacts', () => {
  it('accepts what gradesFacts produces', () => {
    expect(isValidGradeFacts(facts())).toBe(true);
    expect(isValidGradeFacts(facts({ derby: derby(), said: 'note', milestones: ['x'] }))).toBe(true);
  });

  it('refuses anything that is not the shape', () => {
    expect(isValidGradeFacts(null)).toBe(false);
    expect(isValidGradeFacts({})).toBe(false);
    expect(isValidGradeFacts(facts({ players: [] }))).toBe(false);
    expect(isValidGradeFacts(facts({ winners: ['pink'] }))).toBe(false);
    expect(isValidGradeFacts(facts({ date: '' }))).toBe(false);
  });

  it('refuses a duplicate key, which would collapse two players into one line', () => {
    const dupe = facts();
    dupe.players[1].key = 'p1';
    expect(isValidGradeFacts(dupe)).toBe(false);
  });

  it('refuses a key that is not a key', () => {
    const bad = facts();
    bad.players[0].key = 'ניב';
    expect(isValidGradeFacts(bad)).toBe(false);
  });

  it('refuses a grade outside the scale', () => {
    expect(isValidGradeFacts(facts({ players: [player({ grade: 11 })] }))).toBe(false);
    expect(isValidGradeFacts(facts({ players: [player({ grade: 0 })] }))).toBe(false);
  });

  it('refuses a derby pointing at a player the prompt never defines', () => {
    expect(isValidGradeFacts(facts({ derby: derby({ bKey: 'p9' }) }))).toBe(false);
    expect(isValidGradeFacts(facts({ derby: derby({ bKey: 'p1' }) }))).toBe(false);
  });
});

describe('writeGrades', () => {
  const reply = (text) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
    });

  it('needs a key before it will spend one', async () => {
    expect(await writeGrades({}, facts())).toEqual({ error: 'not-configured' });
  });

  it('maps the answer back onto player ids, never the p-codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('{"p1":"מלך","p2":"נו באמת","p3":"ברוך הבא"}')),
    );
    const out = await writeGrades({ GEMINI_KEY: 'k' }, facts());
    expect(out.lines).toEqual({
      id1: { text: 'מלך', grade: 10 },
      id2: { text: 'נו באמת', grade: 4.5 },
      id3: { text: 'ברוך הבא', grade: 3.5 },
    });
    expect(out.missing).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('digs the object out of a markdown fence rather than refusing it', async () => {
    // Asked for a bare object and told not to fence it; models fence it anyway
    // often enough that throwing away a good answer over punctuation would be
    // the wrong trade.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('```json\n{"p1":"א","p2":"ב","p3":"ג"}\n```')),
    );
    const out = await writeGrades({ GEMINI_KEY: 'k' }, facts());
    expect(Object.keys(out.lines)).toHaveLength(3);
    vi.unstubAllGlobals();
  });

  it('names who was left out, and still publishes their mark', async () => {
    // Every player gets an entry because the mark is the published artifact —
    // a public device cannot recompute it (see linesFrom). Only `text` is
    // missing for the players the model skipped.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('{"p1":"מלך"}')),
    );
    const out = await writeGrades({ GEMINI_KEY: 'k' }, facts());
    expect(Object.keys(out.lines)).toEqual(['id1', 'id2', 'id3']);
    expect(out.lines.id1).toEqual({ text: 'מלך', grade: 10 });
    expect(out.lines.id2).toEqual({ grade: 4.5 });
    expect(out.lines.id3).toEqual({ grade: 3.5 });
    expect(out.missing).toEqual(['אופק', 'בר']);
    vi.unstubAllGlobals();
  });

  it('ignores a key the model invented', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('{"p1":"מלך","p2":"ב","p3":"ג","p47":"מי זה"}')),
    );
    const out = await writeGrades({ GEMINI_KEY: 'k' }, facts());
    expect(Object.keys(out.lines)).toEqual(['id1', 'id2', 'id3']);
    vi.unstubAllGlobals();
  });

  it('gives up when the answer is not an object at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('here are the grades, they were all great')),
    );
    expect(await writeGrades({ GEMINI_KEY: 'k' }, facts())).toEqual({
      error: 'the model did not return a JSON object',
    });
    vi.unstubAllGlobals();
  });

  it('gives up when it answered about nobody on the sheet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('{"someone":"מלך"}')),
    );
    expect(await writeGrades({ GEMINI_KEY: 'k' }, facts())).toEqual({
      error: 'the model answered about nobody on the sheet',
    });
    vi.unstubAllGlobals();
  });
});

describe('gradesKey', () => {
  it('is namespaced away from every other key in the store', () => {
    expect(gradesKey('fx1')).toBe('grades:fx1');
  });
});

describe('readAllMarks', () => {
  // A tiny stand-in for the KV binding: enough of `list` and `get` to exercise
  // the paging and the parsing, which is where this can actually go wrong.
  const kv = (store, pageSize = 100) => ({
    async list({ prefix, cursor }) {
      const keys = Object.keys(store).filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + pageSize);
      const end = start + pageSize;
      return {
        keys: slice.map((name) => ({ name })),
        list_complete: end >= keys.length,
        cursor: String(end),
      };
    },
    async get(name) {
      return store[name] ?? null;
    },
  });

  const night = (lines) => JSON.stringify({ lines, at: 1 });

  it('returns marks only, keyed by fixture then player', () => {
    // The banter is the bulky half and a graph plots numbers — see the note
    // on readAllMarks for why the text is dropped here.
    const store = {
      'grades:f1': night({ a: { text: 'מלך', grade: 8 }, b: { grade: 4.5 } }),
    };
    return expect(readAllMarks({ ROSTER_KV: kv(store) })).resolves.toEqual({
      f1: { a: 8, b: 4.5 },
    });
  });

  it('walks every page rather than stopping at the first', async () => {
    const store = {};
    for (let i = 0; i < 7; i++) store[`grades:f${i}`] = night({ a: { grade: 6 } });
    const all = await readAllMarks({ ROSTER_KV: kv(store, 2) });
    expect(Object.keys(all)).toHaveLength(7);
  });

  it('ignores keys belonging to anything else in the store', async () => {
    const store = {
      'grades:f1': night({ a: { grade: 7 } }),
      'recap:f1': JSON.stringify({ text: 'not a grade' }),
      history: JSON.stringify({ fixtures: [] }),
    };
    expect(Object.keys(await readAllMarks({ ROSTER_KV: kv(store) }))).toEqual(['f1']);
  });

  it('survives one unreadable night without losing the rest', async () => {
    // A single corrupt value must not take the whole graph down with it.
    const store = {
      'grades:bad': '{ not json',
      'grades:good': night({ a: { grade: 9 } }),
    };
    expect(await readAllMarks({ ROSTER_KV: kv(store) })).toEqual({ good: { a: 9 } });
  });

  it('drops an entry whose grade is missing or not a number', async () => {
    const store = {
      'grades:f1': night({ a: { grade: 7 }, b: { text: 'no mark' }, c: { grade: 'eight' } }),
    };
    expect(await readAllMarks({ ROSTER_KV: kv(store) })).toEqual({ f1: { a: 7 } });
  });

  it('is an empty object when nothing has been published at all', async () => {
    expect(await readAllMarks({ ROSTER_KV: kv({}) })).toEqual({});
  });
});
