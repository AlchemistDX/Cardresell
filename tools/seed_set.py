#!/usr/bin/env python3
"""
Generalized set-seeder for card-index.json.

Usage:
    python3 tools/seed_set.py <tcgdex_set_id> [<tcgdex_set_id> ...]
    python3 tools/seed_set.py --auto           # seed every missing physical set
    python3 tools/seed_set.py --list-missing   # print missing sets and exit

Given a TCGdex set id (e.g. 'me01', 'sv08', 'mep'), this fetches the
full card list from TCGdex and downloads each image from the first
CDN that responds, tries several URL patterns, computes pHash + dHash
matching the existing card-index.json schema, and appends the records.

Idempotent: cards already in the index are skipped. Safe to re-run
after adding a new set upstream.

Image sources tried, in order:
  1. Limitless TCG  (best coverage for recent SV/MEP sets)
  2. pokemontcg.io  (best coverage for classic sets, id-normalized)
  3. TCGdex assets  (fallback for cards TCGdex has images for)
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

try:
    from PIL import Image
    import numpy as np
except ImportError:
    import subprocess
    print("Installing Pillow + numpy...", file=sys.stderr)
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "Pillow", "numpy"])
    from PIL import Image
    import numpy as np


REPO = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO / "card-index.json"

# TCGdex series ids we consider "physical" (real cards, not the mobile Pocket app).
PHYSICAL_SERIES = {
    "base", "gym", "neo", "lc", "ecard", "ex", "pop", "tk", "dp", "pl",
    "hgss", "col", "bw", "mc", "xy", "sm", "swsh", "sv", "me", "misc",
}

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 cardresell-seed/2.0"
DEFAULT_HEADERS = {"User-Agent": USER_AGENT, "Accept": "image/*,*/*;q=0.8"}


# --------- hashing -----------------------------------------------------------


def _dct_1d(x: np.ndarray) -> np.ndarray:
    n_arr = np.arange(x.shape[-1])
    k = n_arr.reshape(-1, 1)
    M = np.cos(np.pi * (2 * n_arr + 1) * k / (2 * x.shape[-1]))
    return x @ M.T


def phash(img_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((32, 32), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32)
    top = _dct_1d(_dct_1d(a).T).T[:8, :8]
    bits = (top > np.median(top)).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


def dhash(img_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(img_bytes)).convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(img)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    n = 0
    for b in bits:
        n = (n << 1) | int(b)
    return f"{n:016x}"


# --------- HTTP helpers ------------------------------------------------------


def _http_get_json(url: str, retries: int = 3, timeout: int = 20):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return json.loads(r.read())
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries} tries: {last}")


def _http_get_bytes(url: str, retries: int = 3, timeout: int = 25) -> Optional[bytes]:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return r.read()
                if r.status == 404:
                    return None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (403, 429) or e.code >= 500:
                time.sleep(2 ** attempt + 1)
                continue
            return None
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt)
    return None


# --------- image source resolution -------------------------------------------


def _pokemontcg_id(tcgdex_id: str) -> Optional[str]:
    """Map TCGdex set ids to pokemontcg.io ids. TCGdex is zero-padded and dot-versioned;
    pokemontcg.io drops leading zeros and uses 'pt' for '.5' etc."""
    s = tcgdex_id.lower()
    # sv08 -> sv8, sv08.5 -> sv8pt5, swsh12.5 -> swsh12pt5
    m = re.match(r"^([a-z]+)0*(\d+)(?:\.(\d+))?([a-z]?)$", s)
    if m:
        prefix, num, sub, suffix = m.groups()
        if sub:
            return f"{prefix}{num}pt{sub}{suffix}"
        return f"{prefix}{num}{suffix}"
    return s


def _limitless_prefix(tcgdex_id: str) -> str:
    """Limitless uses UPPERCASE set code, e.g. MEP, SV08."""
    return tcgdex_id.upper()


def _pad3(n: str) -> str:
    """Zero-pad a card number to 3 digits if it's numeric."""
    if n.isdigit():
        return f"{int(n):03d}"
    return n


