#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/bug-fix-lab"

echo "[Task3 Phase 1] Checking project scaffold..."

docker compose exec "$SERVICE" bash -lc "
  test -d '$PROJECT'
  test -f '$PROJECT/package.json'
  test -f '$PROJECT/README.md'
  test -d '$PROJECT/src'
  test -d '$PROJECT/tests'
  test -f '$PROJECT/src/calculator.js'
  test -f '$PROJECT/src/textUtils.js'
  test -f '$PROJECT/tests/calculator.test.js'
  test -f '$PROJECT/tests/textUtils.test.js'
"

echo "[Task3 Phase 1] Checking package.json test script..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  node -e \"
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (!pkg.scripts || !pkg.scripts.test) {
      console.error('package.json must contain scripts.test');
      process.exit(1);
    }
    console.log('scripts.test =', pkg.scripts.test);
  \"
"

echo "[Task3 Phase 1] Checking README required content..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  grep -qi 'Bug Fix Lab\\|自动调试\\|debug\\|bug' README.md
  grep -qi '测试\\|test' README.md
  grep -qi '安装\\|install' README.md
  grep -qi '运行\\|npm test' README.md
"

echo "[Task3 Phase 1] PASS"
