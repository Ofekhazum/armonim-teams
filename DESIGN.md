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
(`{ id, date, teams, players, wins, matchLog?, mvpId? }` — `mvpId` is §2.13's MVP pick, added from
History after the night, the one field here that isn't derived from the
result), with `DraftTeamWins` (nullable) for the tally while it's
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
logic is shared, not copied: `useAdminUnlock` (`src/useAdminUnlock.ts`) backs both this button and
the header padlock (§2.14). `ResultsPanel` falls back to the old static text when no
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

**+30s** hands back half a minute for a stoppage the clock knew nothing about — a ball over the
fence, a goal kick from the car park. The logic is `withAddedTime` in `types.ts` rather than in the
component, because which field is authoritative depends on whether the clock is moving and getting
that wrong discards the time silently: the button appears to work and the match ends thirty seconds
early. A running clock is defined by `endsAt`, so the end moves; anything else — paused, not yet
kicked off, or already run out — is defined by `remaining`, so that grows. A clock that had ended
un-ends but stays *stopped*, since giving the time back is one decision and restarting is another,
and merging them would have a match resume in somebody's pocket. Climbing back above a minute
re-arms the one-minute shout, and because the announcements are scheduled from `endsAt` (§2.17), the
push notification moves with it for free.

**Pitch mode** (`PitchMode.tsx`) is the clock with nothing else on screen: a phone propped against a
bag on the touchline is read from ten metres away by someone who isn't holding it, and the ordinary
card is sized for a hand. Dark ground rather than the app's cream, because a bright field at full
brightness in sunlight is glare and the digits should be the only thing shouting — which is also
what every scoreboard ever built looks like, so nobody has to be told what they are looking at. It
lives inside `MatchClock`, so a player's Live view and the organiser's fixture page get it on the
same terms as the alerts toggle, and every press is the same act as a press on the card: it engages
this device, publishes to everyone, unlocks the beeper.

Two details are load-bearing. The type is `min(34vw, 40vh)` — the vw term is what a standing phone
runs out of and the vh term a lying one — and 34 rather than something rounder because `8:00` is
four glyphs wide and anything past ~36vw runs off the sides in portrait. And entering pitch mode
holds the wake lock on its own, separately from `engaged`: a screen that blanks after thirty seconds
is not a pitch clock. `engaged` still means *someone here pressed a button* and still decides who
beeps and who writes down that the match ended, because putting a phone on the floor to be looked at
is not the same as running the match on it.

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

**Entry**: `MvpPicker.tsx`, a single `<select>`, and it lives on **History**, inside a night's **✏️
Edit result** form. Nowhere else — in particular *not* on the fixture page, where it used to sit
above **🏁 Tonight's results**.

That move is the point rather than a tidy-up. The pick asks who the standout player was, and while
you are on the fixture page the answer does not exist yet: the football is still going, and the page
is being touched every ten minutes to record a result. A decision you can only make once was being
asked at the only moment it couldn't be answered, on the screen least suited to holding it. Asked
afterwards, against a night that has finished and whose matches are listed in front of you, it is
the same one dropdown and a question with an answer.

**The list is the winning team, not the squad.** The house rule is that the MVP comes from the side
that won the night, so `mvpCandidates(fx, wins)` offers only those players and the picker names the
shirt it is offering (*"From 🔵 Blue, who won the night"*) — a rule applied by not offering anyone
else beats a rule the organiser has to remember at the moment of picking. A tie is ordinary with
three teams sharing a night, so `winningTeams` returns *all* the teams level at the top and the list
is both squads; level across all three offers everyone, which is the honest reading of a tally that
separated nobody. Two details that stop the restriction doing damage:

- **A pick already on file stays in the list**, even when a later correction to the tally means their
  team no longer won. A `<select>` whose value matches none of its options renders blank, and the
  next save would write that blank over a real pick. Correcting a score is not a reason to silently
  un-name somebody.
