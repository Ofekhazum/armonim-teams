// Generates the VAPID key pair the match-clock notifications are signed with
// (§2.17). Run it once, ever:
//
//   node worker/generate-vapid-keys.mjs
//
// It prints a private JWK. Store that as the Worker secret and nothing else has
// to be configured — the app fetches the matching public key from
// GET /push/key, so there is no key to paste into the source and no way for the
// two to drift apart:
//
//   cd worker && npx wrangler secret put VAPID_JWK      # paste the JSON
//   npx wrangler secret put VAPID_SUBJECT               # e.g. mailto:you@example.com
//
// Keep the private key out of the repo. Losing it is survivable — generate a
// new pair and every device simply re-subscribes the next time someone turns
// alerts on — so it is worth far less than the publish word.

const { privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const jwk = await crypto.subtle.exportKey('jwk', privateKey);

// Only the five fields the Worker imports; `key_ops`/`use` vary by runtime and
// an unexpected one makes importKey throw at exactly the wrong moment.
const { kty, crv, d, x, y } = jwk;

console.log('\nVAPID_JWK — paste this whole line into `wrangler secret put VAPID_JWK`:\n');
console.log(JSON.stringify({ kty, crv, d, x, y, ext: true }));
console.log('\nThe public half is derived from it and served at GET /push/key.\n');
