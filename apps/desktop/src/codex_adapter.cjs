/**
 * Redou-to-Codex Adapter
 *
 * Replaces hermes_adapter.py. The Electron Main Process starts this script as
 * a child process for one Task Chat turn. It reads a JSON payload from stdin,
 * spawns `codex app-server` over stdio, drives the Codex JSON-RPC protocol,
 * and writes Redou-compatible AgentEvent JSON lines to its own stdout.
 *
 * Protocol mapping:
 *   Codex Thread   → Redou Task
 *   Codex Turn     → Redou Run/Turn
 *   Codex Items    → Redou Events (assistant_delta, tool_start, tool_output, etc.)
 *   Codex Approval → Redou risk_approval_required / risk_approval_allowed
 */

"use strict";

const { spawn } = require("child_process");
const readline = require("readline");
const path = require("path");
const crypto = require("crypto");
const { runDirectAgent } = require("./direct_agent.cjs");

// --- Constants ---

const RUN_STAGE_STAGES = new Set([
  "understanding", "inspecting", "planning", "editing",
  "testing", "packaging", "summarizing", "blocked", "done", "failed",
]);

const PLAN_MODE_SYSTEM_CONTEXT = `Redou Plan Mode is active for this turn.

Follow the Redou Plan Mode behavior:
- Plan only. Do not implement code or modify project files except the plan markdown file.
- You may inspect the workspace with read-only tools and commands when needed.
- Do not run mutating terminal commands, commit, push, install packages, or perform external actions.
- Write a concrete markdown plan under the Redou-managed project plan directory.
- Include the goal, current context and assumptions, proposed approach, step-by-step plan, likely files to change, tests or validation, and risks or open questions when relevant.
- After saving the plan, reply briefly with the plan summary and saved path.

The user will review the plan in Redou before any execution turn is started.`;

// --- Globals ---

let payload = {};
let codexProcess = null;
let threadId = null;
let turnId = null;
let rpcId = 10;
let turnStartedAt = new Date().toISOString();
let turnStartedMonotonic = Date.now();
let accumulatedText = "";
let lastStage = null;
let pendingApprovals = new Map();
let doneEmitted = false;

// --- Utilities ---

function utcIso() {
  return new Date().toISOString().replace("+00:00", "Z");
}

const fs_sync = require("fs");
function emit(event) {
  if (event && event.type === "done") doneEmitted = true;
  // Use synchronous write to fd 1 (stdout) to ensure data is flushed before process exits
  fs_sync.writeSync(1, JSON.stringify(event) + "\n");
}

function emitRunStage(stage, status, details) {
  if (!RUN_STAGE_STAGES.has(stage)) return;
  lastStage = stage;
  emit({
    type: "run_stage",
    stage,
    label: stage,
    status: status || "running",
    source: "codex",
    timestamp: utcIso(),
    details: details || "",
    taskId: payload.taskId || "",
    projectId: payload.projectId || "",
    runId: payload.runId || "",
  });
}

function turnTiming() {
  const durationMs = Math.max(0, Date.now() - turnStartedMonotonic);
  return {
    startedAt: turnStartedAt,
    completedAt: utcIso(),
    durationMs,
    durationSeconds: Math.round(durationMs / 100) / 10,
  };
}

function nextId() {
  return ++rpcId;
}

function sendToCodex(msg) {
  if (codexProcess && codexProcess.stdin && !codexProcess.stdin.destroyed) {
    codexProcess.stdin.write(JSON.stringify(msg) + "\n");
  }
}

// --- Codex Event → Redou Event Translation ---

function handleCodexMessage(msg) {
  // JSON-RPC response (has `id`)
  if (msg.id !== undefined && msg.result !== undefined) {
    handleRpcResponse(msg);
    return;
  }

  // JSON-RPC error response
  if (msg.id !== undefined && msg.error !== undefined) {
    handleRpcError(msg);
    return;
  }

  // Notification (no `id`, has `method`)
  if (msg.method) {
    handleNotification(msg);
    return;
  }

  // JSON-RPC request from server (has `id` + `method`) - approvals
  if (msg.id !== undefined && msg.method) {
    handleServerRequest(msg);
    return;
  }
}

