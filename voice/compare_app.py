# One-off voice comparison (DESIGN.md §2.69.1) — NOT part of the live app.
#
# Round one (commit b94b9dc) ran Chatterbox v2/V3 and VoxCPM2 over the same
# paragraph. VoxCPM2 with its transcript was closest to the reference voice but
# read it at what sounded like 1.5x speed. Round two tried chunking and slowing
# it (2554f07); both sounded unnatural. Round three removes the real cause: the
# clip VoxCPM2 was given had its pauses trimmed out, and it copies the rhythm of
# its clip. Round four: the clip as uploaded, as a voice reference only (prompt
# mode leaks the clip's last words into the output), with breaths between
# sentences. Chatterbox is no longer run.
#
#   modal deploy voice/compare_app.py      (done by .github/workflows/deploy-voice-compare.yml)
#
# Reads one fixed paragraph of a real recap through each candidate and scores
# how close each comes to the reference clip, so the winner can be picked by
# ear with numbers beside it. Delete the app from the Modal
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


APP_NAME = "armonim-voice-compare"
MODELS = "/models"

# the clip: the same private dataset, and the same Modal Secret, as the live app
VOICE_REPO = "ofh55/armonim-voice"
VOICE_FILE = "reference_voice_final.wav"
VOICE_SECRET_NAME = "armonim-voice"

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
    image=vox_image,
    # bf16 weights: an L4 does them in hardware, a T4 does not
    gpu="L4",
    secrets=[voice_secret],
    timeout=20 * 60,
    scaledown_window=60,
    max_containers=1,
)
class VoxLab:
    @modal.enter()
    def load(self):
        import os

        from huggingface_hub import hf_hub_download
        from voxcpm import VoxCPM

        self.clip = hf_hub_download(
            VOICE_REPO, VOICE_FILE, repo_type="dataset", token=os.environ["HF_TOKEN"]
        )
        self.model = VoxCPM.from_pretrained(
            VOX_REPO, load_denoiser=False, optimize=False, device="cuda"
        )

    @modal.method()
    def variants(self, text: str):
        import tempfile

        from lab import vox_variants
        from speech import prepare_reference

        # The clip as uploaded goes to the model. The cleaned copy is only what
        # the scorer compares against, so the numbers stay comparable with the
        # earlier rounds.
        with tempfile.TemporaryDirectory() as work:
            clean = prepare_reference(self.clip, f"{work}/clean.wav")
            return vox_variants(self.model, text, self.clip), open(clean, "rb").read()


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

    results, clean = VoxLab().variants.remote(TEXT)
    audible = {n: (r["wav"], r["sr"]) for n, r in results.items() if "wav" in r}
    scores = Scorer().score.remote(clean, audible)

    out = {}
    for name, r in sorted(results.items()):
        if "error" in r:
            out[name] = {"error": r["error"]}
        else:
            out[name] = {
                "score": scores.get(name),
                # length is the thing being tuned: round one's D2 was 14.2 s,
                # Chatterbox's B 18.4 s, for the same paragraph
                "audio_seconds": round(len(r["wav"]) / r["sr"], 1),
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
