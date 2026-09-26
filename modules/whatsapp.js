/**
 * SENJU WhatsApp Module (QR login only)
 * -------------------------------------
 *  - One connection attempt at a time (no overlapping restarts that kill each other)
 *  - Kills the exact leftover Chrome process tree from a previous run (by saved PID)
 *  - Waits for internet instead of hammering web.whatsapp.com while offline / VPN switching
 *  - If a saved login gets stuck (the known "loading 100% but never ready" bug),
 *    wipes it automatically and shows a fresh QR code
 *  - Debug log: whatsapp-debug.log in the SENJU folder
 */

const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { execFile } = require('child_process');

const SESSION_ROOT = path.join(__dirname, '..', 'whatsapp-session');
const PROFILE_DIR = path.join(SESSION_ROOT, 'session');
const PID_FILE = path.join(SESSION_ROOT, 'browser.pid');
const LOG_FILE = path.join(__dirname, '..', 'whatsapp-debug.log');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const OPEN_TIMEOUT_MS = 75 * 1000;     // no QR / progress by then → retry
const RESTORE_STUCK_MS = 45 * 1000;    // saved login loading but never ready → wipe + fresh QR
const RETRY_DELAYS = [2000, 5000, 15000, 30000];
const CONTACT_REFRESH_MS = 15 * 60 * 1000;

let client = null;
let browserWindow = null;
let lastSentMessage = null;
let shuttingDown = false;
let busy = null;                 // promise of the attempt currently being set up
let timers = {};
let retryCount = 0;
let restoreFailures = 0;
let scannedThisRun = false;      // after a fresh QR scan we never auto-wipe again (avoids QR loops)
let contactsCache = [];
let attemptStartedAt = 0;

const status = { state: 'idle', qr: null, percent: 0, message: 'Not started', updatedAt: Date.now() };

// ─────────────────────────────────────────────────────────────
// Logging / status
// ─────────────────────────────────────────────────────────────
function errText(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

function log(...parts) {
  const secs = attemptStartedAt ? ` @${((Date.now() - attemptStartedAt) / 1000).toFixed(1)}s` : '';
  const line = `[${new Date().toISOString()}] ${parts.map(errText).join(' ')}${secs}`;
  console.log('[WhatsApp]', line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 300 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) { /* ignore */ }
}

function send(channel, payload) {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.webContents.send(channel, payload);
}

function setStatus(state, extra = {}) {
  Object.assign(status, { state, qr: null, percent: 0, message: '' }, extra, { updatedAt: Date.now() });
  log(`${state}${status.message ? ' — ' + status.message : ''}${status.percent ? ` (${status.percent}%)` : ''}`);
  send('whatsapp-status', { ...status });
  if (state === 'qr' && status.qr) send('whatsapp-qr', status.qr);
  if (state === 'ready') send('whatsapp-ready');
  if (state === 'disconnected') send('whatsapp-disconnected');
}

function setTimer(name, fn, ms) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(fn, ms);
}
function clearTimer(name) { clearTimeout(timers[name]); delete timers[name]; }
function clearAllTimers() {
  Object.values(timers).forEach((t) => { clearTimeout(t); clearInterval(t); });
  timers = {};
}

// ─────────────────────────────────────────────────────────────
// Browser cleanup
// ─────────────────────────────────────────────────────────────
function run(cmd, args, timeout = 6000) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout }, () => resolve()));
}

function hasLock() {
  return ['lockfile', 'SingletonLock'].some((f) => {
    try { fs.lstatSync(path.join(PROFILE_DIR, f)); return true; } catch (_) { return false; }
  });
}

function removeLocks() {
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.rmSync(path.join(PROFILE_DIR, f), { force: true }); } catch (_) { /* in use */ }
  }
}

async function killLeftoverBrowser() {
  if (process.platform !== 'win32') return;
  // 1) exact process tree we launched last time
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    if (pid) await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  } catch (_) { /* no pid file */ }
  try { fs.rmSync(PID_FILE, { force: true }); } catch (_) { /* ignore */ }

  removeLocks();
  if (!hasLock()) return;

  // 2) fallback: any Chrome using our session folder
  log('Lock still present — searching for leftover WhatsApp Chrome');
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name like 'chrome%'\" | " +
    "Where-Object { $_.CommandLine -like '*whatsapp-session*' } | " +
    "ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }";
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 15000);
  await new Promise((r) => setTimeout(r, 500));
  removeLocks();
}

