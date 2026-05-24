import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type Locale } from "@/i18n";

const ZH_FIELD_LABELS: Record<string, string> = {
  model: "默认模型",
  model_context_length: "上下文窗口覆盖",
  "agent.max_iterations": "最大迭代次数",
  "agent.service_tier": "服务层级",
  "approvals.mode": "危险命令审批模式",
  "context.engine": "上下文管理引擎",
  "dashboard.language": "界面语言",
  "dashboard.theme": "界面主题",
  "delegation.reasoning_effort": "委托推理强度",
  "display.busy_input_mode": "运行时输入模式",
  "display.language": "CLI 与网关语言",
  "display.resume_display": "恢复会话显示方式",
  "display.skin": "CLI 外观主题",
  "human_delay.mode": "模拟输入延迟模式",
  "logging.level": "日志级别",
  "memory.provider": "记忆提供方",
  "stt.provider": "语音转文字提供方",
  "terminal.backend": "终端执行后端",
  "terminal.cwd": "工作目录",
  "terminal.modal_mode": "Modal 沙箱模式",
  "terminal.vercel_runtime": "Vercel 沙箱运行时",
  "tts.provider": "文字转语音提供方",
};

const ZH_WORDS: Record<string, string> = {
  active: "活跃",
  agent: "Agent",
  api: "API",
  approval: "审批",
  approvals: "审批",
  auto: "自动",
  backend: "后端",
  base: "基础",
  browser: "浏览器",
  cache: "缓存",
  checkpoints: "检查点",
  cli: "CLI",
  code: "代码",
  compression: "压缩",
  config: "配置",
  context: "上下文",
  cron: "定时任务",
  curator: "维护器",
  cwd: "工作目录",
  dashboard: "界面",
  debug: "调试",
  default: "默认",
  delegation: "委托",
  discord: "Discord",
  display: "显示",
  enabled: "启用",
  engine: "引擎",
  env: "环境变量",
  error: "错误",
  fallback: "备用",
  file: "文件",
  gateway: "网关",
  history: "历史",
  human: "人工",
  id: "ID",
  image: "图像",
  input: "输入",
  iterations: "迭代次数",
  key: "密钥",
  keys: "密钥",
  language: "语言",
  level: "级别",
  limit: "限制",
  logging: "日志",
  max: "最大",
  memory: "记忆",
  mcp: "MCP",
  mode: "模式",
  model: "模型",
  oauth: "OAuth",
  output: "输出",
  path: "路径",
  profile: "配置档",
  profiles: "配置档",
  prompt: "提示词",
  provider: "提供方",
  reasoning: "推理",
  resume: "恢复",
  safety: "安全",
  search: "搜索",
  security: "安全",
  service: "服务",
  session: "会话",
  sessions: "会话",
  skin: "外观主题",
  stt: "语音转文字",
  terminal: "终端",
  tier: "层级",
  timeout: "超时",
  tool: "工具",
  tools: "工具",
  tts: "文字转语音",
  ui: "界面",
  url: "URL",
  user: "用户",
  value: "值",
  voice: "语音",
  web: "网页",
  yaml: "YAML",
};

const ZH_DESCRIPTIONS: Record<string, string> = {
  model: "新会话默认使用的模型，例如 anthropic/claude-sonnet-4.6。",
  model_context_length: "可选的上下文窗口覆盖值。0 表示根据模型元数据自动检测。",
  "agent.service_tier": "API 服务层级，适用于支持该参数的提供方。",
  "approvals.mode": "遇到危险命令时的审批方式。",
  "context.engine": "上下文管理引擎。",
  "dashboard.language": "Redou 桌面界面语言。",
  "dashboard.theme": "Redou 桌面界面主题。",
  "delegation.reasoning_effort": "委托子 Agent 使用的推理强度。",
  "display.busy_input_mode": "Agent 运行中继续输入消息时的处理方式。",
  "display.language": "CLI 与消息网关使用的界面语言。",
  "display.resume_display": "恢复会话时如何显示历史记录。",
  "display.skin": "CLI 视觉主题。",
  "human_delay.mode": "模拟真人输入延迟的模式。",
  "logging.level": "agent.log 的日志级别。",
  "memory.provider": "记忆插件提供方。",
  "stt.provider": "语音转文字提供方。",
  "terminal.backend": "终端命令执行后端。",
  "terminal.modal_mode": "Modal 沙箱模式。",
  "terminal.vercel_runtime": "Vercel Sandbox 运行时。",
  "tts.provider": "文字转语音提供方。",
};

