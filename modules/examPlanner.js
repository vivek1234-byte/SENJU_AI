/**
 * SENJU Exam Planner
 * -------------------
 * Manages exam dates, countdowns, and generates daily study plans
 * based on free gaps in the timetable.
 *
 * @module modules/examPlanner
 */

class ExamPlanner {
  /**
   * @param {import('electron-store')} store - Electron store instance
   */
  constructor(store) {
    this.store = store;
  }

  /** @private */
  _id() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  }

  /** @private - Normalize subject (title-case, preserve acronyms) */
  _norm(subject) {
    if (!subject) return '';
    const acr = new Set(['DBMS','OS','AI','ML','CN','TOC','DSA','OOP','SE','COA','DAA','IOT','CD','DM','WT']);
    return subject.trim().split(/\s+/).filter(Boolean).map(w => {
      const up = w.toUpperCase();
      if (acr.has(up)) return up;
      if (w.length >= 2 && w.length <= 5 && w === up && /^[A-Z0-9]+$/.test(w)) return up;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  /** @private - Convert HH:mm to minutes since midnight */
  _toMin(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /** @private - Convert minutes to HH:mm */
  _toTime(m) {
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /** @private - Days left until YYYY-MM-DD (using local midnight) */
  _daysLeft(dateStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, d] = dateStr.split('-').map(Number);
    const exam = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Math.round((exam - today) / 86400000);
  }

  /** @private - Check if day string matches today */
  _isToday(dayStr) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const today = days[new Date().getDay()];
    const clean = (dayStr || '').trim().toLowerCase();
    return clean === today || clean === today.substring(0, 3);
  }

  /**
   * Add an exam.
   * @param {string} subject
   * @param {string} dateStr - YYYY-MM-DD
   * @returns {Object} Created exam
   */
  addExam(subject, dateStr) {
    if (!subject) throw new Error('Subject is required');
    if (!dateStr) throw new Error('Date (YYYY-MM-DD) is required');
    const exams = this.store.get('exams', []);
    const exam = {
      id: this._id(),
      subject: this._norm(subject),
      date: dateStr.trim(),
      createdAt: new Date().toISOString(),
    };
    exams.push(exam);
    this.store.set('exams', exams);
    console.log(`[SENJU Exams] Added: ${exam.subject} on ${exam.date}`);
    return exam;
  }

  /**
   * Remove an exam by ID.
   * @returns {boolean}
   */
  removeExam(id) {
    if (!id) return false;
    const exams = this.store.get('exams', []);
    const filtered = exams.filter(e => e.id !== id);
    if (filtered.length === exams.length) return false;
    this.store.set('exams', filtered);
    console.log(`[SENJU Exams] Removed: ${id}`);
    return true;
  }

  /**
   * Get all exams sorted by date.
   * @returns {Array}
   */
  getAll() {
    return (this.store.get('exams', []) || []).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get countdowns sorted by daysLeft.
   * @returns {Array<{id, subject, date, daysLeft}>}
   */
  getCountdowns() {
    return this.getAll().map(e => ({
      id: e.id,
      subject: e.subject,
      date: e.date,
      daysLeft: this._daysLeft(e.date),
    })).sort((a, b) => a.daysLeft - b.daysLeft);
  }

  /**
   * Generate today's study plan from free timetable gaps.
   *
   * 1. Filter timetable for today, sort by start
   * 2. Find free gaps (08:00–22:00), min 30 min each
   * 3. Get upcoming exams (daysLeft >= 0), sorted by closeness
   * 4. Distribute slots: closest exams get more slots (weighted)
   *
   * @param {Array} timetableEntries - Full timetable array
   * @returns {Array<{subject, startTime, endTime, tip}>}
   */
  generateStudyPlan(timetableEntries) {
    const entries = Array.isArray(timetableEntries) ? timetableEntries : [];

    // 1. Today's classes
    const todayClasses = entries
      .filter(e => this._isToday(e.day))
      .sort((a, b) => this._toMin(a.startTime) - this._toMin(b.startTime));

    // 2. Find free gaps (08:00 to 22:00)
    const DAY_START = 480, DAY_END = 1320; // 8*60, 22*60
    const gaps = [];
    let cursor = DAY_START;

    for (const cls of todayClasses) {
      const s = this._toMin(cls.startTime);
      const e = this._toMin(cls.endTime);
      if (s > cursor) gaps.push({ s: cursor, e: Math.min(s, DAY_END) });
      if (e > cursor) cursor = Math.min(e, DAY_END);
      if (cursor >= DAY_END) break;
    }
    if (cursor < DAY_END) gaps.push({ s: cursor, e: DAY_END });

    const freeSlots = gaps
      .filter(g => (g.e - g.s) >= 30)
      .map(g => ({ startTime: this._toTime(g.s), endTime: this._toTime(g.e), duration: g.e - g.s }));

    if (!freeSlots.length) return [];

    // 3. Upcoming exams
    const upcoming = this.getCountdowns().filter(c => c.daysLeft >= 0);
    if (!upcoming.length) return [];

    // 4. Weighted slot distribution
    const nSlots = freeSlots.length;
    const nExams = upcoming.length;
    const alloc = new Array(nExams).fill(0);

    if (nSlots <= nExams) {
      for (let i = 0; i < nSlots; i++) alloc[i] = 1;
    } else {
      const totalW = (nExams * (nExams + 1)) / 2;
      for (let i = 0; i < nExams; i++) {
        alloc[i] = Math.max(1, Math.floor(((nExams - i) / totalW) * nSlots));
      }
      let sum = alloc.reduce((a, b) => a + b, 0);
      for (let i = 0; sum < nSlots; i = (i + 1) % nExams) { alloc[i]++; sum++; }
      for (let i = nExams - 1; sum > nSlots && i >= 0; i--) {
        if (alloc[i] > 1) { alloc[i]--; sum--; }
      }
    }

    // Build ordered assignment
    const assigned = [];
    for (let i = 0; i < nExams; i++) {
      for (let c = 0; c < alloc[i]; c++) assigned.push(upcoming[i]);
    }

    // 5. Build plan
    const plan = [];
    for (let i = 0; i < nSlots && i < assigned.length; i++) {
      const ex = assigned[i];
      const dl = ex.daysLeft;
      let tip;
      if (dl === 0) tip = 'Exam TODAY — last revision!';
      else if (dl === 1) tip = 'Exam tomorrow — high priority!';
      else if (dl <= 3) tip = `Exam in ${dl} days — high priority!`;
      else if (dl <= 7) tip = `Exam in ${dl} days — medium priority`;
      else tip = `Exam in ${dl} days — revision recommended`;

      plan.push({ subject: ex.subject, startTime: freeSlots[i].startTime, endTime: freeSlots[i].endTime, tip });
    }

    return plan;
  }
}

module.exports = ExamPlanner;
