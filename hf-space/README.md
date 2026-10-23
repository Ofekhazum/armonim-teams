---
title: Armonim recap voice
emoji: 🎙️
colorFrom: yellow
colorTo: red
sdk: gradio
sdk_version: 6.30.0
python_version: "3.12"
app_file: app.py
suggested_hardware: zero-a10g
pinned: false
short_description: Private TTS endpoint for the Armonim app
---

# Armonim recap voice

The Hugging Face Space behind the voiced night recap (DESIGN.md §2.69). It takes the text of a
recap, which the Worker cleans for speech, and returns an MP3 of it read in the reference voice.
Its only caller is the Worker.

Stack: [phonikud-onnx](https://huggingface.co/thewh1teagle/phonikud-onnx) adds the Hebrew vowel
marks, and [Chatterbox Multilingual](https://huggingface.co/ResembleAI/chatterbox) (MIT) does the
zero-shot voice cloning with `language_id="he"`. ffmpeg joins the pieces, levels the loudness and
encodes the MP3.

## Safeguards

These are part of the design, not optional extras. The voice is a real person's.

- **The Space has no text box.** Its single API function rejects any call that doesn't carry
  `VOICE_SECRET`. Only the Worker holds that secret, and the Worker only sends a recap that Gemini
  wrote for a real night.
- **The reference voice lives in a private repo**, which the Space downloads at startup. It is never
  committed to the Space, so the Space's files don't include it.
- **Every output is marked as synthetic.** Chatterbox applies Resemble's PerTh watermark inside
  `generate()`. The MP3's title and comment tags say it's an AI voice. The app names the file
  `…-AI-voice.mp3` and sends a line of text with it saying so.

## Setup

You need a Hugging Face account with a verified email that is more than 30 days old. That is what
a free account needs to host a ZeroGPU Space.

### 1. The reference voice: a private dataset repo

1. Go to <https://huggingface.co/new-dataset>, name it `armonim-voice` and set it to **Private**.
2. Upload the clip as `reference_voice.wav`. For a good clone:
   - Use 10–15 seconds of one person speaking, with no music, applause or room echo.
   - Put the cleanest stretch first. Chatterbox uses the first 10 seconds for the voice and the
     first 6 for the speaking style, and ignores the rest.
   - A WAV at 24 kHz or higher, in mono, is ideal. Anything librosa can read will work.

### 2. A token

Create a **fine-grained** token at <https://huggingface.co/settings/tokens/new?tokenType=fineGrained>.
Under *Repositories permissions*, give it **read** access to:

- the dataset `<you>/armonim-voice`, so the Space can download the clip
- the Space `<you>/armonim-recap-voice` (step 3), so the Worker can call it

Use the same token in both places. It's tied to your account, so the Space's GPU time comes out
of your daily ZeroGPU allowance, which is 5 minutes on a free account.

### 3. The Space

1. Go to <https://huggingface.co/new-space> and fill it in:
   - Name: `armonim-recap-voice`
   - SDK: **Gradio**
   - Hardware: **ZeroGPU**
   - Visibility: **Private**. If a free account can't make a private ZeroGPU Space, Public still
     works, because the secret check and the private voice repo don't depend on it. Private is
     better because it also hides the endpoint.
2. Add the four files from this folder (`README.md`, `app.py`, `requirements.txt` and
   `packages.txt`), either by uploading them on the web or with git:

   ```sh
   git clone https://huggingface.co/spaces/<you>/armonim-recap-voice
   cp hf-space/* armonim-recap-voice/
   cd armonim-recap-voice && git add . && git commit -m "Recap voice" && git push
   ```

3. In the Space's **Settings**, add:
   - Variable `VOICE_REPO`: `<you>/armonim-voice`
   - Secret `HF_TOKEN`: the token from step 2
   - Secret `VOICE_SECRET`: a long random string, for example from `openssl rand -hex 32`. Keep a
     copy, because the Worker needs the same value.
4. Wait for the build. The first one takes several minutes because it installs torch and
   downloads about 3 GB of weights. The logs should end with `Running on local URL`.

### 4. The Worker

Run these from `worker/`:

```sh
npx wrangler secret put HF_SPACE_URL   # https://<you>-armonim-recap-voice.hf.space
npx wrangler secret put HF_TOKEN       # the same token
npx wrangler secret put VOICE_SECRET   # the same value as the Space's
npx wrangler deploy                    # also adds the RecapVoice Durable Object
```

The Worker's URL for the Space is the `*.hf.space` address, not the `huggingface.co/spaces/...`
page.

## Running it locally

`spaces.GPU` does nothing off Hugging Face, so the same file runs on a laptop CPU. It's slow, but
it runs exactly the same code:

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt gradio==6.30.0
VOICE_FILE=/path/to/any_voice.wav VOICE_SECRET=local python app.py
```

Then call it the same way the Worker does:

```sh
curl -s -X POST localhost:7860/gradio_api/call/synthesize \
  -H 'Content-Type: application/json' -d '{"data": ["שלום לכולם.", "local"]}'
curl -sN localhost:7860/gradio_api/call/synthesize/<event_id>
```

## What it costs

Measured locally on a laptop CPU, a warm model took about 40 seconds to make 14 seconds of speech.
ZeroGPU will be faster, but its speed hasn't been measured yet. Check the Space logs after the
first real run. Recaps run 1,400–2,900 characters, which is 1.5–3.5 minutes of audio, against a
free account's 5 GPU-minutes a day. The Worker separately limits recordings to four a day per IP
address.

When the Space hasn't been used for a while it goes to sleep. Waking it adds a few minutes, and the
app shows a timer while it waits.
