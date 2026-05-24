<!-- PATH_TEMPLATE: MODEL_NAME=@@MODEL_NAME@@ DOCKER_WORKSPACE=@@DOCKER_WORKSPACE@@ BENCHMARK_ROOT=@@BENCHMARK_ROOT@@ RUN_DIR=@@RUN_DIR@@ RESULTS_DIR=@@RESULTS_DIR@@ DOCKER_SERVICE=@@DOCKER_SERVICE@@ -->

# Task 7: Markdown Parser Implementation

Work only in the current benchmark workspace. Run real commands and keep
dependency installation, tests, and grading inside Docker service
`@@DOCKER_SERVICE@@` whenever Docker is available.

```bash
MODEL_NAME="@@MODEL_NAME@@"
```

## Migrated task assets

- Source template: `@@BENCHMARK_ROOT@@/task7_source/`
- Hidden tests: `@@BENCHMARK_ROOT@@/task7_tests/`
- Task metadata: `@@BENCHMARK_ROOT@@/task7.yaml`
- Working copy: `@@RUN_DIR@@`
- Results directory: `@@RESULTS_DIR@@`

Prepare your isolated working copy:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python -m pip install -r task_project_requirements.txt &&
  python task_project_prepare.py --model "@@MODEL_NAME@@" --task 7 --force
'
```

Do not edit `task7_source/`, `task7_tests/`, `task7.yaml`, or shared helpers.

## Objective

Implement a Markdown-to-HTML parser from scratch. Create or complete
`markdown_parser.py` so it exposes:

```python
def parse(text: str) -> str:
    ...
```

Support block elements such as headings, paragraphs, fenced code blocks,
blockquotes, unordered and ordered lists, horizontal rules, and nested content.
Support inline elements such as bold, italic, inline code, links, images,
strikethrough, and escaped punctuation. Read the working copy `README.md` for the
full specification.

Official grading:

```bash
docker compose exec @@DOCKER_SERVICE@@ bash -lc '
  cd @@BENCHMARK_ROOT@@ &&
  python task_project_evaluate.py --model "@@MODEL_NAME@@" --task 7 --submit-index 1
'
```

You may submit up to three times.

## Final report

Create `@@RESULTS_DIR@@/task7_report.md` with implementation notes, commands
run, official evaluation results, best pass count and proportional score, and
confirmation that the original `task7_source/` was not edited.
