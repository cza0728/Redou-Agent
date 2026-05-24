/**
 * Direct Agent - OpenAI-compatible Chat Completions agent loop
 *
 * Used for non-OpenAI providers (DeepSeek, Xiaomi MiMo, Qwen, etc.)
 * that support the standard OpenAI Chat Completions API with tool calling.
 * Codex CLI only works with OpenAI's proprietary protocol, so this module
 * provides a generic agent loop for all other providers.
 */

"use strict";

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync, spawn: spawnChild } = require("child_process");

// --- Tool definitions for the agent ---

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file at the given path. Returns the file content as a string.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative file path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write to" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command and return its output (stdout + stderr). Use this for running tests, installing packages, checking files, etc. Timeout: 120 seconds.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          cwd: { type: "string", description: "Working directory (optional, defaults to workspace root)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and directories at the given path. Returns names with trailing / for directories.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text pattern in files under a directory. Returns matching file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for" },
          directory: { type: "string", description: "Directory to search in (defaults to workspace root)" },
          file_glob: { type: "string", description: "Optional glob pattern to filter files (e.g. '*.py')" },
        },
        required: ["pattern"],
      },
    },
  },
];

// --- Tool execution ---

function executeTool(name, args, cwd) {
  try {
    switch (name) {
      case "read_file": {
        const filePath = path.resolve(cwd, args.path);
        if (!fs.existsSync(filePath)) return { error: `File not found: ${filePath}` };
        const stat = fs.statSync(filePath);
        if (stat.size > 512 * 1024) return { error: `File too large (${stat.size} bytes). Read a smaller file or use search.` };
        return { content: fs.readFileSync(filePath, "utf-8") };
      }
      case "write_file": {
        const filePath = path.resolve(cwd, args.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, args.content, "utf-8");
        return { success: true, path: filePath };
      }
      case "run_command": {
        const cmdCwd = args.cwd ? path.resolve(cwd, args.cwd) : cwd;
        try {
          const output = execSync(args.command, {
            cwd: cmdCwd,
            timeout: 120000,
            maxBuffer: 1024 * 1024,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: true,
          });
          return { stdout: output, exitCode: 0 };
        } catch (err) {
          return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: err.status ?? 1,
            error: err.message,
          };
        }
      }
      case "list_directory": {
        const dirPath = path.resolve(cwd, args.path || ".");
        if (!fs.existsSync(dirPath)) return { error: `Directory not found: ${dirPath}` };
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = entries.map((e) => e.isDirectory() ? e.name + "/" : e.name);
        return { entries: items };
      }
      case "search_files": {
        const dir = path.resolve(cwd, args.directory || ".");
        const pattern = args.pattern;
        let cmd;
        if (process.platform === "win32") {
          const glob = args.file_glob ? `--include="${args.file_glob}"` : "";
          cmd = `findstr /s /n /r /c:"${pattern.replace(/"/g, '\\"')}" "${dir}\\*"`;
          if (args.file_glob) {
            cmd = `findstr /s /n /r /c:"${pattern.replace(/"/g, '\\"')}" "${dir}\\${args.file_glob}"`;
          }
        } else {
          const glob = args.file_glob ? `--include="${args.file_glob}"` : "";
          cmd = `grep -rn ${glob} "${pattern}" "${dir}" 2>/dev/null | head -50`;
        }
        try {
          const output = execSync(cmd, { timeout: 30000, maxBuffer: 512 * 1024, encoding: "utf-8", windowsHide: true, shell: true });
          return { matches: output.trim().split("\n").slice(0, 50) };
        } catch {
          return { matches: [] };
        }
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// --- HTTP request helper ---

function chatCompletionRequest(baseUrl, apiKey, model, messages, tools, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, "") + "/chat/completions");
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const body = JSON.stringify({
      model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.2,
      stream: false,
    });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: options.requestTimeout || 300000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`API error ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.write(body);
    req.end();
  });
}

// --- Main agent loop ---

/**
 * Run the direct agent loop.
 * @param {object} opts
 * @param {string} opts.baseUrl - API base URL
 * @param {string} opts.apiKey - API key
 * @param {string} opts.model - Model name
 * @param {string} opts.systemPrompt - System instructions
 * @param {string} opts.userPrompt - User task description
 * @param {string} opts.cwd - Working directory
 * @param {number} opts.maxIterations - Max tool call iterations
 * @param {function} opts.emit - Function to emit Redou events
 * @param {function} opts.turnTiming - Function to get turn timing
 * @param {number} opts.requestTimeout - HTTP request timeout in ms
 */
async function runDirectAgent(opts) {
  const {
    baseUrl,
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    cwd,
    maxIterations = 30,
    emit,
    turnTiming,
    requestTimeout = 300000,
  } = opts;

  if (!apiKey) {
    emit({ type: "error", message: `No API key available for model ${model}. Check environment variables.` });
    emit({ type: "done", metadata: { ...turnTiming(), completed: false, failed: true, error: "Missing API key" } });
    return;
  }

  emit({
    type: "raw_log",
    content: `Direct agent: model=${model}, base_url=${baseUrl}, max_iterations=${maxIterations}`,
    metadata: { folded: true, stream: "agent_config" },
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let apiCalls = 0;
  let iteration = 0;

  emit({ type: "run_stage", stage: "understanding", status: "running", label: "understanding", details: "Analyzing task" });

  try {
    while (iteration < maxIterations) {
      iteration++;
      apiCalls++;

      const response = await chatCompletionRequest(baseUrl, apiKey, model, messages, TOOLS, { requestTimeout });

      // Track usage
      if (response.usage) {
        totalInputTokens += response.usage.prompt_tokens || 0;
        totalOutputTokens += response.usage.completion_tokens || 0;
      }

      const choice = response.choices?.[0];
      if (!choice) {
        emit({ type: "error", message: "No response from model" });
        break;
      }

      const msg = choice.message;
      messages.push(msg);

      // Emit assistant text
      if (msg.content) {
        emit({ type: "assistant_delta", content: msg.content });
      }

      // Check for tool calls
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Model finished - no more tool calls
        if (iteration === 1) {
          emit({ type: "run_stage", stage: "summarizing", status: "running", label: "summarizing", details: "Task completed" });
        }
        break;
      }

      // Process tool calls
      if (iteration === 1) {
        emit({ type: "run_stage", stage: "editing", status: "running", label: "editing", details: "Executing tools" });
      }

      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs;
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          fnArgs = {};
        }

        // Emit tool start
        emit({
          type: "tool_start",
          tool: fnName,
          input: fnArgs,
          metadata: { toolCallId: toolCall.id },
        });

        // Execute tool
        const result = executeTool(fnName, fnArgs, cwd);
        const resultStr = JSON.stringify(result).slice(0, 50000);

        // Emit tool output
        emit({
          type: "tool_output",
          tool: fnName,
          output: resultStr.slice(0, 2000),
          metadata: { toolCallId: toolCall.id, truncated: resultStr.length > 2000 },
        });

        // Add tool result to messages
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }

      // Check stop reason
      if (choice.finish_reason === "stop") {
        break;
      }
    }

    emit({ type: "run_stage", stage: "done", status: "completed", label: "done", details: "Completed" });
    emit({
      type: "done",
      metadata: {
        ...turnTiming(),
        completed: true,
        failed: false,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        apiCalls,
        iterations: iteration,
      },
    });
  } catch (err) {
    emit({ type: "error", message: err.message });
    emit({
      type: "done",
      metadata: {
        ...turnTiming(),
        completed: false,
        failed: true,
        error: err.message,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        apiCalls,
        iterations: iteration,
      },
    });
  }
}

module.exports = { runDirectAgent, TOOLS, executeTool };
