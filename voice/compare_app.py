# One-off likeness comparison (DESIGN.md §2.69.1) — NOT part of the live app.
#
#   modal deploy voice/compare_app.py      (done by .github/workflows/deploy-voice-compare.yml)
#
# Reads one fixed paragraph of a real recap through each candidate voice
# pipeline and scores how close each comes to the reference clip, so the winner
# can be picked by ear with numbers beside it. Delete the app from the Modal
# dashboard once a pipeline has been chosen.
#
# **There is no text input.** The paragraph and the clip's transcript are
# constants below, so what this endpoint can be made to say is exactly the one
# paragraph in this file. It sits behind the same proxy-auth lock as the live
# voice server (401 at Modal's edge, before any container starts).
#
#   POST /runs                  → { call_id }
#   GET  /runs/{id}?wait=N      → 200 { variant: { score, seconds, error? } } | 202
#   GET  /runs/{id}/{variant}   → audio/mpeg

from pathlib import Path

import modal

from speech import CHATTERBOX_FILES, CHATTERBOX_REPO, PHONIKUD_FILE, PHONIKUD_REPO

APP_NAME = "armonim-voice-compare"
MODELS = "/models"

# the clip: the same private dataset, and the same Modal Secret, as the live app
VOICE_REPO = "ofh55/armonim-voice"
VOICE_FILE = "reference_voice_final.wav"
VOICE_SECRET_NAME = "armonim-voice"

CHATTERBOX_V3 = "t3_mtl23ls_v3.safetensors"
VOX_REPO = "openbmb/VoxCPM2"
ECAPA = "speechbrain/spkrec-ecapa-voxceleb"

# What is read: the masthead and first paragraph of a stored recap, already
# through speakable().
TEXT = (
    "ארבל זעזוע מדווח מהמגרש.\n"
    "ערב חריג של דיקטטורה מוחלטת נרשם על הדשא, עם שלושה עשר משחקים שבהם ההובלה "
    "התחלפה רק פעם אחת בודדת ופעמיים הלכנו להכרעה מהנקודה הלבנה. "
    "בסיומו של המחזור, השחורים והלבנים חלקו את פסגת הלילה."
)

# What is said *in the clip*, for VoxCPM2's transcript-assisted cloning. It
# has to match the words exactly; it is not spoken.
TRANSCRIPT = (
    "המקצוע הכי טוב בכדורגל, נתת לו הכל, נגיע איך זה קרה, "
    "אבל חלילה חלילה, והחתמת אותו לתקופה ממושכת, חלילה חלילה חלילה, "
    "הוא נכשל ומי כמוך יודע, ביתר זה לא המועדון הראשון שלך, האם הוא חוזר"
)

SPEECH_PY = Path(__file__).parent / "speech.py"
LAB_PY = Path(__file__).parent / "lab.py"


def bake_chatterbox():
    from huggingface_hub import hf_hub_download, snapshot_download

    snapshot_download(
        CHATTERBOX_REPO,
        allow_patterns=CHATTERBOX_FILES + [CHATTERBOX_V3, "s3gen.safetensors"],
    )
    hf_hub_download(PHONIKUD_REPO, PHONIKUD_FILE)


def bake_vox():
    from huggingface_hub import snapshot_download

    snapshot_download(VOX_REPO)


def bake_ecapa():
    from speechbrain.inference.speaker import EncoderClassifier

    EncoderClassifier.from_hparams(source=ECAPA, savedir=f"{MODELS}/ecapa")


def sources(image: modal.Image) -> modal.Image:
    return image.add_local_file(SPEECH_PY, "/root/speech.py", copy=True).add_local_file(
        LAB_PY, "/root/lab.py", copy=True
    )


chatterbox_image = sources(
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("chatterbox-tts==0.1.7", "phonikud==0.4.1", "phonikud-onnx==1.0.6", "soundfile")
    .env({"HF_HOME": MODELS})
).run_function(bake_chatterbox)

# VoxCPM2 and Chatterbox pin different torch/transformers stacks, so each gets
# its own image rather than one image trying to satisfy both.
vox_image = sources(
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install("voxcpm==2.0.3", "soundfile")
    .env({"HF_HOME": MODELS})
).run_function(bake_vox)

score_image = sources(
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("speechbrain==1.1.2", "librosa", "soundfile")
    .env({"HF_HOME": MODELS})
).run_function(bake_ecapa)

light_image = sources(
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]", "numpy", "soundfile")
)

app = modal.App(APP_NAME)
voice_secret = modal.Secret.from_name(VOICE_SECRET_NAME)