- **The candidates follow the tally being typed**, not the one on file — correcting the score and
  picking the MVP happen in the same drawer, which is why `wins` is a parameter.

Consequences of the earlier move off the fixture page, all small and all load-bearing:

- `Session` has **no `mvpId`**. Tonight doesn't hold a pick; the filed record does. Nothing to reset
  when fresh teams are generated, because there is nothing to go stale.
- `saveNight()` (`MatchDay.tsx`) never writes `mvpId`. But it rebuilds the *whole* record from the
  session on every save, and a night gets filed more than once — another match logged, the button
  pressed twice. So `App.saveFixture` runs the incoming record through **`preserveMvp(existing,
  fixture)`** (`src/mvp.ts`), which carries a pick already on file across the re-save. Filing is
  idempotent; forgetting is not. An explicit `mvpId` on the incoming record still wins, which is what
  lets the edit form *change* a pick.
- A night with no pick shows a **🌟 Pick MVP** button (admin only) beside **✏️ Edit result**, opening
  the same form. Since the fixture page stopped asking, nothing else would ever raise the subject,
  and a prompt nobody sees is a feature that quietly stops happening.

`MvpPicker`'s `players` prop only ever needs id/name, so it works from a saved night's
`FixturePlayer[]` snapshot as readily as a live squad. The edit patch always carries `mvpId`
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
| Writing down who won a match | ✓ | | same reason as the clock — the organiser is usually playing (§2.18) |
| Tonight's results; the MVP pick (on History) | — | ✓ | the organiser's calls, recorded once |
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

**For the organiser running tonight, that tab *is* the fixture page** — the same milestones, match
log, result panel and End fixture they get from Match day, rendered by the same component rather
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
kept alive on fifteen backgrounded phones. Two rates — **2s while a fixture is on, 15s otherwise** —
and none at all on a hidden tab, with an immediate poll when the tab comes back, which is both when
the answer is most likely to have changed and when it is about to be looked at.

**Where the record lives, and why it moved.** It was a KV key. KV is eventually consistent and its
reads are edge-cached with a 60-second floor, which for a value rewritten every few minutes means a
clock paused a minute ago can still be read as running — and no poll interval can fix that, because
the interval was never the floor. Dropping the poll from 10s to 3s was run as the experiment that
would tell the two apart, and a real fixture answered it: still slow, worst on pause and on resuming
after full time, exactly where a stale read shows.

So the live fixture now lives in the `ClockNotifier` Durable Object, which is strongly consistent —
a read after a write sees the write, always. Three things fell out of that. The record is in the
same object as the alarm it drives, so storing a clock and rescheduling its announcements is one
trip that cannot half-happen, replacing a KV write plus two best-effort side calls. The 12-hour
expiry KV gave for free is now enforced on read, which is cheaper than an alarm and leaves this
object's single alarm to the announcements. And the poll can drop to **2s**, since it is finally the
whole of the delay rather than the smaller half of it.

One honest wrinkle: the class is still called `ClockNotifier` while it now owns the night, not just
the announcements about it. A rename is a `renamed_classes` migration and was kept out of a diff
that was already the largest of the season.

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

**Anyone can run it**, which is one of the two places this app accepts an unauthenticated write
(the other is writing down a finished match, §2.18 — same reasoning, same shape). At 8 minutes a
match, whoever is nearest the phone has to be able to start it; routing that through the organiser
makes the clock useless. `POST /live/clock` therefore takes no secret, and is kept safe by
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
table so nothing is a mystery emoji: 🥇 most wins, 🏅 most nights won, 🌟 most MVP picks, 🎯 most
shootouts won by their team, 🦾 hasn't missed a night in 8+, 📈 longest winning run, ✨ played every
recorded night, 🎖️ 25+ nights. Ties
**share** a badge rather than being broken — two players level on wins are exactly as level as the
number says.

