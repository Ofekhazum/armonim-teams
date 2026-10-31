import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from './roster-worker.js';
import { RecapVoice } from './recap-voice.js';
import { PERSONAS, PERSONA_KEYS, TONE_GUARDRAILS } from './recap.js';
import {
  MONTH_FRAME,
  buildMonthPrompt,
  currentPeriod,
  isMonthRecapId,
  monthRecapId,
  readMonthFacts,
  writeMonthRecap,
} from './month-recap.js';
import { buildTestClub } from '../src/testData';
import { nightGrades } from '../src/grades';
import { ratingsOf, teamOfMonth, totmPeriods } from '../src/totm';

// The month's show (§2.74). The same questions as the night's reporter — what
// the prompt cannot leave out, and what the route refuses — plus the one this
// feature was asked for in so many words: that what reaches the voice is Hebrew.

afterEach(() => vi.unstubAllGlobals());

const club = buildTestClub();
// A finished month with a note in it. The invented club follows the real
// calendar, so "finished" has to be asked rather than assumed.
const PERIOD = totmPeriods(club.history).find(
  (p) => p < currentPeriod() && club.history.some((fx) => fx.date.startsWith(`${p}-`) && fx.note),
);
const FIVE = teamOfMonth(club.history, PERIOD, ratingsOf(club.players));
const REGISTERED = { ids: FIVE.map((p) => p.id), names: FIVE.map((p) => p.name), at: 1 };

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  const meta = new Map();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v, opts) => {
      store.set(k, v);
      if (opts?.metadata) meta.set(k, opts.metadata);
    },
    delete: async (k) => {
      store.delete(k);
      meta.delete(k);
    },
    list: async ({ prefix }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
    getWithMetadata: async (k) => ({ value: store.get(k) ?? null, metadata: meta.get(k) ?? null }),
  };
}

// The club as KV holds it: the archive, the roster, the registered team and
// the published marks of every night.
function clubKv({ registered = true } = {}) {
  const seed = {
    history: JSON.stringify({ version: 1, fixtures: club.history }),
    roster: JSON.stringify({ version: 1, players: club.players }),
    totm: JSON.stringify(registered ? { [PERIOD]: REGISTERED } : {}),
  };
  for (const fx of club.history) {
    const graded = nightGrades(club.history, fx.id);
    if (!graded) continue;
    const lines = Object.fromEntries(graded.map((g) => [g.id, { grade: g.grade, line: 'שורה' }]));
    seed[`grades:${fx.id}`] = JSON.stringify({ lines });
  }
  return fakeKv(seed);
}

function fakeState() {
  const map = new Map();
  return {
    map,
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      delete: async (k) => void map.delete(k),
      setAlarm: async () => {},
    },
  };
}

const WORD = 'club-word';

