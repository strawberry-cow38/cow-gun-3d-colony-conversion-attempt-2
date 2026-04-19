"""Bake the terrain texture atlas used by the chunked-instanced terrain.

Layout: 4×4 grid of 512×512 cells = 2048×2048 atlas.
  cells 0..8  = PS2-tinted Marlin Studios "Seamless Textures vol 1" grass tiles
                (grass01..grass09 after LAB color-match + HSV sat 1.35x boost)
  cell  9     = pure white (biomes w/o a baked texture UV-offset here so
                the per-instance color tint passes through unattenuated)
  cells 10..11 = Marlin grnd03/grnd04 after LAB color-match to a shared warm
                brown (see /tmp/process_ground.py). Dirt tiles alternate
                between these two cells by tile-coord hash so the field
                reads as one coherent mud patch with internal variation.
  cells 12..15 = white (spare, free for future biomes)

Cell index `i` maps to atlas UV offset `(i % 4 / 4, i // 4 / 4)`.

Run after re-tinting source tiles:

    python tools/bake-grass-atlas.py

Expects:
  /tmp/marlin_grass_processed/grass01.jpg..grass09.jpg
  /tmp/marlin_ground_processed/grnd03.jpg, grnd04.jpg

Output: public/textures/grass-atlas.jpg.
"""
from pathlib import Path
from PIL import Image

CELL = 512
COLS = 4
ROWS = 4
GRASS_SRC = Path("/tmp/marlin_grass_processed")
GROUND_SRC = Path("/tmp/marlin_ground_processed")

def paste_cell(atlas: Image.Image, tile_path: Path, cell: int) -> None:
    if not tile_path.exists():
        raise SystemExit(f"missing source tile: {tile_path}")
    tile = Image.open(tile_path).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
    col = cell % COLS
    row = cell // COLS
    atlas.paste(tile, (col * CELL, row * CELL))

def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "textures" / "grass-atlas.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)

    atlas = Image.new("RGB", (COLS * CELL, ROWS * CELL), (255, 255, 255))
    for i in range(9):
        paste_cell(atlas, GRASS_SRC / f"grass{i+1:02d}.jpg", i)
    paste_cell(atlas, GROUND_SRC / "grnd03.jpg", 10)
    paste_cell(atlas, GROUND_SRC / "grnd04.jpg", 11)

    atlas.save(out, quality=92, optimize=True)
    print(f"wrote {out}  ({atlas.size}, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
