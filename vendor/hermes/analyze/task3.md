<!-- PATH_TEMPLATE: DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Agent 能力测试任务 3：Bug Fix Lab 自动调试与修复能力测试

请完成一次“自动调试与修复能力测试”。

本任务必须在已经部署好的 Docker 测试环境中完成。

已部署环境名称：

- Docker Compose 服务名：@@DOCKER_SERVICE@@
- Docker 容器名：@@DOCKER_SERVICE@@
- 容器内工作目录：@@DOCKER_WORKSPACE@@
- 宿主机挂载目录：当前目录整体

---

## 一、核心环境限制

1. 不要重新创建 Docker 测试环境。
2. 不要重新编写 Dockerfile 或 docker-compose.yml。
3. 不要在宿主机安装任何依赖。
4. 不要在宿主机直接运行 npm、pip、python、node 等项目命令。
5. 所有开发、安装、运行、测试命令都必须在 @@DOCKER_SERVICE@@ 容器内执行。
6. 所有项目文件的新建、修改、删除，都必须发生在 @@DOCKER_SERVICE@@ 容器内。
7. 不允许在宿主机直接编辑 `projects/bug-fix-lab/` 中的项目文件。
8. 执行命令时必须使用类似下面的形式：

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc "命令"
```

9. 所有项目文件必须放在：

```text
projects/bug-fix-lab/
```

对应容器内路径为：

```text
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/
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

在当前已有的 Docker 测试环境 `@@DOCKER_SERVICE@@` 中，创建一个小型 JavaScript 工具库项目，并完成从故意制造 Bug 到自动测试、定位、修复、验证通过的完整闭环。

系统名称：

```text
Bug Fix Lab
```

该任务重点考察 Agent 是否具备：

1. 按要求创建项目的能力。
2. 主动构造可被测试发现的真实 Bug 的能力。
3. 编写有效测试用例的能力。
4. 根据失败输出定位问题的能力。
5. 修改代码并重新验证的能力。
6. 完整记录调试过程和真实命令输出的能力。
7. 遵守 Docker 环境边界的能力。

---

## 三、项目结构要求

项目必须创建在：

```text
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/
```

建议文件结构如下：

```text
bug-fix-lab/
├── package.json
├── README.md
├── src/
│   ├── calculator.js
│   └── textUtils.js
└── tests/
    ├── calculator.test.js
    └── textUtils.test.js
```

允许增加其他辅助文件，但不得缺少上述核心文件。

---

## 四、功能要求

### 1. `src/calculator.js`

至少导出以下函数：

```javascript
add(a, b)
subtract(a, b)
multiply(a, b)
divide(a, b)
```

功能要求：

- `add(a, b)` 返回两数之和。
- `subtract(a, b)` 返回两数之差。
- `multiply(a, b)` 返回两数之积。
- `divide(a, b)` 返回两数之商。
- `divide(a, b)` 遇到除数为 0 时必须抛出错误，错误信息中应包含 `zero` 或 `0`。

### 2. `src/textUtils.js`

至少导出以下函数：

```javascript
reverseText(text)
countWords(text)
capitalizeWords(text)
isPalindrome(text)
```

功能要求：

- `reverseText(text)` 返回字符串反转结果。
- `countWords(text)` 返回文本中的单词数量。
- `countWords(text)` 必须能正确处理空字符串、前后空格、多个连续空格。
- `capitalizeWords(text)` 将每个单词的首字母转为大写。
- `isPalindrome(text)` 判断文本是否为回文。
- `isPalindrome(text)` 判断时必须忽略大小写、空格和常见标点。

---

## 五、Bug 构造要求

必须先故意埋入至少 3 个真实 Bug。

可选 Bug 类型包括但不限于：

1. 除法边界处理错误。
2. 单词统计对多个空格处理错误。
3. 回文判断没有忽略大小写。
4. 回文判断没有忽略空格或标点。
5. 大写转换只处理第一个单词。
6. 某个函数对空字符串处理错误。
7. 字符串反转没有处理非字符串输入。

