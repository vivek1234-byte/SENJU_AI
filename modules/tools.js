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
      description: 'Send a WhatsApp message. Vivek must have given BOTH the contact and the exact message; if either is unclear, ask first instead of calling.',
      parameters: {
        type: 'object',
        properties: {
          contact: { type: 'string', description: 'Contact name as saved in WhatsApp.' },
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Web search via Groq's compound-mini (has built-in live web search, same API key). */
  async webSearch(query) {
    const apiKey = this.deps.getApiKey();
    const body = {
      model: 'groq/compound-mini',
      messages: [
        { role: 'system', content: `Today is ${new Date().toDateString()}. Search the web and give a factual, concise answer (max ~150 words) with key numbers and dates. Mention source site names.` },
        { role: 'user', content: query },
      ],
      temperature: 0.2,
      max_tokens: 700,
    };
    const tryModel = async (model) => {
      const data = await fetchJSON('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model }),
      }, 30000);
      return data.choices?.[0]?.message?.content || '';
    };
    try {
      return (await tryModel('groq/compound-mini')) || 'No results.';
    } catch (e) {
      console.warn('[SENJU Tools] compound-mini failed, trying compound:', e.message);
      return (await tryModel('groq/compound')) || 'No results.';
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
