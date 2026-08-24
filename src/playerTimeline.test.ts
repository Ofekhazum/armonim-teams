import { describe, expect, it } from 'vitest';
import type { FixtureRecord, TeamColor, TeamWins } from './types';
import { MIN_NIGHTS_FOR_RECORD, playerTimeline } from './playerTimeline';
import type { TimelineEvent, TimelineKind } from './playerTimeline';

// The subject plays for black on every night unless a test says otherwise;
// `wins` is what each shirt took, so `won` is decided by who took the most.
const night = (
  date: string,
  wins: Partial<TeamWins>,
  over: Partial<FixtureRecord> = {},
): FixtureRecord => ({
  id: date,
  date,
  teams: { black: ['me', 'b1'], white: ['w1', 'w2'], blue: ['u1', 'u2'] },
  players: [
    { id: 'me', name: 'אופק', rating: 4 },
    { id: 'b1', name: 'ירין', rating: 3 },
    { id: 'w1', name: 'ניב', rating: 3 },
    { id: 'w2', name: 'טום', rating: 3 },
    { id: 'u1', name: 'עידו', rating: 3 },
    { id: 'u2', name: 'רון', rating: 3 },
  ],
  wins: { black: 0, white: 0, blue: 0, ...wins },
  ...over,
});

// A night the subject's team took, and one they didn't.
const won = (date: string, n = 4) => night(date, { black: n, white: 1, blue: 0 });
const lost = (date: string, n = 1) => night(date, { black: n, white: 5, blue: 2 });

// Dates are the sort key and the identity of a night, so they have to be real
// and ordered. One a week, which is what this club actually plays.
const weekly = (count: number, from = 1): string[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, from + i * 7));
    return d.toISOString().slice(0, 10);
  });

const kinds = (events: TimelineEvent[]): TimelineKind[] => events.map((e) => e.kind);
const only = (events: TimelineEvent[], kind: TimelineKind) => events.filter((e) => e.kind === kind);

