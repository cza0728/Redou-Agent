#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/agent-task-board-report.md"

echo "[Phase 5] Checking final report..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'

  grep -qi '创建' '$REPORT'
  grep -qi '技术栈' '$REPORT'
  grep -qi '命令' '$REPORT'
  grep -qi '容器' '$REPORT'
  grep -qi 'Docker' '$REPORT'
  grep -qi '问题' '$REPORT'
  grep -qi '修复' '$REPORT'
  grep -qi '访问' '$REPORT'
  grep -qi 'curl' '$REPORT'
  grep -qi '验证' '$REPORT'
  grep -qi '端口' '$REPORT'
"

echo "[Phase 5] PASS"