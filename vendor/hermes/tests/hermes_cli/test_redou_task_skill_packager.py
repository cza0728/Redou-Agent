from __future__ import annotations

import re
from pathlib import Path

from hermes_cli import redou_task_skill_packager as packager


def test_redou_task_packager_generates_semantic_skill_and_references(tmp_path, monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_skill_manage(action: str, **kwargs):
        calls.append((action, kwargs))
        return {"success": True, "message": f"{action} ok"}

    monkeypatch.setattr(packager, "_skill_manage", fake_skill_manage)
    profile_home = tmp_path / "profile"
    payload = {
        "profileHome": str(profile_home),
        "workspacePath": str(tmp_path),
        "project": {"id": "project-1", "name": "服务器", "path": str(tmp_path), "hermesProfile": "redou"},
        "task": {"id": "task-1", "title": "访问远程服务器", "hermesSessionId": "s1"},
        "taskRules": "# Task Rules\n\n- 通过 SSH 连接到天翼云主机。\n- password = 'secret-value'\n",
        "taskContext": "# Task Context\n\n已验证 SSH 端口。\n",
        "messages": [
            {"role": "user", "content": "请连接天翼云服务器", "createdAt": "2026-05-16T00:00:00Z"},
            {"role": "assistant", "content": "Authorization: Bearer abcdefghijklmnop", "createdAt": "2026-05-16T00:01:00Z"},
        ],
        "packagedAt": "2026-05-16T00:02:00Z",
    }

    result = packager.package_redou_task_skill(payload)

    assert result["success"] is True
    assert re.match(r"^task-tianyi-cloud-remote-access-[0-9a-f]{8}$", result["skillName"])
    assert result["skillCategory"] == "task-packages"
    assert [action for action, _kwargs in calls] == ["create", "write_file", "write_file"]

    skill_md = calls[0][1]["content"]
    assert "description: \"通过 SSH 远程访问天翼云服务器的可复用流程。\"" in skill_md
    assert "# 天翼云服务器远程访问" in skill_md
    assert "secret-value" not in skill_md
    assert "[REDACTED]" in skill_md

    context_ref = calls[1][1]["file_content"]
    transcript_ref = calls[2][1]["file_content"]
    assert "secret-value" not in context_ref
    assert "Bearer abcdefghijklmnop" not in transcript_ref
    assert "请连接天翼云服务器" in transcript_ref


def test_redou_task_packager_updates_existing_skill(tmp_path, monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_skill_manage(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "create":
            return {"success": False, "error": "A skill named 'task-demo' already exists."}
        return {"success": True, "message": f"{action} ok"}

    monkeypatch.setattr(packager, "_skill_manage", fake_skill_manage)
    project = {"id": "project-1", "name": "Demo", "path": str(tmp_path)}
    task = {"id": "task-1", "title": "Demo"}
    metadata = packager.packaged_skill_metadata(project, task, "")
    skill_path = Path(tmp_path) / "profile" / "skills" / "task-packages" / metadata["name"] / "SKILL.md"
    skill_path.parent.mkdir(parents=True)
    skill_path.write_text("existing", encoding="utf-8")

    result = packager.package_redou_task_skill({
        "profileHome": str(tmp_path / "profile"),
        "workspacePath": str(tmp_path),
        "project": project,
        "task": task,
    })

    assert result["packageAction"] == "updated"
    assert [action for action, _kwargs in calls] == ["create", "edit", "write_file", "write_file"]
    assert any("updated" in warning for warning in result["warnings"])
