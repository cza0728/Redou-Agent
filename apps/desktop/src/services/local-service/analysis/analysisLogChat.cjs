/**
 * analysisLogChat.cjs — AI-powered analysis log chat.
 *
 * Memory strategy: **Progressive LLM summarization + file persistence**.
 *
 * Instead of sending the full conversation each time (wastes tokens),
 * we keep a compact rolling summary of older exchanges and only send:
 *   [system prompt, conversation summary, last RECENT_WINDOW messages]
 *
 * After every COMPRESS_THRESHOLD new messages, the LLM is asked to
 * compress older messages into the existing summary.  The session state
 * (summary + recent messages) is persisted to a JSON file so it
 * survives app restarts.
 *
 * Token usage per request ≈ system prompt + ~200 words summary + 4 messages.
 */
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

// ── tuning constants ──
const RECENT_WINDOW = 4;          // keep last N messages verbatim
const COMPRESS_THRESHOLD = 6;     // compress when recent messages exceed this
const SUMMARY_MAX_TOKENS = 512;   // max tokens for the summarization call

// ── in-memory cache (avoids re-reading disk every call) ──
const sessionCache = new Map();

// ── persistence helpers ──

function chatDir(analysisRoot) {
  const dir = path.join(analysisRoot, "chat");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionFilePath(analysisRoot, sessionKey) {
  const safe = String(sessionKey).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return path.join(chatDir(analysisRoot), `${safe}.json`);
}

function loadSession(analysisRoot, sessionKey) {
  if (sessionCache.has(sessionKey)) return sessionCache.get(sessionKey);
  const filePath = sessionFilePath(analysisRoot, sessionKey);
  let session = { sessionKey, summary: "", recentMessages: [], totalRounds: 0 };
  try {
    if (fs.existsSync(filePath)) {
      session = { ...session, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
    }
  } catch { /* corrupted file — start fresh */ }
  sessionCache.set(sessionKey, session);
  return session;
}

function saveSession(analysisRoot, sessionKey, session) {
  sessionCache.set(sessionKey, session);
  try {
    const filePath = sessionFilePath(analysisRoot, sessionKey);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf8");
  } catch { /* best effort */ }
}

function clearConversation(analysisRoot, sessionKey) {
  sessionCache.delete(sessionKey);
  try {
    const filePath = sessionFilePath(analysisRoot, sessionKey);
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch { /* best effort */ }
}

// ── system prompt builder ──

function buildSystemPrompt(logDetail, locale) {
  const lang = locale === "zh" ? "zh" : "en";
  const result = logDetail?.result;
  if (!result) {
    return lang === "zh"
      ? "你是一个AI助手，帮助用户分析模型评测日志。用户还没有选择具体的日志。"
      : "You are an AI assistant helping users analyze model benchmark logs. No log is selected yet.";
  }

  const taskSummaries = (result.tasks || []).map((task) => {
    const sections = (task.sections || []).map((s) => `  - ${s.label}: ${s.score}/100 ${s.evidence || ""}`).join("\n");
    return [
      `### ${task.id.toUpperCase()}: ${task.title}`,
      `状态: ${task.status}, 得分: ${task.score}, 耗时: ${Math.round((task.durationMs || 0) / 1000)}s`,
      `Input tokens: ${task.inputTokens || 0}, Output tokens: ${task.outputTokens || 0}, API calls: ${task.apiCalls || 0}`,
      task.error ? `错误: ${task.error}` : "",
      sections ? `评分细节:\n${sections}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const events = (logDetail.events || []).slice(-30).map((e) => {
    const meta = e.metadata?.event || e;
    return `[${meta.type || e.role || "?"}] ${meta.content || e.content || JSON.stringify(meta).slice(0, 200)}`;
  }).join("\n");

  return [
    lang === "zh"
      ? "你是一个AI助手，专门帮助用户分析模型评测（benchmark）日志。请根据以下评测结果回答用户的问题。如果用户问某道题为什么分数低或失败，请仔细分析任务详情和错误信息。回答请使用中文。"
      : "You are an AI assistant analyzing model benchmark logs. Answer based on the data below.",
    "",
    `## 评测概要`,
    `模型: ${result.model} (${result.provider})`,
    `状态: ${result.status}`,
    `总耗时: ${Math.round((result.totals?.durationMs || 0) / 1000)}s`,
    `总 tokens: input=${result.totals?.inputTokens || 0}, output=${result.totals?.outputTokens || 0}`,
    `API calls: ${result.totals?.apiCalls || 0}`,
    result.summary ? `摘要: ${result.summary}` : "",
    "",
    `## 各任务详情`,
    taskSummaries,
    "",
    events.length > 0 ? `## 事件日志 (最近30条)\n${events}` : "",
  ].filter((l) => l !== undefined).join("\n");
}

// ── LLM call ──

function chatCompletion({ baseUrl, apiKey, model, messages, maxTokens = 2048, temperature = 0.3, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, "") + "/chat/completions");
    const body = JSON.stringify({ model, messages, max_tokens: maxTokens, temperature });
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      timeout,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) { reject(new Error(json.error.message || JSON.stringify(json.error))); return; }
          resolve(json.choices?.[0]?.message?.content || "");
        } catch { reject(new Error(`Invalid API response: ${data.slice(0, 500)}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("API request timed out")); });
    req.write(body);
    req.end();
  });
}

// ── progressive summarization ──

async function compressHistory(resolved, session, locale) {
  // Take everything except the last RECENT_WINDOW messages and compress
  const toCompress = session.recentMessages.slice(0, -RECENT_WINDOW);
  const toKeep = session.recentMessages.slice(-RECENT_WINDOW);
  if (toCompress.length === 0) return;

  const oldPairs = toCompress.map((m) => `[${m.role}]: ${m.content}`).join("\n");
  const existing = session.summary ? `之前的摘要:\n${session.summary}\n\n` : "";

  const compressPrompt = locale === "zh"
    ? [
        "请将以下对话历史压缩成一段简洁的摘要（200字以内）。",
        "保留关键问题、结论、用户关注点。去掉寒暄和重复内容。只输出摘要，不要加任何前缀。",
        "",
        existing,
        "新的对话内容:",
        oldPairs,
      ].join("\n")
    : [
        "Compress the conversation below into a concise summary (under 200 words).",
        "Keep key questions, conclusions, and user concerns. Output only the summary.",
        "",
        existing,
        "New conversation:",
        oldPairs,
      ].join("\n");

  try {
    const newSummary = await chatCompletion({
      baseUrl: resolved.url,
      apiKey: resolved.key,
      model: resolved.model,
      messages: [{ role: "user", content: compressPrompt }],
      maxTokens: SUMMARY_MAX_TOKENS,
      temperature: 0.1,
    });
    session.summary = newSummary.trim();
    session.recentMessages = toKeep;
  } catch {
    // If summarization fails, just hard-trim to keep things bounded
    session.recentMessages = toKeep;
  }
}

// ── model resolution ──

function resolveChatModel(hermesHome) {
  const envVars = {};
  try {
    const envPath = path.join(hermesHome, ".env");
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)/);
        if (match) envVars[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* ignore */ }

  const env = (key) => process.env[key] || envVars[key] || "";

  const providers = [
    { model: "deepseek-chat", key: env("DEEPSEEK_API_KEY"), url: env("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1" },
    { model: "mimo-v2.5-pro", key: env("XIAOMI_API_KEY"), url: env("XIAOMI_BASE_URL") || "https://api.xiaomimimo.com/v1" },
    { model: "glm-5", key: env("GLM_API_KEY"), url: env("GLM_BASE_URL") || "https://api.z.ai/api/paas/v4" },
    { model: "kimi-k2.5", key: env("KIMI_CN_API_KEY"), url: "https://api.moonshot.cn/v1" },
    { model: "gpt-4.1", key: env("OPENAI_API_KEY"), url: "https://api.openai.com/v1" },
    { model: "qwen3.6-plus", key: env("DASHSCOPE_API_KEY"), url: env("DASHSCOPE_BASE_URL") || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  ];

  for (const p of providers) {
    if (p.key) return p;
  }
  return null;
}

// ── main entry point ──

async function chatWithAnalysisLog({ sessionKey, userMessage, logDetail, locale, hermesHome, analysisRoot }) {
  const resolved = resolveChatModel(hermesHome);
  if (!resolved) {
    throw new Error(
      locale === "zh"
        ? "没有可用的 AI 模型 API Key。请在配置中设置至少一个模型的 API Key（如 DEEPSEEK_API_KEY）。"
        : "No AI model API key available. Please configure at least one API key (e.g., DEEPSEEK_API_KEY).",
    );
  }

  const root = analysisRoot || path.join(hermesHome, "..", "analysis");
  const session = loadSession(root, sessionKey);

  // 1. Append user message
  session.recentMessages.push({ role: "user", content: userMessage });
  session.totalRounds++;

  // 2. Compress if recent messages exceed threshold
  if (session.recentMessages.length > COMPRESS_THRESHOLD) {
    await compressHistory(resolved, session, locale);
  }

  // 3. Build messages array: system + summary context + recent
  const systemPrompt = buildSystemPrompt(logDetail, locale);
  const messages = [{ role: "system", content: systemPrompt }];

  if (session.summary) {
    messages.push({
      role: "system",
      content: (locale === "zh" ? "以下是之前对话的摘要:\n" : "Summary of prior conversation:\n") + session.summary,
    });
  }

  messages.push(...session.recentMessages);

  // 4. Call LLM
  const reply = await chatCompletion({
    baseUrl: resolved.url,
    apiKey: resolved.key,
    model: resolved.model,
    messages,
  });

  // 5. Append assistant reply and persist
  session.recentMessages.push({ role: "assistant", content: reply });
  saveSession(root, sessionKey, session);

  return { reply, model: resolved.model };
}

function getConversationHistory(analysisRoot, sessionKey) {
  const session = loadSession(analysisRoot, sessionKey);
  return { messages: session.recentMessages || [], summary: session.summary || "" };
}

module.exports = {
  chatWithAnalysisLog,
  clearConversation,
  getConversationHistory,
};
