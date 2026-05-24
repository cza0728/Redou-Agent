#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/redou-agent"
APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$APPLICATIONS_DIR/redou-agent.desktop"
LAUNCH_WRAPPER="$LAUNCHER_HOME/launch-redou-agent.sh"
ICON_PATH="$ROOT/apps/desktop/assets/icons/redou-agent.png"

mkdir -p "$LAUNCHER_HOME" "$APPLICATIONS_DIR"

cat > "$LAUNCH_WRAPPER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$ROOT"
exec bash "$ROOT/Launch Redou Agent.sh"
EOF

chmod +x "$LAUNCH_WRAPPER" || true
chmod +x "$ROOT/Install Redou Agent.sh" "$ROOT/Launch Redou Agent.sh" "$ROOT/install-redou-agent.sh" "$ROOT/start-redou-agent.sh" || true

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Redou Agent
Comment=Local AI desktop workspace
Exec=$LAUNCH_WRAPPER
Icon=$ICON_PATH
Path=$ROOT
Terminal=false
Categories=Development;Utility;
StartupNotify=true
EOF

chmod +x "$DESKTOP_FILE" || true

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

DESKTOP_DIR="${XDG_DESKTOP_DIR:-$HOME/Desktop}"
if [[ -d "$DESKTOP_DIR" ]]; then
  cp "$DESKTOP_FILE" "$DESKTOP_DIR/Redou Agent.desktop"
  chmod +x "$DESKTOP_DIR/Redou Agent.desktop" || true
fi

echo "Linux launcher installed:"
echo "  $DESKTOP_FILE"
if [[ -d "$DESKTOP_DIR" ]]; then
  echo "  $DESKTOP_DIR/Redou Agent.desktop"
fi
