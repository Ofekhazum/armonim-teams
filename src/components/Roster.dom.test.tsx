import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FixtureRecord, Player } from '../types';
import { STRINGS } from '../strings';
import Roster from './Roster';

// Renaming somebody who joined the roster after playing as a guest (§2.68).
// Their guest-era nights are attached by *name*, so the rename has to carry
// the old one over as an alias or it quietly splits them into two people. The
// decision itself is `loadBearingNames`, tested in guests.test.ts; this is the
// wiring — that the form acts on it, says so first, and leaves an ordinary
// rename completely alone.

// The dom suite pins the language to English (see test-setup.ts), so the
// labels are looked up the same way the component resolves them rather than
// hard-coded — this file is about the wiring, not about the copy.
// A few entries are plural forms ({ one, other }) rather than plain strings;
// none of the labels used here are, so narrow rather than handle it.
const s = (key: keyof typeof STRINGS): string => {
  const en = STRINGS[key].en;
  if (typeof en !== 'string') throw new Error(`${key} is a plural form, not a label`);
  return en;
};

const player = (over: Partial<Player> & Pick<Player, 'id' | 'name'>): Player => ({
  rating: 3,
  attack: 50,
  chemistry: [],
  ...over,
});

const history: FixtureRecord[] = [];

const renderRoster = (players: Player[], guestNameHolds: Map<string, string>) => {
  const onChange = vi.fn();
  render(
    <Roster
      players={players}
      history={history}
      guestNameHolds={guestNameHolds}
      onChange={onChange}
      adminWord="word"
      setAdminWord={() => {}}
      rosterHydrated
    />,
  );
  return onChange;
};

/** Open the edit form for the only player, and return its name box. */
const editOnly = () => {
  fireEvent.click(screen.getByText(s('roster.edit')));
  return screen.getByPlaceholderText(s('roster.form.name.placeholder'));
};

const saved = (onChange: ReturnType<typeof vi.fn>): Player => {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0][0];
};

describe('renaming a promoted guest', () => {
  it('keeps the old name as an alias, so their guest nights stay theirs', () => {
    const onChange = renderRoster(
      [player({ id: 'r1', name: 'זרקא' })],
      new Map([['r1', 'זרקא']]),
    );
    fireEvent.change(editOnly(), { target: { value: 'זרקא כהן' } });
    fireEvent.click(screen.getByText(s('ui.save')));

    expect(saved(onChange).name).toBe('זרקא כהן');
    expect(saved(onChange).aliases).toContain('זרקא');
  });

  it('says so before the save rather than after it', () => {
    renderRoster([player({ id: 'r1', name: 'זרקא' })], new Map([['r1', 'זרקא']]));
    const box = editOnly();
    // nothing to warn about until the name actually changes
    expect(screen.queryByText(/kept as an alias/)).toBeNull();
    fireEvent.change(box, { target: { value: 'זרקא כהן' } });
    expect(screen.getByText(/kept as an alias/)).toBeInTheDocument();
  });

  it('leaves a rename alone when no guest nights are riding on the name', () => {
    // The guard that keeps this from silting the roster up: correcting a typo
    // on somebody who never played as a guest must leave no trace at all.
    const onChange = renderRoster([player({ id: 'r1', name: 'זרקא' })], new Map());
    fireEvent.change(editOnly(), { target: { value: 'זרקא כהן' } });
    fireEvent.click(screen.getByText(s('ui.save')));

    expect(saved(onChange).name).toBe('זרקא כהן');
    expect(saved(onChange).aliases).toEqual([]);
  });

  it('does not add the old name twice when it is already in the box', () => {
    const onChange = renderRoster(
      [player({ id: 'r1', name: 'זרקא', aliases: ['זרקא'] })],
      new Map([['r1', 'זרקא']]),
    );
    fireEvent.change(editOnly(), { target: { value: 'זרקא כהן' } });
    fireEvent.click(screen.getByText(s('ui.save')));

    expect(saved(onChange).aliases).toEqual(['זרקא']);
  });

  it('ignores a change that is only spacing or capitals', () => {
    // guestKey folds those, so the match survives and there is nothing to keep.
    const onChange = renderRoster(
      [player({ id: 'r1', name: 'זרקא' })],
      new Map([['r1', 'זרקא']]),
    );
    fireEvent.change(editOnly(), { target: { value: '  זרקא  ' } });
    fireEvent.click(screen.getByText(s('ui.save')));

    expect(saved(onChange).aliases).toEqual([]);
  });
});
