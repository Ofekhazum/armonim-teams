import { useState } from 'react';
import { verifyWord } from './remote';
import { TEST_WORD, isTestMode, setTestMode } from './testMode';
import { t } from './i18n';

// Prompt for the secret word and, if the Worker accepts it, unlock admin mode.
// The word is verified server-side (and rate-limited there — see §6), never
// checked against anything held in the client.
//
// Shared rather than inlined because admin can be unlocked from more than one
// place: the padlock in the header, reachable from every tab, and the fixture
// page, where saving the night's result is the thing being gated.
export function useAdminUnlock(setAdminWord: (word: string | null) => void) {
  const [unlocking, setUnlocking] = useState(false);

  const unlockAdmin = async () => {
    const word = window.prompt(t('admin.prompt'));
    if (word == null) return; // cancelled

    // The sandbox word (§2.32). Checked here and never sent anywhere — the
    // Worker has never heard of it, and must not: it unlocks invented data on
    // one device, which is not a thing a server has any business knowing. The
    // page reloads into the other club, so nothing from this one survives.
    if (word.trim() === TEST_WORD) {
      setTestMode(!isTestMode());
      return;
    }

    setUnlocking(true);
    const result = await verifyWord(word.trim());
    setUnlocking(false);
    if (result === 'ok') {
      setAdminWord(word.trim());
    } else if (result === 'wrong-word') {
      alert(t('admin.wrong'));
    } else if (result === 'rate-limited') {
      alert(t('admin.rateLimited'));
    } else if (result === 'not-configured') {
      alert(t('admin.notConfigured'));
    } else {
      alert(t('admin.unreachable'));
    }
  };

  return { unlockAdmin, unlocking };
}
