# Armonim Teams — Weekly Football Team Builder

This file describes the app **as actually implemented** (not just the original design intent) —
keep it in sync with `src/` when the model or flows change, so a fresh session can read this
instead of re-exploring the codebase.

## 1. What the app does

A mobile-friendly web app for a weekly 3-team (black / white / blue), 5-a-side football night.
The organizer opens the app, ticks who's available today (or pastes a WhatsApp-style attendance
list — see §2.4), adds/auto-adds any guests, and hits **Generate Teams**.
The app produces three balanced teams that respect goalkeeper needs, chemistry, and guest pairings,
lets the organizer tweak the result by drag-and-drop, and share it (e.g. paste into WhatsApp).

## 2. Core concepts & data model

All types live in `src/types.ts`. There is no backend database — state is `localStorage`
(`src/storage.ts`, key `armonim-teams-v1`) plus an optional shared roster synced through a
tiny Cloudflare Worker (§6).

### Player (`Player` in `src/types.ts`)
| Field | Type | Notes |
|---|---|---|
| id | string | |
| name | string | |
| aliases | string[]? | other names people call this player (e.g. nicknames) — used to match imported attendance lists against the roster, see §2.4. Edited as a comma-separated field in the Roster form (`src/components/Roster.tsx`). |
| rating | 1–5 | overall ability |
| ratingUnknown | boolean? | true for guests whose ability we don't know |
| playstyle | `defensive` \| `mixed` \| `attacking` \| `gk` | `gk` = permanent goalkeeper, always GK-capable on match day |
| isGuest | boolean? | guests are one-off, added on match day |
| invitedBy | playerId? | guests only, optional — if set, the guest is a hard constraint: same team as inviter. If unset, the guest is balanced freely |
| chemistry | string[] | ids of players they play well with (mutual — kept in sync both ways on save) |
| avoid | string[]? | ids of players they clash with, kept on different teams (mutual, mutually exclusive with chemistry for the same pair) |

Guests default to **rating 3.5** with `ratingUnknown: true` when no rating is guessed at add-time
(`addGuest` in `MatchDay.tsx`, and the same default in the paste-import guest path, §2.4)
— the balancer treats them as average but avoids stacking multiple unknowns on one team.

### Session (`Session` in `src/types.ts`) — one match night, no history kept
| Field | Notes |
|---|---|
| availableIds | roster player ids marked available today |
| guests | one-off `Player[]` added for this session only |
| gkIds | **per-session** list of who can go in goal today — GK-only status changes week to week, so it's picked at session setup, not stored on the player (permanent `playstyle: 'gk'` players are always included regardless) |
| teams | the generated/edited assignment (`Record<'black'\|'white'\|'blue', string[]>`), or `null` before generation |
| teamAlts | the top-N balanced variations generated alongside `teams`, for "re-roll" |
| altIndex | which variation is currently shown |

There is no session history — only the current in-progress session is persisted.

### 2.4 Importing a pasted attendance list (match day, step 1)

`src/importRoster.ts` + the "📋 Import a pasted list" panel in `src/components/MatchDay.tsx`.
Lets the organizer paste a numbered list (e.g. copied from a WhatsApp poll/roster message) instead
of ticking players one by one:

1. `parseImportList(text)` reads the pasted text line by line, extracting the name from lines that
   start with `<number>.` / `<number>)`. Non-numbered lines (titles, emoji, `19:00`-style time
   headers) are skipped. Reading stops as soon as a waiting-list header is hit (`המתנה` / `רזרבה` /
   `ממתינים`) — reserves aren't part of today's squad.
2. `resolveImportedNames(names, players, existingGuests, makeGuest)` matches each name against
   `player.name` or any of `player.aliases` (trim + case-insensitive). Matches become
   `session.availableIds`. Names that match nothing become guests via `makeGuest` — same default
   guest shape as manual add (rating 3.5, `ratingUnknown: true`, `playstyle: 'mixed'`), with **no
   `invitedBy`** (the import never claims to know who invited an unrecognized name).
3. Applying an import is a **full override**, not a merge: `session.availableIds` and
   `session.guests` are replaced outright (any previously-ticked players or manually-added guests
   are dropped), and `session.gkIds` is pruned to drop any ids that no longer exist. The panel
   shows a one-line summary of how many matched and the names of any new guests. The organizer then
   uses the existing manual controls (tick/untick, add/remove/edit guest) to fix mismatches or top
   up to 15 if the pasted list came up short.

Guests can also be edited in place after being added (manually or via import) — each row in the
guest list has its own rating and inviter `<select>`, backed by `updateGuestRating` /
`updateGuestInviter` in `MatchDay.tsx`.

## 3. Team generation algorithm

Balancing is a small constrained optimization. With ≤15 players, brute force is too big
(15!/(5!5!5!) ≈ 756k × team labelings), but **hill-climbing with random restarts** solves it
instantly and is easy to reason about:

1. **Seed**: snake-draft by rating (1st, 6th, 7th, 12th… pattern) with guests pre-glued to their inviter.
2. **Improve**: repeatedly try swapping two players between teams; keep the swap if the score improves.
3. **Restart** ~20 times from shuffled seeds, keep the best. Runs in milliseconds in the browser.

### Hard constraints (never violated)
- Guest is on the same team as their inviter.
- Each team has at least one of today's GK-capable players *(if today's GK count ≥ 3; otherwise it degrades to a heavy penalty and the UI warns "only 2 GKs today — blue has no keeper")*.
- Team sizes as dictated by player count (5/5/5, or 5/5/4, 5/4/4 — see §4).

