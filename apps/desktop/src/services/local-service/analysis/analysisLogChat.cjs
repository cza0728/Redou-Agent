/**
 * analysisLogChat.cjs — AI-powered analysis log chat.
 *
 * Maintains per-session conversation history and calls the configured
 * model to answer questions about benchmark logs.
 */
const https = require("https");
const http = require("http");
const path = require("path");
const fs = require("fs");

// In-memory conversation store: sessionKey -> messages[]
const conversations = new Map();
const MAX_HISTORY = 40;

function getConversation(sessionKey) {
  if (!conversations.has(sessionKey)) {
    conversations.set(sessionKey, []);
  }
  return conversations.get(sessionKey);
}

function clearConversation(sessionKey) {
  conversations.delete(sessionKey);
}

function listConversations() {
  return [...conversations.keys()];
}

/**
 * Build a system prompt that includes the benchmark result summary.
 */
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

/**
 * Call an OpenAI-compatible chat completions API.
 */
function chatCompletion({ baseUrl, apiKey, model, messages, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, "") + "/chat/completions");
    const body = JSON.stringify({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.3,
    });
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message || JSON.stringify(json.error)));
            return;
          }
          const content = json.choices?.[0]?.message?.content || "";
          resolve(content);
        } catch (err) {
          reject(new Error(`Invalid API response: ${data.slice(0, 500)}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("API request timed out")); });
    req.write(body);
    req.end();
  });
}

/**
 * Resolve which model+key+url to use for the log chat.
 * Uses the same provider catalog logic as codex_adapter.
 */
function resolveChatModel(hermesHome) {
  // Try to read .env from hermesHome
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

  // Priority order of providers to try
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

/**
 * Main chat function called by the service layer.
 */
async function chatWithAnalysisLog({ sessionKey, userMessage, logDetail, locale, hermesHome }) {
  const resolved = resolveChatModel(hermesHome);
  if (!resolved) {
    throw new Error(
      locale === "zh"
        ? "没有可用的 AI 模型 API Key。请在配置中设置至少一个模型的 API Key（如 DEEPSEEK_API_KEY）。"
        : "No AI model API key available. Please configure at least one API key (e.g., DEEPSEEK_API_KEY).",
    );
  }

  const history = getConversation(sessionKey);
  const systemPrompt = buildSystemPrompt(logDetail, locale);

  // Add user message
  history.push({ role: "user", content: userMessage });

  // Trim history if too long
  while (history.length > MAX_HISTORY) {
    history.shift();
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  const reply = await chatCompletion({
    baseUrl: resolved.url,
    apiKey: resolved.key,
    model: resolved.model,
    messages,
  });

  history.push({ role: "assistant", content: reply });
  return { reply, model: resolved.model };
}

module.exports = {
  chatWithAnalysisLog,
  getConversation,
  clearConversation,
  listConversations,
};
