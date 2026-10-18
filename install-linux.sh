#!/usr/bin/env bash
# One-time Linux setup for SENJU:
#   1. makes node_modules Linux-ready (Electron binary, native addons, puppeteer Chrome)
#   2. installs the SENJU icon + app-menu entry
#   3. puts a shortcut on the Desktop and pins SENJU to the dock / taskbar
# Safe to re-run (e.g. after moving the folder).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_ID="senju"
ICON_SRC="$APP_DIR/assets/senju-icon.png"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_FILE="$DATA_HOME/applications/$APP_ID.desktop"
cd "$APP_DIR"

# ── 1. Dependencies ──────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "→ Installing dependencies…"
  npm install
elif [ "$(cat node_modules/electron/path.txt 2>/dev/null)" != "electron" ]; then
  # node_modules came from Windows: swap in the Linux Electron binary.
  # (curl with a live progress bar — npm's own downloader shows nothing and can crawl)
  ver="$(node -p "require('./node_modules/electron/package.json').version")"
  arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  name="electron-v$ver-linux-$arch.zip"
  zip="${TMPDIR:-/tmp}/$name"
  gh="https://github.com/electron/electron/releases/download/v$ver"
  echo "→ Downloading Electron $ver for Linux…"
  # GitHub's asset CDN is often throttled; try the npmmirror copy first, GitHub as fallback
  curl -L --fail --progress-bar -o "$zip" "https://cdn.npmmirror.com/binaries/electron/$ver/$name" \
    || curl -L --fail --progress-bar -o "$zip" "$gh/$name"
  # Verify against the official checksum published on GitHub
  want="$(curl -sL --fail "$gh/SHASUMS256.txt" | grep " \*\?$name\$" | cut -d' ' -f1)"
  if [ -n "$want" ] && [ "$(sha256sum "$zip" | cut -d' ' -f1)" != "$want" ]; then
    echo "✗ Electron download failed its checksum — aborting." >&2
    rm -f "$zip"; exit 1
  fi
  echo "→ Unpacking…"
  rm -rf node_modules/electron/dist
  mkdir -p node_modules/electron/dist
  (cd node_modules/electron/dist && unzip -q "$zip")
  printf 'electron' > node_modules/electron/path.txt
  rm -f "$zip"
fi
if ! ls "$HOME/.cache/puppeteer/chrome" >/dev/null 2>&1; then
  echo "→ Downloading Chrome for WhatsApp / train tools…"
  npx --yes puppeteer browsers install chrome || echo "  (skipped — WhatsApp will ask again later)"
fi
chmod +x "$APP_DIR/senju.sh"

# ── 2. Icon + app-menu entry ─────────────────────────────────
echo "→ Installing icon and menu entry…"
for size in 16 32 48 64 128 256 512; do
  dir="$DATA_HOME/icons/hicolor/${size}x${size}/apps"
  mkdir -p "$dir"
  if command -v magick >/dev/null; then
    magick "$ICON_SRC" -resize "${size}x${size}" "$dir/$APP_ID.png"
  elif command -v convert >/dev/null; then
    convert "$ICON_SRC" -resize "${size}x${size}" "$dir/$APP_ID.png"
  elif [ "$size" = 512 ]; then
    cp "$ICON_SRC" "$dir/$APP_ID.png"
  fi
done
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true

mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=SENJU
GenericName=Personal AI Assistant
Comment=My own personal AI assistant
Exec="$APP_DIR/senju.sh"
Path=$APP_DIR
Icon=$APP_ID
Terminal=false
Categories=Utility;
Keywords=AI;Assistant;Voice;SENJU;
StartupNotify=true
StartupWMClass=dvsc-assistant
EOF
chmod +x "$DESKTOP_FILE"
command -v update-desktop-database >/dev/null && update-desktop-database -q "$DATA_HOME/applications" || true
command -v kbuildsycoca6 >/dev/null && kbuildsycoca6 >/dev/null 2>&1 || true

# Desktop shortcut
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESKTOP_DIR" ]; then
  cp "$DESKTOP_FILE" "$DESKTOP_DIR/SENJU.desktop"
  chmod +x "$DESKTOP_DIR/SENJU.desktop"
  command -v gio >/dev/null && gio set "$DESKTOP_DIR/SENJU.desktop" metadata::trusted true 2>/dev/null || true
fi

# ── 3. Pin to dock / taskbar ─────────────────────────────────
pin_kde() {
  local script
  script=$(cat <<'JS'
var pinned = 0;
panels().forEach(function (panel) {
  panel.widgets().forEach(function (w) {
    w.currentConfigGroup = ["General"];
    var cur = w.readConfig("launchers", null);
    if (cur === null || cur === undefined) return;          // not a task manager / dock
    var list = (typeof cur === "string") ? (cur ? cur.split(",") : []) : Array.prototype.slice.call(cur);
    if (list.length === 0) return;                           // untouched default list — don't clobber it
    if (list.indexOf("applications:senju.desktop") === -1) {
      list.push("applications:senju.desktop");
      w.writeConfig("launchers", list);
      w.reloadConfig();
    }
    pinned++;
  });
});
print(pinned);
JS
)
  local qdbus
  qdbus="$(command -v qdbus6 || command -v qdbus-qt6 || command -v qdbus || true)"
  if [ -n "$qdbus" ]; then
    "$qdbus" org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "$script"
  else
    gdbus call --session --dest org.kde.plasmashell --object-path /PlasmaShell \
      --method org.kde.PlasmaShell.evaluateScript "$script"
  fi
}

pin_gnome() {
  local favs
  favs="$(gsettings get org.gnome.shell favorite-apps)"
  case "$favs" in *"'$APP_ID.desktop'"*) return 0 ;; esac
  if [ "$favs" = "@as []" ] || [ "$favs" = "[]" ]; then
    gsettings set org.gnome.shell favorite-apps "['$APP_ID.desktop']"
  else
    gsettings set org.gnome.shell favorite-apps "${favs%]}, '$APP_ID.desktop']"
  fi
}

pin_caelestia() {
  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/caelestia/shell.json"
  [ -f "$cfg" ] || return 1
  # The shell watches this file and reloads the dock live
  node -e '
    const fs = require("fs"), [cfg, id] = process.argv.slice(1);
    const c = JSON.parse(fs.readFileSync(cfg, "utf8"));
    c.bar = c.bar || {}; c.bar.dock = c.bar.dock || {};
    const pins = c.bar.dock.pinnedApps = c.bar.dock.pinnedApps || [];
    if (!pins.includes(id)) { pins.push(id); fs.writeFileSync(cfg, JSON.stringify(c, null, 4) + "\n"); }
  ' "$cfg" "$APP_ID"
}

echo "→ Pinning SENJU to the dock…"
if pgrep -x quickshell >/dev/null && pin_caelestia; then
  echo "  pinned (Caelestia dock)"
else
  case "${XDG_CURRENT_DESKTOP:-}" in
    *KDE*)
      if [ "$(pin_kde 2>/dev/null | tr -dc '0-9')" -gt 0 ] 2>/dev/null; then echo "  pinned (KDE Plasma)"
      else echo "  couldn't pin automatically — right-click SENJU in the app menu → Pin to Task Manager"; fi ;;
    *GNOME*|*Ubuntu*) pin_gnome && echo "  pinned (GNOME)" || echo "  couldn't pin automatically — right-click SENJU → Add to Favorites" ;;
    *) echo "  unknown desktop — pin SENJU from your app menu manually" ;;
  esac
fi

echo
echo "✓ SENJU is installed. Launch it from the dock, the app menu, the Desktop, or: $APP_DIR/senju.sh"
