# Armonim recap voice (Modal)

The voice server behind the voiced night recap (DESIGN.md §2.69). It takes the text of a recap,
which the Worker cleans for speech, and returns an MP3 of it read in the reference voice. Its only
caller is the Worker.

- `speech.py`: the pipeline, as plain Python. [phonikud-onnx](https://huggingface.co/thewh1teagle/phonikud-onnx)
  adds the Hebrew vowel marks, [Chatterbox Multilingual](https://huggingface.co/ResembleAI/chatterbox)
  (MIT) does the zero-shot voice cloning with `language_id="he"`, and ffmpeg levels the loudness and
  encodes the MP3.
- `modal_app.py`: wraps the pipeline for Modal. `Voice` runs it on a T4 GPU, and `web` is the
  endpoint the Worker calls: `POST /jobs` to queue a recap, `GET /jobs/{id}?wait=100` to collect
  the MP3.

## Safeguards

These are part of the design, not optional extras. The voice is a real person's.

- **There's no open endpoint.** `requires_proxy_auth=True` means Modal itself rejects any request
  without this workspace's proxy-auth token, returning 401 before any container starts. Only the
  Worker holds the token, and the Worker only sends a recap that Gemini wrote for a real night.
- **The reference voice lives in a private Hugging Face dataset** (`ofh55/armonim-voice`). A
  container fetches it at startup with a token kept in a Modal Secret. It never sits in this repo
  or in the image.
- **Every output is marked as synthetic.** Chatterbox applies Resemble's PerTh watermark inside
  `generate()`. The MP3's title and comment tags say it's an AI voice. The app names the file
  `…-AI-voice.mp3` and sends a line of text with it saying so.

## Setup without the CLI (dashboard + GitHub Actions)

Modal's CLI uses gRPC, which TLS-inspecting corporate proxies such as Netskope tend to cut
("Connection lost" from `modal setup`). This route needs only a browser. A phone is enough.

1. **A Modal API token for GitHub.** In the Modal dashboard, go to Settings → API Tokens and create
   a token. Copy its ID and secret.
2. **GitHub secrets.** At `github.com/<owner>/armonim-teams/settings/secrets/actions`, add
   `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` with those two values.
3. **The HF token as a Modal Secret.** In the Modal dashboard, go to Secrets → Create → Custom.
   Name it `armonim-voice` and give it one key, `HF_TOKEN`, set to a fine-grained Hugging Face
   token with read access to `ofh55/armonim-voice` only.
4. **Deploy.** `.github/workflows/deploy-voice.yml` runs `modal deploy` on every push that
   changes `voice/`. To re-run it, open the Actions tab → *Deploy recap voice to Modal* → the
   latest run → *Re-run jobs*. The log ends with the endpoint's URL, which is also shown in the
   Modal dashboard under Apps → `armonim-recap-voice`.
5. **The proxy-auth token** and **the Worker:** steps 4 and 6 below.

## Setup with the CLI

Run all of these from the repo root.

### 1. A Modal account and the CLI

1. Sign up at <https://modal.com>. The free Starter plan includes $30 of compute a month. Check
   <https://modal.com/pricing> for the current terms.
2. Install the CLI and log in. This opens a browser to connect it to your account:

   ```sh
   pip install modal
   modal setup
   ```

### 2. The reference voice

The clip goes in the private dataset `ofh55/armonim-voice`, named `reference_voice_final.wav`.

For a good clone:

- Use 10–15 seconds of one person speaking, with no music, applause or room echo.
- Put the cleanest stretch first. Chatterbox uses the first 10 seconds for the voice and the first 6
  for the speaking style, and ignores the rest.
- A mono WAV at 24 kHz or higher is ideal, but most audio formats will work.

Create a **fine-grained** Hugging Face token at
<https://huggingface.co/settings/tokens/new?tokenType=fineGrained> with **read** access to that
dataset, and nothing else. Then hand it to Modal as a Secret:

```sh
modal secret create armonim-voice HF_TOKEN=hf_...
```

### 3. Deploy

```sh
modal deploy voice/modal_app.py
```

The first deploy takes several minutes, because it builds the image with torch and about 3 GB of
model weights. Later deploys reuse that image. When it finishes, it prints the endpoint's URL:

```
https://<workspace>--armonim-recap-voice-web.modal.run
```

### 4. A proxy-auth token

In the Modal dashboard, go to **Settings → Proxy Auth Tokens**
(<https://modal.com/settings/proxy-auth-tokens>) and create a token. Copy both parts:

- the **Token ID**, which starts with `wk-`
- the **Token Secret**, which starts with `ws-`

The secret is only shown once.

### 5. Check it before the Worker does (optional)

```sh
URL=https://<workspace>--armonim-recap-voice-web.modal.run
KEY=wk-...
SECRET=ws-...

# without the token: Modal itself refuses (401)
curl -s -o /dev/null -w '%{http_code}\n' -X POST $URL/jobs

# queue a sentence: prints {"call_id":"fc-..."}
curl -s -X POST $URL/jobs -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" \
  -H 'Content-Type: application/json' -d '{"text": "שלום לכולם, זאת בדיקה."}'

# collect it: 200 and an MP3, or 202 if it's still going (run it again)
curl -s "$URL/jobs/<call_id>?wait=100" -H "Modal-Key: $KEY" -H "Modal-Secret: $SECRET" \
  -o test.mp3 -w '%{http_code}\n'
```

The first call starts a cold GPU, so expect to wait about a minute. The run's logs in the Modal
dashboard show how long each part took.

### 6. The Worker

Run these from `worker/`:

```sh
npx wrangler secret put VOICE_URL      # https://<workspace>--armonim-recap-voice-web.modal.run
npx wrangler secret put MODAL_KEY      # the Token ID (wk-…)
npx wrangler secret put MODAL_SECRET   # the Token Secret (ws-…)
npx wrangler deploy                    # also adds the RecapVoice Durable Object
```

## Running it locally

`speech.py` has no Modal in it, so it runs on a laptop CPU. It's slow, but it runs exactly the same
code:

```python
from speech import load_model, speak_mp3
model, diacritizer = load_model("cpu")
open("out.mp3", "wb").write(speak_mp3(model, diacritizer, "voice.wav", "שלום לכולם."))
```

On a laptop CPU, a warm model took 40–70 seconds to make 14 seconds of speech. A T4 will be much
faster, but this hasn't been measured yet.

## What it costs

A T4 costs about $0.59 an hour, billed by the second. That covers only the time a container is
running: a cold start, the recap itself, and two idle minutes afterwards in case you want a second
take. A long recap should cost a few cents, so the free $30 covers far more than one a week.