### Soft constraints (weighted score, lower = better)
| Term | Default weight | What it measures |
|---|---|---|
| Rating balance | high | spread between team rating sums (normalized per player when sizes differ — a 4-player team is compared by average, not sum). An outfield player marked GK-capable *today* (`session.gkIds`, but `playstyle !== 'gk'`) contributes a flat average rating (3) here instead of their outfield rating — see `teamStats`/`planRotation` in `src/balancer.ts`, applied consistently to both team generation and the rotation/loan plan. |
| Playstyle mix | medium | each team should have a spread of defensive/mixed/attacking rather than e.g. all-attackers |
| Chemistry | medium | bonus for each prefer-together pair on the same team |
| Unknown spread | medium | avoid two unknown-rating guests on the same team (unless glued to the same inviter) |
| Variety (later) | low | penalize repeating last week's exact teammates, so teams rotate over the season |

Weights are constants inside `src/balancer.ts` (no settings UI exists to tune them at runtime).

The generator returns the **top 3 distinct results**, so the organizer can flip between alternatives
instead of re-rolling blindly.

## 4. Short-handed nights (13–14 players)

Rules of the night: 3 teams rotate (two play, one rests); 15 is ideal, **13 is the minimum**.
With 13–14 players some team(s) start with 4, and players from the *resting* team come on to
complete the short team for that match.

App behavior:
- **15 players** → 5/5/5, nothing special.
- **14 players** → 5/5/4. One team is marked *short*. For each match where the short team plays, the app suggests a **loan** from the resting team — picking the resting player whose rating best keeps the match balanced, and rotating loans so the same person isn't always the filler.
- **13 players** → 5/4/4, same logic with two short teams.
- **< 13** → the app says the fixture doesn't go ahead (with a "generate 2 teams anyway" escape hatch as a later nice-to-have).

`planRotation` (`src/balancer.ts`) computes this once teams exist; `TeamsBoard.tsx` renders it as a
"🔁 Rotation plan" section (and includes it in the WhatsApp share text) whenever any team is short.

## 5. Screens (`src/App.tsx` — two tabs, no router)

1. **Roster** (`src/components/Roster.tsx`) — the permanent squad: add/edit name, aliases,
   rating, playstyle, chemistry/avoid links. Ratings are only editable in **admin mode**
   (§6 shared roster); everyone else sees roster info read-only plus their own local
   availability picks. Top-right shows a small `v<hash>` build marker (§6) so you can confirm
   a deploy actually landed after pushing.
2. **Match day** (`src/components/MatchDay.tsx`, the main flow):
   - Step 1 *(who's playing)*: tick available players from the roster grid, optionally use
     **📋 Import a pasted list** to bulk-mark attendance from pasted text (§2.4), and add/remove
     guests manually (name + optional inviter + optional rating guess) — guests can be edited
     in place afterwards (rating, inviter) via `updateGuestRating`/`updateGuestInviter`.
   - Step 2 *(goalkeepers)*: mark who can go in goal today (permanent `gk` playstyle players are
     always included).
   - **Generate** → `src/components/TeamsBoard.tsx`: three colored team cards (black/white/blue)
     with per-team total/average rating, GK badge, playstyle icons, and the rotation plan if a team
     is short. Drag-and-drop players between teams (native HTML5 DnD, no external library); balance
     numbers update live. "Re-roll" cycles through the alternative generated results. A **Share**
     button copies WhatsApp-ready text (`shareText`/`copy` in `TeamsBoard.tsx`).

There is no session history and no settings screen — one in-progress session is kept, and it resets
via "New fixture."

## 6. Tech stack (as built)

- **Vite + React 18 + TypeScript**, Tailwind v4 — single-page app, no router.
- **State/persistence**: `localStorage` only (`src/storage.ts`, key `armonim-teams-v1`,
  `STORAGE_VERSION` bump on breaking schema changes — mismatched versions fall back to the
  default roster). No JSON export/import UI currently exists.
- **Shared roster (optional)**: `src/remote.ts` + `worker/roster-worker.js`, a small Cloudflare
  Worker storing the roster as versioned JSON in KV, behind a secret admin word
  (`/verify`, `/roster` endpoints). On load, `App.tsx` pulls the remote roster and adopts it if
  its version is newer than what this device last applied. Unlocking admin mode
  (`Roster.tsx`'s 🔒 Admin button) lets you edit ratings and 📢 Publish the roster for everyone;
  without it the app works fully offline from local/default data. Configure by setting
  `REMOTE_URL` in `remote.ts`; leave it `''` to disable.
- Drag-and-drop uses native HTML5 drag events (`draggable`/`onDragStart`/`onDrop`) — no dnd-kit
  or other DnD library is installed.
- **Build version marker**: `vite.config.ts` runs `git rev-parse --short HEAD` at build time and
  injects it as the `__GIT_HASH__` global (declared in `src/vite-env.d.ts`, falls back to `'dev'`
  if git isn't available). Shown top-right of the Roster page — since GitHub Pages rebuilds on
  every push to `main`, a changed hash after refreshing confirms a deploy actually landed.
- Balancing algorithm (`src/balancer.ts`) is plain TypeScript, runs client-side.
- Deploy as static files (the Vite build output in `dist/`); the Worker deploys separately
  (see `worker/`).

## 7. Build phases

1. **MVP** — roster CRUD, availability picking, GK marking, balancer with hard constraints + rating balance, team cards, WhatsApp share text, localStorage.
2. **Quality** — chemistry links, playstyle mix, guests glued to inviters, drag-and-drop editing with live balance feedback, alternative results.
3. **Short-handed logic** — 13/14 player team sizing, loan rotation screen.
4. **Polish** — history, settings for weights, variety-across-weeks scoring, JSON export/import.
