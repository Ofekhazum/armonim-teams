import type { TeamColor, Teams, TonightPlayer } from '../types';
import { TEAM_COLORS } from '../balancer';
import { Name, TEAM_META } from './ui';

// Tonight's three teams, as something you glance at rather than work on — the
// compact form, names in wrapped chips (~3 lines a team) instead of one tall
// row per player. Shared by the organiser's fixture page and the group's live
// view so the night looks the same on every phone at the pitch (§2.21).
//
// Everything that differs between the two arrives as a prop, and both of those
// props are things a viewer's payload genuinely does not carry rather than
// things being withheld for effect:
//
//   · `order` — the organiser can sort a team by role (gloves first, then the
//     attack spectrum); a LivePlayer has no attack value, so the viewer gets
//     the board's own order. Same names, same chips.
//   · `note` — the tooltip. "Guest of ניב" and "Attacking" are both read off
//     the private half of a Player, so they are absent rather than empty.
//
// `aside` is the one place a rating may appear (`· avg 3.4`), and it is passed
// only when the organiser is looking (§2.9).
// Generic over the player shape so the organiser's page keeps its full
// `Player` in `note` without a cast, while the viewer hands over a `LivePlayer`
// and simply passes no `note` at all.
interface Props<P extends TonightPlayer> {
  teams: Teams;
  byId: Map<string, P>;
  gkSet: Set<string>;
  order?: (c: TeamColor) => string[];
  note?: (p: P) => string | undefined;
  aside?: (c: TeamColor) => string;
}

export default function TeamCards<P extends TonightPlayer>({
  teams,
  byId,
  gkSet,
  order,
  note,
  aside,
}: Props<P>) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {TEAM_COLORS.map((c) => {
        const m = TEAM_META[c];
        const ids = order ? order(c) : teams[c];
        return (
          <div key={c} className={`pop-in rounded-xl border p-2.5 shadow-md ${m.card}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-x-2 px-0.5">
              <h3 className={`text-sm font-black ${m.header}`}>
                {m.emoji} {m.label}
              </h3>
              <span className={`text-[11px] font-semibold ${m.sub}`}>
                {ids.length}
                {aside?.(c) ?? ''}
              </span>
            </div>
            <ul dir="rtl" className="flex flex-wrap gap-1">
              {ids.map((id) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <li
                    key={id}
                    title={note?.(p)}
                    className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${m.row}`}
                  >
                    {gkSet.has(id) && <span title="Goalkeeper tonight">🧤</span>}
                    <Name>{p.name}</Name>
                    {p.isGuest && <span className={`text-[9px] ${m.sub}`}>★</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
