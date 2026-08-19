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
| isGk | boolean? | permanent goalkeeper — always GK-capable on match day, and sits outside the outfield spectrum below |
| attack | 0–100 | position on the defence↔attack spectrum in steps of 5: `0` = fully defensive, `50` = even split, `100` = fully attacking. The **badge** shown in the UI is derived, never stored — ≥75 reads as attacking, ≤25 as defensive, anything between as balanced. Both sides come off the single symmetric `BADGE_LEAN` constant in `types.ts`, so retuning the threshold is a one-line change (`roleBadge`/`badgeForAttack`) |
| isGuest | boolean? | guests are one-off, added on match day |
| invitedBy | playerId? | guests only, optional — if set, the guest is a hard constraint: same team as inviter. If unset, the guest is balanced freely |
| chemistry | string[] | ids of players they play well with (mutual — kept in sync both ways on save) |
| avoid | string[]? | ids of players they'd rather not be teamed with — a *preference* to keep apart, not a hard rule (mutual, mutually exclusive with chemistry for the same pair). **Admin-only**: never shown or editable outside admin mode, and deliberately withheld from the teams board when it renders for a live-room guest (`showPrivateNotes` on `TeamsBoard`). Note the data itself still ships in the published roster JSON, which is a public endpoint — this is UI discretion, not a security boundary |

Guests default to **rating 3.5** with `ratingUnknown: true` when no rating is guessed at add-time
(`addGuest` in `MatchDay.tsx`, and the same default in the paste-import guest path, §2.4)
— the balancer treats them as average but avoids stacking multiple unknowns on one team. Guests
also default to `attack: 50` (even split), since a one-off guest's style usually isn't known.

**Legacy `playstyle` migration.** Before the spectrum, a player stored a categorical
`playstyle: 'defensive' | 'mixed' | 'attacking' | 'gk'`. `migratePlayer` (`types.ts`) converts on
read — defensive→`attack: 0`, attacking→`attack: 100`, mixed→`attack: 50`, gk→`isGk: true` — and is
applied at **both** load paths: `localStorage` (`storage.ts`, `STORAGE_VERSION` bumped to 3) and the
shared remote roster (`App.tsx`), because a roster published from an older client still carries the
old shape until it's re-published. The conversion is idempotent and strips the dead field. The
extremes are deliberate: an old "defensive" player is pinned at 100% defensive as a *starting
point*, expected to be tuned by hand afterwards.

### Session (`Session` in `src/types.ts`) — the match night in progress
| Field | Notes |
|---|---|
| availableIds | roster player ids marked available today |
| guests | one-off `Player[]` added for this session only |
| gkIds | **per-session** list of who can go in goal today — GK-only status changes week to week, so it's picked at session setup, not stored on the player (permanent `isGk` players are always included regardless) |
| teams | the generated/edited assignment (`Record<'black'\|'white'\|'blue', string[]>`), or `null` before generation |
| teamAlts | the top-N balanced variations generated alongside `teams`, for "re-roll" |
| altIndex | which variation is currently shown |
| fixtureStarted | true once **▶️ Start fixture** is clicked — switches from the editable teams board to the read-only fixture page (§2.7). Reversible: **← Back to teams** just flips it off, `teams`/`wins` are untouched |
| wins | tonight's win tally per team as typed, before it's filed (§2.6) |
| savedFixtureId | set once tonight is saved, so re-saving updates that record instead of adding another |

Only the night in progress lives here. Finished nights move into `AppState.history` as
`FixtureRecord`s (§2.6); the session itself is reset by "New fixture".

### 2.4 Importing a pasted attendance list (match day, step 1)

`src/importRoster.ts` + the "📋 Import a pasted list" panel in `src/components/MatchDay.tsx`.
Lets the organizer paste a numbered list (e.g. copied from a WhatsApp poll/roster message) instead
of ticking players one by one:

1. `parseImportList(text)` reads the pasted text line by line and figures out which style of list
   it's looking at, rather than assuming one fixed format: a numbered list (`1. Name`, `1) Name`,
   `1- Name`, or just `1 Name` with nothing but a space — any punctuation, or none, all work, since
   phones often don't render the dot into copied text), a bulleted list (`• Name` / `- Name`), or a
   plain one-name-per-line list with no prefix at all. For a numbered list, unpunctuated `N Name`
   lines are only trusted once the numbers across the whole paste actually climb (gaps are fine,
   e.g. `1, 3, 7`) — that's what stops an unrelated sentence starting with a digit (`"3 players
   still needed"`) from being swept in as a name. A trailing note in brackets (`דני (אורח)`,
   `לירן (שוער)`) is stripped from the name. Time headers (`19:00`-style) are skipped outright, and
   reading stops as soon as a waiting-list header is hit (`המתנה` / `רזרבה` / `ממתינים`) — reserves
   aren't part of today's squad. Covered by `src/importRoster.test.ts`.
2. `resolveImportedNames(names, players, existingGuests, makeGuest)` matches each name against
   `player.name` or any of `player.aliases` (trim + case-insensitive). Matches become
   `session.availableIds`. Names that match nothing become guests via `makeGuest` — same default
   guest shape as manual add (rating 3.5, `ratingUnknown: true`, `attack: 50`), with **no
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

### 2.5 Live match-day room (optional, merged to `main` in `38f4ecf`)

Lets a few people on their own phones watch and drag players between teams together in real time,
once the host has already generated teams. Deliberately narrow in scope — only the Teams page is
collaborative; everything before it (availability, guests, GK marking) stays local and host-only,
so the feature is purely additive on top of the offline-first app described above.

**Server**: `worker/match-room.js`, a `MatchRoom` Durable Object on the same Cloudflare Worker as
the shared roster (routed via `GET /room/:id` → WebSocket upgrade in `roster-worker.js`; bound in
`wrangler.toml` under `[[durable_objects.bindings]]`, free-tier SQLite-backed). One DO instance
per room id holds `{ adminToken, players, teams, gkIds }` — `players` is a full denormalized
snapshot (not ids), so a guest device can render the board without ever having synced the roster.

**Flow**:
1. On the Teams page, the host (only) sees a **🔴 Go live** button (`goLive` in `MatchDay.tsx`).
   Clicking it mints a room id + a random `adminToken` (persisted via `getHostRoom`/`setHostRoom`
   in `storage.ts`, so revisiting the Teams page reuses the same room/link instead of minting a
   new one), prompts for a display name once (`getMyName`/`setMyName`, asked once per device), and
   opens a WebSocket sending `{ type: 'init', adminToken, name, players, teams, gkIds }`.
