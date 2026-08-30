// Renders a month's WrappedStats as a set of shareable "story" posters —
// broadcast graphics rather than a settings screen: heavy outlined numbers,
// section bars, diagonal stripe texture, and a layout that varies with how
// important a stat is. Canvas rather than a chart library, same reason as
// shareImage.ts and shirtImage.ts: this app ships React + Tailwind and nothing
// else, and the output has to end up a PNG in a share sheet either way.
//
// The primitives live in `canvasKit.ts`; this file is composition only — what
// goes on which page, in what order, at what size.
//
// **Six pages, and every one after the first is conditional**, so the month's
// own data decides how many get drawn:
//
//   1. Highlights — the hero count, the leaderboards, perfect attendance.
//   2. The night of the month — its own page, because it is the one thing in
//      the recap about an *evening* rather than about a person. The three
//      squads are redrawn exactly as the fixture page shows them (same
//      colours, same name chips), over a scoreboard of how the night went.
//   3. Winning teams — the shirts that took a night outright, best night
//      first, drawn as the night page draws a winning team (colour, crown,
//      squad chips) with the win count made loud. Capped at four: past that
//      the page is a wall of names.
//   4. The breakdown — every per-player award, in a bento of three card sizes
//      so the page has a shape instead of being a grid of identical boxes.
//      Deliberately **not** framed as a joke page: these are the month's
//      awards, and the copy stays as factual as everywhere else in the app —
//      "fewest wins", never "worst player" (§2.9).
//   5. Achievements — every milestone crossed this month, as chips grouped by
//      kind rather than one row per line.
//   6. Team of the Month — the gold shirt card (§2.20).
//
// Page 3 absorbed what used to be a separate "also happened" page. Once there
// were three card sizes there was room for it, and the split was never really
// about those stats differing in kind — only about there being too many cards
// of one size to look at.

import type {
  Bully,
  GradeExtreme,
  LongestRun,
  NightOfMonth,
  Reservist,
  WinningTeam,
  WrappedStats,
} from './wrapped';
import type { ShareImageResult } from './shareImage';
import type { Milestone } from './milestones';
import type { TeamColor } from './types';
import { TEAM_COLORS } from './balancer';
import { renderShirtImage } from './shirtImage';
import {
  CHIP_GAP,
  CHIP_H,
  INK,
  TEAM_CANVAS,
  TEAM_LABEL,
  drawChip,
  fillRound,
  fitText,
  chipWidth,
  flowChips,
  flowSplitChips,
  drawSplitChip,
  iso,
  isoPair,
  type SplitChip,
  font,
  glow,
  jerseyText,
  packTier,
  roundRect,
  sectionHeader,
  spacedCaps,
  strokeRound,
  stripes,
  vGradient,
  wrapText,
  type Slot,
} from './canvasKit';

const W = 720;
const PAD = 44;
const GAP = 18;
const CARD_R = 22;

const HEADER_H = 184;
const PAGE_HEADER_H = 128;
const HERO_H = 210;
const FOOTER_H = 44;

// Bento tiers. Height is fixed per tier so every row comes out level.
const TIER_HERO_H = 196;
const TIER_MAJOR_H = 228;
const TIER_MINOR_H = 162;

// The clutter ceiling. Every one of these stats is nullable, so a busy month
// can produce a lot of small cards at once — past two rows of them the page
// stops being glanceable, which is the one thing it has to be. `buildMinors`
// is ordered by how much anybody actually wants to read it, and the tail is
// dropped rather than shrunk.
const MAX_MINOR_CARDS = 6;

const TEAM_EMOJI: Record<TeamColor, string> = { black: '⚫', white: '⚪', blue: '🔵' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- Page furniture --------------------------------------------------------

function drawPageBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1608');
  bg.addColorStop(1, '#120a08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  glow(ctx, w * 0.85, h * 0.04, 340, 'rgba(234,88,12,0.34)');
  glow(ctx, w * 0.08, h * 0.26, 280, 'rgba(29,78,216,0.2)');
  glow(ctx, w * 0.92, h * 0.58, 300, 'rgba(21,128,61,0.16)');
  glow(ctx, w * 0.1, h * 0.82, 280, 'rgba(124,58,237,0.15)');
}

function drawBrand(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = INK.body;
  ctx.font = font(24, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 24);
  ctx.restore();
}

/** The lighter header every page after the first uses. */
function drawPageHeader(ctx: CanvasRenderingContext2D, label: string, title: string) {
  drawBrand(ctx);
  spacedCaps(ctx, label, PAD, PAD + 60, { size: 13, color: INK.faint, tracking: 3 });
  jerseyText(ctx, title, PAD, PAD + 104, {
    size: 40,
    fill: INK.gold,
    stroke: 'rgba(0,0,0,0.32)',
    strokeWidth: 5,
  });
}

function drawFooter(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.font = font(15, '600');
  ctx.fillStyle = INK.faint;
  ctx.fillText('Every number here is a count, not a verdict.', W / 2, y + 20);
  ctx.restore();
}

const canvasOf = (h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  drawPageBackground(ctx, W, h);
  return [canvas, ctx];
};

/** A throwaway context with the same font metrics as the real one, for the
 *  measuring passes that must happen before a canvas can be sized. */
const measurer = (): CanvasRenderingContext2D =>
  document.createElement('canvas').getContext('2d')!;

/** Draws a name that may be Hebrew or Latin, right-anchored, shrunk to fit. */
function drawName(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  size: number,
  maxWidth: number,
  align: 'left' | 'right',
  fill = INK.bright,
) {
  const m = measurer();
  m.font = font(size, '900');
  jerseyText(ctx, fitText(m, name, maxWidth), x, y, {
    size,
    fill,
    stroke: 'rgba(0,0,0,0.3)',
    align,
    direction: 'rtl',
    strokeWidth: Math.max(3, size * 0.08),
  });
}

// --- The award card --------------------------------------------------------
//
// One anatomy at every size: accent bar and eyebrow on top, the value as the
// loudest thing on the card, then the supporting count. Keeping to one shape
// is what lets the tiers read as a hierarchy rather than as unrelated designs.

interface Award {
  eyebrow: string; // the award's name — "DRAMA QUEEN"
  value: string; // usually a person
  detail: string; // the count that earned it
  emoji: string;
  accent: string;
  tint: [string, string];
}

function drawAwardCard(ctx: CanvasRenderingContext2D, a: Award, s: Slot) {
  fillRound(ctx, s.x, s.y, s.w, s.h, CARD_R, vGradient(ctx, s.x, s.y, s.w, s.h, a.tint[0], a.tint[1]));
  stripes(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.035)', 20, 8);
  strokeRound(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.12)', 1.5);

  const padX = 16;
  const top = s.y + 28;

  ctx.fillStyle = a.accent;
  roundRect(ctx, s.x + padX, top - 12, 4, 14, 2);
  ctx.fill();
  spacedCaps(ctx, a.eyebrow, s.x + padX + 10, top, {
    size: 11,
    color: 'rgba(255,255,255,0.78)',
    tracking: 1,
    // stop short of the corner emoji rather than running underneath it
    maxWidth: s.w - padX * 2 - 42,
  });

  // emoji as a watermark, not a label
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'right';
  ctx.font = font(26, '700');
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillText(a.emoji, s.x + s.w - padX, top + 6);
  ctx.restore();

  drawName(ctx, a.value, s.x + s.w - padX, s.y + 96, 28, s.w - padX * 2, 'right');

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(14, '700');
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  wrapText(ctx, a.detail, s.w - padX * 2)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, s.x + padX, s.y + 124 + i * 19));
  ctx.restore();
}