const ZH_OPTIONS: Record<string, string> = {
  "": "无",
  ask: "询问",
  ares: "Ares",
  auto: "自动",
  builtin: "内置",
  custom: "自定义",
  daytona: "Daytona",
  default: "默认",
  deny: "拒绝",
  docker: "Docker",
  edge: "Edge",
  elevenlabs: "ElevenLabs",
  en: "English",
  fixed: "固定延迟",
  flex: "Flex",
  full: "完整",
  function: "函数",
  high: "高",
  honcho: "Honcho",
  interrupt: "打断",
  local: "本地",
  low: "低",
  medium: "中",
  minimal: "精简",
  mistral: "Mistral",
  modal: "Modal",
  mono: "Mono",
  neutts: "NeuTTS",
  node22: "Node 22",
  node24: "Node 24",
  off: "关闭",
  openai: "OpenAI",
  "python3.13": "Python 3.13",
  queue: "排队",
  sandbox: "沙箱",
  singularity: "Singularity",
  slate: "Slate",
  ssh: "SSH",
  steer: "引导",
  typing: "模拟输入",
  vercel_sandbox: "Vercel Sandbox",
  yolo: "自动允许",
  zh: "中文",
};

function titleCase(text: string): string {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeKeyPart(part: string, locale: Locale): string {
  if (locale !== "zh") return titleCase(part);
  return part
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => ZH_WORDS[token.toLowerCase()] ?? token)
    .join("");
}

function fieldLabel(schemaKey: string, locale: Locale, fallback?: string): string {
  if (locale !== "zh") return titleCase(fallback ?? schemaKey.split(".").pop() ?? schemaKey);
  if (ZH_FIELD_LABELS[schemaKey]) return ZH_FIELD_LABELS[schemaKey];
  const raw = fallback ?? schemaKey.split(".").pop() ?? schemaKey;
  return humanizeKeyPart(raw, locale);
}

function generatedDescription(schemaKey: string, separator: " -> " | " → "): string {
  return schemaKey
    .replaceAll(".", separator)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldDescription(
  schemaKey: string,
  description: string,
  locale: Locale,
): string {
  if (!description || locale !== "zh") return description;
  if (ZH_DESCRIPTIONS[schemaKey]) return ZH_DESCRIPTIONS[schemaKey];
  if (
    description === generatedDescription(schemaKey, " -> ") ||
    description === generatedDescription(schemaKey, " → ")
  ) {
    return schemaKey
      .split(".")
      .map((part) => fieldLabel(part, locale, part))
      .join(" → ");
  }
  return description;
}

function optionLabel(value: string, locale: Locale): string {
  if (locale !== "zh") return value || "(none)";
  const translated = ZH_OPTIONS[value];
  if (!translated) return value || "无";
  return value && translated !== value ? `${translated} (${value})` : translated;
}

function FieldHint({ schema, schemaKey }: { schema: Record<string, unknown>; schemaKey: string }) {
  const { locale } = useI18n();
  const keyPath = schemaKey.includes(".") ? schemaKey : "";
  const rawDescription =
    locale === "zh" && schema.description_zh
      ? schema.description_zh
      : schema.description;
  const description = rawDescription
    ? fieldDescription(schemaKey, String(rawDescription), locale)
    : "";

  if (!keyPath && !description) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {keyPath && <span className="text-[10px] font-mono text-muted-foreground/50">{keyPath}</span>}
      {description && <span className="text-xs text-muted-foreground/70">{description}</span>}
    </div>
  );
}

