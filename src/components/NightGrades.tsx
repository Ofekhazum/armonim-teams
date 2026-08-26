import { useEffect, useState } from 'react';
import type { FixtureRecord, Player, TeamColor } from '../types';
import { TEAM_COLORS } from '../balancer';
import { gradesFacts, type GradeFactLine } from '../gradesFacts';
import type { GradeLines, StoredGrades } from '../gradesApi';
import { clearGrades, draftGrades, fetchGrades, publishedMarks, saveGrades } from '../gradesApi';
import { Name, TEAM_META, fmtRating } from './ui';

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

// Three plain tones rather than a gradient, because a mark is read once and at
// a glance — the same reasoning `PriceTag`'s up/down/flat chip follows.
// Thresholds come straight off the calibration in grades.ts: the middle band
// is everything between the p10 and p90 of an ordinary season, so "standout"
// and "rough" both mean roughly one night in ten.
const GRADE_TONE = {
  standout: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800',
  ordinary: 'border-amber-900/15 bg-white/60 text-amber-900/70',
  rough: 'border-rose-600/25 bg-rose-500/10 text-rose-800',
} as const;

const toneOf = (grade: number) => (grade >= 8 ? 'standout' : grade <= 4 ? 'rough' : 'ordinary');

function GradeChip({ grade }: { grade: number }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[11px] font-black tabular-nums ${GRADE_TONE[toneOf(grade)]}`}
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
          {p.isMvp && <span title="Player of the night">🌟</span>}
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
        {TEAM_META[color].emoji} {TEAM_META[color].label}
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
    ? 'No joker on this deployment: the worker has no GEMINI_KEY set.'
    : error === 'wrong-word'
      ? 'That admin word was refused.'
      : error === 'rate-limited'
        ? 'Too many attempts from here. Give it ten minutes.'
        : error === 'too-many-grades'
          ? 'That is a dozen sets of marks in an hour. Give it a rest and try later.'
          : error === 'unavailable'
            ? `Gemini turned it down${detail ? ` — ${detail}` : ''}`
            : 'Could not reach the joker.';

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
    if (!confirm('Delete these marks for everyone?')) return;
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
        `${TEAM_META[c].label}:`,
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
          📋 The marks
        </h3>
        {saved && !draft && (
          <span className="text-[10px] text-amber-900/35">
            written {new Date(saved.at).toLocaleDateString()}
          </span>
        )}
        {draft && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700/70">
            draft — nobody else can see this yet
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
        <p className="mt-2 text-xs text-amber-900/50">no line for {missing.join(', ')}</p>
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
            📤 Share
          </button>
        )}
        {adminWord && (
          <>
            <button
              onClick={write}
              disabled={busy !== null}
              className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105 disabled:opacity-50"
            >
              {busy === 'writing' ? 'writing…' : saved || draft ? '↻ Write another' : '✍️ Write the marks'}
            </button>
            {draft && (
              <>
                <button
                  onClick={keep}
                  disabled={busy !== null}
                  className="rounded-lg border border-emerald-600/50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {busy === 'saving' ? 'saving…' : '✓ Publish this one'}
                </button>
                <button
                  onClick={() => {
                    setDraft(null);
                    setMissing([]);
                  }}
                  className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
                >
                  Discard
                </button>
              </>
            )}
            {saved && !draft && (
              <button
                onClick={forget}
                className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                🗑️ Delete
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
