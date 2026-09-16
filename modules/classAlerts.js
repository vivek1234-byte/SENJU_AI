/**
 * SENJU Class Alerts
 * ------------------
 * Works 100% offline. Every 20 seconds it checks today's timetable and, N minutes
 * (default 15) before a class starts, shows a Windows notification and tells the
 * renderer to show + speak the alert.
 */

const { Notification } = require('electron');
const path = require('path');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

class ClassAlertScheduler {
  constructor(store, timetableManager) {
    this.store = store;
    this.timetableManager = timetableManager;
    this.interval = null;
    this.window = null;
  }

  settings() {
    const s = this.store.get('settings', {});
    const minutes = parseInt(s.classAlertMinutes, 10);
    return {
      enabled: s.classAlertsEnabled !== false,          // on by default
      minutes: isNaN(minutes) ? 15 : Math.min(120, Math.max(1, minutes)),
    };
  }

  start(mainWindow) {
    this.window = mainWindow;
    if (this.interval) return;
    this.check();
    this.interval = setInterval(() => this.check(), 20 * 1000);
    console.log('[SENJU Class Alerts] Scheduler started.');
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  check() {
    const { enabled, minutes } = this.settings();
    if (!enabled) return;

    const now = new Date();
    const today = DAYS[now.getDay()];
    const dateKey = localDateKey(now);

    // Keys of alerts already sent today (persisted so a restart doesn't repeat them)
    let sent = this.store.get('classAlertsSent', { date: dateKey, keys: [] });
    if (sent.date !== dateKey) sent = { date: dateKey, keys: [] };

    const entries = this.timetableManager.getAll().filter((e) => e.day === today && /^\d{2}:\d{2}$/.test(e.startTime));
    let changed = false;

    for (const entry of entries) {
      const [h, m] = entry.startTime.split(':').map(Number);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      const msLeft = start - now;
      const key = `${entry.id}|${entry.startTime}`;

      // Fire once when we're inside the alert window (e.g. 15 → 0 minutes before start)
      if (msLeft > 0 && msLeft <= minutes * 60000 && !sent.keys.includes(key)) {
        const minsLeft = Math.max(1, Math.round(msLeft / 60000));
        this.fire(entry, minsLeft);
        sent.keys.push(key);
        changed = true;
      }
    }

    if (changed || sent.date !== (this.store.get('classAlertsSent') || {}).date) {
      this.store.set('classAlertsSent', sent);
    }
  }

  fire(entry, minsLeft) {
    const venue = [entry.block, entry.room ? `Room ${entry.room}` : ''].filter(Boolean).join(', ');
    const time = `${to12h(entry.startTime)} – ${to12h(entry.endTime)}`;
    const alert = {
      id: entry.id,
      title: entry.title,
      startTime: entry.startTime,
      endTime: entry.endTime,
      block: entry.block || '',
      room: entry.room || '',
      minutesLeft: minsLeft,
      text: `${entry.title} in ${minsLeft} min • ${time}${venue ? ` • ${venue}` : ''}`,
    };

    console.log('[SENJU Class Alerts] 🔔', alert.text);

    try {
      const n = new Notification({
        title: `📚 Class in ${minsLeft} min: ${entry.title}`,
        body: `🕒 ${time}${venue ? `\n📍 ${venue}` : ''}`,
        icon: path.join(__dirname, '..', 'assets', 'senju-icon.ico'),
        urgency: 'critical',
        timeoutType: 'never',
      });
      n.on('click', () => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.show();
          this.window.focus();
        }
      });
      n.show();
    } catch (e) {
      console.error('[SENJU Class Alerts] Notification failed:', e.message);
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('class-alert', alert);
    }
  }
}

module.exports = ClassAlertScheduler;
