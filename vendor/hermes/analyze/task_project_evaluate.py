#!/usr/bin/env python3
"""Evaluate migrated task5-task9 project runs and emit taskN-style scores."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
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

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=ignore)


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def print_phase(name: str, points: int, score: float, detail: str) -> None:
    print()
    print("==============================")
    print(f"Running {name} ({points} pts)")
    print("==============================")
    if score >= points:
        print(f"{name} PASS: +{points}")
    elif score > 0:
        rounded = round(score, 2)
        print(f"{name} PARTIAL: +{rounded}")
    else:
        print(f"{name} FAIL: +0")
    if detail:
        print(detail)


def print_check(name: str, detail: str) -> None:
    print()
    print("==============================")
    print(f"Checking {name}")
    print("==============================")
    if detail:
        print(detail)


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate a migrated task5-task9 run.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--submit-index", type=int, default=1)
    parser.add_argument("--bench-root", default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()

    bench_root = Path(args.bench_root).resolve()
    task_num = normalize_task(args.task)
    cfg = get_task(task_num)
    model = safe_name(args.model)
    paths = task_paths(bench_root, task_num, model)
    run_dir = paths["run_dir"]
    tests_dir = paths["tests"]
    source_dir = paths["source"]
    results_dir = paths["results_dir"]
    report_path = paths["report"]
    results_dir.mkdir(parents=True, exist_ok=True)

    working_copy_score = 0.0
    source_unchanged = None
    if run_dir.is_dir():
        working_copy_score += 6
        if any(run_dir.iterdir()):
            working_copy_score += 2
        before_path = results_dir / f"task{task_num}_original_source.sha256.before.json"
        current_source_hash = sha256_tree(source_dir) if source_dir.exists() else {}
        (results_dir / f"task{task_num}_original_source.sha256.after.json").write_text(
            json.dumps(current_source_hash, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        if before_path.exists():
            source_unchanged = read_json(before_path) == current_source_hash
            if source_unchanged:
                working_copy_score += 2
    else:
        print(f"run dir not found; prepare first: {run_dir}")

    judge_result: dict = {}
    judge_returncode = 1
    combined = ""
    if run_dir.is_dir() and tests_dir.is_dir():
        copytree_clean(tests_dir, run_dir / ".judge" / "tests")
        judge_json = results_dir / f"task{task_num}_submit_{args.submit_index}_judge.json"
        cmd = [
            sys.executable,
            str(bench_root / "task_project_judge.py"),
            "--workspace",
            str(run_dir),
            "--task",
            task_num,
            "--result-json",
            str(judge_json),
        ]
        proc = subprocess.run(
            cmd,
            cwd=str(bench_root),
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
        )
        judge_returncode = proc.returncode
        combined = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        judge_result = read_json(judge_json)

    log_path = results_dir / f"task{task_num}_submit_{args.submit_index}.log"
    log_path.write_text(combined, encoding="utf-8")

    metric = float(judge_result.get("metric") or 0.0)
    test_ratio = max(0.0, min(metric, 1.0))
    test_score = test_ratio * 100.0
    test_points = test_ratio * 75.0
    report_text = report_path.read_text(encoding="utf-8", errors="replace") if report_path.exists() else ""
    report_bytes = len(report_text.encode("utf-8")) if report_text else 0
    report_score = 0.0
    if report_bytes > 1000:
        report_score = 15.0
    elif report_bytes > 300:
        report_score = 8.0

    print_phase(
        f"Task{task_num} Working Copy",
        10,
        working_copy_score,
        f"run_dir={run_dir}; original_source_unchanged={source_unchanged}",
    )
    print_phase(
        f"Task{task_num} Automated Tests",
        75,
        test_points,
        judge_result.get("detail", "tests did not run"),
    )
    print_phase(
        f"Task{task_num} Report",
        15,
        report_score,
        f"report={report_path}; bytes={report_bytes}",
    )

    total = round(min(100.0, working_copy_score + test_points + report_score), 2)
    summary = {
        "task_number": task_num,
        "task_id": cfg["id"],
        "task_title": cfg["title"],
        "model": model,
        "run_dir": str(run_dir),
        "report_path": str(report_path),
        "log_path": str(log_path),
        "judge_returncode": judge_returncode,
        "original_source_unchanged": source_unchanged,
        "current_passed": bool(judge_result.get("passed")),
        "current_metric": metric,
        "working_copy_score": round(working_copy_score, 2),
        "test_score": round(test_score, 2),
        "test_points": round(test_points, 2),
        "report_score": round(report_score, 2),
        "current_score": total,
        "max_score": 100,
        "judge_result": {k: v for k, v in judge_result.items() if k != "output"},
    }
    summary_path = results_dir / f"task{task_num}_submit_{args.submit_index}_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print("==============================")
    print(f"Final Score: {total} / 100")
    print("==============================")
    if total >= 85:
        print("Result: Excellent")
    elif total >= 70:
        print("Result: Passed")
    elif total >= 50:
        print("Result: Partially Passed")
    else:
        print("Result: Failed")
    print(f"Summary: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
