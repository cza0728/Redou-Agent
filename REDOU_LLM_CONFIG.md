# Redou Agent LLM 与 API Key 配置

Redou Agent 继承 Hermes Agent 的模型配置。推荐把 API Key 放在用户目录的 `.env`，不要写进项目源码。

## 配置文件位置

Windows 原生：

```powershell
%LOCALAPPDATA%\hermes\config.yaml
%LOCALAPPDATA%\hermes\.env
```

WSL / Linux / macOS：

```bash
~/.hermes/config.yaml
~/.hermes/.env
```

如果目录不存在，先创建它。

## 方式一：用界面配置

启动 Redou Agent 桌面应用：

```powershell
cd "D:\SynologyDrive\ZhuSync\workcopy\RedouAgent"
.\Launch Redou Agent.cmd
```

或者直接运行 PowerShell 启动脚本：

```powershell
cd "D:\SynologyDrive\ZhuSync\workcopy\RedouAgent"
.\start-redou-agent.ps1
```

Renderer/UI 层只通过 Electron IPC 与 Main Process / Local Service 通信。
Main Process 负责读写本地配置和调用 Hermes 本地运行时，不需要启动独立 Web 后端、
HTTP API、FastAPI 或 Express Server。在应用侧边栏进入 `Keys` 填 API Key，进入
`Models` 或 `Config` 切换 provider 和 model。

## 方式二：直接写配置文件

### DeepSeek，OpenAI-compatible

`.env`：

```env
DEEPSEEK_API_KEY=sk-your-deepseek-key
```

`config.yaml`：

```yaml
model:
  provider: deepseek
  default: deepseek-chat
  base_url: "https://api.deepseek.com/v1"
  api_mode: chat_completions
```

如果要用 `install.sh` 里 DeepSeek 的 Anthropic-compatible endpoint：

```yaml
custom_providers:
  - name: deepseek-anthropic
    base_url: "https://api.deepseek.com/anthropic"
    key_env: DEEPSEEK_API_KEY
    api_mode: anthropic_messages
    models:
      "deepseek-v4-pro[1m]":
        context_length: 1000000
      deepseek-v4-pro: {}
      deepseek-v4-flash: {}

model:
  provider: custom:deepseek-anthropic
  default: "deepseek-v4-pro[1m]"
```

### MiniMax，国际版

`.env`：

```env
MINIMAX_API_KEY=your-minimax-key
```

`config.yaml`：

```yaml
model:
  provider: minimax
  default: MiniMax-M2.7
  base_url: "https://api.minimax.io/anthropic"
  api_mode: anthropic_messages
```

### MiniMax，中国大陆版

`.env`：

```env
MINIMAX_CN_API_KEY=your-minimax-cn-key
```

`config.yaml`：

```yaml
model:
  provider: minimax-cn
  default: MiniMax-M2.7
  base_url: "https://api.minimaxi.com/anthropic"
  api_mode: anthropic_messages
```

### vLLM / 本地 OpenAI-compatible 服务

假设 vLLM 用 OpenAI-compatible API 跑在 `http://127.0.0.1:8000/v1`。

`.env`：

```env
VLLM_API_KEY=EMPTY
```

`config.yaml`：

```yaml
custom_providers:
  - name: vllm-local
    base_url: "http://127.0.0.1:8000/v1"
    key_env: VLLM_API_KEY
    api_mode: chat_completions
    models:
      qwen3-coder:
        context_length: 32768
      deepseek-r1:
        context_length: 32768

model:
  provider: custom:vllm-local
  default: qwen3-coder
```

如果你的 vLLM 不需要鉴权，也可以删除 `key_env`，Redou Agent 会按本地无 key 服务处理。

## 命令行切换

交互式选择模型：

```powershell
cd "D:\SynologyDrive\ZhuSync\workcopy\Redou Agent"
python -m hermes_cli.main model
```

在聊天中临时切换：

```text
/model deepseek:deepseek-chat
/model minimax:MiniMax-M2.7
/model minimax-cn:MiniMax-M2.7
/model custom:vllm-local:qwen3-coder
/model custom:deepseek-anthropic:deepseek-v4-pro[1m]
```

检查配置：

```powershell
python -m hermes_cli.main doctor
```
