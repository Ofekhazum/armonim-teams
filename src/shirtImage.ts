// Renders each team's lineup onto the hand-drawn shirt-card templates
// (src/shirt_images/*.webp) and hands all three off to the OS share sheet in
// one go, so "share" on a phone means "save 3 pictures to the gallery".
//
// The templates are a fixed 5-shirt pentagon (this app is 5-a-side, see
// FULL_TEAM in balancer.ts) laid out top → bottom: one shirt up top, two in
// the middle row, two along the bottom. Names go on in the same order as the
// board — keeper/defence first — so the top shirt is always the most
// defensive player and the bottom row is the most attacking.

import type { Player, TeamColor, Teams } from './types';
import { TEAM_COLORS, lineupOrder } from './balancer';
import type { ShareImageResult } from './shareImage';
import blackShirtUrl from './shirt_images/black_team_shirt.webp';
import whiteShirtUrl from './shirt_images/white_team_shirt.webp';
import blueShirtUrl from './shirt_images/blue_team_shirt.webp';
import goldShirtUrl from './shirt_images/gold_team_shirt.webp';
// The sixth/seventh shirt, supplied separately — see the mentions block below.
import mentionShirtUrl from './shirt_images/mention_shirt.webp';

// The three shirts a night is played in, plus the gold one nobody wears: the
// Team of the Month card (§2.21). Same artwork, same five-shirt pentagon, same
// hand-measured boxes — which is the whole reason the card was cheap, and why
// the gold template had to be resized to match the other three exactly.
export type ShirtTemplate = TeamColor | 'gold';

const SHIRT_URL: Record<ShirtTemplate, string> = {
  black: blackShirtUrl,
  white: whiteShirtUrl,
  blue: blueShirtUrl,
  gold: goldShirtUrl,
};

// Dark shirts get light lettering with a dark outline and vice versa, so a
// name reads clearly against the busy nebula texture underneath it.
const TEXT_STYLE: Record<ShirtTemplate, { fill: string; stroke: string }> = {
  black: { fill: '#fdfaf3', stroke: 'rgba(0,0,0,0.85)' },
  white: { fill: '#211407', stroke: 'rgba(255,255,255,0.92)' },
  blue: { fill: '#f2f8ff', stroke: 'rgba(4,12,36,0.85)' },
  // the gold shirts are dark inside a bright outline, so lettering follows the
  // dark-shirt rule rather than the gold of the border
  gold: { fill: '#fff6df', stroke: 'rgba(38,24,0,0.88)' },
};

interface Box {
  x: number; // center
  y: number; // center
  width: number;
  height: number;
}

// Boxes measured by hand, per shirt, against a 572px-wide render of the
// source images (all three share one layout, just recolored) using a small
// drawing tool built for the purpose. The actual template assets are
// exported at a higher resolution for sharper sharing, so every measurement
// here gets multiplied by `scale` (actual width ÷ this design width) before
// use.
const DESIGN_WIDTH = 572;

// Where the name goes — the yoke area right below the collar, like a real
// shirt — in top → bottom order: keeper/defence first, most attacking last.
const NAME_BOXES: Box[] = [
  { x: 286, y: 316, width: 98, height: 43 }, // top
  { x: 124, y: 431, width: 98, height: 43 }, // middle-left
  { x: 449, y: 432, width: 98, height: 43 }, // middle-right
  { x: 183, y: 632, width: 98, height: 43 }, // bottom-left
  { x: 389, y: 632, width: 98, height: 43 }, // bottom-right
];

// Where a jersey number goes — the open center of the shirt, below the name
// — measured at the same time as NAME_BOXES. Drawn for every shirt: players
// with no Player.number set get a "?" rather than an empty box.
const NUMBER_BOXES: Box[] = [
  { x: 287, y: 365, width: 51, height: 52 }, // top
  { x: 125, y: 478, width: 51, height: 52 }, // middle-left
  { x: 450, y: 478, width: 51, height: 52 }, // middle-right
  { x: 183, y: 680, width: 51, height: 52 }, // bottom-left
  { x: 390, y: 680, width: 51, height: 52 }, // bottom-right
];

