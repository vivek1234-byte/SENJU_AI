/**
 * SENJU Booking Agent (IRCTC)
 * ---------------------------
 * Drives a VISIBLE Chrome window (puppeteer) through the IRCTC booking flow:
 * search → pick train/class/date → Book Now → passenger details → Continue,
 * and hands over to the user at the review/captcha/payment step.
 *
 * The steps are decided by the AI from a snapshot of the page (interactive
 * elements + visible text), so small layout changes don't break it.
 *
 * Hard limits (by design, not configurable):
 *   - never types into password / captcha / OTP fields → asks the user
 *   - never clicks Pay / Make Payment
 *   - quota is always GENERAL (no Tatkal automation)
 *   - one booking session at a time, max 60 steps
 */

const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, '..', 'booking-profile');
const LOG_FILE = path.join(__dirname, '..', 'booking-agent.log');
const IRCTC_URL = 'https://www.irctc.co.in/nget/train-search';
const MAX_STEPS = 60;
const STEP_MODEL = 'openai/gpt-oss-120b';
const STEP_MODEL_FALLBACK = 'openai/gpt-oss-20b';

const BERTHS = { LB: 'Lower', MB: 'Middle', UB: 'Upper', SL: 'Side Lower', SU: 'Side Upper', NP: 'No Preference', WS: 'Window Side' };

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 400 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) { /* ignore */ }
  console.log('[BookingAgent]', line);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs inside the page: tag interactive elements and describe them. */
