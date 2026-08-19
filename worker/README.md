# Shared roster + results backend (Cloudflare Worker)

This is a tiny free Worker that stores the team roster **and the results history**
online so both update for **everyone** from inside the app — no code changes, no
redeploy. Your secret "publish word" is checked here on the server, so it's a
real password: it never ships inside the app's public JavaScript.

The same Worker also powers **live match-day rooms** (`match-room.js`) — real-time
team-picking via a Durable Object, one per room. `npx wrangler deploy` sets this
up automatically (see the `[[durable_objects.bindings]]` / `[[migrations]]`
entries in `wrangler.toml`); there's no separate setup step for it beyond the
deploy below.

You only do this setup **once**.

## One-time setup (~10 minutes)

1. **Make a free Cloudflare account:** https://dash.cloudflare.com/sign-up

2. **Install the Cloudflare CLI and log in** (needs Node, which you already have):

   ```sh
   cd worker
   npx wrangler login
   ```

3. **Create the storage (KV namespace):**

   ```sh
   npx wrangler kv namespace create ROSTER_KV
   ```

   It prints an `id = "..."`. Copy that id into `wrangler.toml`, replacing
   `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.

4. **Set your secret publish word** (pick anything only you know):

   ```sh
   npx wrangler secret put PUBLISH_SECRET
   ```

   It asks you to type the word — that's the password the app will ask for.

5. **Deploy the worker:**

   ```sh
   npx wrangler deploy
   ```

   It prints a URL like `https://armonim-roster.<your-subdomain>.workers.dev`.

6. **Tell the app about it:** open [`src/remote.ts`](../src/remote.ts) and set

   ```ts
   export const REMOTE_URL = 'https://armonim-roster.<your-subdomain>.workers.dev';
   ```

   Commit + push. GitHub Actions redeploys the site (this is the **last** time
   you touch the code for a roster change).

## Day-to-day use

- **Roster**: open the app → **Roster** tab → edit players however you like → tap
  **📢 Publish** → type your secret word. Everyone else gets the new roster the
  next time they open the app.
- **Results**: unlock admin (🔒 **Admin** on the Roster tab) once, then record a
  night's win tally on Match Day and tap **💾 Save to history** — this shares
  immediately, no separate publish step. Editing or deleting a past night
  (History tab) shares the same way. Reading history — the standings and past
  nights — needs no password, same as reading the roster.

## Changing the password later

```sh
cd worker
npx wrangler secret put PUBLISH_SECRET
```

## Working on it locally

**Never point a dev run or a test at the deployed worker.** That URL is the
club's real roster and real season; anything that clicks Save or Publish while
aimed at it is editing production, and this project has already lost a season of
results that way. Run a throwaway copy instead — its own storage, its own
password, nothing shared:

```sh
cd worker
echo 'PUBLISH_SECRET = "local_test_word"' > .dev.vars   # gitignored
npx wrangler dev --local                                # http://localhost:8787
```

Then point the app at it, from the repo root:

```sh
echo 'VITE_REMOTE_URL=http://localhost:8787' > .env.local   # gitignored
npm run dev
```

Delete `.env.local` to go back to the deployed worker.

## Deploy order

`npx wrangler deploy` **before** pushing a site change that depends on it. The
app degrades sanely against an older worker, with one exception: `POST
/roster/full` is how a device recovers the private fields the public read no
longer carries, so an admin device that has never held them can't get them from
a worker that doesn't serve that route. The app notices and asks before letting
you publish over them, but deploying the worker first avoids the question.

## Notes

- **Read** (`GET /roster`, `GET /history`, `GET /live`) is public — anyone with the app can load
  the roster, the results, and whatever fixture is being played right now.
- **`/live` is the fixture in progress**, written when the organiser taps *Start fixture* and
  deleted when they end it. One key, so exactly one night can ever be live. It expires on its own
  after 12 hours in case a tab gets closed mid-match, and it carries names and shirts only — no
  ratings — because everyone in the group reads it.
- **The public roster read is not the whole roster.** `avoid` (the keep-apart
  list), `chemistry` and `aliases` are stripped from `GET /roster`, because that
  endpoint needs no password and this worker's URL ships inside the app's public
  JavaScript — anything it returns is readable by anyone who looks, not just by
  the club. The app already treated those as admin-only on screen; this makes the
  wire agree. They're still stored, and `POST /roster/full` returns them for the
  price of the secret word, so a new admin device can recover them.
- **Write** (`POST /roster`, `POST /history`) requires the secret word, checked
  server-side. Writes are a full replace — the app sends its whole local list
  each time — so each one carries the `baseVersion` it means to replace and is
  refused with `409` if the shared copy has moved on since that device last read
  it. That's what stops a stale or freshly-seeded device from silently wiping a
  season.
- **The copy a publish displaces is kept** under `roster:snapshot:<version>` /
  `history:snapshot:<version>` for 90 days, so a bad write is recoverable:

  ```sh
  npx wrangler kv key list --binding ROSTER_KV        # find the version
  npx wrangler kv key get --binding ROSTER_KV 'history:snapshot:1787151556621'
  ```

- **Wrong words are rate-limited** per IP (`rate-limit.js`): 10 failures in 10
  minutes and that IP gets `429` until the window rolls over. The counter is
  incremented and checked in a single Durable Object call, so a burst of
  simultaneous guesses can't all slip through between the check and the count.
  Correct words are refunded, so publishing as often as you like never locks you
  out.
- **Room upgrades are rate-limited too** — 120 per IP per 10 minutes. That route
  needs no password, and each distinct room id it's handed spins up another
  Durable Object.
- **Live rooms expire** after 12 hours with no activity, so a room you forget to
  close doesn't sit in storage forever.
- Free tier allows 100,000 requests/day — vastly more than a friends' team needs.
- If `REMOTE_URL` is left empty, the app just works offline from its built-in
  roster, exactly like before.
