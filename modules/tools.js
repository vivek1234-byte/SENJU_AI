/**
 * SENJU Tools
 * -----------
 * Real function-calling tools for the AI brain. The model decides WHEN to call
 * a tool; this module does the actual work and returns a short result string
 * that goes back to the model so it can answer truthfully.
 *
 * Replaces the old [COMMAND]/[REMINDER]/[TIMETABLE] text tags, which broke
 * whenever the model forgot a brace or a closing tag.
 */

const { exec, execFile } = require('child_process');

// ─────────────────────────────────────────────────────────────
// Tool schemas (OpenAI / Groq format)
// ─────────────────────────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the internet for fresh or factual info: news, scores, prices, people, facts, "who/what/when" questions, anything that may have changed recently. Returns a summarized answer you should then explain in your own words.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A clear, specific search query in English.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather and a 3-day forecast. Leave city empty to use Vivek\'s current location.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name, e.g. "Ahmedabad". Optional.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: 'Create a reminder/alarm. Work out the exact datetime from the current time given in the system prompt.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          datetime: { type: 'string', description: 'Local time, format YYYY-MM-DDTHH:mm' },
          repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'] },
        },
        required: ['title', 'datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: 'List Vivek\'s upcoming (not completed) reminders.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_timetable_entry',
      description: 'Add a recurring weekly slot to Vivek\'s timetable.',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          startTime: { type: 'string', description: 'HH:mm, 24-hour' },
          endTime: { type: 'string', description: 'HH:mm, 24-hour' },
          title: { type: 'string' },
          category: { type: 'string', enum: ['study', 'work', 'personal', 'health', 'other'] },
          block: { type: 'string', description: 'Venue: study block / building. Optional.' },
          room: { type: 'string', description: 'Venue: room number. Optional.' },
        },
        required: ['day', 'startTime', 'endTime', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_timetable_entry',
      description: 'Change an existing timetable entry (time, day, title, category, block, room). Call get_timetable first to find its id.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          day: { type: 'string', enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] },
          startTime: { type: 'string' },
          endTime: { type: 'string' },
          title: { type: 'string' },
          category: { type: 'string', enum: ['study', 'work', 'personal', 'health', 'other'] },
          block: { type: 'string' },
          room: { type: 'string' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_timetable',
      description: 'Read Vivek\'s timetable, optionally for one day (e.g. to answer "aaj kya hai?").',
      parameters: {
        type: 'object',
        properties: { day: { type: 'string', description: 'Lowercase day name. Optional.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_attendance',
      description: 'Record whether Vivek attended a class. Use when he says things like "DBMS attend kiya", "aaj Maths bunk kiya", or "class cancel ho gayi thi".',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'Subject / class name as in the timetable.' },
          status: { type: 'string', enum: ['present', 'absent', 'cancelled'] },
          date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        },
        required: ['subject', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_attendance',
      description: 'Attendance percentages per subject, how many classes he can still miss (or must attend) for his target, and classes not marked yet. Use for "meri attendance kitni hai", "kitni bunk kar sakta hu".',
      parameters: {
        type: 'object',
        properties: { subject: { type: 'string', description: 'Optional — one subject only.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_exam',
      description: 'Save an exam with its date and (optionally) the topics/syllabus. SENJU then builds a study plan automatically. Use for "15 tarikh ko DBMS ka exam hai".',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:mm, optional' },
          topics: { type: 'array', items: { type: 'string' }, description: 'Syllabus topics, optional but makes the plan much better.' },
          difficulty: { type: 'number', description: '1 = easy, 2 = normal, 3 = hard. Default 2.' },
        },
        required: ['subject', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_exams',
      description: 'Upcoming exams with days left and study progress.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_study_plan',
      description: 'The study sessions planned for a day (default today): time, subject and topic.',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD, defaults to today.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_study_done',
      description: 'Mark today\'s study session for a subject as completed ("DBMS wala study ho gaya").',
      parameters: {
        type: 'object',
        properties: {
          subject: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD, defaults to today.' },
        },
        required: ['subject'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_app',
      description: 'Open an application on Vivek\'s Windows PC.',
      parameters: {
        type: 'object',
        properties: { app: { type: 'string', description: 'App name, e.g. "chrome", "notepad", "vscode", "spotify".' } },
        required: ['app'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_volume',
      description: 'Change system volume.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string', description: '"up", "down", "mute", "unmute", or a number 0-100.' } },
        required: ['value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_music',
      description: 'Play a song or video on YouTube. Only call when you know WHAT to play; otherwise ask Vivek first.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Only the song / artist / video name, no filler words.' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_website',
      description: 'Open a URL or a Google search page in the browser. Use only when Vivek wants to SEE the page; to answer a question use web_search instead.',
      parameters: {
        type: 'object',
        properties: { url_or_query: { type: 'string' } },
        required: ['url_or_query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shutdown_pc',
      description: 'Schedule a PC shutdown in 60 seconds (can be cancelled). Only after Vivek clearly asked for shutdown.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_shutdown',
      description: 'Cancel a scheduled shutdown.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_whatsapp',
      description: 'Send a WhatsApp message. Call it as soon as Vivek has given a contact name (or number) and the message — do NOT ask him to confirm the name first; the tool finds the contact itself. Only if the tool replies that several contacts match, ask Vivek which one and call again with the name plus the last 4 digits it listed (e.g. "Shiva Singh 4521").',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Contact name exactly as Vivek said it, a phone number, "myself", or name + last 4 digits when disambiguating.' },
          message: { type: 'string', description: 'Exact message text to send.' },
        },
        required: ['contact', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_last_whatsapp',
      description: 'Delete (for everyone) the last WhatsApp message SENJU sent.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_fact',
      description: 'Save a lasting fact about Vivek to long-term memory (preferences, people, goals, routines, important dates). Call this on your own whenever Vivek shares something worth remembering. Do not save passwords or one-off trivia.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string', description: 'Short third-person fact, e.g. "Vivek\'s exams start 10 Oct".' } },
        required: ['fact'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_fact',
      description: 'Remove facts from long-term memory that match some text.',
      parameters: {
        type: 'object',
        properties: { match: { type: 'string' } },
        required: ['match'],
      },
    },
  },
  // ── Train travel agent ─────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_trains',
      description: 'Find Indian Railways trains between two stations on a date with approximate fares per class, duration, cheapest/fastest tags, average fare and booking-site fee comparison. Live seat availability is included when a RapidAPI key is configured. Use for any "train / ticket / kitna lagega / kaunsi train" question.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Origin station name or code, e.g. "Agra" or "AGC".' },
          to: { type: 'string', description: 'Destination station name or code, e.g. "Ahmedabad" or "ADI".' },
          date: { type: 'string', description: 'Journey date YYYY-MM-DD (resolve "kal", "next Friday" etc. from the current date).' },
          class: { type: 'string', description: 'Optional travel class: SL, 3A, 2A, 1A, 3E, CC, EC, 2S.' },
          sort: { type: 'string', enum: ['price', 'duration', 'departure'], description: 'Sort order. Default: price when a class is given, else departure time.' },
        },
        required: ['from', 'to', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_train_availability',
      description: 'Live seat availability / waitlist status for one train and class on a date (needs the RapidAPI key from Settings).',
      parameters: {
        type: 'object',
        properties: {
          train_no: { type: 'string', description: '5-digit train number' },
          from: { type: 'string' }, to: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          class: { type: 'string', description: 'SL, 3A, 2A, 1A, 3E, CC, EC or 2S' },
          quota: { type: 'string', enum: ['GN', 'TQ', 'LD', 'SS'], description: 'GN general (default), TQ tatkal, LD ladies, SS senior citizen' },
        },
        required: ['train_no', 'from', 'to', 'date', 'class'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_booking_sites',
      description: 'Compare total payable on IRCTC, ConfirmTkt, ixigo, RailYatri, Paytm and MakeMyTrip for a given train fare (base fare is identical everywhere; only fees differ).',
      parameters: {
        type: 'object',
        properties: { fare: { type: 'number', description: 'Base fare in rupees' } },
        required: ['fare'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_train_booking',
      description: 'Open a booking website in the browser with the search pre-filled so Vivek can log in and pay himself. Never books or pays on its own.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          class: { type: 'string' },
          site: { type: 'string', enum: ['irctc', 'confirmtkt', 'ixigo', 'railyatri', 'paytm', 'mmt'], description: 'Default irctc (no agent fee).' },
        },
        required: ['from', 'to', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'watch_train_seat',
      description: 'Keep checking a waitlisted train every ~20 minutes and alert Vivek (desktop + WhatsApp) the moment a seat/RAC opens. Needs the RapidAPI key.',
      parameters: {
        type: 'object',
        properties: {
          train_no: { type: 'string' }, train_name: { type: 'string' },
          from: { type: 'string' }, to: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          class: { type: 'string' },
        },
        required: ['train_no', 'from', 'to', 'date', 'class'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_train_watches',
      description: 'List active seat watches with their last known status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_train_watch',
      description: 'Stop a seat watch by id (from list_train_watches), or all of them.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Watch id, or "all"' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pnr_status',
      description: 'Current PNR status (train, journey, coach/berth, CNF/RAC/WL per passenger, chart status). Takes ~10-20 seconds — it reads the live status page in a hidden browser.',
      parameters: {
        type: 'object',
        properties: { pnr: { type: 'string', description: '10-digit PNR' } },
        required: ['pnr'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_train',
      description: 'Start the IRCTC booking agent: opens a visible Chrome, searches the train, selects class/date, clicks Book Now, fills passenger details from saved travellers and stops at the review/payment step for Vivek to enter captcha and pay. Vivek does IRCTC login himself when the agent asks. Returns immediately; progress arrives as status updates.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' }, to: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          class: { type: 'string', description: 'SL, 3A, 2A, 1A, 3E, CC, EC or 2S' },
          train_no: { type: 'string', description: '5-digit train number (recommended)' },
          train_name: { type: 'string' },
          travellers: { type: 'array', items: { type: 'string' }, description: 'Saved traveller names, e.g. ["Vivek","Papa"]. Empty = the self profile.' },
          mobile: { type: 'string', description: 'Optional 10-digit mobile for the booking' },
          upi_only: { type: 'boolean', description: 'Prefer the BHIM/UPI payment option on the passenger page' },
        },
        required: ['from', 'to', 'date', 'class'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'booking_status',
      description: 'Current state of the IRCTC booking agent (idle, running, need_user, handoff, error).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_booking',
      description: 'Stop the IRCTC booking agent.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_traveller',
      description: 'Save a traveller profile used by the booking agent (name, age, gender, berth preference). Use is_self=true for Vivek himself.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Full name as on ID' },
          age: { type: 'integer' },
          gender: { type: 'string', enum: ['M', 'F', 'T'] },
          berth: { type: 'string', enum: ['LB', 'MB', 'UB', 'SL', 'SU', 'NP'], description: 'Lower/Middle/Upper/Side Lower/Side Upper/No preference' },
          alias: { type: 'string', description: 'How Vivek refers to them, e.g. "papa", "mummy", "bhai"' },
          is_self: { type: 'boolean' },
        },
        required: ['name', 'age', 'gender'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_travellers',
      description: 'List saved traveller profiles.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_traveller',
      description: 'Delete a saved traveller by name.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'train_live_status',
      description: 'Live running status: where a train is right now, delay, next station and ETA. Takes ~10-20 seconds — it reads the live status page in a hidden browser.',
      parameters: {
        type: 'object',
        properties: {
          train_no: { type: 'string', description: '5-digit train number' },
          start_day: { type: 'integer', description: '0 = started today, 1 = started yesterday, 2 = day before' },
        },
        required: ['train_no'],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function openInBrowser(url) {
  // execFile avoids shell-injection from model-generated text
  execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, (err) => {
    if (err) console.error('[SENJU Tools] open url failed:', err.message);
  });
}

const APP_MAP = {
  'google chrome': 'chrome', chrome: 'chrome',
  'microsoft edge': 'msedge', edge: 'msedge',
  word: 'winword', 'microsoft word': 'winword',
  excel: 'excel', 'microsoft excel': 'excel',
  powerpoint: 'powerpnt', 'microsoft powerpoint': 'powerpnt',
  vscode: 'code', 'vs code': 'code', 'visual studio code': 'code',
  calculator: 'calc', calc: 'calc',
  notepad: 'notepad', paint: 'mspaint',
  'file explorer': 'explorer', explorer: 'explorer',
  'task manager': 'taskmgr', cmd: 'cmd', terminal: 'wt',
  settings: 'ms-settings:', spotify: 'spotify:', whatsapp: 'whatsapp:',
};

const WMO = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

// ─────────────────────────────────────────────────────────────
// System command runner (also used by the legacy execute-command IPC)
// ─────────────────────────────────────────────────────────────
async function runSystemCommand(cmd, deps) {
  const { loudness, YouTube } = deps;

  if (cmd.action === 'open_app') {
    const raw = String(cmd.target || '').toLowerCase().replace(/_/g, ' ').trim();
    if (!raw) throw new Error('No app specified');
    const mapped = APP_MAP[raw] || raw.replace(/\s+/g, '');
    // Allow only safe characters — the name comes from the model
    if (!/^[a-z0-9._:-]+$/i.test(mapped)) throw new Error(`Unsafe app name: ${raw}`);
    execFile('cmd.exe', ['/c', 'start', '', mapped], { windowsHide: true }, (err) => {
      if (err) console.error(`[SENJU Tools] open_app ${mapped} failed:`, err.message);
    });
    return `Opening ${raw}.`;
  }

  if (cmd.action === 'volume') {
    const v = String(cmd.value || '').toLowerCase();
    if (v === 'up' || v === 'down') {
      const vol = await loudness.getVolume();
      const next = v === 'up' ? Math.min(100, vol + 20) : Math.max(0, vol - 20);
      await loudness.setVolume(next);
      return `Volume is now ${next}%.`;
    }
    if (v === 'mute') { await loudness.setMuted(true); return 'Muted.'; }
    if (v === 'unmute') { await loudness.setMuted(false); return 'Unmuted.'; }
    const num = parseInt(v, 10);
    if (isNaN(num)) throw new Error(`Invalid volume value: ${cmd.value}`);
    const clamped = Math.max(0, Math.min(100, num));
    await loudness.setVolume(clamped);
    return `Volume set to ${clamped}%.`;
  }

  if (cmd.action === 'search_web') {
    const target = String(cmd.target || '').trim();
    if (!target) throw new Error('No search query');
    const url = /^https?:\/\//i.test(target) ? target : `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    openInBrowser(url);
    return `Opened ${url} in the browser.`;
  }

  if (cmd.action === 'play_music') {
    const query = String(cmd.target || '').trim();
    if (!query) throw new Error('No song specified');
    try {
      const videos = await YouTube.search(query, { limit: 5, type: 'video' });
      if (videos && videos.length) {
        const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
        const best = videos.find((v) => words.every((w) => (v.title || '').toLowerCase().includes(w))) || videos[0];
        openInBrowser(best.url);
        return `Playing "${best.title}" on YouTube.`;
      }
    } catch (e) {
      console.error('[SENJU Tools] YouTube search failed:', e.message);
    }
    openInBrowser(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
    return `Opened YouTube results for "${query}".`;
  }

  if (cmd.action === 'shutdown') {
    exec('shutdown /s /t 60', (err) => err && console.error('[SENJU Tools] shutdown failed:', err.message));
    return 'Shutdown scheduled in 60 seconds. Say "cancel shutdown" to stop it.';
  }

  if (cmd.action === 'cancel_shutdown') {
    exec('shutdown /a', () => {});
    return 'Shutdown cancelled.';
  }

  throw new Error(`Unknown action: ${cmd.action}`);
}

// ─────────────────────────────────────────────────────────────
// Tool executor
// ─────────────────────────────────────────────────────────────
class ToolExecutor {
  /**
   * @param {object} deps - { store, reminderManager, timetableManager, whatsapp, loudness, YouTube, getApiKey, getLocation }
   */
  constructor(deps) {
    this.deps = deps;
  }

  // Long-term memory ---------------------------------------------------------
  getMemories() {
    return this.deps.store.get('memories', []);
  }

  async execute(name, args, ctx) {
    const d = this.deps;
    switch (name) {
      case 'web_search':
        return this.webSearch(args.query);

      case 'get_weather':
        return this.weather(args.city);

      case 'set_reminder': {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(args.datetime || '')) {
          throw new Error('datetime must be YYYY-MM-DDTHH:mm');
        }
        const r = d.reminderManager.add({
          title: args.title,
          description: args.description || '',
          datetime: args.datetime.slice(0, 16),
          repeat: args.repeat || 'none',
        });
        ctx.refresh.add('reminders');
        return `Reminder saved: "${r.title}" at ${r.datetime}${r.repeat && r.repeat !== 'none' ? ` (${r.repeat})` : ''}.`;
      }

      case 'list_reminders': {
        const now = Date.now();
        const list = d.reminderManager.getAll()
          .filter((r) => !r.completed)
          .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
          .slice(0, 15);
        if (!list.length) return 'No active reminders.';
        return list.map((r) => `- ${r.title} @ ${r.datetime}${new Date(r.datetime).getTime() < now ? ' (past)' : ''}`).join('\n');
      }

      case 'add_timetable_entry': {
        const e = d.timetableManager.add(args);
        ctx.refresh.add('timetable');
        return `Timetable updated: ${e.title} on ${e.day} ${e.startTime}-${e.endTime}.`;
      }

      case 'update_timetable_entry': {
        const { id, ...updates } = args;
        const e = d.timetableManager.update(id, updates);
        if (!e) throw new Error(`No timetable entry with id ${id}`);
        ctx.refresh.add('timetable');
        return `Updated: ${e.title} on ${e.day} ${e.startTime}-${e.endTime}${e.block || e.room ? ` @ ${[e.block, e.room].filter(Boolean).join(' ')}` : ''}.`;
      }

      case 'get_timetable': {
        let entries = d.timetableManager.getAll();
        if (args.day) entries = entries.filter((e) => e.day === String(args.day).toLowerCase());
        if (!entries.length) return 'Timetable is empty for that.';
        return entries
          .sort((a, b) => (a.day + a.startTime).localeCompare(b.day + b.startTime))
          .map((e) => `- [id ${e.id}] ${e.day} ${e.startTime}-${e.endTime}: ${e.title} [${e.category}]${e.block || e.room ? ` @ ${[e.block, e.room ? 'Room ' + e.room : ''].filter(Boolean).join(', ')}` : ''}`)
          .join('\n');
      }

      case 'mark_attendance': {
        const { record, stats } = d.attendance.mark({ subject: args.subject, status: args.status, date: args.date });
        ctx.refresh.add('attendance');
        const pctText = stats.pct == null ? '' : ` ${stats.subject}: ${stats.pct}% (${stats.present}/${stats.total}). ${stats.advice}.`;
        return `Marked ${record.subject} as ${record.status} on ${record.date}.${pctText}`;
      }

      case 'get_attendance': {
        const o = d.attendance.getOverview();
        if (args.subject) {
          const s = d.attendance.getSubjectStats(args.subject);
          return `${s.subject}: ${s.pct == null ? 'nothing marked yet' : `${s.pct}% (${s.present}/${s.total})`}. Target ${o.target}%. ${s.advice}.`;
        }
        if (!o.subjects.length) return 'No attendance data yet.';
        const lines = o.subjects.map((s) => `- ${s.subject}: ${s.pct == null ? 'not marked' : `${s.pct}% (${s.present}/${s.total})`} — ${s.advice}`);
        const pend = o.pending.length ? `\nNot marked yet: ${o.pending.slice(0, 5).map((p) => `${p.subject} (${p.date})`).join(', ')}` : '';
        return `Target ${o.target}%. Overall ${o.overallPct == null ? '—' : o.overallPct + '%'}\n${lines.join('\n')}${pend}`;
      }

      case 'add_exam': {
        const ex = d.studyPlanner.addExam(args);
        ctx.refresh.add('exams');
        const saved = d.studyPlanner.getOverview().exams.find((e) => e.id === ex.id);
        const days = saved ? saved.daysLeft : 0;
        const today = d.studyPlanner.getPlanText();
        return `Exam saved: ${ex.subject} on ${ex.date}${ex.time ? ' at ' + ex.time : ''} (${days === 0 ? 'today' : days + ' day(s) away'}). Study plan updated.\nToday's plan:\n${today}`;
      }

      case 'list_exams': {
        const o = d.studyPlanner.getOverview();
        if (!o.exams.length) return 'No exams saved.';
        return o.exams
          .map((e) => `- ${e.subject}: ${e.date}${e.time ? ' ' + e.time : ''} — ${e.daysLeft < 0 ? 'done' : e.daysLeft + ' day(s) left'}, study ${e.sessionsDone}/${e.sessionsPlanned} sessions${e.topics.length ? `, topics: ${e.topics.slice(0, 6).join(', ')}` : ''}`)
          .join('\n');
      }

      case 'get_study_plan':
        return d.studyPlanner.getPlanText(args.date);

      case 'mark_study_done': {
        const o = d.studyPlanner.getOverview();
        const day = args.date || (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; })();
        const list = [...o.today, ...o.next7].filter(
          (s) => s.date === day && s.subject.toLowerCase().includes(String(args.subject).toLowerCase()) && !s.done
        );
        if (!list.length) return `No pending study session for ${args.subject} on ${day}.`;
        d.studyPlanner.setSessionDone(list[0].id, true);
        ctx.refresh.add('exams');
        return `Marked done: ${list[0].subject} — ${list[0].topic} (${list[0].start}).`;
      }

      case 'open_app':
        return runSystemCommand({ action: 'open_app', target: args.app }, d);
      case 'set_volume':
        return runSystemCommand({ action: 'volume', value: args.value }, d);
      case 'play_music':
        return runSystemCommand({ action: 'play_music', target: args.query }, d);
      case 'open_website':
        return runSystemCommand({ action: 'search_web', target: args.url_or_query }, d);
      case 'shutdown_pc':
        return runSystemCommand({ action: 'shutdown' }, d);
      case 'cancel_shutdown':
        return runSystemCommand({ action: 'cancel_shutdown' }, d);

      case 'send_whatsapp':
        return d.whatsapp.sendMessage(args.contact, args.message);
      case 'delete_last_whatsapp':
        return d.whatsapp.deleteLastWhatsAppMessage();

      case 'remember_fact': {
        const fact = String(args.fact || '').trim();
        if (!fact) throw new Error('Empty fact');
        const mem = this.getMemories();
        if (!mem.some((m) => m.text.toLowerCase() === fact.toLowerCase())) {
          mem.push({ text: fact, createdAt: new Date().toISOString() });
          d.store.set('memories', mem.slice(-150));
        }
        return 'Saved to memory.';
      }

      case 'forget_fact': {
        const needle = String(args.match || '').toLowerCase();
        const mem = this.getMemories();
        const kept = mem.filter((m) => !m.text.toLowerCase().includes(needle));
        d.store.set('memories', kept);
        return `Removed ${mem.length - kept.length} memory item(s).`;
      }

      // ── Trains ─────────────────────────────────────────────
      case 'search_trains': {
        if (!d.trains) throw new Error('Train agent not available.');
        const r = await d.trains.search({ from: args.from, to: args.to, date: args.date, cls: args.class, sort: args.sort });
        ctx.refresh.add('travel');
        d.trains.lastSearch = r;
        d.trains.emit('train-search-result', r); // Travel tab shows the full list
        return d.trains.formatSearchForModel(r);
      }

      case 'check_train_availability': {
        const a = await d.trains.availability({ trainNo: args.train_no, from: args.from, to: args.to, date: args.date, cls: args.class, quota: args.quota || 'GN' });
        return `${args.train_no} ${args.from}→${args.to} ${args.date} ${a.cls}/${a.quota}: ${a.text}${a.probability != null ? ` (confirm chance ${a.probability}%)` : ''}${a.fare ? `, fare ₹${a.fare}` : ''}.`;
      }

      case 'compare_booking_sites': {
        const c = d.trains.compareSites(args.fare);
        return `For a ₹${c.fare} fare: ${c.rows.map((s) => `${s.name} ₹${s.total} (+₹${s.extra})`).join(', ')}. ${c.note}`;
      }

      case 'open_train_booking': {
        const info = d.trains.openBooking({ from: args.from, to: args.to, date: args.date, cls: args.class, site: args.site || 'irctc' });
        return `Opened ${info.site} for ${info.from}→${info.to} on ${info.date}${info.prefill ? ' with the search pre-filled' : ' (IRCTC does not accept pre-filled searches — enter stations and date there)'}. Vivek must log in, pick the train and pay himself; SENJU never enters OTP, captcha or payment.`;
      }

      case 'watch_train_seat': {
        const w = d.trains.addWatch({ trainNo: args.train_no, trainName: args.train_name, from: args.from, to: args.to, date: args.date, cls: args.class });
        ctx.refresh.add('travel');
        return `Watching ${w.trainNo} ${w.trainName || ''} ${w.from}→${w.to} on ${w.date} (${w.cls}). I check every 20 minutes and will alert on desktop and WhatsApp when a seat or RAC opens. Watch id: ${w.id}.`;
      }

      case 'list_train_watches': {
        const list = d.trains.getWatches().filter((w) => w.active);
        if (!list.length) return 'No active seat watches.';
        return list.map((w) => `- [${w.id}] ${w.trainNo} ${w.trainName || ''} ${w.from}→${w.to} ${w.date} ${w.cls}: ${w.lastText || 'not checked yet'}${w.lastCheckedAt ? ` (checked ${new Date(w.lastCheckedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})` : ''}`).join('\n');
      }

      case 'cancel_train_watch': {
        const id = String(args.id || '').trim();
        if (id.toLowerCase() === 'all') {
          const n = d.trains.getWatches().length;
          d.trains.saveWatches([]);
          ctx.refresh.add('travel');
          return `Removed ${n} watch(es).`;
        }
        const res = d.trains.removeWatch(id);
        ctx.refresh.add('travel');
        return res.removed ? 'Watch removed.' : `No watch with id ${id}.`;
      }

      case 'get_pnr_status': {
        const p = await d.trains.pnrStatus(args.pnr);
        if (p.invalid) return `PNR ${p.pnr}: ${p.raw}`;
        const pax = p.passengers.map((x) => `P${x.no}: ${x.current || x.booking}${x.coach ? ` (${x.coach}${x.berth ? '/' + x.berth : ''})` : ''}${x.confirmChance ? `, confirm chance ${x.confirmChance}` : ''}`).join('; ');
        const chart = p.chartPrepared == null ? '' : ` Chart: ${p.chartPrepared === true || /prepared|yes/i.test(String(p.chartPrepared)) ? 'prepared' : 'not prepared'}.`;
        const head = [p.train, p.from && p.to ? `${p.from} → ${p.to}` : '', p.date, p.cls].filter(Boolean).join(' · ');
        return `PNR ${p.pnr} (${p.source}): ${head || 'details not parsed'}. ${pax || (p.raw ? `Page text:\n${p.raw}` : 'No passenger rows found.')}${chart}${p.note ? ` ${p.note}` : ''}`;
      }

      case 'book_train': {
        if (!d.booking) throw new Error('Booking agent not available.');
        const st = await d.booking.book({ from: args.from, to: args.to, date: args.date, cls: args.class, trainNo: args.train_no, trainName: args.train_name, travellers: args.travellers || [], mobile: args.mobile, upiOnly: !!args.upi_only });
        ctx.refresh.add('travel');
        const pax = st.job.travellers.map((t) => t.name).join(', ');
        return `Booking agent started for ${st.job.trainNo || 'best train'} ${st.job.from}→${st.job.to} on ${st.job.date} (${st.job.cls}) for ${pax}. A Chrome window is opening; it will ask Vivek to log in to IRCTC (user ID, password, captcha) and then fill everything up to the review/payment page. Tell Vivek to watch for the login prompt; do not claim the ticket is booked.`;
      }

      case 'booking_status': {
        const st = d.booking.getStatus();
        if (st.state === 'idle') return 'Booking agent is idle.';
        return `Booking agent: ${st.state} — ${st.message} (step ${st.step}). Last actions: ${(st.history || []).slice(-4).map((h) => h.reason || h.action).join('; ') || 'none'}.`;
      }

      case 'cancel_booking': {
        const st = await d.booking.cancel();
        ctx.refresh.add('travel');
        return `Booking agent ${st.state}.`;
      }

      case 'add_traveller': {
        const t = d.booking.addTraveller({ name: args.name, age: args.age, gender: args.gender, berth: args.berth, alias: args.alias, isSelf: !!args.is_self });
        ctx.refresh.add('travel');
        return `Saved traveller: ${t.name}, ${t.age}, ${t.gender}, berth ${t.berth}${t.alias ? ` (${t.alias})` : ''}${t.isSelf ? ' (self)' : ''}.`;
      }

      case 'list_travellers': {
        const list = d.booking.getTravellers();
        if (!list.length) return 'No travellers saved yet.';
        return list.map((t) => `- ${t.name}: ${t.age} ${t.gender}, berth ${t.berth}${t.alias ? ` (${t.alias})` : ''}${t.isSelf ? ' (self)' : ''}`).join('\n');
      }

      case 'remove_traveller': {
        const r = d.booking.removeTraveller(args.name);
        ctx.refresh.add('travel');
        return r.removed ? `Removed ${args.name}.` : `No traveller named ${args.name}.`;
      }

      case 'train_live_status': {
        const s = await d.trains.liveStatus(args.train_no, args.start_day || 0);
        const up = s.upcoming.length ? ` Upcoming: ${s.upcoming.map((u) => `${u.name}${u.eta ? ' ' + u.eta : ''}${u.delay ? ` (${u.delay})` : ''}`).join(', ')}.` : '';
        if (!s.status && !s.currentStation && s.raw) return `${s.trainNo} live status page text (${s.source}):\n${s.raw}`;
        return `${s.trainNo} ${s.trainName} (${s.source}): ${s.status || 'status unknown'}${s.currentStation ? ` · at ${s.currentStation}` : ''}${s.delayMin != null ? ` · delay ${s.delayMin} min` : ''}${s.nextStation ? ` · next ${s.nextStation}${s.eta ? ' ETA ' + s.eta : ''}` : ''}${s.lastUpdated ? ` (updated ${s.lastUpdated})` : ''}.${s.note ? ` ${s.note}` : ''}${up}`;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Web search using Groq's built-in browser_search tool (gpt-oss models). */
  async webSearch(query) {
    const apiKey = this.deps.getApiKey();
    const ask = async (model) => {
      const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `Today is ${new Date().toDateString()}. Search the web and answer factually in under 150 words, with key numbers, dates and the source site names.` },
            { role: 'user', content: query },
          ],
          tools: [{ type: 'browser_search' }],
          tool_choice: 'required',
          temperature: 1,
          reasoning_effort: 'low',
          max_tokens: 900,
        }),
      }, 45000);
      return (data.choices?.[0]?.message?.content || '').trim();
    };

    try {
      return (await ask('openai/gpt-oss-120b')) || 'No results.';
    } catch (e) {
      console.warn('[SENJU Tools] browser search on 120b failed:', e.message);
      try {
        return (await ask('openai/gpt-oss-20b')) || 'No results.';
      } catch (e2) {
        return `Web search unavailable right now (${String(e2.message).slice(0, 120)}). Answer from what you know and say it may be outdated.`;
      }
    }
  }

  /** Weather via Open-Meteo (free, no key). */
  async weather(city) {
    let lat, lon, label;
    if (city && city.trim()) {
      const geo = await fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.trim())}&count=1`);
      if (!geo.results || !geo.results.length) return `Couldn't find a place called "${city}".`;
      ({ latitude: lat, longitude: lon } = geo.results[0]);
      label = `${geo.results[0].name}, ${geo.results[0].country || ''}`;
    } else {
      const loc = this.deps.getLocation() || '';
      const m = loc.match(/Lat:\s*(-?[\d.]+),\s*Lon:\s*(-?[\d.]+)/);
      if (!m) return 'Location unknown. Ask Vivek which city, or ask him to enable location in Settings.';
      lat = m[1]; lon = m[2];
      label = loc.replace(/\s*\(Lat:.*\)$/, '').replace(/^Exact Address:\s*/, '');
    }
    const w = await fetchJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=3&timezone=auto'
    );
    const c = w.current;
    const days = w.daily.time.map((t, i) =>
      `${t}: ${WMO[w.daily.weather_code[i]] || 'mixed'}, ${Math.round(w.daily.temperature_2m_min[i])}-${Math.round(w.daily.temperature_2m_max[i])}°C, rain ${w.daily.precipitation_probability_max[i] ?? '?'}%`
    ).join('\n');
    return `Weather for ${label}:\nNow: ${Math.round(c.temperature_2m)}°C (feels ${Math.round(c.apparent_temperature)}°C), ${WMO[c.weather_code] || 'mixed'}, humidity ${c.relative_humidity_2m}%, wind ${Math.round(c.wind_speed_10m)} km/h\n${days}`;
  }
}

module.exports = { TOOL_DEFINITIONS, ToolExecutor, runSystemCommand };
