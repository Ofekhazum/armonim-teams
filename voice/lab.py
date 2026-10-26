# The likeness comparison's logic, as plain functions with no Modal in them
# (compare_app.py wraps them), so it can be exercised on a laptop CPU.
#
# What is being compared is how closely a recording sounds like the reference
# voice — nothing else. Every variant reads the *same fixed paragraph*, so the
# only thing that differs between the files is the model, the clip treatment
# and the extra conversion pass.

import io
import os
import subprocess
import tempfile
import time

from speech import chunks


def _timed(fn):
    start = time.time()
    wav, sr = fn()
    return {"wav": wav, "sr": sr, "seconds": round(time.time() - start, 1)}


def _failed(err: Exception) -> dict:
    return {"error": f"{type(err).__name__}: {err}"[:300]}


def slow(wav, sr: int, tempo: float):
    """
    The same audio at `tempo` times the speed (0.85 = 15% slower), pitch
    unchanged — ffmpeg's `atempo`, which is clean for speech between 0.5 and 2.
    """
    import numpy as np
    import soundfile as sf

    with tempfile.TemporaryDirectory() as work:
        src, dst = os.path.join(work, "in.wav"), os.path.join(work, "out.wav")
        sf.write(src, wav, sr)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", f"atempo={tempo}", dst],
            check=True,
        )
        out, _ = sf.read(dst, dtype="float32")
    return np.asarray(out, dtype="float32")


def vox_speak(model, text: str, style: str = "", **cloning):
    """
    VoxCPM2 reading `text` the way the Chatterbox pipeline reads it: a sentence
    or two at a time with a breath between, longer between paragraphs.

    Round one gave VoxCPM2 the whole paragraph at once. It ran straight
    through, with no breaths, at the pace of the clip — 14.2 s against 18.4 s
    for the same words through Chatterbox, and it sounded like 1.5x speed.
    """
    import numpy as np

    sr = model.tts_model.sample_rate
    parts = []
    for chunk, pause in chunks(text):
        wav = model.generate(
            text=f"{style}{chunk}", cfg_value=2.0, inference_timesteps=10, **cloning
        )
        parts.append(np.asarray(wav, dtype="float32"))
        parts.append(np.zeros(int(sr * pause), dtype="float32"))
    return np.concatenate(parts[:-1]), sr


def vox_variants(model, text: str, clean_clip: str, transcript: str):
    """
    D3  the clip and its transcript (VoxCPM2's strongest mode), with breaths
    D4  D3 at 85% speed
    D5  D3 at 75% speed
    D6  the clip alone, told to speak slowly and calmly, with breaths
    """
    out = {}
    try:
        d3 = _timed(
            lambda: vox_speak(
                model, text,
                reference_wav_path=clean_clip, prompt_wav_path=clean_clip, prompt_text=transcript,
            )
        )
        out["D3"] = d3
        for name, tempo in (("D4", 0.85), ("D5", 0.75)):
            out[name] = {"wav": slow(d3["wav"], d3["sr"], tempo), "sr": d3["sr"], "seconds": 0}
    except Exception as err:
        out["D3"] = _failed(err)
    try:
        out["D6"] = _timed(
            lambda: vox_speak(
                model, text, style="(speaking slowly and calmly, with natural pauses)",
                reference_wav_path=clean_clip,
            )
        )
    except Exception as err:
        out["D6"] = _failed(err)
    return out


def likeness(classifier, ref_wav_bytes: bytes, items: dict) -> dict:
    """
    How close each recording is to the reference voice, 0–1, from a speaker
    recognition model (ECAPA-TDNN) that none of the synthesisers is built on —
    one trained on Chatterbox's own speaker encoder would favour Chatterbox.

    Two different people score about 0.0–0.1 against each other; the same
    person in two recordings, 0.5–0.8. A *synthetic* voice rarely clears 0.6,
    so read these as a ranking, not as a grade.
    """
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio

    def embed(audio, sr):
        a = torch.from_numpy(np.asarray(audio, dtype="float32"))
        if a.ndim > 1:
            a = a.mean(dim=-1)
        a = torchaudio.functional.resample(a, sr, 16000)
        return classifier.encode_batch(a[None]).squeeze()

    data, sr = sf.read(io.BytesIO(ref_wav_bytes), dtype="float32")
    ref = embed(data, sr)
    return {
        name: round(float(torch.nn.functional.cosine_similarity(ref, embed(wav, wsr), dim=0)), 3)
        for name, (wav, wsr) in items.items()
    }
