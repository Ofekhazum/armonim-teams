import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { voiceCap } from './roster-worker.js';
import { stripPoints } from './vocalize.js';
import {
  RecapVoice,
  canVoice,
  collectJob,
  hebrewNumber,
  pointing,
  sha256Hex,
  speakable,
  spokenFor,
  startJob,
  voiceFor,
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

describe('speakable on pointed text (§2.71)', () => {
  it('reads a pointed report the way it reads a plain one', () => {
    const plain = '📻 ארבל מדווח\n\nהכחולים לקחו 5 נקודות ב-3 משחקים. ו-אריאל כבש 10 שערים!';
    const pointed =
      '📻 אַרְבֵּל מְדַוֵּוחַ\n\nהַכְּחוּלִּים לָקְחוּ 5 נְקוּדוֹת בְּ-3 מִשְׂחָקִים. וְ-אֲרִיאֵל כָּבַשׁ 10 שְׁעָרִים!';
    // the same words, with the same numbers spelled in the same gender
    expect(stripPoints(speakable(pointed))).toBe(speakable(plain).replace('ו-אריאל', 'ואריאל'));
  });

  it('takes the gender of a counted noun from the word whatever points it carries', () => {
    expect(stripPoints(speakable('הֵם שִׂחֲקוּ 3 מִשְׂחָקִים'))).toContain('שלושה משחקים');
    expect(stripPoints(speakable('הֵבִיאוּ 3 נְקוּדוֹת'))).toContain('שלוש נקודות');
  });

  it('keeps the points on the words', () => {
    expect(speakable('שֶׂגֶב כָּבַשׁ.')).toBe('שֶׂגֶב כָּבַשׁ.');
  });

  it('still joins a hyphenated word into two', () => {
    expect(stripPoints(speakable('דּוּ-קְרָב נִפְתַּח.'))).toBe('דו קרב נפתח.');
  });
});

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

// --- The voice server client ----------------------------------------------------

const VOICE = 'https://club--armonim-recap-voice-web.modal.run';
const voiceEnv = (over = {}) => ({
  VOICE_URL: VOICE,
  MODAL_KEY: 'wk-test',
  MODAL_SECRET: 'ws-test',
  ...over,
});

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]).buffer;
const later = () => Date.now() + 14 * 60_000;

describe('startJob', () => {
  it('sends the words and the voice with the proxy-auth token, and nothing else', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push({ url, init });
      return Response.json({ call_id: 'fc-1' });
    });
    expect(await startJob(voiceEnv(), 'שלום.')).toBe('fc-1');
    expect(calls[0].url).toBe(`${VOICE}/jobs`);
    expect(calls[0].init.headers['Modal-Key']).toBe('wk-test');
    expect(calls[0].init.headers['Modal-Secret']).toBe('ws-test');
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: 'שלום.', voice: 'default' });
  });

  it('names the voice it was asked for', async () => {
    const calls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      calls.push(init);
      return Response.json({ call_id: 'fc-1' });
    });
    await startJob(voiceEnv(), 'שלום.', { voice: 'zahavi' });
    expect(JSON.parse(calls[0].body)).toEqual({ text: 'שלום.', voice: 'zahavi' });
  });

  it('tries again through a cold start or a blip', async () => {
    const answers = [new Response('', { status: 503 }), Response.json({ call_id: 'fc-2' })];
    vi.stubGlobal('fetch', async () => answers.shift());
    let waited = 0;
    expect(await startJob(voiceEnv(), 'x', { wait: async () => void waited++ })).toBe('fc-2');
    expect(waited).toBe(1);
  });

  it('gives up after a few tries rather than knocking forever', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('', { status: 503 });
    });
    await expect(startJob(voiceEnv(), 'x', { wait: async () => {} })).rejects.toThrow(/unreachable/);
    expect(calls).toBe(3);
  });

  it('gives up at once on a refused token — Modal answers that at its edge', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('modal-http: missing credentials for proxy authorization', { status: 401 });
    });
    await expect(startJob(voiceEnv(), 'x')).rejects.toThrow(/refused the token/);
    expect(calls).toBe(1);
  });
});

