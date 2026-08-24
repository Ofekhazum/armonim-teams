import { isTestMode, setTestMode } from '../testMode';

// The banner that makes test mode impossible to be in by accident (§2.32).
//
// The failure this exists to prevent is not technical. The isolation holds on
// its own — a different storage key and no network — so nothing the sandbox
// does can reach the club. What it cannot prevent is a person forgetting which
// club they are looking at, and then either trusting a number that is invented
// or reporting a bug against football that never happened.
//
// So it is loud and the way out is on it — but deliberately **not** `sticky`
// or `fixed`, and that is a correction rather than the original design. Player
// page, night page, pitch mode and the fixture page's own modals are all
// `fixed inset-0` panels at z-40 to z-50 (see scrollLock.ts), and a `sticky`
// banner is *also* a positioned element with its own stacking context — so a
// z-index above theirs did not make it "loud on top of everything", it made it
// paint over the top few centimetres of every one of those panels, which is
// exactly where their Back/Close/Edit buttons live. Ordinary flow has no
// stacking context at all, so a plain block can never out-rank a `fixed`
// panel regardless of which z-index either one is given — which is the
// property this actually needs, not a taller number.
//
// The trade a static block makes: it will not stay pinned while somebody
// scrolls down a long tab, the way the header above it does not either. Given
// the choice between "loses sight of the banner while scrolling" and
// "sometimes cannot press Back", the second is the one that must never happen.

export default function TestModeBanner() {
  if (!isTestMode()) return null;

  return (
    <div className="-mx-3 mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-dashed border-violet-500/50 bg-violet-500/15 px-3 py-2 text-center sm:-mx-6">
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
