#!/usr/bin/env python3
"""Backfill the 10 MEP cards the initial seed missed (55-63, 89)."""
import io, json, sys, time, urllib.request, urllib.error
from pathlib import Path
from PIL import Image
import numpy as np

REPO = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO / "card-index.json"
MISSING = [55, 56, 57, 58, 59, 60, 61, 62, 63, 89]
RARITY_CODES = ("R", "U", "C", "SR", "UR", "H")


def dct_1d(x):
    N = x.shape[-1]
    n = np.arange(N); k = n.reshape(-1, 1)
    return x @ np.cos(np.pi * (2 * n + 1) * k / (2 * N)).T


def phash(b):
    img = Image.open(io.BytesIO(b)).convert("L").resize((32, 32), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32)
    top = dct_1d(dct_1d(a).T).T[:8, :8]
    bits = (top > np.median(top)).flatten()
    n = 0
    for x in bits: n = (n << 1) | int(x)
    return f"{n:016x}"


def dhash(b):
    img = Image.open(io.BytesIO(b)).convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(img)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    n = 0
    for x in bits: n = (n << 1) | int(x)
    return f"{n:016x}"


def download(num, max_wait=30):
    for rarity in RARITY_CODES:
        url = f"https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/MEP/MEP_{num:03d}_{rarity}_EN.png"
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
                    "Accept": "image/*,*/*;q=0.8",
                    "Referer": "https://limitlesstcg.com/",
                })
                with urllib.request.urlopen(req, timeout=25) as r:
                    if r.status == 200:
                        return r.read(), url
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    break
                wait = min(2 ** attempt * 3, max_wait)
                print(f"  {num} {rarity} HTTP {e.code}, wait {wait}s", flush=True)
                time.sleep(wait)
            except Exception as e:
                time.sleep(2 ** attempt)
    return None, None


def get_name(local_id):
    try:
        req = urllib.request.Request(f"https://api.tcgdex.net/v2/en/cards/mep-{local_id}",
                                      headers={"User-Agent": "cardresell/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def main():
    with open(INDEX_PATH) as f:
        index = json.load(f)
    print(f"[gaps] Backfilling {len(MISSING)} MEP cards", flush=True)

    added = 0
    for num in MISSING:
        local_id = f"{num:03d}"
        img_bytes, img_url = download(num)
        if not img_bytes:
            print(f"  [{num}] no image after retries", flush=True)
            continue
        detail = get_name(local_id)
        rec = {
            "id": f"mep-{local_id}",
            "n": detail.get("name", f"MEP #{num}"),
            "s": "MEP Black Star Promos",
            "si": "mep",
            "sc": "MEP",
            "nu": str(num),
            "r": detail.get("rarity", "Promo"),
            "p": phash(img_bytes),
            "d": dhash(img_bytes),
            "i": img_url,
            "g": "pokemon",
        }
        index.append(rec)
        added += 1
        print(f"  [{num}] {rec['n']} \u2713", flush=True)
        time.sleep(0.8)  # be gentle after being throttled

    with open(INDEX_PATH, "w") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    print(f"[gaps] Added {added}/{len(MISSING)}. Index now: {len(index)}", flush=True)


if __name__ == "__main__":
    main()
