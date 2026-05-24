# Redou Agent Security Policy

This document describes Redou Agent's trust model, supported security posture,
and vulnerability reporting scope.

## 1. Reporting a Vulnerability

Report privately through GitHub Security Advisories for this repository:

<https://github.com/herb711/RedouAgent/security/advisories/new>

Do not open public issues for security vulnerabilities. Redou Agent does not
operate a bug bounty program.

A useful report includes:

- A concise description and severity assessment.
- The affected component, identified by file path and line range.
- Environment details: Redou Agent version or commit SHA, OS, Python version,
  Node.js version, and install method.
- A reproduction against `main` or the latest release.
- A statement of which trust boundary in this policy is crossed.

Please read the scope section before submitting. Reports that demonstrate limits
of an in-process heuristic are welcome as regular issues or pull requests, but
they are not handled through the private security channel unless they chain to an
in-scope impact.

## 2. Trust Model

Redou Agent is a single-tenant, local-first desktop agent workspace. Its main
surfaces are:

- **Renderer/UI layer**: displays projects, tasks, messages, cards, and
  controls.
- **Electron Main Process / Local Service layer**: owns persistence, local
  filesystem access, context building, profile management, process launching,
  stdout/stderr parsing, and IPC event streaming.
- **Local Runtime layer**: runs the local agent runtime and tools in the
  background.

The Renderer is not a security boundary. It must be treated as a UI surface that
requests work through the preload bridge. Privileged operations belong in the
Main Process / Local Service layer and must validate their inputs there.

## 3. Security Boundary

The only reliable containment boundary against adversarial model output is
operating-system-level isolation. In-process checks such as command approval,
pattern scanners, output redaction, tool allowlists, and UI warnings are useful
defense-in-depth mechanisms, but they are not containment.

Supported postures:

- **Default local desktop posture**: Redou Agent runs with the permissions of
  the current OS user. The operator should only use trusted workspaces and
  model/tool configurations appropriate for local execution.
- **Runtime isolation posture**: shell and file operations are routed through a
  constrained backend such as a container, remote host, or sandbox where
  available.
- **Whole-process isolation posture**: the desktop app or runtime process tree is
  run inside an external OS sandbox with explicit filesystem, network, and
  process policy.

If Redou Agent is configured to ingest untrusted content such as arbitrary web
pages, email, shared chat, or untrusted project files, use an OS-level isolation
posture that matches the risk.

## 4. IPC and Local Surface Rules

Every IPC handler that crosses from Renderer to Main Process must:

- Validate project, task, file, and profile identifiers.
- Resolve filesystem paths before access checks.
- Restrict reads and writes to expected app-data, workspace, attachment, and
  context-file locations.
- Avoid passing secrets to the Renderer.
- Return structured errors suitable for user-visible error cards.

The Renderer must not:

- Call `child_process`.
- Launch or operate the runtime CLI directly.
- Perform heavy local file I/O.
- Render raw terminal output as the primary agent UI.

Network-exposed surfaces, if enabled, must require explicit authorization before
dispatching agent work, resolving approvals, or relaying output.

## 5. Secrets and Logs

Provider keys, tokens, passwords, OAuth credentials, and session authorization
material must not appear in:

- Renderer state.
- IPC payloads unless strictly required and intentionally scoped.
- Desktop logs.
- Runtime logs shown in the UI.
- Crash reports.
- Test fixtures.

Secrets belong in the configured credential store or environment files managed by
the local app, not in project context files, task messages, screenshots, or
documentation examples.

## 6. In Scope

The following are security vulnerabilities under this policy:

- Unauthorized IPC or network-surface access that dispatches work, reads output,
  resolves approvals, or accesses task/project data outside the authorized
  caller's scope.
- Path traversal or symlink bypass that reads or writes outside the intended
  workspace, app-data, attachment, or context-file roots.
- Credential leakage through logs, IPC, Renderer state, crash output, runtime
  child-process environments, or model/tool payloads where Redou Agent claimed to
  prevent it.
- Escape from a documented OS-level isolation posture.
- A consuming layer rendering agent output contrary to documented expectations,
  such as treating untrusted output as executable script or privileged UI state.

## 7. Out of Scope

These issues may still be worth reporting publicly, but they are not private
security vulnerabilities by themselves:

- Bypasses of in-process heuristics such as command-approval regexes, redaction
  patterns, or prompt-injection scanners without a chained in-scope impact.
- Prompt injection alone.
- Consequences of intentionally running the default local posture on untrusted
  content.
- Public exposure of local-only surfaces without authentication, VPN, firewall,
  or equivalent external controls.
- Behavior from third-party skills, plugins, models, or tools that the operator
  installed and trusted, unless Redou Agent hid or misrepresented what was being
  installed.

## 8. Deployment Hardening

- Run as a non-admin user for normal development.
- Keep provider keys and tokens out of project workspaces.
- Review third-party skills, plugins, MCP servers, and local tools before use.
- Use OS-level isolation for untrusted workspaces or content.
- Keep the desktop app, Python runtime, Node dependencies, and model/tool
  integrations updated.
- Configure explicit allowlists before enabling any network-exposed adapter.

## 9. Disclosure

- Coordinated disclosure window: 90 days from report, or until a fix is released,
  whichever comes first.
- Channel: the GitHub Security Advisory thread.
- Credit: reporters are credited in release notes unless anonymity is requested.