describe('collectJob', () => {
  it('asks the endpoint to wait, and keeps asking while it says "working"', async () => {
    const urls = [];
    const answers = [Response.json({ status: 'working' }, { status: 202 }), new Response(MP3)];
    vi.stubGlobal('fetch', async (url) => {
      urls.push(url);
      return answers.shift();
    });
    const bytes = await collectJob(voiceEnv(), 'fc-1', { deadline: later() });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(MP3));
    expect(urls[0]).toBe(`${VOICE}/jobs/fc-1?wait=100`);
  });

  it('carries the job’s own reason when it failed', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'reference voice missing' }, { status: 500 }),
    );
    await expect(collectJob(voiceEnv(), 'fc-1', { deadline: later() })).rejects.toThrow(
      'voice job failed: reference voice missing',
    );
  });

  it('never asks the endpoint to wait past the deadline', async () => {
    const urls = [];
    vi.stubGlobal('fetch', async (url) => {
      urls.push(url);
      return new Response(MP3);
    });
    await collectJob(voiceEnv(), 'fc-1', { deadline: Date.now() + 30_000 });
    expect(Number(new URL(urls[0]).searchParams.get('wait'))).toBeLessThanOrEqual(25);
  });

  it('stays inside the free plan’s 50 requests however long it runs', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return Response.json({ status: 'working' }, { status: 202 });
    });
    await expect(
      collectJob(voiceEnv(), 'fc-1', { deadline: Infinity, wait: async () => {} }),
    ).rejects.toThrow(/did not finish/);
    // plus the three tries startJob may need
    expect(calls + 3).toBeLessThanOrEqual(50);
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

// The voice server, end to end: queue, then collect.
const voiceAnswers = () =>
  vi.stubGlobal('fetch', async (_url, init) =>
    init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3),
  );

const startJobOn = (voice, body) =>
  voice.fetch(new Request('https://voice/start', { method: 'POST', body: JSON.stringify(body) }));

describe('voiceFor / voiceHash', () => {
  it('reads a recap in its writer’s voice, and a stranger in the default one', () => {
    expect(voiceFor({ persona: 'zahavi' })).toBe('zahavi');
    expect(voiceFor({})).toBe('default'); // stored before personas existed
    expect(voiceFor({ persona: 'no-such-persona' })).toBe('default');
    expect(voiceFor({ persona: '../../etc' })).toBe('default');
    expect(voiceFor(null)).toBe('default');
  });

  it('files each voice’s audio apart, and leaves the default’s where it was', async () => {
    const words = 'הכחולים לקחו את הערב.';
    expect(await voiceHash(words, 'zahavi')).not.toBe(await voiceHash(words));
    expect(await voiceHash(words, 'default')).toBe(await voiceHash(words));
  });
});

describe('the niqqud switch', () => {
  it('is on unless it is turned off', () => {
    expect(pointing({})).toBe(true);
    expect(pointing({ VOICE_NIQQUD: 'on' })).toBe(true);
    expect(pointing({ VOICE_NIQQUD: 'off' })).toBe(false);
    expect(pointing({ VOICE_NIQQUD: 'OFF' })).toBe(false);
  });

  it('files plain recordings apart from pointed ones', async () => {
    expect(await voiceHash('שלום.', 'default', false)).not.toBe(await voiceHash('שלום.', 'default', true));
  });

  it('records from the text as it stands, and asks Gemini nothing, when off', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), GEMINI_KEY: 'k', VOICE_NIQQUD: 'off', ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    const urls = [];
    vi.stubGlobal('fetch', async (url, init) => {
      urls.push(String(url));
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await voice.alarm();
    expect(urls.some((u) => u.includes('generativelanguage'))).toBe(false);
    expect(await (await voice.fetch(new Request('https://voice/status'))).json()).toMatchObject({
      status: 'ready',
      pointed: false,
      pointNote: 'switched off',
    });
  });
});

