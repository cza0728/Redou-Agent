from desktop.src.dashboard_bridge import _add_log_usage, _add_model_usage, _models_analytics


def test_model_usage_merges_provider_variants_for_same_visible_model():
    buckets = {}

    _add_model_usage(
        buckets,
        model="MiniMax-M2.7",
        provider="minimax-cn",
        base_url="https://api.minimax.chat/v1",
        input_tokens=100,
        output_tokens=20,
        session_count=1,
        api_calls=2,
    )
    _add_model_usage(
        buckets,
        model="MiniMax-M2.7",
        provider="minimax",
        input_tokens=7,
        output_tokens=3,
        session_id="redou-profile-run",
        api_calls=1,
    )

    assert len(buckets) == 1
    bucket = next(iter(buckets.values()))
    assert bucket["model"] == "MiniMax-M2.7"
    assert bucket["provider"] == "minimax-cn"
    assert bucket["base_url"] == "https://api.minimax.chat/v1"
    assert bucket["input_tokens"] == 107
    assert bucket["output_tokens"] == 23
    assert bucket["api_calls"] == 3
    assert bucket["_session_count"] == 1
    assert bucket["_session_ids"] == {"redou-profile-run"}


def test_model_usage_keeps_different_models_separate():
    buckets = {}

    _add_model_usage(
        buckets,
        model="MiniMax-M2.7",
        provider="minimax-cn",
        input_tokens=100,
    )
    _add_model_usage(
        buckets,
        model="Qwen3.6-27B-FP8",
        provider="custom",
        input_tokens=50,
    )

    assert len(buckets) == 2


def test_log_usage_parses_redou_agent_logs(monkeypatch, tmp_path):
    log_path = tmp_path / "agent.log"
    log_path.write_text(
        "2026-05-15 21:12:13,456 INFO [redou-task-1] run_agent: "
        "API call #1: model=MiniMax-M2.7 provider=minimax-cn "
        "in=1,234 out=56 total=1,290 latency=2.5s cache=100/1,334 (7%)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "desktop.src.dashboard_bridge._redou_agent_log_paths",
        lambda: [log_path],
    )

    buckets = {}
    _add_log_usage(buckets, cutoff=0)

    assert len(buckets) == 1
    bucket = buckets["MiniMax-M2.7"]
    assert bucket["provider"] == "minimax-cn"
    assert bucket["input_tokens"] == 1234
    assert bucket["output_tokens"] == 56
    assert bucket["cache_read_tokens"] == 100
    assert bucket["api_calls"] == 1
    assert bucket["_session_ids"] == {"redou-task-1"}


def test_models_analytics_keeps_data_when_one_source_fails(monkeypatch):
    def add_session_usage(buckets, cutoff):
        _add_model_usage(
            buckets,
            model="MiniMax-M2.7",
            provider="minimax-cn",
            input_tokens=100,
            output_tokens=20,
            session_count=1,
            api_calls=1,
        )

    monkeypatch.setattr("desktop.src.dashboard_bridge._refresh_pricing_cache", lambda: None)
    monkeypatch.setattr("desktop.src.dashboard_bridge._add_session_db_usage", add_session_usage)
    monkeypatch.setattr(
        "desktop.src.dashboard_bridge._add_log_usage",
        lambda buckets, cutoff: (_ for _ in ()).throw(RuntimeError("bad log")),
    )
    monkeypatch.setattr("desktop.src.dashboard_bridge._estimate_bucket_cost", lambda bucket: None)
    monkeypatch.setattr("desktop.src.dashboard_bridge._hydrate_model_capabilities", lambda models: None)

    data = _models_analytics(30)

    assert data["totals"]["distinct_models"] == 1
    assert data["totals"]["total_input"] == 100
    assert data["totals"]["total_output"] == 20
    assert data["models"][0]["model"] == "MiniMax-M2.7"
