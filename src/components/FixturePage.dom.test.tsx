import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Player } from '../types';
import { ATTACK_DEFAULT, emptyWins, initialClock } from '../types';
import FixturePage from './FixturePage';

// Ending a night (§2.7.1) and the note that goes with it (§2.27).
//
// This is the one flow in the app where getting it wrong loses an evening's
// football: the buttons decide whether a night is filed or thrown away, and
// they were written, rewritten and shipped without any of them ever being
// pressed outside a browser.

const one = (id: string, name: string): Player => ({
  id,
  name,
  rating: 4,
  attack: ATTACK_DEFAULT,
  chemistry: [],
  avoid: [],
});

const players = [one('a', 'אופק'), one('b', 'ירין'), one('c', 'ניב')];

const page = (over: Partial<Parameters<typeof FixturePage>[0]> = {}) => {
  const onSaveResults = vi.fn();
  const onEndFixture = vi.fn();
  render(
    <FixturePage
      teams={{ black: ['a'], white: ['b'], blue: ['c'] }}
      players={players}
      history={[]}
      gkIds={[]}
      wins={{ ...emptyWins(), black: 3 }}
      matchLog={[]}
      onChangeLog={() => {}}
      clock={initialClock()}
      onChangeClock={() => {}}
      liveFixtureId={null}
      onSaveResults={onSaveResults}
      saved={false}
      savedFixtureId={null}
      isAdmin
      onBack={() => {}}
      onEndFixture={onEndFixture}
      {...over}
    />,
  );
  return { onSaveResults, onEndFixture };
};

const click = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('ending a night', () => {
  it('asks what to do with the result rather than whether you are sure', () => {
    page();
    click(/End fixture/);
    expect(screen.getByText("That's the night?")).toBeInTheDocument();
    // three answers, not two — file it, bin it, or neither yet
    expect(screen.getByRole('button', { name: /Save to history/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lose the result/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not yet/ })).toBeInTheDocument();
  });

  it('ends without filing when the result is thrown away', () => {
    const { onSaveResults, onEndFixture } = page();
    click(/End fixture/);
    click(/lose the result/);
    expect(onSaveResults).not.toHaveBeenCalled();
    expect(onEndFixture).toHaveBeenCalled();
  });

  it('does neither when the answer is not yet', () => {
    const { onSaveResults, onEndFixture } = page();
    click(/End fixture/);
    click(/Not yet/);
    expect(onSaveResults).not.toHaveBeenCalled();
    expect(onEndFixture).not.toHaveBeenCalled();
    expect(screen.queryByText("That's the night?")).not.toBeInTheDocument();
  });

  it('files the night and only then ends it', () => {
    // Order matters and is easy to get backwards: `onSaveResults` reads the
    // session that `onEndFixture` is about to clear.
    const calls: string[] = [];
    const { onSaveResults, onEndFixture } = page();
    onSaveResults.mockImplementation(() => calls.push('file'));
    onEndFixture.mockImplementation(() => calls.push('end'));

    click(/End fixture/);
    click(/Save to history/);
    click(/Save to history/); // the note step's own button
    expect(calls).toEqual(['file', 'end']);
  });

  it('offers the note step only to a night being kept', () => {
    page();
    click(/End fixture/);
    click(/Save to history/);
    expect(screen.getByText('Anything worth remembering?')).toBeInTheDocument();
  });

  it('files nothing when the night is binned, note step never seen', () => {
    page();
    click(/End fixture/);
    click(/lose the result/);
    expect(screen.queryByText('Anything worth remembering?')).not.toBeInTheDocument();
  });

  it('carries what was typed through to the record', () => {
    const { onSaveResults } = page();
    click(/End fixture/);
    click(/Save to history/);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'הכדור עף מעל הגדר 5 פעמים' },
    });
    click(/Save with the note/);
    expect(onSaveResults).toHaveBeenCalledWith('הכדור עף מעל הגדר 5 פעמים');
  });

  it('files with no note at all when the box is left empty', () => {
    // Empty is the normal answer and must cost one tap. Undefined rather than
    // '' so an absent note and an empty one are the same thing everywhere
    // downstream.
    const { onSaveResults } = page();
    click(/End fixture/);
    click(/Save to history/);
    click(/Save to history/);
    expect(onSaveResults).toHaveBeenCalledWith(undefined);
  });

  it('treats whitespace as empty', () => {
    const { onSaveResults } = page();
    click(/End fixture/);
    click(/Save to history/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    click(/Save to history/);
    expect(onSaveResults).toHaveBeenCalledWith(undefined);
  });

  it('lets Back drop the note and return to the question before it', () => {
    page();
    click(/End fixture/);
    click(/Save to history/);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'typed by mistake' } });
    click(/^← Back$/);
    expect(screen.getByText("That's the night?")).toBeInTheDocument();
    click(/Save to history/);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('tells a locked device why it cannot file, instead of showing nothing', () => {
    // An absent control reads as a bug; a sentence reads as a lock.
    page({ isAdmin: false });
    click(/End fixture/);
    expect(screen.queryByRole('button', { name: /Save to history/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Unlock admin to file tonight/)).toBeInTheDocument();
  });

  it('still offers to file a night nobody wrote anything down for', () => {
    // The regression the tally panel's removal would have caused: an unlogged
    // night with no way into history at all. Filing keeps who played.
    const { onSaveResults } = page({ wins: emptyWins(), matchLog: [] });
    click(/End fixture/);
    expect(screen.getByText(/Nothing was written down tonight/)).toBeInTheDocument();
    click(/Save to history/);
    click(/Save to history/);
    expect(onSaveResults).toHaveBeenCalled();
  });
});
