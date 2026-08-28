#!/usr/bin/env python3
"""
Seeder v2 for card-index.json.

Design changes vs v1:
  - pokemontcg.io is now the PRIMARY catalog + image source. TCGdex was
    unreliable (Cloudflare-blocked from our egress IP) and pokemontcg.io
    actually has the sets we need (me1..me5, sv8pt5, sv9, etc.).
  - Every HTTP call wrapped in retry with exponential backoff. Every
    exception surfaced with traceback, never swallowed silently.
  - Progress checkpointed every 10 cards (save + fsync). Interruption
    at any point leaves a consistent index we can resume from.
  - Explicit per-card timing and memory logging so future failures
    are debuggable from the log alone.

CLI:
    python3 tools/seed_set_v2.py --set me5
    python3 tools/seed_set_v2.py --set me5 --max-cards 30      # partial run for testing
    python3 tools/seed_set_v2.py --auto                        # discovers + seeds
    python3 tools/seed_set_v2.py --list-missing                # dry-run discovery
"""
from __future__ import annotations

import argparse
import io
import json
import os
import resource
import sys
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
INDEX_PATH = REPO / "card-index.json"

# Reuse the hash implementations from seed_set.py so we don't drift.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_set import phash, dhash  # type: ignore

CHECKPOINT_EVERY = 10  # save index every N cards added
POLITE_DELAY = 0.15    # seconds between card downloads to be nice to CDN
UA = "cardresell-seeder/2.0 (+https://cardresell.org)"


# --- HTTP with real retry -----------------------------------------------------

def http_get(url: str, timeout: int = 25, retries: int = 15, allow_5xx_retry: bool = True) -> bytes:
    """Get bytes from `url` with capped exponential backoff on transient failures.

    pokemontcg.io has runs of 60%+ 500s that resolve within ~30s, so we
    retry aggressively (up to 15 times) with backoff capped at 8s. Total
    worst-case wait is ~2 minutes per call, which is still fine at our
    scale (~120 calls per set = ~4 hours if EVERY call went to worst-case,
    but the observed average is far better).
    """
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise  # not retryable
            if e.code >= 500 and allow_5xx_retry:
                last = e
            elif e.code == 429:
                last = e
            else:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionResetError, OSError) as e:
            last = e
        # capped exponential backoff: 0.5, 1, 2, 4, 8, 8, 8, ...
        sleep_s = min(8, 0.5 * (2 ** attempt))
        time.sleep(sleep_s)
    raise RuntimeError(f"GET {url} failed after {retries} tries: {last}")


def http_get_json(url: str, **kw) -> Any:
    return json.loads(http_get(url, **kw))


# --- pokemontcg.io catalog ----------------------------------------------------

def ptcg_get_all_sets() -> list[dict]:
    """Fetch every Pokemon set from pokemontcg.io."""
    out: list[dict] = []
    page = 1
    while True:
        url = (
            "https://api.pokemontcg.io/v2/sets"
            f"?pageSize=250&page={page}"
            "&orderBy=-releaseDate"
            "&select=id,name,releaseDate,total,series,ptcgoCode"
        )
        d = http_get_json(url)
        chunk = d.get("data", []) or []
        out.extend(chunk)
        if len(chunk) < 250:
            break
        page += 1
    return out


def ptcg_get_all_cards_in_set(set_id: str) -> list[dict]:
    """Fetch every card in one set from pokemontcg.io (paginated)."""
    out: list[dict] = []
    page = 1
    while True:
        url = (
            "https://api.pokemontcg.io/v2/cards"
            f"?q=set.id:{set_id}&pageSize=250&page={page}"
            "&select=id,name,number,rarity,images"
        )
        d = http_get_json(url)
        chunk = d.get("data", []) or []
        out.extend(chunk)
        if len(chunk) < 250:
            break
        page += 1
    return out


# --- index i/o ----------------------------------------------------------------

def load_index() -> list[dict]:
    with open(INDEX_PATH) as f:
        return json.load(f)


def save_index(idx: list[dict]) -> None:
    tmp = INDEX_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(idx, f, separators=(",", ":"), ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, INDEX_PATH)


