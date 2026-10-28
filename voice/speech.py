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

# How the text is broken up to be spoken (§2.69.1, §2.73). The model never
# pauses by itself — not at a full stop, not at a "!" — so every breath in the
# recording is one stitched in between chunks, and a chunk is spoken in one go.
# The text is therefore cut so that a breath falls at every sentence end, and
# no chunk runs longer than a person could say in one breath, however long the
# sentences are: the writing is left as wild as the persona wants it.
#
# Letters, points not counted, so pointed text breaks where unpointed text would.
# Short sentences are joined into a chunk of at most 140 letters, about 11
# seconds of speech (the 240 this replaced ran 15-18 seconds in a real recap, with
# up to three sentence ends inside and no pause at any).
CHUNK_CHARS = 140

# A sentence is never cut at a comma, and is kept whole up to this length (about
# 25 seconds). Each chunk is generated on its own, so the voice ends it the way
# it ends a sentence, falling; a break after a comma sounds like a full stop in
# the middle of a thought, which is worse than a long breath. Only a sentence
# past this, which a person could not say in one go either, is split, and then
# into as few and as equal pieces as it takes, at a comma if there is one near.
# The model's own limit (MAX_STEPS) is about 800 letters, well above it.
WHOLE_SENTENCE = 320

# Only a sentence of a word or two ("כן!") is joined to its neighbour instead of
# standing alone: a breath after one syllable sounds like a stammer, and a chunk
# that small is harder for the model to say. Anything longer gets its own breath
# — even "איזו בונבוניירה!" does, which is the whole point of the breaths.
SHORT_SENTENCE = 12

