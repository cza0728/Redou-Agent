#!/usr/bin/env bash
set -euo pipefail

SERVICE="${DOCKER_SERVICE:-agent-lab}"

echo "[Phase 2] Checking taskStore.js exported functions and behavior..."

docker compose exec "$SERVICE" bash -lc "cat > /tmp/agent_task_board_data_test.mjs <<'EOF'
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = pathToFileURL('/workspace/projects/agent-task-board/src/taskStore.js').href;
const store = await import(modulePath);
const doneStatus = '\u5df2\u5b8c\u6210';

const requiredFunctions = [
  'createMainTask',
  'createSubTask',
  'updateSubTaskStatus',
  'addSubTaskLog',
  'deleteMainTask',
  'deleteSubTask',
  'calculateMainTaskProgress',
  'serializeBoard',
  'deserializeBoard'
];

for (const fn of requiredFunctions) {
  if (typeof store[fn] !== 'function') {
    throw new Error(\`Missing exported function: \${fn}\`);
  }
}

const main = store.createMainTask('Build Agent Board');
if (!main.id || main.title !== 'Build Agent Board' || !Array.isArray(main.subtasks)) {
  throw new Error('createMainTask returned invalid structure');
}

const sub1 = store.createSubTask('Plan UI', 'Planner');
const sub2 = store.createSubTask('Code UI', 'Coder');

if (!sub1.id || sub1.name !== 'Plan UI' || sub1.role !== 'Planner' || !Array.isArray(sub1.logs)) {
  throw new Error('createSubTask returned invalid structure');
}

let board = [{ ...main, subtasks: [sub1, sub2] }];

let progress = store.calculateMainTaskProgress(board[0]);
if (progress !== 0) {
  throw new Error(\`Initial progress should be 0, got \${progress}\`);
}

if (store.calculateMainTaskProgress(undefined) !== 0) {
  throw new Error('calculateMainTaskProgress(undefined) should return 0');
}

if (store.calculateMainTaskProgress({ title: 'No subtasks' }) !== 0) {
  throw new Error('calculateMainTaskProgress should return 0 when subtasks is missing');
}

board = store.updateSubTaskStatus(board, main.id, sub1.id, doneStatus);
progress = store.calculateMainTaskProgress(board[0]);
if (progress !== 50) {
  throw new Error(\`Progress after one completed subtask should be 50, got \${progress}\`);
}

board = store.addSubTaskLog(board, main.id, sub1.id, 'Planner finished the initial design.');
const updatedSub1 = board[0].subtasks.find(s => s.id === sub1.id);
if (!updatedSub1.logs.some(log => String(log).includes('Planner finished'))) {
  throw new Error('addSubTaskLog did not add log correctly');
}

board = store.deleteSubTask(board, main.id, sub2.id);
if (board[0].subtasks.length !== 1) {
  throw new Error('deleteSubTask failed');
}

const text = store.serializeBoard(board);
const restored = store.deserializeBoard(text);
if (!Array.isArray(restored) || restored.length !== 1 || restored[0].title !== 'Build Agent Board') {
  throw new Error('serializeBoard or deserializeBoard failed');
}

const invalidRestored = store.deserializeBoard('{not json');
if (!Array.isArray(invalidRestored)) {
  throw new Error('deserializeBoard should return an array for invalid JSON');
}

board = store.deleteMainTask(restored, main.id);
if (board.length !== 0) {
  throw new Error('deleteMainTask failed');
}

console.log('Data logic test passed.');
EOF

node /tmp/agent_task_board_data_test.mjs
"

echo "[Phase 2] PASS"
