#!/usr/bin/env python3
"""Repack a horizontal sprite strip into a 2D grid that fits inside texture limits.

WebKit (Tauri's macOS webview) downsamples textures wider than ~8192px, which
breaks pixel-aligned frame stepping. This script slices a wide strip into
fixed-size frames and re-lays them out in a cols×rows grid.

Usage:
    python3 scripts/repack_grid.py <input.png> <frames> [--frame-size 128]
                                   [--max-width 4096] [--out <path>]

If --out is omitted, the input file is overwritten (a .bak is created first).
"""

import argparse, math, os, shutil, sys
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="Path to wide sprite strip PNG")
    ap.add_argument("frames", type=int, help="Number of frames in the strip")
    ap.add_argument("--frame-size", type=int, default=128, help="Frame width/height in pixels (default: 128)")
    ap.add_argument("--max-width", type=int, default=4096, help="Max output width in pixels (default: 4096)")
    ap.add_argument("--out", help="Output path (default: overwrite input with .bak backup)")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        print(f"Error: {args.input} not found", file=sys.stderr); sys.exit(1)

    img = Image.open(args.input).convert("RGBA")
    fs = args.frame_size
    n = args.frames

    if img.width != n * fs or img.height != fs:
        print(f"Warning: expected {n*fs}x{fs}, got {img.width}x{img.height}. Continuing anyway.", file=sys.stderr)

    cols = max(1, args.max_width // fs)
    rows = math.ceil(n / cols)
    print(f"input:  {img.width}x{img.height} ({n} frames at {fs}px)")
    print(f"output: {cols * fs}x{rows * fs} ({cols} cols × {rows} rows)")

    out = Image.new("RGBA", (cols * fs, rows * fs), (0, 0, 0, 0))
    for i in range(n):
        sx = i * fs
        crop = img.crop((sx, 0, sx + fs, fs))
        dx, dy = (i % cols) * fs, (i // cols) * fs
        out.paste(crop, (dx, dy))

    dest = args.out or args.input
    if not args.out:
        bak = args.input + ".bak"
        if not os.path.exists(bak):
            shutil.copy(args.input, bak)
            print(f"backup: {bak}")
    out.save(dest)
    print(f"wrote:  {dest}")


if __name__ == "__main__":
    main()