// --- Page 1: the highlights ------------------------------------------------

interface Leaderboard {
  title: string;
  entries: { name: string; stat: string }[];
  accent: string;
}

const LEADERBOARD_ROW_H = 50;
const LEADERBOARD_TITLE_H = 56;
const MEDALS = ['🥇', '🥈', '🥉'];

const leaderboardHeight = (b: Leaderboard) =>
  LEADERBOARD_TITLE_H + b.entries.length * LEADERBOARD_ROW_H + 12;

function drawLeaderboard(ctx: CanvasRenderingContext2D, b: Leaderboard, y: number, cardW: number) {
  const h = leaderboardHeight(b);
  fillRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(253,250,243,0.055)');
  strokeRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(253,250,243,0.1)', 1.5);
  sectionHeader(ctx, b.title, PAD + 20, y + 38, b.accent, 20);

  b.entries.forEach((entry, i) => {
    const rowY = y + LEADERBOARD_TITLE_H + i * LEADERBOARD_ROW_H + 30;
    if (i > 0) {
      ctx.strokeStyle = 'rgba(253,250,243,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD + 20, rowY - 32);
      ctx.lineTo(PAD + cardW - 20, rowY - 32);
      ctx.stroke();
    }
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = font(21, '800');
    ctx.fillStyle = INK.body;
    ctx.fillText(`${MEDALS[i] ?? `${i + 1}.`}  ${entry.stat}`, PAD + 20, rowY);
    ctx.restore();

    drawName(ctx, entry.name, PAD + cardW - 20, rowY, 23, cardW * 0.46, 'right');
  });
}

const ATTENDANCE_TITLE_H = 88;

const attendanceHeight = (lines: string[][]) =>
  ATTENDANCE_TITLE_H + lines.length * (CHIP_H + CHIP_GAP) + 10;

function drawAttendance(
  ctx: CanvasRenderingContext2D,
  nights: number,
  lines: string[][],
  y: number,
  cardW: number,
) {
  const h = attendanceHeight(lines);
  fillRound(ctx, PAD, y, cardW, h, CARD_R, vGradient(ctx, PAD, y, cardW, h, '#1e40af', '#172554'));
  stripes(ctx, PAD, y, cardW, h, CARD_R, 'rgba(255,255,255,0.045)', 20, 8);
  strokeRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(147,197,253,0.3)', 1.5);
  sectionHeader(ctx, '🦾 Never missed a night', PAD + 20, y + 38, '#60a5fa', 20);
  spacedCaps(ctx, `${nights} for ${nights} this month`, PAD + 20, y + 64, {
    size: 12,
    color: 'rgba(191,219,254,0.8)',
    tracking: 1.4,
  });

  lines.forEach((line, i) => {
    let x = PAD + 20;
    const rowY = y + ATTENDANCE_TITLE_H + i * (CHIP_H + CHIP_GAP);
    for (const name of line) {
      x +=
        drawChip(ctx, name, x, rowY, {
          fill: 'rgba(255,255,255,0.15)',
          border: 'rgba(191,219,254,0.42)',
        }) + CHIP_GAP;
    }
  });
}

