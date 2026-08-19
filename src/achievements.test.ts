import { describe, expect, it } from 'vitest';
import type { FixtureRecord } from './types';
import {
  MIN_NIGHTS_FOR_EVER_PRESENT,
  VETERAN_NIGHTS,
  playerAchievements,
} from './achievements';

let seq = 0;

function night(
  date: string,
  black: string[],
  white: string[],
  wins: { black: number; white: number; blue: number },
  mvpId?: string,
): FixtureRecord {
  const fx: FixtureRecord = {
    id: `f${seq++}`,
    date,
    teams: { black, white, blue: [] },
    players: [...black, ...white].map((id) => ({ id, name: id, rating: 3 })),
    wins,
    mvpId,
  };
  return fx;
}

const day = (n: number) => `2026-08-${String(n).padStart(2, '0')}`;
const kindsFor = (history: FixtureRecord[], id: string) =>
  (playerAchievements(history).get(id)?.achievements ?? []).map((a) => a.kind);

describe('playerAchievements', () => {
  it('counts whole nights a player’s team finished top of, not matches won', () => {
    // a's team banks a blowout on night 1 but is edged on the other two —
    // more match wins, fewer fixtures. Same distinction the recap draws.
    const history = [
      night(day(1), ['a'], ['b'], { black: 5, white: 1, blue: 0 }),
      night(day(2), ['a'], ['b'], { black: 0, white: 1, blue: 0 }),
      night(day(3), ['a'], ['b'], { black: 0, white: 1, blue: 0 }),
    ];
    const ach = playerAchievements(history);
    expect(ach.get('a')!.fixturesWon).toBe(1);
    expect(ach.get('b')!.fixturesWon).toBe(2);
  });

  it('gives the most-wins badge to whoever tops the wins column', () => {
    const history = [
      night(day(1), ['a'], ['b'], { black: 5, white: 1, blue: 0 }),
      night(day(2), ['a'], ['b'], { black: 4, white: 1, blue: 0 }),
    ];
    expect(kindsFor(history, 'a')).toContain('most-wins');
    expect(kindsFor(history, 'b')).not.toContain('most-wins');
  });

  it('shares a badge between players who are genuinely level', () => {
    // breaking a tie arbitrarily would invent a fact the numbers don't have
    const history = [night(day(1), ['a'], ['b'], { black: 3, white: 3, blue: 0 })];
    expect(kindsFor(history, 'a')).toContain('most-wins');
    expect(kindsFor(history, 'b')).toContain('most-wins');
  });

  it('awards no top badge at all when nobody has won anything', () => {
    const history = [night(day(1), ['a'], ['b'], { black: 0, white: 0, blue: 0 })];
    expect(playerAchievements(history).get('a')).toBeUndefined();
  });

  it('counts MVP picks and ignores nights with none', () => {
    const history = [
      night(day(1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }, 'a'),
      night(day(2), ['a'], ['b'], { black: 3, white: 1, blue: 0 }, 'a'),
      night(day(3), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    const ach = playerAchievements(history);
    expect(ach.get('a')!.mvps).toBe(2);
    expect(ach.get('a')!.achievements.find((x) => x.kind === 'mvp')?.label).toBe(
      'Picked MVP 2 times',
    );
    expect(ach.get('b')!.mvps).toBe(0);
    expect(kindsFor(history, 'b')).not.toContain('mvp');
  });

  it('says "1 time", not "1 times"', () => {
    const history = [night(day(1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }, 'a')];
    expect(playerAchievements(history).get('a')!.achievements.find((x) => x.kind === 'mvp')?.label)
      .toBe('Picked MVP 1 time');
  });

  it('only calls someone ever-present once there are enough nights to mean it', () => {
    const short = Array.from({ length: MIN_NIGHTS_FOR_EVER_PRESENT - 1 }, (_, i) =>
      night(day(i + 1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    );
    expect(kindsFor(short, 'a')).not.toContain('ever-present');

    const enough = [
      ...short,
      night(day(MIN_NIGHTS_FOR_EVER_PRESENT), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    expect(kindsFor(enough, 'a')).toContain('ever-present');
  });

  it('drops ever-present the moment a night is missed', () => {
    const history = [
      ...Array.from({ length: MIN_NIGHTS_FOR_EVER_PRESENT }, (_, i) =>
        night(day(i + 1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      ),
      night(day(MIN_NIGHTS_FOR_EVER_PRESENT + 1), ['c'], ['b'], { black: 3, white: 1, blue: 0 }),
    ];
    expect(kindsFor(history, 'a')).not.toContain('ever-present');
  });

  it('reports a winning run only once it clears the milestone floor', () => {
    const two = Array.from({ length: 2 }, (_, i) =>
      night(day(i + 1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    );
    expect(kindsFor(two, 'a')).not.toContain('win-streak');

    const three = [...two, night(day(3), ['a'], ['b'], { black: 3, white: 1, blue: 0 })];
    expect(kindsFor(three, 'a')).toContain('win-streak');
  });

  it('reads the winning run over the whole season, not just the tail', () => {
    const history = [
      ...Array.from({ length: 3 }, (_, i) =>
        night(day(i + 1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      ),
      night(day(4), ['a'], ['b'], { black: 1, white: 3, blue: 0 }), // run broken
    ];
    expect(
      playerAchievements(history).get('a')!.achievements.find((x) => x.kind === 'win-streak')
        ?.label,
    ).toBe('Longest winning run — 3 nights');
  });

  it('awards the veteran badge at the long-service mark', () => {
    const history = Array.from({ length: VETERAN_NIGHTS }, (_, i) =>
      night(`2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
    );
    expect(kindsFor(history, 'a')).toContain('veteran');
    // one night short of it, they don't
    expect(kindsFor(history.slice(1), 'a')).not.toContain('veteran');
  });

  it('ignores nights with no result recorded', () => {
    const history = [
      night(day(1), ['a'], ['b'], { black: 3, white: 1, blue: 0 }),
      night(day(2), ['a'], ['b'], { black: 0, white: 0, blue: 0 }), // never filled in
    ];
    expect(playerAchievements(history).get('a')!.fixturesWon).toBe(1);
  });

  it('returns nothing at all for an empty history', () => {
    expect(playerAchievements([]).size).toBe(0);
  });
});