async function destroyClient() {
  const c = client;
  client = null;
  if (!c) return;
  let pid = null;
  try { pid = c.pupBrowser && c.pupBrowser.process() && c.pupBrowser.process().pid; } catch (_) { /* ignore */ }
  try { await Promise.race([c.destroy(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* ignore */ }
  if (pid && process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F']);
  try { fs.rmSync(PID_FILE, { force: true }); } catch (_) { /* ignore */ }
}

function waitForInternet() {
  return new Promise((resolve) => {
    const check = () => {
      if (shuttingDown) return resolve(false);
      dns.lookup('web.whatsapp.com', (err) => {
        if (!err) return resolve(true);
        setTimer('net', check, 4000);
      });
    };
    check();
  });
}

// ─────────────────────────────────────────────────────────────
// Connect (QR only)
// ─────────────────────────────────────────────────────────────
function initWhatsApp(mainWindow) {
  if (mainWindow) browserWindow = mainWindow;
  if (shuttingDown) return Promise.resolve();
  if (busy) return busy;             // an attempt is already being set up
  busy = startAttempt().finally(() => { busy = null; });
  return busy;
}

async function startAttempt() {
  clearAllTimers();
  attemptStartedAt = Date.now();
  await destroyClient();

  setStatus('starting', { message: 'Checking internet...' });
  let online = await new Promise((r) => dns.lookup('web.whatsapp.com', (e) => r(!e)));
  if (!online) {
    setStatus('offline', { message: 'Waiting for internet (turn off VPN if it is on)...' });
    online = await waitForInternet();
    if (!online) return;
    attemptStartedAt = Date.now();
  }

  await killLeftoverBrowser();

  // One-time: the old saved login on this PC was stuck, so start clean with a QR code
  const RESET_MARKER = path.join(SESSION_ROOT, '.qr-only-v2');
  if (!fs.existsSync(RESET_MARKER)) {
    log('One-time cleanup of old saved login');
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (e) { log('cleanup failed:', e); }
    try { fs.mkdirSync(SESSION_ROOT, { recursive: true }); fs.writeFileSync(RESET_MARKER, new Date().toISOString()); } catch (_) { /* ignore */ }
  }

  const { Client, LocalAuth } = require('whatsapp-web.js');
  const hasSession = fs.existsSync(PROFILE_DIR);

  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_ROOT }),
    userAgent: USER_AGENT,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    qrMaxRetries: 0,
    authTimeoutMs: 60000,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        '--disable-extensions', '--no-first-run', '--no-default-browser-check',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding', '--mute-audio',
      ],
    },
  });
  client = c;
  const alive = () => client === c && !shuttingDown;

  c.on('qr', async (qr) => {
    if (!alive()) return;
    clearTimer('open'); clearTimer('restore');
    scannedThisRun = true;
    try {
      const dataUrl = await require('qrcode').toDataURL(qr, { margin: 1, width: 300 });
      setStatus('qr', { qr: dataUrl, message: 'Open WhatsApp on your phone → Linked devices → Link a device → scan this QR' });
    } catch (e) { log('QR render failed:', e); }
  });

  c.on('loading_screen', (percent) => {
    if (!alive()) return;
    clearTimer('open');
    setStatus('loading', { percent: Number(percent) || 0, message: 'Loading chats...' });
    // Known bug: restored sessions sometimes reach 100% and never become ready
    setTimer('restore', () => onStuck(c, 'Loading finished but WhatsApp never became ready'), RESTORE_STUCK_MS);
  });

  c.on('authenticated', () => {
    if (!alive()) return;
    clearTimer('open');
    setStatus('authenticated', { message: 'QR scanned — syncing chats...' });
    setTimer('restore', () => onStuck(c, 'Linked but WhatsApp never became ready'), RESTORE_STUCK_MS + 30000);
  });

  c.on('auth_failure', (msg) => {
    if (!alive()) return;
    log('Auth failure:', msg);
    wipeAndRestart('Saved login is no longer valid. Showing a new QR code...');
  });

  c.on('ready', () => {
    if (!alive()) return;
    clearTimer('open'); clearTimer('restore');
    retryCount = 0; restoreFailures = 0;
    const me = c.info && c.info.pushname ? ` as ${c.info.pushname}` : '';
    setStatus('ready', { message: `Connected${me}` });
    refreshContacts();
    clearInterval(timers.contacts);
    timers.contacts = setInterval(refreshContacts, CONTACT_REFRESH_MS);
  });

  c.on('disconnected', (reason) => {
    if (!alive()) return;
    log('Disconnected:', String(reason));
    contactsCache = [];
    if (String(reason).toUpperCase() === 'LOGOUT') {
      wipeAndRestart('Logged out from phone. Showing a new QR code...');
    } else {
      setStatus('disconnected', { message: 'Connection lost. Reconnecting...' });
      retryLater();
    }
  });

  setStatus('starting', { message: hasSession ? 'Restoring saved login...' : 'Opening WhatsApp Web for QR code...' });
  setTimer('open', () => onStuck(c, 'WhatsApp Web did not open in time'), OPEN_TIMEOUT_MS);

  // save browser PID as soon as Chrome is up, so a crash/force-close can be cleaned next time
  const pidWatch = setInterval(() => {
    if (!alive()) return clearInterval(pidWatch);
    try {
      const p = c.pupBrowser && c.pupBrowser.process();
      if (p && p.pid) {
        fs.mkdirSync(SESSION_ROOT, { recursive: true });
        fs.writeFileSync(PID_FILE, String(p.pid));
        clearInterval(pidWatch);
      }
    } catch (_) { /* ignore */ }
  }, 300);

  c.initialize().catch((err) => {
    clearInterval(pidWatch);
    if (!alive()) return;          // we replaced/destroyed this client on purpose
    const text = errText(err);
    log('Initialization error:', text);
    if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_PROXY|ERR_TIMED_OUT/i.test(text)) {
      setStatus('offline', { message: 'Internet dropped or changed (VPN?). Waiting for internet...' });
      destroyClient().then(waitForInternet).then((ok) => ok && initWhatsApp());
      return;
    }
    if (/auth timeout/i.test(text)) {
      setStatus('error', { message: 'WhatsApp Web loaded too slowly. Retrying...' });
    } else if (/already running/i.test(text)) {
      setStatus('error', { message: 'Closing old WhatsApp browser and retrying...' });
    } else if (/Could not find (Chrome|expected browser)/i.test(text)) {
      setStatus('error', { message: 'WhatsApp browser missing — run "npx puppeteer browsers install chrome" in the SENJU folder' });
      return;
    } else {
      setStatus('error', { message: `Could not connect (${text.slice(0, 80)}). Retrying...` });
    }
    retryLater();
  });
}

