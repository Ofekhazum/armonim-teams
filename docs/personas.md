# Adding a reporter persona

A persona restyles the night recap — the voice it's written in, the byline, the
delivery — without touching a single fact or safety rule (DESIGN.md §2.70). This
is how to add one.

Two separate things, and they're independent:

- **Part A — the writing.** Which style Gemini writes the report in. This works
  today, and it's four small edits.
- **Part B — the spoken voice.** Which cloned voice reads it aloud. **Today
  every recap is read in one shared voice**, whoever wrote it. Giving a persona
  its *own* voice is not wired yet — Part B explains what it would take.

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

**Current state.** The spoken recap (🎙️ on the night page) always uses a single
reference clip: `reference_voice_final.wav` in the private Hugging Face dataset
`ofh55/armonim-voice`. The Modal voice server loads that one clip and reads
*every* recap in it, no matter which persona wrote the text. So today, changing
the voice for everyone is just: upload a new clip to that dataset under that
name, and the next recording uses it (see `voice/README.md`).

**Per-persona voices are not built yet.** To make `noir` read in one voice and
`zahavi` in another, three things need to change — it's a small feature, not a
config step:

1. **Store which persona wrote a recap.** Right now the stored recap doesn't
   record its persona, so the voice server has no way to know. The recap record
   in KV would need a `persona` field.
2. **Pass it to the voice server.** `worker/recap-voice.js` would send the
   persona (or a voice key) along with the text when it starts a Modal job.
3. **Map persona → clip in Modal.** `voice/modal_app.py` would pick the clip by
   persona — e.g. fetch `voice_<persona>.wav` from the dataset, falling back to
   the shared clip when a persona has none. Each voice is still just a file in
   `ofh55/armonim-voice`.

Once that exists, "linking a voice" becomes: record a clip, upload it to the
dataset as `voice_<key>.wav`, and the persona with that key is read in it. Until
then, treat the voice as one shared setting.

> Reminder for Part B voices, same as everywhere else: a cloned voice must be of
> someone who agreed to it. The clip stays in the private dataset, and every
> output keeps its AI watermark, its AI tags, and the "AI voice" line when
> shared.

Want per-persona voices wired up? It's a good small next step — ask and it's a
single focused change across those three files.
