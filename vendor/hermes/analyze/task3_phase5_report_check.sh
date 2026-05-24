#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/bug-fix-lab-report.md"
LOG="/workspace/logs/bug-fix-lab-test.log"

echo "[Task3 Phase 5] Checking final report..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'
  test -f '$LOG'

  grep -qi '项目创建位置\\|project' '$REPORT'
  grep -qi '文件结构\\|structure' '$REPORT'
  grep -qi '测试框架\\|Jest\\|Vitest\\|node:test' '$REPORT'
  grep -qi 'Bug\\|bug' '$REPORT'
  grep -qi '失败\\|fail' '$REPORT'
  grep -qi '定位\\|locat\\|diagnos' '$REPORT'
  grep -qi '修改\\|修复\\|fix' '$REPORT'
  grep -qi '通过\\|pass' '$REPORT'
  grep -qi '命令\\|command' '$REPORT'
  grep -qi 'agent-lab\\|容器\\|Docker' '$REPORT'
  grep -qi 'bug-fix-lab-test.log' '$REPORT'
"

echo "[Task3 Phase 5] PASS"