function handleRpcResponse(msg) {
  // thread/start response
  if (msg.result?.thread?.id && !threadId) {
    threadId = msg.result.thread.id;
    startTurn();
  }
}

function handleRpcError(msg) {
  const errMsg = msg.error?.message || "Codex returned an error";
  emit({ type: "error", message: errMsg, details: JSON.stringify(msg.error) });
}

function handleNotification(msg) {
  const method = msg.method;
  const params = msg.params || {};

  switch (method) {
    case "turn/started":
      turnId = params.turn?.id || turnId;
      emitRunStage("understanding", "started", "Processing request");
      break;

    case "turn/completed":
      handleTurnCompleted(params);
      break;

    case "turn/plan/updated":
      handlePlanUpdated(params);
      break;

    case "turn/diff/updated":
      // Optional: could emit file change summary
      break;

    case "item/started":
      handleItemStarted(params);
      break;

    case "item/completed":
      handleItemCompleted(params);
      break;

    case "item/agentMessage/delta":
      handleAgentDelta(params);
      break;

    case "item/commandExecution/outputDelta":
      handleCommandOutputDelta(params);
      break;

    case "item/reasoning/summaryTextDelta":
      // Reasoning deltas - currently ignored in UI
      break;

    case "thread/tokenUsage/updated":
      // Token usage tracking handled in done event
      break;

    default:
      // Unknown notifications logged as raw
      emit({
        type: "raw_log",
        content: `Codex: ${method}`,
        metadata: { folded: true, codexMethod: method },
      });
  }
}

function handleServerRequest(msg) {
  const method = msg.method;
  const params = msg.params || {};

  // Command execution approval
  if (method === "commandExecution/requestApproval" || method === "approval/commandExecution") {
    handleCommandApproval(msg.id, params);
    return;
  }

  // File change approval
  if (method === "fileChange/requestApproval" || method === "approval/fileChange") {
    handleFileChangeApproval(msg.id, params);
    return;
  }

  // User input request
  if (method === "tool/requestUserInput") {
    // Auto-respond empty for now
    sendToCodex({ id: msg.id, result: { input: "" } });
    return;
  }

  // Unknown server request - respond with empty result
  sendToCodex({ id: msg.id, result: {} });
}

// --- Item Handlers ---

function handleItemStarted(params) {
  const item = params.item || params;
  const itemType = item.type || detectItemType(item);

  switch (itemType) {
    case "commandExecution":
      emitRunStage("testing", "running", item.command || "Running command");
      emit({
        type: "tool_start",
        name: "terminal",
        input: { command: item.command || "", cwd: item.cwd || "" },
        metadata: { toolCallId: item.id || "" },
      });
      break;

    case "fileChange":
      emitRunStage("editing", "running", "Modifying files");
      emit({
        type: "tool_start",
        name: "file_edit",
        input: { changes: item.changes || [] },
        metadata: { toolCallId: item.id || "" },
      });
      break;

    case "mcpToolCall":
      emit({
        type: "tool_start",
        name: item.tool || "mcp_tool",
        input: item.arguments || {},
        metadata: { toolCallId: item.id || "", server: item.server || "" },
      });
      break;

    case "webSearch":
      emitRunStage("inspecting", "running", `Searching: ${item.query || ""}`);
      emit({
        type: "tool_start",
        name: "web_search",
        input: { query: item.query || "" },
        metadata: { toolCallId: item.id || "" },
      });
      break;

    case "agentMessage":
      // Agent is composing a response
      if (!lastStage || lastStage === "understanding") {
        emitRunStage("summarizing", "running", "Composing response");
      }
      break;

    case "reasoning":
      emitRunStage("planning", "running", "Reasoning");
      break;
  }
}

