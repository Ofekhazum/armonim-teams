import { describe, expect, it } from 'vitest';
import { buildGradesPrompt } from './grades.js';

// The grades prompt (§2.39). The mark is arithmetic and tested in
// src/grades.test.ts; what matters here is what the model is told — that it is
// one request for everybody, that it cannot key on a Hebrew name, and that no
// rating has crept into the payload.

const facts = (over = {}) => ({
  date: '2026-08-20',
  matches: 11.5,
  winners: ['השחורים'],
  mvp: 'ניב',
  said: null,
  milestones: [],
  players: [
    { key: 'p1', name: 'ניב', grade: 10, team: 'black', teamWins: 9.5, place: 1, wonNight: true, isMvp: true, nightsBefore: 30, trend: 'hot', runBefore: 3, droughtBefore: 0 },
    { key: 'p2', name: 'אופק', grade: 4.5, team: 'blue', teamWins: 2, place: 2, wonNight: false, isMvp: false, nightsBefore: 30, trend: 'cold', runBefore: 0, droughtBefore: 7 },
    { key: 'p3', name: 'בר', grade: 3.5, team: 'white', teamWins: 0, place: 3, wonNight: false, isMvp: false, nightsBefore: 0, trend: null, runBefore: 0, droughtBefore: 0 },
  ],
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
    expect(p).toContain('נבחר לשחקן הערב');       // the MVP
    expect(p).toContain('לא לקח ערב כבר 7 ערבים'); // the drought
    expect(p).toContain('בירידת כושר');            // the cold run
    expect(p).toContain('סיימו אחרונים');          // the team that finished bottom
    expect(p).toContain('ערב ראשון במועדון');      // the debut
  });

  it('includes the organiser’s note only when there is one', () => {
    expect(buildGradesPrompt(facts())).not.toMatch(/WHAT THE ORGANISER SAID/);
    const withNote = buildGradesPrompt(facts({ said: 'הכדור עף מעל הגדר' }));
    expect(withNote).toMatch(/WHAT THE ORGANISER SAID/);
    expect(withNote).toContain('הכדור עף מעל הגדר');
  });
});
