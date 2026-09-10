import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LangProvider, useI18n } from './lang';
import LangToggle from './components/LangToggle';
import { getLang, setCurrentLang, storedLang, t } from './i18n';

// The toggle is the one control in the app whose job is to change every other
// label on the page, so what is tested here is the *propagation*: that a tap
// reaches a component which never subscribed to the language itself, that the
// document direction follows, and that the choice outlives a reload.

// Reads its label from the module-level `t()` rather than from the hook —
// which is how the great majority of this app's components read theirs (see
// the note in `i18n.ts`). If this one re-renders in the new language, they do.
function UnsubscribedLabel() {
  return <span data-testid="label">{t('app.tab.club')}</span>;
}

function Subscriber() {
  const { lang, dir } = useI18n();
  return (
    <span data-testid="state">
      {lang}/{dir}
    </span>
  );
}

const setup = () =>
  render(
    <LangProvider>
      <Wrapper />
    </LangProvider>,
  );

// Found by its accessible name rather than by role alone, so the assertion
// keeps meaning the language control and not whatever select is added next.
const picker = () => screen.getByRole('combobox', { name: /Language|שפה/ });

// Stands in for `main.tsx`'s `Root`: it reads the context, so its children are
// created afresh on a switch. Without this the provider re-renders and React
// skips the identical `children` element beneath it — the exact bug the real
// `Root` exists to avoid.
function Wrapper() {
  useI18n();
  return (
    <>
      <LangToggle />
      <UnsubscribedLabel />
      <Subscriber />
    </>
  );
}

describe('the language toggle', () => {
  it('starts in Hebrew on a device that has never chosen', () => {
    // `test-setup.ts` pins English for every other test in the suite; this one
    // is specifically about the shipped default, so it clears that first.
    localStorage.removeItem('armonim-lang');
    setCurrentLang('he');

    setup();

    expect(screen.getByTestId('state')).toHaveTextContent('he/rtl');
    expect(screen.getByTestId('label')).toHaveTextContent('מועדון');
  });

  it('switches a component that never subscribed to the language', async () => {
    setup();

    expect(screen.getByTestId('label')).toHaveTextContent('Club');

    await userEvent.selectOptions(picker(), 'he');

    expect(screen.getByTestId('label')).toHaveTextContent('מועדון');
    expect(screen.getByTestId('state')).toHaveTextContent('he/rtl');
  });

  it('turns the document right-to-left and back', async () => {
    setup();

    await userEvent.selectOptions(picker(), 'he');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'he');

    await userEvent.selectOptions(picker(), 'en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('remembers the choice for the next visit', async () => {
    setup();

    await userEvent.selectOptions(picker(), 'he');

    expect(storedLang()).toBe('he');
    // and the non-React readers — the share cards, the countdown labels — see
    // it too, without going through the context
    expect(getLang()).toBe('he');
  });

  it('names every language in its own language, whichever one is showing', async () => {
    setup();

    // The way out has to be readable to somebody who cannot read the language
    // the app is currently in — so neither option is ever translated.
    const named = () => screen.getAllByRole('option').map((o) => o.textContent);
    expect(named()).toEqual(['עברית', 'English']);
    expect(picker()).toHaveValue('en');

    await userEvent.selectOptions(picker(), 'he');

    expect(named()).toEqual(['עברית', 'English']);
    expect(picker()).toHaveValue('he');
  });
});
