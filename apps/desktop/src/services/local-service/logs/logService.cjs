const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// LogService owns two related surfaces:
// - UI log text reads from Redou/Hermes log files such as agent.log.
// - Task JSONL journals, including messages.jsonl and events.jsonl persistence.
// It must not change message/event JSON shape, event types, or metadata semantics.

const LOG_FILES = {
  redou: { kind: "redou", name: "desktop-main.log" },
  agent: { kind: "hermes", name: "agent.log" },
  errors: { kind: "hermes", name: "errors.log" },
};

const LOG_LEVEL_ORDER = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 };
const LOG_COMPONENT_PREFIXES = {
  gateway: ["gateway"],
  agent: ["agent", "run_agent", "model_tools", "batch_runner"],
  tools: ["tools"],
  cli: ["hermes_cli", "cli"],
  cron: ["cron"],
};
const LOG_LEVEL_RE = /\s(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/;
const LOG_LOGGER_NAME_RE = /\s(?:DEBUG|INFO|WARNING|ERROR|CRITICAL)(?:\s+\[.*?\])?\s+(\S+):/;

function clampLogLineCount(value) {
  const n = Number(value || 100);
  if (!Number.isFinite(n)) return 100;
  return Math.min(500, Math.max(1, Math.round(n)));
}

function extractLogLevel(line) {
  const match = String(line || "").match(LOG_LEVEL_RE);
  return match ? match[1] : null;
}

function extractLogLoggerName(line) {
  const match = String(line || "").match(LOG_LOGGER_NAME_RE);
  return match ? match[1] : null;
}

function logLineMatchesFilters(line, { minLevel = null, componentPrefixes = null } = {}) {
  if (minLevel) {
    const level = extractLogLevel(line);
    if (level && LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minLevel]) {
      return false;
    }
  }
  if (componentPrefixes) {
    const loggerName = extractLogLoggerName(line);
    if (!loggerName || !componentPrefixes.some((prefix) => loggerName.startsWith(prefix))) {
      return false;
    }
  }
  return true;
}

function splitLogLines(text, { dropFirst = false } = {}) {
  const lines = String(text || "").split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (dropFirst && lines.length) lines.shift();
  return lines;
}

