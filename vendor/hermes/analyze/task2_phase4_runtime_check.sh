#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/agent-task-board"
DEV_LOG="/workspace/logs/agent-task-board-dev.log"
CURL_LOG="/workspace/logs/agent-task-board-curl.log"

echo "[Phase 4] Starting dev server inside container..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'

  if [ -f /tmp/agent-task-board-dev.pid ]; then
    old_pid=\$(cat /tmp/agent-task-board-dev.pid || true)
    if [ -n \"\$old_pid\" ]; then
      kill \"\$old_pid\" >/dev/null 2>&1 || true
    fi
    rm -f /tmp/agent-task-board-dev.pid
  fi

  nohup npm run dev -- --host 0.0.0.0 > '$DEV_LOG' 2>&1 &
  echo \$! > /tmp/agent-task-board-dev.pid
"

echo "[Phase 4] Waiting for service..."

sleep 5

echo "[Phase 4] Curl checking local container address..."

docker compose exec "$SERVICE" bash -lc "
  set -e

  URLS='
http://127.0.0.1:5173
http://127.0.0.1:3000
http://127.0.0.1:8080
http://127.0.0.1:4173
'

  success=0

  for url in \$URLS; do
    echo \"Trying \$url\" | tee -a '$CURL_LOG'
    if curl -I --max-time 5 \"\$url\" >> '$CURL_LOG' 2>&1; then
      echo \"SUCCESS_URL=\$url\" | tee -a '$CURL_LOG'
      success=1
      break
    fi
  done

  if [ \"\$success\" != \"1\" ]; then
    echo 'No accessible dev server found.' | tee -a '$CURL_LOG'
    echo '--- Dev log ---'
    cat '$DEV_LOG' || true
    exit 1
  fi
"

echo "[Phase 4] Checking HTML response contains app root or title..."

docker compose exec "$SERVICE" bash -lc "
  SUCCESS_URL=\$(grep 'SUCCESS_URL=' '$CURL_LOG' | tail -n 1 | cut -d= -f2-)
  curl -L --max-time 5 \"\$SUCCESS_URL\" > /tmp/agent-task-board-page.html

  if ! grep -qi 'Agent Task Board\\|root\\|app' /tmp/agent-task-board-page.html; then
    echo 'HTML page does not contain expected app markers.'
    exit 1
  fi
"

echo "[Phase 4] PASS"