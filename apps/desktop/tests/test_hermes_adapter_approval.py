import importlib.util
import os
from pathlib import Path
import sys
import threading
import time
import types


def load_adapter():
    adapter_path = Path(__file__).resolve().parents[1] / "src" / "hermes_adapter.py"
    spec = importlib.util.spec_from_file_location("redou_hermes_adapter_for_test", adapter_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_approval_module():
    vendor_root = Path(__file__).resolve().parents[3] / "vendor" / "hermes"
    if str(vendor_root) not in sys.path:
        sys.path.insert(0, str(vendor_root))
    saved_modules = {name: sys.modules.get(name) for name in ("hermes_cli", "hermes_cli.config", "utils")}
    hermes_cli = types.ModuleType("hermes_cli")
    hermes_cli.__path__ = []
    config = types.ModuleType("hermes_cli.config")
    config.cfg_get = lambda key, default=None: default
    config.load_config = lambda: {
        "approvals": {"mode": "manual", "timeout": 60, "gateway_timeout": 300, "cron_mode": "deny"}
    }
    sys.modules["hermes_cli"] = hermes_cli
    sys.modules["hermes_cli.config"] = config
    utils = types.ModuleType("utils")
    utils.is_truthy_value = lambda value: str(value).strip().lower() in {"1", "true", "yes", "on"}
    sys.modules["utils"] = utils
    try:
        approval_path = vendor_root / "tools" / "approval.py"
        spec = importlib.util.spec_from_file_location(
            f"redou_approval_for_test_{time.time_ns()}",
            approval_path,
        )
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        for name, module in saved_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def configure_adapter(adapter, permissions):
    adapter.RISK_CONFIRMED = False
    adapter.PERMISSIONS_CONFIG = permissions
    adapter.RUNTIME_APPROVAL_ENABLED = None
    adapter.APPROVAL_TIMEOUT_SECONDS = None
    adapter.RUN_CONTEXT = {
        "projectId": "project-1",
        "taskId": "task-1",
        "runId": "run-1",
    }
    adapter._clear_pending_approvals()


def test_redou_approval_callback_deny_blocks_high_risk(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "deny"})

    assert adapter._approval_callback("node -e \"console.log(1)\"", "script execution via -e/-c flag") == "deny"
    assert emitted[-1]["type"] == "high_risk_command_blocked"
    assert emitted[-1]["metadata"]["permissionMode"] == "deny"


def test_redou_approval_callback_allow_auto_allows_high_risk(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "allow"})

    assert adapter._approval_callback("python -c \"print(1)\"", "script execution via -e/-c flag") == "once"
    assert emitted[-1]["type"] == "high_risk_command_auto_allowed"
    assert emitted[-1]["decision"] == "auto_allow"


def test_redou_approval_callback_risk_confirmed_is_once_without_yolo(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "ask"})
    adapter.RISK_CONFIRMED = True

    assert adapter._approval_callback("python -c \"print(1)\"", "script execution via -e/-c flag") == "once"
    assert emitted[-1]["type"] == "risk_approval_allowed"
    assert emitted[-1]["decision"] == "pre_confirmed_once"


def test_redou_approval_callback_ask_allows_once_after_decision(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "ask", "approval_timeout_seconds": 10})

    result = {}
    thread = threading.Thread(
        target=lambda: result.setdefault(
            "choice",
            adapter._approval_callback("node -e \"console.log(1)\"", "script execution via -e/-c flag"),
        )
    )
    thread.start()
    deadline = time.time() + 2
    request = None
    while time.time() < deadline:
        request = next((event for event in emitted if event["type"] == "risk_approval_required"), None)
        if request:
            break
        time.sleep(0.01)
    assert request is not None

    adapter._resolve_pending_approval({
        "type": "risk_approval_decision",
        "projectId": "project-1",
        "taskId": "task-1",
        "runId": "run-1",
        "approvalId": request["approvalId"],
        "decision": "allow_once",
    })
    thread.join(timeout=2)
    assert result["choice"] == "once"
    assert emitted[-1]["type"] == "risk_approval_allowed"
    assert emitted[-1]["decision"] == "allow_once"


def test_redou_approval_callback_ask_denies_after_decision(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "ask", "approval_timeout_seconds": 10})

    result = {}
    thread = threading.Thread(
        target=lambda: result.setdefault(
            "choice",
            adapter._approval_callback("python -c \"print(1)\"", "script execution via -e/-c flag"),
        )
    )
    thread.start()
    deadline = time.time() + 2
    request = None
    while time.time() < deadline:
        request = next((event for event in emitted if event["type"] == "risk_approval_required"), None)
        if request:
            break
        time.sleep(0.01)
    assert request is not None

    adapter._resolve_pending_approval({
        "type": "risk_approval_decision",
        "projectId": "project-1",
        "taskId": "task-1",
        "runId": "run-1",
        "approvalId": request["approvalId"],
        "decision": "deny",
    })
    thread.join(timeout=2)
    assert result["choice"] == "deny"
    assert emitted[-1]["type"] == "risk_approval_denied"


