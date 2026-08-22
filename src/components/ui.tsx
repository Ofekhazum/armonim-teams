import type { RoleBadge, TeamColor } from '../types';

export const STYLE_META: Record<RoleBadge, { icon: string; label: string }> = {
  defensive: { icon: '🛡️', label: 'Defensive' },
  balanced: { icon: '⚖️', label: 'Balanced' },
  attacking: { icon: '⚔️', label: 'Attacking' },
  gk: { icon: '🧤', label: 'Goalkeeper' },
};

// `tile` is the ribbon palette — deliberately louder than `card`. A ribbon
// tile has to hold its own against the tile pressed up beside it, where a team
// card only has to sit on the page; white's card is cream on a cream page,
// which as a ribbon made half a night invisible. Shared here rather than kept
// in one component because two pages now draw the same ribbon at two sizes
// (the night page's, and the fingerprint on each History card).
export const TEAM_META: Record<
  TeamColor,
  {
    label: string;
    emoji: string;
    card: string;
    tile: string;
    header: string;
    sub: string;
    row: string;
    ring: string;
  }
> = {
  black: {
    label: 'Black',
    emoji: '⚫',
    card: 'bg-stone-900 border-stone-700 text-stone-100',
    tile: 'bg-stone-800 text-stone-100',
    header: 'text-stone-100',
    sub: 'text-stone-400',
    row: 'border-stone-700 hover:bg-stone-800',
    ring: 'ring-orange-400',
  },
  white: {
    label: 'White',
    emoji: '⚪',
    card: 'bg-[#fffdf4] border-amber-900/25 text-amber-950',
    tile: 'bg-white text-amber-950 ring-1 ring-inset ring-amber-900/25',
    header: 'text-amber-950',
    sub: 'text-amber-900/60',
    row: 'border-amber-900/15 hover:bg-amber-100/70',
    ring: 'ring-orange-500',
  },
  blue: {
    label: 'Blue',
    emoji: '🔵',
    card: 'bg-blue-900 border-blue-700 text-blue-50',
    tile: 'bg-blue-800 text-blue-50',
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
      dir="ltr"
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

// Wins and points carry halves, because a match taken on penalties is worth
// half of one (§2.8). Same formatting everywhere they are printed, so 3 never
// shows up as 3.0 beside a 3.5.
export const fmtWins = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

// Marker colour along the spectrum: blue at fully-defensive, through a warm
// neutral at an even split, to red at fully-attacking — matching the track
// gradient beneath it, so the handle reads as "where am I leaning".
const SPECTRUM_STOPS = {
  defensive: [2, 132, 199], // sky-600
  neutral: [120, 113, 108], // stone-500
  attacking: [220, 38, 38], // red-600
} as const;

export function spectrumColor(attack: number): string {
  const t = Math.max(0, Math.min(100, attack)) / 100;
  const [from, to, k] =
    t <= 0.5
      ? [SPECTRUM_STOPS.defensive, SPECTRUM_STOPS.neutral, t / 0.5]
      : [SPECTRUM_STOPS.neutral, SPECTRUM_STOPS.attacking, (t - 0.5) / 0.5];
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * k));
  return `rgb(${mix.join(' ')})`;
}

// Compact read-only view of where a player sits on the defence↔attack
// spectrum — a track with a marker. Roster cards show this in admin mode only.
export function SpectrumBar({ attack }: { attack: number }) {
  return (
    <span
      dir="ltr"
      className="relative inline-block h-1.5 w-16 shrink-0 rounded-full bg-gradient-to-r from-sky-600/35 via-amber-900/15 to-red-600/35"
    >
      <span
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-sm"
        style={{ left: `${attack}%`, background: spectrumColor(attack) }}
      />
    </span>
  );
}
