#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"

echo "[Phase 0] Checking Docker Compose service..."

docker compose ps "$SERVICE" >/dev/null

echo "[Phase 0] Checking container command execution..."

docker compose exec "$SERVICE" bash -lc "pwd && whoami"

echo "[Phase 0] Creating required directories inside container..."

docker compose exec "$SERVICE" bash -lc '
  mkdir -p /workspace/projects /workspace/reports /workspace/logs
  test -d /workspace/projects
  test -d /workspace/reports
  test -d /workspace/logs
'

echo "[Phase 0] PASS"