function pageSnapshot() {
  const MAX = 160;
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight * 3 && r.left < innerWidth;
  };
  const txt = (el) => {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 90);
  };
  document.querySelectorAll('[data-senju-idx]').forEach((el) => el.removeAttribute('data-senju-idx'));
  const base = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"], [role="option"], [role="link"], [role="radio"], [role="checkbox"], [role="menuitem"], [onclick], label, li, td, span, div, p-dropdown, p-calendar, p-autocomplete'));
  const items = [];
  const seen = new Set();
  for (const el of base) {
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const native = ['a', 'button', 'input', 'select', 'textarea'].includes(tag);
    const clickable = native || el.hasAttribute('role') || el.hasAttribute('onclick') || cs.cursor === 'pointer' || el.hasAttribute('tabindex');
    if (!clickable) continue;
    // skip wrappers whose only purpose is to contain another clickable element with the same text
    if (!native && el.querySelector('a, button, input, select, textarea')) {
      const inner = el.querySelector('a, button, input, select, textarea');
      if (txt(inner) === txt(el)) continue;
    }
    if (tag === 'input' && ['hidden'].includes(el.type)) continue;
    const label = txt(el);
    const key = `${tag}|${label}|${el.getAttribute('formcontrolname') || el.name || el.id || ''}|${Math.round(el.getBoundingClientRect().top)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ el, tag, label });
    if (items.length >= MAX * 2) break;
  }
  // in-viewport items first
  items.sort((a, b) => {
    const ra = a.el.getBoundingClientRect(), rb = b.el.getBoundingClientRect();
    const ia = ra.top >= 0 && ra.top < innerHeight ? 0 : 1, ib = rb.top >= 0 && rb.top < innerHeight ? 0 : 1;
    return ia - ib || ra.top - rb.top || ra.left - rb.left;
  });
  const out = [];
  items.slice(0, MAX).forEach((it, i) => {
    it.el.setAttribute('data-senju-idx', String(i));
    const el = it.el;
    const d = { i, tag: it.tag, text: it.label };
    if (it.tag === 'input') { d.type = el.type; if (el.value) d.value = String(el.value).slice(0, 40); if (el.checked) d.checked = true; }
    if (it.tag === 'select') { d.value = el.options[el.selectedIndex]?.text?.slice(0, 40); d.options = Array.from(el.options).slice(0, 25).map((o) => o.text.trim().slice(0, 40)); }
    const ph = el.getAttribute('placeholder'); if (ph) d.placeholder = ph.slice(0, 40);
    const fc = el.getAttribute('formcontrolname') || el.getAttribute('name'); if (fc) d.name = fc.slice(0, 40);
    if (el.id) d.id = el.id.slice(0, 40);
    if (el.disabled) d.disabled = true;
    if (el.getAttribute('aria-selected') === 'true' || el.classList.contains('active') || el.classList.contains('selected')) d.selected = true;
    out.push(d);
  });
  const modal = document.querySelector('.ui-dialog:not([style*="display: none"]), .p-dialog, [role="dialog"], .modal.show');
  return {
    url: location.href,
    title: document.title,
    modalOpen: !!modal && isVisible(modal),
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 2500),
    elements: out,
  };
}

class BookingAgent {
  /**
   * @param {object} store electron-store
   * @param {object} deps { getApiKey: () => string, notify?: (title, body) => void }
   */
  constructor(store, deps = {}) {
    this.store = store;
    this.deps = deps;
    this.window = null;
    this.browser = null;
    this.page = null;
    this.session = null; // { id, state, message, step, job, startedAt, history: [] }
    this.cancelRequested = false;
  }

  start(win) { this.window = win; }

  // ── travellers ─────────────────────────────────────────
  getTravellers() { return this.store.get('travellers', []); }
  saveTravellers(list) { this.store.set('travellers', list); return list; }

  addTraveller(t) {
    const name = String(t.name || '').trim();
    const age = parseInt(t.age, 10);
    const gender = String(t.gender || '').trim().toUpperCase().slice(0, 1);
    if (!name || name.length < 2) throw new Error('Traveller name is required.');
    if (!(age >= 1 && age <= 120)) throw new Error('Traveller age must be 1–120.');
    if (!['M', 'F', 'T'].includes(gender)) throw new Error('Gender must be M, F or T.');
    const berth = String(t.berth || 'NP').toUpperCase();
    const list = this.getTravellers();
    const existing = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const rec = {
      id: existing ? existing.id : `t_${Date.now().toString(36)}`,
      name, age, gender,
      berth: BERTHS[berth] ? berth : 'NP',
      nationality: 'Indian',
      alias: String(t.alias || '').trim().toLowerCase(),
      isSelf: !!t.isSelf || /^(me|myself|self|main|mai)$/i.test(String(t.alias || '')),
      food: t.food || '',
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };
    const out = existing ? list.map((x) => (x.id === rec.id ? rec : x)) : [...list, rec];
    this.saveTravellers(out);
    return rec;
  }

  removeTraveller(idOrName) {
    const q = String(idOrName || '').toLowerCase();
    const list = this.getTravellers();
    const kept = list.filter((x) => x.id !== idOrName && x.name.toLowerCase() !== q);
    this.saveTravellers(kept);
    return { removed: list.length - kept.length };
  }

  resolveTravellers(names) {
    const list = this.getTravellers();
    if (!names || !names.length) return list.filter((t) => t.isSelf).length ? list.filter((t) => t.isSelf) : list.slice(0, 1);
    const out = [];
    for (const n of names) {
      const q = String(n).toLowerCase().trim();
      const hit = list.find((t) => t.name.toLowerCase() === q)
        || list.find((t) => t.alias && t.alias === q)
        || list.find((t) => t.name.toLowerCase().split(/\s+/)[0] === q)
        || (/(me|myself|self|main|mai|mujhe|khud)/.test(q) ? list.find((t) => t.isSelf) : null)
        || list.find((t) => t.name.toLowerCase().includes(q));
      if (!hit) throw new Error(`No saved traveller matches "${n}". Add them first (name, age, gender, berth).`);
      if (!out.includes(hit)) out.push(hit);
    }
    return out;
  }

  // ── status ─────────────────────────────────────────────
  getStatus() {
    const s = this.session;
    if (!s) return { state: 'idle' };
    return { id: s.id, state: s.state, message: s.message, step: s.step, job: s.job, startedAt: s.startedAt, history: s.history.slice(-12) };
  }

  setState(state, message, extra = {}) {
    if (!this.session) return;
    this.session.state = state;
    this.session.message = message;
    Object.assign(this.session, extra);
    log(`state=${state}: ${message}`);
    this.emit('booking-status', this.getStatus());
    if (['need_user', 'handoff', 'error', 'done'].includes(state)) this.notify(state === 'error' ? 'Booking agent stopped' : 'Booking agent needs you', message);
  }

  emit(channel, payload) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload);
  }

  notify(title, body) {
    try {
      const { Notification } = require('electron');
      const n = new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'senju-icon.ico') });
      n.on('click', () => this.bringToFront());
      n.show();
    } catch (_) { /* ignore */ }
    if (this.deps.notify) { try { this.deps.notify(title, body); } catch (_) { /* ignore */ } }
  }

  async bringToFront() {
    try { if (this.page) await this.page.bringToFront(); } catch (_) { /* ignore */ }
  }

  // ── main entry ─────────────────────────────────────────
  /**
   * @param {object} job { from, to, date (YYYY-MM-DD), cls, trainNo, trainName, travellers: [names], mobile, upiOnly }
   */
  async book(job) {
    if (this.session && ['running', 'need_user'].includes(this.session.state)) {
      throw new Error(`A booking is already in progress (${this.session.message}). Cancel it first or let it finish.`);
    }
    const apiKey = this.deps.getApiKey ? this.deps.getApiKey() : '';
    if (!apiKey) throw new Error('Groq API key missing — the booking agent needs it to read the page.');
    const travellers = this.resolveTravellers(job.travellers);
    if (!travellers.length) throw new Error('No travellers saved. Add at least one (name, age, gender, berth preference).');
    const mobile = String(job.mobile || (this.store.get('settings') || {}).bookingMobile || '').replace(/\D/g, '');

    const jobInfo = { ...job, travellers: travellers.map((t) => ({ name: t.name, age: t.age, gender: t.gender, berth: t.berth })), mobile, quota: 'GENERAL' };
    this.session = { id: `b_${Date.now().toString(36)}`, state: 'running', message: 'Opening IRCTC…', step: 0, job: jobInfo, startedAt: new Date().toISOString(), history: [] };
    this.cancelRequested = false;
    this.emit('booking-status', this.getStatus());

    // run in background; callers poll status / get events
    this._run(jobInfo, apiKey).catch((e) => {
      log('run failed:', e);
      this.setState('error', `Agent stopped: ${e.message}`);
    });
    return this.getStatus();
  }

  async cancel() {
    this.cancelRequested = true;
    if (this.session && ['running', 'need_user'].includes(this.session.state)) this.setState('cancelled', 'Cancelled by Vivek.');
    return this.getStatus();
  }

  async closeBrowser() {
    try { if (this.browser) await this.browser.close(); } catch (_) { /* ignore */ }
    this.browser = null; this.page = null;
  }

  async openBrowser() {
    if (this.browser && this.browser.connected) {
      try { this.page = (await this.browser.pages())[0] || (await this.browser.newPage()); return; } catch (_) { /* relaunch */ }
    }
    const puppeteer = require('puppeteer');
    try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (_) { /* ignore */ }
    this.browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: PROFILE_DIR,
      args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled',
        '--disable-infobars', '--disable-extensions', '--no-sandbox', '--disable-dev-shm-usage'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    this.browser.on('disconnected', () => {
      this.browser = null; this.page = null;
      if (this.session && ['running', 'need_user'].includes(this.session.state)) this.setState('error', 'Browser window was closed.');
    });
    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = window.chrome || { runtime: {} };
    });
    this.page.on('dialog', (d) => { log('dialog:', d.message()); d.accept().catch(() => {}); });
  }

  // ── the loop ───────────────────────────────────────────
  async _run(job, apiKey) {
    await this.openBrowser();
    const page = this.page;
    this.setState('running', 'Opening IRCTC…');
    await page.goto(IRCTC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('goto warn:', e.message));
    await sleep(2500);

    let sameCount = 0;
    let lastActionKey = '';
    let waitingSince = 0;

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (this.cancelRequested) return;
      this.session.step = step;

      const snap = await page.evaluate(pageSnapshot).catch((e) => { log('snapshot failed:', e.message); return null; });
      if (!snap) { await sleep(1500); continue; }

      const phase = this.detectPhase(snap);
      if (phase === 'handoff') {
        await this.bringToFront();
        this.setState('handoff', 'Review page ready — captcha bharo, check karo aur payment complete karo. Baaki sab bhar diya hai.');
        return;
      }
      if (phase === 'payment') {
        await this.bringToFront();
        this.setState('handoff', 'Payment page open hai — ab aap pay karo. Agent ka kaam yahan khatam.');
        return;
      }
      if (phase === 'login') {
        if (this.session.state !== 'need_user') {
          await this.bringToFront();
          this.setState('need_user', 'IRCTC login chahiye — Chrome window mein user ID, password aur captcha daalo. Login hote hi main aage badhungi.');
          waitingSince = Date.now();
        }
        if (Date.now() - waitingSince > 6 * 60 * 1000) { this.setState('error', 'Login ka 6 minute wait ho gaya. Dobara "book karo" bolna.'); return; }
        await sleep(2500);
        step--; // waiting doesn't consume steps
        continue;
      }
      if (this.session.state === 'need_user') this.setState('running', 'Login mil gaya — aage badh rahi hu…');

      const action = await this.decide(snap, job, apiKey);
      log(`step ${step}:`, action);
      if (!action || !action.action) { await sleep(1500); continue; }

      if (action.action === 'done') {
        await this.bringToFront();
        this.setState('handoff', action.reason || 'Agent ne apna hissa poora kar diya — ab aap check karke pay karo.');
        return;
      }
      if (action.action === 'need_user') {
        await this.bringToFront();
        this.setState('need_user', action.reason || 'Aapki madad chahiye — Chrome window dekho.');
        waitingSince = Date.now();
        // wait for the page to change, then continue
        const before = snap.text.slice(0, 400);
        for (let w = 0; w < 120; w++) {
          await sleep(2500);
          if (this.cancelRequested) return;
          const s2 = await page.evaluate(pageSnapshot).catch(() => null);
          if (s2 && s2.text.slice(0, 400) !== before) break;
        }
        this.setState('running', 'Aage badh rahi hu…');
        continue;
      }

      // loop protection
      const key = `${action.action}|${action.index}|${action.text || ''}`;
      sameCount = key === lastActionKey ? sameCount + 1 : 0;
      lastActionKey = key;
      if (sameCount >= 3) {
        log('same action repeated, scrolling instead');
        await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
        this.session.history.push({ step, action: 'scroll', reason: 'loop protection' });
        await sleep(800);
        continue;
      }

      const ok = await this.perform(page, snap, action);
      this.session.history.push({ step, action: action.action, target: action.index != null ? (snap.elements[action.index] || {}).text : '', text: action.text, reason: action.reason, ok });
      this.setState('running', action.reason || `${action.action}…`);
      await sleep(action.action === 'click' ? 1800 : 700);
    }
    this.setState('error', `Step limit (${MAX_STEPS}) reached — please finish in the Chrome window.`);
  }

  detectPhase(snap) {
    const t = snap.text.toLowerCase();
    const url = snap.url.toLowerCase();
    const hasPassword = snap.elements.some((e) => e.tag === 'input' && e.type === 'password');
    if (hasPassword) return 'login';
    if (url.includes('/payment') || /payment methods|select payment|pay & book|pay and book|make payment|net banking|debit card/.test(t) && !/passenger name/.test(t)) return 'payment';
    const captchaField = snap.elements.some((e) => e.tag === 'input' && /captcha/i.test(`${e.id || ''} ${e.name || ''} ${e.placeholder || ''} ${e.text || ''}`));
    if (captchaField && /review|total fare|passenger details|journey details/.test(t) && !hasPassword) return 'handoff';
    return null;
  }

  async decide(snap, job, apiKey) {
    const hist = this.session.history.slice(-8).map((h) => `${h.step}: ${h.action}${h.target ? ` "${h.target}"` : ''}${h.text ? ` text="${h.text}"` : ''}${h.ok === false ? ' (failed)' : ''}`).join('\n') || '(none yet)';
    const pax = job.travellers.map((t, i) => `${i + 1}. ${t.name}, age ${t.age}, ${t.gender === 'M' ? 'Male' : t.gender === 'F' ? 'Female' : 'Transgender'}, berth ${BERTHS[t.berth] || 'No Preference'}`).join('\n');
    const system = `You are SENJU's booking agent controlling a Chrome browser on IRCTC (www.irctc.co.in) for the user. Your job ends BEFORE payment.
GOAL
- Journey: ${job.from} → ${job.to} on ${job.date} (YYYY-MM-DD). Class: ${job.cls}. Quota: GENERAL (never Tatkal/Premium Tatkal).
- Train: ${job.trainNo ? `${job.trainNo} ${job.trainName || ''}`.trim() : 'the cheapest suitable train with availability in that class'}.
- Passengers:\n${pax}
- Mobile number for booking: ${job.mobile || '(leave as prefilled)'}
- Payment preference: ${job.upiOnly ? 'select "Pay through BHIM/UPI" if such option exists' : 'leave default'}.
FLOW ON IRCTC
1. Home/search page: type origin station in the From box, pick the matching suggestion; same for To; set the journey date (type it as DD/MM/YYYY or use the calendar); choose the class and General quota; click Search.
2. Train list: find the train card; click its class tab (e.g. "AC 3 Tier (3A)"); click the availability cell for the journey date; click "Book Now". If a login popup appears, return need_user.
3. Passenger details page: fill each passenger's Name, Age, Gender, Berth preference. Use "+ Add Passenger" for extra passengers. Fill mobile if empty. Do not tick insurance/auto-upgrade unless already ticked. Then click "Continue".
4. Review page (shows fare + a captcha box) or the payment page: return done.
RULES
- NEVER type into password, captcha or OTP fields, never click Pay/Make Payment — return need_user or done instead.
- If a dialog/alert with OK/Confirm appears, click it. If a "session expired" message appears, click OK and continue from the search page.
- If nothing useful is visible, use scroll. Do one action per turn. Prefer exact text matches.
Return ONLY JSON: {"action":"click|type|select|press|scroll|wait|done|need_user","index":<element i>,"text":"<text to type or option to select>","key":"Enter|Tab|ArrowDown|Escape","reason":"<short human-readable status line in Hinglish>"}`;

    const elements = snap.elements.map((e) => {
      const bits = [`#${e.i} <${e.tag}${e.type ? ' ' + e.type : ''}>`];
      if (e.text) bits.push(JSON.stringify(e.text));
      if (e.placeholder) bits.push(`placeholder=${JSON.stringify(e.placeholder)}`);
      if (e.name) bits.push(`name=${e.name}`);
      if (e.id) bits.push(`id=${e.id}`);
      if (e.value) bits.push(`value=${JSON.stringify(e.value)}`);
      if (e.options) bits.push(`options=[${e.options.join('|')}]`);
      if (e.checked) bits.push('checked');
      if (e.selected) bits.push('selected');
      if (e.disabled) bits.push('disabled');
      return bits.join(' ');
    }).join('\n');

    const user = `URL: ${snap.url}\nTITLE: ${snap.title}${snap.modalOpen ? '\nA MODAL/DIALOG IS OPEN — act inside it first.' : ''}\nRECENT ACTIONS:\n${hist}\n\nPAGE TEXT (trimmed):\n${snap.text.slice(0, 1800)}\n\nINTERACTIVE ELEMENTS:\n${elements}`;

    const ask = async (model) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 40000);
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, temperature: 0, reasoning_effort: 'low', max_tokens: 300,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
        return JSON.parse(data.choices?.[0]?.message?.content || '{}');
      } finally { clearTimeout(t); }
    };
    try { return await ask(STEP_MODEL); }
    catch (e) { log('decide fallback:', e.message); return ask(STEP_MODEL_FALLBACK); }
  }

  async perform(page, snap, action) {
    const idx = Number.isInteger(action.index) ? action.index : parseInt(action.index, 10);
    const el = snap.elements[idx];
    const sel = `[data-senju-idx="${idx}"]`;
    try {
      switch (action.action) {
        case 'scroll':
          await page.evaluate(() => window.scrollBy(0, Math.round(innerHeight * 0.7)));
          return true;
        case 'wait':
          await sleep(2000);
          return true;
        case 'press':
          await page.keyboard.press(action.key || 'Enter');
          return true;
        case 'click': {
          if (!el) return false;
          if (this.isForbiddenClick(el)) { log('blocked click on', el.text); return false; }
          await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
          await sleep(200);
          try { await page.click(sel, { delay: 40 }); }
          catch { await page.evaluate((s) => document.querySelector(s)?.click(), sel); }
          return true;
        }
        case 'type': {
          if (!el) return false;
          if (this.isForbiddenField(el)) { log('blocked typing into', el); return false; }
          const text = String(action.text ?? '');
          if (/tatkal/i.test(text)) return false;
          await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);
          await page.click(sel, { clickCount: 3, delay: 30 }).catch(() => {});
          await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          await page.type(sel, text, { delay: 45 });
          if (action.key) { await sleep(800); await page.keyboard.press(action.key); }
          return true;
        }
        case 'select': {
          if (!el) return false;
          const want = String(action.text || '').toLowerCase();
          if (/tatkal/.test(want)) return false;
          if (el.tag === 'select') {
            const value = await page.evaluate((s, w) => {
              const node = document.querySelector(s);
              if (!node) return null;
              const opt = Array.from(node.options).find((o) => o.text.trim().toLowerCase() === w) || Array.from(node.options).find((o) => o.text.trim().toLowerCase().includes(w));
              if (!opt) return null;
              node.value = opt.value;
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
              return opt.value;
            }, sel, want);
            return value != null;
          }
          // custom dropdown: click it, then click the option by text
          await page.click(sel).catch(() => page.evaluate((s) => document.querySelector(s)?.click(), sel));
          await sleep(600);
          const clicked = await page.evaluate((w) => {
            const opts = Array.from(document.querySelectorAll('li, [role="option"], .ui-dropdown-item, .p-dropdown-item, .ui-autocomplete-list-item'));
            const hit = opts.find((o) => o.innerText.trim().toLowerCase() === w) || opts.find((o) => o.innerText.trim().toLowerCase().includes(w));
            if (hit) { hit.click(); return true; }
            return false;
          }, want);
          return clicked;
        }
        default:
          return false;
      }
    } catch (e) {
      log('perform failed:', action, e.message);
      return false;
    }
  }

  isForbiddenField(el) {
    const s = `${el.type || ''} ${el.id || ''} ${el.name || ''} ${el.placeholder || ''} ${el.text || ''}`.toLowerCase();
    return el.type === 'password' || /captcha|otp|password|cvv|card number|expiry|upi pin|mpin/.test(s);
  }

  isForbiddenClick(el) {
    const s = `${el.text || ''} ${el.id || ''} ${el.name || ''}`.toLowerCase();
    return /^(pay|pay now|make payment|pay & book|pay and book|proceed to pay|confirm payment)\b/.test(s.trim()) || /tatkal/.test(s);
  }
}

module.exports = { BookingAgent, BERTHS };
