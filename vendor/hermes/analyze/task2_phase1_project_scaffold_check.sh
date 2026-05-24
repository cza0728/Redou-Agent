#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/agent-task-board"

echo "[Phase 1] Checking project scaffold..."

docker compose exec "$SERVICE" bash -lc "
  test -d '$PROJECT'
  test -f '$PROJECT/package.json'
  test -f '$PROJECT/README.md'
  test -d '$PROJECT/src'
  test -f '$PROJECT/src/taskStore.js'
"

echo "[Phase 1] Checking package.json scripts..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  node -e \"
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (!pkg.scripts || !pkg.scripts.dev || !pkg.scripts.build) {
      console.error('package.json must contain scripts.dev and scripts.build');
      process.exit(1);
    }
    console.log('scripts.dev =', pkg.scripts.dev);
    console.log('scripts.build =', pkg.scripts.build);
  \"
"

echo "[Phase 1] Checking README required sections..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'
  grep -qi '功能' README.md
  grep -qi '技术栈' README.md
  grep -qi '安装' README.md
  grep -qi '启动' README.md
  grep -qi '访问' README.md
  grep -qi '停止' README.md
"

echo "[Phase 1] PASS"