2. The host shares the room link (**📋 Copy link**, `roomShareUrl` in `liveRoom.ts` — `?room=<id>`
   on the app's own URL). Opening that link with no other app state renders `RoomGuest.tsx`
   instead of `App` (routed in `main.tsx` by checking the query string — no router needed for one
   param), prompts the guest for a name, and sends `{ type: 'join', name }`.
3. Both host and guest render the *same* `TeamsBoard`, but a guest's instance omits
   `onBack`/`onNewFixture`/`onReroll` entirely (those props are optional on `TeamsBoard` precisely
   for this) — there is no way to navigate out of the board or touch setup from a guest link.
4. Any drag/swap/move — host or guest — sends `{ type: 'sync', teams }`; the Durable Object
   overwrites the room's canonical `teams`, broadcasts `{ type: 'state', room }` to everyone
   connected, and derives a best-effort human summary of the change (`describeChange` in
   `match-room.js`) broadcast as `{ type: 'activity', text, by, ids }` (`ids` = the player(s) that
   moved). Updates are instant (no debounce): each op is already one deliberate action, not a
   stream of continuous drag deltas, so there's nothing to batch, and Durable Object round trips
   are on the order of tens of milliseconds. Each connected person gets a stable identity color
   (`src/userColor.ts`, a validated 7-hue categorical palette — see the dataviz skill's
   `palette.md`; the 8th hue, blue, is deliberately dropped since this app's teams are literally
   named black/white/blue and a blue identity dot would read as team membership, not "who moved
   this" — re-validated as a 7-hue set, not assumed safe), assigned in first-seen order (not
   hashed, so the palette's CVD-safety guarantee — validated for consecutive slots rendered in that
   order — actually holds) and always paired with their name text, never color-alone. That color
   drives two things at once, both owned by a single ~1.8s timer in the parent
   (`MatchDay.tsx`/`RoomGuest.tsx`, not `LiveRoomBar` — so they fade together): a toast
   (`LiveRoomBar.tsx`, a colored accent stripe + dot, bold text) and a `flash-ring` highlight
   (`index.css`, `TeamsBoard`'s `highlight` prop) on the actual player row(s) that moved, so you see
   *what* changed, not just a text log. The toast is `fixed`-positioned (floats above the page,
   bottom-center) rather than sitting in-flow next to the presence chips — in-flow, it pushed the
   whole layout down each time it appeared and back up when it faded, which read as the page
   janking/reflowing on every change, worse on a small mobile viewport. The toast keeps the app's
   existing solid `amber-900` background rather than filling with the identity color directly:
   white text on several of the hues (yellow, aqua, magenta) fails basic text-contrast (down to
   2.09:1) — checked with the palette's own `contrast()` helper, not eyeballed.
5. Conflicts resolve as plain last-write-wins on the server's own canonical copy — no merge logic.
   Good enough at this scale (a handful of people, occasional overlapping drags) and much simpler
   than operational transform/CRDT.
6. The host can end the room with **✕ Close room** (confirms first), which sends
   `{ type: 'close-room', adminToken }`; the Durable Object deletes its stored state and broadcasts
   `{ type: 'closed' }` so any connected guest immediately sees "the host closed this room" instead
   of just silently dropping. **New Fixture** also closes the room rather than abandoning it.
   A room that is *never* closed expires on its own **12 hours after the last activity** — every
   write re-arms a Durable Object alarm (`save()`/`alarm()` in `match-room.js`), and firing it
   clears storage and broadcasts the same `{ type: 'closed' }`, so a forgotten room looks
   identical to a closed one rather than lingering in storage.

**Untrusted input.** Anyone who knows a room id can open a socket to it, so nothing off the wire is
stored as-is (`match-room.js`): oversized frames are dropped before parsing (128k chars), team and
id arrays are length- and shape-checked, display names are clamped to 60 chars, and `init`'s player
list is **rebuilt field by field** rather than passed through. That whitelist deliberately drops
`chemistry` (a balancer-only input, and the balancer has already run) and `avoid` — so the private
keep-apart preference never reaches a guest device at all, instead of shipping it and relying on
`showPrivateNotes` not to render it. The host's own board is unaffected: it renders from local
state (`todays` in `MatchDay.tsx`), never from the room copy.

The host's `adminToken` is minted with `secureToken()` (`crypto.randomUUID()`), not `uid()` — it's
the only thing proving a connection is the host, and `uid()`'s `Math.random()` tail is neither
strong nor long enough for a credential. Existing live rooms keep whatever token they were created
with.

**Known v1 limitation**: switching away from the Match Day tab and back drops the WebSocket (no
auto-reconnect-on-remount — click "Go live" again, which reuses the persisted room/link and resyncs
rather than minting a new room).

### 2.6 Results, history & rating suggestions

Recording what actually happened, and using it to question the ratings.

**What gets recorded.** At the end of the night the organiser enters **three numbers: how many
matches each team won**. Half-steps are ordinary — the house rule is that taking a shootout is
worth *half* a win, so `3.5` is a normal entry. That's the whole result: no per-match scores, no
head-to-head record, and no count of how many matches were played. It's deliberately what actually
gets written down rather than what would be most convenient to analyse, and §2.6's last part is
honest about what that costs.

Each team's count has **−/+ buttons stepping by half a win**, alongside the number field. Typing
`2.5` on a phone means switching to the numeric pad and finding the decimal key; two taps on **+**
doesn't. The field stays for direct entry, and both paths snap to the nearest half — anything finer
is a typo.

**Model** (`types.ts`): `TeamWins = Record<TeamColor, number>` on a `FixtureRecord`
(`{ id, date, teams, players, wins, mvpId? }` — `mvpId` is §2.13's MVP pick, the one field here that
isn't derived from the result), with `DraftTeamWins` (nullable) for the tally while it's
still being typed. `players` is a **snapshot** (`FixturePlayer`: id/name/rating at the time) rather
than a pointer into the roster, because guests are one-off and both names and ratings move; history
has to still read correctly years later.

**Entry**: `ResultsPanel.tsx`, rendered on the fixture page (§2.7) rather than inside `TeamsBoard`
itself — deliberately, since a live-room guest renders that same `TeamsBoard` and must not be able
to file a night into the host's history. Re-saving updates the same record
(`session.savedFixtureId`) instead of appending a duplicate; generating fresh teams clears both,
since an old tally no longer describes the new sheet.

**Shared, like the roster** (`src/remote.ts`, `GET`/`POST /history` on the same Worker as §6):
history is **not** local-only — every admin write (save, edit, delete) publishes the *entire*
fixture list to the shared store immediately, and any device adopts it on load if the remote
version is newer than what it last applied. Same last-write-wins model as the roster, and the same
tradeoff: fine at this scale (one organiser recording results after a match, not concurrent
editors), and simpler than merging individual fixture changes. Unlike the roster's explicit
**📢 Publish** button, this syncs automatically — asking someone to remember a separate publish
step after every night's scores was one more thing to forget, and unlike a roster edit (which is
provisional until reviewed and published), a saved result is already a completed fact. Reading is
public, same as the roster; **writing requires the admin word**, checked and rate-limited by the
same Worker code that already guards `/roster` (§6, `worker/roster-worker.js`) — so recording a
result now needs the organiser's word where it didn't before this was shared. A write that fails to
sync (offline, wrong word, rate-limited) still commits locally — the app alerts rather than losing
the correction silently, but the device with the fix is now ahead of everyone else's until it
reconnects and saves again.

**Correcting a night afterwards** (admin only, History tab — a non-admin sees a line saying so,
since an empty panel reads as a bug rather than a lock): expanding a past night offers
*✏️ Edit result* — the three win counts and the date — and *🗑️ Delete this night*. The team sheet
is deliberately not editable, since it's a snapshot of who actually played; a genuinely wrong sheet
means deleting the night and saving it again. Two consistency details live in `App.tsx` rather than
the component: editing or deleting the night that is *still open on Match Day* also patches
`session.wins` / clears `session.savedFixtureId`, so pressing "Save to history" again can't silently
undo the correction. The list is ordered by date rather than by insertion, so a night filed late or
re-dated still sorts correctly.

**Standings** (`playerStandings`): a player collects whatever their team won on nights they played,
so the table is nights / wins / wins-per-night. Without a matches-played count there is no true
win percentage — wins-per-night is the honest rate.

**Rating suggestions** (`calibration.ts`, History tab, admin only). Each night is turned into three
*pairwise* observations — black vs white, black vs blue, white vs blue — where the outcome is each
side's share of the wins the two of them took between them, weighted by how many wins that was (a
4–1 night is stronger evidence than 1–0). Every player is then solved for at once with
**ridge-regularised plus-minus**, so a result is attributed to whoever keeps turning up on the right
side of it rather than smeared equally across five shirts. Expectation uses **current** ratings, not
the night's, which makes an accepted suggestion self-cancelling rather than repeating.

**What the numbers actually support.** Constants were set by simulation (120 runs per setting: one
player a full star underrated, one a full star overrated, the other thirteen rated exactly right),
not by taste. At the chosen setting, for a genuinely mis-rated player:

| nights | found | pointed the wrong way | fairly-rated players flagged |
|---|---|---|---|
| 4 | ~8% | ~7% | 1.6 of 13 |
| 6 | ~18% | ~9% | 2.6 of 13 |
| 10 | ~28% | ~3% | 3.0 of 13 |

Suggestions need **four nights from that player** (`MIN_NIGHTS`) — counted per player, not per
season, so a regular builds a record while someone who turns up twice a year is never judged on it.
So it *can* speak from four nights, but usually won't, and **most players should get no
suggestion at all** — that is the intended behaviour, not a gap. The tuning run that made this
concrete: loosening the effect-size gate (`MIN_IMPLIED_DELTA`) from 1.5 to 0.6 roughly quadruples
how often it fires at four nights *and* pushes the wrong-direction rate to about 25% — it would be
recommending a downgrade for a genuinely good player one time in four. Three numbers a night is a
coarse record, and no amount of modelling manufactures information that isn't there.

**A rating is a claim that has to keep being justified.** The bar is not the same in both
directions: it's anchored at lower-mid (2.5★) and tilts with how far a player sits from it.
Climbing further from the anchor costs more evidence; sliding back toward it costs less.

| rating | to go up | to come down |
|---|---|---|
| 1.0 | 1.35 | 1.65 |
| 2.5 | 1.50 | 1.50 |
| 4.0 | 1.65 | 1.35 |
| 5.0 | 1.75 | 1.25 |

So a 5★ needs somewhat more evidence to be promoted than to be dropped, and a 2★ the reverse. The
anchor sits below the arithmetic middle deliberately: squads have a few genuinely strong players and
a long ordinary tail, and hand-set ratings drift upward over time because nobody enjoys arguing
someone down.

The size of the tilt (`RATING_BIAS`) was lowered once already, from 0.20 to 0.10, after testing
showed it too aggressive at the top. Over 120 runs × 20 nights on a realistically spread roster, at
0.10 a 5★ who is really a 3.5 is flagged for a drop 47% of the time, and — the actual cost — a 5★ who
genuinely *is* a 5 is flagged 17% of the time. At the original 0.20 those were 58% and 28%: steepening
the tilt does catch more genuine over-ratings, but it worsens the false-flag rate on a correctly-rated
player *faster*, which is the wrong direction to trade in — a wrong "demote your best player" costs
more trust in the feature than a missed "you should probably drop this one" costs opportunity.
Suggestions are dismissible and only ever move half a star, but a panel that keeps nagging you about
your best player trains you to stop reading it.

**Running out of scale.** A player already at 5★ who keeps beating expectation, or one at 1★ who
keeps falling short, has no half-star left to move. Rather than silently dropping the case (which
left them showing a large "vs rating" number with no explanation), it's reported as a note with
`atLimit: true` — shown without an Apply button and sorted below the actionable suggestions. The
note says what it means in practice: since the balancer only ever *compares* players, a ceiling
player who keeps over-performing means the top of the scale is compressed, so teams built around
them are stronger than their numbers admit, and the fix — if it persists — is to nudge the rest of
the roster down rather than to invent a 5.5.

Two further caveats worth keeping in view:

- Converting "surprise in results" into "stars" assumes a model of how ratings drive wins that this
  data cannot check. Simulation shows the sign and ordering hold up while the magnitude can be well
  out — hence a suggestion never moves more than half a star, and the UI calls them prompts rather
  than verdicts, with an `early` badge until a player has a real number of nights behind them.
- Short-handed nights lend players between teams (§4), but an aggregate tally can't say which
  matches those were, so a loaned player is credited to their own team for the night.

The standings therefore also carry a raw "vs rating" column, on the same `MIN_NIGHTS` floor as the
suggestions: blank below four nights, then greyed until `|z| ≥ 1.5`. Showing a number for someone
with one night behind them read as the app passing judgement on them, which is exactly the
impression the floor exists to avoid.

### 2.7 The fixture page

Once the organizer is happy with tonight's teams, **▶️ Start fixture** on the teams board
(`TeamsBoard.tsx`) locks them in: `session.fixtureStarted` flips to `true` and `MatchDay.tsx` swaps
from the editable teams board to `FixturePage.tsx` — teams shown **read-only** (no drag-and-drop, no
re-roll, no live-room controls) plus **🏁 Tonight's results** (`ResultsPanel.tsx`, moved here from
directly under the board — see the "Entry" note in §2.6). This is meant to be the page open *during*
the match, separate from the team-building page before it, and the natural place to add more
once-the-teams-are-set features later.

