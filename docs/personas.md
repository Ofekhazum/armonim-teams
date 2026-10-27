# Adding a reporter persona

A persona restyles the night recap — the voice it's written in, the byline, the
delivery — without touching a single fact or safety rule (DESIGN.md §2.70). This
is how to add one.

Two separate things, and they're independent:

- **Part A — the writing.** Which style Gemini writes the report in. This works
  today, and it's four small edits.
- **Part B — the spoken voice.** Which cloned voice reads it aloud. One file
  upload per persona; until you add one, a persona is read in the default voice.

---

## Part A — add the writing persona

A persona is three fields. Pick a short `key` for it (lowercase, no spaces) —
used everywhere below. The example here adds a film-noir detective, `noir`.

### 1. Define it — `worker/recap.js`

In the `PERSONAS` object:

```js
noir: {
  role: 'You are a world-weary film-noir detective narrating a weekly amateur 5-a-side football night as if it were an unsolved case.',
  byline: '📻 הבלש מדווח מזירת הפשע',
  tone: `Hard-boiled, clipped, and fatalistic. Short sentences. Everything is a clue, a suspect, or a betrayal. Cigarette-smoke metaphors. Treat every defeat as a crime with no witnesses. A couple of emojis, no more.`,
},
```

- **`role`** — the first sentence of the prompt: who's writing.
- **`byline`** — the line the report opens with.
  - A literal line (like above) is printed **exactly as written**.
  - Put a `<placeholder>` in it (e.g. `📻 <שם הכתב> מדווח מהמגרש`) and the model
    **invents a fresh name each time** instead. That's what `default` does.
- **`tone`** — the delivery: pace, mood, the phrases to reach for. Write it in
  English (it's an instruction to the model); the quoted example phrases can be
  Hebrew.

That's all the model sees of your persona. Everything that keeps a report honest
— never mocking a person's body, numbers only from the record, no invented
goals, Hebrew only, no dates — is bolted on automatically **after** your `tone`
(`TONE_GUARDRAILS`), the same for every persona. You can't loosen it and you
don't need to repeat it.

### 2. Let the app offer it — three client edits

So it shows up in the admin dropdown on the night page:

- **`src/recap.ts`** — add the key to the `Persona` type:
  ```ts
  export type Persona = 'default' | 'zahavi' | 'noir';
  ```
- **`src/components/NightPage.tsx`** — add it to `PERSONA_LABELS` (order here is
  the dropdown order):
  ```ts
  const PERSONA_LABELS: Record<Persona, Parameters<typeof t>[0]> = {
    default: 'np.report.persona.default',
    zahavi: 'np.report.persona.zahavi',
    noir: 'np.report.persona.noir',
  };
  ```
- **`src/strings/night.ts`** — add the label the dropdown shows, in both
  languages:
  ```ts
  'np.report.persona.noir': { he: 'הבלש', en: 'The detective' },
  ```

### 3. Check and ship

```sh
npx vitest run worker/recap.test.js   # the persona tests cover the new one
npx tsc --noEmit
npm run build
```

Then merge to `main` and push — the app and Worker redeploy on their own. No
Modal or Hugging Face step is needed for a writing persona.

> **If you only do step 1 (the Worker) and skip the client edits:** the persona
> still works if something sends its key, and it stays fully guard-railed — it
> just won't appear in the dropdown, and the TypeScript type will complain. For
> a persona you can actually pick, do all three client edits.

### The one rule about *who* a persona can be

Don't add a persona that impersonates a real, identifiable person — a
politician, a working broadcaster or journalist. A realistic-sounding report
bylined as a real public figure, read aloud and stripped of its AI label the
moment someone forwards it, is exactly what the whole feature's labelling exists
to prevent. Invented characters (a detective, an over-dramatic poet, a panicked
weather reporter) and people who've consented to it are fair game. `zahavi` is
in because he's the organiser's friend, styled as himself, with his consent.

---

## Part B — give a persona its own voice

A persona is read in the clip named after its key. In the private Hugging Face
dataset `ofh55/armonim-voice`:

| File | Used for |
|---|---|
| `voice_<key>.wav` | the persona with that key (`voice_zahavi.wav`, `voice_noir.wav`, …) |
| `reference_voice_final.wav` | the `default` persona, **and any persona that has no `voice_<key>.wav`** |

So adding a voice is one step: **record a clip and upload it to the dataset
with that name.** No redeploy — the voice server fetches clips when a container
starts, and picks up a new one the next time it is cold (up to a couple of
minutes after the previous recording, or immediately on the first one of the
day).

**Until you upload one, every persona is read in `reference_voice_final.wav`** —
which is how it worked before this existed, so nothing changes by itself. To
give the writing persona `zahavi` its own voice, upload `voice_zahavi.wav`; to
split the default reporter off as well, upload a new `reference_voice_final.wav`
(the default stays the fallback, so keep one).

How the clip is chosen (DESIGN.md §2.70.1):

1. When the organiser tells the app to write a report, the Worker remembers
   **which persona wrote that draft**, next to the draft's fingerprint. When the
   organiser publishes it, the persona is stored with the recap. The app is
   never trusted to say which persona it was — a published recap is read in the
   voice of the persona that actually wrote it.
2. 🎙️ sends that persona's key to the voice server with the text.
3. The voice server looks for `voice_<key>.wav`, and falls back to the default
   clip if there isn't one (it logs that it did).

A recap written before this existed, or by a persona that has since been
removed, is read in the default voice.

Each voice's recording is stored apart, so a night written once by `default`
and re-written by `zahavi` doesn't get the wrong voice from a cached file. The
default voice's cache is unchanged, so nothing that was already recorded has to
be made again.

**Tips for a clip** are the same as for the first one (`voice/README.md`): 15–25
seconds of one person speaking, no music or echo, **left exactly as recorded**
— the model copies the clip's *pace and pauses*, so a clip spoken calmly with
real pauses gives a calm reading, and trimming the silences out of it makes the
voice rush.

> Same reminder as everywhere else: a cloned voice must be of someone who
> agreed to it. The clip stays in the private dataset, and every output keeps
> its AI watermark, its AI tags, and the "AI voice" line when shared.
