#!/usr/bin/env bash
set -euo pipefail

SERVICE="agent-lab"
PROJECT="/workspace/projects/bug-fix-lab"

echo "[Task3 Phase 4] Running independent behavior checks..."

docker compose exec "$SERVICE" bash -lc "cat > /tmp/task3_behavior_check.mjs <<'EOF'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

async function loadModule(filePath) {
  const url = pathToFileURL(filePath).href;
  try {
    return await import(url);
  } catch (importError) {
    const require = createRequire(import.meta.url);
    return require(filePath);
  }
}

const calculator = await loadModule('/workspace/projects/bug-fix-lab/src/calculator.js');
const textUtils = await loadModule('/workspace/projects/bug-fix-lab/src/textUtils.js');

const requiredCalculator = ['add', 'subtract', 'multiply', 'divide'];
const requiredTextUtils = ['reverseText', 'countWords', 'capitalizeWords', 'isPalindrome'];

for (const fn of requiredCalculator) {
  if (typeof calculator[fn] !== 'function') {
    throw new Error(\`Missing calculator export: \${fn}\`);
  }
}

for (const fn of requiredTextUtils) {
  if (typeof textUtils[fn] !== 'function') {
    throw new Error(\`Missing textUtils export: \${fn}\`);
  }
}

if (calculator.add(2, 3) !== 5) throw new Error('add(2, 3) should be 5');
if (calculator.subtract(7, 4) !== 3) throw new Error('subtract(7, 4) should be 3');
if (calculator.multiply(6, 5) !== 30) throw new Error('multiply(6, 5) should be 30');
if (calculator.divide(8, 2) !== 4) throw new Error('divide(8, 2) should be 4');

let divideZeroFailed = false;
try {
  calculator.divide(1, 0);
} catch (err) {
  divideZeroFailed = /zero|0/i.test(String(err && err.message ? err.message : err));
}
if (!divideZeroFailed) {
  throw new Error('divide(1, 0) must throw an error mentioning zero or 0');
}

if (textUtils.reverseText('abc') !== 'cba') {
  throw new Error('reverseText(\"abc\") should be \"cba\"');
}

if (textUtils.countWords('  hello   world  ') !== 2) {
  throw new Error('countWords should handle leading, trailing, and repeated spaces');
}

if (textUtils.countWords('') !== 0) {
  throw new Error('countWords(\"\") should be 0');
}

if (textUtils.capitalizeWords('hello world') !== 'Hello World') {
  throw new Error('capitalizeWords(\"hello world\") should be \"Hello World\"');
}

if (textUtils.isPalindrome('A man, a plan, a canal: Panama') !== true) {
  throw new Error('isPalindrome should ignore case, spaces, and punctuation');
}

if (textUtils.isPalindrome('hello world') !== false) {
  throw new Error('isPalindrome(\"hello world\") should be false');
}

console.log('Independent behavior checks passed.');
EOF

node /tmp/task3_behavior_check.mjs
"

echo "[Task3 Phase 4] Checking tests were not weakened..."

docker compose exec "$SERVICE" bash -lc "
  cd '$PROJECT'

  grep -R \"divide\" tests >/dev/null
  grep -R \"countWords\" tests >/dev/null
  grep -R \"capitalizeWords\" tests >/dev/null
  grep -R \"isPalindrome\" tests >/dev/null

  if grep -R \"test\\.skip\\|it\\.skip\\|describe\\.skip\\|todo\" tests >/dev/null 2>&1; then
    echo 'Skipped or todo tests found.'
    exit 1
  fi
"

echo "[Task3 Phase 4] PASS"
