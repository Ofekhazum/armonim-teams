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
(`{ id, date, teams, players, wins, matchLog?, mvpId? }` — `mvpId` is §2.12's MVP pick, added from
History after the night, the one field here that isn't derived from the
result), with `DraftTeamWins` (nullable) for the tally while it's
still being typed. `players` is a **snapshot** (`FixturePlayer`: id/name/rating at the time) rather
than a pointer into the roster, because guests are one-off and both names and ratings move; history
has to still read correctly years later.

**Entry**: the night is filed when it *ends* (§2.7.1), from the panel behind **End fixture**.
Re-saving updates the same record (`session.savedFixtureId`) instead of appending a duplicate;
generating fresh teams clears both, since an old tally no longer describes the new sheet. A night
with nothing written down can still be filed — it keeps who played and which teams they were in, and
the tally is typed in afterwards on the History tab, which is also where a mistake is corrected.

There used to be a **🏁 Tonight's results** panel on the fixture page: three number inputs and a Save
button, sitting under the match log that had already counted the same numbers. Once a night is logged
match by match the tally is *derived*, so the panel was asking the organiser to type in something the
app knew — and offering, as its own failure mode, a hand-typed tally that disagreed with the matches
it was made of. It was removed with the change above: filing is part of ending, and typing is for
correcting.

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

**Past nights are a strip of cards, above the numbers.** They were an accordion: tap a row, get three
team sheets and a strip of admin buttons, with *📖 Read the night* a small button two taps in. That
was the right shape while there was nothing behind the row — and the wrong one from the moment §2.22
gave every night a page with a headline, a ribbon and a report on it.

So the nights moved **above the table** (the table is reference; a night is a story) and became a row
that **scrolls sideways**, the same gesture as the ribbon on the night page itself. Sideways matters:
a season is forty nights, and forty full-width cards is a wall to scroll past on the way to anything
else, where forty squares is a shelf you skim. Each card is a **summary and deliberately not the
evening** — date, the night's own headline, the winning shirt with 👑 and its points, and the MVP —
and it opens the night page when tapped anywhere on it. An earlier version drew a miniature
of the match-by-match ribbon on every card; it was cut because the full-size one is the first thing
the page behind it draws, and printing the same thing twice at two sizes just makes the strip a worse
copy of a better view. The team sheets are on that page too, next to everything else about the night.

**Who won is the foot of the card**, a full-width block in the winning team's ribbon colour carrying
the crown, the name and the points. At shelf size a chip is something you *read* and a block is
something you see — and seeing it is the point, because scanning six cards for a run of one colour is
the thing a row of small pills could not do. A tie splits it between both winners.

It started as a 6px band across the *top*, which was the right idea at the wrong size: white's ribbon
colour on a cream card is very nearly nothing, so the one element whose entire job was being seen
from a shelf away was invisible for a third of the nights. At footer height it is unmistakable in all
three colours, and it fills the dead band the first layout left under the headline — which was the
card admitting it had nothing else to say, when the answer was to let the headline be bigger. A night
with no result recorded gets a muted footer of the same height rather than none, so it does not stand
a different shape to the cards either side of it.

**The MVP is a second bar under it**, same shape and deliberately shorter. It was a floating pill,
which left the foot of the card as one solid block with a stray rounded thing hovering over it. Two
stacked bars read as a single footer with a hierarchy inside it: who won the night, then who was the
best of them. Amber rather than a team colour, because the pick belongs to the person and not to
whichever shirt they happened to be handed.

**Everything on the card is centred**, including the points, which stopped being pushed to the right
edge by an `ml-auto`. A card this narrow has no columns to align to, so left-aligned text just leaves
a ragged right edge next to a hard one — and the crown, the shirt and the number read as one phrase
when they sit together rather than as a label with a figure filed away opposite it.

**The counts line went in three steps, and the third was the right one.** It read
*"18 matches · 15 played"*, where the second number was taken for matches — which is exactly what it
looks like beside the first — and turned out to be the same fifteen every week, so it went. Then
*"18 matches"* went too. A card in a shelf is **scanned, not read**, and the four things worth
scanning are the date, what kind of night it was, who won, and who was the best of them. How long the
night took is on the page one tap away, where the ribbon draws every match. The **MVP** was the only
person named on the card and simultaneously the faintest thing on it, same size and grey as the
counts that used to sit above; it wears a tinted star chip now.

**The scrollbar is hidden and the shelf drags.** `.no-scrollbar` (`index.css`, both the Firefox and
WebKit spellings, since neither alone is enough) — cards cut off mid-shelf already say the row
scrolls, and a track drawn under them is a second thing to look at. Taking the bar away leaves a
mouse with nothing, so `useDragScroll` adds click-and-drag: **mouse only**, because touch already has
momentum scrolling that taking over would only make worse. Two details make it feel right rather than
fight the cards — a `DRAG_SLOP` of 6px, so a hand that shifts two pixels while pressing a card still
opens that night; and a capture-phase click handler that swallows the click at the end of a real
drag, since a pointer that went down on a card and came up on it is a click by every definition the
browser has. **Pointer capture is taken when the drag becomes real, never on `pointerdown`** — this
one shipped broken and is worth writing down. Capturing at the start retargets the whole gesture to
the strip, so the click ending an ordinary press fires on the container instead of the card beneath
it, and every card stopped opening. Capture once past the slop and an ordinary click is never
touched, while a drag still gets what capture is for: a button released off the edge ends the drag
instead of leaving the shelf glued to the mouse. Scroll snapping was dropped in the same change: it fights a drag that sets `scrollLeft`
directly.

**The shelf can be hidden**, and the choice is remembered per device (`armonim-nights-shelf`) rather
than held in component state, because the tabs unmount — without that, hiding it would last until the
next time anyone looked at anything else, which is not what hiding something means. It defaults to
open: the shelf is what the tab is for, but forty cards is still forty cards on the way to the
numbers, and somebody who only wants the table should be able to say so once.

**Correcting a night afterwards** (admin only, History tab): a card's **⋯** corner opens one drawer
**under the strip** with *✏️ Edit result* — the three win counts and the date — *🌟 Pick MVP* where
there isn't one, and *🗑️ Delete this night*. Under the strip rather than inside the card, because a
card in a sideways row has nowhere to open downwards without shoving the row about; and nothing at
all for a non-admin, who sees a clean card instead of the same padlock line repeated down the whole
archive. The team sheet
is deliberately not editable, since it's a snapshot of who actually played; a genuinely wrong sheet
means deleting the night and saving it again. Two consistency details live in `App.tsx` rather than
the component: editing or deleting the night that is *still open on Match Day* also patches
`session.wins` / clears `session.savedFixtureId`, so pressing "Save to history" again can't silently
undo the correction. The list is ordered by date rather than by insertion, so a night filed late or
re-dated still sorts correctly.

**Standings** (`playerStandings`): a player collects whatever their team won on nights they played,
so the table is nights / wins / wins-per-night. Without a matches-played count there is no true
win percentage — wins-per-night is the honest rate.

It is titled **📊 Career numbers** and not "Standings", and it gives nobody a position. A league table
says *who is winning*; this counts what happened and cannot support that claim — a player collects
whatever their team won, five shirts at a time, and the app's own rule is counts rather than verdicts
(§2.9). Numbered places were tried and taken straight back out: a rank is a verdict wearing a digit,
and on a *sortable* table it is not even a stable one, since it changes meaning with every header
tapped.

Seven sortable columns will not fit a phone and never will, so the fix is not to drop columns but to
stop the **name** leaving with them: the first column is `sticky left-0`, and a number read sideways
still says whose it is. That is also why this one card is opaque rather than the usual `/70` — a
translucent sticky cell lets the rows it is holding scroll visibly underneath it, which reads as a
rendering fault rather than a design. Rows alternate, and that is the whole of the decoration.

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
re-roll, no live-room controls). This is the page open *during* the match, separate from the
team-building page before it: the clock, the match log, what is on the line tonight, and the way out
of the night (§2.7.1).

**The team display here is deliberately compact** — names as small wrapped chips (one line per team,
~78px for all three) rather than the board's one-tall-row-per-player (~270px). On this page the
teams are a reference you glance at, not something you work on, so they yield vertical space to
whatever else the page carries; the clock and the match log stay above the fold on a phone, which
they did not when the full board was reproduced here. Kept in the chip: the 🧤 keeper marker (worth knowing
mid-match) and a small ★ for guests. Dropped: per-player role icons, which are a team-building
input rather than something you check during the match.

**Unlocking admin** happens at the header padlock, which is on every tab (§2.13). The fixture page
carried its own unlock button while the results panel lived there — worth it then, since filing a
night was a thing you did mid-match and the trip to another tab and back was the cost. Filing now
happens once, at the end, on a panel that says plainly why a locked device cannot do it.

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

### 2.7.1 Ending a night

**"End fixture" asks what to do with the result, not whether you are sure.** It used to be a
`confirm()` — *"Tonight's result hasn't been saved and will be lost. End anyway?"* — which is the
wrong shape for the question. A browser dialog can only offer yes and no, and the real question has
three answers: file it and end, end and throw it away, or neither yet.

So the button opens a small panel headed **"That's the night?"** with **🗂️ Save to history & end** as
the obvious move, **🗑️ End and lose the result** underneath it, and **← Not yet** to go back. The
copy changes with the state rather than the buttons moving: a night already filed offers *Update
history & end* (a re-save updates the same record, so matches logged after the first save are picked
up), and a night with nothing recorded says so and drops the save option entirely, which promotes
ending to the primary action.

Filing happens **before** ending, because `onSaveResults` reads the session that `onEndFixture` is
about to clear. A non-admin sees why they cannot file rather than a missing button — the same rule
the rest of the app follows about locks being visible.

### 2.8 The match clock (and the rules of a match)

**+30s** hands back half a minute for a stoppage the clock knew nothing about — a ball over the
fence, a goal kick from the car park. The logic is `withAddedTime` in `types.ts` rather than in the
component, because which field is authoritative depends on whether the clock is moving and getting
that wrong discards the time silently: the button appears to work and the match ends thirty seconds
early. A running clock is defined by `endsAt`, so the end moves; anything else — paused, not yet
kicked off, or already run out — is defined by `remaining`, so that grows. A clock that had ended
un-ends but stays *stopped*, since giving the time back is one decision and restarting is another,
and merging them would have a match resume in somebody's pocket. Climbing back above a minute
re-arms the one-minute shout, and because the announcements are scheduled from `endsAt` (§2.16), the
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
- **Added time starts on that tap**, rather than loading a paused 2:00 and waiting for Start. It is
  the one period that isn't a separate decision: the two minutes begin the moment somebody says the
  score is level, and the players are already standing there. The extra press was pure ceremony and,
  on the night, got forgotten. Everything else still waits for ▶️ — a fresh match starts when the
  teams are ready, which genuinely is its own moment.
- Added time expiring lands on *"Still level — penalties"*.
- A match ending early on a two-goal lead just ends with **⏭ Next match**, same as any other.

Implementation notes: the countdown is computed from a wall-clock `endsAt` timestamp rather than by
decrementing a counter, so a backgrounded/throttled tab doesn't quietly lose time.

**The end-of-match effect fires once per `endsAt`, and that guard is load-bearing.** It deliberately
has no dependency array — it must re-check against the wall clock on every 200ms tick — so "the clock
has run out" stays true on every render until the *parent* hands back a cleared clock. The parent's
clock is the shared one, which arrives by poll (§2.14), so any delay there left this publishing five
times a second. That is how a `429` storm starts and then feeds itself: the writes fail, so the clock
never clears, so it writes again, and the rate limiter stays pinned until the window expires. Fixed
with `endedForRef`, keyed on `endsAt` so a restart re-arms it — the same shape as the `shoutedRef`
guard that was already protecting the one-minute beep. Beeps are
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
— the banter side (§2.12) — only gets rendered when there's actually something to say
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
see §2.12 for why that's fine.

**Repeat guests are one person (`src/guests.ts`).** A guest is created on the night they turn up with
a fresh `uid()`, because at that moment there is nothing to match them against — they are a name
somebody typed into a box. Across a season that makes one person look like three, each with one night
and a per-night number computed from a single result, sitting at the top of the standings saying
nothing.

`mergeGuestIdentities` collapses them by name, and three choices keep it safe. **Only ids absent from
the roster are candidates**, so two squad members who share a first name are never welded together —
the roster is where that identity question is already settled. **The earliest night wins**, so the
canonical id is stable as history grows rather than being renumbered every time the guest plays
again. And **it is applied on read, never on write**: `App.readHistory` is a derived value, the stored
records keep the ids they were filed with, so saving, editing and publishing all still work on
untouched data and a merge that turns out to be wrong is undone by changing a function rather than by
repairing a database.

Matching is exact after trimming and case-folding — no fuzzy matching, because quietly merging two
genuinely different people is a far worse failure than leaving a duplicate row on screen.

**The career-numbers table has no floor** (`MIN_STANDINGS_NIGHTS = 1`): everybody who has played a
night with a result is in it. It started at two, on the reasoning that a per-night number derived
from a single result sorts to the top and means nothing. That is true and it was still the wrong
trade — the table is a record of who has played, and a guest who came once and never came back is
part of that record. Excluding them meant the tab quietly disagreed with the night pages they appear
on. The per-night oddity is the price, and it is at least visible. A different question from
`MIN_NIGHTS`, which still governs whether the *"vs rating"* column will speak at all.

### 2.12 MVP picks

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

### 2.13 Two audiences: the organiser and the group

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
| History: nights, standings, fixture wins, MVPs, badges | ✓ | | the part worth sharing — see §2.14 |
| History: "vs rating" column, rating suggestions | — | ✓ | opinions about players, not counts of what happened |
| Monthly recap generator | — | ✓ | a produced thing the organiser sends out, not a button on everyone's screen |
| Tonight's fixture: teams | ✓ | | the one thing a player actually opens the app for |
| Starting / pausing the match clock | ✓ | | 8-minute matches; whoever is nearest the phone runs it (§2.14) |
| Writing down who won a match | ✓ | | same reason as the clock — the organiser is usually playing (§2.17) |
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

### 2.14 The live fixture (`src/live.ts`, `LiveFixtureView.tsx`)

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
(the other is writing down a finished match, §2.17 — same reasoning, same shape). At 8 minutes a
match, whoever is nearest the phone has to be able to start it; routing that through the organiser
makes the clock useless. `POST /live/clock` therefore takes no secret, and is kept safe by
being *narrow* instead: it replaces only the `clock` field of a fixture that is **already live**, so
it cannot create a fixture, cannot end one, and cannot touch teams, players, ratings, the roster or
the history — the handler copies the validated clock onto the stored record and ignores everything
else in the body. Rate-limited per IP on its own counter, and shape-checked as strictly as any
authenticated write, because a non-numeric `endsAt` would render as `NaN` on fifteen phones at once.
The worst a stranger who read the Worker URL out of the public bundle can do is show a wrong number
for a few minutes, which the next press of Reset undoes.

**Recording is shared; undoing is not (added 2026-08-27).** The same reasoning that opens the clock
and the match log to everybody stops short of the undo, and the asymmetry is the point. Writing a
match down is *additive and self-correcting*: the worst a wrong tap does is put a match on a list
everyone can see is wrong, and two people recording the same result is explicitly fine — `isLogStep`
treats an identical log as a retry. An undo removes a result somebody else wrote, and afterwards
there is nothing on screen to say it was ever there. So "Undo last match" is now behind `canUndo` on
`MatchLog`, passed as `isAdmin` from both the organiser's fixture page and the view the group
watches.

The gate is in the UI only, and that is worth stating plainly rather than implying otherwise:
`POST /live/log` still accepts a one-shorter log from anyone, because making it authenticated would
mean authenticating the recording it shares a route with. This stops the accidental and the casual —
somebody tapping it because it is there — not somebody deliberately calling the endpoint. Given what
an undo costs (one match, on a night everybody watched, easily re-recorded), that is the proportionate
place to spend the complexity.

`canUndo` defaults to **false**, so a new caller has to opt in deliberately: a permission that
defaults to granted is one forgotten prop away from not being a permission. `MatchLog.dom.test.tsx`
pins both halves — that the organiser is offered it, and that a viewer who is not is still able to
record a result, since hiding the undo is only correct while the recording stays open.