function renderHighlights(stats: WrappedStats): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const boards: Leaderboard[] = [];
  if (stats.topMvps.length > 0) {
    boards.push({
      title: '🌟 Most MVP picks',
      accent: '#f472b6',
      entries: stats.topMvps.map((m) => ({
        name: m.name,
        stat: `${m.count} MVP${m.count === 1 ? '' : 's'}`,
      })),
    });
  }
  if (stats.topMatchWinners.length > 0) {
    boards.push({
      title: '🏅 Most matches won',
      accent: INK.gold,
      entries: stats.topMatchWinners.map((w) => ({ name: w.name, stat: `${w.wins} wins` })),
    });
  }
  if (stats.topFixtureWinners.length > 0) {
    boards.push({
      title: '🏆 Most fixtures won',
      accent: '#5eead4',
      entries: stats.topFixtureWinners.map((w) => ({
        name: w.name,
        stat: `${w.nights} fixture${w.nights === 1 ? '' : 's'}`,
      })),
    });
  }

  const attLines = stats.perfectAttendance
    ? flowChips(measurer(), stats.perfectAttendance.names, cardW - 40)
    : [];

  const H =
    PAD +
    HEADER_H +
    HERO_H +
    GAP +
    boards.reduce((s, b) => s + leaderboardHeight(b) + GAP, 0) +
    (stats.perfectAttendance ? attendanceHeight(attLines) + GAP : 0) +
    FOOTER_H +
    PAD;

  const [canvas, ctx] = canvasOf(H);
  drawBrand(ctx);

  jerseyText(ctx, stats.label, PAD, PAD + 106, {
    size: 58,
    fill: INK.goldSoft,
    stroke: 'rgba(0,0,0,0.35)',
    strokeWidth: 7,
  });
  spacedCaps(ctx, 'Monthly recap', PAD, PAD + 140, { size: 15, color: INK.muted, tracking: 5 });

  let y = PAD + HEADER_H;

  // the hero: one number, as large as the page allows
  fillRound(
    ctx,
    PAD,
    y,
    cardW,
    HERO_H,
    28,
    vGradient(ctx, PAD, y, cardW, HERO_H, '#f97316', '#9a3412'),
  );
  stripes(ctx, PAD, y, cardW, HERO_H, 28, 'rgba(255,255,255,0.06)', 22, 9);
  strokeRound(ctx, PAD, y, cardW, HERO_H, 28, 'rgba(253,186,116,0.35)', 1.5);

  const nights = String(stats.nightsRecorded);
  jerseyText(ctx, nights, PAD + 32, y + 130, {
    size: 116,
    fill: INK.bright,
    stroke: 'rgba(0,0,0,0.28)',
    strokeWidth: 9,
  });
  const mm = measurer();
  mm.font = font(116, '900');
  const numRight = PAD + 32 + mm.measureText(nights).width + 18;

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(26, '900');
  ctx.fillStyle = INK.bright;
  ctx.fillText('nights played', numRight, y + 106);
  ctx.font = font(19, '700');
  ctx.fillStyle = 'rgba(255,250,240,0.82)';
  ctx.fillText('this month', numRight, y + 132);
  ctx.restore();

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(18, '800');
  ctx.fillStyle = 'rgba(255,250,240,0.9)';
  ctx.fillText(`⚽ ${stats.totalWins} wins banked by the squad`, PAD + 32, y + 176);
  ctx.restore();
  y += HERO_H + GAP;

  for (const b of boards) {
    drawLeaderboard(ctx, b, y, cardW);
    y += leaderboardHeight(b) + GAP;
  }
  if (stats.perfectAttendance) {
    drawAttendance(ctx, stats.perfectAttendance.nights, attLines, y, cardW);
    y += attendanceHeight(attLines) + GAP;
  }

  drawFooter(ctx, y);
  return canvas;
}

// --- Page 2: the night of the month ----------------------------------------
//
// The three squads exactly as the fixture page draws them — same colours, same
// name chips, same header — above a scoreboard of how the night actually went.
// Redrawn from the record rather than screenshotted, so it is always the squad
// that really played.

const SQUAD_HEADER_H = 48;
const SQUAD_PAD = 12;
const SCORE_H = 148;

const squadHeight = (lines: string[][]) =>
  SQUAD_HEADER_H + Math.max(lines.length, 1) * (CHIP_H + 6) + SQUAD_PAD;

function drawSquadCard(
  ctx: CanvasRenderingContext2D,
  color: TeamColor,
  lines: string[][],
  s: Slot,
  isWinner: boolean,
) {
  const t = TEAM_CANVAS[color];
  fillRound(ctx, s.x, s.y, s.w, s.h, 18, t.bg);
  strokeRound(ctx, s.x, s.y, s.w, s.h, 18, isWinner ? INK.gold : t.border, isWinner ? 3 : 1.5);

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(16, '900');
  ctx.fillStyle = t.text;
  ctx.fillText(`${TEAM_EMOJI[color]} ${TEAM_LABEL[color]}`, s.x + SQUAD_PAD, s.y + 29);
  ctx.restore();

  lines.forEach((line, i) => {
    let x = s.x + SQUAD_PAD;
    const rowY = s.y + SQUAD_HEADER_H + i * (CHIP_H + 6);
    for (const name of line) {
      x +=
        drawChip(ctx, name, x, rowY, {
          size: 15,
          fill: t.chip,
          border: t.border,
          color: t.text,
        }) + CHIP_GAP;
    }
  });
}

function drawScoreRow(ctx: CanvasRenderingContext2D, night: NightOfMonth, y: number, cardW: number) {
  const colW = (cardW - GAP * 2) / 3;
  TEAM_COLORS.forEach((c, i) => {
    const t = TEAM_CANVAS[c];
    const x = PAD + i * (colW + GAP);
    const won = night.winner === c;
    fillRound(ctx, x, y, colW, SCORE_H, 18, won ? t.bg : 'rgba(253,250,243,0.05)');
    strokeRound(ctx, x, y, colW, SCORE_H, 18, won ? INK.gold : 'rgba(253,250,243,0.12)', won ? 3 : 1.5);

    // measure the caps so they can be centred in the column
    const capsW = spacedCaps(measurer(), TEAM_LABEL[c], 0, -999, { size: 12, tracking: 1.6 });
    spacedCaps(ctx, TEAM_LABEL[c], x + colW / 2 - capsW / 2, y + 30, {
      size: 12,
      color: won ? t.sub : INK.muted,
      tracking: 1.6,
    });

    jerseyText(ctx, String(night.teams[c].won), x + colW / 2, y + 88, {
      size: 52,
      fill: won ? INK.bright : INK.body,
      stroke: 'rgba(0,0,0,0.32)',
      align: 'center',
    });

    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.font = font(15, '900');
    ctx.fillStyle = won ? INK.bright : INK.body;
    ctx.fillText(night.teams[c].won === 1 ? 'WIN' : 'WINS', x + colW / 2, y + 110);
    ctx.font = font(13, '700');
    ctx.fillStyle = won ? t.sub : INK.muted;
    ctx.fillText(`from ${night.teams[c].played} played`, x + colW / 2, y + 130);
    ctx.restore();

    if (won) {
      ctx.save();
      ctx.direction = 'ltr';
      ctx.textAlign = 'center';
      ctx.font = font(15, '900');
      ctx.fillStyle = INK.gold;
      ctx.fillText('🏆', x + colW - 22, y + 30);
      ctx.restore();
    }
  });
}