function handleItemCompleted(params) {
  const item = params.item || params;
  const itemType = item.type || detectItemType(item);

  switch (itemType) {
    case "commandExecution": {
      const output = item.aggregatedOutput || "";
      const exitCode = item.exitCode;
      emit({
        type: "tool_output",
        name: "terminal",
        output: output,
        metadata: {
          toolCallId: item.id || "",
          input: { command: item.command || "" },
          exitCode,
        },
      });
      emit({
        type: "tool_end",
        name: "terminal",
        success: exitCode === 0 || exitCode === undefined,
        metadata: { toolCallId: item.id || "" },
      });
      break;
    }

    case "fileChange": {
      const changes = item.changes || [];
      const summary = changes.map((c) => `${c.kind || "modify"}: ${c.path}`).join("\n");
      emit({
        type: "tool_output",
        name: "file_edit",
        output: summary || "File changes applied",
        metadata: { toolCallId: item.id || "", changes },
      });
      emit({
        type: "tool_end",
        name: "file_edit",
        success: item.status !== "rejected",
        metadata: { toolCallId: item.id || "" },
      });
      break;
    }

    case "mcpToolCall": {
      emit({
        type: "tool_output",
        name: item.tool || "mcp_tool",
        output: item.result || item.error || "",
        metadata: { toolCallId: item.id || "" },
      });
      emit({
        type: "tool_end",
        name: item.tool || "mcp_tool",
        success: !item.error,
        metadata: { toolCallId: item.id || "" },
      });
      break;
    }

    case "webSearch": {
      emit({
        type: "tool_output",
        name: "web_search",
        output: `Searched: ${item.query || ""}`,
        metadata: { toolCallId: item.id || "" },
      });
      emit({
        type: "tool_end",
        name: "web_search",
        success: true,
        metadata: { toolCallId: item.id || "" },
      });
      break;
    }

    case "agentMessage": {
      const text = (item.text || "").trim();
      if (text) {
        accumulatedText = text;
        emit({
          type: "assistant_message",
          content: text,
          metadata: { phase: item.phase || "final_answer" },
        });
      }
      break;
    }
  }
}

function handleAgentDelta(params) {
  const delta = params.delta || params.text || "";
  if (delta) {
    accumulatedText += delta;
    emit({ type: "assistant_delta", content: delta, metadata: {} });
  }
}

function handleCommandOutputDelta(params) {
  const delta = params.delta || params.output || "";
  if (delta) {
    emit({
      type: "raw_log",
      content: delta,
      metadata: { folded: true, stream: "command_output", itemId: params.itemId || "" },
    });
  }
}

function handlePlanUpdated(params) {
  const plan = params.plan || [];
  if (plan.length > 0) {
    emitRunStage("planning", "running", `Plan: ${plan.length} step(s)`);
  }
}

function handleTurnCompleted(params) {
  const turn = params.turn || {};
  const status = turn.status || "completed";
  const error = turn.error;

  if (error) {
    emitRunStage("failed", "failed", error.message || "Turn failed");
    emit({
      type: "error",
      message: error.message || "Codex turn failed",
      details: error.additionalDetails || "",
      metadata: { codexErrorInfo: error.codexErrorInfo },
    });
  } else if (status === "completed") {
    emitRunStage("done", "completed", "Task completed");
  } else if (status === "interrupted") {
    emitRunStage("blocked", "blocked", "Turn interrupted");
  }

  const completed = status === "completed";
  const failed = status === "failed" || !!error;
  const interrupted = status === "interrupted";

  emit({
    type: "done",
    metadata: {
      ...turnTiming(),
      completed: completed && !failed,
      failed,
      interrupted,
      partial: interrupted,
      turnExitReason: status,
      error: error?.message || null,
    },
  });
}

// --- Approval Handling ---

