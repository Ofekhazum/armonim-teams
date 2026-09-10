import { STRINGS } from './strings';

// The app speaks two languages (§2.45). The club is Hebrew-speaking — the
// player names, the AI banter and the organiser's own paste-in lists were
// already Hebrew while every label around them was English — so Hebrew is the
// default and English is the option, not the other way round.
//
// **Player names are never translated.** They are data, not copy: the same
// string renders in both languages, and `guestKey` / `localeCompare(…, 'he')`
// keep working because nothing about a name changes when the label beside it
// does.
//
// Hand-rolled rather than react-i18next, for the same reason the rest of this
// app has two dependencies: the whole feature is a lookup, an interpolation and
// a plural rule, and a library would be more bytes on a phone in a car park
// than the thing it replaces.
//
// This file is the engine and deliberately has no React in it: `kickoff.ts`,
// the canvas share cards and the push registration all need to produce text,
// and they are unit-tested in a node environment with no DOM. The provider and
// the hooks live in `lang.tsx`.

export type Lang = 'he' | 'en';

export const LANGS: Lang[] = ['he', 'en'];

// A string that changes shape with a count. Hebrew has a dual form, but no UI
// string here ever needs it — "2 nights" takes the plural, the same as 3 — so
// the two-way split English already needs covers both languages.
export type Plural = { one: string; other: string };
export type Str = string | Plural;
export type Entry = { he: Str; en: Str };

export type Key = keyof typeof STRINGS;

export type Vars = Record<string, string | number>;

const DIR: Record<Lang, 'rtl' | 'ltr'> = { he: 'rtl', en: 'ltr' };

export const dirOf = (lang: Lang) => DIR[lang];

// `{name}`, `{n}` — the count, when one is passed, is always available as `{n}`
// so a plural string can name the number it is agreeing with.
const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

const pick = (s: Str, vars?: Vars) =>
  typeof s === 'string' ? s : Number(vars?.n) === 1 ? s.one : s.other;

/**
 * The pure lookup. Everything else here is a way of getting a `lang` to it —
 * the hook from context, `t` from the module-level current language.
 *
 * A missing key returns the key itself rather than throwing or rendering
 * empty: a wrong label is a bug you can see and fix, where a blank one is a
 * layout that silently loses a control. `Key` makes it a compile error anyway;
 * this only catches the JavaScript that reaches here from the Worker.
 */
export function translate(lang: Lang, key: Key, vars?: Vars): string {
  const entry = STRINGS[key] as Entry | undefined;
  if (!entry) return String(key);
  return fill(pick(entry[lang] ?? entry.he, vars), vars);
}

// --- Where the choice is kept ----------------------------------------------

const LANG_KEY = 'armonim-lang';

const isLang = (v: unknown): v is Lang => v === 'he' || v === 'en';

/**
 * Hebrew unless this device has said otherwise. Deliberately not
 * `navigator.language`: the club is one Hebrew-speaking group of friends, and
 * an English phone belonging to one of them is not a request for an English
 * app — it is a phone. The toggle is one tap away for anyone who wants it, and
 * once tapped it is remembered.
 */
export function storedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return isLang(saved) ? saved : 'he';
  } catch {
    return 'he';
  }
}

export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // A private-mode browser that refuses storage still gets a working toggle;
    // it just forgets on reload, which beats not switching at all.
  }
}

// --- The current language, for code that is not a component -----------------
//
// The canvas share cards (§2.20), the countdown labels and the push bodies all
// build text outside React. Rather than thread a `lang` argument through every
// one of those signatures — and through the ~200 call sites and assertions
// that would come with it — they read the language the provider last set.
//
// One writer (the provider), one language at a time, app-wide: that is what
// the app actually does, so a module-level answer is the honest shape rather
// than a shortcut. `translate` stays pure, and is what a test uses when it
// wants to pin a language without touching global state.

/**
 * Seeded from storage rather than from a constant, so that a *fresh copy* of
 * this module starts in the language the device already chose.
 *
 * That is not hypothetical: a component test calling `vi.resetModules()` gets
 * its own instance of this file, which the suite's `setCurrentLang` never
 * touched — and it rendered a Hebrew banner in the middle of an
 * English-pinned suite until this read the same place the provider does.
 */
let current: Lang = storedLang();

export const getLang = (): Lang => current;

/**
 * Only the provider and the test setup call this. Everything else changes the
 * language by rendering — `setLang` on the context, which routes here and then
 * re-renders the tree.
 */
export const setCurrentLang = (lang: Lang) => {
  current = lang;
};

export const t = (key: Key, vars?: Vars): string => translate(current, key, vars);

// --- Dates ------------------------------------------------------------------
// Both languages read the same Western digits, so a date only needs its month
// and weekday names swapping — `Intl` already knows them, and `he-IL` gives the
// day-first order Hebrew expects without a format string.

const LOCALE: Record<Lang, string> = { he: 'he-IL', en: 'en-GB' };

export const localeOf = (lang: Lang) => LOCALE[lang];

export const fmtDate = (
  iso: string | number | Date,
  lang: Lang = current,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
) => new Date(iso).toLocaleDateString(LOCALE[lang], opts);

export const fmtTime = (iso: string | number | Date, lang: Lang = current) =>
  new Date(iso).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' });
