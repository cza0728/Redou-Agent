#!/usr/bin/env python3
"""Run hidden project tests for the migrated task5-task9 assets."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import subprocess
import sys
from pathlib import Path

from task_project_tasks import get_task, normalize_task


def parse_pytest_counts(text: str, total_hint: int) -> tuple[int, int, int, int]:
    passed = failed = errors = 0
    match = re.search(r"(\d+)\s+passed", text)
    if match:
        passed = int(match.group(1))
    match = re.search(r"(\d+)\s+failed", text)
    if match:
        failed = int(match.group(1))
    match = re.search(r"(\d+)\s+errors?", text)
    if match:
        errors = int(match.group(1))
    total_run = passed + failed + errors
    # Prefer the configured hidden-suite size, but never let a stale hint make
    # a run with failures score above 100%. This happened for task8 after the
    # pytest suite grew beyond the task metadata.
    total = max(total_hint or 0, total_run)
    return passed, failed, errors, total


def run_project_tests(workspace: Path, task_num: str) -> dict:
    cfg = get_task(task_num)
    tests_dir = workspace / ".judge" / "tests"
    if not tests_dir.is_dir():
        return {
            "passed": False,
            "passed_count": 0,
            "total": int(cfg["total_tests"]),
            "metric": 0.0,
            "detail": "missing .judge/tests",
            "output": "",
        }

    command = shlex.split(str(cfg["test_command"]))
    timeout = int(cfg["timeout"])
    try:
        proc = subprocess.run(
            command,
            cwd=str(workspace),
            text=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + ("\n" + exc.stderr if exc.stderr else "")
        return {
            "passed": False,
            "passed_count": 0,
            "total": int(cfg["total_tests"]),
            "metric": 0.0,
            "detail": f"test command timed out after {timeout}s",
            "output": output,
        }

    passed_count, failed_count, error_count, total = parse_pytest_counts(
        output,
        int(cfg["total_tests"]),
    )
    total = total or int(cfg["total_tests"])
    metric = round(passed_count / total, 6) if total else 0.0
    passed = proc.returncode == 0 and failed_count == 0 and error_count == 0
    failed_lines = [
        line for line in output.splitlines()
        if "FAILED" in line or "ERROR" in line or "Traceback" in line
    ][:20]
    detail = f"passed {passed_count}/{total}; score {round(metric * 100, 2)}/100"
    if failed_lines:
        detail += "\n" + "\n".join(failed_lines)
    return {
        "passed": passed,
        "passed_count": passed_count,
        "failed_count": failed_count,
        "error_count": error_count,
        "total": total,
        "metric": metric,
        "detail": detail,
        "returncode": proc.returncode,
        "output": output,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Judge a migrated task project run.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--task", required=True)
    parser.add_argument("--result-json")
    args = parser.parse_args()

    task_num = normalize_task(args.task)
    result = run_project_tests(Path(args.workspace).resolve(), task_num)
    output = result.get("output") or ""
    if output:
        print(output)
    print("\n[task project judge]")
    print(result["detail"])
    print(json.dumps({k: v for k, v in result.items() if k != "output"}, ensure_ascii=False, indent=2))
    if args.result_json:
        Path(args.result_json).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return 0 if result.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