**Four of these are "top of a column" badges, not "appears in it" badges** — most wins, most nights
won, most MVP picks, and most shootouts (that last one gated on `MIN_PROFILE_NIGHTS` *logged* nights,
since a shootout count drawn from one logged night says nothing about anybody). 🌟 used to go to anyone with a single pick, which over a season is most of
the squad: a badge nearly everyone wears has stopped being one. It now means the same thing 🥇 does,
one row up. The count itself is still in the **MVPs** column for everybody who has one, so nothing
is hidden by the change — only the badge narrowed.
Thresholds are the ones the app already uses elsewhere (`MIN_WIN_STREAK`, `MIN_ATTEND_STREAK`), so a
badge and the fixture-page milestone that announces it agree.

Nothing here is new data; it is all re-read from `history`. And nothing here is a verdict — "most
wins in the club" is a fact about a column, "best player" is a claim three numbers a night cannot
support, and it is not on the list (§2.9).

### 2.18 Logging the night as it happens (`src/matchLog.ts`)

`types.ts` used to say the tally was **deliberately** the whole result — three numbers typed in at
the end, accepting that there is no head-to-head record and no count of how much football it took,
on the grounds that a tally is what actually gets written down. That trade was reconsidered on
request, and the reason it stopped being a trade is the house rotation: **the winner stays on and the
resting team comes in.** So after the opening pairing — the only one anyone chooses — every
subsequent match is already determined, and recording one is a single tap on whoever won. Logging as
you go turns out to be *less* work than remembering, not more.

**One record, not two.** Everything is derived from the log rather than stored beside it:
`winsFromLog` produces the same `TeamWins` shape the tally always had (a win in play is 1, taken on
penalties is ½ — the house rule the tally already used), so a logged night and a typed one sit in
the same history table and mean the same thing. When a log exists it *is* the night: the results
panel shows counted numbers with its controls disabled, because a tally you can edit alongside a log
that disagrees with it is two records and one of them is wrong. An empty log leaves the old
end-of-night entry in charge, so both ways of running a night still work.

The opening pairing is **two dropdowns** rather than a button per possible pairing. Three teams make
only three pairings, so buttons would have fitted — but "these two play" is the shape the organiser
is already thinking in, and it reads as one decision instead of three. Whichever team is picked
first drops out of the second list, and picking a team that was already in the second box empties
it, so the two can never name the same side. The outcome buttons appear only once both are chosen.

`recordMatch` takes a winner rather than a pairing, and throws if that team was not on the pitch.
The pairing stops being the organiser's to choose after the first match, and a guard is cheaper than
a log that quietly disagrees with itself. `consecutiveMatches` surfaces the one unfairness
winner-stays-on creates — a team about to play a third without leaving the pitch — because only the
organiser can decide whether to allow it.

**The old nights cannot be recovered.** A tally is strictly less information than a log: `black 3 /
white 2 / blue 1` could be six matches or nine, and who beat whom is simply gone. So `matchLog` is
optional on `FixtureRecord`, and anything derived from it has to read as *not recorded* for those
nights rather than as zero — the same distinction `closeRate` makes in §2.12.

**Recording a result puts the clock back.** Writing down who won means that match is over, and the
next thing anybody did was press Next match — so it happens on the same tap. The session write is a
single call, so the log and the clock cannot land separately, and the publish is precisely the one
the manual press used to make: no extra round trip, instant on the phone doing the logging because
local state moves first, and exactly as fast as before on everyone else's. Only on a result being
*added* — undoing one is a correction to the record rather than the end of a match, and resetting a
running clock would be the wrong kind of surprise.

**`ScoreBar`** sticks the two numbers you look up for — the points and the clock — to the top of the
fixture page. Both exist further down already; "further down" is the problem on a page long enough
to scroll, asked at a pitch, usually by someone who is also playing. The two teams currently on are
lifted out of the three, so it answers "who is on" without anyone reading a word.

