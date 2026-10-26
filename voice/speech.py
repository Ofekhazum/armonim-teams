# Hebrew text in, an MP3 in the reference voice out (DESIGN.md §2.69).
#
# Plain functions with no Modal in them, so the same code runs in the GPU
# container (modal_app.py) and on a laptop CPU for testing. It knows nothing
# about football, fixtures or the club: the Worker decides what is said — the
# night's stored Gemini recap, cleaned for speech by `speakable()` — and this
# only says it.
#
# Per sentence-sized chunk:
#   phonikud-onnx    adds the vowel marks Hebrew text leaves out — without them
#                    "ספר" is a book, a barber or a count, and a TTS model guesses
#   Chatterbox MTL   zero-shot multilingual TTS, language "he", conditioned on
#                    the reference clip. It applies Resemble's PerTh watermark to
#                    every chunk inside generate(); there is no switch to turn
#                    that off and none is wanted
# then the chunks are joined, loudness-normalised and encoded to MP3 by ffmpeg.

import os
import re
import subprocess
import tempfile

# A recap is 1,400–2,900 characters. Anything far past that is not a recap.
MAX_CHARS = 6000

# Chatterbox stops after 1000 speech tokens (~40 s of audio) per call, and
# Resemble's own demo caps a call at 300 characters. Below that, with headroom:
# a chunk that runs out of tokens is cut off mid-word, silently.
CHUNK_CHARS = 240

# Pauses stitched between chunks, in seconds. A sentence break inside a
# paragraph is a breath; a paragraph break is a beat longer.
GAP_SENTENCE = 0.25
GAP_PARAGRAPH = 0.6

PHONIKUD_REPO = "thewh1teagle/phonikud-onnx"
PHONIKUD_FILE = "phonikud-1.0.int8.onnx"

# What ChatterboxMultilingualTTS.from_pretrained() downloads, listed so the
# image can bake exactly these in at build time.
CHATTERBOX_REPO = "ResembleAI/chatterbox"
CHATTERBOX_FILES = [
    "ve.pt",
    "t3_mtl23ls_v2.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "Cangjie5_TC.json",
]


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
    for paragraph in (p.strip() for p in text.split("\n")):
        if not paragraph:
            continue
        current = ""
        for sentence in (s for s in re.split(r"(?<=[.!?])\s+", paragraph) if s):
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


def prepare_reference(src: str, dst: str) -> str:
    """
    The clip as the model should hear it (§2.69.1).

    Chatterbox clones from the first 10 s of the clip, and takes the speaking
    style from the first 6 s alone. The real clip spent a third of those 6 s in
    pauses (3.8 s of actual speech), with a noise floor around -47 dB the
    model learns as part of "the voice". So: mono, gentle denoise, every pause
    cut to about 0.12 s, and an even level — the same treatment for any clip
    uploaded later, with nothing done by hand.

    Measured on the real clip: 4.8 s of speech in the first 6 s (was 3.8) and
    8.4 s in the first 10 (was 7.0). Trimming harder (-35 dB, 0.08 s kept)
    gained half a second more but clipped soft final consonants before a pause
    — Whisper heard "חדש" as "חד" — so this stops short of that.
    """
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-i", src,
            "-af",
            "aformat=channel_layouts=mono,"
            "afftdn=nr=20:nf=-45,"
            "silenceremove=start_periods=1:start_threshold=-38dB:detection=peak:"
            "stop_periods=-1:stop_duration=0.12:stop_threshold=-38dB:stop_silence=0.12,"
            "loudnorm=I=-20:TP=-2:LRA=11",
            "-ar", "24000",
            dst,
        ],
        check=True,
    )
    return dst


def load_model(device: str):
    """Chatterbox and the diacritizer, ready to speak."""
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from huggingface_hub import hf_hub_download
    from phonikud_onnx import Phonikud

    # A string, not a torch.device: Chatterbox decides whether to remap its
    # CUDA-saved weights onto the CPU with `device in ["cpu", "mps"]`, which a
    # torch.device never satisfies.
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    diacritizer = Phonikud(hf_hub_download(PHONIKUD_REPO, PHONIKUD_FILE))
    return model, diacritizer


def vocalise(diacritizer, text: str) -> str:
    """Vowel marks, in the form Chatterbox's Hebrew tokens were trained on."""
    from phonikud import lexicon

    # Phonikud also emits its own stress and vowel-length marks. Chatterbox's
    # Hebrew tokens were trained on standard nikud, so those are stripped —
    # the same step phonikud-chatterbox takes.
    return re.sub(f"[{lexicon.NON_STANDARD_DIAC}]", "", diacritizer.add_diacritics(text))


def speak_wav(model, diacritizer, reference: str, text: str):
    """The recap as one float32 waveform, and its sample rate."""
    import numpy as np

    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")
    if len(text) > MAX_CHARS:
        raise ValueError("text too long")

    # The voice is read from the clip once per recap, not once per chunk.
    model.prepare_conditionals(reference)

    parts = []
    for chunk, pause in chunks(text):
        wav = model.generate(vocalise(diacritizer, chunk), language_id="he")
        parts.append(wav.squeeze(0).cpu().numpy())
        parts.append(np.zeros(int(model.sr * pause), dtype=np.float32))
    return np.concatenate(parts[:-1]), model.sr


def encode_mp3(audio, sample_rate: int) -> bytes:
    import soundfile as sf

    with tempfile.TemporaryDirectory() as workdir:
        wav_path = os.path.join(workdir, "recap.wav")
        mp3_path = os.path.join(workdir, "recap.mp3")
        sf.write(wav_path, audio, sample_rate)
        # Mono 64 kbps is ~0.5 MB a minute and indistinguishable from the WAV
        # for speech on a phone speaker. loudnorm evens out chunk-to-chunk
        # level differences. The tags say what this is, so the file carries
        # that wherever it is forwarded.
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
        with open(mp3_path, "rb") as f:
            return f.read()


def speak_mp3(model, diacritizer, reference: str, text: str) -> bytes:
    return encode_mp3(*speak_wav(model, diacritizer, reference, text))
