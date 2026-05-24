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

run_phase "Task3 Phase 0: Environment" 10 "task3_phase0_env_check.sh"
run_phase "Task3 Phase 1: Scaffold" 15 "task3_phase1_scaffold_check.sh"
run_phase "Task3 Phase 2: Initial Failure" 20 "task3_phase2_initial_failure_check.sh"
run_phase "Task3 Phase 3: Final Pass" 20 "task3_phase3_final_pass_check.sh"
run_phase "Task3 Phase 4: Behavior" 20 "task3_phase4_behavior_check.sh"
run_phase "Task3 Phase 5: Report" 15 "task3_phase5_report_check.sh"

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
