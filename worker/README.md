# Shared roster backend (Cloudflare Worker)

This is a tiny free Worker that stores the team roster online so you can update
it for **everyone** from inside the app — no code changes, no redeploy. Your
secret "publish word" is checked here on the server, so it's a real password:
it never ships inside the app's public JavaScript.

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

- Open the app → **Roster** tab → edit players however you like → tap
  **📢 Publish** → type your secret word.
- Everyone else gets the new roster the next time they open the app.

## Changing the password later

```sh
cd worker
npx wrangler secret put PUBLISH_SECRET
```

## Notes

- **Read** (`GET /roster`) is public — anyone with the app can load the roster.
- **Write** (`POST /roster`) requires the secret word, checked server-side.
- Free tier allows 100,000 requests/day — vastly more than a friends' team needs.
- If `REMOTE_URL` is left empty, the app just works offline from its built-in
  roster, exactly like before.
