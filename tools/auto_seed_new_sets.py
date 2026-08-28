#!/usr/bin/env python3
"""
Weekly auto-seeder for card-index.json.

Runs from a scheduled task. Detects new upstream Pokemon sets that our
offline pHash index doesn't yet cover, seeds them, and prints a JSON
report the calling agent can turn into a user notification.

Strategy:
  1. Fetch every physical-TCG set from TCGdex (authoritative catalog).
  2. Diff against card-index.json to find sets missing from the offline index.
  3. Prioritize sets pokemontcg.io ALSO doesn't have (or has 500'd on) \u2014
     those are the MEP-style truly-new releases where the offline index is
     the only path to a free/instant match.
  4. Cap the run at a max card count so a single weekly job doesn't blow
     the budget (default 500 new cards). Anything above cap is deferred to
     next week or a manual on-demand run.
  5. Commit and push if anything changed. Emit a JSON report on stdout.

Report format (last line of stdout):
    __AUTOSEED_REPORT__ {"newly_seeded": [...], "skipped": [...], "errors": [...]}
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# We import from the sibling module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_set import (  # type: ignore
    INDEX_PATH,
    PHYSICAL_SERIES,
    _http_get_json,
    discover_missing_sets,
    load_index,
    save_index,
    seed_set,
)

REPO = Path(__file__).resolve().parents[1]
MAX_CARDS_PER_RUN = int(os.environ.get("AUTOSEED_MAX_CARDS", "500"))
MAX_SETS_PER_RUN = int(os.environ.get("AUTOSEED_MAX_SETS", "3"))
GIT_EMAIL = "willsep200@gmail.com"
GIT_NAME = "CardResell"


def check_pokemontcg_has_set(set_id: str) -> tuple[bool, int]:
    """Return (present, card_count). Also returns present=False on 5xx errors."""
    # TCGdex ids and pokemontcg.io ids share the same shape for many sets, but
    # the seeding tool has _pokemontcg_id() that maps sv08 -> sv8 etc. Reuse it.
    from seed_set import _pokemontcg_id  # local import to avoid cycles

    ptcg = _pokemontcg_id(set_id)
    url = f"https://api.pokemontcg.io/v2/cards?q=set.id:{ptcg}&pageSize=1&select=id"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "cardresell-autoseed/1.0"})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 200:
                    d = json.loads(r.read())
                    n = d.get("totalCount", 0)
                    return (n > 0, n)
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            return (False, 0)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * (attempt + 1))
    return (False, 0)


# Only auto-seed sets released within this window. Older missing sets
# (McDonald's promos, decade-old Trainer Kits) are back-catalog gaps we
# don't want the weekly cron to chew on. On-demand seeding via seed_set.py
# remains the path for those.
RECENT_WINDOW_DAYS = 180


def _release_epoch(m: dict[str, Any]) -> float:
    rd = m.get("release_date") or ""
    if not rd:
        return 0.0
    try:
        import datetime
        parts = [int(p) for p in rd.split("-")]
        while len(parts) < 3:
            parts.append(1)
        return datetime.datetime(*parts[:3]).timestamp()
    except Exception:
        return 0.0


def prioritize(missing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Rank missing sets so the truly-new releases are seeded first.

    Filters and ranking:
      1. Drop non-physical (TCG Pocket) sets.
      2. Drop sets older than RECENT_WINDOW_DAYS or missing a release date.
      3. Bucket the remainder by whether pokemontcg.io covers them:
         - high: also missing on pokemontcg.io (MEP-style; offline is only free path)
         - low: on pokemontcg.io but not in our index (nice-to-have)
      4. Within each bucket, newest release first.
    """
    import time as _t
    cutoff = _t.time() - RECENT_WINDOW_DAYS * 86400

    priority_high: list[dict[str, Any]] = []
    priority_low: list[dict[str, Any]] = []

    for m in missing:
        if m["serie"] == "tcgp":
            continue
        epoch = _release_epoch(m)
        if epoch < cutoff:
            continue
        present, count = check_pokemontcg_has_set(m["id"])
        m["_ptcg_present"] = present
        m["_ptcg_count"] = count
        (priority_high if not present else priority_low).append(m)

    priority_high.sort(key=_release_epoch, reverse=True)
    priority_low.sort(key=_release_epoch, reverse=True)
    return priority_high + priority_low


def run_git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    env = {**os.environ}
    cmd = ["git", "-c", f"user.email={GIT_EMAIL}", "-c", f"user.name={GIT_NAME}", *args]
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)


