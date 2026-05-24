const crypto = require("crypto");
const path = require("path");
const { isRunLogicallyActive } = require("../processes/processManager.cjs");

function nowSeconds() {
  return Date.now() / 1000;
}

function toInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function timestampSeconds(value, fallback = nowSeconds()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed / 1000 : fallback;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedMsSince(value, nowMs = Date.now()) {
  const startedMs = timestampMs(value);
  return startedMs == null ? 0 : Math.max(0, nowMs - startedMs);
}

function isLiveAnalysisStatus(status) {
  return ["queued", "running"].includes(String(status || "").toLowerCase());
}

function dateKeyFromSeconds(seconds) {
  return new Date(timestampSeconds(seconds) * 1000).toISOString().slice(0, 10);
}

function compact(value, max = 200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function clampScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function averageScore(items) {
  const scores = items.map((item) => Number(item.score || 0));
  if (scores.length === 0) return 0;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function usageFromMetadata(metadata = {}) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  return {
    inputTokens: toInt(meta.inputTokens ?? meta.input_tokens),
    outputTokens: toInt(meta.outputTokens ?? meta.output_tokens),
    cacheReadTokens: toInt(meta.cacheReadTokens ?? meta.cache_read_tokens),
    cacheWriteTokens: toInt(meta.cacheWriteTokens ?? meta.cache_write_tokens),
    reasoningTokens: toInt(meta.reasoningTokens ?? meta.reasoning_tokens),
    apiCalls: toInt(meta.apiCalls ?? meta.api_calls),
    estimatedCostUsd: toNumber(meta.estimatedCostUsd ?? meta.estimated_cost_usd),
  };
}

function addUsage(target, usage = {}) {
  target.inputTokens += toInt(usage.inputTokens);
  target.outputTokens += toInt(usage.outputTokens);
  target.cacheReadTokens += toInt(usage.cacheReadTokens);
  target.cacheWriteTokens += toInt(usage.cacheWriteTokens);
  target.reasoningTokens += toInt(usage.reasoningTokens);
  target.apiCalls += toInt(usage.apiCalls);
  target.estimatedCostUsd += toNumber(usage.estimatedCostUsd);
  return target;
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    apiCalls: 0,
    estimatedCostUsd: 0,
  };
}

function hasUsage(usage = {}) {
  return (
    toInt(usage.inputTokens) > 0 ||
    toInt(usage.outputTokens) > 0 ||
    toInt(usage.cacheReadTokens) > 0 ||
    toInt(usage.cacheWriteTokens) > 0 ||
    toInt(usage.reasoningTokens) > 0 ||
    toInt(usage.apiCalls) > 0 ||
    toNumber(usage.estimatedCostUsd) > 0
  );
}

function mergeMetadata(message = {}) {
  const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const event = metadata.event && typeof metadata.event === "object" ? metadata.event : {};
  const eventMetadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return {
    metadata,
    event,
    eventMetadata,
    combined: { ...metadata, ...eventMetadata },
    eventType: metadata.eventType || event.type || "",
  };
}

function truthyFailureText(value) {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text || text === "false" || text === "null") return "";
  return text;
}

function doneRuntimeStatus(combined = {}) {
  const exitCode = Number(combined.exitCode);
  const turnExitReason = String(combined.turnExitReason || combined.turn_exit_reason || "").toLowerCase();
  const interrupted = Boolean(
    combined.cancelled ||
      combined.canceled ||
      combined.stopRequested ||
      combined.interrupted ||
      combined.replacedByRunId,
  );
  if (interrupted) return "interrupted";

  const failed = Boolean(
    combined.failed === true ||
      combined.partial === true ||
      truthyFailureText(combined.error) ||
      truthyFailureText(combined.failure) ||
      truthyFailureText(combined.exception) ||
      (combined.completed === false && /max_iterations|error|failed|failure|exception|invalid/.test(turnExitReason)) ||
      (Number.isFinite(exitCode) && exitCode !== 0),
  );
  return failed ? "failed" : "completed";
}

