# The night reporter's voice, served from Modal (DESIGN.md §2.69).
#
#   modal deploy voice/modal_app.py
#
# Two functions. `Voice` runs on a GPU and does the speaking (speech.py). `web`
# runs on a CPU and is the only way in: it queues a recap and hands back its id,
# then hands back the MP3 once it exists. That two-step shape is Modal's own
# pattern for long jobs, and it is also what keeps a Worker on the free plan
# within its request budget — no connection is held open for the minutes a cold
# GPU and a long recap can take.
#
# **This is not an open text box.** `requires_proxy_auth=True` makes Modal's
# edge refuse any request without a proxy-auth token from this workspace — with
# a 401, before any container starts, so a stranger cannot even spend the GPU
# credits. Only the Worker holds the token, and the Worker only ever sends a
# recap that Gemini wrote for a real night. The reference voice stays in a
# private Hugging Face dataset, fetched with a token from a Modal Secret when a
# container starts — never in this repo, and never baked into the image.

import re
from pathlib import Path

import modal

from speech import MAX_CHARS, VOX_REPO

APP_NAME = "armonim-recap-voice"
MODELS = "/models"

# The private dataset holding the clip, and the Modal Secret holding the
# Hugging Face token that can read it (`modal secret create armonim-voice
# HF_TOKEN=…`).
VOICE_REPO = "ofh55/armonim-voice"
VOICE_FILE = "reference_voice_final.wav"  # the default voice, and the fallback for any persona without its own
VOICE_PREFIX = "voice_"  # a persona's own clip is voice_<persona>.wav in the same dataset
VOICE_SECRET_NAME = "armonim-voice"

# A voice is a persona key (worker/recap.js PERSONAS). The Worker only ever
# sends one it knows, but this is also a file name in a private dataset, so it
# is held to a plain slug here as well.
VOICE_KEY = re.compile(r"^[a-z][a-z0-9_]{0,23}$")

# How long the poll endpoint waits for a finished recap before answering
# "still working". Modal cuts a web request at 150 s.
MAX_WAIT_S = 100


def bake_weights():
    """Download the weights at build time, so a cold start loads from disk."""
    from huggingface_hub import snapshot_download

    snapshot_download(VOX_REPO)


gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    # resemble-perth declares no dependencies of its own but imports all of
    # these; without them it silently disables itself (speech.watermark refuses)
    .pip_install(
        "voxcpm==2.0.3", "soundfile", "resemble-perth==1.0.1",
        "pyrubberband", "pydub", "audioread", "matplotlib", "pyyaml", "setuptools<81",
    )
    .env({"HF_HOME": MODELS})
    .add_local_file(Path(__file__).parent / "speech.py", "/root/speech.py", copy=True)
    .run_function(bake_weights)
)

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]")
    .add_local_file(Path(__file__).parent / "speech.py", "/root/speech.py", copy=True)
)

app = modal.App(APP_NAME)


@app.cls(
    image=gpu_image,
    # VoxCPM2 is a 2B model with bf16 weights: an L4 (24 GB) does them in
    # hardware and has room to spare; a T4 does neither. About $0.80 an hour,
    # billed by the second, so a recap is a few cents of the free credit.
    gpu="L4",
    secrets=[modal.Secret.from_name(VOICE_SECRET_NAME)],
    timeout=15 * 60,
    # stay warm briefly for a second take, then stop billing
    scaledown_window=120,
    # one recap at a time — the club makes one a week
    max_containers=1,
)
class Voice:
    @modal.enter()
    def load(self):
        import os

        from speech import load_vox

        # Fetched per container rather than baked into the image, so changing
        # a voice is an upload to the dataset rather than a redeploy, and a clip
        # never sits in an image layer. Used exactly as uploaded: the model
        # copies the rhythm of its clip, so trimming the pauses out of it makes
        # the voice read fast with no stops (§2.69.1).
        self.token = os.environ["HF_TOKEN"]
        self.references = {}
        self.references["default"] = self.fetch(VOICE_FILE)
        self.model = load_vox("cuda")

    def fetch(self, filename: str) -> str:
        from huggingface_hub import hf_hub_download

        return hf_hub_download(VOICE_REPO, filename, repo_type="dataset", token=self.token)

    def reference_for(self, voice: str) -> str:
        """The clip for a persona: its own voice_<persona>.wav, else the default."""
        from huggingface_hub.utils import EntryNotFoundError

        if voice not in self.references:
            try:
                self.references[voice] = self.fetch(f"{VOICE_PREFIX}{voice}.wav")
            except EntryNotFoundError:
                print(f"no clip for voice {voice!r}; using the default", flush=True)
                self.references[voice] = self.references["default"]
        return self.references[voice]

    @modal.method()
    def speak(self, text: str, voice: str = "default") -> bytes:
        from speech import speak_vox_mp3

        return speak_vox_mp3(self.model, self.reference_for(voice), text)


def make_api(start, result):
    """
    The HTTP side, free of Modal so it can be served locally with fakes.

      POST /jobs        { text, voice? }  → { call_id }
      GET  /jobs/{id}?wait=N      → 200 audio/mpeg | 202 still working
                                    | 404 unknown or expired | 500 { error }

    `start(text, voice)` returns a job id; `result(id, wait)` returns the MP3 bytes,
    or raises TimeoutError (still running) or LookupError (no such job).
    """
    from fastapi import Body, FastAPI
    from fastapi.responses import JSONResponse, Response

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @api.post("/jobs")
    async def queue(text: str = Body(..., embed=True), voice: str = Body("default", embed=True)):
        text = text.strip()
        if not text or len(text) > MAX_CHARS:
            return JSONResponse({"error": "bad text"}, status_code=400)
        if voice != "default" and not VOICE_KEY.match(voice):
            return JSONResponse({"error": "bad voice"}, status_code=400)
        return {"call_id": await start(text, voice)}

    @api.get("/jobs/{call_id}")
    async def collect(call_id: str, wait: float = 0):
        try:
            audio = await result(call_id, max(0.0, min(wait, MAX_WAIT_S)))
        except TimeoutError:
            return JSONResponse({"status": "working"}, status_code=202)
        except LookupError:
            return JSONResponse({"error": "no such job"}, status_code=404)
        except Exception as err:  # the job itself failed; say why
            return JSONResponse({"error": str(err)[:300] or type(err).__name__}, status_code=500)
        return Response(audio, media_type="audio/mpeg")

    return api


@app.function(image=web_image)
@modal.asgi_app(requires_proxy_auth=True)
def web():
    async def start(text: str, voice: str) -> str:
        call = await Voice().speak.spawn.aio(text, voice)
        return call.object_id

    async def result(call_id: str, wait: float) -> bytes:
        # Still running is Python's own TimeoutError and passes straight
        # through. Expired (results are kept 7 days) and unknown ids are
        # Modal's own exceptions — and OutputExpiredError, despite subclassing
        # Modal's TimeoutError, is not the built-in one.
        try:
            call = modal.FunctionCall.from_id(call_id)
            return await call.get.aio(timeout=wait)
        except (modal.exception.OutputExpiredError, modal.exception.NotFoundError) as err:
            raise LookupError(call_id) from err

    return make_api(start, result)