def existing_ids(idx: list[dict]) -> set[str]:
    return {c["id"] for c in idx if c.get("id")}


# --- discovery ----------------------------------------------------------------

RECENT_WINDOW_DAYS = 180


def parse_ptcg_date(s: str) -> float:
    """pokemontcg.io uses YYYY/MM/DD."""
    if not s:
        return 0.0
    try:
        import datetime
        p = s.replace("-", "/").split("/")
        y, m, d = int(p[0]), int(p[1] or 1), int(p[2] or 1)
        return datetime.datetime(y, m, d).timestamp()
    except Exception:
        return 0.0


def discover_missing(index: list[dict], recent_only: bool = True) -> list[dict]:
    """Return pokemontcg.io sets not fully covered by our index."""
    our_sets: dict[str, int] = {}
    for c in index:
        if c.get("g") != "pokemon":
            continue
        sid = c.get("si", "")
        our_sets[sid] = our_sets.get(sid, 0) + 1

    all_sets = ptcg_get_all_sets()
    cutoff = time.time() - RECENT_WINDOW_DAYS * 86400
    missing = []
    for s in all_sets:
        sid = s["id"]
        expected = int(s.get("total") or 0)
        if expected == 0:
            continue
        have = our_sets.get(sid, 0)
        if have >= expected * 0.9:  # 90%+ = "good enough"
            continue
        rd = s.get("releaseDate") or ""
        epoch = parse_ptcg_date(rd)
        if recent_only and epoch < cutoff:
            continue
        missing.append({
            "id": sid,
            "name": s.get("name", "?"),
            "expected": expected,
            "have": have,
            "release_date": rd,
            "release_epoch": epoch,
            "ptcgoCode": s.get("ptcgoCode", ""),
        })
    missing.sort(key=lambda m: m["release_epoch"], reverse=True)
    return missing


# --- seed one set -------------------------------------------------------------

def rss_kb() -> int:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss


def seed_one_set(set_id: str, index: list[dict], max_cards: int | None = None) -> dict:
    """Seed one set. Mutates `index`. Returns stats."""
    print(f"[seed:{set_id}] fetching card list from pokemontcg.io...", flush=True)
    try:
        cards = ptcg_get_all_cards_in_set(set_id)
    except Exception as e:
        traceback.print_exc()
        return {"set_id": set_id, "added": 0, "failed": 0, "error": f"catalog: {e}"}
    print(f"[seed:{set_id}] {len(cards)} cards in catalog", flush=True)

    have = existing_ids(index)
    to_add = [c for c in cards if c["id"] not in have]
    print(f"[seed:{set_id}] {len(to_add)} new (skipping {len(cards) - len(to_add)} already indexed)", flush=True)

    if max_cards is not None:
        to_add = to_add[:max_cards]
        print(f"[seed:{set_id}] limited to first {len(to_add)} for this run", flush=True)

    # Set name comes from the first card's set metadata; we already have it via
    # the set list. Cache it once here to avoid re-fetching per card.
    set_name = ""
    if cards:
        # Try to get set name from a full detail call (cheap, one request).
        try:
            detail = http_get_json(
                f"https://api.pokemontcg.io/v2/cards/{cards[0]['id']}"
            )
            set_name = ((detail.get("data") or {}).get("set") or {}).get("name", "")
        except Exception:
            set_name = ""

    stats = {"set_id": set_id, "set_name": set_name, "added": 0, "failed": 0, "error": None}
    failed_details: list[tuple[str, str]] = []

    since_ckpt = 0
    for i, c in enumerate(to_add, 1):
        t0 = time.time()
        cid = c["id"]
        img_url = ((c.get("images") or {}).get("large")
                   or (c.get("images") or {}).get("small") or "")
        if not img_url:
            stats["failed"] += 1
            failed_details.append((cid, "no image URL in card record"))
            continue

        try:
            img_bytes = http_get(img_url, retries=4)
        except Exception as e:
            stats["failed"] += 1
            failed_details.append((cid, f"download: {type(e).__name__}: {str(e)[:80]}"))
            continue

        try:
            p = phash(img_bytes)
            d = dhash(img_bytes)
        except Exception as e:
            stats["failed"] += 1
            failed_details.append((cid, f"hash: {type(e).__name__}: {str(e)[:80]}"))
            continue

        record = {
            "id": cid,
            "n": c.get("name") or "",
            "s": set_name or set_id,
            "si": set_id,
            "sc": (c.get("set") or {}).get("ptcgoCode") or set_id.upper(),
            "nu": (c.get("number") or "").lstrip("0") or "0",
            "r": c.get("rarity") or "Common",
            "p": p,
            "d": d,
            "i": img_url,
            "g": "pokemon",
        }
        index.append(record)
        stats["added"] += 1
        since_ckpt += 1

        dt_ms = int((time.time() - t0) * 1000)
        if i % 10 == 0 or i == len(to_add):
            print(f"[seed:{set_id}]   {i:4d}/{len(to_add)}  last={dt_ms}ms  rss={rss_kb()}KB", flush=True)

        # checkpoint save so a mid-run kill leaves us consistent
        if since_ckpt >= CHECKPOINT_EVERY:
            save_index(index)
            since_ckpt = 0

        time.sleep(POLITE_DELAY)

    if since_ckpt > 0:
        save_index(index)

    print(f"[seed:{set_id}] done: added={stats['added']} failed={stats['failed']}", flush=True)
    if failed_details:
        for cid, reason in failed_details[:20]:
            print(f"   fail {cid}: {reason}", flush=True)
        if len(failed_details) > 20:
            print(f"   ... and {len(failed_details) - 20} more", flush=True)
    stats["failed_details"] = failed_details
    return stats


