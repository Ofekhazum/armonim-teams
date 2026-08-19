import { describe, expect, it } from 'vitest';
import { isMilestoneNight, isWinMilestone, tonightsMilestones } from './milestones';
import type { FixtureRecord, Player } from './types';

function player(id: string, name: string, extra: Partial<Player> = {}): Player {
  return { id, name, rating: 3, attack: 50, chemistry: [], ...extra };
}

// Unique ids and ascending dates across every fixture any test builds, so
// nothing depends on two helper calls not colliding.
let seq = 0;
const nextDate = () => new Date(Date.UTC(2026, 0, 1 + seq)).toISOString().slice(0, 10);

type Outcome = 'won' | 'lost' | 'no-result';

// A night `ids` played, all on black. `outcome` is from their point of view:
// black takes it 3–1, drops it 1–3, or the night was never scored.
function fixture(ids: string[], outcome: Outcome = 'lost', id?: string): FixtureRecord {
  const wins =
    outcome === 'won'
      ? { black: 3, white: 1, blue: 0 }
      : outcome === 'lost'
        ? { black: 1, white: 3, blue: 0 }
        : { black: 0, white: 0, blue: 0 };
  const fx: FixtureRecord = {
    id: id ?? `f${seq}`,
    date: nextDate(),
    teams: { black: ids, white: [], blue: [] },
    players: ids.map((x) => ({ id: x, name: x, rating: 3 })),
    wins,
  };
  seq++;
  return fx;
}

// `n` nights for `ids`. Outcomes alternate by default so no run ever builds —
// tests about counts shouldn't accidentally trip the streak facts.
const nights = (n: number, ids: string[], outcome?: Outcome) =>
  Array.from({ length: n }, (_, i) =>
    fixture(ids, outcome ?? (i % 2 ? 'won' : 'lost')),
  );

describe('isMilestoneNight', () => {
  it('fires on 10, 25 and every 50 after', () => {
    expect([10, 25, 50, 100, 150, 200].every(isMilestoneNight)).toBe(true);
  });

  it('stays quiet on ordinary numbers', () => {
    expect([1, 9, 11, 24, 26, 49, 51, 75, 99].some(isMilestoneNight)).toBe(false);
  });
});

