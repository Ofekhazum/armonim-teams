#!/usr/bin/env python3
"""Regenerate the app icons from the club crest.

    python3 scripts/make-icons.py

Run this only when src/club_logo.jpg changes; the outputs are committed, so a
normal build needs neither Python nor Pillow.

The maskable variant exists because Android crops icons to whatever shape the
launcher uses — a circle, a squircle, a rounded square — and guarantees only
the central 80%. The crest's outer ring sits right at the edge of the artwork,
so a straight resize would have its top and bottom shaved off. That one gets
scaled down onto the crest's own background colour instead, which is also why
the padding is sampled from the image rather than guessed at: a hand-picked
cream that is one shade off shows up as a visible ring.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'src' / 'club_logo.jpg'
PUBLIC = ROOT / 'public'

# Android's maskable safe zone is the central 80%; leave a little more than that.
MASKABLE_SCALE = 0.76

# The crest is three flat colours plus antialiasing, but it arrives as a JPEG,
# so its "flat" areas are speckled with compression noise that PNG cannot
# compress away — a straight save is 326KB for artwork that should be a
# fraction of that. Quantising collapses the noise back into the few colours
# actually in the design; at this many it is indistinguishable by eye.
PALETTE_COLOURS = 64

def main() -> None:
    crest = Image.open(SOURCE).convert('RGB')
    background = crest.getpixel((2, 2))  # the crest's own ground colour
    print(f'source {crest.width}x{crest.height}, background #{background[0]:02x}{background[1]:02x}{background[2]:02x}')

    def write(img: Image.Image, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        img.quantize(colors=PALETTE_COLOURS, dither=Image.NONE).save(path, 'PNG', optimize=True)
        print(f'  {path.relative_to(ROOT)}  {img.width}x{img.height}  {path.stat().st_size // 1024}KB')

    for size, path in [
        (512, PUBLIC / 'icons' / 'icon-512.png'),
        (192, PUBLIC / 'icons' / 'icon-192.png'),
        (180, PUBLIC / 'apple-touch-icon.png'),  # iOS Home Screen
        (32, PUBLIC / 'favicon.png'),
    ]:
        write(crest.resize((size, size), Image.LANCZOS), path)

    inner = int(512 * MASKABLE_SCALE)
    padded = Image.new('RGB', (512, 512), background)
    offset = (512 - inner) // 2
    padded.paste(crest.resize((inner, inner), Image.LANCZOS), (offset, offset))
    write(padded, PUBLIC / 'icons' / 'icon-maskable-512.png')

if __name__ == '__main__':
    main()
