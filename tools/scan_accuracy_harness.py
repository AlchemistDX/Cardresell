#!/usr/bin/env python3
"""Offline scan-accuracy harness.

Runs pHash + dHash on every real user upload in
uploaded_attachments/ and reports the top-K matches from card-index.json,
mirroring the client-side FastPath. This is a NN-only test — it does not
call Ximilar and does not run the LLM rerank. It's the ceiling for the
offline-only path.

Usage:
    python3 tools/scan_accuracy_harness.py [--limit N]

Prints per-image: filename, best match, distance. Emits summary at end.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
INDEX_PATH = ROOT / "card-index.json"
ATTACH_DIR = Path("/home/user/workspace/uploaded_attachments")


def _dct_1d(x: np.ndarray) -> np.ndarray:
    n_arr = np.arange(x.shape[-1])
    k = n_arr.reshape(-1, 1)
    M = np.cos(np.pi * (2 * n_arr + 1) * k / (2 * x.shape[-1]))
    return x @ M.T


def phash(img: Image.Image) -> str:
    g = img.convert("L").resize((32, 32), Image.LANCZOS)
    a = np.asarray(g, dtype=np.float32)
    top = _dct_1d(_dct_1d(a).T).T[:8, :8]
    bits = (top > np.median(top)).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


def dhash(img: Image.Image) -> str:
    g = img.convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(g)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


def hamming(a: str, b: str) -> int:
    if len(a) != len(b):
        return 999
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def detect_bounds(img: Image.Image) -> tuple[int, int, int, int] | None:
    """Match client detectCardBounds: Sobel-esque gradient + 3-97 percentile.

    Returns (left, top, right, bottom) or None.
    """
    small = img.convert("L").resize((320, 320), Image.LANCZOS)
    a = np.asarray(small, dtype=np.float32)
    gx = np.abs(np.diff(a, axis=1))
    gy = np.abs(np.diff(a, axis=0))
    # pad back to same shape
    gx = np.pad(gx, ((0, 0), (0, 1)))
    gy = np.pad(gy, ((0, 1), (0, 0)))
    grad = gx + gy
    mask = grad > 40
    cols = np.any(mask, axis=0)
    rows = np.any(mask, axis=1)
    if not cols.any() or not rows.any():
        return None
    col_idx = np.where(cols)[0]
    row_idx = np.where(rows)[0]
    l = int(np.percentile(col_idx, 3))
    r = int(np.percentile(col_idx, 97))
    t = int(np.percentile(row_idx, 3))
    b = int(np.percentile(row_idx, 97))
    if r <= l or b <= t:
        return None
    W, H = img.size
    scale_x = W / 320.0
    scale_y = H / 320.0
    margin = 4
    L = max(0, int(l * scale_x) - margin)
    R = min(W, int(r * scale_x) + margin)
    T = max(0, int(t * scale_y) - margin)
    B = min(H, int(b * scale_y) + margin)
    return (L, T, R, B)


def process(path: Path) -> tuple[str, str]:
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    box = detect_bounds(img)
    if box:
        img = img.crop(box)
    return phash(img), dhash(img)


def load_index() -> list[dict]:
    with open(INDEX_PATH) as f:
        return json.load(f)


def top_k(ph: str, dh: str, idx: list[dict], k: int = 5) -> list[tuple[dict, int]]:
    scored = []
    for c in idx:
        d = hamming(ph, c["p"]) * 2 + hamming(dh, c["d"])
        scored.append((c, d))
    scored.sort(key=lambda x: x[1])
    return scored[:k]


def gather_images(limit: int | None) -> list[Path]:
    exts = {".jpeg", ".jpg", ".png"}
    out = []
    for root, _, files in os.walk(ATTACH_DIR):
        for name in files:
            if name.lower().endswith(tuple(exts)):
                out.append(Path(root) / name)
    out.sort()
    if limit:
        out = out[:limit]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--json", type=str, default=None, help="Write results to JSON")
    args = ap.parse_args()

    print(f"Loading index...", file=sys.stderr)
    idx = load_index()
    print(f"  {len(idx):,} cards loaded", file=sys.stderr)

    images = gather_images(args.limit)
    print(f"Found {len(images)} images", file=sys.stderr)

    # Confidence bands from client:
    #   dist <= 12 with gap >= 6 = confident hit
    CONFIDENCE_MAX = 12
    GAP_MIN = 6

    results = []
    confident = 0
    ambiguous = 0
    low = 0
    errors = 0

    for i, p in enumerate(images):
        try:
            ph, dh = process(p)
            top = top_k(ph, dh, idx, k=5)
            best_c, best_d = top[0]
            second_d = top[1][1] if len(top) > 1 else 999
            gap = second_d - best_d
            if best_d <= CONFIDENCE_MAX and gap >= GAP_MIN:
                confident += 1
                verdict = "CONFIDENT"
            elif best_d <= CONFIDENCE_MAX:
                ambiguous += 1
                verdict = "AMBIGUOUS"
            else:
                low += 1
                verdict = "LOW"
            results.append({
                "file": str(p.relative_to(ATTACH_DIR)),
                "verdict": verdict,
                "best": {"id": best_c["id"], "name": best_c["n"], "set": best_c["s"], "dist": best_d},
                "second_dist": second_d,
                "gap": gap,
                "top5": [{"id": c["id"], "name": c["n"], "set": c["s"], "dist": d} for c, d in top],
            })
            if i < 20 or verdict != "CONFIDENT":
                print(f"[{verdict:9}] d={best_d:2} gap={gap:2}  {p.name:40} -> {best_c['id']:15} {best_c['n']} ({best_c['s']})")
        except Exception as e:
            errors += 1
            print(f"[ERROR    ]                     {p.name}: {e}")
            results.append({"file": str(p.relative_to(ATTACH_DIR)), "verdict": "ERROR", "error": str(e)})

    total = len(images)
    print()
    print("=" * 70)
    print(f"Total:      {total}")
    print(f"Confident:  {confident:4} ({100*confident/total:.1f}%)")
    print(f"Ambiguous:  {ambiguous:4} ({100*ambiguous/total:.1f}%)")
    print(f"Low:        {low:4} ({100*low/total:.1f}%)")
    print(f"Errors:     {errors:4} ({100*errors/total:.1f}%)")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({
                "total": total,
                "confident": confident,
                "ambiguous": ambiguous,
                "low": low,
                "errors": errors,
                "results": results,
            }, f, indent=2)
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
