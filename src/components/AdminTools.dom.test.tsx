import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FixtureRecord, Player } from '../types';
import AdminTools from './AdminTools';
import History from './History';

// Admin tools (§2.55), and specifically the one thing a *move* can get wrong
// in a way no type check will catch: a panel that ends up on both pages, or on
// neither. Everything here was working code on the Club tab the day before, so
// what is worth a test is not that the recap generates — it is that the recap
// is now in exactly one place.

const player = (id: string, name: string): Player => ({
  id,
  name,
  rating: 4,
  attack: 50,
  chemistry: [],
  avoid: [],
});

const roster = [
  player('a', 'אופק'),
  player('b', 'ירין'),
  player('c', 'ניב'),
  player('d', 'עומר'),
  player('e', 'יונתן'),
  player('f', 'איתי'),
];

const night = (date: string): FixtureRecord => ({
  id: date,
  date,
  teams: { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] },
  players: roster.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
  wins: { black: 6, white: 3, blue: 1 },
});

const history = [night('2026-08-06'), night('2026-08-13')];

const tools = (fixtures = history) =>
  render(
    <AdminTools
      history={fixtures}
      players={roster}
      adminWord="not-the-real-one"
      onApplyRating={() => {}}
    />,
  );

// Asked of the controls rather than of the headings, because the page's own
// intro names all four tools in a sentence — so `getByText(/Alerts/)` would
// find the paragraph that promises an alerts check whether or not one is
// there, which is precisely the thing under test.
const fold = (name: RegExp) => screen.queryByRole('button', { name });

describe('the organiser’s workbench', () => {
  it('carries all four tools', () => {
    tools();
    expect(fold(/Share recap/)).toBeInTheDocument();
    expect(fold(/Team of the Month/)).toBeInTheDocument();
    expect(fold(/Why were the teams uneven/)).toBeInTheDocument();
    expect(fold(/Alerts/)).toBeInTheDocument();
  });

  // The post-mortem is the reason most visits happen, so it is the one section
  // that opens on arrival rather than behind a fold.
  it('reads the nights without being asked to', () => {
    tools();
    expect(screen.getByText(/The big picture/)).toBeInTheDocument();
  });

  // A club with nothing filed still has a page. The recap and Team of the
  // Month have no month to offer and say nothing at all; the post-mortem is
  // still there, saying why it is empty — which is the difference between a
  // young club and a broken tab.
  it('survives an empty history', () => {
    tools([]);
    expect(fold(/Share recap/)).not.toBeInTheDocument();
    expect(fold(/Team of the Month/)).not.toBeInTheDocument();
    expect(screen.getByText(/No nights to analyse yet/)).toBeInTheDocument();
  });
});

describe('the rating suggestions, while the switch is off', () => {
  // Not rendering the section at all is what the Club tab did, and it is the
  // wrong answer on a page somebody opens *looking* for it: gone and broken
  // read identically. So the heading stays and the reason is written down.
  it('says why rather than disappearing', () => {
    tools();
    const heading = fold(/Rating suggestions/);
    expect(heading).toBeInTheDocument();
    // Shut on arrival, like the rest of the once-in-a-while tooling — so the
    // reason is a fold away rather than on screen. Open it the way a reader
    // would.
    fireEvent.click(heading!);
    expect(screen.getByText(/off until there are enough recorded nights/)).toBeInTheDocument();
  });
});

describe('what the Club tab gave up', () => {
  // The half of the move that is easy to forget. An organiser on the Club tab
  // must not still find the monthly tooling there — two copies of a Register
  // button pointed at the same guarded write is worse than none.
  it('keeps none of the moved panels, even for an admin', () => {
    render(
      <History
        history={history}
        players={roster}
        isAdmin
        adminWord="not-the-real-one"
        onDeleteFixture={() => {}}
        onEditFixture={() => {}}
      />,
    );
    expect(screen.queryByText(/Monthly recap/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Team of the Month/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rating suggestions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Why were the teams uneven/)).not.toBeInTheDocument();
    // …while the things that stayed are still there: the career table is the
    // page, and correcting a night belongs beside the night.
    expect(screen.getByText(/Career numbers/)).toBeInTheDocument();
  });
});
