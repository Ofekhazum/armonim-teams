# The likeness comparison's logic, as plain functions with no Modal in them
# (compare_app.py wraps them), so it can be exercised on a laptop CPU.
#
# What is being compared is how closely a recording sounds like the reference
# voice — nothing else. Every variant reads the *same fixed paragraph*, so the
# only thing that differs between the files is the model, the clip treatment
# and the extra conversion pass.

import io
import os
import tempfile
import time

from speech import prepare_reference, speak_wav


def _timed(fn):
    start = time.time()
    wav, sr = fn()
    return {"wav": wav, "sr": sr, "seconds": round(time.time() - start, 1)}


def swap_t3(model, state) -> None:
    """
    Put another set of T3 weights into a loaded Chatterbox.

    After its first generation, T3 wraps itself in `patched_model`, which adds a
    second set of names to the state dict for the *same* tensors. Loading a
    saved state therefore reports those names as missing, and strict loading
    would refuse. They are expected to be the only ones: anything else missing
    or unexpected is a real mismatch and must still fail.
    """
    result = model.t3.load_state_dict(state, strict=False)
    stray = [k for k in result.missing_keys if not k.startswith("patched_model.")]
    if stray or result.unexpected_keys:
        raise RuntimeError(f"T3 weights do not fit: missing {stray[:3]}, unexpected {result.unexpected_keys[:3]}")


def _failed(err: Exception) -> dict:
    return {"error": f"{type(err).__name__}: {err}"[:300]}


def chatterbox_variants(model, diacritizer, v2_state, v3_state, clip: str, text: str, work: str):
    """
    A  the model as it runs today (v2), on the clip as uploaded
    B  the same, on the cleaned clip       — what cleaning alone buys
    C  Chatterbox V3, on the cleaned clip  — what Resemble's newer weights buy

    Returns the variants, and the cleaned clip's path (the later variants want it).
    """
    clean = prepare_reference(clip, os.path.join(work, "clean.wav"))
    out = {}
    for name, state, ref in (("A", v2_state, clip), ("B", v2_state, clean), ("C", v3_state, clean)):
        try:
            swap_t3(model, state)
            out[name] = _timed(lambda: speak_wav(model, diacritizer, ref, text))
        except Exception as err:  # one variant failing must not lose the others
            out[name] = _failed(err)
    return out, clean


def convert_voice(vc, wav, sr, clean_clip: str):
    """
    The conversion pass: re-voice finished audio towards the reference clip.
    Chatterbox's own converter, which reuses the speaker model its synthesiser
    is built on, so nothing new is needed to run it.
    """
    import soundfile as sf

    with tempfile.TemporaryDirectory() as work:
        src = os.path.join(work, "in.wav")
        sf.write(src, wav, sr)
        out = vc.generate(src, target_voice_path=clean_clip)
    return out.squeeze(0).cpu().numpy(), vc.sr


def vox_variants(model, text: str, clean_clip: str, transcript: str):
    """
    D1  VoxCPM2 cloning from the clip alone
    D2  VoxCPM2 given the clip *and what is said in it* — its strongest mode
    """
    sr = model.tts_model.sample_rate
    out = {}
    for name, extra in (
        ("D1", {"reference_wav_path": clean_clip}),
        (
            "D2",
            {
                "reference_wav_path": clean_clip,
                "prompt_wav_path": clean_clip,
                "prompt_text": transcript,
            },
        ),
    ):
        try:
            out[name] = _timed(
                lambda: (
                    model.generate(text=text, cfg_value=2.0, inference_timesteps=10, **extra),
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
