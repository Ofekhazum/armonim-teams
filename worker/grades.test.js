import { describe, expect, it, vi } from 'vitest';
import { buildGradesPrompt, gradesKey, isValidGradeFacts, writeGrades } from './grades.js';

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

  it('names who was left out instead of failing the whole night', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply('{"p1":"מלך"}')),
    );
    const out = await writeGrades({ GEMINI_KEY: 'k' }, facts());
    expect(Object.keys(out.lines)).toEqual(['id1']);
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
