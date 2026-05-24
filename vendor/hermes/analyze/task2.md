<!-- PATH_TEMPLATE: DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Agent 能力测试任务：Agent Task Board 阶段化开发与验收

请完成一次“从零开发小型 Web 项目”的 Agent 能力测试。

本任务必须在已经部署好的 Docker 测试环境中完成。

已部署环境名称：

- Docker Compose 服务名：@@DOCKER_SERVICE@@
- Docker 容器名：@@DOCKER_SERVICE@@
- 容器内工作目录：@@DOCKER_WORKSPACE@@
- 宿主机挂载目录：当前目录整体

## 一、核心环境限制

1. 不要重新创建 Docker 测试环境。
2. 不要重新编写 Dockerfile 或 docker-compose.yml，除非当前环境确实无法运行本任务，并且必须在报告中说明原因。
3. 不要在宿主机安装任何依赖。
4. 不要在宿主机直接运行 npm、pip、python、node 等项目命令。
5. 所有开发、安装、运行、测试命令都必须在 @@DOCKER_SERVICE@@ 容器内执行。
6. 所有项目文件的新建、修改、删除，都必须发生在 @@DOCKER_SERVICE@@ 容器内。
7. 不允许在宿主机直接编辑 projects/agent-task-board/ 中的项目文件。
8. 执行命令时必须使用类似下面的形式：

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc "命令"
```

9. 所有项目文件必须放在：

```text
projects/agent-task-board/
```

对应容器内路径为：

```text
@@DOCKER_WORKSPACE@@/projects/agent-task-board/
```

10. 所有报告文件必须放在：

```text
reports/
```

对应容器内路径为：

```text
@@DOCKER_WORKSPACE@@/reports/
```

11. 所有日志文件必须放在：

```text
logs/
```

对应容器内路径为：

```text
@@DOCKER_WORKSPACE@@/logs/
```

12. 所有结论必须来自真实命令输出，不允许编造运行结果。

---

## 二、任务目标

在当前已有的 Docker 测试环境 @@DOCKER_SERVICE@@ 中，从零创建一个本地可运行的 Web 原型系统：

```text
Agent Task Board
```

该系统用于管理 Agent 执行任务，包括主任务、子任务、执行角色、执行状态、执行日志和完成进度。

---

## 三、功能要求

页面必须支持以下功能：

1. 创建主任务。
2. 每个主任务可以包含多个子任务。
3. 子任务字段包括：
   - 子任务名称
   - 执行角色：Planner、Coder、Reviewer、Tester
   - 状态：等待中、执行中、已完成、失败
   - 执行日志
4. 支持修改子任务状态。
5. 支持给子任务添加日志。
6. 支持删除主任务。
7. 支持删除子任务。
8. 支持显示每个主任务的完成进度。
9. 页面刷新后数据不能丢失，可以使用 localStorage 或本地文件持久化。
10. 页面需要有基本美观的布局，不能只是纯文本堆叠。

---

## 四、技术要求

1. 可以使用 React、Vue、纯 HTML/JS 或其他简单方案。
2. 优先保证能运行，不追求复杂架构。
3. 如果使用 Vite、React 或 Vue，服务必须监听 0.0.0.0。
4. 项目必须提供 README.md。
5. README.md 至少包括：
   - 项目功能
   - 技术栈
   - 如何在 @@DOCKER_SERVICE@@ 容器中安装依赖
   - 如何在 @@DOCKER_SERVICE@@ 容器中启动
   - 如何访问或验证页面
   - 如何停止服务

---

## 五、可测试性要求

为了让本任务可以自动分阶段验收，项目必须额外满足以下要求。

### 1. 必须提供数据逻辑模块

必须创建：

```text
@@DOCKER_WORKSPACE@@/projects/agent-task-board/src/taskStore.js
```

该文件必须导出以下函数：

```javascript
createMainTask(title)
createSubTask(name, role)
updateSubTaskStatus(board, mainTaskId, subTaskId, status)
addSubTaskLog(board, mainTaskId, subTaskId, log)
deleteMainTask(board, mainTaskId)
deleteSubTask(board, mainTaskId, subTaskId)
calculateMainTaskProgress(mainTask)
serializeBoard(board)
deserializeBoard(text)
```

其中：

- `board` 是主任务数组。
- 每个主任务至少包含 `id`、`title`、`subtasks` 字段。
- 每个子任务至少包含 `id`、`name`、`role`、`status`、`logs` 字段。
- `calculateMainTaskProgress(mainTask)` 返回 0 到 100 的数字。
- 当子任务状态为 `已完成` 时计入完成进度。
- `serializeBoard` 和 `deserializeBoard` 用于持久化数据。

### 2. 页面必须包含测试标记

页面中的关键元素必须包含以下 `data-testid`：

```text
main-task-input
create-main-task-button
main-task-card
delete-main-task-button
subtask-name-input
role-select
add-subtask-button
status-select
add-log-input
add-log-button
delete-subtask-button
progress-value
```

说明：

- 可以出现多个 `main-task-card`。
- 可以出现多个 `delete-main-task-button`。
- 可以出现多个 `status-select`。
- 这些标记用于自动验收，不影响页面样式。

### 3. 必须提供 npm 脚本

`package.json` 中必须至少包含：

```json
{
  "scripts": {
    "dev": "...",
    "build": "..."
  }
}
```

如果使用纯 HTML/JS，也可以使用一个轻量静态服务器，但仍然需要提供 `npm run dev` 和 `npm run build`。

---

## 六、阶段化开发要求

请按以下阶段完成任务。每个阶段都可以被独立脚本检验。

### 阶段 0：环境合规检查

目标：

- 确认 Docker 环境存在。
- 确认 @@DOCKER_SERVICE@@ 容器可执行命令。
- 确认项目目录、报告目录、日志目录可以在容器内创建。

必须完成：

```text
@@DOCKER_WORKSPACE@@/projects/
@@DOCKER_WORKSPACE@@/reports/
@@DOCKER_WORKSPACE@@/logs/
```

### 阶段 1：项目骨架

目标：

- 创建完整项目目录。
- 创建 package.json。
- 创建 README.md。
- 创建入口页面和源码目录。

必须至少包含：

```text
@@DOCKER_WORKSPACE@@/projects/agent-task-board/package.json
@@DOCKER_WORKSPACE@@/projects/agent-task-board/README.md
@@DOCKER_WORKSPACE@@/projects/agent-task-board/src/taskStore.js
```

如果使用 Vite React，建议包含：

```text
index.html
src/main.jsx
src/App.jsx
src/styles.css
```

### 阶段 2：数据逻辑

目标：

- 实现主任务和子任务的数据结构。
- 实现子任务状态更新。
- 实现日志添加。
- 实现主任务删除。
- 实现子任务删除。
- 实现完成进度计算。
- 实现序列化和反序列化。

要求：

- 该阶段必须能通过 Node 直接导入 `src/taskStore.js` 进行验证。
- 不允许只把所有逻辑写死在页面组件中。

### 阶段 3：页面功能与构建

目标：

- 页面能创建主任务。
- 页面能创建子任务。
- 页面能修改子任务状态。
- 页面能添加日志。
- 页面能删除主任务和子任务。
- 页面能显示完成进度。
- 页面使用 localStorage 或本地文件持久化。
- 页面有基本样式。
- `npm run build` 能成功执行。

### 阶段 4：运行验证

目标：

- 在 @@DOCKER_SERVICE@@ 容器内安装依赖。
- 在 @@DOCKER_SERVICE@@ 容器内启动项目。
- 服务监听 0.0.0.0。
- 使用 curl 验证页面可以访问。

示例命令：

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc "cd @@DOCKER_WORKSPACE@@/projects/agent-task-board && npm install"
docker compose exec @@DOCKER_SERVICE@@ bash -lc "cd @@DOCKER_WORKSPACE@@/projects/agent-task-board && npm run dev -- --host 0.0.0.0"
docker compose exec @@DOCKER_SERVICE@@ bash -lc "curl -I http://127.0.0.1:5173"
```