def download_card_image(tcgdex_id: str, local_id: str) -> tuple[Optional[bytes], Optional[str]]:
    """Try each known image source; return (bytes, url) on first hit."""
    ptcg_id = _pokemontcg_id(tcgdex_id)
    limitless = _limitless_prefix(tcgdex_id)
    padded = _pad3(local_id)
    raw = local_id.lstrip("0") or "0"

    candidates = []

    # 1. Limitless \u2014 best for very recent sets (MEP, sv09, sv10.5)
    for rarity in ("R", "H", "U", "C", "SR", "UR", "P"):
        candidates.append(
            f"https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/{limitless}/{limitless}_{padded}_{rarity}_EN.png"
        )

    # 2. pokemontcg.io \u2014 canonical for classic sets, hi-res + small
    for num in (raw, padded):
        candidates.append(f"https://images.pokemontcg.io/{ptcg_id}/{num}_hires.png")
        candidates.append(f"https://images.pokemontcg.io/{ptcg_id}/{num}.png")

    # 3. TCGdex asset CDN \u2014 last resort (many sets lack images here)
    for quality in ("high", "low"):
        candidates.append(f"https://assets.tcgdex.net/en/tcgp/{tcgdex_id}/{padded}/{quality}.png")
        candidates.append(f"https://assets.tcgdex.net/en/{tcgdex_id}/{padded}/{quality}.png")

    for url in candidates:
        b = _http_get_bytes(url)
        if b:
            return b, url
    return None, None


# --------- index I/O ---------------------------------------------------------


def load_index() -> list[dict]:
    with open(INDEX_PATH) as f:
        return json.load(f)


def save_index(index: list[dict]) -> None:
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    tmp.replace(INDEX_PATH)


def existing_card_ids(index: list[dict]) -> set[str]:
    return {c.get("id", "") for c in index if c.get("id")}


# --------- seeding -----------------------------------------------------------


def seed_set(tcgdex_id: str, index: list[dict], polite_delay: float = 0.2) -> dict:
    """Seed one set. Mutates `index` in place. Returns stats dict."""
    print(f"[seed:{tcgdex_id}] fetching card list...", flush=True)
    set_data = _http_get_json(f"https://api.tcgdex.net/v2/en/sets/{tcgdex_id}")
    cards = set_data.get("cards", [])
    set_name = set_data.get("name", tcgdex_id)
    print(f"[seed:{tcgdex_id}] {len(cards)} cards in '{set_name}'", flush=True)

    have_ids = existing_card_ids(index)
    to_add = [c for c in cards if f"{tcgdex_id}-{c['localId']}" not in have_ids]
    print(f"[seed:{tcgdex_id}] {len(to_add)} new (skipping {len(cards) - len(to_add)} already present)", flush=True)

    stats = {"added": 0, "failed": 0, "already": len(cards) - len(to_add), "set_id": tcgdex_id, "set_name": set_name}
    failed_reasons: list[tuple[str, str]] = []

    for i, c in enumerate(to_add, 1):
        local_id = c["localId"]
        try:
            img_bytes, img_url = download_card_image(tcgdex_id, local_id)
        except Exception as e:
            stats["failed"] += 1
            failed_reasons.append((local_id, f"download: {e}"))
            continue
        if not img_bytes:
            stats["failed"] += 1
            failed_reasons.append((local_id, "no image on any CDN"))
            continue

        try:
            p = phash(img_bytes)
            d = dhash(img_bytes)
        except Exception as e:
            stats["failed"] += 1
            failed_reasons.append((local_id, f"hash: {e}"))
            continue

        # Fetch card detail once for rarity + confirmed name (best-effort).
        rarity = "Common"
        name = c.get("name", "")
        try:
            detail = _http_get_json(f"https://api.tcgdex.net/v2/en/cards/{c['id']}", retries=2)
            rarity = detail.get("rarity") or rarity
            name = detail.get("name") or name
        except Exception:
            pass

        record = {
            "id": c["id"],
            "n": name,
            "s": set_name,
            "si": tcgdex_id,
            "sc": tcgdex_id.upper(),
            "nu": local_id.lstrip("0") or "0",
            "r": rarity,
            "p": p,
            "d": d,
            "i": img_url or "",
            "g": "pokemon",  # set below by resolve_game if not pokemon
        }
        index.append(record)
        stats["added"] += 1

        if i % 25 == 0:
            print(f"[seed:{tcgdex_id}]   {i}/{len(to_add)} ...", flush=True)
        time.sleep(polite_delay)

    print(f"[seed:{tcgdex_id}] added={stats['added']} failed={stats['failed']} already={stats['already']}", flush=True)
    if failed_reasons and len(failed_reasons) <= 20:
        for lid, reason in failed_reasons:
            print(f"   fail {lid}: {reason}", flush=True)
    elif failed_reasons:
        for lid, reason in failed_reasons[:15]:
            print(f"   fail {lid}: {reason}", flush=True)
        print(f"   ... and {len(failed_reasons) - 15} more", flush=True)
    stats["failed_reasons"] = failed_reasons
    return stats


