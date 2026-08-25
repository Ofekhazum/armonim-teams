import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FixtureRecord, Player } from '../types';
import History from './History';

// The past-nights shelf (§2.6), and specifically the two things about it that
// no amount of reading the code caught: a drag that opened a night it should
// not have, and — the one actually reported — cards that stopped opening at
// all once pointer capture was added.
//
// Both are gestures. Neither is reachable from a pure function, which is why
// they shipped broken.

const player = (id: string, name: string): Player => ({
  id,
  name,
  rating: 4,
  attack: 50,
  chemistry: [],
  avoid: [],
});

const roster = [player('a', 'אופק'), player('b', 'ירין'), player('c', 'ניב')];

const night = (date: string): FixtureRecord => ({
  id: date,
  date,
  teams: { black: ['a'], white: ['b'], blue: ['c'] },
  players: roster.map((p) => ({ id: p.id, name: p.name, rating: p.rating })),
  wins: { black: 4, white: 2, blue: 1 },
});

const shelf = () =>
  render(
    <History
      history={[night('2026-08-06'), night('2026-08-13'), night('2026-08-20')]}
      players={roster}
      isAdmin={false}
      onApplyRating={() => {}}
      onDeleteFixture={() => {}}
      onEditFixture={() => {}}
    />,
  );

const cardFor = (date: string) => screen.getByLabelText(`Read the night of ${date}`);

// The night page is an overlay with no route behind it, so "is it open" is
// asked the way a reader would: is the way out of it on screen.
const nightIsOpen = () => screen.queryByRole('button', { name: /Close/ }) !== null;

// The strip is the scrolling ancestor the drag handlers live on.
const strip = () => document.querySelector('.no-scrollbar') as HTMLElement;

// jsdom has no layout, so a scroll container has no room to scroll and
// `scrollLeft` silently stays 0. Give it some.
const givenWidth = (el: HTMLElement) => {
  Object.defineProperty(el, 'scrollWidth', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
};

const press = (el: HTMLElement, clientX: number) =>
  fireEvent.pointerDown(el, { clientX, pointerType: 'mouse', button: 0, pointerId: 1 });
const move = (el: HTMLElement, clientX: number) =>
  fireEvent.pointerMove(el, { clientX, pointerType: 'mouse', pointerId: 1 });

describe('the past-nights shelf', () => {
  it('opens the night when a card is clicked', () => {
    // The bug that was reported from a phone: pointer capture was taken on
    // `pointerdown`, which retargets the whole gesture to the strip, so the
    // click fired there instead of on the card and nothing ever opened.
    shelf();
    fireEvent.click(cardFor('2026-08-20'));
    expect(nightIsOpen()).toBe(true);
  });

  it('scrolls rather than opening a night when the shelf is dragged', () => {
    shelf();
    const el = strip();
    givenWidth(el);

    press(el, 500);
    move(el, 380);
    fireEvent.pointerUp(el, { pointerType: 'mouse', pointerId: 1 });

    expect(el.scrollLeft).toBe(120);
    // the drag ended over a card; the browser calls that a click
    fireEvent.click(cardFor('2026-08-20'));
    expect(nightIsOpen()).toBe(false);
  });

  it('still opens a night when the hand wobbles a couple of pixels', () => {
    // DRAG_SLOP. Below it, a press is a press — a phone-sized finger never
    // holds perfectly still, and treating three pixels as a drag would make
    // the shelf feel broken in exactly the way the capture bug did.
    shelf();
    const el = strip();
    givenWidth(el);

    press(el, 500);
    move(el, 497);
    fireEvent.pointerUp(el, { pointerType: 'mouse', pointerId: 1 });

    expect(el.scrollLeft).toBe(0);
    fireEvent.click(cardFor('2026-08-20'));
    expect(nightIsOpen()).toBe(true);
  });

  it('swallows one click per drag, and never the one after it', () => {
    // `moved` is cleared as it is spent. Left set, a single drag would eat
    // every click that followed it and the shelf would go dead.
    shelf();
    const el = strip();
    givenWidth(el);

    press(el, 500);
    move(el, 400);
    fireEvent.pointerUp(el, { pointerType: 'mouse', pointerId: 1 });
    fireEvent.click(cardFor('2026-08-20'));
    expect(nightIsOpen()).toBe(false);

    // a plain click straight afterwards
    fireEvent.click(cardFor('2026-08-13'));
    expect(nightIsOpen()).toBe(true);
  });

  it('leaves touch alone, so the phone keeps its own scrolling', () => {
    // Touch already has momentum scrolling; taking it over would make it
    // worse. Only a mouse is handled.
    shelf();
    const el = strip();
    givenWidth(el);

    fireEvent.pointerDown(el, { clientX: 500, pointerType: 'touch', pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 380, pointerType: 'touch', pointerId: 2 });
    expect(el.scrollLeft).toBe(0);

    // and a tap still opens the night
    fireEvent.click(cardFor('2026-08-20'));
    expect(nightIsOpen()).toBe(true);
  });

  it('hides the shelf without hiding the numbers under it', () => {
    shelf();
    // By its own control, not by the "▲ hide" text: the Club tab's other
    // sections fold with the identical wording now (§2.36), so matching on
    // that alone would be ambiguous — and would silently start closing a
    // different section the day the order changed.
    fireEvent.click(screen.getByRole('button', { name: /Past nights/ }));
    expect(screen.queryByLabelText('Read the night of 2026-08-20')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Career numbers/ })).toBeInTheDocument();
  });

  it('gives a non-admin no way to edit a night', () => {
    shelf();
    expect(screen.queryByText('⋯')).not.toBeInTheDocument();
  });
});
