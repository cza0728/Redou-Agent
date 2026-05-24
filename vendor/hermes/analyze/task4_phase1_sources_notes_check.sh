#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
SOURCES="/workspace/logs/chinese-agent-product-sources.md"
NOTES="/workspace/logs/chinese-agent-product-notes.md"

echo "[Task4 Phase 1] Checking source list and research notes..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$SOURCES'
  test -f '$NOTES'
  test -s '$SOURCES'
  test -s '$NOTES'
"

echo "[Task4 Phase 1] Checking required tools in sources..."

docker compose exec "$SERVICE" bash -lc "
  for term in 'Claude Code' 'OpenAI Codex' 'Cursor' 'Cline' 'Continue' 'OpenHands' 'OpenClaw'; do
    grep -qi \"\$term\" '$SOURCES' || { echo \"Missing source entry for: \$term\"; exit 1; }
  done
  grep -Eqi 'Qoder|QoderWork' '$SOURCES' || { echo 'Missing source entry for Qoder or QoderWork'; exit 1; }
  grep -Eqi 'DeepSeek|Qwen|MiniMax|国内模型' '$SOURCES' || { echo 'Missing source entry for domestic model integration'; exit 1; }
"

echo "[Task4 Phase 1] Checking URLs and source metadata..."

docker compose exec "$SERVICE" bash -lc "
  url_count=\$(grep -Eo 'https?://[^ )>]+' '$SOURCES' | wc -l)
  if [ \"\$url_count\" -lt 9 ]; then
    echo \"Expected at least 9 URLs in sources, got \$url_count\"
    exit 1
  fi

  grep -Eqi '官网|官方|GitHub|文档|documentation|docs|repository|repo|媒体|技术媒体' '$SOURCES' || {
    echo 'Sources file should describe source types.'
    exit 1
  }

  grep -Eqi '检索日期|访问日期|retrieved|accessed' '$SOURCES' || {
    echo 'Sources file should include retrieval/access date.'
    exit 1
  }
"

echo "[Task4 Phase 1] Checking notes contain uncertainty/source-quality reasoning..."

docker compose exec "$SERVICE" bash -lc "
  grep -Eqi '不确定|冲突|官方|推理|可信|来源' '$NOTES' || {
    echo 'Notes should include uncertainty/source-quality reasoning.'
    exit 1
  }
"

echo "[Task4 Phase 1] PASS"