**The team display here is deliberately compact** — names as small wrapped chips (one line per team,
~78px for all three) rather than the board's one-tall-row-per-player (~270px). On this page the
teams are a reference you glance at, not something you work on, so they yield vertical space to
whatever else the page carries; the results panel stays above the fold on a phone, which it did not
when the full board was reproduced here. Kept in the chip: the 🧤 keeper marker (worth knowing
mid-match) and a small ★ for guests. Dropped: per-player role icons, which are a team-building
input rather than something you check during the match.

**Unlocking admin here.** Saving a result needs the admin word (§2.6), so the fixture page offers
**🔒 Unlock admin to save** in place of the results panel's old "unlock on the Roster tab" text —
same prompt, same server-side check, just without the trip to another tab and back mid-match. The
logic is shared, not copied: `useAdminUnlock` (`src/useAdminUnlock.ts`) now backs both this button
and the Roster tab's 🔒 Admin. `ResultsPanel` falls back to the old static text when no
`onUnlockAdmin` is passed, which is what happens when `REMOTE_URL` is empty and there is no server
to verify a word against.

**← Back to teams** undoes a mistaken click without losing anything: it just flips
`fixtureStarted` back to `false`, landing back on the same teams board (still editable, re-rollable,
`Go live`-able) with whatever result was already typed in still there — nothing is cleared.
`session.fixtureStarted` persists in `localStorage` like the rest of the session, so a page refresh
while the fixture is open reopens the fixture page rather than dropping back to the teams board.

**⏹️ End fixture** is the opposite: the night is over, wipe it and start again from availability.
It's the *same action* as the teams board's **🆕 New Fixture** — one `newFixture()` in `MatchDay.tsx`
backs both, so closing the live room, clearing `getHostRoom`, resetting to `emptySession()` and
returning to step 1 can't drift apart between the two entry points. It's offered here because this
is the page you're actually on when a night finishes; walking back to the teams board to end the
night made the button hard to find at the only moment it's wanted.

Being destructive, it confirms first, and the confirmation **says which thing you're about to
lose**: if a result has been typed but not filed to history, the prompt leads with that rather than
the generic "clears today's selections". History itself is untouched — ending a fixture clears the
session, never the saved nights (§2.6).

**What else is on the page**, top to bottom: tonight's milestones (§2.9), the match clock (§2.8),
and the results panel. Everything here is either read-only or costs a single tap — a deliberate
constraint, since anything needing steady input during a match (live scores, goal scorers) gets
abandoned after a few weeks and leaves half-complete data behind, which is worse than none.

### 2.8 The match clock (and the rules of a match)

**The house rules**, which this is the app's record of:

- A match is **8 minutes**, or ends early at a **two-goal lead** — 2:0, 3:1, and so on.
- **Level after 8 minutes** → **2 minutes of added time**, played as **golden goal**: the next goal
  ends the match immediately.
- **Still level after added time** → **penalties**.
- **The team that isn't playing shouts when there's a minute left.** It's their job, not the
  players', because they're the only ones not busy.

`MatchClock.tsx` automates the **time** half only, and knows nothing about the score — the app
deliberately doesn't collect one live (see the constraint above). So:

- ▶️ Start runs the 8 minutes down. At **1:00 remaining** the clock turns red, says *"One minute —
  resting team shouts!"* and beeps twice. That's a prompt for the resting team to do their job, not
  a replacement for it; the shout is what the players on the pitch actually hear.
- At **0:00** it beeps three times and offers the one decision the score governs: **⚽ Level — added
  time** (2:00, golden goal), or **⏭ Next match** if the match was already settled. One tap, at a
  natural break — not a running tally.
- Added time expiring lands on *"Still level — penalties"*.
- A match ending early on a two-goal lead just ends with **⏭ Next match**, same as any other.

Implementation notes: the countdown is computed from a wall-clock `endsAt` timestamp rather than by
decrementing a counter, so a backgrounded/throttled tab doesn't quietly lose time. Beeps are
synthesised with Web Audio (no audio asset to ship), and the `AudioContext` is created on the first
Start press — a user gesture — because iOS won't let it make sound otherwise. A screen wake lock is
held while the clock runs, since a pitch-side timer the phone blanks after 30 seconds isn't one;
browsers without `navigator.wakeLock` simply don't get it.

**This one is on trial.** It's the most speculative thing on the page, so it's kept trivially
removable: `MatchClock.tsx` is entirely self-contained (no props, no session state, nothing
persisted), so backing it out is deleting that file and its two lines in `FixturePage.tsx`.

### 2.9 Tonight's milestones

`src/milestones.ts` (+ `milestones.test.ts`) turns `AppState.history` into a one-line note above the
clock: *"🎉 אופק's 50th night · ✨ First night for דור"*. Zero input — it's counting, not tracking.

Everything here is a **count**, never a verdict. The line between the two is the whole design rule:
*"won the last three nights"* is checkable arithmetic, while *"is in form"* or *"these two click"*
are claims about ability that a night's three win totals cannot support — the same reasoning that
keeps rating suggestions behind `MIN_NIGHTS` (§2.6). The copy is written to stay on the count side,
which is why the streak line says "has won 3 nights running" rather than anything about form.

The facts, and what each needs:

| Fact | Fires when | Notes |
|---|---|---|
| 🎉 Nth night | 10, 25, then every 50 | roughly a mention a year once established |
| 🏆 Nth win | crossing 50, 100, 250, then every 500 | wins are fractional, so it's a *crossing*, not equality |
| 🦾 N nights straight | run ≥ `MIN_ATTEND_STREAK` (8) | attendance, not results — see below |
| 📈 Won N nights running | run ≥ `MIN_WIN_STREAK` (3) | ~one player on any given night |
| 💤 Hasn't won in N nights | run ≥ `MIN_WINLESS_RUN` (5) | the same maths inverted |
| ✨ First night | see the debut rules below | |

**🦾 is attendance, not results — a different axis from the streaks above it.** It counts
consecutive nights *on the sheet*, whether or not a result was ever recorded that night, and breaks
on a single missed night the way a win streak deliberately does not (win streaks skip a missed week
rather than break on it, since the question there is "on nights they played, how did it go"; the
question here is "did they show up", so missing is the one thing that has to end it). `MIN_ATTEND_STREAK`
(8) is a starting guess, unlike the two ladders below it — those were also guessed first and only
correct once real nights showed the true rate. This constant is due the same treatment once there's
enough attendance history to look at.

**The two ladders are calibrated against real results, not guessed.** The first recorded night
finished 7 / 5 / 2 — **14 wins shared between the three teams**, so a player banks roughly 4–5 wins
per night, not the 1–2 `isWinMilestone` first assumed. That had 🏆 firing about three times sooner
than intended, and because everyone accrues at much the same rate, half the squad would have crossed
a low threshold within a fortnight of each other and crowded the streaks off the line. At ~4.7 a
night the current ladder lands near nights 11 / 22 / 54 / 107 — comparable rarity to the nights
ladder, and offset from it so one player rarely trips both on the same evening. **If the format
changes (longer matches, more or fewer of them), this is the constant to revisit.**

