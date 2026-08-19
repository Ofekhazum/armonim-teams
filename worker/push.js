// Web Push: VAPID authentication (RFC 8292) and payload encryption (RFC 8291
// over the aes128gcm content encoding of RFC 8188).
//
// Written out by hand rather than pulled from npm because the Worker runtime
// has no Node built-ins and the usual library (`web-push`) is Node-only. Every
// primitive needed is in Web Crypto, which Workers do have: ECDH P-256 for the
// shared secret, HMAC-SHA256 for HKDF, AES-128-GCM for the payload, ECDSA
// P-256 for the VAPID signature.
//
// This is the one file in the project where a subtle mistake is invisible —
// a wrong byte produces a push service that returns 201 Created and a phone
// that never buzzes, with nothing to debug. So it is checked against the
// `web-push` library's own output byte-for-byte (see push.test.js), which is
// the closest thing to a conformance test available without a real device.

const enc = (s) => new TextEncoder().encode(s);

export const bytesToB64u = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const b64uToBytes = (s) => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// HKDF with a single output block, which is all any of the derivations here
// need (the longest is 32 bytes). Extract, then one Expand round with the
// mandatory 0x01 counter byte.
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

// The 65-byte uncompressed point a push service expects as the VAPID key, and
// which the browser wants as `applicationServerKey` when subscribing.
export function publicKeyBytes(jwk) {
  return concat(new Uint8Array([4]), b64uToBytes(jwk.x), b64uToBytes(jwk.y));
}

// Exported with the ephemeral key and salt injectable purely so the test can
// pin them and compare against a known-good implementation; production always
// takes the random path.
export async function encryptPayload(p256dh, auth, plaintext, fixed) {
  const uaPublic = b64uToBytes(p256dh); // the subscriber's public key, 65 bytes
  const authSecret = b64uToBytes(auth); // 16 bytes, shared out-of-band by the browser

  const asKeys =
    fixed?.keyPair ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256),
  );

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 §3.3 — the auth secret salts the first extraction, and the two
  // public keys are bound into the info so a key can't be replayed elsewhere.
  const keyInfo = concat(enc('WebPush: info'), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const cek = await hkdf(
    salt,
    ikm,
    concat(enc('Content-Encoding: aes128gcm'), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    concat(enc('Content-Encoding: nonce'), new Uint8Array([0])),
    12,
  );

  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 is the last-record delimiter of RFC 8188; everything here fits in one
  // record, so there is never a 0x01 continuation.
  const padded = concat(enc(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded),
  );

  // aes128gcm header: salt(16) | record size(4) | key id length(1) | key id
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// RFC 8292. `sub` identifies whoever operates this server, so a push provider
// has someone to contact if it misbehaves; a mailto: is what they expect.
export async function vapidAuthorization(endpoint, jwk, subject, now = Date.now()) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = bytesToB64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(
    enc(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToB64u(signature)}, k=${bytesToB64u(publicKeyBytes(jwk))}`;
}

// A push service that has never heard of this subscription, or has seen the
// browser drop it, answers 404 or 410. Those are the only statuses worth acting
// on — everything else is transient and the next match will try again.
export const isGone = (status) => status === 404 || status === 410;

export async function sendPush(subscription, payload, jwk, subject) {
  const body = await encryptPayload(subscription.keys.p256dh, subscription.keys.auth, payload);
  const authorization = await vapidAuthorization(subscription.endpoint, jwk, subject);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // "one minute left" is worthless five minutes later — better that a
      // phone which was offline gets nothing than gets it after the final
      // whistle. Deliberately far shorter than the usual 4-week default.
      TTL: '120',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}
