// Renders a month's WrappedStats as one or two shareable "story" cards — a
// Spotify-Wrapped-style poster, not a plain list: one big headline number,
// then a grid of colored stat tiles so it actually looks like something
// worth sending to the group chat instead of a settings screen. Canvas
// rather than a chart library, same reason as shareImage.ts/shirtImage.ts:
// this app ships React + Tailwind and nothing else.
//
// Split into two images rather than one long scroll: a "highlights" card
// (hero, MVP/match/fixture leaderboards, attendance, streak, best pair) and,
// only when there's anything to say, an "also happened" card — the banter
// side (fewest wins, longest winless run, worst duo). Same "it's a count,
// not a verdict" rule as the rest of the app applies to that second card
// (the copy says "fewest wins", never "worst player"), but a recap that's
// all good news reads as a highlight reel, not a record of the month. Both
// go out together as a single multi-file share, the same pattern
// shirtImage.ts already uses for the three team shirts.

import type { WrappedStats, Bully, NightOfMonth } from './wrapped';
import type { ShareImageResult } from './shareImage';
import type { Milestone } from './milestones';
import type { Flavour } from './nightStory';
import { renderShirtImage } from './shirtImage';

const W = 720;
const PAD = 44;

// Layout constants shared between the height calculation and the drawing
// pass below, so each canvas is always sized to exactly what gets drawn —
// no dead space on a quiet month with only a couple of stats, no clipping
// on a full one.
const HEADER_H = 172;
const PAGE2_HEADER_H = 108;
const HERO_H = 200;
const TILE_H = 188;
const DUO_H = 168;
const BULLY_H = 168;
const NIGHT_CARD_H = 168;
const LEADERBOARD_ROW_H = 52;
const LEADERBOARD_TITLE_H = 58;
const ACHIEVEMENT_ROW_H = 48;
const ACHIEVEMENT_TITLE_H = 58;
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

