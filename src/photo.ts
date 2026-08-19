// Compresses a picked photo down to a small inline data URL before it's
// attached to a FixtureRecord (see types.ts). Deliberately a thumbnail, not a
// full-resolution photo: this rides along inside the same JSON blob every
// other history write already pushes to the shared store (§2.6's "publish the
// *entire* fixture list" model), so it has to stay small or every future
// unrelated edit — fixing a score, deleting an old night — gets slower for
// everyone. A keepsake memory doesn't need to be full-res to do its job.
//
// Known limitation: there's no cap on how many nights end up with a photo, so
// the shared history payload grows slowly over time as more get attached.
// Fine for the near future; worth moving to object storage (Cloudflare R2,
// same Worker) if it's ever actually felt.

const MAX_DIM = 640;
const QUALITY = 0.6;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to load image'));
    };
    img.src = url;
  });
}

export async function compressPhoto(file: File): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', QUALITY);
}
