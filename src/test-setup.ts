// Setup for the component tests only (see vite.config.ts).

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setCurrentLang } from './i18n';

afterEach(cleanup);

beforeEach(() => {
  // **No component test may reach the network.** `REMOTE_URL` defaults to the
  // club's live Worker, so a component that fetches on mount — a night page
  // asking for its recap, the History tab reading the awards — would be
  // talking to production from a test run. Every one of those calls is written
  // to treat a failure as "no data", so refusing them here is both safe and
  // the correct shape: the tests exercise the component, not the Worker.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network in component tests'))),
  );
  // jsdom has no scrolling to do. `window.scrollTo` warns on every call and
  // `Element.scrollTo` is not implemented at all — the night page calls it to
  // start a night at the top, which is a real thing to do and not a thing this
  // environment can model.
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo;

  // This jsdom is built without the storage feature, so `localStorage` is
  // simply absent — and the app reads it during render (the shelf remembers
  // whether it is open). A real one per test also buys isolation: a preference
  // written by one test is not a preference the next one inherits.
  // `sessionStorage` alongside it, for the same reason and one more: it is
  // where the test-mode flag lives (§2.32), so the isolation tests need a real
  // one that starts empty — a leaked flag would run a test against the
  // sandbox's club without saying so.
  const fakeStorage = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
  };
  vi.stubGlobal('localStorage', fakeStorage());
  vi.stubGlobal('sessionStorage', fakeStorage());

  // **These tests read the app in English, and the app ships in Hebrew.**
  // Not laziness about translating assertions: a component test is checking
  // that pressing Publish publishes, that a benched player leaves the board,
  // that a zero renders as "none" rather than as nothing — behaviour, not
  // copy. Pinning one language keeps those assertions about the behaviour,
  // and keeps a re-worded Hebrew label from failing forty tests that were
  // never about the wording.
  //
  // English rather than Hebrew because it is the language the assertions were
  // already written in, and because a failure message with the expected text
  // in it is easier to read in the language of the code around it. The Hebrew
  // side is covered on purpose in `i18n.dom.test.tsx` and `i18n.test.ts`:
  // that every key has both languages, and that the toggle actually swaps
  // them — which is the part that could really break.
  setCurrentLang('en');
  localStorage.setItem('armonim-lang', 'en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});
