import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { mvpFromVotes } from '../mvp';
import MvpPicker from './MvpPicker';

// The night's vote sheet (§2.46). What the tally *means* is grades.ts's problem
// and is tested there; this is the control: that a zero is an absence rather
// than a stored count, that a level vote refuses to crown anybody, and that a
// night picked before the sheet existed can still be corrected.

const players = [
  { id: 'a', name: 'אביב' },
  { id: 'b', name: 'בר' },
  { id: 'c', name: 'Guy' },
];

// The drawer recomputes the pick from the sheet on every change, so the test
// harness has to as well — a component tested with a pick that never follows
// its own votes would be testing a state the app cannot produce.
function Sheet({ start = {}, pick = null }: { start?: Record<string, number>; pick?: string | null }) {
  // One state object holding both, updated functionally — the same shape as
  // History's `draft`, so the batching behaviour under test is the real one.
  const [draft, setDraft] = useState<{ votes: Record<string, number>; mvpId: string | null }>({
    votes: start,
    mvpId: pick,
  });
  return (
    <MvpPicker
      players={players}
      winners={['black']}
      votes={draft.votes}
      mvpId={draft.mvpId}
      onChange={(update) =>
        setDraft((d) => {
          const votes = update(d.votes);
          // `pick` — the value as filed — rather than the draft's own, matching
          // History. See the comment there: a mid-typing leader is not a
          // decision anybody made.
          return { votes, mvpId: mvpFromVotes(votes, pick) };
        })
      }
      legacyPick={Object.keys(draft.votes).length === 0 && draft.mvpId ? 'אביב' : null}
      onClearLegacy={() => setDraft((d) => ({ ...d, mvpId: null }))}
    />
  );
}

// Exact labels rather than a substring: "One more vote for X" and "One fewer
// vote for X" both contain "vote for X", so a loose match finds two buttons.
const plus = (name: string) => screen.getByLabelText(`One more vote for ${name}`);
const minus = (name: string) => screen.getByLabelText(`One fewer vote for ${name}`);
const box = (name: string) => screen.getByLabelText(`Votes for ${name}`) as HTMLInputElement;

describe('MvpPicker', () => {
  it('says nothing has been counted before anybody votes', () => {
    render(<Sheet />);
    expect(screen.getByText(/no votes counted yet/i)).toBeInTheDocument();
  });

  it('hands the night to whoever the room named most', () => {
    render(<Sheet />);
    fireEvent.click(plus('אביב'));
    fireEvent.click(plus('אביב'));
    fireEvent.click(plus('בר'));
    expect(screen.getByText(/3 votes · player of the night: אביב/i)).toBeInTheDocument();
  });

  it('refuses to pick anybody while the vote is level', () => {
    // The app must not invent the one judgement it exists to record — a tie is
    // broken by somebody casting the deciding vote, not by a sort order.
    render(<Sheet />);
    fireEvent.click(plus('אביב'));
    fireEvent.click(plus('בר'));
    expect(screen.getByText(/level on 1 vote — add one to settle it/i)).toBeInTheDocument();
    expect(screen.queryByText(/player of the night:/i)).not.toBeInTheDocument();

    // and one more hand settles it
    fireEvent.click(plus('בר'));
    expect(screen.getByText(/player of the night: בר/i)).toBeInTheDocument();
  });

  it('does not let entry order settle a level sheet being typed from scratch', () => {
    // Tapping אביב then בר leaves 1–1. אביב led for exactly one keystroke, on
    // the way to a tie, and that is not a judgement anybody made — so nobody
    // is picked and the organiser is told to break it.
    render(<Sheet />);
    fireEvent.click(plus('אביב'));
    fireEvent.click(plus('בר'));
    expect(screen.getByText(/add one to settle it/i)).toBeInTheDocument();
    expect(screen.queryByText(/keeps it/i)).not.toBeInTheDocument();
  });

  it('says the standing pick keeps it when a correction levels the sheet', () => {
    // The pick survives — un-naming somebody because a score was corrected is
    // exactly what mvpCandidates already refuses to do — so the footer must not
    // read "add one to settle it" while a star sits on a row above it.
    render(<Sheet start={{ a: 3, b: 1 }} pick="a" />);
    fireEvent.click(plus('בר'));
    fireEvent.click(plus('בר'));
    expect(screen.getByText(/level on 3 votes — אביב keeps it/i)).toBeInTheDocument();
  });

  it('moves the star when a correction changes who leads', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MvpPicker players={players} winners={['black']} votes={{ a: 3, b: 1 }} mvpId="a" onChange={onChange} />,
    );
    expect(screen.getByText(/player of the night: אביב/i)).toBeInTheDocument();
    rerender(
      <MvpPicker players={players} winners={['black']} votes={{ a: 3, b: 4 }} mvpId="b" onChange={onChange} />,
    );
    expect(screen.getByText(/player of the night: בר/i)).toBeInTheDocument();
  });

  it('counts every tap in a burst, not just the last one', () => {
    // Found in the browser, not here: three taps inside one React batch all
    // read the same tally, so a name tapped up to 3 landed on 1 and two votes
    // vanished. Tapping fast is the normal way to use this — somebody adds a
    // vote per name as the room calls them out — so the steppers apply a delta
    // to whatever the previous state was rather than to the rendered prop.
    render(<Sheet />);
    const b = plus('אביב');
    // No re-render between them, which is exactly what a fast thumb produces
    fireEvent.click(b);
    fireEvent.click(b);
    fireEvent.click(b);
    expect(box('אביב').value).toBe('3');
  });

  it('deletes a row rather than storing a zero', () => {
    // A stored 0 would make an untouched sheet look counted to grades.ts,
    // which treats "nobody voted" and "nobody counted" very differently.
    const onChange = vi.fn();
    render(
      <MvpPicker players={players} winners={['black']} votes={{ a: 1 }} mvpId="a" onChange={onChange} />,
    );
    fireEvent.click(minus('אביב'));
    expect(onChange).toHaveBeenCalledTimes(1);
    // an updater rather than a finished sheet — see the prop's comment
    expect(onChange.mock.calls[0][0]({ a: 1 })).toEqual({});
  });

  it('will not go below zero', () => {
    render(<Sheet />);
    expect(minus('אביב')).toBeDisabled();
  });

  it('takes a whole poll typed in at once', () => {
    render(<Sheet />);
    fireEvent.change(box('Guy'), { target: { value: '6' } });
    expect(screen.getByText(/6 votes · player of the night: Guy/i)).toBeInTheDocument();
  });

  it('shows an empty box rather than a zero on a row nobody voted for', () => {
    // A column of zeroes reads as fifteen shut-outs; an empty box reads as a
    // question not yet answered, which is what it is.
    render(<Sheet />);
    expect(box('בר').value).toBe('');
  });

  it('says so plainly on a night picked before the sheet existed', () => {
    render(<Sheet pick="a" />);
    expect(screen.getByText(/picked: אביב — no tally on file/i)).toBeInTheDocument();
  });

  it('lets a pick with no tally behind it be cleared', () => {
    // The only thing this control can do about a night filed before §2.46 —
    // once anything is voted, zeroing the sheet is how a pick goes away.
    render(<Sheet pick="a" />);
    fireEvent.click(screen.getByRole('button', { name: /clear the pick/i }));
    expect(screen.getByText(/no votes counted yet/i)).toBeInTheDocument();
  });

  it('offers no way to clear once the room has actually voted', () => {
    render(<Sheet />);
    fireEvent.click(plus('אביב'));
    expect(screen.queryByRole('button', { name: /clear the pick/i })).not.toBeInTheDocument();
  });
});