# Pauses stitched after a chunk, in seconds: after a break inside a very long
# sentence, a sentence end, and a paragraph end — each a beat longer than the last.
GAP_COMMA = 0.15
GAP_SENTENCE = 0.3
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
    """
    A sentence over WHOLE_SENTENCE, broken into pieces of about equal length.

    The last resort, for a sentence no one could say in one breath: broken at
    commas and semicolons where there are any, and only past that at spaces.
    Balanced rather than packed: a 340-letter sentence is two 170s, not a 320
    and a 20, because a stub sounds like the speaker ran out.
    """
    total = plain_len(sentence)
    if total <= WHOLE_SENTENCE:
        return [sentence]
    target = total / -(-total // WHOLE_SENTENCE)  # an equal share of the pieces it needs

    atoms: list[str] = []
    for piece in re.split(r"(?<=[,;])\s+", sentence):
        atoms.extend([piece] if plain_len(piece) <= WHOLE_SENTENCE else piece.split())

    out, current = [], ""
    for atom in atoms:
        joined = f"{current} {atom}".strip()
        # close the piece when the next atom would not fit, or would take it
        # further past its share than stopping here leaves it short of it
        over = plain_len(joined) - target
        short = target - plain_len(current)
        if current and (plain_len(joined) > WHOLE_SENTENCE or (over > 0 and over > short)):
            out.append(current)
            current = atom
        else:
            current = joined
    if current:
        out.append(current)
    return out


def chunks(text: str) -> list[tuple[str, float]]:
    """
    (chunk, pause after it): a breath at every sentence end, none of them long.

    Each sentence is its own chunk, with a pause after. A sentence too long to
    say in one breath (WHOLE_SENTENCE) is split, with a shorter pause at each
    split; a sentence shorter than that is never cut at its commas. A very
    short sentence joins its neighbour when they fit together.
    The last chunk of a paragraph gets the paragraph's longer pause.
    """
    out: list[tuple[str, float]] = []
    for paragraph in (p.strip() for p in text.split("\n")):
        if not paragraph:
            continue
        units: list[tuple[str, float]] = []
        for sentence in (s for s in re.split(r"(?<=[.!?])\s+", paragraph) if s):
            pieces = split_long(sentence)
            units.extend((piece, GAP_COMMA) for piece in pieces[:-1])
            units.append((pieces[-1], GAP_SENTENCE))

        merged: list[tuple[str, float]] = []
        for text_, pause in units:
            if merged:
                before, before_pause = merged[-1]
                # only across a sentence end: a comma break was made on purpose
                joins = before_pause == GAP_SENTENCE and (
                    plain_len(before) < SHORT_SENTENCE or plain_len(text_) < SHORT_SENTENCE
                )
                if joins and plain_len(f"{before} {text_}") <= CHUNK_CHARS:
                    merged[-1] = (f"{before} {text_}", pause)
                    continue
            merged.append((text_, pause))
        merged[-1] = (merged[-1][0], GAP_PARAGRAPH)
        out.extend(merged)
    return out


# A chunk is checked against the rest of the recording: the same speaker reads
# at nearly the same rate throughout (on real recaps, 13.0 letters a second give
# or take half a letter), so a chunk spoken much faster than that is one where the
# model dropped words or stopped before the end of the sentence, and one spoken
# much slower is one where it dragged or rambled. Only chunks long enough for the
# rate to mean something are judged.
CHECK_MIN_LETTERS = 40
TOO_FAST = 1.35  # times the recording's usual rate
TOO_SLOW = 0.65
RETRIES = 2  # extra tries for a chunk that fails the check; the best of them is kept


def usual_rate(letters: list[int], seconds: list[float]) -> float | None:
    """The recording's usual letters a second, or None if too few chunks to say."""
    rates = sorted(n / t for n, t in zip(letters, seconds) if n >= CHECK_MIN_LETTERS and t > 0)
    if len(rates) < 3:
        return None
    return rates[len(rates) // 2]


def off_pace(n: int, t: float, usual: float | None) -> bool:
    """True if a chunk of `n` letters spoken in `t` seconds is out of step with the rest."""
    if usual is None or n < CHECK_MIN_LETTERS or t <= 0:
        return False
    ratio = (n / t) / usual
    return ratio > TOO_FAST or ratio < TOO_SLOW


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
    todo = chunks(text)
    started = time.monotonic()

    def over_budget(i: int):
        if budget_s is not None and time.monotonic() - started > budget_s:
            raise TimeoutError(
                f"the recording ran out of time at chunk {i} of {len(todo)} ({int(budget_s)} s)"
            )

    def say(chunk: str):
        wav = model.generate(
            text=chunk, cfg_value=2.0, inference_timesteps=10, reference_wav_path=reference,
            max_len=MAX_STEPS,
        )
        return np.asarray(wav, dtype="float32")

    audio = []
    for i, (chunk, _) in enumerate(todo, 1):
        over_budget(i)
        t = time.monotonic()
        audio.append(say(chunk))
        print(
            f"chunk {i}/{len(todo)}: {plain_len(chunk)} letters -> {len(audio[-1]) / sr:.1f} s of speech"
            f" in {time.monotonic() - t:.1f} s",
            flush=True,
        )

    # a second look at the chunks that came out at a different pace to the rest
    letters = [plain_len(c) for c, _ in todo]
    usual = usual_rate(letters, [len(a) / sr for a in audio])
    for i, (chunk, _) in enumerate(todo):
        if not off_pace(letters[i], len(audio[i]) / sr, usual):
            continue
        best = audio[i]
        for attempt in range(1, RETRIES + 1):
            over_budget(i + 1)
            again = say(chunk)
            print(
                f"chunk {i + 1}/{len(todo)} retry {attempt}: {len(best) / sr:.1f} s -> {len(again) / sr:.1f} s"
                f" ({letters[i] / (len(best) / sr):.1f} letters/s, usual {usual:.1f})",
                flush=True,
            )
            # keep whichever lands nearer the usual pace
            if abs(letters[i] / (len(again) / sr) - usual) < abs(letters[i] / (len(best) / sr) - usual):
                best = again
            if not off_pace(letters[i], len(best) / sr, usual):
                break
        audio[i] = best

    parts = []
    for wav, (_, pause) in zip(audio, todo):
        parts.append(wav)
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
