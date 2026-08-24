import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TestModeBanner from './TestModeBanner';

// The banner (§2.32), after it turned out to cover the Back button on every
// full-screen overlay. jsdom does not paint or lay anything out, so the actual
// bug — one stacking context out-ranking another — is not something a test
// here can reproduce. What it can do is fail loudly the moment somebody
// reaches for `sticky`, `fixed` or a `z-` class to make the banner "more
// visible" again, which is exactly how it broke the first time.

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

const renderInTestMode = async () => {
  vi.stubGlobal('sessionStorage', {
    getItem: () => 'on',
    setItem: () => {},
    removeItem: () => {},
  } as unknown as Storage);
  const { default: Banner } = await import('./TestModeBanner');
  render(<Banner />);
};

describe('the test mode banner', () => {
  it('renders nothing outside test mode', () => {
    render(<TestModeBanner />);
    expect(screen.queryByText(/Test mode/)).not.toBeInTheDocument();
  });

  it('never claims a stacking context that could out-rank a fixed overlay', async () => {
    // The actual bug: `sticky`/`fixed` plus a z-index is a positioned element,
    // and a positioned element's z-index is compared against every other
    // positioned element regardless of source order — which is how a banner
    // meant to sit "on top" ended up painted over the Back button of a
    // `fixed inset-0 z-40` player page. Ordinary flow has no stacking context
    // at all, so this is the one property that actually keeps it safe.
    await renderInTestMode();
    const banner = screen.getByText(/Test mode — invented club/).closest('div')!;
    const classes = banner.className.split(/\s+/);
    expect(classes).not.toContain('sticky');
    expect(classes).not.toContain('fixed');
    expect(classes.some((c) => c === 'z-40' || c === 'z-50' || c.startsWith('z-['))).toBe(false);
  });

  it('still says which club this is and offers the way out', async () => {
    await renderInTestMode();
    expect(screen.getByText(/Test mode — invented club/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to the real club/ })).toBeInTheDocument();
  });
});
