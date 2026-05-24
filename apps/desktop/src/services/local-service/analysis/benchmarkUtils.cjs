const fs = require("fs");
const path = require("path");
const { readJson, readText, readTextFirst } = require("../shared/fileUtils.cjs");
const { compact, compactMultiline, safeSegment } = require("../shared/textUtils.cjs");
const { topLevelYamlBlock, yamlScalar } = require("../shared/yamlUtils.cjs");

const REDOU_CONTEXT_DIR = ".redou";
const REDOU_ANALYSIS_DIR = "analysis";

const ANALYSIS_RESULTS_FILE = "model-benchmarks.json";
const ANALYSIS_DEFAULT_MAX_ITERATIONS = 1000;
const ANALYSIS_DOCKER_WORKSPACE = "/workspace";
const ANALYSIS_WORKSPACE_PROJECT_ID = "model-benchmarks";
const ANALYSIS_WORKSPACE_PROJECT_NAME = "Model Benchmarks";
const ANALYSIS_WORKSPACE_TASK_KIND = "analysis_benchmark";
const ANALYSIS_ABILITY_KEYS = [
  "environmentConstraints",
  "projectDelivery",
  "debugRepair",
  "frameworkExtension",
  "parsingEdgeCases",
  "verificationIteration",
  "researchProduct",
  "documentationReproducibility",
];
const ANALYSIS_TASKS = [
  {
    id: "task1",
    file: "task1.md",
    title: "Docker environment lab",
    capability: "environment",
  },
  {
    id: "task2",
    file: "task2.md",
    title: "Small project build",
    capability: "implementation",
  },
  {
    id: "task3",
    file: "task3.md",
    title: "Debug and repair loop",
    capability: "debugging",
  },
  {
    id: "task4",
    file: "task4.md",
    title: "Research and product plan",
    capability: "research",
  },
  {
    id: "task5",
    file: "task5.md",
    title: "Peewee ORM industrial bug fixing",
    capability: "debugging",
  },
  {
    id: "task6",
    file: "task6.md",
    title: "Bottle plugin extension",
    capability: "framework",
  },
  {
    id: "task7",
    file: "task7.md",
    title: "Markdown parser implementation",
    capability: "parsing",
  },
  {
    id: "task8",
    file: "task8.md",
    title: "Click CLI framework bug fixing",
    capability: "debugging",
  },
  {
    id: "task9",
    file: "task9.md",
    title: "Jinja2 custom extension development",
    capability: "framework",
  },
];
const ANALYSIS_MIGRATED_WORKING_COPY_POINTS = 10;
const ANALYSIS_MIGRATED_TEST_POINTS = 75;
const ANALYSIS_MIGRATED_REPORT_POINTS = 15;

function clampScore(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function modelBenchmarkKey(provider, model) {
  const providerPart = safeSegment(provider || "auto", "auto");
  const modelPart = safeSegment(model || "default", "default");
  return `${providerPart}--${modelPart}`.slice(0, 160);
}

function pathExists(root, relativePath) {
  return fs.existsSync(path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean)));
}

function readRelativeText(root, relativePath) {
  return readText(path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean)));
}