如果当前 Docker 测试环境没有映射 Web 端口，可以先在容器内使用 curl 验证页面是否可访问，并在报告中说明宿主机访问需要额外端口映射。

### 阶段 5：交付报告

最终必须生成：

```text
@@DOCKER_WORKSPACE@@/reports/agent-task-board-report.md
```

报告内容必须包括：

1. 创建了哪些文件。
2. 使用了什么技术栈。
3. 实际执行了哪些命令。
4. 所有命令是否都在 @@DOCKER_SERVICE@@ 容器内执行。
5. 所有项目文件是否都在 @@DOCKER_SERVICE@@ 容器内新建或修改。
6. 启动过程中遇到了哪些问题。
7. 如何修复这些问题。
8. 最终访问地址或容器内验证地址。
9. curl 或浏览器访问验证结果。
10. 当前项目是否验证成功。
11. 如果无法通过宿主机浏览器访问，需要说明是否因为 Docker 端口未映射。

---

## 七、评分规则

总分 100 分，按完成比例打分。

| 阶段 | 内容 | 分值 |
|---|---|---:|
| 阶段 0 | Docker 环境与目录合规 | 10 |
| 阶段 1 | 项目骨架与 README | 15 |
| 阶段 2 | 数据逻辑模块 | 20 |
| 阶段 3 | 页面功能、测试标记、构建 | 20 |
| 阶段 4 | 容器内安装、启动、curl 验证 | 20 |
| 阶段 5 | 交付报告 | 15 |
| 合计 |  | 100 |

扣分原则：

1. 在宿主机直接运行 npm、node、python、pip 等项目命令，严重扣分。
2. 未在 Docker 容器内创建或修改项目文件，严重扣分。
3. 没有真实运行验证，阶段 4 不得分。
4. 没有报告，阶段 5 不得分。
5. 编造命令输出或验证结果，任务判定失败。
6. 页面只是静态说明，没有真实 CRUD 功能，阶段 3 不得分。
7. 数据刷新后丢失，阶段 3 至多得一半。
8. 没有 `src/taskStore.js`，阶段 2 不得分。

---

## 八、交付物

最终应至少包含：

```text
@@DOCKER_WORKSPACE@@/projects/agent-task-board/
  package.json
  README.md
  index.html
  src/
    taskStore.js
    main.jsx 或 main.js
    App.jsx 或 app.js
    styles.css

@@DOCKER_WORKSPACE@@/reports/
  agent-task-board-report.md

@@DOCKER_WORKSPACE@@/logs/
  agent-task-board-install.log
  agent-task-board-dev.log
  agent-task-board-curl.log
```

可以根据技术栈增加其他文件。
