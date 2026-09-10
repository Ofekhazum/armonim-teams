// Setup for the logic tests (see vitest.workspace.ts).
//
// They get no DOM and want none — but a handful of the pure functions they
// cover now produce *text* (`kickoffLabel`, `agoLabel`, the night story, the
// milestone lines), and text has a language. Without this, those tests would
// assert against whatever `i18n.ts` happens to default to, which is Hebrew,
// which is the app's answer rather than the test's.
//
// So the language is pinned here for the same reason and to the same value as
// in `test-setup.ts` — see the longer note there.

import { beforeEach } from 'vitest';
import { setCurrentLang } from './i18n';

beforeEach(() => {
  setCurrentLang('en');
});