**Where the log is kept, and why that matters.** It is a field on `FixtureRecord`, so it rides the
existing history path with no separate store: written to `localStorage` on save, and pushed to the
Worker by the same `POST /history` full-list replace as everything else (§6), which means a night
logged on the organiser's phone is readable from every other device in the club. There is no second
system to keep in step, no per-match write while the football is happening, and nothing that can be
stored without the night it belongs to.

The Worker **validates** it rather than waving it through (`isValidMatchLog`): the three shirt
colours only, no team playing itself, a winner who was actually one of the two on the pitch, a real
boolean for the penalty flag, and at most `MAX_MATCHES` (100) rows. Two reasons to be strict here
and not merely size-capped. First, this is the field the per-match statistics will be counted from,
and a row naming a winner who wasn't playing would skew a head-to-head silently rather than fail
loudly. Second, the client cannot produce such a row — `recordMatch` throws — so anything that fails
this check did not come from the app, and storing it would only be storing a lie in a record every
device downloads.

**The tally of a logged night is read-only in History's edit form.** Wins are the sum of the
matches; typing over them would leave the record disagreeing with the rows it is made of, which is
the same "one record, not two" rule the results panel enforces during the night, applied after it.

History shows the log's **count** — *"18 matches logged"* — and not the matches. Listing them was
tried and reverted: eighteen rows of *"Blue beat White"* is a wall to scroll past on the way to
anything else, and nobody re-reads a night one match at a time. The count does the only job the
expanded night needs from it, which is to say the data survived being filed.

**Anyone at the pitch can write a match down**, not only the organiser — the same call the clock
makes, for the same reason: a match ends, and whoever is nearest a phone records it. The organiser is
usually one of the twenty-two people busy playing, and funnelling every result through them is how a
log ends up with holes in it. So `matchLog` is a field on `LiveFixture`, `MatchLog.tsx` renders in
the spectator view (`LiveFixtureView`) as well as the organiser's fixture page, and there is a second
password-free write on the Worker: **`POST /live/log`**.

Two writers make concurrency real, and the write carries a whole list, so a phone whose last poll was
stale would append to an old base and *erase* a match somebody else had just recorded — silent data
loss in the exact feature being added. **`isLogStep(prev, next)`** is the answer: a write is accepted
only if it is one match longer (recorded), one shorter (undone), or identical (a retry, or two people
recording the same result — which converges rather than duplicating). Anything else is a **409**
carrying the real log, which the client adopts on the spot.

**It runs inside the Durable Object, and it has to.** The check is a read followed by a write that
depends on what was read. Across KV that is a race with a *stale* read in the middle — and not a
theoretical one: the first version of this shipped that way and rejected matches people really had
logged, because the read it compared against was up to a minute old. A tap looked like it vanished a
few seconds later, when the equally-stale next poll landed. A Durable Object is single-threaded and
strongly consistent, so the compare and the swap cannot be pulled apart. `isLogStep` therefore lives
in `clock-notifier.js` beside the storage it guards, and the Worker's route does shape validation
and forwards.

The organiser's session **mirrors** the shared log (`sameLog` guards the poll and the session from
chasing each other), because the session is what `saveNight` files into history — without it, a night
where two people took turns recording would be filed with only the matches that one phone entered.
`adoptLive` seeds it too, so an organiser picking the night up on a second device inherits the
matches already played. And recording a result resets the clock from *whichever* device did it:
`App.shareLog` owns that rule, so the spectator view and the fixture page cannot drift apart.

**How fast others see it:** exactly as fast as a clock press, because it is the same record and the
same poll — which since the move off KV means one poll interval (2s) rather than a cache expiry. Which means it is only as good as §2.15's latency — the person tapping always sees it
immediately (local state moves first), and everyone else sees it on their next poll after the write
lands.

**Not yet counted.** The log is stored and shared but nothing derives from it beyond `winsFromLog`
yet — head-to-head between two shirts, matches played versus wins collected, how often a night went
to penalties. Those are reads over data already on file, and can be added whenever without another
migration.