function handleCommandApproval(rpcRequestId, params) {
  const command = params.command || params.commandLine || "";
  const cwd = params.cwd || "";
  const reason = `Codex wants to execute: ${command}`;
  const approvalId = crypto.randomUUID();

  const permissions = payload.permissions || {};
  const mode = (permissions.mode || "ask").toLowerCase();

  // Auto-allow mode
  if (mode === "allow" || payload.riskConfirmed === true) {
    sendToCodex({ id: rpcRequestId, result: { decision: "accept" } });
    emit({
      type: "high_risk_command_auto_allowed",
      command,
      cwd,
      reason,
      riskLevel: "high",
      decision: "auto_allow",
      metadata: { permissionMode: mode },
    });
    return;
  }

  // Deny mode
  if (mode === "deny") {
    sendToCodex({ id: rpcRequestId, result: { decision: "decline" } });
    emit({
      type: "high_risk_command_blocked",
      command,
      cwd,
      reason,
      riskLevel: "high",
      metadata: { permissionMode: mode },
    });
    return;
  }

  // Ask mode - emit approval request to Redou UI
  const runtimeApprovalEnabled = permissions.runtime_approval_enabled !== false;
  if (!runtimeApprovalEnabled) {
    sendToCodex({ id: rpcRequestId, result: { decision: "decline" } });
    emit({
      type: "high_risk_command_blocked",
      command,
      cwd,
      reason,
      riskLevel: "high",
      metadata: { permissionMode: mode },
    });
    return;
  }

  const timeoutSeconds = Math.max(10, Math.min(3600, Number(permissions.approval_timeout_seconds) || 300));
  const nowMs = Date.now();

  pendingApprovals.set(approvalId, {
    rpcRequestId,
    command,
    cwd,
    timer: setTimeout(() => {
      pendingApprovals.delete(approvalId);
      sendToCodex({ id: rpcRequestId, result: { decision: "decline" } });
      emit({
        type: "risk_approval_timeout",
        approvalId,
        command,
        reason,
        riskLevel: "high",
        timeoutSeconds,
        metadata: { permissionMode: mode },
      });
    }, timeoutSeconds * 1000),
  });

  emit({
    type: "risk_approval_required",
    approvalId,
    command,
    cwd,
    reason,
    riskLevel: "high",
    mode,
    taskId: payload.taskId || "",
    projectId: payload.projectId || "",
    runId: payload.runId || "",
    allowedDecisions: ["allow_once", "allow_session", "deny"],
    createdAt: nowMs,
    expiresAt: nowMs + timeoutSeconds * 1000,
    metadata: { source: "runtime_command", permissionMode: mode },
  });
}

function handleFileChangeApproval(rpcRequestId, params) {
  // For file changes, auto-accept in workspace-write sandbox mode
  // The user chose to run Codex in this workspace, so file edits are expected
  sendToCodex({ id: rpcRequestId, result: { decision: "accept" } });
}

