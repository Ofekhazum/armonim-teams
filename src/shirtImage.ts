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

const SHIRT_URL: Record<TeamColor, string> = {
  black: blackShirtUrl,
  white: whiteShirtUrl,
  blue: blueShirtUrl,
};

// Dark shirts get light lettering with a dark outline and vice versa, so a
// name reads clearly against the busy nebula texture underneath it.
const TEXT_STYLE: Record<TeamColor, { fill: string; stroke: string }> = {
  black: { fill: '#fdfaf3', stroke: 'rgba(0,0,0,0.85)' },
  white: { fill: '#211407', stroke: 'rgba(255,255,255,0.92)' },
  blue: { fill: '#f2f8ff', stroke: 'rgba(4,12,36,0.85)' },
};

// Chest-center of each of the 5 shirts in the template, measured by hand
// against a 572px-wide render of the source images (all three share one
// layout, just recolored). The actual template assets are exported at a
// higher resolution for sharper sharing, so every measurement here gets
// multiplied by `scale` (actual width ÷ this design width) before use.
const DESIGN_WIDTH = 572;
const SLOTS: { x: number; y: number }[] = [
  { x: 286, y: 340 }, // top
  { x: 123, y: 466 }, // middle-left
  { x: 452, y: 466 }, // middle-right
  { x: 187, y: 662 }, // bottom-left
  { x: 388, y: 662 }, // bottom-right
];
const SLOT_MAX_WIDTH = 116;

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

// Shrinks the name until it fits the shirt's chest; if it still won't fit at
// the smallest readable size, wraps it onto a second line instead of
// shrinking further. `maxWidth` and the returned `size` are both in actual
// canvas pixels (i.e. already multiplied by `scale`).
function fitName(
  ctx: CanvasRenderingContext2D,
  name: string,
  maxWidth: number,
  scale: number,
): { lines: string[]; size: number } {
  const minSize = 15 * scale;
  for (let size = 26 * scale; size >= minSize; size -= scale) {
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

export async function renderShirtImage(color: TeamColor, names: string[]): Promise<HTMLCanvasElement> {
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

  names.slice(0, SLOTS.length).forEach((name, i) => {
    const slot = SLOTS[i];
    const { lines, size } = fitName(ctx, name, SLOT_MAX_WIDTH * scale, scale);
    ctx.font = font(size);
    const lineHeight = size * 1.15;
    const startY = slot.y * scale - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, li) => {
      const y = startY + li * lineHeight;
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = style.stroke;
      ctx.strokeText(line, slot.x * scale, y);
      ctx.fillStyle = style.fill;
      ctx.fillText(line, slot.x * scale, y);
    });
  });

  // A squad bigger than the 5 drawn shirts (extra guests, mostly) still
  // needs to show up somewhere rather than silently vanish off the picture.
  const overflow = names.slice(SLOTS.length);
  if (overflow.length > 0) {
    ctx.font = font(15 * scale, '700');
    ctx.fillStyle = style.fill;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 3 * scale;
    const line = `+${overflow.length}: ${overflow.join(', ')}`;
    ctx.strokeText(line, canvas.width / 2, canvas.height - 40 * scale);
    ctx.fillText(line, canvas.width / 2, canvas.height - 40 * scale);
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
      const names = ids.map((id) => opts.byId.get(id)?.name).filter((n): n is string => !!n);
      if (names.length === 0) continue;
      const canvas = await renderShirtImage(c, names);
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
