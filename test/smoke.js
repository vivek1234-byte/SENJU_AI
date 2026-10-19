/**
 * SENJU smoke test — runs the same way on Windows and Linux:
 *
 *   node test/smoke.js
 *
 * 1. Checks the OS-specific command helpers for BOTH Windows and Linux (simulated).
 * 2. Launches the real app against a throwaway profile (your data is untouched),
 *    then drives it over the DevTools protocol: UI, settings, voice IPC, a live MCP server.
 * Needs no API key. Exits 0 when everything passes.
 */

const { spawn } = require('child_process');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9339;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. platform helpers, simulated per OS ─────────────────────
function loadPlatformAs(platform) {
  const calls = [];
  const fakeCP = {
    execFile: (cmd, args, opts, cb) => { calls.push([cmd, ...args]); (typeof opts === 'function' ? opts : cb || (() => {}))(null); },
    spawn: (cmd, args) => { calls.push([cmd, ...args]); return { on() {}, unref() {} }; },
  };
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const origLoad = Module._load;
  const file = path.join(ROOT, 'modules', 'platform.js');
  Object.defineProperty(process, 'platform', { value: platform });
  Module._load = function (req) { return req === 'child_process' ? fakeCP : origLoad.apply(this, arguments); };
  try {
    delete require.cache[file];
    return { mod: require(file), calls };
  } finally {
    Module._load = origLoad;
    Object.defineProperty(process, 'platform', realPlatform);
    delete require.cache[file];
  }
}

function platformChecks() {
  const win = loadPlatformAs('win32');
  check('win32: app icon is .ico and exists', win.mod.APP_ICON.endsWith('.ico') && fs.existsSync(win.mod.APP_ICON));
  win.mod.openExternal('https://example.com/?a=1&b=2');
  const url = win.calls.pop().join(' ');
  check('win32: "&" in a URL cannot start a second command', url.includes('^&') && !/[^^]&/.test(url), url);
  win.mod.openApp('calculator');
  check('win32: open_app → start calc', win.calls.pop().join(' ') === 'cmd.exe /c start  calc');
  win.mod.scheduleShutdown(() => {});
  check('win32: shutdown /s /t 60', win.calls.pop().join(' ') === 'shutdown /s /t 60');

  const lin = loadPlatformAs('linux');
  check('linux: app icon is .png and exists', lin.mod.APP_ICON.endsWith('.png') && fs.existsSync(lin.mod.APP_ICON));
  lin.mod.openExternal('https://example.com/?a=1&b=2');
  check('linux: URLs open with xdg-open', lin.calls.pop().join(' ') === 'xdg-open https://example.com/?a=1&b=2');
  lin.mod.scheduleShutdown(() => {});
  check('linux: shutdown -h +1', lin.calls.pop().join(' ') === 'shutdown -h +1');
}

// ── 2. the real app ───────────────────────────────────────────
async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.some((p) => p.url.includes('index.html'))) return;
    } catch (_) { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error('SENJU window never appeared');
}

async function appChecks() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'senju-smoke-'));
  const mcpDir = path.join(profile, 'mcp-files');
  fs.mkdirSync(mcpDir);
  fs.writeFileSync(path.join(mcpDir, 'hello.txt'), 'hello from the smoke test');

  const electronBin = require('electron'); // path to this OS's Electron binary
  const args = ['.', `--remote-debugging-port=${PORT}`];
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
  const child = spawn(electronBin, args, {
    cwd: ROOT,
    env: { ...process.env, SENJU_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.on('exit', r));

  let browser;
  try {
    await waitForPage();
    check('app starts and loads index.html', true);
    const puppeteer = require('puppeteer');
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
    const page = (await browser.pages()).find((p) => p.url().includes('index.html'));
    await sleep(4000); // boot animation

    const ui = await page.evaluate(() => ({
      bridge: !!(window.dvsc && window.dvsc.sendMessage && window.dvsc.transcribe && window.dvsc.mcpSaveConfig),
      nvidiaKeyField: !!document.getElementById('settings-nvidia-key'),
      mcpEditor: !!document.getElementById('mcp-config'),
      groqLeft: /groq/i.test(document.documentElement.innerHTML),
    }));
    check('preload bridge exposes chat, voice and MCP', ui.bridge);
    check('Settings has NVIDIA key + MCP editor', ui.nvidiaKeyField && ui.mcpEditor);
    check('no Groq left in the UI', !ui.groqLeft);

    const info = await page.evaluate(() => window.dvsc.getAiProviderInfo());
    check('brain lists the Nemotron model chain', info.models.length >= 2 && info.models.every((m) => m.startsWith('nvidia/')), info.models.join(', '));

    // Voice: tone → MediaRecorder → WAV (16 kHz) → main process → NVIDIA (no key here, so a clean error)
    const voice = await page.evaluate(async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      const rec = new MediaRecorder(dest.stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(); await new Promise((r) => setTimeout(r, 800)); rec.stop(); await stopped;
      osc.stop(); ctx.close();
      const url = await blobToWavDataUrl(new Blob(chunks, { type: 'audio/webm' }));
      const head = atob(url.split(',')[1].slice(0, 64));
      const res = await window.dvsc.transcribe(url, '');
      return { wav: head.startsWith('RIFF') && head.slice(8, 12) === 'WAVE', error: res.error || '' };
    });
    check('voice: recording converts to WAV', voice.wav);
    check('voice: transcribe IPC reaches main and asks for the NVIDIA key', /NVIDIA API key missing/.test(voice.error), voice.error);

    // MCP: connect the official filesystem server and list its tools
    const cfg = JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', mcpDir] } } });
    const mcp = await page.evaluate((c) => window.dvsc.mcpSaveConfig(c), cfg);
    const files = (mcp.status || []).find((s) => s.name === 'files') || {};
    check('MCP: filesystem server connects', mcp.success && files.state === 'connected', files.error || `${(files.tools || []).length} tools`);
    check('MCP: read_text_file tool available', (files.tools || []).includes('read_text_file'));
    const bad = await page.evaluate(() => window.dvsc.mcpSaveConfig('{ broken json'));
    check('MCP: bad config is rejected with a message', !bad.success && !!bad.error);

    await page.evaluate(() => window.dvsc.close()).catch(() => {});
  } catch (e) {
    check('app run', false, e.message);
  } finally {
    if (browser) browser.disconnect();
    const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
    check('app quits cleanly', code !== 'timeout', `exit ${code}`);
    if (code === 'timeout') child.kill('SIGKILL');
    if (results.includes(false)) console.log('\n--- app log (tail) ---\n' + log.split('\n').slice(-40).join('\n'));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  console.log(`SENJU smoke test on ${process.platform} (${os.release()})\n`);
  platformChecks();
  await appChecks();
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