function resolveApproval(control) {
  const approvalId = (control.approvalId || "").trim();
  const decision = (control.decision || "").trim();

  const entry = pendingApprovals.get(approvalId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pendingApprovals.delete(approvalId);

  let codexDecision = "decline";
  if (decision === "allow_once" || decision === "allow_session" || decision === "allow_always") {
    codexDecision = decision === "allow_session" ? "acceptForSession" : "accept";
  }

  sendToCodex({ id: entry.rpcRequestId, result: { decision: codexDecision } });

  const eventType = codexDecision === "decline" ? "risk_approval_denied" : "risk_approval_allowed";
  emit({
    type: eventType,
    approvalId,
    command: entry.command,
    reason: `User ${decision}`,
    riskLevel: "high",
    decision,
    metadata: { permissionMode: (payload.permissions || {}).mode || "ask" },
  });
}

// --- Control Loop (stdin from Redou) ---
// Control lines are handled inline via main() → handleControlLine()

// --- Codex Launch & Handshake ---

function startTurn() {
  const userContext = payload.userContext || payload.userInput || "";
  const systemContext = payload.systemContext || "";
  const runMode = (payload.runMode || "execute").toLowerCase();

  let instructions = systemContext;
  if (runMode === "plan") {
    instructions = instructions ? `${instructions}\n\n${PLAN_MODE_SYSTEM_CONTEXT}` : PLAN_MODE_SYSTEM_CONTEXT;
  }

  const input = [{ type: "text", text: userContext }];

  const turnParams = {
    threadId,
    input,
  };

  // Add instructions as personality/system context
  if (instructions) {
    turnParams.personality = instructions;
  }

  // Set sandbox policy
  turnParams.sandboxPolicy = { type: "workspaceWrite" };

  sendToCodex({ method: "turn/start", id: nextId(), params: turnParams });
}

function detectItemType(item) {
  if (item.command !== undefined || item.commandActions !== undefined) return "commandExecution";
  if (item.changes !== undefined) return "fileChange";
  if (item.tool !== undefined && item.server !== undefined) return "mcpToolCall";
  if (item.query !== undefined && item.action !== undefined) return "webSearch";
  if (item.text !== undefined && (item.phase !== undefined || item.content === undefined)) return "agentMessage";
  if (item.summary !== undefined || item.content !== undefined) return "reasoning";
  return "unknown";
}

function resolveCodexBinary() {
  // Check env override first
  if (process.env.CODEX_BINARY) return process.env.CODEX_BINARY;

  // Check if `codex` is on PATH (most common after installation)
  return "codex";
}

// Provider catalog for resolving base_url and API key env vars
const PROVIDER_CATALOG = {
  "local-vllm":     { base_url: "http://127.0.0.1:8000/v1", api_key_env: "VLLM_API_KEY", base_url_env: "" },
  deepseek:         { base_url: "https://api.deepseek.com/v1", api_key_env: "DEEPSEEK_API_KEY", base_url_env: "DEEPSEEK_BASE_URL" },
  alibaba:          { base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", api_key_env: "DASHSCOPE_API_KEY", base_url_env: "DASHSCOPE_BASE_URL" },
  "kimi-coding-cn": { base_url: "https://api.moonshot.cn/v1", api_key_env: "KIMI_CN_API_KEY", base_url_env: "" },
  zai:              { base_url: "https://api.z.ai/api/paas/v4", api_key_env: "GLM_API_KEY", base_url_env: "GLM_BASE_URL" },
  "minimax-cn":     { base_url: "https://api.minimaxi.com/v1", api_key_env: "MINIMAX_CN_API_KEY", base_url_env: "MINIMAX_CN_BASE_URL" },
  xiaomi:           { base_url: "https://api.xiaomimimo.com/v1", api_key_env: "XIAOMI_API_KEY", base_url_env: "XIAOMI_BASE_URL" },
  doubao:           { base_url: "https://ark.cn-beijing.volces.com/api/v3", api_key_env: "ARK_API_KEY", base_url_env: "" },
  openrouter:       { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY", base_url_env: "OPENROUTER_BASE_URL" },
  openai:           { base_url: "https://api.openai.com/v1", api_key_env: "OPENAI_API_KEY", base_url_env: "" },
  anthropic:        { base_url: "https://api.anthropic.com", api_key_env: "ANTHROPIC_API_KEY", base_url_env: "" },
};

// Model name prefix → provider slug mapping for auto-detection
const MODEL_PREFIX_TO_PROVIDER = [
  [/^mimo-/i, "xiaomi"],
  [/^deepseek-/i, "deepseek"],
  [/^qwen/i, "alibaba"],
  [/^kimi-/i, "kimi-coding-cn"],
  [/^glm-/i, "zai"],
  [/^minimax-/i, "minimax-cn"],
  [/^doubao-/i, "doubao"],
  [/^gpt-/i, "openai"],
  [/^o[1-9]/i, "openai"],
  [/^claude-/i, "anthropic"],
  [/^anthropic\//i, "openrouter"],
  [/^openai\//i, "openrouter"],
  [/^google\//i, "openrouter"],
];

function inferProvider(model) {
  if (!model) return null;
  for (const [pattern, provider] of MODEL_PREFIX_TO_PROVIDER) {
    if (pattern.test(model)) return provider;
  }
  return null;
}

function launchCodex() {
  const codexBin = resolveCodexBinary();
  const cwd = payload.workspacePath || process.cwd();

  const args = ["app-server", "--listen", "stdio://"];

  // Add sandbox policy
  args.push("--sandbox", "workspace-write");

  const env = { ...process.env };
  let provider = (payload.provider || "").toLowerCase().replace(/\s+/g, "-");
  if (!provider || provider === "auto") {
    provider = inferProvider(payload.model) || provider;
  }
  const providerInfo = PROVIDER_CATALOG[provider] || null;

  // Pass API key — explicit payload > provider catalog > existing OPENAI_API_KEY
  if (payload.apiKey || payload.api_key) {
    env.OPENAI_API_KEY = payload.apiKey || payload.api_key;
  } else if (providerInfo?.api_key_env && process.env[providerInfo.api_key_env]) {
    env.OPENAI_API_KEY = process.env[providerInfo.api_key_env];
  }

  // Pass base URL — explicit payload > provider catalog
  if (payload.baseUrl || payload.base_url) {
    env.OPENAI_BASE_URL = payload.baseUrl || payload.base_url;
  } else if (providerInfo?.base_url && provider !== "openai") {
    env.OPENAI_BASE_URL = providerInfo.base_url;
  }

  emit({
    type: "raw_log",
    content: `Provider: ${provider || "default"}, Model: ${payload.model || "default"}, Base URL: ${env.OPENAI_BASE_URL || "(default)"}, API Key set: ${!!env.OPENAI_API_KEY}`,
    metadata: { folded: true, stream: "codex_config" },
  });

  codexProcess = spawn(codexBin, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });

  // Read stdout lines from Codex
  const rl = readline.createInterface({ input: codexProcess.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      handleCodexMessage(msg);
    } catch {
      emit({ type: "raw_log", content: trimmed, metadata: { folded: true, stream: "codex_stdout" } });
    }
  });

  // Stderr from Codex - log as raw
  codexProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      emit({ type: "raw_log", content: text, metadata: { folded: true, stream: "codex_stderr" } });
    }
  });

  codexProcess.on("error", (err) => {
    emit({ type: "error", message: `Failed to start Codex: ${err.message}` });
    emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: err.message } });
    process.exit(1);
  });

  codexProcess.on("exit", (code) => {
    rl.close();
    if (!doneEmitted) {
      const msg = code ? `Codex process exited with code ${code}` : "Codex process exited unexpectedly";
      emit({ type: "error", message: msg });
      emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: msg, exitCode: code } });
    }
  });

  // Initialize handshake
  sendToCodex({
    method: "initialize",
    id: 0,
    params: {
      clientInfo: {
        name: "redou_agent",
        title: "Redou Agent",
        version: "0.3.4",
      },
    },
  });

  sendToCodex({ method: "initialized", params: {} });

  // Start a thread
  const model = payload.model || "";
  const threadParams = {};
  if (model) {
    threadParams.model = model;
  }
  threadParams.cwd = cwd;

  sendToCodex({ method: "thread/start", id: 1, params: threadParams });
}

