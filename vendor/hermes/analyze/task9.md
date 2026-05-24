<!-- PATH_TEMPLATE: MODEL_NAME=@@MODEL_NAME@@ DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ BENCHMARK_ROOT=@@BENCHMARK_ROOT@@ RUN_DIR=@@RUN_DIR@@ RESULTS_DIR=@@RESULTS_DIR@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Task 9: Jinja2 Custom Extension Development

Work only in the current benchmark workspace. Run dependency installation, tests,
and grading inside Docker service `@@DOCKER_SERVICE@@` whenever Docker is
available.

```bash
MODEL_NAME="@@MODEL_NAME@@"
```

## Migrated task assets

- Source template: `@@BENCHMARK_ROOT@@/task9_source/`
- Hidden tests: `@@BENCHMARK_ROOT@@/task9_tests/`
- Task metadata: `@@BENCHMARK_ROOT@@/task9.yaml`
- Working copy: `@@RUN_DIR@@`
- Results directory: `@@RESULTS_DIR@@`

Prepare your isolated working copy:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python -m pip install -r task_project_requirements.txt &&
  python task_project_prepare.py --model "@@MODEL_NAME@@" --task 9 --force
'
```

Do not edit `task9_source/`, `task9_tests/`, `task9.yaml`, or shared helpers.

## Objective

Create `jinja2_extensions.py` in the working copy and implement two Jinja2
extensions:

1. `SpacelessExtension` for `{% spaceless %}...{% endspaceless %}`. It removes
   whitespace between HTML tags while preserving text content inside tags.
2. `SwitchExtension` for
   `{% switch expr %}{% case value %}...{% default %}...{% endswitch %}`. It
   should support multiple case branches and an optional default branch.

Use the Jinja2 Extension API. Read the working copy `README.md` for the full
contract.

Official grading:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python task_project_evaluate.py --model "@@MODEL_NAME@@" --task 9 --submit-index 1
'
```

You may submit up to three times.

## Final report

Create `@@RESULTS_DIR@@/task9_report.md` with changed files, implemented
extension behavior, commands run, official evaluation results, best pass count
and proportional score, and confirmation that the original `task9_source/` was
not edited.
