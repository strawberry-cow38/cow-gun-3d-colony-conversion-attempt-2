"""Sand-tile pipeline: LAB-shift grnd01 (Marlin "Light Sand") toward the
sand target color used by the game so the baked atlas tile matches the
biome tint that's currently used as a flat fill. Mild HSV sat/val nudge
for PS2 punch, same as the grass/ground scripts.

Output: /tmp/marlin_ground_processed/grnd01.jpg (512x512).
"""
import os
import numpy as np
from PIL import Image
from skimage import color

SRC = "/tmp/marlin_ground_raw/grnd01.jpg"
OUT_DIR = "/tmp/marlin_ground_processed"
OUT = os.path.join(OUT_DIR, "grnd01.jpg")
TILE = 512
SAT_BOOST = 1.55
VAL_BOOST = 1.02

# Target: SAND_TOP_COLOR = 0xc8b27a = (200, 178, 122) — warm light tan.
TARGET_RGB = np.array([200, 178, 122], dtype=np.float32) / 255.0
TARGET_LAB = color.rgb2lab(TARGET_RGB.reshape(1, 1, 3))[0, 0]

os.makedirs(OUT_DIR, exist_ok=True)
im = Image.open(SRC).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
rgb = np.asarray(im, dtype=np.float32) / 255.0

lab = color.rgb2lab(rgb)
mean_lab = lab.reshape(-1, 3).mean(axis=0)
shift = (TARGET_LAB - mean_lab) * 0.9
lab_shifted = lab + shift
lab_shifted[..., 0] = np.clip(lab_shifted[..., 0], 0, 100)
rgb_shifted = np.clip(color.lab2rgb(lab_shifted), 0, 1)

hsv = color.rgb2hsv(rgb_shifted)
hsv[..., 1] = np.clip(hsv[..., 1] * SAT_BOOST, 0, 1)
hsv[..., 2] = np.clip(hsv[..., 2] * VAL_BOOST, 0, 1)
rgb_final = np.clip(color.hsv2rgb(hsv), 0, 1)

out_im = Image.fromarray((rgb_final * 255).astype(np.uint8))
out_im.save(OUT, quality=92)
print(f"grnd01: meanLAB {mean_lab[0]:.0f}/{mean_lab[1]:+.0f}/{mean_lab[2]:+.0f} -> shift {shift[0]:+.0f}/{shift[1]:+.0f}/{shift[2]:+.0f}")
print(f"wrote {OUT}")
