/**
 * SENJU Exam Countdown + Study Planner
 * ------------------------------------
 * - Keeps your exams with dates and topics
 * - Builds a day-by-day study plan in the free gaps of your timetable
 *   (weighted by how close each exam is and how much is left to cover)
 * - Reminds you every morning, and 5 minutes before each study session
 * - Everything is local; data lives in electron-store under "exams" / "studyPlan"
 */

const { Notification } = require('electron');
const path = require('path');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n) => String(n).padStart(2, '0');

const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const parseDay = (dk) => new Date(`${dk}T12:00:00`);
const daysBetween = (aKey, bKey) => Math.round((parseDay(bKey) - parseDay(aKey)) / 864e5);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const DEFAULTS = {
  dayStart: '07:00',
  dayEnd: '22:00',
  sessionMinutes: 60,
  breakMinutes: 15,
  maxSessionsPerDay: 3,
  reminderTime: '08:00',
};

class StudyPlanner {
  constructor(store, timetableManager) {
    this.store = store;
    this.timetable = timetableManager;
    this.window = null;
    this.interval = null;
  }

  // ── settings ────────────────────────────────────────────
  settings() {
    const s = this.store.get('settings', {});
    const st = s.study || {};
    const out = { ...DEFAULTS, ...st };
    out.sessionMinutes = Math.min(180, Math.max(20, Number(out.sessionMinutes) || 60));
    out.maxSessionsPerDay = Math.min(8, Math.max(1, Number(out.maxSessionsPerDay) || 3));
    out.breakMinutes = Math.min(60, Math.max(0, Number(out.breakMinutes) || 15));
    return out;
  }

  saveSettings(patch = {}) {
    const s = this.store.get('settings', {});
    s.study = { ...this.settings(), ...patch };
    this.store.set('settings', s);
    this.generatePlan();
    return s.study;
  }

  // ── exams ───────────────────────────────────────────────
  getExams() {
    const list = this.store.get('exams', []);
    return (Array.isArray(list) ? list : []).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  }

