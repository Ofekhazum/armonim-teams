// Opting a device into match-clock notifications (§2.17).
//
// The whole reason this goes through a push service rather than a timer in the
// page: a phone in a pocket with the screen off runs no JavaScript. The four
// moments worth announcing are scheduled server-side off the clock's absolute
// end time, and arrive whether or not this tab — or this browser — is still
// awake.

import { REMOTE_URL } from './remote';

// Which devices have opted in is per-device by definition, so it lives here
// rather than in the shared session.
const ENABLED_KEY = 'armonim-notify';

export type PushSupport =
  | 'ok' // everything needed is present
  | 'unsupported' // browser has no push at all
  | 'needs-install' // iOS: only installed (Home Screen) web apps may subscribe
  | 'not-configured'; // no worker, or no VAPID key set on it

// iOS gates the whole Notification API behind installing the site to the Home
// Screen — not visiting it, not bookmarking it. So on an iPhone the API is
// simply absent until the app is launched from the home screen, and being told
// "your browser doesn't support this" would be both wrong and a dead end.
const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  // the iOS-only legacy flag, still the reliable signal there
  (navigator as { standalone?: boolean }).standalone === true;

// Only iOS has the install-first rule, so only iOS gets told about it — a
// desktop browser missing push is missing it for good, and "Add to Home
// Screen" would be nonsense advice. The second clause catches iPadOS, which
// reports itself as a Mac and is distinguishable only by having a touchscreen.
const isIOS = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function pushSupport(): PushSupport {
  if (!REMOTE_URL) return 'not-configured';
  const hasPush =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasPush) return 'ok';
  return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
}

// What is stored is *which fixture* this device opted into, not a bare yes.
// Alerts last one night: the Worker drops every subscription when the live
// fixture changes, and keying the local flag the same way is what keeps the
// two from disagreeing. A phone that was switched off when the night ended
// comes back to a toggle that reads off, because the id no longer matches —
// no message had to reach it to make that true.
export const notifyEnabled = (fixtureId: string | null): boolean =>
  fixtureId !== null && localStorage.getItem(ENABLED_KEY) === fixtureId;

const setEnabledFlag = (fixtureId: string | null) => {
  if (fixtureId) localStorage.setItem(ENABLED_KEY, fixtureId);
  else localStorage.removeItem(ENABLED_KEY);
};

// Vite serves the app from '/' in dev and '/armonim-teams/' on Pages; the
// worker has to be registered within that scope to control the page.
const swUrl = () => `${import.meta.env.BASE_URL}sw.js`;

// Asked for once per page load, not once per render: the answer is a
// deployment fact, and the toggle sits on a component that re-renders every
// time the clock ticks.
let keyRequest: Promise<Uint8Array | null> | null = null;

async function vapidKey(): Promise<Uint8Array | null> {
  keyRequest ??= (async () => {
    try {
      const res = await fetch(`${REMOTE_URL}/push/key`, { cache: 'no-store' });
      if (!res.ok) return null;
      const { key } = (await res.json()) as { key: string | null };
      if (!key) return null;
      const padded = key.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
      return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  })();
  return keyRequest;
}

// Whether this deployment can send at all. A Worker with no VAPID secret set
// serves a null key, and without this the app would show everyone a toggle
// that fails the moment it is pressed — worse than showing nothing, because it
// reads as broken rather than as absent.
export const notificationsConfigured = (): Promise<boolean> =>
  vapidKey().then((k) => k !== null);

export type EnableResult = 'ok' | 'denied' | 'unsupported' | 'not-configured' | 'error';

// The reason travels with the result because the reason is the whole story.
// `pushManager.subscribe()` is the step most likely to fail and the one that
// says why — "AbortError: Registration failed" from a browser with no push
// service behind it, for instance — and swallowing that into "try again" leaves
// a person tapping a button that will never work.
export interface EnableOutcome {
  result: EnableResult;
  message?: string;
}

export async function enableNotifications(fixtureId: string): Promise<EnableOutcome> {
  const support = pushSupport();
  if (support === 'not-configured') return { result: 'not-configured' };
  if (support !== 'ok') return { result: 'unsupported' };

  // Must be called from a user gesture, which is why this hangs off a button
  // press rather than running on load.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { result: 'denied' };

  try {
    const key = await vapidKey();
    if (!key) return { result: 'not-configured' };

    const registration = await navigator.serviceWorker.register(swUrl(), {
      scope: import.meta.env.BASE_URL,
    });
    await navigator.serviceWorker.ready;

    // Re-subscribing with the same key returns the existing subscription, so
    // this is safe to call again on a device that already opted in.
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key as BufferSource,
    });

    const res = await fetch(`${REMOTE_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    if (!res.ok) return { result: 'error', message: `server said ${res.status}` };

    setEnabledFlag(fixtureId);
    return { result: 'ok' };
  } catch (err) {
    return { result: 'error', message: String(err).slice(0, 120) };
  }
}

// This device's subscription as the server knows it, or null if it never
// subscribed. Read straight from the browser rather than remembered, because
// the interesting failure is exactly the case where the two disagree.
export async function currentEndpoint(): Promise<string | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    return subscription?.endpoint ?? null;
  } catch {
    return null;
  }
}

// What the round trip reported. Every field here answers one "did this link
// work" question: `configured` the server key, `subscribers`/`known` the
// subscription, `sent[].status` the push service, and a banner appearing on
// the phone the last link — the one no server can see.
export interface PushReport {
  subscribers: number;
  known: boolean;
  configured: boolean;
  pending: { at: number; kind: string; period: string }[];
  alarmAt: number | null;
  now: number;
  sent: { host: string; status: number; detail: string }[];
  // the address a push provider would contact, and whether the stored key's
  // public and private halves are actually each other's
  subject: string;
  keyOk: boolean;
  // set by the client, not the server: this device had no subscription to test
  noEndpoint?: boolean;
  // ...nor can the server tell whether this subscription was minted against
  // the key it now signs with. Only the browser holds that. null = couldn't
  // tell (no subscription, or a browser that doesn't expose the options).
  keyMatchesSubscription?: boolean | null;
}

// A push subscription is bound to the application server key it was created
// with, permanently. Rotate the key on the Worker and every subscription made
// before it keeps working right up until the moment it is used, when the push
// service answers with the same generic complaint it gives a bad subject.
// The browser is the only party that holds both halves of this comparison.
async function subscriptionMatchesKey(): Promise<boolean | null> {
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    const applied = subscription?.options?.applicationServerKey;
    const current = await vapidKey();
    if (!applied || !current) return null;
    const bytes = new Uint8Array(applied);
    return bytes.length === current.length && bytes.every((b, i) => b === current[i]);
  } catch {
    return null;
  }
}

export async function testPush(secret: string): Promise<PushReport | null> {
  if (!REMOTE_URL) return null;
  const endpoint = await currentEndpoint();
  try {
    const res = await fetch(`${REMOTE_URL}/push/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, endpoint }),
    });
    if (!res.ok) return null;
    return {
      ...((await res.json()) as PushReport),
      noEndpoint: endpoint === null,
      keyMatchesSubscription: await subscriptionMatchesKey(),
    };
  } catch {
    return null;
  }
}

export async function disableNotifications(): Promise<void> {
  // The local flag goes first: whatever happens to the network, a device that
  // has been switched off must read as switched off.
  setEnabledFlag(null);
  try {
    const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch(`${REMOTE_URL}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch {
    // the server prunes subscriptions it can no longer deliver to anyway
  }
}