// --- Main Entry ---

function main() {
  process.stderr.write(`[codex_adapter] PID=${process.pid} v2 direct_agent=${typeof runDirectAgent === 'function'}\n`);
  turnStartedAt = utcIso();
  turnStartedMonotonic = Date.now();

  const rl = readline.createInterface({ input: process.stdin });
  let gotPayload = false;

  rl.on("line", (line) => {
    if (!gotPayload) {
      gotPayload = true;
      try {
        payload = JSON.parse(line || "{}");
      } catch {
        payload = {};
      }
      startAdapter();
      return;
    }

    // Subsequent lines are control commands from Redou
    handleControlLine(line);
  });

  rl.on("close", () => {
    if (!gotPayload) {
      emit({ type: "error", message: "No valid payload received on stdin." });
      emit({ type: "done", metadata: { completed: false, failed: true } });
      process.exit(1);
    }
    // stdin closed - Redou is terminating this run
    if (codexProcess && !codexProcess.killed) {
      codexProcess.kill();
    }
  });
}

function handleControlLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let command;
  try {
    command = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!command || typeof command !== "object") return;

  if (command.type === "risk_approval_decision") {
    resolveApproval(command);
    return;
  }

  if (command.type === "steer") {
    const text = (command.text || "").trim();
    if (text && threadId) {
      sendToCodex({
        method: "turn/steer",
        id: nextId(),
        params: { threadId, input: [{ type: "text", text }] },
      });
      emit({
        type: "raw_log",
        content: "User guidance accepted for the active run.",
        metadata: { folded: true, guided: true, guideId: command.guideId },
      });
    }
  }
}

