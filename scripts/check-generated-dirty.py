#!/usr/bin/env python3
"""Fail when generated artifacts or runtime debris are modified or present.

This is intentionally lightweight: it works with git when available and also
scans for common source-archive debris (node_modules, __pycache__, .lnk).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

GENERATED_PATHS = [
    "vendor/hermes/hermes_cli/web_dist",
    "vendor/hermes/web/dist",
    "vendor/hermes/web/public/ds-assets",
    "vendor/hermes/web/public/fonts",
    "vendor/hermes/ui-tui/dist",
    "vendor/hermes/ui-tui/packages/hermes-ink/dist",
    "apps/desktop/dist",
    "vendor/hermes/website/build",
    "vendor/hermes/website/out",
    "vendor/hermes/website/.vitepress/dist",
]

DEBRIS_DIR_NAMES = {"node_modules", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
DEBRIS_FILE_SUFFIXES = {".pyc", ".pyo", ".lnk", ".log", ".tmp"}


def git_status(root: Path, paths: list[str]) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--", *paths],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return []
    if result.returncode != 0:
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


def git_tracked_paths(root: Path) -> set[str]:
    try:
        result = subprocess.run(
            ["git", "ls-files", "-z"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return set()
    if result.returncode != 0:
        return set()
    return {item for item in result.stdout.split("\0") if item}


def scan_debris(root: Path, tracked_paths: set[str] | None = None) -> list[str]:
    tracked_paths = tracked_paths or set()
    findings: list[str] = []
    for current, dirnames, filenames in os.walk(root):
        current_path = Path(current)
        rel_current = current_path.relative_to(root).as_posix() if current_path != root else "."
        if ".git" in dirnames:
            dirnames.remove(".git")
        for dirname in list(dirnames):
            if dirname in DEBRIS_DIR_NAMES:
                findings.append(f"{rel_current}/{dirname}".lstrip("./"))
                dirnames.remove(dirname)
        for filename in filenames:
            if any(filename.endswith(suffix) for suffix in DEBRIS_FILE_SUFFIXES):
                rel_file = (current_path / filename).relative_to(root).as_posix()
                if filename.endswith(".lnk") and rel_file in tracked_paths:
                    continue
                findings.append(rel_file)
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check generated artifacts and runtime debris.")
    parser.add_argument("--root", default=".", help="project root")
    parser.add_argument("--allow-debris", action="store_true", help="only check generated git status")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    dirty = git_status(root, GENERATED_PATHS)
    tracked_paths = set() if args.allow_debris else git_tracked_paths(root)
    debris = [] if args.allow_debris else scan_debris(root, tracked_paths)

    if dirty:
        print("Generated artifacts have uncommitted changes:")
        for line in dirty:
            print(f"  {line}")
    if debris:
        print("Runtime/build debris found:")
        for item in debris[:200]:
            print(f"  {item}")
        if len(debris) > 200:
            print(f"  ... {len(debris) - 200} more")
    if dirty or debris:
        print("\nUse scripts/export-clean.py for source archives, or regenerate from source before committing.")
        return 1
    print("generated/debris check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
