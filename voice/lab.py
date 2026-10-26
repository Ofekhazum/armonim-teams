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


def vox_variants(model, text: str, clip: str):
    """
    A whole recap, the clip as uploaded, voice reference only.

    F8   the text in one go, no breaths — what D8 did, at full length
    F10  the production path: speech.speak_vox_wav, breaths between chunks

    Both are watermarked, as production is.
    """
    from speech import speak_vox_wav, watermark

    def one_shot():
        wav = model.generate(
            text=text.replace("\n", " "), cfg_value=2.0, inference_timesteps=10,
            reference_wav_path=clip,
        )
        return watermark(wav, model.tts_model.sample_rate), model.tts_model.sample_rate

    def production():
        wav, sr = speak_vox_wav(model, clip, text)
        return watermark(wav, sr), sr

    out = {}
    for name, run in (("F8", one_shot), ("F10", production)):
        try:
            out[name] = _timed(run)
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