function startAdapter() {
  emit({
    type: "raw_log",
    content: "Codex adapter starting.",
    metadata: { folded: true },
  });

  // Resolve provider from payload
  let provider = (payload.provider || "").toLowerCase().replace(/\s+/g, "-");
  if (!provider || provider === "auto") {
    provider = inferProvider(payload.model) || provider;
  }
  const providerInfo = PROVIDER_CATALOG[provider] || null;

  // Determine if we should use Codex CLI (only for OpenAI) or direct agent (all others)
  const useCodex = provider === "openai" || (!providerInfo && !provider);
  process.stderr.write(`[codex_adapter] provider=${provider}, model=${payload.model}, useCodex=${useCodex}, providerInfo=${!!providerInfo}\n`);

  if (!useCodex) {
    // --- Direct agent mode for third-party providers ---
    const apiKey = payload.apiKey || payload.api_key
      || (providerInfo?.api_key_env && process.env[providerInfo.api_key_env])
      || process.env.OPENAI_API_KEY || "";
    // Base URL priority: explicit payload > env var override > catalog default
    const baseUrl = payload.baseUrl || payload.base_url
      || (providerInfo?.base_url_env && process.env[providerInfo.base_url_env])
      || providerInfo?.base_url
      || "https://api.openai.com/v1";
    const model = payload.model || "default";
    const cwd = payload.workspacePath || process.cwd();
    const maxIterations = payload.maxIterations || 30;
    const systemPrompt = payload.systemContext || "You are a coding agent. Complete the given task by reading files, writing code, and running commands.";
    const userPrompt = payload.userContext || payload.userInput || "";
    const requestTimeout = (payload.requestTimeoutSeconds || 300) * 1000;

    emit({
      type: "raw_log",
      content: `Direct agent mode: provider=${provider}, model=${model}, base_url=${baseUrl}, api_key_set=${!!apiKey}`,
      metadata: { folded: true, stream: "agent_config" },
    });

    runDirectAgent({
      baseUrl,
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      cwd,
      maxIterations,
      emit,
      turnTiming,
      requestTimeout,
    }).then(() => {
      // emit already uses fs.writeSync so data is flushed. Destroy stdin to let process exit.
      process.stdin.destroy();
    }).catch((err) => {
      if (!doneEmitted) {
        emit({ type: "error", message: err.message });
        emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: err.message } });
      }
      process.stdin.destroy();
    });
    return;
  }

  // --- Codex CLI mode (OpenAI only) ---

  // Global timeout: ensure the adapter never hangs forever (default 30 min)
  const maxDurationMs = (payload.maxDurationSeconds || 1800) * 1000;
  setTimeout(() => {
    if (!doneEmitted) {
      const msg = `Adapter timed out after ${Math.round(maxDurationMs / 60000)} minutes without completion.`;
      emit({ type: "error", message: msg });
      emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: msg, timedOut: true } });
      if (codexProcess && !codexProcess.killed) codexProcess.kill();
      process.exit(1);
    }
  }, maxDurationMs).unref();

  // Startup timeout: if no response from Codex within 60s, fail fast
  const startupTimeout = setTimeout(() => {
    if (!doneEmitted && !threadId) {
      const msg = "Codex did not respond within 60 seconds. Check API key and base URL.";
      emit({ type: "error", message: msg });
      emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: msg } });
      if (codexProcess && !codexProcess.killed) codexProcess.kill();
      process.exit(1);
    }
  }, 60000).unref();

  launchCodex();
}

main();
