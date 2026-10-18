/**
 * SENJU Platform helpers
 * ----------------------
 * The few things that differ between Windows and Linux: which icon file the
 * OS understands, how to open a URL / launch an app, and how to schedule a
 * shutdown. Everything else in SENJU is plain Node/Electron and runs on both.
 */

const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Windows wants .ico; Linux (and macOS) render PNG reliably
const APP_ICON = path.join(__dirname, '..', 'assets', IS_WIN ? 'senju-icon.ico' : 'senju-icon.png');

/** Is `cmd` an executable somewhere on PATH? (Linux/macOS only) */
function which(cmd) {
  if (cmd.includes('/')) return fs.existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch (_) { /* keep looking */ }
  }
  return null;
}

/** Start a program fully detached so it outlives SENJU and never blocks it. */
function launchDetached(cmd, args = []) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`[SENJU Platform] launch ${cmd} failed:`, err.message));
  child.unref();
}

/** Open a URL (or URI like spotify:) with the system default handler. */
function openExternal(target, tag = 'SENJU') {
  if (IS_WIN) {
    // execFile avoids shell-injection from model-generated text
    execFile('cmd.exe', ['/c', 'start', '', target], { windowsHide: true }, (err) => {
      if (err) console.error(`[${tag}] open ${target} failed:`, err.message);
    });
    return;
  }
  launchDetached(IS_MAC ? 'open' : 'xdg-open', [target]);
}

// Spoken name → candidates. Windows: a `start` target. Linux: binaries tried in order.
const WIN_APPS = {
  'google chrome': 'chrome', chrome: 'chrome',
  'microsoft edge': 'msedge', edge: 'msedge',
  word: 'winword', 'microsoft word': 'winword',
  excel: 'excel', 'microsoft excel': 'excel',
  powerpoint: 'powerpnt', 'microsoft powerpoint': 'powerpnt',
  vscode: 'code', 'vs code': 'code', 'visual studio code': 'code',
  calculator: 'calc', calc: 'calc',
  notepad: 'notepad', paint: 'mspaint',
  'file explorer': 'explorer', explorer: 'explorer',
  'task manager': 'taskmgr', cmd: 'cmd', terminal: 'wt',
  settings: 'ms-settings:', spotify: 'spotify:', whatsapp: 'whatsapp:',
};

const LINUX_APPS = {
  'google chrome': ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
  chromium: ['chromium', 'chromium-browser'],
  firefox: ['firefox'],
  'microsoft edge': ['microsoft-edge', 'microsoft-edge-stable'], edge: ['microsoft-edge', 'microsoft-edge-stable'],
  word: ['libreoffice --writer', 'onlyoffice-desktopeditors'], 'microsoft word': ['libreoffice --writer'],
  excel: ['libreoffice --calc'], 'microsoft excel': ['libreoffice --calc'],
  powerpoint: ['libreoffice --impress'], 'microsoft powerpoint': ['libreoffice --impress'],
  vscode: ['code'], 'vs code': ['code'], 'visual studio code': ['code'],
  calculator: ['kcalc', 'gnome-calculator', 'galculator', 'qalculate-gtk'], calc: ['kcalc', 'gnome-calculator'],
  notepad: ['kate', 'kwrite', 'gnome-text-editor', 'gedit', 'mousepad'],
  'text editor': ['kate', 'kwrite', 'gnome-text-editor', 'gedit'],
  paint: ['kolourpaint', 'pinta', 'gimp'],
  'file explorer': ['dolphin', 'nautilus', 'thunar', 'nemo'], explorer: ['dolphin', 'nautilus', 'thunar', 'nemo'],
  files: ['dolphin', 'nautilus', 'thunar', 'nemo'],
  'task manager': ['plasma-systemmonitor', 'ksysguard', 'gnome-system-monitor'],
  'system monitor': ['plasma-systemmonitor', 'gnome-system-monitor'],
  cmd: ['konsole', 'ptyxis', 'gnome-terminal', 'xterm'], terminal: ['konsole', 'ptyxis', 'gnome-terminal', 'xterm'],
  settings: ['systemsettings', 'gnome-control-center'],
  spotify: ['spotify', 'flatpak run com.spotify.Client', 'xdg-open:https://open.spotify.com'],
  whatsapp: ['xdg-open:https://web.whatsapp.com'],
  discord: ['discord', 'flatpak run com.discordapp.Discord'],
  steam: ['steam'], vlc: ['vlc'], obs: ['obs'], telegram: ['telegram-desktop'],
};

/**
 * Launch an app by its spoken name. Returns false when nothing matching was found.
 * `name` must already be validated as safe by the caller.
 */
function openApp(name, tag = 'SENJU') {
  const key = String(name).toLowerCase().replace(/_/g, ' ').trim();
  if (IS_WIN) {
    const mapped = WIN_APPS[key] || key.replace(/\s+/g, '');
    openExternal(mapped, tag);
    return true;
  }
  const candidates = LINUX_APPS[key] || [key.replace(/\s+/g, '-'), key.replace(/\s+/g, '')];
  for (const cand of candidates) {
    if (cand.startsWith('xdg-open:')) { openExternal(cand.slice(9), tag); return true; }
    const [bin, ...args] = cand.split(' ');
    if (which(bin)) { launchDetached(bin, args); return true; }
  }
  // Last resort: an installed .desktop entry with that id (e.g. "org.kde.kcalc")
  if (which('gtk-launch')) { launchDetached('gtk-launch', [candidates[0]]); return true; }
  return false;
}

function scheduleShutdown(cb) {
  if (IS_WIN) execFile('shutdown', ['/s', '/t', '60'], { windowsHide: true }, cb);
  else execFile('shutdown', ['-h', '+1'], cb); // systemd: whole minutes only
}

function cancelShutdown(cb) {
  if (IS_WIN) execFile('shutdown', ['/a'], { windowsHide: true }, cb);
  else execFile('shutdown', ['-c'], cb);
}

module.exports = { IS_WIN, IS_MAC, APP_ICON, which, openExternal, openApp, scheduleShutdown, cancelShutdown };
