import { describe, expect, it } from 'vitest';
import type { Scan } from './diagnostics';
import { diagnose } from './diagnostics';
import type { Arcs, Tally } from './playerArcs';

// The joke is the framing. The number in every line has to be true, so these
// tests are mostly about what the scan refuses to say.

const t = (won: number, played: number): Tally => ({ won, played });

const arcs = (over: Partial<Arcs> = {}): Arcs => ({
  loggedNights: 8,
  matches: 40,
  won: 20,
  quarters: [t(5, 10), t(5, 10), t(5, 10), t(5, 10)],
  early: t(10, 20),
  late: t(10, 20),
  bounce: t(6, 12),
  ...over,
});

const scan = (over: Partial<Scan> = {}): Scan => ({
  name: 'ניב',
  arcs: arcs(),
  club: t(60, 120), // the club wins half of what it comes back for
  bogey: null,
  shootouts: { taken: 2, wonInPlay: 18 },
  wins: 20,
  nights: 10,
  ...over,
});

const codes = (s: Scan) => diagnose(s).map((d) => d.code);

describe('diagnose', () => {
  it('always says something, because a blank report reads as broken', () => {
    const out = diagnose(scan());
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe('ok');
    expect(out[0].detail).toContain('20 wins across 10 nights');
  });

  it('finds the quarter that goes worst, against their own rate', () => {
    // half the night overall, but nothing in the fourth quarter
    const out = diagnose(
      scan({ arcs: arcs({ quarters: [t(6, 10), t(6, 10), t(6, 10), t(2, 10)] }) }),
    );
    const line = out.find((d) => d.headline.includes('quarter'));
    expect(line?.headline).toContain('fourth');
    expect(line?.detail).toContain('2 of 10');
  });

  it('ignores a bad quarter with barely anything in it', () => {
    // one thin quarter is two results, not a pattern
    const out = diagnose(scan({ arcs: arcs({ quarters: [t(5, 10), t(5, 10), t(5, 10), t(0, 3)] }) }));
    expect(out.every((d) => !d.headline.includes('quarter'))).toBe(true);
  });

  it('names a nemesis only once they have really done it', () => {
    const thin = { id: 'x', name: 'ירין', together: 0, togetherWon: 0, against: 4, faced: 5, beat: 2, beatenBy: 3 };
    expect(codes(scan({ bogey: thin }))).not.toContain('ERR 0x404');

    const real = { ...thin, faced: 10, beat: 2, beatenBy: 8 };
    const line = diagnose(scan({ bogey: real })).find((d) => d.code === 'ERR 0x404');
    expect(line?.headline).toContain('ירין');
    expect(line?.detail).toBe('beaten 8 times, 2 the other way');
  });

  it('reads coming off a loss against the club, never against a coin', () => {
    // 50% sounds ordinary and is exactly what everybody else does
    expect(codes(scan({ arcs: arcs({ bounce: t(6, 12) }), club: t(60, 120) }))).toEqual(['OK 0x00']);
    // the same rate is a finding when the club does much better
    expect(codes(scan({ arcs: arcs({ bounce: t(6, 12) }), club: t(90, 120) }))).toContain(
      'WARN 0x1B',
    );
  });

  it('holds the bounce line until there is enough of it', () => {
    expect(codes(scan({ arcs: arcs({ bounce: t(0, 3) }), club: t(90, 120) }))).not.toContain(
      'WARN 0x1B',
    );
  });

  it('says which way the halves go, both ways', () => {
    expect(codes(scan({ arcs: arcs({ early: t(16, 20), late: t(6, 20) }) }))).toContain('WARN 0x5B');
    expect(codes(scan({ arcs: arcs({ early: t(6, 20), late: t(16, 20) }) }))).toContain('OK 0x5B');
  });

  it('says nothing about halves that are level', () => {
    expect(codes(scan({ arcs: arcs({ early: t(10, 20), late: t(11, 20) }) }))).toEqual(['OK 0x00']);
  });

  it('mentions the spot only when a real share of their wins came from it', () => {
    expect(codes(scan({ shootouts: { taken: 6, wonInPlay: 14 } }))).toContain('WARN 0x½');
    expect(codes(scan({ shootouts: { taken: 1, wonInPlay: 19 } }))).not.toContain('WARN 0x½');
  });

  it('puts the errors first and the good news last', () => {
    const out = diagnose(
      scan({
        arcs: arcs({ quarters: [t(6, 10), t(6, 10), t(6, 10), t(2, 10)], early: t(6, 20), late: t(16, 20) }),
      }),
    );
    expect(out[0].level).toBe('error');
    expect(out[out.length - 1].level).toBe('ok');
  });
});
