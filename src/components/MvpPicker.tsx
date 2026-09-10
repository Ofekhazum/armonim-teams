import type { TeamColor } from '../types';
import { VOTES_MAX } from '../types';
import { TEAM_COLORS } from '../balancer';
import { TEAM_META, teamLabel, Name } from './ui';
import { t } from '../i18n';

interface Props {
  // just id/name — works for a live squad (Player[]) and a past night's
  // FixturePlayer[] snapshot alike, since neither is needed beyond that
  players: { id: string; name: string }[];
  // the tally as typed so far: id → votes. Only positive entries are kept.
  votes: Record<string, number>;
  /**
   * Applied as an updater rather than handed a finished object, because the
   * steppers are tapped *fast* — a name gets three votes as three taps in about
   * a second, and React batches those into one render. Computing the next sheet
   * from the `votes` prop meant all three read the same stale tally and two of
   * them were silently dropped. Caught in the browser; a unit test with one
   * click per render never sees it.
   */
  onChange: (update: (prev: Record<string, number>) => Record<string, number>) => void;
  // who the sheet currently makes player of the night, or null while the vote
  // is level at the top. Computed by the caller from `votes` — this only draws
  // it, so the star and the marks out of ten can never disagree.
  mvpId: string | null;
  // whose players these are: the team that won the night, or every team that
  // tied for it. Shown so the short list reads as a rule rather than a bug.
  winners: TeamColor[];
  // a pick with no tally behind it — a night filed before the sheet existed
  // (§2.46). Clearing it is the only thing this control can do about it.
  legacyPick?: string | null;
  onClearLegacy?: () => void;
}