// --- Honourable mentions (§2.69) --------------------------------------------
//
// Ranks six and seven, printed small in the empty strip below the pentagon on
// the gold card only. **They are not in the team**: nothing here is registered,
// announced or shown on a profile — see `teamOfMonth` in totm.ts.
//
// Their shirt is its own asset rather than one of the five borrowed from the
// template, which is what the organiser asked for and is also the reason this
// file no longer carries a luminance key. An earlier version cut a shirt out of
// the gold template by brightness, because every rectangular crop of that
// artwork has a bright border and lands a visible box. `mention_shirt.webp`
// arrives with a real alpha channel — corners measured at 0 — so it is simply
// drawn, and the mention is a whole shirt instead of an outline.

/**
 * The part of the asset that is actually artwork, in its own pixels.
 *
 * Measured off the alpha channel rather than assumed: the file is 1024×921 and
 * the shirt occupies x 102–872, y 48–858. Positioning against the file's centre
 * instead would sit every mention 25px right of where it belongs, since the
 * padding is not symmetric.
 */
const MENTION_ART = { x: 102, y: 48, width: 770, height: 810 };

/** Name and number on that shirt, in the asset's own pixels. */
const MENTION_NAME_BOX: Box = { x: 487, y: 322, width: 340, height: 86 };
const MENTION_NUMBER_BOX: Box = { x: 487, y: 500, width: 250, height: 150 };

/** How wide a mention shirt is drawn, in design units. */
const MENTION_WIDTH = 104;

/**
 * The font range for a mention, as a fraction of a full-size shirt's.
 *
 * **Deliberately not tied to `MENTION_WIDTH`.** Scaling the type with the
 * artwork is the obvious thing and gives a name about 2.4px tall — the shirt
 * can shrink freely, a name cannot. So the art has a scale and the type has a
 * floor, and they are allowed to disagree.
 */
const MENTION_TEXT_SCALE = 0.5;

/** The centre of the strip the mentions sit in, and how far apart they sit. */
const MENTION_ROW_Y = 878;
const MENTION_GAP = 122;

/** Where the label goes, above the row. */
const MENTION_LABEL_Y = 806;

