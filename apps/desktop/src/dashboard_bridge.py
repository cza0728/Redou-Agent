"""Local dashboard data bridge for Redou Desktop.

The Electron app does not run the Hermes FastAPI dashboard.  This script
reuses the local Hermes Python modules directly and returns the small subset of
dashboard-shaped JSON that the Redou renderer needs.
"""

from __future__ import annotations

import copy
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# Source checkout layout: apps/desktop/src -> repo root -> vendor/hermes.
_REDOU_PROJECT_ROOT = Path(os.environ.get("REDOU_PROJECT_ROOT", Path(__file__).resolve().parents[3]))
_HERMES_VENDOR_ROOT = Path(os.environ.get("HERMES_VENDOR_ROOT", _REDOU_PROJECT_ROOT / "vendor" / "hermes"))
if _HERMES_VENDOR_ROOT.is_dir():
    value = str(_HERMES_VENDOR_ROOT)
    if value not in sys.path:
        sys.path.insert(0, value)
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import yaml

PROJECT_ROOT = _REDOU_PROJECT_ROOT
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from hermes_cli.config import (  # noqa: E402
    DEFAULT_CONFIG,
    get_config_path,
    get_env_value,
    load_config,
    load_env,
    save_config,
    save_env_value,
)
from hermes_constants import get_hermes_home  # noqa: E402


CATEGORY_ORDER: List[str] = [
    "general",
    "security",
    "agent",
    "terminal",
    "display",
    "delegation",
    "memory",
    "compression",
    "browser",
    "voice",
    "tts",
    "stt",
    "logging",
    "discord",
    "auxiliary",
]

CATEGORY_MERGE = {
    "goals": "agent",
    "telegram": "discord",
}

REDOU_CONTEXT_DIR = ".redou"


AUX_TASK_SLOTS: Tuple[str, ...] = (
    "vision",
    "web_extract",
    "compression",
    "session_search",
    "skills_hub",
    "approval",
    "mcp",
    "title_generation",
    "curator",
)

SCHEMA_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "model": {
        "description": "Default model used for new conversations.",
        "category": "general",
    },
    "model_context_length": {
        "type": "number",
        "description": "Optional context-length override. 0 means auto-detect.",
        "category": "general",
    },
    "dashboard.language": {
        "type": "select",
        "options": ["zh", "en"],
        "description": "Dashboard language.",
        "category": "display",
    },
    "display.language": {
        "type": "select",
        "options": ["zh", "en"],
        "description": "CLI and gateway UI language.",
        "category": "display",
    },
    "agent.max_turns": {
        "type": "number",
        "min": 1,
        "max": 10000,
        "label": "Per-turn max iterations",
        "label_zh": "单轮最大迭代次数",
        "description": "Controls how many model-tool loops the Agent may run in one request or one Goal continuation round. Very high values may make tasks run for a long time and consume more tokens.",
        "description_zh": "控制 Agent 在一次请求或一次 Goal 续跑轮中，最多进行多少次模型-工具循环。数值过大可能导致任务长时间运行和较高 token 消耗。",
        "category": "agent",
    },
    "goals.max_turns": {
        "type": "number",
        "min": 1,
        "max": 500,
        "label": "Goal max continuation rounds",
        "label_zh": "Goal 最大续跑轮数",
        "description": "Goal is the continuous objective mode. When enabled, the Agent checks after each round whether the goal is complete; if not, it continues until completion, pause, or this continuation-round limit. Each round is still bounded by the per-turn max iterations.",
        "description_zh": "Goal 即持续目标模式。开启后，Agent 会在每轮结束后检查目标是否完成；未完成则自动继续，直到完成、暂停或达到最大续跑轮数。每一轮内部仍受“单轮最大迭代次数”限制。",
        "category": "agent",
    },
    "permissions.mode": {
        "category": "security",
        "type": "select",
        "options": ["deny", "ask", "smart", "allow"],
        "description": "Global permission mode for high-risk agent actions.",
    },
    "permissions.runtime_approval_enabled": {
        "category": "security",
        "type": "boolean",
        "description": "Show runtime approval cards when the agent generates high-risk commands.",
    },
    "permissions.approval_timeout_seconds": {
        "category": "security",
        "type": "number",
        "min": 10,
        "max": 3600,
        "description": "Seconds to wait for a runtime approval before denying the command.",
    },
    "permissions.prefilter_user_input": {
        "category": "security",
        "type": "boolean",
        "description": "Check user input before sending and show a high-risk warning when needed.",
    },
    "permissions.default_scope": {
        "category": "security",
        "type": "select",
        "options": ["once", "session", "always"],
        "description": "Default approval scope.",
    },
    "permissions.allow_session_approval": {
        "category": "security",
        "type": "boolean",
        "description": "Allow users to approve similar commands for the current session.",
    },
    "permissions.allow_always_approval": {
        "category": "security",
        "type": "boolean",
        "description": "Allow users to permanently approve a command pattern. Disabled by default.",
    },
    "permissions.hardline_policy": {
        "category": "security",
        "type": "select",
        "options": ["deny"],
        "readonly": True,
        "description": "Hardline commands are always denied and cannot be bypassed.",
    },
    "permissions.cron_mode": {
        "category": "security",
        "type": "select",
        "options": ["deny", "allow"],
        "description": "How unattended cron jobs handle high-risk commands.",
    },
    "permissions.audit_log": {
        "category": "security",
        "type": "boolean",
        "description": "Write structured audit events for approvals and denials.",
    },
    "approvals.mode": {
        "category": "security",
        "type": "select",
        "options": ["manual", "smart", "off"],
        "description": "Legacy Hermes approval mode. Redou permissions.mode takes precedence.",
    },
    "approvals.timeout": {
        "category": "security",
        "type": "number",
        "min": 10,
        "max": 3600,
        "description": "Legacy CLI approval timeout.",
    },
    "approvals.gateway_timeout": {
        "category": "security",
        "type": "number",
        "min": 10,
        "max": 3600,
        "description": "Legacy gateway approval timeout.",
    },
    "approvals.cron_mode": {
        "category": "security",
        "type": "select",
        "options": ["deny", "approve"],
        "description": "Legacy cron approval mode.",
    },
}


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    return str(value)


def _emit(value: Any) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, default=_json_default))


def _error(message: str, code: str = "REDOU_DASHBOARD_BRIDGE_ERROR") -> None:
    _emit({"ok": False, "error": message, "code": code})
    raise SystemExit(1)


def _infer_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "string"


def _build_schema(config: Dict[str, Any], prefix: str = "") -> Dict[str, Dict[str, Any]]:
    schema: Dict[str, Dict[str, Any]] = {}
    for key, value in config.items():
        full_key = f"{prefix}.{key}" if prefix else str(key)
        if full_key == "_config_version":
            continue

        if prefix:
            category = prefix.split(".", 1)[0]
        elif isinstance(value, dict):
            category = str(key)
        else:
            category = "general"

        if isinstance(value, dict):
            schema.update(_build_schema(value, full_key))
            continue

        entry: Dict[str, Any] = {
            "type": _infer_type(value),
            "description": full_key.replace(".", " -> ").replace("_", " ").title(),
            "category": CATEGORY_MERGE.get(category, category),
        }
        if full_key.startswith("permissions.") or full_key.startswith("approvals."):
            entry["category"] = "security"
        entry.update(SCHEMA_OVERRIDES.get(full_key, {}))
        schema[full_key] = entry
    return schema


def _config_schema() -> Dict[str, Dict[str, Any]]:
    schema = _build_schema(DEFAULT_CONFIG)
    ordered: Dict[str, Dict[str, Any]] = {}
    for key, value in schema.items():
        ordered[key] = value
        if key == "model":
            ordered["model_context_length"] = copy.deepcopy(
                SCHEMA_OVERRIDES["model_context_length"]
            )
    return ordered


