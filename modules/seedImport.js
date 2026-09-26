/**
 * SENJU College Data Import
 * -------------------------
 * Loads seed-data.json (timetable + attendance from the college portal) into
 * SENJU's store, once per "version" in that file.
 *
 * - Timetable: replaces entries with the portal ones (subject code → full name,
 *   block + room kept). The previous timetable is backed up under "timetableBackup".
 * - Attendance: recreates the held/attended counts as dated records, placed on the
 *   real weekday slots of each subject, walking backwards from today.
 *
 * Re-import later: bump "version" in seed-data.json (or delete "seedImport" from the store).
 */

const fs = require('fs');
const path = require('path');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function categoryFor(kind) {
  return 'study'; // classes and labs both count towards attendance
}

/**
 * @param {import('electron-store')} store
 * @param {string} [file] path to seed-data.json
 * @returns {{applied:boolean, reason?:string, classes?:number, records?:number}}
 */
function importCollegeData(store, file = path.join(__dirname, '..', 'seed-data.json')) {
  if (!fs.existsSync(file)) return { applied: false, reason: 'no seed-data.json' };

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[Import] seed-data.json is not valid JSON:', e.message);
    return { applied: false, reason: 'invalid json' };
  }

  const version = seed.version || 'v1';
  if (store.get('seedImport') === version) return { applied: false, reason: 'already imported' };

  const byCode = new Map(seed.subjects.map((s) => [s.code, s]));

  // ── 1. Timetable ──────────────────────────────────────────
  const previous = store.get('timetable', []);
  if (previous.length) store.set('timetableBackup', { at: new Date().toISOString(), entries: previous });

  const createdAt = new Date(Date.now() - 180 * 864e5).toISOString(); // so past classes can be marked
  const entries = seed.timetable.map((t) => {
    const subject = byCode.get(t.code);
    return {
      id: newId(),
      day: t.day,
      startTime: t.startTime,
      endTime: t.endTime,
      title: subject ? subject.name : t.code,
      code: t.code,
      faculty: subject ? subject.faculty || '' : '',
      category: categoryFor(subject && subject.kind),
      block: t.block || seed.block || '',
      room: t.room || '',
      createdAt,
    };
  });
  store.set('timetable', entries);

  // ── 2. Attendance baseline ────────────────────────────────
  // Portal totals are stored as a per-subject baseline, NOT as individual rows,
  // so the "Recent marks" list and the subject percentages stay independent.
  const att = store.get('attendance', {});
  const prevRecords = Array.isArray(att) ? [] : (att.records || []).filter((r) => !r.imported);
  const baseline = {};
  let held = 0;
  for (const subject of seed.subjects) {
    const key = subject.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const h = Math.max(0, Number(subject.held) || 0);
    const a2 = Math.min(h, Math.max(0, Number(subject.attended) || 0));
    baseline[key] = { subject: subject.name, code: subject.code, held: h, attended: a2, updatedAt: new Date().toISOString() };
    held += h;
  }

  store.set('attendance', {
    records: prevRecords,
    baseline,
    // drop old imported rows from the undo bin — the baseline now carries those numbers
    trash: Array.isArray(att) ? [] : (att.trash || []).filter((r) => !r.imported),
    // portal totals cover everything up to this date; SENJU counts from here on
    trackFrom: seed.trackFrom || '',
    target: Array.isArray(att) ? 75 : att.target || 75,
    ignored: Array.isArray(att) ? [] : att.ignored || [],
    prompted: {},
  });
  store.set('seedImport', version);

  const records = { length: held };
  console.log(`[Import] College data loaded: ${entries.length} weekly classes, ${held} classes of attendance history.`);
  return { applied: true, classes: entries.length, held };
}

module.exports = { importCollegeData };
