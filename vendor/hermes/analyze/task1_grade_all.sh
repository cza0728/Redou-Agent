#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="${DOCKER_SERVICE:-agent-lab}"
DOCKER_WORKSPACE="${DOCKER_WORKSPACE:-/workspace}"

TOTAL=0
MAX=100

run_phase() {
  local name="$1"
  local score="$2"
  shift 2

  echo
  echo "=============================="
  echo "Running $name ($score pts)"
  echo "=============================="

  if "$@"; then
    echo "$name PASS: +$score"
    TOTAL=$((TOTAL + score))
  else
    echo "$name FAIL: +0"
  fi
}

phase_files() {
  cd "$SCRIPT_DIR" || return 1
  test -f Dockerfile
  test -f docker-compose.yml
  test -f README.md
  test -f ENV_REPORT.md
  test -d projects
  test -d reports
  test -d logs
}

phase_compose_service() {
  cd "$SCRIPT_DIR" || return 1
  docker compose config -q
  docker compose config > /tmp/task1_compose_config.yml
  grep -Eq "^[[:space:]]+$SERVICE:" /tmp/task1_compose_config.yml
  grep -Eq "container_name:[[:space:]]+$SERVICE" /tmp/task1_compose_config.yml
  grep -Eq "target:[[:space:]]*$DOCKER_WORKSPACE|:[[:space:]]*$DOCKER_WORKSPACE" /tmp/task1_compose_config.yml
  docker compose ps "$SERVICE" >/dev/null
}

phase_toolchain() {
  cd "$SCRIPT_DIR" || return 1
  docker compose exec "$SERVICE" bash -lc "
    node -v &&
    npm -v &&
    python3 --version &&
    pip --version &&
    git --version &&
    curl --version &&
    wget --version
  "
}

phase_workspace_mount() {
  cd "$SCRIPT_DIR" || return 1
  docker compose exec "$SERVICE" bash -lc "
    mkdir -p '$DOCKER_WORKSPACE/logs' &&
    date > '$DOCKER_WORKSPACE/logs/task1_mount_check.txt' &&
    test -f '$DOCKER_WORKSPACE/logs/task1_mount_check.txt'
  "
  test -f logs/task1_mount_check.txt
}

phase_docs() {
  cd "$SCRIPT_DIR" || return 1
  test -s README.md
  test -s ENV_REPORT.md
  test "$(wc -c < README.md)" -ge 400
  test "$(wc -c < ENV_REPORT.md)" -ge 600
  grep -q "docker compose up -d --build" README.md
  grep -qi "workspace" ENV_REPORT.md
  grep -qi "env_check" ENV_REPORT.md
}

run_phase "Task1 Phase 1: Files" 20 phase_files
run_phase "Task1 Phase 2: Compose Service" 20 phase_compose_service
run_phase "Task1 Phase 3: Toolchain" 25 phase_toolchain
run_phase "Task1 Phase 4: Workspace Mount" 20 phase_workspace_mount
run_phase "Task1 Phase 5: Docs" 15 phase_docs

echo
echo "=============================="
echo "Final Score: $TOTAL / $MAX"
echo "=============================="

if [ "$TOTAL" -ge 85 ]; then
  echo "Result: Excellent"
elif [ "$TOTAL" -ge 70 ]; then
  echo "Result: Passed"
elif [ "$TOTAL" -ge 50 ]; then
  echo "Result: Partially Passed"
else
  echo "Result: Failed"
fi