def test_redou_approval_callback_timeout_denies(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    monkeypatch.setattr(
        adapter,
        "_coerce_timeout_seconds",
        lambda value, default=300: int(value if value is not None else default),
    )
    configure_adapter(adapter, {"mode": "ask", "approval_timeout_seconds": 10})
    adapter.APPROVAL_TIMEOUT_SECONDS = 1

    assert adapter._approval_callback("node -e \"console.log(1)\"", "script execution via -e/-c flag") == "deny"
    assert emitted[-1]["type"] == "risk_approval_timeout"
    assert emitted[-1]["timeoutSeconds"] == 1


def test_redou_approval_invalid_and_duplicate_decisions(monkeypatch):
    adapter = load_adapter()
    emitted = []
    monkeypatch.setattr(adapter, "_emit", emitted.append)
    configure_adapter(adapter, {"mode": "ask", "approval_timeout_seconds": 10})

    adapter._resolve_pending_approval({
        "type": "risk_approval_decision",
        "projectId": "project-1",
        "taskId": "task-1",
        "runId": "run-1",
        "approvalId": "missing",
        "decision": "allow_once",
    })
    assert emitted[-1]["type"] == "risk_approval_invalid"

    result = {}
    thread = threading.Thread(
        target=lambda: result.setdefault(
            "choice",
            adapter._approval_callback("node -e \"console.log(1)\"", "script execution via -e/-c flag"),
        )
    )
    thread.start()
    deadline = time.time() + 2
    request = None
    while time.time() < deadline:
        request = next((event for event in emitted if event["type"] == "risk_approval_required"), None)
        if request:
            break
        time.sleep(0.01)
    assert request is not None
    decision = {
        "type": "risk_approval_decision",
        "projectId": "project-1",
        "taskId": "task-1",
        "runId": "run-1",
        "approvalId": request["approvalId"],
        "decision": "allow_once",
    }
    adapter._resolve_pending_approval(decision)
    adapter._resolve_pending_approval(decision)
    thread.join(timeout=2)
    assert result["choice"] == "once"
    assert any(event["type"] == "risk_approval_invalid" for event in emitted)


def test_redou_approval_environment_uses_interactive_callback_path(monkeypatch):
    adapter = load_adapter()
    monkeypatch.setenv("HERMES_EXEC_ASK", "1")
    monkeypatch.delenv("HERMES_INTERACTIVE", raising=False)
    monkeypatch.setenv("HERMES_YOLO_MODE", "1")
    configure_adapter(adapter, {"mode": "ask"})

    adapter._configure_approval_environment()

    assert "HERMES_EXEC_ASK" not in os.environ
    assert os.environ["HERMES_INTERACTIVE"] == "1"
    assert "HERMES_YOLO_MODE" not in os.environ
    assert "REDOU_PERMISSIONS_JSON" in os.environ


def test_permissions_deny_preempts_yolo_in_hermes_approval(monkeypatch):
    approval = load_approval_module()
    monkeypatch.setenv("REDOU_PERMISSIONS_JSON", '{"mode":"deny"}')
    monkeypatch.setenv("HERMES_YOLO_MODE", "1")
    monkeypatch.delenv("HERMES_INTERACTIVE", raising=False)

    result = approval.check_all_command_guards('node -e "console.log(1)"', "local")

    assert result["approved"] is False
    assert "Permission policy denied" in result["message"]


def test_permissions_allow_does_not_bypass_hardline(monkeypatch):
    approval = load_approval_module()
    monkeypatch.setenv("REDOU_PERMISSIONS_JSON", '{"mode":"allow"}')
    monkeypatch.setenv("HERMES_YOLO_MODE", "1")

    result = approval.check_all_command_guards("rm -rf /", "local")

    assert result["approved"] is False


def test_permissions_timeout_and_cron_precede_legacy(monkeypatch):
    approval = load_approval_module()
    monkeypatch.setenv(
        "REDOU_PERMISSIONS_JSON",
        '{"mode":"ask","approval_timeout_seconds":77,"cron_mode":"allow"}',
    )

    assert approval._get_approval_timeout() == 77
    assert approval._get_gateway_approval_timeout() == 77
    assert approval._get_cron_approval_mode() == "approve"


def test_legacy_gateway_timeout_fallback_still_works(monkeypatch):
    approval = load_approval_module()
    monkeypatch.delenv("REDOU_PERMISSIONS_JSON", raising=False)
    monkeypatch.setattr(
        approval,
        "_get_approval_config",
        lambda: {"mode": "manual", "timeout": 60, "gateway_timeout": 222, "cron_mode": "deny"},
    )

    assert approval._get_gateway_approval_timeout() == 222


def test_redou_developer_context_is_merged_into_system_prompt():
    adapter = load_adapter()

    system_context, user_context, history = adapter._context_messages_to_history(
        [
            {"role": "system", "content": "base system"},
            {"role": "developer", "content": "project rules"},
            {"role": "developer", "content": "task state"},
            {"role": "user", "content": "old request"},
            {"role": "assistant", "content": "old answer"},
            {"role": "tool", "content": "tool output", "tool_call_id": "call_1"},
            {"role": "user", "content": "current request"},
        ],
        "base system",
        "fallback user context",
    )

    assert system_context.count("base system") == 1
    assert "project rules" in system_context
    assert "task state" in system_context
    assert user_context == "current request"
    assert [message["role"] for message in history] == ["user", "assistant", "tool"]
    assert all(message["role"] != "developer" for message in history)
    assert history[-1]["tool_call_id"] == "call_1"
