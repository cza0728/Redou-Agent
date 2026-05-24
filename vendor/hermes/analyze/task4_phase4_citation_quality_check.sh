#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/chinese-agent-product-research.md"
SOURCES="/workspace/logs/chinese-agent-product-sources.md"

echo "[Task4 Phase 4] Checking citation and source quality..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'
  test -f '$SOURCES'

  grep -qi '参考来源' '$REPORT' || { echo 'Missing references section.'; exit 1; }

  report_urls=\$(grep -Eo 'https?://[^ )>]+' '$REPORT' | wc -l)
  source_urls=\$(grep -Eo 'https?://[^ )>]+' '$SOURCES' | wc -l)

  if [ \"\$report_urls\" -lt 9 ]; then
    echo \"Expected at least 9 URLs in report, got \$report_urls\"
    exit 1
  fi

  if [ \"\$source_urls\" -lt 9 ]; then
    echo \"Expected at least 9 URLs in sources, got \$source_urls\"
    exit 1
  fi

  grep -Eqi '官方|GitHub|文档|docs|官网|repository|repo' '$REPORT' || {
    echo 'Report should prioritize official docs/sites/GitHub repositories.'
    exit 1
  }

  grep -Eqi '不确定|资料不足|信息不一致|冲突|推理|截至|访问日期|检索日期' '$REPORT' || {
    echo 'Report should mention uncertainty, source limits, retrieval date, or inference boundary.'
    exit 1
  }
"

echo "[Task4 Phase 4] PASS"
