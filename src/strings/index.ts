import { app } from './app';
import { clock } from './clock';
import { common } from './common';
import { fixture } from './fixture';
import { matchday } from './matchday';
import { night } from './night';
import { roster } from './roster';

// Every string the app can say, in both languages (§2.45).
//
// Split by area rather than kept in one file, because one file would be a
// three-thousand-line object nobody can find anything in — but merged back
// into a single flat object here, so `Key` is the union of every key and a
// typo is a compile error rather than a label that quietly renders its own
// key on a match night.
//
// Areas own their prefix: `ui.` is shared furniture (`common.ts`), everything
// else is named for the screen it belongs to.

export const STRINGS = {
  ...common,
  ...app,
  ...fixture,
  ...roster,
  ...matchday,
  ...clock,
  ...night,
} as const;
