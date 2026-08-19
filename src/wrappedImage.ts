// Renders a month's WrappedStats as a shareable "story" card — a Spotify-
// Wrapped-style poster, not a plain list: one big headline number, then a
// grid of colored stat tiles so it actually looks like something worth
// sending to the group chat instead of a settings screen. Canvas rather than
// a chart library, same reason as shareImage.ts/shirtImage.ts: this app
// ships React + Tailwind and nothing else.
//
// The bottom half is banter — fewest wins, longest winless run, worst duo —
// same "it's a count, not a verdict" rule as the rest of the app (the copy
// says "fewest wins", never "worst player"), but a recap that's all good
// news reads as a highlight reel, not a record of the month.

import type { WrappedStats } from './wrapped';
import type { ShareImageResult } from './shareImage';

const W = 720;
const PAD = 44;

// Layout constants shared between the height calculation and the drawing
// pass below, so the canvas is always sized to exactly what gets drawn —
// no dead space on a quiet month with only a couple of stats, no clipping
// on a full one.
const HEADER_H = 172;
const HERO_H = 200;
const TILE_H = 178;
const DUO_H = 168;
const SECTION_LABEL_H = 46;
const GAP = 18;
const FOOTER_H = 36;

const font = (size: number, weight = '700') =>
  `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A soft radial glow rather than a hard-edged shape — gives the poster
// background depth without needing canvas `filter: blur()`, whose support on
// older mobile Safari is shakier than a plain gradient.
function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function fillGradientRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  colors: [string, string],
) {
  const grad = ctx.createLinearGradient(x, y, x + w * 0.25, y + h);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

// Pairs share a row; a leftover odd tile gets its own full-width row.
const tileRows = (n: number) => Math.floor(n / 2) + (n % 2);

interface Tile {
  emoji: string;
  value: string;
  label: string;
  colors: [string, string];
}

function buildPositiveTiles(stats: WrappedStats): Tile[] {
  const tiles: Tile[] = [];
  if (stats.topScorer) {
    tiles.push({
      emoji: '⭐',
      value: stats.topScorer.name,
      label: `top scorer — ${stats.topScorer.wins} wins`,
      colors: ['#fde68a', '#d97706'],
    });
  }
  if (stats.mostNights) {
    tiles.push({
      emoji: '🦾',
      value: stats.mostNights.name,
      label: `never missed — ${stats.mostNights.nights} nights`,
      colors: ['#7dd3fc', '#1d4ed8'],
    });
  }
  if (stats.longestStreak) {
    tiles.push({
      emoji: '📈',
      value: stats.longestStreak.name,
      label: `longest run — ${stats.longestStreak.nights} straight wins`,
      colors: ['#86efac', '#15803d'],
    });
  }
  return tiles;
}

function buildNegativeTiles(stats: WrappedStats): Tile[] {
  const tiles: Tile[] = [];
  if (stats.bottomScorer) {
    tiles.push({
      emoji: '🥶',
      value: stats.bottomScorer.name,
      label: `fewest wins — ${stats.bottomScorer.wins} in ${stats.bottomScorer.nights} nights`,
      colors: ['#cbd5e1', '#475569'],
    });
  }
  if (stats.longestWinless) {
    tiles.push({
      emoji: '📉',
      value: stats.longestWinless.name,
      label: `${stats.longestWinless.nights} nights without a win`,
      colors: ['#fca5a5', '#991b1b'],
    });
  }
  return tiles;
}

// Draws a 2-column tile grid starting at `y`, returns the height it used.
function drawTileGrid(
  ctx: CanvasRenderingContext2D,
  tiles: Tile[],
  y: number,
  cardW: number,
): number {
  const halfW = (cardW - GAP) / 2;

  tiles.forEach((tile, i) => {
    const isLastOdd = i === tiles.length - 1 && tiles.length % 2 === 1;
    const w = isLastOdd ? cardW : halfW;
    const col = isLastOdd ? 0 : i % 2;
    const row = Math.floor(i / 2);
    const x = PAD + col * (halfW + GAP);
    const rowY = y + row * (TILE_H + GAP);

    fillGradientRoundRect(ctx, x, rowY, w, TILE_H, 22, tile.colors);

    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(34, '700');
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillText(tile.emoji, x + 20, rowY + 44);

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#1c1310';
    const maxTextW = w - 40;
    let name = tile.value;
    ctx.font = font(30, '900');
    while (ctx.measureText(name).width > maxTextW && name.length > 1) {
      name = name.slice(0, -1);
    }
    if (name !== tile.value) name = name.trimEnd() + '…';
    ctx.fillText(name, x + w - 20, rowY + 100);

    ctx.font = font(15, '700');
    ctx.fillStyle = 'rgba(28,19,16,0.65)';
    // the label is plain English, so it stays LTR even inside an RTL card
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    const words = tile.label.split(' ');
    let line = '';
    const lines: string[] = [];
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - 40 && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((l, li) => {
      ctx.fillText(l, x + 20, rowY + 130 + li * 20);
    });
  });

  return tileRows(tiles.length) * (TILE_H + GAP);
}

function drawDuoCard(
  ctx: CanvasRenderingContext2D,
  duo: { aName: string; bName: string; won: number; together: number },
  label: string,
  colors: [string, string],
  y: number,
  cardW: number,
) {
  fillGradientRoundRect(ctx, PAD, y, cardW, DUO_H, 24, colors);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(30, '700');
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillText(label, PAD + 24, y + 42);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(32, '900');
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(`${duo.aName} & ${duo.bName}`, PAD + cardW - 24, y + 92);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(18, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.fillText(`won ${duo.won} of their ${duo.together} nights together`, PAD + 24, y + 128);
}

export function renderWrappedImage(stats: WrappedStats): HTMLCanvasElement {
  const posTiles = buildPositiveTiles(stats);
  const negTiles = buildNegativeTiles(stats);
  const hasNegSection = negTiles.length > 0 || !!stats.worstDuo;

  const posTilesH = posTiles.length > 0 ? tileRows(posTiles.length) * (TILE_H + GAP) : 0;
  const posDuoH = stats.bestDuo ? DUO_H + GAP : 0;
  const negLabelH = hasNegSection ? SECTION_LABEL_H : 0;
  const negTilesH = negTiles.length > 0 ? tileRows(negTiles.length) * (TILE_H + GAP) : 0;
  const negDuoH = stats.worstDuo ? DUO_H + GAP : 0;

  const H =
    PAD +
    HEADER_H +
    HERO_H +
    GAP +
    posTilesH +
    posDuoH +
    negLabelH +
    negTilesH +
    negDuoH +
    FOOTER_H +
    PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // page background: a dark base with a few soft color glows behind
  // everything, so the poster has depth instead of a flat fill
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2a1608');
  bg.addColorStop(1, '#150d0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  glow(ctx, W * 0.85, H * 0.05, 320, 'rgba(234,88,12,0.35)');
  glow(ctx, W * 0.1, H * 0.28, 260, 'rgba(29,78,216,0.22)');
  glow(ctx, W * 0.9, H * 0.55, 300, 'rgba(21,128,61,0.18)');
  glow(ctx, W * 0.12, H * 0.78, 280, 'rgba(124,58,237,0.16)');
  glow(ctx, W * 0.88, H * 0.95, 260, 'rgba(220,38,38,0.14)');

  // brand row
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(253,250,243,0.85)';
  ctx.font = font(26, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 26);

  // month title — the headline of the whole poster
  ctx.font = font(56, '900');
  const titleGrad = ctx.createLinearGradient(PAD, 0, PAD + 500, 0);
  titleGrad.addColorStop(0, '#fed7aa');
  titleGrad.addColorStop(1, '#f59e0b');
  ctx.fillStyle = titleGrad;
  ctx.fillText(stats.label, PAD, PAD + 100);

  ctx.font = font(20, '700');
  ctx.fillStyle = 'rgba(253,250,243,0.5)';
  ctx.fillText('R E C A P', PAD, PAD + 132);

  let y = PAD + HEADER_H;
  const cardW = W - PAD * 2;

  // hero: one big number, the headline stat, in its own bold gradient card
  fillGradientRoundRect(ctx, PAD, y, cardW, HERO_H, 28, ['#fb923c', '#c2410c']);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(96, '900');
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(String(stats.nightsRecorded), PAD + 32, y + 108);
  ctx.font = font(26, '800');
  ctx.fillStyle = 'rgba(255,250,240,0.92)';
  ctx.fillText('nights played this month', PAD + 32, y + 148);
  ctx.font = font(20, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.75)';
  ctx.fillText(`⚽ ${stats.totalWins} wins banked by the squad`, PAD + 32, y + 178);
  y += HERO_H + GAP;

  y += drawTileGrid(ctx, posTiles, y, cardW);

  if (stats.bestDuo) {
    drawDuoCard(ctx, stats.bestDuo, '🤝 Best pair', ['#f0abfc', '#7c3aed'], y, cardW);
    y += DUO_H + GAP;
  }

  if (hasNegSection) {
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(22, '800');
    ctx.fillStyle = 'rgba(253,250,243,0.55)';
    ctx.fillText('😬 ALSO HAPPENED', PAD, y + 26);
    y += SECTION_LABEL_H;

    y += drawTileGrid(ctx, negTiles, y, cardW);

    if (stats.worstDuo) {
      drawDuoCard(ctx, stats.worstDuo, '🙃 Worst pair', ['#fca5a5', '#7f1d1d'], y, cardW);
      y += DUO_H + GAP;
    }
  }

  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = font(15, '600');
  ctx.fillStyle = 'rgba(253,250,243,0.4)';
  ctx.fillText('Every number here is a count, not a verdict.', W / 2, y + 16);

  return canvas;
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

export async function shareWrappedImage(stats: WrappedStats): Promise<ShareImageResult> {
  try {
    const canvas = renderWrappedImage(stats);
    const blob = await canvasBlob(canvas);
    if (!blob) return 'failed';

    const file = new File([blob], `armonim-wrapped-${stats.period}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
