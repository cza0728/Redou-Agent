#!/usr/bin/env python
"""Custom test runner for peewee benchmark task.
Runs unittest-based tests and outputs pytest-compatible summary."""
import sys, os, time, unittest

# Setup paths: workspace root has peewee.py, playhouse/
ws_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ws_root)

# Make 'tests' importable as a package (.judge/ is the parent of tests/)
tests_parent = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if tests_parent not in sys.path:
    sys.path.insert(0, tests_parent)

MODULES = [
    'base_models', 'db_tests', 'fields', 'models', 'model_sql',
    'schema', 'transactions', 'shortcuts', 'signals', 'results',
    'manytomany',
]

def main():
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for mod in MODULES:
        try:
            suite.addTests(loader.loadTestsFromName('tests.' + mod))
        except Exception as e:
            print(f'WARNING: Failed to load tests.{mod}: {e}', file=sys.stderr)

    t0 = time.time()
    runner = unittest.TextTestRunner(verbosity=1)
    result = runner.run(suite)
    elapsed = time.time() - t0

    # Output pytest-compatible summary line that the judge can parse
    total = result.testsRun
    fail = len(result.failures) + len(result.errors)
    skip = len(result.skipped)
    passed = total - fail - skip

    parts = []
    if passed:
        parts.append(f'{passed} passed')
    if fail:
        parts.append(f'{fail} failed')
    if skip:
        parts.append(f'{skip} skipped')
    summary = ', '.join(parts)
    print(f'\n{"=" * 40}')
    print(f'{summary} in {elapsed:.2f}s')

    sys.exit(0 if fail == 0 else 1)

if __name__ == '__main__':
    main()
