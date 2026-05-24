<p align="center">
  <img src="logo.png" alt="Redou Agent logo" width="180" />
</p>

# Redou Agent

Redou Agent 是一个本地优先的 AI 桌面工作台。它把“让模型在你的项目里做事”这件事，从一段终端命令、一个脚本 harness，变成可看、可控、可继续协作的项目任务界面。

你可以把它理解成一个面向个人开发者、小团队和本地模型玩家的 Agent 控制台：选择一个本地工作目录，创建项目和任务，把规则、上下文、附件、模型配置交给 Redou，然后让 OpenAI Codex CLI 在后台读取代码、调用工具、运行命令、生成修改方案，并把过程拆成清楚的消息卡、命令卡、工具卡、文件卡、错误卡和完成状态。

Redou 的重点不是把终端嵌进桌面壳里，而是把 Agent 工作流产品化。你看到的是任务、上下文、模型、技能和结果，底层 Codex CLI 是本地运行时。

## 当前目录结构

Redou 现在采用深度分层结构：

```text
apps/desktop/        Redou Electron 桌面壳、任务管理、本地 IPC bridge
vendor/hermes/       渲染器 UI 和前端资源（legacy web_dist）
scripts/             Redou 工作区清理和导出脚本
docs/architecture/   Redou 架构和重构说明
```

边界规则很简单：**Codex CLI 负责 prompt 执行、工具调用、命令运行和文件编辑；Redou 负责状态展示、任务持久化、上下文编辑和用户交互。**

Redou 通过 `apps/desktop/src/codex_adapter.cjs` 桥接层与 Codex 的 app-server JSON-RPC 协议通信。运行时不再需要 Python 环境，只需安装 Codex CLI（`npm install -g @openai/codex`）。

## 它解决什么问题

传统 Agent harness 往往擅长“把一个任务跑起来”，但日常使用时会遇到几个问题：

- 任务上下文散在 prompt、终端历史、临时文件和聊天记录里，下一次接着做很费劲。
- 模型做了什么只能从原始日志里翻，出错、排队、等待确认、文件变化都不够直观。
- 每次换模型、换 provider、换本地推理服务都要改配置。
- 好用的一次性工作流很难沉淀成可复用的 skill。
- 多个项目和多个任务同时推进时，缺少一个总览面板。

Redou 的做法是把这些能力放进桌面 UI：项目树管理工作目录，任务聊天承载执行过程，Context Builder 自动组织上下文，Skills 页面管理可复用能力，Models/Analytics 页面让你比较模型配置和实际表现。

## 和其他 harness 的区别

| 维度 | 常见 Agent harness | Redou Agent |
| --- | --- | --- |
| 使用入口 | CLI、脚本、Notebook 或 Web 控制台 | 本地 Electron 桌面应用 |
| 任务组织 | 一次运行一个 prompt 或 job | 项目、任务、消息、附件、上下文长期保存 |
| 过程可见性 | 原始日志或终端输出 | ChatGPT-like 任务聊天，结构化事件卡片 |
| 运行中互动 | 通常只能中断或等待结束 | Queue 排队补充，Guide 引导当前运行的下一步 |
| 上下文管理 | 手写 prompt 或配置文件 | 全局、项目、任务三级上下文文件加 Context Builder |
| Skill 沉淀 | 依赖手工整理 | 可从任务打包 skill，并在 Skills 页面启用、禁用、合并 |
| 模型管理 | 手改环境变量或 YAML | Models 页面选择 provider、API key、主模型、辅助模型 |
| 本地模型 | 需要自己维护接入脚本 | 内置 Local vLLM 等 OpenAI-compatible 入口 |
| 多任务观察 | 依赖日志目录或数据库查询 | Console/Analytics 直接看运行、队列、错误和用量 |
| 产品边界 | 经常混合 Web 服务、终端和后端 | Renderer 只走 IPC，Main Process 管本地服务，Codex CLI 是本地 runtime |

Redou 更像“Agent IDE 的任务工作台”，而不是只负责调起模型的 runner。

## 界面导览

### Console / Work

这是 Redou 的主工作区。你可以在这里查看当前项目、任务、运行状态和最近输出：

控制台首页的信息架构见 [`docs/architecture/dashboard-information-architecture.md`](docs/architecture/dashboard-information-architecture.md)。

