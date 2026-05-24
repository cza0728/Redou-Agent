#!/usr/bin/env python3
"""Shared metadata for the migrated code-project evaluation tasks."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


TASKS: dict[str, dict[str, Any]] = {
    "5": {
        "id": "F_peewee_industrial",
        "title": "Peewee ORM industrial bug fixing",
        "source_dir": "task5_source",
        "tests_dir": "task5_tests",
        "config_file": "task5.yaml",
        "run_folder": "task5",
        "report_file": "task5_report.md",
        "total_tests": 801,
        "test_command": "python .judge/tests/run_all.py",
        "timeout": 300,
    },
    "6": {
        "id": "G_bottle_feature",
        "title": "Bottle web framework plugin extension",
        "source_dir": "task6_source",
        "tests_dir": "task6_tests",
        "config_file": "task6.yaml",
        "run_folder": "task6",
        "report_file": "task6_report.md",
        "total_tests": 429,
        "test_command": "python .judge/tests/run_all.py",
        "timeout": 300,
    },
    "7": {
        "id": "H_markdown_parser",
        "title": "Markdown parser implementation",
        "source_dir": "task7_source",
        "tests_dir": "task7_tests",
        "config_file": "task7.yaml",
        "run_folder": "task7",
        "report_file": "task7_report.md",
        "total_tests": 108,
        "test_command": "python .judge/tests/run_all.py",
        "timeout": 300,
    },
    "8": {
        "id": "I_click_cli",
        "title": "Click CLI framework bug fixing",
        "source_dir": "task8_source",
        "tests_dir": "task8_tests",
        "config_file": "task8.yaml",
        "run_folder": "task8",
        "report_file": "task8_report.md",
        "total_tests": 1440,
        "test_command": "python -m pytest .judge/tests/ --tb=short -q -m 'not stress'",
        "timeout": 300,
    },
    "9": {
        "id": "J_jinja2_ext",
        "title": "Jinja2 custom extension development",
        "source_dir": "task9_source",
        "tests_dir": "task9_tests",
        "config_file": "task9.yaml",
        "run_folder": "task9",
        "report_file": "task9_report.md",
        "total_tests": 950,
        "test_command": "python -m pytest .judge/tests/ --tb=short -q",
        "timeout": 300,
    },
}

TASK_ALIASES = {key: key for key in TASKS}
TASK_ALIASES.update({f"task{key}": key for key in TASKS})


def safe_name(name: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_.-]+", "-", name.strip())
    return value.strip(".-_") or "unknown-model"


def normalize_task(task: str) -> str:
    key = TASK_ALIASES.get(str(task).lower())
    if not key:
        raise ValueError(f"unknown migrated project task: {task}")
    return key


def get_task(task: str) -> dict[str, Any]:
    return TASKS[normalize_task(task)]


def task_paths(bench_root: Path, task: str, model: str | None = None) -> dict[str, Path]:
    key = normalize_task(task)
    cfg = TASKS[key]
    paths = {
        "source": bench_root / cfg["source_dir"],
        "tests": bench_root / cfg["tests_dir"],
        "config": bench_root / cfg["config_file"],
    }
    if model is not None:
        model_name = safe_name(model)
        run_root = bench_root / "model_runs" / model_name
        paths.update(
            {
                "run_root": run_root,
                "run_dir": run_root / cfg["run_folder"],
                "results_dir": run_root / "results",
                "report": run_root / "results" / cfg["report_file"],
            }
        )
    return paths
