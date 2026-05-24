const GLOBAL_USER_FILE = "USER.md";
const GLOBAL_RULES_FILE = "GLOBAL_RULES.md";
const PROJECT_RULES_FILE = "PROJECT_RULES.md";
const TASK_RULES_FILE = "TASK_RULES.md";
const TASK_CONTEXT_FILE = "TASK_CONTEXT.md";
const TASK_STATE_FILE = "TASK_STATE.json";
const TASK_EVENTS_FILE = "events.jsonl";
const TASK_MESSAGES_FILE = "messages.jsonl";
const TASK_UPLOADS_DIR = "uploads";
const REDOU_CONTEXT_DIR = ".redou";
const REDOU_TASKS_DIR = "tasks";
const REDOU_SKILLS_DIR = "skills";
const REDOU_ANALYSIS_DIR = "analysis";
const PROFILE_RUNTIME_CONFIG_KEYS = [
  "model",
  "providers",
  "custom_providers",
  "model_aliases",
  "agent",
  "goals",
  "mcp_servers",
];
const DEFAULT_CHAT_PROJECT_NAME = "\u9ed8\u8ba4\u9879\u76ee";
const DEFAULT_CHAT_TASK_TITLE = "\u5f00\u59cb\u5bf9\u8bdd";

module.exports = {
  GLOBAL_USER_FILE,
  GLOBAL_RULES_FILE,
  PROJECT_RULES_FILE,
  TASK_RULES_FILE,
  TASK_CONTEXT_FILE,
  TASK_STATE_FILE,
  TASK_EVENTS_FILE,
  TASK_MESSAGES_FILE,
  TASK_UPLOADS_DIR,
  REDOU_CONTEXT_DIR,
  REDOU_TASKS_DIR,
  REDOU_SKILLS_DIR,
  REDOU_ANALYSIS_DIR,
  PROFILE_RUNTIME_CONFIG_KEYS,
  DEFAULT_CHAT_PROJECT_NAME,
  DEFAULT_CHAT_TASK_TITLE,
};
