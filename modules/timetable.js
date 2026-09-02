/**
 * DVSC Timetable Manager
 * -----------------------
 * Manages the Boss's weekly timetable/schedule.
 * Entries are sorted by day (Monday → Sunday) then by start time.
 *
 * @module modules/timetable
 */

// Day ordering for consistent Monday-first sorting
const DAY_ORDER = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/**
 * TimetableManager — Manages the weekly timetable for DVSC.
 * Persists data via electron-store.
 */
class TimetableManager {
  /**
   * @param {import('electron-store')} store - Electron store instance for persistence
   */
  constructor(store) {
    /** @type {import('electron-store')} */
    this.store = store;
  }

  // ─────────────────────────────────────────────────────────
  // Read Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Get all timetable entries, sorted by day (Monday → Sunday) then by start time.
   *
   * @returns {Array<Object>} Sorted array of timetable entries
   */
  getAll() {
    const entries = this.store.get('timetable', []);
    return this._sort(entries);
  }

  /**
   * Get timetable entries for a specific day of the week.
   *
   * @param {string} day - Day name (lowercase), e.g. 'monday', 'tuesday'
   * @returns {Array<Object>} Entries for that day, sorted by start time
   */
  getByDay(day) {
    const normalizedDay = day.toLowerCase().trim();
    const entries = this.store.get('timetable', []);

    return entries
      .filter((entry) => entry.day === normalizedDay)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  // ─────────────────────────────────────────────────────────
  // Write Operations
  // ─────────────────────────────────────────────────────────

  /**
   * Add a new timetable entry.
   *
   * @param {Object} entry - Timetable entry data
   * @param {string} entry.day - Day of the week (lowercase)
   * @param {string} entry.startTime - Start time in HH:mm format
   * @param {string} entry.endTime - End time in HH:mm format
   * @param {string} entry.title - Activity title
   * @param {string} [entry.category='other'] - Category: study, work, personal, health, other
   * @returns {Object} The created timetable entry with generated id
   */
  add(entry) {
    const entries = this.store.get('timetable', []);

    // Generate unique ID
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

    const newEntry = {
      id,
      day: (entry.day || 'monday').toLowerCase().trim(),
      startTime: entry.startTime || '09:00',
      endTime: entry.endTime || '10:00',
      title: entry.title || 'Untitled',
      category: this._validateCategory(entry.category),
      createdAt: new Date().toISOString(),
    };

    entries.push(newEntry);
    this.store.set('timetable', entries);

    console.log(`[DVSC Timetable] Added: "${newEntry.title}" on ${newEntry.day} (${newEntry.startTime}-${newEntry.endTime})`);
    return newEntry;
  }

  /**
   * Delete a timetable entry by ID.
   *
   * @param {string} id - Entry ID to delete
   * @returns {boolean} True if the entry was found and deleted
   */
  delete(id) {
    const entries = this.store.get('timetable', []);
    const filtered = entries.filter((e) => e.id !== id);

    if (filtered.length === entries.length) {
      console.warn(`[DVSC Timetable] Entry not found: ${id}`);
      return false;
    }

    this.store.set('timetable', filtered);
    console.log(`[DVSC Timetable] Deleted entry: ${id}`);
    return true;
  }

  /**
   * Update a timetable entry by ID.
   * Only the provided fields in `updates` will be modified.
   *
   * @param {string} id - Entry ID to update
   * @param {Object} updates - Partial object with fields to update
   * @returns {Object|null} The updated entry, or null if not found
   */
  update(id, updates) {
    const entries = this.store.get('timetable', []);
    const entry = entries.find((e) => e.id === id);

    if (!entry) {
      console.warn(`[DVSC Timetable] Entry not found for update: ${id}`);
      return null;
    }

    // Apply allowed updates
    if (updates.day !== undefined) entry.day = updates.day.toLowerCase().trim();
    if (updates.startTime !== undefined) entry.startTime = updates.startTime;
    if (updates.endTime !== undefined) entry.endTime = updates.endTime;
    if (updates.title !== undefined) entry.title = updates.title;
    if (updates.category !== undefined) entry.category = this._validateCategory(updates.category);

    this.store.set('timetable', entries);
    console.log(`[DVSC Timetable] Updated entry: "${entry.title}" (${id})`);
    return entry;
  }

  // ─────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────

  /**
   * Sort entries by day of week (Monday → Sunday), then by start time.
   *
   * @param {Array<Object>} entries - Unsorted entries
   * @returns {Array<Object>} Sorted entries
   * @private
   */
  _sort(entries) {
    return [...entries].sort((a, b) => {
      // Primary sort: day of week
      const dayDiff = (DAY_ORDER[a.day] ?? 7) - (DAY_ORDER[b.day] ?? 7);
      if (dayDiff !== 0) return dayDiff;

      // Secondary sort: start time (lexicographic works for HH:mm)
      return a.startTime.localeCompare(b.startTime);
    });
  }

  /**
   * Validate and normalize a category string.
   *
   * @param {string} [category] - Raw category input
   * @returns {string} Validated category
   * @private
   */
  _validateCategory(category) {
    const valid = ['study', 'work', 'personal', 'health', 'other'];
    const normalized = (category || 'other').toLowerCase().trim();
    return valid.includes(normalized) ? normalized : 'other';
  }
}

module.exports = TimetableManager;
