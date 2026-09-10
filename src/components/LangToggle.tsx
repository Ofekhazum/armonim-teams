import { LANGS, type Lang } from '../i18n';
import { useI18n } from '../lang';

const NATIVE_NAME: Record<Lang, string> = { he: 'עברית', en: 'English' };

/**
 * The language picker, in the header opposite the crest (§2.45).
 *
 * A native `<select>` rather than a hand-built menu: it is two options, and on
 * a phone the platform picker is a better one than anything drawn here — it
 * opens as a wheel or a sheet, is reachable one-handed, and already knows how
 * to close itself. The same reason the guest-rating and shirt-swap pickers on
 * match day are native selects too.
 *
 * Each option is written in its own language, and carries `lang` to match, so
 * a reader who cannot read the current one can still find the row that gets
 * them out. `dir="ltr"` on the control keeps "עברית / English" from having its
 * own glyph reordered against the box (§2.44 fixed the same thing for the
 * guest-rating select).
 */
export default function LangToggle() {
  const { lang, setLang, t } = useI18n();

  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      aria-label={t('ui.lang.label')}
      title={t('ui.lang.label')}
      dir="ltr"
      className="rounded-full border border-amber-900/20 bg-[#fffdf4]/70 px-3 py-1.5 text-sm font-bold text-amber-900/80 shadow-sm outline-none transition-colors hover:border-orange-500 focus:border-orange-500"
    >
      {LANGS.map((l) => (
        <option key={l} value={l} lang={l}>
          {NATIVE_NAME[l]}
        </option>
      ))}
    </select>
  );
}