function interruptionTextFromMessage(message = {}) {
  const { combined, event } = mergeMetadata(message);
  return [
    message.content,
    event.message,
    combined.message,
    combined.reason,
    combined.error,
  ].filter(Boolean).join(" ");
}

function isInterruptionText(text) {
  return /stopped|interrupted|cancelled|canceled|closing/i.test(String(text || ""));
}

function isStreamRecoveryInterruptionText(text) {
  return /stream stalled mid tool-call|stream interrupted before completion/i.test(String(text || ""));
}

function previousRunMessagesIndicateInterruption(messages, doneIndex) {
  for (let index = doneIndex - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (String(message.role || "").toLowerCase() === "user") return false;
    if (isInterruptionText(interruptionTextFromMessage(message))) return true;
  }
  return false;
}

function previousRunMessagesIndicateStreamRecovery(messages, doneIndex) {
  for (let index = doneIndex - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (String(message.role || "").toLowerCase() === "user") return false;
    if (isStreamRecoveryInterruptionText(interruptionTextFromMessage(message))) return true;
  }
  return false;
}

class AnalyticsService {
  constructor({ host, paths = {}, analysis = {} }) {
    if (!host) throw new Error("AnalyticsService requires a host service.");
    this.host = host;
    this.paths = paths;
    this.analysis = analysis;
  }

  hermesHome() {
    return typeof this.paths.hermesHome === "function"
      ? this.paths.hermesHome()
      : this.host.hermesHome;
  }

  analysisTasks() {
    return Array.isArray(this.analysis.tasks) ? this.analysis.tasks : [];
  }

  analysisAbilityKeys() {
    return Array.isArray(this.analysis.abilityKeys) ? this.analysis.abilityKeys : [];
  }

  getModelsAnalytics(days) {
    return this.host.runDashboardBridge("get_models_analytics", { days });
  }

  activeAnalysisItems() {
    const items = [];
    const seen = new Set();
    const add = (item) => {
      if (!item || typeof item !== "object") return;
      const id = item.runId || item.key;
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(item);
    };
    if (this.host.activeAnalysisRuns instanceof Map) {
      for (const item of this.host.activeAnalysisRuns.values()) {
        add(item);
      }
    }
    add(this.host.activeAnalysisRun);
    return items;
  }

  primaryActiveAnalysisRun() {
    return this.activeAnalysisItems()[0] || null;
  }

  getStatus() {
    const activeRuns = Array.from(this.host.activeRuns.entries())
      .filter(([, run]) => isRunLogicallyActive(run))
      .map(([runId, run]) => ({
        runId,
        ...run,
      }));
    const activeAnalysisRuns = this.activeAnalysisItems();
    const latestActivityMs = Math.max(
      0,
      ...activeRuns.map((run) => Number(run.lastActiveAtMs || run.startedAtMs || 0)),
      activeAnalysisRuns.length > 0 ? Date.now() : 0,
    );
    const activeCount = activeRuns.length + activeAnalysisRuns.length;
    const primaryRun = activeRuns[0] || null;
    const hermesHome = this.hermesHome();
    return {
      active_sessions: activeCount,
      config_path: path.join(hermesHome, "config.yaml"),
      config_version: 0,
      env_path: path.join(hermesHome, ".env"),
      gateway_exit_reason: null,
      gateway_health_url: null,
      gateway_pid: primaryRun?.child?.pid || null,
      gateway_platforms: {},
      gateway_running: activeCount > 0,
      gateway_state: activeCount > 0 ? "running" : "stopped",
      gateway_updated_at: latestActivityMs ? new Date(latestActivityMs).toISOString() : null,
      hermes_home: hermesHome,
      latest_config_version: 0,
      release_date: "",
      version: "desktop",
    };
  }

  desktopSessionId(project, task) {
    return `redou:${project.id}:${task.id}`;
  }