  addExam({ subject, date, time = '', topics = [], difficulty = 2, note = '' }) {
    if (!subject || !String(subject).trim()) throw new Error('subject is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('date must be YYYY-MM-DD');
    const exam = {
      id: newId(),
      subject: String(subject).trim(),
      date,
      time: /^\d{2}:\d{2}$/.test(time) ? time : '',
      topics: this._cleanTopics(topics),
      difficulty: Math.min(3, Math.max(1, Number(difficulty) || 2)),
      note: String(note || '').trim(),
      createdAt: new Date().toISOString(),
    };
    this.store.set('exams', [...this.getExams(), exam]);
    this.generatePlan();
    this._broadcast();
    return exam;
  }

  updateExam(id, updates = {}) {
    const exams = this.getExams();
    const exam = exams.find((e) => e.id === id);
    if (!exam) return null;
    if (updates.subject !== undefined) exam.subject = String(updates.subject).trim();
    if (updates.date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(updates.date)) exam.date = updates.date;
    if (updates.time !== undefined) exam.time = /^\d{2}:\d{2}$/.test(updates.time) ? updates.time : '';
    if (updates.topics !== undefined) exam.topics = this._cleanTopics(updates.topics);
    if (updates.difficulty !== undefined) exam.difficulty = Math.min(3, Math.max(1, Number(updates.difficulty) || 2));
    if (updates.note !== undefined) exam.note = String(updates.note).trim();
    this.store.set('exams', exams);
    this.generatePlan();
    this._broadcast();
    return exam;
  }

  deleteExam(id) {
    this.store.set('exams', this.getExams().filter((e) => e.id !== id));
    const plan = this._plan();
    plan.sessions = plan.sessions.filter((s) => s.examId !== id);
    this._savePlan(plan);
    this.generatePlan();
    this._broadcast();
    return true;
  }

  _cleanTopics(topics) {
    const arr = Array.isArray(topics) ? topics : String(topics || '').split(/[\n,;]+/);
    return arr.map((t) => String(t).trim()).filter(Boolean).slice(0, 40);
  }

  // ── plan storage ────────────────────────────────────────
  /** Local-time stamp (YYYY-MM-DDTHH:mm). NOT toISOString(): that is UTC, and between
   *  00:00 and 05:30 IST its date is "yesterday", which made check() regenerate forever. */
  _stamp(now = new Date()) {
    return `${dateKey(now)}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
  _plan() {
    const p = this.store.get('studyPlan', {});
    return { generatedAt: p.generatedAt || null, sessions: Array.isArray(p.sessions) ? p.sessions : [], notified: p.notified || {} };
  }
  _savePlan(p) {
    this.store.set('studyPlan', p);
  }

  /** Free slots on a given date, after removing classes and exams. */
  freeSlots(dk, cfg = this.settings(), now = new Date()) {
    const weekday = DAYS[parseDay(dk).getDay()];
    const busy = this.timetable.getAll()
      .filter((e) => e.day === weekday && /^\d{2}:\d{2}$/.test(e.startTime))
      .map((e) => [toMin(e.startTime) - 10, toMin(e.endTime) + 10]);

    for (const ex of this.getExams()) {
      if (ex.date !== dk) continue;
      const start = ex.time ? toMin(ex.time) : toMin(cfg.dayStart);
      busy.push([start - 60, start + 180]); // exam time + travel/buffer
    }

    let cursor = toMin(cfg.dayStart);
    if (dk === dateKey(now)) {
      const from = now.getHours() * 60 + now.getMinutes() + 10;
      cursor = Math.max(cursor, Math.ceil(from / 15) * 15); // start on a clean quarter hour
    }
    const end = toMin(cfg.dayEnd);

    const slots = [];
    const sorted = busy.sort((a, b) => a[0] - b[0]);
    for (const [bs, be] of sorted) {
      if (bs > cursor) slots.push([cursor, Math.min(bs, end)]);
      cursor = Math.max(cursor, be);
    }
    if (cursor < end) slots.push([cursor, end]);
    return slots.filter(([s, e]) => e - s >= cfg.sessionMinutes);
  }

  /**
   * Rebuild future study sessions. Sessions already marked done, and past ones, are kept.
   */
  generatePlan(now = new Date()) {
    const cfg = this.settings();
    const exams = this.getExams();
    const todayKey = dateKey(now);
    const plan = this._plan();

    // keep history (past days) and anything already ticked off
    const keep = plan.sessions.filter((s) => s.done || s.date < todayKey);
    const upcoming = exams.filter((e) => e.date >= todayKey);
    if (!upcoming.length) {
      this._savePlan({ ...plan, sessions: keep, generatedAt: this._stamp(now) });
      return keep;
    }

    const lastDate = upcoming[upcoming.length - 1].date;
    const fresh = [];

    // how many sessions each exam still needs
    const need = new Map();
    for (const ex of upcoming) {
      const topics = ex.topics.length || 3;
      const target = Math.max(2, Math.round(topics * ex.difficulty * 0.8));
      const alreadyDone = keep.filter((s) => s.examId === ex.id && s.done).length;
      need.set(ex.id, Math.max(1, target - alreadyDone));
    }

    for (let d = 0; ; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const dk = dateKey(day);
      if (dk > lastDate) break;
      if (d > 120) break;

      const slots = this.freeSlots(dk, cfg, now);
      const usedToday = keep.filter((s) => s.date === dk).length;
      let budget = Math.max(0, cfg.maxSessionsPerDay - usedToday);
      if (!budget) continue;

      for (const [slotStart, slotEnd] of slots) {
        let cursor = slotStart;
        while (budget > 0 && cursor + cfg.sessionMinutes <= slotEnd) {
          // pick the exam that needs this slot most: closest exam with work left
          const candidates = upcoming
            .filter((ex) => ex.date > dk || (ex.date === dk && ex.time && toMin(ex.time) > cursor + cfg.sessionMinutes))
            .map((ex) => {
              const daysLeft = Math.max(0, daysBetween(dk, ex.date));
              const remaining = need.get(ex.id) || 0;
              const plannedForExam = fresh.filter((s) => s.examId === ex.id).length;
              const left = remaining - plannedForExam;
              const urgency = (left > 0 ? left : 0.2) / (daysLeft + 1);
              return { ex, left, daysLeft, urgency };
            })
            .sort((a, b) => b.urgency - a.urgency);

          if (!candidates.length) break;
          const pick = candidates[0];
          const ex = pick.ex;

          // avoid two sessions of the same subject back-to-back when another exam needs time
          const prev = fresh[fresh.length - 1];
          let chosen = pick;
          if (prev && prev.date === dk && prev.examId === ex.id && candidates[1] && candidates[1].left > 0) chosen = candidates[1];

          const topicIdx = fresh.filter((s) => s.examId === chosen.ex.id).length;
          const topics = chosen.ex.topics;
          let topic;
          if (chosen.daysLeft <= 1) topic = 'Full revision + practice paper';
          else if (!topics.length) topic = 'Study / revise syllabus';
          else if (topicIdx < topics.length) topic = topics[topicIdx];
          else topic = `Revision: ${topics[topicIdx % topics.length]}`;

          fresh.push({
            id: newId(),
            examId: chosen.ex.id,
            subject: chosen.ex.subject,
            topic,
            date: dk,
            start: toHHMM(cursor),
            end: toHHMM(cursor + cfg.sessionMinutes),
            done: false,
          });
          budget--;
          cursor += cfg.sessionMinutes + cfg.breakMinutes;
        }
        if (!budget) break;
      }
    }

    const sessions = [...keep, ...fresh].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    this._savePlan({ generatedAt: this._stamp(now), sessions, notified: plan.notified });
    return sessions;
  }

  setSessionDone(id, done = true) {
    const plan = this._plan();
    const s = plan.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.done = !!done;
    s.doneAt = done ? new Date().toISOString() : null;
    this._savePlan(plan);
    this._broadcast();
    return s;
  }

  // ── views ───────────────────────────────────────────────
  getOverview(now = new Date()) {
    const todayKey = dateKey(now);
    const plan = this._plan();
    const exams = this.getExams().map((ex) => {
      const mine = plan.sessions.filter((s) => s.examId === ex.id);
      const done = mine.filter((s) => s.done).length;
      return {
        ...ex,
        daysLeft: daysBetween(todayKey, ex.date),
        sessionsPlanned: mine.length,
        sessionsDone: done,
        progress: mine.length ? Math.round((done / mine.length) * 100) : 0,
      };
    });
    const upcoming = plan.sessions.filter((s) => s.date >= todayKey);
    return {
      settings: this.settings(),
      generatedAt: plan.generatedAt,
      exams,
      today: upcoming.filter((s) => s.date === todayKey),
      next7: upcoming.filter((s) => s.date > todayKey && daysBetween(todayKey, s.date) <= 7),
      doneCount: plan.sessions.filter((s) => s.done).length,
    };
  }

  getPlanText(dayKey) {
    const dk = dayKey || dateKey(new Date());
    const list = this._plan().sessions.filter((s) => s.date === dk);
    if (!list.length) return `No study sessions planned for ${dk}.`;
    return list.map((s) => `- ${s.start}–${s.end} ${s.subject}: ${s.topic}${s.done ? ' ✔' : ''}`).join('\n');
  }

  // ── reminders ───────────────────────────────────────────
  start(win) {
    this.window = win;
    if (this.interval) return;
    this.generatePlan();
    this.interval = setInterval(() => this.check(), 60 * 1000);
    setTimeout(() => this.check(), 20000);
  }
  stop() {
    clearInterval(this.interval);
    this.interval = null;
  }

  check(now = new Date()) {
    if (this.store.get('settings.studyReminders') === false) return;
    const cfg = this.settings();
    const todayKey = dateKey(now);
    const mins = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    let plan = this._plan();

    // rebuild the plan once a day (new day = new free slots) — no recursion, one rebuild max
    if (!plan.generatedAt || plan.generatedAt.slice(0, 10) < todayKey) {
      this.generatePlan(now);
      plan = this._plan();
      if (!plan.generatedAt || plan.generatedAt.slice(0, 10) < todayKey) {
        // should be impossible now; never loop on it
        plan.generatedAt = this._stamp(now);
        changed = true;
      }
    }

    for (const k of Object.keys(plan.notified)) if (k.slice(0, 10) < todayKey) { delete plan.notified[k]; changed = true; }

    // morning briefing
    const brief = `brief|${todayKey}`;
    if (mins >= toMin(cfg.reminderTime) && mins <= toMin(cfg.reminderTime) + 120 && !plan.notified[brief]) {
      const today = plan.sessions.filter((s) => s.date === todayKey);
      const nextExam = this.getExams().find((e) => e.date >= todayKey);
      if (today.length || nextExam) {
        plan.notified[brief] = true;
        changed = true;
        const lines = today.map((s) => `${s.start} ${s.subject} — ${s.topic}`);
        const examLine = nextExam
          ? `${nextExam.subject} exam ${daysBetween(todayKey, nextExam.date) === 0 ? 'today' : `in ${daysBetween(todayKey, nextExam.date)} day(s)`}`
          : '';
        this._notify('📚 Today\'s study plan', [examLine, ...lines].filter(Boolean).join('\n'));
        this._send('study-reminder', { type: 'morning', examLine, sessions: today });
      }
    }

    // 5 minutes before each session
    for (const s of plan.sessions) {
      if (s.date !== todayKey || s.done) continue;
      const key = `session|${s.id}`;
      const left = toMin(s.start) - mins;
      if (left <= 5 && left >= -2 && !plan.notified[key]) {
        plan.notified[key] = true;
        changed = true;
        this._notify(`⏳ Study time: ${s.subject}`, `${s.topic}\n${s.start}–${s.end}`);
        this._send('study-reminder', { type: 'session', session: s });
      }
    }

    if (changed) this._savePlan(plan);
  }

  _notify(title, body) {
    try {
      const n = new Notification({ title, body, icon: path.join(__dirname, '..', 'assets', 'senju-icon.ico') });
      n.on('click', () => { if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); } });
      n.show();
    } catch (_) { /* ignore */ }
  }
  _send(channel, payload) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload);
  }
  _broadcast() {
    this._send('academics-updated', 'exams');
  }
}

module.exports = StudyPlanner;