describe('tonightsMilestones', () => {
  it('calls a player with no history a debut, once there is history to be absent from', () => {
    const out = tonightsMilestones([player('a', 'דור')], nights(5, ['someone-else']));
    expect(out).toEqual([{ id: 'a', name: 'דור', kind: 'debut' }]);
  });

  it('counts tonight towards the total', () => {
    // 49 nights behind them → tonight is the 50th, and also their 50th in a row
    const out = tonightsMilestones([player('a', 'דור')], nights(49, ['a']));
    expect(out).toEqual([
      { id: 'a', name: 'דור', kind: 'nth-night', nights: 50 },
      { id: 'a', name: 'דור', kind: 'iron-man', nights: 50 },
    ]);
  });

  it('says nothing on an ordinary night', () => {
    expect(tonightsMilestones([player('a', 'דור')], nights(5, ['a']))).toEqual([]);
  });

  it('ignores guests entirely — their ids are one-off, so every visit would look like a debut', () => {
    const out = tonightsMilestones([player('g', 'אורח', { isGuest: true })], nights(9, ['x']));
    expect(out).toEqual([]);
  });

  // Regression: on a fresh install every player is trivially absent from an
  // empty history, which tagged the whole squad as debutants.
  it('claims no debuts at all until the history is deep enough to mean something', () => {
    const squad = [player('a', 'דור'), player('b', 'עומרי')];
    expect(tonightsMilestones(squad, [])).toEqual([]);
    expect(tonightsMilestones(squad, nights(4, ['x']))).toEqual([]);
    expect(tonightsMilestones(squad, nights(5, ['x']))).toHaveLength(2);
  });

  it('collapses more than three first-timers into one line', () => {
    const squad = ['a', 'b', 'c', 'd'].map((id) => player(id, id.toUpperCase()));
    expect(tonightsMilestones(squad, nights(5, ['x']))).toEqual([
      { kind: 'debut-group', count: 4 },
    ]);
  });

  it('still names a real milestone alongside a collapsed debut group', () => {
    const squad = [
      player('vet', 'ותיק'),
      ...['a', 'b', 'c', 'd'].map((id) => player(id, id.toUpperCase())),
    ];
    const out = tonightsMilestones(squad, nights(24, ['vet']));
    expect(out).toEqual([
      { kind: 'nth-night', id: 'vet', name: 'ותיק', nights: 25 },
      { kind: 'iron-man', id: 'vet', name: 'ותיק', nights: 25 },
      { kind: 'debut-group', count: 4 },
    ]);
  });

  it('counts a fixture once even if a player is somehow listed twice on it', () => {
    const dupe = fixture(['a', 'a']);
    dupe.players.push({ id: 'a', name: 'a', rating: 3 });
    // 9 clean nights + 1 duplicated one = 10 nights, so tonight is the 11th —
    // and also their 11th straight, since none of those nights were missed
    expect(tonightsMilestones([player('a', 'דור')], [...nights(9, ['a']), dupe])).toEqual([
      { kind: 'iron-man', id: 'a', name: 'דור', nights: 11 },
    ]);
  });

  it('only counts the nights a player was actually on the sheet', () => {
    const history = [...nights(9, ['a']), ...nights(40, ['b'])];
    // tonight is a's 10th, and only b's 41st — and b's 41 have all been in a
    // row, while a hasn't played since before b's run started
    const out = tonightsMilestones([player('a', 'דור'), player('b', 'עומרי')], history);
    expect(out).toEqual([
      { id: 'a', name: 'דור', kind: 'nth-night', nights: 10 },
      { id: 'b', name: 'עומרי', kind: 'iron-man', nights: 41 },
    ]);
  });

  it('puts the bigger milestone first and debuts last', () => {
    const history = [...nights(24, ['a']), ...nights(49, ['b'])];
    const out = tonightsMilestones(
      [player('a', 'דור'), player('b', 'עומרי'), player('c', 'חדש')],
      history,
    );
    // b's run is unbroken up to tonight; a's 24 nights are all *before* b's
    // block, so a's attendance streak was broken long before tonight
    expect(out).toEqual([
      { kind: 'nth-night', id: 'b', name: 'עומרי', nights: 50 },
      { kind: 'nth-night', id: 'a', name: 'דור', nights: 25 },
      { kind: 'iron-man', id: 'b', name: 'עומרי', nights: 50 },
      { kind: 'debut', id: 'c', name: 'חדש' },
    ]);
  });
});

describe('attendance streaks', () => {
  it('reports a run of eight nights running, including tonight, and stays quiet at seven', () => {
    // 6 past + tonight = 7, one short
    const six = tonightsMilestones([player('a', 'דור')], nights(6, ['a']));
    expect(six.some((m) => m.kind === 'iron-man')).toBe(false);

    // 7 past + tonight = 8, right at the bar
    const seven = tonightsMilestones([player('a', 'דור')], nights(7, ['a']));
    expect(seven).toContainEqual({ kind: 'iron-man', id: 'a', name: 'דור', nights: 8 });
  });

  it('breaks on a single missed night, unlike a win streak', () => {
    const history = [
      ...nights(8, ['a']),
      ...nights(1, ['someone-else']), // a sat this one out
      ...nights(3, ['a']),
    ];
    const out = tonightsMilestones([player('a', 'דור')], history);
    // only the 3 clean nights since the miss, plus tonight, count
    expect(out.some((m) => m.kind === 'iron-man')).toBe(false);
  });

  it('counts a night with no result recorded — attendance is not about winning', () => {
    const out = tonightsMilestones([player('a', 'דור')], nights(7, ['a'], 'no-result'));
    expect(out).toContainEqual({ kind: 'iron-man', id: 'a', name: 'דור', nights: 8 });
  });
});

