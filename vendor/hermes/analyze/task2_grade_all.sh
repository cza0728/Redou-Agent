#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL=0
MAX=100

run_phase() {
  local name="$1"
  local score="$2"
  local script="$3"

  echo
  echo "=============================="
  echo "Running $name ($score pts)"
  echo "=============================="

  if bash "$SCRIPT_DIR/$script"; then
    echo "$name PASS: +$score"
    TOTAL=$((TOTAL + score))
  else
    echo "$name FAIL: +0"
  fi
}

run_phase "Phase 0: Environment" 10 "task2_phase0_env_check.sh"
run_phase "Phase 1: Scaffold" 15 "task2_phase1_project_scaffold_check.sh"
run_phase "Phase 2: Data Logic" 20 "task2_phase2_data_logic_check.sh"
run_phase "Phase 3: UI and Build" 20 "task2_phase3_ui_build_check.sh"
run_phase "Phase 4: Runtime Curl" 20 "task2_phase4_runtime_check.sh"
run_phase "Phase 5: Report" 15 "task2_phase5_report_check.sh"

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
