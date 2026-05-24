import yaml

from desktop.src import dashboard_bridge as bridge


def _write_skill(skill_dir, name="task-1-1ce5ef6d"):
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "\n".join(
            [
                "---",
                f"name: {name}",
                'description: "Reusable workflow packaged from Redou task."',
                "metadata:",
                "  hermes:",
                "    category: task-packages",
                "---",
                "",
                "# Packaged Task",
                "",
                "Use this when a future task has the same recurring shape.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def test_profile_task_package_skills_are_discovered(tmp_path):
    profile_home = tmp_path / "profiles" / "redou-test5-mp3mxl04"
    _write_skill(profile_home / "skills" / "task-packages" / "task-1-1ce5ef6d")

    rows = bridge._scan_profile_skills(profile_home, "redou-test5-mp3mxl04")

    assert rows == [
        {
            "id": "profile:redou-test5-mp3mxl04:task-1-1ce5ef6d",
            "name": "task-1-1ce5ef6d",
            "description": "Reusable workflow packaged from Redou task.",
            "category": "task-packages",
            "enabled": True,
            "source": "profile",
            "profile": "redou-test5-mp3mxl04",
            "path": str(
                profile_home
                / "skills"
                / "task-packages"
                / "task-1-1ce5ef6d"
                / "SKILL.md"
            ),
        }
    ]


def test_profile_skill_toggle_writes_profile_config(tmp_path):
    profile_home = tmp_path / "profiles" / "redou-test5-mp3mxl04"
    profile_home.mkdir(parents=True)

    bridge._set_disabled_skill_for_home(profile_home, "task-1-1ce5ef6d", False)

    config = yaml.safe_load((profile_home / "config.yaml").read_text(encoding="utf-8"))
    assert config["skills"]["disabled"] == ["task-1-1ce5ef6d"]

    bridge._set_disabled_skill_for_home(profile_home, "task-1-1ce5ef6d", True)

    config = yaml.safe_load((profile_home / "config.yaml").read_text(encoding="utf-8"))
    assert config["skills"]["disabled"] == []


def test_delete_profile_skill_uses_hermes_skill_manage(tmp_path, monkeypatch):
    profile_name = "redou-test5-mp3mxl04"
    profile_home = tmp_path / "profiles" / profile_name
    skill_dir = profile_home / "skills" / "task-packages" / "task-delete"
    _write_skill(skill_dir, "task-delete")
    (profile_home / "config.yaml").write_text(
        "skills:\n  disabled:\n    - task-delete\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(bridge, "get_hermes_home", lambda: tmp_path)

    result = bridge._delete_skill(
        {
            "name": "task-delete",
            "source": "profile",
            "profile": profile_name,
            "path": str(skill_dir / "SKILL.md"),
        }
    )

    assert result["ok"] is True
    assert result["name"] == "task-delete"
    assert result["source"] == "profile"
    assert not skill_dir.exists()
    config = yaml.safe_load((profile_home / "config.yaml").read_text(encoding="utf-8"))
    assert config["skills"]["disabled"] == []


def test_merge_profile_skills_appends_and_archives_sources(tmp_path, monkeypatch):
    profile_name = "redou-test5-mp3mxl04"
    profile_home = tmp_path / "profiles" / profile_name
    target_dir = profile_home / "skills" / "task-packages" / "task-target"
    source_dir = profile_home / "skills" / "task-packages" / "task-source"
    _write_skill(target_dir, "task-target")
    _write_skill(source_dir, "task-source")
    (source_dir / "references").mkdir(parents=True)
    (source_dir / "references" / "notes.md").write_text("source notes", encoding="utf-8")
    monkeypatch.setattr(bridge, "get_hermes_home", lambda: tmp_path)

    result = bridge._merge_skills(
        {
            "skills": [
                {
                    "name": "task-target",
                    "source": "profile",
                    "profile": profile_name,
                    "path": str(target_dir / "SKILL.md"),
                },
                {
                    "name": "task-source",
                    "source": "profile",
                    "profile": profile_name,
                    "path": str(source_dir / "SKILL.md"),
                },
            ]
        }
    )

    assert result["ok"] is True
    assert result["mergedInto"]["name"] == "task-target"
    assert result["archived"][0]["name"] == "task-source"
    assert not source_dir.exists()
    assert (profile_home / "skills" / ".archive").is_dir()
    target_text = (target_dir / "SKILL.md").read_text(encoding="utf-8")
    assert "## Merged Skill: task-source" in target_text
    assert "### Absorbed Instructions" in target_text
    assert (target_dir / "references" / "merged").is_dir()