def _normalize_config_for_web(config: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(config)
    model_value = normalized.get("model")
    if isinstance(model_value, dict):
        ctx = model_value.get("context_length", 0)
        normalized["model"] = model_value.get("default", model_value.get("name", ""))
        normalized["model_context_length"] = ctx if isinstance(ctx, int) else 0
    else:
        normalized["model_context_length"] = 0
    return {k: v for k, v in normalized.items() if not str(k).startswith("_")}


def _denormalize_config_from_web(config: Dict[str, Any]) -> Dict[str, Any]:
    next_config = dict(config)
    next_config.pop("_model_meta", None)
    ctx_override = next_config.pop("model_context_length", 0)
    try:
        ctx_override = int(ctx_override)
    except (TypeError, ValueError):
        ctx_override = 0

    model_value = next_config.get("model")
    if isinstance(model_value, str) and model_value:
        disk_model = load_config().get("model")
        if isinstance(disk_model, dict):
            disk_model = dict(disk_model)
            disk_model["default"] = model_value
            if ctx_override > 0:
                disk_model["context_length"] = ctx_override
            else:
                disk_model.pop("context_length", None)
            next_config["model"] = disk_model
        elif ctx_override > 0:
            next_config["model"] = {
                "default": model_value,
                "context_length": ctx_override,
            }
    return next_config


def _dedupe_strings(values: Iterable[Any]) -> List[str]:
    seen = set()
    out: List[str] = []
    for value in values:
        text = _clean_setup_string(value)
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _positive_int(
    value: Any,
    *,
    default: int | None = None,
    min: int = 1,
    max: int | None = None,
) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed < min:
        return default
    if max is not None and parsed > max:
        return max
    return parsed


def _default_model_request_timeout(provider: str, tags: Iterable[Any] = ()) -> int:
    text = " ".join([provider, *[str(item) for item in tags]]).lower()
    if any(token in text for token in ("local", "vllm", "ollama", "custom")):
        return 600
    return 300


def _clean_setup_string(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()


def _catalog_entry(
    *,
    provider: str,
    label: str,
    description: str,
    base_url: str,
    api_key_env: str,
    models: List[str],
    default_model: str = "",
    base_url_env: str = "",
    region: str = "",
    tags: List[str] | None = None,
    docs_url: str = "",
    api_mode: str = "",
    custom_provider_name: str = "",
    api_key_optional: bool = False,
    request_timeout_seconds: int | None = None,
    model_timeout_seconds: int | None = None,
) -> Dict[str, Any]:
    models = _dedupe_strings(models)
    timeout = request_timeout_seconds or _default_model_request_timeout(provider, tags or [])
    return {
        "provider": provider,
        "label": label,
        "description": description,
        "base_url": base_url,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "models": models,
        "default_model": default_model or (models[0] if models else ""),
        "region": region,
        "tags": tags or [],
        "docs_url": docs_url,
        "api_mode": api_mode,
        "custom_provider_name": custom_provider_name,
        "api_key_optional": api_key_optional,
        "request_timeout_seconds": timeout,
        "model_timeout_seconds": model_timeout_seconds,
    }


MODEL_SETUP_PROVIDER_ORDER: Dict[str, int] = {
    "local-vllm": 0,
    "deepseek": 10,
    "alibaba": 20,
    "kimi-coding-cn": 30,
    "zai": 40,
    "minimax-cn": 50,
    "xiaomi": 60,
    "doubao": 70,
    "openrouter": 100,
    "openai": 110,
    "anthropic": 120,
}


_BUILTIN_MODEL_PROVIDERS = {
    "anthropic",
    "deepseek",
    "minimax",
    "minimax-cn",
    "kimi-coding",
    "kimi-coding-cn",
    "openai",
    "openrouter",
    "zai",
    "alibaba",
    "xiaomi",
    "doubao",
}


def _is_builtin_model_provider(provider: str) -> bool:
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY

        return provider in PROVIDER_REGISTRY
    except Exception:
        return provider in _BUILTIN_MODEL_PROVIDERS


def _provider_model_list(provider_cfg: Dict[str, Any]) -> List[str]:
    model_map = provider_cfg.get("models")
    if isinstance(model_map, dict):
        return [_clean_setup_string(item) for item in model_map.keys()]
    if isinstance(model_map, list):
        return [_clean_setup_string(item) for item in model_map]
    return []


def _hydrate_catalog_from_config(
    catalog: List[Dict[str, Any]],
    cfg: Dict[str, Any],
    current: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Merge saved Redou/Hermes config back into the setup catalog."""
    user_providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    by_provider = {entry["provider"]: entry for entry in catalog}

    for provider, provider_cfg in user_providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        provider = _clean_setup_string(provider)
        entry = by_provider.get(provider)
        if entry is None:
            entry = _catalog_entry(
                provider=provider,
                label=_clean_setup_string(provider_cfg.get("name") or provider),
                description="Saved OpenAI-compatible provider.",
                base_url=_clean_setup_string(provider_cfg.get("base_url")),
                api_key_env=_clean_setup_string(provider_cfg.get("key_env") or provider_cfg.get("api_key_env")),
                models=[],
                default_model=_clean_setup_string(provider_cfg.get("model") or provider_cfg.get("default_model")),
                base_url_env=_clean_setup_string(provider_cfg.get("base_url_env")),
                region=_clean_setup_string(provider_cfg.get("region") or "Custom"),
                tags=["saved"],
                docs_url=_clean_setup_string(provider_cfg.get("docs_url")),
                api_mode=_clean_setup_string(provider_cfg.get("api_mode")),
                custom_provider_name=_clean_setup_string(provider_cfg.get("name") or provider),
            )
            catalog.append(entry)
            by_provider[provider] = entry

        if provider_cfg.get("name"):
            entry["label"] = _clean_setup_string(provider_cfg["name"])
        if provider_cfg.get("base_url"):
            entry["base_url"] = _clean_setup_string(provider_cfg["base_url"]).rstrip("/")
        if provider_cfg.get("key_env") and not entry.get("api_key_env"):
            entry["api_key_env"] = _clean_setup_string(provider_cfg["key_env"])
        if provider_cfg.get("api_mode"):
            entry["api_mode"] = _clean_setup_string(provider_cfg["api_mode"])
        configured_timeout = _positive_int(
            provider_cfg.get("request_timeout_seconds"),
            default=None,
            min=30,
            max=3600,
        )
        if configured_timeout is not None:
            entry["request_timeout_seconds"] = configured_timeout

        configured_model = _clean_setup_string(
            provider_cfg.get("model") or provider_cfg.get("default_model")
        )
        configured_models = _provider_model_list(provider_cfg)
        model_timeout = None
        model_map = provider_cfg.get("models")
        if configured_model and isinstance(model_map, dict):
            model_entry = model_map.get(configured_model)
            if isinstance(model_entry, dict):
                model_timeout = _positive_int(
                    model_entry.get("timeout_seconds"),
                    default=None,
                    min=30,
                    max=3600,
                )
        entry["models"] = _dedupe_strings(
            [configured_model, *configured_models, *(entry.get("models") or [])]
        )
        if configured_model:
            entry["default_model"] = configured_model
        if model_timeout is not None:
            entry["model_timeout_seconds"] = model_timeout

    current_provider = current.get("provider", "")
    current_model = current.get("model", "")
    current_base_url = current.get("base_url", "")
    if current_provider:
        entry = by_provider.get(current_provider)
        if entry is None:
            entry = _catalog_entry(
                provider=current_provider,
                label=current_provider,
                description="Currently configured provider.",
                base_url=current_base_url,
                api_key_env="",
                models=[current_model] if current_model else [],
                default_model=current_model,
                region="Current",
                tags=["current"],
            )
            catalog.insert(0, entry)
            by_provider[current_provider] = entry
        if current_model:
            entry["models"] = _dedupe_strings([current_model, *(entry.get("models") or [])])
            entry["default_model"] = current_model
        if current_base_url:
            entry["base_url"] = current_base_url.rstrip("/")
        current_timeout = _positive_int(
            (user_providers.get(current_provider) or {}).get("request_timeout_seconds")
            if isinstance(user_providers.get(current_provider), dict)
            else None,
            default=None,
            min=30,
            max=3600,
        )
        if current_timeout is not None:
            entry["request_timeout_seconds"] = current_timeout

    catalog.sort(
        key=lambda entry: (
            MODEL_SETUP_PROVIDER_ORDER.get(str(entry.get("provider") or ""), 80),
            str(entry.get("label") or entry.get("provider") or "").lower(),
        )
    )
    return catalog


def _build_model_setup_catalog(cfg: Dict[str, Any] | None = None) -> List[Dict[str, Any]]:
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY
        from hermes_cli.models import _PROVIDER_MODELS
    except Exception:
        PROVIDER_REGISTRY = {}
        _PROVIDER_MODELS = {}

    def base(provider: str, fallback: str = "") -> str:
        cfg = PROVIDER_REGISTRY.get(provider) if isinstance(PROVIDER_REGISTRY, dict) else None
        return str(getattr(cfg, "inference_base_url", "") or fallback)

    def key_env(provider: str, fallback: str = "") -> str:
        cfg = PROVIDER_REGISTRY.get(provider) if isinstance(PROVIDER_REGISTRY, dict) else None
        envs = getattr(cfg, "api_key_env_vars", ()) if cfg else ()
        return str((envs[0] if envs else "") or fallback)

    def base_env(provider: str, fallback: str = "") -> str:
        cfg = PROVIDER_REGISTRY.get(provider) if isinstance(PROVIDER_REGISTRY, dict) else None
        return str(getattr(cfg, "base_url_env_var", "") or fallback)

    def models(provider: str, fallback: List[str]) -> List[str]:
        return list(_PROVIDER_MODELS.get(provider) or fallback)

    catalog = [
        _catalog_entry(
            provider="local-vllm",
            label="Local vLLM",
            description="Local OpenAI-compatible server.",
            base_url="http://127.0.0.1:8000/v1",
            api_key_env="VLLM_API_KEY",
            models=["local-model"],
            default_model="local-model",
            region="Local",
            tags=["vllm", "openai-compatible"],
            docs_url="https://docs.vllm.ai/",
            api_mode="chat_completions",
            custom_provider_name="Local vLLM",
            api_key_optional=True,
        ),
        _catalog_entry(
            provider="deepseek",
            label="DeepSeek",
            description="DeepSeek chat and reasoning models.",
            base_url=base("deepseek", "https://api.deepseek.com/v1"),
            api_key_env=key_env("deepseek", "DEEPSEEK_API_KEY"),
            base_url_env=base_env("deepseek", "DEEPSEEK_BASE_URL"),
            models=models("deepseek", ["deepseek-chat", "deepseek-reasoner"]),
            default_model="deepseek-chat",
            region="CN",
            tags=["reasoning", "coding"],
            docs_url="https://api-docs.deepseek.com/",
        ),
        _catalog_entry(
            provider="minimax-cn",
            label="MiniMax",
            description="China endpoint for MiniMax M2 models.",
            base_url=base("minimax-cn", "https://api.minimaxi.com/anthropic"),
            api_key_env=key_env("minimax-cn", "MINIMAX_CN_API_KEY"),
            base_url_env=base_env("minimax-cn", "MINIMAX_CN_BASE_URL"),
            models=models("minimax-cn", ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"])
            + ["MiniMax-M2.7-highspeed", "MiniMax-M2.5-highspeed", "MiniMax-M2.1-highspeed"],
            default_model="MiniMax-M2.7",
            region="CN",
            tags=["agent", "anthropic"],
            docs_url="https://platform.minimaxi.com/",
            api_mode="anthropic_messages",
        ),
        _catalog_entry(
            provider="kimi-coding-cn",
            label="Kimi / Moonshot",
            description="Moonshot China endpoint for Kimi models.",
            base_url=base("kimi-coding-cn", "https://api.moonshot.cn/v1"),
            api_key_env=key_env("kimi-coding-cn", "KIMI_CN_API_KEY"),
            models=models("kimi-coding-cn", ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking"]),
            default_model="kimi-k2.5",
            region="CN",
            tags=["coding", "long-context"],
            docs_url="https://platform.moonshot.cn/docs",
        ),
        _catalog_entry(
            provider="zai",
            label="GLM / Zhipu",
            description="Z.AI / Zhipu GLM family.",
            base_url=base("zai", "https://api.z.ai/api/paas/v4"),
            api_key_env=key_env("zai", "GLM_API_KEY"),
            base_url_env=base_env("zai", "GLM_BASE_URL"),
            models=models("zai", ["glm-5.1", "glm-5", "glm-4.7"]),
            default_model="glm-5",
            region="CN/Global",
            tags=["reasoning", "coding"],
            docs_url="https://docs.z.ai/",
        ),
        _catalog_entry(
            provider="alibaba",
            label="Qwen / DashScope",
            description="Alibaba DashScope OpenAI-compatible endpoint.",
            base_url=base("alibaba", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"),
            api_key_env=key_env("alibaba", "DASHSCOPE_API_KEY"),
            base_url_env=base_env("alibaba", "DASHSCOPE_BASE_URL"),
            models=models("alibaba", ["qwen3.6-plus", "qwen3.5-plus", "qwen3-coder-plus"]),
            default_model="qwen3.6-plus",
            region="CN/Global",
            tags=["qwen", "coding"],
            docs_url="https://help.aliyun.com/zh/model-studio/",
        ),
        _catalog_entry(
            provider="xiaomi",
            label="Xiaomi MiMo",
            description="Xiaomi MiMo V2.5 and V2 models.",
            base_url=base("xiaomi", "https://api.xiaomimimo.com/v1"),
            api_key_env=key_env("xiaomi", "XIAOMI_API_KEY"),
            base_url_env=base_env("xiaomi", "XIAOMI_BASE_URL"),
            models=models("xiaomi", ["mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro"]),
            default_model="mimo-v2.5-pro",
            region="CN",
            tags=["long-context", "multimodal"],
            docs_url="https://platform.xiaomimimo.com/",
        ),
        _catalog_entry(
            provider="doubao",
            label="Doubao / Volcengine Ark",
            description="ByteDance Doubao models through Ark OpenAI-compatible API.",
            base_url="https://ark.cn-beijing.volces.com/api/v3",
            api_key_env="ARK_API_KEY",
            models=[
                "doubao-seed-1-6",
                "doubao-seed-1-6-251015",
                "doubao-seed-1-6-thinking",
                "doubao-seed-1-6-thinking-250715",
                "doubao-seed-1-6-flash",
                "doubao-seed-1-6-flash-250828",
                "doubao-1-5-pro-32k",
            ],
            default_model="doubao-seed-1-6-251015",
            region="CN",
            tags=["fast", "openai-compatible"],
            docs_url="https://www.volcengine.com/docs/82379",
            api_mode="chat_completions",
            custom_provider_name="Doubao / Volcengine Ark",
        ),
        _catalog_entry(
            provider="openrouter",
            label="OpenRouter",
            description="OpenRouter hosted model marketplace.",
            base_url=base("openrouter", "https://openrouter.ai/api/v1"),
            api_key_env=key_env("openrouter", "OPENROUTER_API_KEY"),
            base_url_env=base_env("openrouter", "OPENROUTER_BASE_URL"),
            models=models(
                "openrouter",
                [
                    "anthropic/claude-sonnet-4.5",
                    "openai/gpt-5.1",
                    "google/gemini-3-pro-preview",
                ],
            ),
            default_model="anthropic/claude-sonnet-4.5",
            region="Global",
            tags=["marketplace"],
            docs_url="https://openrouter.ai/docs",
        ),
        _catalog_entry(
            provider="openai",
            label="OpenAI",
            description="OpenAI API models.",
            base_url=base("openai", "https://api.openai.com/v1"),
            api_key_env=key_env("openai", "OPENAI_API_KEY"),
            models=models("openai", ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"]),
            default_model="gpt-5.1",
            region="Global",
            tags=["tools", "vision"],
            docs_url="https://platform.openai.com/docs",
        ),
        _catalog_entry(
            provider="anthropic",
            label="Anthropic",
            description="Claude models through the Anthropic API.",
            base_url=base("anthropic", "https://api.anthropic.com"),
            api_key_env=key_env("anthropic", "ANTHROPIC_API_KEY"),
            models=models("anthropic", ["claude-sonnet-4-5", "claude-haiku-4-5"]),
            default_model="claude-sonnet-4-5",
            region="Global",
            tags=["agent", "coding"],
            docs_url="https://docs.anthropic.com/",
            api_mode="anthropic_messages",
        ),
    ]

    cfg = cfg if isinstance(cfg, dict) else load_config()
    current = _current_model(cfg)
    catalog = _hydrate_catalog_from_config(catalog, cfg, current)

    model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    user_providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    env_on_disk = load_env()
    for entry in catalog:
        provider_cfg = user_providers.get(entry.get("provider"))
        if not isinstance(provider_cfg, dict):
            provider_cfg = {}
        key = _clean_setup_string(entry.get("api_key_env"))
        base_key = _clean_setup_string(entry.get("base_url_env"))
        env_key_value = _clean_setup_string(env_on_disk.get(key)) if key else ""
        env_base_value = _clean_setup_string(env_on_disk.get(base_key)) if base_key else ""
        has_inline_key = (
            entry.get("provider") == current.get("provider")
            and isinstance(model_cfg, dict)
            and bool(_clean_setup_string(model_cfg.get("api_key")))
        )
        has_provider_inline_key = bool(_clean_setup_string(provider_cfg.get("api_key")))
        entry["api_key_set"] = bool(
            env_key_value or has_inline_key or has_provider_inline_key
        )
        entry["base_url_set"] = bool(env_base_value)
    return catalog


def _current_model(cfg: Dict[str, Any]) -> Dict[str, str]:
    model_cfg = cfg.get("model", {})
    if isinstance(model_cfg, dict):
        return {
            "provider": _clean_setup_string(model_cfg.get("provider")),
            "model": _clean_setup_string(
                model_cfg.get("default", model_cfg.get("model", model_cfg.get("name")))
            ),
            "base_url": _clean_setup_string(model_cfg.get("base_url")),
        }
    return {"provider": "", "model": _clean_setup_string(model_cfg) if model_cfg else "", "base_url": ""}


def _fallback_model_options(cfg: Dict[str, Any]) -> Dict[str, Any]:
    current = _current_model(cfg)
    providers: List[Dict[str, Any]] = []
    for entry in _build_model_setup_catalog():
        include = (
            entry.get("api_key_set")
            or entry.get("api_key_optional")
            or entry["provider"] == current["provider"]
        )
        if include:
            providers.append(
                {
                    "name": entry["label"],
                    "slug": entry["provider"],
                    "models": entry.get("models") or [],
                    "total_models": len(entry.get("models") or []),
                    "is_current": entry["provider"] == current["provider"],
                    "source": "desktop",
                }
            )

    user_providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    for slug, provider_cfg in user_providers.items():
        if not isinstance(provider_cfg, dict):
            continue
        if any(p["slug"] == str(slug) for p in providers):
            continue
        model_map = provider_cfg.get("models")
        model_list = list(model_map.keys()) if isinstance(model_map, dict) else []
        configured_model = provider_cfg.get("model")
        if configured_model:
            model_list = _dedupe_strings([configured_model, *model_list])
        providers.append(
            {
                "name": str(provider_cfg.get("name") or slug),
                "slug": str(slug),
                "models": model_list,
                "total_models": len(model_list),
                "is_current": str(slug) == current["provider"],
                "source": "config",
            }
        )

    if current["provider"] and not any(p["slug"] == current["provider"] for p in providers):
        providers.insert(
            0,
            {
                "name": current["provider"],
                "slug": current["provider"],
                "models": [current["model"]] if current["model"] else [],
                "total_models": 1 if current["model"] else 0,
                "is_current": True,
                "source": "current",
            },
        )

    return {
        "providers": providers,
        "model": current["model"],
        "provider": current["provider"],
    }


def _merge_setup_catalog_models(
    providers: List[Dict[str, Any]],
    cfg: Dict[str, Any],
) -> List[Dict[str, Any]]:
    catalog_by_provider = {
        str(entry.get("provider") or ""): entry
        for entry in _build_model_setup_catalog(cfg)
    }
    merged: List[Dict[str, Any]] = []
    for provider in providers:
        item = dict(provider)
        entry = catalog_by_provider.get(str(item.get("slug") or ""))
        if entry:
            setup_models = list(entry.get("models") or [])
            if setup_models:
                models = _dedupe_strings([*setup_models, *(item.get("models") or [])])
                item["models"] = models
                item["total_models"] = max(int(item.get("total_models") or 0), len(models))
        merged.append(item)
    return merged


def _get_model_options() -> Dict[str, Any]:
    cfg = load_config()
    current = _current_model(cfg)
    try:
        from hermes_cli.model_switch import list_authenticated_providers

        providers = list_authenticated_providers(
            current_provider=current["provider"],
            current_base_url=current["base_url"],
            current_model=current["model"],
            user_providers=cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {},
            custom_providers=cfg.get("custom_providers")
            if isinstance(cfg.get("custom_providers"), list)
            else [],
            max_models=50,
        )
        if providers:
            providers = _merge_setup_catalog_models(providers, cfg)
            return {
                "providers": providers,
                "model": current["model"],
                "provider": current["provider"],
            }
    except Exception:
        pass
    return _fallback_model_options(cfg)


def _get_auxiliary_models() -> Dict[str, Any]:
    cfg = load_config()
    aux_cfg = cfg.get("auxiliary", {})
    if not isinstance(aux_cfg, dict):
        aux_cfg = {}
    tasks = []
    for slot in AUX_TASK_SLOTS:
        slot_cfg = aux_cfg.get(slot, {}) if isinstance(aux_cfg.get(slot), dict) else {}
        tasks.append(
            {
                "task": slot,
                "provider": str(slot_cfg.get("provider", "auto") or "auto"),
                "model": str(slot_cfg.get("model", "") or ""),
                "base_url": str(slot_cfg.get("base_url", "") or ""),
            }
        )
    current = _current_model(cfg)
    return {"tasks": tasks, "main": {"provider": current["provider"], "model": current["model"]}}


def _set_model_assignment(payload: Dict[str, Any]) -> Dict[str, Any]:
    scope = str(payload.get("scope") or "").strip().lower()
    provider = str(payload.get("provider") or "").strip()
    model = str(payload.get("model") or "").strip()
    task = str(payload.get("task") or "").strip().lower()
    if scope not in ("main", "auxiliary"):
        raise ValueError("scope must be 'main' or 'auxiliary'")

    cfg = load_config()
    if scope == "main":
        if not provider or not model:
            raise ValueError("provider and model required for main")
        model_cfg = cfg.get("model", {})
        if not isinstance(model_cfg, dict):
            model_cfg = {}
        model_cfg["provider"] = provider
        model_cfg["default"] = model
        if model_cfg.get("base_url"):
            model_cfg["base_url"] = ""
        model_cfg.pop("context_length", None)
        cfg["model"] = model_cfg
        save_config(cfg)
        return {"ok": True, "scope": "main", "provider": provider, "model": model}

    aux = cfg.get("auxiliary")
    if not isinstance(aux, dict):
        aux = {}
    if task == "__reset__":
        for slot in AUX_TASK_SLOTS:
            slot_cfg = aux.get(slot) if isinstance(aux.get(slot), dict) else {}
            slot_cfg["provider"] = "auto"
            slot_cfg["model"] = ""
            aux[slot] = slot_cfg
        cfg["auxiliary"] = aux
        save_config(cfg)
        return {"ok": True, "scope": "auxiliary", "reset": True}
    if not provider:
        raise ValueError("provider required for auxiliary")
    targets = [task] if task else list(AUX_TASK_SLOTS)
    for slot in targets:
        if slot not in AUX_TASK_SLOTS:
            raise ValueError(f"unknown auxiliary task: {slot}")
        slot_cfg = aux.get(slot) if isinstance(aux.get(slot), dict) else {}
        slot_cfg["provider"] = provider
        slot_cfg["model"] = model
        aux[slot] = slot_cfg
    cfg["auxiliary"] = aux
    save_config(cfg)
    return {
        "ok": True,
        "scope": "auxiliary",
        "tasks": targets,
        "provider": provider,
        "model": model,
    }


def _saved_model_setup_key(
    *,
    cfg: Dict[str, Any],
    provider: str,
    api_key_env: str,
) -> str:
    provider = _clean_setup_string(provider)
    api_key_env = _clean_setup_string(api_key_env)
    if api_key_env:
        env_on_disk = load_env()
        key = _clean_setup_string(env_on_disk.get(api_key_env) or os.environ.get(api_key_env, ""))
        if key:
            return key

    user_providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    provider_cfg = user_providers.get(provider) if isinstance(user_providers, dict) else None
    if isinstance(provider_cfg, dict):
        key_env = _clean_setup_string(provider_cfg.get("key_env") or provider_cfg.get("api_key_env"))
        if key_env:
            env_on_disk = load_env()
            key = _clean_setup_string(env_on_disk.get(key_env) or os.environ.get(key_env, ""))
            if key:
                return key
        key = _clean_setup_string(provider_cfg.get("api_key"))
        if key:
            return key

    model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    if isinstance(model_cfg, dict) and str(model_cfg.get("provider") or "") == provider:
        return _clean_setup_string(model_cfg.get("api_key"))
    return ""


def _fallback_setup_models(
    *,
    cfg: Dict[str, Any],
    provider: str,
    selected_model: str,
    payload_models: Iterable[Any],
) -> List[str]:
    catalog = _build_model_setup_catalog(cfg)
    catalog_models: List[str] = []
    default_model = ""
    for entry in catalog:
        if entry.get("provider") == provider:
            catalog_models = list(entry.get("models") or [])
            default_model = str(entry.get("default_model") or "")
            break
    return _dedupe_strings([selected_model, default_model, *payload_models, *catalog_models])


def _refresh_model_setup_models(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = _clean_setup_string(payload.get("provider"))
    selected_model = _clean_setup_string(payload.get("model"))
    base_url = _clean_setup_string(payload.get("base_url")).rstrip("/")
    api_key = _clean_setup_string(payload.get("api_key"))
    api_key_env = _clean_setup_string(payload.get("api_key_env"))
    base_url_env = _clean_setup_string(payload.get("base_url_env"))
    api_mode = _clean_setup_string(payload.get("api_mode"))
    custom_provider_name = _clean_setup_string(payload.get("custom_provider_name"))
    payload_models = _dedupe_strings(payload.get("models") or [])
    request_timeout_seconds = _positive_int(
        payload.get("request_timeout_seconds"),
        default=_default_model_request_timeout(provider),
        min=30,
        max=3600,
    )
    model_timeout_seconds = _positive_int(
        payload.get("model_timeout_seconds"),
        default=None,
        min=30,
        max=3600,
    )

    if not provider:
        raise ValueError("provider required")
    if not base_url:
        raise ValueError("base_url required")

    cfg = load_config()
    is_builtin_provider = _is_builtin_model_provider(provider)

    if api_key and api_key_env:
        save_env_value(api_key_env, api_key)
    if base_url and base_url_env:
        save_env_value(base_url_env, base_url)

    if custom_provider_name or not is_builtin_provider:
        providers_cfg = cfg.get("providers")
        if not isinstance(providers_cfg, dict):
            providers_cfg = {}
        entry = providers_cfg.get(provider)
        if not isinstance(entry, dict):
            entry = {}
        entry["name"] = custom_provider_name or entry.get("name") or provider
        entry["base_url"] = base_url
        if api_key_env:
            entry["key_env"] = api_key_env
        elif api_key:
            entry["api_key"] = api_key
        if api_mode:
            entry["api_mode"] = api_mode
        if request_timeout_seconds is not None:
            entry["request_timeout_seconds"] = request_timeout_seconds
        if payload_models:
            entry["models"] = {
                item: (
                    {"timeout_seconds": model_timeout_seconds}
                    if model_timeout_seconds is not None and item == selected_model
                    else {}
                )
                for item in payload_models
            }
        providers_cfg[provider] = entry
        cfg["providers"] = providers_cfg
        save_config(cfg)
        cfg = load_config()

    effective_key = api_key or _saved_model_setup_key(
        cfg=cfg,
        provider=provider,
        api_key_env=api_key_env,
    )

    live_models: List[str] = []
    probe: Dict[str, Any] = {}
    warning = ""
    try:
        from hermes_cli.models import probe_api_models

        probe = probe_api_models(
            effective_key or None,
            base_url,
            timeout=8.0,
            api_mode=api_mode or None,
        )
        live_models = _dedupe_strings(probe.get("models") or [])
        status_code = probe.get("status_code")
        if not live_models and status_code in {401, 403}:
            detail = str(probe.get("error") or "").strip()
            raise ValueError(
                f"{provider} API key was rejected (HTTP {status_code}). "
                "Paste a valid key and refresh models again."
                + (f" Provider said: {detail[:240]}" if detail else "")
            )
    except Exception as exc:
        if "API key was rejected" in str(exc):
            raise
        warning = f"Could not refresh models from the provider: {exc}"

    fallback_models = _fallback_setup_models(
        cfg=cfg,
        provider=provider,
        selected_model=selected_model,
        payload_models=payload_models,
    )
    models = live_models or fallback_models
    if not live_models and not warning:
        warning = "Could not read the provider model list; showing saved/default models."
    default_model = selected_model if selected_model in models else (models[0] if models else "")

    if custom_provider_name or not is_builtin_provider or models:
        providers_cfg = cfg.get("providers")
        if not isinstance(providers_cfg, dict):
            providers_cfg = {}
        entry = providers_cfg.get(provider)
        if not isinstance(entry, dict):
            entry = {}
        entry["name"] = custom_provider_name or entry.get("name") or provider
        entry["base_url"] = base_url
        if api_key_env:
            entry["key_env"] = api_key_env
        elif effective_key:
            entry["api_key"] = effective_key
        if api_mode:
            entry["api_mode"] = api_mode
        if request_timeout_seconds is not None:
            entry["request_timeout_seconds"] = request_timeout_seconds
        if models:
            entry["models"] = {
                item: (
                    {"timeout_seconds": model_timeout_seconds}
                    if model_timeout_seconds is not None and item == default_model
                    else {}
                )
                for item in models
            }
        providers_cfg[provider] = entry
        cfg["providers"] = providers_cfg
        save_config(cfg)

    return {
        "ok": True,
        "scope": "main",
        "provider": provider,
        "base_url": base_url,
        "api_key_env": api_key_env,
        "api_key_set": bool(effective_key),
        "base_url_set": bool(base_url_env and base_url),
        "models": models,
        "default_model": default_model,
        "model_count": len(models),
        "request_timeout_seconds": request_timeout_seconds,
        "model_timeout_seconds": model_timeout_seconds,
        "refreshed": bool(live_models),
        "warning": warning,
        "probed_url": probe.get("probed_url"),
    }


def _setup_main_model(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = _clean_setup_string(payload.get("provider"))
    model = _clean_setup_string(payload.get("model"))
    base_url = _clean_setup_string(payload.get("base_url")).rstrip("/")
    api_key = _clean_setup_string(payload.get("api_key"))
    api_key_env = _clean_setup_string(payload.get("api_key_env"))
    base_url_env = _clean_setup_string(payload.get("base_url_env"))
    api_mode = _clean_setup_string(payload.get("api_mode"))
    custom_provider_name = _clean_setup_string(payload.get("custom_provider_name"))
    models = _dedupe_strings(payload.get("models") or [])
    request_timeout_seconds = _positive_int(
        payload.get("request_timeout_seconds"),
        default=_default_model_request_timeout(provider),
        min=30,
        max=3600,
    )
    model_timeout_seconds = _positive_int(
        payload.get("model_timeout_seconds"),
        default=None,
        min=30,
        max=3600,
    )
    if not provider:
        raise ValueError("provider required")
    if not model:
        raise ValueError("model required")

    is_builtin_provider = _is_builtin_model_provider(provider)

    cfg = load_config()
    if api_key and api_key_env:
        save_env_value(api_key_env, api_key)
    if base_url and base_url_env:
        save_env_value(base_url_env, base_url)

    if custom_provider_name or not is_builtin_provider or models or request_timeout_seconds is not None:
        providers_cfg = cfg.get("providers")
        if not isinstance(providers_cfg, dict):
            providers_cfg = {}
        entry = providers_cfg.get(provider)
        if not isinstance(entry, dict):
            entry = {}
        entry["name"] = custom_provider_name or entry.get("name") or provider
        if base_url:
            entry["base_url"] = base_url
        if api_key_env:
            entry["key_env"] = api_key_env
        if api_mode:
            entry["api_mode"] = api_mode
        if request_timeout_seconds is not None:
            entry["request_timeout_seconds"] = request_timeout_seconds
        entry["model"] = model
        entry["default_model"] = model
        if models:
            entry["models"] = {
                item: (
                    {"timeout_seconds": model_timeout_seconds}
                    if model_timeout_seconds is not None and item == model
                    else {}
                )
                for item in models
            }
        elif model_timeout_seconds is not None:
            entry["models"] = {model: {"timeout_seconds": model_timeout_seconds}}
        providers_cfg[provider] = entry
        cfg["providers"] = providers_cfg

    model_cfg = cfg.get("model")
    if not isinstance(model_cfg, dict):
        model_cfg = {}
    model_cfg["provider"] = provider
    model_cfg["default"] = model
    model_cfg["base_url"] = base_url
    if api_mode:
        model_cfg["api_mode"] = api_mode
    else:
        model_cfg.pop("api_mode", None)
    model_cfg.pop("context_length", None)
    if api_key and not api_key_env and (custom_provider_name or not is_builtin_provider):
        model_cfg["api_key"] = api_key
    else:
        model_cfg.pop("api_key", None)
    cfg["model"] = model_cfg
    save_config(cfg)
    return {
        "ok": True,
        "scope": "main",
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "api_key_env": api_key_env,
        "request_timeout_seconds": request_timeout_seconds,
        "model_timeout_seconds": model_timeout_seconds,
    }


def _model_info() -> Dict[str, Any]:
    current = _current_model(load_config())
    model = current["model"]
    provider = current["provider"]
    if not model:
        return {
            "model": "",
            "provider": provider,
            "auto_context_length": 0,
            "config_context_length": 0,
            "effective_context_length": 0,
            "capabilities": {},
        }
    config_ctx = 0
    model_cfg = load_config().get("model", {})
    if isinstance(model_cfg, dict) and isinstance(model_cfg.get("context_length"), int):
        config_ctx = int(model_cfg["context_length"])
    auto_ctx = 0
    caps: Dict[str, Any] = {}
    try:
        from agent.model_metadata import get_model_context_length

        auto_ctx = int(
            get_model_context_length(
                model=model,
                base_url=current["base_url"],
                provider=provider,
                config_context_length=None,
            )
            or 0
        )
    except Exception:
        auto_ctx = 0
    try:
        from agent.models_dev import get_model_capabilities

        mc = get_model_capabilities(provider=provider, model=model)
        if mc is not None:
            caps = {
                "supports_tools": mc.supports_tools,
                "supports_vision": mc.supports_vision,
                "supports_reasoning": mc.supports_reasoning,
                "context_window": mc.context_window,
                "max_output_tokens": mc.max_output_tokens,
                "model_family": mc.model_family,
            }
    except Exception:
        pass
    return {
        "model": model,
        "provider": provider,
        "auto_context_length": auto_ctx,
        "config_context_length": config_ctx,
        "effective_context_length": config_ctx or auto_ctx,
        "capabilities": caps,
    }


def _empty_models_analytics(days: int) -> Dict[str, Any]:
    return {
        "models": [],
        "totals": {
            "distinct_models": 0,
            "total_input": 0,
            "total_output": 0,
            "total_cache_read": 0,
            "total_reasoning": 0,
            "total_estimated_cost": 0,
            "total_actual_cost": 0,
            "total_sessions": 0,
            "total_api_calls": 0,
        },
        "period_days": days,
    }


_API_USAGE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(?P<ms>\d{3})\s+"
    r"INFO\s+(?:\[(?P<session>[^\]]+)\]\s+)?run_agent:\s+API call #(?P<call>\d+):\s+"
    r"model=(?P<model>.*?)\s+provider=(?P<provider>\S+)\s+"
    r"in=(?P<input>[\d,]+)\s+out=(?P<output>[\d,]+)\s+total=(?P<total>[\d,]+)\s+"
    r"latency=(?P<latency>[\d.]+)s(?:\s+cache=(?P<cache_read>[\d,]+)/(?P<prompt>[\d,]+)\s+\((?P<cache_pct>\d+)%\))?"
)


def _to_int(value: Any) -> int:
    try:
        return int(str(value or "0").replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _log_timestamp(ts: str, ms: str) -> Optional[float]:
    try:
        return datetime.strptime(f"{ts},{ms}", "%Y-%m-%d %H:%M:%S,%f").timestamp()
    except (TypeError, ValueError):
        return None


def _new_model_bucket(model: str, provider: str) -> Dict[str, Any]:
    return {
        "model": model,
        "provider": provider,
        "base_url": "",
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "reasoning_tokens": 0,
        "estimated_cost": 0.0,
        "actual_cost": 0.0,
        "sessions": 0,
        "api_calls": 0,
        "tool_calls": 0,
        "last_used_at": 0.0,
        "avg_tokens_per_session": 0,
        "capabilities": {},
        "_session_ids": set(),
        "_session_count": 0,
        "_provider_tokens": {},
        "_provider_base_urls": {},
    }


def _bucket_for(
    buckets: Dict[str, Dict[str, Any]],
    model: str,
    provider: str,
    base_url: str = "",
) -> Dict[str, Any]:
    # The Models page counts "models used" by model name, so the card list
    # must use the same visible identity. Provider/base_url can differ between
    # persisted session rows and per-call logs for the same underlying model.
    if model not in buckets:
        buckets[model] = _new_model_bucket(model, provider)
        buckets[model]["base_url"] = base_url
    elif base_url and not buckets[model].get("base_url"):
        buckets[model]["base_url"] = base_url
    return buckets[model]


def _add_model_usage(
    buckets: Dict[str, Dict[str, Any]],
    *,
    model: str,
    provider: str = "",
    base_url: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    reasoning_tokens: int = 0,
    estimated_cost: float = 0.0,
    actual_cost: float = 0.0,
    session_count: int = 0,
    session_id: str = "",
    api_calls: int = 0,
    tool_calls: int = 0,
    last_used_at: float = 0.0,
) -> None:
    model = str(model or "").strip()
    if not model:
        return
    provider = str(provider or "").strip()
    base_url = str(base_url or "").strip().rstrip("/")
    bucket = _bucket_for(buckets, model, provider, base_url)
    token_total = (
        int(input_tokens or 0)
        + int(output_tokens or 0)
        + int(cache_read_tokens or 0)
        + int(reasoning_tokens or 0)
    )
    if provider:
        provider_tokens = bucket.setdefault("_provider_tokens", {})
        provider_base_urls = bucket.setdefault("_provider_base_urls", {})
        provider_tokens[provider] = int(provider_tokens.get(provider) or 0) + token_total
        if base_url and not provider_base_urls.get(provider):
            provider_base_urls[provider] = base_url
        selected_provider = max(provider_tokens.items(), key=lambda item: item[1])[0]
        bucket["provider"] = selected_provider
        bucket["base_url"] = provider_base_urls.get(selected_provider, "")
    bucket["input_tokens"] += int(input_tokens or 0)
    bucket["output_tokens"] += int(output_tokens or 0)
    bucket["cache_read_tokens"] += int(cache_read_tokens or 0)
    bucket["reasoning_tokens"] += int(reasoning_tokens or 0)
    bucket["estimated_cost"] += float(estimated_cost or 0)
    bucket["actual_cost"] += float(actual_cost or 0)
    bucket["api_calls"] += int(api_calls or 0)
    bucket["tool_calls"] += int(tool_calls or 0)
    bucket["last_used_at"] = max(float(bucket["last_used_at"] or 0), float(last_used_at or 0))
    if session_id:
        bucket["_session_ids"].add(session_id)
    elif session_count:
        bucket["_session_count"] += int(session_count or 0)


def _session_db_paths() -> List[Path]:
    home = get_hermes_home()
    paths = [home / "state.db"]
    # Redou Task Chat runs inside per-project Hermes profiles. When an agent
    # log exists for a profile, prefer parsing that per-call stream below; it
    # preserves model switches inside one task/session. The profile state.db is
    # still a useful fallback for old or pruned profiles that have no log.
    profiles = home / "profiles"
    if profiles.exists():
        for path in sorted(profiles.glob("*/state.db")):
            if not (path.parent / "logs" / "agent.log").exists():
                paths.append(path)
    seen: set[str] = set()
    result: List[Path] = []
    for path in paths:
        try:
            resolved = str(path.resolve())
        except OSError:
            resolved = str(path)
        if resolved in seen or not path.exists():
            continue
        seen.add(resolved)
        result.append(path)
    return result


def _redou_agent_log_paths() -> List[Path]:
    home = get_hermes_home()
    paths: List[Path] = []
    profiles = home / "profiles"
    if profiles.exists():
        paths.extend(sorted(profiles.glob("*/logs/agent.log")))
    return [path for path in paths if path.exists()]


def _add_session_db_usage(
    buckets: Dict[str, Dict[str, Any]],
    cutoff: float,
) -> None:
    try:
        from hermes_state import SessionDB
    except Exception:
        return

    for db_path in _session_db_paths():
        db = None
        try:
            db = SessionDB(db_path=db_path)
            cur = db._conn.execute(
                """
                SELECT model,
                       billing_provider,
                       billing_base_url,
                       SUM(input_tokens) as input_tokens,
                       SUM(output_tokens) as output_tokens,
                       SUM(cache_read_tokens) as cache_read_tokens,
                       SUM(reasoning_tokens) as reasoning_tokens,
                       COALESCE(SUM(estimated_cost_usd), 0) as estimated_cost,
                       COALESCE(SUM(actual_cost_usd), 0) as actual_cost,
                       COUNT(*) as sessions,
                       SUM(COALESCE(api_call_count, 0)) as api_calls,
                       SUM(tool_call_count) as tool_calls,
                       MAX(started_at) as last_used_at
                FROM sessions WHERE started_at > ? AND model IS NOT NULL AND model != ''
                GROUP BY model, billing_provider, billing_base_url
                """,
                (cutoff,),
            )
            for raw in cur.fetchall():
                row = dict(raw)
                _add_model_usage(
                    buckets,
                    model=row.get("model") or "",
                    provider=row.get("billing_provider") or "",
                    base_url=row.get("billing_base_url") or "",
                    input_tokens=row.get("input_tokens") or 0,
                    output_tokens=row.get("output_tokens") or 0,
                    cache_read_tokens=row.get("cache_read_tokens") or 0,
                    reasoning_tokens=row.get("reasoning_tokens") or 0,
                    estimated_cost=row.get("estimated_cost") or 0,
                    actual_cost=row.get("actual_cost") or 0,
                    session_count=row.get("sessions") or 0,
                    api_calls=row.get("api_calls") or 0,
                    tool_calls=row.get("tool_calls") or 0,
                    last_used_at=row.get("last_used_at") or 0,
                )
        except Exception:
            continue
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass


def _add_log_usage(
    buckets: Dict[str, Dict[str, Any]],
    cutoff: float,
) -> None:
    for path in _redou_agent_log_paths():
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            match = _API_USAGE_RE.match(line)
            if not match:
                continue
            ts = _log_timestamp(match.group("ts"), match.group("ms"))
            if ts is None or ts <= cutoff:
                continue
            session_id = str(match.group("session") or "").strip()
            _add_model_usage(
                buckets,
                model=match.group("model") or "",
                provider=match.group("provider") or "",
                input_tokens=_to_int(match.group("input")),
                output_tokens=_to_int(match.group("output")),
                cache_read_tokens=_to_int(match.group("cache_read")),
                session_id=session_id,
                api_calls=1,
                last_used_at=ts,
            )


def _hydrate_model_capabilities(models: List[Dict[str, Any]]) -> None:
    for item in models:
        provider = item.get("provider") or ""
        model_name = item.get("model") or ""
        try:
            from agent.models_dev import get_model_capabilities

            mc = get_model_capabilities(provider=provider, model=model_name)
            if mc is not None:
                item["capabilities"] = {
                    "supports_tools": mc.supports_tools,
                    "supports_vision": mc.supports_vision,
                    "supports_reasoning": mc.supports_reasoning,
                    "context_window": mc.context_window,
                    "max_output_tokens": mc.max_output_tokens,
                    "model_family": mc.model_family,
                }
        except Exception:
            item["capabilities"] = item.get("capabilities") or {}


def _refresh_pricing_cache() -> None:
    try:
        from agent.usage_pricing import refresh_pricing_store

        refresh_pricing_store()
    except Exception:
        pass


def _estimate_bucket_cost(bucket: Dict[str, Any]) -> None:
    try:
        from agent.usage_pricing import CanonicalUsage, estimate_usage_cost

        result = estimate_usage_cost(
            bucket.get("model") or "",
            CanonicalUsage(
                input_tokens=int(bucket.get("input_tokens") or 0),
                output_tokens=int(bucket.get("output_tokens") or 0),
                cache_read_tokens=int(bucket.get("cache_read_tokens") or 0),
            ),
            provider=bucket.get("provider") or "",
            base_url=bucket.get("base_url") or "",
        )
        bucket["cost_status"] = result.status
        bucket["cost_source"] = result.source
        bucket["pricing_version"] = result.pricing_version
        if result.amount_usd is not None:
            bucket["estimated_cost"] = float(result.amount_usd)
    except Exception:
        bucket["cost_status"] = bucket.get("cost_status") or "unknown"


def _models_analytics(days: int) -> Dict[str, Any]:
    cutoff = time.time() - (days * 86400)
    buckets: Dict[str, Dict[str, Any]] = {}

    try:
        _refresh_pricing_cache()
    except Exception:
        pass
    try:
        _add_session_db_usage(buckets, cutoff)
    except Exception:
        pass
    try:
        _add_log_usage(buckets, cutoff)
    except Exception:
        pass

    models: List[Dict[str, Any]] = []
    total_session_ids: set[str] = set()
    total_session_count = 0
    for bucket in buckets.values():
        bucket_session_count = int(bucket.pop("_session_count", 0))
        bucket_session_ids = bucket.pop("_session_ids", set())
        bucket.pop("_provider_tokens", None)
        bucket.pop("_provider_base_urls", None)
        total_session_count += bucket_session_count
        total_session_ids.update(bucket_session_ids)
        session_count = bucket_session_count + len(bucket_session_ids)
        bucket["sessions"] = session_count
        token_total = bucket["input_tokens"] + bucket["output_tokens"]
        bucket["avg_tokens_per_session"] = (token_total / session_count) if session_count else 0
        _estimate_bucket_cost(bucket)
        models.append(bucket)

    models.sort(
        key=lambda item: (
            (item.get("input_tokens") or 0) + (item.get("output_tokens") or 0),
            item.get("api_calls") or 0,
        ),
        reverse=True,
    )
    _hydrate_model_capabilities(models)

    totals = {
        "distinct_models": len({item.get("model") for item in models if item.get("model")}),
        "total_input": sum(item.get("input_tokens") or 0 for item in models),
        "total_output": sum(item.get("output_tokens") or 0 for item in models),
        "total_cache_read": sum(item.get("cache_read_tokens") or 0 for item in models),
        "total_reasoning": sum(item.get("reasoning_tokens") or 0 for item in models),
        "total_estimated_cost": sum(item.get("estimated_cost") or 0 for item in models),
        "total_actual_cost": sum(item.get("actual_cost") or 0 for item in models),
        "total_sessions": total_session_count + len(total_session_ids),
        "total_api_calls": sum(item.get("api_calls") or 0 for item in models),
    }
    return {"models": models, "totals": totals, "period_days": days}


def _sync_bundled_skills() -> None:
    try:
        from tools.skills_sync import sync_skills

        sync_skills(quiet=True)
    except Exception:
        pass


def _get_skills(payload: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    _sync_bundled_skills()
    from hermes_cli.skills_config import get_disabled_skills
    from tools.skills_tool import _find_all_skills

    config = load_config()
    disabled = get_disabled_skills(config)
    skills = _find_all_skills(skip_disabled=True)
    for skill in skills:
        skill["enabled"] = skill.get("name") not in disabled
        skill["id"] = f"root:{skill.get('name')}"
        skill["source"] = "root"
    skills.extend(_get_profile_skills(payload))
    return sorted(
        skills,
        key=lambda item: (
            item.get("category") or "",
            item.get("profile") or "",
            item.get("name") or "",
        ),
    )


def _read_yaml_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_yaml_file(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )


def _disabled_skills_for_home(home: Path) -> Set[str]:
    config = _read_yaml_file(home / "config.yaml")
    skills_cfg = config.get("skills")
    if not isinstance(skills_cfg, dict):
        return set()
    disabled = skills_cfg.get("disabled")
    if isinstance(disabled, str):
        return {disabled}
    if not isinstance(disabled, list):
        return set()
    return {str(item) for item in disabled if str(item).strip()}


def _set_disabled_skill_for_home(home: Path, name: str, enabled: bool) -> None:
    config_path = home / "config.yaml"
    config = _read_yaml_file(config_path)
    skills_cfg = config.setdefault("skills", {})
    if not isinstance(skills_cfg, dict):
        skills_cfg = {}
        config["skills"] = skills_cfg
    disabled = _disabled_skills_for_home(home)
    if enabled:
        disabled.discard(name)
    else:
        disabled.add(name)
    skills_cfg["disabled"] = sorted(disabled)
    _write_yaml_file(config_path, config)


def _remove_disabled_skill_for_home(home: Path, name: str) -> None:
    config_path = home / "config.yaml"
    config = _read_yaml_file(config_path)
    skills_cfg = config.get("skills")
    if not isinstance(skills_cfg, dict):
        return
    disabled = _disabled_skills_for_home(home)
    if name not in disabled:
        return
    disabled.discard(name)
    skills_cfg["disabled"] = sorted(disabled)
    _write_yaml_file(config_path, config)


def _redou_app_data_root() -> Path:
    raw = os.environ.get("REDOU_APP_DATA_ROOT") or ""
    return Path(raw).resolve() if raw else (get_hermes_home().resolve().parent / "appData")


def _read_json_file(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _project_context_dir(project: Dict[str, Any]) -> Optional[Path]:
    workspace = str(project.get("path") or project.get("workspace_path") or "").strip()
    if workspace:
        return (Path(workspace).resolve() / REDOU_CONTEXT_DIR)
    app_data = str(project.get("appDataPath") or "").strip()
    return Path(app_data).resolve() if app_data else None


def _iter_redou_project_profiles() -> Iterable[Tuple[str, Path, Dict[str, Any]]]:
    projects_root = _redou_app_data_root() / "projects"
    if not projects_root.is_dir():
        return []
    rows: List[Tuple[str, Path, Dict[str, Any]]] = []
    for project_json in sorted(projects_root.glob("*/project.json")):
        project = _read_json_file(project_json)
        if not project:
            continue
        context_dir = _project_context_dir(project)
        if context_dir is None:
            continue
        profile_home = context_dir.resolve()
        if not profile_home.is_dir():
            continue
        profile_name = str(project.get("hermesProfile") or project.get("id") or profile_home.name).strip() or profile_home.name
        rows.append((profile_name, profile_home, project))
    return rows


def _iter_payload_project_profiles(profile_homes: Any) -> Iterable[Tuple[str, Path, Dict[str, Any]]]:
    if not isinstance(profile_homes, list):
        return []
    rows: List[Tuple[str, Path, Dict[str, Any]]] = []
    for item in profile_homes:
        if not isinstance(item, dict):
            continue
        raw_home = str(item.get("profileHome") or "").strip()
        if not raw_home:
            continue
        profile_home = Path(raw_home).resolve()
        profile_name = str(item.get("profile") or item.get("projectId") or profile_home.name).strip() or profile_home.name
        project = {
            "id": item.get("projectId") or "",
            "name": item.get("projectName") or "",
            "path": item.get("workspacePath") or "",
            "workspace_path": item.get("workspacePath") or "",
        }
        rows.append((profile_name, profile_home, project))
    return rows


def _allowed_profile_homes() -> Dict[str, Path]:
    homes: Dict[str, Path] = {}
    for profile_name, profile_home, _project in _iter_redou_project_profiles():
        homes[profile_name] = profile_home.resolve()
    return homes


def _profile_home_from_payload(payload: Dict[str, Any]) -> Optional[Path]:
    raw_home = str(payload.get("profileHome") or "").strip()
    allowed = _allowed_profile_homes()
    if raw_home:
        requested = Path(raw_home).resolve()
        if requested in set(allowed.values()):
            return requested
        raise ValueError("profileHome is not a known Redou/Hermes profile path")

    profile = str(payload.get("profile") or "").strip()
    if not profile:
        return None
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,96}", profile):
        raise ValueError("invalid profile name")
    if profile not in allowed:
        raise ValueError("profile was not found in Redou project profiles or Hermes profiles")
    return allowed[profile]


def _category_for_skill(skill_md: Path, skills_dir: Path, frontmatter: Dict[str, Any]) -> Optional[str]:
    try:
        rel_parts = skill_md.relative_to(skills_dir).parts
        if len(rel_parts) >= 3:
            return rel_parts[0]
    except ValueError:
        pass
    metadata = frontmatter.get("metadata")
    hermes = metadata.get("hermes") if isinstance(metadata, dict) else None
    category = hermes.get("category") if isinstance(hermes, dict) else None
    return str(category) if category else None


def _scan_profile_skills(profile_home: Path, profile_name: str) -> List[Dict[str, Any]]:
    from agent.skill_utils import iter_skill_index_files, parse_frontmatter, skill_matches_platform

    skills_dir = profile_home / "skills"
    if not skills_dir.is_dir():
        return []

    disabled = _disabled_skills_for_home(profile_home)
    rows: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for skill_md in iter_skill_index_files(skills_dir, "SKILL.md"):
        try:
            content = skill_md.read_text(encoding="utf-8")[:4000]
            frontmatter, body = parse_frontmatter(content)
        except Exception:
            continue

        if not skill_matches_platform(frontmatter):
            continue

        name = str(frontmatter.get("name") or skill_md.parent.name).strip()[:64]
        if not name or name in seen:
            continue
        seen.add(name)

        description = str(frontmatter.get("description") or "").strip()
        if not description:
            for line in body.strip().split("\n"):
                line = line.strip()
                if line and not line.startswith("#"):
                    description = line
                    break
        if len(description) > 1024:
            description = description[:1021] + "..."

        rows.append(
            {
                "id": f"profile:{profile_name}:{name}",
                "name": name,
                "description": description,
                "category": _category_for_skill(skill_md, skills_dir, frontmatter),
                "enabled": name not in disabled,
                "source": "profile",
                "profile": profile_name,
                "profileHome": str(profile_home.resolve()),
                "path": str(skill_md),
            }
        )
    return rows


def _get_profile_skills(payload: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen: Set[Path] = set()
    for profile_name, profile_home, project in _iter_redou_project_profiles():
        resolved = profile_home.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        project_rows = _scan_profile_skills(resolved, profile_name)
        for row in project_rows:
            row["profileHome"] = str(resolved)
            row["projectId"] = str(project.get("id") or "")
            row["projectName"] = str(project.get("name") or "")
            row["source"] = "profile"
        rows.extend(project_rows)
    return rows


def _toggle_skill(payload: Dict[str, Any]) -> Dict[str, Any]:
    from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills

    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("skill name required")
    enabled = bool(payload.get("enabled"))

    profile_home = _profile_home_from_payload(payload)
    if profile_home is not None:
        _set_disabled_skill_for_home(profile_home, name, enabled)
        return {
            "ok": True,
            "name": name,
            "enabled": enabled,
            "profile": str(payload.get("profile") or profile_home.name),
        }

    config = load_config()
    disabled = get_disabled_skills(config)
    if enabled:
        disabled.discard(name)
    else:
        disabled.add(name)
    save_disabled_skills(config, disabled)
    return {"ok": True, "name": name, "enabled": enabled}


def _delete_skill(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise ValueError("skill name required")

    source = str(payload.get("source") or "").strip()
    profile_home = _profile_home_from_payload(payload)
    if source == "profile" or profile_home is not None:
        if profile_home is None:
            raise ValueError("profile skill deletion requires a profile")
        skill = _resolve_profile_skill({**payload, "source": "profile"})
        result = _call_profile_skill_manage(
            profile_home,
            {
                "action": "delete",
                "name": skill["name"],
                "absorbed_into": "",
            },
        )
        _remove_disabled_skill_for_home(profile_home, skill["name"])
        return {
            "ok": True,
            "name": skill["name"],
            "profile": str(payload.get("profile") or profile_home.name),
            "source": "profile",
            "path": str(skill["skill_dir"]),
            "message": result.get("message") or f"Skill '{skill['name']}' deleted.",
        }

    result = _call_profile_skill_manage(
        get_hermes_home(),
        {
            "action": "delete",
            "name": name,
            "absorbed_into": "",
        },
    )
    _remove_disabled_skill_for_home(get_hermes_home(), name)
    return {
        "ok": True,
        "name": name,
        "source": source or "root",
        "message": result.get("message") or f"Skill '{name}' deleted.",
    }


def _find_profile_skill_md(profile_home: Path, name: str) -> Optional[Path]:
    from agent.skill_utils import iter_skill_index_files, parse_frontmatter

    skills_dir = profile_home / "skills"
    if not skills_dir.is_dir():
        return None
    for skill_md in iter_skill_index_files(skills_dir, "SKILL.md"):
        try:
            frontmatter, _body = parse_frontmatter(skill_md.read_text(encoding="utf-8")[:4000])
        except Exception:
            frontmatter = {}
        found_name = str(frontmatter.get("name") or skill_md.parent.name).strip()
        if found_name == name:
            return skill_md
    return None


def _resolve_profile_skill(item: Dict[str, Any]) -> Dict[str, Any]:
    from agent.skill_utils import parse_frontmatter

    if str(item.get("source") or "") != "profile":
        raise ValueError("Only profile skills can be managed here.")
    name = str(item.get("name") or "").strip()
    if not name:
        raise ValueError("Skill name required.")
    profile_home = _profile_home_from_payload(item)
    if profile_home is None:
        raise ValueError("Profile skill management requires a profile.")
    skills_dir = (profile_home / "skills").resolve()
    raw_path = str(item.get("path") or "").strip()
    skill_md = Path(raw_path).resolve() if raw_path else _find_profile_skill_md(profile_home, name)
    if skill_md is None:
        raise ValueError(f"Skill '{name}' was not found.")
    if skill_md.name != "SKILL.md":
        raise ValueError(f"Skill '{name}' path must point to SKILL.md.")
    try:
        rel = skill_md.relative_to(skills_dir)
    except ValueError as exc:
        raise ValueError(f"Skill '{name}' is outside the profile skills directory.") from exc
    if ".archive" in rel.parts:
        raise ValueError(f"Skill '{name}' is archived and cannot be managed here.")
    if not skill_md.is_file():
        raise ValueError(f"Skill '{name}' is missing SKILL.md.")

    text = skill_md.read_text(encoding="utf-8")
    try:
        frontmatter, _body = parse_frontmatter(text[:4000])
    except Exception:
        frontmatter = {}
    frontmatter_name = str(frontmatter.get("name") or skill_md.parent.name).strip()
    if frontmatter_name != name:
        raise ValueError(f"Skill path/name mismatch for '{name}'.")

    return {
        "name": name,
        "description": str(frontmatter.get("description") or "").strip(),
        "profile": str(item.get("profile") or profile_home.name),
        "profile_home": profile_home,
        "skills_dir": skills_dir,
        "skill_md": skill_md,
        "skill_dir": skill_md.parent.resolve(),
        "text": text,
    }


def _call_profile_skill_manage(profile_home: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    bridge_module = "hermes_cli.skill_manage_bridge"
    env = os.environ.copy()
    env.update(
        {
            "HERMES_HOME": str(profile_home),
            "PYTHONUTF8": "1",
            "PYTHONUNBUFFERED": "1",
            "PYTHONPATH": os.pathsep.join([str(_HERMES_VENDOR_ROOT), env.get("PYTHONPATH", "")]) if _HERMES_VENDOR_ROOT else env.get("PYTHONPATH", ""),
            "HERMES_VENDOR_ROOT": str(_HERMES_VENDOR_ROOT) if _HERMES_VENDOR_ROOT else "",
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", bridge_module],
        cwd=str(PROJECT_ROOT),
        env=env,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=60,
    )
    stdout_lines = [
        line.strip()
        for line in str(result.stdout or "").splitlines()
        if line.strip()
    ]
    raw_json = stdout_lines[-1] if stdout_lines else ""
    parsed: Dict[str, Any] = {}
    if raw_json:
        try:
            parsed = json.loads(raw_json)
        except Exception as exc:
            raise ValueError(f"Hermes skill_manage returned invalid JSON: {exc}") from exc
    if result.returncode != 0 or not parsed.get("ok"):
        message = parsed.get("error") if isinstance(parsed, dict) else ""
        raise ValueError(message or str(result.stderr or result.stdout or f"exit {result.returncode}").strip())
    skill_result = parsed.get("result")
    if not isinstance(skill_result, dict):
        raise ValueError("Hermes skill_manage returned no result.")
    if not skill_result.get("success"):
        raise ValueError(str(skill_result.get("error") or skill_result.get("message") or "merge failed"))
    return skill_result


def _merge_skills(payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_skills = payload.get("skills")
    if not isinstance(raw_skills, list) or len(raw_skills) < 2:
        raise ValueError("Select at least two skills to merge.")

    resolved: List[Dict[str, Any]] = []
    seen_paths: Set[Path] = set()
    for raw in raw_skills:
        if not isinstance(raw, dict):
            raise ValueError("Invalid skill selection.")
        skill = _resolve_profile_skill(raw)
        if skill["skill_dir"] in seen_paths:
            continue
        seen_paths.add(skill["skill_dir"])
        resolved.append(skill)

    if len(resolved) < 2:
        raise ValueError("Select at least two different skills to merge.")
    profiles = {skill["profile"] for skill in resolved}
    if len(profiles) != 1:
        raise ValueError("Skills must belong to the same Hermes profile.")

    target = resolved[0]
    sources = resolved[1:]
    result = _call_profile_skill_manage(
        target["profile_home"],
        {
            "action": "merge",
            "name": target["name"],
            "merge_sources": [source["name"] for source in sources],
        },
    )
    archived = result.get("archived") if isinstance(result.get("archived"), list) else []
    copied_files = result.get("copied_files") if isinstance(result.get("copied_files"), list) else []

    return {
        "ok": True,
        "mergedInto": {
            "name": str(result.get("merged_into") or target["name"]),
            "profile": target["profile"],
            "path": str(result.get("skill_md") or target["skill_md"]),
        },
        "archived": archived,
        "copiedFiles": copied_files,
        "count": 1 + len(archived),
    }


def _get_toolsets() -> List[Dict[str, Any]]:
    from hermes_cli.tools_config import (
        _get_effective_configurable_toolsets,
        _get_platform_tools,
        _toolset_has_keys,
    )
    from toolsets import resolve_toolset

    config = load_config()
    enabled_toolsets = _get_platform_tools(
        config,
        "cli",
        include_default_mcp_servers=False,
    )
    result: List[Dict[str, Any]] = []
    for name, label, description in _get_effective_configurable_toolsets():
        try:
            tools = sorted(set(resolve_toolset(name)))
        except Exception:
            tools = []
        is_enabled = name in enabled_toolsets
        result.append(
            {
                "name": name,
                "label": label,
                "description": description,
                "enabled": is_enabled,
                "available": is_enabled,
                "configured": _toolset_has_keys(name, config),
                "tools": tools,
            }
        )
    return result


_BUILTIN_DASHBOARD_THEMES: List[Dict[str, str]] = [
    {
        "name": "default",
        "label": "AGENT Teal",
        "description": "Classic dark teal - the canonical AGENT look",
    },
    {"name": "midnight", "label": "Midnight", "description": "Deep blue-violet with cool accents"},
    {"name": "ember", "label": "Ember", "description": "Warm crimson and bronze"},
    {"name": "mono", "label": "Mono", "description": "Clean grayscale - minimal and focused"},
    {"name": "paper", "label": "Paper", "description": "White canvas with black text"},
    {"name": "cyberpunk", "label": "Cyberpunk", "description": "Neon green on black"},
    {"name": "rose", "label": "Rose", "description": "Soft pink and warm ivory"},
    {
        "name": "default-large",
        "label": "AGENT Teal (Large)",
        "description": "AGENT Teal with bigger fonts and roomier spacing",
    },
]


def _normalise_dashboard_language(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text if text in {"zh", "en"} else "zh"


def _ensure_dashboard_config(config: Dict[str, Any]) -> Dict[str, Any]:
    dashboard = config.get("dashboard")
    if not isinstance(dashboard, dict):
        dashboard = {}
        config["dashboard"] = dashboard
    return dashboard


def _get_dashboard_theme_name() -> str:
    dashboard = load_config().get("dashboard")
    if isinstance(dashboard, dict):
        return str(dashboard.get("theme") or "default")
    return "default"


def _get_themes() -> Dict[str, Any]:
    return {"themes": list(_BUILTIN_DASHBOARD_THEMES), "active": _get_dashboard_theme_name()}


def _set_theme(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = str(payload.get("name") or "default").strip() or "default"
    config = load_config()
    _ensure_dashboard_config(config)["theme"] = name
    save_config(config)
    return {"ok": True, "theme": name}


def _get_language() -> Dict[str, str]:
    dashboard = load_config().get("dashboard")
    value = dashboard.get("language") if isinstance(dashboard, dict) else "zh"
    return {"language": _normalise_dashboard_language(value)}


def _set_language(payload: Dict[str, Any]) -> Dict[str, Any]:
    language = _normalise_dashboard_language(payload.get("language"))
    config = load_config()
    _ensure_dashboard_config(config)["language"] = language
    save_config(config)
    return {"ok": True, "language": language}


def _require_nonempty_id(payload: Dict[str, Any]) -> str:
    job_id = str(payload.get("id") or "").strip()
    if not job_id:
        raise ValueError("cron job id required")
    return job_id


def _cron_list() -> List[Dict[str, Any]]:
    from cron.jobs import list_jobs

    return list_jobs(include_disabled=True)


def _cron_create(payload: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import create_job

    return create_job(
        prompt=str(payload.get("prompt") or ""),
        schedule=str(payload.get("schedule") or ""),
        name=str(payload.get("name") or "") or None,
        deliver=str(payload.get("deliver") or "local") or "local",
    )


def _cron_update(payload: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import update_job

    job_id = _require_nonempty_id(payload)
    updates = {k: v for k, v in payload.items() if k not in {"id", "job_id"}}
    job = update_job(job_id, updates)
    if not job:
        raise ValueError("cron job not found")
    return job


def _cron_pause(payload: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import pause_job

    job = pause_job(_require_nonempty_id(payload))
    if not job:
        raise ValueError("cron job not found")
    return job


def _cron_resume(payload: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import resume_job

    job = resume_job(_require_nonempty_id(payload))
    if not job:
        raise ValueError("cron job not found")
    return job


def _cron_trigger(payload: Dict[str, Any]) -> Dict[str, Any]:
    from cron.jobs import trigger_job

    job = trigger_job(_require_nonempty_id(payload))
    if not job:
        raise ValueError("cron job not found")
    return job


def _cron_delete(payload: Dict[str, Any]) -> Dict[str, bool]:
    from cron.jobs import remove_job

    if not remove_job(_require_nonempty_id(payload)):
        raise ValueError("cron job not found")
    return {"ok": True}


def _get_dashboard_plugins() -> List[Dict[str, Any]]:
    # Desktop does not serve plugin JS/CSS assets over an HTTP dashboard route.
    # Keep renderer extension injection disabled until there is a desktop asset
    # loader. The plugin hub below still manages agent plugins.
    return []


def _rescan_dashboard_plugins() -> Dict[str, Any]:
    return {"ok": True, "count": 0}


MINIMAX_MCP_NAME = "minimax"
MINIMAX_MCP_PACKAGE_JS = "minimax-mcp-js"
MINIMAX_MCP_DEFAULT_API_HOST = "https://api.minimaxi.com"
MINIMAX_MCP_ENV_KEY = "MINIMAX_API_KEY"
MINIMAX_MCP_CN_ENV_KEY = "MINIMAX_CN_API_KEY"


def _mcp_base_output_dir(name: str = MINIMAX_MCP_NAME) -> Path:
    path = get_hermes_home() / "mcp-outputs" / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _present_env_values(keys: Iterable[str]) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for key in keys:
        value = os.environ.get(key)
        if value:
            env[key] = value
    return env


def _minimax_mcp_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    api_host = _clean_setup_string(
        payload.get("apiHost") or payload.get("api_host") or MINIMAX_MCP_DEFAULT_API_HOST
    ).rstrip("/") or MINIMAX_MCP_DEFAULT_API_HOST
    resource_mode = _clean_setup_string(
        payload.get("resourceMode") or payload.get("resource_mode") or "local"
    ).lower()
    if resource_mode not in {"local", "url"}:
        resource_mode = "local"
    base_path = _clean_setup_string(payload.get("basePath") or payload.get("base_path"))
    output_dir = Path(base_path).expanduser() if base_path else _mcp_base_output_dir(MINIMAX_MCP_NAME)
    output_dir.mkdir(parents=True, exist_ok=True)
    api_key_ref = f"${{{MINIMAX_MCP_ENV_KEY}}}"
    if not get_env_value(MINIMAX_MCP_ENV_KEY) and get_env_value(MINIMAX_MCP_CN_ENV_KEY):
        api_key_ref = f"${{{MINIMAX_MCP_CN_ENV_KEY}}}"
    env = {
        **_present_env_values(
            [
                "APPDATA",
                "LOCALAPPDATA",
                "TEMP",
                "TMP",
                "SystemRoot",
                "ComSpec",
            ]
        ),
        MINIMAX_MCP_ENV_KEY: api_key_ref,
        "MINIMAX_MCP_BASE_PATH": str(output_dir),
        "MINIMAX_API_HOST": api_host,
        "MINIMAX_RESOURCE_MODE": resource_mode,
        "MINIMAX_API_RESOURCE_MODE": resource_mode,
    }
    return {
        "command": "npx",
        "args": ["-y", MINIMAX_MCP_PACKAGE_JS],
        "env": env,
        "timeout": 180,
        "connect_timeout": 120,
        "enabled": bool(payload.get("enable", True)),
        "redou": {
            "preset": "minimax",
            "package": MINIMAX_MCP_PACKAGE_JS,
            "docs": "https://platform.minimaxi.com/docs/guides/mcp-guide",
            "installed_by": "redou",
        },
    }


def _mask_secret(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    if text.startswith("${") and text.endswith("}"):
        return text
    if len(text) <= 8:
        return "***"
    return f"{text[:4]}***{text[-4:]}"


def _mcp_row(name: str, cfg: Dict[str, Any]) -> Dict[str, Any]:
    env = cfg.get("env") if isinstance(cfg.get("env"), dict) else {}
    if "url" in cfg:
        transport = str(cfg.get("transport") or "http")
    else:
        transport = "stdio"
    redou = cfg.get("redou") if isinstance(cfg.get("redou"), dict) else {}
    env_keys = sorted(str(key) for key in env.keys())
    missing_env: List[str] = []
    for key, value in env.items():
        if isinstance(value, str):
            refs = re.findall(r"\$\{([^}]+)\}", value)
            missing_env.extend(ref for ref in refs if not get_env_value(ref))
    missing_env = list(dict.fromkeys(missing_env))
    return {
        "name": name,
        "enabled": cfg.get("enabled", True) is not False,
        "transport": transport,
        "command": str(cfg.get("command") or ""),
        "args": [str(item) for item in (cfg.get("args") or [])],
        "url": str(cfg.get("url") or ""),
        "env_keys": env_keys,
        "env": {str(key): _mask_secret(value) for key, value in env.items()},
        "missing_env": missing_env,
        "preset": str(redou.get("preset") or ""),
        "package": str(redou.get("package") or ""),
        "docs": str(redou.get("docs") or ""),
    }


def _mcp_hub() -> Dict[str, Any]:
    config = load_config()
    servers = config.get("mcp_servers") if isinstance(config.get("mcp_servers"), dict) else {}
    rows = [_mcp_row(str(name), cfg) for name, cfg in servers.items() if isinstance(cfg, dict)]
    has_minimax_key = bool(get_env_value(MINIMAX_MCP_ENV_KEY) or get_env_value(MINIMAX_MCP_CN_ENV_KEY))
    return {
        "servers": rows,
        "presets": {
            "minimax": {
                "name": MINIMAX_MCP_NAME,
                "label": "MiniMax MCP",
                "description": "Text-to-speech, video, image and voice tools from MiniMax.",
                "docs": "https://platform.minimaxi.com/docs/guides/mcp-guide",
                "package": MINIMAX_MCP_PACKAGE_JS,
                "api_key_env": MINIMAX_MCP_ENV_KEY,
                "has_api_key": has_minimax_key,
                "default_api_host": MINIMAX_MCP_DEFAULT_API_HOST,
                "default_resource_mode": "local",
                "default_output_dir": str(_mcp_base_output_dir(MINIMAX_MCP_NAME)),
            }
        },
    }


def _save_mcp_config(name: str, server_config: Dict[str, Any], *, force: bool = False) -> None:
    config = load_config()
    servers = config.get("mcp_servers")
    if not isinstance(servers, dict):
        servers = {}
        config["mcp_servers"] = servers
    if name in servers and not force:
        raise ValueError(f"MCP server '{name}' already exists. Enable force reinstall to overwrite it.")
    servers[name] = server_config
    save_config(config)


def _install_mcp_server(payload: Dict[str, Any]) -> Dict[str, Any]:
    preset = _clean_setup_string(payload.get("preset") or "minimax").lower()
    if preset != "minimax":
        raise ValueError(f"Unsupported MCP preset: {preset}")
    name = _clean_setup_string(payload.get("name") or MINIMAX_MCP_NAME) or MINIMAX_MCP_NAME
    if not re.match(r"^[A-Za-z0-9._-]+$", name):
        raise ValueError("MCP server name may only contain letters, numbers, '.', '_' and '-'.")

    api_key = _clean_setup_string(payload.get("apiKey") or payload.get("api_key"))
    if api_key:
        save_env_value(MINIMAX_MCP_ENV_KEY, api_key)

    server_config = _minimax_mcp_config(payload)
    _save_mcp_config(name, server_config, force=bool(payload.get("force")))
    row = _mcp_row(name, server_config)
    return {
        "ok": True,
        "name": name,
        "enabled": row["enabled"],
        "server": row,
        "missing_env": row["missing_env"],
    }


def _remove_mcp_server(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = _clean_setup_string(payload.get("name") or "")
    if not name:
        raise ValueError("MCP server name required")
    config = load_config()
    servers = config.get("mcp_servers")
    if not isinstance(servers, dict) or name not in servers:
        raise ValueError(f"MCP server '{name}' is not configured")
    del servers[name]
    if not servers:
        config.pop("mcp_servers", None)
    save_config(config)
    return {"ok": True, "name": name}


def _test_mcp_server(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = _clean_setup_string(payload.get("name") or MINIMAX_MCP_NAME) or MINIMAX_MCP_NAME
    config = load_config()
    servers = config.get("mcp_servers") if isinstance(config.get("mcp_servers"), dict) else {}
    cfg = servers.get(name)
    if not isinstance(cfg, dict):
        raise ValueError(f"MCP server '{name}' is not configured")
    try:
        from hermes_cli.mcp_config import _probe_single_server
        from tools.mcp_tool import _interpolate_env_vars

        tools = _probe_single_server(
            name,
            _interpolate_env_vars(copy.deepcopy(cfg)),
            connect_timeout=float(cfg.get("connect_timeout") or 120),
        )
    except Exception as exc:
        return {"ok": False, "name": name, "error": str(exc), "tools": []}
    return {
        "ok": True,
        "name": name,
        "tools": [{"name": tool_name, "description": desc} for tool_name, desc in tools],
    }


def _validate_plugin_name(name: Any) -> str:
    text = str(name or "").strip()
    if not text or "/" in text or "\\" in text or ".." in text:
        raise ValueError("invalid plugin name")
    return text


def _plugins_hub() -> Dict[str, Any]:
    from hermes_cli.plugins_cmd import (
        _discover_all_plugins,
        _discover_context_engines,
        _discover_memory_providers,
        _get_current_context_engine,
        _get_current_memory_provider,
        _get_disabled_set,
        _get_enabled_set,
        _read_manifest as _read_plugin_manifest_at,
    )

    disabled_set = _get_disabled_set()
    enabled_set = _get_enabled_set()
    config = load_config()
    dashboard = config.get("dashboard") if isinstance(config.get("dashboard"), dict) else {}
    hidden_plugins = dashboard.get("hidden_plugins") if isinstance(dashboard, dict) else []
    hidden_set = set(hidden_plugins) if isinstance(hidden_plugins, list) else set()
    plugins_root_resolved = (get_hermes_home() / "plugins").resolve()
    rows: List[Dict[str, Any]] = []

    for name, version, description, source, dir_path in _discover_all_plugins():
        path = Path(dir_path)
        if name in disabled_set:
            runtime_status = "disabled"
        elif name in enabled_set:
            runtime_status = "enabled"
        else:
            runtime_status = "inactive"

        under_user_tree = False
        try:
            path.resolve().relative_to(plugins_root_resolved)
            under_user_tree = True
        except ValueError:
            pass

        can_remove_update = source in ("user", "git") and under_user_tree and path.is_dir()
        manifest_data = _read_plugin_manifest_at(path)
        provides_tools = manifest_data.get("provides_tools") or []
        auth_required = False
        auth_command = ""
        if provides_tools:
            try:
                from tools.registry import registry

                for tool_name in provides_tools:
                    entry = registry.get_entry(tool_name)
                    if entry and entry.check_fn and not entry.check_fn():
                        auth_required = True
                        auth_command = f"hermes auth {name}"
                        break
            except Exception:
                pass

        rows.append(
            {
                "name": name,
                "version": version or "",
                "description": description or "",
                "source": source,
                "runtime_status": runtime_status,
                "has_dashboard_manifest": (path / "dashboard" / "manifest.json").exists(),
                "dashboard_manifest": None,
                "path": str(path),
                "can_remove": can_remove_update,
                "can_update_git": can_remove_update and (path / ".git").exists(),
                "auth_required": auth_required,
                "auth_command": auth_command,
                "user_hidden": name in hidden_set,
            }
        )

    memory_options: List[Dict[str, str]] = []
    try:
        memory_options = [
            {"name": name, "description": description}
            for name, description in _discover_memory_providers()
        ]
    except Exception:
        pass

    context_options: List[Dict[str, str]] = []
    try:
        context_options = [
            {"name": name, "description": description}
            for name, description in _discover_context_engines()
        ]
    except Exception:
        pass

    return {
        "plugins": rows,
        "orphan_dashboard_plugins": [],
        "providers": {
            "memory_provider": _get_current_memory_provider() or "",
            "memory_options": memory_options,
            "context_engine": _get_current_context_engine(),
            "context_options": context_options,
        },
    }


def _install_agent_plugin(payload: Dict[str, Any]) -> Dict[str, Any]:
    from hermes_cli.plugins_cmd import dashboard_install_plugin

    identifier = str(payload.get("identifier") or "").strip()
    if not identifier:
        raise ValueError("plugin identifier required")
    result = dashboard_install_plugin(
        identifier,
        force=bool(payload.get("force")),
        enable=bool(payload.get("enable", True)),
    )
    if not result.get("ok"):
        raise ValueError(str(result.get("error") or "plugin install failed"))
    return result


def _set_agent_plugin_enabled(payload: Dict[str, Any]) -> Dict[str, Any]:
    from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled

    result = dashboard_set_agent_plugin_enabled(
        _validate_plugin_name(payload.get("name")),
        enabled=bool(payload.get("enabled")),
    )
    if not result.get("ok"):
        raise ValueError(str(result.get("error") or "plugin state update failed"))
    return result


def _update_agent_plugin(payload: Dict[str, Any]) -> Dict[str, Any]:
    from hermes_cli.plugins_cmd import dashboard_update_user_plugin

    result = dashboard_update_user_plugin(_validate_plugin_name(payload.get("name")))
    if not result.get("ok"):
        raise ValueError(str(result.get("error") or "plugin update failed"))
    return result


def _remove_agent_plugin(payload: Dict[str, Any]) -> Dict[str, Any]:
    from hermes_cli.plugins_cmd import dashboard_remove_user_plugin

    result = dashboard_remove_user_plugin(_validate_plugin_name(payload.get("name")))
    if not result.get("ok"):
        raise ValueError(str(result.get("error") or "plugin remove failed"))
    return result


def _save_plugin_providers(payload: Dict[str, Any]) -> Dict[str, bool]:
    from hermes_cli.plugins_cmd import _save_context_engine, _save_memory_provider

    if "memory_provider" in payload:
        _save_memory_provider(str(payload.get("memory_provider") or ""))
    if "context_engine" in payload:
        _save_context_engine(str(payload.get("context_engine") or ""))
    return {"ok": True}


def _set_plugin_visibility(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = _validate_plugin_name(payload.get("name"))
    hidden = bool(payload.get("hidden"))
    config = load_config()
    dashboard = _ensure_dashboard_config(config)
    hidden_list = dashboard.get("hidden_plugins")
    if not isinstance(hidden_list, list):
        hidden_list = []
    if hidden and name not in hidden_list:
        hidden_list.append(name)
    elif not hidden and name in hidden_list:
        hidden_list.remove(name)
    dashboard["hidden_plugins"] = hidden_list
    save_config(config)
    return {"ok": True, "name": name, "hidden": hidden}


def handle(action: str, payload: Dict[str, Any]) -> Any:
    if action == "get_config":
        return _normalize_config_for_web(load_config())
    if action == "get_defaults":
        return DEFAULT_CONFIG
    if action == "get_schema":
        return {"fields": _config_schema(), "category_order": CATEGORY_ORDER}
    if action == "save_config":
        save_config(_denormalize_config_from_web(payload.get("config") or {}))
        return {"ok": True}
    if action == "get_config_raw":
        path = get_config_path()
        return {"yaml": path.read_text(encoding="utf-8") if path.exists() else ""}
    if action == "save_config_raw":
        parsed = yaml.safe_load(str(payload.get("yaml_text") or ""))
        if not isinstance(parsed, dict):
            raise ValueError("YAML must be a mapping")
        save_config(parsed)
        return {"ok": True}
    if action == "get_model_info":
        return _model_info()
    if action == "get_model_setup_catalog":
        cfg = load_config()
        current = _current_model(cfg)
        return {"providers": _build_model_setup_catalog(cfg), "current": current}
    if action == "get_model_options":
        return _get_model_options()
    if action == "get_auxiliary_models":
        return _get_auxiliary_models()
    if action == "set_model_assignment":
        return _set_model_assignment(payload)
    if action == "refresh_model_setup_models":
        return _refresh_model_setup_models(payload)
    if action == "setup_main_model":
        return _setup_main_model(payload)
    if action == "get_models_analytics":
        return _models_analytics(int(payload.get("days") or 30))
    if action == "get_skills":
        return _get_skills(payload)
    if action == "toggle_skill":
        return _toggle_skill(payload)
    if action == "delete_skill":
        return _delete_skill(payload)
    if action == "merge_skills":
        return _merge_skills(payload)
    if action == "get_toolsets":
        return _get_toolsets()
    if action == "get_themes":
        return _get_themes()
    if action == "set_theme":
        return _set_theme(payload)
    if action == "get_language":
        return _get_language()
    if action == "set_language":
        return _set_language(payload)
    if action == "cron_list":
        return _cron_list()
    if action == "cron_create":
        return _cron_create(payload)
    if action == "cron_update":
        return _cron_update(payload)
    if action == "cron_pause":
        return _cron_pause(payload)
    if action == "cron_resume":
        return _cron_resume(payload)
    if action == "cron_trigger":
        return _cron_trigger(payload)
    if action == "cron_delete":
        return _cron_delete(payload)
    if action == "get_dashboard_plugins":
        return _get_dashboard_plugins()
    if action == "rescan_dashboard_plugins":
        return _rescan_dashboard_plugins()
    if action == "get_plugins_hub":
        return _plugins_hub()
    if action == "get_mcp_hub":
        return _mcp_hub()
    if action == "install_mcp_server":
        return _install_mcp_server(payload)
    if action == "remove_mcp_server":
        return _remove_mcp_server(payload)
    if action == "test_mcp_server":
        return _test_mcp_server(payload)
    if action == "install_agent_plugin":
        return _install_agent_plugin(payload)
    if action == "set_agent_plugin_enabled":
        return _set_agent_plugin_enabled(payload)
    if action == "update_agent_plugin":
        return _update_agent_plugin(payload)
    if action == "remove_agent_plugin":
        return _remove_agent_plugin(payload)
    if action == "save_plugin_providers":
        return _save_plugin_providers(payload)
    if action == "set_plugin_visibility":
        return _set_plugin_visibility(payload)
    raise ValueError(f"Unsupported dashboard bridge action: {action}")


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = handle(action, payload if isinstance(payload, dict) else {})
        _emit(result)
    except Exception as exc:
        _error(str(exc))


if __name__ == "__main__":
    main()
