#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/chinese-agent-product-research.md"

echo "[Task4 Phase 2] Checking final report and comparison analysis..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'
  test -s '$REPORT'

  bytes=\$(wc -c < '$REPORT')
  if [ \"\$bytes\" -lt 6000 ]; then
    echo \"Final report is too short for a complete comparison: \$bytes bytes\"
    exit 1
  fi
"

echo "[Task4 Phase 2] Checking required research sections..."

docker compose exec "$SERVICE" bash -lc "
  for term in '调研范围' '来源可信' '工具逐项分析' '工具对比表'; do
    grep -qi \"\$term\" '$REPORT' || { echo \"Missing report section: \$term\"; exit 1; }
  done
"

echo "[Task4 Phase 2] Checking required tools in final report..."

docker compose exec "$SERVICE" bash -lc "
  for term in 'Claude Code' 'OpenAI Codex' 'Cursor' 'Cline' 'Continue' 'OpenHands' 'OpenClaw'; do
    grep -qi \"\$term\" '$REPORT' || { echo \"Missing tool in report: \$term\"; exit 1; }
  done
  grep -Eqi 'Qoder|QoderWork' '$REPORT' || { echo 'Missing Qoder or QoderWork in report'; exit 1; }
  grep -Eqi 'DeepSeek|Qwen|MiniMax|国内模型' '$REPORT' || { echo 'Missing domestic model integration in report'; exit 1; }
"

echo "[Task4 Phase 2] Checking Markdown table columns..."

docker compose exec "$SERVICE" bash -lc "
  for col in '工具名称' '产品形态' '终端能力' '浏览器能力' '多模型支持' '本地模型' '二次开发' '主要优势' '主要限制' '信息来源'; do
    grep -qi \"\$col\" '$REPORT' || { echo \"Missing comparison table column or concept: \$col\"; exit 1; }
  done

  table_lines=\$(grep -n '^|' '$REPORT' | wc -l)
  if [ \"\$table_lines\" -lt 10 ]; then
    echo \"Expected a Markdown comparison table with at least 10 pipe-lines, got \$table_lines\"
    exit 1
  fi

  data_rows=\$(grep '^|' '$REPORT' | grep -E 'Claude|Codex|Cursor|Cline|Continue|OpenHands|OpenClaw|Qoder|DeepSeek|Qwen|MiniMax' | wc -l)
  if [ \"\$data_rows\" -lt 8 ]; then
    echo \"Comparison table should cover at least 8 concrete tools, got \$data_rows\"
    exit 1
  fi
"

echo "[Task4 Phase 2] Checking analysis dimensions..."

docker compose exec "$SERVICE" bash -lc "
  for term in '产品定位' '使用形态' '终端操作' '浏览器操作' '多模型' '第三方模型' '二次开发' '主要优点' '主要缺点' '适合'; do
    grep -qi \"\$term\" '$REPORT' || { echo \"Missing analysis dimension: \$term\"; exit 1; }
  done
"

echo "[Task4 Phase 2] PASS"