function renderNightOfMonth(night: NightOfMonth): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const squadW = (cardW - GAP * 2) / 3;
  const m = measurer();

  // every squad card takes the height of the tallest, so the row stays level
  const squadLines = TEAM_COLORS.map((c) =>
    flowChips(m, night.teams[c].squad, squadW - SQUAD_PAD * 2, 15),
  );
  const squadH = Math.max(...squadLines.map(squadHeight));

  const facts: string[] = [
    `${night.matches} matches`,
    `${night.leadChanges} lead change${night.leadChanges === 1 ? '' : 's'}`,
  ];
  if (night.penalties > 0) {
    facts.push(`${night.penalties} shootout${night.penalties === 1 ? '' : 's'}`);
  }
  if (night.mvpName) facts.push(`🌟 ${iso(night.mvpName)}`);
  const factLines = flowChips(m, facts, cardW, 16);

  const H =
    PAD +
    PAGE_HEADER_H +
    64 + // the headline line
    squadH +
    GAP +
    SCORE_H +
    GAP +
    factLines.length * (CHIP_H + CHIP_GAP) +
    GAP +
    FOOTER_H +
    PAD;

  const [canvas, ctx] = canvasOf(H);
  drawPageHeader(ctx, night.date, 'Night of the month');

  let y = PAD + PAGE_HEADER_H;

  // nightStory's own headline for the evening
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(27, '900');
  ctx.fillStyle = INK.bright;
  ctx.fillText(fitText(ctx, `“${night.headline}”`, cardW), PAD, y + 24);
  ctx.restore();
  y += 64;

  TEAM_COLORS.forEach((c, i) => {
    drawSquadCard(
      ctx,
      c,
      squadLines[i],
      { x: PAD + i * (squadW + GAP), y, w: squadW, h: squadH },
      night.winner === c,
    );
  });
  y += squadH + GAP;

  drawScoreRow(ctx, night, y, cardW);
  y += SCORE_H + GAP;

  factLines.forEach((line, i) => {
    let x = PAD;
    const rowY = y + i * (CHIP_H + CHIP_GAP);
    for (const f of line) x += drawChip(ctx, f, x, rowY, { size: 16 }) + CHIP_GAP;
  });
  y += factLines.length * (CHIP_H + CHIP_GAP) + GAP;

  drawFooter(ctx, y);
  return canvas;
}

// --- Page 3: the month's winning teams -------------------------------------
//
// The same card the night page uses for a winning shirt — colour, crown, the
// squad in name chips — one per night that had an outright winner, best night
// first. A shared night (see WinningTeam.shared in wrapped.ts) draws as one
// card split into a column per tied shirt, rather than as separate cards —
// they are one event, not several. Capped at MAX_WINNING_TEAMS *nights*: past
// four the page is a wall of names and stops being something anybody reads.

const MAX_WINNING_TEAMS = 4;
const WT_HEADER_H = 72;
const WT_PAD = 18;
// Bigger than the chips elsewhere: on this page the squad *is* the content,
// where on the night page it sits under a scoreboard and has to stay quieter.
const WT_CHIP_SIZE = 23;
const WT_CHIP_H = 48;

const winningTeamHeight = (lines: string[][]) =>
  WT_HEADER_H + Math.max(lines.length, 1) * (WT_CHIP_H + 8) + WT_PAD;

/** One night, with every shirt that topped its tally — one entry for an
 *  outright win, two or three for a shared one. Grouping by fixture (rather
 *  than trusting the sort to keep tied entries adjacent) is what lets a
 *  shared night become one card instead of several. */
interface WinningNight {
  fixtureId: string;
  date: string;
  wins: number;
  shared: boolean;
  teams: { color: TeamColor; squad: string[] }[];
}

function groupWinningTeams(teams: WinningTeam[]): WinningNight[] {
  const byFixture = new Map<string, WinningTeam[]>();
  for (const t of teams) {
    const group = byFixture.get(t.fixtureId);
    if (group) group.push(t);
    else byFixture.set(t.fixtureId, [t]);
  }
  return [...byFixture.values()]
    .map((group) => ({
      fixtureId: group[0].fixtureId,
      date: group[0].date,
      wins: group[0].wins,
      shared: group[0].shared,
      teams: group.map((t) => ({ color: t.color, squad: t.squad })),
    }))
    .sort((a, b) => b.wins - a.wins || a.date.localeCompare(b.date));
}

function drawWinningTeamCard(
  ctx: CanvasRenderingContext2D,
  team: WinningTeam,
  lines: string[][],
  y: number,
  cardW: number,
) {
  const t = TEAM_CANVAS[team.color];
  const h = winningTeamHeight(lines);
  fillRound(ctx, PAD, y, cardW, h, CARD_R, t.bg);
  strokeRound(ctx, PAD, y, cardW, h, CARD_R, INK.gold, 2.5);

  // No colour name: the card *is* the colour, so the words only repeated what
  // the background already says. The date is what actually identifies which
  // night this was, so it takes the slot and the weight. A shared night gets
  // a handshake rather than a crown — it says outright that this shirt didn't
  // win the night alone, without needing a caption to explain it.
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(23, '900');
  ctx.fillStyle = t.text;
  ctx.fillText(`${team.shared ? '🤝' : '👑'} ${team.date}`, PAD + WT_PAD, y + 44);
  ctx.restore();

  // the win count, as the loudest thing on the card
  const label = team.wins === 1 ? 'WIN' : 'WINS';
  const capsW = spacedCaps(measurer(), label, 0, -999, { size: 13, tracking: 1.8 });
  spacedCaps(ctx, label, PAD + cardW - WT_PAD - capsW, y + 48, {
    size: 13,
    color: t.sub,
    tracking: 1.8,
  });
  jerseyText(ctx, String(team.wins), PAD + cardW - WT_PAD - capsW - 14, y + 50, {
    size: 48,
    fill: t.text,
    stroke: 'rgba(0,0,0,0.28)',
    align: 'right',
  });

  // squad chips, right-anchored the way the fixture page lays them out
  lines.forEach((line, i) => {
    const rowW = line.reduce(
      (w, n) => w + chipWidth(measurer(), n, WT_CHIP_SIZE) + CHIP_GAP,
      -CHIP_GAP,
    );
    let x = PAD + cardW - WT_PAD - rowW;
    const rowY = y + WT_HEADER_H + i * (WT_CHIP_H + 8);
    for (const name of line) {
      x += drawChip(ctx, name, x, rowY, {
        size: WT_CHIP_SIZE,
        height: WT_CHIP_H,
        fill: t.chip,
        border: t.border,
        color: t.text,
      }) + CHIP_GAP;
    }
  });
}

