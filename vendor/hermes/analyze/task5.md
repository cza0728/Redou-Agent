<!-- PATH_TEMPLATE: MODEL_NAME=@@MODEL_NAME@@ DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ BENCHMARK_ROOT=@@BENCHMARK_ROOT@@ RUN_DIR=@@RUN_DIR@@ RESULTS_DIR=@@RESULTS_DIR@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Task 5: Peewee ORM Industrial Bug Fixing

You are participating in a code-agent capability benchmark. Work only in the
current benchmark workspace and keep all dependency installation, test runs, and
grading inside the Docker environment named `@@DOCKER_SERVICE@@` whenever Docker
is available.

Set the model run name first:

```bash
MODEL_NAME="@@MODEL_NAME@@"
```

## Migrated task assets

- Source template: `@@BENCHMARK_ROOT@@/task5_source/`
- Hidden tests: `@@BENCHMARK_ROOT@@/task5_tests/`
- Task metadata: `@@BENCHMARK_ROOT@@/task5.yaml`
- Working copy: `@@RUN_DIR@@`
- Results directory: `@@RESULTS_DIR@@`

Do not modify `task5_source/`, `task5_tests/`, `task5.yaml`, or the shared
`task_project_*.py` helper files. Prepare an isolated working copy before
editing:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python -m pip install -r task_project_requirements.txt &&
  python task_project_prepare.py --model "@@MODEL_NAME@@" --task 5 --force
'
```

## Objective

Fix the bundled Peewee ORM implementation so as many hidden tests as possible
pass. The core project includes `peewee.py`, `playhouse/`, and `pwiz.py`; most
known defects are concentrated in `peewee.py`.

Known symptoms include:

1. Integer fields are read back as floats.
2. Datetime parsing loses microsecond precision.
3. Nested savepoint behavior is inverted.
4. `Model.get_or_create()` returns the wrong `created` flag for existing rows.
5. `SELECT DISTINCT` is ignored.
6. Pagination has an off-by-one error.
7. `ASC` and `DESC` ordering are reversed.
8. Empty `IN` clauses match all rows.
9. `NULL` comparisons use `=` instead of `IS`.
10. `count()` returns `None` on empty tables instead of `0`.

You may run focused tests while debugging, but the official score must come from:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python task_project_evaluate.py --model "@@MODEL_NAME@@" --task 5 --submit-index 1
'
```

You may submit up to three times by incrementing `--submit-index`.

## Final report

Create `@@RESULTS_DIR@@/task5_report.md` with:

1. Working directory path.
2. Files changed.
3. Bugs fixed.
4. Commands actually run.
5. Official evaluation results for each submit.
6. Best pass count and proportional score.
7. Confirmation that the original `task5_source/` tree was not edited.