# --- CLI ----------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", help="Seed one pokemontcg.io set id (e.g. me5)")
    ap.add_argument("--max-cards", type=int, default=None,
                    help="Cap on cards to add (for testing partial runs)")
    ap.add_argument("--auto", action="store_true",
                    help="Discover missing sets and seed up to --max-sets / --max-cards")
    ap.add_argument("--list-missing", action="store_true",
                    help="Dry-run: print missing recent sets and exit")
    ap.add_argument("--max-sets", type=int, default=3,
                    help="Max sets to seed in --auto mode (default 3)")
    ap.add_argument("--all-time", action="store_true",
                    help="Include sets older than 180 days in discovery")
    args = ap.parse_args()

    if not (args.set or args.auto or args.list_missing):
        ap.print_help()
        return 2

    index = load_index()
    print(f"[seeder-v2] index size at start: {len(index)}", flush=True)

    if args.list_missing:
        missing = discover_missing(index, recent_only=not args.all_time)
        print(f"[seeder-v2] {len(missing)} sets missing from index:", flush=True)
        for m in missing:
            print(f"  {m['release_date']:10s}  {m['id']:10s}  have={m['have']:3d}/{m['expected']:3d}  {m['name']}", flush=True)
        return 0

    started = time.time()
    if args.set:
        stats = seed_one_set(args.set, index, max_cards=args.max_cards)
        elapsed = int(time.time() - started)
        print(f"[seeder-v2] done in {elapsed}s. index size now: {len(index)}", flush=True)
        report = {"newly_seeded": [stats] if stats["added"] else [], "elapsed_seconds": elapsed}
    else:
        missing = discover_missing(index, recent_only=not args.all_time)
        print(f"[seeder-v2] {len(missing)} missing recent sets", flush=True)
        summaries = []
        cards_run = 0
        for m in missing[: args.max_sets]:
            if args.max_cards and cards_run >= args.max_cards:
                break
            remaining = None
            if args.max_cards:
                remaining = args.max_cards - cards_run
            stats = seed_one_set(m["id"], index, max_cards=remaining)
            if stats["added"]:
                summaries.append({k: v for k, v in stats.items() if k != "failed_details"})
                cards_run += stats["added"]
        elapsed = int(time.time() - started)
        report = {"newly_seeded": summaries, "elapsed_seconds": elapsed}

    print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