Two consequences of shared control worth naming. A press is applied **optimistically** and outranks
incoming polls for `LOCAL_CLOCK_GRACE_MS` — a request already in flight when someone hits Start
carries the *previous* clock, and letting it land afterwards would snap the button back. And
`MatchClock` tracks whether anyone on *this* device has pressed anything: the beeps, the wake lock
and the writing-down of "the match ended" all follow that, not merely having the controls. One phone
beeping at the one-minute mark is a cue, fifteen is a mess — and pressing a button is also the
gesture iOS requires before it will play audio at all, so the opt-in and the platform requirement
turn out to be the same event.

### 2.15 Achievement badges (`src/achievements.ts`)

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

### 2.16 Match-clock notifications (`src/push.ts`, `worker/push.js`, `worker/clock-notifier.js`)

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

**How the timing works.** The clock already travels as an absolute `endsAt` (§2.14), so the instant
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

### 2.17 Logging the night as it happens (`src/matchLog.ts`)

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
nights rather than as zero.

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
same poll — which since the move off KV means one poll interval (2s) rather than a cache expiry. Which means it is only as good as §2.14's latency — the person tapping always sees it
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

### 2.18 The player page (`src/playerProfile.ts`, `PlayerPage.tsx`)

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

**Four ladders, and a badge for each one crossed.** Nights played, match wins, **nights won outright**
(5 · 10 · 25 · then every 50) and **MVP picks** (1 · 3 · 5 · then every 10). A ladder only works on a
count that can never go down, which is why the streaks are badges instead: progress that drops back to
zero next week is not a ladder.

`ladderBadges` wears the **top rung of each ladder only**. A player four ladders deep would otherwise
carry a dozen chips, and "10 nights" stops being worth saying the moment "25 nights" is true — the
ladder card underneath still shows the whole climb, so this is its headline rather than a summary of
it. The first MVP is a rung of its own, because being picked at all is the event and a ladder starting
at three would say nothing to almost anybody for a season.

**The headline is now worn as a medallion coloured by tier, not by bronze/silver/gold.** Each badge
carries `tier`: how many rungs of *that* ladder have been passed — `reached.length` off the same
`Rung[]` the card underneath draws, so the two can never disagree. A three-way cap was the first
version and it was wrong for the same reason a three-quarter chart was wrong: the night ladder alone
has rungs every 50 past the first two, so a real career clears far more than three of them, and a
scheme that stops distinguishing at "gold" goes quiet for exactly the players who have climbed the
furthest — the opposite of what a tier is for.

`TIER_STYLE` (`PlayerPage.tsx`) is seven steps — Bronze, Silver, Gold, Emerald, Sapphire, Amethyst,
Diamond — the order competitive games settle on for this exact problem, legible without a legend to
someone who has never opened the app. Past the seventh rung the colour stops changing and the
medallion pulses instead: a ramp that kept inventing hues would eventually repeat one by coincidence
and read as a demotion, where capping-and-pulsing says "as far as this scale goes" honestly. Ladder
badges got their own row, separate from the achievement pills below — a circle-and-label stack and a
one-line pill do not share a baseline gracefully in the same flex row, and achievement badges
(§2.15) are superlatives, held or not, with no ladder to be a tier of.

**Every badge and every medal explains itself on tap, not just on hover.** A `title` attribute is
invisible on a phone, which is where this app is used, so a chip nobody can decode is decoration. The
answer is a **caption**: tapping a badge or a night writes one sentence under that row, and tapping
again or touching something else clears it. Deliberately not a popover or a modal — a one-line
explanation asked for with a fingertip should not take the screen away from you to answer.

The counted line is five tiles: nights, nights won, match wins, wins per night, and **MVP nights**.
The MVP count carries no threshold, unlike the rate beside it — a pick either happened or it didn't,
so `0` is the true answer rather than a small sample, and it is shown for everybody precisely so a
zero reads as *none* rather than as *not tracked*. It comes off `playerAchievements`, which was
already counting picks in order to decide who tops that column; counting them a second time here is
how two numbers on one page end up disagreeing.

**The bogey man is a *share*, and one constant keeps it apart from the worthy opponent.** These two
picks used to come out as the same person, which is how the bug was noticed. The bogey was a raw
count of matches lost, so whoever you had faced most usually topped it — and the player you have
faced most is very often also the one with the closest record, because a long record has had time to
even out. A 10–12 head-to-head is simultaneously "the most matches he has beaten you in" and "the
most level record you have", and the page said both about one man on the same card.

A rate is the right question anyway: being beaten twelve times by the man you have played ninety
matches against is not a bogey man, it is a lot of football. So `bogey` and `victim` are now picked
by **share** over `MIN_FACED = 8` matches, and `BOGEY_RATE = 0.6` does double duty — it is the bar a
bogey man clears *and* the ceiling a rivalry must stay under to count as `worthy`. That makes the two
**mutually exclusive by construction** rather than by a tie-break, and there is a test asserting it.
Across the invented club (§2.32) it produces bogey men at 8–23 and 17–34 beside worthy opponents at
27–27 and 12–12 — 20 players, zero collisions. The tails print the denominator (`has beaten you 23 of
31`) because the pick is made on the share and the bare count would leave a reader unable to see why
that name and not a longer record with more losses in it.

**One threshold, `MIN_PROFILE_NIGHTS = 4`, and it guards inferences only** — the same bar
`MIN_NIGHTS` uses for rating calibration, and deliberately not a different number per statistic, so
the page can be calibrated against as a whole rather than heading by heading. What it gates: the
matchup card (bogey man, mates and rivals), the shootout section, and the shirt-luck arcs. Those are
all *claims* about a player, and a claim about who somebody struggles against, off two nights, is
noise.

**Wins per night is not one of them, and used to be.** It was withheld below four nights on the
uniformity argument above, which was the wrong call for this one statistic: it is `wins / nights`,
and both of those numbers sit in the tiles either side of it — so the threshold hid arithmetic the
reader could do by looking left, while the two counts it came from were shown without comment. It
also came to disagree with the career table, which has no floor at all (§2.6): the same player read
`5.00` there and `–` on their own page. It is now always shown, `null` only when there are no nights
to divide by. The shootout section stays gated on *logged* nights specifically, because only a night
written down match by match can answer it (§2.17), and it prints how many those were: two counts over
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
part that survives colourblindness and a bad screen — which is also why the gold/silver/bronze key
that once sat under the ribbon is gone. A square reading **2** in silver does not need a caption
saying silver means second, and the key was the widest line in the card. And the milestone rungs became **filling bars**: "no nights milestone
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

**A title under the name — but not for a while.** Titles are held back until the club has
`MIN_NIGHTS_FOR_TITLES` (5) recorded nights behind it. A title is the most declarative thing in the
app, a noun attached to a person, and on a young history the badge underneath it is nearly free:
"played every night" off three nights is a fact about the history's length, not about the player. The
*badges* stay on from the first night, because a badge shows its count and a title doesn't. The count
is the **club's** nights, not the player's: one person turning up a lot is not what makes a title mean
something, the league having happened is.

**One title sets its own lower bar.** 📈 *On a Run* is let through at `MIN_WIN_STREAK` (3) nights,
because it carries its own evidence: a run of three winning nights cannot exist in a history shorter
than three, so unlike "played every night" it can never be an artefact of a thin record. A title
suppressed by the general bar falls through to the next one the player holds rather than silencing
them, so a four-night history can show *On a Run* while *Ever Present* waits — and once the history
is deep enough the rarer title takes the headline back.

`titleFor` picks the highest-ranked badge a player holds and says it as
a name: **Top of the Club → The Star → On a Run → Night Taker → Ever Present → Nerves of Steel →
Iron Man → Veteran.** It is not a new fact — every title is the badge underneath it, and the count that
earned it is on screen beside it.

That order is a **judgement about what is worth wearing**, not a derivation. Ranking by rarity was
the first attempt and it read wrong: it put *Nerves of Steel* above a live winning run, which is the
thing anyone at the pitch would actually mention. It sits above *Iron Man* for the opposite reason —
turning up is a habit, holding your nerve at the spot is an event, and only one of the two has to be
earned again each time. So `TITLE_ORDER` is the club's call, set in one place,
and the roster skins follow it rather than keeping a ranking of their own. Nobody with no badges gets
a title — an invented one for everybody would be the first verdict in the app.

**🔥 and 📈 are two badges, not one.** *Longest winning run* is the longest they have ever had;
*on a run* is the one they are on right now. Only the second can be a title, because a title says
something is happening and so it has to still be happening — a player who won three on the trot last
winter is not on a run. `TITLE_THEME` is therefore `Partial`: badges worth wearing are a subset of
badges worth having.

**A titled player wears their title on the roster.** `TITLE_THEME` (`components/titleTheme.ts`) skins
the roster row: champion gold, starlight, podium green, gunmetal, clear sky, forged iron, fire, aged
parchment. The squad list stops being fifteen identical cards, and the two or three people who have
earned something are visible from across the page.

Three rules hold it together. **The title decides the skin**, so there is only ever one ranking —
`titleBadgeFor` already picks the single most distinguishing badge, and a second priority list would
be a second thing to keep in step. **Light tints, never dark cards**: every theme keeps the dark
amber lettering the plain rows use. Gunmetal and forged iron obviously *want* to be dark with light
text, but then the name colour flips per theme, and a Hebrew name at 14px on a busy dark gradient is
worse than the theme is good — so the border and the gradient carry the identity instead. And **rare
by construction**: four titles can only be held by one player or a tie, and none appear before the
club has enough nights, so a skin is never wallpaper. The badge's own emoji sits at the far edge as a
large, near-transparent **watermark** — pinned to the row's centre line, since anchored to the bottom
it hung half off the card and read as a rendering fault rather than as a mark. The row's `title`
attribute names the title on hover.

Writing the title *on* the row was tried and taken back off: a name, a role icon, an aka line and a
title is more than a list row can carry, and the roster is a list you scan rather than a page you
read. The title still appears in full under the name on the player page, which is where one person
is the whole subject.

**Mates and rivals.** `matchups` walks history once and counts, for every player this one has shared
a pitch with: nights alongside, how many of those were taken, nights on opposite sides, and who took
those. The app had always counted who somebody plays *with* and never who they play *against*, even
though every night puts them opposite ten people — the most naturally competitive thing in the ledger
was the one thing nobody had read.

Seven lines come out of it, deliberately rather than three: **most nights with** and
**won most with** are different questions, and so are **bogey man** (whose team keeps taking nights
off yours) and **favourite victim**. **Never once alongside** only fires for somebody seen a lot from
the other side, because the joke needs them to have been around.

**The whole card waits for `MIN_PROFILE_NIGHTS`.** Two nights in, a player has a bogey man and a
favourite victim purely by arithmetic, and naming either is a joke at the expense of a fact that is
not there yet. Two separate floors, doing separate jobs: the per-pair one asks whether *that pairing*
is worth a line, this one asks whether the player has been around long enough for any of it to be
about them. The §2.10 duo record sits underneath
as the one *claim* on a card of counts.

**The head-to-head is counted in matches, not nights**, and therefore only from nights logged match by
match (§2.17). A night is far too blunt a unit for a rivalry: two players can be opponents for two
hours, play each other five times, and the night records one winner between three teams. Matches are
what they actually played against each other, so *Faced most*, *Bogey man*, *Favourite victim* and
*Worthy opponent* all read off `matchLog`. On a tallied night that half of the card stays empty and
says why — the same honesty the shootout panel already practises.

**🤜 Worthy opponent** is the most even record anybody has: the smallest gap between the two columns,
and among equally close ones the one with the most football behind it. 6–5 is a worthier rivalry than
1–1, and both are a gap of one — which is why `MIN_FACED` (6 matches) keeps the thin ones out of the
running entirely.

**They count teams and address the player.** `beat` is, and remains, *matches this player's team won
against that player's team* — the arithmetic never attributes a result to one man. The copy is the
part that changed: it was *"their team has beaten yours 5 times"*, and it now reads *"has beaten you
5 times"*. The old line was accurate and nobody wanted to read it; on a page devoted to one player,
spelling out the team clause four times running is pedantry rather than honesty, and it pushed every
tail onto a second line. The banter lives here, in the copy of a personal card, and the club-wide
numbers §2.15 draws still say *their team* where a claim is being made about somebody. Tails are kept
to a few words for the same reason. *Faced most* is the clearest case: it prints **38 matches** and
nothing else, the number it was actually ranked on. It carried the record too (*20–18 across 38
matches*, then *20–18*) and both were wrong for the line — the record is what the three lines under
it are for, and the only question this one answers is who you have played against most.

The split into counts-first came from the card being useless in practice. The duo test is shrunk hard on purpose: a
pair needs to win around **60% of their nights together** against a base rate near a third before it
says anything — roughly **6 of 8, or 9 of 15** — so across fifteen recorded nights with players
deliberately kept together, it stayed silent for everybody. Worse, the empty state blamed
`MIN_TOGETHER`, telling the organiser it needed four nights together when four nights together was
never the blocker. Two separate faults: a card that could only ever say "not yet", and copy that
explained the wrong reason. Who somebody plays with is always true and needs no claim attached; the
claim about chemistry stays where it earned its caution.

**No organiser half.** Ratings, the attack spectrum, the keep-apart list and "beats what their rating
expects" are the organiser's working notes about a person, and this is the most screenshot-able page
in the app. They stay on the roster row and in the edit form, behind admin, exactly where they were —
and ✏️ Edit on the page opens *that* form rather than a second one, so there is still only one place
a player is edited. The roster row's own Edit and ✕ still work; both stop the click reaching the row
underneath, which would otherwise bury the form under the page it opened.

`computeDuoRecords` gained an optional `mustInclude` id so the page can ask for the best and worst
pair *containing this player*, while the fixture page keeps asking for the best and worst in the
group. Same shrinkage either way (§2.10), so the two can never disagree about a pair they both name.

### 2.19 What tonight could become (`src/radar.ts`)

`milestones.ts` announces a threshold the moment it is crossed. This is the same idea pointed
forwards: **🎯 On the line tonight**, a strip above the fixture page's milestone row saying who is one
night away from something. Same appearances ledger, read one step short of the line — no new data,
and tonight's own record excluded throughout, since tonight is the thing being asked about.

**Every line is a condition, never a prediction.** *"Their team wins and that's three nights running"*
is arithmetic on the record. *"Likely to win tonight"* would be a claim three win totals a night
cannot support (§2.9) — which is why there are no probabilities in this file, and why the
pre-match win-probability idea was declined rather than deferred.

**Everything here is conditional on how tonight goes, and that is the line between this strip and the
milestone row under it.** Milestones state what is already true coming in; this states what tonight
could turn into. A fact that is certain the moment somebody is on the team sheet belongs below, not
here — *"tonight is their 10th night"* was in both strips, word for word, until it was taken out of
this one.

Three things fire, each **exactly one night short**, never earlier: a win streak sitting at
`MIN_WIN_STREAK - 1`, an attendance run at `MIN_ATTEND_STREAK - 1`, and a career win milestone within
`WINS_WITHIN_REACH` (5 — about one night's haul, per `isWinMilestone`'s calibration note). A radar that fires three nights early is noise, and one that
fires after the fact is duplicating the milestone row underneath it.

**The bounty** names the longest active winning run among tonight's players — *"is on 3 winning
nights. Somebody end it."* It stays silent below `MIN_WIN_STREAK`, so an ordinary week doesn't get a
manufactured rivalry, and it names **nobody on a tie**: two players level on the longest run is not a
bounty on one of them, and picking arbitrarily would invent the target. The copy is about the streak
rather than the player, which is what keeps a bit of needling on the right side of §2.9.

### 2.20 Team of the Month (`src/wrapped.ts`, `shirtImage.ts`)

The month's five, drawn onto a **gold shirt card** and shared as the last page of the monthly recap
(§2.11). The artwork is the same five-shirt pentagon the team cards use — its title is already
*קבוצת החודש* — so `renderShirtImage` gained a fourth template rather than a second implementation of
the same drawing. That meant resizing the gold asset to exactly 2288×4096 like the other three: the
name and number boxes are hand-measured against that geometry, and it arrived at a slightly different
aspect ratio.

**Two gates, and they do different jobs.**

- **Eligibility** — at least `ceil(month's nights ÷ 2)` nights played. Without it the team is whoever
  happened to be there on a good night: one appearance at a high rate would outrank a month of steady
  football, which is the opposite of what "of the month" means.
