#!/usr/bin/env bash
# Launch SENJU on Linux (Windows uses Start_SENJU.bat / launch-senju.vbs)
cd "$(dirname "$(readlink -f "$0")")" || exit 1

ELECTRON="node_modules/electron/dist/electron"
if [ ! -x "$ELECTRON" ]; then
  echo "Linux Electron not found — run ./install-linux.sh first." >&2
  exit 1
fi

# Tie the window to senju.desktop so the dock shows the SENJU icon (not the parent app's)
export CHROME_DESKTOP=senju.desktop
exec "$ELECTRON" . "$@"
