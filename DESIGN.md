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
| wins | tonight's win tally per team as typed, before it's filed (§2.6) |
| savedFixtureId | set once tonight is saved, so re-saving updates that record instead of adding another |

Only the night in progress lives here. Finished nights move into `AppState.history` as
`FixtureRecord`s (§2.6); the session itself is reset by "New fixture".

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

**What gets recorded.** At the end of the night the organiser types **three numbers: how many
matches each team won**. Half-steps are ordinary — the house rule is that taking a shootout is
worth *half* a win, so `3.5` is a normal entry. That's the whole result: no per-match scores, no
head-to-head record, and no count of how many matches were played. It's deliberately what actually
gets written down rather than what would be most convenient to analyse, and §2.6's last part is
honest about what that costs.

**Model** (`types.ts`): `TeamWins = Record<TeamColor, number>` on a `FixtureRecord`
(`{ id, date, teams, players, wins }`), with `DraftTeamWins` (nullable) for the tally while it's
still being typed. `players` is a **snapshot** (`FixturePlayer`: id/name/rating at the time) rather
than a pointer into the roster, because guests are one-off and both names and ratings move; history
has to still read correctly years later.

**Entry**: `ResultsPanel.tsx`, rendered by `MatchDay` *below* the board rather than inside
`TeamsBoard` — deliberately, since a live-room guest renders that same board and must not be able
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
"🔁 Rotation plan" section on screen whenever any team is short.

**The WhatsApp share text deliberately omits the rotation lines** (`shareText` in `TeamsBoard.tsx`,
guarded by `totalAssigned >= 15`). Note what this means in practice: teams are sized by
`targetSizes(n)` = `floor(n/3)` + remainder, so a team is short only when `n < 15` — which is
exactly the case the guard excludes. So the rotation block **never** appears in the shared text
today; the guard is equivalent to deleting the block, and is written as a threshold only so the
intent ("don't paste rotation into WhatsApp for a short-handed night") stays legible. The on-screen
panel is unaffected — the organizer still sees the plan, it just doesn't go into the group chat.

## 5. Screens (`src/App.tsx` — three tabs, no router)

1. **Roster** (`src/components/Roster.tsx`) — the permanent squad: add/edit name, aliases,
   rating, role (GK toggle, or a 0–100 defence↔attack slider in steps of 5), chemistry/avoid
   links. Ratings are only editable in **admin mode**
   (§6 shared roster); everyone else sees roster info read-only plus their own local
   availability picks. Top-right shows a small `v<hash>` build marker (§6) so you can confirm
   a deploy actually landed after pushing.
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
   Below the board, **🏁 Tonight's results** (`ResultsPanel.tsx`) takes each team's win count
   and files the night into history — see §2.6.
3. **History** (`src/components/History.tsx`) — past nights (expandable to the team sheets and
   each team's wins), a standings table of nights / wins / wins-per-night where a shootout counts
   as half, and, in admin mode, rating suggestions with Apply/Dismiss. Empty until the first
   night is saved.
4. **Live room guest view** (`src/components/RoomGuest.tsx`) — what a shared room link opens
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
  its version is newer than what this device last applied. Unlocking admin mode
  (`Roster.tsx`'s 🔒 Admin button) lets you edit ratings and 📢 Publish the roster for everyone;
  without it the app works fully offline from local/default data. Configure by setting
  `REMOTE_URL` in `remote.ts`; leave it `''` to disable.
  Both POSTs are **rate-limited per client IP** by a `RateLimiter` Durable Object
  (`worker/rate-limit.js`): 10 wrong words inside 10 minutes and that IP gets `429` until the
  window rolls over. Only *failures* count, so publishing repeatedly never locks the admin out.
  A DO rather than KV because KV is eventually consistent and caps same-key writes at ~1/sec —
  a counter on it would undercount exactly when it matters. Sharding by IP (`idFromName(ip)`)
  keeps each client on its own counter instead of funnelling the world through one instance, and
  the counter self-deletes via alarm once its window lapses. The client maps `429` to a
  `'rate-limited'` `PublishResult` (`remote.ts`) so the app says "wait a few minutes" rather than
  "check your connection". CORS stays `*` deliberately — the POSTs are gated on the secret, and an
  origin rule would only inconvenience browsers while breaking `npm run dev`.
- **Shared results history (optional)**: same Worker and KV namespace as the roster, under the
  `history` key instead of `roster` — `GET`/`POST /history` in `roster-worker.js`, `fetchRemoteHistory`
  / `publishRemoteHistory` in `remote.ts`. Same rate limiting, same secret, same version-timestamp
  conflict handling. The one real difference from the roster: writes here are **automatic**, not a
  manual Publish button — every admin save/edit/delete pushes the full fixture list immediately (see
  §2.6). Reading is public; a device with no `REMOTE_URL` configured just keeps recording locally,
  same empty-string-disables convention as everything else on this Worker.
- **Live match-day rooms (optional)**: see §2.5 — same Worker, a `MatchRoom` Durable Object per
  room. Free-tier limits (100k requests/day, 13,000 GB-s/day of active WebSocket duration, 5GB
  storage) are far beyond what a handful of people for a couple of hours a week would ever use —
  see [Cloudflare's Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
  `ROOMS_ENABLED` in `liveRoom.ts` mirrors `REMOTE_URL`'s empty-string-to-disable convention.
- Drag-and-drop uses native HTML5 drag events (`draggable`/`onDragStart`/`onDrop`) — no dnd-kit
  or other DnD library is installed.
- **Share as an image** (`src/shareImage.ts`) — **written but not wired into the UI**. The teams
  drawn onto a `<canvas>` at 2× and handed to the OS share sheet via `navigator.share({ files })`,
  falling back to a download where file sharing isn't supported; canvas rather than rasterising the
  DOM so nothing new has to be installed, text drawn with `ctx.direction = 'rtl'` so Hebrew names —
  and Latin nicknames mixed into them — sit the right way round. `TeamsBoard.tsx` shipped a
  "🖼️ Share image" button calling it, then that button was pulled after a look at the result:
  the module itself is untouched, so re-adding the button is the only step needed to bring it back
  once the visual design is worth shipping.
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
npm test         # vitest run — see src/calibration.test.ts
npm run build    # tsc --noEmit && vite build  → dist/
```

**There is no linter, and `src/calibration.ts` is the only file with real tests.** CI
(`.github/workflows/deploy.yml`) runs `npm test` then `npm run build` before deploying, so a broken
rating-suggestion property fails the build now — but `src/balancer.ts` (the team-generation
heuristic) and every component are still only checked by `tsc --noEmit` and manual verification. The
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
