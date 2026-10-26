# The likeness comparison's logic, as plain functions with no Modal in them
# (compare_app.py wraps them), so it can be exercised on a laptop CPU.
#
# What is being compared is how closely a recording sounds like the reference
# voice — nothing else. Every variant reads the *same fixed paragraph*, so the
# only thing that differs between the files is the model, the clip treatment
# and the extra conversion pass.

import io
import re
import time

from speech import chunks


def _timed(fn):
    start = time.time()
    wav, sr = fn()
    return {"wav": wav, "sr": sr, "seconds": round(time.time() - start, 1)}


def _failed(err: Exception) -> dict:
    return {"error": f"{type(err).__name__}: {err}"[:300]}


def sentences(text: str):
    """(sentence, pause after it): a breath between sentences, a longer one between paragraphs."""
    out = []
    for paragraph in (p.strip() for p in text.split("\n")):
        if not paragraph:
            continue
        parts = [s for s in re.split(r"(?<=[.!?])\s+", paragraph) if s]
        for i, sentence in enumerate(parts):
            out.append((sentence, 0.7 if i == len(parts) - 1 else 0.4))
    return out


def vox_speak(model, pieces, **cloning):
    """VoxCPM2 reading `pieces` one at a time, with silence stitched between."""
    import numpy as np

    sr = model.tts_model.sample_rate
    parts = []
    for piece, pause in pieces:
        wav = model.generate(text=piece, cfg_value=2.0, inference_timesteps=10, **cloning)
        parts.append(np.asarray(wav, dtype="float32"))
        parts.append(np.zeros(int(sr * pause), dtype="float32"))
    return np.concatenate(parts[:-1]), sr


def vox_variants(model, text: str, clip: str):
    """
    VoxCPM2, the clip as uploaded, as a voice reference only, with breaths.

    Findings that shape this (rounds one to three):
    - It copies the *rhythm* of its clip, and the cleaned clip had its pauses
      cut out, so it was given the clip untouched.
    - Given the clip *with its transcript* (prompt mode) it spills the last
      words of the clip at the start of its output — "…האם הוא חוזר" — which
      in chunked generation repeated at the start of every chunk: the
      stuttering. Reference-only mode has no such leak.
    - Either way it never pauses between sentences on its own (zero silences
      over 0.25 s in a 16 s paragraph, against two in Chatterbox's).

    D10  breaths the way Chatterbox's pipeline has them: masthead, then the body
    D11  a breath after every sentence
    """
    out = {}
    for name, pieces in (("D10", chunks(text)), ("D11", sentences(text))):
        try:
            out[name] = _timed(lambda: vox_speak(model, pieces, reference_wav_path=clip))
        except Exception as err:
            out[name] = _failed(err)
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
