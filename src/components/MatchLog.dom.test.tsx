import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MatchLogEntry } from '../types';
import MatchLog from './MatchLog';

// Who may take a match back (§2.14).
//
// **Recording and undoing are two different permissions, and the split is the
// whole subject of this file.** Writing down who won is deliberately open to
// everyone at the pitch — the organiser is usually playing, and a match ends
// wherever the nearest phone is. Undoing is not: it deletes a result somebody
// else wrote, and once it is gone the screen shows no trace that it ever
// existed. The Worker will accept an undo from anyone (`isLogStep` allows a
// one-shorter log), so this gate is the only thing standing in front of it.

const played = (winner: 'black' | 'white' | 'blue'): MatchLogEntry => ({
  a: 'black',
  b: 'white',
  winner,
  viaPenalties: false,
});

// One match on the record, so there is a "next" pairing and the live controls
// render at all — the undo only exists once something has been played.
const LOG = [played('black')];

const undo = () => screen.queryByRole('button', { name: /Undo last match/ });

describe('undoing a match', () => {
  it('is offered to the organiser', () => {
    render(<MatchLog log={LOG} onChange={() => {}} canUndo />);
    expect(undo()).toBeInTheDocument();
  });

  it('is not offered to everyone else at the pitch', () => {
    render(<MatchLog log={LOG} onChange={() => {}} canUndo={false} />);
    expect(undo()).not.toBeInTheDocument();
  });

  it('is withheld when nobody said otherwise', () => {
    // The default matters more than it looks: this component is rendered on
    // the organiser's page and on the view the whole group watches, and a
    // permission defaulting to "granted" is one forgotten prop away from
    // being no permission at all.
    render(<MatchLog log={LOG} onChange={() => {}} />);
    expect(undo()).not.toBeInTheDocument();
  });

  it('drops only the last match when it is used', () => {
    const onChange = vi.fn();
    const log = [played('black'), played('white')];
    render(<MatchLog log={log} onChange={onChange} canUndo />);
    fireEvent.click(undo()!);
    expect(onChange).toHaveBeenCalledWith([log[0]]);
  });

  it('still lets a viewer record a result', () => {
    // The half that must NOT be gated. Hiding the undo from the group is only
    // correct because writing a match down stays open to them — if this ever
    // starts failing, the gate has been put in the wrong place.
    render(<MatchLog log={LOG} onChange={() => {}} canUndo={false} />);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((t) => !/Undo/.test(t))).toBe(true);
  });
});
