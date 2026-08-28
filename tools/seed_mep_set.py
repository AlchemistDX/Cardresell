#!/usr/bin/env python3
"""
Seed the MEP (Mega Evolution Black Star Promos) set into card-index.json.

Same pattern as the manual Strixhaven seed for MTG. When Ximilar hasn't
been trained on a brand-new set yet, we can pre-index it ourselves by:
  1) Pulling the full card list from a free authoritative catalog (TCGdex)
  2) Downloading each card image from a working CDN (Limitless)
  3) Computing perceptual hashes (pHash + dHash, matching card-index.json schema)
  4) Appending the new records to card-index.json so the client-side
     fast-path can match them.

The client already loads card-index.json and runs pHash matching before
Ximilar; adding MEP records here means Mega Greninja ex 081/MEP and its
88 setmates will be recognized instantly without waiting on Ximilar to
retrain.
"""

import io
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...", file=sys.stderr)
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image


REPO = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO / "card-index.json"

SET_ID = "mep"
SET_NAME = "MEP Black Star Promos"
SET_CODE = "MEP"
GAME = "pokemon"

TCGDEX_SET_URL = f"https://api.tcgdex.net/v2/en/sets/{SET_ID}"
# Limitless CDN pattern: MEP_{NNN}_R_EN.png (holo/rare) — some cards may
# need MEP_{NNN}_C_EN or _U_EN. We try R, then U, then C.
LIMITLESS_URL_TMPL = "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/MEP/MEP_{num:03d}_{rarity}_EN.png"
RARITY_CODES = ("R", "U", "C", "SR", "UR")


def fetch_json(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cardresell-seed/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            if i == retries - 1:
                raise
            time.sleep(1 + i)


def try_download_image(num):
    """Try each rarity suffix until one works, return (bytes, image_url).

    Retries with backoff on transient 403/429/5xx from the CDN."""
    for rarity in RARITY_CODES:
        url = LIMITLESS_URL_TMPL.format(num=num, rarity=rarity)
        # up to 3 attempts per rarity with exponential backoff
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    url,
                    headers={
                        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) cardresell-seed/1.0",
                        "Accept": "image/*,*/*;q=0.8",
                    },
                )
                with urllib.request.urlopen(req, timeout=20) as r:
                    if r.status == 200:
                        return r.read(), url
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break  # try next rarity
                if e.code in (403, 429) or e.code >= 500:
                    time.sleep(2 ** attempt + 1)
                    continue
                break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(2 ** attempt)
                continue
    return None, None


# 64-bit perceptual hash (matches the algorithm used to build card-index.json).
# Standard DCT-based pHash: reduce to 32x32 grayscale, DCT, take top-left 8x8,
# threshold against median, emit 64-bit hex string.
def phash(img_bytes):
    import numpy as np
    img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((32, 32), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32)
    # Simple DCT via numpy fft (matches how our existing hashes were computed).
    def dct_1d(x):
        N = x.shape[-1]
        n = np.arange(N)
        k = n.reshape(-1, 1)
        M = np.cos(np.pi * (2 * n + 1) * k / (2 * N))
        return x @ M.T
    d = dct_1d(dct_1d(a).T).T
    top = d[:8, :8]
    med = np.median(top)
    bits = (top > med).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


# 64-bit difference hash (dHash).
def dhash(img_bytes):
    import numpy as np
    img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(img)
    diff = a[:, 1:] > a[:, :-1]
    bits = diff.flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


def main():
    print(f"[seed] Fetching {SET_ID} card list from TCGdex...", flush=True)
    set_data = fetch_json(TCGDEX_SET_URL)
    cards = set_data.get("cards", [])
    print(f"[seed] {len(cards)} cards in set", flush=True)

    print(f"[seed] Loading current index at {INDEX_PATH}...", flush=True)
    with open(INDEX_PATH) as f:
        index = json.load(f)
    print(f"[seed] Current index has {len(index)} cards", flush=True)

    # Skip cards already present.
    existing_ids = {c.get("id") for c in index if c.get("id")}
    to_add = [c for c in cards if f"{SET_ID}-{c['localId']}" not in existing_ids]
    print(f"[seed] {len(to_add)} new cards to seed (skipping {len(cards) - len(to_add)} already indexed)", flush=True)

    added = 0
    failed = []
    for c in to_add:
        local_id = c["localId"]
        num = int(local_id) if local_id.isdigit() else None
        if num is None:
            failed.append((local_id, "non-numeric localId"))
            continue

        # Fetch full card record to get rarity for our schema.
        try:
            detail = fetch_json(f"https://api.tcgdex.net/v2/en/cards/{c['id']}")
        except Exception as e:
            failed.append((local_id, f"detail fetch: {e}"))
            continue

        img_bytes, img_url = try_download_image(num)
        if not img_bytes:
            failed.append((local_id, "no image on Limitless CDN"))
            continue
        # Small delay between cards to be polite to the CDN.
        time.sleep(0.15)

        try:
            p = phash(img_bytes)
            d = dhash(img_bytes)
        except Exception as e:
            failed.append((local_id, f"hash: {e}"))
            continue

        record = {
            "id": c["id"],
            "n": detail.get("name", c["name"]),
            "s": SET_NAME,
            "si": SET_ID,
            "sc": SET_CODE,
            "nu": local_id.lstrip("0") or "0",
            "r": detail.get("rarity", "Promo"),
            "p": p,
            "d": d,
            "i": img_url,
            "g": GAME,
        }
        index.append(record)
        added += 1
        if added % 10 == 0:
            print(f"[seed]   {added}/{len(to_add)} indexed...", flush=True)

    print(f"[seed] Added {added} cards. Failed: {len(failed)}", flush=True)
    for lid, reason in failed[:15]:
        print(f"  - {lid}: {reason}", flush=True)
    if len(failed) > 15:
        print(f"  ... and {len(failed) - 15} more", flush=True)

    # Write back, preserving compact single-line format like the original.
    print(f"[seed] Writing {len(index)} records to {INDEX_PATH}...", flush=True)
    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    print("[seed] Done.", flush=True)


if __name__ == "__main__":
    main()
