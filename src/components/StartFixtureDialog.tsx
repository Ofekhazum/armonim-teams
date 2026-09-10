import { useState } from 'react';
import {
  MAX_SCHEDULE_AHEAD_MS,
  isSchedulable,
  nextThursday7pm,
  parseLocalKickoff,
  toLocalInputValue,
} from '../kickoff';
import { useScrollLock } from '../scrollLock';
import { t } from '../i18n';

interface Props {
  onStartNow: () => void;
  onSchedule: (startedAt: number) => void;
  onCancel: () => void;
}

// What ▶️ Start fixture opens to now, instead of starting the night outright
// (§2.7.2). Teams often get picked a day ahead of the fixture itself — this is
// the way to lock them in without putting the night live for the group early.
export default function StartFixtureDialog({ onStartNow, onSchedule, onCancel }: Props) {
  const [mode, setMode] = useState<'pick' | 'schedule'>('pick');
  const [value, setValue] = useState(() => toLocalInputValue(nextThursday7pm()));
  const [error, setError] = useState<string | null>(null);
  useScrollLock(true);

  const confirmSchedule = () => {
    const at = parseLocalKickoff(value);
    if (at === null || !isSchedulable(at)) {
      setError(t('start.schedule.error'));
      return;
    }
    onSchedule(at);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-amber-950/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-900/20 bg-[#fffdf4] p-5 shadow-xl">
        {mode === 'pick' ? (
          <>
            <h3 className="text-lg font-black text-amber-950">{t('start.title')}</h3>
            <p className="mt-2 text-sm text-amber-900/70">{t('start.body')}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={onStartNow}
                className="rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-[1.02]"
              >
                {t('start.now')}
              </button>
              <button
                onClick={() => setMode('schedule')}
                className="rounded-xl border border-amber-900/25 px-4 py-2 text-sm font-bold text-amber-900 hover:border-orange-500"
              >
                {t('start.later')}
              </button>
              <button
                onClick={onCancel}
                className="rounded-xl border border-amber-900/25 px-4 py-2 text-sm font-bold text-amber-900 hover:border-orange-500"
              >
                {t('start.notYet')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-black text-amber-950">{t('start.schedule.title')}</h3>
            <p className="mt-2 text-sm text-amber-900/70">{t('start.schedule.body')}</p>
            <input
              type="datetime-local"
              value={value}
              min={toLocalInputValue(new Date())}
              max={toLocalInputValue(new Date(Date.now() + MAX_SCHEDULE_AHEAD_MS))}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className="mt-3 w-full rounded-xl border border-amber-900/25 bg-white px-3 py-2 text-sm text-amber-950 outline-none focus:border-orange-500"
            />
            {error && <p className="mt-1 text-xs font-semibold text-red-700">{error}</p>}
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={confirmSchedule}
                className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-amber-50 shadow-sm transition-transform hover:scale-[1.02]"
              >
                {t('start.schedule.confirm')}
              </button>
              <button
                onClick={() => setMode('pick')}
                className="rounded-xl border border-amber-900/25 px-4 py-2 text-sm font-bold text-amber-900 hover:border-orange-500"
              >
                {t('md.back')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
