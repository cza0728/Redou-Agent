<!-- PATH_TEMPLATE: MODEL_NAME=@@MODEL_NAME@@ DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ BENCHMARK_ROOT=@@BENCHMARK_ROOT@@ RUN_DIR=@@RUN_DIR@@ RESULTS_DIR=@@RESULTS_DIR@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Task 6: Bottle Web Framework Plugin Extension

Work only in the current benchmark workspace. Run dependency installation, test
execution, and grading inside Docker service `@@DOCKER_SERVICE@@` whenever the
service is available.

```bash
MODEL_NAME="@@MODEL_NAME@@"
```

## Migrated task assets

- Source template: `@@BENCHMARK_ROOT@@/task6_source/`
- Hidden tests: `@@BENCHMARK_ROOT@@/task6_tests/`
- Task metadata: `@@BENCHMARK_ROOT@@/task6.yaml`
- Working copy: `@@RUN_DIR@@`
- Results directory: `@@RESULTS_DIR@@`

Do not edit the source template, tests, metadata, or shared helper files. Prepare
your isolated copy:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python -m pip install -r task_project_requirements.txt &&
  python task_project_prepare.py --model "@@MODEL_NAME@@" --task 6 --force
'
```

## Objective

Extend the lightweight Bottle framework by creating `bottle_plugins.py` in the
working copy. Implement four Bottle Plugin API v2 plugins:

1. `SessionPlugin`: signed-cookie stateless sessions exposed through
   `request.session`.
2. `CORSPlugin`: normal CORS headers and `OPTIONS` preflight handling.
3. `RateLimitPlugin`: in-memory fixed-window rate limiting with HTTP 429.
4. `ETagPlugin`: ETag generation for GET/HEAD 200 responses plus
   `If-None-Match` / 304 behavior.

Use only the Python standard library. Avoid modifying `bottle.py` unless there is
no cleaner way to satisfy the plugin contract. Read the working copy `README.md`
before implementation.

Official grading:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python task_project_evaluate.py --model "@@MODEL_NAME@@" --task 6 --submit-index 1
'
```

You may submit up to three times by incrementing `--submit-index`.

## Final report

Create `@@RESULTS_DIR@@/task6_report.md` with changed files, implemented plugin
behavior, commands run, official evaluation results, best pass count and
proportional score, and confirmation that `task6_source/` was not edited.
