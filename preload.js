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
