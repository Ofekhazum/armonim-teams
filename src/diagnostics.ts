// Run diagnostics (§2.23).
//
// A joke with its receipts attached: a mock system scan whose every line is a
// real count out of this player's record. The framing is the funny part; the
// number is true, and no line exists that could not be checked by hand.
//
// Two rules, and the first one matters more than it looks.
//
// **It is pulled, never pushed.** There is no badge, no automatic flag, nothing
// that goes looking for whoever is having a bad month and points at them by
// name on a page fifteen people can see. Somebody has to press the button, and
// the button is on everyone's page — the person having a rough run is the one
// case where an app volunteering a joke stops being funny, and this club has
// exactly one of everybody.
//
// **A count, dressed up — never a diagnosis.** "Won 2 of 9 in the last quarter"
// with a silly error code on it is a fact wearing a costume. "Poor stamina"
// would be a claim about a body, out of thirty matches. The costume is allowed;
// the claim is not.

import type { Matchup } from './playerProfile';
import type { Arcs, Tally } from './playerArcs';
import { MIN_BOUNCE, NOTABLE_GAP, rate } from './playerArcs';

export interface Diagnostic {
  level: 'error' | 'warn' | 'ok';
  code: string;
  // the joke
  headline: string;
  // the count it is made of, which is the part that has to be true
  detail: string;
}

// A quarter needs this many matches in it before being the worst one means
// anything — one bad quarter of four matches is two results.
const MIN_QUARTER = 6;
// A quarter this far below their own rate for the rest of the night is worth a
// line; anything less is noise wearing a costume.
const QUARTER_GAP = 0.2;
// Somebody has to have beaten them this often before they are a problem rather
// than an opponent.
const MIN_NEMESIS = 4;

const ORDINAL = ['first', 'second', 'third', 'fourth'];

export interface Scan {
  name: string;
  arcs: Arcs;
  club: Tally;
  bogey: Matchup | null;
  shootouts: { taken: number; wonInPlay: number };
  wins: number;
  nights: number;
}

/**
 * Everything the scan found, worst first. Never empty: a clean record gets the
 * lines that say so, because a diagnostic that reports nothing reads as broken
 * rather than as good news.
 */
export function diagnose(s: Scan): Diagnostic[] {
  const found: Diagnostic[] = [];
  const overall = rate({ played: s.arcs.matches, won: s.arcs.won });

  // The quarter of the night that goes worst for them, against their own rate
  // across the rest of it — so this says "worse than they usually are" rather
  // than "worse than somebody else".
  if (overall !== null) {
    let worst: { i: number; q: Tally; r: number } | null = null;
    s.arcs.quarters.forEach((q, i) => {
      const r = rate(q);
      if (q.played < MIN_QUARTER || r === null) return;
      if (!worst || r < worst.r) worst = { i, q, r };
    });
    // TS cannot see through the closure assignment, hence the local
    const w = worst as { i: number; q: Tally; r: number } | null;
    if (w && overall - w.r >= QUARTER_GAP) {
      found.push({
        level: 'error',
        code: `ERR 0x${(0xc0 + w.i).toString(16).toUpperCase()}`,
        headline: `clock_module: signal lost in the ${ORDINAL[w.i]} quarter`,
        detail: `${w.q.won} of ${w.q.played} won there, against ${Math.round(overall * 100)}% across the night`,
      });
    }
  }

  if (s.bogey && s.bogey.beatenBy >= MIN_NEMESIS) {
    found.push({
      level: 'error',
      code: 'ERR 0x404',
      headline: `firewall: no defence found against ${s.bogey.name}`,
      detail: `beaten ${s.bogey.beatenBy} times, ${s.bogey.beat} the other way`,
    });
  }

  const bounceRate = rate(s.arcs.bounce);
  const clubRate = rate(s.club);
  if (s.arcs.bounce.played >= MIN_BOUNCE && bounceRate !== null && clubRate !== null) {
    const gap = bounceRate - clubRate;
    if (gap <= -NOTABLE_GAP) {
      found.push({
        level: 'warn',
        code: 'WARN 0x1B',
        headline: 'restart loop: slow to come back up',
        detail: `won ${s.arcs.bounce.won} of ${s.arcs.bounce.played} coming back on after a loss, against ${Math.round(clubRate * 100)}% for the club`,
      });
    } else if (gap >= NOTABLE_GAP) {
      found.push({
        level: 'ok',
        code: 'OK 0x1B',
        headline: 'restart loop: comes back up clean',
        detail: `won ${s.arcs.bounce.won} of ${s.arcs.bounce.played} coming back on after a loss, against ${Math.round(clubRate * 100)}% for the club`,
      });
    }
  }

  const early = rate(s.arcs.early);
  const late = rate(s.arcs.late);
  if (early !== null && late !== null && s.arcs.early.played >= MIN_QUARTER) {
    const drop = early - late;
    if (drop >= NOTABLE_GAP) {
      found.push({
        level: 'warn',
        code: 'WARN 0x5B',
        headline: 'battery: discharging',
        detail: `${s.arcs.early.won} of ${s.arcs.early.played} in their first matches, ${s.arcs.late.won} of ${s.arcs.late.played} in their last`,
      });
    } else if (drop <= -NOTABLE_GAP) {
      found.push({
        level: 'ok',
        code: 'OK 0x5B',
        headline: 'battery: charging',
        detail: `${s.arcs.early.won} of ${s.arcs.early.played} in their first matches, ${s.arcs.late.won} of ${s.arcs.late.played} in their last`,
      });
    }
  }

  const decided = s.shootouts.taken + s.shootouts.wonInPlay;
  if (decided >= 8 && s.shootouts.taken * 4 >= decided) {
    found.push({
      level: 'warn',
      code: 'WARN 0x½',
      headline: 'nerve subsystem: running hot',
      detail: `${s.shootouts.taken} of their ${decided} wins came from the spot`,
    });
  }

  if (found.length === 0) {
    found.push({
      level: 'ok',
      code: 'OK 0x00',
      headline: 'all subsystems nominal',
      detail: `${s.wins} wins across ${s.nights} nights and nothing to report`,
    });
  }

  // errors, then warnings, then the good news
  const order = { error: 0, warn: 1, ok: 2 };
  return found.sort((a, b) => order[a.level] - order[b.level]);
}