- **The score**, a rate rather than a total: `(match wins + 2 × nights won + 3 × MVP picks) ÷ nights
  played`. Match wins are the base currency at four or five a night. A night taken *outright* is worth
  two more, which separates the player who kept edging nights from the one who banked a single
  blowout. An MVP is worth three — a real thumb on the scale for the one human judgement the app
  records, without letting a single pick outrank a month of winning.

Ties break on the parts in the order they matter: more nights played, then more MVPs, then more
nights won, then the name — so the fifth slot is decided by something rather than by whichever way
the sort fell.

**The formula is deliberately not shown.** Everywhere else this app prints the rule beside the
number, and the reasoning holds there; here it would turn a card people want to send to each other
into a specification. `TotmPlayer` still carries the parts that made the score, so the pick can be
explained if it is ever queried — the arithmetic has to be *defensible*, which is a different
requirement from having to be read.

**Ordering on the card is by score, not by position.** The top shirt is the top of the list. History
has no record of who kept goal — `gkIds` lives on the session, never on a `FixtureRecord` — so a
position-based lineup would be invented, and inventing one on a card five people get named on is
exactly the wrong place to guess. Shirt numbers come from the live roster, since a fixture record
keeps a name and a rating but never a number.

### 2.21 One live page, two roles (`TonightFacts.tsx`)

The organiser and the group were looking at two different pages while the same night was on.
`FixturePage` had **🎯 On the line tonight** and the milestone/duo row; `LiveFixtureView` had neither.
Nothing decided that — the strips were written on the organiser's page and simply never travelled.
They are counts of who has turned up, which is the group's own record, and the group is who they are
about. So they moved into `TonightFacts`, which both pages render.

