<!-- PATH_TEMPLATE: MODEL_NAME=@@MODEL_NAME@@ DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ BENCHMARK_ROOT=@@BENCHMARK_ROOT@@ RUN_DIR=@@RUN_DIR@@ RESULTS_DIR=@@RESULTS_DIR@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Task 8: Click CLI Framework Bug Fixing

Work only in the current benchmark workspace and run dependency installation,
tests, and grading inside Docker service `@@DOCKER_SERVICE@@` whenever possible.

```bash
MODEL_NAME="@@MODEL_NAME@@"
```

## Migrated task assets

- Source template: `@@BENCHMARK_ROOT@@/task8_source/`
- Hidden tests: `@@BENCHMARK_ROOT@@/task8_tests/`
- Task metadata: `@@BENCHMARK_ROOT@@/task8.yaml`
- Working copy: `@@RUN_DIR@@`
- Results directory: `@@RESULTS_DIR@@`

Prepare your isolated working copy:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python -m pip install -r task_project_requirements.txt &&
  python task_project_prepare.py --model "@@MODEL_NAME@@" --task 8 --force
'
```

Do not edit `task8_source/`, `task8_tests/`, `task8.yaml`, or shared helpers.

## Objective

Fix the bundled Click CLI framework implementation so the hidden tests pass.
The likely hot spots are `click/core.py`, `click/types.py`, and
`click/formatting.py`.

Known symptoms include:

1. `IntRange` open bounds with `clamp` clamp in the wrong direction.
2. `Choice(case_sensitive=False)` mishandles differently-cased input.
3. `File` lazy opening is inverted between read and write modes.
4. Group subcommands are not sorted alphabetically.
5. Short/long option pairs derive parameter names from the short option.
6. Subcommand `auto_envvar_prefix` casing is wrong.
7. Argument metavars with `...` appear in the wrong help location.
8. Group parsing swaps subcommand name and arguments.
9. `HelpFormatter.dedent` increases indentation.
10. Short/long option help display order is reversed.

Official grading:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python task_project_evaluate.py --model "@@MODEL_NAME@@" --task 8 --submit-index 1
'
```

You may submit up to three times.

## Final report

Create `@@RESULTS_DIR@@/task8_report.md` with changed files, bugs fixed, commands
run, official evaluation results, best pass count and proportional score, and
confirmation that the original `task8_source/` was not edited.