describe('playerTimeline', () => {
  it('opens the career with the first night on record', () => {
    const dates = weekly(3);
    const events = playerTimeline([won(dates[0]), lost(dates[1]), won(dates[2])], 'me');
    const debut = only(events, 'debut');
    expect(debut).toHaveLength(1);
    expect(debut[0].at).toBe(dates[0]);
    // the shirt and the finish come with it — a debut card with no detail is a
    // date, and the reader already has the date
    expect(debut[0].shirt).toBe<TeamColor>('black');
    expect(debut[0].place).toBe(1);
  });

  it('reads newest first', () => {
    const dates = weekly(4);
    const events = playerTimeline(dates.map((d) => won(d)), 'me');
    const ats = events.map((e) => e.at);
    expect([...ats].sort((a, b) => b.localeCompare(a))).toEqual(ats);
  });

  it('says nothing at all about a player who has never been on a sheet', () => {
    expect(playerTimeline([won('2026-01-01')], 'nobody')).toEqual([]);
  });

  // --- runs -----------------------------------------------------------------

  it('dates a broken run to the night that broke it, with its length', () => {
    const dates = weekly(5);
    const events = playerTimeline(
      [won(dates[0]), won(dates[1]), won(dates[2]), lost(dates[3]), won(dates[4])],
      'me',
    );
    const ended = only(events, 'streak-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].n).toBe(3);
    // the event is the loss, not the last win before it
    expect(ended[0].at).toBe(dates[3]);
  });

  it('leaves a short run alone', () => {
    // MIN_WIN_STREAK. Two won nights in a row happens to somebody most weeks;
    // a feed that cards it is a feed nobody reads to the bottom of.
    const dates = weekly(3);
    const events = playerTimeline([won(dates[0]), won(dates[1]), lost(dates[2])], 'me');
    expect(kinds(events)).not.toContain('streak-ended');
  });

  it('calls a run that has not ended a live one, on the most recent night', () => {
    const dates = weekly(4);
    const events = playerTimeline([lost(dates[0]), won(dates[1]), won(dates[2]), won(dates[3])], 'me');
    const live = only(events, 'streak-live');
    expect(live).toHaveLength(1);
    expect(live[0].n).toBe(3);
    expect(live[0].at).toBe(dates[3]);
    // a run is either broken or still going, never carded as both
    expect(kinds(events)).not.toContain('streak-ended');
  });

  it('ends a drought on the win rather than on the losses', () => {
    const dates = weekly(7);
    const events = playerTimeline(
      [...dates.slice(0, 6).map((d) => lost(d)), won(dates[6])],
      'me',
    );
    const broke = only(events, 'drought-ended');
    expect(broke).toHaveLength(1);
    expect(broke[0].n).toBe(6);
    expect(broke[0].at).toBe(dates[6]);
  });

  it('does not card a short winless patch', () => {
    const dates = weekly(4);
    const events = playerTimeline([lost(dates[0]), lost(dates[1]), lost(dates[2]), won(dates[3])], 'me');
    expect(kinds(events)).not.toContain('drought-ended');
  });

  // --- an untallied night ----------------------------------------------------

  it('lets a night nobody tallied pass a run through unbroken', () => {
    // The rule `appearances()` follows: no result is not a loss. Breaking a run
    // on a night whose score was never typed in would be inventing the loss.
    const dates = weekly(5);
    const events = playerTimeline(
      [
        won(dates[0]),
        won(dates[1]),
        night(dates[2], {}), // 0–0–0: nobody recorded anything
        won(dates[3]),
        lost(dates[4]),
      ],
      'me',
    );
    const ended = only(events, 'streak-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].n).toBe(3); // not 2, and not reset by the blank night
  });

  it('still counts an untallied night as a debut', () => {
    // Turning up is the event. A first night nobody scored is still the night
    // they first turned up.
    const dates = weekly(2);
    const events = playerTimeline([night(dates[0], {}), won(dates[1])], 'me');
    expect(only(events, 'debut')[0].at).toBe(dates[0]);
  });

  // --- ladders ---------------------------------------------------------------

  it('cards the tenth night, and not the ninth or eleventh', () => {
    const dates = weekly(11);
    const events = playerTimeline(dates.map((d) => won(d)), 'me');
    const nth = only(events, 'nth-night');
    expect(nth.map((e) => e.n)).toEqual([10]);
    expect(nth[0].at).toBe(dates[9]);
  });

  it('catches a win milestone crossed mid-night', () => {
    // Match wins arrive four or five at a time, so a total can step straight
    // over 50 without ever equalling it. Asking "is the new total a rung"
    // would silently drop most of this ladder.
    const dates = weekly(13);
    const events = playerTimeline(dates.map((d) => won(d, 4)), 'me'); // 4 a night
    const fifty = only(events, 'nth-win');
    expect(fifty.map((e) => e.n)).toEqual([50]);
    // 4 a night reaches 52 on the 13th night, having been on 48 the week before
    expect(fifty[0].at).toBe(dates[12]);
  });

  it('counts a shootout as half a win on the way to a milestone', () => {
    const dates = weekly(20);
    const events = playerTimeline(dates.map((d) => won(d, 2.5)), 'me');
    const fifty = only(events, 'nth-win');
    expect(fifty.map((e) => e.n)).toEqual([50]);
    expect(fifty[0].at).toBe(dates[19]); // 2.5 × 20 = exactly 50
  });

  it('climbs the nights-won ladder on nights taken outright', () => {
    const dates = weekly(10);
    // won, lost, won, lost … five wins in ten nights
    const events = playerTimeline(
      dates.map((d, i) => (i % 2 === 0 ? won(d) : lost(d))),
      'me',
    );
    const rungs = only(events, 'nth-night-won');
    expect(rungs.map((e) => e.n)).toEqual([5]);
    expect(rungs[0].at).toBe(dates[8]);
  });

  it('cards the first MVP pick, since being picked at all is the event', () => {
    const dates = weekly(3);
    const events = playerTimeline(
      [won(dates[0]), won(dates[1], 4), night(dates[2], { black: 4, white: 1 }, { mvpId: 'me' })],
      'me',
    );
    const mvp = only(events, 'nth-mvp');
    expect(mvp).toHaveLength(1);
    expect(mvp[0].n).toBe(1);
    expect(mvp[0].at).toBe(dates[2]);
  });

  it('counts an MVP pick from a night nobody tallied', () => {
    // The pick is made afterwards, off a page that reads the night back, and
    // does not depend on whether the score was ever entered.
    const dates = weekly(2);
    const events = playerTimeline(
      [won(dates[0]), night(dates[1], {}, { mvpId: 'me' })],
      'me',
    );
    expect(only(events, 'nth-mvp')).toHaveLength(1);
  });

  // --- records ---------------------------------------------------------------

  it('will not call the opening nights a personal best', () => {
    // Without the floor the first night is always a record and the second
    // usually is, and the feed opens with cards about having no history.
    const dates = weekly(MIN_NIGHTS_FOR_RECORD);
    const events = playerTimeline(
      dates.map((d, i) => won(d, i + 1)), // strictly improving every night
      'me',
    );
    expect(kinds(events)).not.toContain('best-night');
  });

  it('cards a best night once there is something to beat', () => {
    const dates = weekly(6);
    // four ordinary nights, then a quiet one, then the big one
    const events = playerTimeline(
      [won(dates[0], 3), won(dates[1], 3), won(dates[2], 3), won(dates[3], 3), won(dates[4], 2), won(dates[5], 7)],
      'me',
    );
    const bests = only(events, 'best-night');
    expect(bests).toHaveLength(1);
    expect(bests[0].n).toBe(7);
    expect(bests[0].at).toBe(dates[5]);
  });

  it('measures a record against nights that came before the floor', () => {
    // `best` is tracked from the first night even though nothing is carded
    // yet, so the first record card beats a real number rather than zero.
    const dates = weekly(6);
    const events = playerTimeline(
      [won(dates[0], 9), won(dates[1], 2), won(dates[2], 2), won(dates[3], 2), won(dates[4], 2), won(dates[5], 5)],
      'me',
    );
    expect(kinds(events)).not.toContain('best-night'); // 5 never beats the 9
  });

  // --- team of the month -----------------------------------------------------

  it('files a month above the nights it was won for', () => {
    // March 26th is an MVP night purely so there is a card at the far end of
    // March to sort against.
    const events = playerTimeline(
      [
        won('2026-03-05'),
        night('2026-03-26', { black: 4, white: 1 }, { mvpId: 'me' }),
        won('2026-04-02'),
      ],
      'me',
      ['2026-03'],
    );
    const totm = only(events, 'totm');
    expect(totm).toHaveLength(1);
    expect(totm[0].period).toBe('2026-03');

    // above every March night, below April: the award is the month's
    // conclusion, and that is where a reader looks for it
    const at = events.map((e) => e.at);
    expect(at.indexOf('2026-04-02')).toBeLessThan(at.indexOf(totm[0].at));
    expect(at.indexOf(totm[0].at)).toBeLessThan(at.indexOf('2026-03-26'));
  });

  it('treats an empty awards read as no months, not as a failure', () => {
    const events = playerTimeline([won('2026-03-05')], 'me', []);
    expect(kinds(events)).not.toContain('totm');
  });
});
