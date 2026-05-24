#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/agent-task-board"
LOG="/workspace/logs/agent-task-board-build.log"

echo "[Phase 3] Checking required data-testid markers..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'

  REQUIRED_IDS='
main-task-input
create-main-task-button
main-task-card
delete-main-task-button
subtask-name-input
role-select
add-subtask-button
status-select
add-log-input
add-log-button
delete-subtask-button
progress-value
'

  for id in \$REQUIRED_IDS; do
    if ! grep -R \"data-testid=[\\\"']\$id[\\\"']\" . >/dev/null 2>&1; then
      echo \"Missing data-testid: \$id\"
      exit 1
    fi
  done
"

echo "[Phase 3] Checking persistence keyword..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  if ! grep -R \"localStorage\\|serializeBoard\\|deserializeBoard\" src >/dev/null 2>&1; then
    echo 'No persistence-related code found.'
    exit 1
  fi
"

echo "[Phase 3] Installing dependencies if needed..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  npm install > /workspace/logs/agent-task-board-install.log 2>&1
"

echo "[Phase 3] Running build..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  npm run build > '$LOG' 2>&1
"

echo "[Phase 3] Checking build output..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  test -d dist || test -d build || test -f index.html
"

echo "[Phase 3] PASS"