// The shared-win card: one rounded rectangle, its background split into a
// column per tied shirt so "who tied" is legible at a glance without a label
// per side. A single badge straddles the seam for the date and the win count
// (the same number for every column, so it is said once, not repeated) — a
// dark pill rather than either shirt's own ink, because it has to sit
// legibly on top of whichever colours happen to be tied that night, and one
// of the three is always a near-white background.
const WT_SHARED_BADGE_TOP = 16;
const WT_SHARED_BADGE_H = 38;
const WT_SHARED_HEADER_H = WT_SHARED_BADGE_TOP + WT_SHARED_BADGE_H + 16;
const WT_SEAM_INSET = 10;
const WT_COL_PAD = 14;

const sharedWinHeight = (colLines: string[][][]) =>
  WT_SHARED_HEADER_H +
  Math.max(...colLines.map((l) => Math.max(l.length, 1))) * (WT_CHIP_H + 8) +
  WT_PAD;

function drawSharedWinCard(
  ctx: CanvasRenderingContext2D,
  night: WinningNight,
  colLines: string[][][],
  y: number,
  cardW: number,
) {
  const h = sharedWinHeight(colLines);
  const n = night.teams.length;
  const colW = cardW / n;

  ctx.save();
  roundRect(ctx, PAD, y, cardW, h, CARD_R);
  ctx.clip();
  night.teams.forEach((team, i) => {
    ctx.fillStyle = TEAM_CANVAS[team.color].bg;
    ctx.fillRect(PAD + i * colW, y, colW, h);
  });
  ctx.restore();
  strokeRound(ctx, PAD, y, cardW, h, CARD_R, INK.gold, 2.5);

  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(PAD + i * colW, y + WT_SEAM_INSET);
    ctx.lineTo(PAD + i * colW, y + h - WT_SEAM_INSET);
    ctx.stroke();
  }
  ctx.restore();

  const badgeLabel = `🤝 ${night.date} · ${plural(night.wins, 'win')} each`;
  const bm = measurer();
  bm.font = font(17, '900');
  const badgeW = bm.measureText(badgeLabel).width + 32;
  const badgeX = PAD + cardW / 2 - badgeW / 2;
  const badgeY = y + WT_SHARED_BADGE_TOP;
  fillRound(ctx, badgeX, badgeY, badgeW, WT_SHARED_BADGE_H, WT_SHARED_BADGE_H / 2, 'rgba(0,0,0,0.6)');
  strokeRound(
    ctx,
    badgeX,
    badgeY,
    badgeW,
    WT_SHARED_BADGE_H,
    WT_SHARED_BADGE_H / 2,
    'rgba(245,158,11,0.65)',
    1.5,
  );
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.font = font(17, '900');
  ctx.fillStyle = INK.bright;
  ctx.fillText(badgeLabel, PAD + cardW / 2, badgeY + WT_SHARED_BADGE_H / 2 + 6);
  ctx.restore();

  // squad chips, centred within each shirt's own column
  night.teams.forEach((team, colIdx) => {
    const t = TEAM_CANVAS[team.color];
    const colX = PAD + colIdx * colW;
    colLines[colIdx].forEach((line, i) => {
      const rowW = line.reduce(
        (w, name) => w + chipWidth(measurer(), name, WT_CHIP_SIZE) + CHIP_GAP,
        -CHIP_GAP,
      );
      let x = colX + colW / 2 - rowW / 2;
      const rowY = y + WT_SHARED_HEADER_H + i * (WT_CHIP_H + 8);
      for (const name of line) {
        x +=
          drawChip(ctx, name, x, rowY, {
            size: WT_CHIP_SIZE,
            height: WT_CHIP_H,
            fill: t.chip,
            border: t.border,
            color: t.text,
          }) + CHIP_GAP;
      }
    });
  });
}

function renderWinningTeams(stats: WrappedStats): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const m = measurer();
  const nights = groupWinningTeams(stats.winningTeams)
    .slice(0, MAX_WINNING_TEAMS)
    .map((night) => ({
      night,
      colLines: night.teams.map((team) =>
        flowChips(
          m,
          team.squad,
          night.teams.length > 1 ? cardW / night.teams.length - WT_COL_PAD * 2 : cardW - WT_PAD * 2,
          WT_CHIP_SIZE,
        ),
      ),
    }));

  const heightOf = (n: (typeof nights)[number]) =>
    n.night.teams.length > 1 ? sharedWinHeight(n.colLines) : winningTeamHeight(n.colLines[0]);

  const H =
    PAD +
    PAGE_HEADER_H +
    nights.reduce((s, n) => s + heightOf(n) + GAP, 0) +
    FOOTER_H +
    PAD;

  const [canvas, ctx] = canvasOf(H);
  drawPageHeader(ctx, stats.label, 'Winning teams');

  let y = PAD + PAGE_HEADER_H;
  for (const { night, colLines } of nights) {
    if (night.teams.length > 1) {
      drawSharedWinCard(ctx, night, colLines, y, cardW);
    } else {
      drawWinningTeamCard(
        ctx,
        {
          fixtureId: night.fixtureId,
          date: night.date,
          color: night.teams[0].color,
          wins: night.wins,
          squad: night.teams[0].squad,
          shared: false,
        },
        colLines[0],
        y,
        cardW,
      );
    }
    y += heightOf({ night, colLines }) + GAP;
  }

  drawFooter(ctx, y);
  return canvas;
}