@app.cls(
    image=chatterbox_image,
    gpu="T4",
    secrets=[voice_secret],
    timeout=20 * 60,
    scaledown_window=60,
    max_containers=1,
)
class ChatterboxLab:
    @modal.enter()
    def load(self):
        import os

        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file

        from speech import load_model

        self.clip = hf_hub_download(
            VOICE_REPO, VOICE_FILE, repo_type="dataset", token=os.environ["HF_TOKEN"]
        )
        self.model, self.diacritizer = load_model("cuda")
        self.v2 = {k: v.detach().cpu().clone() for k, v in self.model.t3.state_dict().items()}
        v3 = load_file(hf_hub_download(CHATTERBOX_REPO, CHATTERBOX_V3))
        self.v3 = v3["model"][0] if "model" in v3 else v3

    @modal.method()
    def variants(self, text: str):
        import tempfile

        from lab import chatterbox_variants

        with tempfile.TemporaryDirectory() as work:
            out, clean = chatterbox_variants(
                self.model, self.diacritizer, self.v2, self.v3, self.clip, text, work
            )
            return out, open(clean, "rb").read()

    @modal.method()
    def convert(self, wav, sr: int, clean_clip: bytes):
        import tempfile

        from chatterbox.vc import ChatterboxVC

        from lab import convert_voice

        if not hasattr(self, "vc"):
            self.vc = ChatterboxVC.from_pretrained("cuda")
        with tempfile.TemporaryDirectory() as work:
            path = f"{work}/clean.wav"
            open(path, "wb").write(clean_clip)
            return convert_voice(self.vc, wav, sr, path)


@app.cls(
    image=vox_image,
    # bf16 weights: an L4 does them in hardware, a T4 does not
    gpu="L4",
    timeout=20 * 60,
    scaledown_window=60,
    max_containers=1,
)
class VoxLab:
    @modal.enter()
    def load(self):
        from voxcpm import VoxCPM

        self.model = VoxCPM.from_pretrained(
            VOX_REPO, load_denoiser=False, optimize=False, device="cuda"
        )

    @modal.method()
    def variants(self, text: str, clean_clip: bytes, transcript: str):
        import tempfile

        from lab import vox_variants

        with tempfile.TemporaryDirectory() as work:
            path = f"{work}/clean.wav"
            open(path, "wb").write(clean_clip)
            return vox_variants(self.model, text.replace("\n", " "), path, transcript)


@app.cls(image=score_image, cpu=2, memory=4096, timeout=10 * 60, scaledown_window=60)
class Scorer:
    @modal.enter()
    def load(self):
        from speechbrain.inference.speaker import EncoderClassifier

        self.classifier = EncoderClassifier.from_hparams(
            source=ECAPA, savedir=f"{MODELS}/ecapa", run_opts={"device": "cpu"}
        )

    @modal.method()
    def score(self, ref_wav: bytes, items: dict):
        from lab import likeness

        return likeness(self.classifier, ref_wav, items)


@app.function(image=light_image, timeout=40 * 60)
def run_compare() -> dict:
    from speech import encode_mp3

    chatterbox, vox = ChatterboxLab(), VoxLab()
    results, clean = chatterbox.variants.remote(TEXT)
    results.update(vox.variants.remote(TEXT, clean, TRANSCRIPT))

    # the conversion pass goes on VoxCPM2's best attempt at the clip's voice
    source = next((results[n] for n in ("D2", "D1") if "wav" in results.get(n, {})), None)
    if source:
        try:
            wav, sr = chatterbox.convert.remote(source["wav"], source["sr"], clean)
            results["E"] = {"wav": wav, "sr": sr}
        except Exception as err:
            results["E"] = {"error": f"{type(err).__name__}: {err}"[:300]}

    audible = {n: (r["wav"], r["sr"]) for n, r in results.items() if "wav" in r}
    scores = Scorer().score.remote(clean, audible)

    out = {}
    for name, r in sorted(results.items()):
        if "error" in r:
            out[name] = {"error": r["error"]}
        else:
            out[name] = {
                "score": scores.get(name),
                "seconds": r.get("seconds"),
                "mp3": encode_mp3(r["wav"], r["sr"]),
            }
    return out


def make_api(start, result):
    """The HTTP side, free of Modal. `result(id, wait)` raises TimeoutError while
    running and LookupError for an unknown or expired id."""
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse, Response

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    async def fetch(call_id: str, wait: float):
        try:
            return await result(call_id, max(0.0, min(wait, 100.0))), None
        except TimeoutError:
            return None, JSONResponse({"status": "working"}, status_code=202)
        except LookupError:
            return None, JSONResponse({"error": "no such run"}, status_code=404)
        except Exception as err:
            return None, JSONResponse({"error": str(err)[:400] or type(err).__name__}, status_code=500)

    @api.post("/runs")
    async def queue():
        return {"call_id": await start()}

    @api.get("/runs/{call_id}")
    async def summary(call_id: str, wait: float = 0):
        results, problem = await fetch(call_id, wait)
        if problem:
            return problem
        return {n: {k: v for k, v in r.items() if k != "mp3"} for n, r in results.items()}

    @api.get("/runs/{call_id}/{variant}")
    async def audio(call_id: str, variant: str):
        results, problem = await fetch(call_id, 0)
        if problem:
            return problem
        r = results.get(variant)
        if not r or "mp3" not in r:
            return JSONResponse({"error": "no such variant"}, status_code=404)
        return Response(r["mp3"], media_type="audio/mpeg")

    return api


@app.function(image=light_image)
@modal.asgi_app(requires_proxy_auth=True)
def web():
    async def start() -> str:
        return (await run_compare.spawn.aio()).object_id

    async def result(call_id: str, wait: float):
        try:
            return await modal.FunctionCall.from_id(call_id).get.aio(timeout=wait)
        except (modal.exception.OutputExpiredError, modal.exception.NotFoundError) as err:
            raise LookupError(call_id) from err

    return make_api(start, result)
