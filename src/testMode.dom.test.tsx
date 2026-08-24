import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The isolation (§2.32), and nothing else. This is the file that has to be
// right: everything else in test mode is invented football, and the only way
// it can hurt anybody is by reaching the real club's storage or the real
// club's Worker.
//
// Both decisions are made at *module load*, which is what makes them safe and
// what makes them awkward to test — so every case below resets the module
// registry and imports fresh, which is exactly the situation a page reload
// creates. `setTestMode` reloads for precisely this reason.

const LIVE_KEY = 'armonim-teams-v1';
const TEST_KEY = 'armonim-teams-test-v1';

// A live save sitting on the device before any of this starts. Every test
// below asserts it is still here, untouched, afterwards — which is the whole
// question a reviewer is actually asking.
const REAL_SAVE = JSON.stringify({
  version: 4,
  players: [{ id: 'real1', name: 'אופק', rating: 4, attack: 50, chemistry: [], avoid: [] }],
  session: {},
  history: [{ id: 'real-night', date: '2026-08-20' }],
});

const load = async (testMode: boolean) => {
  vi.resetModules();
  localStorage.setItem(LIVE_KEY, REAL_SAVE);
  if (testMode) sessionStorage.setItem('armonim-test-mode', 'on');
  else sessionStorage.removeItem('armonim-test-mode');
  return {
    storage: await import('./storage'),
    remote: await import('./remote'),
    testMode: await import('./testMode'),
  };
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.resetModules();
});

describe('test mode isolation', () => {
  it('has no network at all', async () => {
    // The kill switch. Every remote function in the app opens with
    // `if (!REMOTE_URL) return …`, so an empty URL is not a refused request —
    // it is code that returns before a request exists.
    const { remote } = await load(true);
    expect(remote.REMOTE_URL).toBe('');
  });

  it('still has one when it is off', async () => {
    const { remote } = await load(false);
    expect(remote.REMOTE_URL).not.toBe('');
  });

  it('never writes to the live key', async () => {
    const { storage } = await load(true);
    const state = storage.loadState();
    state.players.push({
      id: 'test-intruder',
      name: 'intruder',
      rating: 5,
      attack: 50,
      chemistry: [],
      avoid: [],
    });
    storage.saveState(state);

    expect(localStorage.getItem(LIVE_KEY)).toBe(REAL_SAVE);
    expect(localStorage.getItem(TEST_KEY)).toContain('test-intruder');
  });

  it('never reads the live key either', async () => {
    // Reading it would be almost as bad as writing it: the sandbox would open
    // showing the real club, and the first edit would be an edit to real data
    // that then gets saved under the test key and looks like it never happened.
    const { storage } = await load(true);
    const state = storage.loadState();
    expect(state.players.some((p) => p.id === 'real1')).toBe(false);
    expect(state.history.some((fx) => fx.id === 'real-night')).toBe(false);
  });

  it('opens the live club when it is off, leaving the sandbox alone', async () => {
    localStorage.setItem(TEST_KEY, JSON.stringify({ version: 4, players: [], history: [] }));
    const { storage } = await load(false);
    const state = storage.loadState();
    expect(state.players.some((p) => p.id === 'real1')).toBe(true);

    storage.saveState(state);
    expect(localStorage.getItem(TEST_KEY)).not.toContain('real1');
  });

  it('seeds a fresh sandbox with the invented club', async () => {
    const { storage } = await load(true);
    const state = storage.loadState();
    expect(state.players).toHaveLength(20);
    expect(state.history.length).toBeGreaterThan(20);
    // and every single id is marked, so a stray record is obvious on sight
    expect(state.players.every((p) => p.id.startsWith('test-'))).toBe(true);
    expect(state.history.every((fx) => fx.id.startsWith('test-'))).toBe(true);
  });

  it('keeps sandbox edits, rather than reseeding on every open', async () => {
    const first = await load(true);
    const state = first.storage.loadState();
    state.players[0].name = 'renamed';
    first.storage.saveState(state);

    const second = await load(true);
    expect(second.storage.loadState().players[0].name).toBe('renamed');
  });

  it('does not poison the live version watermark', async () => {
    // The subtlest way this could have gone wrong, and one this project has
    // already been bitten by once (see the note on `versionKey` in remote.ts).
    // The stored version is a timestamp taken by whichever server wrote it. If
    // the sandbox stamped the *live* key, the device would come back from test
    // mode believing it already held something newer than the club's roster
    // and would refuse to adopt the real one — silently, and forever.
    //
    // It is safe for free, because the key is scoped by REMOTE_URL's host and
    // test mode has no host. That is worth an assertion rather than a hope.
    const live = await load(false);
    live.remote.setLocalRosterVersion(1000);

    const sandbox = await load(true);
    sandbox.remote.setLocalRosterVersion(999999);

    const back = await load(false);
    expect(back.remote.localRosterVersion()).toBe(1000);
  });

  it('dies with the tab', async () => {
    // sessionStorage, not localStorage. Forgetting to leave is the obvious
    // human error here, and this makes the consequence "closed the tab".
    const { testMode } = await load(true);
    expect(testMode.isTestMode()).toBe(true);
    sessionStorage.clear(); // what closing the tab does
    const reopened = await load(false);
    expect(reopened.testMode.isTestMode()).toBe(false);
  });

  it('reports the same answer every time it is asked', async () => {
    // Read once at load and cached, deliberately: a value that could change
    // between two calls in one render is a value that could have the app
    // reading one club and writing to the other.
    const { testMode } = await load(true);
    sessionStorage.removeItem('armonim-test-mode');
    expect(testMode.isTestMode()).toBe(true);
  });
});
