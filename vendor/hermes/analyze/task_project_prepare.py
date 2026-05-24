#!/usr/bin/env python3
"""Prepare an isolated per-model working copy for task5-task9."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from task_project_tasks import get_task, normalize_task, safe_name, task_paths


def sha256_tree(root: Path) -> dict[str, str]:
    checks: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if "__pycache__" in path.parts or ".pytest_cache" in path.parts:
            continue
        if path.name.endswith(".pyc"):
            continue
        rel = path.relative_to(root).as_posix()
        checks[rel] = hashlib.sha256(path.read_bytes()).hexdigest()
    return checks


def copytree_clean(src: Path, dst: Path) -> None:
    def ignore(_dirpath: str, names: list[str]) -> set[str]:
        ignored = {"__pycache__", ".pytest_cache", ".mypy_cache", ".coverage"}
        return {name for name in names if name in ignored or name.endswith(".pyc")}

    shutil.copytree(src, dst, ignore=ignore)


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a migrated task5-task9 project run.")
    parser.add_argument("--model", required=True, help="model label used for model_runs/<model>/")
    parser.add_argument("--task", required=True, help="task number: 5, task5, ..., 9, task9")
    parser.add_argument("--bench-root", default=str(Path(__file__).resolve().parent))
    parser.add_argument("--force", action="store_true", help="remove the existing run dir first")
    args = parser.parse_args()

    bench_root = Path(args.bench_root).resolve()
    task_num = normalize_task(args.task)
    cfg = get_task(task_num)
    model = safe_name(args.model)
    paths = task_paths(bench_root, task_num, model)
    source_root = paths["source"]
    run_dir = paths["run_dir"]
    results_dir = paths["results_dir"]

    if not source_root.exists():
        raise SystemExit(f"source not found: {source_root}")
    results_dir.mkdir(parents=True, exist_ok=True)

    original_hash = sha256_tree(source_root)
    (results_dir / f"task{task_num}_original_source.sha256.before.json").write_text(
        json.dumps(original_hash, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if run_dir.exists():
        if not args.force:
            raise SystemExit(f"run dir already exists, use --force to recreate it: {run_dir}")
        shutil.rmtree(run_dir)
    copytree_clean(source_root, run_dir)

    meta = {
        "task_number": task_num,
        "task_id": cfg["id"],
        "task_title": cfg["title"],
        "model": model,
        "bench_root": str(bench_root),
        "source_dir": str(source_root),
        "run_dir": str(run_dir),
        "results_dir": str(results_dir),
    }
    (results_dir / f"task{task_num}_run_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
