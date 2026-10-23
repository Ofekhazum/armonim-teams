import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './roster-worker.js';
import {
  RecapVoice,
  awaitJob,
  canVoice,
  hebrewNumber,
  parseEvents,
  speakable,
  startJob,
  voiceHash,
  voiceKey,
} from './recap-voice.js';

// The voiced recap (§2.69). Two kinds of test, for the two ways this goes
// wrong: the voice saying something it should not — which is what the
// provenance and route tests are for — and the voice saying the right thing
// badly, which is what speakable() is for.

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- speakable() -------------------------------------------------------------

describe('hebrewNumber', () => {
  it('counts in both genders', () => {
    expect(hebrewNumber(3)).toBe('שלוש');
    expect(hebrewNumber(3, true)).toBe('שלושה');
    expect(hebrewNumber(13, true)).toBe('שלושה עשר');
    expect(hebrewNumber(13)).toBe('שלוש עשרה');
    expect(hebrewNumber(22, true)).toBe('עשרים ושניים');
    expect(hebrewNumber(0)).toBe('אפס');
  });

  it('puts the ו before the last part, the way it is said', () => {
    expect(hebrewNumber(115, true)).toBe('מאה וחמישה עשר');
    expect(hebrewNumber(120)).toBe('מאה ועשרים');
    expect(hebrewNumber(123, true)).toBe('מאה עשרים ושלושה');
    expect(hebrewNumber(2026)).toBe('אלפיים עשרים ושש');
  });

  it('leaves what it cannot say to the caller', () => {
    expect(hebrewNumber(10000)).toBeNull();
    expect(hebrewNumber(-1)).toBeNull();
    expect(hebrewNumber(1.5)).toBeNull();
  });
});

describe('speakable', () => {
  // Every case here is a construction from a real stored recap.
  it.each([
    ['השחורים אספו 5 נקודות ב-10 משחקים', 'השחורים אספו חמש נקודות בעשרה משחקים.'],
    ['רצף שיא של 5 ניצחונות', 'רצף שיא של חמישה ניצחונות.'],
    ['עם 2 נקודות בלבד', 'עם שתי נקודות בלבד.'],
    ['שניצח 3 מ-4 המחזורים שלו', 'שניצח שלוש מארבעת המחזורים שלו.'],
    ['יוני לקח 4 נקודות לעומת 0 של ירין', 'יוני לקח ארבע נקודות לעומת אפס של ירין.'],
    ['חסרים לו 5 ניצחונות ל-50', 'חסרים לו חמישה ניצחונות לחמישים.'],
    ['הם נפגשו 4 פעמים', 'הם נפגשו ארבע פעמים.'],
  ])('%s', (text, spoken) => {
    expect(speakable(text)).toBe(spoken);
  });

  it('takes the noun’s gender only from a noun, not from a word that starts with ה', () => {
    // הפסדים is not "the פסדים": a definite form here would be wrong Hebrew
    expect(speakable('3 הפסדים')).toBe('שלושה הפסדים.');
    expect(speakable('3 המחזורים')).toBe('שלושת המחזורים.');
  });

  it('reads scores, halves, percentages and ordinals', () => {
    expect(speakable('ניצח 4-0')).toBe('ניצח ארבע אפס.');
    expect(speakable('5.5 נקודות')).toBe('חמש וחצי נקודות.');
    expect(speakable('61% מהמשחקים')).toBe('שישים ואחד אחוז מהמשחקים.');
    expect(speakable('המחזור ה-10')).toBe('המחזור העשירי.');
    expect(speakable('הניצחון ה-50')).toBe('הניצחון החמישים.');
    expect(speakable('1,250 שערים')).toBe('אלף מאתיים וחמישים שערים.');
  });

  it('glues prefix letters back on, and only prefix letters', () => {
    expect(speakable('דור, יוני ו-אריאל')).toBe('דור, יוני ואריאל.');
    expect(speakable('תודה ל-יועד')).toBe('תודה ליועד.');
    // short words, not prefixes — joined they would be nonsense
    expect(speakable('כל-כך טוב')).toBe('כל כך טוב.');
    expect(speakable('של-50')).toBe('של חמישים.');
    expect(speakable('דו-קרב פנדלים')).toBe('דו קרב פנדלים.');
  });

  it('drops what cannot be said: emoji, markdown, direction marks', () => {
    expect(speakable('📻 ארבל זעזוע מדווח מהמגרש')).toBe('ארבל זעזוע מדווח מהמגרש.');
    expect(speakable('**מצטיין** 🌟 שגב')).toBe('מצטיין שגב.');
    expect(speakable('# כותרת\n- שורה')).toBe('כותרת.\nשורה.');
    expect(speakable('שגב‏ 🇮🇱 👍🏽')).toBe('שגב.');
  });

  it('keeps an acronym and drops a quotation', () => {
    expect(speakable('לז\'ורי של פיפ"א')).toBe('לז\'ורי של פיפ"א.');
    expect(speakable('אמר "שלום" לכולם')).toBe('אמר שלום לכולם.');
  });

  it('keeps paragraphs apart and gives every line an ending', () => {
    // The masthead has no full stop; without one it runs straight into the
    // first sentence of the report.
    const text = '📻 ארבל מדווח\n\nערב חריג!\nשורה שנייה';
    expect(speakable(text)).toBe('ארבל מדווח.\nערב חריג!\nשורה שנייה.');
  });

  it('never leaves a digit in a recap-shaped text', () => {
    const recap = [
      '📻 נחמן גולף מדווח מהמגרש',
      'הכחולים לקחו 10.5 נקודות מתוך 13 משחקים וריצה של 9 ניצחונות.',
      'הדרבי בין הלחמי ל-ירין הגיע אחרי 16 מפגשים, וירין לקח 3-1.',
      'טאקו חזר אחרי 6 מחזורים, ו-חנש כבר 8 מחזורים בלי ניצחון.',
    ].join('\n\n');
    expect(speakable(recap)).not.toMatch(/\d/);
  });
});