**Winning the night is derived, not recorded.** The organiser enters three win counts (§2.6); there
is no stored notion of who "won". `winnerOf` defines it as *strictly* the most wins, so a tie at the
top means nobody took the night. Runs count **nights played** — a week someone missed doesn't break
a streak, matching how `MIN_NIGHTS` is counted per player rather than per season — and a night with
no result recorded is skipped rather than counted as a loss, since it says nothing either way.

**Timing.** Most facts are knowable before kick-off, but a career-win crossing depends on tonight's
result, so it only appears once the night is saved. That's also why `tonightsMilestones` takes
`session.savedFixtureId`: tonight must be **excluded** from the nights count (it's the +1) and
**included** in career wins. Getting this wrong is a real bug that existed briefly — saving the
result flipped "your 50th night" to "your 51st".

Three debut details that are each a bug someone would otherwise hit:

- **Guests are skipped entirely.** A guest gets a fresh `uid` every visit, so their history never
  matches and they'd be "making their debut" every single week.
- **No debuts claimed until there are `MIN_HISTORY_FOR_DEBUTS` (5) nights on record.** A debut means
  something only if the history is deep enough that *absence* from it is informative; on a fresh
  install everyone is trivially absent, which tagged the entire squad at once.
- **More than `MAX_NAMED_DEBUTS` (3) first-timers collapse to one line** ("✨ 13 first nights
  tonight"). Past that it stops reading as a milestone and starts reading as a list.

At most `MAX_SHOWN` (5) facts are rendered, ranked rarest-first. In practice it's usually nought or
one; the cap only exists so a freak night can't turn the line into a wall.

### 2.10 Duo records

`src/duos.ts` (+ `duos.test.ts`) adds one more line: the best and worst **pairing** among tonight's
players — *"🤝 יועד & חנש have won 12 of their 12 nights together"*.

**Why it's phrased as a record and not a verdict.** The obvious feature here is "these two play well
together", and the data cannot support it. Detecting a genuinely large chemistry effect (≈ +0.5 wins
a night) would take something like **45 nights together**, and well over 100 once you account for a
15-player squad containing ~105 possible pairs — test that many and the best-looking one is noise
almost every time. Four nights at 100% isn't even surprising: at a two-in-three base rate that
happens by chance about one time in five. So the UI states the count and lets the reader draw their
own conclusion.

Worth knowing: the app already has the honest version of this as an **input**. `chemistry` and
`avoid` on `Player` (§2) are human-declared and the balancer acts on them. This section is a record
of what happened, not a competing inference about who ought to play together.

**How a short record is stopped from winning.** Rather than a hard cut-off, the win rate is shrunk
toward the measured base rate as if every pair began with `SHRINK_K` (20) ordinary nights, and a
pair must then clear `MIN_EDGE` (0.10) to be worth a line. At a 50% base that puts a 4-from-4 pair
at 0.583 — quiet — and a 15-from-20 pair at 0.625 — reported. So `MIN_TOGETHER` (4) is a floor that
in practice rarely binds: a pair realistically needs 10–15 nights together before it can surface.
Early records are still collected and ranked; they just can't win on the strength of being small.

Two smaller details: the base rate is **measured** from tonight's players rather than assumed to be
a third (ties at the top drag it below that), and guests are excluded for the same id-churn reason
as milestones.

The scoring engine (`computeDuoRecords`) is factored out from `duoFacts` so it can also drive the
monthly recap's best-pairing stat (§2.11) over a different set of ids/fixtures — same shrink-toward-
base-rate math, applied to "everyone who played this month" instead of "tonight's squad".

### 2.11 Monthly recap ("Wrapped")

`src/wrapped.ts` (+ `wrapped.test.ts`) turns a calendar month of `AppState.history` into a small set
of counts, rendered as one or two shareable "story" images (`src/wrappedImage.ts`, same
canvas-drawing approach as `shirtImage.ts`) via a **📊 Monthly recap** picker + **🖼️ Share recap**
button at the top of the History tab. Visible to everyone, not just admins — sharing a recap is not
a write.

**Deliberately monthly, not seasonal or yearly.** The app has no notion of a "season" boundary, and a
full year is a long wait for the first shareable moment; a month is close to the natural size of "a
few weeks of Thursdays" and gives the picker something to show early. `wrappedPeriods` only lists
months that actually have a recorded night, so the picker never offers an empty one.

**Two images, not one long scroll.** `renderWrappedImages` always returns a "highlights" page (hero,
MVP/match/fixture leaderboards, attendance, longest streak, best pair); a second "also happened" page
— the banter side (§2.13) — only gets rendered when there's actually something to say
(`hasAlsoHappened`), and both go out together as one multi-file share, same pattern as
`shirtImage.ts`'s three team shirts. This is the split point the app already had for free: page 1 is
everything already gated positive/neutral, page 2 is exactly the `buildNegativeTiles`/`worstDuo`
content that used to live under an "😬 ALSO HAPPENED" divider on a single card. Splitting there means
neither page needed new gating logic, just a second, lighter-headed canvas.

**Every card's height is measured, not guessed.** A tile grid, a leaderboard, the attendance list —
each has a `*Height`/`leaderboardHeight`/`wrapNames`-driven size computed before the canvas exists, so
a quiet month (few stats) produces a short image and a busy one a tall one, never dead space or
clipping. The attendance card is the trickiest case: how many lines a name list wraps to depends on
the actual font metrics, so that one measurement pass runs against a throwaway `<canvas>` context
before the real canvas (whose height depends on the answer) is even created.

**Reuses existing engines rather than inventing new ones.** `topMatchWinners`/`topFixtureWinners` are
top-3 tallies over the month's fixtures — kept as two separate rankings rather than one "top scorer"
because this app has no goal tally (§2.6): a *match* win is the three-numbers-a-night team credit,
a *fixture* win is whether that team was the strict top of the whole night (`winnerOf`, same
definition milestones/duos already use), and a player can lead one without leading the other.
`perfectAttendance` lists everyone whose night count equals the month's total, not just the single
top attendee (an earlier version did that and mislabeled a merely-good month "never missed").
`longestStreak`/`longestWinless` reuse `appearances` (exported from `milestones.ts` for this purpose)
and gate on the same `MIN_WIN_STREAK`/`MIN_WINLESS_RUN` as tonight's own facts; `bestDuo`/`worstDuo`
reuse `computeDuoRecords` (§2.10) with "everyone who played this month" as the relevant id set instead
of "tonight's squad". `topMvps` is the one exception to "every line is a count, not a verdict" —
see §2.13 for why that's fine.

### 2.12 Balancer trust dashboard

`src/trust.ts` (+ `trust.test.ts`), admin-only, in the History tab. The balancer (§3) optimizes for a
small rating gap between teams, but nothing else in the app ever checks whether that prediction shows
up in the result — this closes that loop by plotting, per recorded night, the **predicted** gap
(spread between team-average ratings, derived from the `FixturePlayer` snapshot already on the
record — no new data needed) against the **actual** gap (spread in win share). A scatter chart (inline
SVG, no charting library — consistent with the rest of the app) plus a one-line Pearson correlation
readout (`trustCorrelation`), gated at `MIN_TRUST_NIGHTS` (8) the same way `MIN_NIGHTS` gates rating
suggestions (§2.6).

**Purely descriptive, on purpose.** Nothing here feeds back into team generation — same posture as
`calibration.ts`'s rating suggestions, a number to look at rather than an auto-tune loop. The
correlation readout is written in tiers (tracks together / barely tracks / moves opposite) rather
than a bare number, and the "barely tracks" case explicitly allows for the honest possibility that
8-minute matches are just noisier than a rating gap can predict, rather than assuming the balancer
must be wrong.

### 2.13 MVP picks

The one deliberately subjective input in the app, sitting next to a whole design rule (§2.9) built
around never claiming more than the win tally supports. `FixtureRecord.mvpId` (optional, `types.ts`)
is the organiser's own pick for tonight's standout player — any id from that night's `players`,
guests included. `src/mvp.ts`'s `mvpCounts(fixtures)` is the one small piece of logic here: how many
times each player has been picked, ranked most first, over whatever fixture list it's given (the
whole history for a career total, an already-month-filtered list for the recap).

**Entry**: `MvpPicker.tsx`, a single `<select>` on the fixture page, rendered above **🏁 Tonight's
results** (`FixturePage.tsx`) — same host-only, not-visible-to-a-live-room-guest placement as
`ResultsPanel` (§2.6), and saved in the same `saveNight()` call rather than as a separate step.
Optional; `session.mvpId` resets to `null` whenever fresh teams are generated, same as `session.wins`
— an old pick against last week's sheet shouldn't survive onto a new one. `MvpPicker` is reused (with
different copy) inside History's **✏️ Edit result** form (below) to add or correct a pick on a past
night — its `players` prop only ever needs id/name, so the same component works from a live squad
(`Player[]`) or a saved night's `FixturePlayer[]` snapshot. That edit patch always carries `mvpId`
explicitly, even as `undefined` for "no pick" — the field is how a wrong pick gets *cleared*, and
omitting the key from the patch would leave the old id in place instead of clearing it.