describe('win streaks and winless runs', () => {
  it('reports a run of three wins, and stays quiet at two', () => {
    const two = tonightsMilestones([player('a', 'דור')], nights(2, ['a'], 'won'));
    expect(two.some((m) => m.kind === 'win-streak')).toBe(false);

    const three = tonightsMilestones([player('a', 'דור')], nights(3, ['a'], 'won'));
    expect(three).toContainEqual({ kind: 'win-streak', id: 'a', name: 'דור', nights: 3 });
  });

  it('counts only the run at the end, not wins scattered through the season', () => {
    const history = [...nights(9, ['a'], 'won'), ...nights(1, ['a'], 'lost'), ...nights(3, ['a'], 'won')];
    const out = tonightsMilestones([player('a', 'דור')], history);
    expect(out).toContainEqual({ kind: 'win-streak', id: 'a', name: 'דור', nights: 3 });
  });

  it('does not break a run over a night the player missed', () => {
    const history = [
      ...nights(2, ['a'], 'won'),
      ...nights(1, ['someone-else'], 'won'), // a wasn't there
      ...nights(1, ['a'], 'won'),
    ];
    expect(tonightsMilestones([player('a', 'דור')], history)).toContainEqual({
      kind: 'win-streak',
      id: 'a',
      name: 'דור',
      nights: 3,
    });
  });

  it('does not break a run over a night nobody scored', () => {
    const history = [
      ...nights(2, ['a'], 'won'),
      ...nights(1, ['a'], 'no-result'),
      ...nights(1, ['a'], 'won'),
    ];
    expect(tonightsMilestones([player('a', 'דור')], history)).toContainEqual({
      kind: 'win-streak',
      id: 'a',
      name: 'דור',
      nights: 3,
    });
  });

  it('treats a drawn top — two teams level on wins — as nobody winning the night', () => {
    const won = nights(3, ['a'], 'won');
    // built after, so it sorts last and is the run-breaking night
    const drawn = fixture(['a'], 'won');
    drawn.wins = { black: 3, white: 3, blue: 0 };
    const out = tonightsMilestones([player('a', 'דור')], [...won, drawn]);
    expect(out.some((m) => m.kind === 'win-streak')).toBe(false);
  });

  it('reports a winless run only at five or more', () => {
    const four = tonightsMilestones([player('a', 'דור')], nights(4, ['a'], 'lost'));
    expect(four.some((m) => m.kind === 'winless')).toBe(false);

    const five = tonightsMilestones([player('a', 'דור')], nights(5, ['a'], 'lost'));
    expect(five).toContainEqual({ kind: 'winless', id: 'a', name: 'דור', nights: 5 });
  });
});

describe('career wins', () => {
  // black takes 3 a night when it wins, 1 when it loses
  it('fires when tonight is what carries them past a round number', () => {
    // 16 wins × 3 = 48 so far; tonight's 3 crosses 50
    const past = nights(16, ['a'], 'won');
    const tonight = fixture(['a'], 'won', 'tonight');
    const out = tonightsMilestones([player('a', 'דור')], [...past, tonight], 'tonight');
    expect(out).toContainEqual({ kind: 'nth-win', id: 'a', name: 'דור', wins: 50 });
  });

  it('says nothing until the result is in, since the crossing has not happened yet', () => {
    const past = nights(16, ['a'], 'won'); // 48 wins — not there yet
    const out = tonightsMilestones([player('a', 'דור')], past);
    expect(out.some((m) => m.kind === 'nth-win')).toBe(false);
  });

  it('does not repeat the milestone on later nights', () => {
    const past = nights(18, ['a'], 'won'); // 54 wins, already past 50
    const tonight = fixture(['a'], 'won', 'tonight');
    const out = tonightsMilestones([player('a', 'דור')], [...past, tonight], 'tonight');
    expect(out.some((m) => m.kind === 'nth-win')).toBe(false);
  });

  // Guards the recalibration: the ladder was 25/50/every-50, which at the ~4.7
  // wins a night the real results show had 🏆 firing three times too often.
  it('uses a ladder spaced for the real rate of about five wins a night', () => {
    expect([50, 100, 250, 500, 1000].every(isWinMilestone)).toBe(true);
    expect([25, 75, 150, 200, 300, 400].some(isWinMilestone)).toBe(false);
  });
});

describe("tonight's own fixture", () => {
  // Regression: once the result is saved, tonight lands in `history`, which
  // made "your 50th night" tick over to "your 51st" the moment you hit save.
  it('does not let a saved result inflate the nights count', () => {
    const past = nights(49, ['a']);
    const tonight = fixture(['a'], 'won', 'tonight');
    const before = tonightsMilestones([player('a', 'דור')], past);
    const after = tonightsMilestones([player('a', 'דור')], [...past, tonight], 'tonight');
    expect(before).toContainEqual({ kind: 'nth-night', id: 'a', name: 'דור', nights: 50 });
    expect(after).toContainEqual({ kind: 'nth-night', id: 'a', name: 'דור', nights: 50 });
  });
});
