import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  dirOf,
  rememberLang,
  setCurrentLang,
  storedLang,
  translate,
  type Key,
  type Lang,
  type Vars,
} from './i18n';

// React's half of the language feature — the engine and the reasoning behind
// it are in `i18n.ts`.

interface Ctx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
  dir: 'rtl' | 'ltr';
}

const LangContext = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(storedLang);

  // During render rather than in an effect, and on purpose: the non-React
  // callers (`kickoffLabel`, the share cards) read `getLang()` while this very
  // tree renders, so setting it a frame later would draw the first paint of a
  // switch in the language being switched away from.
  setCurrentLang(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setCurrentLang(next);
    rememberLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars), dir: dirOf(lang) }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

/**
 * Falls back to the stored language rather than throwing when there is no
 * provider above. The share-room view, the test harnesses and every component
 * test that renders one component on its own would otherwise all need a
 * wrapper to render at all — and a label in the right language is exactly what
 * they would get from one.
 */
export function useI18n(): Ctx {
  const ctx = useContext(LangContext);
  const [fallback] = useState<Lang>(storedLang);
  return (
    ctx ?? {
      lang: fallback,
      setLang: setCurrentLang,
      t: (key, vars) => translate(fallback, key, vars),
      dir: dirOf(fallback),
    }
  );
}

export const useT = () => useI18n().t;