// Dark base + a few soft color glows, shared by both pages so the two
// images read as one set rather than two differently-styled cards.
function drawPageBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1608');
  bg.addColorStop(1, '#150d0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  glow(ctx, w * 0.85, h * 0.05, 320, 'rgba(234,88,12,0.35)');
  glow(ctx, w * 0.1, h * 0.28, 260, 'rgba(29,78,216,0.22)');
  glow(ctx, w * 0.9, h * 0.55, 300, 'rgba(21,128,61,0.18)');
  glow(ctx, w * 0.12, h * 0.78, 280, 'rgba(124,58,237,0.16)');
  glow(ctx, w * 0.88, h * 0.95, 260, 'rgba(220,38,38,0.14)');
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

// Several of the banter counts land on 1 far more often than the older,
// gated stats ever did (a reservist by definition shows up 1-2 times; a
// single shootout is the whole of Drama Queen's floor) — "1 nights" reads as
// a typo, so anywhere that can plausibly land there gets this instead. Takes
// the plural form explicitly rather than guessing it (an "-es" word like
// "match" would otherwise come out "matchs").
const plural = (n: number, singular: string, pluralForm = `${singular}s`) =>
  `${n} ${n === 1 ? singular : pluralForm}`;

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

// One tile per banter stat that fits the "name, one-line label" shape —
// the two that don't (a rivalry between two names, and a whole night's own
// headline) get their own card functions below instead of being forced into
// this grid.
function buildBanterTiles(stats: WrappedStats): Tile[] {
  const tiles: Tile[] = [];
  if (stats.teachersPet) {
    tiles.push({
      emoji: '👑',
      value: stats.teachersPet.name,
      label: `Teacher's Pet — avg ${stats.teachersPet.avg.toFixed(1)}/10 over ${stats.teachersPet.nights} nights`,
      colors: ['#fde68a', '#b45309'],
    });
  }
  if (stats.punchingBag) {
    tiles.push({
      emoji: '🥊',
      value: stats.punchingBag.name,
      label: `Punching Bag — avg ${stats.punchingBag.avg.toFixed(1)}/10 over ${stats.punchingBag.nights} nights`,
      colors: ['#fca5a5', '#7f1d1d'],
    });
  }
  if (stats.rollercoaster) {
    tiles.push({
      emoji: '🎢',
      value: stats.rollercoaster.name,
      label: `The Rollercoaster — swung ${stats.rollercoaster.low.toFixed(1)} to ${stats.rollercoaster.high.toFixed(1)}`,
      colors: ['#c4b5fd', '#5b21b6'],
    });
  }
  if (stats.benchwarmer) {
    tiles.push({
      emoji: '🪑',
      value: stats.benchwarmer.name,
      label: `The Benchwarmer — sat out ${plural(stats.benchwarmer.matchesBenched, 'match', 'matches')}`,
      colors: ['#cbd5e1', '#475569'],
    });
  }
  if (stats.outOfGas) {
    tiles.push({
      emoji: '🔋',
      value: stats.outOfGas.name,
      label: `Out of Gas — ${Math.round(stats.outOfGas.earlyRate * 100)}% early → ${Math.round(stats.outOfGas.lateRate * 100)}% late`,
      colors: ['#fdba74', '#c2410c'],
    });
  }
  if (stats.dramaQueen) {
    tiles.push({
      emoji: '🎭',
      value: stats.dramaQueen.name,
      label: `Drama Queen — ${plural(stats.dramaQueen.shootouts, 'penalty shootout')}`,
      colors: ['#f9a8d4', '#be185d'],
    });
  }
  if (stats.reservist) {
    tiles.push({
      emoji: '🎖️',
      value: stats.reservist.name,
      label: `The Reservist — ${plural(stats.reservist.wins, 'win')} in just ${plural(stats.reservist.nights, 'night')}`,
      colors: ['#5eead4', '#0f766e'],
    });
  }
  if (stats.cursedShirt) {
    const colorName = stats.cursedShirt.color[0].toUpperCase() + stats.cursedShirt.color.slice(1);
    tiles.push({
      emoji: '👕',
      value: colorName,
      label: `Cursed Shirt — won ${stats.cursedShirt.nightsWon} of ${stats.cursedShirt.nightsPlayed} nights`,
      colors: ['#94a3b8', '#1e293b'],
    });
  }
  if (stats.longestRun) {
    const colorName = stats.longestRun.color[0].toUpperCase() + stats.longestRun.color.slice(1);
    tiles.push({
      emoji: '🔥',
      value: colorName,
      label: `Biggest Run — ${plural(stats.longestRun.length, 'match', 'matches')} on the spin, ${stats.longestRun.date}`,
      colors: ['#fca5a5', '#b91c1c'],
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
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
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
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
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
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
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

// A two-name rivalry rather than a single stat — its own card, styled after
// drawDuoCard but reading as a scoreline rather than a partnership.
function drawBullyCard(ctx: CanvasRenderingContext2D, bully: Bully, y: number, cardW: number): number {
  fillGradientRoundRect(ctx, PAD, y, cardW, BULLY_H, 24, ['#fdba74', '#9a3412']);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(30, '700');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText('😤 The Bully', PAD + 24, y + 42);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(30, '900');
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(
    `${bully.aName}  ${bully.aWon}–${bully.bWon}  ${bully.bName}`,
    PAD + cardW - 24,
    y + 92,
  );

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(20, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.9)';
  ctx.fillText(`head-to-head this month, ${bully.faced} matches faced`, PAD + 24, y + 128);

  return BULLY_H;
}

const FLAVOUR_EMOJI: Record<Flavour, string> = {
  dictatorship: '👑',
  chaos: '🌀',
  'tug-of-war': '🪢',
  ordinary: '⚽',
};

// nightStory's own headline and lead-change count, lifted from the single
// most dramatic fixture of the month rather than recomputed here.
function drawNightOfMonthCard(
  ctx: CanvasRenderingContext2D,
  night: NightOfMonth,
  y: number,
  cardW: number,
): number {
  fillGradientRoundRect(ctx, PAD, y, cardW, NIGHT_CARD_H, 24, ['#93c5fd', '#1e3a8a']);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(24, '800');
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(`${FLAVOUR_EMOJI[night.flavour]} Night of the month`, PAD + 24, y + 38);

  ctx.font = font(16, '700');
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(night.date, PAD + 24, y + 60);

  ctx.font = font(28, '900');
  ctx.fillStyle = '#fffaf0';
  const headline = fitName(ctx, night.headline, cardW - 48);
  ctx.fillText(headline, PAD + 24, y + 100);

  ctx.font = font(18, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.fillText(
    `${plural(night.leadChanges, 'lead change')} across ${plural(night.matches, 'match', 'matches')}`,
    PAD + 24,
    y + 132,
  );

  return NIGHT_CARD_H;
}

function milestoneRow(m: Milestone): { emoji: string; desc: string; name?: string } {
  switch (m.kind) {
    case 'debut-group':
      return { emoji: '✨', desc: `${m.count} first nights` };
    case 'debut':
      return { emoji: '✨', desc: 'First night', name: m.name };
    case 'nth-night':
      return { emoji: '🎉', desc: `${m.nights}th night`, name: m.name };
    case 'nth-win':
      return { emoji: '🏆', desc: `${m.wins}th win`, name: m.name };
    case 'iron-man':
      return { emoji: '🦾', desc: `${m.nights} nights running`, name: m.name };
    case 'win-streak':
      return { emoji: '📈', desc: `${m.nights} wins running`, name: m.name };
    case 'winless':
      return { emoji: '💤', desc: `${m.nights} nights winless`, name: m.name };
  }
}

function achievementsHeight(count: number): number {
  return ACHIEVEMENT_TITLE_H + count * ACHIEVEMENT_ROW_H;
}

// A full list, not a top-3 — a month digest says everything that happened
// rather than throttling to what one night's own panel would show (the same
// distinction `monthlyAchievements` itself draws in wrapped.ts).
function drawAchievementsCard(
  ctx: CanvasRenderingContext2D,
  milestones: Milestone[],
  y: number,
  cardW: number,
): number {
  const rows = milestones.map(milestoneRow);
  const h = achievementsHeight(rows.length);
  fillGradientRoundRect(ctx, PAD, y, cardW, h, 24, ['#fde68a', '#b45309']);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(26, '800');
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText('🏅 Monthly achievements', PAD + 24, y + 38);

  rows.forEach((row, i) => {
    const rowY = y + ACHIEVEMENT_TITLE_H + i * ACHIEVEMENT_ROW_H + 30;

    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(20, '800');
    ctx.fillStyle = 'rgba(28,19,16,0.75)';
    const maxDescW = row.name ? cardW * 0.5 - 24 : cardW - 48;
    const desc = fitName(ctx, `${row.emoji}  ${row.desc}`, maxDescW);
    ctx.fillText(desc, PAD + 24, rowY);

    if (row.name) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.font = font(22, '900');
      ctx.fillStyle = '#1c1310';
      const name = fitName(ctx, row.name, cardW * 0.45 - 24);
      ctx.fillText(name, PAD + cardW - 24, rowY);
    }
  });

  return h;
}

function drawFooter(ctx: CanvasRenderingContext2D, y: number) {
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = font(16, '600');
  ctx.fillStyle = 'rgba(253,250,243,0.45)';
  ctx.fillText('Every number here is a count, not a verdict.', W / 2, y + 16);
}

function buildMvpBoard(stats: WrappedStats): Leaderboard | null {
  return stats.topMvps.length > 0
    ? {
        title: '🌟 Most MVP picks',
        colors: ['#fbcfe8', '#be185d'],
        entries: stats.topMvps.map((m) => ({
          name: m.name,
          stat: `${m.count} MVP${m.count === 1 ? '' : 's'}`,
        })),
      }
    : null;
}

// Page 1: the highlights — hero, MVP/match/fixture leaderboards, attendance,
// longest streak, best pair.
function renderHighlightsImage(stats: WrappedStats): HTMLCanvasElement {
  const mvpBoard = buildMvpBoard(stats);
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

  const mvpBoardH = mvpBoard ? leaderboardHeight(mvpBoard) + GAP : 0;
  const matchBoardH = matchBoard ? leaderboardHeight(matchBoard) + GAP : 0;
  const fixtureBoardH = fixtureBoard ? leaderboardHeight(fixtureBoard) + GAP : 0;
  const posTilesH = posTiles.length > 0 ? tileRows(posTiles.length) * (TILE_H + GAP) : 0;
  const posDuoH = stats.bestDuo ? DUO_H + GAP : 0;

  const H =
    PAD +
    HEADER_H +
    HERO_H +
    GAP +
    mvpBoardH +
    matchBoardH +
    fixtureBoardH +
    attendanceH +
    posTilesH +
    posDuoH +
    FOOTER_H +
    PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawPageBackground(ctx, W, H);

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

  if (mvpBoard) {
    y += drawLeaderboard(ctx, mvpBoard, y, cardW) + GAP;
  }
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

  drawFooter(ctx, y);

  return canvas;
}

// Page 2: the banter — only rendered when there's actually something to
// say (see hasAlsoHappened below). Its own lighter header rather than a
// repeat of the full brand/hero treatment, since it's the second half of
// one set, not a standalone poster.
function renderAlsoHappenedImage(stats: WrappedStats): HTMLCanvasElement {
  const negTiles = buildNegativeTiles(stats);
  const cardW = W - PAD * 2;

  const negTilesH = negTiles.length > 0 ? tileRows(negTiles.length) * (TILE_H + GAP) : 0;
  const negDuoH = stats.worstDuo ? DUO_H + GAP : 0;

  const H = PAD + PAGE2_HEADER_H + negTilesH + negDuoH + FOOTER_H + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawPageBackground(ctx, W, H);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(253,250,243,0.85)';
  ctx.font = font(26, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 26);

  ctx.font = font(38, '900');
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(`${stats.label} — also happened 😬`, PAD, PAD + 74);

  let y = PAD + PAGE2_HEADER_H;

  y += drawTileGrid(ctx, negTiles, y, cardW);

  if (stats.worstDuo) {
    drawDuoCard(ctx, stats.worstDuo, '🙃 Worst pair', ['#fca5a5', '#7f1d1d'], y, cardW);
    y += DUO_H + GAP;
  }

  drawFooter(ctx, y);

  return canvas;
}

const hasAlsoHappened = (stats: WrappedStats): boolean =>
  buildNegativeTiles(stats).length > 0 || !!stats.worstDuo;

// Page 3: the roast — grades, arcs, matchups. Same "only when there's
// something to say" rule as page 2, checked by hasBanter below. A separate
// page from "also happened" rather than folded into it: that page's tiles
// are all `MIN_NIGHTS_FOR_ROAST`-gated career-shaped counts that exist every
// month once there's any history at all, where this page's stats are the new
// ones layered on top of grades/logs/arcs/derbies and can easily say nothing
// for months at a time (a young grades feature, a quiet Out of Gas month) —
// keeping them apart means one page going quiet doesn't take the other with it.
function renderBanterImage(stats: WrappedStats): HTMLCanvasElement {
  const tiles = buildBanterTiles(stats);
  const cardW = W - PAD * 2;

  const tilesH = tiles.length > 0 ? tileRows(tiles.length) * (TILE_H + GAP) : 0;
  const bullyH = stats.bully ? BULLY_H + GAP : 0;
  const nightH = stats.nightOfMonth ? NIGHT_CARD_H + GAP : 0;

  const H = PAD + PAGE2_HEADER_H + tilesH + bullyH + nightH + FOOTER_H + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawPageBackground(ctx, W, H);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(253,250,243,0.85)';
  ctx.font = font(26, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 26);

  ctx.font = font(38, '900');
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(`${stats.label} — the banter 🎭`, PAD, PAD + 74);

  let y = PAD + PAGE2_HEADER_H;

  y += drawTileGrid(ctx, tiles, y, cardW);

  if (stats.bully) {
    y += drawBullyCard(ctx, stats.bully, y, cardW) + GAP;
  }
  if (stats.nightOfMonth) {
    y += drawNightOfMonthCard(ctx, stats.nightOfMonth, y, cardW) + GAP;
  }

  drawFooter(ctx, y);

  return canvas;
}

const hasBanter = (stats: WrappedStats): boolean =>
  buildBanterTiles(stats).length > 0 || !!stats.bully || !!stats.nightOfMonth;

// Page 4: every milestone crossed this month, only when there was at least
// one — unlike the tile pages, there's no fixed shape to check against, just
// whether the list is empty.
function renderAchievementsImage(stats: WrappedStats): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const cardH = achievementsHeight(stats.monthlyAchievements.length);

  const H = PAD + PAGE2_HEADER_H + cardH + GAP + FOOTER_H + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  drawPageBackground(ctx, W, H);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(253,250,243,0.85)';
  ctx.font = font(26, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 26);

  ctx.font = font(38, '900');
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(`${stats.label} — achievements 🏅`, PAD, PAD + 74);

  let y = PAD + PAGE2_HEADER_H;
  y += drawAchievementsCard(ctx, stats.monthlyAchievements, y, cardW) + GAP;

  drawFooter(ctx, y);

  return canvas;
}

const hasAchievements = (stats: WrappedStats): boolean => stats.monthlyAchievements.length > 0;

// The public entry point: the highlights card, plus whichever of the banter
// pages have anything to say this month.
export function renderWrappedImages(stats: WrappedStats): HTMLCanvasElement[] {
  const images = [renderHighlightsImage(stats)];
  if (hasAlsoHappened(stats)) images.push(renderAlsoHappenedImage(stats));
  if (hasBanter(stats)) images.push(renderBanterImage(stats));
  if (hasAchievements(stats)) images.push(renderAchievementsImage(stats));
  return images;
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

// Shares every page in one go — on a phone, picking "Save Image"/"Save to
// Photos" from the share sheet drops all of them into the gallery at once,
// same pattern as shirtImage.ts's three team shirts.
/**
 * The Team of the Month card: the month's five, drawn onto the gold shirt
 * template (§2.21).
 *
 * Reuses `renderShirtImage` rather than drawing its own pentagon — the boxes
 * are hand-measured against that artwork and the gold template shares it
 * exactly, so a second implementation would only be a second thing to keep in
 * step. Shirt numbers come from the live roster, since history stores a name
 * and a rating but never a number.
 */
export async function renderTeamOfMonth(
  stats: WrappedStats,
  numberOf?: Map<string, number | undefined>,
): Promise<HTMLCanvasElement | null> {
  if (stats.teamOfMonth.length === 0) return null;
  return renderShirtImage(
    'gold',
    stats.teamOfMonth.map((p) => ({ name: p.name, number: numberOf?.get(p.id) })),
  );
}

export async function shareWrappedImage(
  stats: WrappedStats,
  numberOf?: Map<string, number | undefined>,
): Promise<ShareImageResult> {
  try {
    const canvases = renderWrappedImages(stats);
    // last, so the recap reads as pages of numbers and then the thing people
    // actually want to send on
    const totm = await renderTeamOfMonth(stats, numberOf);
    if (totm) canvases.push(totm);
    const files: File[] = [];
    for (let i = 0; i < canvases.length; i++) {
      const blob = await canvasBlob(canvases[i]);
      if (!blob) continue;
      const suffix = canvases.length > 1 ? `-${i + 1}` : '';
      files.push(
        new File([blob], `armonim-wrapped-${stats.period}${suffix}.png`, { type: 'image/png' }),
      );
    }
    if (files.length === 0) return 'failed';

    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
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