**Known gap:** `planRotation` and `MATCH_PAIRINGS` (§3) still assume the fixed three-match rotation
when lending players to a short-handed team. Winner-stays-on means the sequence is not knowable in
advance beyond the current match, so that planner and this log now disagree about what happens
third. Left alone deliberately rather than half-changed.

### 2.19 The player page (`src/playerProfile.ts`, `PlayerPage.tsx`)

Tapping a roster row opens one player's page: badges, the nights they played, the milestones they
are climbing towards, the shirts they have worn, their best and leanest teammate, and their teams'
shootout record. No router in this app, so it is `openId` state plus a full-screen overlay — the same
shape as pitch mode, Escape included.

**Nothing here is new data.** It is the same history the standings table, the badges and the
milestones are already built from, sliced per player rather than per column. That is the whole reason
the page was cheap: the counting was already being done, it had just never been gathered in one place
with somebody's name on it.

**One rule runs through all of it.** The app records three teams and how many matches each won; it
has never recorded an individual. So a player's wins are the wins of the teams they were in, and the
*wording* carries that wherever it could be misread — the 🎯 badge reads "most shootouts won **by
their team**", not "most shootouts won". Said in the labels rather than in a disclaimer at the top:
a banner explaining that the page doesn't mean what it looks like is a page that shouldn't say it.

The counted line is five tiles: nights, nights won, match wins, wins per night, and **MVP nights**.
The MVP count carries no threshold, unlike the rate beside it — a pick either happened or it didn't,
so `0` is the true answer rather than a small sample, and it is shown for everybody precisely so a
zero reads as *none* rather than as *not tracked*. It comes off `playerAchievements`, which was
already counting picks in order to decide who tops that column; counting them a second time here is
how two numbers on one page end up disagreeing.

**One threshold, `MIN_PROFILE_NIGHTS = 4`** — the same bar `MIN_NIGHTS` uses for rating calibration,
and deliberately not a different number per statistic. A page showing "67%" under one heading and
"not enough nights yet" under the next, off the same four nights, is one nobody can calibrate their
trust against. Below the bar the per-night rate is `null` rather than a small-sample number, and the
page says why. The shootout section is gated on *logged* nights specifically, because only a night
written down match by match can answer it (§2.18), and it prints how many those were: two counts over
different windows are fine, two that look like they cover the same window are not.

**Looking like somebody's page, not a row from a table.** The first cut was correct and drab — cream
cards, one type size, a name in the same 14px as the numbers under it. The visual pass changed no
counts and no thresholds; it changed what carries meaning. The header takes a warm gradient and sets
the name at 3xl with the shirt number huge and nearly transparent behind it, the way it sits on an
actual shirt. Badges keep a **tone per kind** (`BADGE_TONE`) rather than seven identical pills, so 🥇
is the same gold wherever it appears and the row can be scanned instead of read. Each ribbon square is a
**medal**: gold, silver or bronze for where that team finished on the night. Three teams means every
night has all three, so a row of medals is a complete season in one line — and unlike a win/lose mark
it separates the second-place nights from the ones spent bottom. Metallic gradients rather than flat
fills, because flat gold and flat bronze are two similar oranges at 8px; the numeral inside is the
part that survives colourblindness and a bad screen. And the milestone rungs became **filling bars**: "no nights milestone
yet" said nothing twice, where `4 / 10 nights · 6 to go` says the same thing and shows the distance.

**A night with no result recorded gets no medal**, rather than the bottom one — nobody finished
anywhere. `appearances` in milestones.ts drops those nights entirely, but a ribbon cannot, because it
is a picture of turning up as much as of winning; so `ProfileNight.place` and `.won` are both
nullable and an untallied night renders as a dashed outline. It also can't break a winning run, for
the same reason.

