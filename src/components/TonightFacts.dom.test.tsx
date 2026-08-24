import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TonightPlayer } from '../types';
import { buildTestClub } from '../testData';
import TonightFacts, { MilestoneStrip } from './TonightFacts';

// The three panels on a match night, and their folds (§2.34).
//
// What is worth testing here is not that a panel can be hidden — that is one
// `&&` — but the two things around it that are easy to get wrong: that folding
// one panel leaves the other two alone, and that the choice survives the page
// being rebuilt, because the live view at a pitch is reloaded constantly and a
// fold that forgot itself every time would be worse than no fold at all.

// The invented club (§2.32) rather than a hand-rolled fixture, and that is the
// second thing this file is checking. A first attempt built fifteen players
// with identical records over twenty uniform nights, and *none* of the three
// panels appeared: nobody was near a round number of wins, nobody had a
// streak, and no pair had a head-to-head worth the word. Which is the whole
// argument for the sandbox — a fixture that is merely present tests nothing,
// because every panel here is gated on a pattern rather than on a count.
const club = buildTestClub();
const TONIGHT = club.history[club.history.length - 1];
const PAST = club.history.slice(0, -1);
const TODAYS: TonightPlayer[] = TONIGHT.players.map((p) => ({ id: p.id, name: p.name }));

const facts = () =>
  render(<TonightFacts players={TODAYS} history={PAST} teams={TONIGHT.teams} />);

const panel = (name: RegExp) => screen.getByRole('button', { name });

describe('folding the match-night panels', () => {
  it('opens all three, and the derby has something to say', () => {
    facts();
    for (const p of [/on the line/i, /tonight's derby/i, /coming in tonight/i]) {
      expect(panel(p)).toHaveAttribute('aria-expanded', 'true');
    }
    expect(screen.getByText(/matches on opposite sides/i)).toBeInTheDocument();
  });

  it('folds one panel without touching the others', () => {
    facts();
    fireEvent.click(panel(/tonight's derby/i));

    expect(panel(/tonight's derby/i)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/matches on opposite sides/i)).not.toBeInTheDocument();
    // The heading itself stays, or there would be no way back.
    expect(panel(/tonight's derby/i)).toBeInTheDocument();

    expect(panel(/on the line/i)).toHaveAttribute('aria-expanded', 'true');
    expect(panel(/coming in tonight/i)).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds back open again', () => {
    facts();
    fireEvent.click(panel(/tonight's derby/i));
    fireEvent.click(panel(/tonight's derby/i));
    expect(screen.getByText(/matches on opposite sides/i)).toBeInTheDocument();
  });

  it('remembers the fold across a rebuild of the page', () => {
    const { unmount } = facts();
    fireEvent.click(panel(/coming in tonight/i));
    unmount();

    facts();
    expect(panel(/coming in tonight/i)).toHaveAttribute('aria-expanded', 'false');
    // and only that one
    expect(panel(/tonight's derby/i)).toHaveAttribute('aria-expanded', 'true');
    expect(panel(/on the line/i)).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves the night page strip exactly as it was — no heading, no fold', () => {
    render(
      <MilestoneStrip
        milestones={[{ kind: 'nth-win', id: 'p1', name: 'אופק', wins: 50 }]}
        duos={[]}
      />,
    );
    expect(screen.getByText(/50th win/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