**Read**: two places.
- **History's standings table** (§2.6's table) gains an **MVPs** column, sortable like the others,
  built from `mvpCounts(history)` — a *career* total, since it isn't month-scoped there.
- **The monthly recap** (§2.11) leads with a **🌟 Most MVP picks** leaderboard, `mvpCounts` given only
  the month's fixtures. Deliberately **not** capped at 3 the way the match/fixture-win leaderboards
  are: an MVP pick is one player a night, so it routinely spreads across more than three people in a
  month, and cutting it off there would hide most of who actually got picked. The card just grows to
  fit, same as the attendance list.

**Why this is fine to just count, when nothing else in the app gets that treatment.** Every other
fact here is derived from a win tally specifically *because* a human declaring "this player was good"
is a claim the three-numbers-a-night record can't support. MVP inverts that: it *is* the human
declaring it, recorded as what it actually is — the organiser's call — rather than manufactured from
data that was never rich enough to support it. The count is honest because it's counting a real,
already-made judgment, not synthesizing one.

### 2.14 Two audiences: the organiser and the group

Everything above was written for one person with the app open on the touchline. Sending it to the
rest of the team makes it a *read* surface for fifteen people and a *write* surface for one, and
those want almost opposite things — so admin mode stops being "unlock to edit ratings" and becomes
the line between the two audiences.

What a normal user gets, and why:

| Surface | Normal user | Admin only | Why |
|---|---|---|---|
| Roster | read the squad | add / edit / ✕ | who is in this club is the organiser's call |
| Player ratings, attack spectrum, keep-apart lists | — | ✓ | already the line the public roster read draws (§6) |
| Match day (availability, guests, balancer, teams board) | — | ✓ | the workbench, not the scoreboard |
| History: nights, standings, fixture wins, MVPs, badges | ✓ | | the part worth sharing — see §2.15 |
| History: "vs rating" column, rating suggestions, balancer trust | — | ✓ | opinions about players, not counts of what happened |
| Monthly recap generator | — | ✓ | a produced thing the organiser sends out, not a button on everyone's screen |
| Tonight's fixture: teams | ✓ | | the one thing a player actually opens the app for |
| Starting / pausing the match clock | ✓ | | 8-minute matches; whoever is nearest the phone runs it (§2.15) |
| Tonight's MVP, tonight's results | — | ✓ | the organiser's calls, recorded once |
| Starting / ending a fixture | — | ✓ | exactly one night can be live at a time |

The rule these follow: **a count of what happened is shareable, a judgement about a person is not.**
Nights, wins, fixture wins, MVP picks and streaks are all counts. Ratings, the attack spectrum,
"vs rating", keep-apart lists and rating suggestions are all somebody's opinion about a player, and
they stay with the person whose opinion it is. This is the same line §6 draws on the wire for the
public roster read, applied to the screen.

Gating is by *absence*, not by disabling: a hidden tab has no route to it (`Tab` in `App.tsx`
simply never renders `match` without admin, and switching admin off while standing on it moves you
somewhere that still exists). Where a control's absence would read as a bug rather than a lock —
correcting a past night — there's an explicit "🔒 Unlock admin" line instead.

### 2.15 The live fixture (`src/live.ts`, `LiveFixtureView.tsx`)

Match day is admin-only, which leaves everyone else with no way to find out what team they're on.
So starting a fixture publishes it: `POST /live` on the same Worker, one KV key, read publicly by
`GET /live`. One key is the whole "only one fixture can be live" rule — the app can never be in a
position to ask which of two is the real one. Ending the night (or **← Back to teams**, since a
night being re-picked is not one to read your team off) deletes the key. A 12-hour TTL covers the
organiser who closes the tab mid-night, the same reasoning as the live rooms' idle expiry (§2.5).

A 🔴 **Live** tab appears in the top nav while one is on — pulsing dot rather than the word alone,
because on a phone in a car park it has to read as *now* at a glance — and the app lands on it the
first time it hears about a fixture, once, never over a tab the user picked themselves.

**For the organiser running tonight, that tab *is* the fixture page** — the same milestones, MVP
picker, result panel and End fixture they get from Match day, rendered by the same component rather
than duplicated. Two tabs showing two different views of the match you are standing in the middle of
is a worse answer than two tabs showing the same one.

Which device is holding the night decides only what can be *drawn*, never what is allowed. The
fixture page needs ratings, guests and history that the deliberately-thin live payload doesn't
carry, so a phone that didn't start the night has nothing to render it from — but that is a plumbing
limit, not a permission, and it must not become one. So an admin device that lacks those simply goes
and gets them: opening Live rebuilds the session from the live record plus this device's own roster
and history (`adoptLive`), and the full page appears. No button, no "take over" step — adoption is
purely local, publishes nothing, and two admin devices doing it cannot conflict. The only thing it
can cost is a squad half-picked on that device, which needs a live match, a second admin phone and
an in-progress selection all at once; making every organiser learn an extra concept to avoid that
was the worse trade. The one real gap is guests: they exist only for tonight and are in nobody's
roster, so they return with a name and an unknown rating — which moves the displayed team average
and nothing that gets saved.

**⏹️ End fixture** is offered to any admin on any device regardless, since ending needs no local
state at all. It covers the moment before adoption, and the case where adoption can't help — an
organiser whose browser was cleared must never be left watching a fixture they own with no way to
stop it, which is exactly what happened once.

Both ways out of that page (**← Back to teams**, **⏹️ End fixture**) leave the Live tab with nothing
to show, so whoever was running it here is moved to Match day, where everything they would do next
lives. Keyed on *having been* the device running it rather than on being admin, so the second-phone
organiser above keeps the read-only view they asked for. Ending also drops the fixture from local
state immediately (`forget()`) instead of waiting a poll cycle to be told what they just did.

**What travels is deliberately thin.** `LivePlayer` is `{id, name, isGk?, isGuest?}` — no rating, no
attack value, nothing the balancer used. The team cards show how many players, never the average
rating that sits in the same corner on the organiser's board. This is privacy by *payload*, not by
CSS: there is nothing in what a viewer receives to reveal, so no future change to the view can leak
it.

**Polled, not pushed.** The live rooms in `liveRoom.ts` already do WebSockets, but they exist for
dragging players between teams, where lag is felt; this is a scoreboard. Polling needs no connection
kept alive on fifteen backgrounded phones. Two rates — 10s while a fixture is on, 60s otherwise —
and none at all on a hidden tab, with an immediate poll when the tab comes back, which is both when
the answer is most likely to have changed and when it is about to be looked at.

The delay for the *next* poll is taken from what the poll just returned, held in a plain local
variable — never read back off React state. The next poll is scheduled synchronously after
`setFixture`, before any re-render, so state there still holds the previous answer: reading it meant
the first poll of a live fixture scheduled the *idle* rate, and the app dropped to one check a
minute exactly when a clock was running. Caught by driving two browsers rather than by a test, and
the reason the comment in `live.ts` is as long as it is.

**The clock** (§2.8) moved out of `MatchClock.tsx` into shared state, so there is exactly one clock
per night and everybody is looking at it — the organiser included, whose fixture page reads
`liveClock` rather than keeping a private copy. What crosses the wire is `endsAt`, an absolute epoch
ms, not a countdown, so a device whose poll lands ten seconds late still renders the correct time;
only the *transition* is late, never the number. `Session.clock` survives as a local fallback for a
refresh while offline. Publishing happens on start/pause/next-match — a handful a match, not one a
tick, since the seconds in between are counted down locally by each device.

**Anyone can run it**, which is the one place this app accepts an unauthenticated write. At 8
minutes a match, whoever is nearest the phone has to be able to start it; routing that through the
organiser makes the clock useless. `POST /live/clock` therefore takes no secret, and is kept safe by
being *narrow* instead: it replaces only the `clock` field of a fixture that is **already live**, so
it cannot create a fixture, cannot end one, and cannot touch teams, players, ratings, the roster or
the history — the handler copies the validated clock onto the stored record and ignores everything
else in the body. Rate-limited per IP on its own counter, and shape-checked as strictly as any
authenticated write, because a non-numeric `endsAt` would render as `NaN` on fifteen phones at once.
The worst a stranger who read the Worker URL out of the public bundle can do is show a wrong number
for a few minutes, which the next press of Reset undoes.

Two consequences of shared control worth naming. A press is applied **optimistically** and outranks
incoming polls for `LOCAL_CLOCK_GRACE_MS` — a request already in flight when someone hits Start
carries the *previous* clock, and letting it land afterwards would snap the button back. And
`MatchClock` tracks whether anyone on *this* device has pressed anything: the beeps, the wake lock
and the writing-down of "the match ended" all follow that, not merely having the controls. One phone
beeping at the one-minute mark is a cue, fifteen is a mess — and pressing a button is also the
gesture iOS requires before it will play audio at all, so the opt-in and the platform requirement
turn out to be the same event.

