# Redou-specific Hermes patches

Keep this file updated whenever Redou changes code under `vendor/hermes`.  The
folder intentionally preserves Hermes' original internal layout to make upstream
sync easier.

## Patches currently preserved

- Busy input defaults to `queue` via `hermes_cli/busy_input.py`; guide/steer is
  explicit and interrupt/replace remains available through Redou UI paths.
- Redou Context Assembly Contract in `hermes_cli/redou_context.py`: current user
  request appears once, queued future messages are excluded, guide/control events
  stay out of ordinary history, raw events are summarized, and prompt-bound
  secrets are redacted.
- Redou profile creation uses `--no-skills` where applicable, preserving the
  Redou policy that bundled skills are not auto-packed into new desktop profiles.
- Explicit desktop task packaging is implemented in `hermes_cli/redou_task_skill_packager.py`; Redou desktop only sends project/task state and records the result. Packaged skills include task-derived descriptions and context notes, are never created by automatic background packaging, and are written under the project `HERMES_HOME` / `.redou/skills/` directory.
- Redou Stage Event Protocol in `hermes_cli/run_stage.py` plus Redou prompt guidance in `agent/prompt_builder.py`; Hermes emits lightweight `run_stage` events for task detail timelines without changing final answers or tool-call schemas.

## Sync workflow

1. Sync or diff upstream Hermes against this entire `vendor/hermes` subtree.
2. Re-apply or verify the patches listed above.
3. Run at least:

```bash
PYTHONPATH=vendor/hermes python -m py_compile vendor/hermes/hermes_cli/redou_context.py vendor/hermes/hermes_cli/busy_input.py
node --test ./apps/desktop/tests/*.test.cjs
```

## Redou task skill packager

Redou's explicit task-to-skill packaging implementation lives in Hermes as:

- `hermes_cli/redou_task_skill_packager.py`

The desktop application only collects project/task state and invokes this Hermes-side entry point with `python -m hermes_cli.redou_task_skill_packager`. Redou sets `HERMES_HOME` to the project `.redou` root and passes `REDOU_PROJECT_SKILLS_DIR`, so task-packaged skills are created under `<project-redou-root>/skills/task-packages/`. This keeps the skill format, metadata generation, supporting reference files, redaction, and writes inside the Hermes fork while preserving a clear upstream synchronization boundary.

## Hermes skill management bridge

- `hermes_cli/skill_manage_bridge.py` is kept inside Hermes so Redou Skills page actions call Hermes `skill_manage` through a process boundary instead of reimplementing skill mutation in the desktop layer.

## Redou Stage Event Protocol

Redou keeps this Hermes fork patch so Task Details can show a stage timeline from explicit runtime progress instead of relying only on frontend inference. Hermes owns the production of `run_stage` events; Redou owns display and fallback inference.

The stage enum is intentionally small:

- `understanding` - 理解任务
- `inspecting` - 检查项目
- `planning` - 制定方案
- `editing` - 修改文件
- `testing` - 测试验证
- `packaging` - 打包输出
- `summarizing` - 整理结果
- `blocked` - 等待处理
- `done` - 完成
- `failed` - 失败

Event shape:

```json
{
  "type": "run_stage",
  "stage": "testing",
  "label": "测试验证",
  "status": "running",
  "source": "hermes",
  "timestamp": "2026-05-16T10:21:00Z",
  "details": "正在运行测试、构建、lint 或路径检查"
}
```

`status` is one of `started`, `running`, `completed`, `skipped`, `blocked`, or `failed`. `taskId`, `runId`, and `turnId` are added when Redou/Hermes already has them.

Implementation notes:

- `hermes_cli/run_stage.py` provides `emit_run_stage(...)`, `RunStageEmitter`, and simple tool-to-stage inference.
- `run_agent.py` emits stages through the existing `status_callback` bridge only for `platform="redou"`.
- `apps/desktop/src/hermes_adapter.py` receives `status_callback("run_stage", event)`, writes the event to stdout as structured JSON, and strips accidental `run_stage` JSON from final assistant text.
- `apps/desktop/src/services/redouLocalService.cjs` persists `run_stage` like other AgentEvent records in `messages.jsonl` and `.redou/tasks/<task>/events.jsonl`.

When syncing upstream Hermes, keep this section and the files above. If explicit `run_stage` events are missing, Redou frontend may still infer stages from read/search, edit/write, test/build/lint, package/export, and final-summary events.