// --- Provenance ---------------------------------------------------------------

describe('canVoice', () => {
  it('voices what Gemini wrote, and what was stored before anyone asked', () => {
    expect(canVoice({ text: 'דוח', source: 'gemini' })).toBe(true);
    // written by the Worker as it was before §2.69: every write since has a source
    expect(canVoice({ text: 'דוח' })).toBe(true);
  });

  it('never voices text that is not a draft the reporter wrote', () => {
    expect(canVoice({ text: 'כל מה שבא לי', source: 'edited' })).toBe(false);
    expect(canVoice(null)).toBe(false);
    expect(canVoice({ text: '', source: 'gemini' })).toBe(false);
  });
});

// --- The Space client -----------------------------------------------------------

const SPACE = 'https://club-voice.hf.space';
const spaceEnv = (over = {}) => ({
  HF_SPACE_URL: SPACE,
  HF_TOKEN: 'hf_test',
  VOICE_SECRET: 'voice-secret',
  ...over,
});

const sse = (...events) =>
  events.map(([event, data]) => `event: ${event}\ndata: ${data}`).join('\n\n') + '\n\n';

describe('parseEvents', () => {
  it('reads Gradio’s stream, heartbeats and all', () => {
    const body = sse(['heartbeat', 'null'], ['complete', '[{"url":"u"}]']);
    expect(parseEvents(body)).toEqual([
      { event: 'heartbeat', data: 'null' },
      { event: 'complete', data: '[{"url":"u"}]' },
    ]);
  });
});