- 项目可以绑定本地工作目录。
- 每个项目下面可以创建多个任务。
- 任务会保存独立的聊天历史、附件、模型选择和上下文。
- 运行中的任务会显示 live 状态、队列深度、最近工具调用和错误提示。
- 顶部状态区可以看到 gateway/runtime 是否可用、当前模型和最近 token 用量。

适合用法：

- 把一个代码仓库创建成项目。
- 为每个目标创建任务，比如“重写 README”“修复模型配置页”“分析 CI 失败”。
- 每个任务都保留自己的上下文，方便隔天继续。

### Task Chat

Task Chat 是 Redou 的核心交互面。它不是终端 relay，而是把 Hermes 的 stdout/stderr 和工具结果解析成结构化 `AgentEvent` 后渲染：

- 用户消息和助手回复是普通聊天消息。
- 命令执行显示为命令卡，包含命令、状态、输出摘要。
- 工具调用显示为工具卡，便于追踪模型调用了什么能力。
- 文件变化显示为文件卡，适合复查修改范围。
- 错误、确认、停止和完成状态都有独立卡片。

运行中你还可以继续输入：

- `Queue`：排到当前运行结束后的下一轮执行，适合补充新需求。
- `Guide`：尝试插入当前运行，让 Agent 在后续步骤采纳你的新指示，适合实时纠偏。

如果 Guide 携带附件，或者当前运行无法接收插入，Redou 会自动降级为 Queue。

### Context Files

Redou 把“上下文”从一整段混在 prompt 里的文字拆成可维护的文件：

- `USER.md`：全局用户偏好。
- `GLOBAL_RULES.md`：全局规则。
- `GLOBAL_MEMORY.md`：全局长期记忆。
- `PROJECT_RULES.md`：项目级规则，例如技术栈、编码风格、禁止操作。
- `TASK_RULES.md`：当前任务的额外约束和验收标准。
- `TASK_CONTEXT.md`：当前任务的背景、进度、决策、证据和待办。

发送消息前，Context Builder 会把全局、项目、任务、最近消息和附件整理成一次任务上下文。任务进行一段时间后，也可以把已经确认的信息压缩、归档或提炼进规则文件，减少重复解释。

绑定工作目录后，项目和任务规则通常写入：

```text
<workspace>/.redou/PROJECT_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_CONTEXT.md
```

### Skills

Skills 页面用于管理 Agent 能力，而不是让用户记住一堆命令行参数：

- 查看当前可用 skill、来源、分类、描述和启用状态。
- 启用或禁用某个 skill。
- 管理 project/profile 里的局部 skill。
- 合并多个任务沉淀出来的 skill，减少重复。
- 查看 toolset，理解当前 Agent 可以调用哪些工具集合。

一个很实用的工作流是：先在 Task Chat 里把某个任务跑通，然后把它打包成 skill。之后类似任务不需要重新解释背景、步骤和注意事项。

### Models

Models 页面负责模型接入和分工：

- 设置主模型，也就是负责对话、规划和执行的模型。
- 设置辅助模型，例如 Vision、Compression、Session Search、Title Gen、Skills Hub、Approval、MCP 等。
- 选择云端 provider，例如 DeepSeek、MiniMax、Kimi/Moonshot、GLM/Z.AI、Qwen/DashScope、OpenRouter、OpenAI、Anthropic。
- 接入本地 OpenAI-compatible 服务，例如 vLLM、LM Studio 或其他 `/v1` API。
- 查看 provider 是否已保存 API key，刷新模型列表，选择模型 ID。

主模型和辅助模型可以分工。比如主模型用更强的云端模型，压缩和标题生成用更便宜的模型；或者探索阶段用本地模型，关键修改再切到更强模型。

### Analytics

Analytics 页面用来回答“哪个模型在我的任务里真的好用”：

- 查看最近 7/30/90 天调用量。
- 查看输入、输出、缓存读取、推理 token。
- 查看模型能力标签，例如 tools、vision、reasoning。
- 查看任务运行数量、工具调用和模型成本估算。
- 运行或查看模型能力分析任务，用同一套任务集比较不同模型。

这让 Redou 不只是“能跑模型”，还可以慢慢形成你自己的模型选择依据。

### Logs、Profiles、Config、Keys、Plugins、Cron

这些页面面向更深入的使用：

