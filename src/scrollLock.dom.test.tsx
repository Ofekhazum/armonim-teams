import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { useScrollLock } from './scrollLock';

// The overlay scroll lock (§2.26), which reached a phone as three symptoms of
// one bug and was fixed on reasoning alone, because there was no way to run a
// component. This is that gap closed: everything below is about the *document*
// rather than about a panel, which is the whole point of the fix — nothing an
// overlay does to itself can stop iOS rubber-banding the page behind it.

const Overlay = ({ active = true }: { active?: boolean }) => {
  useScrollLock(active);
  return <div>overlay</div>;
};

const bodyIsPinned = () => document.body.style.position === 'fixed';

describe('useScrollLock', () => {
  it('pins the document while it is mounted and lets go afterwards', () => {
    const { unmount } = render(<Overlay />);
    expect(bodyIsPinned()).toBe(true);
    unmount();
    expect(document.body.style.position).toBe('');
  });

  it('holds the page exactly where it was, and puts it back', () => {
    // `top: -scrollY` is what makes a pinned body look like it never moved;
    // without it the page jumps to the top the instant an overlay opens, which
    // the reader sees as the app losing its place.
    window.scrollY = 420;
    const { unmount } = render(<Overlay />);
    expect(document.body.style.top).toBe('-420px');

    let restored = -1;
    window.scrollTo = ((_x: number, y: number) => {
      restored = y;
    }) as typeof window.scrollTo;
    unmount();
    expect(restored).toBe(420);
    window.scrollY = 0;
  });

  it('stays locked while a second overlay is still open', () => {
    // A player page over a night page. The inner one closing must not unlock a
    // document the outer one is still covering — which is why the counter is
    // module-level rather than per-hook.
    const outer = render(<Overlay />);
    const inner = render(<Overlay />);
    inner.unmount();
    expect(bodyIsPinned()).toBe(true);
    outer.unmount();
    expect(bodyIsPinned()).toBe(false);
  });

  it('keeps the scroll position of the outermost lock', () => {
    // the reader was at 300 before any of this started; where the page happened
    // to be when the second overlay opened is not somewhere they ever were
    window.scrollY = 300;
    const outer = render(<Overlay />);
    window.scrollY = 0;
    const inner = render(<Overlay />);

    let restored = -1;
    window.scrollTo = ((_x: number, y: number) => {
      restored = y;
    }) as typeof window.scrollTo;
    inner.unmount();
    expect(restored).toBe(-1); // nothing restored yet — still covered
    outer.unmount();
    expect(restored).toBe(300);
  });

  it('does nothing at all when it is not active', () => {
    // the end-of-night dialog holds it conditionally, so an inactive hook has
    // to be genuinely inert rather than merely harmless
    const { unmount } = render(<Overlay active={false} />);
    expect(bodyIsPinned()).toBe(false);
    unmount();
    expect(bodyIsPinned()).toBe(false);
  });

  it('restores instantly rather than animating the page back', () => {
    // a closing overlay that then smooth-scrolls the page into place reads as
    // the app losing its footing
    document.documentElement.style.scrollBehavior = 'smooth';
    const { unmount } = render(<Overlay />);
    let behaviourDuringRestore = '';
    window.scrollTo = (() => {
      behaviourDuringRestore = document.documentElement.style.scrollBehavior;
    }) as typeof window.scrollTo;
    unmount();
    expect(behaviourDuringRestore).toBe('auto');
    // and put back the way it was found
    expect(document.documentElement.style.scrollBehavior).toBe('smooth');
    document.documentElement.style.scrollBehavior = '';
  });
});
