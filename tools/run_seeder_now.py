#!/usr/bin/env python3
"""
One-off manual runner: seed the top-3 highest-priority recent Pokemon sets
right now, using the same seed_set() core the weekly cron uses.

Skips discovery-enrichment (already known target list) and the pokemontcg.io
priority check to fit in the interactive sandbox budget. The weekly cron does
the full discovery + prioritization on its own schedule where wall-time is
not a constraint.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_set import load_index, save_index, seed_set  # type: ignore

REPO = Path(__file__).resolve().parents[1]

# Pre-computed target list: recent physical Pokemon sets missing from our index,
# sorted newest-release first. (Derived from earlier discovery run.)
# For the manual trigger we take the top 3 to respect the 3-set-per-run cap.
TARGETS = [
    ("me05",     "Pitch Black",           120),
    ("me04",     "Chaos Rising",          122),
    ("me03",     "Perfect Order",         124),
]

MAX_CARDS = int(os.environ.get("SEED_MAX_CARDS", "500"))


def run_git(args):
    cmd = ["git", "-c", "user.email=willsep200@gmail.com", "-c", "user.name=CardResell", *args]
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)


def main() -> int:
    started = time.time()
    print(f"[run-now] targeting {len(TARGETS)} sets, max {MAX_CARDS} cards", flush=True)

    index = load_index()
    starting_size = len(index)
    print(f"[run-now] index size at start: {starting_size}", flush=True)

    summaries = []
    cards_this_run = 0

    for set_id, set_name, expected_count in TARGETS:
        if cards_this_run + expected_count > MAX_CARDS and summaries:
            print(f"[run-now] skipping {set_id}: would exceed {MAX_CARDS}-card cap", flush=True)
            continue
        print(f"[run-now] seeding {set_id} ({set_name}, ~{expected_count} cards)...", flush=True)
        t0 = time.time()
        try:
            stats = seed_set(set_id, index)
        except Exception as e:
            print(f"[run-now]   ERROR: {e}", flush=True)
            continue
        elapsed = int(time.time() - t0)
        print(f"[run-now]   done in {elapsed}s: added={stats['added']} failed={stats['failed']}", flush=True)

        if stats["added"] > 0:
            save_index(index)
            cards_this_run += stats["added"]
            summaries.append({
                "set_id": stats["set_id"],
                "set_name": stats["set_name"],
                "added": stats["added"],
                "failed": stats["failed"],
            })

    # Commit + push if anything landed.
    committed = False
    commit_msg_body = ""
    if summaries:
        run_git(["add", "card-index.json"])
        diff = run_git(["diff", "--cached", "--quiet"])
        if diff.returncode != 0:  # there IS a diff
            msg_lines = ["Auto-seed: manual trigger of weekly job", ""]
            for s in summaries:
                msg_lines.append(f"- {s['set_id']:8s}  +{s['added']:4d} cards  {s['set_name']}"
                                 + (f"  ({s['failed']} failed)" if s.get("failed") else ""))
            msg_lines.append("")
            msg_lines.append("Manually triggered the same job that will run every Sunday. "
                             "Priority given to recently released sets missing from the offline "
                             "pHash index (card-index.json). Non-destructive: additive only.")
            commit_msg_body = "\n".join(msg_lines)
            r = run_git(["commit", "-m", commit_msg_body])
            print(f"[run-now] commit rc={r.returncode}", flush=True)
            if r.returncode == 0:
                r = run_git(["push", "origin", "main"])
                print(f"[run-now] push rc={r.returncode}: {r.stdout.strip()} {r.stderr.strip()}", flush=True)
                committed = (r.returncode == 0)

    elapsed_total = int(time.time() - started)
    report = {
        "newly_seeded": summaries,
        "index_size_before": starting_size,
        "index_size_after": len(index),
        "cards_added": cards_this_run,
        "committed": committed,
        "elapsed_seconds": elapsed_total,
    }
    print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
