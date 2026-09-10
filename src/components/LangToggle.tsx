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
      lang={next}
      // The label is already in the language it switches to, which for a
      // screen reader in the *current* language would be read out in the
      // wrong one — so the accessible name says what the control does in the
      // language the page is currently in.
      aria-label={`${t('ui.lang.label')}: ${t('ui.lang.switch')}`}
      title={t('ui.lang.switch')}
      className="rounded-full px-3 py-1.5 text-sm font-bold text-amber-900/70 transition-colors hover:text-orange-700"
    >
      {t('ui.lang.switch')}
    </button>
  );
}
