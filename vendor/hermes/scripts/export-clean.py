#!/usr/bin/env python3
"""Create a clean Redou Agent source archive.

The exporter removes runtime/build debris that commonly causes patch drift:
node_modules, __pycache__, .git, logs, local .env files, shortcuts, and caches.
Generated web bundles are excluded by default; pass --include-generated when you
need a runnable snapshot that keeps checked-in build outputs.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import sys
import zipfile
from pathlib import Path

ALWAYS_EXCLUDED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".parcel-cache",
    ".turbo",
    ".venv",
    "venv",
    "logs",
    "tmp",
    "temp",
}

GENERATED_DIRS = {
    "hermes_cli/web_dist",
    "web/dist",
    "web/public/ds-assets",
    "web/public/fonts",
    "ui-tui/dist",
    "ui-tui/packages/hermes-ink/dist",
    "desktop/dist",
    "website/build",
    "website/out",
    "website/.vitepress/dist",
}

GENERATED_DIR_NAMES = {"dist", "build", "coverage"}

EXCLUDED_FILE_PATTERNS = {
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "*.log",
    "*.tmp",
    "*.temp",
    "*.bak",
    "*.swp",
    "*.swo",
    "*.lnk",
    ".DS_Store",
    "Thumbs.db",
    ".env",
}


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _is_generated_dir(rel: str) -> bool:
    return any(rel == item or rel.startswith(item + "/") for item in GENERATED_DIRS)


def _is_generated_dir_name(dirname: str) -> bool:
    return dirname in GENERATED_DIR_NAMES


def _is_excluded_file(path: Path) -> bool:
    name = path.name
    return any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDED_FILE_PATTERNS)


def iter_clean_files(root: Path, include_generated: bool):
    for current, dirnames, filenames in os.walk(root):
        current_path = Path(current)
        rel_current = "." if current_path == root else _rel(current_path, root)
        kept_dirs = []
        for dirname in dirnames:
            child = current_path / dirname
            rel_child = _rel(child, root)
            if dirname in ALWAYS_EXCLUDED_DIRS:
                continue
            if not include_generated and (_is_generated_dir(rel_child) or _is_generated_dir_name(dirname)):
                continue
            kept_dirs.append(dirname)
        dirnames[:] = kept_dirs
        for filename in filenames:
            path = current_path / filename
            rel = _rel(path, root)
            if _is_excluded_file(path):
                continue
            if not include_generated and _is_generated_dir(rel):
                continue
            yield path, rel


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export a clean Redou Agent source zip.")
    parser.add_argument("--root", default=".", help="project root, default: current directory")
    parser.add_argument("--output", "-o", default="RedouAgent-clean.zip", help="output zip path")
    parser.add_argument("--include-generated", action="store_true", help="keep generated dist/web_dist directories")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    output = Path(args.output).resolve()
    if not root.exists():
        raise SystemExit(f"project root does not exist: {root}")
    if output.exists():
        output.unlink()
    output.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    total_bytes = 0
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path, rel in iter_clean_files(root, args.include_generated):
            if path.resolve() == output:
                continue
            archive.write(path, rel)
            count += 1
            total_bytes += path.stat().st_size

    print(f"exported {count} files ({total_bytes / (1024 * 1024):.1f} MiB source) -> {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