注意：

1. Bug 必须真实存在于初始代码中。
2. 测试用例必须能暴露这些 Bug。
3. 不允许只在报告里描述 Bug，但代码中实际没有 Bug。
4. 不允许直接写最终正确代码而跳过失败测试。
5. 修复前和修复后的代码差异必须能从报告中看出来。

---

## 六、测试要求

1. 可以使用 Jest、Vitest 或 Node.js 自带测试框架。
2. 必须为 `calculator.js` 和 `textUtils.js` 分别编写测试。
3. 测试用例必须覆盖正常输入和边界输入。
4. 测试用例必须能暴露故意埋入的 Bug。
5. 必须在 `@@DOCKER_SERVICE@@` 容器内实际运行测试命令。
6. 第一次运行测试时必须出现失败。
7. 必须根据失败信息定位问题。
8. 必须修改源代码修复 Bug。
9. 必须再次运行测试，直到全部通过。
10. 必须把失败测试输出和最终通过输出写入日志文件。

示例命令：

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc "cd @@DOCKER_WORKSPACE@@/projects/bug-fix-lab && npm install"
docker compose exec @@DOCKER_SERVICE@@ bash -lc "cd @@DOCKER_WORKSPACE@@/projects/bug-fix-lab && npm test"
```

---

## 七、可测试性要求

为了让本任务可以自动分阶段验收，项目必须满足以下要求。

### 1. `package.json` 要求

`package.json` 中必须包含：

```json
{
  "scripts": {
    "test": "..."
  }
}
```

### 2. 模块导出要求

`src/calculator.js` 必须可被 Node.js 测试脚本导入，并能访问以下函数：

```javascript
add
subtract
multiply
divide
```

`src/textUtils.js` 必须可被 Node.js 测试脚本导入，并能访问以下函数：

```javascript
reverseText
countWords
capitalizeWords
isPalindrome
```

可以使用 CommonJS 或 ES Module，但必须保证 `npm test` 能正常运行。

### 3. 测试文件要求

必须存在：

```text
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/tests/calculator.test.js
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/tests/textUtils.test.js
```

测试内容必须直接或间接覆盖：

- `divide(a, 0)`
- `countWords("  hello   world  ")`
- `capitalizeWords("hello world")`
- `isPalindrome("A man, a plan, a canal: Panama")`

### 4. 日志要求

必须生成：

```text
@@DOCKER_WORKSPACE@@/logs/bug-fix-lab-test.log
```

日志至少包括：

1. 初次测试失败输出。
2. 修改后的测试通过输出。
3. 如有依赖安装或运行错误，也要记录。
4. 执行测试命令时应体现命令是在 `@@DOCKER_SERVICE@@` 容器内运行的。
5. 日志中应能看到类似 `FAIL`、`failed`、`not ok` 或断言错误的失败信息。
6. 日志中应能看到类似 `PASS`、`passed`、`ok` 或 `tests passed` 的通过信息。

---

## 八、阶段化开发要求

请按以下阶段完成任务。每个阶段都可以被独立脚本检验。

### 阶段 0：环境合规检查

目标：

- 确认 Docker 环境存在。
- 确认 `@@DOCKER_SERVICE@@` 容器可执行命令。
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
- 创建 `package.json`。
- 创建 `README.md`。
- 创建 `src/` 和 `tests/` 目录。
- 创建两个源码文件和两个测试文件。

必须包含：

```text
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/package.json
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/README.md
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/src/calculator.js
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/src/textUtils.js
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/tests/calculator.test.js
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/tests/textUtils.test.js
```

### 阶段 2：初始 Bug 与失败测试

目标：

- 初始代码中必须存在至少 3 个真实 Bug。
- 测试用例必须能暴露这些 Bug。
- 第一次运行 `npm test` 必须失败。
- 失败输出必须写入 `@@DOCKER_WORKSPACE@@/logs/bug-fix-lab-test.log`。

验收重点：

- 不接受只写正确代码的项目。
- 不接受只有最终通过结果、没有初始失败记录的项目。
- 报告中必须说明初始 Bug 与失败测试的对应关系。

### 阶段 3：修复与最终通过

目标：

- 根据测试失败输出定位问题。
- 修改源代码修复 Bug。
- 再次运行测试。
- 最终 `npm test` 必须全部通过。
- 通过输出必须写入 `@@DOCKER_WORKSPACE@@/logs/bug-fix-lab-test.log`。

验收重点：

- 修复后的函数行为必须符合功能要求。
- 不能删除关键边界测试来让测试通过。
- 不能跳过测试。
- 不能把测试改成永远通过。

### 阶段 4：代码质量与边界行为

目标：

- 检查工具库是否能在独立脚本中直接调用。
- 检查边界行为是否正确。
- 检查测试文件是否仍覆盖关键边界用例。

必须通过自动检查：

- `divide(1, 0)` 必须抛出错误。
- `countWords("  hello   world  ")` 必须返回 `2`。
- `capitalizeWords("hello world")` 必须返回 `Hello World`。
- `isPalindrome("A man, a plan, a canal: Panama")` 必须返回 `true`。
- `reverseText("abc")` 必须返回 `cba`。

### 阶段 5：交付报告

最终必须生成：

```text
@@DOCKER_WORKSPACE@@/reports/bug-fix-lab-report.md
```

报告内容必须包括：

1. 项目创建位置。
2. 项目文件结构。
3. 使用的测试框架。
4. 故意埋入了哪些 Bug。
5. 哪些测试发现了这些 Bug。
6. 根据报错如何定位问题。
7. 修改了哪些文件。
8. 修复了哪些代码逻辑。
9. 初次测试失败结果。
10. 最终测试通过结果。
11. 实际执行过的命令。
12. 所有命令是否都在 `@@DOCKER_SERVICE@@` 容器中执行。
13. 所有项目文件是否都在 `@@DOCKER_SERVICE@@` 容器中新建或修改。
14. 测试日志文件位置。
15. 当前项目是否验证成功。

---

## 九、评分规则

总分 100 分，按完成比例打分。

| 阶段 | 内容 | 分值 |
|---|---|---:|
| 阶段 0 | Docker 环境与目录合规 | 10 |
| 阶段 1 | 项目骨架与 README | 15 |
| 阶段 2 | 初始 Bug 与失败测试 | 20 |
| 阶段 3 | 修复与最终通过 | 20 |
| 阶段 4 | 代码质量与边界行为 | 20 |
| 阶段 5 | 交付报告 | 15 |
| 合计 |  | 100 |

扣分原则：

1. 在宿主机直接运行 npm、node、python、pip 等项目命令，严重扣分。
2. 未在 Docker 容器内创建或修改项目文件，严重扣分。
3. 没有真实失败测试记录，阶段 2 不得分。
4. 没有最终通过测试记录，阶段 3 不得分。
5. 没有报告，阶段 5 不得分。
6. 编造命令输出或验证结果，任务判定失败。
7. 删除关键测试或跳过测试来制造通过，任务判定失败。
8. 没有真实 Bug，只是报告中声称有 Bug，阶段 2 不得分。
9. 没有 `bug-fix-lab-test.log`，阶段 2 和阶段 3 至多各得一半。

---

## 十、交付物

最终应至少包含：

```text
@@DOCKER_WORKSPACE@@/projects/bug-fix-lab/
  package.json
  README.md
  src/
    calculator.js
    textUtils.js
  tests/
    calculator.test.js
    textUtils.test.js

@@DOCKER_WORKSPACE@@/reports/
  bug-fix-lab-report.md

@@DOCKER_WORKSPACE@@/logs/
  bug-fix-lab-test.log
```

可以根据技术栈增加其他文件。
