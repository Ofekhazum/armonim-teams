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

export const notifyEnabled = (): boolean => localStorage.getItem(ENABLED_KEY) === '1';

const setEnabledFlag = (on: boolean) => {
  if (on) localStorage.setItem(ENABLED_KEY, '1');
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

export async function enableNotifications(): Promise<EnableResult> {
  const support = pushSupport();
  if (support === 'not-configured') return 'not-configured';
  if (support !== 'ok') return 'unsupported';

  // Must be called from a user gesture, which is why this hangs off a button
  // press rather than running on load.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  try {
    const key = await vapidKey();
    if (!key) return 'not-configured';

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
    if (!res.ok) return 'error';

    setEnabledFlag(true);
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function disableNotifications(): Promise<void> {
  // The local flag goes first: whatever happens to the network, a device that
  // has been switched off must read as switched off.
  setEnabledFlag(false);
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
