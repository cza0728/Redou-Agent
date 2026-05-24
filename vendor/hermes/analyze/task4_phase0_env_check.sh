#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"

echo "[Task4 Phase 0] Checking Docker Compose service..."
docker compose ps "$SERVICE" >/dev/null

echo "[Task4 Phase 0] Checking container command execution..."
docker compose exec "$SERVICE" bash -lc "pwd && whoami"

echo "[Task4 Phase 0] Creating required directories inside container..."
docker compose exec "$SERVICE" bash -lc '
  mkdir -p /workspace/reports /workspace/logs
  test -d /workspace/reports
  test -d /workspace/logs
'

echo "[Task4 Phase 0] PASS"
