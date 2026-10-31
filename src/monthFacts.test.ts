import { describe, expect, it } from 'vitest';
import type { FixtureRecord, Player } from './types';
import type { AllMarks } from './gradeHistory';
import { buildTestClub } from './testData';
import { nightGrades } from './grades';
import { ratingsOf, teamOfMonth, totmPeriods } from './totm';
import { monthFacts, namesPlayer, type RegisteredTeam } from './monthFacts';

// What the month's show is told. The same two questions as `recapFacts`: is
// every number one the app already stands behind, and does anything private
// travel with them.

const club = buildTestClub();

// What `GET /grades/all` would hold for the invented club, worked out the way
// the sandbox does it (`fetchAllMarks` in test mode).
const marksOf = (history: FixtureRecord[]): AllMarks => {
  const out: AllMarks = {};
  for (const fx of history) {
    const graded = nightGrades(history, fx.id);
    if (graded) out[fx.id] = Object.fromEntries(graded.map((g) => [g.id, g.grade]));
  }
  return out;
};

const registeredFor = (history: FixtureRecord[], period: string, players: Player[]): RegisteredTeam => {
  const five = teamOfMonth(history, period, ratingsOf(players));
  return { ids: five.map((p) => p.id), names: five.map((p) => p.name) };
};

// A finished month with a note in it, so the events have something to carry.
const period = totmPeriods(club.history).find((p) =>
  club.history.some((fx) => fx.date.startsWith(`${p}-`) && fx.note),
)!;
const marks = marksOf(club.history);
const registered = registeredFor(club.history, period, club.players);
const facts = () => monthFacts(club.history, period, club.players, marks, registered)!;

describe('monthFacts', () => {
  it('has nothing to say about a month with no recorded night', () => {
    expect(monthFacts(club.history, '1999-01', club.players, marks, registered)).toBeNull();
  });

  it('counts the team itself, as the images do, when a finished month was never registered', () => {
    const f = monthFacts(club.history, period, club.players, marks, null)!;
    registered.names.forEach((name, i) => expect(f.team[i].startsWith(name)).toBe(true));
  });

  it('counts the team for a month still being played, rather than trust a registration', () => {
    // a hand registration made mid-month is a snapshot the images no longer show
    const stale: RegisteredTeam = { ids: ['nobody-now'], names: ['שחקן מאמצע החודש'] };
    const f = monthFacts(club.history, period, club.players, marks, stale, false)!;
    expect(f.team.join(' ')).not.toContain('שחקן מאמצע החודש');
    registered.names.forEach((name, i) => expect(f.team[i].startsWith(name)).toBe(true));
  });

  it("numbers the month's nights in order and carries each night's events", () => {
    const f = facts();
    const inMonth = club.history.filter((fx) => fx.date.startsWith(`${period}-`));
    expect(f.nights).toBe(inMonth.length);
    expect(f.nightsInOrder.map((n) => n.night)).toEqual(inMonth.map((_, i) => i + 1));
    expect(f.nightsInOrder.flatMap((n) => n.events).length).toBeGreaterThan(0);
  });

  it("strips the organiser's marks off an event", () => {
    const history = club.history.map((fx) =>
      fx.date.startsWith(`${period}-`) && !fx.note ? { ...fx, note: '@הכדור עף מעבר לגדר ++@' } : fx,
    );
    const events = monthFacts(history, period, club.players, marks, registered)!.nightsInOrder.flatMap(
      (n) => n.events,
    );
    expect(events).toContain('הכדור עף מעבר לגדר');
    expect(events.join(' ')).not.toMatch(/\+/);
  });

  it('keeps the registered team in the registered order, even one the count would no longer pick', () => {
    const f = facts();
    expect(f.team).toHaveLength(registered.ids.length);
    registered.names.forEach((name, i) => expect(f.team[i].startsWith(name)).toBe(true));

    const swapped: RegisteredTeam = {
      ids: ['nobody-now', ...registered.ids.slice(1)],
      names: ['שחקן שתוקן', ...registered.names.slice(1)],
    };
    expect(monthFacts(club.history, period, club.players, marks, swapped)!.team[0]).toBe('שחקן שתוקן');
  });

  it("tells the countdown what else each of the team did, the organiser's events first", () => {
    const top = registered.ids[0];
    const name = registered.names[0];
    // one night of theirs with an event naming them, and them as its MVP
    const theirs = club.history.find(
      (fx) => fx.date.startsWith(`${period}-`) && fx.players.some((p) => p.id === top),
    )!;
    const history = club.history.map((fx) =>
      fx.id === theirs.id ? { ...fx, note: `@${name} בעט את הכדור לחניה@`, mvpId: top } : fx,
    );
    const line = monthFacts(history, period, club.players, marks, registered)!.team[0];
    const also = line.slice(line.indexOf('ALSO THIS MONTH: ') + 'ALSO THIS MONTH: '.length).split('; ');
    expect(also[0]).toMatch(new RegExp(`on the \\w+ night: "${name} בעט את הכדור לחניה"`));
    expect(also.some((m) => m.startsWith('player of the night on the'))).toBe(true);
    // capped, so a place stays a line
    expect(also.length).toBeLessThanOrEqual(3);
  });

  it('matches a name as a word, never as the end of another one', () => {
    expect(namesPlayer('ושגב השחיל את כולם', 'שגב')).toBe(true);
    expect(namesPlayer('הכדור עף מעל הגדר', 'דור')).toBe(false);
    expect(namesPlayer('המדור של הספורט', 'דור')).toBe(false);
    expect(namesPlayer('best pair: ניב and גיא won 4', 'גיא')).toBe(true);
  });

  it('leaves out the early-versus-late win rates, which say nothing about a month', () => {
    expect(facts().awards.join(' ')).not.toMatch(/ran out of gas|early matches/);
  });

  it('names the month and never prints a date', () => {
    const f = facts();
    expect(f.month).toMatch(/^[א-ת]+$/);
    expect(JSON.stringify(f)).not.toMatch(/\d{4}-\d{2}(-\d{2})?/);
  });

  it('never carries a rating, while the published mark averages do go in', () => {
    // A rating nobody could arrive at by accident, on every player.
    const players = club.players.map((p) => ({ ...p, rating: 3.217 }));
    const f = monthFacts(club.history, period, players, marks, registered)!;
    const json = JSON.stringify(f);
    expect(json).not.toContain('3.217');
    expect(json).not.toMatch(/rating|tier|attack|chemistry|avoid/i);
    expect(f.awards.some((a) => a.startsWith('highest average mark'))).toBe(true);
  });
});