function readLastLogLines(file, count, readText) {
  const n = Math.max(1, Number(count || 1));
  try {
    const stat = fs.statSync(file);
    if (!stat.size) return [];
    if (stat.size <= 1_048_576) {
      return splitLogLines(fs.readFileSync(file, "utf8")).slice(-n);
    }

    const fd = fs.openSync(file, "r");
    try {
      const chunks = [];
      let position = stat.size;
      let chunkSize = 8192;
      let newlineCount = 0;
      while (position > 0 && newlineCount <= n) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;
        const buffer = Buffer.allocUnsafe(readSize);
        fs.readSync(fd, buffer, 0, readSize, position);
        chunks.unshift(buffer);
        for (let i = 0; i < buffer.length; i += 1) {
          if (buffer[i] === 10) newlineCount += 1;
        }
        chunkSize = Math.min(chunkSize * 2, 65536);
      }
      return splitLogLines(Buffer.concat(chunks).toString("utf8"), { dropFirst: position > 0 }).slice(-n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return splitLogLines(readText(file)).slice(-n);
  }
}

function parseEventsJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

class LogService {
  constructor({ repos, paths = {}, helpers = {}, logger = null } = {}) {
    if (!repos?.logs) {
      throw new Error("LogService requires a log repository.");
    }
    if (typeof helpers.findProjectAndTask !== "function") {
      throw new Error("LogService requires findProjectAndTask helper.");
    }
    this.repos = repos;
    this.paths = paths;
    this.helpers = helpers;
    this.log = typeof logger === "function" ? logger : () => {};
  }

  helper(name, fallback = null) {
    const value = this.helpers[name];
    return typeof value === "function" ? value : fallback;
  }

  hermesHome() {
    return typeof this.paths.hermesHome === "function" ? this.paths.hermesHome() : this.paths.hermesHome || "";
  }

  redouLogPath() {
    return typeof this.paths.redouLogPath === "function" ? this.paths.redouLogPath() : this.paths.redouLogPath || "";
  }

  isoNow() {
    const isoNow = this.helper("isoNow");
    return isoNow ? isoNow() : new Date().toISOString();
  }

  redact(value) {
    const redact = this.helper("redact");
    return redact ? redact(value) : String(value || "");
  }

  normalizeUserInputStatus(value, fallback) {
    const normalizeUserInputStatus = this.helper("normalizeUserInputStatus");
    return normalizeUserInputStatus ? normalizeUserInputStatus(value, fallback) : String(value || fallback || "pending");
  }

  taskEventsPathFromContextPath(contextPath) {
    const taskEventsPathFromContextPath = this.helper("taskEventsPathFromContextPath");
    return taskEventsPathFromContextPath ? taskEventsPathFromContextPath(contextPath) : "";
  }

  validMessageRoles() {
    const roles = this.helpers.validMessageRoles;
    return roles instanceof Set ? roles : new Set(["user", "assistant", "system", "tool", "event"]);
  }

  getLogs(params = {}) {
    const fileKey = String(params?.file || "agent").toLowerCase();
    const logFile = LOG_FILES[fileKey];
    if (!logFile) {
      throw new Error(`Unknown log file: ${fileKey}`);
    }

    const lineCount = clampLogLineCount(params?.lines);
    const rawLevel = String(params?.level || "").toUpperCase();
    const minLevel = rawLevel && rawLevel !== "ALL" ? rawLevel : null;
    if (minLevel && !(minLevel in LOG_LEVEL_ORDER)) {
      throw new Error(`Unknown log level: ${rawLevel}`);
    }

    const rawComponent = String(params?.component || "").toLowerCase();
    let componentPrefixes = null;
    if (rawComponent && rawComponent !== "all") {
      componentPrefixes = LOG_COMPONENT_PREFIXES[rawComponent];
      if (!componentPrefixes) {
        throw new Error(`Unknown log component: ${rawComponent}`);
      }
    }

    const search = String(params?.search || "").toLowerCase();
    const hasFilters = Boolean(minLevel || componentPrefixes || search);
    const rawLimit = hasFilters ? Math.max(lineCount * 20, 2000) : lineCount;
    const logPath = logFile.kind === "redou"
      ? this.redouLogPath()
      : path.join(this.hermesHome(), "logs", logFile.name);
    if (!logPath) {
      return { file: fileKey, lines: [] };
    }
    if (!fs.existsSync(logPath)) {
      return { file: fileKey, lines: [] };
    }

    let lines = readLastLogLines(logPath, Math.min(rawLimit, 10000), (file) => this.repos.logs.readText(file));
    if (minLevel || componentPrefixes) {
      lines = lines.filter((line) => logLineMatchesFilters(line, { minLevel, componentPrefixes }));
    }
    if (search) {
      lines = lines.filter((line) => line.toLowerCase().includes(search));
    }
    return { file: fileKey, lines: lines.slice(-lineCount) };
  }

  loadMessagesFile(file, context = {}) {
    const messages = [];
    const warnings = [];
    if (!file || !fs.existsSync(file)) return { messages, warnings };
    const lines = this.repos.logs.readText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        const role = String(parsed.role || "").toLowerCase();
        if (!this.validMessageRoles().has(role)) {
          warnings.push(`Line ${index + 1}: unsupported role "${role}"`);
          return;
        }
        messages.push({
          role,
          content: String(parsed.content || ""),
          createdAt: parsed.createdAt || parsed.created_at || this.isoNow(),
          metadata: parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {},
          attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
        });
      } catch (error) {
        warnings.push(`Line ${index + 1}: ${error.message}`);
      }
    });
    if (warnings.length > 0) {
      this.log(`redou messages warning projectId=${context.projectId || ""} taskId=${context.taskId || ""} messagesPath=${this.redact(file)} warnings=${warnings.length}`);
    }
    return { messages, warnings };
  }

  appendTaskMessage(projectId, taskId, role, content, metadata = {}, attachments = []) {
    const { project, task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");
    const roleName = this.validMessageRoles().has(String(role).toLowerCase())
      ? String(role).toLowerCase()
      : "event";
    const payload = {
      role: roleName,
      content: String(content || ""),
      createdAt: this.isoNow(),
      metadata: {
        projectId,
        taskId,
        ...(task.hermesSessionId ? { hermesSessionId: task.hermesSessionId } : {}),
        ...(metadata && typeof metadata === "object" ? metadata : {}),
      },
      attachments: Array.isArray(attachments) ? attachments : [],
    };
    this.repos.logs.appendJsonLine(task.messagesPath, payload);
    this.appendTaskEventJsonl(task, payload);
    this.helper("updateChatTask")?.(projectId, taskId, {}, { activate: false });
    return payload;
  }

  appendTaskEventJsonl(task, event) {
    if (!task?.eventsPath) return null;
    const payload = {
      id: event.id || crypto.randomUUID(),
      createdAt: event.createdAt || this.isoNow(),
      ...event,
    };
    this.repos.logs.appendJsonLine(task.eventsPath, payload);
    return payload;
  }

  readTaskEvents(task) {
    const eventsPath = task?.eventsPath || this.taskEventsPathFromContextPath(task?.contextPath || "");
    return parseEventsJsonl(this.repos.logs.readText(eventsPath));
  }

  updateUserInputEnvelopeStatus(projectId, taskId, envelopeId, patch = {}) {
    const id = String(envelopeId || "").trim();
    if (!id) return false;
    const { task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!task || !fs.existsSync(task.messagesPath)) return false;

    let changed = false;
    const lines = this.repos.logs.readText(task.messagesPath).split(/\r?\n/);
    const nextLines = lines.map((line) => {
      if (!line.trim()) return line;
      try {
        const parsed = JSON.parse(line);
        const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
        const envelope = metadata.inputEnvelope && typeof metadata.inputEnvelope === "object"
          ? metadata.inputEnvelope
          : null;
        if (!envelope || String(envelope.id || "") !== id) return line;
        parsed.metadata = {
          ...metadata,
          inputEnvelope: {
            ...envelope,
            ...(patch && typeof patch === "object" ? patch : {}),
            status: this.normalizeUserInputStatus(patch.status || envelope.status, envelope.status || "pending"),
          },
        };
        changed = true;
        return JSON.stringify(parsed);
      } catch {
        return line;
      }
    });
    if (changed) {
      this.repos.logs.writeText(
        task.messagesPath,
        `${nextLines.filter((line, index) => line.trim() || index < nextLines.length - 1).join("\n").replace(/\n*$/, "")}\n`,
      );
    }
    return changed;
  }

  removeQueuedUserInputMessage(projectId, taskId, queueId) {
    const id = String(queueId || "").trim();
    if (!id) return false;
    const { task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!task || !fs.existsSync(task.messagesPath)) return false;

    let changed = false;
    const lines = this.repos.logs.readText(task.messagesPath).split(/\r?\n/);
    const nextLines = [];
    for (const line of lines) {
      if (!line.trim()) {
        nextLines.push(line);
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        const metadata = parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : {};
        const envelope = metadata.inputEnvelope && typeof metadata.inputEnvelope === "object"
          ? metadata.inputEnvelope
          : null;
        const matches =
          String(metadata.queueId || "") === id ||
          String(envelope?.id || "") === id;
        const isPending =
          !envelope ||
          this.normalizeUserInputStatus(envelope.status, "pending") === "pending";
        if (String(parsed.role || "").toLowerCase() === "user" && matches && isPending) {
          changed = true;
          continue;
        }
      } catch {
        // Keep malformed lines intact; the loader will surface warnings.
      }
      nextLines.push(line);
    }

    if (changed) {
      const text = nextLines
        .filter((line, index) => line.trim() || index < nextLines.length - 1)
        .join("\n")
        .replace(/\n*$/, "");
      this.repos.logs.writeText(task.messagesPath, text ? `${text}\n` : "");
    }
    return changed;
  }
}

module.exports = {
  LogService,
  parseEventsJsonl,
};
