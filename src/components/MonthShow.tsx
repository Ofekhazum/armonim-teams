import { useEffect, useState } from 'react';
import type { Persona, StoredRecap } from '../recap';
import { clearMonthShow, draftMonthShow, monthShowId, readMonthShow, saveMonthShow } from '../monthShow';
import { periodLabel } from '../wrapped';
import { fmtDate, getLang, t } from '../i18n';
import RecapVoice from './RecapVoice';

// The month's show (§2.74): write it, read the draft, publish it, record it.
//
// The night page's report block, for a month — the same taps in the same
// order, and the same voice component under the published text. Two
// differences, both decided: the text lives only here, on the organiser's
// workbench, and the only months offered are ones with a registered Team of
// the Month, since the show ends on it.

// The night page's reporters, with its labels. Its own map rather than an
// import from NightPage, so this feature touches nothing it does not own —
// and typed by `Persona`, so a persona added to the app and not here is a
// compile error rather than a month that cannot pick it.
const PERSONA_LABELS: Record<Persona, Parameters<typeof t>[0]> = {
  default: 'np.report.persona.default',
  zahavi: 'np.report.persona.zahavi',
  bibi: 'np.report.persona.bibi',
  swissa: 'np.report.persona.swissa',
};
const PERSONA_OPTIONS = Object.keys(PERSONA_LABELS) as Persona[];

interface Props {
  // finished months with a registered team, newest first
  periods: string[];
  adminWord: string;
}

export default function MonthShow({ periods, adminWord }: Props) {
  const [period, setPeriod] = useState(periods[0] ?? '');
  const [saved, setSaved] = useState<StoredRecap | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState<'writing' | 'saving' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [persona, setPersona] = useState<Persona>('default');

  useEffect(() => {
    if (!periods.includes(period)) setPeriod(periods[0] ?? '');
  }, [periods, period]);

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    setSaved(null);
    setDraft(null);
    setFailed(null);
    readMonthShow(period, adminWord).then((s) => {
      if (!cancelled) setSaved(s);
    });
    return () => {
      cancelled = true;
    };
  }, [period, adminWord]);

  if (periods.length === 0) {
    return <p className="text-sm text-amber-900/50">{t('tools.show.none')}</p>;
  }

  // The night page's wording for every failure the two share.
  const say = (error: string, detail?: string) =>
    setFailed(
      error === 'not-ready'
        ? t('tools.show.err.notReady')
        : error === 'not-configured'
          ? t('np.report.err.notConfigured')
          : error === 'wrong-word'
            ? t('marks.err.wrongWord')
            : error === 'rate-limited'
              ? t('marks.err.rateLimited')
              : error === 'too-many-recaps'
                ? t('np.report.err.tooMany')
                : error === 'unavailable'
                  ? `${t('marks.err.unavailable')}${detail ? ` — ${detail}` : ''}`
                  : t('np.report.err.unreachable'),
    );

  const write = async () => {
    setBusy('writing');
    setFailed(null);
    const out = await draftMonthShow(period, adminWord, persona);
    setBusy(null);
    if ('error' in out) say(out.error, out.detail);
    else setDraft(out.text);
  };

  const keep = async () => {
    if (!draft) return;
    setBusy('saving');
    const out = await saveMonthShow(period, draft, adminWord);
    setBusy(null);
    if ('error' in out) return say(out.error, out.detail);
    setSaved({ text: draft, at: 'at' in out && out.at ? out.at : Date.now() });
    setDraft(null);
  };

  const forget = async () => {
    if (!confirm(t('tools.show.deleteConfirm'))) return;
    const out = await clearMonthShow(period, adminWord);
    if ('error' in out) return say(out.error, out.detail);
    setSaved(null);
  };

  const shown = draft ?? saved?.text;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-900/15 bg-[#fffdf4]/70 p-4 shadow-sm">
      <p className="text-xs text-amber-900/60">{t('tools.show.hint')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          disabled={busy !== null}
          aria-label={t('tools.show.month')}
          className="rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500 disabled:opacity-50"
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </select>
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value as Persona)}
          disabled={busy !== null}
          aria-label={t('np.report.persona.label')}
          className="rounded-lg border border-amber-900/25 bg-white px-2 py-1.5 text-sm font-semibold text-amber-950 outline-none focus:border-orange-500 disabled:opacity-50"
        >
          {PERSONA_OPTIONS.map((key) => (
            <option key={key} value={key}>
              {t(PERSONA_LABELS[key])}
            </option>
          ))}
        </select>
      </div>

      {saved && !draft && (
        <div className="text-[11px] font-bold text-amber-900/40">
          {t('np.report.written', { date: fmtDate(saved.at, getLang(), {}) })}
        </div>
      )}
      {draft && <div className="text-[11px] font-bold text-orange-700">{t('np.report.draft')}</div>}

      {shown ? (
        <p dir="rtl" className="whitespace-pre-wrap text-sm leading-relaxed text-amber-950">
          {shown}
        </p>
      ) : (
        <p className="text-sm text-amber-900/55">{t('tools.show.nothing')}</p>
      )}

      {failed && <p className="whitespace-pre-wrap break-words text-xs text-red-700">{failed}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={write}
          disabled={busy !== null || !period}
          className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105 disabled:opacity-50"
        >
          {busy === 'writing'
            ? t('np.report.writing')
            : shown
              ? t('np.report.writeAnother')
              : t('tools.show.write')}
        </button>
        {draft && (
          <>
            <button
              onClick={keep}
              disabled={busy !== null}
              className="rounded-lg border border-emerald-600/50 px-3 py-1 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {busy === 'saving' ? t('np.report.saving') : t('np.report.publish')}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
            >
              {t('np.report.discard')}
            </button>
          </>
        )}
        {saved && !draft && (
          <button
            onClick={forget}
            className="rounded-lg border border-red-500/50 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
          >
            {t('np.report.delete')}
          </button>
        )}
      </div>

      {/* Only the published show is recorded, in the voice of the persona
          that wrote it — the Worker decides that, not this page. */}
      {saved && !draft && (
        <RecapVoice
          fixtureId={monthShowId(period)}
          date={`month-${period}`}
          adminWord={adminWord}
          recapAt={saved.at}
          shareText={t('tools.show.shareText')}
        />
      )}
    </div>
  );
}
