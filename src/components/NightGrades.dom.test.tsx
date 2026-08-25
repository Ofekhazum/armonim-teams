import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FixtureRecord, MatchLogEntry, Player } from '../types';
import { winsFromLog } from '../matchLog';
import { nightGrades } from '../grades';
import NightGrades from './NightGrades';

// The marks panel on the night page (§2.39). The arithmetic is grades.ts's and
// is tested there; this is the display: nothing shown to a reader who cannot
// publish, every mark surviving even when its line does not, and the one
// vocabulary word that must never appear here — "rating" means something else
// entirely in this app (§2.28).

const TEAMS = { black: ['a', 'b'], white: ['c', 'd'], blue: ['e', 'f'] };
const NAMES: Record<string, string> = {
  a: 'אביב',
  b: 'בר',
  c: 'גיא',
  d: 'דור',
  e: 'איתן',
  f: 'פארי',
};
const roster: Player[] = Object.keys(NAMES).map((id) => ({
  id,
  name: NAMES[id],
  rating: 3,
  attack: 50,
  chemistry: [],
}));

const m = (a: 'black' | 'white' | 'blue', b: 'black' | 'white' | 'blue', winner: 'black' | 'white' | 'blue'): MatchLogEntry => ({
  a,
  b,
  winner,
  viaPenalties: false,
});

// A spread night: black wins comfortably, white splits, blue takes nothing —
// so the three cards have visibly different marks rather than three identical
// fives, and 'a' (the MVP) separates from their own teammate 'b'.
const LOG: MatchLogEntry[] = [
  m('black', 'white', 'black'),
  m('black', 'blue', 'black'),
  m('black', 'white', 'black'),
  m('white', 'blue', 'white'),
  m('black', 'white', 'white'),
];

const fixture = (over: Partial<FixtureRecord> = {}): FixtureRecord => ({
  id: 'f1',
  date: '2026-05-04',
  teams: TEAMS,
  players: Object.keys(NAMES).map((id) => ({ id, name: NAMES[id], rating: 3 })),
  wins: winsFromLog(LOG),
  matchLog: LOG,
  mvpId: 'a',
  ...over,
});

const NO_RESULT = fixture({ wins: { black: 0, white: 0, blue: 0 }, matchLog: undefined, mvpId: undefined });

describe('NightGrades', () => {
  it('renders nothing for a night with no result', () => {
    const { container } = render(
      <NightGrades fixture={NO_RESULT} history={[NO_RESULT]} players={roster} adminWord="word" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a reader who cannot publish and nothing has been', () => {
    // Default test-setup fetch always rejects, so `fetchGrades` resolves null —
    // the same "nobody has written anything yet" state a real offline read
    // would produce.
    const fx = fixture();
    const { container } = render(
      <NightGrades fixture={fx} history={[fx]} players={roster} adminWord={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers an admin a write button before anything exists, and nothing else', () => {
    const fx = fixture();
    render(<NightGrades fixture={fx} history={[fx]} players={roster} adminWord="word" />);
    expect(screen.getByText('✍️ Write the marks')).toBeInTheDocument();
    // No team cards yet — nothing has been generated, so there is nothing to
    // group. The same restraint the report panel shows before its first write.
    expect(screen.queryByText(NAMES.a)).not.toBeInTheDocument();
  });

  it('shows every player’s mark once a set is published', async () => {
    const fx = fixture();
    const graded = nightGrades([fx], fx.id)!;
    const lines = Object.fromEntries(
      graded.map((g) => [g.id, { text: `line for ${g.id}`, grade: g.grade }]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ lines, at: Date.now() }))),
    );

    render(<NightGrades fixture={fx} history={[fx]} players={roster} adminWord={null} />);

    for (const g of graded) {
      await screen.findByText(NAMES[g.id]);
      expect(screen.getByText(`line for ${g.id}`)).toBeInTheDocument();
    }
    // Grouped by shirt, not one flat list — all three team headers present.
    expect(screen.getByText(/Black/)).toBeInTheDocument();
    expect(screen.getByText(/White/)).toBeInTheDocument();
    expect(screen.getByText(/Blue/)).toBeInTheDocument();
  });

  it('keeps the mark but drops the line once the stored grade drifts', async () => {
    // A night corrected after the fact: the archive's marks moved, and the
    // banter that was written about the old ones is no longer honestly true.
    const fx = fixture();
    const graded = nightGrades([fx], fx.id)!;
    const lines = Object.fromEntries(
      graded.map((g, i) => [
        g.id,
        // The first player's stored mark no longer matches what the archive
        // says today; everyone else's still does.
        { text: `line for ${g.id}`, grade: i === 0 ? g.grade + 1 : g.grade },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ lines, at: Date.now() }))),
    );

    render(<NightGrades fixture={fx} history={[fx]} players={roster} adminWord={null} />);

    const drifted = graded[0];
    await screen.findByText(NAMES[drifted.id]);
    expect(screen.queryByText(`line for ${drifted.id}`)).not.toBeInTheDocument();
    for (const g of graded.slice(1)) {
      expect(screen.getByText(`line for ${g.id}`)).toBeInTheDocument();
    }
  });

  it('names who was left out of a generated draft', async () => {
    const fx = fixture();
    const graded = nightGrades([fx], fx.id)!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            lines: { [graded[0].id]: { text: 'only one line', grade: graded[0].grade } },
            missing: [NAMES.b, NAMES.c],
          }),
        ),
      ),
    );

    render(<NightGrades fixture={fx} history={[fx]} players={roster} adminWord="word" />);
    fireEvent.click(screen.getByText('✍️ Write the marks'));

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`no line for.*${NAMES.b}.*${NAMES.c}`))).toBeInTheDocument();
    });
  });

  it('never uses the app’s word for a private opinion of somebody', async () => {
    // "Rating" is the organiser's 1–5, never shown outside admin mode (§2.28).
    // A grade is a different thing and must never borrow that word.
    const fx = fixture();
    const graded = nightGrades([fx], fx.id)!;
    const lines = Object.fromEntries(
      graded.map((g) => [g.id, { text: `line for ${g.id}`, grade: g.grade }]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ lines, at: Date.now() }))),
    );

    render(<NightGrades fixture={fx} history={[fx]} players={roster} adminWord="word" />);
    await screen.findByText(NAMES.a);

    const text = document.body.textContent ?? '';
    expect(text.toLowerCase()).not.toContain('rating');
    expect(text).not.toContain('דירוג');
  });
});