  findTaskByDesktopSessionId(sessionId) {
    const target = String(sessionId || "");
    for (const project of this.host.readAllProjects()) {
      for (const task of project.tasks || []) {
        if (
          this.desktopSessionId(project, task) === target ||
          (task.hermesSessionId && task.hermesSessionId === target) ||
          (task.session_id && task.session_id === target)
        ) {
          return { project, task };
        }
      }
    }
    return { project: null, task: null };
  }

  activeRunForTaskSnapshot(projectId, taskId) {
    for (const [runId, run] of this.host.activeRuns.entries()) {
      if (!isRunLogicallyActive(run)) continue;
      if (run.projectId === projectId && run.taskId === taskId) {
        return { runId, ...run };
      }
    }
    return null;
  }

  analysisRunForTaskSnapshot(projectId, taskId) {
    for (const item of this.activeAnalysisItems()) {
      if (item.projectId === projectId && item.taskId === taskId) {
        const nowMs = Date.now();
        return {
          state: "running",
          item,
          startedAtMs: Number(item.analysisStartedAtMs || item.startedAtMs || nowMs),
          lastActiveAtMs: Number(item.analysisLastActiveAtMs || item.analysisStartedAtMs || nowMs),
        };
      }
    }
    for (const item of this.host.analysisQueue || []) {
      if (item.projectId === projectId && item.taskId === taskId) {
        const queuedAtMs = timestampMs(item.queuedAt) || Date.now();
        return {
          state: "queued",
          item,
          startedAtMs: queuedAtMs,
          lastActiveAtMs: queuedAtMs,
        };
      }
    }
    return null;
  }

  hasAnalysisRunForTask(projectId, taskId = null) {
    const matches = (item) => {
      if (!item || item.projectId !== projectId) return false;
      return !taskId || item.taskId === taskId;
    };
    return this.activeAnalysisItems().some(matches) || (this.host.analysisQueue || []).some(matches);
  }

  taskRuntimeSnapshot(projectId, taskId) {
    const activeRun = this.activeRunForTaskSnapshot(projectId, taskId);
    const analysisRun = this.analysisRunForTaskSnapshot(projectId, taskId);
    if (analysisRun) {
      return {
        is_active: analysisRun.state === "running",
        active_run_id: analysisRun.item.runId || null,
        queue_depth: analysisRun.state === "queued" ? 1 : 0,
        run_started_at: analysisRun.state === "running"
          ? timestampSeconds(analysisRun.startedAtMs, nowSeconds())
          : null,
        last_active: timestampSeconds(analysisRun.lastActiveAtMs, nowSeconds()),
        current_stage: analysisRun.item.currentTaskId || null,
      };
    }
    const queueDepth = this.host.queueDepth(projectId, taskId);
    const lastActiveMs = activeRun ? Number(activeRun.lastActiveAtMs || activeRun.startedAtMs || 0) : 0;
    return {
      is_active: Boolean(activeRun),
      active_run_id: activeRun?.runId || null,
      queue_depth: queueDepth,
      run_started_at: activeRun
        ? timestampSeconds(activeRun.startedAtMs || activeRun.startedAt, nowSeconds())
        : null,
      last_active: activeRun && lastActiveMs ? timestampSeconds(lastActiveMs, nowSeconds()) : null,
      current_stage: activeRun?.currentStage || null,
    };
  }

  taskCompletionStatus(project, task, runtime) {
    if (runtime?.is_active) return "running";
    if (Number(runtime?.queue_depth || 0) > 0) return "queued";

    const { messages } = this.host.loadMessagesFile(task.messagesPath, {
      projectId: project.id,
      taskId: task.id,
    });
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index] || {};
      const { combined, event, eventType } = mergeMetadata(message);
      const role = String(message.role || "").toLowerCase();

      if (eventType === "done") {
        const status = doneRuntimeStatus(combined);
        if (previousRunMessagesIndicateStreamRecovery(messages, index)) return "interrupted";
        return status === "failed" && previousRunMessagesIndicateInterruption(messages, index)
          ? "interrupted"
          : status;
      }