**Place and win are deliberately different questions.** `placeOf` is standard competition ranking —
one more than the number of teams strictly above — so two teams level at the top are *both* gold and
the third is 3rd, not 2nd. `winnerOf` still says nobody *took* a night that ended level (§2.6), so a
shared gold shows on the ribbon while adding nothing to **nights won** or to a winning run. Both are
true: they finished first together, and neither of them won it. The tooltip says "1st (shared)" so
the ribbon isn't quietly claiming the stronger of the two.

**No organiser half.** Ratings, the attack spectrum, the keep-apart list and "beats what their rating
expects" are the organiser's working notes about a person, and this is the most screenshot-able page
in the app. They stay on the roster row and in the edit form, behind admin, exactly where they were —
and ✏️ Edit on the page opens *that* form rather than a second one, so there is still only one place
a player is edited. The roster row's own Edit and ✕ still work; both stop the click reaching the row
underneath, which would otherwise bury the form under the page it opened.

`computeDuoRecords` gained an optional `mustInclude` id so the page can ask for the best and worst
pair *containing this player*, while the fixture page keeps asking for the best and worst in the
group. Same shrinkage either way (§2.10), so the two can never disagree about a pair they both name.

### 2.20 What tonight could become (`src/radar.ts`)

`milestones.ts` announces a threshold the moment it is crossed. This is the same idea pointed
forwards: **🎯 On the line tonight**, a strip above the fixture page's milestone row saying who is one
night away from something. Same appearances ledger, read one step short of the line — no new data,
and tonight's own record excluded throughout, since tonight is the thing being asked about.

**Every line is a condition, never a prediction.** *"Their team wins and that's three nights running"*
is arithmetic on the record. *"Likely to win tonight"* would be a claim three win totals a night
cannot support (§2.9) — which is why there are no probabilities in this file, and why the
pre-match win-probability idea was declined rather than deferred.