function onStuck(c, why) {
  if (client !== c || shuttingDown || status.state === 'ready' || status.state === 'qr') return;
  log('Stuck:', why);
  const hadSession = fs.existsSync(PROFILE_DIR);
  if (hadSession && !scannedThisRun && ['loading', 'authenticated', 'starting'].includes(status.state)) {
    restoreFailures++;
    if (restoreFailures >= 1) {
      wipeAndRestart('Saved login got stuck. Showing a fresh QR code — please scan again.');
      return;
    }
  }
  if (scannedThisRun && status.state !== 'starting') {
    setStatus('error', { message: 'WhatsApp linked but did not finish loading. Retrying... (if this repeats, run "npm update whatsapp-web.js")' });
    retryLater(15000);
    return;
  }
  setStatus('error', { message: 'Connection got stuck. Retrying...' });
  retryLater(1000);
}

function retryLater(delayOverride) {
  if (shuttingDown) return;
  const delay = delayOverride ?? RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
  retryCount++;
  setTimer('retry', () => initWhatsApp(), delay);
}

async function wipeAndRestart(message) {
  clearAllTimers();
  setStatus('starting', { message });
  await destroyClient();
  await killLeftoverBrowser();
  for (let i = 0; i < 3; i++) {
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); break; } catch (e) {
      log('Could not delete session folder (retrying):', e);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  retryCount = 0;
  return initWhatsApp();
}

// Manual actions from the UI
async function restartWhatsApp() {
  if (busy) return busy;
  retryCount = 0;
  return initWhatsApp();
}

async function resetWhatsAppSession() {
  if (busy) await busy;
  return wipeAndRestart('Removing old login. Getting a new QR code...');
}

