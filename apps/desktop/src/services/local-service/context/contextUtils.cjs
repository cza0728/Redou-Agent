const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { mkdirp, readJson, readText } = require("../shared/fileUtils.cjs");
const { compact, compactMultiline, markdownListText, uniqueList } = require("../shared/textUtils.cjs");

const RECENT_MESSAGE_LIMIT = 20;
const RECENT_MESSAGE_CONTENT_LIMIT = 4000;
const DEFAULT_MODEL_CONTEXT_TOKENS = 128000;
const COMPACT_FORCE_RATIO = 0.85;
const COMPACT_EMERGENCY_RATIO = 0.95;
const RECENT_TURN_DIGEST_LIMIT = 6;
const RECENT_TURN_DIGEST_MAX_CHARS = 6000;
const RECENT_CONVERSATION_MAX_CHARS = 24000;
const CONTEXT_RULE_MAX_CHARS = 280;
const VALID_MESSAGE_ROLES = new Set(["user", "assistant", "system", "tool", "event"]);
const PROFILE_RUNTIME_CONFIG_KEYS = ["model", "providers", "custom_providers", "model_aliases", "agent"];
const DELIVERY_MODES = new Set(["new_turn", "queue", "guide", "interrupt_replace"]);
const RUN_MODES = new Set(["execute", "plan"]);
const USER_INPUT_STATUSES = new Set(["pending", "consumed", "completed", "cancelled"]);

function stripImmediateRequestTail(value) {
  let text = String(value || "").trim();
  const sentenceTail = /[。！？.!?]\s*(?=(现在|接下来|顺便|然后|另外|同时|此外|马上|今天|now|next|also|then|please|can you|could you))/i;
  const sentenceMatch = text.match(sentenceTail);
  if (sentenceMatch?.index != null && sentenceMatch.index > 0) {
    text = text.slice(0, sentenceMatch.index + 1).trim();
  }
  const clauseTail =
    /([，,；;]\s*)(现在|接下来|顺便|然后|另外|同时|此外|马上|今天|now|next|also|then)\s*(请|帮我|给我|回答|回复|告诉我|解释|写|生成|处理|做|看|检查|测试|执行|运行|实现|修复|创建|总结|please|can you|could you|answer|reply|tell|explain|write|generate|handle|check|test|run|implement|fix|create|summarize).*$/i;
  text = text.replace(clauseTail, "").trim();
  return text;
}

function extractContextRuleContent(raw) {
  const stripped = stripContextDirectiveLead(raw);
  const concise = stripImmediateRequestTail(stripped);
  return markdownListText(concise || stripped, CONTEXT_RULE_MAX_CHARS);
}

function stripContextDirectiveLead(value) {
  return String(value || "")
    .trim()
    .replace(
      /^(please\s+)?(remember|note|save|record|use this as|add this to|add to|keep in mind|以后|下次|记住|记忆|记录|保存|请记住|帮我记住)[\s:：,，-]*/i,
      "",
    )
    .replace(
      /^(this\s+)?(project|task)\s+(rule|memory|mem|instruction|preference)[\s:：,，-]*/i,
      "",
    )
    .replace(/^(项目|任务|本项目|本任务|当前项目|当前任务)(规则|记忆|偏好|要求)?[\s:：,，-]*/i, "")
    .replace(/^(规则|偏好|要求)[\s:：,，-]*/i, "")
    .trim();
}

function classifyContextDirective(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const hasRememberSignal =
    /(remember|note this|save this|record this|keep in mind|always|never|from now on|以后|下次|以后都|总是|永远|记住|记忆|记录|保存)/i.test(raw);
  const hasExplicitDirective =
    /^(this\s+)?(project|task)\s+(rules?|memory|mem|instruction|preference)[\s:：,，-]/i.test(raw) ||
    /^(项目|任务|本项目|本任务|当前项目|当前任务)(规则|记忆|偏好|要求)?[\s:：,，-]/i.test(raw) ||
    /^(规则|偏好|要求)[\s:：,，-]/i.test(raw) ||
    /(项目|任务).{0,16}(规则|记忆|偏好|要求)[\s:：,，-]/i.test(raw);
  if (!hasRememberSignal && !hasExplicitDirective) return null;

  const taskScoped = /(task\s+(rules?|instruction|preference)|this task|current task|任务|本任务|当前任务)/i.test(raw);
  const projectScoped = /(project\s+(rules?|memory|mem|instruction|preference)|this project|current project|项目|本项目|当前项目)/i.test(raw);
  const explicitProjectRules = /(project\s+(rules?|instruction|preference)|项目.*(规则|偏好|要求)|本项目|当前项目)/i.test(raw);

  const scope = projectScoped && !taskScoped ? "project" : "task";
  const content = extractContextRuleContent(raw);
  if (!content || content.length < 2) return null;
  return { scope, content };
}

function normalizeDeliveryMode(value, fallback = "queue") {
  const mode = String(value || "").trim().toLowerCase();
  return DELIVERY_MODES.has(mode) ? mode : fallback;
}

function normalizeRunMode(value, fallback = "execute") {
  const mode = String(value || "").trim().toLowerCase();
  return RUN_MODES.has(mode) ? mode : fallback;
}

class SecretRedactor {
  static replacement = "[REDACTED_SECRET]";

