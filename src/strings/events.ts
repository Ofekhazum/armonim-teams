import type { Entry } from '../i18n';

// The events editor (§2.58) — the list of things that happened tonight, which
// used to be a textarea full of `@…@` the organiser maintained by hand.
//
// Nothing here explains the storage format, deliberately. The delimiters are
// written by the code now, and a label that mentioned them would be teaching a
// syntax nobody has to type any more.

export const events = {
  'ev.event': { he: 'אירוע {n}', en: 'Event {n}' },
  'ev.add': { he: '+ אירוע נוסף', en: '+ Another event' },
  'ev.remove': { he: 'מחיקת אירוע {n}', en: 'Remove event {n}' },
  'ev.up': { he: 'חצי נקודה למעלה', en: 'Half a point up' },
  'ev.down': { he: 'חצי נקודה למטה', en: 'Half a point down' },
  // Reads in points, because that is the question being asked. How it is
  // stored — as `+` and `−` in the note — is the app's business.
  'ev.effect': { he: 'לציון של מי שמוזכר', en: 'to whoever is named' },
  // Events, not characters — see the footer's comment in EventsEditor.
  'ev.count': { he: '{n} מתוך {max} אירועים', en: '{n} of {max} events' },
} as const satisfies Record<string, Entry>;
