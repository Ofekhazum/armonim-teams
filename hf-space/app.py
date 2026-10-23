# The night reporter's voice (DESIGN.md §2.69).
#
# One job: Hebrew text in, an MP3 of it read in the reference voice out. It
# knows nothing about football, fixtures or the club — the Worker decides what
# is said (the night's stored Gemini recap, cleaned for speech) and this only
# says it. That split is the point: a persona scriptwriter can replace the text
# later without anything here changing.
#
# **This is not an open text box.** The Space is private, the reference voice
# is fetched from a private repo at startup rather than committed here, and the
# one API function refuses any call that does not carry VOICE_SECRET — which
# only the Worker holds, and the Worker only ever sends a recap that Gemini
# wrote for a real night. Nobody can type a sentence into this and get the
# voice saying it, including from the Space's own page, which has no inputs.
#
# Pipeline, per sentence-sized chunk:
#   phonikud-onnx     adds the vowel marks Hebrew text leaves out — without
#                     them "ספר" is a book, a barber or a count, and a TTS model
#                     guesses
#   Chatterbox MTL    zero-shot multilingual TTS, language "he", conditioned on
#                     the reference clip. It applies Resemble's PerTh watermark
#                     to every chunk inside generate(); there is no switch to
#                     turn that off and none is wanted
# then the chunks are joined, loudness-normalised and encoded to MP3 by ffmpeg.

import hmac
import os
import re
import subprocess
import sys
import tempfile

# `spaces` has to be imported before anything initialises CUDA.
import spaces

# chatterbox-tts pins torch==2.6.0, and ZeroGPU only runs torch 2.8 or later.
# requirements.txt therefore installs chatterbox's dependencies itself (with a
# ZeroGPU-compatible torch), and the package goes in here without its pins.
# pip has no per-line --no-deps in a requirements file, which is why this is
# not there. Resemble's own ZeroGPU Spaces sidestep the same pin by vendoring
# the source instead.
try:
    import chatterbox  # noqa: F401
except ImportError:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "--no-deps", "chatterbox-tts==0.1.7"],
        check=True,
    )

import gradio as gr
import numpy as np
import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from huggingface_hub import hf_hub_download
from phonikud import lexicon
from phonikud_onnx import Phonikud

VOICE_SECRET = os.environ.get("VOICE_SECRET", "")
VOICE_REPO = os.environ.get("VOICE_REPO", "")
VOICE_FILE = os.environ.get("VOICE_FILE", "reference_voice.wav")
HF_TOKEN = os.environ.get("HF_TOKEN")

# A recap is 1,400–2,900 characters. Anything far past that is not a recap,
# and every character is GPU time out of a 5-minute daily allowance.
MAX_CHARS = 6000

# Chatterbox stops after 1000 speech tokens (~40 s of audio) per call, and the
# official demo caps a call at 300 characters. Below that, with headroom: a
# chunk that runs out of tokens is cut off mid-word, silently.
CHUNK_CHARS = 240

# Pauses stitched between chunks, in seconds. A sentence break inside a
# paragraph is a breath; a paragraph break is a beat longer.
GAP_SENTENCE = 0.25
GAP_PARAGRAPH = 0.6

# ZeroGPU only exists on Spaces. Locally this runs on CPU — slowly, but it is
# the same code path, which is what a local run is for.
DEVICE = "cuda" if (os.environ.get("SPACES_ZERO_GPU") or torch.cuda.is_available()) else "cpu"

# Loaded once, at module level: ZeroGPU wants models placed on CUDA at startup
# (it emulates CUDA outside @spaces.GPU), not moved there inside a GPU call.
# A string, not a torch.device: Chatterbox decides whether to remap its
# CUDA-saved weights onto the CPU with `device in ["cpu", "mps"]`, which a
# torch.device never satisfies.
MODEL = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
DIACRITIZER = Phonikud(hf_hub_download("thewh1teagle/phonikud-onnx", "phonikud-1.0.int8.onnx"))

# Local runs may point VOICE_FILE at a file on disk instead of a repo.
if VOICE_REPO:
    REFERENCE = hf_hub_download(VOICE_REPO, VOICE_FILE, repo_type="dataset", token=HF_TOKEN)
else:
    REFERENCE = VOICE_FILE
if not os.path.exists(REFERENCE):
    raise RuntimeError(f"reference voice not found: {REFERENCE}")

NON_STANDARD = re.compile(f"[{lexicon.NON_STANDARD_DIAC}]")


