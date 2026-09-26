/**
 * SENJU Attendance Tracker
 * ------------------------
 * - After each class in the timetable ends, asks "Did you attend?" (in-app card + Windows notification)
 * - Keeps per-subject attendance % and tells you how many classes you can still miss
 *   (or must attend) to stay above your target (default 75%)
 * - Works fully offline; data lives in electron-store under "attendance"
 */

const { Notification } = require('electron');
const path = require('path');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NOT_TRACKED_CATEGORIES = ['personal', 'health'];
const pad = (n) => String(n).padStart(2, '0');

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function subjectKey(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

class AttendanceManager {
  constructor(store, timetableManager) {
    this.store = store;
    this.timetable = timetableManager;
    this.window = null;
    this.interval = null;
  }

  // ── storage ─────────────────────────────────────────────
  _data() {
    let d = this.store.get('attendance', {});
    // Migrate the older counter-style data ([{subject, attended, total}]) into dated records
    if (Array.isArray(d)) {
      const records = [];
      let back = 1;
      for (const row of d) {
        const total = Number(row.total) || 0;
        const attended = Math.min(total, Number(row.attended) || 0);
        for (let i = 0; i < total; i++) {
          const day = new Date(Date.now() - back++ * 864e5);
          records.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            subject: String(row.subject || 'Unknown').trim(),
            date: dateKey(day),
            startTime: '',
            entryId: null,
            status: i < attended ? 'present' : 'absent',
            markedAt: new Date().toISOString(),
            imported: true,
          });
        }
      }
      d = { records, target: 75, ignored: [], prompted: {} };
      this.store.set('attendance', d);
      console.log(`[Attendance] Imported ${records.length} classes from the previous tracker.`);
    }
    return {
      records: Array.isArray(d.records) ? d.records : [],
      // college-portal totals per subject — independent of the day-to-day marks below
      baseline: d.baseline && typeof d.baseline === 'object' ? d.baseline : {},
      // deleted marks, kept so a mistaken delete can be undone
      trash: Array.isArray(d.trash) ? d.trash : [],
      // classes before this date are already covered by the portal baseline
      trackFrom: typeof d.trackFrom === 'string' ? d.trackFrom : '',
      target: Number(d.target) || 75,
      ignored: Array.isArray(d.ignored) ? d.ignored : [],
      prompted: d.prompted && typeof d.prompted === 'object' ? d.prompted : {},
    };
  }
  _save(d) {
    this.store.set('attendance', d);
  }

  // ── tracked classes ─────────────────────────────────────
  isTracked(entry, data = this._data()) {
    if (!entry || !entry.title) return false;
    if (NOT_TRACKED_CATEGORIES.includes(entry.category)) return false;
    return !data.ignored.includes(subjectKey(entry.title));
  }

  /** Classes that already ended (today + previous days) and have no attendance mark yet. */
  getPending(daysBack = 2, now = new Date()) {
    const data = this._data();
    const entries = this.timetable.getAll();
    const pending = [];
    for (let back = 0; back <= daysBack; back++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const dk = dateKey(day);
      const weekday = DAYS[day.getDay()];
      for (const e of entries) {
        if (e.day !== weekday || !this.isTracked(e, data)) continue;
        // skip anything already counted in the portal totals
        if (data.trackFrom && dk < data.trackFrom) continue;
        // don't ask about classes from before the entry existed
        if (e.createdAt && new Date(e.createdAt) > new Date(`${dk}T${e.endTime}`)) continue;
        if (back === 0 && toMinutes(e.endTime) > now.getHours() * 60 + now.getMinutes()) continue;
        const marked = data.records.some(
          (r) => r.date === dk && (r.entryId === e.id || subjectKey(r.subject) === subjectKey(e.title)) && r.startTime === e.startTime
        );
        if (!marked) pending.push({ entryId: e.id, subject: e.title, date: dk, startTime: e.startTime, endTime: e.endTime, block: e.block || '', room: e.room || '' });
      }
    }
    return pending.sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
  }

  // ── marking ─────────────────────────────────────────────
  mark({ subject, date, status, entryId = null, startTime = '' }) {
    if (!['present', 'absent', 'cancelled'].includes(status)) throw new Error('status must be present, absent or cancelled');
    if (!subject) throw new Error('subject is required');
    const d = this._data();
    const dk = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : dateKey(new Date());

    // If no startTime given, use today's timetable slot for that subject (when there is one)
    if (!startTime) {
      const weekday = DAYS[new Date(`${dk}T12:00`).getDay()];
      const slot = this.timetable.getAll().find((e) => e.day === weekday && subjectKey(e.title) === subjectKey(subject));
      if (slot) { startTime = slot.startTime; entryId = entryId || slot.id; subject = slot.title; }
    }

    const idx = d.records.findIndex(
      (r) => r.date === dk && subjectKey(r.subject) === subjectKey(subject) && (r.startTime || '') === (startTime || '')
    );
    const rec = {
      id: idx >= 0 ? d.records[idx].id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      subject: String(subject).trim(),
      date: dk,
      startTime: startTime || '',
      entryId,
      status,
      markedAt: new Date().toISOString(),
    };
    if (idx >= 0) d.records[idx] = rec; else d.records.push(rec);
    this._save(d);
    this._broadcast();
    return { record: rec, stats: this.getSubjectStats(rec.subject) };
  }

  deleteRecord(id) {
    const d = this._data();
    const rec = d.records.find((r) => r.id === id);
    if (!rec) return false;
    d.records = d.records.filter((r) => r.id !== id);
    d.trash = [{ ...rec, deletedAt: new Date().toISOString() }, ...d.trash].slice(0, 50);
    this._save(d);
    this._broadcast();
    return true;
  }

  /** Put a deleted mark back. */
  restoreRecord(id) {
    const d = this._data();
    const rec = d.trash.find((r) => r.id === id);
    if (!rec) return null;
    d.trash = d.trash.filter((r) => r.id !== id);
    delete rec.deletedAt;
    if (!d.records.some((r) => r.id === rec.id)) d.records.push(rec);
    this._save(d);
    this._broadcast();
    return rec;
  }

  restoreAll() {
    const d = this._data();
    const back = d.trash.length;
    for (const rec of d.trash) {
      delete rec.deletedAt;
      if (!d.records.some((r) => r.id === rec.id)) d.records.push(rec);
    }
    d.trash = [];
    this._save(d);
    this._broadcast();
    return back;
  }

  clearTrash() {
    const d = this._data();
    d.trash = [];
    this._save(d);
    this._broadcast();
    return true;
  }

  /**
   * College-portal totals for a subject. These are kept separately from the marks
   * list, so deleting a mark never changes the imported figures.
   */
  setBaseline(subject, { held, attended, code = '' } = {}) {
    const d = this._data();
    const k = subjectKey(subject);
    const h = Math.max(0, Math.round(Number(held) || 0));
    const a = Math.min(h, Math.max(0, Math.round(Number(attended) || 0)));
    d.baseline[k] = { subject: String(subject).trim(), code, held: h, attended: a, updatedAt: new Date().toISOString() };
    this._save(d);
    this._broadcast();
    return d.baseline[k];
  }

  getBaseline(subject) {
    return this._data().baseline[subjectKey(subject)] || null;
  }

  /** Start counting classes from this date (YYYY-MM-DD). Earlier ones are the portal's job. */
  setTrackFrom(date) {
    const d = this._data();
    d.trackFrom = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : '';
    this._save(d);
    this._broadcast();
    return d.trackFrom;
  }

  setTarget(target) {
    const t = Math.min(100, Math.max(1, Math.round(Number(target) || 75)));
    const d = this._data();
    d.target = t;
    this._save(d);
    this._broadcast();
    return t;
  }

  toggleIgnore(subject) {
    const d = this._data();
    const k = subjectKey(subject);
    d.ignored = d.ignored.includes(k) ? d.ignored.filter((x) => x !== k) : [...d.ignored, k];
    this._save(d);
    this._broadcast();
    return !d.ignored.includes(k);
  }

  // ── stats ───────────────────────────────────────────────
  _statsFor(subject, records, target, baseline = {}) {
    const mine = records.filter((r) => subjectKey(r.subject) === subjectKey(subject));
    const base = baseline[subjectKey(subject)] || { held: 0, attended: 0 };
    const markedPresent = mine.filter((r) => r.status === 'present').length;
    const markedAbsent = mine.filter((r) => r.status === 'absent').length;
    const cancelled = mine.filter((r) => r.status === 'cancelled').length;
    // portal figures + what you marked in SENJU
    const present = base.attended + markedPresent;
    const absent = (base.held - base.attended) + markedAbsent;
    const total = present + absent;
    const t = target / 100;
    const pct = total ? Math.round((present / total) * 1000) / 10 : null;
    let canMiss = 0;
    let mustAttend = 0;
    if (total) {
      if (present / total >= t) canMiss = t >= 1 ? 0 : Math.max(0, Math.floor(present / t - total + 1e-9));
      else mustAttend = t >= 1 ? Infinity : Math.ceil((t * total - present) / (1 - t) - 1e-9);
    }
    let advice;
    if (!total) advice = 'No classes marked yet';
    else if (mustAttend) advice = `Attend the next ${mustAttend} class${mustAttend === 1 ? '' : 'es'} to reach ${target}%`;
    else if (canMiss) advice = `Safe — you can miss ${canMiss} more class${canMiss === 1 ? '' : 'es'}`;
    else advice = `On the edge — don't miss the next class`;
    const level = !total ? 'none' : mustAttend ? 'danger' : canMiss <= 1 ? 'warning' : 'good';
    return {
      subject: (base.subject || (mine[0] && mine[0].subject) || subject),
      code: base.code || (mine[0] && mine[0].code) || '',
      present, absent, cancelled, total, pct, canMiss, mustAttend, advice, level,
      baseline: { held: base.held, attended: base.attended },
      marked: { present: markedPresent, absent: markedAbsent, cancelled },
    };
  }

  getSubjectStats(subject) {
    const d = this._data();
    return this._statsFor(subject, d.records, d.target, d.baseline);
  }

  getOverview() {
    const d = this._data();
    const names = new Map();
    for (const e of this.timetable.getAll()) {
      if (!NOT_TRACKED_CATEGORIES.includes(e.category)) names.set(subjectKey(e.title), e.title);
    }
    for (const b of Object.values(d.baseline)) if (!names.has(subjectKey(b.subject))) names.set(subjectKey(b.subject), b.subject);
    for (const r of d.records) if (!names.has(subjectKey(r.subject))) names.set(subjectKey(r.subject), r.subject);

    const subjects = [...names.entries()]
      .filter(([k]) => !d.ignored.includes(k))
      .map(([, name]) => this._statsFor(name, d.records, d.target, d.baseline))
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));

    const totals = subjects.reduce((acc, s) => ({ present: acc.present + s.present, total: acc.total + s.total }), { present: 0, total: 0 });
    return {
      target: d.target,
      trackFrom: d.trackFrom,
      overallPct: totals.total ? Math.round((totals.present / totals.total) * 1000) / 10 : null,
      subjects,
      ignored: [...names.entries()].filter(([k]) => d.ignored.includes(k)).map(([, n]) => n),
      pending: this.getPending(),
      recent: [...d.records].sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime)).slice(0, 30),
      trash: [...d.trash].slice(0, 20),
    };
  }

  // ── scheduler: ask after each class ─────────────────────
  start(win) {
    this.window = win;
    if (this.interval) return;
    setTimeout(() => this.check(), 15000); // first check shortly after startup
    this.interval = setInterval(() => this.check(), 60 * 1000);
  }
  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  check() {
    if (this.store.get('settings.attendancePrompts') === false) return;
    const now = new Date();
    const d = this._data();
    const today = dateKey(now);
    // keep prompted keys for 3 days only
    for (const k of Object.keys(d.prompted)) if (k.slice(0, 10) < dateKey(new Date(now - 3 * 864e5))) delete d.prompted[k];

    const toAsk = this.getPending(0, now).filter((p) => {
      const key = `${p.date}|${p.entryId}|${p.startTime}`;
      const minsSinceEnd = now.getHours() * 60 + now.getMinutes() - toMinutes(p.endTime);
      return p.date === today && !d.prompted[key] && minsSinceEnd >= 1 && minsSinceEnd <= 12 * 60;
    });
    if (!toAsk.length) return;

    for (const p of toAsk) d.prompted[`${p.date}|${p.entryId}|${p.startTime}`] = true;
    this._save(d);

    // Ask about the most recent class first; others appear in the pending list
    const p = [...toAsk].sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
    const stats = this.getSubjectStats(p.subject);
    try {
      const n = new Notification({
        title: `📋 Did you attend ${p.subject}?`,
        body: `${p.startTime}–${p.endTime}${stats.pct != null ? ` • currently ${stats.pct}%` : ''}\nOpen SENJU to mark it.`,
        icon: path.join(__dirname, '..', 'assets', 'senju-icon.ico'),
      });
      n.on('click', () => { if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); } });
      n.show();
    } catch (_) { /* ignore */ }
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('attendance-prompt', { ...p, stats, others: toAsk.length - 1 });
    }
  }

  _broadcast() {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('academics-updated', 'attendance');
  }
}

module.exports = AttendanceManager;
