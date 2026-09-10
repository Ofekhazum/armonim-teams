// Holding the page still behind a full-screen overlay (§2.26).
//
// The app has three of them — a player's page, a night's page, and pitch mode
// — and all three are `fixed inset-0` over a document that is still perfectly
// scrollable underneath. On a desktop that is untidy. On a phone it is the bug
// that gets reported as "the scrolling is stuck and you can see behind the
// page", and it is really three bugs wearing one description:
//
//   1. **Scroll chaining.** A swipe that reaches the end of the overlay keeps
//      going and starts moving the document instead. The overlay stops
//      responding — "stuck" — and what is actually moving is the thing behind
//      it. `overscroll-contain` on the scroller stops this half.
//
//   2. **Rubber-banding.** iOS lets the *document* bounce past its ends, and
//      while it bounces, `position: fixed` elements bounce with it — so the
//      overlay slides and the page underneath appears at the edge. Nothing on
//      the overlay can prevent this. The document has to stop being scrollable.
//
//   3. **The URL bar.** Scrolling the document behind collapses and expands
//      Safari's chrome, which resizes the viewport that `inset-0` is measured
//      against. The overlay jumps. Same cause, same fix.
//
// So: `position: fixed` on the body, offset by the scroll position it had, and
// put back on the way out. `overflow: hidden` alone is not enough — iOS Safari
// has ignored it on `body` for touch scrolling for years, which is why this
// looks more elaborate than it should have to be.
//
// 4. **Full-page screenshots capturing the page behind** (§2.43). A fixed body
//    is out of the document's flow, but it keeps its *content* height — a
//    twenty-row roster is still a 2,000px box, it is just pinned to the
//    viewport. "Capture full page" tools (phone browsers' long-screenshot,
//    Playwright's `fullPage`, screenshot extensions) size their capture from
//    that, then photograph a viewport-sized overlay against it: the shot runs
//    past the bottom of the player's page and into the roster list underneath.
//    Pinning the locked body to the viewport height, and clipping the document
//    element with it, makes the capture's idea of "the whole page" the same
//    size as the overlay it is actually looking at. Matters most on the player
//    page, which exists to be screenshotted and shared (§2.19).

import { useEffect } from 'react';

// Module-level rather than per-hook, because two overlays can legally be open
// at once and the second one closing must not unlock a page the first one is
// still covering. The saved offset belongs to the outermost lock — it is where
// the reader was before any of this started, and where they expect to be put
// back.
let locks = 0;
let savedY = 0;

/**
 * Freeze the document while this component is mounted.
 *
 * Pass `false` to hold the lock open conditionally — the hook still runs, so
 * the rules of hooks are kept, and nothing is locked.
 */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;

    if (locks === 0) {
      savedY = window.scrollY;
      const { style } = document.body;
      style.position = 'fixed';
      style.top = `-${savedY}px`;
      style.left = '0';
      style.right = '0';
      style.width = '100%';
      // Viewport-tall, not content-tall — see note 4 above. The body is fixed,
      // so 100% resolves against the viewport; the saved offset is added back
      // because the body is also pulled up by exactly that much, and a plain
      // 100% would stop short of the viewport's bottom edge by the same
      // amount — invisible behind the overlay, but a strip of bare page in a
      // full-page capture.
      style.height = `calc(100% + ${savedY}px)`;
      // belt and braces: the body being fixed is what actually does it, but
      // this stops a stray scrollbar appearing on desktop as it happens
      style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }
    locks++;

    return () => {
      locks--;
      if (locks > 0) return;
      const { style } = document.body;
      style.position = '';
      style.top = '';
      style.left = '';
      style.right = '';
      style.width = '';
      style.height = '';
      style.overflow = '';
      document.documentElement.style.overflow = '';
      // Instantly, and not with whatever `scroll-behavior` is in force: a
      // closing overlay that then animates the page back into place looks
      // like the app losing its footing rather than like a restoration.
      const root = document.documentElement.style;
      const wasSmooth = root.scrollBehavior;
      root.scrollBehavior = 'auto';
      window.scrollTo(0, savedY);
      root.scrollBehavior = wasSmooth;
    };
  }, [active]);
}
