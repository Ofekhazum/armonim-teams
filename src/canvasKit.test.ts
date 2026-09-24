import { describe, expect, it } from 'vitest';
import { spacedCaps } from './canvasKit';

// The canvas modules have no other tests — they need a real 2D context, and a
// PNG is not something an assertion can read. `spacedCaps` is the exception
// worth pinning: it is the one helper that decides *glyph order* itself rather
// than handing the string to the platform, and getting that wrong is silent
// everywhere except in front of a Hebrew-speaking reader.

/** Enough of a 2D context to record what was asked of it. */
const stub = () => {
  const drawn: { text: string; x: number }[] = [];
  const state = { direction: 'ltr', textAlign: 'left', font: '', fillStyle: '', letterSpacing: '' };
  const ctx = {
    ...state,
    save() {},
    restore() {},
    // Every glyph one unit wide, so widths are countable rather than guessed.
    measureText: (s: string) => ({ width: [...s].length * 10 }),
    fillText(text: string, x: number) {
      drawn.push({ text, x });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, at: () => ctx };
};

describe('spacedCaps', () => {
  it('hands a Hebrew label to the bidi algorithm in one piece', () => {
    // The bug this exists for: drawn a glyph at a time, `ספטמבר` came out
    // `רבמטפס`, because the loop advances rightwards in logical order. Revert
    // the RTL branch and this splits into seven calls.
    const { ctx, drawn, at } = stub();
    spacedCaps(ctx, 'ספטמבר 2026', 100, 50);
    expect(drawn).toHaveLength(1);
    expect(drawn[0].text).toBe('ספטמבר 2026');
    expect(at().direction).toBe('rtl');
  });

  it('still spaces a Latin label a glyph at a time', () => {
    // The other half: the English pages are tuned around this tracking, and
    // fixing Hebrew must not quietly restyle them.
    const { ctx, drawn } = stub();
    spacedCaps(ctx, 'HEAD TO HEAD', 100, 50);
    expect(drawn).toHaveLength('HEAD TO HEAD'.length);
    expect(drawn.map((d) => d.text).join('')).toBe('HEAD TO HEAD');
    // and each one lands further right than the last
    const xs = drawn.map((d) => d.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('never reverses a mixed label by hand', () => {
    // Reversing the character array was the obvious fix and is wrong: these
    // labels carry years, and `2026` reversed is `6202`. Whatever is drawn has
    // to contain the digits in the order they were written.
    const { ctx, drawn } = stub();
    spacedCaps(ctx, 'ספטמבר 2026', 0, 0);
    expect(drawn.map((d) => d.text).join('')).toContain('2026');
  });

  it('puts a left-aligned label at x, and a right-aligned one ending there', () => {
    // `align` is physical on both paths or the eyebrow on a right-aligned card
    // walks off its own corner.
    const left = stub();
    spacedCaps(left.ctx, 'שגב', 100, 0, { align: 'left' });
    expect(left.drawn[0].x).toBe(100);
    expect(left.at().textAlign).toBe('left');

    const right = stub();
    spacedCaps(right.ctx, 'שגב', 100, 0, { align: 'right' });
    expect(right.drawn[0].x).toBe(100);
    expect(right.at().textAlign).toBe('right');
  });

  it('truncates a Hebrew label from the end that overflows', () => {
    const { ctx, drawn } = stub();
    // 10 units a glyph, so 45 leaves room for four.
    const total = spacedCaps(ctx, 'אבגדהוז', 0, 0, { maxWidth: 45 });
    expect(drawn[0].text).toBe('אבגד');
    expect(total).toBeLessThanOrEqual(45);
  });

  it('reports a width the caller can right-align against', () => {
    // wrappedImage measures with a throwaway context before drawing for real;
    // a wrong number there puts the label through the card's edge.
    const { ctx } = stub();
    expect(spacedCaps(ctx, 'אבג', 0, 0)).toBe(30);
  });
});
