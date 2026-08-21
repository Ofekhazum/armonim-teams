import type { AchievementKind } from '../achievements';

// A skin per title (§2.19). A player carrying a title wears it on their roster
// row, so the squad list stops being fifteen identical cards and the two or
// three people who have earned something are visible from across the page.
//
// Three rules hold this together:
//
// 1. **The title decides the skin, so there is only ever one ranking.**
//    `titleBadgeFor` already picks the single most distinguishing badge a
//    player holds; the theme follows it. A second priority list would be a
//    second thing to keep in step, and the first time they disagreed the row
//    would say one thing and the player page another.
//
// 2. **Light tints, never dark cards.** Every theme keeps the same dark amber
//    lettering the untitled rows use. Gunmetal and forged iron obviously *want*
//    to be dark with light text — but then the name colour has to flip per
//    theme, and a Hebrew name at 14px on a busy dark gradient is worse than the
//    theme is good. The border and the gradient carry the identity instead.
//
// 3. **Rare by construction.** Four of the eight titles can only be held by one
//    player (or a tie), and titles do not appear at all until the club has
//    enough nights on record. A skin everybody wears is wallpaper.
export interface TitleTheme {
  // border + background, applied to the row in place of its default surface
  card: string;
  // an outer glow, for the two themes whose whole point is that they radiate
  glow?: string;
}

export const TITLE_THEME: Record<AchievementKind, TitleTheme> = {
  // Champion gold — the same language the Team of the Month card speaks.
  'most-wins': {
    card: 'border-amber-500/60 bg-gradient-to-br from-amber-200/80 via-amber-100/60 to-[#fffdf4]',
    glow: 'shadow-[0_0_18px_-4px_rgba(217,119,6,0.45)]',
  },
  // Starlight — indigo dusk rather than more gold, so the two brightest titles
  // in the list never look like each other.
  mvp: {
    card: 'border-violet-400/55 bg-gradient-to-br from-violet-200/70 via-indigo-100/50 to-[#fffdf4]',
    glow: 'shadow-[0_0_18px_-6px_rgba(124,58,237,0.4)]',
  },
  // Podium green — quietly dominant. Winning nights outright is the least
  // showy achievement in the app and the hardest to fluke.
  'most-fixtures': {
    card: 'border-emerald-600/50 bg-gradient-to-br from-emerald-200/70 via-emerald-50/60 to-[#fffdf4]',
  },
  // Gunmetal — cool and hard-edged, for the one earned at the penalty spot.
  shootouts: {
    card: 'border-slate-500/60 bg-gradient-to-br from-slate-300/70 via-slate-100/70 to-[#fffdf4]',
  },
  // Clear sky — calm and even. Never missing a night is dependability, which
  // should not look like a trophy.
  'ever-present': {
    card: 'border-sky-500/45 bg-gradient-to-br from-sky-200/60 via-sky-50/60 to-[#fffdf4]',
  },
  // Forged iron — warm rust, heavier border, the most solid-looking of the set.
  'iron-man': {
    card: 'border-orange-900/45 bg-gradient-to-br from-orange-300/60 via-amber-100/70 to-[#fffdf4]',
  },
  // Fire — the loudest, and the only title that can appear on a short history,
  // which is fine: a run of winning nights is the most *now* thing here.
  'win-streak': {
    card: 'border-orange-500/70 bg-gradient-to-br from-red-300/60 via-orange-200/70 to-[#fffdf4]',
    glow: 'shadow-[0_0_20px_-4px_rgba(234,88,12,0.55)]',
  },
  // Aged parchment — long service, worn rather than polished.
  veteran: {
    card: 'border-amber-800/40 bg-gradient-to-br from-amber-100/90 via-[#f3e7ce] to-[#fffdf4]',
  },
};

// What an untitled player wears — the surface the roster has always used.
export const PLAIN_ROW = 'border-amber-900/15 bg-[#fffdf4]/70';
