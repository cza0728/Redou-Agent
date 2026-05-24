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

run_phase "Task4 Phase 0: Environment" 10 "task4_phase0_env_check.sh"
run_phase "Task4 Phase 1: Sources and Notes" 20 "task4_phase1_sources_notes_check.sh"
run_phase "Task4 Phase 2: Report and Comparison" 25 "task4_phase2_report_comparison_check.sh"
run_phase "Task4 Phase 3: Product Design" 25 "task4_phase3_product_design_check.sh"
run_phase "Task4 Phase 4: Citation Quality" 10 "task4_phase4_citation_quality_check.sh"
run_phase "Task4 Phase 5: Delivery" 10 "task4_phase5_delivery_check.sh"

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
