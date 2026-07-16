import type { Playstyle, TeamColor } from '../types';

export const STYLE_META: Record<Playstyle, { icon: string; label: string }> = {
  defensive: { icon: '🛡️', label: 'Defensive' },
  mixed: { icon: '⚖️', label: 'Mixed' },
  attacking: { icon: '⚔️', label: 'Attacking' },
  gk: { icon: '🧤', label: 'Goalkeeper' },
};

export const TEAM_META: Record<
  TeamColor,
  { label: string; emoji: string; card: string; header: string; sub: string; row: string; ring: string }
> = {
  black: {
    label: 'Black',
    emoji: '⚫',
    card: 'bg-stone-900 border-stone-700 text-stone-100',
    header: 'text-stone-100',
    sub: 'text-stone-400',
    row: 'border-stone-700 hover:bg-stone-800',
    ring: 'ring-orange-400',
  },
  white: {
    label: 'White',
    emoji: '⚪',
    card: 'bg-[#fffdf4] border-amber-900/25 text-amber-950',
    header: 'text-amber-950',
    sub: 'text-amber-900/60',
    row: 'border-amber-900/15 hover:bg-amber-100/70',
    ring: 'ring-orange-500',
  },
  blue: {
    label: 'Blue',
    emoji: '🔵',
    card: 'bg-blue-900 border-blue-700 text-blue-50',
    header: 'text-blue-50',
    sub: 'text-blue-300',
    row: 'border-blue-800 hover:bg-blue-800/70',
    ring: 'ring-orange-400',
  },
};

// Bidi-isolated name so Hebrew and English names sit correctly side by side.
export function Name({ children, className = '' }: { children: string; className?: string }) {
  return (
    <bdi dir="auto" className={className}>
      {children}
    </bdi>
  );
}

// Fractional star display — supports half ratings (3.5, 4.5, …) by clipping
// the filled layer to the right width. Base layer inherits the surrounding
// text color so it stays visible on dark and light team cards alike.
export function Stars({ rating, unknown }: { rating: number; unknown?: boolean }) {
  if (unknown) {
    return (
      <span
        className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold text-orange-600"
        title="New player — ability unknown"
      >
        NEW ?
      </span>
    );
  }
  const pct = (Math.max(0, Math.min(5, rating)) / 5) * 100;
  return (
    <span
      className="relative inline-block text-sm leading-none tracking-tight"
      title={`Rating ${rating}/5`}
    >
      <span className="opacity-25">★★★★★</span>
      <span
        className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-amber-500"
        style={{ width: `${pct}%` }}
      >
        ★★★★★
      </span>
    </span>
  );
}

export const RATING_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export const fmtRating = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));