def git_commit_and_push(seeded_summaries: list[dict[str, Any]]) -> tuple[bool, str]:
    """Stage card-index.json, commit with a descriptive message, and push."""
    # Stage
    r = run_git(["add", "card-index.json"], REPO)
    if r.returncode != 0:
        return False, f"git add failed: {r.stderr}"

    # Anything to commit?
    r = run_git(["diff", "--cached", "--quiet"], REPO)
    if r.returncode == 0:
        return False, "no changes to commit"

    lines = ["Auto-seed new sets"]
    lines.append("")
    for s in seeded_summaries:
        lines.append(
            f"- {s['set_id']:12s}  +{s['added']:4d} cards  {s['set_name']}"
            + (f"  (\u2717{s['failed']} failed)" if s.get("failed") else "")
        )
    lines.append("")
    lines.append(
        "Auto-seeded from the weekly cron. Sets picked with priority given to "
        "releases pokemontcg.io doesn't have yet (the MEP-style edge cases "
        "where our offline pHash index is the only free path to a match)."
    )
    msg = "\n".join(lines)

    r = run_git(["commit", "-m", msg], REPO)
    if r.returncode != 0:
        return False, f"commit failed: {r.stderr}"

    r = run_git(["push", "origin", "main"], REPO)
    if r.returncode != 0:
        return False, f"push failed: {r.stderr}"

    return True, "committed and pushed"


def main() -> int:
    started = time.time()
    print(f"[autoseed] starting (max_cards={MAX_CARDS_PER_RUN}, max_sets={MAX_SETS_PER_RUN})", flush=True)

    index = load_index()
    starting_size = len(index)
    print(f"[autoseed] index size at start: {starting_size}", flush=True)

    try:
        missing = discover_missing_sets(index)
    except Exception as e:
        print(f"[autoseed] discovery failed: {e}", flush=True)
        report = {"newly_seeded": [], "skipped": [], "errors": [f"discovery: {e}"]}
        print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
        return 1

    print(f"[autoseed] {len(missing)} missing physical sets upstream", flush=True)
    if not missing:
        report = {"newly_seeded": [], "skipped": [], "errors": []}
        print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
        return 0

    prioritized = prioritize(missing)
    print(f"[autoseed] priority-high (missing from pokemontcg.io too): "
          f"{sum(1 for m in prioritized if not m['_ptcg_present'])}", flush=True)

    seeded_summaries: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    errors: list[str] = []
    cards_this_run = 0

    for m in prioritized:
        if len(seeded_summaries) >= MAX_SETS_PER_RUN:
            skipped.append({"set_id": m["id"], "reason": "max_sets_per_run cap"})
            continue
        if cards_this_run + m["count"] > MAX_CARDS_PER_RUN and seeded_summaries:
            skipped.append({"set_id": m["id"], "reason": "would exceed max_cards_per_run cap"})
            continue

        try:
            stats = seed_set(m["id"], index)
        except Exception as e:
            errors.append(f"{m['id']}: {e}")
            continue

        if stats["added"] > 0:
            save_index(index)
            cards_this_run += stats["added"]
            seeded_summaries.append({
                "set_id": stats["set_id"],
                "set_name": stats["set_name"],
                "added": stats["added"],
                "failed": stats["failed"],
                "ptcg_present": m.get("_ptcg_present", False),
                "release_date": m.get("release_date", ""),
            })
        else:
            # Seeded 0 usually means every image URL 404'd. Common on
            # very fresh sets before scans are public. Retry next week.
            skipped.append({
                "set_id": m["id"],
                "set_name": m["name"],
                "reason": f"no images available yet ({stats['failed']} 404s)",
            })

    # Commit + push if anything landed.
    if seeded_summaries:
        ok, git_msg = git_commit_and_push(seeded_summaries)
        if not ok:
            errors.append(f"git: {git_msg}")
        print(f"[autoseed] git: {git_msg}", flush=True)

    elapsed = int(time.time() - started)
    print(f"[autoseed] done in {elapsed}s. added {cards_this_run} cards across "
          f"{len(seeded_summaries)} sets. skipped {len(skipped)}. errors {len(errors)}", flush=True)

    report = {
        "newly_seeded": seeded_summaries,
        "skipped": skipped,
        "errors": errors,
        "index_size_before": starting_size,
        "index_size_after": len(index),
        "elapsed_seconds": elapsed,
    }
    print(f"__AUTOSEED_REPORT__ {json.dumps(report)}", flush=True)
    return 0 if not errors else 2


if __name__ == "__main__":
    sys.exit(main())