// The night's vote, one row per candidate (§2.46).
//
// It used to be a single dropdown, which recorded the winner and threw the
// margin away: a 3–2 and a 5–0 were filed as the identical fact, and the player
// one vote short was filed as nobody at all. The sheet keeps the whole tally,
// and `grades.ts` is the only thing that reads it — the honour itself is still
// one name a night everywhere else in the app.
//
// It used to sit on the fixture page, asked while the night was still being
// played. That was the wrong moment: the standout player isn't known until the
// football stops. So it lives on History now, attached to a night that has
// already finished, where the question can actually be answered.
//
// The list is the winning team only (both, on a tie) — the house rule, applied
// by not offering anyone else. `mvpCandidates` in src/mvp.ts decides who that
// is; this just draws them.
//
// **There is no tie-break control, deliberately.** A level vote is broken the
// way it is broken at the pitch — somebody casts the deciding vote — so the
// footer says the sheet is level and the organiser adds one. A button that let
// the app crown one of two tied names would be recording a judgement nobody
// actually made.
export default function MvpPicker({
  players,
  votes,
  onChange,
  mvpId,
  winners,
  legacyPick = null,
  onClearLegacy,
}: Props) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const shirts = winners.map((c) => `${TEAM_META[c].emoji} ${teamLabel(c)}`);
  const cast = Object.values(votes).reduce((s, n) => s + n, 0);
  const top = cast > 0 ? Math.max(...Object.values(votes)) : 0;
  // Level *and* actually contested — one name on one vote is a decided sheet,
  // not a tie, however thin it is.
  const tied = cast > 0 && Object.values(votes).filter((n) => n === top).length > 1;

  // A zero is deleted rather than stored: an entry of 0 and no entry are the
  // same fact, and keeping it would make an untouched sheet look like a counted
  // one to `grades.ts` — which treats those two very differently.
  const write = (prev: Record<string, number>, id: string, n: number) => {
    const next = { ...prev };
    if (n > 0) next[id] = Math.min(n, VOTES_MAX);
    else delete next[id];
    return next;
  };

  /** The typed box: an absolute count. */
  const setVotes = (id: string, n: number) => onChange((prev) => write(prev, id, n));
  /** The steppers: relative, so a burst of taps adds up instead of overwriting. */
  const bump = (id: string, by: number) =>
    onChange((prev) => write(prev, id, (prev[id] ?? 0) + by));

  return (
    <div className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <h3 className="mb-1 font-bold text-amber-950">{t('mvp.title')}</h3>
      <p className="mb-3 text-xs text-amber-900/60">
        {t('mvp.hint')}{' '}
        {shirts.length === 1
          ? t('mvp.from.one', { team: shirts[0] })
          : shirts.length === TEAM_COLORS.length
            ? t('mvp.from.level')
            : t('mvp.from.tied', { teams: shirts.join(t('mvp.and')) })}
      </p>

      <ul className="space-y-1">
        {sorted.map((p) => {
          const n = votes[p.id] ?? 0;
          const isPick = p.id === mvpId;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                isPick ? 'bg-amber-200/50' : n > 0 ? 'bg-amber-100/40' : ''
              }`}
            >
              {/* Star and name in one group that takes the slack, rather than
                  the name itself stretching. A stretched `Name` is a wide box
                  whose Hebrew text aligns to its *own* start — the far end —
                  so in an English page the star sat at the left margin and the
                  name against the steppers, with a hand's width of nothing
                  between them. Grouping keeps the two together at the start of
                  the row in both languages.

                  The star's slot is a fixed width so the names stay on one
                  edge whether or not a row is starred: a column that jogs
                  sideways as votes are typed is harder to read down. */}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="w-4 shrink-0 text-center text-sm" aria-hidden="true">
                  {isPick ? '🌟' : ''}
                </span>
                <Name className="min-w-0 truncate text-sm font-semibold text-amber-950">
                  {p.name}
                </Name>
              </span>
              {/* Steppers rather than a bare number box: this is filled in on a
                  phone, usually one-handed, usually by tapping a name up one at
                  a time as the room says it. The box is still typeable for
                  somebody entering a poll's results in one go. */}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => bump(p.id, -1)}
                  disabled={n === 0}
                  aria-label={t('mvp.vote.less', { name: p.name })}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-amber-900/25 text-sm font-black text-amber-900 disabled:opacity-30"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={VOTES_MAX}
                  value={n === 0 ? '' : n}
                  placeholder="0"
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (e.target.value === '') return setVotes(p.id, 0);
                    if (!Number.isFinite(raw) || raw < 0) return;
                    setVotes(p.id, Math.floor(raw));
                  }}
                  aria-label={t('mvp.vote.count', { name: p.name })}
                  className="w-12 rounded-lg border border-amber-900/25 bg-white px-1 py-1 text-center text-sm font-bold tabular-nums text-amber-950 outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={() => bump(p.id, 1)}
                  disabled={n >= VOTES_MAX}
                  aria-label={t('mvp.vote.more', { name: p.name })}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-amber-900/25 text-sm font-black text-amber-900 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* What the sheet currently says, in one line. Three states, and the
          middle one is the reason this line exists at all: a level vote has no
          winner and the organiser has to be told so, or they file a night
          believing they picked somebody. */}
      <p className="mt-3 text-xs font-semibold text-amber-900/70" aria-live="polite">
        {cast === 0
          ? legacyPick
            ? t('mvp.vote.legacy', { name: legacyPick })
            : t('mvp.vote.none')
          : tied
            ? // A standing pick survives a correction that levels the sheet
              // under them (see `mvpFromVotes`), so a tie has two readings and
              // the star on the row above says which one this is.
              mvpId
              ? t('mvp.vote.tied.holds', { n: top, name: nameOf(sorted, mvpId) })
              : t('mvp.vote.tied', { n: top })
            : t('mvp.vote.cast', { n: cast, name: nameOf(sorted, mvpId) })}
      </p>

      {/* Only reachable on a night picked before the sheet existed. Once any
          vote is typed the tally is the pick, and clearing it means zeroing the
          sheet — so an extra button would be a second way to do one thing. */}
      {cast === 0 && legacyPick && onClearLegacy && (
        <button
          type="button"
          onClick={onClearLegacy}
          className="mt-2 rounded-lg border border-amber-900/25 px-2 py-1 text-[11px] font-bold text-amber-900 hover:border-orange-500"
        >
          {t('mvp.vote.clear')}
        </button>
      )}
    </div>
  );
}

const nameOf = (players: { id: string; name: string }[], id: string | null) =>
  players.find((p) => p.id === id)?.name ?? '?';
