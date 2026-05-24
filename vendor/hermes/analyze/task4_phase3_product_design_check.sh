#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
REPORT="/workspace/reports/chinese-agent-product-research.md"

echo "[Task4 Phase 3] Checking product design section..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$REPORT'

  for term in \
    '产品名称' \
    '目标用户' \
    '核心使用场景' \
    '主要痛点' \
    '核心卖点' \
    '差异化' \
    'MVP' \
    '技术架构' \
    '多模型协作' \
    '大模型与小模型' \
    '任务拆解' \
    '终端可视化' \
    '浏览器操作' \
    '3 个月' \
    '风险'; do
    grep -qi \"\$term\" '$REPORT' || { echo \"Missing product design item: \$term\"; exit 1; }
  done
"

echo "[Task4 Phase 3] Checking Chinese-developer/researcher positioning..."

docker compose exec "$SERVICE" bash -lc "
  for term in '中文' '开发者' '研究者'; do
    grep -qi \"\$term\" '$REPORT' || { echo \"Missing positioning term: \$term\"; exit 1; }
  done

  grep -Eqi 'DeepSeek|Qwen|MiniMax|国内模型|本地模型|私有化|token|成本|服务器|论文|实验' '$REPORT' || {
    echo 'Product design should reflect domestic models, local/private deployment, cost, research or server scenarios.'
    exit 1
  }
"

echo "[Task4 Phase 3] PASS"
