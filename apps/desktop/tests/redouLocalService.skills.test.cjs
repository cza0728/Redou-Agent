const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { RedouLocalService } = require("../src/services/redouLocalService.cjs");

function makeBareService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "redou-skills-"));
  const app = {
    getPath(name) {
      assert.equal(name, "userData");
      return path.join(root, "userData");
    },
  };
  const service = new RedouLocalService({
    app,
    projectRoot: root,
    hermesHome: path.join(root, "hermes-home"),
    log: () => {},
  });
  return { root, service };
}

test("skills page data is loaded through the local dashboard bridge", () => {
  const { service } = makeBareService();
  const calls = [];

  service.runDashboardBridge = (action, payload = {}) => {
    calls.push({ action, payload });
    if (action === "get_skills") {
      return [
        {
          name: "github-code-review",
          description: "Review GitHub pull requests.",
          category: "github",
          enabled: true,
        },
      ];
    }
    if (action === "toggle_skill") {
      return { ok: true, name: payload.name, enabled: payload.enabled };
    }
    if (action === "delete_skill") {
      return { ok: true, name: payload.name, source: payload.source || "root" };
    }
    if (action === "merge_skills") {
      return {
        ok: true,
        mergedInto: { name: payload.skills[0].name, path: payload.skills[0].path },
        archived: [{ name: payload.skills[1].name, path: "archive" }],
        count: payload.skills.length,
      };
    }
    if (action === "get_toolsets") {
      return [
        {
          name: "skills",
          label: "Skills",
          description: "list, view, manage",
          enabled: true,
          configured: true,
          tools: ["skills_list", "skill_view"],
        },
      ];
    }
    throw new Error(`unexpected action ${action}`);
  };

  assert.deepEqual(service.getSkills().map((skill) => skill.name), ["github-code-review"]);
  assert.deepEqual(service.toggleSkill("github-code-review", false), {
    ok: true,
    name: "github-code-review",
    enabled: false,
  });
  assert.deepEqual(
    service.deleteSkill({ name: "github-code-review", source: "root" }),
    {
      ok: true,
      name: "github-code-review",
      source: "root",
    },
  );
  assert.deepEqual(service.getToolsets().map((toolset) => toolset.name), ["skills"]);
  assert.equal(
    service.mergeSkills([
      { name: "task-one", source: "profile", profile: "redou", profileHome: "/tmp/redou-profile", path: "one/SKILL.md" },
      { name: "task-two", source: "profile", profile: "redou", profileHome: "/tmp/redou-profile", path: "two/SKILL.md" },
    ]).mergedInto.name,
    "task-one",
  );
  assert.deepEqual(calls, [
    { action: "get_skills", payload: { profileHomes: [] } },
    { action: "toggle_skill", payload: { name: "github-code-review", enabled: false } },
    { action: "delete_skill", payload: { name: "github-code-review", source: "root" } },
    { action: "get_toolsets", payload: {} },
    {
      action: "merge_skills",
      payload: {
        skills: [
          { name: "task-one", source: "profile", profile: "redou", profileHome: "/tmp/redou-profile", path: "one/SKILL.md" },
          { name: "task-two", source: "profile", profile: "redou", profileHome: "/tmp/redou-profile", path: "two/SKILL.md" },
        ],
      },
    },
  ]);
});

test("managed project profile config preserves skill toggles", () => {
  const { root, service } = makeBareService();
  const profileHome = path.join(root, "workspace", ".redou");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.writeFileSync(
    path.join(profileHome, "config.yaml"),
    [
      "# Redou managed Hermes profile.",
      "skills:",
      "  disabled:",
      "    - task-1-1ce5ef6d",
      "terminal:",
      "  cwd: C:\\\\old",
      "",
    ].join("\n"),
    "utf8",
  );

  service.writeManagedProfileConfig(profileHome, "C:\\work", path.join(profileHome, "skills"));

  const text = fs.readFileSync(path.join(profileHome, "config.yaml"), "utf8");
  assert.match(text, /skills:\n(?:  external_dirs:[\s\S]*?\n)?  disabled:\n    - "?task-1-1ce5ef6d"?/);
  assert.match(text, /terminal:\n  cwd: "C:\\\\work"/);
});

test("managed project profile config inherits root agent max turns", () => {
  const { root, service } = makeBareService();
  const profileHome = path.join(root, "workspace", ".redou");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: auto",
      "  model: ''",
      "agent:",
      "  max_turns: 321",
      "  service_tier: flex",
      "",
    ].join("\n"),
    "utf8",
  );

  service.writeManagedProfileConfig(profileHome, "C:\\work");

  const text = fs.readFileSync(path.join(profileHome, "config.yaml"), "utf8");
  assert.match(text, /agent:\n  max_turns: 321\n  service_tier: flex/);
});

test("managed project profile config inherits root MCP servers", () => {
  const { root, service } = makeBareService();
  const profileHome = path.join(root, "workspace", ".redou");
  fs.mkdirSync(profileHome, { recursive: true });
  fs.mkdirSync(service.hermesHome, { recursive: true });
  fs.writeFileSync(
    path.join(service.hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: auto",
      "  model: ''",
      "mcp_servers:",
      "  minimax:",
      "    command: npx",
      "    args:",
      "      - -y",
      "      - minimax-mcp-js",
      "    env:",
      "      MINIMAX_API_KEY: ${MINIMAX_API_KEY}",
      "    enabled: true",
      "",
    ].join("\n"),
    "utf8",
  );

  service.writeManagedProfileConfig(profileHome, "C:\\work");

  const text = fs.readFileSync(path.join(profileHome, "config.yaml"), "utf8");
  assert.match(text, /mcp_servers:\n  minimax:\n    command: npx/);
  assert.match(text, /MINIMAX_API_KEY: \${MINIMAX_API_KEY}/);
});

test("plugin service exposes MCP management through the dashboard bridge", () => {
  const { service } = makeBareService();
  const calls = [];
  service.runDashboardBridge = (action, payload = {}) => {
    calls.push({ action, payload });
    if (action === "get_mcp_hub") {
      return { servers: [], presets: {} };
    }
    if (action === "install_mcp_server") {
      return { ok: true, name: payload.name || "minimax" };
    }
    if (action === "test_mcp_server") {
      return { ok: true, name: payload.name, tools: [] };
    }
    if (action === "remove_mcp_server") {
      return { ok: true, name: payload.name };
    }
    throw new Error(`unexpected action ${action}`);
  };

  assert.deepEqual(service.getMcpHub(), { servers: [], presets: {} });
  assert.deepEqual(service.installMcpServer({ preset: "minimax", name: "minimax" }), {
    ok: true,
    name: "minimax",
  });
  assert.deepEqual(service.testMcpServer("minimax"), {
    ok: true,
    name: "minimax",
    tools: [],
  });
  assert.deepEqual(service.removeMcpServer("minimax"), { ok: true, name: "minimax" });
  assert.deepEqual(calls, [
    { action: "get_mcp_hub", payload: {} },
    { action: "install_mcp_server", payload: { preset: "minimax", name: "minimax" } },
    { action: "test_mcp_server", payload: { name: "minimax" } },
    { action: "remove_mcp_server", payload: { name: "minimax" } },
  ]);
});