      if (eventType === "error") {
        const text = [
          message.content,
          event.message,
          combined.message,
          combined.reason,
        ].filter(Boolean).join(" ");
        return isInterruptionText(text)
          ? "interrupted"
          : "failed";
      }

      if (eventType === "assistant_message" || role === "assistant") {
        return "completed";
      }

      if (role === "user") {
        return "idle";
      }
    }

    return "idle";
  }

  decorateTaskRuntime(project, task) {
    const runtime = this.taskRuntimeSnapshot(project.id, task.id);
    return {
      ...task,
      ...runtime,
      runtime_status: this.taskCompletionStatus(project, task, runtime),
    };
  }

  decorateProjectRuntime(project) {
    return {
      ...project,
      tasks: (project.tasks || []).map((task) => this.decorateTaskRuntime(project, task)),
    };
  }

  activeRunUsage(run) {
    if (!run) return emptyUsage();
    return {
      inputTokens: toInt(run.inputTokens) || toInt(run.contextTokens),
      outputTokens: toInt(run.outputTokens) || toInt(run.outputEstimateTokens),
      cacheReadTokens: toInt(run.cacheReadTokens),
      cacheWriteTokens: toInt(run.cacheWriteTokens),
      reasoningTokens: toInt(run.reasoningTokens),
      apiCalls: toInt(run.apiCalls),
      estimatedCostUsd: toNumber(run.estimatedCostUsd),
    };
  }

  usageForMessages(messages, activeRun = null) {
    const byRun = new Map();
    const ensure = (runId) => {
      const key = String(runId || "stored");
      if (!byRun.has(key)) {
        byRun.set(key, {
          done: emptyUsage(),
          fallback: emptyUsage(),
          hasDoneUsage: false,
          hasFallbackUsage: false,
        });
      }
      return byRun.get(key);
    };

    for (const message of messages || []) {
      const { combined, eventType } = mergeMetadata(message);
      const runId = combined.runId || combined.guidedRunId || "stored";
      const usage = usageFromMetadata(combined);
      const entry = ensure(runId);
      if (eventType === "done") {
        addUsage(entry.done, usage);
        entry.hasDoneUsage = entry.hasDoneUsage || hasUsage(usage);
      } else if (eventType === "assistant_message" || message.role === "assistant") {
        addUsage(entry.fallback, usage);
        entry.hasFallbackUsage = entry.hasFallbackUsage || hasUsage(usage);
      }
    }

    const total = emptyUsage();
    for (const entry of byRun.values()) {
      if (entry.hasDoneUsage) {
        addUsage(total, entry.done);
      } else if (entry.hasFallbackUsage) {
        addUsage(total, entry.fallback);
      }
    }
    if (activeRun) {
      addUsage(total, this.activeRunUsage(activeRun));
    }
    return total;
  }

  toolCountForMessages(messages) {
    return (messages || []).filter((message) => {
      const { eventType } = mergeMetadata(message);
      return eventType === "tool_start" || eventType === "command_start";
    }).length;
  }

  latestContent(messages, roles) {
    const wanted = new Set(roles);
    for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (wanted.has(message.role) && String(message.content || "").trim()) {
        return compact(message.content, 180);
      }
    }
    return null;
  }

  sessionRecordForTask(project, task) {
    const { messages } = this.host.loadMessagesFile(task.messagesPath, {
      projectId: project.id,
      taskId: task.id,
    });
    const activeRun = this.activeRunForTaskSnapshot(project.id, task.id);
    const queueDepth = this.host.queueDepth(project.id, task.id);
    const firstMessage = messages[0] || null;
    const lastMessage = messages[messages.length - 1] || null;
    const { eventType: lastEventType } = mergeMetadata(lastMessage || {});
    const created = timestampSeconds(firstMessage?.createdAt, task.created_at || project.created_at || nowSeconds());
    const lastStored = timestampSeconds(lastMessage?.createdAt, task.updated_at || project.updated_at || created);
    const lastActive = activeRun
      ? timestampSeconds(activeRun.lastActiveAtMs || activeRun.startedAtMs, lastStored)
      : lastStored;
    const usage = this.usageForMessages(messages, activeRun);
    const messageCount = messages.filter((message) =>
      ["user", "assistant", "system", "tool"].includes(message.role),
    ).length;
    const model = [task.model_provider, task.model].filter(Boolean).join("/") || null;
    return {
      id: this.desktopSessionId(project, task),
      source: "redou-desktop",
      model,
      title: `${project.name || "Project"} / ${task.title || "Task"}`,
      started_at: created,
      ended_at: activeRun ? null : lastActive,
      last_active: lastActive,
      is_active: Boolean(activeRun),
      message_count: messageCount,
      tool_call_count: this.toolCountForMessages(messages),
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      preview:
        (activeRun ? "Hermes local runtime is running." : null) ||
        (queueDepth > 0 ? `${queueDepth} queued message${queueDepth === 1 ? "" : "s"}.` : null) ||
        this.latestContent(messages, ["assistant", "user"]) ||
        null,
      parent_session_id: task.hermesSessionId || null,
      projectId: project.id,
      taskId: task.id,
      queue_depth: queueDepth,
      last_event_type: lastEventType || null,
      run_started_at: activeRun
        ? timestampSeconds(activeRun.startedAtMs || activeRun.startedAt, lastActive)
        : null,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
      reasoning_tokens: usage.reasoningTokens,
      api_calls: usage.apiCalls,
      estimated_cost: usage.estimatedCostUsd,
    };
  }

  desktopSessionRecords() {
    this.host.ensureInitialized();
    const records = [];
    for (const project of this.host.readAllProjects()) {
      for (const task of project.tasks || []) {
        const record = this.sessionRecordForTask(project, task);
        if (
          record.is_active ||
          record.queue_depth > 0 ||
          record.message_count > 0 ||
          record.tool_call_count > 0 ||
          record.preview
        ) {
          records.push(record);
        }
      }
    }
    return records.sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return Number(b.last_active || 0) - Number(a.last_active || 0);
    });
  }

  getSessions(limit = 20, offset = 0) {
    const safeLimit = Math.max(1, Math.min(100, toInt(limit) || 20));
    const safeOffset = Math.max(0, toInt(offset));
    const records = this.desktopSessionRecords();
    const sessions = records.slice(safeOffset, safeOffset + safeLimit).map((record) => ({
      id: record.id,
      source: record.source,
      model: record.model,
      title: record.title,
      started_at: record.started_at,
      ended_at: record.ended_at,
      last_active: record.last_active,
      is_active: record.is_active,
      message_count: record.message_count,
      tool_call_count: record.tool_call_count,
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      preview: record.preview,
      parent_session_id: record.parent_session_id,
      projectId: record.projectId,
      taskId: record.taskId,
      queue_depth: record.queue_depth,
      last_event_type: record.last_event_type,
      run_started_at: record.run_started_at,
      api_calls: record.api_calls,
    }));
    return {
      sessions,
      total: records.length,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  dashboardMessageFromTaskMessage(message) {
    const createdAt = timestampSeconds(message.createdAt);
    const { event, eventType } = mergeMetadata(message);
    if (["user", "assistant", "system", "tool"].includes(message.role)) {
      return {
        role: message.role,
        content: message.content || null,
        timestamp: createdAt,
      };
    }
    if (eventType === "tool_start") {
      return {
        role: "assistant",
        content: null,
        timestamp: createdAt,
        tool_calls: [
          {
            id: String(event.id || event.metadata?.toolCallId || crypto.randomUUID()),
            function: {
              name: String(event.name || "tool"),
              arguments: JSON.stringify(event.input || {}),
            },
          },
        ],
      };
    }
    if (eventType === "command_start") {
      return {
        role: "assistant",
        content: null,
        timestamp: createdAt,
        tool_calls: [
          {
            id: String(event.id || event.metadata?.toolCallId || crypto.randomUUID()),
            function: {
              name: "terminal",
              arguments: JSON.stringify({
                command: event.command || "",
                cwd: event.cwd || "",
              }),
            },
          },
        ],
      };
    }
    if (eventType === "tool_output" || eventType === "command_output") {
      return {
        role: "tool",
        content: message.content || null,
        timestamp: createdAt,
        tool_name: String(event.name || event.metadata?.command || "tool"),
        tool_call_id: String(event.id || event.metadata?.toolCallId || ""),
      };
    }
    return {
      role: "system",
      content: message.content || null,
      timestamp: createdAt,
    };
  }

  getSessionMessages(sessionId) {
    const { project, task } = this.findTaskByDesktopSessionId(sessionId);
    if (!project || !task) {
      return { session_id: String(sessionId || ""), messages: [] };
    }
    const { messages } = this.host.loadMessagesFile(task.messagesPath, {
      projectId: project.id,
      taskId: task.id,
    });
    return {
      session_id: this.desktopSessionId(project, task),
      messages: messages.map((message) => this.dashboardMessageFromTaskMessage(message)),
    };
  }

  getUsageAnalytics(days = 7) {
    const safeDays = Math.max(1, Math.min(90, toInt(days) || 7));
    const now = new Date();
    const daily = [];
    const dailyMap = new Map();
    for (let index = safeDays - 1; index >= 0; index -= 1) {
      const date = new Date(now);
      date.setUTCDate(now.getUTCDate() - index);
      const day = date.toISOString().slice(0, 10);
      const entry = {
        day,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        reasoning_tokens: 0,
        estimated_cost: 0,
        actual_cost: 0,
        sessions: 0,
        api_calls: 0,
        tool_calls: 0,
      };
      daily.push(entry);
      dailyMap.set(day, entry);
    }

    const cutoffSeconds = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - safeDays + 1,
      0,
      0,
      0,
    ) / 1000;
    const byModel = new Map();
    const totals = {
      total_input: 0,
      total_output: 0,
      total_cache_read: 0,
      total_reasoning: 0,
      total_estimated_cost: 0,
      total_actual_cost: 0,
      total_sessions: 0,
      total_api_calls: 0,
      total_tool_calls: 0,
    };

    for (const session of this.desktopSessionRecords()) {
      if (Number(session.last_active || 0) < cutoffSeconds) continue;
      const day = dateKeyFromSeconds(session.last_active);
      const dailyEntry = dailyMap.get(day);
      if (dailyEntry) {
        dailyEntry.input_tokens += toInt(session.input_tokens);
        dailyEntry.output_tokens += toInt(session.output_tokens);
        dailyEntry.cache_read_tokens += toInt(session.cache_read_tokens);
        dailyEntry.reasoning_tokens += toInt(session.reasoning_tokens);
        dailyEntry.estimated_cost += toNumber(session.estimated_cost);
        dailyEntry.sessions += 1;
        dailyEntry.api_calls += toInt(session.api_calls);
        dailyEntry.tool_calls += toInt(session.tool_call_count);
      }

      const modelKey = session.model || "redou-desktop/default";
      if (!byModel.has(modelKey)) {
        byModel.set(modelKey, {
          model: modelKey,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost: 0,
          actual_cost: 0,
          sessions: 0,
          api_calls: 0,
        });
      }
      const modelEntry = byModel.get(modelKey);
      modelEntry.input_tokens += toInt(session.input_tokens);
      modelEntry.output_tokens += toInt(session.output_tokens);
      modelEntry.estimated_cost += toNumber(session.estimated_cost);
      modelEntry.sessions += 1;
      modelEntry.api_calls += toInt(session.api_calls);

      totals.total_input += toInt(session.input_tokens);
      totals.total_output += toInt(session.output_tokens);
      totals.total_cache_read += toInt(session.cache_read_tokens);
      totals.total_reasoning += toInt(session.reasoning_tokens);
      totals.total_estimated_cost += toNumber(session.estimated_cost);
      totals.total_sessions += 1;
      totals.total_api_calls += toInt(session.api_calls);
      totals.total_tool_calls += toInt(session.tool_call_count);
    }

    return {
      daily,
      by_model: Array.from(byModel.values()).sort(
        (a, b) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens),
      ),
      totals,
      skills: {
        summary: {
          total_skill_loads: 0,
          total_skill_edits: 0,
          total_skill_actions: 0,
          distinct_skills_used: 0,
        },
        top_skills: [],
      },
    };
  }

  analysisTotals(tasks) {
    return {
      durationMs: tasks.reduce((sum, task) => sum + toInt(task.durationMs), 0),
      inputTokens: tasks.reduce((sum, task) => sum + toInt(task.inputTokens), 0),
      outputTokens: tasks.reduce((sum, task) => sum + toInt(task.outputTokens), 0),
      cacheReadTokens: tasks.reduce((sum, task) => sum + toInt(task.cacheReadTokens), 0),
      reasoningTokens: tasks.reduce((sum, task) => sum + toInt(task.reasoningTokens), 0),
      apiCalls: tasks.reduce((sum, task) => sum + toInt(task.apiCalls), 0),
      estimatedCostUsd: tasks.reduce((sum, task) => sum + Number(task.estimatedCostUsd || 0), 0),
    };
  }

  analysisAbilityScores(tasks) {
    const byTask = Object.fromEntries(tasks.map((task) => [task.id, task]));
    const section = (taskId, sectionId) => {
      const found = byTask[taskId]?.sections?.find((item) => item.id === sectionId);
      return found ? clampScore(found.score) : 0;
    };
    const score = (taskId) => clampScore(byTask[taskId]?.score);
    const weightedScore = (items) => clampScore(
      items.reduce((sum, item) => sum + clampScore(item.score) * item.weight, 0) /
        Math.max(1, items.reduce((sum, item) => sum + item.weight, 0)),
    );
    return {
      environmentConstraints: weightedScore([
        { score: score("task1"), weight: 0.45 },
        { score: section("task2", "container_execution"), weight: 0.08 },
        { score: section("task3", "container_execution"), weight: 0.08 },
        { score: section("task4", "container_check"), weight: 0.07 },
        { score: section("task5", "container_execution"), weight: 0.08 },
        { score: section("task6", "container_execution"), weight: 0.08 },
        { score: section("task7", "container_execution"), weight: 0.06 },
        { score: section("task8", "container_execution"), weight: 0.06 },
        { score: section("task9", "container_execution"), weight: 0.04 },
      ]),
      projectDelivery: weightedScore([
        { score: score("task2"), weight: 0.45 },
        { score: section("task6", "automated_tests"), weight: 0.2 },
        { score: section("task7", "automated_tests"), weight: 0.15 },
        { score: section("task9", "automated_tests"), weight: 0.15 },
        { score: section("task2", "verification"), weight: 0.05 },
      ]),
      debugRepair: weightedScore([
        { score: score("task3"), weight: 0.25 },
        { score: section("task3", "bug_loop"), weight: 0.15 },
        { score: section("task5", "automated_tests"), weight: 0.3 },
        { score: section("task8", "automated_tests"), weight: 0.3 },
      ]),
      frameworkExtension: weightedScore([
        { score: section("task2", "features"), weight: 0.2 },
        { score: section("task6", "automated_tests"), weight: 0.4 },
        { score: section("task9", "automated_tests"), weight: 0.4 },
      ]),
      parsingEdgeCases: weightedScore([
        { score: section("task7", "automated_tests"), weight: 0.45 },
        { score: section("task8", "automated_tests"), weight: 0.35 },
        { score: section("task3", "function_coverage"), weight: 0.2 },
      ]),
      verificationIteration: clampScore(averageScore([
        { score: section("task1", "environment_verification") },
        { score: section("task2", "verification") },
        { score: section("task3", "bug_loop") },
        { score: section("task4", "container_check") },
        { score: section("task5", "official_submission") },
        { score: section("task6", "official_submission") },
        { score: section("task7", "official_submission") },
        { score: section("task8", "official_submission") },
        { score: section("task9", "official_submission") },
      ])),
      researchProduct: weightedScore([
        { score: score("task4"), weight: 0.55 },
        { score: section("task4", "sources"), weight: 0.15 },
        { score: section("task4", "comparison"), weight: 0.15 },
        { score: section("task4", "product_plan"), weight: 0.15 },
      ]),
      documentationReproducibility: clampScore(averageScore([
        { score: section("task1", "documentation") },
        { score: section("task2", "report") },
        { score: section("task3", "log_report") },
        { score: section("task4", "report_saved") },
        { score: section("task5", "report") },
        { score: section("task6", "report") },
        { score: section("task7", "report") },
        { score: section("task8", "report") },
        { score: section("task9", "report") },
      ])),
    };
  }

  normalizeAnalysisAbilityScores(rawScores, derivedScores = null) {
    const scores = {};
    for (const key of this.analysisAbilityKeys()) {
      const value = rawScores?.[key];
      scores[key] = value === undefined && derivedScores
        ? clampScore(derivedScores[key])
        : clampScore(value);
    }
    return scores;
  }

  withLiveAnalysisTiming(result, nowMs = Date.now()) {
    const hasLiveTask = result.tasks.some((task) => isLiveAnalysisStatus(task.status));
    if (!isLiveAnalysisStatus(result.status) && !hasLiveTask) {
      return result;
    }

    let taskDurationIsLive = false;
    const tasks = result.tasks.map((task) => {
      if (!isLiveAnalysisStatus(task.status) || !task.startedAt) {
        return task;
      }
      const durationMs = Math.max(toInt(task.durationMs), elapsedMsSince(task.startedAt, nowMs));
      if (durationMs <= toInt(task.durationMs)) {
        return task;
      }
      taskDurationIsLive = true;
      return { ...task, durationMs };
    });
    const totals = this.analysisTotals(tasks);
    if (!taskDurationIsLive && isLiveAnalysisStatus(result.status) && result.startedAt) {
      totals.durationMs = Math.max(totals.durationMs, elapsedMsSince(result.startedAt, nowMs));
    }
    return {
      ...result,
      tasks,
      totals,
    };
  }

  buildAnalysisBenchmarksSnapshot(store, options = {}) {
    const activeAnalysisRuns = Array.isArray(options.activeAnalysisRuns)
      ? options.activeAnalysisRuns
      : this.activeAnalysisItems();
    const analysisQueue = Array.isArray(options.analysisQueue)
      ? options.analysisQueue
      : (this.host.analysisQueue || []);
    const primaryActiveRun = activeAnalysisRuns[0] || null;
    const activeRunIds = new Set([
      ...activeAnalysisRuns.map((item) => item.runId).filter(Boolean),
      ...analysisQueue.map((item) => item.runId).filter(Boolean),
    ]);
    let changed = false;
    const results = store.results.map((result) => {
      if (result.status === "running" || result.status === "queued") {
        if (!activeRunIds.has(result.runId)) {
          changed = true;
          return {
            ...result,
            status: "interrupted",
            summary: result.summary || "This benchmark was interrupted before completion.",
          };
        }
      }
      return result;
    });
    return {
      changed,
      results,
      response: {
        version: 1,
        tasks: this.analysisTasks(),
        results: results.map((result) => this.withLiveAnalysisTiming(result)),
        activeRunId: primaryActiveRun?.runId || null,
        activeRunIds: activeAnalysisRuns.map((item) => item.runId).filter(Boolean),
        queueDepth: analysisQueue.length,
      },
    };
  }

  getAnalysisBenchmarks() {
    return this.buildAnalysisBenchmarksSnapshot(this.host.readAnalysisStore()).response;
  }
}

module.exports = {
  AnalyticsService,
};
