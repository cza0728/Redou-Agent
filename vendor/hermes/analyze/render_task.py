#!/usr/bin/env python3
"""Render a benchmark task prompt for one model/container environment."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


ACTIVE_TASKS = {str(i) for i in range(1, 10)}

PLACEHOLDER_RE = re.compile(r"@@[A-Z0-9_]+@@")


def safe_model_name(name: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_.-]+", "-", name.strip())
    return value.strip(".-_") or "unknown-model"


def clean_container_path(path: str) -> str:
    value = (path or "/workspace").replace("\\", "/").strip()
    if not value.startswith("/"):
        value = "/" + value
    return value.rstrip("/") or "/"


def render_task_text(
    task: str,
    *,
    model: str,
    docker_workspace: str = "/workspace",
    docker_service: str = "agent-lab",
    benchmark_root: str | None = None,
    analyze_dir: Path | None = None,
    strict: bool = True,
) -> str:
    task_num = str(task).removeprefix("task")
    if task_num not in ACTIVE_TASKS:
        raise ValueError(f"task{task_num} is not part of the current Redou evaluation suite")
    analyze_dir = analyze_dir or Path(__file__).resolve().parent
    task_path = analyze_dir / f"task{task_num}.md"
    if not task_path.exists():
        raise FileNotFoundError(f"task file not found: {task_path}")

    model_name = safe_model_name(model)
    workspace = clean_container_path(docker_workspace)
    bench_root = clean_container_path(benchmark_root or workspace)
    task_folder = f"task{task_num}"
    run_root = f"{bench_root}/model_runs/{model_name}"
    run_dir = f"{run_root}/{task_folder}"
    results_dir = f"{run_root}/results"

    text = task_path.read_text(encoding="utf-8")
    replacements = {
        "@@MODEL_NAME@@": model_name,
        "@@DOCKER_SERVICE@@": docker_service,
        "@@DOCKER_WORKSPACE@@": workspace,
        "@@BENCHMARK_ROOT@@": bench_root,
        "@@RUN_ROOT@@": run_root,
        "@@RUN_DIR@@": run_dir,
        "@@RESULTS_DIR@@": results_dir,
        "@@TASK_NUMBER@@": task_num,
        "@@TASK_FOLDER@@": task_folder,
    }
    for key, value in replacements.items():
        text = text.replace(key, value)

    if strict:
        unresolved = sorted(set(PLACEHOLDER_RE.findall(text)))
        if unresolved:
            raise ValueError(
                f"unresolved placeholders in task{task_num}.md: {', '.join(unresolved)}"
            )
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Render taskN.md path placeholders.")
    parser.add_argument("--task", required=True, help="task number, e.g. 1 or 5")
    parser.add_argument("--model", default="unknown-model", help="model label/name")
    parser.add_argument("--docker-workspace", default="/workspace")
    parser.add_argument("--docker-service", default="agent-lab")
    parser.add_argument(
        "--benchmark-root",
        default=None,
        help="container benchmark root; defaults to --docker-workspace",
    )
    parser.add_argument("--output", help="optional file to write rendered prompt")
    parser.add_argument("--no-strict", action="store_true")
    args = parser.parse_args()

    text = render_task_text(
        args.task,
        model=args.model,
        docker_workspace=args.docker_workspace,
        docker_service=args.docker_service,
        benchmark_root=args.benchmark_root,
        strict=not args.no_strict,
    )
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
