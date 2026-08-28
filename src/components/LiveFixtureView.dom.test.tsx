import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { LiveFixture } from '../types';
import { initialClock } from '../types';
import LiveFixtureView from './LiveFixtureView';

// What the rest of the group sees while a fixture is on, or merely scheduled
// (§2.7.2, §2.14) — the spectator's cut of `FixturePage`, and the one place a
// future `startedAt` was misread as "kicked off just now" before it moved
// into `kickoff.ts`.

const players = [
  { id: 'a', name: 'אופק', isGk: true },
  { id: 'b', name: 'ירין' },
  { id: 'c', name: 'ניב' },
];

const fixture = (over: Partial<LiveFixture> = {}): LiveFixture => ({
  id: 'live-1',
  startedAt: 0, // epoch 0: always already kicked off
  players,
  teams: { black: ['a'], white: ['b'], blue: ['c'] },
  gkIds: ['a'],
  clock: initialClock(),
  ...over,
});

const view = (over: Partial<LiveFixture> = {}, admin = true) => {
  const onEndFixture = vi.fn();
  render(
    <LiveFixtureView
      fixture={fixture(over)}
      history={[]}
      onChangeClock={() => {}}
      onChangeLog={() => {}}
      onEndFixture={onEndFixture}
      isAdmin={admin}
    />,
  );
  return { onEndFixture };
};

describe('a fixture that has already kicked off', () => {
  it('says when it started, not the scheduled countdown', () => {
    view({ startedAt: 0 });
    expect(screen.getByText(/kicked off/)).toBeInTheDocument();
    expect(screen.queryByText(/Kicks off in/)).not.toBeInTheDocument();
  });

  it('shows the clock and the match log', () => {
    view();
    expect(screen.getByRole('button', { name: /Start match/ })).toBeInTheDocument();
  });
});

describe('a fixture that is merely scheduled', () => {
  const future = () => Date.now() + 60 * 60 * 1000;

  it('shows a countdown rather than "kicked off just now"', () => {
    view({ startedAt: future() });
    expect(screen.getByText(/Kicks off in/)).toBeInTheDocument();
    expect(screen.queryByText(/kicked off/)).not.toBeInTheDocument();
  });

  it('hides the clock and the match log until kickoff', () => {
    view({ startedAt: future() });
    expect(screen.queryByRole('button', { name: /Start match/ })).not.toBeInTheDocument();
  });

  it('still shows the teams', () => {
    view({ startedAt: future() });
    expect(screen.getByText('אופק')).toBeInTheDocument();
  });

  it('offers to cancel rather than to end', () => {
    view({ startedAt: future() });
    expect(screen.getByRole('button', { name: /Cancel fixture/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /End fixture/ })).not.toBeInTheDocument();
  });

  it('confirms before cancelling, with scheduling-specific copy', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onEndFixture } = view({ startedAt: future() });
    fireEvent.click(screen.getByRole('button', { name: /Cancel fixture/ }));
    expect(confirmSpy.mock.calls[0][0]).toMatch(/scheduled fixture/);
    expect(onEndFixture).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