function routeEnv(kv = clubKv()) {
  const limited = [];
  const voices = new Map();
  const env = {
    PUBLISH_SECRET: WORD,
    GEMINI_KEY: 'k',
    VOICE_NIQQUD: 'off',
    VOICE_URL: 'https://club--armonim-recap-voice-web.modal.run',
    MODAL_KEY: 'wk-test',
    MODAL_SECRET: 'ws-test',
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
  };
  return { env, kv, limited, voices };
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

// Gemini, answering with `text` between the tags, and keeping what it was asked.
const gemini = (text) => {
  const asked = [];
  vi.stubGlobal('fetch', async (_url, init) => {
    asked.push(JSON.parse(init.body).contents[0].parts[0].text);
    return Response.json({ candidates: [{ content: { parts: [{ text: `<report>${text}</report>` }] } }] });
  });
  return asked;
};

const SHOW = '📻 שדרן החודש מדווח מהמגרש\n\nאיזה חודש היה לנו. חמישה מחזורים, ואף אחד לא ישן.';

describe('monthRecapId', () => {
  it('names a month in a space no fixture id can reach', () => {
    expect(monthRecapId('2026-09')).toBe('month:2026-09');
    expect(isMonthRecapId('month:2026-09')).toBe(true);
    // fixture ids are base36 — no colon, ever
    expect(isMonthRecapId('lz3k9q2abc')).toBe(false);
  });
});

describe('readMonthFacts', () => {
  it('reads a finished month out of KV, with the registered team in its order', async () => {
    const facts = await readMonthFacts({ ROSTER_KV: clubKv() }, PERIOD);
    expect(facts.nights).toBeGreaterThan(0);
    REGISTERED.names.forEach((name, i) => expect(facts.team[i].startsWith(name)).toBe(true));
    expect(facts.awards.some((a) => a.startsWith('highest average mark'))).toBe(true);
  });

  it('counts the team itself when a finished month was never registered', async () => {
    const facts = await readMonthFacts({ ROSTER_KV: clubKv({ registered: false }) }, PERIOD);
    REGISTERED.names.forEach((name, i) => expect(facts.team[i].startsWith(name)).toBe(true));
  });

  it('counts the team for a month still being played, rather than trust a registration', async () => {
    const kv = clubKv();
    await kv.put('totm', JSON.stringify({ [PERIOD]: { ids: ['x'], names: ['שחקן מאמצע החודש'], at: 1 } }));
    const during = Date.parse(`${PERIOD}-15T12:00:00Z`); // "now" inside the month itself
    const facts = await readMonthFacts({ ROSTER_KV: kv }, PERIOD, during);
    REGISTERED.names.forEach((name, i) => expect(facts.team[i].startsWith(name)).toBe(true));

    // and once it is over, the registration is the announcement
    const after = await readMonthFacts({ ROSTER_KV: kv }, PERIOD);
    expect(after.team).toEqual(['שחקן מאמצע החודש']);
  });

  it('is not ready for a month with no recorded night', async () => {
    expect(await readMonthFacts({ ROSTER_KV: clubKv() }, '1999-01')).toBeNull();
  });
});

describe('currentPeriod', () => {
  it('ends the month at midnight in Israel, not in UTC', () => {
    // 22:30 UTC on 31 October is 00:30 on 1 November in Israel (UTC+2 in winter)
    expect(currentPeriod(Date.parse('2026-10-31T22:30:00Z'))).toBe('2026-11');
    expect(currentPeriod(Date.parse('2026-10-31T21:30:00Z'))).toBe('2026-10');
    // and in summer, UTC+3
    expect(currentPeriod(Date.parse('2026-07-31T21:30:00Z'))).toBe('2026-08');
  });
});

describe('buildMonthPrompt', () => {
  const facts = async () => readMonthFacts({ ROSTER_KV: clubKv() }, PERIOD);

  it('turns every persona into the month’s host, and keeps every guardrail after its voice', async () => {
    const f = await facts();
    for (const key of PERSONA_KEYS) {
      const prompt = buildMonthPrompt(f, key);
      const p = PERSONAS[key];
      expect(prompt.startsWith(p.role)).toBe(true);
      expect(prompt.indexOf(MONTH_FRAME)).toBeGreaterThan(prompt.indexOf(p.role));
      expect(prompt).toContain(p.byline);
      expect(prompt.indexOf(TONE_GUARDRAILS)).toBeGreaterThan(prompt.indexOf(p.tone));
    }
  });

  it('tells a month still being played exactly as it would a finished one', async () => {
    const during = Date.parse(`${PERIOD}-15T12:00:00Z`);
    const early = await readMonthFacts({ ROSTER_KV: clubKv() }, PERIOD, during);
    // same club, same nights: the clock changes nothing the model is told
    expect(buildMonthPrompt(early, 'default')).toBe(buildMonthPrompt(await facts(), 'default'));
    expect(buildMonthPrompt(early, 'default')).not.toMatch(/so far|as it stands|נכון לעכשיו/i);
  });

  it('falls back to the house reporter for a persona it does not know', async () => {
    const f = await facts();
    expect(buildMonthPrompt(f, 'nobody')).toBe(buildMonthPrompt(f, 'default'));
  });

  it('builds up to the team before naming anyone, and never reads a line out', async () => {
    const prompt = buildMonthPrompt(await facts(), 'default');
    const buildUp = prompt.indexOf('THE BUILD-UP TO THE TEAM OF THE MONTH');
    expect(buildUp).toBeGreaterThan(-1);
    expect(prompt.indexOf('THE COUNTDOWN')).toBeGreaterThan(buildUp);
    expect(prompt).toContain('Never read their line out');
  });

  it('quotes its bad examples without anybody’s real name', async () => {
    const prompt = buildMonthPrompt(await facts(), 'default');
    const examples = prompt.slice(prompt.indexOf('The failure to avoid'), prompt.indexOf('THIS IS A ROAST'));
    // whole words: "דור" is a name, and also the end of "הכדור"
    const words = new Set(examples.split(/[^\u05d0-\u05ea]+/));
    for (const p of club.players) expect(words.has(p.name)).toBe(false);
  });

  it('hands over the team by place, and the countdown from the bottom', async () => {
    const prompt = buildMonthPrompt(await facts(), 'default');
    REGISTERED.names.forEach((name, i) => expect(prompt).toContain(`PLACE ${i + 1}: ${name}`));
    expect(prompt).toContain('Places in this order: 5, 4, 3, 2, 1');
  });

  it('carries the events, and never a date for the model to copy', async () => {
    const prompt = buildMonthPrompt(await facts(), 'default');
    expect(prompt).toMatch(/EVENT \d+\.1: "/);
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // the names it must not leak into the prompt: they are only for the check
    expect(prompt).not.toContain('"names"');
  });
});

describe('writeMonthRecap — what reaches the voice is Hebrew', () => {
  let facts;
  beforeAll(async () => {
    facts = { ...(await readMonthFacts({ ROSTER_KV: clubKv() }, PERIOD)), names: ['ניב', 'Guy'] };
  });

  it('keeps a Hebrew show', async () => {
    gemini(SHOW);
    expect(await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).toMatchObject({ text: SHOW });
  });

  it('lets through a Latin name only if somebody that month is called it', async () => {
    gemini('גם Guy היה שם.');
    expect((await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).text).toBe('גם Guy היה שם.');
  });

  it('refuses a word in another language', async () => {
    gemini('ו finalmente הלבנים לקחו.');
    expect(await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).toEqual({
      error: 'the report slipped out of Hebrew: finalmente',
    });
  });

  it('refuses another script', async () => {
    gemini('חמש פעמים ברֵيف.');
    expect((await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).error).toMatch(/slipped out of Hebrew/);
  });

  it('refuses a printed date', async () => {
    gemini('ב-2026-09-03 זה התחיל.');
    expect((await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).error).toMatch(/raw date/);
  });

  it('refuses an answer with no tags', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: 'בדקתי את הכללים' }] } }] }),
    );
    expect((await writeMonthRecap({ GEMINI_KEY: 'k' }, facts)).error).toMatch(/working out/);
  });
});

