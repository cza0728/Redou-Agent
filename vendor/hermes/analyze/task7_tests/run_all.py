#!/usr/bin/env python
"""Test runner for Markdown parser task."""
import sys, os, time, subprocess, re

ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
tests_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ws_root)

def main():
    args = [sys.executable, '-m', 'pytest', tests_dir, '-q', '--tb=no']

    t0 = time.time()
    result = subprocess.run(args, capture_output=True, text=True, cwd=ws_root)
    elapsed = time.time() - t0

    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)

    stdout = result.stdout
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
    parts = []
    if passed: parts.append(f'{passed} passed')
    if total_fail: parts.append(f'{total_fail} failed')
    summary = ', '.join(parts)
    print(f'\n{"=" * 40}')
    print(f'{summary} in {elapsed:.2f}s')

    sys.exit(0 if total_fail == 0 else 1)

if __name__ == '__main__':
    main()