  static redactText(value) {
    let count = 0;
    let text = String(value || "");
    const replace = (pattern, replacer) => {
      text = text.replace(pattern, (...args) => {
        count += 1;
        return typeof replacer === "function" ? replacer(...args) : replacer;
      });
    };

    replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, `[private key ${SecretRedactor.replacement}]`);
    replace(/\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Authorization: Bearer ${SecretRedactor.replacement}`);
    replace(/\b(sk|pk)-[A-Za-z0-9_-]{12,}\b/g, (match, prefix) => `${prefix}-${SecretRedactor.replacement}`);
    replace(
      /\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password))[ \t]*[:=][ \t]*(['"])(?:(?!\2).){1,4096}\2/gi,
      (_match, key, quote) => `${key}=${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password))[ \t]*[:=][ \t]*([^\s,;]+)/gi,
      (_match, key) => `${key}=${SecretRedactor.replacement}`,
    );
    replace(
      /\b(AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS|OPENAI_API_KEY|ANTHROPIC_API_KEY|MINIMAX_API_KEY)[ \t]*[:=][ \t]*([^\s,;]+)/g,
      (_match, key) => `${key}=${SecretRedactor.replacement}`,
    );
    replace(
      /((?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*)([`'"])(?:(?!\2).){1,4096}\2/g,
      (_match, key, quote) => `${key}${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /((?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*)(?!\[REDACTED_SECRET\])([^\s,;，。；、|]+)/g,
      (_match, key) => `${key}${SecretRedactor.replacement}`,
    );
    replace(
      /\b(Password bytes[ \t]*:[ \t]*b)([`'"])(?:(?!\2).){1,4096}\2/gi,
      (_match, key, quote) => `${key}${quote}${SecretRedactor.replacement}${quote}`,
    );
    replace(
      /(`ssh\b[^`\r\n]*`[ \t]+)(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])([^\s`]{8,})/gi,
      (_match, prefix) => `${prefix}${SecretRedactor.replacement}`,
    );
    replace(
      /(\bssh\b(?![^\r\n]*\bpassword[ \t]*[:=])[^\r\n]*?\b[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+[^\r\n]*?[ \t]+)(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])([^\s`]{8,})/gi,
      (_match, prefix) => `${prefix}${SecretRedactor.replacement}`,
    );

    return { text, count };
  }

  static containsUnredactedSecret(value) {
    const text = String(value || "");
    return [
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
      /\bAuthorization\s*:\s*Bearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}/i,
      /\b(sk|pk)-(?!(?:\[REDACTED_SECRET\]))[A-Za-z0-9_-]{12,}\b/i,
      /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|secret[_-]?access[_-]?key|token|auth[_-]?token|password|passwd|pwd|root[_-]?password|admin[_-]?password|ssh[_-]?password|server[_-]?password|cloud[_-]?password)[ \t]*[:=][ \t]*(?!\[REDACTED_SECRET\])['"]?[^'"\s,;]{4,}/i,
      /(?:密码|口令|密钥|令牌|凭证|访问令牌|访问密钥|私钥)[ \t]*(?:[:：=]|是|为)[ \t]*(?![`'"]?\[REDACTED_SECRET\])[`'"]?[^\s,;，。；、|]{4,}/i,
      /\bPassword bytes[ \t]*:[ \t]*b(?![`'"]?\[REDACTED_SECRET\])[`'"][^`'"]{4,}[`'"]/i,
      /`ssh\b[^`\r\n]*`[ \t]+(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])[^\s`]{8,}/i,
      /\bssh\b(?![^\r\n]*\bpassword[ \t]*[:=])[^\r\n]*?\b[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+[^\r\n]*?[ \t]+(?!\[REDACTED_SECRET\])(?=[^\s`]*[A-Za-z])(?=[^\s`]*\d)(?=[^\s`]*[^A-Za-z0-9\s`])[^\s`]{8,}/i,
    ].some((pattern) => pattern.test(text));
  }
}

function redact(value) {
  return SecretRedactor.redactText(value).text;
}

function cjkCharCount(text) {
  const matches = String(text || "").match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g);
  return matches ? matches.length : 0;
}

function estimateContextTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  const cjk = cjkCharCount(value);
  const nonCjk = Math.max(0, value.length - cjk);
  return Math.max(1, cjk + Math.ceil(nonCjk / 4));
}

function contextPercent(tokens, maxTokens = DEFAULT_MODEL_CONTEXT_TOKENS) {
  if (!maxTokens || maxTokens <= 0) return 0;
  return Math.round((Math.max(0, tokens) / maxTokens) * 1000) / 10;
}

function getContextBudget(modelContextTokens) {
  const parsed = Number(modelContextTokens);
  const safeModelContextTokens = Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_MODEL_CONTEXT_TOKENS;
  const reservedOutput = Math.min(8192, Math.floor(safeModelContextTokens * 0.15));
  const safetyMargin = Math.floor(safeModelContextTokens * 0.05);
  const inputBudget = Math.max(1, safeModelContextTokens - reservedOutput - safetyMargin);
  return {
    modelContextTokens: safeModelContextTokens,
    inputBudget,
    reservedOutput,
    safetyMargin,
  };
}

function shouldCompactContext(contextUsage, budget) {
  const inputBudget = Math.max(1, Number(budget?.inputBudget || DEFAULT_MODEL_CONTEXT_TOKENS));
  const ratio = Math.max(0, Number(contextUsage || 0)) / inputBudget;
  return {
    shouldCompact: ratio >= COMPACT_FORCE_RATIO,
    emergency: ratio >= COMPACT_EMERGENCY_RATIO,
    ratio,
  };
}

function defaultTaskContextText() {
  return renderTaskContextMarkdown(defaultTaskState());
}

function defaultTaskState() {
  return {
    task_goal: "",
    current_phase: "not_started",
    constraints: [],
    decisions: [],
    completed: [],
    open_issues: [],
    files_changed: [],
    commands_run: [],
    current_focus: "",
    next_steps: [],
  };
}

const TASK_STATE_FIELDS = Object.keys(defaultTaskState());

function normalizeTaskState(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalized = defaultTaskState();
  for (const field of TASK_STATE_FIELDS) {
    const current = source[field];
    if (Array.isArray(normalized[field])) {
      normalized[field] = uniqueList(
        (Array.isArray(current) ? current : current ? [current] : [])
          .map((item) => markdownListText(item, 700))
          .filter(Boolean),
        80,
      );
    } else {
      normalized[field] = markdownListText(current, 900);
    }
  }
  return normalized;
}

function renderTaskStateStructuredMarkdown(state) {
  const safe = normalizeTaskState(state);
  return [
    "# Task Context",
    "",
    "## A. Structured State",
    "",
    "### Current Goal",
    "",
    safe.task_goal || "(empty)",
    "",
    "### Current Phase",
    "",
    safe.current_phase || "(empty)",
    "",
    "### Constraints",
    "",
    renderMarkdownList(safe.constraints),
    "",
    "### Decisions",
    "",
    renderMarkdownList(safe.decisions),
    "",
    "### Completed",
    "",
    renderMarkdownList(safe.completed),
    "",
    "### Open Issues",
    "",
    renderMarkdownList(safe.open_issues),
    "",
    "### Files Changed",
    "",
    renderMarkdownList(safe.files_changed),
    "",
    "### Commands Run",
    "",
    renderMarkdownList(safe.commands_run),
    "",
    "### Current Focus",
    "",
    safe.current_focus || "(empty)",
    "",
    "### Next Action",
    "",
    renderMarkdownList(safe.next_steps),
    "",
    "---",
  ].join("\n");
}

function renderRecentTurnDigest(state) {
  const safe = normalizeTaskState(state);
  const digest = [
    ...safe.open_issues.slice(-3).map((item) => `issue: ${compact(item, 220)}`),
    ...safe.commands_run.slice(-4).map((item) => `command: ${compact(item, 220)}`),
    ...safe.files_changed.slice(-6).map((item) => `file: ${compact(item, 180)}`),
    ...safe.completed.slice(-3).map((item) => `done: ${compact(item, 220)}`),
  ];
  return renderMarkdownList(digest, "(empty)");
}

function renderTaskContextMarkdown(state) {
  return [
    renderTaskStateStructuredMarkdown(state).trimEnd(),
    "",
    "## B. Recent Turn Digest",
    "",
    renderRecentTurnDigest(state),
    "",
  ].join("\n");
}

function parseTaskStateFromStructuredText(text) {
  const value = String(text || "");
  return normalizeTaskState({
    task_goal: markdownSectionsByTitle(value, ["Current Goal", "Current Brief"])[0] || "",
    current_phase: markdownSectionsByTitle(value, ["Current Phase"])[0] || "",
    constraints: parseMarkdownListSection(value, "Constraints").concat(parseMarkdownListSection(value, "Active Constraints")),
    decisions: parseMarkdownListSection(value, "Decisions"),
    completed: parseMarkdownListSection(value, "Completed").concat(parseMarkdownListSection(value, "Progress Summary")),
    open_issues: parseMarkdownListSection(value, "Open Issues"),
    files_changed: parseMarkdownListSection(value, "Files Changed").concat(parseMarkdownListSection(value, "Relevant Files")),
    commands_run: parseMarkdownListSection(value, "Commands Run"),
    current_focus: markdownSectionsByTitle(value, ["Current Focus"])[0] || "",
    next_steps: parseMarkdownListSection(value, "Next Action").concat(parseMarkdownListSection(value, "Todo List")),
  });
}

function taskStatePathFromContextPath(taskContextPath) {
  return path.join(path.dirname(String(taskContextPath || "")), TASK_STATE_FILE);
}

function taskEventsPathFromContextPath(taskContextPath) {
  return path.join(path.dirname(String(taskContextPath || "")), TASK_EVENTS_FILE);
}

function readTaskStateFile(taskStatePath) {
  const parsed = readJson(taskStatePath, null);
  return normalizeTaskState(parsed);
}

function writeTaskStateFiles(task, state) {
  const safe = normalizeTaskState(state);
  const statePath = task.statePath || taskStatePathFromContextPath(task.contextPath);
  const contextPath = task.contextPath;
  mkdirp(path.dirname(statePath));
  fs.writeFileSync(statePath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  fs.writeFileSync(contextPath, renderTaskContextMarkdown(safe), "utf8");
  return safe;
}

function hasTaskContextShape(text) {
  const value = String(text || "");
  return (
    /^# Task Context\s*$/m.test(value) &&
    /^## A\. Structured State\s*$/m.test(value) &&
    (/^## B\. Recent Turn Digest\s*$/m.test(value) || /^## B\. Raw Turn Log\s*$/m.test(value))
  );
}

function stripTaskContextHeading(text) {
  return String(text || "")
    .replace(/^\s*#\s*Task Context\s*/i, "")
    .trim();
}

function normalizeTaskContextText(text) {
  const value = String(text || "").replace(/\r\n/g, "\n").trimEnd();
  if (!value.trim()) return defaultTaskContextText();
  if (hasTaskContextShape(value)) {
    return value
      .replace(/^## B\. Raw Turn Log\s*$/m, "## B. Recent Turn Digest")
      .replace(/\n*$/, "\n");
  }
  const legacy = stripTaskContextHeading(value);
  const state = normalizeTaskState({
    completed: legacy ? [compactMultiline(legacy, 1200)] : [],
  });
  return renderTaskContextMarkdown(state);
}

function splitTaskContext(text) {
  const normalized = normalizeTaskContextText(text);
  const digestMarker = normalized.search(/^## B\. Recent Turn Digest\s*$/m);
  const rawMarker = normalized.search(/^## B\. Raw Turn Log\s*$/m);
  const marker = digestMarker >= 0 ? digestMarker : rawMarker;
  if (marker < 0) {
    const empty = normalizeTaskContextText("");
    return { structuredState: empty, recentTurnDigest: "", rawTurnLog: "" };
  }
  const structuredState = normalized.slice(0, marker).trimEnd();
  const recentTurnDigest = normalized
    .slice(marker)
    .replace(/^## B\. (?:Recent Turn Digest|Raw Turn Log)\s*$/m, "")
    .trim();
  return { structuredState, recentTurnDigest, rawTurnLog: recentTurnDigest };
}

function recentTurnDigest(taskContext, maxEntries = RECENT_TURN_DIGEST_LIMIT, maxChars = RECENT_TURN_DIGEST_MAX_CHARS) {
  if (maxEntries <= 0 || maxChars <= 0) return "";
  const { recentTurnDigest: digest } = splitTaskContext(taskContext);
  if (!digest) return "";
  const entries = digest
    .split(/\n(?=-\s+)/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  let text = entries.slice(-Math.max(0, maxEntries)).join("\n").trim();
  if (text.length > maxChars) {
    text = `[older digest omitted]\n${text.slice(text.length - maxChars).replace(/^\s+/, "")}`;
  }
  return text;
}

function trimTaskContextRawLog(taskContext, maxEntries = 2) {
  const normalized = normalizeTaskContextText(taskContext);
  const state = parseTaskStateFromStructuredText(splitTaskContext(normalized).structuredState);
  const digest = recentTurnDigest(normalized, maxEntries);
  return [
    renderTaskStateStructuredMarkdown(state).trimEnd(),
    "",
    "## B. Recent Turn Digest",
    "",
    digest || "(empty)",
    "",
  ].join("\n");
}

function markdownBulletBlock(values) {
  const items = uniqueList(values);
  if (!items.length) return "  []";
  return items.map((item) => `  - ${item}`).join("\n");
}

function normalizeRuleKey(value) {
  return String(value || "")
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/[.!?。！？,，;；:：]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function appendDedupeRules(file, rules) {
  const cleanRules = uniqueList(rules, 50).filter(Boolean);
  if (!cleanRules.length) return [];
  const current = readText(file);
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map(normalizeRuleKey)
      .filter(Boolean),
  );
  const added = [];
  for (const rule of cleanRules) {
    const key = normalizeRuleKey(rule);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    added.push(rule);
  }
  if (!added.length) return [];
  const entry = added.map((rule) => `- ${rule}`).join("\n");
  fs.writeFileSync(file, `${current.trimEnd()}\n\n${entry}\n`, "utf8");
  return added;
}

function projectWorkspaceOutputRule(workspacePath) {
  const cleanPath = String(workspacePath || "").trim();
  if (!cleanPath) return "";
  const displayPath = path.resolve(cleanPath).replace(/`/g, "'");
  return `Keep all task outputs for this project under the configured project workspace path: ${displayPath}. This includes generated files, reports, logs, and other artifacts, unless the user explicitly requests otherwise.`;
}

function markdownHeading(line) {
  const match = String(line || "").match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return {
    depth: match[1].length,
    title: match[2].trim().toLowerCase(),
  };
}

function markdownSectionsByTitle(markdown, titles) {
  const wanted = new Set(titles.map((title) => String(title || "").trim().toLowerCase()).filter(Boolean));
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = markdownHeading(line);
    if (heading) {
      if (current && heading.depth <= current.depth) {
        sections.push(current.lines.join("\n"));
        current = null;
      }
      if (wanted.has(heading.title)) {
        current = { depth: heading.depth, lines: [] };
      }
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current.lines.join("\n"));
  return sections;
}

function normalizeExtractedRule(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/^(rules?|constraints?|requirements?|preferences?|规则|约束|要求|偏好)\s*[:：]\s*/i, "")
    .trim();
}

function isUsefulExtractedRule(value) {
  const text = normalizeExtractedRule(value);
  if (!text) return false;
  if (/^(?:\[\]|\(empty\)|empty|none|null|n\/a|\[truncated\])$/i.test(text)) return false;
  if (/^(?:files?|commands?|errors?|attachments?|constraints?|todos?|evidence|open_issues)\s*[:：]$/i.test(text)) return false;
  if (/^(?:文件|命令|错误|附件|约束|待办|证据|开放问题)\s*[:：]$/.test(text)) return false;
  if (text.endsWith(":") || text.endsWith("：")) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (Array.from(text).length < 6) return false;
  return true;
}

function extractedRulesFromMarkdownBlock(block) {
  const rules = [];
  let paragraph = [];
  const flushParagraph = () => {
    const text = normalizeExtractedRule(paragraph.join(" "));
    paragraph = [];
    if (isUsefulExtractedRule(text)) rules.push(text);
  };

  for (const rawLine of String(block || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (markdownHeading(line) || /^-{3,}$/.test(line)) {
      flushParagraph();
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/) || line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const text = normalizeExtractedRule(bullet[1]);
      if (isUsefulExtractedRule(text)) rules.push(text);
      continue;
    }

    if (/^(?:user request|assistant summary|observed artifacts|light tags)\s*[:：]$/i.test(line)) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return uniqueList(rules, 50);
}

function fallbackRulesFromNamedSections(markdown, titles) {
  const wanted = new Set(titles.map((title) => String(title || "").trim().toLowerCase()).filter(Boolean));
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const rules = [];
  let activeDepth = 0;
  let activeLines = [];
  const flush = () => {
    if (activeLines.length) rules.push(...extractedRulesFromMarkdownBlock(activeLines.join("\n")));
    activeLines = [];
  };
  for (const line of lines) {
    const heading = markdownHeading(line);
    if (heading) {
      if (activeDepth && heading.depth <= activeDepth) {
        flush();
        activeDepth = 0;
      }
      if (wanted.has(heading.title)) {
        activeDepth = heading.depth;
        activeLines = [];
      }
      continue;
    }
    if (activeDepth && /^-{3,}\s*$/.test(line)) {
      flush();
      activeDepth = 0;
      continue;
    }
    if (activeDepth) activeLines.push(line);
  }
  flush();
  return uniqueList(rules, 50);
}

function labeledMarkdownBlock(text, label, stopLabels) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const labelPattern = new RegExp(`^${label}\\s*[:：]\\s*$`, "i");
  const stopPatterns = stopLabels.map((item) => new RegExp(`^${item}\\s*[:：]\\s*$`, "i"));
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (labelPattern.test(trimmed)) {
      if (current) blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    if (current && stopPatterns.some((pattern) => pattern.test(trimmed))) {
      blocks.push(current.join("\n"));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

function explicitRulesFromRawTurnLog(rawTurnLog, targetScope) {
  const rules = [];
  for (const userRequest of labeledMarkdownBlock(rawTurnLog, "User Request", [
    "Assistant Summary",
    "Observed Artifacts",
    "Light Tags",
  ])) {
    const directive = classifyContextDirective(userRequest);
    if (directive?.scope === targetScope && directive.content) {
      rules.push(directive.content);
    }
  }
  return uniqueList(rules, 50);
}

function extractRulesFromTaskContextText(taskContext, targetScope) {
  const normalized = normalizeTaskContextText(taskContext);
  const { structuredState, rawTurnLog } = splitTaskContext(normalized);
  const sectionTitles = targetScope === "project"
    ? [
        "Project Rules",
        "Project Rule",
        "Project Constraints",
        "Project-wide Rules",
        "Project-wide Constraints",
        "Active Constraints",
      ]
    : [
        "Task Rules",
        "Task Rule",
        "Task Constraints",
        "Active Constraints",
        "Validation Criteria",
        "Output Requirements",
        "Requirements",
        "Constraints",
      ];
  const rules = [];
  for (const section of markdownSectionsByTitle(structuredState, sectionTitles)) {
    rules.push(...extractedRulesFromMarkdownBlock(section));
  }
  if (!rules.length) {
    for (const section of markdownSectionsByTitle(normalized, sectionTitles)) {
      rules.push(...extractedRulesFromMarkdownBlock(section));
    }
  }
  if (!rules.length) {
    rules.push(...fallbackRulesFromNamedSections(taskContext, sectionTitles));
  }
  rules.push(...explicitRulesFromRawTurnLog(rawTurnLog, targetScope));
  return uniqueList(rules, 50);
}

function toInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
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

function normalizeUserInputStatus(value, fallback = "pending") {
  const status = String(value || "").trim().toLowerCase();
  return USER_INPUT_STATUSES.has(status) ? status : fallback;
}

function createUserInputEnvelope(input = {}) {
  const deliveryMode = normalizeDeliveryMode(input.deliveryMode, "new_turn");
  return {
    id: String(input.id || crypto.randomUUID()),
    text: String(input.text || ""),
    turnId: String(input.turnId || crypto.randomUUID()),
    ...(input.runId ? { runId: String(input.runId) } : {}),
    deliveryMode,
    status: normalizeUserInputStatus(input.status, "pending"),
    ...(input.targetRunId ? { targetRunId: String(input.targetRunId) } : {}),
    ...(input.consumedAt ? { consumedAt: String(input.consumedAt) } : {}),
  };
}

function messageInputEnvelope(message = {}) {
  const { metadata } = mergeMetadata(message);
  const envelope = metadata.inputEnvelope && typeof metadata.inputEnvelope === "object"
    ? metadata.inputEnvelope
    : null;
  if (!envelope) return null;
  return {
    id: String(envelope.id || ""),
    text: String(envelope.text || ""),
    turnId: String(envelope.turnId || ""),
    runId: envelope.runId ? String(envelope.runId) : undefined,
    deliveryMode: normalizeDeliveryMode(envelope.deliveryMode, "new_turn"),
    status: normalizeUserInputStatus(envelope.status, "pending"),
    targetRunId: envelope.targetRunId ? String(envelope.targetRunId) : undefined,
    consumedAt: envelope.consumedAt ? String(envelope.consumedAt) : undefined,
  };
}

function promptTextFromMessages(messages = []) {
  return (messages || [])
    .map((message) => {
      const content = message?.content;
      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object") return String(part.text || part.content || "");
            return "";
          })
          .join("\n");
      }
      return String(content || "");
    })
    .join("\n\n");
}

function countOccurrences(haystack, needle) {
  const source = String(haystack || "");
  const target = String(needle || "");
  if (!target) return 0;
  let count = 0;
  let index = source.indexOf(target);
  while (index >= 0) {
    count += 1;
    index = source.indexOf(target, index + target.length);
  }
  return count;
}

function scrubCurrentRequestEcho(content, currentRequest) {
  const source = String(content || "");
  const request = String(currentRequest || "").trim();
  if (!request || request.length < 8) return source;
  return source.split(request).join("[current request omitted here]");
}

function completedRunIdsFromMessages(messages = []) {
  const completed = new Set();
  const cancelled = new Set();
  for (const message of messages || []) {
    const { combined, eventType } = mergeMetadata(message);
    const runId = combined.runId ? String(combined.runId) : "";
    if (!runId) continue;
    if (eventType === "done") {
      const turnExitReason = String(combined.turnExitReason || combined.turn_exit_reason || "").toLowerCase();
      const unsuccessful =
        combined.cancelled ||
        combined.canceled ||
        combined.stopRequested ||
        combined.replacedByRunId ||
        combined.interrupted ||
        combined.partial ||
        combined.failed ||
        combined.error ||
        (combined.completed === false && /max_iterations|partial|stream|error|failed|failure|exception|invalid/.test(turnExitReason));
      if (unsuccessful) {
        cancelled.add(runId);
      } else {
        completed.add(runId);
      }
    }
    if (eventType === "error" && (combined.cancelled || combined.stopRequested)) {
      cancelled.add(runId);
    }
  }
  for (const runId of cancelled) completed.delete(runId);
  return completed;
}

function isControlEventMessage(message = {}) {
  const { metadata, eventType } = mergeMetadata(message);
  return (
    eventType === "control_event" ||
    metadata.controlEvent === true ||
    metadata.controlEventType ||
    metadata.deliveryMode === "guide" ||
    messageInputEnvelope(message)?.deliveryMode === "guide"
  );
}

function isPromptHistoryMessage(message, completedRunIds, currentRequestId = "") {
  if (!message || !["user", "assistant", "tool"].includes(message.role)) return false;
  const { combined, eventType } = mergeMetadata(message);
  if (["command_start", "command_output", "command_end", "tool_start", "tool_output", "tool_end", "done", "raw_log", "queue_update", "run_stage"].includes(eventType)) {
    return false;
  }
  if (isControlEventMessage(message)) return false;
  const envelope = messageInputEnvelope(message);
  if (envelope) {
    if (envelope.id && envelope.id === currentRequestId) return false;
    if (envelope.deliveryMode === "guide") return false;
    if (envelope.status !== "completed") return false;
  }
  if (combined.runId && completedRunIds.size > 0 && !completedRunIds.has(String(combined.runId))) {
    return false;
  }
  return true;
}

function renderPromptHistoryMessage(message, currentRequestText, redactionStats) {
  const { combined } = mergeMetadata(message);
  const envelope = messageInputEnvelope(message);
  const rawContent = compactMultiline(message.content, RECENT_MESSAGE_CONTENT_LIMIT);
  const scrubbed = scrubCurrentRequestEcho(rawContent, currentRequestText);
  const redacted = SecretRedactor.redactText(scrubbed);
  redactionStats.count += redacted.count;
  const attachments = Array.isArray(message.attachments) && message.attachments.length > 0
    ? message.attachments.map((attachment) => {
        const line = [
          attachment.name || "attachment",
          attachment.storedPath ? `storedPath=${attachment.storedPath}` : "",
          attachment.mimeType ? `mimeType=${attachment.mimeType}` : "",
        ].filter(Boolean).join(" ");
        const safe = SecretRedactor.redactText(line);
        redactionStats.count += safe.count;
        return safe.text;
      }).join("\n")
    : "";
  const content = attachments
    ? `${redacted.text}\n\nAttachments:\n${attachments}`.trim()
    : redacted.text;
  return {
    role: message.role,
    content,
    metadata: {
      redouContextKind: "history",
      ...(combined.runId ? { runId: String(combined.runId) } : {}),
      ...(envelope?.turnId ? { turnId: envelope.turnId } : {}),
      ...(envelope?.id ? { inputEnvelopeId: envelope.id } : {}),
    },
  };
}

class ToolLogSummarizer {
  static summarize(messages = [], completedRunIds = new Set(), currentRequestText = "", redactionStats = { count: 0 }) {
    const byRun = new Map();
    const ensure = (runId) => {
      const key = String(runId || "legacy");
      if (!byRun.has(key)) {
        byRun.set(key, { commands: [], tools: [], files: [], errors: [], outputs: [], success: null });
      }
      return byRun.get(key);
    };

    for (const message of messages || []) {
      const { event, combined, eventType } = mergeMetadata(message);
      const runId = combined.runId ? String(combined.runId) : "";
      if (runId && completedRunIds.size > 0 && !completedRunIds.has(runId)) continue;
      if (!["command_start", "command_end", "command_output", "tool_start", "tool_end", "tool_output", "file_changed", "error"].includes(eventType)) {
        continue;
      }
      const bucket = ensure(runId);
      if (eventType === "command_start" && event.command) {
        bucket.commands.push(event.command);
      } else if (eventType === "command_end") {
        bucket.success = event.success !== false;
      } else if (eventType === "tool_start" && event.name) {
        bucket.tools.push(event.name);
      } else if (eventType === "tool_end") {
        bucket.success = event.success !== false;
      } else if (eventType === "file_changed") {
        bucket.files.push(event.path || event.summary);
      } else if (eventType === "error") {
        bucket.errors.push(event.message || message.content);
      } else if (eventType === "command_output" || eventType === "tool_output") {
        const raw = eventType === "tool_output"
          ? (typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {}))
          : (event.content || message.content);
        const firstUsefulLine = String(raw || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean);
        if (firstUsefulLine) {
          bucket.outputs.push(firstUsefulLine);
        }
      }
    }

    const lines = [];
    for (const [runId, bucket] of Array.from(byRun.entries()).slice(-4)) {
      const parts = [];
      if (bucket.commands.length) parts.push(`commands: ${uniqueList(bucket.commands, 6).join("; ")}`);
      if (bucket.tools.length) parts.push(`tools: ${uniqueList(bucket.tools, 8).join(", ")}`);
      if (bucket.success != null) parts.push(`result: ${bucket.success ? "success" : "failed"}`);
      if (bucket.files.length) parts.push(`files: ${uniqueList(bucket.files, 8).join(", ")}`);
      if (bucket.outputs.length) parts.push(`key output: ${uniqueList(bucket.outputs.map((item) => compact(item, 220)), 4).join(" | ")}`);
      if (bucket.errors.length) parts.push(`errors: ${uniqueList(bucket.errors.map((item) => compact(item, 260)), 4).join(" | ")}`);
      if (!parts.length) continue;
      const rawLine = `- run ${runId}: ${parts.join("; ")}`;
      const scrubbed = scrubCurrentRequestEcho(rawLine, currentRequestText);
      const redacted = SecretRedactor.redactText(scrubbed);
      redactionStats.count += redacted.count;
      lines.push(redacted.text);
    }
    return lines.join("\n");
  }
}

function parseMarkdownListSection(markdown, title) {
  const sections = markdownSectionsByTitle(markdown, [title]);
  if (!sections.length) return [];
  return sections[0]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line && line !== "(empty)" && line !== "No completed turns yet." && !/^#+\s/.test(line));
}

function renderMarkdownList(items, empty = "(empty)") {
  const values = uniqueList((items || []).map((item) => String(item || "").trim()).filter(Boolean), 12);
  return values.length ? values.map((item) => `- ${item}`).join("\n") : empty;
}

class TaskStateManager {
  static update(taskContext, userInput, assistantText, options = {}) {
    const artifacts = options.artifacts && typeof options.artifacts === "object"
      ? options.artifacts
      : emptyTurnArtifacts();
    const existingState = parseTaskStateFromStructuredText(splitTaskContext(taskContext).structuredState);
    const state = compressTaskContext([
      { type: "turn_digest", user: userInput, assistant: assistantText, ...(artifacts || {}) },
    ], options.budget || {});
    const merged = normalizeTaskState({
      ...state,
      constraints: [...existingState.constraints, ...state.constraints],
      decisions: [...existingState.decisions, ...state.decisions],
      completed: [...existingState.completed, ...state.completed],
      open_issues: [...existingState.open_issues, ...state.open_issues],
      files_changed: [...existingState.files_changed, ...state.files_changed],
      commands_run: [...existingState.commands_run, ...state.commands_run],
      next_steps: [...existingState.next_steps, ...state.next_steps],
      task_goal: state.task_goal || existingState.task_goal,
      current_phase: state.current_phase || existingState.current_phase,
      current_focus: state.current_focus || existingState.current_focus,
    });
    const nextStructured = renderTaskStateStructuredMarkdown(merged);
    return {
      structuredState: nextStructured,
      rawTurnLog: "",
      recentTurnDigest: renderRecentTurnDigest(merged),
      taskStateSnapshot: nextStructured.replace(/^# Task Context\s*/i, "").trim(),
    };
  }
}

class ContextValidator {
  static validate(messages = [], options = {}) {
    const errors = [];
    const currentRequestText = String(options.currentRequestText || "").trim();
    const currentRequestId = String(options.currentRequestId || "");
    const allowEmptyCurrentRequest = options.allowEmptyCurrentRequest === true;
    const promptText = promptTextFromMessages(messages);
    const userMessages = messages.filter((message) => message?.role === "user");
    const lastUser = userMessages[userMessages.length - 1] || null;
    const occurrenceTarget = currentRequestText.length >= 16
      ? currentRequestText
      : `# Current User Request\n\n${currentRequestText}`;
    const occurrences = currentRequestText ? countOccurrences(promptText, occurrenceTarget) : 0;

    if (!currentRequestText) {
      if (!allowEmptyCurrentRequest) {
        errors.push("Current User Request is empty.");
      }
    } else if (occurrences !== 1) {
      errors.push(`Current User Request occurrence count is ${occurrences}, expected 1.`);
    }
    if (currentRequestText && (!lastUser || !String(lastUser.content || "").includes(currentRequestText))) {
      errors.push("Current User Request is not the last user message.");
    }

    for (const message of messages) {
      const kind = message?.metadata?.redouContextKind || "";
      const envelope = messageInputEnvelope(message);
      const { eventType } = mergeMetadata(message);
      if (kind === "history" && envelope && envelope.status !== "completed") {
        errors.push(`History includes non-completed turn ${envelope.turnId || envelope.id}.`);
      }
      if (kind === "history" && envelope && ["pending", "consumed"].includes(envelope.status)) {
        errors.push(`History includes queued or future user input ${envelope.id}.`);
      }
      if (kind === "history" && envelope?.deliveryMode === "guide") {
        errors.push(`Guide/control event appears as user history ${envelope.id}.`);
      }
      if (kind === "history" && ["command_start", "command_output", "command_end", "tool_start", "tool_output", "tool_end", "done", "raw_log", "run_stage"].includes(eventType)) {
        errors.push(`Raw run event ${eventType} appears in conversation history.`);
      }
    }

    const nonCurrentPromptText = promptTextFromMessages(
      lastUser ? messages.slice(0, messages.lastIndexOf(lastUser)) : messages,
    );
    if (/\b(command_start|tool_start|tool_end|queue_update|raw_log|run_stage)\b/.test(nonCurrentPromptText)) {
      errors.push("Prompt contains raw run event labels.");
    }
    if (SecretRedactor.containsUnredactedSecret(promptText)) {
      errors.push("Prompt contains an unredacted secret-like value.");
    }

    return {
      ok: errors.length === 0,
      errors,
      currentRequestId,
      currentRequestOccurrences: occurrences,
      messageCount: messages.length,
    };
  }
}

function isImageMime(mimeType) {
  return String(mimeType || "").toLowerCase().startsWith("image/");
}

function eventContent(event) {
  switch (event.type) {
    case "assistant_message":
    case "assistant_delta":
    case "command_output":
    case "raw_log":
      return event.content || "";
    case "command_start":
      return event.command || "";
    case "command_end":
      return `command ${event.success ? "succeeded" : "failed"}${event.exitCode == null ? "" : ` (${event.exitCode})`}`;
    case "tool_start":
      return `tool started: ${event.name}`;
    case "tool_output":
      return typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? {});
    case "tool_end":
      return `tool ${event.success ? "succeeded" : "failed"}: ${event.name}`;
    case "file_changed":
      return event.summary || event.path || "";
    case "queue_update":
      return event.message || `${Number(event.queued || 0)} queued`;
    case "run_stage":
      return [event.label || event.stage || "stage", event.status].filter(Boolean).join(": ");
    case "error":
      return event.message || "error";
    case "done":
      return "done";
    default:
      return JSON.stringify(event);
  }
}

function emptyTurnArtifacts() {
  return { files: [], commands: [], errors: [], attachments: [] };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tryParseJsonObject(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text || !/^[{[]/.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function outputPayloadFromEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "tool_output") return event.output;
  if (event.type === "command_output") return tryParseJsonObject(event.content) || event;
  return event.output || event.content || null;
}

function truthyErrorValue(value) {
  if (value == null || value === false) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text || text === "null" || text === "false") return "";
  return compactMultiline(text, 600);
}

function exitCodeFromValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventExitCode(event, payload = null) {
  const source = asObject(payload) || {};
  const code = exitCodeFromValue(
    event?.exitCode ?? event?.exit_code ?? event?.code ?? source.exitCode ?? source.exit_code ?? source.status,
  );
  if (code != null) return code;
  if (event?.type === "command_end" && event.success === false) return 1;
  if (event?.success === true || source.success === true) return 0;
  return null;
}

function stderrFromPayload(payload) {
  const source = asObject(payload);
  if (!source) return "";
  return markdownListText(source.stderr || source.stdErr || source.errorOutput || "", 700);
}

function keyErrorLines(text, maxLines = 4) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const keyed = lines.filter((line) => /(error|exception|traceback|assertion|failed|failure|stderr|失败|报错)/i.test(line));
  return uniqueList((keyed.length ? keyed : lines).map((line) => compact(line, 240)), maxLines);
}

function summarizeEventError(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "error") return truthyErrorValue(event.message || event.details);
  const payload = outputPayloadFromEvent(event);
  const payloadObject = asObject(payload);
  if (event.type === "tool_output") {
    const toolError = truthyErrorValue(payloadObject ? payloadObject.error : event.error);
    if (toolError) return toolError;
  }
  const stderr = stderrFromPayload(payload);
  const exitCode = eventExitCode(event, payload);
  if (exitCode != null && exitCode !== 0) {
    const source = stderr || (payloadObject ? payloadObject.stdout || payloadObject.output || "" : payload);
    const keyLines = keyErrorLines(source).join(" | ");
    return [`exitCode ${exitCode}`, keyLines].filter(Boolean).join(": ");
  }
  if (stderr) return keyErrorLines(stderr).join(" | ");
  return "";
}

function recordTurnArtifact(artifacts, key, value) {
  if (!artifacts || !Object.prototype.hasOwnProperty.call(artifacts, key)) return;
  const text = compactMultiline(value, 1000).trim();
  if (!text) return;
  artifacts[key].push(text);
  artifacts[key] = uniqueList(artifacts[key], 20);
}

function collectTurnArtifactFromEvent(artifacts, event) {
  if (!artifacts || !event || typeof event !== "object") return;
  if (event.type === "command_end") {
    const code = eventExitCode(event);
    if (code != null && code !== 0) recordTurnArtifact(artifacts, "errors", eventContent(event));
    return;
  }
  if (event.type === "command_output" || event.type === "tool_output" || event.type === "raw_log") {
    const summary = summarizeEventError(event);
    if (summary) recordTurnArtifact(artifacts, "errors", summary);
    return;
  }
  if (event.type === "command_start") {
    recordTurnArtifact(artifacts, "commands", event.command);
  } else if (event.type === "file_changed") {
    recordTurnArtifact(artifacts, "files", event.path || event.summary);
  } else if (event.type === "error") {
    recordTurnArtifact(artifacts, "errors", event.message || event.details);
  } else if (event.type === "command_end" && event.success === false) {
    recordTurnArtifact(artifacts, "errors", eventContent(event));
  } else if (event.type === "command_output" || event.type === "tool_output" || event.type === "raw_log") {
    const text = event.type === "tool_output"
      ? eventContent(event)
      : String(event.content || "");
    if (/(Error|Exception|Traceback|Assertion|failed|失败|报错)/i.test(text)) {
      recordTurnArtifact(artifacts, "errors", text);
    }
  }
}

function seedAttachmentArtifacts(artifacts, attachments) {
  for (const attachment of attachments || []) {
    const label = [
      attachment.name || "attachment",
      attachment.storedPath ? `storedPath=${attachment.storedPath}` : "",
      attachment.mimeType ? `mimeType=${attachment.mimeType}` : "",
    ].filter(Boolean).join(" ");
    recordTurnArtifact(artifacts, "attachments", label);
  }
}

const LIGHT_TAG_KEYWORDS = {
  constraints: ["以后", "默认", "从现在起", "每次", "都要", "必须", "不要再", "禁止", "优先", "保持", "固定", "只能", "不允许"],
  todos: ["帮我", "实现", "修改", "检查", "调试", "运行", "跑一下", "设计", "生成", "整理", "下一步", "计划", "任务"],
  open_issues: ["问题", "失败", "报错", "不确定", "还没", "需要", "风险", "冲突", "歧义", "待确认", "unresolved"],
};

function matchingKeywords(text, keywords) {
  const source = String(text || "");
  return keywords.filter((keyword) => source.toLowerCase().includes(keyword.toLowerCase()));
}

function evidenceMatches(text) {
  const source = String(text || "");
  const matches = [];
  const pathMatches = source.match(/[A-Za-z]:[\\/][^\s"'`<>]+|(?:^|[\s"'`])(?:\.{1,2}[\\/]|[A-Za-z0-9_.-]+[\\/])[^\s"'`<>]+/gm) || [];
  const fileMatches = source.match(/\b[\w.-]+\.(?:py|js|ts|tsx|md|json|csv|xlsx|tex|cjs)\b/g) || [];
  const commandMatches = source.match(/\b(?:npm|python|pytest|git|docker|node|pip|conda)\b[^\r\n]*/gi) || [];
  const errorMatches = source.match(/\b(?:Error|Exception|Traceback|Assertion|failed)\b[^\r\n]*|(?:失败|报错)[^\r\n]*/g) || [];
  const metricMatches = source.match(/\b(?:AUC|ACC|RMSE|loss|accuracy|metrics)\b[^\r\n]*/gi) || [];
  matches.push(...pathMatches, ...fileMatches, ...commandMatches, ...errorMatches, ...metricMatches);
  return uniqueList(matches, 12);
}

function extractLightTags(userInput, assistantSummary, artifacts = emptyTurnArtifacts()) {
  const combined = [
    userInput,
    assistantSummary,
    ...(artifacts.files || []),
    ...(artifacts.commands || []),
    ...(artifacts.errors || []),
    ...(artifacts.attachments || []),
  ].join("\n");
  return {
    constraints: matchingKeywords(userInput, LIGHT_TAG_KEYWORDS.constraints),
    todos: matchingKeywords(userInput, LIGHT_TAG_KEYWORDS.todos),
    evidence: evidenceMatches(combined),
    open_issues: matchingKeywords(combined, LIGHT_TAG_KEYWORDS.open_issues),
  };
}

function eventEnvelope(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const metadata = entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  const event = metadata.event && typeof metadata.event === "object"
    ? metadata.event
    : entry.event && typeof entry.event === "object"
      ? entry.event
      : entry;
  return { entry, metadata, event };
}

function contextEventId(raw, fallbackIndex = 0) {
  const { entry, metadata, event } = eventEnvelope(raw);
  return String(
    event.id ||
    metadata.eventId ||
    metadata.toolCallId ||
    metadata.inputEnvelope?.id ||
    entry.id ||
    `${event.type || entry.role || "event"}:${event.command || entry.content || ""}:${entry.createdAt || event.createdAt || fallbackIndex}`,
  );
}

function commandKey(command) {
  return String(command || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function commandRecordKey(event, index) {
  const metadata = event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  return String(
    metadata.commandId ||
    metadata.toolCallId ||
    event.id ||
    metadata.command ||
    event.command ||
    `command-${index}`,
  );
}

function addStateItem(target, field, value, limit = 80) {
  const text = markdownListText(value, 700);
  if (!text || !Array.isArray(target[field])) return;
  target[field] = uniqueList([...target[field], text], limit);
}

function addOpenIssue(openIssues, id, text) {
  const key = String(id || text || "").trim();
  const body = markdownListText(text, 700);
  if (!key || !body) return;
  openIssues.set(key, body);
}

function removeOpenIssue(openIssues, id) {
  const key = String(id || "").trim();
  if (!key) return;
  openIssues.delete(key);
}

function summarizeMessageForState(text, max = 260) {
  return SecretRedactor.redactText(compact(markdownListText(text, max), max)).text;
}

function extractConstraintCandidates(text) {
  const source = String(text || "");
  if (!/(must|only|never|do not|don't|required|constraint|禁止|必须|不要|只能|不允许|默认|保持|优先)/i.test(source)) {
    return [];
  }
  return [summarizeMessageForState(source, 320)];
}

function extractDecisionCandidates(text) {
  const source = String(text || "");
  if (!/(decide|decision|choose|chosen|use |adopt|决定|选择|采用|确认)/i.test(source)) return [];
  return [summarizeMessageForState(source, 280)];
}

function extractNextStepCandidates(text) {
  const source = String(text || "");
  if (!/(next|todo|follow.?up|remaining|下一步|待办|继续|后续)/i.test(source)) return [];
  return [summarizeMessageForState(source, 260)];
}

function commandSummary(command, record) {
  const cleanCommand = SecretRedactor.redactText(compact(command || record?.command || "command", 220)).text;
  const exitCode = record?.exitCode ?? 0;
  if (record?.status === "failed") {
    const lines = SecretRedactor.redactText(
      keyErrorLines([record.stderr, record.error, record.output].filter(Boolean).join("\n")).join(" | "),
    ).text;
    return `failed: ${cleanCommand} (exitCode ${exitCode})${lines ? `: ${lines}` : ""}`;
  }
  return `passed: ${cleanCommand} (exitCode ${exitCode})`;
}

function stateBudgetMaxChars(budget) {
  if (typeof budget === "number") return Math.max(800, Math.floor(budget));
  const source = budget && typeof budget === "object" ? budget : {};
  return Math.max(
    800,
    Math.floor(
      Number(source.stateMaxChars || source.taskStateMaxChars || source.maxChars || source.structuredStateMaxChars) ||
      Number(source.inputBudget || 0) * 4 ||
      12000,
    ),
  );
}

const TASK_STATE_FIELD_WEIGHTS = {
  task_goal: 0.06,
  current_phase: 0.03,
  constraints: 0.16,
  decisions: 0.13,
  completed: 0.08,
  open_issues: 0.18,
  files_changed: 0.10,
  commands_run: 0.12,
  current_focus: 0.04,
  next_steps: 0.10,
};

function trimItemsToChars(items, maxChars, preferRecent = false) {
  const source = preferRecent ? [...items].reverse() : [...items];
  const kept = [];
  let used = 0;
  for (const raw of source) {
    const item = markdownListText(raw, Math.max(120, maxChars));
    if (!item) continue;
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const trimmed = item.length > remaining ? compact(item, Math.max(80, remaining)) : item;
    if (!trimmed) break;
    kept.push(trimmed);
    used += trimmed.length + 2;
  }
  return preferRecent ? kept.reverse() : kept;
}

function applyTaskStateBudget(state, budget) {
  const normalized = normalizeTaskState(state);
  const maxChars = stateBudgetMaxChars(budget);
  const next = defaultTaskState();
  for (const field of TASK_STATE_FIELDS) {
    const fieldBudget = Math.max(120, Math.floor(maxChars * (TASK_STATE_FIELD_WEIGHTS[field] || 0.05)));
    if (Array.isArray(normalized[field])) {
      const preferRecent = ["commands_run", "files_changed", "open_issues", "next_steps"].includes(field);
      next[field] = trimItemsToChars(normalized[field], fieldBudget, preferRecent);
    } else {
      next[field] = compact(normalized[field], fieldBudget);
    }
  }
  return normalizeTaskState(next);
}

function compressTaskContext(events, budget = {}) {
  const state = defaultTaskState();
  const seenIds = new Set();
  const commandsByKey = new Map();
  const commandAliasByCommand = new Map();
  const openIssues = new Map();
  const commandIssues = new Map();
  let latestUser = "";
  let latestAssistant = "";
  let latestFocus = "";

  const sortedEvents = (Array.isArray(events) ? events : []).filter(Boolean);
  sortedEvents.forEach((raw, index) => {
    const id = contextEventId(raw, index);
    if (seenIds.has(id)) return;
    seenIds.add(id);
    const { entry, metadata, event } = eventEnvelope(raw);
    const type = String(event.type || metadata.eventType || entry.role || "").trim();
    const role = String(entry.role || "").trim();
    const content = String(entry.content || event.content || event.message || "").trim();

    if (role === "user" || type === "user") {
      latestUser = summarizeMessageForState(content || metadata.inputEnvelope?.text || "", 320);
      if (latestUser) latestFocus = latestUser;
      for (const item of extractConstraintCandidates(content)) addStateItem(state, "constraints", item);
      for (const item of extractDecisionCandidates(content)) addStateItem(state, "decisions", item);
      for (const item of extractNextStepCandidates(content)) addStateItem(state, "next_steps", item);
      return;
    }

    if (role === "assistant" || type === "assistant_message") {
      latestAssistant = summarizeMessageForState(content || event.content || "", 320);
      if (latestAssistant) {
        addStateItem(state, "completed", latestAssistant);
        latestFocus = latestAssistant;
      }
      for (const item of extractDecisionCandidates(latestAssistant)) addStateItem(state, "decisions", item);
      for (const item of extractNextStepCandidates(latestAssistant)) addStateItem(state, "next_steps", item);
      return;
    }

    if (type === "turn_digest" || type === "turn_summary") {
      if (event.user) latestUser = summarizeMessageForState(event.user, 320);
      if (event.assistant) latestAssistant = summarizeMessageForState(event.assistant, 320);
      if (event.goal) latestUser = summarizeMessageForState(event.goal, 320);
      if (latestUser) latestFocus = latestUser;
      if (latestAssistant) addStateItem(state, "completed", latestAssistant);
      for (const item of event.constraints || []) addStateItem(state, "constraints", item);
      for (const item of event.decisions || []) addStateItem(state, "decisions", item);
      for (const item of event.next_steps || event.nextSteps || []) addStateItem(state, "next_steps", item);
      for (const item of event.files || []) addStateItem(state, "files_changed", item);
      for (const item of event.commands || []) addStateItem(state, "commands_run", item);
      for (const item of event.errors || []) addOpenIssue(openIssues, `turn:${item}`, item);
      return;
    }

    if (type === "file_changed") {
      addStateItem(state, "files_changed", event.path || event.summary);
      latestFocus = event.path || latestFocus;
      return;
    }

    if (type === "error") {
      const issue = summarizeEventError(event) || summarizeMessageForState(content, 320);
      addOpenIssue(openIssues, `error:${id}`, issue);
      latestFocus = issue || latestFocus;
      return;
    }

    if (type === "command_start") {
      const key = commandRecordKey(event, index);
      const command = event.command || metadata.command || content;
      commandsByKey.set(key, { command, status: "running", output: "", stderr: "", error: "", exitCode: null });
      if (command) commandAliasByCommand.set(commandKey(command), key);
      return;
    }

    if (type === "command_output" || type === "tool_output") {
      const payload = outputPayloadFromEvent(event);
      const payloadObject = asObject(payload);
      const command = event.command || metadata.command || payloadObject?.command || "";
      const key = command
        ? (commandAliasByCommand.get(commandKey(command)) || commandKey(command))
        : commandRecordKey(event, index);
      const record = commandsByKey.get(key) || { command, status: "running", output: "", stderr: "", error: "", exitCode: null };
      record.command = record.command || command || metadata.command || event.name || "tool";
      record.output = compactMultiline([record.output, payloadObject?.stdout || payloadObject?.output || event.content || ""].filter(Boolean).join("\n"), 900);
      record.stderr = compactMultiline([record.stderr, stderrFromPayload(payload)].filter(Boolean).join("\n"), 900);
      record.error = compactMultiline([record.error, summarizeEventError(event)].filter(Boolean).join("\n"), 900);
      const code = eventExitCode(event, payload);
      if (code != null) record.exitCode = code;
      if (record.error || (record.exitCode != null && record.exitCode !== 0)) record.status = "failed";
      commandsByKey.set(key, record);
      if (record.command) commandAliasByCommand.set(commandKey(record.command), key);
      if (record.status === "failed") {
        const issueId = `command:${commandKey(record.command)}`;
        commandIssues.set(commandKey(record.command), issueId);
        addOpenIssue(openIssues, issueId, commandSummary(record.command, record));
      }
      return;
    }

    if (type === "command_end") {
      const command = event.command || metadata.command || "";
      const key = command
        ? (commandAliasByCommand.get(commandKey(command)) || commandKey(command))
        : commandRecordKey(event, index);
      const record = commandsByKey.get(key) || { command, status: "running", output: "", stderr: "", error: "", exitCode: null };
      record.command = record.command || command || "command";
      const code = eventExitCode(event);
      record.exitCode = code == null ? (event.success === false ? 1 : 0) : code;
      record.status = record.exitCode === 0 ? "passed" : "failed";
      commandsByKey.set(key, record);
      if (record.command) commandAliasByCommand.set(commandKey(record.command), key);
      const issueId = commandIssues.get(commandKey(record.command)) || `command:${commandKey(record.command)}`;
      if (record.status === "passed") {
        removeOpenIssue(openIssues, issueId);
      } else {
        commandIssues.set(commandKey(record.command), issueId);
        addOpenIssue(openIssues, issueId, commandSummary(record.command, record));
      }
    }
  });

  for (const record of commandsByKey.values()) {
    if (!record.command || record.status === "running") continue;
    addStateItem(state, "commands_run", commandSummary(record.command, record), 120);
  }

  state.task_goal = latestUser || state.task_goal || "";
  state.current_focus = latestFocus || latestAssistant || latestUser || "";
  state.current_phase = state.open_issues.length || openIssues.size
    ? "blocked"
    : state.completed.length || state.commands_run.length || state.files_changed.length
      ? "in_progress"
      : "not_started";
  state.open_issues = uniqueList([...state.open_issues, ...openIssues.values()], 80);
  if (!state.next_steps.length && state.open_issues.length) {
    addStateItem(state, "next_steps", "Resolve the current open issue before continuing.");
  }
  return applyTaskStateBudget(state, budget);
}

function inferCommandFromTool(event) {
  const input = event.input && typeof event.input === "object" ? event.input : {};
  const command = input.command || input.cmd || input.code || input.shell_command;
  if (typeof command !== "string" || !command.trim()) return null;
  const name = String(event.name || "").toLowerCase();
  if (
    name.includes("terminal") ||
    name.includes("shell") ||
    name.includes("command") ||
    name.includes("execute")
  ) {
    return command.trim();
  }
  return null;
}

function eventToolKey(event) {
  const metadata = event && typeof event.metadata === "object" ? event.metadata : {};
  return String(metadata.toolCallId || event.id || event.name || "").trim();
}

function inferFileChangedFromTool(event) {
  const name = String(event.name || "").toLowerCase();
  if (!/(file|write|edit|patch|apply|save|modify)/.test(name)) return null;
  const data = event.output && typeof event.output === "object" ? event.output : event.input;
  const candidates = [];
  if (data && typeof data === "object") {
    for (const key of ["path", "file", "filename", "target", "output_path"]) {
      if (typeof data[key] === "string" && data[key].trim()) {
        candidates.push(data[key].trim());
      }
    }
    if (Array.isArray(data.files)) {
      for (const item of data.files) {
        if (typeof item === "string" && item.trim()) candidates.push(item.trim());
        else if (item && typeof item === "object" && typeof item.path === "string") candidates.push(item.path.trim());
      }
    }
  }
  const file = candidates.find(Boolean);
  if (!file) return null;
  return {
    type: "file_changed",
    path: file,
    changeType: name.includes("delete") ? "delete" : "modify",
    summary: `Changed by ${event.name}`,
  };
}

module.exports = {
  RECENT_MESSAGE_LIMIT,
  RECENT_MESSAGE_CONTENT_LIMIT,
  DEFAULT_MODEL_CONTEXT_TOKENS,
  COMPACT_FORCE_RATIO,
  COMPACT_EMERGENCY_RATIO,
  RECENT_TURN_DIGEST_LIMIT,
  RECENT_TURN_DIGEST_MAX_CHARS,
  RECENT_CONVERSATION_MAX_CHARS,
  CONTEXT_RULE_MAX_CHARS,
  VALID_MESSAGE_ROLES,
  uniqueList,
  stripImmediateRequestTail,
  extractContextRuleContent,
  stripContextDirectiveLead,
  classifyContextDirective,
  normalizeDeliveryMode,
  normalizeRunMode,
  SecretRedactor,
  redact,
  cjkCharCount,
  estimateContextTokens,
  contextPercent,
  getContextBudget,
  shouldCompactContext,
  defaultTaskContextText,
  defaultTaskState,
  normalizeTaskState,
  renderTaskStateStructuredMarkdown,
  renderRecentTurnDigest,
  renderTaskContextMarkdown,
  parseTaskStateFromStructuredText,
  taskStatePathFromContextPath,
  taskEventsPathFromContextPath,
  readTaskStateFile,
  writeTaskStateFiles,
  hasTaskContextShape,
  stripTaskContextHeading,
  normalizeTaskContextText,
  splitTaskContext,
  recentTurnDigest,
  trimTaskContextRawLog,
  markdownBulletBlock,
  normalizeRuleKey,
  appendDedupeRules,
  projectWorkspaceOutputRule,
  markdownHeading,
  markdownSectionsByTitle,
  normalizeExtractedRule,
  isUsefulExtractedRule,
  extractedRulesFromMarkdownBlock,
  fallbackRulesFromNamedSections,
  labeledMarkdownBlock,
  explicitRulesFromRawTurnLog,
  extractRulesFromTaskContextText,
  toInt,
  toNumber,
  usageFromMetadata,
  mergeMetadata,
  normalizeUserInputStatus,
  createUserInputEnvelope,
  messageInputEnvelope,
  promptTextFromMessages,
  countOccurrences,
  scrubCurrentRequestEcho,
  completedRunIdsFromMessages,
  isControlEventMessage,
  isPromptHistoryMessage,
  renderPromptHistoryMessage,
  ToolLogSummarizer,
  parseMarkdownListSection,
  renderMarkdownList,
  TaskStateManager,
  ContextValidator,
  isImageMime,
  eventContent,
  emptyTurnArtifacts,
  asObject,
  tryParseJsonObject,
  outputPayloadFromEvent,
  truthyErrorValue,
  exitCodeFromValue,
  eventExitCode,
  stderrFromPayload,
  keyErrorLines,
  summarizeEventError,
  recordTurnArtifact,
  collectTurnArtifactFromEvent,
  seedAttachmentArtifacts,
  matchingKeywords,
  evidenceMatches,
  extractLightTags,
  eventEnvelope,
  contextEventId,
  commandKey,
  commandRecordKey,
  addStateItem,
  addOpenIssue,
  removeOpenIssue,
  summarizeMessageForState,
  extractConstraintCandidates,
  extractDecisionCandidates,
  extractNextStepCandidates,
  commandSummary,
  stateBudgetMaxChars,
  trimItemsToChars,
  applyTaskStateBudget,
  compressTaskContext,
  inferCommandFromTool,
  eventToolKey,
  inferFileChangedFromTool,
};