- `Logs`：查看桌面端、本地 runtime、Hermes gateway 等日志。
- `Profiles`：管理不同 Hermes profile，隔离项目级配置和 skill。
- `Config`：编辑非密钥配置。
- `Keys`：管理 API key 和 `.env` 里的秘密。
- `Plugins`：查看运行时 provider、memory provider、context engine 等插件能力。
- `Cron`：管理定时任务和后台自动化。

## 工作方式

Redou Desktop 的调用链是：

```text
Renderer TaskChat
  -> IPC sendMessage(projectId, taskId, userInput)
  -> Main Process chatHandler
  -> Context Builder
  -> HermesAdapter
  -> Hermes CLI / Runtime
  -> AgentEvent stream
  -> IPC push events
  -> Renderer renders Chat UI
```

边界很明确：

- Renderer/UI layer 负责项目树、任务聊天、消息、输入框、命令卡、工具卡、文件卡和错误卡。
- Electron Main Process / Local Service layer 负责持久化、app-data 初始化、上下文文件读写、Context Builder、Hermes profile、Hermes CLI 子进程、stdout/stderr 解析和 IPC 事件推送。
- Local Runtime layer 是本机后台运行的 Hermes。

Redou UI 功能不需要独立 Web 后端、HTTP API、FastAPI、Express 或远程服务。Renderer 不直接调用 `child_process`，也不直接操作 Hermes CLI。

## 环境要求

推荐环境：

- Windows 10 或 Windows 11。
- Node.js 20 或更高版本，并确保 `npm` 在 `PATH` 中。
- Python 3.11 或更高版本，推荐 Python 3.12。
- Git，用于克隆仓库和常规开发工作流。
- PowerShell 5+。
- Docker 可选，仅在运行部分模型能力评测或容器化任务时需要。

Redou 当前是本地 Electron 桌面应用。普通聊天、项目任务、模型配置和 skill 管理不需要 Docker。

## 安装指南

### 1. 使用 Windows 安装包

普通用户推荐直接下载安装包，不需要克隆仓库，也不需要手动运行 `npm install`：

