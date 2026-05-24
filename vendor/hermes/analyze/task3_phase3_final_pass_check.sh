#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/bug-fix-lab"
LOG="/workspace/logs/bug-fix-lab-test.log"

echo "[Task3 Phase 3] Installing dependencies if needed inside container..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  npm install >> '$LOG' 2>&1
"

echo "[Task3 Phase 3] Running final npm test inside container..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  echo '' >> '$LOG'
  echo '===== FINAL VALIDATION: docker compose exec agent-lab bash -lc \"cd /workspace/projects/bug-fix-lab && npm test\" =====' >> '$LOG'
  npm test >> '$LOG' 2>&1
"

echo "[Task3 Phase 3] Checking final pass output..."

docker compose exec "$SERVICE" bash -lc "
  if ! grep -Eiq 'PASS|passed|ok|# pass|tests passed|Test Suites:.*passed' '$LOG'; then
    echo 'The log does not contain recognizable final passing test output.'
    exit 1
  fi
"

echo "[Task3 Phase 3] PASS"