// --- Page 4: the breakdown -------------------------------------------------

/** The two grade extremes share one card: they are the same question asked
 *  from both ends, and two separate boxes was the grid-of-identical-tiles
 *  problem in miniature. */
function drawMarksCard(
  ctx: CanvasRenderingContext2D,
  best: GradeExtreme,
  worst: GradeExtreme,
  s: Slot,
) {
  fillRound(ctx, s.x, s.y, s.w, s.h, CARD_R, vGradient(ctx, s.x, s.y, s.w, s.h, '#292524', '#171412'));
  stripes(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.03)', 20, 8);
  strokeRound(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.12)', 1.5);
  sectionHeader(ctx, '📋 Average mark', s.x + 20, s.y + 38, INK.gold, 17);

  const rowH = (s.h - 62) / 2;
  (
    [
      { p: best, tag: 'Highest average', color: '#4ade80' },
      { p: worst, tag: 'Lowest average', color: '#f87171' },
    ] as const
  ).forEach((row, i) => {
    const rowY = s.y + 62 + i * rowH;
    spacedCaps(ctx, row.tag, s.x + 20, rowY + 18, { size: 11, color: row.color, tracking: 1.2 });
    drawName(ctx, row.p.name, s.x + 20, rowY + 50, 25, s.w - 130, 'left');
    jerseyText(ctx, row.p.avg.toFixed(1), s.x + s.w - 20, rowY + 48, {
      size: 36,
      fill: row.color,
      stroke: 'rgba(0,0,0,0.3)',
      align: 'right',
    });
  });
}

/** The head-to-head, as a scoreline — the one award about two people, which is
 *  why it takes the full width. */