The teams themselves went the same way, into **`TeamCards`** — one set of cards, the compact form
(names in wrapped chips, ~3 lines a team) that the organiser's page already used. The live view had
been drawing its own taller one-row-per-player version, which was not a different *decision* either,
just a second piece of markup that drifted. What a viewer's payload genuinely cannot supply arrives
as an optional prop and is simply absent: `order` (the organiser sorts gloves-first then along the
attack spectrum — a `LivePlayer` has no attack value, so the viewer gets the board's own order),
`note` (the "Guest of ניב" / "Attacking" tooltip, both read off a `Player`'s private half), and
`aside`, the one place a rating may appear. The component is generic over the player shape so the
organiser keeps a full `Player` in `note` without a cast.

**What stays with the organiser is a short list, and every item on it is a decision rather than a
count**: *Tonight's result* (the tally that gets filed), *End fixture*, *Back to teams*, and the
**rating averages** — team `avg`, and the *balance gap*, which is those same averages subtracted, so
it hides with them (§2.9: ratings are one person's opinion of people and never leave the organiser's
screen). That last one was a genuine leak rather than a design: `TeamsBoard` is also what a live-room
guest sees, and it was printing `avg 3.4` on every team card to anyone holding a share link.

**A viewer excludes tonight by date, not by id.** The organiser's page knows `savedFixtureId`; a
viewer's live fixture is keyed `live-<kickoff>` and the saved record by a `uid`, so the two cannot be
matched up. Both are filed with a UTC `toISOString().slice(0,10)` date, and two fixtures have never
shared one — so a record dated today *is* tonight. Without the exclusion, a night whose result went in
early counts itself, and everybody's tenth night quietly becomes their eleventh while they are still
playing.

`TonightPlayer` in `types.ts` is what made this cheap: `milestones.ts`, `radar.ts` and `duos.ts` read
an id, a name and `isGuest` and nothing else, so typing them to that rather than to `Player` lets a
viewer's ratings-free `LivePlayer` run the identical arithmetic. The private half of a `Player` was
never needed to say whose 50th win is on the line — it just happened to be in scope.

### 2.22 Reading a night back (`src/nightStory.ts`, `NightPage.tsx`)

A tallied night is three numbers. A logged night is **the order things happened in**, and that is
where everything interesting lives: a team that won five on the trot and a team that won five spread
across the evening file the identical result and were not remotely the same night. `nightStory` reads
one `FixtureRecord` back off its own `matchLog` and returns what the order says — per-team played and
won, the longest run, how often the lead changed hands, an alternation index, a flavour, and a list
of detected facts.

**Everything here describes the sequence, never a player**, and that is exactly what makes it safe to
be loud about. One night's log is not a sample of anything — it is the whole population of that
night — so *"the lead changed nine times"* is a description rather than an estimate. Claims about
people need many nights and stay behind the floors in `playerProfile.ts`. It is the same line §2.9
draws, arriving at the opposite answer because the unit changed.

**The detectors emit structured facts, not sentences.** `{ kind: 'streak-broken', by, over, length,
at }`, not *"Blue finally ended Black's reign!"*. Hand-written strings are the thing that goes stale:
six patterns and a dozen matches a night is the same three lines every week by about week five,
which is how a feature like this dies. A fact with its numbers attached can be written up differently
every time by whatever does the writing — which is also what lets a reporter (still to be
built) consume the same output without a second detection pass.

Seven detectors, each with a threshold that exists to keep it **rare**: `streak-broken` (a run of
`DOMINANT_RUN` = 4 or more, and only once somebody *ends* it — a run still going at the final whistle
was never broken by anybody), `break-and-run`, `perfect`, `blanked`, `heist` (nothing early,
everything late, compared across halves of *that team's* matches rather than of the clock),
`yo-yo` and `shootouts`. If the page starts feeling routine, those constants are the dial — that is
the failure mode to watch for, not a missing detector.

**The flavour has a bank of headlines, picked by the fixture's own id.** Stable for a given night,
different from the night before it. A cheap defence against a page that reads identically every week;
the real defence is that the numbers underneath differ.

**The timeline is one row, one tile per match, painted in the winner's colour.** It began as three
lanes — a row per team, filled when they won, outlined when they lost, a gap where they sat out —
which was complete and unreadable: three rows to cross-reference before you knew who won match four.
The row that replaced it says the same thing by *being* the sequence. **A run is one block**, no gap
inside it and rounded at both ends, so holding the pitch looks like holding the pitch, and the gap
before the next block is where a team came off. The loser is a thin bar along the bottom of each
tile, which is the one fact the winner's colour cannot state on its own. Tiles wear the team's own
card palette rather than a colour invented for the chart.

**No colour key, and the tiles are sized to be read.** The key spelled out black/white/blue directly
above three team cards in those colours — words explaining something already being looked at. The
sizing was the real bug: tiles used to *share* the row's width so a night never scrolled, which on a
phone made an 18-match night about 19px a tile, numbers unreadable and runs reduced to slivers. Past
a dozen matches it scrolled regardless, so the choice was never scroll-or-not — it was legible and
scrolling versus tiny and scrolling. Fixed 44×56px now, bleeding through the card's padding so the
row scrolls edge to edge.

**One fact per line** in the milestone strip (`MilestoneStrip`, shared with the fixture page).
Wrapped inline they ran together — two facts could share a line while a third straddled two, so
"🏆 הלחמי's 50th win" and "💪 פוגל hasn't missed a night in 10 straight" read as one long sentence
about somebody. They are separate claims about separate people, and a line break is the cheapest
possible way to say so.

**Nothing is stored.** A night whose result is corrected next week should tell the corrected story,
and a stored summary would quietly go on telling the old one — the same reasoning as the read-time
guest merge (§2.6). Two consequences worth naming: milestones are counted **as of that night**
(`history.filter(fx => fx.date <= fixture.date)`, because a page about April that counts May reports
a tenth night that was already a fifteenth), and guest-ness is **inferred** from the roster, since a
`FixturePlayer` carries a name and a rating but never a guest flag — without that, a returning guest
would be making their debut on every night page in the archive.

**The archive is walkable.** ← older / newer → step to the nights either side without closing the
overlay, with arrow keys bound to the same thing and the neighbour's date printed on the button —
reading back through a season is mostly checking whether you have already seen this one. The scroll
position resets on every step, or a short night opened after a long one starts somewhere in the
middle of itself. The dates run left to right regardless of the list being newest-first, because an
arrow points the way time goes, not the way an array is sorted.

**A tallied night gets the page and says why it is thin**, rather than rendering empty boxes: there
is no sequence in three totals, and inventing one would be making it up. Same honesty as the
head-to-head card (§2.18).

### 2.23 When a player's football happens (`src/playerArcs.ts`)

Everything else about a player counts nights — turned up, won, took the night. This counts **when**,
which only exists on nights logged match by match and only became askable when the log did. One walk
over a player's own match sequence answers three questions: how the match *after a loss* went (winner
stays on, so losing puts you on the bench for exactly one match), their first matches of a night
against their last, and whether their wins land in the beginning, middle or end of the evening.

**Coming off a loss is measured against the club, not against 50%** — and that is the difference
between a metric and a mirage. After your team loses you sit one out and come back against a team
that has just played two in a row. Everybody's number is lifted by the same rotation, so a raw 60%
looks like character in a player who is exactly ordinary. `clubBounce` counts the same situation
across every team on every logged night, per team-match rather than per player (the five in a team
share one result, and counting it five times would make the baseline look better sampled than it is).
The club rate is printed **inside the line** — *"against 52% for the club"* — rather than explained in
a footnote under the card. A caveat nobody reads is not a caveat; the comparison has to be in the
sentence, and once it is, the footnote was only repeating it.

**Counts, never traits, and the floors say so.** `MIN_ARC_NIGHTS` (4 logged nights) gates the card;
`MIN_BOUNCE` and `MIN_HALF` gate the individual lines on top of it, because a player can clear four
nights and still have barely come off a loss. `NOTABLE_GAP` (20 points) is the width below which
`lean()` returns **'level'** rather than naming a direction. Four fixtures is about thirty matches:
enough to say what the record did, nowhere near enough to separate a resilient player from a lucky
one, so the app says *"won 9 of 14 coming back on"* and never *"mentally resilient"*.

**Only "across the night" is drawn.** Early-versus-late and the bench return are computed, tested and shown
nowhere — the card kept the one line that is a *shape* and dropped the two that were sentences of
arithmetic. They stay in `playerArcs` because the counting is the hard part and it costs one pass over
history either way: the reporter will want exactly these when it arrives, and deleting them would only
mean writing them again.

A **diagnostics panel** was built here and taken back out — a mock system scan printing each of these
counts as a joke error code. It was honest (pull-only, every line a real number) and it was not
useful: the counts above already say the same things, and saying them twice in a funnier font is
weight on the page rather than information on it.

#### Drawing it (`NightParts.tsx`)

The first version was four bars labelled `32/49`, `23/44`, `19/43`, `29/42` under the heading "where
their wins land". Every number on it was true and it was unreadable, for three reasons worth writing
down because they are easy to repeat:

1. **Two encodings of two different things.** The bar's height was the win *rate*; the label under it
   was the raw *fraction*. Nothing said so, so the tallest bar was not the one with the biggest
   number under it.
2. **No reference point.** A bar at 65% means nothing alone. Three teams share one pitch on a
   winner-stays-on rotation, so a team plays about two matches in three and wins about half of those
   — "good" is near 50%, not near 100%, and nothing on the card said so either.
3. **Four similar bars read as noise**, which is honest and useless. What the card is *for* is the
   shape: does this player start well and fade, or arrive late.

**Then four bars became three: beginning, middle, end.** `1st quarter, 2nd quarter, 3rd quarter, 4th
quarter` read as a spreadsheet column rather than three chapters of an evening, and the sample size
argued the same way — a typical logged night is nine to thirteen matches, so a quarter is routinely
three of them: the thinnest bar on the card, saying the least while taking a quarter of the room. A
third keeps every bucket around four matches, still thin but consistently so. The field on `Arcs` is
`parts`, not `quarters`, so a stale reference to the old shape fails to compile rather than silently
reading the wrong array.

The rate is stated as a percentage, the raw count stays underneath as the evidence for it (a
percentage off three matches and one off forty look identical without it), and a dashed line marks
**their own average across the whole night**. That last one is what turns three numbers into a shape:
every bar is read against the same line, and "is 65% good" becomes "is this part better than their
other two" — a question the data can actually answer.

The bars and the line share one coordinate space, which is asserted rather than eyeballed: the track
has no padding, so `bottom: X%` and `height: X%` land on the same line. Bars are drawn against a
full-height track rather than scaled to the player's best part, since per-profile axes would turn
three flat bars into a dramatic staircase. And a part nobody played gets **no bar at all** rather
than a zero-height one, which would read as "played and lost them all" — the same distinction the
medal ribbon draws between a night with no result and a night finished third.

### 2.24 The night reporter (`src/recapFacts.ts`, `worker/recap.js`)

A Hebrew match report for a logged night, written by Gemini and read **on the night's own page**. Not
a share sheet and not a clipboard trick: the night page is where a night is read, and a recap that
only ever exists in WhatsApp is gone by Thursday. Sharing is a button on it, not the point of it.

**The key cannot be in the client.** Vite compiles env values into the bundle, so a key in the app is
a key in everybody's DevTools. `GEMINI_KEY` is a wrangler secret and the browser never talks to
Google — it posts counts to `POST /recap`, behind the admin word and the same per-IP limiter that
guards every other write.

**The model is a waterfall, not a name.** The free tier's problem is that it is *uneven* rather than
small: `gemini-3.6-flash` writes the best report and allows about twenty requests a day, while the
lite models allow five hundred. One night re-rolled three times while somebody tunes the wording, on
the same day the archive is being backfilled, walks through twenty without noticing — and the failure
was total, because a single 429 meant the feature was simply gone until tomorrow.

So `MODELS` is an ordered list, best first, and a refusal moves down it. The report is written by the
best model that will take it, and the worst case is a plainer report rather than no report. It also
retires the other failure this feature has actually had: `gemini-2.5-flash` was the only name in the
file until Google answered "no longer available to new users", and the feature stopped. A single name
is a single point of failure; now a name going stale costs one 404 and the next model down.

`FALL_THROUGH` is `{400, 404, 429, 500, 502, 503, 504}`. The 5xxs and 429 are the obvious ones — a
quota that is per-model, an outage that might not be. 404 is there because that is what a retired
model answers. 400 is there because by the time it is checked the thinking-config retries have
already been exhausted, so it means *this* model will not take this request and the next one might.
**401 and 403 are deliberately absent**: a rejected key is rejected by every model, so falling
through would turn one clear error into five identical slow ones.

**A 200 ends the walk, whatever it contains.** An empty or untagged answer is a *content* failure,
and asking four more models to have a go at it would spend five quotas on one bad report. Those have
their own fixes — `MAX_TOKENS`, the report tags — and neither of them is "ask somebody else".

Two bounds worth knowing. The worst case is fifteen calls (three thinking shapes × five models), only
reachable when every model rejects every shape, which means the payload is wrong rather than the
quota — and a 400 costs no tokens. And when everything refuses, an all-429 result reports as plain
`quota`, while a mixed one names each model and its answer, because five identical numbers is a
paragraph nobody can read and five different ones is a diagnosis. `GEMINI_MODEL` still exists and
now *jumps the queue* rather than replacing it, since pinning one model used to pin its failure too;
it accepts the `models/…` prefix Google's own docs use.

**Generating has a second limiter, and that one never refunds.** Every guarded write costs a KV put,
which is ours and cheap, so the publish limiter hands a *correct* word its attempt back (§7) — right
for a roster, wrong for this. A draft is up to three calls on the club's Gemini key against a free
tier with a daily cap, so an admin word that leaked would otherwise be an unlimited supply of
somebody else's tokens, discovered only when the reporter went dead for everyone. `RECAP_LIMIT` is
twelve an hour per IP, counted only on the generate path and only after `isValidFacts` passes — a
malformed flood spends nothing upstream and so must not spend the budget either. **Saving an approved
draft and deleting one stay free**: they cost a KV write, and being told to wait before you can save
the report already on your screen would be a penalty for the wrong act. The two 429s are told apart
by name in the body, because "wait ten minutes" and "you have had enough" are different sentences.

**The Worker builds the prompt; the client sends only facts.** The client could send finished prompt
text and save the Worker a job — and then anyone holding the admin word could make our key write
anything at all. `isValidFacts` pins the *shape*, so the rules, the format and the line nobody
crosses live in the Worker and cannot be sent from outside — but names and story lines are free text
in the prompt, so the word still steers what comes back. That is the right amount of protection
rather than a gap: the same word already stores 8000 arbitrary characters via `{ text }`, so what is
being defended is the key, not the text — it must not become a general text generator for whoever
holds the word.

**A colour is a team for one evening.** The shirts are redrawn every week, so tonight's השחורים and
next week's השחורים are different people — something no model can infer from a night's results, and
the prompt did not say it. A report duly signed off with *"if השחורים don't start winning next week
we'll bring them deckchairs"*, which is a threat against five people who will not be in that team.
The prompt now states the reshuffle outright and confines the sign-off to **people, by name**. The
distinction that keeps shirt luck alive: a *player's* record in a colour is about the player, so
somebody who keeps winning whenever they happen to wear white is still cursed, and the curse follows
them into whatever shirt they are handed next.

**Facts, never the log.** `recapFacts` flattens what `nightStory`, `milestones` and `duos` already
computed into a few hundred bytes of finished numbers. A model handed eighteen raw results will do
the arithmetic itself and get it wrong, and a report that says Blue won seven when they won five is
worse than no report. It carries no ratings, no attack values, no keep-apart lists and no ids: what
leaves the app is roughly what is already on the night page (§2.9).

**The guard rail is against confident invention.** This data has no goals, no scorers, no assists and
no saves — a sports-writer prompt with nothing said about that will supply all four from imagination.
So the prompt states what the data is, what it is not, and that nothing outside it may appear, and
the tests assert those clauses are present. It also explains the rotation, without which none of the
numbers make sense, and it forbids touching a player's name — Hebrew names must survive verbatim.

**Written for the audience, not for the app.** Output is Hebrew, because it is read in a Hebrew
WhatsApp group by people whose names are Hebrew; the app's own chrome being English is a fact about
the app, not about who reads it. The block renders `dir="rtl"` with `whitespace-pre-wrap`, since the
model's paragraphing is part of what it wrote. Team colours travel as English identifiers and the
prompt maps them to השחורים / הלבנים / הכחולים, so changing the output language stays a prompt edit
rather than a change to what gets counted.

**Stored in its own KV key**, `recap:<fixtureId>`, never on the fixture record. No schema change, no
migration, nothing that can damage a night — and it is the honest split: the record is what happened,
a recap is generated prose that can be thrown away and written again. It is also stored rather than
generated per reader, or fifteen phones would each write a different report of the same night and
spend the quota doing it.

**Built for the automatic version it is not yet.** `POST /recap` takes `{ facts }` (write it, store
nothing), `{ facts, save: true }` (write and store in one call), `{ text }` (store what the organiser
approved) or `{ text: null }` (forget it). Today the app uses the first and third, which is the human
in the loop: the organiser reads a draft nobody else can see, then publishes it. Turning that into
"a report appears the moment a night is filed" is the second variant called from wherever a fixture
is saved — `autoRecap` in `src/recap.ts` is already that call, kept unused on purpose. Nothing about
the route, the prompt or the storage has to change.

**Three things the first real calls taught, all worth keeping written down.** The model name went
stale before the feature shipped — `gemini-2.5-flash` answered with *"no longer available to new
users, use models/gemini-3.6-flash"* — which is why it is a `GEMINI_MODEL` secret with a default
rather than a constant, and why a model that refuses `thinkingBudget: 0` gets exactly one retry
without it rather than a support ticket. Gemini 2.5 Flash has
*thinking on by default and pays for it out of `maxOutputTokens`*, so a budget sized for the answer
is spent before the answer starts — the reply comes back with `finishReason: MAX_TOKENS`, no content
at all, and a few hundred thinking tokens billed. `thinkingConfig: { thinkingBudget: 0 }` turns it
off, because writing a report from finished counts is not a reasoning problem. And the failure
*message* mattered as much as the failure: a missing key, a wrong model name and an empty generation
all arrived as the same 502 and the same sentence — "Gemini turned it down" — which named none of
them. The worker knew which; it just wasn't saying. It says now, verbatim, including whatever Google
put in the error body.

**The first report that came back was short, cut off mid-word, and covered one team.** Three separate
faults, worth separating: the token budget was being eaten by thinking and left only a fragment (it
is 8000 now — output tokens are the cheap part of a weekly report); a `thought` part can arrive
alongside the answer and would otherwise be pasted into WhatsApp as though a person wrote it, so
those are filtered out; and the prompt asked for "three short paragraphs" without saying what went in
them, which a model answers by writing about whatever it noticed first. It now names five paragraphs
in order and says explicitly that **no team may be skipped**, including the one that had a quiet
night.

**The report comes back inside `<report>` tags, and only what is between them is kept.** Asking a
model for five paragraphs and a list of rules invites it to check its work in the open: one attempt
came back with *"Let's check every single rule again: 1. Paragraphs: Yes, exactly 5"* sitting in the
middle of the Hebrew, as ordinary unflagged text that no `thought` filter could catch. A delimiter
costs nothing and turns "trust the model to have kept quiet" into a substring. An answer with no tags
at all is refused rather than shown, because a report whose boundaries nobody can trust is worse than
no report.

**Turning thinking off is a ladder, not a setting.** 3.x wants `thinkingLevel`, 2.5 wants
`thinkingBudget`, some models refuse to have it off at all, and a model that dislikes the field
answers `400 Request contains an invalid argument` without naming it — so matching on the message
was useless. Each form is tried in turn and a 400 moves to the next: three calls worst case, only
ever after a failure.

**The change index is not sent at all.** It came back in a report as *מדד השינוי: 47*, an internal
name for an internal number quoted at a group who have seen neither. Instructing the model to phrase
it in words was tried first; not sending it is the version that cannot fail. The night's *shape*
still travels, because it is a word rather than a figure.

**A club table was sent for one version and taken back out.** Ranked on wins, it put somebody who had
turned up once above regulars who had played all season, and the report duly repeated that as though
it meant something. A standing needs a minimum-nights rule before it is worth quoting — §2.6 has one
for exactly this reason — and the report is about a night rather than a season.

**Eight detectors feed `notes`, and the cap is the point rather than a safety valve.** 👕 shirt luck
(the colour they win in against the one they do not), 🔁 revenge inside the night (beaten twice by the
same team early, beating them twice later), 🪑 bench time, 🕰️ first night back after missing three or
more, 💤 a drought of four losing nights ending, ⭐ a guest finishing on the winning team, 🎯 how few
wins short of a career milestone they now are, and ⏳ which half of a night they are actually good in.
A report is about 350 words: hand it twelve equally-weighted facts and it picks three at random and
mentions none of them properly. So each detector is gated to fire on a night when the thing actually
happened, at most two of any one kind travel, and they are ordered rarest first — a squad of fifteen
produces shirt records every week, where a drought breaking is a season event.

**The tone is set by naming the audience.** The prompt says who reads this — a WhatsApp group of
friends who have played together for years and take the mickey out of each other constantly — and
that *a polite report is a failed report*. Nicknames, invented feuds, curses, dynasties, demands that
somebody be dropped or given a statue, and absurd attribution ("sources close to the changing room")
are all explicitly invited. Temperature sits at 1: a cautious setting reads as a cautious report.

**The one line is drawn around the subject, not the strength.** Everything mocked is a **result** —
matches won and lost, shirts, streaks, turning up, who beat whom. Never a body, weight, looks, age,
health, money, job, family, politics or religion, and never a flat statement that somebody is bad at
football; the scoreboard is what laughs at them. Realistic quotations attributed to a player are out
too — an absurd one reads as a joke, a plausible one reads as something they said. The test is that
the person it is about would be the one forwarding it.

**The notes are written as bare facts on purpose**, and the prompt says so: they are material, not
lines to print. A fact printed as written is the statistical vibe this feature keeps sliding back
into — *"מדד השינוי: 47"*, *"came into tonight 2-8 down"* — and the fix each time has been to send
less number and more situation.

**Personal history is told as a story, not as a record.** The bogey line first read *"came into
tonight 2-8 down against ירין across their careers, and tonight ניב's team beat ירין's 3-1"* — four
numbers stacked around one joke, which is three too many. It is one sentence now, and the prompt says
in as many words that a rivalry is a headline rather than a record.

**The byline is invented on the spot.** Each report opens `📻 <reporter> מדווח מהמגרש` with a
different absurd name every week — never a real journalist, never anybody playing. It costs nothing,
it varies for free, and it is what makes the thing read as a broadcast rather than as a summary.

**`notes` is the part worth having.** `nightNotes` walks each player's career head-to-head as it
stood *strictly before* this night and looks for their **bogey** — the opponent whose team keeps
beating theirs — turning up on the other side and losing. Nothing else in the app can say that:
every other view is about one player or about one night, and this is the two together. The record
quoted is the one they walked in with, because quoting a total that already includes tonight would
have the report announce the overturning of a record that had already been overturned.

**A recap is decoration and never load-bearing.** Every failure — no key, quota exhausted, a safety
refusal, no network — comes back as a message under the page, and the page renders exactly as it does
today. A tallied night has no recap button at all, because there is no sequence to write about and a
model asked to describe one anyway would invent it.

### 2.25 Team of the Month, registered (`src/totm.ts`, `worker/awards.js`)

**Counts are derived; awards are registered.** Everything else in this app is worked out at read time
— a night page recomputes, the career table recomputes — and that is right, because a corrected
result *should* change what a count says. Team of the Month is not a count. It is an announcement:
five names, picked for a month, made into a shirt image and posted to the group. Derived, a
correction to some night in June could quietly change who was in June's team, and a player's page
would end up disagreeing with the card everybody actually saw. So it is written down once and kept.

**The registrar is a cron.** `[triggers] crons = ["0 5 1 * *"]` — 05:00 UTC on the 1st, which is
08:00 in Israel through the summer and an hour earlier in winter, since Cloudflare's crons are UTC
only and pinning an exact local hour year-round would cost two schedules and a DST guess for a job
nobody is watching. The Worker reads `history` straight out of KV, so nobody's phone has to be open.

`registerAwards` writes **every finished month that has no team yet**, which gives three properties
out of two lines: the first run after deploying **backfills the whole archive** rather than starting
from that month; a run missed to a deploy **self-heals** next time; and it **never overwrites**, so a
month set by hand stays as set. The current calendar month is skipped because it is still being
played — the one place a clock enters the design, and every other "is this month finished?" question
reduces to it.

An earlier draft had the cron re-register its own entries whenever a month's night count changed, to
cover a night played on the 29th and filed on the 2nd. That is a flow that was bypassed rather than a
case worth machinery: filing is part of ending the night (§2.7.1). The fingerprint went, and the
record is `{ ids, names, at }`.

**`src/totm.ts` exists so the rule cannot drift.** Two things ask who was in a month's team — the
shirt image the organiser posts, and the cron. If they ever disagreed the feature would be worse than
not having it. So `totmEligible`, `totmScore`, `TOTM_SIZE` and `teamOfMonth` live in one file that
`wrapped.ts` imports and the Worker bundles directly; esbuild follows the import and tree-shakes the
rest of `milestones`/`calibration` away (verified: the scoring is in the Worker bundle,
`buildWrapped` and the ridge solver are not). A copy in the Worker would agree on the day it was
written and stop agreeing the day one of them was tuned.

**Storage** is one KV document, `totm`, keyed by `YYYY-MM` — one document rather than a key per month
because a player page wants all of them at once, where a recap is read one night at a time. **The
names travel with the ids**, which is the difference between an award that still renders in two years
and five blanks the week somebody leaves the roster. `GET /awards` is public; `POST /awards` costs the
admin word and takes `{ period }` to register one, `{ period, clear }` to forget one, and
`{ run: true }` to do the cron's pass now.

**On the player page**, a shelf of month chips under the hero — the one honour there that is a
*selection* rather than arithmetic about them, and a record of an announcement rather than something
recomputed, so it can say *when*. **Absent at zero, deliberately**: most players will never make a
five-man team, and a permanent empty trophy cabinet is a page telling them so every time they open
it. Absent reads as neutral where "×0" reads as a verdict (§2.9). The chip's tooltip carries the one
thing that otherwise looks like a bug — `totmEligible` wants half the month's nights, so somebody can
play brilliantly in a month they mostly missed and not be eligible.

**👕 Team of the Month** is its own admin panel on the History tab, one row per month: who is
registered and when, or *not registered*, with **Register** / **Re-register** and **Remove**. Not a
second way of doing the cron's job — it is the three cases the cron cannot cover. Seeding the
archive, rather than waiting a month for its first entry. Correcting a month the automatic pick got
wrong. And **removing** one, which hands the month back so the next 1st registers it afresh — that is
what makes it safe to register a month early, look at the result, and undo it.

A month still being played can be registered on purpose: it is the only way to see what the shelf
looks like without waiting for the 1st. It asks first, though, and says the thing that would
otherwise be discovered a month later — the cron never overwrites, so a team scored halfway through a
month stays scored halfway through unless it is removed.

### 2.26 Full-screen overlays on a phone (`src/scrollLock.ts`)

The app has no router: a player's page, a night's page, pitch mode and the end-of-night dialog are
all `fixed inset-0` panels over a document that carries on existing underneath (§5). That is untidy
on a desktop and broken on a phone, and it was reported as one symptom — *"the scrolling is stuck and
you can see behind the page, the page is not always opened stable"* — which turned out to be three
faults sharing a cause.

**Scroll chaining.** A swipe that reaches the end of the overlay's own scroller keeps going and
starts moving the document instead. The overlay stops responding to the finger, which reads as stuck,
and the thing actually moving is the page behind it. `overscroll-contain` on the scroller fixes this
half and only this half.

**Rubber-banding.** iOS lets the *document* bounce past its ends, and while it bounces, `position:
fixed` elements bounce with it — so the panel slides and the page underneath appears at the edge.
Nothing on the overlay can prevent this; the document has to stop being scrollable.

**The URL bar.** Scrolling behind collapses and expands Safari's chrome, which resizes the viewport
`inset-0` is measured against, and the overlay jumps. Same cause again.

So `useScrollLock()` pins the body — `position: fixed` offset by the scroll position it had, restored
on the way out. **`overflow: hidden` on `body` is not enough**: iOS Safari has ignored it for touch
scrolling for years, which is why this is more elaborate than it ought to be. The lock counts holders
at module level, so two overlays open at once do not have the inner one unlock a page the outer one
is still covering, and the saved offset belongs to the outermost lock — where the reader was before
any of it started. Restoring forces `scroll-behavior: auto` for the one call, because a closing
overlay that then animates the page back into place looks like the app losing its footing.

Pitch mode takes the lock even though nothing on it scrolls: it is the rubber-banding fault it is
guarding against, not the chaining one. The end-of-night dialog takes it conditionally
(`useScrollLock(ending)`) — a modal is a `fixed inset-0` panel like any other.

**Covered by `src/scrollLock.dom.test.tsx`**, which was written after the fact — this shipped on
reasoning alone, and the component-test project (§7) exists largely because of it. The tests are
about the *document* rather than about a panel, which is the whole point: nothing an overlay does to
itself can stop iOS rubber-banding the page behind it.

### 2.27 The organiser's note (`FixtureRecord.note`)

**One box, at the end of the night, that never appears on a page.** Everything the reporter is handed
is *counted* — who beat whom, in what order — which is exactly why a night full of things that
happened can read as a night of arithmetic. The ball over the fence is not in the match log and never
will be. So filing a night now asks one optional question, and whatever is typed goes to the reporter
and nowhere else.

**A second step rather than a box on the ending panel**, because it only applies to a night being
kept: one being thrown away has nothing worth remembering. Empty is the normal answer and costs one
tap. `NOTE_MAX` is 280 — the reporter is being given a detail to hang a joke on, not a second match
report to compete with the first.

**It is never rendered.** Not on the fixture page, not on the night page, not for an admin. A note
printed on the page it describes is the report's punchline printed above the report — and the whole
value of it is that the write-up says something nobody could have worked out from the results. The
only place it is visible is the field you edit it in.

**Editing and deleting are admin-only**, in the same History drawer as the result and the MVP pick,
which is where every other correction to a filed night already lives. Emptying the box deletes it;
`note` is spread as an explicit `undefined` for exactly the reason `mvpId` is (§2.6), since a key
merely omitted from the patch would leave the old value in place.

**Three layers had to agree** for a note to survive. `recapFacts` carries it as `said`, absent rather
than empty so the prompt never has to ignore a blank field. `isValidFacts` caps it at 400 — the one
field in that payload that is prose rather than a counted thing, so the one that could arrive as a
wall of text. And `isValidFixtures` on the Worker had to be taught to allow it, without which filing
a night that had one would have failed the publish of *the entire season*, not just the note.

**The prompt frames it as evidence, not licence.** It arrives under *SOMETHING ELSE THAT HAPPENED
TONIGHT*, presented as true and as the best thing in the record — nothing else there is an actual
event. Then the fences, two of which were added after a first attempt got both of them wrong:

- **The reporter saw it.** The first draft opened with *"according to the organisers of the round,
  who revealed a remarkable statistic"* — which turns a broadcaster who was at the pitch into
  somebody reading a memo. It is now told never to say where it came from: no sources, no reports,
  no one having handed it anything. It was there. **With one carve-out written into the same
  paragraph**, because that rule and the report's best joke share a vocabulary: the *invented*
  absurd source — *"גורמים המקורבים לחדר ההלבשה מוסרים כי ירין כבר דורש חקירה דחופה לגבי איכות
  הדשא"* — is a punchline, not a citation, and a model reading "no sources say" literally would have
  quietly stopped writing them. It is rationed rather than encouraged, though: once or twice in a
  report, since a device on every second sentence stops being a joke and becomes a verbal tic.
- **Attribution follows the words, not the guess.** Given *"the ball went over the fence about five
  times"*, the first draft told two named players to aim better — neither of whom the line mentions.
  So: if it names somebody, it is theirs and they get both barrels; if it names nobody, it belongs to
  nobody, and inventing a culprit is the same offence as inventing a goal.
- **And the sign-off is where that rule breaks**, which took a second attempt to see. Paragraph 5
  *demands* names — it is the paragraph that threatens somebody about next week — so the model names
  players and hooks them to the most concrete thing in the record, which is the note. The next report
  closed by telling six players to aim for the pitch rather than over the fence, for a ball nobody
  had been said to kick. Two rules were fighting and the note lost. Now the ban is stated as holding
  in *every* paragraph with the sign-off called out by name, and paragraph 5 is pointed at what it
  should have been aimed at all along: a player's **own results** — who won nothing, who won
  everything, who is on a run.
- **Say what it says**, invent no surrounding detail, and do not read it as permission to describe
  goals or saves (the standing rule against inventing football, §2.24). Tone follows the event —
  most are absurd and should be treated as such, but a note that is not funny is reported straight
  rather than having a joke forced onto it.

The heading and the sentence in paragraph 4 pointing at it are both conditional, so a night without a
note carries no empty section for the model to fill in.

### 2.28 Ratings never leave the organiser's device

§2.9's rule — a rating is the organiser's private opinion and never leaves the app — was true of every
screen and false of the wire. `TeamsBoard` hides team averages from a non-admin, `LivePlayer` was
typed down to a name and a shirt so ratings could not travel to the group, and `recapFacts` carries a
test asserting no rating reaches Gemini. Meanwhile **`GET /roster` served every player's 1–5 and
attack value to anyone**, unauthenticated, from a URL that ships in the public bundle. One `curl`.

`PRIVATE_PLAYER_FIELDS` now holds five: `avoid`, `chemistry`, `aliases`, **`rating`, `attack`**.

**The archive was the same leak, staler.** A `FixturePlayer` is a snapshot — id, name and the rating
that player had that evening — so `GET /history` handed out a number against the name of everybody
who has ever played. `publicFixture` strips it on the read.

**Stripping a read that gets written back is how you delete data**, and that is the part worth
reading twice. An admin device adopts the shared history on load and republishes the *entire list*
every time a night is filed. A device holding the stripped copy would hand it straight back, and the
ratings would be gone from the store for good — the exact failure this project has already had once.
So the strip could not ship alone:

- **`POST /history/full`** returns the archive as stored, ratings included, behind the admin word —
  the counterpart of the `/roster/full` that already existed for the same reason.
- **`App` pulls the full copy whenever `adminWord` is set**, and re-runs when it arrives, so
  unlocking mid-session upgrades what the device is holding rather than leaving it on a stripped
  copy it will later publish.
- The version guard is `<` rather than `<=` once unlocked, because the same version legitimately
  arrives twice — stripped, then whole — and the second one is worth taking.
- **`isValidFixtures` treats `rating` as optional**, since a device that has only ever seen the
  stripped copy still has to be able to publish.

**What a viewer's device does without ratings.** Nothing it could not do before: `mergePublicRoster`
keeps whatever rating that device already held and falls back to `RATING_UNSEEN = 3` for a player it
is meeting for the first time — the middle of the scale, because a device that is not allowed to know
should not be guessing high or low about anyone. It never uses the number: team generation is
admin-only, and everything a viewer can reach is counted from results. `mergePrivateFields` is now
the *only* way a device ever learns what the organiser thinks of anybody, which is the correct shape
— unlocking admin is what turns a device that can read the club's results into one that can see its
opinions.

One regression caught by an existing test while writing this: defaulting `attack` in
`mergePublicRoster` before `migratePlayer` runs makes the migration keep the default and silently
lose a legacy `playstyle`. It is left `undefined` and passed through instead.

**The window next to the locked door: `defaultRoster.ts` (found 2026-08-27, on a pre-share audit).**
Everything above is about the wire, and all of it worked — pulled live, `GET /roster` and
`GET /history` were both correctly stripped. What none of it covered is that the seed roster is
*compiled into the bundle*, and the bundle is served to every viewer out of a **public repository**.
All twenty-one players' real ratings and attack values were sitting in
`dist/assets/index-*.js`, readable with one DevTools tab. The endpoint next door was carefully
removing exactly those five fields while the file beside it published two of them.

The fix keeps the seed but empties it of opinion: `rating: 3` (`RATING_UNSEEN`, the same value
`mergePublicRoster` already falls back to) and `attack: 50` (`ATTACK_DEFAULT`) for everybody, so the
array cannot rank a squad however it is read. Names, ids and the goalkeeper flag stay — a first-time
visitor still opens the app to a squad. Nothing else changed, because nothing else had to: the
recovery path was already built and tested. An organiser's device fills the real numbers back in from
`/roster/full` the moment admin is unlocked, which §2.28 already describes as *the only way a device
learns what the organiser thinks of anybody*.

**Guarded by a test rather than a comment**, because the way this returns is not malice but
convenience — the update instructions in that file say "Roster tab → Export, then replace the array
below", and an export contains the real numbers. `defaultRoster.test.ts` asserts every seeded rating
and attack is identical, which fails the build on a pasted export. It was verified against the old
file before shipping: two of its four tests fail on it.

**A consequence taken deliberately:** the role badge on each roster row is drawn from `attack`, so
until admin is unlocked every player now shows the balanced badge. That is the honest rendering of a
field this device has not been told — and the badges only ever looked right before because of the
leak. If they should be public, the fix is to take `attack` out of `PRIVATE_PLAYER_FIELDS` and
publish it properly, not to put real values back in the seed.

**What the fix cannot reach:** the repository is public and the ratings were committed, so they
remain in git history. Removing them from the bundle ends the practical exposure — nobody reads git
history to find out what the organiser thinks of them — but making the history itself private means
making the repository private.

### 2.29 The career as a feed (`src/playerTimeline.ts`, `PlayerTimeline.tsx`)

The player page already drew the same history twice. The **ribbon** — one medal per night, oldest
first — and the **milestone bars** are both *shapes*: you read them at a glance and learn how much
football someone has and roughly how it went. Neither can tell you the night something happened on.
A ribbon cannot say "this is where the run of five ended"; a progress bar cannot say "the 100th win
was in March".

So: the same nights, as a dated feed, newest first. **No new evidence anywhere in it.** Every event
is either a counter crossing a rung that `milestones.ts` already defines, or a run ending on the
night it ended, which is arithmetic over `profileNights`.

**Ten kinds.** `debut` · `nth-night` · `nth-win` · `nth-night-won` · `nth-mvp` · `streak-ended` ·
`streak-live` · `drought-ended` · `best-night` · `totm`.

**The shape is flat, not a discriminated union**, which is the opposite of `Milestone` and
`NightFact`. Those are consumed by exhaustive switches building a different sentence each; this is
consumed by one card component drawing icon + headline + number, so a union would buy nothing and
cost a cast at every field access. And like `ProfileNight`, the module holds **no words** — it
decides what happened and when, and the page decides how to say it.

**Four decisions worth keeping:**

- **A milestone can be stepped over.** Match wins arrive four or five a night and a shootout is worth
  half, so a total can pass 50 without ever equalling it. `crossed(before, after, isRung)` checks the
  whole interval; asking whether the new total *is* a rung would silently drop most of that ladder.
- **An untallied night breaks nothing.** No result is not a loss — the rule `appearances()` already
  follows. A blank night passes a run straight through. It still counts as a debut, because turning
  up is the event, and it still counts an MVP, because the pick is made afterwards and does not
  depend on whether anyone typed in the score.
- **A record needs something to beat.** Below `MIN_NIGHTS_FOR_RECORD = 4` nothing is carded, or the
  feed opens with three "best night yet" cards that are artefacts of having no history. `best` is
  still tracked from night one, so the first record card beats a real number rather than zero.
- **Team of the Month sorts on `${period}-99`** — a day no date can equal, which puts the award above
  every night of the month it was won for, where a reader looks for a month's conclusion. That key is
  never rendered; a component test asserts the 99th of July never reaches a profile.

**Nights are counted the way the rest of the page counts them** — only nights with a result — so the
feed and the Milestones card agree about which night was somebody's 25th. Two places on one screen
disagreeing is worse than either answer.

**The rail is the component.** Cards in a list are a list of facts; the same cards threaded on a line
are a career, and the *gaps* in the line are as legible as the events on it — six months of nothing
reads as six months of nothing, which no ribbon can show.

**Folds past `PAGE = 3`, and folds back up.** This is the one card on the profile with no natural
length — a two-season regular has dozens of events — and at eight the timeline alone was taller than
everything below it put together, so the shirts, the mates and rivals and the rest of the page were
all under the fold on a phone. Three is a glance at what happened lately. The expand is *two-way*:
a one-way one is a card that can only ever get bigger, so a long career opens once and is then
scrolled past for the rest of the visit.

§2.9 holds throughout, and the easiest place to break it is the card about something going wrong: a
broken run is **"a run of five ended"**, never "the wheels came off". There is a test for that
sentence.

### 2.30 Strength from results alone (`resultStrength`)

`ratingErrors` measures **surprise** — how far a player's results sit from what their rating said to
expect. That makes every number it produces a statement *about a rating*, which is why the "vs
rating" column is admin-only and why §2.28 exists at all.

Hand the same solver a constant instead and the question changes entirely:

```ts
export function resultStrength(history) { return ratingErrors(history, () => FLAT_PRIOR); }
```

Every team's average is now identical, `expected` collapses to 0.5 for every pairing, and the ridge
is left attributing the whole deviation from an even split — **who keeps turning up on the winning
side, controlling for who they lined up with**. No rating enters the arithmetic anywhere, so nothing
in the output can leak one. It is safe to publish to every phone in the club. Which constant is used
is irrelevant: only the *difference* between two team averages reaches the model, and every
difference here is zero.

This is the estimator "The Anchor" would have been, minus the organiser's opinion.

**Units.** `delta` still divides by `SENSITIVITY`, so it is still "rating points of advantage this
player's presence is worth" — but read against an average player rather than against their own
rating. **It is not a rating and must never be rendered as stars.**

**Small records need no special case.** The ridge penalty pulls a thin estimate toward zero by
itself, so a newcomer lands near "ordinary". That is the entire reason for regularising rather than
solving exactly.

**Not yet simulated.** The hit-rate table under `MIN_IMPLIED_DELTA` was measured with a real rating
prior; a flat prior is a different estimator and is owed its own pass before anything *gates* on it.
Nothing does — it feeds a price tag, where being roughly right is the requirement.

### 2.31 Market value (`src/marketValue.ts`, `GET /values`)

> **Hidden from the UI since 2026-08-26, at the organiser's request** — `SHOW_MARKET_VALUE` in
> `values.ts` is `false`, so no price renders anywhere and `PlayerPage` does not even ask for one.
> Everything described below is intact and still tested: the formula, `GET /values`, the stored data,
> `PriceTag` itself, and `ratingTier.ts` — which the grades (§2.39) now share and which is the reason
> this cannot simply be deleted. Because the flag is a compile-time constant, the whole feature is
> tree-shaken out of the bundle rather than merely hidden in it. Flipping it back to `true` is the
> whole of turning the feature on again; three tests in `PlayerPage.dom.test.tsx` fail if it flips by
> accident.

A Transfermarkt-style price tag: one number in euros that says roughly what a player is worth to the
club and moves a little every week.

**The problem it has to solve first.** A price tag is the easiest imaginable way to undo §2.28.
Publish a number that is a monotone function of a rating and you have published the rating, the whole
ordering of the club, and a euro figure against each friend's name. Everything below is shaped by
that.

**Five terms, multiplied.** Additive terms let one big number swamp the rest; proportional ones keep
every term honest and the range sane, which is also how a real valuation behaves.

```
value = BASE × (tier × impact) × form × momentum × presence × honours
```

| Term | From | Band |
|---|---|---|
| `BASE` | — | €6.0M |
| `tier` | the rating, **bucketed three ways** | 0.85 / 1.00 / 1.18 |
| `impact` | `resultStrength` delta (§2.30) | 0.90 – 1.15 |
| `form` | nights won, shrunk toward the club rate | 0.75 – 1.35 |
| `momentum` | last 5 nights vs their *own* shrunk rate | 0.88 – 1.15 |
| `presence` | nights played of the last 10 held | 0.85 – 1.10 |
| `honours` | badges + months in the registered five | 1.00 – 1.30 |

**The rating is the narrowest band in the formula, and it is a tier, not a number.** A continuous map
inverts: knowing four public terms, you solve for the fifth. Bucketed at ±18%, the same arithmetic
recovers only which third of the club somebody is in. Measured on a simulated 16-night season the
tier moved a price by €0.5–2.0M against a spread of €3.25M–€12.5M — **the price is mostly results,
and the tier is a nudge on top of them**. A test bounds the whole effect at 1.18/0.85.

**Two privacy gates, and they are gates rather than polish:**

- **`MIN_HISTORY_FOR_VALUES = 5`.** With little history every term but the tier is neutral *by
  construction*, so the price is exactly `BASE × tier` — three distinct numbers across the club, and
  the rating is simply published. Nothing is served until results, attendance and honours have had
  time to pull players apart.
- **Nobody who has never been on a sheet gets a price**, for the same reason at the individual scale.
  Transfermarkt does the same with a new signing.

**`presence` does most of the hiding.** It is a pure public count, and it moves the price enough that
no clean read-back of the tier survives it.

**`impact` is clamped tight** because it is correlated with `form` — both are the same football, once
controlled for teammates and once not. A wide band there would be counting it twice.

**Two rules that make it feel real.** `quantise` steps in quarter-millions under €10M and
half-millions over, so prices look like prices and the arithmetic stops being invertible exactly.
`MAX_SWING = 0.15` caps the week-on-week move: a price that lurches €4M on one bad night is noise,
one that climbs for six weeks is a story, and the story is the whole feature.

**Last week is recomputed, not stored.** `previous` is the same formula over the history with the
most recent *date* dropped — a date rather than a record, so two fixtures filed under one evening
leave together. Nothing to keep in sync, nothing to migrate, and a corrected result recomputes both
sides at once. It is also what makes the swing cap safe: it clamps against a number from the same
code, not against whatever happened to be written down last time.

**`GET /values` is its own route, not a field on `/roster`.** Two reasons. It needs the archive as
well as the roster, and `/roster` is on the path every device takes on every open — a second KV read
there would be paid by everybody, forever, for a decoration. And keeping it separate means
`publicPlayer` keeps its shape, so what stands between a rating and the wire is still one list of
five field names with a test around it, rather than five names *plus a formula*.

**Only `{value, previous}` ships.** No term of the blend ever leaves the Worker — five multipliers on
the wire are five equations, and five equations are the rating back again. Both the module test and
the endpoint test assert the published shape.

**On screen** (`src/values.ts`, `PriceTag.tsx`). The price sits inside the profile header rather than
in a card of its own, because it is an attribute of the player the way the name and the title are —
every card below it is a *count about* them. `values.ts` deliberately does not import
`marketValue.ts`: the formula belongs to the Worker, and pulling it in would ship a ridge solver and
six tuning constants to every phone in order to render a string. A grep of the built bundle asserts
none of it is there.

The hard part of the component is the caption, not the number. A euro figure beside somebody's name
reads as *the app's opinion of them* unless it says otherwise, which is the one thing §2.9 forbids and
the exact thing the private rating was protecting — so the line underneath names its ingredients,
**and says the word directly rather than leaving it implied: "Priced from results, appearances and
honours — not a rating."**

**First version was too heavy, and the fix was to shrink the layout rather than the caption.** An
eyebrow label, a 3xl price, a `border-top` divider and the two-sentence original made this read as a
second panel bolted onto the header instead of a fact about the person beside it. It is now one line
— price, move, done — with the caption folded to a single short sentence underneath. What did *not*
shrink is whether the caption shows: hiding it behind a tap would mean a first glance shows a bare
price with nothing standing between it and being read as a rating, which is the one outcome this
component exists to prevent. So the sentence got shorter and sharper; it did not get optional.

The weekly move carries a sign and a glyph as well as a colour (`▲ +€0.5M`), so it survives a bad
screen and colour blindness. A first valuation says **"first valuation"** rather than drawing a zero
move: a price with nothing behind it has not been observed to be stable.

And it renders **nothing at all** rather than an absence. Offline, an undeployed Worker, a club under
five nights, and a player who has never played are four different reasons that all mean "not yet",
and none of them is worth a sentence on somebody's profile.

**What an insider can still work out.** The repository is public, so the formula is public, and the
four non-rating terms are computable from the published history by anyone who wants to. Divide a
price by them and the tier falls out. That is not a hole in the blend — it is the blend's actual
guarantee, stated exactly: what is recoverable is **which of three buckets** a player is in, never
the 1–5 value or the order inside a bucket. Quantising blurs it further but is not what makes it
safe; coarseness is. If that ever needs to be stronger, a salted per-player jitter of a few percent
(the salt a wrangler secret) breaks the division without changing anything a reader sees.

### 2.32 Test mode (`src/testMode.ts`, `testData.ts`)

Almost everything built this year needs a season behind it before it shows anything — the career
table, the timeline, market value, duos, arcs, the reporter. With sixteen real nights most of it was
either blank or on the wrong side of a threshold, which made it impossible to review and very easy to
sign off something broken. Test mode is a whole invented club to look at it all against: **twenty
players, forty Thursdays**, unlocked by typing `test_mode` at the padlock.

**The entire design problem is not destroying the real club.** The live app keeps its state in one
localStorage key and republishes the *whole* roster and the *whole* archive whenever an admin device
saves anything. A sandbox sharing either would eventually hand twenty invented players to fifteen
real phones. So the isolation is not a check somewhere — it is three structural facts:

1. **A different storage key.** `armonim-teams-test-v1`. `KEY` is a module-level constant resolved
   before the first render, so there is no moment at which the app could be reading one club and
   writing to the other.
2. **No network at all.** `REMOTE_URL` is forced to `''`, and every remote function in this app —
   `remote.ts`, `live.ts`, `push.ts`, `liveRoom.ts`, `recap.ts`, `awards.ts`, `values.ts` — opens
   with `if (!REMOTE_URL) return …`. An empty URL is not a refused request; it is code that returns
   before a request exists. That is one grep, not a promise.
3. **Entering and leaving reload the page.** Nothing carries over in memory and every module constant
   is recomputed. A sandbox that started by inheriting live React state would be one bug away from
   writing it back.

**`sessionStorage`, not `localStorage`.** Test mode dies with the tab. Forgetting to leave is the
obvious human error, and this makes the consequence "closed the tab" rather than "the phone has been
showing fake data for a week". A non-dismissible banner sits above every tab for the same reason: the
isolation holds on its own, but nothing stops a person forgetting which club they are looking at and
reporting a bug against football that never happened.

**The banner is deliberately `position: static`, not `sticky` or `fixed`.** It was the latter once,
with a z-index above everything else in the app so it would read as "loud" — which instead painted it
over the top few centimetres of every `fixed inset-0` overlay (player page, night page, pitch mode,
the fixture page's own modals; see `scrollLock.ts`), exactly where their Back/Close/Edit buttons live.
A `sticky` element is a positioned element with its own stacking context, so z-index alone decided who
won regardless of which one opened later or which was "supposed" to be on top. Ordinary document flow
has no stacking context at all, so a static block can never out-rank a `fixed` panel no matter what
z-index either is given — the property this needed, not a taller number. The trade: the banner no
longer stays visible while scrolling a long tab, the way the header above it never has either.

**The banner's copy names the club's size from `testData.ts`'s own exports (`NIGHTS`,
`PLAYER_COUNT`), not from a number typed into the sentence.** It said "20 nights" by hand for a while
after `NIGHTS` moved to 40, because nothing tied the sentence to the constant it was describing —
the same shape of bug as any other duplicated fact, just easy to miss on a banner nobody reads twice.
Reading both off the one export makes that drift impossible rather than merely unlikely, and there is
a test asserting the rendered sentence matches the current constants rather than a copied-in number.

**The sandbox is admin from the moment it opens**, because most of what it exists to exercise is
behind admin and there is nothing here to protect. `test_mode` is checked in the client and **never
sent anywhere** — the Worker has never heard of it and must not.

**The version watermark is safe for free**, and it is the subtlest hazard here. The stored version is
a timestamp taken by whichever server wrote it; had the sandbox stamped the live key, the device
would return from test mode believing it already held something newer than the club's roster and
would refuse to adopt the real one, silently and forever. `versionKey` is scoped by `REMOTE_URL`'s
host and test mode has no host — the fix from an earlier bug covers this one. There is an assertion
rather than a hope.

#### The invented season

Data that is merely *present* tests nothing. Almost every feature here is gated on a **pattern**
rather than a count — a run of three, a duo past its shrinkage, a plus-minus with signal in it — and
a season of coin flips satisfies every structural check while leaving every page as blank as it was
with real data. So results are simulated *from* team strength with noise on top: good players really
are better, which gives the ridge solver something true to find, and the noise is heavy enough that
upsets, droughts and runs happen on their own rather than being sprinkled in.

Nights are valid ones the app could have produced: three fives from a fifteen-strong sheet, `wins`
equal to `winsFromLog` wherever a log exists, and a log that respects winner-stays-on. Roughly three
in four are logged match by match and the rest are tallies, because both are real and both have to
keep being read. There are MVP picks, a few organiser's notes, and everything is prefixed `test-` so
a stray record is obvious on sight.

**Forty nights, and the number was measured rather than picked.** Twenty was the obvious choice and
it is not enough. Teams are redrawn weekly, so a pair only line up together about a third of the
nights they both attend; at twenty nights the closest pair had eleven together, and `duos.ts` shrinks
a record that short back to the base rate on purpose. Measured on this seed:

| nights | players with a duo record |
|---|---|
| 20 | 0 / 20 |
| 30 | 0 / 20 |
| 40 | 6 / 20 |
| 52 | 6 / 20 |

Forty is also what takes the keenest players past `VETERAN_NIGHTS = 25`, so the long-service badge
can appear at all. Fifty-two buys nothing further.

**Deterministic**, from one seed. A sandbox that reshuffled on reload would make "did that change?"
unanswerable, which is the one question a fixture exists to answer. The *dates* are anchored to the
real calendar so "this month" and Team of the Month have something to be about, which is the right
way round: the football is what you are reviewing.

Team of the Month is the one place the sandbox inverts a rule the real feature is built on. An award
is a **record**, read back from KV, never derived (§2.25) — but there is no Worker here, so
`testAwards.ts` derives the months from the invented history using the same `teamOfMonth` the
registrar calls. It lives in its own file, reachable only from the test branch of `fetchAwards`, so a
derived award can never be reached from live code. The newest month is left out: a month that has not
ended has not been announced, and including it would make the sandbox disagree with the one behaviour
anyone testing the feature is trying to see.

### 2.33 Tonight's derby (`src/derby.ts`, `DerbyBanner.tsx`)

The two players on opposing shirts who **cannot put each other away** — the closest head-to-head
record on tonight's sheet, over enough matches to mean it. Rendered above the milestone strip in
`TonightFacts`, so the organiser's fixture page and the group's live view get the identical card
(§2.21).

**A derby is not a bogey man, and the difference is the whole design.** `matchupPicks` already finds
the player whose team has beaten yours most, and that is the right fact for a profile page you opened
about yourself. It is the wrong fact for a banner the entire group reads before kick-off — *"ניב has
beaten אופק 12 times to 2"* puts one named friend on a screen as the loser, every week, decided by an
app. The symmetric version costs nothing and reads better anyway: a rivalry that is *level* is the one
worth announcing, which is what the word has always meant.

**The pick is the smallest `gap = |beat − beatenBy|`, and the longer rivalry wins a tie.** Same shape
as the worthy opponent on a player's page (§2.18), which is the right family: both are looking for two
people who cannot separate themselves.

**This replaced a first attempt, and the reason is worth keeping.** That version scored
`contested = 2 × min(beat, beatenBy)` — "how many of their matches have gone each way" — which reads
elegant and is dominated by **volume**. Measured against the invented club (§2.32) it crowned a 40–32
record over 72 matches, a 56% split that is not level at all, while a dead-level 27–27 over 54 came
third. Worse, the pair it named were the two keenest attenders in the club, so the same two names
would have headlined a large share of every night — and a banner that says the same thing every week
stops being read. Ranking on the gap picks the rivalry rather than the fixture list.

**A floor on matches and a ceiling on lopsidedness, and both are load-bearing.**

- **`MIN_MATCHES = 10`.** A gap of zero is trivially available — play someone once, lose, play again,
  win — so the floor is what separates "cannot be separated" from "has barely been tried". With
  roughly seventy-five cross-team pairs on any sheet, several are dead level at 1–1 by accident. A
  little above the worthy opponent's `MIN_FACED = 8` on purpose: that card is one line on a page about
  you, this is the only thing on the screen and it is addressed to everyone.
- **`BOGEY_RATE`, imported from `playerProfile.ts` rather than re-declared.** Ranking on the gap picks
  the *least* lopsided pair, which is not the same as picking a level one — on a night where nobody is
  close, the closest available might be 14–6, and announcing that to the group is the bogey man this
  file exists to avoid, arrived at by a different road. So a pair who clear 0.6 in either direction get
  no banner at all. Sharing the constant buys a property worth stating plainly: **a derby is a pairing
  in which neither player is the other's bogey man.** Two 0.6s in two files would drift and the
  sentence would quietly stop being true.

This also rules out the shrinkage `duos.ts` uses: pulling a thin record toward even is the exact wrong
correction when *even* is what you are hunting, and would rank 1–1 above 9–7. The floor does that job
by refusing thin records outright rather than by adjusting them.

**Counted in matches, not nights**, so only nights logged match by match can answer it (§2.17) — the
same constraint `Matchup.faced` carries. A night is a blunt unit for a rivalry: two players can be
opponents for two hours and the night records one winner between three teams.

Measured across the invented season: **silent on 6 of 40 nights** (the early ones, before anybody has
ten matches against anybody), and **25 different pairs named across the other 34** — the most-named
appears four times in a season. Late on it is finding 27–27 over 54 and 24–24 over 48. Both numbers
matter: the first says the floor is not strangling it, the second says the repetition problem the
contested-matches version had is gone.

Guests are excluded by name rather than left to the floor: a guest carries a fresh id every visit, so
a pair involving one can never accumulate a record — the same reasoning as milestones and duos.
`tonightId` is excluded too, since tonight's own result is not part of the record the two of them are
bringing *into* tonight.

**Both names are the same size, and there is a test for it.** Every other pick in this app has a
subject — a milestone belongs to one player, a bounty is on one player — and this one is symmetric by
construction, so the layout has to be symmetric too or the reader will decide the one on the left is
the favourite. The shirts do the colouring, because this pairing is only a derby *because of how the
teams came out*; next week they will probably be on the same side. And the card says **"14 matches on
opposite sides"** underneath, because `7–7` beside two names is exactly what a goal tally looks like,
and this app has never counted a goal in its life (§2.9).

### 2.34 Folding the match-night panels (`TonightFacts.tsx`, `ui.tsx`)

A match night carries three panels of facts — **🎯 On the line tonight**, **⚔️ Tonight's derby**, and
**📋 Coming in tonight** — alongside the clock and the match log. Two changes, both about a page that
is used standing up.

**The clock and the log come first, the facts after.** They were the other way round, ordered by how
interesting each panel is, which put most of a screen of reading between the organiser and the two
controls they actually came for. The facts are read once, before kick-off; the clock and the log are
touched every few minutes for two hours, with wet hands, by somebody not looking for long. Both
`FixturePage` and `LiveFixtureView` were reordered, for the same reason (§2.21).

**And each panel folds**, via a shared `FoldHeader` in `ui.tsx`.

**The heading is the control.** No separate chevron button: the eyebrow label was already there and
already the width of the card, so making it the target costs no pixels and gives a thumb something
to hit. `▲ hide` / `▼ show` in words as well as a glyph, matching the past-nights shelf in History
(§2.14) — a bare chevron is the kind of control people do not find on a phone.

**The chrome is not shared, only the affordance.** The three cards look deliberately different —
orange for what is at stake, violet for the derby, cream for what is already true — so `FoldHeader`
takes a `className` and each card keeps its own palette. A fold control that varied between them
would read as three unrelated widgets rather than one habit.

**A fold lasts exactly one fixture.** Two requirements pulling opposite ways, resolved by what the
key is made of — `armonim:folded:<fixtureId>` in `sessionStorage`:

- **It must survive a reload**, which is why this is storage rather than component state. The live
  view is reloaded constantly at a pitch — a phone locks, a signal drops, somebody re-opens the link
  — and re-folding three panels each time is precisely the annoyance folding was added to remove.
- **It must die with the fixture**, which is what the id in the key buys. A fold is a decision about
  *tonight's* facts: this derby, this set of near-milestones. Carrying it into next Thursday would
  mean somebody who tidied the page away once silently gets a barer app every week after, with no
  memory of having asked for it. Keying on the fixture makes "it ends when the fixture ends" true
  **without anything having to notice that it ended** — no cleanup on the end-fixture path, nothing
  to forget to call. A write sweeps every other fixture's entry on the way past, so at most one is
  ever kept.

`sessionStorage` rather than `localStorage` as the backstop, the same trade test mode makes (§2.32):
closing the tab is a second thing that ends a night, and neither should outlive it. Open is the
default, and open is what a failed read returns.

The id arrives *late* — a fixture has no published id until the organiser publishes it — so one night
can be shown under two keys in a sitting. `useFold` re-derives on the key rather than only on mount,
or a fold from a moment ago would be read back off the wrong entry.

**`MilestoneStrip` gained the heading it never had.** It is the one panel that was a bare card, and
a fold needs a label to hang on. `title`, `open` and `onToggle` are all optional, so the night page
(§2.22) — where this strip is the record of a night already over, on a page with no clock to reach —
renders exactly what it always did. **"Coming in tonight"** is the counterpart to "on the line
tonight" above it: what everyone brings to the pitch, as against what they could leave with.

**One fact per line, now in both panels.** "On the line tonight" wrapped inline, so two facts could
share a line and a third straddle two — "איתי is 3 from 100 career wins  אורי is 2 from 100 career
wins" reads as one sentence about a pair of people. These are separate claims about separate people;
`MilestoneStrip` had already been fixed this way and the argument was the same one.

### 2.36 Club statistics (`leaderboards.ts`, `Leaderboards.tsx`, `History.tsx`)

The History tab became **Club statistics**: the same page it always was, plus podiums and the two-player
comparison (§2.37). A league scatter plot was built against this same structure and is parked on
`feature/league-scatter` rather than shipped — the `Section` machinery below is what it slots into if it
comes back.

**The tab strip says "Club", the page says "Club statistics".** The strip is
`[Match day] [Roster (20)] [Club]` and lives on a phone; the full phrase is roughly double the width of
the word it replaced and would have wrapped the nav to two lines. A short tab and a full `<h2>` costs
nothing and says the same thing.

**The past-nights shelf stays first.** It was tempting to lead with the numbers now that the page is
named after them, and that would have made two comments — here and in `storage.ts` — quietly stop
being true, both of which say *the shelf is what the tab is for*. It still is: a night is a story and
the rest is reference. The new sections go **below** the career table, and the admin panels stay
exactly where they were.

**Every section folds**, via the same `FoldHeader` the match night uses (§2.34). Nine blocks on one
phone-width page is the problem folding was built for. **Team of the Month starts folded** — it is
admin tooling that opens to a row of buttons per month, used once when a pick needs correcting, and it
was the largest thing between an organiser and the football.

That default is why the stored shape is a **map of choices** rather than a list of hidden ids. A hidden
list cannot express "closed unless you say otherwise": Team of the Month's default would have been
indistinguishable from a fold the reader had chosen, so opening it once and returning later would have
been ambiguous. Storing what somebody actually chose, and falling back to each section's own default
until they do, keeps the two apart — and means changing a default later does not have to fight state
already sitting on a device. A stored value that is not a plain map (including the older hidden-list
format) is read as no preference at all rather than trusted.

**Rating suggestions sit directly above the career table.** They are a claim about the numbers in it,
and the `vs rating` column they come from is one of its columns; three sections higher up they were an
instruction to go and check something further down the page.

**But the fold state is stored differently from the match night's, on purpose.** Those folds are keyed
by fixture in `sessionStorage`, because a fold there is a decision about *tonight* and must not outlive
it. This tab has no event to expire against — somebody uninterested in podiums is uninterested next
week too — so it uses `localStorage`, one key holding the hidden section ids. That matches the
past-nights shelf sitting beside it, whose comment already explains the reasoning: the tabs unmount, so
without storage "hidden" would only last until you looked at something else. One key rather than a key
per section, because sections are still being added and a growing family of near-identical keys is how
one of them ends up misspelled.

#### The podiums

Six boards — most match wins, most nights won outright, most nights played, most MVP picks, longest
winning run, and on a run right now. **Nothing is newly measured**: every one is a column that already
existed in `playerStandings`, `mvpCounts`, or `achievements.ts`, which computes both winning runs in
order to badge them. `longestWinRun` and `activeWinRun` were exported rather than reimplemented — a
podium and a badge disagreeing about whose run is longest is the kind of bug nobody reports, because
both numbers look plausible alone.

**Counts only, and the exclusion is the point.** `perNight` is the one number on the career table that
is a *rate*, and a rate must not go on a podium. Sorted in a column, "2.5 per night off two nights"
sits in a list the reader can see the rest of; on a podium it becomes "best in the club" with the
sample size nowhere on screen. Wins, nights and picks are totals — more football can only ever help —
so none of them can do that to anybody. `perNight` stays a sortable column (§2.9).

**Ties share a rank, and a board can therefore be longer than three names.** Standard competition
ranking, the same rule `placeOf` uses for three teams level on a night: two players tied on 15 are both
first and the next is *third*. Drawing exactly three would mean picking one of two genuinely level
players to print and one to hide, and there is no honest rule for choosing. Measured on the invented
club, "most nights won outright" runs to five names.

**Zero is dropped before ranking, not after.** A board reading "0 · 0 · 0" is not an empty podium, it is
three people being told publicly that they have none of something — and for a count like MVP picks that
most players will never have, that would be most of the roster. A board with no one left disappears
entirely, which is also why **🔥 On a run right now vanishes after a drawn night**: `winnerOf` says
nobody takes a night that ends level at the top (§2.6), so nobody is on a run, and the board correctly
has nothing to say. Verified against the invented club, whose final night ends 4–4.

**Silent below `MIN_NIGHTS_FOR_BOARDS`**, which is `MIN_NIGHTS_FOR_TITLES` imported rather than
re-declared — that constant already answers "has the league happened enough for a superlative about it
to mean anything", and its own comment applies here word for word. Two constants would be two answers
to one question and they would drift. `leaderboards()` returns `[]` rather than a list of empty boards,
the same shape `fitnessRings` uses (§2.35): "not yet" is one state, said once.

#### What came out of the career table

The badge cluster beside each name, and the nine-line key under the table that existed to decode it.
That cluster was the only aggregated "who tops what" a non-admin could see, which is why **it could only
be removed in the same commit that added the podiums** — taking it out first would have lost the
information for however long the gap lasted. The podiums say the same thing in words, with the count
beside each name, and the widest rows no longer carry nine emoji.

Untouched: `titleBadgeFor` still drives the roster skins and the title on a player's page, and the
badges themselves still appear on the player page. Only the table lost them.

**The medal palette moved to `ui.tsx`** and is now shared by the night ribbon and the podiums. A reader
who has learnt what the 2 on their ribbon means should not have to learn a second palette to read a
rank.

**A `bdi` sets its own direction, which broke the first layout.** With the name given `flex-1`, a Hebrew
name aligned to the right edge of a stretched box and drifted a couple of centimetres from the medal it
belonged to — while an English name in the same markup would not have. The name now hugs its medal and
a spacer takes the slack, which reads correctly in either direction.

### 2.37 Comparing two players (`compare.ts`, `PlayerCompare.tsx`)

Two pickers and two columns of counts, folded away at the bottom of the Club tab. **Nothing new is
measured**: each side is `profileCounts` over `profileNights` — the same numbers the career table
prints — and the shared half is one entry out of `matchups()`, which has counted both "alongside" and
"against" since §2.18.

**The rule this screen is built around is that it must not rank two named friends.** It is kept by
restricting the rows to numbers *both players own separately* — nights, nights won, match wins, MVP
picks, longest run — each a count of something that happened to each of them on their own, so putting
them side by side is arithmetic a reader could do by looking at the table twice. There is a test
asserting the rendered panel contains no "leads", no "winner", no "better", no crown and no tick, and
it is the most important test in the file.

That test earned its keep immediately: the row now labelled **"Longest run"** was first written as
"Best run", and the assertion failed on the word *best*. The podium already calls the same statistic
"Longest winning run" (§2.36), so the fix was also the consistent name — but the point is that a
judgement word had walked onto the screen unnoticed inside an ordinary stat label.

**`perNight` appears here, having been excluded from the podiums, and the difference is the sample
size.** A podium shows "best in the club" with nothing to calibrate against; here the nights each rate
was divided by sit two rows above it in the same panel. A rate whose denominator is on screen is a
fact; one whose denominator is not is a verdict.

**Both pickers start empty.** There is no non-arbitrary default — the app has no idea which of twenty
players is holding the phone (device identity is still parked) — and defaulting would put an arbitrary
pair of friends on screen under a heading that invites comparing them. The section is also
`defaultOpen={false}`, because it does nothing at all until two names are chosen.

**The bar under each row is the ratio and declares nothing.** Where both sides are zero the track stays
empty rather than splitting 50/50: "0 against 0" is not a dead heat, it is nothing to compare. The bar
is `dir="ltr"` so the left number always owns the left bar, whichever direction the names beside it run.

**The larger figure on each row is boxed, and where the line is drawn matters.** Marking which of two
numbers is bigger is arithmetic the reader could do by looking at them; a crown, a tick or the word
"leads" would be the app calling somebody the better player off a count that cannot carry it. So the
highlight is a tint and a ring, **tinted per side** rather than gold — which keeps the picker → bar →
highlight chain in one colour and stops it reading as a medal. Strictly greater, so **a tie boxes
neither**: level is not a win, and two zeroes are a tie by the same rule, which is right, because
nobody won a count nobody has. The no-judgement-words test is unaffected and stays green — the
highlight adds emphasis, not vocabulary.

**The figures themselves wear the page's ordinary ink**, not the side colours. A column of coloured
numbers reads as a status — *this one is the good one* — before it reads as a quantity, and the
quantity is the point. The pickers keep their colours, because that is what maps a chosen name onto
the bar beneath it.

**Three shared states, and they are genuinely different.** Nights on the same team; nights on opposing
teams; and matches faced — the last only from nights logged match by match (§2.17). So `against > 0`
with `faced === 0` is a real and common state, meaning "opponents all evening, but nobody wrote the
matches down", and the panel says exactly that rather than printing a silent zero. Never having shared
a sheet at all is a third state with its own sentence. The head-to-head line says **"אופק's team has
beaten ניב's"** — teams beat teams, never people (§2.8) — even though the 🥊 beside it is allowed its fun.

Names come off the fixtures rather than the roster, newest first: somebody who has left the club can
still be compared because their record happened, and somebody who changed their name reads as the name
they go by now.

### 2.39 Post-match grades (`grades.ts`, `gradesFacts.ts`, `gradesApi.ts`, `NightGrades.tsx`, `worker/grades.js`, `GET|POST /grades`)

A mark out of ten for every player on a filed night, and one line of dressing-room banter beside it.

**The model never decides the number.** Same split as Market Value (§2.31): the app computes something
defensible, and the model is handed the finished figure and asked to phrase it. Four terms carry the real
football, and only two of them can separate teammates at all — a fifth and sixth, `tier` and `jitter`,
exist for a different reason entirely and are documented on their own below.

| Term | Weight / cap | What it is |
|---|---|---|
| `night` | 2.3, ±2.5 | the team's result **relative to that night's own size**, shared by all five |
| `mvp` | +1 | the one true per-player signal a night produces |
| `career` | 0.75, ±0.5 | their record against the club's, shrunk toward the mean (`SHRINK_K = 6`) |
| `momentum` | 0.65, ±0.7 | their last five nights against **their own** shrunk baseline |
| `tier` | ±0.25, permanent | the organiser's rating, coarsened — see **The tier shade** below |
| `jitter` | ±0.35, permanent | a stable per-player-per-night "coin flip" — carries no information at all |

**`WIN_FLOOR = 8` — a night won outright is worth at least eight (added 2026-08-28).** From the first
real night the club graded: one team took 7 of 12 while the other two took 2 and 3, and players on
the winning side still came out at 7.5. The ordering was right; the *floor* was wrong. The four
personal terms span about ±1.5 between them, which is easily enough to drag somebody under the mark
their team's night earned, and winning a night comfortably while being told you were a 7.5 reads as
a correction rather than a result.

**A floor rather than a wider `night` term, because the two are different moves.** `night` is one
symmetric slider: widening it lifts the winners and pushes the other two teams down by exactly the
same amount, and nobody complained about the losing teams. The floor lifts only the side that
actually took the night and leaves every other mark on the sheet where it was. `NIGHT_W` did go
2.3 → 2.6 at the same time, but for a different purpose — so a dominant win clears 8 on its own
(base + night = 7.95 on that 7/3/2 night) and the floor stays a safety net for narrow wins rather
than the thing setting most winners' marks.

Applied **after** rounding, so the floor is exactly the number it claims; and to outright winners
only, since a night level at the top belongs to nobody (§2.6). **The cost, stated plainly:** marks
inside the winning team compress — two players who would have been 7 and 7.5 are both 8 now, and only
the spread above the floor survives. That is what a floor *is*, and the alternative is a night's
winner reading a 7.

**`PLAYED_FLOOR = 4` — and nobody who turned up goes below four.** The other half of the same
decision: on that night the two teams that did not win were landing at 3 and 3.5, and the organiser
raised both. It is the `BASE = 6` argument applied to the bottom of the scale rather than the middle
— the mark is read every week by the person it is about, and there is no version of a Thursday
five-a-side that is worth telling somebody they were a 3 out of 10 for. It does not flatten the
bottom third: the spread between a quiet night and a hammering survives above the floor, and the
losing sides still mark clearly below the winning one. On the 7/3/2 night the three teams come out
**8–10**, **4–7** and **4–6.5**.

`GRADE_MIN` stays 1 rather than being raised to match. The scale is 1–10 and that is what the chip
renders against; these are floors applied *within* it, and collapsing the two would hide that a
judgement is being made rather than a range being defined.

`MatchLogEntry` records `{a, b, winner, viaPenalties}` — team colours, not people. Every match, every
shootout and every sequence is therefore *identical* for the five players on a shirt, so **on a single
night exactly one thing distinguishes teammates: the MVP pick.** Everything else that differs between
them is history, which is what the last two terms are.

**Why "did they beat their own baseline tonight" is not a term.** It was the obvious fifth and it is
backwards. Measured on the invented club (§2.32), a single night swings a player's per-night figure by
−2.0 to +2.4 (p10–p90) while the gap between the club's best and worst player is 1.61 — one night is
mostly luck. Worse, the term *inverts*: on an identical five-win night the weakest player
"overperforms" by +2.75 and the strongest by +1.14, so over a season every player averages the same
mark and the best players score **lowest** on ordinary wins. The personal-expectation angle is real and
worth saying — it belongs in the sentence, where it can be qualitative, not in the number, where it
would be a lie. **Momentum is safe for the opposite reason:** averaged over several nights it is far
less noisy, it is measured against each player's own baseline so it favours nobody, and it
mean-reverts — per-player season averages land between −0.30 and +0.21. It adds movement, not bias.

**`BASE = 6`, not the arithmetic midpoint.** A 1–10 centred on 5.5 is technically balanced and reads as
mean: most nights are unremarkable, so most marks sat at 5 and below, and a group reading their own
marks every week would be told they were average-to-poor most of the time. Six leaves the spread and
the ordering untouched and moves only where "nothing special happened" sits — a judgement about tone,
not about football. Calibrated: median 6, p10/p90 at 4/8, 1.0% at or below 3, 0.3% perfect, season
averages 4.79–6.84. (Those figures are from before the two floors below, which were added later and
move the bottom of that distribution up — nothing now sits under 4, and the winning third of any
night sits at 8 or above.)

**The tier shade (`tier`, `jitter`).** On a club three real nights old, `momentum` is structurally off
for everybody (`MIN_RECENT` nights unmet) and `career` is shrunk almost flat (`SHRINK_K = 6` against one
or two nights of evidence), so every player on a shirt rendered as the identical number for weeks —
measured on the actual club, four and five teammates in a row at the exact same mark. `marketValue.ts`
has the same problem and solves it by withholding the price entirely for `MIN_HISTORY_FOR_VALUES` nights
(§2.31). This file does not take that route: it puts the organiser's rating (§2.28) into the formula as a
small, coarse, **permanent** term.

**A jitter-only version was designed first and rejected, on the maths rather than on taste.** The
proposal: a small deterministic per-night noise term, seeded from `fixtureId` + `playerId`, meant to
break the flatline visually with nothing correlated to anybody. It cannot also give a stronger player a
"realistic edge" — unbiased noise has no slope by definition — so achieving both halves of the ask
requires a second, *systematic* term keyed to the rating. And a systematic term does not hide behind noise
added on top of it: `night`, `mvp`, `career` and `momentum` are all reconstructable by anyone from
`GET /history` (no password), so the residual `grade − (those four)` is computable for every night a
player has played, and by the law of large numbers `mean(residual) → tier` as nights accumulate — the
noise is exactly what averaging cancels, which makes the jitter the thing destroyed by the technique
meant to hide the tier behind it, not a mitigation of it.

**A fading version was built next, then deliberately removed.** `coldStartWeight` tapered both terms to
zero by `FADE_NIGHTS = 8`, capping the exposure at a short window. The organiser's objection was decisive
and is a product argument the maths cannot answer: the ratings are *actively maintained* as players
improve and decline, so a term that switches itself off once somebody has played enough nights is fighting
exactly the updates it exists to reflect. Permanence is also what `marketValue.ts` does — its `tier` never
decays either; it buys safety by withholding the whole feature until real variance exists to hide inside.

**So the accepted, on-the-record trade is:** a determined reader who reconstructs the four public terms and
averages the residual over a season recovers **which third of the club the organiser puts somebody in** —
and the estimate gets *sharper* with tenure, so the most loyal members are the most exposed. This was
measured, argued twice, and overruled on purpose on the grounds that a weeknight five-a-side group will
not run the regression. Not a missed risk; a priced one.

- **`tier`** buckets the rating into the same three thirds `marketValue.ts`'s `ratingTier` already cuts
  (exported from there specifically so the two files can never define "top third of the club" two different
  ways). Read from **that night's `FixturePlayer` snapshot**, not today's roster, so re-rating somebody
  changes their future marks without silently re-scoring their past ones.
- **`jitter`** is the harmless half of the original proposal, kept for what it was always good for: visual
  variety with zero information in it. A stable FNV-1a hash of the two ids.
- **What keeps it bounded** is that `tier` is the smallest term in the formula — ±0.25 against `career`'s
  ±0.5, `momentum`'s ±0.7 and `night`'s ±2.5. There is a test asserting exactly that, and another asserting
  a top-tier player on a blanked team still marks below a bottom-tier player whose team took the night. It
  shades a mark; it cannot carry one. Widening `TIER_BUMP` past `CAREER_CAP` turns a shade into a verdict
  and needs the organiser saying so in as many words.

Deliberately **not** threaded into `GradeContext` — the model never sees `tier` or `jitter`, only the
final `grade`, exactly as it never sees any other part of the breakdown.

**The mark became a published artifact the moment the rating entered it (`publishedMarks`).** This is the
structural consequence that is easy to miss: `publicFixture` strips `rating` from every filed night before
`GET /history` serves it, so `nightGrades` — which runs client-side — computes one answer on the
organiser's device (which pulls `/history/full`) and a *different* answer on everybody else's. Measured
against the real club with ratings attached: **six of sixteen players came out half a mark apart.** An
earlier version made this worse by comparing the stored mark against the locally recomputed one and
dropping the banter when they disagreed, as a staleness check — on a viewer's phone that fired for a large
share of the club every time, hiding the lines from precisely the people they were written for while the
organiser saw them fine. So the Worker now stores a `grade` for **every** player (with `text` optional, for
the ones the model skipped) and the UI renders the published figure, never a local one — the same shape
`GET /values` already uses for a price no public device could work out. Staleness after a correction is
handled the way the recap handles it: the organiser re-rolls.

**One prompt for the whole sheet, keyed on an ASCII code.** Fifteen separate requests would burn a
day's free tier on one night, and fifteen independent completions have no way to avoid handing the same
joke to four people. So the Worker sends one request and asks for a JSON object mapping `p1`, `p2` … to
one Hebrew sentence each. The codes exist for the length of that request: the payload carries `key`
*and* `id`, only `key` reaches the prompt, and `linesFrom` maps the answer back onto player ids before
anything is stored. Keying on the Hebrew name instead would mean a single altered character silently
orphaning that player's line.

**Inventing a *connection* is the same offence as inventing an event, and it is what the first spike
actually did.** Handed the organiser's unassigned note — "the ball went over the fence about five
times, all by the same guy" — and a player who had lost every match, the model put the two together and
named him. Nothing in the record said it was him; he was simply the most available culprit. So the
prompt carries **WHO A FACT BELONGS TO**: never attribute an event, quote or note to a player unless
that player's key or name is explicitly attached to it, never guess, and an unassigned note stays
unassigned. It then names the exact wrong inference — *a bad night is not evidence; the player with the
lowest mark did not do it* — because the general rule alone had already been obeyed in spirit and
broken in fact. `gradesFacts` drops the `debut-group` milestone for the same reason: "3 players played
their first night" is the one milestone naming nobody, and the individual debuts say it with names.

**The derby is the one fact in the payload that belongs to two named people** (§2.33). It is recovered
rather than remembered — `derbyOnRecord` recomputes the pairing the group read before kick-off, since
the pick is a pure function of that night's teams and the archive before it — and `settleDerby` counts
what the two shirts did to each other once they were on the pitch. Both players' lines are told to use
it, in whichever direction it went: whoever came out ahead enjoys it, whoever came off worse hears
about it, and nobody else may mention it. A shootout counts as a full win here, exactly as it does in
the record the pairing was picked from — the half-win rule is about the night's tally, not about who
beat whom — though the prompt is told how many meetings needed one. `met: 0` is reported rather than
hidden: billed against each other and kept apart by the rotation all evening is a better line than
most. A night with no `matchLog` returns null, because a tally cannot say who beat whom (§2.17).

**The marks and the sentences are both stored**, keyed by player id — see the note on `publishedMarks`
above for why the mark cannot simply be recomputed by whoever is reading it. `text` is optional within
that record and `grade` is not: a mark with no banter is an ordinary complete state, where a sentence
with no mark would be banter about a number nobody can see.

`POST /grades` takes the same four shapes `POST /recap` does — `{facts}`, `{facts, save}`, `{lines}`,
`{lines: null}` — behind the secret word, with its own rate-limit counter rather than the recap's, since
re-rolling a report until it reads well must not silently spend grades that have not been written yet.
`worker/gemini.js` holds the model waterfall, the thinking-config retries and the error wording that
both features share; what stays with each is its prompt and how it reads the reply.

**On screen (`NightGrades.tsx`), last on the night page, below the report.** The story of the night
comes first; each player's personal verdict on it comes after. Same generate → draft → publish flow the
report already teaches, on purpose — an organiser who has learned one has learned the other.

**Grouped by shirt, not one flat ranking of fifteen friends.** The dominant term in the mark is the
team's result, shared by all five players on it, so a list sorted 10 → 3 would mostly re-derive the three
teams in blocks while presenting itself as a personal ranking. Three cards mirroring the team cards above
them are honest about what the number mostly is, and put the genuinely personal spread — MVP, career,
momentum — where it actually lives: between teammates on the same card. This is also the one place in the
app that comes close to the no-judgement-words rule §2.37 draws for `PlayerCompare` and does not follow
it — a grade is a verdict by design here, unlike a count — so the boundary is enforced a different way:
the word "rating" (the organiser's private 1–5, §2.28) is never used for it, and there is a test for that.

**A player still gets their mark with no line beside it**, and that is not a degraded state — it means
the model skipped them, which the admin sees named on the draft (`missing`) and can re-roll if it is
worth it. On screen it is simply a chip with no sentence under it.

**Three prompt corrections from the same night's feedback (2026-08-28).**

- **A run that ended was still being congratulated.** The fact read `הגיע עם 3 ערבים ברצף של ניצחון`
  and stopped there, so a player whose team was beaten got a line praising the streak that had just
  been taken off them. Both halves were already in the payload (`runBefore`, `wonNight`), so
  `describe()` now says which way it went — `והרצף ממשיך` or `והרצף נגמר הלילה` — and a new prompt
  section, WHAT SOMEBODY ARRIVED WITH IS NOT WHAT HAPPENED TONIGHT, says outright that the last
  clause of a player's line often reverses the first.
- **Lines were promising things about next week's shirts.** The grades prompt had one sentence on
  this inside HOW THE NIGHT WORKS; the night reporter has had a full section for months and *still*
  broke the rule, so the grades prompt now gets the same treatment plus the standing exception: a
  player's own luck in a colour is about the player and follows them into whatever they wear next.
- **The reporter's sign-off, for the fourth time.** Three separate statements of the rule had not
  stopped it, so the fix is no longer another statement: the sign-off paragraph now names itself as
  the place this goes wrong, and carries a worked wrong example (`להגן על התואר`) and a right one.
  An abstract prohibition gives a model nothing to pattern-match against; two examples do.

**The organiser's note can hold more than one event (2026-08-28).** `said` is one free-text field and
an organiser will reasonably put two things in it, but WHO IT BELONGS TO was written in the singular
— "read the line and see whether it names a player" — which has no answer when one half names
somebody and the other names nobody. Merging them is precisely how a named player gets attached to an
event nobody was named for, which is the §2.24 failure this section exists to prevent. The note is
now explicitly *several* facts with *several* owners, checked one at a time. It also asks for two or
three sentences rather than one: it is the only actual event in a record that is otherwise entirely
scorelines, and a flat single-sentence mention spends the best material in the report.

**The chip's tone (`GRADE_TONE`, `toneOf`) is flat for the ordinary run of marks and breaks that rule
only at the top.** Rose at 4 and below, plain card ink in between, green from 7 up — a group reading
their own marks every week should see green often enough for it to mean something, not reserve it for a
handful of outliers. 9 and 10 step further, on purpose: a gold gradient for 9–9.9 and a violet-to-indigo
one for a perfect 10, because those two are rare enough, and worth enough to the player who gets one,
that a flat fill undersells them.

**The whole section renders nothing for two different kinds of nobody.** A night with no result at all —
`gradesFacts` returns null — and a night nobody has published yet, read by somebody who cannot publish
one. Neither is worth an empty shell asking to be filled in, the same restraint `PriceTag` shows for a
player with no market value yet.

### 2.40 The form panel (`gradeHistory.ts`, `GradeForm.tsx`, `GET /grades/all`)

A player's published marks lately, on their profile — the third way of asking about the same nights, so
it sits between the medal ribbon (where they finished) and the timeline (what happened). A row of
coloured squares and a table with a mark on the end of each row: the shape every football screen uses
for form, pared back once on the organiser's own read of it (below).

**It replaced a line chart, and the reason is worth keeping.** The graph drew a continuous trend through
points a week apart, which invites reading a slope into what are really five separate evenings, and it
spent most of its pixels on the empty space between them. Squares and rows say the same thing without
implying anything in the gaps. (The chart is in the history at `95a77d9` if it is ever wanted back.)

**The columns are what a night actually knows.** The screens this is modelled on show minutes, xG, goals
and assists; this app records none of those, because nobody writes them down (§2.24). It records the
shirt, what the team took, where they finished and the player-of-the-night pick — so those are the
columns (the "wins" column named for what it is, not for a Football Manager convention that assumes a
season of matches rather than a night of them), and there is a test asserting the words *goal*, *assist*,
*xG* and *minute* never appear on it. Inventing them here would be the same offence the grades prompt
spends three paragraphs preventing.

**No "won of last N" / "MVP of last N" tiles, on the organiser's second pass at the design.** The first
version carried both beside the strip, in the spirit of the reference screens' summary row. Dropped for
being redundant with what the table already shows one scroll down, and for being where a shared-top night
first exposed the next point.

**A shared placing shows a plain number, not `=1`.** The first version marked a tie explicitly — level at
the top means nobody took the night (§2.6), so without the mark a gold 1 could read as an outright win
that did not happen. Simplified back to a bare number on request; the honest distinction is not gone, only
quieter — the hover title still says "Level on 1" rather than "Finished 1st" on a shared night, which
costs nothing and loses nothing for anyone who taps it, while the badge itself stays uncluttered for
everyone who does not.

**A bulk endpoint had to exist first, and it is the interesting part.** Grades are stored one KV key per
fixture, which is right for the night page — it reads one night. This panel reads *every* night a player
has played, and a request per night is fine at three and absurd at fifty. `/awards` already documents
this exact tension ("a player page wants all of them at once"); `GET /grades/all` resolves it from the
other side — the per-night keys stay, and `readAllMarks` does the fan-out inside one request, where it
can be concurrent. It returns **marks only**: the banter is the bulky half, this panel shows numbers, and
dropping the text takes a season from roughly 150KB to under 20KB rather than letting this quietly
become the way a whole season of writing gets downloaded to draw a form strip.

**Five tones on the squares, not the three `NightGrades` uses for its chip.** A strip is read as a
*gradient* — the eye is hunting a run of green or a slide into red — and three tones cannot show a slide.

**The strip is the last five, whatever the window.** Five is what every football screen means by recent
form, and it is also `RECENT_NIGHTS` in `grades.ts`, so the squares and the momentum term inside the
mark are looking at the same stretch of football rather than two different definitions of "lately".

**1M is the default** (`DEFAULT_RANGE`, asserted in a test because it is a product decision a later tidy
could undo). A month is four or five nights, which reads as a run of form — the question somebody opens
their own profile to ask. Every longer view is one tap away, and the table folds at eight rows for the
same reason `PlayerTimeline` folds at three: on a phone an unfolded season is taller than the rest of
the profile put together.

**Windows are anchored to today, not to the player's last night.** Anchoring to their last night would
guarantee the default view was never empty, at the cost of "1M" meaning a different month for every
player. A window that means what it says can be empty, and an empty one is itself the answer to "how has
their month been" — so the empty state says so and points at a longer range rather than looking broken.

**Three states that are not the happy one**, all of which the club will actually hit: a night played but
never graded is *absent* rather than shown as a zero, which would read as the worst evening of someone's
career; a single graded night draws one square and a summary reading "last 1 night" — the club's real
state the day this shipped was exactly one published night; and a player nobody has ever published a
mark for gets no card at all.

**In test mode the marks are computed locally** from the invented club, the same move `fetchValues`
makes and for the same reason: the sandbox exists to review features against a season of football, and
a panel that is permanently empty there cannot be reviewed at all. Live devices never take that path.

`testGrades.ts` does the same job for the *night page*, which had the worse version of this problem — no
Worker meant an empty marks panel and a write button that could only ever fail. It derives each night's
lines on demand, and the marks in them are the **real** ones from `nightGrades` rather than random
numbers: the form panel already computes marks that way in test mode, so rolling a different figure here
would put one number on the night page and another on the graph two taps away. Only the banter is
invented — there is no model to ask — drawn from four pools split by grade band, because a
"carried the whole team" line under a 3.5 reads as broken rather than as invented, and picked by a hash
of the two ids so a night reads the same every time it is opened.

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

Which tabs exist depends on whether admin is unlocked (§2.13): a normal user gets **Roster** and
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
   read — no Edit, no ✕, no + Add player, and no ratings or keep-apart lists (§2.13). Top-right
   shows a small `v<hash>` build marker (§6) so you can confirm a deploy actually landed after
   pushing. **Tapping any row opens that player's page** (§2.18) — badges, every night as a medal,
   the milestone ladder, shirts worn, teammates and shootouts — for everyone, not just the
   organiser, since everything on it is already public.
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
     them read-only (§2.7), with **🎯 On the line tonight** and the bounty (§2.19), tonight's
     milestones and duo records (§2.9, §2.10), the 8-minute
     match clock with **+30s** and **⛶ Pitch mode** (§2.8) and the **📋 match log** (§2.17). No
     tally to type in and no MVP picker: the night is filed when it ends (§2.7.1), and the MVP is
     asked for afterwards, on History (§2.12). Starting also publishes the fixture to the
     whole group (§2.14); ending it takes it back down.
     **← Back to teams** returns to the editable board above without losing anything, in case the
     teams need another look; **⏹️ End fixture** asks what to do with the result and then wipes the
     night, the same action
     as the board's 🆕 New Fixture.
3. **History** (`src/components/History.tsx`) — open to everyone: past nights (expandable to the
   team sheets and each team's wins) and a standings table of nights / wins / fixture wins /
   wins-per-night (a shootout counts as half) / MVPs (§2.12), with achievement badges beside each
   name and a key beneath (§2.15). Admin mode adds the **📊 Monthly recap** picker + share button
   (§2.11), the **vs rating** column, rating suggestions
   with Apply/Dismiss, ✏️/🗑️ on a past night, and the **🌟 MVP** pick for a night (§2.12) — which
   lives only here. The recap share ends with the **Team of the Month** card (§2.20). Empty until
   the first night is saved.
4. **🔴 Live** (`src/components/LiveFixtureView.tsx`) — only present while a fixture is on: tonight's
   three teams (read-only, no ratings) and the shared match clock, which **anyone** can start,
   pause, add 30 seconds to, or open in pitch mode — the same control the organiser has, since it is
   the same component (§2.8). See §2.14.
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
  `live` key alongside `roster` and `history` — see §2.14 for the design and why it's polled rather
  than pushed. Unlike the other two this one is *transient*: no version guard and no snapshot
  (there is nothing here worth recovering an hour later), a 12-hour KV TTL, and `POST` with a null
  fixture deletes the key rather than storing an empty one, so "is anything live" stays a question
  about existence. `isValidLive` in the Worker checks the clock's shape as strictly as the rest —
  a non-numeric `endsAt` would render as `NaN` on fifteen phones at once. `POST /live/clock` and
  `POST /live/log` are the two routes in this Worker with no password on them; see §2.14 and §2.17
  for the reasoning and the limits that make them safe — including `isLogStep`, which only lets the
  log move one match at a time so a stale phone can't erase somebody else's result.
- **Match-clock notifications (optional)**: `src/push.ts` + `worker/push.js` +
  `worker/clock-notifier.js`, a `ClockNotifier` Durable Object holding the subscriptions and one
  alarm — see §2.16. `public/sw.js` is the only service worker in the project and deliberately does
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

**Two test projects: `logic` and `dom`** (`vitest.workspace.ts`). The great majority are pure
functions over plain data and run in `node` with no DOM, because giving them one costs a jsdom per
file for nothing. The component half is **opted into by filename** — `*.dom.test.tsx` — which is
deliberately visible in a directory listing, since a component test is slower and more fragile than a
unit test and you should know which you are looking at before opening it.

That half exists because three bugs got past everything else by being *gestures*: a scroll lock that
could only be reasoned about, a drag that must not become a click, and the end-of-night dialog that
decides whether an evening's football is filed or thrown away. All three shipped on a promise, and
one of them — cards that stopped opening at all after pointer capture was added — was found by the
organiser on a phone rather than by anything here. `src/test-setup.ts` gives the DOM project three
things and nothing else: the extra matchers, a fake `localStorage` (this jsdom is built without the
storage feature, and the app reads it during render), and a **`fetch` that always rejects**, so no
component test can reach the live Worker — `REMOTE_URL` defaults to production, and a night page asks
for its recap on mount.

**There is no linter, and the tests still lean heavily on the pure logic.** CI
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
