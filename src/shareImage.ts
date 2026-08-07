// Renders the teams as a PNG for sharing.
//
// Pasting the text version into WhatsApp works, but it arrives as a wall of
// names; a picture reads at a glance and survives being forwarded. Drawn on a
// canvas rather than rasterised from the DOM so there's no extra dependency
// and nothing to load — this app ships with React and Tailwind and nothing
// else, and that's worth keeping.
//
// Names are mostly Hebrew, so text is drawn right-to-left with the canvas'
// own `direction`, which handles the bidi runs (a Latin nickname inside an
// otherwise Hebrew list) the same way the DOM does.

import type { Player, TeamColor, Teams } from './types';
import { roleBadge } from './types';

const TEAM_STYLE: Record<TeamColor, { label: string; bg: string; fg: string; sub: string }> = {
  black: { label: 'קבוצה שחורה', bg: '#1c1917', fg: '#fafaf9', sub: '#a8a29e' },
  white: { label: 'קבוצה לבנה', bg: '#fffdf4', fg: '#1c1310', sub: '#8a7560' },
  blue: { label: 'קבוצה כחולה', bg: '#1e3a8a', fg: '#eff6ff', sub: '#93c5fd' },
};

const ROLE_ICON: Record<string, string> = {
  defensive: '🛡',
  balanced: '⚖',
  attacking: '⚔',
  gk: '🧤',
};

// Rendered at 2× and scaled down in the file, so it stays crisp when someone
// opens it full-screen on a phone.
const SCALE = 2;
const W = 900;
const PAD = 28;
const CARD_GAP = 16;
const ROW_H = 44;
const HEAD_H = 74;

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

export interface TeamsImageOptions {
  teams: Teams;
  byId: Map<string, Player>;
  gkIds: Set<string>;
  date?: string;
}

export function renderTeamsImage({
  teams,
  byId,
  gkIds,
  date,
}: TeamsImageOptions): HTMLCanvasElement {
  const order: TeamColor[] = ['black', 'white', 'blue'];
  const rows = Math.max(...order.map((c) => teams[c].length), 1);
  const cardH = HEAD_H + rows * ROW_H + 14;
  const cardW = (W - PAD * 2 - CARD_GAP * 2) / 3;
  const H = PAD + 76 + cardH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);

  // page
  ctx.fillStyle = '#fbf4e4';
  ctx.fillRect(0, 0, W, H);

  // title
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#3b1f0b';
  ctx.font = font(34, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 34);
  if (date) {
    ctx.font = font(17, '600');
    ctx.fillStyle = '#8a7560';
    ctx.textAlign = 'right';
    ctx.fillText(date, W - PAD, PAD + 32);
  }

  const top = PAD + 76;
  order.forEach((c, i) => {
    const style = TEAM_STYLE[c];
    const x = PAD + i * (cardW + CARD_GAP);

    ctx.save();
    ctx.shadowColor = 'rgba(60,32,12,0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = style.bg;
    roundRect(ctx, x, top, cardW, cardH, 18);
    ctx.fill();
    ctx.restore();

    if (c === 'white') {
      ctx.strokeStyle = 'rgba(60,32,12,0.22)';
      ctx.lineWidth = 1;
      roundRect(ctx, x, top, cardW, cardH, 18);
      ctx.stroke();
    }

    // team name, right-aligned to match the Hebrew reading order
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = style.fg;
    ctx.font = font(22, '800');
    ctx.fillText(style.label, x + cardW - 16, top + 38);

    const ids = teams[c];
    const rated = ids.map((id) => byId.get(id)).filter((p): p is Player => !!p);
    const avg = rated.length
      ? rated.reduce((n, p) => n + (p.rating ?? 0), 0) / rated.length
      : 0;
    ctx.font = font(14, '600');
    ctx.fillStyle = style.sub;
    ctx.fillText(`${ids.length} שחקנים · ממוצע ${avg.toFixed(1)}`, x + cardW - 16, top + 60);

    // players
    ctx.font = font(17, '600');
    ids.forEach((id, r) => {
      const p = byId.get(id);
      if (!p) return;
      const y = top + HEAD_H + r * ROW_H + 26;

      // separator
      if (r > 0) {
        ctx.strokeStyle = c === 'white' ? 'rgba(60,32,12,0.10)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 14, y - 26);
        ctx.lineTo(x + cardW - 14, y - 26);
        ctx.stroke();
      }

      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillStyle = style.fg;
      ctx.fillText(p.name, x + cardW - 16, y);

      // role / keeper marker on the far side, where it can't collide with a
      // long name
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = style.sub;
      ctx.font = font(15, '600');
      ctx.fillText(gkIds.has(id) ? ROLE_ICON.gk : ROLE_ICON[roleBadge(p)], x + 14, y);
      ctx.font = font(17, '600');
    });
  });

  return canvas;
}

const canvasBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

export type ShareImageResult = 'shared' | 'downloaded' | 'failed';

// Hands the picture to the OS share sheet where that exists (every modern
// phone), and falls back to a plain download on desktop browsers that don't
// do file sharing.
export async function shareTeamsImage(opts: TeamsImageOptions): Promise<ShareImageResult> {
  try {
    const canvas = renderTeamsImage(opts);
    const blob = await canvasBlob(canvas);
    if (!blob) return 'failed';

    const file = new File([blob], `armonim-${opts.date ?? 'teams'}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        // the user backing out of the share sheet is not a failure
        if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
        // anything else: fall through to the download path
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
