import json
from pathlib import Path

from hermes_cli import redou_context


def _write_store(tmp_path: Path, monkeypatch):
    app_data = tmp_path / "app-data"
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True)
    store_path = tmp_path / "chat-projects.json"
    store = {
        "projects": [
            {
                "id": "project-1",
                "name": "Project 1",
                "path": str(workspace),
                "tasks": [{"id": "task-1", "title": "Task 1"}],
            }
        ]
    }
    store_path.write_text(json.dumps(store), encoding="utf-8")
    monkeypatch.setenv(redou_context.REDOU_APP_DATA_ENV, str(app_data))
    monkeypatch.setenv(redou_context.REDOU_CHAT_PROJECTS_FILE_ENV, str(store_path))
    return app_data, workspace, store_path


def _messages_path(app_data: Path) -> Path:
    return app_data / "projects" / "project-1" / "tasks" / "task-1" / redou_context.TASK_MESSAGES_FILE


def _append_jsonl(path: Path, *rows: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def test_redou_context_filters_queued_guides_and_raw_events(tmp_path, monkeypatch):
    app_data, _workspace, _store_path = _write_store(tmp_path, monkeypatch)
    redou_context.build_task_context("project-1", "task-1", "bootstrap")
    messages_path = _messages_path(app_data)
    _append_jsonl(
        messages_path,
        {
            "role": "user",
            "content": "old completed request",
            "metadata": {
                "inputEnvelope": {
                    "id": "old-user",
                    "deliveryMode": "new_turn",
                    "status": "completed",
                    "turnId": "turn-old",
                }
            },
        },
        {"role": "assistant", "content": "old completed answer", "metadata": {}},
        {
            "role": "user",
            "content": "queued future request must not leak",
            "metadata": {
                "inputEnvelope": {
                    "id": "queued-user",
                    "deliveryMode": "queue",
                    "status": "pending",
                    "turnId": "turn-queued",
                }
            },
        },
        {
            "role": "event",
            "content": "command_start must not leak as history",
            "metadata": {
                "eventType": "command_start",
                "event": {"type": "command_start", "command": "npm test", "metadata": {"runId": "run-1"}},
            },
        },
        {
            "role": "event",
            "content": "run_stage must not leak as history",
            "metadata": {
                "eventType": "run_stage",
                "event": {
                    "type": "run_stage",
                    "stage": "inspecting",
                    "label": "检查项目",
                    "status": "running",
                    "source": "hermes",
                },
            },
        },
        {
            "role": "event",
            "content": "guide only must not leak",
            "metadata": {
                "eventType": "control_event",
                "controlEvent": True,
                "inputEnvelope": {"id": "guide-1", "deliveryMode": "guide", "status": "completed"},
            },
        },
    )

    built = redou_context.build_task_context("project-1", "task-1", "current active request")

    assert built.validation and built.validation["ok"] is True
    assert built.debug and built.debug["rawTurnLogIncluded"] is False
    assert "old completed request" in built.text
    assert "old completed answer" in built.text
    assert "queued future request must not leak" not in built.text
    assert "guide only must not leak" not in built.text
    assert "command_start" not in built.text
    assert "run_stage" not in built.text
    assert built.text.count("current active request") == 1


def test_redou_context_redacts_secrets_in_prompt_and_raw_log(tmp_path, monkeypatch):
    _app_data, workspace, _store_path = _write_store(tmp_path, monkeypatch)
    secret = "super-secret-password"

    built = redou_context.build_task_context(
        "project-1",
        "task-1",
        f"review password = '{secret}' and Authorization: Bearer abcdefghijklmnop",
    )

    assert built.validation and built.validation["ok"] is True
    assert secret not in built.text
    assert "Bearer abcdefghijklmnop" not in built.text
    assert redou_context._SECRET_MARKER in built.text

    redou_context.append_raw_turn_log("project-1", "task-1", f"password = '{secret}'", "done")
    task_context = workspace / ".redou" / "tasks" / "task-1" / redou_context.TASK_CONTEXT_FILE
    saved = task_context.read_text(encoding="utf-8")
    assert secret not in saved
    assert redou_context._SECRET_MARKER in saved
