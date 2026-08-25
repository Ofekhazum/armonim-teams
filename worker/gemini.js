// Talking to Google, for whoever in this Worker needs to.
//
// Everything here was written for the night reporter (§2.24) and lived inside
// `recap.js` until the grades (§2.39) needed the same thing. None of it is
// about reports: it is the model list, the fallback rules, the thinking-config
// dance and the two ways a 200 can still contain nothing. Copying that into a
// second file would have meant two lists of model names going stale at
// different times, which is the exact failure the list below exists to survive.
//
// What stays with each caller is the part that is theirs: the prompt, and how
// to read what came back. `callGemini` hands over the raw text and no opinion
// about it.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// The waterfall: best first, most generous last.
//
// The free tier's problem is not that it is small, it is that it is *uneven*.
// The best model here allows about twenty requests a day; the lite ones allow
// five hundred. A weekly report needs one call — but a night being re-rolled
// three times while somebody tunes the wording, on the same day the archive is
// being backfilled, walks through twenty without noticing. And the failure was
// total: one 429 and the feature was simply gone until tomorrow.
//
// So a refusal moves down the list rather than ending the attempt. The work
// gets done by the best model that will take it, and the worst case is a
// slightly plainer answer instead of no answer — which is the whole of what
// "graceful" means here.
//
// This list is also the answer to the other thing that has actually happened:
// `gemini-2.5-flash` was the only model in this file until Google replied
// "no longer available to new users, use models/gemini-3.6-flash" and the
// feature stopped working. A single name is a single point of failure, and now
// a name going stale costs one 404 and the next model down.
export const MODELS = [
  'gemini-3.6-flash', // best writing, ~20 requests a day
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite', // ~500 a day
  'gemini-3.1-flash-lite', // ~500 a day
  'gemini-3-flash',
];