async function logoutWhatsApp() {
  const c = client;
  if (c && status.state === 'ready') {
    try { await Promise.race([c.logout(), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { log('Logout error:', e); }
  }
  return resetWhatsAppSession();
}

async function shutdownWhatsApp() {
  shuttingDown = true;
  clearAllTimers();
  await destroyClient();
}

// ─────────────────────────────────────────────────────────────
// Contacts + sending
// ─────────────────────────────────────────────────────────────
async function refreshContacts() {
  if (!client || status.state !== 'ready') return contactsCache;
  try {
    const list = await client.getContacts();
    const byKey = new Map();
    for (const c of list) {
      if (!c.id || !['c.us', 'lid'].includes(c.id.server)) continue;
      if (c.isGroup || c.isMe) continue;
      const name = (c.name || '').trim();
      const pushname = (c.pushname || '').trim();
      if (!name && !(c.isMyContact && pushname)) continue;
      const number = (c.number || (c.id.server === 'c.us' ? c.id.user : '') || '').replace(/\D/g, '');
      // one entry per real person: same number (or same name when number unknown) = duplicate
      const key = number || `name:${(name || pushname).toLowerCase()}`;
      const entry = { id: c.id._serialized, server: c.id.server, name, pushname, number };
      const prev = byKey.get(key);
      if (!prev || (prev.server !== 'c.us' && entry.server === 'c.us')) byKey.set(key, entry); // prefer phone-number ids
    }
    // WhatsApp's newer "LID" ids often duplicate a saved contact without a number → drop those copies
    const all = [...byKey.values()];
    const numberedNames = new Set(all.filter((c) => c.number).map((c) => (c.name || c.pushname).toLowerCase()));
    contactsCache = all.filter((c) => c.number || !numberedNames.has((c.name || c.pushname).toLowerCase()));
    log(`Contact cache: ${contactsCache.length} (from ${list.length})`);
  } catch (e) {
    log('Contact refresh failed:', e);
  }
  return contactsCache;
}

// Recent chats help pick the right person when two contacts have the same name
let chatCache = { at: 0, lastActive: new Map() };
async function recentChatActivity() {
  if (Date.now() - chatCache.at < 2 * 60 * 1000) return chatCache.lastActive;
  try {
    const chats = await withTimeout(client.getChats(), 15000, 'Loading chats');
    const m = new Map();
    for (const ch of chats) {
      if (ch.isGroup) continue;
      m.set(ch.id._serialized, ch.timestamp || 0);
      if (ch.id.user) m.set(`num:${ch.id.user}`, ch.timestamp || 0);
    }
    chatCache = { at: Date.now(), lastActive: m };
  } catch (e) {
    log('Chat list failed:', e);
  }
  return chatCache.lastActive;
}

function ensureReady() {
  if (!client || status.state !== 'ready') {
    const hint = status.state === 'qr'
      ? 'Scan the QR code in the WhatsApp tab first.'
      : `Currently: ${status.message || status.state}. Try again in a few seconds.`;
    throw new Error(`WhatsApp is not connected. ${hint}`);
  }
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const labelOf = (c) => c.name || c.pushname || '';
const lastDigits = (c) => (c.number ? `…${c.number.slice(-4)}` : '');

/** Returns { match } or { options } (list of candidates the user must choose from). */
async function findContact(query) {
  // "Shiva Singh 4521" → name + last digits of the number
  const m = String(query).match(/^(.*?)[\s(#…-]*(\d{3,})\)?\s*$/);
  const nameQ = norm(m ? m[1] : query);
  const digitsQ = m ? m[2] : '';

  let pool = contactsCache;
  if (digitsQ) pool = pool.filter((c) => c.number.endsWith(digitsQ));

  const exact = pool.filter((c) => norm(labelOf(c)) === nameQ || norm(c.pushname) === nameQ);
  const words = nameQ.split(' ');
  const wordMatch = pool.filter((c) => {
    const w = norm(labelOf(c)).split(' ');
    return words.every((q) => w.includes(q));
  });
  const partial = pool.filter((c) => norm(labelOf(c)).includes(nameQ));

  let candidates = exact.length ? exact : wordMatch.length ? wordMatch : partial;
  if (candidates.length <= 1) return { match: candidates[0] || null };

  // Same person saved more than once (same number, or copies without a number) → not really ambiguous
  const numbered = candidates.filter((c) => c.number);
  const uniqueNumbers = new Set((numbered.length ? numbered : candidates).map((c) => c.number || c.id));
  if (numbered.length && uniqueNumbers.size === 1) return { match: numbered.find((c) => c.server === 'c.us') || numbered[0] };
  if (uniqueNumbers.size === 1) return { match: candidates.find((c) => c.server === 'c.us') || candidates[0] };

  // Identical names with different numbers → pick the one you actually chat with most recently
  const sameName = new Set(candidates.map((c) => norm(labelOf(c)))).size === 1;
  if (sameName) {
    const activity = await recentChatActivity();
    const ranked = candidates
      .map((c) => ({ c, t: activity.get(c.id) || activity.get(`num:${c.number}`) || 0 }))
      .sort((a, b) => b.t - a.t);
    if (ranked[0].t > 0 && ranked[0].t !== (ranked[1] && ranked[1].t)) return { match: ranked[0].c };
  }

  return { options: candidates.slice(0, 6) };
}

async function resolveChatId(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('No contact given.');
  const lower = raw.toLowerCase();

  if (['me', 'myself', 'self', 'mujhe', 'khud', 'my number'].includes(lower)) {
    return { id: client.info.wid._serialized, label: 'yourself' };
  }

  // Phone number?
  const digits = raw.replace(/[^\d]/g, '');
  if (/^\+?[\d\s()-]{8,}$/.test(raw) && digits.length >= 10) {
    const full = digits.length === 10 ? '91' + digits : digits; // default India
    const numberId = await client.getNumberId(full);
    if (!numberId) throw new Error(`${raw} is not on WhatsApp.`);
    return { id: numberId._serialized, label: `+${full}` };
  }

  if (!contactsCache.length) await refreshContacts();
  let found = await findContact(raw);
  if (!found.match && !found.options) {
    await refreshContacts();
    found = await findContact(raw);
  }
  if (found.options) {
    const list = found.options.map((c) => `${labelOf(c)} ${lastDigits(c)}`.trim()).join(', ');
    log(`Ambiguous contact "${raw}":`, list);
    throw new Error(
      `More than one contact matches "${raw}": ${list}. Ask Vivek which one, then call send_whatsapp again with contact set to the name plus the last 4 digits (e.g. "${labelOf(found.options[0])} ${found.options[0].number.slice(-4)}").`
    );
  }
  if (!found.match) throw new Error(`Contact "${raw}" not found in WhatsApp contacts. Ask Vivek for the exact saved name or the phone number.`);
  const c = found.match;
  return { id: c.id, label: `${labelOf(c) || raw}${c.number ? ` (${lastDigits(c)})` : ''}` };
}

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out. WhatsApp may be reconnecting.`)), ms)),
  ]);
}

async function sendMessage(contactName, messageText) {
  ensureReady();
  if (!messageText || !String(messageText).trim()) throw new Error('Message is empty.');
  log(`Send request → "${contactName}"`);
  const { id, label } = await resolveChatId(contactName);
  lastSentMessage = await withTimeout(client.sendMessage(id, String(messageText)), 30000, 'Sending');
  log(`Sent message to ${label}`);
  return `Message sent to ${label} on WhatsApp.`;
}

async function sendFileToSelf(filePath, caption) {
  ensureReady();
  const { MessageMedia } = require('whatsapp-web.js');
  const media = MessageMedia.fromFilePath(filePath);
  await withTimeout(
    client.sendMessage(client.info.wid._serialized, media, { sendMediaAsDocument: true, caption }),
    60000,
    'Sending file'
  );
  return 'File sent to your own WhatsApp chat.';
}

async function deleteLastWhatsAppMessage() {
  ensureReady();
  if (!lastSentMessage) throw new Error('No recent message to delete.');
  await lastSentMessage.delete(true); // delete for everyone
  lastSentMessage = null;
  return 'Message deleted for everyone.';
}

function getWhatsAppState() {
  return {
    ...status,
    // legacy field names used by older UI code
    state: status.state === 'ready' ? 'connected' : status.state,
    rawState: status.state,
  };
}

module.exports = {
  initWhatsApp,
  restartWhatsApp,
  resetWhatsAppSession,
  logoutWhatsApp,
  shutdownWhatsApp,
  sendMessage,
  sendFileToSelf,
  deleteLastWhatsAppMessage,
  getWhatsAppState,
};
