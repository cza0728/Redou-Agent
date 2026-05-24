# Contributing to Redou Agent

Thank you for contributing to Redou Agent. This guide describes how to work on
the project without blurring the boundaries between the desktop app, the local
service layer, and the underlying local runtime.

## Project Shape

Redou Agent is a local-first Electron desktop application. Treat it as a
desktop product, not as a split frontend plus standalone web service.

Use these names consistently in prompts, plans, comments, and docs:

- **Renderer/UI layer**: project tree, task chat, messages, input composer,
  command cards, tool cards, file cards, and error cards.
- **Electron Main Process / Local Service layer**: persistence, app-data
  initialization, context-file reads and writes, Context Builder, profile
  management, CLI child processes, stdout/stderr parsing, and IPC event
  streaming.
- **Local Runtime layer**: the local agent runtime running in the background.

The required call chain is:

```text
Renderer TaskChat
  -> IPC sendMessage(projectId, taskId, userInput)
  -> Main Process chatHandler
  -> Context Builder
  -> Runtime Adapter
  -> Local CLI / Runtime
  -> AgentEvent stream
  -> IPC push events
  -> Renderer renders Chat UI
```

Renderer code must not call `child_process`, operate the runtime CLI directly,
or perform heavy local file I/O. Use IPC handlers exposed by the preload bridge.
Terminal output is never the main UI surface; parse it into structured
`AgentEvent` objects and render a ChatGPT-like task chat with event cards.

Do not add a standalone Web backend, HTTP API, FastAPI app, Express server, or
remote service for Redou UI features.

## Contribution Priorities

We value contributions in this order:

1. **Bug fixes**: crashes, incorrect behavior, lost task state, broken IPC
   flows, and data-loss risks.
2. **Security hardening**: command execution boundaries, path traversal,
   secret handling, prompt-injection impact, and unsafe renderer/main-process
   boundaries.
3. **Desktop workflow quality**: task chat ergonomics, project/task state,
   context building, structured event rendering, and recovery from runtime
   failures.
4. **Cross-platform reliability**: Windows first, with Linux/macOS kept in mind
   for shared Python and Node code.
5. **Performance and robustness**: startup time, streaming latency, retry logic,
   graceful degradation, and actionable error states.
6. **Documentation**: setup clarity, architecture notes, and troubleshooting.

Keep PRs focused. One logical change per PR is much easier to review and test.

## Development Setup

Prerequisites:

| Requirement | Notes |
|-------------|-------|
| Git | Use `--recurse-submodules` if you need submodules. |
| Python 3.11+ | Prefer the project virtual environment. |
| Node.js 20+ | Required for the Electron renderer and desktop packaging. |
| uv | Recommended for Python environment setup. |

Clone and install:

```bash
git clone https://github.com/herb711/RedouAgent.git
cd RedouAgent
```

Python environment:

```bash
# Prefer .venv; fall back to venv if that is what your checkout has.
source .venv/bin/activate

# On Windows PowerShell:
# .\.venv\Scripts\Activate.ps1
```

Desktop app:

```bash
cd desktop
npm install
npm run build
```

Windows install/check helpers:

```powershell
.\install-redou-agent.ps1 -CheckOnly
.\Install Redou Agent.cmd
```

## Testing

Run the narrowest useful test first, then expand based on risk.

Python:

```bash
scripts/run_tests.sh
```

Desktop:

```bash
cd desktop
npm test
```

If your change touches renderer layout or task chat behavior, manually launch
the desktop app and verify the user-visible flow. If your change touches runtime
launching, context building, command/event parsing, persistence, or IPC, add or
update tests in the relevant desktop service/test area.

## Architecture Rules

- Keep Renderer work UI-focused. It should render state and call preload IPC
  methods.
- Keep local filesystem, profile, process, and runtime orchestration in the
  Electron Main Process / Local Service layer.
- Convert raw runtime output into structured events before it reaches the UI.
- Prefer explicit `AgentEvent` shapes over ad hoc strings.
- Preserve task history and context files in a way users can inspect and move
  with their projects.
- Keep Redou-specific runtime behavior behind Redou-specific adapters or helper
  modules instead of scattering product checks through unrelated code.
- Do not convert the chat UI into a PTY, xterm, or raw terminal relay.

## Code Style

- Match the existing patterns in the file you edit.
- Keep changes scoped to the behavior requested.
- Prefer typed, structured data over stringly-typed parsing where practical.
- Use clear error messages that can be shown in the UI.
- Avoid logging secrets, provider keys, raw tokens, or private file contents.
- Add comments only where they explain non-obvious intent or trade-offs.

## Security-Sensitive Changes

Be especially careful with:

- IPC handlers and preload bridge exposure.
- Path handling for workspace files, attachments, and context files.
- Runtime command construction and child process environment variables.
- Secrets in config files, logs, crash reports, and renderer state.
- Any feature that lets model output influence shell commands, file writes, or
  local process execution.

If your PR changes any of these areas, call it out in the PR description and
include the manual security checks you performed.

## Pull Request Checklist

Before submitting:

1. Run relevant tests.
2. Manually exercise the changed desktop flow when user-visible behavior changed.
3. Confirm renderer code is using IPC rather than direct local process or heavy
   filesystem access.
4. Confirm logs and errors do not expose secrets.
5. Keep unrelated rebrands, formatting churn, and refactors out of the PR.

## Commit Messages

Use Conventional Commits:

```text
<type>(<scope>): <description>
```

Common types:

| Type | Use for |
|------|---------|
| `fix` | Bug fixes |
| `feat` | New features |
| `docs` | Documentation |
| `test` | Tests |
| `refactor` | Code restructuring without behavior change |
| `chore` | Build, packaging, and maintenance |

Useful scopes include `desktop`, `renderer`, `main`, `runtime`, `context`,
`models`, `skills`, `install`, `security`, and `docs`.

## Reporting Issues

Use GitHub Issues: <https://github.com/herb711/RedouAgent/issues>

Include:

- OS and version.
- Redou Agent version or commit SHA.
- Whether you launched from the installer, script, or development checkout.
- Steps to reproduce.
- Relevant logs with secrets removed.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