const font = (size: number, weight = '800') =>
  `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

// Shrinks the name until it fits the name box; if it still won't fit at the
// smallest readable size, wraps it onto a second line instead of shrinking
// further. `maxWidth` and the returned `size` are both in actual canvas
// pixels (i.e. already multiplied by `scale`).
function fitName(
  ctx: CanvasRenderingContext2D,
  name: string,
  maxWidth: number,
  scale: number,
): { lines: string[]; size: number } {
  const minSize = 18 * scale;
  for (let size = 30 * scale; size >= minSize; size -= scale) {
    ctx.font = font(size);
    if (ctx.measureText(name).width <= maxWidth) return { lines: [name], size };
  }
  ctx.font = font(minSize);
  if (!name.includes(' ') || ctx.measureText(name).width <= maxWidth) {
    return { lines: [name], size: minSize };
  }
  const words = name.split(' ');
  let first = words[0];
  let i = 1;
  while (i < words.length && ctx.measureText(`${first} ${words[i]}`).width <= maxWidth) {
    first += ` ${words[i]}`;
    i++;
  }
  const second = words.slice(i).join(' ');
  return { lines: second ? [first, second] : [first], size: minSize };
}

// Shrinks a jersey number until it fits its box — numbers never wrap, they
// just get smaller, since "9" and "99" need very different sizes to look
// like they belong in the same-size box.
function fitNumberSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  scale: number,
): number {
  const minSize = 13 * scale;
  let size = Math.min(36 * scale, maxHeight * 0.55);
  while (size > minSize) {
    ctx.font = font(size, '900');
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= scale;
  }
  return Math.max(size, minSize);
}

export interface ShirtPlayer {
  name: string;
  number?: number;
}

/**
 * Draws the near-misses into the empty strip under the pentagon.
 *
 * `shirt` is `mention_shirt.webp`, already loaded; it has its own alpha, so this
 * is an ordinary composite with nothing clever in it.
 */
function drawMentions(
  ctx: CanvasRenderingContext2D,
  shirt: HTMLImageElement,
  mentions: ShirtPlayer[],
  style: { fill: string; stroke: string },
  scale: number,
  label: string,
) {
  // design units per pixel of the asset
  const k = MENTION_WIDTH / MENTION_ART.width;
  const w = MENTION_WIDTH;
  const h = MENTION_ART.height * k;
  const artCx = MENTION_ART.x + MENTION_ART.width / 2;
  const artCy = MENTION_ART.y + MENTION_ART.height / 2;
  /** An asset-space box's centre, in design units, relative to a shirt centred at 0. */
  const offset = (box: Box) => ({ dx: (box.x - artCx) * k, dy: (box.y - artCy) * k });

  const centreX = DESIGN_WIDTH / 2;
  // one shirt sits centred; two straddle the centre line
  const xs =
    mentions.length === 1
      ? [centreX]
      : mentions.map((_, i) => centreX + (i - (mentions.length - 1) / 2) * MENTION_GAP);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  ctx.direction = 'rtl';
  ctx.font = font(20 * scale, '700');
  ctx.lineWidth = 4 * scale;
  ctx.strokeStyle = style.stroke;
  ctx.strokeText(label, centreX * scale, MENTION_LABEL_Y * scale);
  ctx.fillStyle = style.fill;
  ctx.fillText(label, centreX * scale, MENTION_LABEL_Y * scale);

  const nameAt = offset(MENTION_NAME_BOX);
  const numberAt = offset(MENTION_NUMBER_BOX);
  const textScale = MENTION_TEXT_SCALE * scale;

  mentions.forEach((player, i) => {
    // Only the artwork is drawn, not the file — the asset's padding is not
    // symmetric, so sizing off the whole image would shift every shirt right.
    ctx.drawImage(
      shirt,
      MENTION_ART.x,
      MENTION_ART.y,
      MENTION_ART.width,
      MENTION_ART.height,
      (xs[i] - w / 2) * scale,
      (MENTION_ROW_Y - h / 2) * scale,
      w * scale,
      h * scale,
    );

    const cx = xs[i] * scale;

    ctx.direction = 'rtl';
    const { lines, size } = fitName(
      ctx,
      player.name,
      MENTION_NAME_BOX.width * k * scale,
      textScale,
    );
    ctx.font = font(size);
    const lineHeight = size * 1.15;
    const nameY = (MENTION_ROW_Y + nameAt.dy) * scale;
    const startY = nameY - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, li) => {
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = style.stroke;
      ctx.strokeText(line, cx + nameAt.dx * scale, startY + li * lineHeight);
      ctx.fillStyle = style.fill;
      ctx.fillText(line, cx + nameAt.dx * scale, startY + li * lineHeight);
    });

    ctx.direction = 'ltr';
    const text = player.number == null ? '?' : String(player.number);
    const numSize = fitNumberSize(
      ctx,
      text,
      MENTION_NUMBER_BOX.width * k * scale,
      MENTION_NUMBER_BOX.height * k * scale,
      textScale,
    );
    ctx.font = font(numSize, '900');
    ctx.lineWidth = numSize * 0.16;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, cx + numberAt.dx * scale, (MENTION_ROW_Y + numberAt.dy) * scale);
    ctx.fillStyle = style.fill;
    ctx.fillText(text, cx + numberAt.dx * scale, (MENTION_ROW_Y + numberAt.dy) * scale);
  });

  ctx.restore();
}

export async function renderShirtImage(
  color: ShirtTemplate,
  players: ShirtPlayer[],
  mentions?: { players: ShirtPlayer[]; label: string },
): Promise<HTMLCanvasElement> {
  const img = await loadImage(SHIRT_URL[color]);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const scale = canvas.width / DESIGN_WIDTH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const style = TEXT_STYLE[color];
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  players.slice(0, NAME_BOXES.length).forEach((player, i) => {
    const box = NAME_BOXES[i];
    const { lines, size } = fitName(ctx, player.name, box.width * scale, scale);
    ctx.font = font(size);
    // Centered both ways: fillText's own textAlign='center' handles the x
    // axis, and stacking the lines symmetrically around the box's own
    // center-y (rather than its top) handles the y axis, for one line or two.
    const lineHeight = size * 1.15;
    const startY = box.y * scale - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, li) => {
      const y = startY + li * lineHeight;
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = style.stroke;
      ctx.strokeText(line, box.x * scale, y);
      ctx.fillStyle = style.fill;
      ctx.fillText(line, box.x * scale, y);
    });
  });

  ctx.direction = 'ltr'; // pure digits, but keep it explicit rather than inheriting 'rtl'
  players.slice(0, NUMBER_BOXES.length).forEach((player, i) => {
    const box = NUMBER_BOXES[i];
    // Nobody's shirt is blank: a player with no number set gets a "?" in the
    // same box, so every shirt in the picture reads as a shirt rather than
    // looking half-finished.
    const text = player.number == null ? '?' : String(player.number);
    const size = fitNumberSize(ctx, text, box.width * scale, box.height * scale, scale);
    ctx.font = font(size, '900');
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, box.x * scale, box.y * scale);
    ctx.fillStyle = style.fill;
    ctx.fillText(text, box.x * scale, box.y * scale);
  });

  // A squad bigger than the 5 drawn shirts (extra guests, mostly) still
  // needs to show up somewhere rather than silently vanish off the picture.
  const overflow = players.slice(NAME_BOXES.length);
  if (overflow.length > 0) {
    ctx.direction = 'rtl';
    ctx.font = font(15 * scale, '700');
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 3 * scale;
    const line = `+${overflow.length}: ${overflow.map((p) => p.name).join(', ')}`;
    ctx.strokeText(line, canvas.width / 2, canvas.height - 40 * scale);
    ctx.fillText(line, canvas.width / 2, canvas.height - 40 * scale);
  }

  // Last, so the additive copy lands on bare background rather than over
  // anything drawn above. It cuts from `img`, the untouched template, so the
  // borrowed shirt never picks up a name written onto the canvas.
  if (mentions && mentions.players.length > 0) {
    // A failed load must not cost the card the team it is actually about, so
    // the mentions are skipped rather than allowed to reject.
    const shirt = await loadImage(mentionShirtUrl).catch(() => null);
    if (shirt) drawMentions(ctx, shirt, mentions.players, style, scale, mentions.label);
  }

  return canvas;
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

export interface ShareShirtsOptions {
  teams: Teams;
  byId: Map<string, Player>;
  gkIds: Set<string>;
  date?: string;
}

// Renders all three teams and hands them to the OS share sheet as one
// multi-file share — on a phone, picking "Save Image"/"Save to Photos" there
// drops all three into the gallery in one tap. Falls back to three staggered
// downloads where file sharing isn't available (desktop browsers).
export async function shareTeamsShirtImages(opts: ShareShirtsOptions): Promise<ShareImageResult> {
  try {
    const files: File[] = [];
    for (const c of TEAM_COLORS) {
      const ids = lineupOrder(opts.teams[c], opts.byId, opts.gkIds);
      const players = ids
        .map((id) => opts.byId.get(id))
        .filter((p): p is Player => !!p)
        .map((p) => ({ name: p.name, number: p.number }));
      if (players.length === 0) continue;
      const canvas = await renderShirtImage(c, players);
      const blob = await canvasBlob(canvas);
      if (!blob) continue;
      files.push(new File([blob], `armonim-${c}-${opts.date ?? 'lineup'}.png`, { type: 'image/png' }));
    }
    if (files.length === 0) return 'failed';

    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
        return 'shared';
      } catch (err) {
        // the user backing out of the share sheet is not a failure
        if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
        // anything else: fall through to the download path
      }
    }

    files.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      setTimeout(() => {
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }, i * 300);
    });
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
