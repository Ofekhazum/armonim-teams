# Hebrew text in, an MP3 in the reference voice out (DESIGN.md §2.69, §2.69.1).
#
# Plain functions with no Modal in them, so the same code runs in the GPU
# container (modal_app.py) and on a laptop for testing. It knows nothing about
# football, fixtures or the club: the Worker decides what is said — the night's
# stored Gemini recap, cleaned for speech by `speakable()` — and this only says
# it.
#
# The engine is VoxCPM2, chosen over Chatterbox on a listening comparison. What
# that comparison settled, all of it measured rather than assumed:
#
# - The clip goes in **as uploaded**. VoxCPM2 copies the rhythm of its clip, and
#   a version with the pauses trimmed out made it read fast with no stops.
# - **Reference-only** mode. Given the clip *with its transcript* it spills the
#   last words of the clip at the start of its output, which in chunked
#   generation repeated at every chunk and sounded like stuttering.
# - **Chunked, with breaths stitched in.** It never pauses between sentences by
#   itself (no silence over 0.25 s in 16 s of speech, against two for
#   Chatterbox), and over a full recap in one go it rushed and dropped about 40
#   of 222 words. Chunked, it read every word with a clear pause between
#   paragraphs.
# - It does **not watermark**. Chatterbox did, inside generate(). Here the same
#   Resemble PerTh watermark is applied to the finished audio. Checked: the
#   detector reads 0.0 before, 1.0 after, and 1.0 again after loudness
#   normalisation and a 64 kbps MP3 round trip, at 24 kHz and 48 kHz.

import os
import re
import subprocess
import tempfile
import time

# A recap is 1,400–2,900 letters. With vowel points (§2.71) it is nearly twice
# that in characters, so the limit is on characters as received. Anything far
# past it is not a recap.
MAX_CHARS = 12000

# Hebrew vowel points and cantillation. Not the maqaf (U+05BE), paseq or sof
# pasuq, which are punctuation and sit inside the same block.
POINTS = re.compile("[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]")


def plain_len(text: str) -> int:
    """Length as it is spoken: the vowel points are not extra speech."""
    return len(POINTS.sub("", text))

# Sentences are packed into chunks up to this many letters (points not counted,
# so pointed text breaks where unpointed text would). It sets how
# often a breath falls: roughly every sentence or two, which is where the
# Chatterbox version the club first heard had them.
CHUNK_CHARS = 240

# Pauses stitched between chunks, in seconds. A sentence break inside a
# paragraph is a breath; a paragraph break is a beat longer.
GAP_SENTENCE = 0.25
GAP_PARAGRAPH = 0.6

VOX_REPO = "openbmb/VoxCPM2"

# The reference clips live in a private dataset (modal_app.py). The default is
# the fallback for every persona that has no clip of its own.
VOICE_FILE = "reference_voice_final.wav"
VOICE_PREFIX = "voice_"  # a persona's own clip: voice_<persona>.wav

# The most time one recording may spend generating, measured from when the job
# starts running (a cold container's load is not part of it). Checked between
# chunks. Modal's own limit kills a call without a word, which the app sees as
# a recording that never finishes; this one ends it with a reason, and sits
# inside both Modal's limit and the Worker's (which gives up at fourteen minutes).
BUDGET_S = 10 * 60

# The most generation steps one chunk may take. A step is one patch of audio:
# 4 latent frames of 40 ms, so 0.16 s. A normal chunk (240 characters, 15–20 s of
# speech) needs about 150. The library's own limit is 4,096 steps — eleven
# minutes of audio from a single chunk that never finds its end — and it retries
# a bad attempt up to three more times, which is how one chunk can hold the GPU
# until the job times out. 400 steps is 64 s: nearly three times what a real
# chunk needs, and the worst case becomes about a minute instead of ten.
MAX_STEPS = 400


def reference_names(voice: str) -> list[str]:
    """The clips to look for, best first: a persona's own, then the default."""
    return [VOICE_FILE] if voice == "default" else [f"{VOICE_PREFIX}{voice}.wav", VOICE_FILE]


