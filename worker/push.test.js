import { describe, expect, it } from 'vitest';
import {
  b64uToBytes,
  bytesToB64u,
  encryptPayload,
  isGone,
  keyIsConsistent,
  publicKeyBytes,
  vapidAuthorization,
} from './push.js';

// A wrong byte anywhere in push.js produces a push service that cheerfully
// returns 201 Created and a phone that never buzzes — nothing throws, nothing
// logs, and there is no way to tell from either end. So the expected ciphertext
// below is deliberately *not* something this implementation produced and
// blessed: it came out of `http_ece`, the library `web-push` itself uses, from
// these same pinned keys and salt, and the two agreed byte-for-byte. If this
// test ever fails, the suspect is push.js, not the vector.
const VECTOR = {
  p256dh:
    'BDgBTGA8idqXEkJjIO5TqUx5Xdo7kLtbB5Guj120hrfbJeOqNo7eN7llZvZlkPieoqyDS81hVBuQc4y8gpRwbJY',
  auth: 'MDEyMzQ1Njc4OWFiY2RlZg',
  senderJwk: {
    kty: 'EC',
    crv: 'P-256',
    d: 'u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7s',
    x: 'dgoGyFjcF-XFNt6BH3EHv6JNT-451kr9kVjuuqs88ls',
    y: 'xO3PNMLAjRaw3NuIHYRwFLhAKusNb8UweMqU884c5M4',
    ext: true,
  },
  salt: 'ABEiM0RVZneImaq7zN3u_w',
  plaintext: 'One minute left',
  expected:
    'ABEiM0RVZneImaq7zN3u_wAAEABBBHYKBshY3BflxTbegR9xB7-iTU_uOdZK_ZFY7rqrPPJbxO3PNMLAjRaw3NuIHYRwFLhAKusNb8UweMqU884c5M5Q_fEWiv_wwiZs0nfYmn3bYPQ_XQV3nJBXG6ZcYnANSQ',
};

async function senderKeyPair() {
  const jwk = VECTOR.senderJwk;
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    ),
  };
}

const claimsOf = (header) =>
  JSON.parse(new TextDecoder().decode(b64uToBytes(header.match(/t=([^,]+)/)[1].split('.')[1])));

describe('base64url', () => {
  it('round-trips byte lengths that need every amount of padding', () => {
    for (const len of [1, 2, 3, 16, 32, 65]) {
      const bytes = new Uint8Array(len).map((_, i) => (i * 251) % 256);
      expect(b64uToBytes(bytesToB64u(bytes))).toEqual(bytes);
    }
  });

  it('emits nothing that would need escaping in a URL or a header', () => {
    expect(bytesToB64u(new Uint8Array([251, 255, 254, 253]))).not.toMatch(/[+/=]/);
  });
});

describe('encryptPayload', () => {
  it('matches the reference implementation byte-for-byte', async () => {
    const body = await encryptPayload(VECTOR.p256dh, VECTOR.auth, VECTOR.plaintext, {
      keyPair: await senderKeyPair(),
      salt: b64uToBytes(VECTOR.salt),
    });
    expect(bytesToB64u(body)).toBe(VECTOR.expected);
  });

  it('lays the aes128gcm header out the way RFC 8188 specifies', async () => {
    const body = await encryptPayload(VECTOR.p256dh, VECTOR.auth, 'x');
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096); // record size
    expect(body[20]).toBe(65); // key id length: an uncompressed P-256 point
    expect(body[21]).toBe(4); // ...which always begins with the 0x04 tag
  });

  it('uses a fresh salt and ephemeral key on every call', async () => {
    // reusing either against the same subscriber would leak the plaintext
    const a = await encryptPayload(VECTOR.p256dh, VECTOR.auth, 'same');
    const b = await encryptPayload(VECTOR.p256dh, VECTOR.auth, 'same');
    expect(bytesToB64u(a.slice(0, 16))).not.toBe(bytesToB64u(b.slice(0, 16)));
    expect(bytesToB64u(a.slice(21, 86))).not.toBe(bytesToB64u(b.slice(21, 86)));
    expect(bytesToB64u(a)).not.toBe(bytesToB64u(b));
  });

  it('adds exactly the delimiter and the GCM tag to the plaintext', async () => {
    const short = await encryptPayload(VECTOR.p256dh, VECTOR.auth, 'a');
    const long = await encryptPayload(VECTOR.p256dh, VECTOR.auth, 'a'.repeat(50));
    // header(86) + plaintext(1) + record delimiter(1) + GCM tag(16)
    expect(short.length).toBe(86 + 1 + 1 + 16);
    expect(long.length - short.length).toBe(49);
  });
});

describe('vapidAuthorization', () => {
  const jwk = VECTOR.senderJwk;
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

  it('addresses the token to the push service origin, never the full endpoint', async () => {
    // sending the endpoint itself would hand every push service a token
    // identifying the exact subscriber it was minted for
    const claims = claimsOf(await vapidAuthorization(endpoint, jwk, 'mailto:a@b.c'));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:a@b.c');
  });

  it('expires inside the 24 hours push services allow', async () => {
    const now = 1_700_000_000_000;
    const claims = claimsOf(await vapidAuthorization(endpoint, jwk, 'mailto:a@b.c', now));
    expect(claims.exp).toBeGreaterThan(now / 1000);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('declares ES256 and ships the public key alongside the token', async () => {
    const header = await vapidAuthorization(endpoint, jwk, 'mailto:a@b.c');
    const jose = JSON.parse(
      new TextDecoder().decode(b64uToBytes(header.match(/t=([^,]+)/)[1].split('.')[0])),
    );
    expect(jose).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(header).toContain(`k=${bytesToB64u(publicKeyBytes(jwk))}`);
  });

  it('produces a signature that verifies against the public key', async () => {
    // exactly the check a push service runs before accepting the push
    const header = await vapidAuthorization(endpoint, jwk, 'mailto:a@b.c');
    const [h, c, s] = header.match(/t=([^,]+)/)[1].split('.');
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    expect(
      await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        b64uToBytes(s),
        new TextEncoder().encode(`${h}.${c}`),
      ),
    ).toBe(true);
  });
});

describe('keyIsConsistent', () => {
  // Exists to tell a corrupt secret apart from a rejected subject: Apple says
  // "BadJwtToken" to both. It is only worth having if it can actually fail.
  it('accepts a key whose halves belong to each other', async () => {
    expect(await keyIsConsistent(VECTOR.senderJwk)).toBe(true);
  });

  it('rejects a key whose public half came from somewhere else', async () => {
    const other = await crypto.subtle.exportKey(
      'jwk',
      (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']))
        .publicKey,
    );
    const frankenkey = { ...VECTOR.senderJwk, x: other.x, y: other.y };
    expect(await keyIsConsistent(frankenkey)).toBe(false);
  });

  it('rejects a secret that is not a key at all rather than throwing', async () => {
    expect(await keyIsConsistent({ kty: 'EC', crv: 'P-256' })).toBe(false);
  });
});

describe('isGone', () => {
  it('treats only 404 and 410 as a subscription that is really gone', () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    // a 5xx or a rate-limit is the push service having a bad day, not the
    // device disappearing — pruning on those loses real subscribers
    expect(isGone(500)).toBe(false);
    expect(isGone(429)).toBe(false);
    expect(isGone(201)).toBe(false);
  });
});