Four things fire, and each fires **exactly one night short**, never earlier: a win streak sitting at
`MIN_WIN_STREAK - 1`, an attendance run at `MIN_ATTEND_STREAK - 1`, a night that simply *is* somebody's
10th/25th/50th, and a career win milestone within `WINS_WITHIN_REACH` (5 — about one night's haul, per
`isWinMilestone`'s calibration note). A radar that fires three nights early is noise, and one that
fires after the fact is duplicating the milestone row underneath it.

**The bounty** names the longest active winning run among tonight's players — *"is on 3 winning
nights. Somebody end it."* It stays silent below `MIN_WIN_STREAK`, so an ordinary week doesn't get a
manufactured rivalry, and it names **nobody on a tie**: two players level on the longest run is not a
bounty on one of them, and picking arbitrarily would invent the target. The copy is about the streak
rather than the player, which is what keeps a bit of needling on the right side of §2.9.

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

Three rules govern the wording, since these are read in about a second by someone who may be in the
middle of playing. **The title is the moment and nothing else**: it is the half that survives
truncation on a watch or a banner, so the identifying words come first and stay fixed week to week —
a timing cue you have to read twice has already failed. **The body is an instruction or a branch**,
never a restatement; "Added time — golden goal" sitting under "One minute left" was a line nobody
needed to read. And **never who is playing**. The full-time message is the interesting one: what
happens next depends on the score, which the app never learns (§2.8), so instead of a half-answer it
states both branches with the commoner one first — *"Ahead? Done. Level? Two minutes, golden goal."*
Tests enforce the first two mechanically, including that no meaningful word from a title reappears
in its own body.

**The crypto is hand-written and that is the risky part.** The Worker runtime has no Node built-ins,
so `web-push` is unusable and `worker/push.js` implements VAPID (RFC 8292) and payload encryption
(RFC 8291 over RFC 8188) directly on Web Crypto. This is the one file in the project where a wrong
byte is *invisible*: the push service returns 201 Created and the phone simply never buzzes, with
nothing thrown and nothing logged. So the test does not check it against itself — the expected
ciphertext in `push.test.js` was produced by `http_ece`, the library `web-push` itself uses, from
pinned keys and salt, and the two agreed byte-for-byte. A `TTL` of 120 seconds is deliberate: "one
minute left" is worse than useless after the final whistle, so it expires rather than queues.

**Opting in is per device, per fixture, and off by default** (`NotifyToggle`, rendered by
`MatchClock` so the player's Live view and the organiser's fixture page get the identical control).
Granting a browser permission once is not consent to be buzzed every Thursday forever, so the toggle
— not the permission — is what decides, and turning it off drops the subscription server-side rather
than just hiding a button.

**And the yes expires with the night.** Every write to `/live` tells the notifier which fixture it
now holds subscriptions for, and any *change* of id — ended, or replaced — drops all of them. The
alternative is a list that only ever grows: a phone that opted in once, months ago, buzzing for
matches its owner stopped coming to. Doing it server-side is what makes it true rather than polite —
a device that was switched off when the night ended is simply no longer there, and no message had to
reach it. The local flag stores *which fixture* it said yes to rather than a bare yes, so that phone
comes back to a toggle that already reads off, and the two ends agree without a handshake.

This also settles where the toggle can live. It only renders beside a running clock, which for a
player means only while a fixture is live — as a permanent setting that would be a discovery
problem, since nobody could opt in during the week. As a per-night one it is exactly right: people
open the app to see their team, tap 🔔, and pocket the phone. The cost is real and accepted —
someone who forgets to tap gets nothing and won't be told why. Subscribing needs no admin word, for the same reason running the clock
doesn't: it is a thing any of the fifteen people at the pitch might do, and all a subscription can
ever receive is those four fixed sentences. A push service answering 404/410 means that device is
genuinely gone and it is pruned; a 5xx is a bad day and it keeps its place.

**iOS requires the site to be added to the Home Screen** — Apple allows web notifications only for
installed web apps. Hence `public/manifest.webmanifest` and the `apple-mobile-web-app-*` tags, and
hence `pushSupport()` returning `needs-install` rather than `unsupported` when the API is absent on
an iPhone, so the app can give the one instruction that fixes it instead of a dead toggle. That
check is iOS-only on purpose: a desktop browser without push is missing it permanently, and "Add to
Home Screen" there would be nonsense.

**App icons** come from the club crest (`src/club_logo.jpg`), regenerated by
`scripts/make-icons.py` into `public/`. Three sizes plus a *maskable* variant, which exists because
Android crops icons to whatever shape the launcher uses and guarantees only the central 80% — the
crest's outer ring sits at the very edge of the artwork, so a straight resize would have its top and
bottom shaved off. That one is scaled onto the crest's own background colour, sampled from the image
rather than guessed, since a cream one shade out shows as a visible ring. iOS ignores the manifest
entirely and uses `apple-touch-icon.png`, without which the Home Screen icon would be a screenshot
of the page. The source is a JPEG, so its flat areas carry compression noise that PNG can't compress
away; quantising to 64 colours collapses that back to the handful the design actually uses and cuts
the set from ~1MB to under 400KB with no visible difference.

**When nothing buzzes, there is nothing to look at** — and that is the feature's defining problem.
Five links have to hold (the browser mints a subscription, the Worker stores it, an alarm fires
minutes later, a push service accepts it, a service worker draws a banner) and *every one of them
fails silently*. So `POST /push/test`, behind the admin word, walks the chain out loud: it sends one
announcement now and reports whether the server has a key, whether the asking device is among the
subscriptions, what the push service answered and with what message, and what is still pending with
the alarm time. `AlertsCheck` renders that as four ticks and crosses. Two deliberate
narrowings: it buzzes only the device that asked — the common question is "why doesn't *mine* go
off", and answering it must not set off fourteen pockets at the pitch — and no endpoint ever leaves
the Worker, only the push service's host, which is the part that explains anything. The same
rejections are `console.warn`ed from the alarm path, because otherwise a scheduled send has no
witness at all: `wrangler tail` during a match is the only other place a 403 could ever appear.

It earned its keep on the first real test, which came back `403 {"reason":"BadJwtToken"}` — Apple's
answer to *every* complaint it has about a VAPID setup, and three different bugs wear it: a `sub`
claim that isn't a `mailto:` or `https:` URL, a stored JWK whose public and private halves aren't
each other's, and a subscription minted against a key the Worker has since replaced (a subscription
is bound to its application server key for life). So the report tells them apart. The Worker signs
a probe with the private half and verifies it against the public half `k=` is derived from, which
settles the corrupt-secret case locally in a millisecond; it reports the subject, which is not a
secret — it exists precisely so a push provider can make contact; and the *browser* compares its
subscription's `applicationServerKey` with the key now served, since it is the only party holding
both. Those three lines render only when a send actually failed.

