/**
 * SENJU Timetable → Phone Calendar (.ics)
 * ---------------------------------------
 * Builds an iCalendar file where every timetable entry is a weekly repeating
 * event with an alarm N minutes before. Once imported into the phone's calendar
 * (Google Calendar / Samsung / iPhone), alerts fire on the phone even when the
 * PC is off and the phone has no internet.
 */

const BYDAY = { monday: 'MO', tuesday: 'TU', wednesday: 'WE', thursday: 'TH', friday: 'FR', saturday: 'SA', sunday: 'SU' };
const DAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const pad = (n) => String(n).padStart(2, '0');

function escapeText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// iCalendar lines must be folded at 75 octets
function fold(line) {
  const out = [];
  let buf = '';
  for (const ch of line) {
    if (Buffer.byteLength(buf + ch) > 73) { out.push(buf); buf = ' ' + ch; } else buf += ch;
  }
  out.push(buf);
  return out.join('\r\n');
}

function localStamp(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(h)}${pad(m)}00`;
}

/** First date (today or later) that falls on `day`. */
function firstOccurrence(day, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const diff = (DAY_INDEX[day] - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * @param {Array} entries timetable entries
 * @param {{minutesBefore?:number, until?:string, onlyCategory?:string}} opts
 */
function buildICS(entries, opts = {}) {
  const minutes = Math.min(120, Math.max(1, parseInt(opts.minutesBefore, 10) || 15));
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;

  let until = '';
  if (opts.until && /^\d{4}-\d{2}-\d{2}$/.test(opts.until)) {
    // end of that day, IST → UTC (IST = UTC+5:30)
    const [y, mo, d] = opts.until.split('-').map(Number);
    const u = new Date(Date.UTC(y, mo - 1, d, 23 - 5, 59 - 30, 59));
    until = `;UNTIL=${u.getUTCFullYear()}${pad(u.getUTCMonth() + 1)}${pad(u.getUTCDate())}T${pad(u.getUTCHours())}${pad(u.getUTCMinutes())}${pad(u.getUTCSeconds())}Z`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SENJU AI//Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:College Timetable (SENJU)',
    'X-WR-TIMEZONE:Asia/Kolkata',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Kolkata',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:IST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  let count = 0;
  for (const e of entries) {
    if (!BYDAY[e.day] || !/^\d{2}:\d{2}$/.test(e.startTime) || !/^\d{2}:\d{2}$/.test(e.endTime)) continue;
    if (opts.onlyCategory && e.category !== opts.onlyCategory) continue;

    const first = firstOccurrence(e.day, now);
    const venue = [e.block, e.room ? `Room ${e.room}` : ''].filter(Boolean).join(', ');
    const alarmText = `${e.title} in ${minutes} min${venue ? ` – ${venue}` : ''}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:senju-${e.id}@senju.local`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=Asia/Kolkata:${localStamp(first, e.startTime)}`,
      `DTEND;TZID=Asia/Kolkata:${localStamp(first, e.endTime)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[e.day]}${until}`,
      fold(`SUMMARY:${escapeText(e.title)}`),
      ...(venue ? [fold(`LOCATION:${escapeText(venue)}`)] : []),
      fold(`DESCRIPTION:${escapeText(`${e.startTime}–${e.endTime}${venue ? `\n📍 ${venue}` : ''}\nAdded by SENJU`)}`),
      `CATEGORIES:${escapeText((e.category || 'other').toUpperCase())}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      fold(`DESCRIPTION:${escapeText(alarmText)}`),
      `TRIGGER:-PT${minutes}M`,
      'END:VALARM',
      'END:VEVENT'
    );
    count++;
  }

  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n') + '\r\n', count };
}

module.exports = { buildICS };
