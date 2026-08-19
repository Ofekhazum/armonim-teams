import { useEffect, useState } from 'react';
import {
  disableNotifications,
  enableNotifications,
  notificationsConfigured,
  notifyEnabled,
  pushSupport,
} from '../push';

// Per-device opt-in for the match-clock announcements (§2.17). Off by default,
// and off means off: granting a browser permission once, months ago, is not
// consent to be buzzed every Thursday forever — this toggle is what decides,
// and turning it off drops the subscription server-side rather than just
// hiding the button.
// Alerts are asked for one night at a time (§2.17), so the toggle is about
// *this* fixture: there is nothing to be alerted about without one, and last
// week's yes is not this week's.
export default function NotifyToggle({ fixtureId }: { fixtureId: string | null }) {
  const [on, setOn] = useState(() => notifyEnabled(fixtureId));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // undefined while we're still asking — render nothing rather than flashing a
  // control that might be about to disappear
  const [configured, setConfigured] = useState<boolean | undefined>(undefined);
  const support = pushSupport();

  useEffect(() => {
    let cancelled = false;
    void notificationsConfigured().then((yes) => !cancelled && setConfigured(yes));
    return () => {
      cancelled = true;
    };
  }, []);

  // A new night starting under a mounted toggle has to reset it — the opt-in
  // it is reporting belongs to the fixture, not to the device.
  useEffect(() => setOn(notifyEnabled(fixtureId)), [fixtureId]);

  // Nothing live means nothing to be alerted about, and no night to attach an
  // opt-in to. The organiser's clock exists before a fixture is published;
  // this doesn't.
  if (fixtureId === null) return null;
  if (support === 'not-configured' || configured !== true) return null;

  // On an iPhone the API simply isn't there until the site has been added to
  // the Home Screen, so saying "not supported" would be both wrong and a dead
  // end. Tell them the one step that fixes it instead.
  if (support === 'needs-install') {
    return (
      <span
        className="text-[11px] leading-tight text-amber-900/50"
        title="Apple only allows notifications for web apps installed to the Home Screen"
      >
        🔔 For match alerts: Share → <b>Add to Home Screen</b>, then open it from there
      </span>
    );
  }

  if (support === 'unsupported') return null;

  const toggle = async () => {
    setBusy(true);
    setNote(null);
    if (on) {
      await disableNotifications();
      setOn(false);
    } else {
      const { result, message } = await enableNotifications(fixtureId);
      if (result === 'ok') setOn(true);
      else {
        setOn(false);
        setNote(
          result === 'denied'
            ? 'Blocked in your browser settings'
            : result === 'not-configured'
              ? 'Not set up on the server yet'
              : // the browser's own words, because "try again" is advice that
                // has never once fixed this
                (message ?? "Couldn't turn on — try again"),
        );
      }
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
        title={
          on
            ? 'Stop this device buzzing at one minute left and full time'
            : 'Buzz this device at one minute left and full time, even with the screen off'
        }
        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
          on
            ? 'border-orange-500 bg-orange-500/10 text-orange-700'
            : 'border-amber-900/25 text-amber-900 hover:border-orange-500'
        }`}
      >
        {busy ? '…' : on ? '🔔 Alerts on' : '🔕 Alerts off'}
      </button>
      {note && (
        <span className="max-w-[16rem] text-right text-[10px] leading-tight text-red-700">
          {note}
        </span>
      )}
    </div>
  );
}