- 最新 Release：[Redou Agent v0.1.8](https://github.com/herb711/RedouAgent/releases/tag/v0.1.8)
- Windows 安装包：[Redou-Agent-Setup-0.1.8.exe](https://github.com/herb711/RedouAgent/releases/download/v0.1.8/Redou-Agent-Setup-0.1.8.exe)
- 校验文件：[Redou-Agent-Setup-0.1.8.exe.sha256](https://github.com/herb711/RedouAgent/releases/download/v0.1.8/Redou-Agent-Setup-0.1.8.exe.sha256)

下载安装包后双击运行。安装向导会让你选择安装范围和安装路径，并在安装前检查本机环境：

- 如果缺少 Python 3.11+，安装器会尝试通过 `winget` 安装 Python 3.12。
- 如果缺少 Node.js 20+，安装器会尝试通过 `winget` 安装 Node.js LTS。
- 自动安装依赖时需要网络，并且机器上需要可用的 Windows App Installer / `winget`。

安装完成后，可以从开始菜单、桌面快捷方式或安装目录启动 `Redou Agent`。

首次启动时，桌面主进程会在应用数据目录中准备 Python runtime，并安装本地 Hermes runtime 依赖。这个过程可能需要一点时间，界面会显示启动状态。

### 2. 从源码安装

开发者或需要修改代码时，可以从源码运行。先克隆仓库：

```powershell
git clone https://github.com/herb711/RedouAgent.git
cd RedouAgent
```

如果你是下载 zip 包，解压后在项目根目录打开 PowerShell。

先确认 Node.js、npm 和 Python 可用：

```powershell
.\install-redou-agent.ps1 -CheckOnly
```

如果提示找不到 Python，可以指定 Python 路径后重试：

```powershell
$env:REDOU_PYTHON="C:\Path\To\python.exe"
.\install-redou-agent.ps1 -CheckOnly
```

源码安装推荐运行：

```powershell
.\Install Redou Agent.cmd
```

安装脚本会完成：

- 检查 Node.js、npm 和 Python。
- 安装 `apps/desktop/` 的 Electron 依赖。
- 安装 `vendor/hermes/web/` 的 Renderer/UI 依赖。
- 构建 Renderer 到 `vendor/hermes/hermes_cli/web_dist/`。
- 刷新桌面启动快捷方式和 Windows 图标。

也可以直接运行 PowerShell 脚本：

```powershell
.\install-redou-agent.ps1
```

常用参数：

```powershell
.\install-redou-agent.ps1 -CheckOnly
.\install-redou-agent.ps1 -Launch
.\install-redou-agent.ps1 -SkipRendererBuild
```

参数说明：

- `-CheckOnly`：只检查本机工具链，不安装依赖。
- `-Launch`：安装完成后直接启动 Redou Agent。
- `-SkipRendererBuild`：跳过 Renderer 依赖安装和构建，适合你确认前端已经构建完成的情况。

源码安装完成后运行：

```powershell
.\Launch Redou Agent.cmd
```

或者：

```powershell
.\start-redou-agent.ps1
```

### 3. 构建 Windows 安装包

如果你要自己生成 Windows 安装包：

```powershell
npm --prefix apps/desktop run build
```

构建产物会出现在 `apps/desktop/dist/`。

## 首次配置模型

推荐全部通过界面完成：

1. 启动 Redou Agent。
2. 打开左侧导航的 `Models`。
3. 在 `Model Settings` 里点击主模型的 `Change`。
4. 选择 provider。
5. 填入 API Key 和 Base URL。
6. 点击 `Save Key & Refresh Models` 或 `Refresh Models`。
7. 从模型列表中选择模型。
8. 点击 `Save`。

配置会写入 Redou 自己管理的 Hermes Home：

```text
%APPDATA%\Redou Agent\hermes-home\config.yaml
%APPDATA%\Redou Agent\hermes-home\.env
```

API key 属于秘密，应该放在 `.env` 或 provider 的安全配置里，不要提交到仓库。

## 接入本地大模型

Redou 支持任何 OpenAI-compatible 的本地推理服务。最直接的入口是在 `Models` 页面选择 `Local vLLM`。

### vLLM 示例

先启动 vLLM OpenAI-compatible server：

```powershell
python -m vllm.entrypoints.openai.api_server `
  --model Qwen/Qwen3-Coder-30B-A3B-Instruct `
  --host 127.0.0.1 `
  --port 8000
```

然后在 Redou Agent 中：

1. 打开 `Models`。
2. 点击主模型 `Change`。
3. 选择 `Local vLLM`。
4. Base URL 填：

```text
http://127.0.0.1:8000/v1
```

5. API Key 对本地服务通常可以留空，或填 `EMPTY`。
6. 点击 `Refresh Models`。
7. 选择返回的模型。如果服务没有实现 `/v1/models`，就在 `Model ID` 输入框手动填写模型名。
8. 保存。

### LM Studio 或其他本地服务

只要服务暴露 OpenAI-compatible `/v1` API，就可以按同样方式接入。LM Studio 常见地址是：

```text
http://127.0.0.1:1234/v1
```

如果界面里没有合适预设，可以在 `config.yaml` 里手动添加 provider：

```yaml
providers:
  lmstudio-local:
    name: LM Studio Local
    base_url: http://127.0.0.1:1234/v1
    api_mode: chat_completions
    models:
      local-model: {}

model:
  provider: lmstudio-local
  default: local-model
  base_url: http://127.0.0.1:1234/v1
  api_mode: chat_completions
```

如果本地服务需要鉴权，可以加上：

```yaml
providers:
  my-local-model:
    key_env: LOCAL_MODEL_API_KEY
```

并在 `.env` 中写入：

```env
LOCAL_MODEL_API_KEY=your-token
```

## 操作指南

### 1. 创建项目

1. 打开 `Work` 或 `Console`。
2. 在项目面板点击新建项目。
3. 输入项目名称。
4. 选择或粘贴本地工作目录。
5. 创建后，Redou 会准备项目级 Hermes profile 和上下文文件。

建议一个代码仓库对应一个 Redou 项目。这样项目规则、任务上下文和附件都更容易管理。

### 2. 创建任务

1. 在项目下方输入任务标题。
2. 点击添加。
3. 选择任务后，聊天区会加载该任务的历史消息。

任务适合按目标拆分，例如：

- 分析当前桌面端架构并给出重构计划。
- 修复登录页样式问题。
- 给某个 Python 模块补测试。
- 比较本地模型和云端模型完成同一任务的差异。
- 把一次成功的操作流程打包成 skill。

### 3. 编写项目规则和任务上下文

在项目面板中维护：

- `PROJECT_RULES.md`：项目长期规则，例如技术栈、目录边界、命名规范、禁止操作。
- `TASK_RULES.md`：当前任务的目标、约束、验收标准。
- `TASK_CONTEXT.md`：当前任务的背景、进度、证据、已确认决策、待办和开放问题。

写得好的上下文可以显著减少模型跑偏。推荐把“长期有效的规则”放到项目规则，把“只服务当前目标的信息”放到任务上下文。

### 4. 发送任务给 Agent

在输入框里直接描述你要 Redou 做什么，例如：

```text
阅读这个项目的桌面端实现，确认模型配置链路，然后把 README 的本地模型接入说明写得更完整。
```

常用交互：

- `Enter` 发送。
- `Shift + Enter` 换行。
- 点击附件按钮添加本地文件或图片。
- 拖放文件到聊天区添加附件。
- 运行中点击停止按钮可以中断当前任务。
- 检测到高风险请求时，界面会要求二次确认。

### 5. 阅读执行过程

不要只看最后回答。Redou 会把过程拆成事件卡片：

- 命令卡：看 Agent 运行了什么命令。
- 工具卡：看 Agent 调用了哪些工具。
- 文件卡：看哪些文件被读取或改变。
- 错误卡：看失败原因和可恢复信息。
- 完成卡：看最终状态。

这种可视化过程是 Redou 区别于普通 harness 的关键。你可以一边看 Agent 工作，一边判断是否需要 Guide 或 Queue。

### 6. 运行中补充指令

当任务正在运行时，输入区会提供两种投递方式：

- `Queue`：排队到当前运行结束后的下一轮执行。适合补充需求、追加检查、要求整理总结。
- `Guide`：插入到当前运行，让 Agent 在下一步采纳。适合实时纠偏，例如“不要改这个目录”“先跑测试再继续”。

如果当前运行无法接收 Guide，Redou 会保存为队列消息，避免你的指令丢失。

### 7. 为任务切换模型

在 Work 或 Models 的模型工具条中，可以给当前任务选择 provider 和 model。新任务可以继承当前任务的模型选择；如果任务没有显式模型，就使用全局主模型。

常见策略：

- 探索阶段用本地模型，降低成本。
- 复杂代码修改用云端强模型。
- 文档、标题、压缩等辅助任务用便宜模型。
- 同一个任务复制成多个任务，用不同模型横向比较。

### 8. 打包任务为 Skill

当某个任务跑通后，可以在任务面板中把它打包成 Hermes skill。Redou 会从当前任务的上下文、消息和关键步骤中生成可复用说明，并统一放到项目 `.redou/skills/` 目录；桌面端只调用 Hermes 侧 packager，不在 Redou 本地重复实现 skill 生成逻辑。

适合打包的任务：

- 固定项目的发布检查流程。
- 固定仓库的代码审查规则。
- 常用的日志分析步骤。
- 某个业务系统的排障流程。
- 你经常重复写给 Agent 的长提示词。

打包后到 `Skills` 页面启用、禁用、删除或合并。

### 9. 查看模型效果

在 `Analytics` 和 `Models` 中看：

- 哪些模型最近被使用。
- token 和成本估算。
- 哪些任务失败、排队或等待确认。
- 不同模型在同一类任务上的表现。

这能帮助你逐步形成自己的模型路由策略，而不是凭印象选模型。

## 配置和数据位置

完整路径契约见 `docs/architecture/source-and-generated-paths.md`。核心规则是：项目级规则、任务上下文、消息、上传和任务打包出来的 skill 都归置到项目工作区的 `.redou/` 下；Electron `userData` 只保留全局配置、运行时、项目索引和日志。

```text
<workspace>/.redou/PROJECT_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_CONTEXT.md
<workspace>/.redou/tasks/<task-id>/messages.jsonl
<workspace>/.redou/tasks/<task-id>/uploads/
<workspace>/.redou/skills/task-packages/<skill-name>/SKILL.md
```

Electron `userData` 主要保留：

```text
%APPDATA%/Redou Agent/runtime/                         Python runtime
%APPDATA%/Redou Agent/hermes-home/config.yaml          全局模型配置
%APPDATA%/Redou Agent/hermes-home/.env                 全局 provider credentials
%APPDATA%/Redou Agent/appData/projects/<project-id>/project.json
%APPDATA%/Redou Agent/logs/                            desktop startup logs
```

## 安全建议

- 在真实项目里使用前，最好让项目处于 Git 工作树中，方便审查 diff。
- API key 不要写进 `PROJECT_RULES.md`、`TASK_CONTEXT.md` 或 README。
- 对会删除文件、移动目录、执行部署、改数据库的任务，先写清楚约束。
- 运行中如果发现方向不对，优先用 `Guide` 纠偏，必要时停止任务。
- Redou 是本地优先工具，但 Agent 仍可能调用你配置的云端模型；敏感代码是否发送给云端取决于你的模型配置。

## 冒烟测试

清理或重构后可以运行：

```powershell
npm run smoke
```

它会检查旧兼容入口是否已移除、关键 Python/CJS 文件是否可解析、桌面端单元测试、Redou/Hermes context contract，以及生成物/缓存污染。没有安装 Node/Python 依赖时，Web/TUI/Electron 生产构建需要在目标平台补跑。

## 开发指南

安装 Renderer 依赖并构建：

```powershell
npm --prefix vendor/hermes/web install
npm --prefix vendor/hermes/web run build
```

启动桌面应用：

```powershell
npm --prefix apps/desktop start
```

或使用根目录脚本：

```powershell
npm run desktop
```

构建桌面安装包：

```powershell
npm --prefix apps/desktop run build
```

运行桌面端测试：

```powershell
npm --prefix apps/desktop test
```

运行 Python/Hermes 测试：

```bash
vendor/hermes/scripts/run_tests.sh
```

## 目录说明

```text
apps/desktop/        Redou Electron shell, preload bridge, main process, local service
vendor/hermes/       Hermes Runtime fork kept as one upstream-syncable subtree
vendor/hermes/web/   React Renderer/UI source used by the desktop shell
vendor/hermes/tests/ Python/Hermes tests
vendor/hermes/analyze/ Model benchmark tasks and harness
vendor/hermes/hermes_cli/ Hermes CLI, Redou context contract, dashboard bridge and bundled renderer output
assets/              Redou root icons, banner, visual assets
scripts/             Redou installer, shortcut, export and generated-artifact checks
docs/architecture/   Redou layout and migration notes
```

## 常见问题

### 启动提示缺少 Node.js 或 Python

安装 Node.js LTS 和 Python 3.11+，然后重新运行：

```powershell
.\install-redou-agent.ps1 -CheckOnly
.\Install Redou Agent.cmd
```

如果本机有多个 Python，可以指定：

```powershell
$env:REDOU_PYTHON="C:\Path\To\python.exe"
.\Install Redou Agent.cmd
```

### 修改前端后界面没有变化

重新构建 Renderer：

```powershell
npm --prefix vendor/hermes/web run build
.\start-redou-agent.ps1
```

### 本地模型刷新不出模型列表

检查：

- 本地服务是否已启动。
- Base URL 是否以 `/v1` 结尾。
- 防火墙是否拦截 `127.0.0.1` 端口。
- 服务是否实现 `/v1/models`。
- 如果没有 `/v1/models`，在 Model ID 中手动输入模型名。

### Agent 没有真正开始运行

如果消息已保存但显示 Hermes runtime 不可用，通常是首次启动的 Python runtime 准备失败。关闭应用后重新运行：

```powershell
.\start-redou-agent.ps1
```

如仍失败，查看：

```text
%APPDATA%\Redou Agent\logs\desktop-main.log
```

### 是否需要单独启动 Web 服务

不需要。Redou Agent 是本地 Electron 桌面应用。Renderer 通过 preload bridge 调用 IPC，Main Process 管本地服务和 Hermes runtime。不要为 Redou UI 功能另起 FastAPI、Express 或独立 Web 后端。

## 项目状态

Redou Agent 正在从 Hermes Agent 演进为更聚焦的本地桌面 Agent 工作台。仓库内部仍有一些 Hermes 命名和历史 Dashboard 页面，但 Redou 的核心产品形态是：本地桌面 UI、项目任务工作流、多模型接入、上下文构建、结构化 Agent 事件流和可复用 skills。

## 许可

Redou Agent 可用于个人、非商业用途。商业使用、转售、SaaS 托管、付费分发，或集成到商业产品中，均需事先获得权利人书面授权。

Redou was created by Shiyu Zhu.
