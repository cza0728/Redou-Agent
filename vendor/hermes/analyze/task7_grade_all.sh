#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_NUM=7
MODEL="${MODEL_NAME:-unknown-model}"
SUBMIT="${SUBMIT_INDEX:-1}"
SERVICE="${DOCKER_SERVICE:-agent-lab}"
CONTAINER_ROOT="${DOCKER_BENCHMARK_ROOT:-/workspace}"

run_local() {
  python "$SCRIPT_DIR/task_project_evaluate.py" --model "$MODEL" --task "$TASK_NUM" --submit-index "$SUBMIT" --bench-root "$SCRIPT_DIR"
}

run_container() {
  local command
  printf -v command 'cd %q && python task_project_evaluate.py --model %q --task %q --submit-index %q --bench-root %q' \
    "$CONTAINER_ROOT" "$MODEL" "$TASK_NUM" "$SUBMIT" "$CONTAINER_ROOT"
  docker compose exec -T "$SERVICE" bash -lc "$command"
}

if command -v docker >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/docker-compose.yml" ] && (cd "$SCRIPT_DIR" && docker compose ps "$SERVICE" >/dev/null 2>&1); then
  (cd "$SCRIPT_DIR" && run_container) || true
else
  run_local || true
fi
