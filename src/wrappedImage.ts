// Renders a month's WrappedStats as a shareable "story" card — tall, one
// stat per line, meant to be dropped straight into the group chat the way the
// shirt images already are. Canvas rather than a chart library, same reason
// as shareImage.ts/shirtImage.ts: this app ships React + Tailwind and
// nothing else.

import type { WrappedStats } from './wrapped';
import type { ShareImageResult } from './shareImage';

const W = 720;
const H = 1080;
const PAD = 48;

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

interface Line {
  emoji: string;
  value: string;
  label: string;
}

function statLines(stats: WrappedStats): Line[] {
  const lines: Line[] = [
    { emoji: '📅', value: String(stats.nightsRecorded), label: 'nights played' },
    { emoji: '🏆', value: String(stats.totalWins), label: 'wins banked by the squad' },
  ];
  if (stats.mostNights) {
    lines.push({
      emoji: '🦾',
      value: stats.mostNights.name,
      label: `never missed — ${stats.mostNights.nights} nights`,
    });
  }
  if (stats.topScorer) {
    lines.push({
      emoji: '⭐',
      value: stats.topScorer.name,
      label: `top scorer — ${stats.topScorer.wins} wins`,
    });
  }
  if (stats.longestStreak) {
    lines.push({
      emoji: '📈',
      value: stats.longestStreak.name,
      label: `longest run — ${stats.longestStreak.nights} nights won straight`,
    });
  }
  if (stats.bestDuo) {
    lines.push({
      emoji: '🤝',
      value: `${stats.bestDuo.aName} & ${stats.bestDuo.bName}`,
      label: `best pair — won ${stats.bestDuo.won} of ${stats.bestDuo.together} together`,
    });
  }
  return lines;
}

export function renderWrappedImage(stats: WrappedStats): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // page background — a warm gradient, distinct from the flat team-card look
  // so a recap image reads as its own kind of thing at a glance
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3b1f0b');
  bg.addColorStop(1, '#1c1310');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fdfaf3';
  ctx.font = font(28, '800');
  ctx.fillText('🦁 Armonim FC', PAD, PAD + 30);

  ctx.font = font(46, '900');
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(stats.label, PAD, PAD + 100);

  ctx.font = font(20, '600');
  ctx.fillStyle = 'rgba(253,250,243,0.55)';
  ctx.fillText('Recap', PAD, PAD + 132);

  const lines = statLines(stats);
  const cardW = W - PAD * 2;
  const cardH = 108;
  const gap = 20;
  let y = PAD + 190;

  for (const line of lines) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, PAD, y, cardW, cardH, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y, cardW, cardH, 20);
    ctx.stroke();

    ctx.font = font(40, '700');
    ctx.fillStyle = '#fdfaf3';
    ctx.textAlign = 'left';
    ctx.fillText(line.emoji, PAD + 24, y + 62);

    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = font(30, '800');
    ctx.fillStyle = '#fdfaf3';
    ctx.fillText(line.value, PAD + cardW - 24, y + 42);

    ctx.font = font(17, '600');
    ctx.fillStyle = 'rgba(253,250,243,0.6)';
    ctx.fillText(line.label, PAD + cardW - 24, y + 76);
    ctx.direction = 'ltr';

    y += cardH + gap;
  }

  ctx.textAlign = 'center';
  ctx.font = font(15, '600');
  ctx.fillStyle = 'rgba(253,250,243,0.35)';
  ctx.fillText('Every number here is a count, not a verdict.', W / 2, H - 32);

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
