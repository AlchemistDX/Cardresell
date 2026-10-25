#!/usr/bin/env python3
"""Compatibility entry point for the shipped-browser scanner evaluation.

The retired Python approximation used different resizing, a stale cutoff,
and an unavailable upload directory. It could not measure current behavior.
This command runs the actual shipped JavaScript with labeled local fixtures.
No external calls or paid recognition. Results are not Ximilar accuracy.
"""
import argparse
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("manifest", nargs="?", help="JSON manifest with labeled local photos")
parser.add_argument("report", nargs="?", help="Optional JSON evidence output")
args = parser.parse_args()
command = ["node", str(Path(__file__).with_name("fastpath_calibration.mjs"))]
if args.manifest:
    command.append(args.manifest)
if args.report:
    command.append(args.report)
raise SystemExit(subprocess.call(command))
