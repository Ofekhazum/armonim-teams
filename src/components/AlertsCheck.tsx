import { useState } from 'react';
import { testPush, type PushReport } from '../push';
import { t } from '../i18n';

// NOT CURRENTLY RENDERED. It found the bug it was built for (Apple was
// rejecting the VAPID token) and was taken out of the header once alerts
// worked, rather than deleted: the failure it diagnoses is silence, so the
// next time there is nothing to look at, this is the thing to put back. One
// import in App.tsx. The `POST /push/test` endpoint behind it is still live
// and still admin-gated, so it remains usable from curl in the meantime.
//
// Why this exists: a push notification that doesn't arrive leaves no trace
// anywhere a person can look. The browser reports success, the Worker reports
// success, the push service returns 201, and the phone stays quiet — and there
// are five links in that chain, each of which fails exactly that way.
//
// So this walks the chain out loud. It buzzes *this* device now (never the
// group — see /test in clock-notifier.js) and prints what each link said, so
// "no notification" turns into a line with an ✗ next to it.
//
// Organiser-only, because pressing it makes a phone vibrate.

const seconds = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className={ok ? 'text-amber-900/70' : 'font-bold text-red-700'}>
      {ok ? '✓' : '✗'} {children}
    </div>
  );
}

function Report({ report }: { report: PushReport }) {
  const push = report.sent[0];
  const next = report.pending.length
    ? report.pending.reduce((a, b) => (a.at < b.at ? a : b))
    : null;

  return (
    <div className="mt-1 space-y-0.5 text-left text-[10px] leading-tight">
      <Line ok={report.configured}>
        {report.configured ? t('alerts.configured') : t('alerts.noVapid')}
      </Line>
      <Line ok={!report.noEndpoint && report.known}>
        {report.noEndpoint
          ? t('alerts.neverSubscribed')
          : report.known
            ? t('alerts.subscribed', { n: report.subscribers })
            : t('alerts.unknownHere')}
      </Line>
      {push && (
        <Line ok={push.status >= 200 && push.status < 300}>
          {t('alerts.answered', { host: push.host, status: push.status })}
          {push.detail ? ` — ${push.detail}` : ''}
        </Line>
      )}
      {/* A push service that dislikes the VAPID setup says so in one word for
          three different faults. These are those three, told apart — shown
          only when something actually went wrong, since on a working
          deployment they are just noise. */}
      {push && (push.status < 200 || push.status > 299) && (
        <>
          <Line ok={report.keyOk}>
            {report.keyOk ? t('alerts.keyOk') : t('alerts.keyBad')}
          </Line>
          <Line ok={/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(report.subject)}>
            {t('alerts.subject', { subject: report.subject })}
          </Line>
          <Line ok={report.keyMatchesSubscription !== false}>
            {report.keyMatchesSubscription === false
              ? t('alerts.keyMismatch')
              : report.keyMatchesSubscription === null
                ? t('alerts.keyUnknown')
                : t('alerts.keyMatches')}
          </Line>
        </>
      )}
      <Line ok={next !== null}>
        {next
          ? t('alerts.next', { kind: next.kind, in: seconds(next.at - report.now) })
          : t('alerts.nothingScheduled')}
      </Line>
      {push && push.status >= 200 && push.status < 300 && (
        <div className="text-amber-900/50">
          {t('alerts.sent')}
        </div>
      )}
    </div>
  );
}

export default function AlertsCheck({ adminWord }: { adminWord: string }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PushReport | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    const result = await testPush(adminWord);
    if (result) setReport(result);
    else setFailed(true);
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={run}
        disabled={busy}
        title={t('alerts.test.title')}
        className="rounded-lg border border-amber-900/25 px-2.5 py-1 text-[11px] font-bold text-amber-900 transition-colors hover:border-orange-500 disabled:opacity-50"
      >
        {busy ? '…' : t('alerts.test')}
      </button>
      {failed && (
        <span className="mt-1 text-[10px] text-red-700">{t('alerts.unreachable')}</span>
      )}
      {report && <Report report={report} />}
    </div>
  );
}
