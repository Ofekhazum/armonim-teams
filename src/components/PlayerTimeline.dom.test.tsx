import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TimelineEvent } from '../playerTimeline';
import PlayerTimeline from './PlayerTimeline';

// The feed (§2.29). The module that builds the events is covered by
// `playerTimeline.test.ts`; what is tested here is the half that only exists
// on screen — the fold, and the fact that a sort key which is not a date never
// reaches a reader.

const ev = (over: Partial<TimelineEvent> & Pick<TimelineEvent, 'kind' | 'at'>): TimelineEvent =>
  ({ ...over }) as TimelineEvent;

const many = (n: number): TimelineEvent[] =>
  Array.from({ length: n }, (_, i) =>
    ev({ kind: 'nth-mvp', at: `2026-0${(i % 9) + 1}-0${(i % 9) + 1}`, n: i + 1 }),
  );

describe('the career feed', () => {
  it('says so plainly when there is nothing yet', () => {
    // A blank card reads as broken. A new player's page must say that the
    // emptiness is the correct answer, not a missing fetch.
    render(<PlayerTimeline events={[]} />);
    expect(screen.getByText(/Nothing has happened twice yet/)).toBeInTheDocument();
  });

  it('draws a card per event, with the night it happened on', () => {
    render(
      <PlayerTimeline
        events={[
          ev({ kind: 'streak-live', at: '2026-08-20', n: 4 }),
          ev({ kind: 'debut', at: '2026-01-08', shirt: 'black', place: 2 }),
        ]}
      />,
    );
    expect(screen.getByText('On a run of 4')).toBeInTheDocument();
    expect(screen.getByText('First night on record')).toBeInTheDocument();
    expect(screen.getByText('20 Aug 26')).toBeInTheDocument();
    expect(screen.getByText('8 Jan 26')).toBeInTheDocument();
  });

  it('states a broken run as its length, not as a judgement', () => {
    // §2.9 in the one place it is easiest to break: the card about something
    // going wrong. The record is three numbers a night and cannot carry a
    // sentence about how anybody was playing.
    render(<PlayerTimeline events={[ev({ kind: 'streak-ended', at: '2026-05-07', n: 5 })]} />);
    expect(screen.getByText('A run of 5 ended')).toBeInTheDocument();
  });

  it('never shows the Team of the Month sort key', () => {
    // `at` for a month is `2026-07-99` — a day that cannot exist, chosen so the
    // award sorts above July's nights. Rendering it as a date would put the
    // 99th of July on somebody's profile.
    render(<PlayerTimeline events={[ev({ kind: 'totm', at: '2026-07-99', period: '2026-07' })]} />);
    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.queryByText(/99/)).not.toBeInTheDocument();
  });

  it('shows the three most recent and folds the rest away', () => {
    // A career feed is the one card here with no natural length. At eight it
    // was taller than the whole rest of the profile put together, so
    // everything under it was below the fold on a phone.
    render(<PlayerTimeline events={many(14)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /11 earlier moments/ })).toBeInTheDocument();
  });

  it('opens the rest, and closes them again', () => {
    // The half that was missing: a one-way expand is a card that can only get
    // bigger, so a long career opens once and is then scrolled past all visit.
    render(<PlayerTimeline events={many(14)} />);
    fireEvent.click(screen.getByRole('button', { name: /11 earlier moments/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(14);

    fireEvent.click(screen.getByRole('button', { name: /Show less/ }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /11 earlier moments/ })).toBeInTheDocument();
  });

  it('shows a short career whole, with no button at all', () => {
    render(<PlayerTimeline events={many(3)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /earlier|Show less/ })).not.toBeInTheDocument();
  });

  it('counts one hidden moment in the singular', () => {
    render(<PlayerTimeline events={many(4)} />);
    expect(screen.getByRole('button', { name: /1 earlier moment$/ })).toBeInTheDocument();
  });
});