describe('startJob', () => {
  it('sends the words and the secret, with the token, and nothing else', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return Response.json({ event_id: 'e1' });
    });
    expect(await startJob(spaceEnv(), 'שלום.', { deadline: Date.now() + 60_000 })).toBe('e1');
    expect(calls[0].url).toBe(`${SPACE}/gradio_api/call/synthesize`);
    expect(calls[0].init.headers.Authorization).toBe('Bearer hf_test');
    expect(JSON.parse(calls[0].init.body)).toEqual({ data: ['שלום.', 'voice-secret'] });
  });

  it('keeps knocking while the Space wakes up', async () => {
    // A sleeping Space answers with a holding page, then a 503, for minutes.
    const answers = [
      new Response('<html>sleeping</html>', { status: 200 }),
      new Response('', { status: 503 }),
      Response.json({ event_id: 'e2' }),
    ];
    vi.stubGlobal('fetch', async () => answers.shift());
    let waited = 0;
    const id = await startJob(spaceEnv(), 'x', {
      deadline: Date.now() + 10 * 60_000,
      wait: async () => void waited++,
    });
    expect(id).toBe('e2');
    expect(waited).toBe(2);
  });

  it('stops at the deadline rather than knocking forever', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    let t = 0;
    await expect(
      startJob(spaceEnv(), 'x', { deadline: 60_000, now: () => t, wait: async (ms) => void (t += ms) }),
    ).rejects.toThrow(/did not wake up/);
  });

  it('stays inside the free plan’s 50 requests however long the deadline', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('', { status: 503 });
    });
    await expect(
      startJob(spaceEnv(), 'x', { deadline: Infinity, wait: async () => {} }),
    ).rejects.toThrow(/did not wake up/);
    // and two more after it: the stream and the file
    expect(calls + 2).toBeLessThanOrEqual(50);
  });

  it('gives up at once on a refused token — retrying that only burns the clock', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('', { status: 401 });
    });
    await expect(startJob(spaceEnv(), 'x', { deadline: Date.now() + 60_000 })).rejects.toThrow(
      /refused the token/,
    );
    expect(calls).toBe(1);
  });
});

describe('awaitJob', () => {
  it('returns the file the job made', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(sse(['heartbeat', 'null'], ['complete', `[{"url":"${SPACE}/gradio_api/file=/tmp/r.mp3"}]`])),
    );
    expect(await awaitJob(spaceEnv(), 'e1', { deadline: Date.now() + 60_000 })).toBe(
      `${SPACE}/gradio_api/file=/tmp/r.mp3`,
    );
  });

  it('carries the Space’s own reason when it refuses', async () => {
    // verbatim from Gradio 6.30, called with the wrong secret
    vi.stubGlobal('fetch', async () =>
      new Response(sse(['error', '{"error": "forbidden", "duration": 10, "visible": true, "title": "Error"}'])),
    );
    await expect(awaitJob(spaceEnv(), 'e1', { deadline: Date.now() + 60_000 })).rejects.toThrow(
      'space: forbidden',
    );
  });
});

// --- The Durable Object ---------------------------------------------------------

function fakeState() {
  const map = new Map();
  let alarm = null;
  return {
    alarmAt: () => alarm,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      delete: async (k) => void map.delete(k),
      setAlarm: async (t) => void (alarm = t),
    },
  };
}

function fakeKv() {
  const store = new Map();
  const meta = new Map();
  return {
    store,
    meta,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => {
      store.set(k, v);
      if (opts?.metadata) meta.set(k, opts.metadata);
    },
    delete: async (k) => {
      store.delete(k);
      meta.delete(k);
    },
    getWithMetadata: async (k) => ({ value: store.get(k) ?? null, metadata: meta.get(k) ?? null }),
  };
}

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]).buffer;

// The Space, end to end: queue, stream, file.
const spaceAnswers = () =>
  vi.stubGlobal('fetch', async (url, init) => {
    if (init?.method === 'POST') return Response.json({ event_id: 'e1' });
    if (String(url).includes('/gradio_api/call/')) {
      return new Response(sse(['complete', `[{"url":"${SPACE}/gradio_api/file=/tmp/r.mp3"}]`]));
    }
    return new Response(MP3);
  });

const startJobOn = (voice, body) =>
  voice.fetch(new Request('https://voice/start', { method: 'POST', body: JSON.stringify(body) }));

