/**
 * DVSC Main Process
 * ------------------
 * Electron main process for the DVSC AI Assistant.
 * Orchestrates window management, IPC handlers, and module initialization.
 *
 * Dominance. Vision. Strategy. Control.
 *
 * @module main
 */

const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { exec } = require('child_process');
// Lazy-loaded (only needed when a command runs) to keep startup fast
const lazy = {
  get loudness() { return require('loudness'); },
  get YouTube() { return require('youtube-sr').default; },
};

// Only one SENJU at a time: double-clicking again just brings the running window back
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window-shown');
  }
});
// Disable autoplay policy to allow background audio context without user gestures

// Disable autoplay policy to allow background audio context without user gestures
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let tray = null;
let isQuitting = false;

// ─────────────────────────────────────────────────────────────
// Location Services
// ─────────────────────────────────────────────────────────────
async function updateLocationStatus(settings) {
  if (!settings.locationEnabled) {
    dvsc.setLocation(null);
    console.log('[DVSC Location] Disabled');
    return;
  }
  
  // We first do a fast IP-based location fetch as a fallback
  try {
    const res = await fetch('http://ip-api.com/json/');
    const data = await res.json();
    if (data.status === 'success') {
      const loc = `${data.city}, ${data.regionName}, ${data.country} (Lat: ${data.lat}, Lon: ${data.lon})`;
      // Only set if we don't already have a more precise location
      if (!dvsc.location || !dvsc.location.includes('Street')) {
        dvsc.setLocation(loc);
        console.log(`[DVSC Location] IP Fallback Updated: ${loc}`);
      }
    }
  } catch (e) {
    console.error('[DVSC Location] Failed to fetch IP location:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Persistent Store Setup
// ─────────────────────────────────────────────────────────────

const Store = require('electron-store');

const store = new Store({
  name: 'dvsc-data',
  defaults: {
    settings: {
      apiKey: '',
      userName: 'Vivek',
      voiceEnabled: true,
      language: 'hi-en',
    },
    reminders: [],
    timetable: [],
    chatHistory: [],
  },
});

// ─────────────────────────────────────────────────────────────
// Module Imports
// ─────────────────────────────────────────────────────────────

const DVSCGroq = require('./modules/groq');
const ReminderManager = require('./modules/reminders');
const TimetableManager = require('./modules/timetable');
const ClassAlertScheduler = require('./modules/classAlerts');
const { buildICS } = require('./modules/icsExport');
const DVSCTts = require('./modules/tts');
const whatsapp = require('./modules/whatsapp');
const { ToolExecutor, runSystemCommand } = require('./modules/tools');

// ─────────────────────────────────────────────────────────────
// Module Instances
// ─────────────────────────────────────────────────────────────

let dvsc = null;
const tts = new DVSCTts();
let reminderManager;
let timetableManager;
let toolExecutor = null;
let classAlerts = null;

/** @type {BrowserWindow|null} */
let mainWindow = null;

// ─────────────────────────────────────────────────────────────
// Window Creation
// ─────────────────────────────────────────────────────────────

/**
 * Create the main application window.
 * Frameless design for custom title bar, with dark background.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // Frameless for custom title bar
    backgroundColor: '#050a15',
    icon: path.join(__dirname, 'assets', 'senju-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Required for 24/7 background audio listening
    },
  });

  // Load the frontend
  // Forward renderer console logs to terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.loadFile('index.html');
  mainWindow.show();
  mainWindow.center();
  mainWindow.focus();
  
  // Open DevTools for debugging
  // mainWindow.webContents.openDevTools();

  // Prevent app from quitting when window is closed (hide it instead)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      mainWindow.webContents.send('window-hidden');
    }
  });

  // Clean up reference on true close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  console.log('[DVSC] Main window created.');
}

// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

/**
 * Initialize the Groq AI module if an API key is configured.
 * Also loads the last 20 chat history messages for continuity.
 */
function initializeAI() {
  const settings = store.get('settings');

  try {
    const previousLocation = dvsc ? dvsc.location : null;
    dvsc = new DVSCGroq();
    if (previousLocation) dvsc.setLocation(previousLocation);
    if (toolExecutor) dvsc.setTools(toolExecutor);
    if (settings.apiKey) {
      dvsc.initialize(settings.apiKey, { model: settings.aiModel });
      console.log('[DVSC] Groq initialized.');
    } else {
      console.log('[DVSC] No API key found. Groq not initialized.');
    }

    // Migrate legacy chat history if it exists and no new chats exist
    let chats = store.get('chats');
    const legacyHistory = store.get('chatHistory');
    
    if (!chats && legacyHistory && legacyHistory.length > 0) {
      // Migrate
      const newChat = {
        id: 'chat_' + Date.now(),
        title: 'Legacy Chat',
        history: legacyHistory,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      chats = [newChat];
      store.set('chats', chats);
      store.set('currentChatId', newChat.id);
      store.delete('chatHistory'); // Remove legacy
    } else if (!chats || chats.length === 0) {
      // Create initial chat
      const newChat = {
        id: 'chat_' + Date.now(),
        title: 'New Chat',
        history: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      chats = [newChat];
      store.set('chats', chats);
      store.set('currentChatId', newChat.id);
    }

    // Ensure currentChatId exists and points to a valid chat
    let currentChatId = store.get('currentChatId');
    let currentChat = chats.find(c => c.id === currentChatId);
    if (!currentChat) {
      currentChat = chats[0];
      store.set('currentChatId', currentChat.id);
    }

    // Restore chat history for session continuity (last 20 messages)
    if (currentChat.history.length > 0) {
      const recentHistory = currentChat.history.slice(-20);
      dvsc.setHistory(recentHistory);
      console.log(`[DVSC] Loaded ${recentHistory.length} messages from current chat history.`);
    }
  } catch (error) {
    console.error('[DVSC] Failed to initialize AI:', error.message);
  }
}

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Window Controls
// ─────────────────────────────────────────────────────────────

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    // Toggle between maximized and restored
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  app.quit();
});

ipcMain.handle('app-restart', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('window-show', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('window-shown');
  }
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Chat / AI
// ─────────────────────────────────────────────────────────────

ipcMain.handle('chat-message', async (_event, message) => {
  try {
    if (!dvsc) {
      return {
        success: false,
        error: 'SENJU engine is not loaded.',
      };
    }

    const { text: response, actions, refresh } = await dvsc.sendMessage(message);

    const chats = store.get('chats', []);
    const currentChatId = store.get('currentChatId');
    const currentChatIndex = chats.findIndex(c => c.id === currentChatId);
    
    if (currentChatIndex !== -1) {
      const currentChat = chats[currentChatIndex];
      
      // Auto-generate title if it's the first message
      if (currentChat.history.length === 0 && currentChat.title === 'New Chat') {
        currentChat.title = message.substring(0, 25) + (message.length > 25 ? '...' : '');
      }
      
      currentChat.history.push(
        { role: 'user', parts: [{ text: message }] },
        { role: 'model', parts: [{ text: response }] }
      );
      
      currentChat.updatedAt = new Date().toISOString();
      
      // Keep only last 100 entries
      currentChat.history = currentChat.history.slice(-100);
      chats[currentChatIndex] = currentChat;
      store.set('chats', chats);
    }

    return { success: true, response, actions, refresh, model: dvsc.lastModelUsed };
  } catch (error) {
    console.error('[DVSC] Chat error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('chat-startup', async () => {
  try {
    if (!dvsc) {
      return {
        success: false,
        error: 'SENJU engine is not loaded. Please restart the app.',
      };
    }

    const greeting = await dvsc.getStartupGreeting();
    return { success: true, greeting };
  } catch (error) {
    console.error('[DVSC] Startup greeting error:', error.message);
    return {
      success: true,
      greeting: 'Boss! SENJU online hai. Batao kya karna hai aaj? 🌸',
    };
  }
});

// Get Chat History (Legacy, now returns current chat history)
ipcMain.handle('get-chat-history', () => {
  return dvsc.getHistory();
});

// Long-term memory (facts SENJU remembers about Vivek)
ipcMain.handle('get-memories', () => store.get('memories', []));
ipcMain.handle('clear-memories', () => { store.set('memories', []); return { success: true }; });

// Multi-chat handlers
ipcMain.handle('get-all-chats', () => {
  const chats = store.get('chats', []);
  // Return metadata only, exclude full history
  return chats.map(c => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
});

ipcMain.handle('create-new-chat', () => {
  const chats = store.get('chats', []);
  const newChat = {
    id: 'chat_' + Date.now(),
    title: 'New Chat',
    history: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  chats.push(newChat);
  store.set('chats', chats);
  store.set('currentChatId', newChat.id);
  dvsc.setHistory([]);
  return newChat;
});

ipcMain.handle('load-chat', (event, chatId) => {
  const chats = store.get('chats', []);
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    store.set('currentChatId', chat.id);
    const recentHistory = chat.history.slice(-20);
    dvsc.setHistory(recentHistory);
    return chat;
  }
  return null;
});

ipcMain.handle('delete-chat', (event, chatId) => {
  let chats = store.get('chats', []);
  chats = chats.filter(c => c.id !== chatId);
  if (chats.length === 0) {
    // If all deleted, create one
    const newChat = {
      id: 'chat_' + Date.now(),
      title: 'New Chat',
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    chats = [newChat];
  }
  store.set('chats', chats);
  
  // If we deleted the current chat, switch to the most recent one
  const currentChatId = store.get('currentChatId');
  if (currentChatId === chatId) {
    const mostRecent = chats.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    store.set('currentChatId', mostRecent.id);
    dvsc.setHistory(mostRecent.history.slice(-20));
    return { success: true, currentChatId: mostRecent.id, newHistory: mostRecent.history };
  }
  return { success: true, currentChatId };
});

// WhatsApp Send Message
ipcMain.handle('send-whatsapp-msg', async (event, contactName, messageText) => {
  try {
    const result = await whatsapp.sendMessage(contactName, messageText);
    return { success: true, result };
  } catch (error) {
    console.error('[Main] WhatsApp send error:', error);
    return { success: false, error: error.message };
  }
});
// WhatsApp State & Logout
ipcMain.handle('get-whatsapp-state', () => {
  return whatsapp.getWhatsAppState();
});

ipcMain.handle('whatsapp-logout', async () => {
  await whatsapp.logoutWhatsApp();
  return { success: true };
});

ipcMain.handle('delete-whatsapp-msg', async () => {
  try {
    const result = await whatsapp.deleteLastWhatsAppMessage();
    return { success: true, result };
  } catch (error) {
    console.error('[Main] WhatsApp delete error:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('clear-chat-history', () => {
  const chats = store.get('chats', []);
  const currentChatId = store.get('currentChatId');
  const currentChatIndex = chats.findIndex(c => c.id === currentChatId);
  if (currentChatIndex !== -1) {
    chats[currentChatIndex].history = [];
    chats[currentChatIndex].updatedAt = new Date().toISOString();
    store.set('chats', chats);
  }
  dvsc.setHistory([]);
  console.log('[DVSC] Current chat history cleared.');
  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Reminders
// ─────────────────────────────────────────────────────────────

ipcMain.handle('get-reminders', () => {
  return reminderManager.getAll();
});

ipcMain.handle('add-reminder', (_event, reminder) => {
  return reminderManager.add(reminder);
});

ipcMain.handle('delete-reminder', (_event, id) => {
  return reminderManager.delete(id);
});

ipcMain.handle('toggle-reminder', (_event, id) => {
  return reminderManager.toggle(id);
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Timetable
// ─────────────────────────────────────────────────────────────

ipcMain.handle('get-timetable', () => {
  return timetableManager.getAll();
});

ipcMain.handle('add-timetable-entry', (_event, entry) => {
  return timetableManager.add(entry);
});

ipcMain.handle('update-timetable-entry', (_event, id, updates) => {
  const updated = timetableManager.update(id, updates);
  if (!updated) throw new Error('Entry not found: ' + id);
  return updated;
});

// Export timetable as a phone-calendar file (.ics) with alerts before each class
ipcMain.handle('export-timetable-ics', async (_event, opts = {}) => {
  try {
    const { dialog } = require('electron');
    const fs = require('fs');
    const { ics, count } = buildICS(timetableManager.getAll(), opts);
    if (!count) return { success: false, error: 'Timetable is empty.' };

    let filePath;
    if (opts.sendToWhatsApp) {
      filePath = path.join(app.getPath('temp'), 'College-Timetable-SENJU.ics');
    } else {
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'Save timetable for your phone',
        defaultPath: path.join(app.getPath('downloads'), 'College-Timetable-SENJU.ics'),
        filters: [{ name: 'Calendar file', extensions: ['ics'] }],
      });
      if (res.canceled || !res.filePath) return { success: false, canceled: true };
      filePath = res.filePath;
    }

    fs.writeFileSync(filePath, ics, 'utf8');

    if (opts.sendToWhatsApp) {
      await whatsapp.sendFileToSelf(filePath, `📚 College timetable (${count} classes) — open this file on your phone to add it to your calendar.`);
      return { success: true, count, sentToWhatsApp: true };
    }

    require('electron').shell.showItemInFolder(filePath);
    return { success: true, count, filePath };
  } catch (error) {
    console.error('[SENJU] ICS export failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-timetable-entry', (_event, id) => {
  return timetableManager.delete(id);
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Settings
// ─────────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  return store.get('settings');
});

ipcMain.handle('save-settings', (_event, newSettings) => {
  const currentSettings = store.get('settings', {});
  const providerChanged = newSettings.aiProvider !== currentSettings.aiProvider;
  const pathChanged = newSettings.localModelPath !== currentSettings.localModelPath;
  const apiKeyChanged = newSettings.apiKey !== undefined && newSettings.apiKey !== currentSettings.apiKey;
  const modelChanged = newSettings.aiModel !== undefined && newSettings.aiModel !== currentSettings.aiModel;
  const configChanged = providerChanged || pathChanged || apiKeyChanged || modelChanged;

  // Merge new settings with existing ones
  const mergedSettings = { ...currentSettings, ...newSettings };
  store.set('settings', mergedSettings);

  // Re-initialize AI if configuration changed
  if (configChanged) {
    console.log('[DVSC] AI configuration changed, re-initializing AI...');
    try {
      initializeAI();
    } catch (error) {
      console.error('[DVSC] Failed to re-initialize AI:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Update location if setting changed
  updateLocationStatus(mergedSettings);

  console.log('[DVSC] Settings saved.');
  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Notifications
// ─────────────────────────────────────────────────────────────

ipcMain.handle('show-notification', (_event, { title, body }) => {
  try {
    const notification = new Notification({
      title: title || 'SENJU',
      body: body || '',
    });
    notification.show();
  } catch (error) {
    console.error('[DVSC] Notification error:', error.message);
  }
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — Text-to-Speech (Edge Neural TTS)
// ─────────────────────────────────────────────────────────────

ipcMain.handle('tts-speak', async (_event, text) => {
  try {
    const audioData = await tts.speak(text);
    return { success: true, audioData };
  } catch (error) {
    console.error('[DVSC] TTS error:', error.message);
    return { success: false, error: error.message };
  }
});

// ─────────────────────────────────────────────────────────────
// IPC Handlers — System Commands (PC Automation)
// ─────────────────────────────────────────────────────────────

ipcMain.handle('execute-command', async (_event, cmd) => {
  // Legacy path (old [COMMAND] tags). New replies use tool calling inside the brain.
  console.log('[SENJU] Executing legacy system command:', cmd);
  try {
    const message = await runSystemCommand(cmd, lazy);
    return { success: true, message };
  } catch (err) {
    console.error('[SENJU] Command execution failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update-precise-location', async (_event, coords) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lon}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SENJU-AI-Assistant/1.0' } });
    const data = await res.json();
    if (data && data.display_name) {
      const preciseLoc = `Exact Address: ${data.display_name} (Lat: ${coords.lat}, Lon: ${coords.lon})`;
      dvsc.setLocation(preciseLoc);
      console.log(`[DVSC Location] Precise Updated: ${preciseLoc}`);
      return { success: true, location: preciseLoc };
    }
  } catch (e) {
    console.error('[DVSC Location] Reverse geocoding failed:', e.message);
  }
  return { success: false };
});

// ─────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Grant microphone access for Voice Input (Speech Recognition)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'geolocation') {
      return callback(true);
    }
    callback(false);
  });

  // Initialize module instances that depend on the store
  const reminderMgr = new ReminderManager(store);
  const timetableMgr = new TimetableManager(store);
  reminderManager = reminderMgr;
  timetableManager = timetableMgr;

  // Tools the AI can call (web search, weather, reminders, PC control, WhatsApp, memory)
  toolExecutor = new ToolExecutor({
    store,
    reminderManager,
    timetableManager,
    whatsapp,
    get loudness() { return lazy.loudness; },
    get YouTube() { return lazy.YouTube; },
    getApiKey: () => store.get('settings').apiKey,
    getLocation: () => (dvsc ? dvsc.location : null),
  });

  // Create the main window
  createWindow();

  // Start WhatsApp (headless Chromium) only after the UI has loaded, so it doesn't slow the window
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => whatsapp.initWhatsApp(mainWindow), 4000);
  });

  // Initialize Gemini AI if API key exists
  initializeAI();

  // Initialize Location
  const currentSettings = store.get('settings', {});
  updateLocationStatus(currentSettings);

  // Initialize Edge Neural TTS
  tts.initialize().then(() => {
    console.log('[DVSC] Neural TTS engine ready.');
  });

  // Start the reminder scheduler
  reminderManager.startScheduler(mainWindow);

  // Offline class alerts (default: 15 minutes before each class in the timetable)
  classAlerts = new ClassAlertScheduler(store, timetableManager);
  classAlerts.start(mainWindow);

  // Setup System Tray
  // Removed setupSystemTray() to prevent background execution

  console.log('[SENJU] Application ready.');

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function setupSystemTray() {
  // Use SENJU app icon for the tray
  const iconPath = path.join(__dirname, 'assets', 'senju-icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(process.execPath) : icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '🌸 Open SENJU', click: () => { if(mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit SENJU', click: () => { isQuitting = true; app.quit(); } }
  ]);
  
  tray.setToolTip('SENJU (Listening) 🌸');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
        mainWindow.webContents.send('window-hidden');
      } else {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('window-shown');
      }
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (reminderManager) reminderManager.stopScheduler();
  if (classAlerts) classAlerts.stop();
  if (process.platform !== 'darwin') app.quit();
});