### 2.16 Achievement badges (`src/achievements.ts`)

Small emoji badges beside each name in the standings, plus a **Fixtures** column — whole nights a
player's team finished top of, which is a different question from match wins (a team can bank a
blowout on one night and still top fewer nights than one that edges every week; the recap already
splits these two, §2.11).

Every badge is a count with a sentence behind it, readable on hover and listed in a key under the
table so nothing is a mystery emoji: 🥇 most wins, 🏅 most nights won, 🌟 MVP picks, 🦾 hasn't missed
a night in 8+, 📈 longest winning run, ✨ played every recorded night, 🎖️ 25+ nights. Ties **share** a
badge rather than being broken — two players level on wins are exactly as level as the number says.
Thresholds are the ones the app already uses elsewhere (`MIN_WIN_STREAK`, `MIN_ATTEND_STREAK`), so a
badge and the fixture-page milestone that announces it agree.

Nothing here is new data; it is all re-read from `history`. And nothing here is a verdict — "most
wins in the club" is a fact about a column, "best player" is a claim three numbers a night cannot
support, and it is not on the list (§2.9).

### 2.17 Match-clock notifications (`src/push.ts`, `worker/push.js`, `worker/clock-notifier.js`)

A buzz at one minute left and at the whistle, on any phone that opts in — including one that is
locked, in a pocket, with the app closed.

**Why this can't be a timer in the page.** It was asked for as a Dynamic Island widget, which no
web app can have: Live Activities are native ActivityKit, with no web API. What *is* reachable is a
notification — but only via a real push service. A backgrounded iOS Safari tab is suspended within
seconds, so a `setTimeout` scheduled for seven minutes' time fires in exactly the cases nobody needs
it (screen on, app open, clock visible) and never in the case they do. The scheduling therefore
lives on the server, where nothing sleeps.

**Four moments**, each announced once: one minute left and time up, in *both* regulation and added
time. The added-time warning is new — the on-screen clock only ever beeped the one-minute shout in
regulation (§2.8) — and matters because two minutes of golden goal is short enough that halfway
through is worth knowing.

**How the timing works.** The clock already travels as an absolute `endsAt` (§2.15), so the instant
anyone presses Start every announcement time is known. `POST /live` and `POST /live/clock` both hand
the new clock to a `ClockNotifier` Durable Object, which recomputes its triggers from scratch —
pause, reset and next-match all land here, and "what is still to be announced" is always fully
determined by the clock as it stands, never by what was pending before. A DO holds one alarm at a
time, so the pending triggers are a list and the alarm is set to the earliest; firing the first
arms the second. A late alarm fires everything now due rather than stranding it.

**What it says** is deliberately generic — "⏱️ One minute left", "🏁 Full time" — because these land
on lock screens that anyone standing nearby can read. Naming the teams would put tonight's line-up
on fifteen strangers' screens for no gain, and the people who care are already at the pitch.

**The crypto is hand-written and that is the risky part.** The Worker runtime has no Node built-ins,
so `web-push` is unusable and `worker/push.js` implements VAPID (RFC 8292) and payload encryption
(RFC 8291 over RFC 8188) directly on Web Crypto. This is the one file in the project where a wrong
byte is *invisible*: the push service returns 201 Created and the phone simply never buzzes, with
nothing thrown and nothing logged. So the test does not check it against itself — the expected
ciphertext in `push.test.js` was produced by `http_ece`, the library `web-push` itself uses, from
pinned keys and salt, and the two agreed byte-for-byte. A `TTL` of 120 seconds is deliberate: "one
minute left" is worse than useless after the final whistle, so it expires rather than queues.

**Opting in is per device and off by default** (`NotifyToggle`, rendered by `MatchClock` so the
player's Live view and the organiser's fixture page get the identical control). Granting a browser
permission once is not consent to be buzzed every Thursday forever, so the toggle — not the
permission — is what decides, and turning it off drops the subscription server-side rather than
just hiding a button. Subscribing needs no admin word, for the same reason running the clock
doesn't: it is a thing any of the fifteen people at the pitch might do, and all a subscription can
ever receive is those four fixed sentences. A push service answering 404/410 means that device is
genuinely gone and it is pruned; a 5xx is a bad day and it keeps its place.

**iOS requires the site to be added to the Home Screen** — Apple allows web notifications only for
installed web apps. Hence `public/manifest.webmanifest` and the `apple-mobile-web-app-*` tags, and
hence `pushSupport()` returning `needs-install` rather than `unsupported` when the API is absent on
an iPhone, so the app can give the one instruction that fixes it instead of a dead toggle. That
check is iOS-only on purpose: a desktop browser without push is missing it permanently, and "Add to
Home Screen" there would be nonsense.

**Setup** is one secret. `node worker/generate-vapid-keys.mjs` prints a private JWK for
`wrangler secret put VAPID_JWK`; the public half is derived from it and served at `GET /push/key`,
so there is no key pasted into the source and no way for the two to drift apart. With no secret set,
the whole feature is simply absent — the toggle doesn't render and the notifier stays quiet.

**What is verified, and what isn't.** Byte-exact agreement with the reference implementation; a real
subscriber decrypting a real `sendPush`; the alarm chain, pruning and the four messages, against the
Durable Object itself; all four notifications rendering through the actual service worker. The one
link that cannot be tested locally is `pushManager.subscribe()` — an automated Chromium has no push
service to register with, so it fails there by construction. Everything on both sides of it is
covered; that step needs a real device.

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
| Rating balance | high | spread between team rating sums (normalized per player when sizes differ — a 4-player team is compared by average, not sum) |
| Badge mix | medium | each team should have a spread of defensive/balanced/attacking players rather than e.g. all-attackers — counts by derived badge |
| Role strength | medium | spread between teams' **defensive** and **attacking** strength (both ends scored separately). Each outfield player splits their *rating* across the two ends in proportion to their spectrum position — a 5★ at `attack: 0` contributes 5 defence, a 3★ contributes 3 — so quality is balanced *per role*, not just overall. This is what stops one team getting the 5★ defender while another makes do with the 3★ one; the aggregate rating term can't see where a team's strength sits, and badge counts treat both defenders as one head each. Anyone in goal today (permanent or temporary) is excluded from both pools, matching how their rating is already handled. With equal ratings this reduces to plain mean-attack balance, so it generalises rather than replaces that idea |
| Chemistry | medium | bonus for each prefer-together pair on the same team |
| Keep apart | medium | penalty for a "prefer on separate teams" pair landing together. Weight 18 (was 40) — deliberately a nudge that yields rather than a near-hard constraint. In practice a single pair is separated ~100% of the time anyway (with 15 players across 3 teams it costs almost nothing); the weight only bites when preferences conflict with each other, where the balancer now accepts the unavoidable clash rather than wrecking rating balance chasing an impossible split |
| Unknown spread | medium | avoid two unknown-rating guests on the same team (unless glued to the same inviter) |
| Variety (later) | low | penalize repeating last week's exact teammates, so teams rotate over the season |

Weights are constants inside `src/balancer.ts` (no settings UI exists to tune them at runtime).

The generator returns the **top 5 distinct results**, so the organizer can flip between alternatives
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
"🔁 Rotation plan" section on screen whenever any team is short.

**The WhatsApp share text deliberately omits the rotation lines** (`shareText` in `TeamsBoard.tsx`,
guarded by `totalAssigned >= 15`). Note what this means in practice: teams are sized by
`targetSizes(n)` = `floor(n/3)` + remainder, so a team is short only when `n < 15` — which is
exactly the case the guard excludes. So the rotation block **never** appears in the shared text
today; the guard is equivalent to deleting the block, and is written as a threshold only so the
intent ("don't paste rotation into WhatsApp for a short-handed night") stays legible. The on-screen
panel is unaffected — the organizer still sees the plan, it just doesn't go into the group chat.

## 5. Screens (`src/App.tsx` — tabs, no router)

Which tabs exist depends on whether admin is unlocked (§2.14): a normal user gets **Roster** and
**History**, plus **🔴 Live** while a fixture is on; the organiser additionally gets **Match day**.


1. **Roster** (`src/components/Roster.tsx`) — the permanent squad. In **admin mode**: add/edit
   name, aliases, rating, role (GK toggle, or a 0–100 defence↔attack slider in steps of 5),
   chemistry/avoid links, ✕ to remove, and 📢 Publish. Everyone else sees the squad as a list to
   read — no Edit, no ✕, no + Add player, and no ratings or keep-apart lists (§2.14). Top-right
   shows a small `v<hash>` build marker (§6) so you can confirm a deploy actually landed after
   pushing.