def vocalise(text: str) -> str:
    # Phonikud also emits its own stress and vowel-length marks. Chatterbox's
    # Hebrew tokens were trained on standard nikud, so those are stripped —
    # the same step phonikud-chatterbox takes.
    return NON_STANDARD.sub("", DIACRITIZER.add_diacritics(text))


def split_long(sentence: str) -> list[str]:
    """A sentence over CHUNK_CHARS, broken at commas, then at spaces."""
    if len(sentence) <= CHUNK_CHARS:
        return [sentence]
    out, current = [], ""
    for piece in re.split(r"(?<=,)\s+", sentence):
        words = [piece] if len(piece) <= CHUNK_CHARS else piece.split()
        for word in words:
            joined = f"{current} {word}".strip()
            if len(joined) <= CHUNK_CHARS:
                current = joined
            else:
                if current:
                    out.append(current)
                current = word
    if current:
        out.append(current)
    return out


def chunks(text: str) -> list[tuple[str, float]]:
    """(chunk, pause after it) — sentences packed up to CHUNK_CHARS each."""
    out: list[tuple[str, float]] = []
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    for paragraph in paragraphs:
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", paragraph) if s]
        current = ""
        for sentence in sentences:
            for piece in split_long(sentence):
                joined = f"{current} {piece}".strip()
                if len(joined) <= CHUNK_CHARS:
                    current = joined
                else:
                    if current:
                        out.append((current, GAP_SENTENCE))
                    current = piece
        if current:
            out.append((current, GAP_PARAGRAPH))
    return out


# One GPU call per chunk rather than one for the whole recap. ZeroGPU refuses a
# call whose *requested* duration is more than the quota left, so a single
# five-minute request would fail on any day some quota had already gone; short
# calls only spend what they use.
@spaces.GPU(duration=45)
def speak(text: str) -> np.ndarray:
    # Conditioning on the reference is redone per call: a ZeroGPU call runs in
    # its own process, so anything cached on MODEL inside one is gone by the
    # next. It costs well under a second.
    wav = MODEL.generate(text, language_id="he", audio_prompt_path=REFERENCE)
    return wav.squeeze(0).cpu().numpy()


def synthesize(text: str, secret: str) -> str:
    if not VOICE_SECRET or not hmac.compare_digest(secret or "", VOICE_SECRET):
        raise gr.Error("forbidden")
    text = (text or "").strip()
    if not text:
        raise gr.Error("empty text")
    if len(text) > MAX_CHARS:
        raise gr.Error("text too long")

    parts: list[np.ndarray] = []
    for chunk, pause in chunks(text):
        parts.append(speak(vocalise(chunk)))
        parts.append(np.zeros(int(MODEL.sr * pause), dtype=np.float32))
    audio = np.concatenate(parts[:-1]) if len(parts) > 1 else parts[0]

    workdir = tempfile.mkdtemp()
    wav_path = os.path.join(workdir, "recap.wav")
    mp3_path = os.path.join(workdir, "recap.mp3")
    sf.write(wav_path, audio, MODEL.sr)
    # Mono 64 kbps is ~0.5 MB a minute and indistinguishable from the WAV for
    # speech on a phone speaker. loudnorm evens out chunk-to-chunk level
    # differences and lands it near what a WhatsApp voice note plays at. The
    # tags say what this is, so the file carries that wherever it is forwarded.
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ac", "1", "-b:a", "64k",
            "-metadata", "title=Armonim recap (AI-generated voice)",
            "-metadata", "comment=Synthetic speech. Not a real recording.",
            mp3_path,
        ],
        check=True,
    )
    return mp3_path


# No visible inputs: the page of a private Space is reachable by its owner, and
# even there it should not be a place to type text for this voice. The hidden
# components exist only to give the API function its signature.
with gr.Blocks(title="Armonim recap voice") as demo:
    gr.Markdown("Private API for the Armonim app. Nothing to use here.")
    text_in = gr.Textbox(visible=False)
    secret_in = gr.Textbox(visible=False)
    audio_out = gr.File(visible=False)
    trigger = gr.Button(visible=False)
    trigger.click(synthesize, [text_in, secret_in], audio_out, api_name="synthesize")

# One at a time: two recaps at once would only split the same GPU quota.
demo.queue(default_concurrency_limit=1, max_size=4)

if __name__ == "__main__":
    demo.launch(show_error=True)