def find_reference(voice: str, fetch, is_missing) -> str:
    """
    The path of the clip for `voice`.

    `fetch(name)` downloads one and raises if it can't; `is_missing(err)` says
    whether that error means "no such file" (try the next) rather than anything
    else (a bad token, no network — which must not be taken for a missing clip).
    Asked per recording rather than when the container starts, so a missing clip
    is an error on the recording that needs it, in seconds, instead of a
    container that crashes before it can say anything.
    """
    names = reference_names(voice)
    for name in names:
        try:
            path = fetch(name)
        except Exception as err:
            if not is_missing(err):
                raise
            continue
        if name != names[0]:
            print(f"no clip {names[0]!r}; reading {voice!r} in {name!r}", flush=True)
        return path
    raise FileNotFoundError(
        f"no reference clip in the voice dataset (looked for {', '.join(names)})"
    )


def split_long(sentence: str) -> list[str]:
    """A sentence over CHUNK_CHARS, broken at commas, then at spaces."""
    if plain_len(sentence) <= CHUNK_CHARS:
        return [sentence]
    out, current = [], ""
    for piece in re.split(r"(?<=,)\s+", sentence):
        words = [piece] if plain_len(piece) <= CHUNK_CHARS else piece.split()
        for word in words:
            joined = f"{current} {word}".strip()
            if plain_len(joined) <= CHUNK_CHARS:
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
                if plain_len(joined) <= CHUNK_CHARS:
                    current = joined
                else:
                    if current:
                        out.append((current, GAP_SENTENCE))
                    current = piece
        if current:
            out.append((current, GAP_PARAGRAPH))
    return out


def load_vox(device: str = "cuda"):
    from voxcpm import VoxCPM

    # No denoiser (it would clean the reference, which hurt) and no torch.compile
    # (a long first-request stall for a model that runs a few times a week).
    return VoxCPM.from_pretrained(VOX_REPO, load_denoiser=False, optimize=False, device=device)


def speak_vox_wav(model, reference: str, text: str, budget_s: float | None = BUDGET_S):
    """
    The recap as one float32 waveform, and its sample rate.

    Logs one line a chunk — letters, seconds of speech, seconds taken — so a slow
    recording says where it was slow. Raises TimeoutError once `budget_s` seconds
    have gone, between chunks.
    """
    import numpy as np

    text = (text or "").strip()
    if not text:
        raise ValueError("empty text")
    if len(text) > MAX_CHARS:
        raise ValueError("text too long")

    sr = model.tts_model.sample_rate
    parts = []
    todo = chunks(text)
    started = time.monotonic()
    for i, (chunk, pause) in enumerate(todo, 1):
        if budget_s is not None and time.monotonic() - started > budget_s:
            raise TimeoutError(
                f"the recording ran out of time at chunk {i} of {len(todo)} ({int(budget_s)} s)"
            )
        t = time.monotonic()
        wav = model.generate(
            text=chunk, cfg_value=2.0, inference_timesteps=10, reference_wav_path=reference,
            max_len=MAX_STEPS,
        )
        audio = np.asarray(wav, dtype="float32")
        print(
            f"chunk {i}/{len(todo)}: {plain_len(chunk)} letters -> {len(audio) / sr:.1f} s of speech"
            f" in {time.monotonic() - t:.1f} s",
            flush=True,
        )
        parts.append(audio)
        parts.append(np.zeros(int(sr * pause), dtype="float32"))
    return np.concatenate(parts[:-1]), sr


_watermarker = None


def watermark(audio, sample_rate: int):
    """Resemble's PerTh mark, the one Chatterbox applies on its own."""
    import numpy as np
    import perth

    global _watermarker
    if _watermarker is None:
        # perth sets its watermarker to None, without a word, if any of its own
        # imports fails. Unmarked audio must never go out because a package was
        # missing, so that is an error here, not a quiet pass-through.
        if perth.PerthImplicitWatermarker is None:
            raise RuntimeError("the AI watermark is unavailable (perth failed to import)")
        _watermarker = perth.PerthImplicitWatermarker()
    return np.asarray(_watermarker.apply_watermark(audio, sample_rate=sample_rate), dtype="float32")


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


def speak_vox_mp3(model, reference: str, text: str, budget_s: float | None = BUDGET_S) -> bytes:
    audio, sr = speak_vox_wav(model, reference, text, budget_s)
    return encode_mp3(watermark(audio, sr), sr)