It found that bug and was then **taken out of the header rather than deleted** — a diagnostic has no
business occupying screen space once the thing it diagnoses works. `AlertsCheck.tsx` is still in the
tree, unimported, with a note at the top saying so; putting it back is one import in `App.tsx`.
`POST /push/test` stays live and admin-gated, so the report is reachable from `curl` in the
meantime. The reasoning is that the failure mode here is *silence*, and the next time there is
nothing to look at, this is the thing to look at.

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

**The padlock sits in the tab strip**, so admin unlocks from whatever page you are on. It was on the
Roster tab first, which was the wrong place by the time what it gates had spread across all of them
— Match day, the rating column in History, ending a live fixture — and made "go to Roster, come
back" a step that taught nobody anything. It is one control in two states rather than two controls:
**🔒** to unlock, **🔓** to log back off, so the place you got in is the place you get out. The
**ADMIN** badge beside the title is a label only. It was briefly the way out, and that failed for
the obvious reason — a badge that is secretly a button is not one anybody presses.


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
     match clock with **+30s** and **⛶ Pitch mode** (§2.8), the **📋 match log** (§2.18) and
     **🏁 Tonight's results** (`ResultsPanel.tsx`) to file the night. No MVP picker — that is asked
     afterwards, on History (§2.13). Starting also publishes the fixture to the
     whole group (§2.15); ending it takes it back down.
     **← Back to teams** returns to the editable board above without losing anything, in case the
     teams need another look; **⏹️ End fixture** wipes the night and starts over, the same action
     as the board's 🆕 New Fixture.
3. **History** (`src/components/History.tsx`) — open to everyone: past nights (expandable to the
   team sheets and each team's wins) and a standings table of nights / wins / fixture wins /
   wins-per-night (a shootout counts as half) / MVPs (§2.13), with achievement badges beside each
   name and a key beneath (§2.16). Admin mode adds the **📊 Monthly recap** picker + share button
   (§2.11), the **vs rating** column, the **⚖️ Balancer trust** scatter (§2.12), rating suggestions
   with Apply/Dismiss, ✏️/🗑️ on a past night, and the **🌟 MVP** pick for a night (§2.13) — which
   lives only here. Empty until the first night is saved.
4. **🔴 Live** (`src/components/LiveFixtureView.tsx`) — only present while a fixture is on: tonight's
   three teams (read-only, no ratings) and the shared match clock, which **anyone** can start,
   pause, add 30 seconds to, or open in pitch mode — the same control the organiser has, since it is
   the same component (§2.8). See §2.15.
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
  its version is newer than what this device last applied. Unlocking admin mode (the header
  padlock, or the fixture page's 🔒 Unlock admin to save — both via the shared
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
  a non-numeric `endsAt` would render as `NaN` on fifteen phones at once. `POST /live/clock` and
  `POST /live/log` are the two routes in this Worker with no password on them; see §2.15 and §2.18
  for the reasoning and the limits that make them safe — including `isLogStep`, which only lets the
  log move one match at a time so a stale phone can't erase somebody else's result.
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