describe('RecapVoice', () => {
  it('starts on an alarm and files the audio under the words it read', async () => {
    const state = fakeState();
    const env = { ...spaceEnv(), ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    const started = await (await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' })).json();
    expect(started.status).toBe('working');
    expect(state.alarmAt()).not.toBeNull();

    spaceAnswers();
    await voice.alarm();
    expect(new Uint8Array(env.ROSTER_KV.store.get(voiceKey('f1')))).toEqual(new Uint8Array(MP3));
    expect(env.ROSTER_KV.meta.get(voiceKey('f1')).hash).toBe('h1');
    const status = await (await voice.fetch(new Request('https://voice/status'))).json();
    expect(status.status).toBe('ready');
  });

  it('never runs two at once for the same night', async () => {
    const state = fakeState();
    const voice = new RecapVoice(state, { ...spaceEnv(), ROSTER_KV: fakeKv() });
    const first = await (await startJobOn(voice, { fixtureId: 'f1', text: 'א.', hash: 'h1' })).json();
    const second = await (await startJobOn(voice, { fixtureId: 'f1', text: 'ב.', hash: 'h2' })).json();
    expect(second).toEqual(first);
  });

  it('records a failure instead of throwing — a retried alarm is GPU time spent again', async () => {
    const state = fakeState();
    const env = { ...spaceEnv(), ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(voice.alarm()).resolves.toBeUndefined();
    const status = await (await voice.fetch(new Request('https://voice/status'))).json();
    expect(status).toMatchObject({ status: 'failed', error: expect.stringMatching(/refused the token/) });
    expect(env.ROSTER_KV.store.has(voiceKey('f1'))).toBe(false);
  });
});

// --- The routes -------------------------------------------------------------------

const WORD = 'club-word';

function routeEnv({ configured = true } = {}) {
  const kv = fakeKv();
  const voices = new Map();
  const limited = [];
  const env = {
    PUBLISH_SECRET: WORD,
    GEMINI_KEY: 'k',
    ROSTER_KV: kv,
    RATE_LIMITER: {
      idFromName: (name) => name,
      get: (name) => ({
        fetch: async (url) => {
          if (String(url).includes('/attempt')) limited.push(name);
          return Response.json({ blocked: false });
        },
      }),
    },
    RECAP_VOICE: {
      idFromName: (name) => name,
      get: (name) => {
        if (!voices.has(name)) voices.set(name, { state: fakeState() });
        const entry = voices.get(name);
        entry.instance ??= new RecapVoice(entry.state, env);
        return { fetch: (url, init) => entry.instance.fetch(new Request(url, init)) };
      },
    },
    ...(configured ? spaceEnv() : {}),
  };
  return { env, kv, voices, limited };
}

const call = (env, path, body) =>
  worker.fetch(
    new Request(`https://w${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );

const storeRecap = (kv, fixtureId, stored) => kv.put(`recap:${fixtureId}`, JSON.stringify(stored));

const FACTS = {
  date: '2026-10-20',
  matches: 12,
  penalties: 1,
  leadChanges: 2,
  chaos: 40,
  flavour: 'tug-of-war',
  winners: ['Blue'],
  mvp: 'ניב',
  teams: [
    { team: 'Black', points: 4, played: 8, longestRun: 2, players: ['אופק'] },
    { team: 'White', points: 3, played: 8, longestRun: 1, players: ['ירין'] },
    { team: 'Blue', points: 5, played: 8, longestRun: 3, players: ['ניב'] },
  ],
  players: [{ name: 'ניב', team: 'Blue', played: 8, won: 5 }],
  moments: [],
  milestones: [],
  duos: [],
};

describe('POST /recap — where a stored recap came from', () => {
  const geminiWrites = (text) =>
    vi.stubGlobal('fetch', async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: `<report>${text}</report>` }] } }] }),
    );

  it('marks a published draft as the reporter’s, word for word', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    const draft = await (await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS })).json();
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: draft.text });
    expect(JSON.parse(kv.store.get('recap:f1')).source).toBe('gemini');
  });

  it('marks anything else as edited — stored and read, never spoken', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS });
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: 'משהו שכתבתי בעצמי' });
    expect(JSON.parse(kv.store.get('recap:f1')).source).toBe('edited');
  });

  it('does not let one night’s draft vouch for another', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    const draft = await (await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS })).json();
    await call(env, '/recap', { secret: WORD, fixtureId: 'f2', text: draft.text });
    expect(JSON.parse(kv.store.get('recap:f2')).source).toBe('edited');
  });

  it('takes the voiced copy with it when a recap is deleted', async () => {
    const { env, kv } = routeEnv();
    await kv.put(voiceKey('f1'), MP3, { metadata: { hash: 'h' } });
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: null });
    expect(kv.store.has(voiceKey('f1'))).toBe(false);
  });
});

describe('/recap-audio', () => {
  it('will not speak a recap somebody wrote by hand', async () => {
    const { env, kv, voices } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'כל מה שבא לי', at: 1, source: 'edited' });
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    expect(res.status).toBe(409);
    expect(voices.size).toBe(0);
  });

  it('takes a fixture id and nothing else — there are no words to send it', async () => {
    const { env, kv, voices } = routeEnv();
    await storeRecap(kv, 'f1', { text: '📻 ארבל מדווח\n\nהכחולים לקחו 5 נקודות.', at: 1, source: 'gemini' });
    const res = await call(env, '/recap-audio', {
      secret: WORD,
      fixtureId: 'f1',
      text: 'משהו אחר לגמרי',
    });
    expect((await res.json()).status).toBe('working');
    const job = await voices.get('f1').state.storage.get('text');
    expect(job).toBe('ארבל מדווח.\nהכחולים לקחו חמש נקודות.');
  });

  it('wants the word', async () => {
    const { env, kv } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1, source: 'gemini' });
    expect((await call(env, '/recap-audio', { secret: 'nope', fixtureId: 'f1' })).status).toBe(401);
  });

  it('says so when it is not set up, and the public status hides the button', async () => {
    const { env, kv } = routeEnv({ configured: false });
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1, source: 'gemini' });
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'not-configured' });
    expect(await (await call(env, '/recap-audio?id=f1')).json()).toMatchObject({ configured: false });
  });

  it('counts a job that will run, not a question about one already running', async () => {
    const { env, kv, limited } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1 });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    expect(limited.filter((n) => n.startsWith('voice:'))).toHaveLength(1);
  });

  it('hands over the audio only while it still matches the recap on the page', async () => {
    const { env, kv } = routeEnv();
    const text = 'הכחולים לקחו את הערב.';
    await storeRecap(kv, 'f1', { text, at: 1, source: 'gemini' });
    await kv.put(voiceKey('f1'), MP3, { metadata: { hash: await voiceHash(speakable(text)) } });

    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', file: true });
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(MP3));

    // re-rolled since: that audio is a report nobody can read any more
    await storeRecap(kv, 'f1', { text: 'דוח אחר לגמרי.', at: 2, source: 'gemini' });
    const stale = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', file: true });
    expect(stale.status).toBe(404);
  });

  it('answers the public status with a status, never the audio or the words', async () => {
    const { env, kv } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1, source: 'gemini' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    const res = await call(env, '/recap-audio?id=f1');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body).toMatchObject({ configured: true, voiceable: true, status: 'working' });
    expect(JSON.stringify(body)).not.toContain('דוח');
  });

  it('runs end to end: press, wait, fetch the file', async () => {
    const { env, kv, voices } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'הכחולים לקחו את הערב.', at: 1, source: 'gemini' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    spaceAnswers();
    await voices.get('f1').instance.alarm();
    expect(await (await call(env, '/recap-audio?id=f1')).json()).toMatchObject({ status: 'ready' });
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', file: true });
    expect(res.status).toBe(200);
  });
});
