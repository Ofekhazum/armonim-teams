import { useCallback, useEffect, useState } from 'react';
import type { VoiceStatus } from '../recapVoice';
import { fetchSentText, fetchVoiceFile, fetchVoiceStatus, shareVoiceFile, startVoice } from '../recapVoice';
import { t } from '../i18n';

// The recap, read aloud (§2.69) — the organiser's taps under the report.
//
// Tap one asks for it. The Worker answers at once and does the work on an
// alarm, so this polls a public status route until the file exists, then
// fetches it into memory, where it plays in the page (§2.72) and waits to be
// shared. Sharing is a tap of its own: the share sheet needs a fresh user
// gesture, and the one that started a recording that took three minutes is
// long gone by the time there is something to share.

const POLL_MS = 5000;

interface Props {
  fixtureId: string;
  date: string;
  adminWord: string;
  // when the stored recap was written — a new one means the old audio is stale
  recapAt: number;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function RecapVoice({ fixtureId, date, adminWord, recapAt }: Props) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'working' | 'fetching'>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // TEMPORARY (§2.71): the text the voice was sent. undefined = hidden, null = none to show.
  const [sent, setSent] = useState<{ text: string; raw?: string } | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setSent(undefined);
    setFile(null);
    setFailed(null);
    setPhase('idle');
    fetchVoiceStatus(fixtureId).then((s) => {
      if (cancelled) return;
      setStatus(s);
      // one already running — from before the page was closed, or another device
      if (s?.status === 'working') setPhase('working');
    });
    return () => {
      cancelled = true;
    };
  }, [fixtureId, recapAt]);

  // The same file the share sheet gets, played from memory. No second fetch, and
  // nothing is stored: the URL lives and dies with the file.
  useEffect(() => {
    if (!file) {
      setPlayUrl(null);
      return;
    }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
    } catch {
      // no player on a browser that cannot make one; sharing still works
    }
    setPlayUrl(url);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const collect = useCallback(async () => {
    setPhase('fetching');
    const got = await fetchVoiceFile(fixtureId, date, adminWord);
    setPhase('idle');
    if (got) setFile(got);
    else setFailed(t('np.voice.err.noFile'));
  }, [fixtureId, date, adminWord]);

  useEffect(() => {
    if (phase !== 'working') return;
    let cancelled = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const s = await fetchVoiceStatus(fixtureId);
      if (cancelled || !s) return;
      setStatus(s);
      if (s.status === 'ready') void collect();
      else if (s.status !== 'working') {
        setPhase('idle');
        if (s.status === 'failed') {
          setFailed(t('np.voice.err.failed', { detail: s.error ? ` — ${s.error}` : '' }));
        }
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [phase, fixtureId, collect]);

  const create = async (fresh: boolean) => {
    setFailed(null);
    setFile(null);
    setPhase('starting');
    const out = await startVoice(fixtureId, adminWord, fresh);
    if ('error' in out) {
      setPhase('idle');
      setFailed(
        out.error === 'wrong-word'
          ? t('marks.err.wrongWord')
          : out.error === 'rate-limited'
            ? t('marks.err.rateLimited')
            : out.error === 'too-many'
              ? t('np.voice.err.tooMany')
              : out.error === 'not-generated'
                ? t('np.voice.handWritten')
                : out.error === 'not-configured'
                  ? t('np.voice.err.notConfigured')
                  : t('np.voice.err.unreachable'),
      );
      return;
    }
    setStatus(out);
    setNow(Date.now());
    // a take already on file for this exact recap comes straight back
    if (out.status === 'ready') void collect();
    else setPhase('working');
  };

  const share = async () => {
    if (!file) return;
    if ((await shareVoiceFile(file, t('np.voice.shareText'))) === 'failed') {
      setFailed(t('np.voice.err.share'));
    }
  };

  const toggleSent = async () => {
    if (sent !== undefined) return setSent(undefined);
    setSent(await fetchSentText(fixtureId, adminWord));
  };

  if (!status?.configured) return null;
  if (!status.voiceable) {
    return <p className="mt-2 text-xs text-amber-900/50">{t('np.voice.handWritten')}</p>;
  }

  const busy = phase !== 'idle';
  return (
    <div className="mt-3 border-t border-amber-900/10 pt-3">
      {file && playUrl && (
        <audio
          controls
          preload="metadata"
          src={playUrl}
          dir="ltr"
          aria-label={t('np.voice.player')}
          className="mb-2 h-9 w-full"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {file ? (
          <>
            <button
              onClick={share}
              className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-bold text-amber-50 hover:scale-105"
            >
              {t('np.voice.share')}
            </button>
            <button
              onClick={() => create(true)}
              className="rounded-lg border border-amber-900/25 px-3 py-1 text-xs font-bold text-amber-900 hover:border-orange-500"
            >
              {t('np.voice.again')}
            </button>
          </>
        ) : (
          <button
            onClick={() => create(false)}
            disabled={busy}
            className="rounded-lg border border-orange-600/60 px-3 py-1 text-xs font-bold text-orange-800 hover:bg-orange-50 disabled:opacity-60"
          >
            {phase === 'working'
              ? t(status.phase === 'queued' ? 'np.voice.queued' : 'np.voice.working', {
                  time: clock(now - (status.startedAt ?? now)),
                })
              : busy
                ? t('np.voice.fetching')
                : status.status === 'ready'
                  ? t('np.voice.listen')
                  : t('np.voice.create')}
          </button>
        )}
      </div>
      {file && status.pointed !== undefined && (
        <p className="mt-1.5 text-[11px] text-amber-900/50">
          {status.pointed
            ? status.pointNote
              ? t('np.voice.pointedSome', { note: status.pointNote })
              : t('np.voice.pointed')
            : t('np.voice.unpointed', { note: status.pointNote ?? '?' })}
        </p>
      )}
      {/* TEMPORARY: what the voice was sent, to see whether it had niqqud. Remove with
          the Worker's `sent` route once pointing is trusted (DESIGN.md §2.71). */}
      {status.status !== 'none' && (
        <div className="mt-2">
          <button
            onClick={toggleSent}
            className="text-[11px] font-bold text-amber-900/60 underline hover:text-orange-700"
          >
            {sent === undefined ? t('np.voice.sent.show') : t('np.voice.sent.hide')}
          </button>
          {sent === null && <p className="mt-1 text-[11px] text-amber-900/50">{t('np.voice.sent.none')}</p>}
          {sent && (
            <>
              <p className="mt-1 text-[11px] text-amber-900/50">
                {t('np.voice.sent.points', { n: (sent.text.match(/[\u05B0-\u05BC\u05C1\u05C2\u05C7]/g) ?? []).length })}
              </p>
              <pre
                dir="rtl"
                className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-amber-50 p-2 text-sm leading-relaxed text-amber-950"
              >
                {sent.text}
              </pre>
              {sent.raw && (
                <>
                  <p className="mt-2 text-[11px] text-amber-900/50">{t('np.voice.sent.raw')}</p>
                  <pre
                    dir="rtl"
                    className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-orange-50 p-2 text-sm leading-relaxed text-amber-950"
                  >
                    {sent.raw}
                  </pre>
                </>
              )}
            </>
          )}
        </div>
      )}
      {phase === 'working' && (
        <p className="mt-1.5 text-[11px] text-amber-900/50">
          {t(status.phase === 'queued' ? 'np.voice.queuedHint' : 'np.voice.workingHint')}
        </p>
      )}
      {failed && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-red-700">{failed}</p>}
    </div>
  );
}
