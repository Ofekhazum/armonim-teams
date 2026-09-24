import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

// Every date on the profile is a way into the night it belongs to (§2.60).
// A run card is the exception worth its own handling: its date is the night
// that *broke* the run, so the nights it was made of need a list of their own.
describe('getting from the feed to a night', () => {
  const run = ev({
    kind: 'streak-ended',
    at: '2026-08-27',
    fixtureId: 'broke-it',
    n: 3,
    runNights: [
      { fixtureId: 'w1', at: '2026-08-06' },
      { fixtureId: 'w2', at: '2026-08-13' },
      { fixtureId: 'w3', at: '2026-08-20' },
    ],
  });

  it('opens the night a card is dated to', () => {
    const seen: string[] = [];
    render(
      <PlayerTimeline
        events={[ev({ kind: 'nth-mvp', at: '2026-08-06', fixtureId: 'f1', n: 5 })]}
        onOpenNight={(id) => seen.push(id)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open the night of/ }));
    expect(seen).toEqual(['f1']);
  });

  it('leaves the date as plain text when there is nowhere to go', () => {
    // The same component is rendered without a way to open a night, and an
    // underline that does nothing is worse than no underline.
    render(<PlayerTimeline events={[ev({ kind: 'nth-mvp', at: '2026-08-06', fixtureId: 'f1', n: 5 })]} />);
    expect(screen.queryByRole('button', { name: /Open the night of/ })).not.toBeInTheDocument();
  });

  it('keeps the run’s nights behind a tap rather than in the card', () => {
    render(<PlayerTimeline events={[run]} onOpenNight={() => {}} />);
    expect(screen.queryByRole('list', { name: /nights the run was made of/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Which nights/ }));
    expect(screen.getByRole('list', { name: /nights the run was made of/ })).toBeInTheDocument();
  });

  it('lists the nights that were won, newest first, and opens them', () => {
    const seen: string[] = [];
    render(<PlayerTimeline events={[run]} onOpenNight={(id) => seen.push(id)} />);
    fireEvent.click(screen.getByRole('button', { name: /Which nights/ }));

    const list = screen.getByRole('list', { name: /nights the run was made of/ });
    const dates = within(list)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(dates).toHaveLength(3);

    within(list).getAllByRole('button')[0].click();
    // newest first, so the first one listed is the last night of the run —
    // and never the night that ended it
    expect(seen).toEqual(['w3']);
    expect(seen).not.toContain('broke-it');
  });

  it('still lets the card’s own date open the night that ended the run', () => {
    const seen: string[] = [];
    render(<PlayerTimeline events={[run]} onOpenNight={(id) => seen.push(id)} />);
    fireEvent.click(screen.getByRole('button', { name: /Open the night of/ }));
    expect(seen).toEqual(['broke-it']);
  });

  it('offers no run list on a card that is not about a run', () => {
    render(
      <PlayerTimeline
        events={[ev({ kind: 'nth-win', at: '2026-08-06', fixtureId: 'f1', n: 100 })]}
        onOpenNight={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Which nights/ })).not.toBeInTheDocument();
  });
});
