import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { NOTE_MAX } from '../types';
import EventsEditor from './EventsEditor';

// The events editor (§2.58). What it replaced was a two-row textarea holding
// the raw `@…@` string, so the things worth testing are the ones that were
// impossible to get wrong before because nobody could do them at all: adding an
// event, removing one, and moving a mark without typing punctuation.

// Controlled the way both real callers control it — the parent owns the string,
// so a bug where the editor fights its own prop shows up here rather than in
// production.
function Harness({ initial = '', onNote }: { initial?: string; onNote?: (s: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <>
      <EventsEditor
        value={note}
        onChange={(n) => {
          setNote(n);
          onNote?.(n);
        }}
        max={NOTE_MAX}
      />
      <output data-testid="stored">{note}</output>
    </>
  );
}

const stored = () => screen.getByTestId('stored').textContent;
const boxes = () => screen.getAllByRole('textbox');
const click = (name: RegExp, n = 0) => fireEvent.click(screen.getAllByRole('button', { name })[n]);
const type = (i: number, text: string) => fireEvent.change(boxes()[i], { target: { value: text } });

describe('editing the night’s events', () => {
  it('opens on one empty box rather than an empty list', () => {
    render(<Harness />);
    expect(boxes()).toHaveLength(1);
  });

  it('reads a stored note back as separate boxes', () => {
    render(<Harness initial="@first thing@ @second thing +@" />);
    expect(boxes()).toHaveLength(2);
    expect((boxes()[0] as HTMLTextAreaElement).value).toBe('first thing');
    expect((boxes()[1] as HTMLTextAreaElement).value).toBe('second thing');
    // …and the marker it carried is shown as points, not as punctuation
    expect(screen.getByText('+0.5')).toBeInTheDocument();
  });

  it('reads a note that was written one per line', () => {
    render(<Harness initial={'first thing\nsecond thing'} />);
    expect(boxes()).toHaveLength(2);
  });

  it('adds and removes events', () => {
    render(<Harness />);
    type(0, 'one');
    click(/Another event/);
    type(1, 'two');
    expect(stored()).toBe('@one@ @two@');
    click(/Remove event 1/);
    expect(stored()).toBe('@two@');
  });

  it('never leaves the organiser with nothing to type into', () => {
    render(<Harness initial="@only one@" />);
    click(/Remove event 1/);
    expect(boxes()).toHaveLength(1);
    expect(stored()).toBe('');
  });

  it('writes the markers so nobody has to type them', () => {
    render(<Harness />);
    type(0, 'שי שם 4 גולים');
    click(/Half a point up/);
    expect(stored()).toBe('@שי שם 4 גולים +@');
    click(/Half a point down/);
    click(/Half a point down/);
    expect(stored()).toBe('@שי שם 4 גולים -@');
  });

  // The bug this component actually shipped with, twice.
  //
  // Taps in one tick all read the same snapshot, so the second wrote what the
  // first had already written and a double tap was worth half a point instead
  // of a full one. Silently — the worst way for a control that edits somebody's
  // grade to be wrong.
  //
  // **Fired inside one `act` on purpose.** `fireEvent` flushes React between
  // calls, so three separate `fireEvent.click`s pass against the broken
  // component — which is exactly what happened: the first version of this test
  // was green while the browser was still showing +0.5 for three taps. React 18
  // batches real clicks, and this is the only shape that reproduces it.
  it('counts every tap, not every render', () => {
    render(<Harness />);
    type(0, 'שי שם 4 גולים');
    const up = screen.getByRole('button', { name: /Half a point up/ });
    act(() => {
      up.click();
      up.click();
      up.click();
    });
    expect(screen.getByText('+1.5')).toBeInTheDocument();
    expect(stored()).toBe('@שי שם 4 גולים +++@');
  });

  it('applies an edit made straight after the parent swapped the note', () => {
    // The same staleness from the other direction: a re-seed replaces the rows,
    // and an edit landing before the next render must act on the new list.
    const { rerender } = render(<EventsEditor value="@first@" onChange={() => {}} max={NOTE_MAX} />);
    const seen: string[] = [];
    rerender(<EventsEditor value="@second@" onChange={(n) => seen.push(n)} max={NOTE_MAX} />);
    fireEvent.click(screen.getByRole('button', { name: /Half a point up/ }));
    expect(seen[seen.length - 1]).toBe('@second +@');
  });

  it('stops the stepper before it outweighs the whole formula', () => {
    render(<Harness />);
    type(0, 'x');
    for (let i = 0; i < 20; i++) click(/Half a point up/);
    expect(screen.getByText('+3.0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Half a point up/ })).toBeDisabled();
  });

  it('drops an event left blank rather than storing an empty one', () => {
    render(<Harness />);
    type(0, 'one');
    click(/Another event/);
    expect(stored()).toBe('@one@');
  });

  it('keeps the whole note inside the stored limit', () => {
    const onNote = vi.fn();
    render(<Harness onNote={onNote} />);
    type(0, 'x'.repeat(NOTE_MAX + 50));
    expect(stored()!.length).toBeLessThanOrEqual(NOTE_MAX);
  });
});