function readRelativeJson(root, relativePath) {
  const text = readRelativeText(root, relativePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function joinRelativePath(root, relativePath) {
  return path.join(root, ...String(relativePath || "").split(/[\\/]+/).filter(Boolean));
}

function pathExistsAny(root, relativePaths) {
  return relativePaths.some((candidate) => fs.existsSync(joinRelativePath(root, candidate)));
}

function readRelativeTextAny(root, relativePaths) {
  for (const candidate of relativePaths) {
    const text = readText(joinRelativePath(root, candidate));
    if (text) return text;
  }
  return "";
}

function firstExistingRelativePath(root, relativePaths) {
  for (const candidate of relativePaths) {
    const fullPath = joinRelativePath(root, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  return joinRelativePath(root, relativePaths[0] || "");
}

function listFilesRecursive(dir, limit = 400) {
  const files = [];
  const visit = (current) => {
    if (files.length >= limit || !fs.existsSync(current)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        visit(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  visit(dir);
  return files;
}

function hasAny(text, patterns) {
  const value = String(text || "");
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : value.includes(String(pattern)),
  );
}

function isAnalysisModelCallFailure(text) {
  return hasAny(text, [
    /API call failed after \d+ retries/i,
    /\bRateLimitError\b/i,
    /\brate_limit_error\b/i,
    /\busage limit exceeded\b/i,
    /\bStream stalled mid tool-call\b/i,
    /\bStream interrupted before completion\b/i,
    /\bPartial stream dropped tool call/i,
    /\bPartial stream delivered before error\b/i,
    /\bStreaming failed after partial delivery\b/i,
  ]);
}

function commandText(events) {
  return events
    .filter((event) => event && (event.type === "command_start" || event.type === "tool_start"))
    .map((event) => event.command || JSON.stringify(event.input || {}) || "")
    .join("\n");
}

function sectionScore(id, label, score, evidence = "") {
  return {
    id,
    label,
    score: clampScore(score),
    evidence: compact(evidence, 260),
  };
}

function averageScore(items) {
  const scores = items.map((item) => Number(item.score || 0));
  if (scores.length === 0) return 0;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function analysisTestCounts(summary) {
  const judge = summary?.judge_result || {};
  const passedCount = Number(judge.passed_count);
  const total = Number(judge.total);
  const failedCount = Number(judge.failed_count || 0);
  const errorCount = Number(judge.error_count || 0);
  if (Number.isFinite(passedCount) && Number.isFinite(total) && total > 0) {
    const executedTotal = passedCount +
      (Number.isFinite(failedCount) ? failedCount : 0) +
      (Number.isFinite(errorCount) ? errorCount : 0);
    const adjustedTotal = Math.max(total, executedTotal);
    return { passedCount, total, adjustedTotal, failedCount, errorCount };
  }
  return null;
}

function analysisTestPassRatio(summary) {
  const counts = analysisTestCounts(summary);
  if (counts) {
    const { passedCount, adjustedTotal } = counts;
    return Math.max(0, Math.min(1, passedCount / adjustedTotal));
  }
  const judge = summary?.judge_result || {};
  const metric = Number(summary?.current_metric ?? judge.metric ?? 0);
  return Number.isFinite(metric) ? Math.max(0, Math.min(1, metric)) : 0;
}

function analysisMigratedTaskNumber(taskId) {
  const migratedMatch = /^task([5-9])$/.exec(String(taskId || ""));
  return migratedMatch ? migratedMatch[1] : "";
}

function analysisMigratedReportPoints(reportText) {
  const byteLength = Buffer.byteLength(String(reportText || ""), "utf8");
  if (byteLength > 1000) return ANALYSIS_MIGRATED_REPORT_POINTS;
  if (byteLength > 300) return 8;
  return 0;
}

function analysisMigratedReportScore(reportText) {
  return (analysisMigratedReportPoints(reportText) / ANALYSIS_MIGRATED_REPORT_POINTS) * 100;
}

function analysisMigratedWorkingCopyPoints(runDir, runFiles, summary) {
  if (!runDir || !fs.existsSync(runDir)) return 0;
  let score = 6;
  if (Array.isArray(runFiles) && runFiles.length > 0) score += 2;
  if (summary?.original_source_unchanged === true) score += 2;
  return Math.min(ANALYSIS_MIGRATED_WORKING_COPY_POINTS, score);
}

function analysisTaskProcessStatus({
  stopped = false,
  childError = null,
  exitCode = 0,
  modelCallFailed = false,
  postProcessFailed = false,
  hasEvaluation = false,
  evaluationRequired = false,
} = {}) {
  if (stopped) return "interrupted";
  if (childError || modelCallFailed || postProcessFailed) return "failed";
  if (exitCode != null && exitCode !== 0 && !hasEvaluation) return "failed";
  if (evaluationRequired && !hasEvaluation) return "failed";
  return "completed";
}

function normalizeAnalysisTaskStatus(task, { score = 0, sections = [], gradeLogText = "", migratedSummary = null } = {}) {
  const status = String(task?.status || "pending");
  if (status !== "failed") return status;
  const summaryText = `${task?.summary || ""}\n${task?.error || ""}`;
  if (isAnalysisModelCallFailure(summaryText)) return status;
  const realSections = Array.isArray(sections)
    ? sections.filter((section) => String(section?.id || "") !== "fixed_evaluator")
    : [];
  const hasEvaluation =
    Boolean(migratedSummary) ||
    analysisFinalScoreFromLog(gradeLogText) != null ||
    realSections.length > 0 ||
    Number(score || 0) > 0;
  return hasEvaluation ? "completed" : status;
}

function analysisTaskGradeLogText(workspacePath, taskId) {
  const id = String(taskId || "").trim();
  if (!workspacePath || !id) return "";
  const logName = `${id}_grade_all.log`;
  return readTextFirst([
    path.join(analysisDisplayResultsDir(workspacePath), id, logName),
    path.join(workspacePath, "logs", logName),
    path.join(workspacePath, "reports", logName),
  ]);
}

function analysisFinalScoreFromLog(logText) {
  const match = String(logText || "").match(/Final Score:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return null;
  const score = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return null;
  return clampScore((score / max) * 100);
}

const ANALYSIS_GRADE_SECTION_MAP = {
  task1: {
    "Task1 Phase 1: Files": [{ id: "workspace_structure", label: "Workspace structure" }],
    "Task1 Phase 2: Compose Service": [{ id: "compose_contract", label: "Docker compose contract" }],
    "Task1 Phase 3: Toolchain": [{ id: "environment_verification", label: "Environment verification" }],
    "Task1 Phase 4: Workspace Mount": [{ id: "mount_evidence", label: "Workspace mount evidence" }],
    "Task1 Phase 5: Docs": [{ id: "documentation", label: "README and ENV report" }],
  },
  task2: {
    "Phase 0: Environment": [{ id: "container_execution", label: "Container execution" }],
    "Phase 1: Scaffold": [{ id: "project_created", label: "Project files" }],
    "Phase 2: Data Logic": [{ id: "persistence", label: "Persistence and data logic" }],
    "Phase 3: UI and Build": [{ id: "features", label: "Task board UI and build" }],
    "Phase 4: Runtime Curl": [{ id: "verification", label: "Runtime verification" }],
    "Phase 5: Report": [{ id: "report", label: "Delivery report" }],
  },
  task3: {
    "Task3 Phase 0: Environment": [{ id: "container_execution", label: "Container-only commands" }],
    "Task3 Phase 1: Scaffold": [{ id: "project_created", label: "Library project" }],
    "Task3 Phase 2: Initial Failure": [{ id: "tests_created", label: "Tests and initial failure" }],
    "Task3 Phase 3: Final Pass": [{ id: "bug_loop", label: "Failing-to-passing loop" }],
    "Task3 Phase 4: Behavior": [{ id: "function_coverage", label: "Required utility coverage" }],
    "Task3 Phase 5: Report": [{ id: "log_report", label: "Log and report" }],
  },
  task4: {
    "Task4 Phase 0: Environment": [{ id: "environment", label: "Environment" }],
    "Task4 Phase 1: Sources and Notes": [{ id: "sources", label: "Sources and notes" }],
    "Task4 Phase 2: Report and Comparison": [{ id: "comparison", label: "Report and comparison" }],
    "Task4 Phase 3: Product Design": [{ id: "product_plan", label: "Product plan" }],
    "Task4 Phase 4: Citation Quality": [{ id: "citation_quality", label: "Citation quality" }],
    "Task4 Phase 5: Delivery": [
      { id: "report_saved", label: "Research report saved" },
      { id: "container_check", label: "Container file check" },
    ],
  },
};

function analysisPhaseScoresFromLog(logText) {
  const phases = [];
  let current = null;
  for (const line of String(logText || "").split(/\r?\n/)) {
    const running = line.match(/^Running\s+(.+?)\s+\(([0-9]+(?:\.[0-9]+)?)\s+pts\)\s*$/i);
    if (running) {
      current = {
        name: running[1].trim(),
        points: Number(running[2]),
        awarded: null,
        status: "",
      };
      phases.push(current);
      continue;
    }
    const result = line.match(/^(.+?)\s+(PASS|FAIL|PARTIAL):\s*\+([0-9]+(?:\.[0-9]+)?)\s*$/i);
    if (!result) continue;
    const name = result[1].trim();
    const phase = [...phases].reverse().find((item) => item.name === name && item.awarded == null) ||
      (current?.awarded == null ? current : null);
    if (!phase) continue;
    phase.awarded = Number(result[3]);
    phase.status = result[2].toUpperCase();
  }
  return phases.filter((phase) => phase.awarded != null && phase.points > 0);
}

function analysisTaskSectionsFromGradeLog(taskId, logText) {
  const map = ANALYSIS_GRADE_SECTION_MAP[taskId];
  if (!map) return [];
  const sections = [];
  for (const phase of analysisPhaseScoresFromLog(logText)) {
    const mapped = map[phase.name];
    if (!mapped) continue;
    const score = (Number(phase.awarded) / Number(phase.points)) * 100;
    for (const section of mapped) {
      sections.push(sectionScore(
        section.id,
        section.label,
        score,
        `${phase.name}: ${phase.status} +${phase.awarded}/${phase.points}`,
      ));
    }
  }
  return sections;
}

function analysisLatestMigratedTaskSummary(workspacePath, modelRunName, taskId) {
  const taskNumber = analysisMigratedTaskNumber(taskId);
  if (!workspacePath || !modelRunName || !taskNumber) return null;
  const resultsDir = joinRelativePath(workspacePath, `model_runs/${modelRunName}/results`);
  let entries = [];
  try {
    entries = fs.readdirSync(resultsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(new RegExp(`^task${taskNumber}_submit_(\\d+)_summary\\.json$`));
    if (!match) continue;
    const fullPath = path.join(resultsDir, entry.name);
    const summary = readJson(fullPath);
    if (!summary) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(fullPath).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    candidates.push({ summary, submitIndex: Number(match[1]), mtimeMs });
  }
  candidates.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (b.submitIndex - a.submitIndex));
  return candidates[0]?.summary || null;
}

function analysisMigratedTaskScore(taskId, workspacePath, modelRunName, summary) {
  const taskNumber = analysisMigratedTaskNumber(taskId);
  if (!workspacePath || !modelRunName || !taskNumber || !summary) return null;
  const runDir = path.join(workspacePath, "model_runs", modelRunName, `task${taskNumber}`);
  const runFiles = listFilesRecursive(runDir, 220);
  const report = readRelativeText(workspacePath, `model_runs/${modelRunName}/results/task${taskNumber}_report.md`);
  const workingCopyPoints = analysisMigratedWorkingCopyPoints(runDir, runFiles, summary);
  const testPoints = analysisTestPassRatio(summary) * ANALYSIS_MIGRATED_TEST_POINTS;
  const reportPoints = analysisMigratedReportPoints(report);
  return clampScore(workingCopyPoints + testPoints + reportPoints);
}

function analysisMigratedTaskSectionsFromSummary(taskId, workspacePath, modelRunName, summary) {
  const taskNumber = analysisMigratedTaskNumber(taskId);
  if (!workspacePath || !modelRunName || !taskNumber || !summary) return [];
  const runRel = `model_runs/${modelRunName}/task${taskNumber}`;
  const resultsRel = `model_runs/${modelRunName}/results`;
  const runDir = path.join(workspacePath, "model_runs", modelRunName, `task${taskNumber}`);
  const testRatio = analysisTestPassRatio(summary);
  const testScore = testRatio * 100;
  const testCounts = analysisTestCounts(summary);
  const testEvidence = testCounts
    ? `${testCounts.passedCount}/${testCounts.adjustedTotal} passed`
    : `metric=${testRatio}`;
  const report = readRelativeText(workspacePath, `${resultsRel}/task${taskNumber}_report.md`);
  const runFiles = listFilesRecursive(runDir, 220);
  const workingCopyScore = (analysisMigratedWorkingCopyPoints(runDir, runFiles, summary) / ANALYSIS_MIGRATED_WORKING_COPY_POINTS) * 100;
  return [
    sectionScore("working_copy", "Isolated working copy", workingCopyScore, `${runFiles.length} files in ${runRel}`),
    sectionScore("automated_tests", "Automated hidden tests", testScore, testEvidence),
    sectionScore("official_submission", "Official evaluator run", 100, "task_project_evaluate.py summary"),
    sectionScore("source_integrity", "Original source untouched", summary?.original_source_unchanged === true ? 100 : 20, "original source checksum"),
    sectionScore("container_execution", "Container-only commands", 100, "task_project_evaluate.py summary"),
    sectionScore("report", "Delivery report", analysisMigratedReportScore(report), `task${taskNumber}_report.md`),
  ];
}

function countHttpLinks(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s)>\]]+/g);
  return matches ? matches.length : 0;
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analysisContainerExecPatterns(analysisEnvName) {
  const escapedEnvName = regexEscape(analysisEnvName);
  return [
    new RegExp(`docker\\s+compose\\s+exec\\b[^\\r\\n]*\\b${escapedEnvName}\\b`, "i"),
    new RegExp(`docker\\s+exec\\b[^\\r\\n]*\\b${escapedEnvName}\\b`, "i"),
  ];
}

function hasContainerExecCommand(commands, analysisEnvName, extraPatterns = []) {
  const execPatterns = analysisContainerExecPatterns(analysisEnvName);
  return String(commands || "")
    .split(/\r?\n/)
    .some((line) =>
      hasAny(line, execPatterns) &&
      extraPatterns.every((pattern) => hasAny(line, [pattern])),
    );
}

function analysisModelRunName(provider, model, key) {
  return safeSegment(model || key || `${provider || "auto"}-model`, "model");
}

function analysisDockerEnvironmentName(provider, model, key) {
  const modelKey = key || modelBenchmarkKey(provider, model);
  const suffix = safeSegment(modelKey, "model").replace(/[._-]+/g, "-");
  return `agent-lab-${suffix}`.slice(0, 120).replace(/[-.]+$/g, "") || "agent-lab-model";
}

function isMissingDockerContainerOutput(output) {
  return hasAny(output, [
    /\bNo such container\b/i,
    /\bNo such object\b/i,
    /\bnot found\b/i,
  ]);
}

function replaceAnalysisDockerEnvironment(prompt, envName) {
  const target = String(envName || "").trim();
  if (!target || target === "agent-lab") return String(prompt || "");
  return String(prompt || "").replace(/(^|[^A-Za-z0-9_-])agent-lab(?![A-Za-z0-9_-])/g, `$1${target}`);
}

function normalizeAnalysisWorkspaceScript(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^SERVICE="agent-lab"$/gm, 'SERVICE="${DOCKER_SERVICE:-agent-lab}"')
    .replace(/\bdocker compose exec(?!\s+-T)\s+"\$SERVICE"/g, 'docker compose exec -T "$SERVICE"');
}

function normalizeAnalysisWorkspaceScriptsInPlace(workspacePath) {
  if (!workspacePath || !fs.existsSync(workspacePath)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(workspacePath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.sh$/i.test(entry.name)) continue;
    const file = path.join(workspacePath, entry.name);
    const current = readText(file);
    const normalized = normalizeAnalysisWorkspaceScript(current);
    if (normalized !== current) {
      fs.writeFileSync(file, normalized, "utf8");
    }
  }
}

function analysisTaskNumber(taskId) {
  const match = /^task(\d+)$/.exec(String(taskId || "").trim());
  return match ? match[1] : "";
}

function analysisTaskBatchScript(taskId) {
  const number = analysisTaskNumber(taskId);
  return number ? `task${number}_grade_all.sh` : "";
}

function analysisDisplayResultsDir(workspacePath) {
  return path.join(workspacePath, REDOU_CONTEXT_DIR, REDOU_ANALYSIS_DIR, "results");
}

function listRelativeFiles(root, limit = 20) {
  return listFilesRecursive(root, limit)
    .map((file) => path.relative(root, file).replace(/\\/g, "/"))
    .filter(Boolean);
}

function analysisTaskDisplayArtifacts(workspacePath, taskId) {
  const workspace = String(workspacePath || "").trim();
  const id = String(taskId || "").trim();
  const empty = {
    rootPath: "",
    batchLogPath: "",
    batchLogPreview: "",
    reports: [],
    logs: [],
    modelResults: [],
  };
  if (!workspace || !id) return empty;
  const rootPath = path.join(analysisDisplayResultsDir(workspace), id);
  const batchLogName = `${id}_grade_all.log`;
  const batchLogCandidates = [
    path.join(rootPath, batchLogName),
    path.join(workspace, "logs", batchLogName),
    path.join(workspace, "reports", batchLogName),
  ];
  const batchLogPath = batchLogCandidates.find((candidate) => fs.existsSync(candidate)) || "";
  const hasRoot = fs.existsSync(rootPath);
  return {
    rootPath: hasRoot ? rootPath : "",
    batchLogPath,
    batchLogPreview: batchLogPath ? compactMultiline(readText(batchLogPath), 2400) : "",
    reports: hasRoot ? listRelativeFiles(path.join(rootPath, "reports"), 20) : [],
    logs: hasRoot ? listRelativeFiles(path.join(rootPath, "logs"), 20) : [],
    modelResults: hasRoot ? listRelativeFiles(path.join(rootPath, "model_results"), 20) : [],
  };
}

function shellQuoteSingle(value) {
  return `'${String(value || "").replace(/'/g, "'\"'\"'")}'`;
}

function analysisComposeHasService(composeText, serviceName) {
  const escaped = regexEscape(serviceName);
  return new RegExp(`(^|\\n)\\s{2}["']?${escaped}["']?\\s*:`, "m").test(String(composeText || ""));
}

function analysisComposeHasWorkspaceMount(composeText) {
  return /\/workspace\b/i.test(String(composeText || "")) &&
    /(?:-\s*["']?(?:\.\/?|\$\{PWD\})["']?\s*:\s*["']?\/workspace\b|target:\s*["']?\/workspace\b)/i.test(String(composeText || ""));
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeAnalysisMaxIterations(value, fallback = ANALYSIS_DEFAULT_MAX_ITERATIONS) {
  return positiveIntegerOrNull(value) || positiveIntegerOrNull(fallback) || ANALYSIS_DEFAULT_MAX_ITERATIONS;
}

function readRootAgentMaxTurns(hermesHome) {
  const text = readText(path.join(hermesHome, "config.yaml"));
  const agentBlock = topLevelYamlBlock(text, "agent");
  for (const line of agentBlock.split(/\r?\n/).slice(1)) {
    const match = line.match(/^\s+max_turns:\s*(.*)$/);
    const value = match ? positiveIntegerOrNull(yamlScalar(match[1])) : null;
    if (value) return value;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^max_turns:\s*(.*)$/);
    const value = match ? positiveIntegerOrNull(yamlScalar(match[1])) : null;
    if (value) return value;
  }

  return null;
}

function analysisTaskPromptPath(projectRoot, task) {
  return path.join(projectRoot, "analyze", task.file);
}

function readDotEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const rawLine of readText(file).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = sanitizeEnvValue(value);
  }
  return env;
}

function sanitizeEnvValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\0/g, "");
}

module.exports = {
  ANALYSIS_RESULTS_FILE,
  ANALYSIS_DEFAULT_MAX_ITERATIONS,
  ANALYSIS_DOCKER_WORKSPACE,
  ANALYSIS_WORKSPACE_PROJECT_ID,
  ANALYSIS_WORKSPACE_PROJECT_NAME,
  ANALYSIS_WORKSPACE_TASK_KIND,
  ANALYSIS_ABILITY_KEYS,
  ANALYSIS_TASKS,
  clampScore,
  modelBenchmarkKey,
  pathExists,
  readRelativeText,
  readRelativeJson,
  joinRelativePath,
  pathExistsAny,
  readRelativeTextAny,
  firstExistingRelativePath,
  listFilesRecursive,
  hasAny,
  isAnalysisModelCallFailure,
  commandText,
  sectionScore,
  averageScore,
  analysisTestCounts,
  analysisTestPassRatio,
  analysisTaskProcessStatus,
  normalizeAnalysisTaskStatus,
  analysisTaskGradeLogText,
  analysisFinalScoreFromLog,
  analysisPhaseScoresFromLog,
  analysisTaskSectionsFromGradeLog,
  analysisLatestMigratedTaskSummary,
  analysisMigratedTaskScore,
  analysisMigratedTaskSectionsFromSummary,
  countHttpLinks,
  analysisContainerExecPatterns,
  hasContainerExecCommand,
  analysisModelRunName,
  analysisDockerEnvironmentName,
  isMissingDockerContainerOutput,
  replaceAnalysisDockerEnvironment,
  normalizeAnalysisWorkspaceScript,
  normalizeAnalysisWorkspaceScriptsInPlace,
  analysisTaskNumber,
  analysisTaskBatchScript,
  analysisDisplayResultsDir,
  listRelativeFiles,
  analysisTaskDisplayArtifacts,
  shellQuoteSingle,
  analysisComposeHasService,
  analysisComposeHasWorkspaceMount,
  positiveIntegerOrNull,
  normalizeAnalysisMaxIterations,
  readRootAgentMaxTurns,
  analysisTaskPromptPath,
  readDotEnv,
  sanitizeEnvValue,
};
