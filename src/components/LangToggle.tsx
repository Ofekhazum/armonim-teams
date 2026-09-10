import { useI18n } from '../lang';

/**
 * One button, not a picker (§2.45). There are two languages, so a control that
 * asks which of them you want is a menu with one useful row in it — the button
 * simply says what it will switch you to, in that language, which is also the
 * only label a reader of the *other* language is guaranteed to recognise.
 *
 * It lives in the header beside the padlock rather than on a settings screen
 * for the same reason unlocking does: it is a thing you do once on a new
 * phone, and hunting for it is the whole cost.
 */
export default function LangToggle() {
  const { lang, setLang, t } = useI18n();
  const next = lang === 'he' ? 'en' : 'he';

  return (
    <button
      onClick={() => setLang(next)}
      // The visible label is a word in the language it switches *to*, which a
      // screen reader set to the current language would mispronounce — so the
      // accessible name says what the control does, in the language the page
      // is in right now, and `lang` is scoped to the label itself rather than
      // put on the button (where it would cover the aria-label too).
      aria-label={`${t('ui.lang.label')}: ${t('ui.lang.switch.full')}`}
      title={t('ui.lang.switch.full')}
      className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold text-amber-900/70 transition-colors hover:text-orange-700"
    >
      <span lang={next}>{t('ui.lang.switch')}</span>
    </button>
  );
}
