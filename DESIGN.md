# Armonim Teams — Weekly Football Team Builder

## 1. What the app does

A mobile-friendly web app for a weekly 3-team (black / white / blue), 5-a-side football night.
The organizer opens the app, ticks who's available today, adds any guests, and hits **Generate Teams**.
The app produces three balanced teams that respect goalkeeper needs, chemistry, and guest pairings,
lets the organizer tweak the result by drag-and-drop, and share it (e.g. paste into WhatsApp).

## 2. Core concepts & data model

### Player (persistent roster)
| Field | Type | Notes |
|---|---|---|
| id | string | |
| name | string | |
| rating | 1–5 | overall ability |
| playstyle | `defensive` \| `mixed` \| `attacking` | |
| isGuest | boolean | guests are one-off, invited by a member |
| invitedBy | playerId? | guests only — hard constraint: same team as inviter |
| notes | string? | optional |

Rating for guests defaults to **3 (unknown)** with an "unknown" flag — we don't know their ability,
so the balancer treats them as average but avoids stacking multiple unknowns on one team.

### Chemistry links
Stored as pairs: `{ playerA, playerB, weight }` where weight is `prefer-together` (positive)
— close friends who play better together. (Room later for `keep-apart` with negative weight if ever needed.)

### Session (one match night)
| Field | Notes |
|---|---|
| date | |
| availablePlayerIds | who's playing today |
| gkOnlyIds | **per-session** list — GK-only status changes week to week (injury etc.), so it's picked at session setup, not stored on the player |
| teams | the generated/edited assignment: black, white, blue |
| loans | when short-handed: which resting-team players fill in (see §4) |

Past sessions are kept as history — useful later for "who played with whom" stats and fairness of loans.

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
| Playstyle mix | medium | each team should have a spread of defensive/mixed/attacking rather than e.g. all-attackers |
| Chemistry | medium | bonus for each prefer-together pair on the same team |
| Unknown spread | medium | avoid two unknown-rating guests on the same team (unless glued to the same inviter) |
| Variety (later) | low | penalize repeating last week's exact teammates, so teams rotate over the season |

Weights live in a settings screen so you can tune them ("we care more about ratings than friendships").

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

The match-day screen shows the rotation: "Black vs White — **Yossi (Blue) joins White**", with a tap to swap the suggested loaner.

## 5. Screens

1. **Roster** — list of permanent players; add/edit name, rating, playstyle; manage chemistry links (from a player's card: "plays well with…").
2. **New Session** (the main flow):
   - Step 1: tick available players; "+ Add guest" (name + who invited them + optional rating guess).
   - Step 2: mark today's GK-only players.
   - Step 3: **Generate** → three colored team cards (black/white/blue) with per-team total & average rating, GK badge, playstyle icons. Drag-and-drop players between teams; the balance numbers update live and warnings appear if a hard constraint breaks (e.g. team with no GK). "Re-roll" cycles the alternative results.
   - Step 4: **Share** — copies a clean text block (team lists + loan plan) for WhatsApp.
3. **Match Day** (only when 13–14 players) — rotation view with loan suggestions.
4. **History** — past sessions, read-only.
5. **Settings** — balancer weights, minimum player count.

## 6. Tech stack

**Recommendation: a local-first single-page app, no backend.**

- **Vite + React + TypeScript** — fast to build, easy to iterate.
- **Tailwind CSS** — quick mobile-first styling; team colors are literally the theme.
- **State/persistence: localStorage** (roster, sessions, settings) with **JSON export/import** so the organizer's phone/laptop owns the data and can back it up or move it.
- **dnd-kit** for drag-and-drop team editing.
- Balancing algorithm is plain TypeScript, runs client-side — no server needed at 15 players.
- Deploy as static files (GitHub Pages / Netlify / Vercel) — free, zero maintenance.

Why no backend: one organizer runs the night; a shared database adds accounts, hosting and sync
complexity for little gain. If later you want players to self-register availability, the clean upgrade
path is Supabase (auth + Postgres) behind the same UI — the data model above maps directly to tables.

## 7. Build phases

1. **MVP** — roster CRUD, availability picking, GK marking, balancer with hard constraints + rating balance, team cards, WhatsApp share text, localStorage.
2. **Quality** — chemistry links, playstyle mix, guests glued to inviters, drag-and-drop editing with live balance feedback, alternative results.
3. **Short-handed logic** — 13/14 player team sizing, loan rotation screen.
4. **Polish** — history, settings for weights, variety-across-weeks scoring, JSON export/import.
