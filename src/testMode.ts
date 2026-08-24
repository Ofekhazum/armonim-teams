// Test mode (§2.32): a whole fake club, on this device, for one browser tab.
//
// Most of what has been built this year needs a season behind it before it
// shows anything — the career table, the timeline, market value, duos, arcs,
// the reporter. With sixteen real nights on record most of it is either blank
// or on the wrong side of a threshold, which makes it impossible to review and
// very easy to sign off something broken. This is twenty players and twenty
// nights of invented football to look at it all against.
//
// **The entire design problem is not destroying the real club.** The live app
// keeps its state in one localStorage key and republishes the *whole* roster
// and the *whole* archive whenever an admin device saves anything. A sandbox
// that shared either of those would eventually hand twenty invented players to
// fifteen real phones. So the isolation is not a check somewhere, it is three
// structural facts:
//
//   1. **A different storage key.** `armonim-teams-test-v1`. The live key is
//      never opened while test mode is on, and the test key is never opened
//      while it is off — decided once, at module load, before any component
//      renders, so there is no moment when the two could cross.
//   2. **No network at all.** `REMOTE_URL` is forced to `''`, and every remote
//      function in this app already begins `if (!REMOTE_URL) return …`. That
//      is a verified kill switch rather than a promise: nothing can be
//      published, pulled, gone live with or notified about, because the code
//      that would do it returns before it builds a request.
//   3. **Entering and leaving reload the page.** Nothing carries over in
//      memory, and the module-level constants above are recomputed from
//      scratch. A sandbox that started by inheriting live React state would be
//      one bug away from writing it back.
//
// **`sessionStorage`, not `localStorage`**, and that is the safety property
// worth keeping: test mode dies with the tab. Forgetting to leave it is the
// obvious human error here, and this makes the consequence "closed the tab"
// rather than "the phone has been showing fake data for a week".

const FLAG = 'armonim-test-mode';

/** What you type at the padlock to get in. Never sent anywhere. */
export const TEST_WORD = 'test_mode';

// Read once, at module load, and cached. Deliberately *not* re-read: a value
// that could change between two calls in the same render is a value that could
// have the app reading one club and writing to the other.
let active: boolean;
try {
  active = sessionStorage.getItem(FLAG) === 'on';
} catch {
  // storage blocked (private mode) — live is the safe answer
  active = false;
}

export const isTestMode = (): boolean => active;

/**
 * Switch in or out, and reload.
 *
 * The reload is not a convenience. It is what guarantees that no state, no
 * pending fetch and no cached module constant from one club is alive while the
 * other is on screen.
 */
export function setTestMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(FLAG, 'on');
    else sessionStorage.removeItem(FLAG);
  } catch {
    return;
  }
  window.location.reload();
}