export function AutoField({
  schemaKey,
  schema,
  value,
  onChange,
}: AutoFieldProps) {
  const { locale } = useI18n();
  const rawLabel = schemaKey.split(".").pop() ?? schemaKey;
  const configuredLabel =
    locale === "zh" && schema.label_zh
      ? String(schema.label_zh)
      : schema.label
        ? String(schema.label)
        : "";
  const label = configuredLabel || fieldLabel(schemaKey, locale, rawLabel);
  const readonly = schema.readonly === true;
  const listPlaceholder = locale === "zh" ? "逗号分隔的值" : "comma-separated values";

  if (schema.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label className="text-sm">{label}</Label>
          <FieldHint schema={schema} schemaKey={schemaKey} />
        </div>
        <Switch checked={!!value} onCheckedChange={(checked) => !readonly && onChange(checked)} disabled={readonly} />
      </div>
    );
  }

  if (schema.type === "select") {
    const options = (schema.options as string[]) ?? [];
    return (
      <div className="grid gap-1.5">
        <Label className="text-sm">{label}</Label>
        <FieldHint schema={schema} schemaKey={schemaKey} />
        <Select value={String(value ?? "")} onValueChange={(v) => !readonly && onChange(v)} disabled={readonly}>
          {options.map((opt) => (
            <SelectOption key={opt} value={opt}>
              {optionLabel(opt, locale)}
            </SelectOption>
          ))}
        </Select>
      </div>
    );
  }

  if (schema.type === "number") {
    return (
      <div className="grid gap-1.5">
        <Label className="text-sm">{label}</Label>
        <FieldHint schema={schema} schemaKey={schemaKey} />
        <Input
          type="number"
          min={typeof schema.min === "number" ? schema.min : undefined}
          max={typeof schema.max === "number" ? schema.max : undefined}
          disabled={readonly}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            if (readonly) return;
            const raw = e.target.value;
            if (raw === "") {
              onChange(0);
              return;
            }
            const n = Number(raw);
            if (!Number.isNaN(n)) {
              onChange(n);
            }
          }}
        />
      </div>
    );
  }

  if (schema.type === "text") {
    return (
      <div className="grid gap-1.5">
        <Label className="text-sm">{label}</Label>
        <FieldHint schema={schema} schemaKey={schemaKey} />
        <textarea
          className="flex min-h-[80px] w-full border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          disabled={readonly}
          value={String(value ?? "")}
          onChange={(e) => !readonly && onChange(e.target.value)}
        />
      </div>
    );
  }

  if (schema.type === "list") {
    return (
      <div className="grid gap-1.5">
        <Label className="text-sm">{label}</Label>
        <FieldHint schema={schema} schemaKey={schemaKey} />
        <Input
          value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
          disabled={readonly}
          onChange={(e) =>
            !readonly && onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          placeholder={listPlaceholder}
        />
      </div>
    );
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return (
      <div className="grid gap-3 border border-border p-3">
        <Label className="text-xs font-medium">{label}</Label>
        <FieldHint schema={schema} schemaKey={schemaKey} />
        {Object.entries(obj).map(([subKey, subVal]) => (
          <div key={subKey} className="grid gap-1">
            <Label className="text-xs text-muted-foreground">
              {fieldLabel(`${schemaKey}.${subKey}`, locale, subKey)}
            </Label>
            <Input
              value={String(subVal ?? "")}
              disabled={readonly}
              onChange={(e) => !readonly && onChange({ ...obj, [subKey]: e.target.value })}
              className="text-xs"
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label className="text-sm">{label}</Label>
      <FieldHint schema={schema} schemaKey={schemaKey} />
      <Input disabled={readonly} value={String(value ?? "")} onChange={(e) => !readonly && onChange(e.target.value)} />
    </div>
  );
}

interface AutoFieldProps {
  schemaKey: string;
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (v: unknown) => void;
}
