"""Bake the grass texture atlas used by the chunked-instanced terrain.

Layout: 4×4 grid of 512×512 cells = 2048×2048 atlas.
  cells 0..8  = PS2-tinted Marlin Studios "Seamless Textures vol 1" grass tiles
                (grass01..grass09 after LAB color-match + HSV sat 1.35x boost)
  cell  9     = pure white (non-grass biomes UV-offset here so their instance
                color tint survives unattenuated by the texture sample)
  cells 10..15 = white (spare, free for future biomes)

Cell index `i` maps to atlas UV offset `(i % 4 / 4, i // 4 / 4)`.

Run after re-tinting source tiles:

    python tools/bake-grass-atlas.py /path/to/marlin_grass_processed/

Source dir must contain grass01.jpg..grass09.jpg (any size, resized to 512²).

Output: public/textures/grass-atlas.jpg  (~1.5 MB at q=92).
"""
import sys
from pathlib import Path
from PIL import Image

CELL = 512
COLS = 4
ROWS = 4

def main(src_dir: str) -> None:
    src = Path(src_dir)
    out = Path(__file__).resolve().parent.parent / "public" / "textures" / "grass-atlas.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)

    atlas = Image.new("RGB", (COLS * CELL, ROWS * CELL), (255, 255, 255))
    for i in range(9):
        tile_path = src / f"grass{i+1:02d}.jpg"
        if not tile_path.exists():
            raise SystemExit(f"missing source tile: {tile_path}")
        tile = Image.open(tile_path).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
        col = i % COLS
        row = i // COLS
        atlas.paste(tile, (col * CELL, row * CELL))

    atlas.save(out, quality=92, optimize=True)
    print(f"wrote {out}  ({atlas.size}, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/marlin_grass_processed")
