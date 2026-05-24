#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$ROOT/apps/desktop"
WEB_DIR="$ROOT/vendor/hermes/web"
RENDERER_ENTRY="$ROOT/vendor/hermes/hermes_cli/web_dist/index.html"

LAUNCH=0
SKIP_RENDERER_BUILD=0
CHECK_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --launch)
      LAUNCH=1
      ;;
    --skip-renderer-build)
      SKIP_RENDERER_BUILD=1
      ;;
    --check-only)
      CHECK_ONLY=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: bash install-redou-agent.sh [--check-only] [--skip-renderer-build] [--launch]

Prepares Redou Agent from source on Linux.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

step() {
  printf '\n==> %s\n' "$1"
}

ok() {
  printf 'OK  %s\n' "$1"
}

warn() {
  printf 'WARN %s\n' "$1"
}

command_path() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    command -v "$command_name"
  fi
}

python_supported() {
  local python_path="$1"
  "$python_path" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1
}

resolve_python() {
  local candidates=()
  if [[ -n "${REDOU_PYTHON:-}" ]]; then
    candidates+=("$REDOU_PYTHON")
  fi
  candidates+=("python3.12" "python3.11" "python3" "python")

  local candidate resolved
  for candidate in "${candidates[@]}"; do
    if [[ "$candidate" == */* ]]; then
      [[ -x "$candidate" ]] || continue
      resolved="$candidate"
    else
      resolved="$(command_path "$candidate" || true)"
      [[ -n "$resolved" ]] || continue
    fi
    if python_supported "$resolved"; then
      printf '%s\n' "$resolved"
      return 0
    fi
  done

  echo "Python 3.11 or newer was not found. On Ubuntu, install python3 python3-venv python3-pip." >&2
  exit 1
}

resolve_node() {
  local node_path
  node_path="$(command_path node || true)"
  if [[ -z "$node_path" ]]; then
    echo "Node.js was not found. Install Node.js 20+ and npm." >&2
    exit 1
  fi

  local major
  major="$("$node_path" --version | sed 's/^v//' | cut -d. -f1)"
  if [[ "$major" -lt 20 ]]; then
    echo "Node.js $("$node_path" --version) found, but Redou Agent requires Node.js 20+." >&2
    exit 1
  fi
  printf '%s\n' "$node_path"
}

resolve_npm() {
  local npm_path
  npm_path="$(command_path npm || true)"
  if [[ -z "$npm_path" ]]; then
    echo "npm was not found. Install Node.js 20+ and npm." >&2
    exit 1
  fi
  printf '%s\n' "$npm_path"
}

require_command() {
  local command_name="$1"
  local package_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name was not found. Install $package_hint." >&2
    exit 1
  fi
}

invoke_npm() {
  local project_dir="$1"
  shift
  (cd "$project_dir" && "$NPM" "$@")
}

install_npm_project() {
  local project_dir="$1"
  local label="$2"

  if [[ ! -f "$project_dir/package.json" ]]; then
    echo "Missing package.json for $label at $project_dir." >&2
    exit 1
  fi

  step "Installing $label dependencies"
  if [[ -d "$project_dir/node_modules" ]]; then
    invoke_npm "$project_dir" install --no-fund --no-audit --progress=false
  elif [[ -f "$project_dir/package-lock.json" ]]; then
    invoke_npm "$project_dir" ci --no-fund --no-audit --progress=false
  else
    invoke_npm "$project_dir" install --no-fund --no-audit --progress=false
  fi
  ok "$label dependencies are ready"
}

update_linux_launchers() {
  local launcher_script="$ROOT/scripts/create-redou-linux-launchers.sh"
  if [[ ! -f "$launcher_script" ]]; then
    warn "Linux launcher generator not found at $launcher_script"
    return
  fi

  step "Refreshing Linux launchers"
  if bash "$launcher_script"; then
    ok "Linux launchers are ready"
  else
    warn "Could not refresh Linux launchers"
  fi
}

cd "$ROOT"

step "Checking local tools"
NODE="$(resolve_node)"
ok "Node.js $("$NODE" --version) found at $NODE"

NPM="$(resolve_npm)"
ok "npm $("$NPM" --version) found at $NPM"

PYTHON="$(resolve_python)"
export REDOU_PYTHON="$PYTHON"
ok "Python $("$PYTHON" --version 2>&1) found at $PYTHON"

require_command git "git"
ok "git $(git --version | awk '{print $3}') found"

require_command bash "bash"
ok "bash is available"

if ! "$PYTHON" -m venv --help >/dev/null 2>&1; then
  echo "Python venv support is missing. On Ubuntu, install python3-venv." >&2
  exit 1
fi

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  ok "Preflight checks completed"
  exit 0
fi

install_npm_project "$DESKTOP_DIR" "desktop shell"

if [[ "$SKIP_RENDERER_BUILD" -eq 1 ]]; then
  warn "Renderer dependency install and build skipped"
else
  install_npm_project "$WEB_DIR" "renderer"
  step "Building renderer"
  invoke_npm "$WEB_DIR" run build
  if [[ ! -f "$RENDERER_ENTRY" ]]; then
    echo "Renderer build did not produce $RENDERER_ENTRY." >&2
    exit 1
  fi
  ok "Renderer build is ready"
fi

update_linux_launchers
step "Installation complete"
echo "Run Redou Agent with:"
echo '  bash "Launch Redou Agent.sh"'
echo "or from your Linux application launcher."

if [[ "$LAUNCH" -eq 1 ]]; then
  step "Launching Redou Agent"
  exec bash "$ROOT/start-redou-agent.sh"
fi