2. **Match day** (`src/components/MatchDay.tsx`, the main flow):
   - Step 1 *(who's playing)*: tick available players from the roster grid, optionally use
     **📋 Import a pasted list** to bulk-mark attendance from pasted text (§2.4), and add/remove
     guests manually (name + optional inviter + optional rating guess) — guests can be edited
     in place afterwards (rating, inviter) via `updateGuestRating`/`updateGuestInviter`.
   - Step 2 *(goalkeepers)*: mark who can go in goal today (permanent `isGk` players are
     always included).
   - **Generate** → `src/components/TeamsBoard.tsx`: three colored team cards (black/white/blue)
     with per-team total/average rating, GK badge, role icons, and the rotation plan if a team
     is short. Drag-and-drop players between teams (native HTML5 DnD, no external library); balance
     numbers update live. "Re-roll" cycles through the alternative generated results. A **Share**
     button copies WhatsApp-ready text (`shareText`/`copy` in `TeamsBoard.tsx`). Optionally,
     **🔴 Go live** turns this board into a shared live room others can join and drag in — see §2.5.
   - **▶️ Start fixture** → `src/components/FixturePage.tsx`: locks tonight's teams in and shows
     them read-only (§2.7), with tonight's milestones and duo records (§2.9, §2.10), the 8-minute
     match clock (§2.8), **🌟 Tonight's MVP** (`MvpPicker.tsx`, §2.13, optional) and **🏁 Tonight's
     results** (`ResultsPanel.tsx`) to file the night. Starting also publishes the fixture to the
     whole group (§2.15); ending it takes it back down.
     **← Back to teams** returns to the editable board above without losing anything, in case the
     teams need another look; **⏹️ End fixture** wipes the night and starts over, the same action
     as the board's 🆕 New Fixture.
3. **History** (`src/components/History.tsx`) — open to everyone: past nights (expandable to the
   team sheets and each team's wins) and a standings table of nights / wins / fixture wins /
   wins-per-night (a shootout counts as half) / MVPs (§2.13), with achievement badges beside each
   name and a key beneath (§2.16). Admin mode adds the **📊 Monthly recap** picker + share button
   (§2.11), the **vs rating** column, the **⚖️ Balancer trust** scatter (§2.12), rating suggestions
   with Apply/Dismiss, and ✏️/🗑️ on a past night. Empty until the first night is saved.
4. **🔴 Live** (`src/components/LiveFixtureView.tsx`) — only present while a fixture is on: tonight's
   three teams (read-only, no ratings) and the shared match clock, which **anyone** can start and
   pause. See §2.15.
5. **Live room guest view** (`src/components/RoomGuest.tsx`) — what a shared room link opens
   instead of the app above; see §2.5.

There is no settings screen — one in-progress session is kept and resets via "New fixture", while
saved nights accumulate in the History tab (§2.6).

## 6. Tech stack (as built)

- **Vite + React 18 + TypeScript**, Tailwind v4 — single-page app, no router.
- **State/persistence**: `localStorage` is the on-device cache for everything (`src/storage.ts`,
  key `armonim-teams-v1`, `STORAGE_VERSION` 4 — bumped when results/history were added; a save from
  an older version is *migrated*, never discarded, and a missing `history` simply starts empty).
  No JSON export/import UI currently exists. The roster and the results history are both also
  synced through the Worker (below) when one is configured — `localStorage` is what the app reads
  from and falls back to, not the system of record once a `REMOTE_URL` is set.
- **Shared roster (optional)**: `src/remote.ts` + `worker/roster-worker.js`, a small Cloudflare
  Worker storing the roster as versioned JSON in KV, behind a secret admin word
  (`/verify`, `/roster` endpoints). On load, `App.tsx` pulls the remote roster and adopts it if
  its version is newer than what this device last applied. Unlocking admin mode (`Roster.tsx`'s
  🔒 Admin button, or the fixture page's 🔒 Unlock admin to save — both via the shared
  `useAdminUnlock` hook, §2.7) lets you edit ratings and 📢 Publish the roster for everyone;
  without it the app works fully offline from local/default data. Configure by setting
  `REMOTE_URL` in `remote.ts` (or `VITE_REMOTE_URL` for a dev run, §7); leave it `''` to disable.

  **The public read is not the whole roster.** `GET /roster` strips `avoid`, `chemistry` and
  `aliases` (`PRIVATE_PLAYER_FIELDS` in `roster-worker.js`). That endpoint needs no password and
  the Worker URL ships inside the app's public JavaScript, so whatever it returns is readable by
  anyone who looks — and `avoid` is the keep-apart list, i.e. who won't play with whom. The app
  had always treated it as admin-only on screen (Roster's per-player note, `showPrivateNotes` on
  the board) and `match-room.js` already rebuilt player objects field-by-field to keep it off
  guests' phones; the public endpoint was quietly undoing all of it. They are still *stored* —
  `POST /roster/full` returns the roster intact for the price of the secret word, which is how a
  newly set-up admin device recovers them (`fetchFullRoster`, called from `App.tsx` the moment
  admin unlocks). Because a pull can therefore no longer be a straight replace, `src/rosterMerge.ts`
  reconciles the two directions: `mergePublicRoster` keeps this device's private fields while
  adopting shared names/ratings, `mergePrivateFields` fills them back in from the admin read.
  If that read never succeeded, Roster's 📢 Publish asks before sending — empty lists mean "we
  don't know", not "there aren't any", and publishing them would erase everyone's.

  Both POSTs are **rate-limited per client IP** by a `RateLimiter` Durable Object
  (`worker/rate-limit.js`): 10 wrong words inside 10 minutes and that IP gets `429` until the
  window rolls over. The attempt is **counted and judged in a single DO call** — this used to be a
  read-only `/check` followed by a separate `/fail`, which is not the same thing: each call was
  atomic but the pair wasn't, so a burst of simultaneous guesses all read the counter before any of
  them incremented it and every one sailed through (verified — 20/20 against a budget of 10; the
  fixed version holds at exactly 10, see `worker/rate-limit.test.js`). Counting first means correct
  words are counted too, hence `/refund` once the word checks out, which preserves the original
  property that only *failures* accumulate. A DO rather than KV because KV is eventually consistent
  and caps same-key writes at ~1/sec — a counter on it would undercount exactly when it matters.
  Sharding by IP (`idFromName(ip)`) keeps each client on its own counter, with a separate
  `room:<ip>` counter so match-night traffic can't spend the budget guarding the password. The
  client maps `429` to a `'rate-limited'` `PublishResult` (`remote.ts`) so the app says "wait a few
  minutes" rather than "check your connection". CORS stays `*` deliberately — the POSTs are gated on
  the secret and nothing authenticates with a cookie, so there is no ambient authority for another
  origin to ride on and CSRF doesn't apply; an origin rule would only inconvenience browsers while
  breaking `npm run dev`.

  **Shape-checking is a durability concern, not just a security one.** A client drops the fetched
  result straight into React state, so one malformed publish is a white screen for every device in
  the club. The checks used to test `p?.id && p?.name` — truthiness, which an object passes as
  happily as a name — and never looked inside `teams[color]` at all; they now type- and
  length-check ids, names, aliases, team entries and `mvpId`, and the whole body is capped at
  512 KB (`worker/validation.test.js`).
- **Shared results history (optional)**: same Worker and KV namespace as the roster, under the
  `history` key instead of `roster` — `GET`/`POST /history` in `roster-worker.js`, `fetchRemoteHistory`
  / `publishRemoteHistory` in `remote.ts`. Same rate limiting, same secret, same version-timestamp
  conflict handling. The one real difference from the roster: writes here are **automatic**, not a
  manual Publish button — every admin save/edit/delete pushes the full fixture list immediately (see
  §2.6). Reading is public; a device with no `REMOTE_URL` configured just keeps recording locally,
  same empty-string-disables convention as everything else on this Worker.

  Because both endpoints are a whole-list replace, they are also a whole-list **delete** if the
  list is wrong — which has happened here for real: an automated check reused the admin word while
  seeded test data was loaded, and published fifteen fake fixtures over a live season. Two things
  now stand in the way. Every publish carries the `baseVersion` it believes it is replacing and is
  refused with `409` (`'stale'`) if the stored version has moved on since this device last read it,
  which is exactly the shape of that incident — a device holding version 0 replacing a live season.
  And the copy a publish displaces is kept under `history:snapshot:<version>` /
  `roster:snapshot:<version>` for 90 days, so recovery is a `wrangler kv key get` rather than
  reconstructing a season from screenshots. Concurrent editors were never the risk at this scale;
  a device publishing from a copy it never pulled was.
- **The live fixture (optional)**: `src/live.ts` + `GET`/`POST /live` on the same Worker, under a
  `live` key alongside `roster` and `history` — see §2.15 for the design and why it's polled rather
  than pushed. Unlike the other two this one is *transient*: no version guard and no snapshot
  (there is nothing here worth recovering an hour later), a 12-hour KV TTL, and `POST` with a null
  fixture deletes the key rather than storing an empty one, so "is anything live" stays a question
  about existence. `isValidLive` in the Worker checks the clock's shape as strictly as the rest —
  a non-numeric `endsAt` would render as `NaN` on fifteen phones at once. `POST /live/clock` is the
  one route in this Worker with no password on it; see §2.15 for the reasoning and the limits that
  make it safe.
- **Match-clock notifications (optional)**: `src/push.ts` + `worker/push.js` +
  `worker/clock-notifier.js`, a `ClockNotifier` Durable Object holding the subscriptions and one
  alarm — see §2.17. `public/sw.js` is the only service worker in the project and deliberately does
  nothing but receive pushes: no caching, no `fetch` handler, because an offline layer here would be
  a fresh source of "why am I looking at last week's roster". Enabled by setting the `VAPID_JWK`
  secret and nothing else; absent entirely without it.
- **Live match-day rooms (optional)**: see §2.5 — same Worker, a `MatchRoom` Durable Object per
  room. Distinct from the live *fixture* above: rooms are an invite-only drag-and-drop surface for
  picking teams, the live fixture is a public read-only view of a night already underway. Free-tier limits (100k requests/day, 13,000 GB-s/day of active WebSocket duration, 5GB
  storage) are far beyond what a handful of people for a couple of hours a week would ever use —
  see [Cloudflare's Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
  `ROOMS_ENABLED` in `liveRoom.ts` mirrors `REMOTE_URL`'s empty-string-to-disable convention.
  The room id is a **credential, not a label**: anyone holding it can read the night's squad
  (names and ratings) and drag players between teams, since guests are meant to. It is therefore
  minted with `secureToken()` (`crypto.randomUUID()`) rather than `uid()` — `storage.ts` already
  said as much about the host's `adminToken` and the room id had been getting `Math.random()`
  anyway. Two limits back that up, because this route deliberately has no password: 120 upgrades
  per IP per 10 minutes (every distinct id handed to it instantiates another Durable Object), and
  40 messages per socket per 10 seconds — message *size* was bounded but the *rate* wasn't, and
  every accepted `sync` is a storage write.
- Drag-and-drop uses native HTML5 drag events (`draggable`/`onDragStart`/`onDrop`) — no dnd-kit
  or other DnD library is installed.
- **Share as an image, card style** (`src/shareImage.ts`) — **written but not wired into the UI**.
  The teams drawn onto a `<canvas>` at 2× and handed to the OS share sheet via
  `navigator.share({ files })`, falling back to a download where file sharing isn't supported;
  canvas rather than rasterising the DOM so nothing new has to be installed, text drawn with
  `ctx.direction = 'rtl'` so Hebrew names — and Latin nicknames mixed into them — sit the right way
  round. `TeamsBoard.tsx` shipped a "🖼️ Share image" button calling it, then that button was pulled
  after a look at the result: the module itself is untouched, so re-adding the button is the only
  step needed to bring it back if this style is ever wanted instead of the shirt style below.
- **Share as an image, shirt style** (`src/shirtImage.ts`) — the "🖼️ Share images" button on
  `TeamsBoard.tsx`. Takes the three hand-drawn shirt-card templates in `src/shirt_images/`
  (one per team color, a fixed 5-shirt pentagon since this app is 5-a-side, see `FULL_TEAM`) and
  draws each player's name — and shirt number, if they have one set — onto their shirt with a
  canvas, same RTL-text approach as the card style above. Names go on top → bottom in
  `lineupOrder()` (`balancer.ts`, shared with the on-screen board) — keeper/defence on the top
  shirt, most attacking on the bottom two — so the picture and the board always agree on who's
  "up top". Both the name box (yoke, below the collar) and the number box (open center of the
  shirt) are `Box` constants hand-measured against the actual template art with a small picker
  tool (not in the repo — it was a throwaway HTML file), rather than guessed by eye; font size
  shrinks to fit each box, names wrapping onto a second line rather than shrinking past
  readability, numbers just shrinking (a bare "9" and "99" need different sizes to look like they
  belong in the same box). A squad bigger than 5 (extra guests) gets listed in a small caption
  under the shirts rather than silently dropped. All three team images are handed to
  `navigator.share({ files })` in one call, so accepting the OS share sheet's "Save
  Image"/"Save to Photos" drops all three into the gallery at once; falls back to three staggered
  downloads where file sharing isn't available.
- **Shirt numbers** (`Player.number`, optional): set from the Roster tab's edit-player form only —
  never shown in the roster list, on the board, in the WhatsApp text, or in history, purely
  cosmetic and only surfaces on the shirt-image export above. No uniqueness check; two players
  sharing a number is fine since nothing depends on it being distinct. A player with **no** number
  set gets a **"?"** drawn in the box rather than an empty one, so every shirt in the picture reads
  as a finished shirt — most players have no number, and a grid of blank centres looked like the
  export had failed halfway.
- **Build version marker**: `vite.config.ts` runs `git rev-parse --short HEAD` at build time and
  injects it as the `__GIT_HASH__` global (declared in `src/vite-env.d.ts`, falls back to `'dev'`
  if git isn't available). Shown top-right of the Roster page — since GitHub Pages rebuilds on
  every push to `main`, a changed hash after refreshing confirms a deploy actually landed.
- Balancing algorithm (`src/balancer.ts`) is plain TypeScript, runs client-side.
- Deploy as static files (the Vite build output in `dist/`); the Worker deploys separately
  (see `worker/`).

## 7. Working on this repo (dev, deploy, gotchas)

```sh
npm install
npm run dev      # vite dev server
npm test         # vitest run — src/ and worker/
npm run build    # tsc --noEmit && vite build  → dist/
```

**`npm run dev` talks to the live Worker by default.** That is the club's real roster and real
season — so anything in a dev run that saves, publishes, or clicks through admin is editing
production, and that is not hypothetical: an automated verification script did exactly that and
cost a season of results. Point dev at a throwaway Worker instead, which has its own storage and
its own password:

```sh
cd worker && echo 'PUBLISH_SECRET = "local_test_word"' > .dev.vars && npx wrangler dev --local
# then, from the repo root:
echo 'VITE_REMOTE_URL=http://localhost:8787' > .env.local && npm run dev
```

Both files are gitignored. Delete `.env.local` to go back to the deployed Worker. `VITE_REMOTE_URL`
exists specifically so this is a switch rather than an edit-and-remember-to-revert (see `REMOTE_URL`
in `remote.ts`), and `worker/README.md` has the same instructions from the Worker side.

**There is no linter, and the tests cover the pure logic, not the components.** CI
(`.github/workflows/deploy.yml`) runs `npm test` then `npm run build` before deploying, so a broken
rating-suggestion property fails the build now — but `src/balancer.ts` (the team-generation
heuristic) and every component are still only checked by `tsc --noEmit` and manual verification.
The Worker has tests too (`worker/rate-limit.test.js`, `worker/validation.test.js`) — vitest picks
up `worker/` as well as `src/`, so the limiter and the publish validators are covered even though
the request handler itself is only exercised by hand against `wrangler dev`. The
calibration tests are mostly statistical (many synthetic seasons with a known ground truth, asserted
on the *rate* of correct/incorrect suggestions, seeded for reproducibility) rather than exact-output
checks — the nature of a probabilistic estimator, not a style choice to copy for ordinary logic.

### Deploying the site (GitHub Pages)

Automatic: every push to `main` triggers `.github/workflows/deploy.yml` (build job uploads
`dist/` as the `github-pages` artifact → deploy job publishes it). Live at
https://ofekhazum.github.io/armonim-teams/. Confirm a deploy landed by checking the `v<hash>`
build marker top-right of the Roster page against `git rev-parse --short HEAD`.

**Gotcha worth knowing (cost hours on 2026-08-06):** if a deploy fails, do **not** re-run only the
failed job (`gh run rerun <id> --failed`). The `deploy` job consumes the artifact built by the
`build` job; rerunning just `deploy` reuses the *original* artifact, and once that artifact expires
you get `Found 0 artifact(s)` / `No artifacts named "github-pages"`. Re-run the **whole** workflow
so `build` regenerates a fresh artifact:

```sh
gh run rerun <run-id>          # all jobs — correct
gh run rerun <run-id> --failed # deploy only — will fail on an expired artifact
```

Separately, `actions/deploy-pages@v4` can hang in `deployment_queued` for its full 10-minute
timeout for reasons unrelated to this repo; a full re-run is also the fix there.

### Deploying the Worker (Cloudflare)

The Worker deploys **separately** from the site — pushing to `main` does not touch it:

```sh
cd worker
npx wrangler deploy                    # ships roster-worker.js + match-room.js (Durable Object)
npx wrangler secret put PUBLISH_SECRET # only when changing the admin publish word
```

One-time setup (login, KV namespace creation) is already done and documented in
[`worker/README.md`](worker/README.md). `wrangler` is not a project dependency — `npx` fetches it
on demand.

## 8. Build phases

1. **MVP** — roster CRUD, availability picking, GK marking, balancer with hard constraints + rating balance, team cards, WhatsApp share text, localStorage.
2. **Quality** — chemistry links, role/spectrum balance, guests glued to inviters, drag-and-drop editing with live balance feedback, alternative results.
3. **Short-handed logic** — 13/14 player team sizing, loan rotation screen.
4. **Polish** — settings for weights, variety-across-weeks scoring, JSON export/import.
   *(History, results and rating suggestions landed in §2.6; picture sharing in §6.)*
