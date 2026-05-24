#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/chinese-agent-product-research.md"
SOURCES="/workspace/logs/chinese-agent-product-sources.md"
NOTES="/workspace/logs/chinese-agent-product-notes.md"
COMMANDS="/workspace/logs/chinese-agent-product-commands.log"

echo "[Task4 Phase 5] Checking delivery files..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'
  test -f '$SOURCES'
  test -f '$NOTES'
  test -f '$COMMANDS'
  test -s '$REPORT'
  test -s '$SOURCES'
  test -s '$NOTES'
  test -s '$COMMANDS'

  report_bytes=\$(wc -c < '$REPORT')
  sources_bytes=\$(wc -c < '$SOURCES')
  notes_bytes=\$(wc -c < '$NOTES')
  if [ \"\$report_bytes\" -lt 6000 ]; then
    echo \"Final report is too short: \$report_bytes bytes\"
    exit 1
  fi
  if [ \"\$sources_bytes\" -lt 1200 ]; then
    echo \"Sources file is too short: \$sources_bytes bytes\"
    exit 1
  fi
  if [ \"\$notes_bytes\" -lt 1200 ]; then
    echo \"Notes file is too short: \$notes_bytes bytes\"
    exit 1
  fi
"

echo "[Task4 Phase 5] Checking command log contains container verification..."

docker compose exec "$SERVICE" bash -lc "
  grep -q '/workspace/reports/chinese-agent-product-research.md' '$COMMANDS' || {
    echo 'Command log should mention final report path.'
    exit 1
  }

  grep -Eqi 'ls -lh|^-rw|chinese-agent-product-research.md' '$COMMANDS' || {
    echo 'Command log should contain ls -lh verification output.'
    exit 1
  }

  ls -lh '$REPORT'
"

echo "[Task4 Phase 5] PASS"
