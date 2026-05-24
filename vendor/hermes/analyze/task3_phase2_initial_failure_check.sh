#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/bug-fix-lab"
LOG="/workspace/logs/bug-fix-lab-test.log"

echo "[Task3 Phase 2] Checking failed-test record in log..."

docker compose exec "$SERVICE" bash -lc "
  test -f '$LOG'

  if ! grep -Eiq 'FAIL|failed|failing|not ok|AssertionError|Expected|Received|Error:' '$LOG'; then
    echo 'The log does not contain a recognizable initial failed test output.'
    exit 1
  fi

  if ! grep -Eiq 'docker compose exec|agent-lab|/workspace/projects/bug-fix-lab|npm test' '$LOG'; then
    echo 'The log does not clearly show container-based test execution.'
    exit 1
  fi
"

echo "[Task3 Phase 2] Checking tests cover required bug-revealing cases..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'

  grep -R \"divide\" tests >/dev/null
  grep -R \"0\" tests >/dev/null
  grep -R \"countWords\" tests >/dev/null
  grep -R \"hello\" tests >/dev/null
  grep -R \"capitalizeWords\" tests >/dev/null
  grep -R \"hello world\" tests >/dev/null
  grep -R \"isPalindrome\" tests >/dev/null
  grep -R \"Panama\" tests >/dev/null
"

echo "[Task3 Phase 2] PASS"
