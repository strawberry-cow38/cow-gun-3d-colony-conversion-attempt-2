"""Bake the terrain texture atlas used by the chunked-instanced terrain.

Layout: 4×4 grid of 512×512 cells = 2048×2048 atlas.
  cells 0..6  = PS2-tinted Marlin "Seamless Textures vol 1" grass tiles
                (grass01..grass07 after LAB color-match + HSV sat boost)
  cells 7..8  = stone-biome tiles: rock05 + rock11 LAB-shifted to rock05's
                purple-grey. Used on BOTH stone-biome tops AND stone-biome
                cliff faces so the purple family reads as a single rocky
                material.
  cell  9     = pure white (biomes w/o a baked texture UV-offset here so
                the per-instance color tint passes through unattenuated —
                fallback for biomes that don't bake their own tile)
  cells 10..11 = Marlin grnd03/grnd04 after LAB color-match to a shared warm
                brown. Dirt tops alternate between these two cells by
                tile-coord hash so the field reads as one coherent mud
                patch with internal variation.
  cells 12..14 = cliff-biome tiles: rock01 + rock02 + rock03 LAB-shifted to
                rock02's orange. Used on cliff faces under grass / dirt /
                sand biomes so exposed subsoil reads as warm rock.
  cell 15     = Marlin grnd01 ("Light Sand") LAB-matched to the game's sand
                top color. Used on sand + shallow-water beds so those tiles
                read as real sand instead of flat tint.

Cell index `i` maps to atlas UV offset `(i % 4 / 4, i // 4 / 4)`.

Run after re-tinting source tiles:

    python tools/bake-grass-atlas.py

Expects:
  /tmp/marlin_grass_processed/grass01.jpg..grass07.jpg
  /tmp/marlin_ground_processed/grnd03.jpg, grnd04.jpg
  /tmp/marlin_rock_processed/rock01.jpg..rock03.jpg, rock05.jpg, rock11.jpg

Output: public/textures/grass-atlas.jpg.
"""
from pathlib import Path
from PIL import Image

CELL = 512
COLS = 4
ROWS = 4
GRASS_SRC = Path("/tmp/marlin_grass_processed")
GROUND_SRC = Path("/tmp/marlin_ground_processed")
ROCK_SRC = Path("/tmp/marlin_rock_processed")

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
    for i in range(7):
        paste_cell(atlas, GRASS_SRC / f"grass{i+1:02d}.jpg", i)
    paste_cell(atlas, ROCK_SRC / "rock05.jpg", 7)
    paste_cell(atlas, ROCK_SRC / "rock11.jpg", 8)
    paste_cell(atlas, GROUND_SRC / "grnd03.jpg", 10)
    paste_cell(atlas, GROUND_SRC / "grnd04.jpg", 11)
    paste_cell(atlas, ROCK_SRC / "rock01.jpg", 12)
    paste_cell(atlas, ROCK_SRC / "rock02.jpg", 13)
    paste_cell(atlas, ROCK_SRC / "rock03.jpg", 14)
    paste_cell(atlas, GROUND_SRC / "grnd01.jpg", 15)

    atlas.save(out, quality=92, optimize=True)
    print(f"wrote {out}  ({atlas.size}, {out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
