// The drawing primitives the recap posters are built from (§2.11).
//
// Split out of `wrappedImage.ts` when the recap grew from "a few stat tiles"
// into five composed pages: that file is now about *what goes where*, and this
// one is about *how a thing is drawn*. Nothing here knows what a fixture is —
// it takes numbers and strings and puts pixels down, which is what makes it
// testable by eye in isolation and reusable by the next poster that wants a
// chip or a stripe.
//
// Canvas rather than a chart library, same reason as shareImage.ts and
// shirtImage.ts: this app ships React + Tailwind and nothing else, and a
// poster that has to end up as a PNG in a share sheet was never going to be
// DOM anyway.

import type { TeamColor } from './types';

export const font = (size: number, weight = '700') =>
  `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

// --- Palette ---------------------------------------------------------------
//
// `TEAM_META` in components/ui.tsx is the same three shirts in Tailwind class
// strings — unusable on a canvas, which needs real colour values. These are
// the hexes those classes resolve to, so the recap's squads look like the
// fixture page's squads rather than merely similar to them.
export const TEAM_CANVAS: Record<
  TeamColor,
  { bg: string; border: string; text: string; sub: string; chip: string; accent: string }
> = {
  black: {
    bg: '#1c1917', // stone-900
    border: '#44403c', // stone-700
    text: '#f5f5f4', // stone-100
    sub: '#a8a29e', // stone-400
    chip: '#292524', // stone-800
    accent: '#e7e5e4', // stone-200
  },
  white: {
    bg: '#fffdf4',
    border: '#d6c9a8',
    text: '#451a03', // amber-950
    sub: '#8a6d3f',
    chip: '#ffffff',
    accent: '#f59e0b',
  },
  blue: {
    bg: '#1e3a8a', // blue-900
    border: '#1d4ed8', // blue-700
    text: '#eff6ff', // blue-50
    sub: '#93c5fd', // blue-300
    chip: '#1e40af', // blue-800
    accent: '#60a5fa', // blue-400
  },
};

export const TEAM_LABEL: Record<TeamColor, string> = {
  black: 'Black',
  white: 'White',
  blue: 'Blue',
};

// The poster's own ink, on the dark ground every page shares.
export const INK = {
  bright: '#fffaf0',
  body: 'rgba(253,250,243,0.82)',
  muted: 'rgba(253,250,243,0.52)',
  faint: 'rgba(253,250,243,0.28)',
  gold: '#f59e0b',
  goldSoft: '#fed7aa',
};

// --- Shapes ----------------------------------------------------------------

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

export function strokeRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  lineWidth = 2,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

/** A top-to-bottom fill — the card surface, replacing the old corner-to-corner
 *  gradients that made every tile read as the same object at a different hue. */
export function vGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  from: string,
  to: string,
): CanvasGradient {
  void x;
  void w;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

// A soft radial glow rather than a hard-edged shape — gives the poster
// background depth without needing canvas `filter: blur()`, whose support on
// older mobile Safari is shakier than a plain gradient.
export function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Diagonal broadcast stripes, clipped to a rounded card. Kept very low
 *  contrast: it is texture, and the moment it is readable as lines it is
 *  competing with the number on top of it. */
export function stripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  gap = 18,
  width = 7,
) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = -h; i < w + h; i += gap) {
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Text ------------------------------------------------------------------

/** Shrinks a string until it fits, adding an ellipsis if anything was cut. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Greedy word wrap. Returns the lines; the caller decides how many to draw. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The broadcast/jersey number: heavy, and outlined so it survives on top of
 *  a busy card without needing a panel behind it. */
export function jerseyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    size: number;
    fill: string;
    stroke?: string;
    align?: CanvasTextAlign;
    direction?: CanvasDirection;
    strokeWidth?: number;
  },
) {
  ctx.save();
  ctx.font = font(opts.size, '900');
  ctx.textAlign = opts.align ?? 'left';
  ctx.direction = opts.direction ?? 'ltr';
  if (opts.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = opts.strokeWidth ?? Math.max(3, opts.size * 0.09);
    ctx.strokeStyle = opts.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A section header: a thick colour bar, then the title in spaced caps. The
 *  bar is what makes it read as broadcast furniture rather than as a heading
 *  in a document. */
export function sectionHeader(
  ctx: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
  accent: string,
  size = 22,
) {
  const barW = 7;
  const barH = size + 6;
  ctx.fillStyle = accent;
  roundRect(ctx, x, y - barH + 4, barW, barH, 3);
  ctx.fill();

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(size, '900');
  ctx.fillStyle = INK.bright;
  ctx.fillText(title.toUpperCase(), x + barW + 12, y);
  ctx.restore();
}

/**
 * Wraps a run in a Unicode first-strong isolate, so its own direction is
 * resolved on its own and it cannot reorder what sits beside it.
 *
 * This is not decoration — without it, a chip reading `דני · 10th` comes out
 * as `10 · דניth`: the Hebrew name makes the whole string an RTL paragraph,
 * the digits and the "th" resolve as separate runs, and the trailing Latin
 * gets flung to the far end. Isolating each half and drawing the chip
 * left-to-right is what keeps a mixed-script label in the order it was
 * written, whichever way round the two halves happen to be.
 */
export const iso = (s: string) => `⁨${s}⁩`;

/** A `name · detail` label, safe for any mix of Hebrew, Latin and digits. */
export const isoPair = (name: string, detail: string) => `${iso(name)} · ${iso(detail)}`;

/** Small spaced caps — the label above a number. Canvas has no letter-spacing,
 *  so it is drawn a character at a time. Truncates at `maxWidth` if given,
 *  which is what stops a long award name reaching the card's corner emoji. */
export function spacedCaps(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: {
    size?: number;
    color?: string;
    tracking?: number;
    align?: 'left' | 'right';
    maxWidth?: number;
  } = {},
) {
  const size = opts.size ?? 13;
  const tracking = opts.tracking ?? 1.6;
  ctx.save();
  ctx.font = font(size, '800');
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = opts.color ?? INK.muted;

  let chars = [...text.toUpperCase()];
  const widthOf = (cs: string[]) =>
    cs.reduce((w, ch) => w + ctx.measureText(ch).width + tracking, -tracking);
  if (opts.maxWidth != null) {
    while (chars.length > 1 && widthOf(chars) > opts.maxWidth) chars.pop();
  }

  const total = widthOf(chars);
  let cx = opts.align === 'right' ? x - total : x;
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();
  return total;
}

// --- Chips -----------------------------------------------------------------
//
// A name in a bordered pill. The achievements page is built entirely from
// these: a flowed row of pills says the same thing a column of rows did in a
// fraction of the height, which is the whole difference between a poster and
// a receipt.

export const CHIP_PAD_X = 12;
export const CHIP_H = 34;
export const CHIP_GAP = 8;

export function chipWidth(ctx: CanvasRenderingContext2D, text: string, size = 17): number {
  ctx.save();
  ctx.direction = 'ltr';
  ctx.font = font(size, '800');
  const w = ctx.measureText(text).width + CHIP_PAD_X * 2;
  ctx.restore();
  return w;
}

/** Packs chips into lines that fit `maxWidth`. Never truncates the list — the
 *  point of the achievements page is that it lists everything. */
export function flowChips(
  ctx: CanvasRenderingContext2D,
  texts: string[],
  maxWidth: number,
  size = 17,
): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  let used = 0;
  for (const text of texts) {
    const w = chipWidth(ctx, text, size);
    if (line.length > 0 && used + CHIP_GAP + w > maxWidth) {
      lines.push(line);
      line = [text];
      used = w;
    } else {
      used += (line.length ? CHIP_GAP : 0) + w;
      line.push(text);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

export function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; fill?: string; border?: string; color?: string } = {},
): number {
  const size = opts.size ?? 17;
  const w = chipWidth(ctx, text, size);
  fillRound(ctx, x, y, w, CHIP_H, CHIP_H / 2, opts.fill ?? 'rgba(253,250,243,0.07)');
  strokeRound(ctx, x, y, w, CHIP_H, CHIP_H / 2, opts.border ?? 'rgba(253,250,243,0.16)', 1.5);

  ctx.save();
  ctx.font = font(size, '800');
  // Explicitly left-to-right, which together with `iso()` on each half is what
  // makes a mixed-script chip land in the order it was written. A bare Hebrew
  // name is unaffected — it is one isolated RTL run either way.
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.fillStyle = opts.color ?? INK.bright;
  ctx.fillText(text, x + w / 2, y + CHIP_H / 2 + size * 0.36);
  ctx.restore();
  return w;
}

// --- The bento packer ------------------------------------------------------
//
// Cards declare a span in sixths (6 = full width, 3 = half, 2 = a third) and
// are laid out a tier at a time, so a row is always made of same-sized cards.
// **A short final row stretches to fill the width** rather than leaving a gap:
// every stat on these pages is nullable, so the number of cards is whatever
// the month happened to produce, and a layout that only looks right at certain
// counts would look broken most months.

export const GRID_UNITS = 6;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Positions `count` cards of the given span, `GRID_UNITS/span` to a row. */
export function packTier(
  count: number,
  span: number,
  x: number,
  y: number,
  totalW: number,
  rowH: number,
  gap: number,
): { slots: Slot[]; height: number } {
  const perRow = Math.floor(GRID_UNITS / span);
  const slots: Slot[] = [];
  let rowY = y;
  for (let i = 0; i < count; i += perRow) {
    const inRow = Math.min(perRow, count - i);
    // the stretch: a lone card on the last row takes the whole width
    const cardW = (totalW - gap * (inRow - 1)) / inRow;
    for (let j = 0; j < inRow; j++) {
      slots.push({ x: x + j * (cardW + gap), y: rowY, w: cardW, h: rowH });
    }
    rowY += rowH + gap;
  }
  return { slots, height: count === 0 ? 0 : rowY - y };
}
