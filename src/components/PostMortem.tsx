import { useMemo, useState } from 'react';
import { TEAM_COLORS } from '../balancer';
import { diagnoseSeason, type Cause, type NightDiagnosis } from '../postMortem';
import { fmtDate, t } from '../i18n';
import type { FixtureRecord, Player, TeamColor } from '../types';
import { fmtRating, fmtWins, teamLabel, TEAM_META } from './ui';

/**
 * The night post-mortem (§2.54) — why the teams keep coming out uneven.
 *
 * **Admin-only, by placement rather than by a flag.** Everything below reads
 * `players[].rating`, and a public device's roster has had those stripped on
 * the way out of the Worker (§2.28) — so on one, every team would read as
 * level and the tool would confidently tell an ordinary member that their
 * organiser builds perfect teams. The host renders this inside its own
 * `isAdmin` gate. There is deliberately no second check here: a component that
 * silently renders nothing is harder to debug later than one with a stated
 * precondition.
 *
 * **Props-only, and it draws no chrome of its own.** No store, no callbacks,
 * no fold header — the host supplies those. It currently lives on the History
 * tab; moving it to an Admin Tools page is meant to be one JSX line, and that
 * only stays true while this file knows nothing about where it is.
 */
interface Props {
  history: FixtureRecord[];
  players: Player[];
}

const pct = (n: number) => Math.round(n);

// Written out rather than built from a template, so every key here is checked
// against STRINGS at compile time — a missing verdict would otherwise only
// show up as a raw key on an organiser's screen.
const CAUSE_CHIP_KEY = {
  format: 'pm.cause.format',
  sheet: 'pm.cause.sheet',
  ratings: 'pm.cause.ratings',
  unclear: 'pm.cause.unclear',
} as const satisfies Record<Cause, string>;

const CAUSE_WHY_KEY = {
  format: 'pm.cause.format.why',
  sheet: 'pm.cause.sheet.why',
  ratings: 'pm.cause.ratings.why',
  unclear: 'pm.cause.unclear.why',
} as const satisfies Record<Cause, string>;

// A verdict is a judgement on the organiser's own work, so the colours are
// deliberately flat rather than a traffic light: "the format" is the ordinary
// answer and should not look like a pass mark, and "the sheet" is a thing to
// look at rather than a failure.
const CAUSE_CHIP: Record<Cause, string> = {
  format: 'bg-amber-900/10 text-amber-900/70',
  sheet: 'bg-orange-200/70 text-orange-900',
  ratings: 'bg-blue-200/60 text-blue-900',
  unclear: 'bg-amber-900/10 text-amber-900/50',
};

// Where a night sat against what level teams produce. The shaded band is the
// middle half of those nights, the tick is their median, and the marker is
// this night — which puts "8/3/1" next to "and here is what nothing-wrong
// looks like" in one glance, which is the whole argument of the feature.
function SpreadStrip({ night }: { night: NightDiagnosis }) {
  const max = Math.max(night.actual, night.equalSpread * 2, 6);
  const at = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="relative h-6 rounded bg-amber-900/5" aria-hidden>
      <div
        className="absolute inset-y-0 rounded bg-amber-900/15"
        style={{ insetInlineStart: at(night.equalSpread * 0.6), width: at(night.equalSpread * 0.9) }}
      />
      <div
        className="absolute inset-y-1 w-px bg-amber-900/40"
        style={{ insetInlineStart: at(night.equalSpread) }}
      />
      <div
        className="absolute inset-y-0 w-1 rounded-full bg-orange-600"
        style={{ insetInlineStart: at(night.actual) }}
      />
    </div>
  );
}

function TeamRow({
  color,
  children,
}: {
  color: TeamColor;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-amber-900/60">
        {TEAM_META[color].emoji} {teamLabel(color)}
      </span>
      {children}
    </div>
  );
}

