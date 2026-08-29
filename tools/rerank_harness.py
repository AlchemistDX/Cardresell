#!/usr/bin/env python3
"""Rerank simulation harness.

Given a list of (image_path, expected_id, name, number, ximilar_set) tuples,
simulate the client's LLM-shortlist rerank pipeline offline:
  1. Filter index by name (word-boundary) and number (with alpha-prefix strip).
  2. Trust Ximilar set when it uniquely matches.
  3. Otherwise pHash tiebreak with reprint-recency nudge.

Tests that the improved logic picks the right card.

Usage:
    python3 tools/rerank_harness.py [--cases cases.json]

If no cases file provided, uses the built-in synthetic test set derived from
the pHash collision analysis (which are the hardest cases: same-art reprints
across multiple sets).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
INDEX_PATH = ROOT / "card-index.json"


def load_index() -> list[dict]:
    with open(INDEX_PATH) as f:
        return json.load(f)


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def norm_num(s: str) -> tuple[str, str]:
    clean = str(s or "").split("/")[0].strip()
    no_zeros = clean.lstrip("0") or clean
    no_prefix = re.sub(r"^[a-z]+", "", no_zeros, flags=re.I)
    return no_zeros.lower(), no_prefix.lower()


def tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", (s or "").lower()) if t]


def name_matches(a: str, b: str) -> bool:
    A, B = tokens(a), tokens(b)
    if not A or not B:
        return False
    small, big = (A, B) if len(A) <= len(B) else (B, A)
    big_set = set(big)
    return all(t in big_set for t in small)


def set_rank(sid: str) -> int:
    s = (sid or "").lower()
    if s.startswith("me"):   return 105
    if s.startswith("zsv"):  return 102
    if s.startswith("rsv"):  return 101
    if s.startswith("sv"):   return 100
    if s.startswith("swsh"): return 90
    if s.startswith("sm"):   return 80
    if s.startswith("xy"):   return 70
    if s.startswith("bw"):   return 60
    if s.startswith("hgss"): return 55
    if s.startswith("col"):  return 52
    if s.startswith("pl"):   return 50
    if s.startswith("dp"):   return 48
    if s.startswith("ex"):   return 40
    return 10


def hamming_hex(a: str, b: str) -> int:
    if len(a) != len(b):
        return 999
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def rerank(idx: list[dict], name: str, number: str, ximilar_set: str, phash: str, dhash: str) -> tuple[dict | None, str]:
    """Run the improved rerank. Returns (chosen_card, reason)."""
    llm_num_full, llm_num_tail = norm_num(number)

    def filt(require_num: bool):
        out = []
        for c in idx:
            if not name_matches(c["n"], name):
                continue
            if require_num and llm_num_full:
                cf, ct = norm_num(c["nu"])
                if cf != llm_num_full and ct != llm_num_tail and cf != llm_num_tail and ct != llm_num_full:
                    continue
            out.append(c)
        return out

    candidates = filt(True)
    if not candidates and llm_num_full:
        candidates = filt(False)

    if not candidates:
        return None, "no-candidates"
    if len(candidates) == 1:
        return candidates[0], "exact"

    # Ximilar set trust
    if ximilar_set:
        xnorm = norm(ximilar_set)
        exact = [c for c in candidates if norm(c["s"]) == xnorm]
        if len(exact) == 1:
            return exact[0], "ximilar-set-exact"
        if len(exact) > 1:
            candidates = exact
        else:
            # length-ratio ≥ 0.6 bidirectional includes
            loose = []
            for c in candidates:
                cs = norm(c["s"])
                if not cs or not xnorm:
                    continue
                short = cs if len(cs) < len(xnorm) else xnorm
                long = cs if len(cs) >= len(xnorm) else xnorm
                if short in long and (len(short) / len(long)) >= 0.6:
                    loose.append(c)
            if len(loose) == 1:
                return loose[0], "ximilar-set-loose"
            if len(loose) > 1:
                candidates = loose

    # pHash tiebreak
    scored = [(c, hamming_hex(phash, c["p"]) * 2 + hamming_hex(dhash, c["d"])) for c in candidates]
    scored.sort(key=lambda x: (x[1], -set_rank(x[0].get("si", ""))))
    best = scored[0]
    if len(scored) >= 2:
        second = scored[1]
        gap = second[1] - best[1]
        if gap <= 2 and set_rank(second[0].get("si", "")) > set_rank(best[0].get("si", "")):
            return second[0], f"phash-newer-set(gap={gap})"
    return best[0], f"phash-dist={best[1]}"


def build_synthetic_cases(idx: list[dict]) -> list[dict]:
    """Build test cases from the actual hash-collision groups.

    For each collision group, generate one case per card:
    - Query with name + number + set (the "we trust Ximilar" case).
    - Query with name + number, no set (the "Ximilar returned nothing" case).
    Expected: we pick the right printing.
    """
    from collections import defaultdict
    groups = defaultdict(list)
    for c in idx:
        groups[(c.get("p", ""), c.get("d", ""))].append(c)
    collision_groups = [g for g in groups.values() if len(g) > 1]

    cases = []
    for group in collision_groups[:50]:  # first 50 collision groups
        for target in group:
            cases.append({
                "target_id": target["id"],
                "name": target["n"],
                "number": target["nu"],
                "ximilar_set": target["s"],
                "phash": target["p"],
                "dhash": target["d"],
                "note": "hash-collision-group",
            })
            # Also test the same query WITHOUT ximilar set (worst case)
            cases.append({
                "target_id": target["id"],
                "name": target["n"],
                "number": target["nu"],
                "ximilar_set": "",
                "phash": target["p"],
                "dhash": target["d"],
                "note": "hash-collision-no-set",
            })
    return cases


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=str, default=None)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    idx = load_index()
    print(f"Loaded {len(idx):,} cards", file=sys.stderr)

    if args.cases:
        with open(args.cases) as f:
            cases = json.load(f)
    else:
        cases = build_synthetic_cases(idx)
        print(f"Generated {len(cases)} synthetic collision-group cases", file=sys.stderr)

    if args.limit:
        cases = cases[: args.limit]

    correct = 0
    wrong = []
    by_reason = {}
    by_reason_correct = {}

    for case in cases:
        result, reason = rerank(
            idx,
            case["name"],
            case["number"],
            case["ximilar_set"],
            case["phash"],
            case["dhash"],
        )
        by_reason[reason] = by_reason.get(reason, 0) + 1
        got_id = result["id"] if result else None
        if got_id == case["target_id"]:
            correct += 1
            by_reason_correct[reason] = by_reason_correct.get(reason, 0) + 1
        else:
            wrong.append({
                "expected": case["target_id"],
                "got": got_id,
                "name": case["name"],
                "number": case["number"],
                "ximilar_set": case["ximilar_set"],
                "reason": reason,
                "note": case.get("note"),
            })

    total = len(cases)
    print()
    print("=" * 70)
    print(f"Total cases:  {total}")
    print(f"Correct:      {correct} ({100*correct/total:.1f}%)")
    print(f"Wrong:        {len(wrong)} ({100*len(wrong)/total:.1f}%)")
    print()
    print("By resolution path:")
    for reason, count in sorted(by_reason.items(), key=lambda x: -x[1]):
        correct_r = by_reason_correct.get(reason, 0)
        print(f"  {reason:35}  {correct_r:4}/{count:4}  ({100*correct_r/count:.1f}%)")

    if wrong[:20]:
        print()
        print("First 20 wrong picks:")
        for w in wrong[:20]:
            print(f"  expected={w['expected']:20} got={str(w['got']):20} name={w['name'][:30]:30} num={w['number']:6} set='{w['ximilar_set']}' [{w['reason']}]")


if __name__ == "__main__":
    main()