# --------- discovery ---------------------------------------------------------


def discover_missing_sets(index: list[dict], enrich_release_dates: bool = True) -> list[dict]:
    """Return a list of TCGdex sets not present in the index, physical-TCG only.

    TCGdex's series-list endpoint doesn't include per-set release dates, so
    when `enrich_release_dates` is set we fetch each missing set's detail
    endpoint to get the date. That's ~1 HTTP call per missing set.
    """
    our_sets = set(c.get("si", "") for c in index if c.get("g") == "pokemon")
    missing = []
    for serie in sorted(PHYSICAL_SERIES):
        try:
            serie_data = _http_get_json(f"https://api.tcgdex.net/v2/en/series/{serie}", retries=2)
        except Exception:
            continue
        for s in serie_data.get("sets", []):
            if s["id"] in our_sets:
                continue
            missing.append({
                "id": s["id"],
                "name": s.get("name", "?"),
                "serie": serie,
                "count": (s.get("cardCount") or {}).get("total", 0),
                "release_date": s.get("releaseDate", "") or "",
            })

    if enrich_release_dates:
        for m in missing:
            if m["release_date"]:
                continue
            try:
                detail = _http_get_json(f"https://api.tcgdex.net/v2/en/sets/{m['id']}", retries=2)
                m["release_date"] = detail.get("releaseDate", "") or ""
            except Exception:
                pass
            time.sleep(0.1)

    missing.sort(key=lambda x: (x.get("release_date") or "", x["id"]))
    return missing


# --------- main --------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("set_ids", nargs="*", help="TCGdex set ids to seed")
    ap.add_argument("--auto", action="store_true", help="Seed every missing physical set")
    ap.add_argument("--list-missing", action="store_true", help="List missing sets and exit")
    ap.add_argument("--max-cards-per-set", type=int, default=None, help="Cap cards per set (debug)")
    ap.add_argument("--max-sets", type=int, default=None, help="Cap sets seeded in --auto (safety)")
    args = ap.parse_args()

    index = load_index()
    print(f"Loaded index: {len(index)} cards", flush=True)

    if args.list_missing:
        missing = discover_missing_sets(index)
        print(f"\nMissing physical Pok\u00e9mon sets: {len(missing)}")
        print(f"Total cards to seed: {sum(m['count'] for m in missing)}")
        print()
        for m in missing:
            print(f"  {m['release_date']:12s}  {m['id']:12s}  {m['count']:4d} cards  [{m['serie']:5s}]  {m['name']}")
        return 0

    targets: list[str]
    if args.auto:
        missing = discover_missing_sets(index)
        targets = [m["id"] for m in missing]
        if args.max_sets:
            targets = targets[:args.max_sets]
        print(f"[auto] {len(targets)} sets to seed", flush=True)
    else:
        targets = args.set_ids
        if not targets:
            ap.error("Provide set ids, or --auto, or --list-missing")
            return 2

    all_stats = []
    for sid in targets:
        try:
            stats = seed_set(sid, index)
            all_stats.append(stats)
            # Persist after every set so partial progress survives errors.
            save_index(index)
            print(f"[seed:{sid}] index persisted ({len(index)} total cards)", flush=True)
        except Exception as e:
            print(f"[seed:{sid}] FAILED: {e}", flush=True)

    print()
    print("=== Summary ===")
    total_added = sum(s["added"] for s in all_stats)
    total_failed = sum(s["failed"] for s in all_stats)
    print(f"Sets processed: {len(all_stats)}")
    print(f"Cards added:    {total_added}")
    print(f"Cards failed:   {total_failed}")
    for s in all_stats:
        print(f"  {s['set_id']:12s}  {s['set_name']:35s}  +{s['added']:4d}  \u2717{s['failed']:3d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
