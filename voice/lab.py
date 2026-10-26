# The likeness comparison's logic, as plain functions with no Modal in them
# (compare_app.py wraps them), so it can be exercised on a laptop CPU.
#
# What is being compared is how closely a recording sounds like the reference
# voice — nothing else. Every variant reads the *same fixed paragraph*, so the
# only thing that differs between the files is the model, the clip treatment
# and the extra conversion pass.

import io
import time


def _timed(fn):
    start = time.time()
    wav, sr = fn()
    return {"wav": wav, "sr": sr, "seconds": round(time.time() - start, 1)}


def _failed(err: Exception) -> dict:
    return {"error": f"{type(err).__name__}: {err}"[:300]}


def vox_variants(model, text: str, clip: str, transcript: str):
    """
    VoxCPM2 on the clip *exactly as uploaded* — no cleaning, no trimming.

    Rounds one and two gave it the cleaned clip, whose pauses had been cut to
    0.12 s. VoxCPM2 copies the rhythm of its clip, so that taught it to speak
    without pausing: fast, with no stop after a sentence, and stuttering where
    the cuts were. Chatterbox does not read rhythm from the clip the same way,
    which is why cleaning helped it and hurt this.

    D7  the clip as a voice reference *and* as a prompt with its transcript
    D8  the clip as a voice reference only
    D9  the clip as a prompt with its transcript only (continuation)
    """
    sr = model.tts_model.sample_rate
    text = text.replace("\n", " ")
    out = {}
    for name, cloning in (
        ("D7", {"reference_wav_path": clip, "prompt_wav_path": clip, "prompt_text": transcript}),
        ("D8", {"reference_wav_path": clip}),
        ("D9", {"prompt_wav_path": clip, "prompt_text": transcript}),
    ):
        try:
            out[name] = _timed(
                lambda: (
                    model.generate(text=text, cfg_value=2.0, inference_timesteps=10, **cloning),
                    sr,
                )
            )
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