function drawBullyCard(ctx: CanvasRenderingContext2D, b: Bully, s: Slot) {
  fillRound(ctx, s.x, s.y, s.w, s.h, CARD_R, vGradient(ctx, s.x, s.y, s.w, s.h, '#c2410c', '#6b2410'));
  stripes(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.055)', 22, 9);
  strokeRound(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(253,186,116,0.35)', 1.5);
  sectionHeader(ctx, '😤 Head to head', s.x + 22, s.y + 40, '#fdba74', 18);

  const midX = s.x + s.w / 2;
  const nameY = s.y + 122;
  const nameW = s.w / 2 - 86;

  drawName(ctx, b.aName, s.x + 22, nameY, 30, nameW, 'left');
  drawName(ctx, b.bName, s.x + s.w - 22, nameY, 30, nameW, 'right', 'rgba(255,250,240,0.68)');
  jerseyText(ctx, `${b.aWon}–${b.bWon}`, midX, nameY + 6, {
    size: 50,
    fill: '#fed7aa',
    stroke: 'rgba(0,0,0,0.35)',
    align: 'center',
  });

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'center';
  ctx.font = font(14, '700');
  ctx.fillStyle = 'rgba(255,237,213,0.78)';
  ctx.fillText(`the month's most lopsided record — ${b.faced} matches faced`, midX, s.y + s.h - 26);
  ctx.restore();
}

function drawDuoCard(
  ctx: CanvasRenderingContext2D,
  duo: { aName: string; bName: string; won: number; together: number },
  s: Slot,
) {
  fillRound(ctx, s.x, s.y, s.w, s.h, CARD_R, vGradient(ctx, s.x, s.y, s.w, s.h, '#9f1239', '#4c0519'));
  stripes(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.04)', 20, 8);
  strokeRound(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(253,164,175,0.3)', 1.5);
  sectionHeader(ctx, '🙃 Least lucky pair', s.x + 20, s.y + 38, '#fda4af', 17);

  drawName(ctx, `${duo.aName} & ${duo.bName}`, s.x + 20, s.y + 100, 25, s.w - 40, 'left');

  jerseyText(ctx, `${duo.won}/${duo.together}`, s.x + 20, s.y + s.h - 44, {
    size: 38,
    fill: '#fda4af',
    stroke: 'rgba(0,0,0,0.3)',
  });
  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(14, '700');
  ctx.fillStyle = 'rgba(255,228,230,0.8)';
  ctx.fillText('nights won together', s.x + 20, s.y + s.h - 20);
  ctx.restore();
}

/**
 * The longest unbroken run of match wins inside one night.
 *
 * Deliberately **does not lead with the shirt colour**. The teams are redrawn
 * every week, so "Black won four on the spin" names a set of people that
 * existed for one evening and never again — it reads as a claim about a
 * standing team and there is no such thing here. The run belongs to the
 * players who were on that shirt that night, so they are who it names.
 */
function drawBiggestRunCard(ctx: CanvasRenderingContext2D, run: LongestRun, s: Slot) {
  fillRound(ctx, s.x, s.y, s.w, s.h, CARD_R, vGradient(ctx, s.x, s.y, s.w, s.h, '#b91c1c', '#5c0f0f'));
  stripes(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(255,255,255,0.05)', 20, 8);
  strokeRound(ctx, s.x, s.y, s.w, s.h, CARD_R, 'rgba(252,165,165,0.32)', 1.5);
  sectionHeader(ctx, '🔥 Biggest run', s.x + 20, s.y + 38, '#fca5a5', 17);

  jerseyText(ctx, String(run.length), s.x + 20, s.y + 104, {
    size: 54,
    fill: INK.bright,
    stroke: 'rgba(0,0,0,0.3)',
  });
  const m = measurer();
  m.font = font(54, '900');
  const numW = m.measureText(String(run.length)).width;

  ctx.save();
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.font = font(17, '800');
  ctx.fillStyle = 'rgba(255,240,240,0.92)';
  ctx.fillText('matches in a row', s.x + 30 + numW, s.y + 90);
  ctx.font = font(13, '700');
  ctx.fillStyle = 'rgba(254,202,202,0.75)';
  ctx.fillText(run.date, s.x + 30 + numW, s.y + 110);
  ctx.restore();

  // who was wearing that shirt — the run belongs to them, not to a colour
  ctx.save();
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.font = font(16, '800');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  wrapText(ctx, run.squad.join(' · '), s.w - 40)
    .slice(0, 3)
    .forEach((line, i) => ctx.fillText(line, s.x + s.w - 20, s.y + 148 + i * 23));
  ctx.restore();
}

type Major =
  | { kind: 'marks'; best: GradeExtreme; worst: GradeExtreme }
  | { kind: 'run'; run: LongestRun }
  | { kind: 'duo'; duo: { aName: string; bName: string; won: number; together: number } };

function buildMajors(stats: WrappedStats): Major[] {
  const out: Major[] = [];
  if (stats.teachersPet && stats.punchingBag) {
    out.push({ kind: 'marks', best: stats.teachersPet, worst: stats.punchingBag });
  }
  if (stats.longestRun) out.push({ kind: 'run', run: stats.longestRun });
  if (stats.worstDuo) out.push({ kind: 'duo', duo: stats.worstDuo });
  return out;
}

// The reservists get a full-width card of their own with an adaptive height,
// the same shape the attendance card on page 1 uses. **Everyone who qualified
// is named** — on a month with several one-off appearances, picking the best
// story and silently dropping the rest reads as the app not having noticed
// them, and a fixed-height card would eventually have to truncate.
const RESERVIST_TITLE_H = 88;
const reservistsHeight = (lines: string[][]) =>
  RESERVIST_TITLE_H + lines.length * (CHIP_H + CHIP_GAP) + 10;

function drawReservistsCard(
  ctx: CanvasRenderingContext2D,
  lines: string[][],
  y: number,
  cardW: number,
) {
  const h = reservistsHeight(lines);
  fillRound(ctx, PAD, y, cardW, h, CARD_R, vGradient(ctx, PAD, y, cardW, h, '#0f766e', '#0b3330'));
  stripes(ctx, PAD, y, cardW, h, CARD_R, 'rgba(255,255,255,0.045)', 20, 8);
  strokeRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(94,234,212,0.3)', 1.5);
  sectionHeader(ctx, '🎖️ The reservists', PAD + 20, y + 38, '#5eead4', 20);
  spacedCaps(ctx, 'played once or twice, and still took a night', PAD + 20, y + 64, {
    size: 12,
    color: 'rgba(153,246,228,0.8)',
    tracking: 1.4,
  });

  lines.forEach((line, i) => {
    let x = PAD + 20;
    const rowY = y + RESERVIST_TITLE_H + i * (CHIP_H + CHIP_GAP);
    for (const text of line) {
      x +=
        drawChip(ctx, text, x, rowY, {
          fill: 'rgba(255,255,255,0.14)',
          border: 'rgba(153,246,228,0.4)',
        }) + CHIP_GAP;
    }
  });
}

const reservistChips = (rs: Reservist[]) =>
  rs.map((r) => isoPair(r.name, `${r.wins} win${r.wins === 1 ? '' : 's'}`));

/** Ordered by how much anybody wants to read it — the tail past
 *  MAX_MINOR_CARDS is dropped rather than shrunk. */
function buildMinors(stats: WrappedStats): Award[] {
  const out: Award[] = [];

  if (stats.benchwarmer) {
    out.push({
      eyebrow: 'Benched most',
      value: stats.benchwarmer.name,
      detail: `sat out ${plural(stats.benchwarmer.matchesBenched, 'match', 'matches')}`,
      emoji: '🪑',
      accent: '#cbd5e1',
      tint: ['#475569', '#1e293b'],
    });
  }
  if (stats.cursedShirt) {
    out.push({
      eyebrow: 'Unlucky shirt',
      value: TEAM_LABEL[stats.cursedShirt.color],
      detail: `won ${stats.cursedShirt.nightsWon} of ${stats.cursedShirt.nightsPlayed} nights`,
      emoji: '👕',
      accent: '#94a3b8',
      tint: ['#334155', '#131c2b'],
    });
  }
  if (stats.outOfGas) {
    out.push({
      eyebrow: 'Fastest starter',
      value: stats.outOfGas.name,
      detail: `${Math.round(stats.outOfGas.earlyRate * 100)}% early, ${Math.round(stats.outOfGas.lateRate * 100)}% late`,
      emoji: '🔋',
      accent: '#fdba74',
      tint: ['#c2410c', '#6b2410'],
    });
  }
  if (stats.bottomScorer) {
    out.push({
      eyebrow: 'Fewest wins',
      value: stats.bottomScorer.name,
      detail: `${stats.bottomScorer.wins} in ${plural(stats.bottomScorer.nights, 'night')}`,
      emoji: '🥶',
      accent: '#bae6fd',
      tint: ['#0369a1', '#08344f'],
    });
  }
  if (stats.longestWinless) {
    out.push({
      eyebrow: 'Longest wait',
      value: stats.longestWinless.name,
      detail: `${plural(stats.longestWinless.nights, 'night')} without a win`,
      emoji: '💤',
      accent: '#fca5a5',
      tint: ['#991b1b', '#450a0a'],
    });
  }
  return out.slice(0, MAX_MINOR_CARDS);
}

const hasBreakdown = (stats: WrappedStats): boolean =>
  !!stats.bully ||
  stats.reservists.length > 0 ||
  buildMajors(stats).length > 0 ||
  buildMinors(stats).length > 0;

function renderBreakdown(stats: WrappedStats): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const majors = buildMajors(stats);
  const minors = buildMinors(stats);

  const resLines =
    stats.reservists.length > 0
      ? flowChips(measurer(), reservistChips(stats.reservists), cardW - 40)
      : [];
  const heroPack = packTier(stats.bully ? 1 : 0, 6, PAD, 0, cardW, TIER_HERO_H, GAP);
  const majorPack = packTier(majors.length, 3, PAD, 0, cardW, TIER_MAJOR_H, GAP);
  const minorPack = packTier(minors.length, 2, PAD, 0, cardW, TIER_MINOR_H, GAP);

  const H =
    PAD +
    PAGE_HEADER_H +
    heroPack.height +
    (resLines.length > 0 ? reservistsHeight(resLines) + GAP : 0) +
    majorPack.height +
    minorPack.height +
    FOOTER_H +
    PAD;

  const [canvas, ctx] = canvasOf(H);
  drawPageHeader(ctx, stats.label, 'The breakdown');

  let y = PAD + PAGE_HEADER_H;

  if (stats.bully) {
    drawBullyCard(ctx, stats.bully, { ...heroPack.slots[0], y: y + heroPack.slots[0].y });
    y += heroPack.height;
  }

  if (resLines.length > 0) {
    drawReservistsCard(ctx, resLines, y, cardW);
    y += reservistsHeight(resLines) + GAP;
  }

  majors.forEach((mj, i) => {
    const s = { ...majorPack.slots[i], y: y + majorPack.slots[i].y };
    if (mj.kind === 'marks') drawMarksCard(ctx, mj.best, mj.worst, s);
    else if (mj.kind === 'run') drawBiggestRunCard(ctx, mj.run, s);
    else drawDuoCard(ctx, mj.duo, s);
  });
  y += majorPack.height;

  minors.forEach((a, i) => {
    drawAwardCard(ctx, a, { ...minorPack.slots[i], y: y + minorPack.slots[i].y });
  });
  y += minorPack.height;

  drawFooter(ctx, y);
  return canvas;
}

// --- Page 5: achievements --------------------------------------------------

interface ChipGroup {
  title: string;
  accent: string;
  chips: SplitChip[];
}

function groupAchievements(milestones: Milestone[]): ChipGroup[] {
  const debuts: SplitChip[] = [];
  const nights: SplitChip[] = [];
  const wins: SplitChip[] = [];
  const ironman: SplitChip[] = [];
  const streaks: SplitChip[] = [];
  const droughts: SplitChip[] = [];

  for (const m of milestones) {
    switch (m.kind) {
      case 'debut-group':
        debuts.push({ name: `${m.count} new faces` });
        break;
      case 'debut':
        debuts.push({ name: m.name });
        break;
      case 'nth-night':
        nights.push({ name: m.name, detail: `${m.nights}th night` });
        break;
      case 'nth-win':
        wins.push({ name: m.name, detail: `${m.wins}th win` });
        break;
      case 'iron-man':
        ironman.push({ name: m.name, detail: `${m.nights} weeks in a row` });
        break;
      case 'win-streak':
        streaks.push({ name: m.name, detail: `${m.nights} nights running` });
        break;
      case 'winless':
        droughts.push({ name: m.name, detail: `${m.nights} nights so far` });
        break;
    }
  }

  return [
    { title: '✨ First night at the club', accent: '#fde68a', chips: debuts },
    { title: '🎉 Hit a milestone night', accent: '#f0abfc', chips: nights },
    { title: '🏆 Hit a milestone win', accent: INK.gold, chips: wins },
    { title: '🦾 Turned up every week', accent: '#7dd3fc', chips: ironman },
    { title: '📈 On a winning run', accent: '#86efac', chips: streaks },
    { title: '💤 Still waiting for a win', accent: '#fca5a5', chips: droughts },
  ].filter((g) => g.chips.length > 0);
}

const GROUP_TITLE_H = 50;
const groupHeight = (lines: SplitChip[][]) =>
  GROUP_TITLE_H + lines.length * (CHIP_H + CHIP_GAP) + 12;

function renderAchievements(stats: WrappedStats): HTMLCanvasElement {
  const cardW = W - PAD * 2;
  const m = measurer();
  const groups = groupAchievements(stats.monthlyAchievements).map((g) => ({
    ...g,
    lines: flowSplitChips(m, g.chips, cardW - 40),
  }));

  const H =
    PAD +
    PAGE_HEADER_H +
    groups.reduce((s, g) => s + groupHeight(g.lines) + GAP, 0) +
    FOOTER_H +
    PAD;

  const [canvas, ctx] = canvasOf(H);
  drawPageHeader(ctx, stats.label, 'Achievements');

  let y = PAD + PAGE_HEADER_H;
  for (const g of groups) {
    const h = groupHeight(g.lines);
    fillRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(253,250,243,0.05)');
    strokeRound(ctx, PAD, y, cardW, h, CARD_R, 'rgba(253,250,243,0.1)', 1.5);
    sectionHeader(ctx, g.title, PAD + 20, y + 36, g.accent, 18);

    g.lines.forEach((line, i) => {
      let x = PAD + 20;
      const rowY = y + GROUP_TITLE_H + i * (CHIP_H + CHIP_GAP);
      for (const chip of line) {
        x +=
          drawSplitChip(ctx, chip, x, rowY, {
            fill: 'rgba(253,250,243,0.09)',
            border: 'rgba(253,250,243,0.2)',
            accent: g.accent,
          }) + CHIP_GAP;
      }
    });
    y += h + GAP;
  }

  drawFooter(ctx, y);
  return canvas;
}

// --- Assembly --------------------------------------------------------------

export function renderWrappedImages(stats: WrappedStats): HTMLCanvasElement[] {
  const images = [renderHighlights(stats)];
  if (stats.nightOfMonth) images.push(renderNightOfMonth(stats.nightOfMonth));
  if (stats.winningTeams.length > 0) images.push(renderWinningTeams(stats));
  if (hasBreakdown(stats)) images.push(renderBreakdown(stats));
  if (stats.monthlyAchievements.length > 0) images.push(renderAchievements(stats));
  return images;
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

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

// Shares every page in one go — on a phone, picking "Save Image"/"Save to
// Photos" from the share sheet drops all of them into the gallery at once,
// same pattern as shirtImage.ts's three team shirts.
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
