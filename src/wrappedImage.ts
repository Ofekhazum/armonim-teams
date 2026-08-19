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
const TILE_H = 188;
const DUO_H = 168;
const LEADERBOARD_ROW_H = 52;
const LEADERBOARD_TITLE_H = 58;
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

interface Leaderboard {
  title: string;
  entries: { name: string; stat: string }[];
  colors: [string, string];
}

const MEDALS = ['🥇', '🥈', '🥉'];

function leaderboardHeight(board: Leaderboard): number {
  return LEADERBOARD_TITLE_H + board.entries.length * LEADERBOARD_ROW_H;
}

// Shrinks a name until it fits, same approach as the tile grid's name-fit
// below — factored out since both a leaderboard row and a tile need it.
function fitName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number): string {
  let out = name;
  while (ctx.measureText(out).width > maxWidth && out.length > 1) {
    out = out.slice(0, -1);
  }
  return out === name ? out : out.trimEnd() + '…';
}

// A full-width "top 3" card — one line per rank, medal + stat on the left,
// name on the right. Used for the two leaderboards the recap leads with
// (most individual match wins, most fixtures/nights outright won) — kept as
// ranked lists rather than single-name tiles since the whole point is
// showing 2nd and 3rd place too, not just who's first.
function drawLeaderboard(
  ctx: CanvasRenderingContext2D,
  board: Leaderboard,
  y: number,
  cardW: number,
): number {
  const h = leaderboardHeight(board);
  fillGradientRoundRect(ctx, PAD, y, cardW, h, 24, board.colors);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(26, '800');
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillText(board.title, PAD + 24, y + 38);

  board.entries.forEach((entry, i) => {
    const rowY = y + LEADERBOARD_TITLE_H + i * LEADERBOARD_ROW_H + 32;

    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(22, '800');
    ctx.fillStyle = 'rgba(28,19,16,0.75)';
    ctx.fillText(`${MEDALS[i] ?? `${i + 1}.`}  ${entry.stat}`, PAD + 24, rowY);

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = font(24, '900');
    ctx.fillStyle = '#1c1310';
    const name = fitName(ctx, entry.name, cardW * 0.5 - 24);
    ctx.fillText(name, PAD + cardW - 24, rowY);
  });

  return h;
}

interface AttendanceCard {
  title: string;
  subtitle: string;
  names: string[];
  colors: [string, string];
}

const ATTENDANCE_NAME_SIZE = 21;
const ATTENDANCE_TITLE_H = 100;
const ATTENDANCE_LINE_H = 32;
const ATTENDANCE_BOTTOM_PAD = 24;

// Groups names into lines that fit within maxWidth, each line kept as a
// plain array (joined with ', ' only at draw time — see drawAttendanceCard
// for why it's never joined with a *trailing* comma). Unlike the tile label
// wrapper this never truncates: the whole point of this card is showing
// everyone who qualifies, not a sample.
function wrapNames(ctx: CanvasRenderingContext2D, names: string[], maxWidth: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  names.forEach((name) => {
    const test = [...line, name].join(', ');
    if (line.length > 0 && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = [name];
    } else {
      line.push(name);
    }
  });
  if (line.length > 0) lines.push(line);
  return lines;
}

