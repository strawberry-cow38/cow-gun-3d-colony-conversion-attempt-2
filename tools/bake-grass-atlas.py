"""Bake the grass texture atlas used by the chunked-instanced terrain.

Layout: 4×4 grid of 512×512 cells = 2048×2048 atlas.
  cell  0     = grass11 tile (master's pick — single grass texture, per-tile
                color variation comes from the InstancedMesh color tint)
  cells 1..8  = white (spare, free for future grass variants)
  cell  9     = pure white (non-grass biomes UV-offset here so their instance
                color tint survives unattenuated by the texture sample)
  cells 10..15 = white (spare, free for future biomes)

Cell index `i` maps to atlas UV offset `(i % 4 / 4, i // 4 / 4)`.

Run:

    python tools/bake-grass-atlas.py /path/to/marlin_grass_processed/

Source dir must contain grass11.jpg (any size, resized to 512²).

Output: public/textures/grass-atlas.jpg.
"""
import sys
from pathlib import Path
from PIL import Image

CELL = 512
COLS = 4
ROWS = 4
GRASS_SOURCE = "grass11.jpg"

def main(src_dir: str) -> None:
    src = Path(src_dir)
    out = Path(__file__).resolve().parent.parent / "public" / "textures" / "grass-atlas.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)

    atlas = Image.new("RGB", (COLS * CELL, ROWS * CELL), (255, 255, 255))
    tile_path = src / GRASS_SOURCE
    if not tile_path.exists():
        raise SystemExit(f"missing source tile: {tile_path}")
    tile = Image.open(tile_path).convert("RGB").resize((CELL, CELL), Image.LANCZOS)
    atlas.paste(tile, (0, 0))

    atlas.save(out, quality=92, optimize=True)
    print(f"wrote {out}  ({atlas.size}, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/marlin_grass_processed")