describe('RecapVoice', () => {
  it('hands the voice on to the voice server', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1', voice: 'zahavi' });
    const bodies = [];
    vi.stubGlobal('fetch', async (_url, init) => {
      if (init?.method === 'POST') bodies.push(JSON.parse(init.body));
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    await voice.alarm();
    expect(bodies).toEqual([{ text: 'שלום.', voice: 'zahavi' }]);
  });

  it('sends the voice server the pointed text, and records that it did', async () => {
    const POINTED = 'שָׁלוֹם.';
    const state = fakeState();
    const env = { ...voiceEnv(), GEMINI_KEY: 'k', ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    const sent = [];
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('generativelanguage')) {
        return Response.json({ candidates: [{ content: { parts: [{ text: `<nikud>${POINTED}</nikud>` }] } }] });
      }
      if (init?.method === 'POST') sent.push(JSON.parse(init.body).text);
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    await voice.alarm();
    expect(sent).toEqual([POINTED]);
    expect(await (await voice.fetch(new Request('https://voice/status'))).json()).toMatchObject({
      status: 'ready',
      pointed: true,
    });
  });

  it('still makes the recording, unpointed, when the points cannot be added', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), GEMINI_KEY: 'k', ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    const sent = [];
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('generativelanguage')) return new Response('', { status: 401 });
      if (init?.method === 'POST') sent.push(JSON.parse(init.body).text);
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await voice.alarm();
    expect(sent).toEqual(['שלום.']);
    expect(await (await voice.fetch(new Request('https://voice/status'))).json()).toMatchObject({
      status: 'ready',
      pointed: false,
    });
  });

  it('keeps the exact text it sent, so it can be asked what that was', async () => {
    const POINTED = 'שָׁלוֹם.';
    const state = fakeState();
    const env = { ...voiceEnv(), GEMINI_KEY: 'k', ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('generativelanguage')) {
        return Response.json({ candidates: [{ content: { parts: [{ text: `<nikud>${POINTED}</nikud>` }] } }] });
      }
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    await voice.alarm();
    expect(await (await voice.fetch(new Request('https://voice/sent'))).json()).toEqual({
      sent: POINTED,
      raw: null, // it was all used, so there is no rejected answer to show
      hash: 'h1',
    });
  });

  it('keeps it even when the recording then fails', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), VOICE_NIQQUD: 'off', ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' });
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await voice.alarm();
    expect((await (await voice.fetch(new Request('https://voice/sent'))).json()).sent).toBe('שלום.');
  });

  it('ignores a voice it does not know and falls back to the default', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1', voice: '../x' });
    expect(await state.storage.get('voice')).toBe('default');
  });

  it('starts on an alarm and files the audio under the words it read', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), ROSTER_KV: fakeKv() };
    const voice = new RecapVoice(state, env);
    const started = await (await startJobOn(voice, { fixtureId: 'f1', text: 'שלום.', hash: 'h1' })).json();
    expect(started.status).toBe('working');
    expect(state.alarmAt()).not.toBeNull();

    voiceAnswers();
    await voice.alarm();
    expect(new Uint8Array(env.ROSTER_KV.store.get(voiceKey('f1')))).toEqual(new Uint8Array(MP3));
    expect(env.ROSTER_KV.meta.get(voiceKey('f1')).hash).toBe('h1');
    const status = await (await voice.fetch(new Request('https://voice/status'))).json();
    expect(status.status).toBe('ready');
  });

  it('never runs two at once for the same night', async () => {
    const state = fakeState();
    const voice = new RecapVoice(state, { ...voiceEnv(), ROSTER_KV: fakeKv() });
    const first = await (await startJobOn(voice, { fixtureId: 'f1', text: 'א.', hash: 'h1' })).json();
    const second = await (await startJobOn(voice, { fixtureId: 'f1', text: 'ב.', hash: 'h2' })).json();
    expect(second).toEqual(first);
  });

  it('records a failure instead of throwing — a retried alarm is GPU time spent again', async () => {
    const state = fakeState();
    const env = { ...voiceEnv(), ROSTER_KV: fakeKv() };
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
    ...(configured ? voiceEnv() : {}),
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

  it('remembers which persona wrote a published draft', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    const draft = await (
      await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS, persona: 'zahavi' })
    ).json();
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: draft.text });
    expect(JSON.parse(kv.store.get('recap:f1'))).toMatchObject({ source: 'gemini', persona: 'zahavi' });
  });

  it('does not take the persona from the client when a draft is published', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    const draft = await (await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS })).json();
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: draft.text, persona: 'zahavi' });
    expect(JSON.parse(kv.store.get('recap:f1')).persona).toBe('default');
  });

  it('keeps the persona when the recap is saved in one call', async () => {
    const { env, kv } = routeEnv();
    geminiWrites('הכחולים לקחו את הערב.');
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS, persona: 'zahavi', save: true });
    expect(JSON.parse(kv.store.get('recap:f1')).persona).toBe('zahavi');
  });

  it('reads drafts remembered before personas existed as the default voice', async () => {
    const { env, kv } = routeEnv();
    const text = 'טיוטה ישנה.';
    const hash = await sha256Hex(text);
    await kv.put('recapdrafts:f1', JSON.stringify([hash]));
    await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text });
    expect(JSON.parse(kv.store.get('recap:f1'))).toMatchObject({ source: 'gemini', persona: 'default' });
  });

  describe('written with niqqud (§2.71)', () => {
    const PLAIN = 'הכחולים לקחו את הערב.';
    const POINTED = 'הַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.';

    it('shows the app the plain text, and keeps the pointed copy only on the Worker', async () => {
      const { env, kv } = routeEnv();
      geminiWrites(POINTED);
      const draft = await (await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS })).json();
      expect(draft).toEqual({ ok: true, text: PLAIN }); // not the pointed copy, not even a hint of it

      const published = await (await call(env, '/recap', { secret: WORD, fixtureId: 'f1', text: draft.text })).json();
      expect(published).not.toHaveProperty('vocalized');
      expect(JSON.parse(kv.store.get('recap:f1'))).toMatchObject({ text: PLAIN, vocalized: POINTED });

      // and the public read does not hand it out either
      const read = await (await call(env, '/recap?id=f1')).json();
      expect(read.text).toBe(PLAIN);
      expect(read).not.toHaveProperty('vocalized');
    });

    it('keeps it when the recap is saved in one call', async () => {
      const { env, kv } = routeEnv();
      geminiWrites(POINTED);
      const saved = await (
        await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS, save: true })
      ).json();
      expect(saved).not.toHaveProperty('vocalized');
      expect(JSON.parse(kv.store.get('recap:f1')).vocalized).toBe(POINTED);
    });

    it('does not vouch for a pointed copy the client brings', async () => {
      const { env, kv } = routeEnv();
      geminiWrites(POINTED);
      await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS });
      await call(env, '/recap', {
        secret: WORD,
        fixtureId: 'f1',
        text: PLAIN,
        vocalized: 'משהו אחר לגמרי',
      });
      expect(JSON.parse(kv.store.get('recap:f1')).vocalized).toBe(POINTED);
    });

    it('asks for plain text when niqqud is switched off', async () => {
      const { env, kv } = routeEnv();
      env.VOICE_NIQQUD = 'off';
      const prompts = [];
      vi.stubGlobal('fetch', async (_url, init) => {
        prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
        return Response.json({ candidates: [{ content: { parts: [{ text: `<report>${PLAIN}</report>` }] } }] });
      });
      await call(env, '/recap', { secret: WORD, fixtureId: 'f1', facts: FACTS, save: true });
      expect(prompts[0]).not.toContain('NIQQUD');
      expect(JSON.parse(kv.store.get('recap:f1'))).not.toHaveProperty('vocalized');
    });
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

