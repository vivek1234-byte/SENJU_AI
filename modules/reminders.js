/**
 * DVSC Reminder Manager
 * ----------------------
 * Handles reminder CRUD, scheduling, and notification dispatch.
 * Supports repeating reminders (daily, weekly, monthly) with automatic rescheduling.
 *
 * @module modules/reminders
 */

const { Notification } = require('electron');

/**
 * ReminderManager — Manages all reminders for DVSC.
 * Persists data via electron-store and runs a background scheduler.
 */
class ReminderManager {
  /**
   * @param {import('electron-store')} store - Electron store instance for persistence
   */
  constructor(store) {
    /** @type {import('electron-store')} */
    this.store = store;

    /** @type {NodeJS.Timeout|null} Scheduler interval reference */
    this.schedulerInterval = null;
  }

  // ─────────────────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Get all reminders from the store.
   *
   * @returns {Array<Object>} Array of reminder objects
   */
  getAll() {
    return this.store.get('reminders', []);
  }

  /**
   * Add a new reminder.
   *
   * @param {Object} reminder - Reminder data
   * @param {string} reminder.title - Short title for the reminder
   * @param {string} [reminder.description] - Optional detailed description
   * @param {string} reminder.datetime - ISO datetime string (YYYY-MM-DDTHH:mm)
   * @param {string} [reminder.repeat] - Repeat interval: 'daily', 'weekly', 'monthly', or null
   * @returns {Object} The created reminder with generated id
   */
  add(reminder) {
    const reminders = this.getAll();

    // Generate a unique ID using base36 timestamp + random suffix
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

    const newReminder = {
      id,
      title: reminder.title || 'Untitled Reminder',
      description: reminder.description || '',
      datetime: reminder.datetime,
      repeat: reminder.repeat || null,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    reminders.push(newReminder);
    this.store.set('reminders', reminders);

    console.log(`[DVSC Reminders] Added: "${newReminder.title}" at ${newReminder.datetime}`);
    return newReminder;
  }

  /**
   * Delete a reminder by ID.
   *
   * @param {string} id - Reminder ID to delete
   * @returns {boolean} True if the reminder was found and deleted
   */
  delete(id) {
    const reminders = this.getAll();
    const filtered = reminders.filter((r) => r.id !== id);

    if (filtered.length === reminders.length) {
      console.warn(`[DVSC Reminders] Reminder not found: ${id}`);
      return false;
    }

    this.store.set('reminders', filtered);
    console.log(`[DVSC Reminders] Deleted reminder: ${id}`);
    return true;
  }

  /**
   * Toggle the completed status of a reminder.
   *
   * @param {string} id - Reminder ID to toggle
   * @returns {Object|null} The updated reminder, or null if not found
   */
  toggle(id) {
    const reminders = this.getAll();
    const reminder = reminders.find((r) => r.id === id);

    if (!reminder) {
      console.warn(`[DVSC Reminders] Reminder not found for toggle: ${id}`);
      return null;
    }

    reminder.completed = !reminder.completed;
    this.store.set('reminders', reminders);

    console.log(`[DVSC Reminders] Toggled "${reminder.title}" → ${reminder.completed ? 'completed' : 'active'}`);
    return reminder;
  }

  // ─────────────────────────────────────────────────────────
  // Scheduler
  // ─────────────────────────────────────────────────────────

  /**
   * Start the background scheduler that checks reminders every 30 seconds.
   *
   * @param {import('electron').BrowserWindow} mainWindow - Main app window for IPC events
   */
  startScheduler(mainWindow) {
    if (this.schedulerInterval) {
      console.warn('[DVSC Reminders] Scheduler already running.');
      return;
    }

    console.log('[DVSC Reminders] Starting scheduler (30s interval)...');

    // Check immediately on start, then every 30 seconds
    this.checkReminders(mainWindow);

    this.schedulerInterval = setInterval(() => {
      this.checkReminders(mainWindow);
    }, 30 * 1000);
  }

  /**
   * Stop the background scheduler.
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      console.log('[DVSC Reminders] Scheduler stopped.');
    }
  }

  /**
   * Check all reminders and trigger any that are due.
   * - Shows an Electron Notification for triggered reminders.
   * - Sends 'reminder-triggered' IPC event to the renderer.
   * - Handles repeat reminders by rescheduling to the next occurrence.
   * - Marks non-repeating reminders as completed.
   *
   * @param {import('electron').BrowserWindow} mainWindow - Main app window
   */
  checkReminders(mainWindow) {
    const reminders = this.getAll();
    const now = new Date();
    let updated = false;

    for (const reminder of reminders) {
      // Skip already completed reminders
      if (reminder.completed) continue;

      const reminderTime = new Date(reminder.datetime);

      // Check if the reminder time has passed
      if (reminderTime <= now) {
        console.log(`[DVSC Reminders] 🔔 Triggered: "${reminder.title}"`);

        // Show native OS notification
        this._showNotification(reminder);

        // Send event to renderer process for in-app notification
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('reminder-triggered', reminder);
        }

        // Handle repeat logic or mark as completed
        if (reminder.repeat) {
          this._reschedule(reminder);
        } else {
          reminder.completed = true;
        }

        updated = true;
      }
    }

    // Persist changes if any reminders were updated
    if (updated) {
      this.store.set('reminders', reminders);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Show an Electron native notification for a triggered reminder.
   *
   * @param {Object} reminder - The triggered reminder
   * @private
   */
  _showNotification(reminder) {
    try {
      const notification = new Notification({
        title: `🔔 DVSC Reminder: ${reminder.title}`,
        body: reminder.description || 'Boss, it\'s time!',
        icon: undefined, // Could be set to app icon path
        urgency: 'critical',
      });

      notification.show();
    } catch (error) {
      console.error('[DVSC Reminders] Failed to show notification:', error.message);
    }
  }

  /**
   * Reschedule a repeating reminder to its next occurrence.
   * Modifies the reminder object in-place.
   *
   * @param {Object} reminder - The reminder to reschedule
   * @private
   */
  _reschedule(reminder) {
    const current = new Date(reminder.datetime);
    let next;

    switch (reminder.repeat) {
      case 'daily':
        next = new Date(current);
        next.setDate(next.getDate() + 1);
        break;

      case 'weekly':
        next = new Date(current);
        next.setDate(next.getDate() + 7);
        break;

      case 'monthly':
        next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        break;

      default:
        console.warn(`[DVSC Reminders] Unknown repeat type: "${reminder.repeat}". Marking as completed.`);
        reminder.completed = true;
        return;
    }

    // Format back to ISO-like string for storage
    reminder.datetime = next.toISOString();
    console.log(`[DVSC Reminders] Rescheduled "${reminder.title}" → ${reminder.datetime} (${reminder.repeat})`);
  }
}

module.exports = ReminderManager;
