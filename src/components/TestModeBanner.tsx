import { isTestMode, setTestMode } from '../testMode';

// The banner that makes test mode impossible to be in by accident (§2.32).
//
// The failure this exists to prevent is not technical. The isolation holds on
// its own — a different storage key and no network — so nothing the sandbox
// does can reach the club. What it cannot prevent is a person forgetting which
// club they are looking at, and then either trusting a number that is invented
// or reporting a bug against football that never happened.
//
// So it is loud, it is fixed to the top of every tab, and the way out is on
// it. Deliberately not dismissible: a banner you can close is a banner that is
// closed at the exact moment it matters.

export default function TestModeBanner() {
  if (!isTestMode()) return null;

  return (
    <div className="sticky top-0 z-[60] -mx-3 mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-dashed border-violet-500/50 bg-violet-500/15 px-3 py-2 text-center backdrop-blur sm:-mx-6">
      <span className="text-sm font-black uppercase tracking-wide text-violet-900">
        🧪 Test mode — invented club
      </span>
      <span className="text-[11px] font-semibold text-violet-900/70">
        20 players, 20 nights. Nothing here is published, and the real club is untouched.
      </span>
      <button
        onClick={() => setTestMode(false)}
        className="rounded-lg border border-violet-700/40 bg-white/70 px-2.5 py-1 text-xs font-black text-violet-900 transition-colors hover:border-violet-700"
      >
        ← Back to the real club
      </button>
    </div>
  );
}
