import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildTestClub } from '../testData';
import { playerStandings } from '../calibration';
import { ladderBadges, profileCounts, profileNights } from '../playerProfile';
import { playerAchievements } from '../achievements';
import { SHOW_MARKET_VALUE } from '../values';
import PlayerPage from './PlayerPage';

// The ladder badges' medallions (§2.19), after they stopped being capped at
// bronze/silver/gold. The tier arithmetic has its own tests in
// `playerProfile.test.ts`; what matters here is that the page actually renders
// a different colour per tier rather than collapsing back to three, which is
// exactly the kind of thing a unit test on the pure function cannot see.
//
// Uses the invented club (§2.32) because it is the one history in this repo
// deep enough to have a player who has cleared more than three rungs of a
// ladder — the real club, three nights in, never could.

describe('ladder badge medallions', () => {
  it('renders a round medallion, not the old pill, for a ladder badge', () => {
    const { players, history } = buildTestClub();
    const busiest = playerStandings(history)[0];
    const player = players.find((p) => p.id === busiest.id)!;

    render(
      <PlayerPage
        player={player}
        history={history}
        players={players}
        isAdmin={false}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );

    const medallions = document.querySelectorAll('span.rounded-full.h-11.w-11');
    expect(medallions.length).toBeGreaterThan(0);
  });

  it('gives badges at different tiers different colours, proving it is not capped at three', () => {
    const { players, history } = buildTestClub();
    const busiest = playerStandings(history)[0];
    const player = players.find((p) => p.id === busiest.id)!;

    const counts = profileCounts(profileNights(history, player.id));
    const mvps = playerAchievements(history).get(player.id)?.mvps ?? 0;
    const badges = ladderBadges(counts, mvps);
    const tiers = new Set(badges.map((b) => b.tier));
    // The whole point of the invented season: a busy player's ladders should
    // not all happen to sit on the same rung.
    expect(tiers.size).toBeGreaterThan(1);

    render(
      <PlayerPage
        player={player}
        history={history}
        players={players}
        isAdmin={false}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );

    const medallions = [...document.querySelectorAll('span.rounded-full.h-11.w-11')];
    const looks = new Set(medallions.map((m) => m.className));
    expect(looks.size).toBeGreaterThan(1);
  });

  it('says the tier by name in the badge detail, on tap', () => {
    const { players, history } = buildTestClub();
    const busiest = playerStandings(history)[0];
    const player = players.find((p) => p.id === busiest.id)!;

    render(
      <PlayerPage
        player={player}
        history={history}
        players={players}
        isAdmin={false}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );

    const medallions = document.querySelectorAll('button > span.rounded-full.h-11.w-11');
    const button = medallions[0].closest('button')!;
    fireEvent.click(button);
    // one of Bronze…Diamond, dashed onto the front of the detail sentence
    expect(
      screen.getByText(/^(Bronze|Silver|Gold|Emerald|Sapphire|Amethyst|Diamond) — /),
    ).toBeInTheDocument();
  });
});

// The market value is hidden rather than removed (§2.31): the formula, the
// Worker route and PriceTag itself are all untouched behind `SHOW_MARKET_VALUE`.
// These are what stop it coming back by accident — a stray render or a stray
// fetch would both be invisible in review and obvious to the club.
describe('the hidden market value', () => {
  const open = () => {
    const { players, history } = buildTestClub();
    const busiest = playerStandings(history)[0];
    const player = players.find((p) => p.id === busiest.id)!;
    render(
      <PlayerPage
        player={player}
        history={history}
        players={players}
        isAdmin={false}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );
  };

  it('is off', () => {
    // Stated outright, so flipping the flag without meaning to fails here
    // first rather than on somebody's phone.
    expect(SHOW_MARKET_VALUE).toBe(false);
  });

  it('puts no price on the profile, even when one is available to put there', async () => {
    // The fetch has to *succeed* for this to test the render guard at all.
    // With the default stub (which rejects) the price stays undefined and
    // PriceTag renders nothing whatever the flag says — so this assertion
    // passed with the feature switched on, which is a test proving nothing.
    const { players, history } = buildTestClub();
    const busiest = playerStandings(history)[0];
    const player = players.find((p) => p.id === busiest.id)!;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ values: { [player.id]: { value: 8.75, previous: 8.5 } } }),
        ),
      ),
    );

    render(
      <PlayerPage
        player={player}
        history={history}
        players={players}
        isAdmin={false}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );
    // Let any in-flight price resolve before looking.
    await screen.findByText(player.name);

    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
    expect(screen.queryByText(/not a rating/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('does not even ask for one', () => {
    // A hidden feature must not still be paying for itself on every open of
    // every player's page.
    const spy = vi.fn((url: unknown) => {
      void url;
      return Promise.reject(new Error('no network in component tests'));
    });
    vi.stubGlobal('fetch', spy);
    open();
    for (const [url] of spy.mock.calls) {
      expect(String(url)).not.toContain('/values');
    }
    vi.unstubAllGlobals();
  });
});
