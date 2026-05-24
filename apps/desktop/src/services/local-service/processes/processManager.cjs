const { spawn, spawnSync } = require("child_process");
const { REDOU_EVENTS } = require("../eventBus.cjs");

function appendLimited(current, chunk, maxChars) {
  const next = current + chunk.toString();
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function terminateProcessTree(child, { force = true } = {}) {
  if (!child || child.killed) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32" && pid) {
      const args = ["/PID", String(pid), "/T"];
      if (force) args.push("/F");
      const result = spawnSync("taskkill", args, {
        windowsHide: true,
        stdio: "ignore",
      });
      if (result.status === 0) return;
    } else if (pid) {
      spawnSync("pkill", [force ? "-KILL" : "-TERM", "-P", String(pid)], {
        stdio: "ignore",
      });
    }
  } catch {
    // Fall through to child.kill below.
  }
  try {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  } catch {
    // Best effort.
  }
}

function isRunLogicallyActive(run) {
  return Boolean(run) && !run.completedAtMs && !run.completedAt && !run.terminalAtMs;
}

class ProcessManager {
  constructor({ activeRuns = new Map(), eventBus = null, log = null } = {}) {
    this.activeRuns = activeRuns;
    this.eventBus = eventBus;
    this.log = typeof log === "function" ? log : () => {};
  }

  spawn(command, args = [], options = {}) {
    return spawn(command, args, options);
  }

  spawnSync(command, args = [], options = {}) {
    return spawnSync(command, args, options);
  }

  terminate(child, options = {}) {
    terminateProcessTree(child, options);
  }

  terminateAll(children, options = {}) {
    for (const child of children || []) {
      terminateProcessTree(child, options);
    }
  }

  registerRun(runId, runRecord) {
    this.activeRuns.set(runId, runRecord);
    return runRecord;
  }

  deleteRun(runId) {
    return this.activeRuns.delete(runId);
  }

  activeRunForTask(projectId, taskId) {
    for (const [runId, run] of this.activeRuns.entries()) {
      if (!isRunLogicallyActive(run)) continue;
      if (run.projectId === projectId && run.taskId === taskId) {
        return { runId, ...run };
      }
    }
    return null;
  }

  runBufferedCommand({
    command,
    args = [],
    cwd,
    env,
    timeoutMs = 600000,
    shutdown = false,
    shutdownResult = { code: null, signal: "shutdown", error: "Redou Agent is closing.", output: "" },
    trackingSet = null,
    maxBufferChars = 200000,
    spawnOptions = {},
  }) {
    return new Promise((resolve) => {
      if (shutdown) {
        resolve(shutdownResult);
        return;
      }

      const startedAtMs = Date.now();
      const child = this.spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...spawnOptions,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer = null;

      trackingSet?.add(child);
      const finish = (result) => {
        if (settled) return;
        settled = true;
        trackingSet?.delete(child);
        if (timer) clearTimeout(timer);
        resolve({
          ...result,
          stdout,
          stderr,
          output: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim(),
          durationMs: Math.max(0, Date.now() - startedAtMs),
        });
      };

      timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignored
        }
        finish({ code: null, signal: "timeout", error: `Command timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout = appendLimited(stdout, chunk, maxBufferChars);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendLimited(stderr, chunk, maxBufferChars);
      });
      child.on("error", (error) => {
        finish({ code: null, signal: null, error: error.message });
      });
      child.on("exit", (code, signal) => {
        finish({ code, signal, error: code === 0 ? "" : `Command exited with code ${code}` });
      });
    });
  }

  startJsonLineProcess({
    command,
    args = [],
    options = {},
    input = null,
    onStarted = null,
    onStdoutEvent = null,
    onStderrLine = null,
    onError = null,
    onExit = null,
  }) {
    const child = this.spawn(command, args, options);
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const emitStdoutLine = (line) => {
      if (!line.trim()) return;
      try {
        onStdoutEvent?.(JSON.parse(line), line);
      } catch {
        onStdoutEvent?.({ type: "raw_log", content: line }, line);
      }
    };

    const flushStdout = (final = false) => {
      if (final) {
        const line = stdoutBuffer.trim();
        stdoutBuffer = "";
        if (line) emitStdoutLine(line);
        return;
      }
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        emitStdoutLine(line);
      }
    };

    const emitStderrLine = (line) => {
      if (!line.trim()) return;
      onStderrLine?.(line);
    };

    const flushStderr = (final = false) => {
      if (final) {
        const line = stderrBuffer.trim();
        stderrBuffer = "";
        if (line) emitStderrLine(line);
        return;
      }
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        emitStderrLine(line);
      }
    };

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      flushStdout();
    });
    child.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      flushStderr();
    });
    child.on("error", (error) => {
      onError?.(error);
    });
    child.on("exit", (code, signal) => {
      flushStdout(true);
      flushStderr(true);
      onExit?.({ code, signal, child });
    });

    onStarted?.(child);
    if (input !== null && input !== undefined && child.stdin) {
      const payload = typeof input === "string" ? input : `${JSON.stringify(input)}\n`;
      child.stdin.write(payload, "utf8");
    }
    return child;
  }

  writeRunControl(run, command) {
    if (!run?.child?.stdin || run.child.stdin.destroyed || run.child.killed) {
      throw new Error("Active Hermes runtime is not accepting guidance.");
    }
    run.child.stdin.write(`${JSON.stringify(command)}\n`, "utf8");
  }

  stopRun(runId, { webContents = null, emitToRenderer, persistEvent } = {}) {
    const run = this.activeRuns.get(runId);
    if (!run) return { ok: false, message: "Run not found" };
    try {
      run.stopRequested = true;
      terminateProcessTree(run.child, { force: true });
    } catch {
      // Best effort.
    }
    const event = {
      type: "error",
      message: "Run stopped by user.",
      metadata: { runId, projectId: run.projectId, taskId: run.taskId },
    };
    if (typeof emitToRenderer === "function") {
      emitToRenderer(webContents, {
        runId,
        projectId: run.projectId,
        taskId: run.taskId,
        event,
      });
    }
    if (typeof persistEvent === "function") {
      persistEvent(run.projectId, run.taskId, event);
    }
    if (typeof this.eventBus?.publishRunStopped === "function") {
      this.eventBus.publishRunStopped({ runId, projectId: run.projectId, taskId: run.taskId });
    } else {
      this.eventBus?.emit?.(REDOU_EVENTS.RUN_STOPPED, { runId, projectId: run.projectId, taskId: run.taskId });
    }
    return { ok: true };
  }
}

module.exports = {
  ProcessManager,
  isRunLogicallyActive,
  terminateProcessTree,
};