// A full-width card listing every player who cleared a bar, not just the
// top one — currently only used for perfect attendance (§2.9's rewrite: the
// old single-name "never missed" tile was wrong whenever the best month
// still fell short of a clean sweep). Height depends on how many names wrap
// to how many lines, so the caller measures with `wrapNames` first and
// passes the already-wrapped lines in.
//
// Each line renders as one joined "name, name, name" string, direction=rtl,
// textAlign=right — checked against native `dir="rtl"` DOM rendering as
// ground truth, for pure-Hebrew, pure-Latin, and mixed lists alike, and it
// matches. The one thing that *doesn't* work is a trailing comma with
// nothing after it: at the true end of an RTL-direction string, a bare
// trailing comma has no adjacent strong character to attach to, so it
// resolves to the paragraph's own direction and visually jumps to the
// front instead of staying after the last name. `Array.join(', ')` already
// never produces one (it only inserts commas *between* items), which is
// exactly why this is correct and the multi-call version tried earlier
// wasn't.
function drawAttendanceCard(
  ctx: CanvasRenderingContext2D,
  card: AttendanceCard,
  lines: string[][],
  y: number,
  cardW: number,
): number {
  const h = ATTENDANCE_TITLE_H + lines.length * ATTENDANCE_LINE_H + ATTENDANCE_BOTTOM_PAD;
  fillGradientRoundRect(ctx, PAD, y, cardW, h, 24, card.colors);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(26, '800');
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillText(card.title, PAD + 24, y + 38);

  ctx.font = font(17, '700');
  ctx.fillStyle = 'rgba(28,19,16,0.6)';
  ctx.fillText(card.subtitle, PAD + 24, y + 64);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(ATTENDANCE_NAME_SIZE, '800');
  ctx.fillStyle = '#1c1310';
  lines.forEach((names, i) => {
    const lineY = y + ATTENDANCE_TITLE_H + i * ATTENDANCE_LINE_H;
    ctx.fillText(names.join(', '), PAD + cardW - 24, lineY);
  });
  return h;
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

    ctx.font = font(18, '700');
    ctx.fillStyle = 'rgba(28,19,16,0.7)';
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
      ctx.fillText(l, x + 20, rowY + 132 + li * 24);
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
  ctx.font = font(20, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.9)';
  ctx.fillText(`won ${duo.won} of their ${duo.together} nights together`, PAD + 24, y + 128);
}

export function renderWrappedImage(stats: WrappedStats): HTMLCanvasElement {
  const matchBoard: Leaderboard | null =
    stats.topMatchWinners.length > 0
      ? {
          title: '🏅 Most matches won',
          colors: ['#fde68a', '#d97706'],
          entries: stats.topMatchWinners.map((w) => ({ name: w.name, stat: `${w.wins} wins` })),
        }
      : null;
  const fixtureBoard: Leaderboard | null =
    stats.topFixtureWinners.length > 0
      ? {
          title: '🏆 Most fixtures won',
          colors: ['#5eead4', '#0f766e'],
          entries: stats.topFixtureWinners.map((w) => ({
            name: w.name,
            stat: `${w.nights} fixtures`,
          })),
        }
      : null;

  const posTiles = buildPositiveTiles(stats);
  const negTiles = buildNegativeTiles(stats);
  const hasNegSection = negTiles.length > 0 || !!stats.worstDuo;
  const cardW = W - PAD * 2;

  const attendance: AttendanceCard | null = stats.perfectAttendance
    ? {
        title: '🦾 Never missed a night',
        subtitle: `${stats.perfectAttendance.nights} for ${stats.perfectAttendance.nights} this month`,
        names: stats.perfectAttendance.names,
        colors: ['#7dd3fc', '#1d4ed8'],
      }
    : null;
  // Attendance card height depends on how many names wrap to how many
  // lines, so it has to be measured before the real canvas (and its H)
  // exist — a throwaway context has the same font metrics.
  let attendanceLines: string[][] = [];
  if (attendance) {
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font(ATTENDANCE_NAME_SIZE, '800');
    attendanceLines = wrapNames(measure, attendance.names, cardW - 48);
  }
  const attendanceH = attendance
    ? ATTENDANCE_TITLE_H + attendanceLines.length * ATTENDANCE_LINE_H + ATTENDANCE_BOTTOM_PAD + GAP
    : 0;

  const matchBoardH = matchBoard ? leaderboardHeight(matchBoard) + GAP : 0;
  const fixtureBoardH = fixtureBoard ? leaderboardHeight(fixtureBoard) + GAP : 0;
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
    matchBoardH +
    fixtureBoardH +
    attendanceH +
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

  if (matchBoard) {
    y += drawLeaderboard(ctx, matchBoard, y, cardW) + GAP;
  }
  if (fixtureBoard) {
    y += drawLeaderboard(ctx, fixtureBoard, y, cardW) + GAP;
  }
  if (attendance) {
    y += drawAttendanceCard(ctx, attendance, attendanceLines, y, cardW) + GAP;
  }

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
  ctx.font = font(16, '600');
  ctx.fillStyle = 'rgba(253,250,243,0.45)';
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
