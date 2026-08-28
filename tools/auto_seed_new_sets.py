#!/usr/bin/env python3
"""
Weekly auto-seeder for card-index.json (v2).

Runs from a scheduled task every Sunday. Detects newly released Pokemon
sets that our offline pHash index doesn't yet cover, seeds them, and
prints a JSON report the calling agent turns into a user notification.

v2 rewrite (2026-08-28):
  - pokemontcg.io is now the primary catalog + image source. TCGdex was
    blocking our egress IP with connection resets.
  - Aggressive retry: pokemontcg.io has 40-60% 500 rates that recover
    within ~30s, so we do up to 15 retries with capped backoff.
  - Checkpoint save every 10 cards so any mid-run interruption leaves
    a consistent index we can resume from.
  - Every exception surfaces with traceback (nothing swallowed silently).

Caps per run:
  - AUTOSEED_MAX_SETS   (default 3)
  - AUTOSEED_MAX_CARDS  (default 500)

Report format (last line of stdout):
    __AUTOSEED_REPORT__ {"newly_seeded": [...], "skipped": [...],
                          "errors": [...], "index_size_before": N,
                          "index_size_after": N, "elapsed_seconds": N}
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_set_v2 import (  # type: ignore
    INDEX_PATH,
    discover_missing,
    load_index,
    seed_one_set,
)

REPO = Path(__file__).resolve().parents[1]
MAX_CARDS_PER_RUN = int(os.environ.get("AUTOSEED_MAX_CARDS", "500"))
MAX_SETS_PER_RUN = int(os.environ.get("AUTOSEED_MAX_SETS", "3"))
GIT_EMAIL = "willsep200@gmail.com"
GIT_NAME = "CardResell"


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    cmd = ["git", "-c", f"user.email={GIT_EMAIL}", "-c", f"user.name={GIT_NAME}", *args]
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def git_commit_and_push(seeded: list[dict[str, Any]]) -> tuple[bool, str]:
    """Stage card-index.json, commit with a descriptive message, and push."""
    r = run_git(["add", "card-index.json"], REPO)
    if r.returncode != 0:
        return False, f"git add failed: {r.stderr.strip()}"

    r = run_git(["diff", "--cached", "--quiet"], REPO)
    if r.returncode == 0:
        return False, "no changes to commit"

    lines = ["Auto-seed new Pokemon sets", ""]
    for s in seeded:
        line = f"- {s['set_id']:12s}  +{s['added']:4d} cards  {s.get('set_name') or s['set_id']}"
        if s.get("failed"):
            line += f"  ({s['failed']} failed)"
        lines.append(line)
    lines.append("")
    lines.append("Weekly auto-seeder run. Source: pokemontcg.io (catalog + images).")
    lines.append("Non-destructive: additive-only to card-index.json.")
    msg = "\n".join(lines)

    r = run_git(["commit", "-m", msg], REPO)
    if r.returncode != 0:
        return False, f"commit failed: {r.stderr.strip()}"

    r = run_git(["push", "origin", "main"], REPO)
    if r.returncode != 0:
        return False, f"push failed: {r.stderr.strip()}"

    return True, "committed and pushed"


def main() -> int:
    started = time.time()
    print(f"[autoseed] starting (max_cards={MAX_CARDS_PER_RUN}, max_sets={MAX_SETS_PER_RUN})", flush=True)

    try:
        index = load_index()
    except Exception as e:
        traceback.print_exc()
        report = {"newly_seeded": [], "skipped": [], "errors": [f"load_index: {e}"]}
        print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
        return 1
    starting_size = len(index)
    print(f"[autoseed] index size at start: {starting_size}", flush=True)

    try:
        missing = discover_missing(index, recent_only=True)
    except Exception as e:
        traceback.print_exc()
        report = {
            "newly_seeded": [],
            "skipped": [],
            "errors": [f"discovery: {e}"],
            "index_size_before": starting_size,
            "index_size_after": starting_size,
        }
        print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
        return 1

    print(f"[autoseed] {len(missing)} missing recent Pokemon sets", flush=True)
    for m in missing[:10]:
        print(f"   {m['release_date']:10s} {m['id']:12s} have={m['have']}/{m['expected']:4d}  {m['name']}", flush=True)

    if not missing:
        elapsed = int(time.time() - started)
        report = {
            "newly_seeded": [],
            "skipped": [],
            "errors": [],
            "index_size_before": starting_size,
            "index_size_after": starting_size,
            "elapsed_seconds": elapsed,
        }
        print(f"[autoseed] nothing to seed. done in {elapsed}s.", flush=True)
        print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
        return 0

    seeded_summaries: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[str] = []
    cards_this_run = 0

    for m in missing:
        if len(seeded_summaries) >= MAX_SETS_PER_RUN:
            skipped.append({"set_id": m["id"], "reason": "max_sets_per_run cap"})
            continue
        remaining = MAX_CARDS_PER_RUN - cards_this_run
        if remaining <= 0 and seeded_summaries:
            skipped.append({"set_id": m["id"], "reason": "max_cards_per_run cap"})
            continue

        try:
            stats = seed_one_set(m["id"], index, max_cards=remaining)
        except Exception as e:
            traceback.print_exc()
            errors.append(f"{m['id']}: {type(e).__name__}: {e}")
            continue

        if stats.get("error"):
            errors.append(f"{m['id']}: {stats['error']}")
            continue

        if stats["added"] > 0:
            cards_this_run += stats["added"]
            seeded_summaries.append({
                "set_id": stats["set_id"],
                "set_name": stats.get("set_name") or m["name"],
                "added": stats["added"],
                "failed": stats.get("failed", 0),
                "release_date": m.get("release_date", ""),
            })
        else:
            skipped.append({
                "set_id": m["id"],
                "set_name": m["name"],
                "reason": "no cards added (all downloads/hashes failed)",
                "failed": stats.get("failed", 0),
            })

    # Commit + push if anything landed.
    committed = False
    if seeded_summaries:
        try:
            ok, git_msg = git_commit_and_push(seeded_summaries)
            committed = ok
            if not ok:
                errors.append(f"git: {git_msg}")
            print(f"[autoseed] git: {git_msg}", flush=True)
        except Exception as e:
            traceback.print_exc()
            errors.append(f"git: {type(e).__name__}: {e}")

    elapsed = int(time.time() - started)
    report = {
        "newly_seeded": seeded_summaries,
        "skipped": skipped,
        "errors": errors,
        "committed": committed,
        "index_size_before": starting_size,
        "index_size_after": len(index),
        "cards_added": cards_this_run,
        "elapsed_seconds": elapsed,
    }
    print(
        f"[autoseed] done in {elapsed}s. "
        f"added {cards_this_run} cards across {len(seeded_summaries)} sets. "
        f"skipped {len(skipped)}. errors {len(errors)}",
        flush=True,
    )
    print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
    return 0 if not errors else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