describe('voiceCap', () => {
  it('is ten a day unless told otherwise', () => {
    expect(voiceCap({})).toBe(10);
    expect(voiceCap({ VOICE_LIMIT: '' })).toBe(10);
  });

  it('takes a number, and "off" removes it', () => {
    expect(voiceCap({ VOICE_LIMIT: '25' })).toBe(25);
    expect(voiceCap({ VOICE_LIMIT: 'off' })).toBe(Infinity);
    expect(voiceCap({ VOICE_LIMIT: 'OFF' })).toBe(Infinity);
  });

  it('does not let a typo remove the cap', () => {
    for (const bad of ['0', '-3', '2.5', 'none', 'false', 'unlimited']) {
      expect(voiceCap({ VOICE_LIMIT: bad })).toBe(10);
    }
  });
});

describe('/recap-audio', () => {
  it('does not count recordings against the daily cap while it is off', async () => {
    const { env, kv, limited } = routeEnv();
    env.VOICE_LIMIT = 'off';
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1, source: 'gemini' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    expect(limited.filter((n) => n.startsWith('voice:'))).toHaveLength(0);
  });

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

  it('has a persona’s recap read in that persona’s voice, filed apart from the default', async () => {
    const { env, kv, voices } = routeEnv();
    const text = 'הכחולים לקחו את הערב.';
    await storeRecap(kv, 'f1', { text, at: 1, source: 'gemini', persona: 'zahavi' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    expect(await voices.get('f1').state.storage.get('voice')).toBe('zahavi');
    expect((await voices.get('f1').state.storage.get('job')).hash).toBe(
      await voiceHash(speakable(text), 'zahavi'),
    );
  });

  it('shows the organiser the text the voice was sent — while it is still this recap’s', async () => {
    const { env, kv, voices } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'הכחולים לקחו את הערב.', at: 1, source: 'gemini' });
    expect((await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', sent: true })).status).toBe(404);

    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    voiceAnswers();
    await voices.get('f1').instance.alarm();
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', sent: true });
    expect((await res.json()).text).toContain('הכחולים לקחו את הערב');

    // re-rolled since: that text belongs to a report nobody can read any more
    await storeRecap(kv, 'f1', { text: 'דוח אחר לגמרי.', at: 2, source: 'gemini' });
    expect((await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', sent: true })).status).toBe(404);
  });

  it('records from the pointed report as written, and does not ask Gemini to point it again', async () => {
    const { env, kv, voices } = routeEnv();
    const POINTED = 'הַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.';
    await storeRecap(kv, 'f1', {
      text: 'הכחולים לקחו את הערב.',
      vocalized: POINTED,
      at: 1,
      source: 'gemini',
    });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    const urls = [];
    const sent = [];
    vi.stubGlobal('fetch', async (url, init) => {
      urls.push(String(url));
      if (init?.method === 'POST') sent.push(JSON.parse(init.body).text);
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    await voices.get('f1').instance.alarm();
    expect(sent).toEqual([POINTED]);
    expect(urls.some((u) => u.includes('generativelanguage'))).toBe(false);
    expect(await (await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', sent: true })).json()).toEqual({
      text: POINTED,
    });
  });

  it('sends the voice the respelled words, and leaves the report alone', async () => {
    const { env, kv, voices } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'לשגב היה שיא.', at: 1, source: 'gemini' });
    await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1' });
    const sent = [];
    vi.stubGlobal('fetch', async (url, init) => {
      if (String(url).includes('generativelanguage')) return new Response('', { status: 401 });
      if (init?.method === 'POST') sent.push(JSON.parse(init.body).text);
      return init?.method === 'POST' ? Response.json({ call_id: 'fc-1' }) : new Response(MP3);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await voices.get('f1').instance.alarm();
    expect(sent).toEqual(['le Segev היה סיא.']);
    expect(JSON.parse(kv.store.get('recap:f1')).text).toBe('לשגב היה שיא.');
  });

  it('softens a long sentence’s exclamation mark in the voice’s text, and only there', () => {
    const long = 'השחורים פשוט פירקו את המגרש והראו לכולם מאיפה דג משתין עם שש נקודות';
    const recap = { text: `${long}! איזו בונבוניירה!`, source: 'gemini' };
    expect(spokenFor({}, recap)).toBe(`${long}. איזו בונבוניירה!`);
    expect(spokenFor({ VOICE_EXCLAIM: 'all' }, recap)).toBe(`${long}! איזו בונבוניירה!`);
    expect(recap.text).toContain(`${long}!`); // the report is untouched
  });

  it('ignores a pointed copy that is not the recap’s own words', async () => {
    const { env, kv } = routeEnv();
    const recap = { text: 'הכחולים לקחו את הערב.', vocalized: 'שָׁלוֹם עוֹלָם.', source: 'gemini' };
    expect(spokenFor(env, recap)).toBe('הכחולים לקחו את הערב.');
    expect(spokenFor(env, { ...recap, vocalized: 'הַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.' })).toContain('הַכְּחוּלִּים');
    // switched off: the plain text, even though a pointed copy is on file
    expect(spokenFor({ ...env, VOICE_NIQQUD: 'off' }, { ...recap, vocalized: 'הַכְּחוּלִּים לָקְחוּ אֶת הָעֶרֶב.' })).toBe(
      'הכחולים לקחו את הערב.',
    );
  });

  it('keeps the sent text behind the word', async () => {
    const { env, kv } = routeEnv();
    await storeRecap(kv, 'f1', { text: 'דוח', at: 1, source: 'gemini' });
    expect((await call(env, '/recap-audio', { secret: 'nope', fixtureId: 'f1', sent: true })).status).toBe(401);
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
    voiceAnswers();
    await voices.get('f1').instance.alarm();
    expect(await (await call(env, '/recap-audio?id=f1')).json()).toMatchObject({ status: 'ready' });
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: 'f1', file: true });
    expect(res.status).toBe(200);
  });
});
