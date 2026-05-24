# Redou Agent 中文说明


## 配置和数据位置

完整路径契约见 `docs/architecture/source-and-generated-paths.md`。项目级规则、任务上下文、消息、上传和任务打包出来的 skill 都归置到项目工作区的 `.redou/` 下；Electron `userData` 只保留全局配置、运行时、项目索引和日志。

```text
<workspace>/.redou/PROJECT_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_RULES.md
<workspace>/.redou/tasks/<task-id>/TASK_CONTEXT.md
<workspace>/.redou/tasks/<task-id>/messages.jsonl
<workspace>/.redou/skills/task-packages/<skill-name>/SKILL.md
```

完整中文 README 请阅读 [README.md](README.md)。

根 README 当前就是 Redou Agent 的中文产品说明，包含品牌 logo、产品特色、界面导览、安装指南、模型配置、任务操作、Skills 工作流、数据位置、开发命令和常见问题。
