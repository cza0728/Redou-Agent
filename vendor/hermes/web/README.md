# Redou Agent Renderer UI

This package contains the Electron Renderer UI for the local Redou Agent
desktop app. It is not a standalone frontend for an independent Web backend.

## Architecture Boundary

- Renderer owns Project tree, Task Chat, messages, input, command cards, tool
  cards, file cards, and error cards.
- Renderer calls Electron IPC handlers exposed by the preload bridge.
- Renderer must not call `child_process`, operate Hermes CLI directly, or do
  heavy local file I/O.
- Electron Main Process / Local Service owns persistence, app-data
  initialization, context-file reads/writes, Context Builder, Hermes profile
  management, Hermes CLI child processes, stdout/stderr parsing, and
  `AgentEvent` streaming over IPC.
- Hermes runs only as the local runtime in the background.

Required chat flow:

```text
Renderer TaskChat
  -> IPC sendMessage(projectId, taskId, userInput)
  -> Main Process chatHandler
  -> Context Builder
  -> HermesAdapter
  -> Hermes CLI / Runtime
  -> AgentEvent stream
  -> IPC push events
  -> Renderer renders Chat UI
```

Do not add a standalone Web backend, HTTP API, FastAPI app, Express server, or
remote service for Redou UI features. Do not turn the UI into a PTY, xterm, or
raw Hermes terminal relay.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 with custom dark theme
- Hand-rolled UI primitives

## Development

Run the desktop shell from the repository root:

```powershell
.\Launch Redou Agent.cmd
```

For renderer-only iteration, Vite can still compile the UI, but production
features should be wired through Electron IPC handlers rather than fetch-based
endpoints:

```bash
npm run dev
npm run build
npm run lint
```

## Structure

```text
src/
├── components/   # UI primitives and feature components
├── lib/          # Renderer helpers and IPC-facing adapters
├── pages/        # Workspace, chat, config, and related views
├── App.tsx       # Main layout and navigation
├── main.tsx      # React entry point
└── index.css     # Tailwind imports and theme variables
```