function Night({ night }: { night: NightDiagnosis }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-amber-900/10 py-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 text-start"
      >
        <span className="text-[12px] font-bold text-amber-950">{fmtDate(night.date)}</span>
        <span className="font-mono text-[12px] text-amber-900/70">
          {TEAM_COLORS.map((c) => fmtWins(night.wins[c])).join(' / ')}
        </span>
        <span
          className={`ms-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${CAUSE_CHIP[night.cause]}`}
        >
          {t(CAUSE_CHIP_KEY[night.cause])}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 ps-1">
          <p className="text-[12px] leading-snug text-amber-900/80">
            {night.cause === 'sheet'
              ? t('pm.cause.sheet.why', { gap: fmtRating(Number(night.paperGap.toFixed(1))) })
              : t(CAUSE_WHY_KEY[night.cause])}
          </p>

          {/* Where it landed against level teams */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
              {t('pm.expected.title')}
            </div>
            <SpreadStrip night={night} />
            <div className="text-[11px] text-amber-900/60">
              {t('pm.night.spread', { n: fmtWins(night.actual) })} ·{' '}
              {t('pm.night.percentile', { n: String(pct(night.percentile)) })}
            </div>
            {night.shape.estimated && (
              <div className="text-[10px] text-amber-900/45">{t('pm.night.estimated')}</div>
            )}
          </div>

          {/* Wins vs matches played — the "oh" moment */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
              {t('pm.rate.title')}
            </div>
            {night.played && night.winRate ? (
              <>
                {TEAM_COLORS.map((c) => (
                  <TeamRow key={c} color={c}>
                    <span className="font-mono text-amber-950">
                      {t('pm.rate.of', {
                        wins: fmtWins(night.wins[c]),
                        played: String(night.played![c]),
                      })}
                    </span>
                    <span className="ms-auto font-mono font-bold text-amber-900/80">
                      {Math.round(night.winRate![c] * 100)}%
                    </span>
                  </TeamRow>
                ))}
                <p className="text-[10px] leading-snug text-amber-900/50">{t('pm.rate.note')}</p>
              </>
            ) : (
              <p className="text-[11px] text-amber-900/50">{t('pm.rate.unavailable')}</p>
            )}
          </div>

          {/* The sheet as it was scored */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
              {t('pm.paper.title')}
            </div>
            {TEAM_COLORS.map((c) => (
              <TeamRow key={c} color={c}>
                <span className="font-mono text-amber-950">{fmtRating(Number(night.paper[c].toFixed(2)))}★</span>
              </TeamRow>
            ))}
            <div className="text-[11px] text-amber-900/60">
              {night.paperGap < 0.1
                ? t('pm.paper.level')
                : t('pm.paper.gap', { gap: fmtRating(Number(night.paperGap.toFixed(1))) })}
            </div>
            <p className="text-[10px] leading-snug text-amber-900/45">
              {night.gkKnown ? t('pm.paper.gkNote') : t('pm.paper.noGk')}
            </p>
          </div>

          {/* Rating error — usually a polite "not yet" */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
              {t('pm.ratings.title')}
            </div>
            <p className="text-[11px] leading-snug text-amber-900/60">
              {night.ratingVerdict === 'error'
                ? t('pm.ratings.gap', { gap: fmtRating(Number(night.realGap.toFixed(1))) })
                : night.ratingVerdict === 'level'
                  ? t('pm.ratings.level')
                  : t('pm.ratings.uncertain')}
            </p>
            {/* The interval itself, so "cannot tell" is a number rather than a
                shrug — and so it visibly narrows as the club plays more. */}
            <p className="text-[10px] text-amber-900/45">
              {t('pm.ratings.margin', {
                correction: fmtRating(Number(night.ratingCorrection.toFixed(1))),
                margin: fmtRating(Number(night.ratingMargin.toFixed(1))),
              })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PostMortem({ history, players }: Props) {
  // The reference distributions are a few thousand simulated nights. Cheap in
  // absolute terms, but not something to redo on every keystroke elsewhere on
  // the tab.
  const season = useMemo(() => diagnoseSeason(history, players), [history, players]);

  if (!season.nights.length) {
    return <p className="text-[12px] text-amber-900/60">{t('pm.season.empty')}</p>;
  }

  const lopsided = Math.round(season.lopsidedShare * season.nights.length);
  const expected = Math.round(season.expectedLopsidedShare * season.nights.length);

  return (
    <div className="space-y-3">
      {/* The season verdict leads, because the macro reading is the point and
          a single night is mostly noise. */}
      <div className="space-y-1.5 rounded-lg bg-amber-900/5 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
          {t('pm.season.heading')}
        </div>
        <p className="text-[13px] leading-snug text-amber-950">
          {t('pm.season.median', {
            actual: fmtWins(season.medianActual),
            equal: fmtWins(season.medianEqual),
          })}
        </p>
        <p className="text-[12px] leading-snug text-amber-900/75">
          {t('pm.season.lopsided', {
            n: String(lopsided),
            of: String(season.nights.length),
            expected: String(expected),
          })}
        </p>
        <p className="text-[12px] leading-snug text-amber-900/60">
          {season.inconclusive
            ? t('pm.season.inconclusive', {
                n: String(season.nights.length),
                need: String(season.nightsForConfidence),
              })
            : t('pm.season.settled')}
        </p>
      </div>

      {/* Why the format does this, said once rather than on every night */}
      <details className="rounded-lg bg-amber-900/5 p-3">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
          {t('pm.format.title')}
        </summary>
        <p className="mt-2 text-[12px] leading-snug text-amber-900/75">{t('pm.format.body')}</p>
      </details>

      {/* Night by night, behind a fold (§2.55).

          It was not folded while this lived on the Club tab, because the whole
          post-mortem was — opening it was already a deliberate act. On Admin
          tools the analysis opens on arrival, which is right for the verdict
          and wrong for the list: forty nights is a very long page between an
          organiser and the two tools below it. And the ordering is the point
          the verdict makes — the season is the reading, a single night is
          mostly noise — so the noise is what folds.

          `<details>`, matching the format explainer just above rather than the
          Section component, because this fold is internal to one panel and has
          no business remembering its own state across visits. */}
      <details className="rounded-lg bg-amber-900/5 p-3">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-wide text-amber-900/50">
          {t('pm.nights.title', { n: String(season.nights.length) })}
        </summary>
        <div className="mt-2">
          {season.nights.map((n) => (
            <Night key={n.id} night={n} />
          ))}
        </div>
      </details>
    </div>
  );
}
