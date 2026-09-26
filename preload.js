/**
 * DVSC Preload Script
 * --------------------
 * Secure IPC bridge between the renderer (frontend) and the main process.
 * Exposes a clean `window.dvsc` API using Electron's contextBridge.
 *
 * Security: contextIsolation is enabled, nodeIntegration is disabled.
 * All communication happens through ipcRenderer.invoke (request-response)
 * and ipcRenderer.on (event listener) only.
 *
 * @module preload
 */

const { contextBridge, ipcRenderer } = require('electron');

// Renderer heartbeat: lets the main process log when the UI thread is frozen
setInterval(() => { try { ipcRenderer.send('renderer-heartbeat'); } catch (_) { /* ignore */ } }, 1000);

contextBridge.exposeInMainWorld('dvsc', {
  // ─────────────────────────────────────────────────────────
  // Window Controls (frameless window)
  // ─────────────────────────────────────────────────────────

  /** Minimize the application window */
  minimize: () => ipcRenderer.invoke('window-minimize'),

  /** Toggle maximize/restore the application window */
  maximize: () => ipcRenderer.invoke('window-maximize'),

  /** Close the application window */
  close: () => ipcRenderer.invoke('window-close'),

  /** Restart the application */
  restartApp: () => ipcRenderer.invoke('app-restart'),

  /** Show the application window from background */
  show: () => ipcRenderer.invoke('window-show'),

  // ─────────────────────────────────────────────────────────
  // Chat / AI
  // ─────────────────────────────────────────────────────────

  /**
   * Send a message to DVSC and get a response.
   * @param {string} message - The user's message
   * @returns {Promise<Object>} Response with { success, response } or { success, error }
   */
  sendMessage: (message) => ipcRenderer.invoke('chat-message', message),

  /**
   * Get a time-aware startup greeting from DVSC.
   * @returns {Promise<Object>} Response with { success, greeting }
   */
  getStartupGreeting: () => ipcRenderer.invoke('chat-startup'),

  /**
   * Clear all chat history and reset the conversation.
   * @returns {Promise<Object>} Response with { success }
   */
  clearChatHistory: () => ipcRenderer.invoke('clear-chat-history'),

  // Multi-chat IPC handlers
  getAllChats: () => ipcRenderer.invoke('get-all-chats'),
  createNewChat: () => ipcRenderer.invoke('create-new-chat'),
  loadChat: (chatId) => ipcRenderer.invoke('load-chat', chatId),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),

  // ─────────────────────────────────────────────────────────
  // Reminders
  // ─────────────────────────────────────────────────────────

  /**
   * Get all reminders.
   * @returns {Promise<Array>} Array of reminder objects
   */
  getReminders: () => ipcRenderer.invoke('get-reminders'),

  /**
   * Add a new reminder.
   * @param {Object} reminder - Reminder data { title, description, datetime, repeat }
   * @returns {Promise<Object>} The created reminder
   */
  addReminder: (reminder) => ipcRenderer.invoke('add-reminder', reminder),

  /**
   * Delete a reminder by ID.
   * @param {string} id - Reminder ID
   * @returns {Promise<boolean>} True if deleted
   */
  deleteReminder: (id) => ipcRenderer.invoke('delete-reminder', id),

  /**
   * Toggle the completed status of a reminder.
   * @param {string} id - Reminder ID
   * @returns {Promise<Object|null>} Updated reminder or null
   */
  toggleReminder: (id) => ipcRenderer.invoke('toggle-reminder', id),

  // ─────────────────────────────────────────────────────────
  // Timetable
  // ─────────────────────────────────────────────────────────

  /**
   * Get the full timetable (sorted by day, then time).
   * @returns {Promise<Array>} Array of timetable entries
   */
  getTimetable: () => ipcRenderer.invoke('get-timetable'),

  /**
   * Add a new timetable entry.
   * @param {Object} entry - Entry data { day, startTime, endTime, title, category }
   * @returns {Promise<Object>} The created entry
   */
  addTimetableEntry: (entry) => ipcRenderer.invoke('add-timetable-entry', entry),

  /**
   * Delete a timetable entry by ID.
   * @param {string} id - Entry ID
   * @returns {Promise<boolean>} True if deleted
   */
  deleteTimetableEntry: (id) => ipcRenderer.invoke('delete-timetable-entry', id),

  /**
   * Update an existing timetable entry.
   * @param {string} id - Entry ID
   * @param {Object} updates - Fields to change { day, startTime, endTime, title, category, block, room }
   * @returns {Promise<Object|null>} The updated entry
   */
  updateTimetableEntry: (id, updates) => ipcRenderer.invoke('update-timetable-entry', id, updates),

  // ─────────────────────────────────────────────────────────
  // Attendance
  // ─────────────────────────────────────────────────────────
  getAttendance: () => ipcRenderer.invoke('get-attendance'),
  markAttendance: (payload) => ipcRenderer.invoke('mark-attendance', payload),
  deleteAttendanceRecord: (id) => ipcRenderer.invoke('delete-attendance-record', id),
  restoreAttendanceRecord: (id) => ipcRenderer.invoke('restore-attendance-record', id),
  restoreAllAttendance: () => ipcRenderer.invoke('restore-all-attendance'),
  clearAttendanceTrash: () => ipcRenderer.invoke('clear-attendance-trash'),
  setAttendanceBaseline: (subject, totals) => ipcRenderer.invoke('set-attendance-baseline', subject, totals),
  setAttendanceTarget: (target) => ipcRenderer.invoke('set-attendance-target', target),
  setAttendanceTrackFrom: (date) => ipcRenderer.invoke('set-attendance-track-from', date),
  toggleAttendanceIgnore: (subject) => ipcRenderer.invoke('toggle-attendance-ignore', subject),
  onAttendancePrompt: (callback) => {
    ipcRenderer.on('attendance-prompt', (_event, payload) => callback(payload));
  },

  // ─────────────────────────────────────────────────────────
  // Exams & study planner
  // ─────────────────────────────────────────────────────────
  getExams: () => ipcRenderer.invoke('get-exams'),
  getMemories: () => ipcRenderer.invoke('get-memories'),
  addExam: (exam) => ipcRenderer.invoke('add-exam', exam),
  updateExam: (id, updates) => ipcRenderer.invoke('update-exam', id, updates),
  deleteExam: (id) => ipcRenderer.invoke('delete-exam', id),
  regenerateStudyPlan: () => ipcRenderer.invoke('regenerate-study-plan'),
  setStudySessionDone: (id, done) => ipcRenderer.invoke('set-study-session-done', id, done),
  saveStudySettings: (patch) => ipcRenderer.invoke('save-study-settings', patch),
  onStudyReminder: (callback) => {
    ipcRenderer.on('study-reminder', (_event, payload) => callback(payload));
  },
  onAcademicsUpdated: (callback) => {
    ipcRenderer.on('academics-updated', (_event, what) => callback(what));
  },

  // ─────────────────────────────────────────────────────────
  // Travel — train agent
  // ─────────────────────────────────────────────────────────
  trainSearch: (q) => ipcRenderer.invoke('train-search', q),
  trainAvailability: (q) => ipcRenderer.invoke('train-availability', q),
  trainCompareSites: (fare, q) => ipcRenderer.invoke('train-compare-sites', fare, q),
  trainOpenBooking: (q) => ipcRenderer.invoke('train-open-booking', q),
  trainBookingUrl: (q) => ipcRenderer.invoke('train-booking-url', q),
  trainWatchAdd: (w) => ipcRenderer.invoke('train-watch-add', w),
  trainWatchRemove: (id) => ipcRenderer.invoke('train-watch-remove', id),
  trainWatchList: () => ipcRenderer.invoke('train-watch-list'),
  trainWatchCheck: () => ipcRenderer.invoke('train-watch-check'),
  trainPnr: (pnr) => ipcRenderer.invoke('train-pnr', pnr),
  trainLive: (no, day) => ipcRenderer.invoke('train-live', no, day),
  trainLastSearch: () => ipcRenderer.invoke('train-last-search'),
  trainStations: (q) => ipcRenderer.invoke('train-stations', q),
  trainInfo: () => ipcRenderer.invoke('train-info'),
  onTrainSearchResult: (callback) => {
    ipcRenderer.on('train-search-result', (_event, payload) => callback(payload));
  },
  onTrainWatchesUpdated: (callback) => {
    ipcRenderer.on('train-watches-updated', (_event, payload) => callback(payload));
  },
  onTrainAlert: (callback) => {
    ipcRenderer.on('train-alert', (_event, payload) => callback(payload));
  },
  // Booking agent
  bookingStart: (job) => ipcRenderer.invoke('booking-start', job),
  bookingCancel: () => ipcRenderer.invoke('booking-cancel'),
  bookingStatus: () => ipcRenderer.invoke('booking-status'),
  bookingFocus: () => ipcRenderer.invoke('booking-focus'),
  travellersList: () => ipcRenderer.invoke('travellers-list'),
  travellerAdd: (t) => ipcRenderer.invoke('traveller-add', t),
  travellerRemove: (id) => ipcRenderer.invoke('traveller-remove', id),
  onBookingStatus: (callback) => {
    ipcRenderer.on('booking-status', (_event, payload) => callback(payload));
  },

  // ─────────────────────────────────────────────────────────
  // Location
  // ─────────────────────────────────────────────────────────
  updatePreciseLocation: (coords) => ipcRenderer.invoke('update-precise-location', coords),

  // ─────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────

  /**
   * Get the current application settings.
   * @returns {Promise<Object>} Settings object
   */
  getSettings: () => ipcRenderer.invoke('get-settings'),

  /**
   * Save application settings.
   * @param {Object} settings - Settings to save
   * @returns {Promise<Object>} Response with { success }
   */
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ─────────────────────────────────────────────────────────
  // Notifications
  // ─────────────────────────────────────────────────────────

  /**
   * Show a native OS notification.
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @returns {Promise<void>}
   */
  notify: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  /**
   * Speak text using Edge Neural TTS (high-quality Hinglish voice).
   * @param {string} text - Text to speak
   * @returns {Promise<{success: boolean, audioPath: string}>}
   */
  speak: (text) => ipcRenderer.invoke('tts-speak', text),

  // ─────────────────────────────────────────────────────────
  // System Commands
  // ─────────────────────────────────────────────────────────
  
  /**
   * Execute a system command.
   * @param {Object} cmd - Command data {action, target, value}
   */
  executeCommand: (cmd) => ipcRenderer.invoke('execute-command', cmd),

  // ─────────────────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────────────────

  /**
   * Register a callback for when a reminder is triggered by the scheduler.
   * @param {Function} callback - Called with (event, reminderData)
   */
  exportTimetableICS: (opts) => ipcRenderer.invoke('export-timetable-ics', opts),

  onClassAlert: (callback) => {
    ipcRenderer.on('class-alert', (_event, alert) => callback(alert));
  },

  onReminderTriggered: (callback) => {
    ipcRenderer.on('reminder-triggered', (_event, reminder) => {
      callback(reminder);
    });
  },

  /**
   * Register a callback for when the Wake Word is detected by the main process.
   * @param {Function} callback 
   */
  onWakeWordDetected: (callback) => {
    ipcRenderer.on('wake-word-detected', () => {
      callback();
    });
  },

  // ─────────────────────────────────────────────────────────
  // WhatsApp Integration
  // ─────────────────────────────────────────────────────────

  getWhatsAppState: () => ipcRenderer.invoke('get-whatsapp-state'),
  logoutWhatsApp: () => ipcRenderer.invoke('whatsapp-logout'),
  reconnectWhatsApp: () => ipcRenderer.invoke('whatsapp-reconnect'),
  resetWhatsAppSession: () => ipcRenderer.invoke('whatsapp-reset-session'),
  onWhatsAppStatus: (callback) => {
    ipcRenderer.on('whatsapp-status', (_event, status) => callback(status));
  },
  sendWhatsAppMessage: (contactName, message) => ipcRenderer.invoke('send-whatsapp-msg', contactName, message),
  deleteWhatsAppMessage: () => ipcRenderer.invoke('delete-whatsapp-msg'),

  onWhatsAppQR: (callback) => {
    ipcRenderer.on('whatsapp-qr', (_event, qrDataUrl) => {
      callback(qrDataUrl);
    });
  },

  onWhatsAppReady: (callback) => {
    ipcRenderer.on('whatsapp-ready', () => {
      callback();
    });
  },

  onWhatsAppDisconnected: (callback) => {
    ipcRenderer.on('whatsapp-disconnected', () => {
      callback();
    });
  },


  onWindowHidden: (callback) => {
    ipcRenderer.on('window-hidden', () => callback());
  },

  onWindowShown: (callback) => {
    ipcRenderer.on('window-shown', () => callback());
  },
});