describe('/month-recap', () => {
  it('writes a draft in the chosen persona, and stores nothing', async () => {
    const { env, kv } = routeEnv();
    const asked = gemini(SHOW);
    const res = await call(env, '/month-recap', { secret: WORD, period: PERIOD, persona: 'zahavi' });
    expect(await res.json()).toEqual({ ok: true, text: SHOW });
    expect(asked[0].startsWith(PERSONAS.zahavi.role)).toBe(true);
    expect(kv.store.has(`recap:month:${PERIOD}`)).toBe(false);
  });

  it('publishes the draft as Gemini’s, in the persona that wrote it — not the one the client says', async () => {
    const { env, kv } = routeEnv();
    gemini(SHOW);
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, persona: 'zahavi' });
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: SHOW, persona: 'bibi' });
    expect(JSON.parse(kv.store.get(`recap:month:${PERIOD}`))).toMatchObject({
      text: SHOW,
      source: 'gemini',
      persona: 'zahavi',
    });
  });

  it('stores text it did not write as edited — kept, never spoken', async () => {
    const { env, kv } = routeEnv();
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: 'משהו שנכתב ביד.' });
    expect(JSON.parse(kv.store.get(`recap:month:${PERIOD}`)).source).toBe('edited');
  });

  it('refuses a month with no recorded night, before spending or counting anything', async () => {
    const { env, limited } = routeEnv();
    const asked = gemini(SHOW);
    const res = await call(env, '/month-recap', { secret: WORD, period: '1999-01' });
    expect(res.status).toBe(409);
    expect(asked).toHaveLength(0);
    expect(limited.some((n) => n.startsWith('monthrecap:'))).toBe(false);
  });

  it('counts a generation on its own counter', async () => {
    const { env, limited } = routeEnv();
    gemini(SHOW);
    await call(env, '/month-recap', { secret: WORD, period: PERIOD });
    expect(limited.some((n) => n.startsWith('monthrecap:'))).toBe(true);
  });

  it('refuses a bad period and a wrong word', async () => {
    const { env } = routeEnv();
    expect((await call(env, '/month-recap', { secret: WORD, period: 'September' })).status).toBe(400);
    expect((await call(env, '/month-recap', { secret: 'nope', period: PERIOD })).status).toBe(401);
  });

  it('reads the published text back behind the word, and forgets it with its recording', async () => {
    const { env, kv } = routeEnv();
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: SHOW });
    const read = await (await call(env, '/month-recap', { secret: WORD, period: PERIOD, read: true })).json();
    expect(read.text).toBe(SHOW);

    await kv.put(`recapaudio:month:${PERIOD}`, 'mp3');
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: null });
    expect(kv.store.has(`recap:month:${PERIOD}`)).toBe(false);
    expect(kv.store.has(`recapaudio:month:${PERIOD}`)).toBe(false);
  });

  it('keeps the text off the public read, and the night routes off a month', async () => {
    const { env } = routeEnv();
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: SHOW });
    expect((await call(env, `/recap?id=month:${PERIOD}`)).status).toBe(400);
    const write = await call(env, '/recap', { secret: WORD, fixtureId: `month:${PERIOD}`, text: 'x' });
    expect(write.status).toBe(400);
  });

  it('is voiced by /recap-audio, in the voice of the persona that wrote it', async () => {
    const { env, voices } = routeEnv();
    gemini(SHOW);
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, persona: 'swissa' });
    await call(env, '/month-recap', { secret: WORD, period: PERIOD, text: SHOW });
    const res = await call(env, '/recap-audio', { secret: WORD, fixtureId: `month:${PERIOD}` });
    expect(await res.json()).toMatchObject({ status: 'working' });
    expect(voices.get(`month:${PERIOD}`).state.map.get('voice')).toBe('swissa');
  });
});
