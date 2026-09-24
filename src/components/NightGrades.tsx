import { useEffect, useState } from 'react';
import type { FixtureRecord, Player, TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import { gradesFacts, type GradeFactLine } from '../gradesFacts';
import type { GradeLines, StoredGrades } from '../gradesApi';
import { clearGrades, draftGrades, fetchGrades, publishedMarks, saveGrades } from '../gradesApi';
import { fmtRating, Name, PERFECT_FILL, TEAM_META, teamLabel } from './ui';
import { fmtDate, getLang, t } from '../i18n';

// One line of banter beside every mark (§2.39), on the night page below the
// report. Deliberately last on the page: the report is the night's story, this
// is everyone's personal verdict on it, and a reader gets the shape of the
// evening before they get told what it made of them.
//
// **Grouped by shirt, not one flat ranking of fifteen friends.** The dominant
// term in the mark is the team's result, shared by all five players on it — a
// flat list sorted 10 → 3 would mostly re-derive the three teams in blocks
// while presenting itself as a personal ranking. Three cards mirroring the team
// cards above are honest about what the number mostly is, and put the genuinely
// personal spread — MVP, career, momentum — where it actually lives: between
// teammates on the same card.
//
// Same generate/save/share shape as the report immediately above it
// (`NightPage.tsx`), on purpose: an organiser who has learned that flow has
// learned this one.

interface Props {
  fixture: FixtureRecord;
  history: FixtureRecord[];
  players: Player[]; // the roster, only to tell a guest from a squad member
  adminWord?: string | null;
}

// Plain flat tones for the ordinary run of marks, because a mark is read once
// and at a glance — the same reasoning `PriceTag`'s up/down/flat chip follows.
// The top two bands break that rule on purpose: a 9 or a 10 is rare enough
// (and worth enough to the player reading it) that it earns something a flat
// fill can't give it — see `premium` and `perfect` below.
const GRADE_TONE = {
  // A 10 is rarer than a 9, so it gets a step up rather than the same gold —
  // a shifting spectrum rather than a flat colour, which a single fill can't do.
  // The fill is shared with the profile's form table (`PERFECT_FILL`), so the
  // rarest mark in the app looks the same in both places it can appear.
  perfect: `border-transparent ${PERFECT_FILL} shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)]`,
  // `amber-400` at the far end rather than `yellow-500`: the yellow was the one
  // acid note in the set, and three 9s in a column of it is a lot of shouting
  // for a mark that is not the top one.
  premium:
    'border-amber-500/40 bg-gradient-to-br from-amber-300 to-amber-400 text-amber-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]',
  // **Opaque fills, and that is the fix rather than a restyle.** These three
  // were translucent — `bg-emerald-500/10` and friends — so the card behind
  // them supplied most of the colour, and the cards are `stone-900` and
  // `blue-900`. Measured, the number against its own chip came out at:
  //
  //     band       black   blue    cream
  //     standout   1.97    1.18    6.86
  //     rough      1.97    1.24    6.91
  //     ordinary   2.46    2.72    4.15
  //
  // 1.18:1 is not "hard to read", it is invisible; the marks were only ever
  // legible on the one card the tones were picked against. An opaque fill
  // carries its own contrast, so a chip reads the same on all three.
  //
  // **The 200s rather than the 100s**, which is the second half of the same
  // measurement. On a 0–100 brightness scale the cards sit at 1 (black) and 5
  // (blue), and the 100-level fills came out at 82–89 — a near-white disc on a
  // near-black card, legible and glaring. The 200s land at 69–79 and still
  // clear AAA at 7.58, 12.03 and 6.78, so this is contrast kept and glare
  // dropped rather than a trade between them.
  //
  // Same hues deliberately: green still means a good night. It is the *fill*
  // that changed, from a tint of the card to a colour of its own.
  standout: 'border-emerald-600/30 bg-emerald-200 text-emerald-900',
  ordinary: 'border-amber-900/20 bg-amber-200 text-amber-950',
  rough: 'border-rose-600/30 bg-rose-200 text-rose-900',
} as const;

const toneOf = (grade: number) =>
  grade >= 10 ? 'perfect' : grade >= 9 ? 'premium' : grade >= 7 ? 'standout' : grade <= 4 ? 'rough' : 'ordinary';

/**
 * One mark, in a disc of fixed size.
 *
 * **Square-and-round rather than padded**, which is the whole point: padding
 * sizes a chip to its text, so a "5" came out a small circle and a "4.5" a wide
 * pill, and a column of them read as ragged blobs rather than as a set of
 * marks. A fixed `h-9 w-9` with the number grid-centred means every disc is the
 * same disc and only the number inside it changes — the thing that differs
 * between two players should be the *figure*, not the shape it sits in.
 *
 * Sized to fit the widest mark it will ever hold: "10" and "4.5" are both three
 * glyphs at most, comfortable at 36px with an 11px mono face.
 *
 * **`pt-px` is an optical correction, measured rather than nudged.** Centring
 * puts the *line box* dead centre, which is not the same as centring the
 * digits: this face reports an ascent of 10 and a descent of 3, so the box's
 * middle sits 3.5px above the baseline, while digits — which have no
 * descenders — have their ink centred 4.0px above it. The numerals therefore
 * ride half a pixel high in every disc, consistently enough to read as "off"
 * down a column of fifteen.
 *
 * Line-height cannot fix it (measured at 11, 12, 16 and 16.5px: the offset is
 * -0.504 every time, because the ink's place *within* the line box is a font
 * metric). One pixel of top padding on a centred grid item moves it down half
 * a pixel, which is exactly the correction.
 */
function GradeChip({ grade }: { grade: number }) {
  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border pt-px font-mono text-[11px] font-black tabular-nums ${GRADE_TONE[toneOf(grade)]}`}
    >
      {fmtRating(grade)}
    </span>
  );
}

function PlayerRow({ p, grade, line }: { p: GradeFactLine; grade: number; line?: string }) {
  return (
    // RTL on the whole row rather than on each part: the name starts at the
    // right edge, where a Hebrew reader's eye already lands first, and the mark
    // sits at the left as the trailing figure — the same order a Hebrew
    // scoreline puts a name and a number in.
    <li dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {p.isMvp && <span title={t('marks.mvpTitle')}>🌟</span>}
          {/* Deliberately no vote count here (§2.46). The tally the organiser
              typed is allowed to move the mark — that's the whole feature —
              and nothing else: not this card, not the line beneath it. The
              star already says who the room picked; a number beside it would
              tell the group how close the room came to picking someone else,
              which is not something a mark is supposed to say. */}
          {/* No colour of its own: the card's own text-* (TEAM_META.card)
              already reads on that card, light ink on white, light text on
              black and blue — the same thing TeamCards does above it. */}
          <Name className="truncate text-sm font-bold">{p.name}</Name>
        </span>
        {/* The published mark, never the locally computed one — see
            publishedMarks(). A viewer's device cannot work this out. */}
        <GradeChip grade={grade} />
      </div>
      {/* The model's one sentence, when there is one to show. A player the
          model skipped still gets a mark, which is an ordinary complete state
          rather than a gap.

          **`text-right` explicitly, rather than leaning on `dir` alone.** A
          `dir="rtl"` element's `text-align` resolves to `start`, which *should*
          mean right — and does, measurably, in Chromium. It did not hold up on
          the organiser's iOS Safari, where wrapped lines came out flush left
          under a correctly right-aligned name. Stating the alignment outright
          costs one class and removes the engine from the question.

          Opacity on the inherited colour rather than a fixed one, so it still
          reads on a dark shirt. */}
      {line && (
        <p className="mt-1 text-right text-xs leading-relaxed opacity-75">{line}</p>
      )}
    </li>
  );
}

function TeamGroup({
  color,
  players,
  shown,
}: {
  color: TeamColor;
  players: GradeFactLine[];
  shown: GradeLines;
}) {
  if (players.length === 0) return null;
  return (
    <div className={`rounded-xl border p-3.5 shadow-sm ${TEAM_META[color].card}`}>
      <h4 className={`mb-3 text-xs font-black ${TEAM_META[color].header}`}>
        {TEAM_META[color].emoji} {teamLabel(color)}
      </h4>
      {/* No hairline between rows: the card's own background swings from a
          dark shirt to a cream one, and one divider colour cannot read on
          both. Grouping is done with space instead — a name sits `mt-1` from
          its own sentence and `space-y-4` from the next player, so the pair
          reads as one block rather than as four evenly-spaced lines. That gap
          being bigger than the one inside a row is the whole of what makes
          this legible. */}
      <ul className="space-y-4">
        {players.map((p) => (
          <PlayerRow
            key={p.id}
            p={p}
            grade={shown[p.id]?.grade ?? p.grade}
            line={shown[p.id]?.text}
          />
        ))}
      </ul>
    </div>
  );
}

// The reason, verbatim where there is one — the same principle `NightPage`'s
// `say` follows for the report, and largely the same wording: it is the same
// worker, the same waterfall, and the same handful of ways it says no.
const say = (error: string, detail?: string): string =>
  error === 'not-configured'
    ? t('marks.err.notConfigured')
    : error === 'wrong-word'
      ? t('marks.err.wrongWord')
      : error === 'rate-limited'
        ? t('marks.err.rateLimited')
        : error === 'too-many-grades'
          ? t('marks.err.tooMany')
          : error === 'unavailable'
            ? `${t('marks.err.unavailable')}${detail ? ` — ${detail}` : ''}`
            : t('marks.err.unreachable');

export default function NightGrades({ fixture, history, players, adminWord = null }: Props) {
  // Grades belong to the night, exactly like the report: asked for when the
  // page opens this fixture, dropped when it moves to another one.
  const [saved, setSaved] = useState<StoredGrades | null>(null);
  const [draft, setDraft] = useState<GradeLines | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<'writing' | 'saving' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSaved(null);
    setDraft(null);
    setMissing([]);
    setFailed(null);
    fetchGrades(fixture.id, history).then((g) => {
      if (!cancelled) setSaved(g);
    });
    return () => {
      cancelled = true;
    };
    // `history` is read by the sandbox branch of `fetchGrades`, so it belongs
    // here — it is the app's own state object and stable between edits, so
    // listing it costs a refetch when a night is corrected and nothing
    // otherwise.
  }, [fixture.id, history]);

  // Null on a night with no result — the same night `nightGrades` itself
  // refuses, since there is nothing to grade. The whole section renders
  // nothing rather than an empty shell asking to be filled in.
  const facts = gradesFacts(fixture, history, players);
  if (!facts) return null;

  const write = async () => {
    setBusy('writing');
    setFailed(null);
    const out = await draftGrades(fixture.id, facts, adminWord ?? '', history);
    setBusy(null);
    if ('error' in out) return setFailed(say(out.error, out.detail));
    setDraft(out.lines);
    setMissing(out.missing ?? []);
  };

  const keep = async () => {
    if (!draft) return;
    setBusy('saving');
    const out = await saveGrades(fixture.id, draft, adminWord ?? '');
    setBusy(null);
    if ('error' in out) return setFailed(say(out.error, out.detail));
    setSaved({ lines: draft, at: Date.now() });
    setDraft(null);
    setMissing([]);
  };

  const forget = async () => {
    if (!confirm(t('marks.delete.confirm'))) return;
    const out = await clearGrades(fixture.id, adminWord ?? '');
    if ('error' in out) return setFailed(say(out.error, out.detail));
    setSaved(null);
  };

  const shown = publishedMarks(draft ?? saved?.lines ?? null, facts.players);

  const share = () => {
    const lines = TEAM_COLORS.flatMap((c) => {
      const team = facts.players.filter((p) => p.team === c);
      if (team.length === 0) return [];
      return [
        `${teamLabel(c)}:`,
        ...team.map((p) => {
          const mark = shown[p.id]?.grade ?? p.grade;
          const line = shown[p.id]?.text;
          return `  ${p.name} — ${fmtRating(mark)}${line ? ` — ${line}` : ''}`;
        }),
      ];
    });
    const text = `${fixture.date}\n\n${lines.join('\n')}`;
    if (navigator.share) void navigator.share({ text }).catch(() => {});
    else void navigator.clipboard?.writeText(text);
  };

  // Nothing published, and no admin standing by to write some — the same gate
  // the report uses, so a section that would only ever show a "write" button
  // does not sit on the page for everyone who cannot press it.
  if (!saved && !draft && !adminWord) return null;

  return (
    <section className="rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-black uppercase tracking-wide text-amber-900/45">
          {t('marks.title')}
        </h3>
        {saved && !draft && (
          <span className="text-[10px] text-amber-900/35">
            {t('marks.written', { date: fmtDate(saved.at, getLang(), {}) })}
          </span>
        )}
        {draft && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700/70">
            {t('marks.draft')}
          </span>
        )}
      </div>

      {(saved || draft) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {TEAM_COLORS.map((c) => (
            <TeamGroup
              key={c}
              color={c}
              players={facts.players.filter((p) => p.team === c)}
              shown={shown}
            />
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-2 text-xs text-amber-900/50">
          {t('marks.noLine', { names: missing.join(', ') })}
        </p>
      )}

      {failed && (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs text-red-700">{failed}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(saved || draft) && (
          <button
            onClick={share}
            className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
          >
            {t('marks.share')}
          </button>
        )}
        {adminWord && (
          <>
            <button
              onClick={write}
              disabled={busy !== null}
              className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105 disabled:opacity-50"
            >
              {busy === 'writing'
                ? t('marks.writing')
                : saved || draft
                  ? t('marks.writeAnother')
                  : t('marks.write')}
            </button>
            {draft && (
              <>
                <button
                  onClick={keep}
                  disabled={busy !== null}
                  className="rounded-lg border border-emerald-600/50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {busy === 'saving' ? t('marks.saving') : t('marks.publish')}
                </button>
                <button
                  onClick={() => {
                    setDraft(null);
                    setMissing([]);
                  }}
                  className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  {t('marks.discard')}
                </button>
              </>
            )}
            {saved && !draft && (
              <button
                onClick={forget}
                className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                {t('marks.delete')}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