// Google writes its model names with a `models/` prefix, and the endpoint here
// already ends in `/models`. Anything set as `GEMINI_MODEL` is far more likely
// to be pasted from Google's own docs than typed bare, so both forms work.
const bare = (name) => String(name).replace(/^models\//, '').trim();

/**
 * Which models to try, in order.
 *
 * `GEMINI_MODEL` still exists and still jumps the queue — it is the escape
 * hatch for the day Google renames something again — but it no longer
 * *replaces* the list. Pinning one model used to mean pinning the failure too.
 */
export const modelOrder = (env) => {
  const pinned = env.GEMINI_MODEL ? bare(env.GEMINI_MODEL) : null;
  return pinned ? [pinned, ...MODELS.filter((m) => m !== pinned)] : MODELS;
};

// Statuses where the next model down is worth trying.
//
// 429 and the 5xxs are the ones asked for: a quota that is per-model, and an
// outage that might not be. 404 earns its place from history — that is exactly
// what a retired model answers. 400 is here because by the time it is checked,
// the thinking-config retries below have already been exhausted, so it means
// *this* model will not take this request, and the next one might.
//
// 401 and 403 are deliberately absent. A rejected key is rejected by every
// model, so falling through would turn one clear error into five identical
// ones and slow the answer down for nothing.
const FALL_THROUGH = new Set([400, 404, 429, 500, 502, 503, 504]);

// Deliberately far more than any caller needs.
//
// This number has been wrong twice, in both directions of the same trap:
// thinking is on by default and is *paid for out of this budget*, so a cap
// sized for the answer is spent before the answer starts. At 900 the reply came
// back empty (`finishReason: MAX_TOKENS`, no content). At 1600 — with the
// thinking switch dropped by the 400 retry — it came back as half a sentence
// ending mid-word, which is worse, because a truncated report looks like a
// broken feature rather than a failed call.
//
// So: budget for the thinking *and* the writing, with room to spare. Output
// tokens are the cheap part of a weekly report, and the free tier's limit is a
// million a minute.
const MAX_TOKENS = 10000;

// The numbers in what comes back are load bearing and the prompt is what keeps
// those straight; this is only deciding how far the writing is willing to go,
// and a cautious setting reads as cautious writing.
const TEMPERATURE = 1;

// How to ask a model to stop thinking, in the order worth trying.
//
// There is no single answer: 3.x wants a `thinkingLevel`, 2.5 wants a
// `thinkingBudget`, some models refuse to have it turned off at all, and a
// model that dislikes the field answers `400 Request contains an invalid
// argument` without naming it. So each is tried in turn and a 400 moves to the
// next — worst case three calls, and only ever when the one before failed.
const THINKING = [{ thinkingLevel: 'low' }, { thinkingBudget: 0 }, null];

/** Why Google turned it down, in Google's own words. */
async function reasonFrom(res) {
  try {
    const body = await res.json();
    const parts = [];
    if (body?.error?.message) parts.push(String(body.error.message));
    // "Request contains an invalid argument" says nothing on its own; which
    // argument is in the details, and that is the whole diagnosis.
    for (const d of body?.error?.details ?? []) {
      for (const v of d?.fieldViolations ?? []) {
        parts.push(`${v.field ?? '?'}: ${v.description ?? ''}`.trim());
      }
    }
    return parts.length ? `: ${parts.join(' | ').slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

/**
 * One model, with the thinking-config retries that model may need.
 *
 * Worst case three calls, and only ever when the one before answered 400 —
 * see THINKING for why there is no single way to ask a model to stop thinking.
 */
async function askModel(model, key, prompt, config) {
  const ask = (thinking) =>
    fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: config.temperature ?? TEMPERATURE,
          maxOutputTokens: config.maxTokens ?? MAX_TOKENS,
          // see THINKING: on by default, and paid for out of the same budget
          // as the reply
          ...(thinking ? { thinkingConfig: thinking } : {}),
          ...(config.generationConfig ?? {}),
        },
      }),
    });

  let res = await ask(THINKING[0]);
  for (let i = 1; i < THINKING.length && res.status === 400; i++) {
    res = await ask(THINKING[i]);
  }
  return res;
}

/** What a 200 actually contained: the text, or why there isn't any. */
function textFrom(data) {
  // A blocked generation comes back 200 with no candidate and a reason, which
  // is worth reporting as itself rather than as a generic failure.
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) return { error: `blocked: ${blocked}` };

  const candidate = data?.candidates?.[0];
  // A part marked `thought` is the model reasoning out loud, not the answer.
  // Never asked for, but a part that arrives is a part that would otherwise be
  // shown to the club as though somebody had written it.
  const raw = (candidate?.content?.parts ?? [])
    .filter((p) => !p?.thought)
    .map((p) => p?.text ?? '')
    .join('')
    .trim();
  // An empty answer always has a reason attached, and the reason is the whole
  // difference between "it refused" and "it never got started".
  if (!raw) return { error: `empty (${candidate?.finishReason ?? 'no candidate'})` };
  return { raw };
}

/**
 * Ask Gemini, walking down the waterfall until one of them answers.
 *
 * Returns `{ raw, model }` or `{ error }` — never throws, because everything
 * built on this is decoration and the page behind it must render identically
 * without one.
 *
 * A refusal moves to the next model; a 200 ends the walk whatever it contains.
 * That second half is deliberate: an empty or unusable answer is a *content*
 * failure, and asking four more models to have a go at it would turn one bad
 * answer into five requests against quotas that are the reason this list
 * exists. Content failures have their own fixes and none of them is "ask
 * somebody else".
 */
export async function callGemini(env, prompt, config = {}) {
  const key = env.GEMINI_KEY;
  if (!key) return { error: 'not-configured' };

  // Every failure, so a total loss says which models refused and how. Five
  // lines of "429" is a quota problem; five different answers is not, and
  // telling those apart from the outside is otherwise guesswork.
  const failures = [];

  for (const model of modelOrder(env)) {
    let res;
    try {
      res = await askModel(model, key, prompt, config);
    } catch {
      failures.push(`${model}: unreachable`);
      continue;
    }

    if (!res.ok) {
      const why = await reasonFrom(res);
      failures.push(`${model}: ${res.status}${why}`);
      if (FALL_THROUGH.has(res.status)) continue;
      // a rejected key, and every other model would reject it identically
      return { error: `upstream ${res.status}${why}` };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      return { error: 'bad response' };
    }
    const out = textFrom(data);
    return out.error ? out : { ...out, model };
  }

  // Nobody would take it. All-429 is the ordinary version of this and deserves
  // the plain word for it — the free tier is spent — rather than a paragraph
  // of identical numbers.
  if (failures.every((f) => f.includes(': 429'))) return { error: 'quota' };
  return { error: `every model refused — ${failures.join(' · ').slice(0, 400)}` };
}
