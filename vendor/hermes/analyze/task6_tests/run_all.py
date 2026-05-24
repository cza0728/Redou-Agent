#!/usr/bin/env python
"""Test runner for Bottle feature addition task.
Runs both existing Bottle tests and new feature tests."""
import sys, os, time, subprocess

# Setup paths
ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ws_root)

def main():
    args = [sys.executable, '-m', 'pytest', tests_dir, '-q', '--tb=no']

    t0 = time.time()
    result = subprocess.run(args, capture_output=True, text=True, cwd=ws_root)
    elapsed = time.time() - t0

    # Print pytest output
    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)

    # Parse results from pytest short summary
    import re
    stdout = result.stdout
    # pytest output: "X passed, Y failed, Z errors in Ns"
    passed = 0
    failed = 0
    errors = 0
    m = re.search(r'(\d+)\s+passed', stdout)
    if m: passed = int(m.group(1))
    m = re.search(r'(\d+)\s+failed', stdout)
    if m: failed = int(m.group(1))
    m = re.search(r'(\d+)\s+error', stdout)
    if m: errors = int(m.group(1))

    total_fail = failed + errors

    # Output standardized summary
    parts = []
    if passed: parts.append(f'{passed} passed')
    if total_fail: parts.append(f'{total_fail} failed')
    summary = ', '.join(parts)
    print(f'\n{"=" * 40}')
    print(f'{summary} in {elapsed:.2f}s')

    sys.exit(0 if total_fail == 0 else 1)


if __name__ == '__main__':
    main()
