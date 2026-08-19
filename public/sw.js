// Service worker: exists solely to receive match-clock pushes (§2.17).
//
// Deliberately not a caching/offline worker. The app is a small static bundle
// that the browser already caches well, and an offline layer here would be a
// whole extra source of "why am I looking at last week's roster" — the class of
// bug this project has already paid for once. Nothing is intercepted; `fetch`
// isn't even listened for.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // userVisibleOnly means the browser expects a notification for every push it
  // delivers, and will hold it against us if one doesn't appear — so the
  // fallback is a real message rather than a silent return.
  let data = { title: 'Armonim FC', body: 'Match update' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // malformed payload — show the fallback rather than nothing
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      // one tag for the whole match, so a phone that was asleep through three
      // announcements wakes to the current one rather than a stack of stale
      // ones — with renotify so replacing it still buzzes
      tag: data.tag || 'armonim-clock',
      renotify: true,
      vibrate: [200, 100, 200],
      // these are timing cues at a football pitch; they are worth a buzz now
      // and worthless later, so they never sit silently in the tray
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // reuse a tab that's already on the app rather than piling up new ones
      for (const client of open) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(self.registration.scope);
    })(),
  );
});
