#!/usr/bin/env python3
"""Run task prompts through Hermes, then invoke task acceptance scripts."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from render_task import render_task_text, safe_model_name


ANALYZE_DIR = Path(__file__).resolve().parent
REPO_ROOT = ANALYZE_DIR.parent
DEFAULT_MANIFEST = ANALYZE_DIR / "evaluation_manifest.json"
HERMES_ADAPTER = REPO_ROOT / "desktop" / "src" / "hermes_adapter.py"
DEFAULT_OUTPUT_DIR = ANALYZE_DIR / "model_eval_runs"
ALL_TASKS = [str(i) for i in range(1, 10)]


def load_manifest(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    tasks = data.get("tasks")
    if not isinstance(tasks, dict):
        raise ValueError(f"invalid manifest, missing tasks: {path}")
    return data


def select_tasks(args: argparse.Namespace, manifest: dict[str, Any]) -> list[str]:
    if args.all:
        requested = ALL_TASKS
    else:
        requested = [str(t).removeprefix("task") for t in args.task]
    missing = [task for task in requested if task not in manifest["tasks"]]
    if missing:
        raise ValueError(f"unknown task(s): {', '.join(missing)}")
    return requested


def kill_process_tree(pid: int) -> None:
    try:
        import psutil  # type: ignore

        parent = psutil.Process(pid)
        for child in parent.children(recursive=True):
            with contextlib_suppress(Exception):
                child.kill()
        with contextlib_suppress(Exception):
            parent.kill()
        return
    except Exception:
        pass

    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
    else:
        with contextlib_suppress(Exception):
            os.killpg(os.getpgid(pid), signal.SIGKILL)


class contextlib_suppress:
    def __init__(self, *exceptions: type[BaseException]) -> None:
        self.exceptions = exceptions or (Exception,)

    def __enter__(self) -> "contextlib_suppress":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return exc_type is not None and issubclass(exc_type, self.exceptions)


def build_payload(
    *,
    args: argparse.Namespace,
    task_num: str,
    model_label: str,
    prompt: str,
    task_output_dir: Path,
) -> dict[str, Any]:
    model = args.model or model_label
    metadata = {
        "benchmarkRoot": str(ANALYZE_DIR),
        "taskNumber": task_num,
        "modelLabel": model_label,
        "dockerWorkspace": args.docker_workspace,
        "dockerService": args.docker_service,
    }
    return {
        "projectId": f"model-eval-{model_label}",
        "taskId": f"task{task_num}",
        "hermesProfile": args.hermes_profile,
        "hermesSessionId": f"model-eval-{model_label}-task{task_num}-{int(time.time())}",
        "systemContext": "You are Hermes Agent running inside Redou Agent's local model evaluation harness.",
        "userContext": prompt,
        "attachments": [],
        "metadata": metadata,
        "riskConfirmed": True,
        "provider": args.provider or "",
        "model": model,
        "baseUrl": args.base_url or "",
        "base_url": args.base_url or "",
        "apiKey": args.api_key or "",
        "api_key": args.api_key or "",
        "apiMode": args.api_mode or "",
        "api_mode": args.api_mode or "",
        "workspacePath": str(ANALYZE_DIR),
        "maxIterations": args.max_iterations,
        "logDir": str(task_output_dir),
    }


def run_hermes_task(
    *,
    args: argparse.Namespace,
    task_num: str,
    model_label: str,
    prompt: str,
    task_output_dir: Path,
) -> dict[str, Any]:
    task_output_dir.mkdir(parents=True, exist_ok=True)
    events_path = task_output_dir / "hermes_events.jsonl"
    stderr_path = task_output_dir / "hermes_stderr.txt"
    payload_path = task_output_dir / "hermes_payload.json"

    payload = build_payload(
        args=args,
        task_num=task_num,
        model_label=model_label,
        prompt=prompt,
        task_output_dir=task_output_dir,
    )
    payload_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.skip_hermes or args.dry_run:
        return {
            "exit_reason": "dry_run" if args.dry_run else "skip_hermes",
            "returncode": None,
            "duration_seconds": 0.0,
            "events_path": str(events_path),
            "stderr_path": str(stderr_path),
        }

    if not HERMES_ADAPTER.exists():
        raise FileNotFoundError(f"Hermes adapter not found: {HERMES_ADAPTER}")

    start = time.time()
    with events_path.open("w", encoding="utf-8") as out, stderr_path.open(
        "w", encoding="utf-8"
    ) as err:
        proc = subprocess.Popen(
            [sys.executable, "-u", str(HERMES_ADAPTER)],
            cwd=str(ANALYZE_DIR),
            stdin=subprocess.PIPE,
            stdout=out,
            stderr=err,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=os.environ.copy(),
        )
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        proc.stdin.close()

        exit_reason = "process_exited"
        try:
            proc.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            exit_reason = "timeout"
            kill_process_tree(proc.pid)
            with contextlib_suppress(Exception):
                proc.wait(timeout=10)

    return {
        "exit_reason": exit_reason,
        "returncode": proc.returncode,
        "duration_seconds": round(time.time() - start, 1),
        "events_path": str(events_path),
        "stderr_path": str(stderr_path),
    }


def run_grade_script(
    *,
    args: argparse.Namespace,
    task_num: str,
    task_cfg: dict[str, Any],
    model_label: str,
    task_output_dir: Path,
) -> dict[str, Any]:
    script_name = task_cfg["grade_script"]
    script_path = ANALYZE_DIR / script_name
    stdout_path = task_output_dir / "grade_stdout.txt"
    stderr_path = task_output_dir / "grade_stderr.txt"

    if args.dry_run:
        return {
            "returncode": None,
            "score": None,
            "max_score": None,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "skipped": True,
        }
    if not script_path.exists():
        raise FileNotFoundError(f"grade script not found: {script_path}")

    env = os.environ.copy()
    grade_env = {
        "MODEL_NAME": safe_model_name(model_label),
        "DOCKER_SERVICE": args.docker_service,
        "DOCKER_WORKSPACE": args.docker_workspace,
        "DOCKER_BENCHMARK_ROOT": args.benchmark_root,
        "SUBMIT_INDEX": str(args.submit_index),
    }
    if args.force_evaluate:
        grade_env["FORCE_EVALUATE"] = "1"

    bash = shutil.which("bash")
    if bash is None:
        raise RuntimeError("bash not found; task acceptance scripts require bash")

    env_prefix = " ".join(
        f"{key}={shlex.quote(value)}" for key, value in sorted(grade_env.items())
    )
    proc = subprocess.run(
        [bash, "-lc", f"{env_prefix} bash ./{script_name}"],
        cwd=str(ANALYZE_DIR),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        env=env,
    )
    stdout_path.write_text(proc.stdout, encoding="utf-8")
    stderr_path.write_text(proc.stderr, encoding="utf-8")
    score, max_score = parse_final_score(proc.stdout)
    phase_results = parse_phase_results(proc.stdout)
    return {
        "returncode": proc.returncode,
        "score": score,
        "max_score": max_score,
        "phase_results": phase_results,
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
    }


def parse_final_score(text: str) -> tuple[float | None, float | None]:
    matches = re.findall(r"Final Score:\s*([0-9]+(?:\.[0-9]+)?)\s*/\s*([0-9]+(?:\.[0-9]+)?)", text)
    if not matches:
        return None, None
    score, max_score = matches[-1]
    return float(score), float(max_score)


def parse_phase_results(text: str) -> dict[str, float]:
    results: dict[str, float] = {}
    current: str | None = None
    for line in text.splitlines():
        running = re.search(r"Running\s+(.+?)\s+\(([0-9]+(?:\.[0-9]+)?)\s+pts\)", line)
        if running:
            current = running.group(1).strip()
            continue
        passed = re.search(r"^(.+?)\s+PASS:\s+\+([0-9]+(?:\.[0-9]+)?)", line.strip())
        partial = re.search(r"^(.+?)\s+PARTIAL:\s+\+([0-9]+(?:\.[0-9]+)?)", line.strip())
        failed = re.search(r"^(.+?)\s+FAIL:\s+\+0", line.strip())
        if passed:
            results[passed.group(1).strip()] = float(passed.group(2))
        elif partial:
            results[partial.group(1).strip()] = float(partial.group(2))
        elif failed:
            results[failed.group(1).strip()] = 0.0
        elif current and "PASS:" in line:
            score = re.search(r"\+([0-9]+(?:\.[0-9]+)?)", line)
            if score:
                results[current] = float(score.group(1))
        elif current and "FAIL:" in line:
            results[current] = 0.0
    return results


def ability_breakdown(
    phases: list[dict[str, Any]],
    *,
    score: float | None,
    max_score: float | None,
    phase_results: dict[str, float] | None,
) -> dict[str, dict[str, float]]:
    breakdown: dict[str, dict[str, float]] = {}
    total_points = sum(float(p.get("points", 0)) for p in phases) or (max_score or 100.0)
    ratio = 0.0 if not score or not max_score else max(0.0, min(float(score) / float(max_score), 1.0))
    phase_results = phase_results or {}

    for phase in phases:
        ability = str(phase.get("ability") or "未分类能力")
        name = str(phase.get("name") or "")
        points = float(phase.get("points") or 0)
        achieved = phase_results.get(name)
        if achieved is None:
            achieved = points * ratio
        item = breakdown.setdefault(ability, {"score": 0.0, "max_score": 0.0})
        item["score"] += achieved
        item["max_score"] += points

    if not phases and max_score:
        breakdown["未分类能力"] = {"score": float(score or 0), "max_score": float(max_score)}

    scale = float(max_score or total_points) / total_points if total_points else 1.0
    for item in breakdown.values():
        item["score"] = round(item["score"] * scale, 2)
        item["max_score"] = round(item["max_score"] * scale, 2)
    return breakdown


def run_one_task(
    *,
    args: argparse.Namespace,
    manifest: dict[str, Any],
    task_num: str,
    model_label: str,
    run_dir: Path,
) -> dict[str, Any]:
    task_cfg = manifest["tasks"][task_num]
    task_output_dir = run_dir / f"task{task_num}"
    task_output_dir.mkdir(parents=True, exist_ok=True)

    prompt = render_task_text(
        task_num,
        model=model_label,
        docker_workspace=args.docker_workspace,
        docker_service=args.docker_service,
        benchmark_root=args.benchmark_root,
    )
    prompt_path = task_output_dir / f"task{task_num}_rendered.md"
    prompt_path.write_text(prompt, encoding="utf-8")

    hermes_result = run_hermes_task(
        args=args,
        task_num=task_num,
        model_label=model_label,
        prompt=prompt,
        task_output_dir=task_output_dir,
    )
    grade_result = run_grade_script(
        args=args,
        task_num=task_num,
        task_cfg=task_cfg,
        model_label=model_label,
        task_output_dir=task_output_dir,
    )
    abilities = ability_breakdown(
        task_cfg.get("phases", []),
        score=grade_result.get("score"),
        max_score=grade_result.get("max_score"),
        phase_results=grade_result.get("phase_results"),
    )
    result = {
        "task": task_num,
        "title": task_cfg.get("title", ""),
        "prompt_path": str(prompt_path),
        "hermes": hermes_result,
        "grade": grade_result,
        "ability_breakdown": abilities,
    }
    (task_output_dir / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def print_summary(results: list[dict[str, Any]], model_label: str) -> None:
    print()
    print("=" * 72)
    print(f"Model Evaluation Summary: {model_label}")
    print("=" * 72)
    total_score = 0.0
    total_max = 0.0
    ability_totals: dict[str, dict[str, float]] = {}
    for result in results:
        grade = result.get("grade", {})
        score = grade.get("score")
        max_score = grade.get("max_score")
        if score is not None and max_score:
            total_score += float(score)
            total_max += float(max_score)
        print(
            f"task{result['task']}: "
            f"{'-' if score is None else score} / {'-' if max_score is None else max_score} "
            f"| hermes={result.get('hermes', {}).get('exit_reason')}"
        )
        for ability, item in result.get("ability_breakdown", {}).items():
            agg = ability_totals.setdefault(ability, {"score": 0.0, "max_score": 0.0})
            agg["score"] += item["score"]
            agg["max_score"] += item["max_score"]

    print(f"Total: {round(total_score, 2)} / {round(total_max, 2)}")
    if ability_totals:
        print()
        print("Ability breakdown:")
        for ability, item in sorted(ability_totals.items()):
            print(f"- {ability}: {round(item['score'], 2)} / {round(item['max_score'], 2)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Redou/Hermes model evaluation tasks.")
    task_group = parser.add_mutually_exclusive_group(required=True)
    task_group.add_argument("--all", action="store_true", help="run task1-task9")
    task_group.add_argument("--task", nargs="+", help="task numbers to run")
    parser.add_argument("--model-label", required=True, help="label used for results and path rendering")
    parser.add_argument("--model", help="actual Hermes model name; defaults to --model-label")
    parser.add_argument("--provider", default="")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--api-key", default="")
    parser.add_argument("--api-mode", default="")
    parser.add_argument("--hermes-profile", default="analysis")
    parser.add_argument("--max-iterations", type=int, default=1000)
    parser.add_argument("--timeout", type=int, default=3600, help="Hermes timeout per task in seconds")
    parser.add_argument("--docker-workspace", default="/workspace")
    parser.add_argument("--benchmark-root", default="/workspace")
    parser.add_argument("--docker-service", default="agent-lab")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--submit-index", type=int, default=1)
    parser.add_argument("--force-evaluate", action="store_true")
    parser.add_argument("--skip-hermes", action="store_true", help="only run grade scripts")
    parser.add_argument("--dry-run", action="store_true", help="render prompts only")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    tasks = select_tasks(args, manifest)
    model_label = safe_model_name(args.model_label)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = args.output_dir / f"{timestamp}_{model_label}"
    run_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for task_num in tasks:
        print(f"\n[task{task_num}] {manifest['tasks'][task_num].get('title', '')}")
        result = run_one_task(
            args=args,
            manifest=manifest,
            task_num=task_num,
            model_label=model_label,
            run_dir=run_dir,
        )
        results.append(result)

    summary = {
        "model_label": model_label,
        "timestamp": timestamp,
        "tasks": tasks,
        "results": results,
    }
    (run_dir / "results.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print_summary(results, model_label)
    print(f"\nResults saved to: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
