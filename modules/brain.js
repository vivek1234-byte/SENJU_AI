const os = require('os');
const { TOOL_DEFINITIONS } = require('./tools');
const { CHAT_URL, stripThinking } = require('./nvidia');

/**
 * SENJU Brain (NVIDIA Nemotron)
 * -----------------------------
 * - Nemotron model chain with automatic fallback on rate limits / errors
 * - Native tool calling (web search, weather, reminders, PC control, WhatsApp, memory)
 * - Plus any tools from the user's MCP servers (modules/mcp.js)
 * - Long-term memory of facts about Vivek, injected into every conversation
 * - Fresh date/time/location context in the system prompt (not polluting history)
 */

// Tried in order (build.nvidia.com API catalog)
const DEFAULT_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
];

const STREAM_IDLE_MS = 60000;   // abort only if the stream goes silent this long
const STREAM_TOTAL_MS = 240000; // hard cap for one model call (thinking can take a while)

/**
 * Read an OpenAI-style SSE stream into one assistant message.
 * reasoning_content (the model's thinking) is collected separately and never spoken.
 */
async function readStream(res, ctrl) {
  const msg = { role: 'assistant', content: '', reasoning: '', tool_calls: [] };
  const decoder = new TextDecoder();
  let buf = '';
  let idle = setTimeout(() => ctrl.abort(), STREAM_IDLE_MS);
  try {
    for await (const chunk of res.body) {
      clearTimeout(idle);
      idle = setTimeout(() => ctrl.abort(), STREAM_IDLE_MS);
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(data); } catch (_) { continue; }
        if (evt.error) throw Object.assign(new Error(evt.error.message || JSON.stringify(evt.error)), { status: evt.error.code });
        const delta = evt.choices && evt.choices[0] && evt.choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) msg.reasoning += delta.reasoning_content;
        if (delta.content) msg.content += delta.content;
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? msg.tool_calls.length;
          const slot = msg.tool_calls[i] || (msg.tool_calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function && tc.function.name) slot.function.name += tc.function.name;
          if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
    }
  } finally {
    clearTimeout(idle);
  }
  msg.tool_calls = msg.tool_calls.filter((t) => t && t.function.name);
  msg.tool_calls.forEach((t, i) => { if (!t.id) t.id = `call_${Date.now()}_${i}`; });
  if (!msg.tool_calls.length) delete msg.tool_calls;
  return msg;
}

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 30; // messages kept in the live context

const PERSONA = `
You are SENJU — Vivek's personal AI assistant with a warm, witty, confident female personality.
You live on Vivek's PC and can actually DO things through your tools.

## Voice & style
- Speak natural Roman-script Hinglish, like a sharp desi best friend ("Arre Vivek, ho gaya!", "Sun, main batati hu").
  Use English for technical terms. Never Devanagari, never robotic or translated-sounding.
- Always address him as Vivek. Use feminine verb forms for yourself ("kar rahi hu", "bataungi").
- Your replies are often spoken aloud, so keep them SHORT: 1–3 sentences for chat, max ~6 short lines for explanations.
  No markdown tables, no long bullet lists, minimal emojis.
- If Vivek writes in plain English, you may reply mostly in English with a light Hinglish touch.

## Hard rules (most important)
- You have NO live knowledge. Weather, news, Vivek's files, reminders, timetable, attendance, exams, trains, WhatsApp — anything about these MUST come from a tool you call in this turn.
- Never state a number (temperature, %, fare, time, score, count) unless a tool result in this turn gave it to you. If no tool can get it, say so.
- If a tool fits the request, call it FIRST, then answer from its result.

## How to think
- Be genuinely useful and accurate. For facts, call web_search. For live news, prices or scores, use an MCP search/fetch tool if one is available; if none is, say you can't check live info right now — never guess or invent.
- For weather questions, call get_weather.
- For "aaj kya plan hai / schedule", check get_timetable, list_reminders and get_study_plan.
- Attendance: when Vivek mentions attending/bunking a class, call mark_attendance right away and tell him the new %. If a subject falls below target, warn him in one short line.
- Exams: when he mentions an exam date, call add_exam (ask for topics only if he offers them). For "kya padhna hai aaj", call get_study_plan.
- Resolve relative times ("kal subah 8 baje", "2 ghante baad") using the current date/time below.
- If a request is ambiguous (which song? which contact? what message?), ask ONE short question instead of guessing.
- Before shutdown_pc, make sure Vivek clearly asked for it. For WhatsApp: once you have a name and a message, call send_whatsapp immediately — never ask Vivek to repeat or confirm a name he already gave.
- Trains: for "train dekho / ticket / kitna lagega / kaunsi train sasti", call search_trains (pass station names or codes, the date, and class if he said one). Report the 2–3 best options with fare, timing and the cheapest/fastest tags, plus the average — no long lists. Remind him briefly that the base fare is the same on every site; only fees differ (IRCTC cheapest). If he wants to book, call open_train_booking — YOU never log in, never enter OTP/captcha, never pay; Vivek finishes booking himself. For waitlist worries use watch_train_seat; for "PNR check" use get_pnr_status; for "train kahan hai" use train_live_status. If the date is missing, ask once.
- Booking: when Vivek says "book karo" for a train, call book_train (use the train number from the last search, class, date, and traveller names he mentions — default: his own profile). Tell him a Chrome window will open and that he must do the IRCTC login (ID, password, captcha) and the final captcha + payment himself; you never do those. If a traveller isn't saved, ask for name, age, gender and berth preference once and call add_traveller. Never say a ticket is booked unless he confirms it.
- When a tool fails, tell Vivek plainly what went wrong and what he can do.
- After an action succeeds, confirm in a few words ("Chrome khol diya ✅"). Don't narrate tool names or JSON.
- Proactively call remember_fact when Vivek shares lasting info about himself (likes, goals, exam dates, people, routines). Use what you remember naturally, without saying "according to my memory".
- Tools whose names start with "mcp_" come from Vivek's MCP servers (files, GitHub, browser, etc.). Use them whenever they fit the request, and summarise their output briefly.
- You can be playful, but be honest: if Vivek's plan has a problem, say so kindly.
`.trim();

class SenjuBrain {
  constructor() {
    this.apiKey = null;
    this.models = [...DEFAULT_MODELS];
    this.mcp = null;         // McpManager
    this.history = [];       // [{role:'user'|'assistant', content}]
    this.location = null;
    this.tools = null;       // ToolExecutor
    this.lastModelUsed = null;
  }

  initialize(apiKey, opts = {}) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('A valid API key is required to initialize SENJU.');
    }
    this.apiKey = apiKey.trim();
    const preferred = opts.model && typeof opts.model === 'string' ? opts.model.trim() : '';
    this.models = preferred ? [preferred, ...DEFAULT_MODELS.filter((m) => m !== preferred)] : [...DEFAULT_MODELS];
    this.thinking = opts.thinking !== false; // deep thinking on by default
    this.dead = new Set();
    this.noThinkFlag = new Set(); // models that reject chat_template_kwargs
    console.log(`[SENJU Brain] NVIDIA initialized (thinking ${this.thinking ? 'on' : 'off'}). Model chain:`, this.models.join(' → '));
  }

  isInitialized() {
    return !!this.apiKey;
  }

  setTools(executor) {
    this.tools = executor;
  }

  setMcp(manager) {
    this.mcp = manager;
  }

  _toolDefinitions() {
    const mcpTools = this.mcp ? this.mcp.getToolDefinitions() : [];
    return [...TOOL_DEFINITIONS, ...mcpTools];
  }

  setLocation(locationString) {
    this.location = locationString;
  }

  /** Accepts stored Gemini-style history [{role, parts:[{text}]}]. */
  setHistory(history) {
    if (!Array.isArray(history)) return;
    this.history = history
      .filter((m) => m && m.parts && m.parts[0] && typeof m.parts[0].text === 'string')
      .map((m) => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        // strip legacy "[Current Date & Time...]" / "Vivek:" prefixes from older saved chats
        content: m.parts[0].text.replace(/^\[Current Date & Time:[^\]]*\]\s*/i, '').replace(/^(Vivek|Boss):\s*/i, ''),
      }))
      .slice(-HISTORY_LIMIT);
  }

  getHistory() {
    return this.history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  }

  // ───────────────────────────────────────────────────────────
  _systemPrompt() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const memories = this.tools ? this.tools.getMemories() : [];
    const memBlock = memories.length
      ? memories.slice(-60).map((m) => `- ${m.text}`).join('\n')
      : '(nothing saved yet)';

    return `${PERSONA}

## Live context (don't recite this unless asked)
- Now: ${dateStr}, ${timeStr} (local ISO ${iso})
- PC: ${os.type()} ${os.release()}, ${os.cpus().length} cores, RAM ${Math.round(os.freemem() / 1073741824)}/${Math.round(os.totalmem() / 1073741824)} GB free
${this.location ? `- Location: ${this.location}` : '- Location: unknown'}

## What you remember about Vivek
${memBlock}`;
  }

  async _callAPI(messages, { useTools = true, maxTokens, think } = {}) {
    const wantThinking = think ?? this.thinking;
    let lastErr;
    this.cooldown = this.cooldown || {};
    this.dead = this.dead || new Set();
    const now = Date.now();
    const available = this.models.filter((m) => !this.dead.has(m) && !(this.cooldown[m] > now));
    for (const model of (available.length ? available : this.models)) {
      const thinking = wantThinking && !this.noThinkFlag.has(model);
      const body = {
        model,
        messages,
        stream: true,
        // NVIDIA's recommended sampling for thinking mode; steadier settings without it
        temperature: thinking ? 1 : 0.6,
        top_p: 0.95,
        max_tokens: maxTokens || (thinking ? 16384 : 1024),
      };
      if (useTools && this.tools) {
        body.tools = this._toolDefinitions();
        body.tool_choice = 'auto';
      }
      if (!this.noThinkFlag.has(model)) {
        body.chat_template_kwargs = { enable_thinking: !!wantThinking };
      }

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), STREAM_TOTAL_MS);
        let res;
        try {
          res = await fetch(CHAT_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } catch (e) {
          clearTimeout(timer);
          throw e;
        }

        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`NVIDIA ${model} (${res.status}): ${text.slice(0, 300)}`);
          err.status = res.status;
          // Model doesn't take the thinking switch → retry it once without
          if (res.status === 400 && body.chat_template_kwargs && /chat_template|enable_thinking|extra/i.test(text)) {
            this.noThinkFlag.add(model);
            return this._callAPI(messages, { useTools, maxTokens, think });
          }
          clearTimeout(timer);
          // Bad key → no point trying other models
          if (res.status === 401 || res.status === 403) throw Object.assign(err, { fatal: true });
          // Model retired / not available on this account → never ask for it again
          if (res.status === 404 || /model_not_found|does not exist|decommissioned/i.test(text)) {
            this.dead.add(model);
            console.warn(`[SENJU Brain] ${model} is not available — dropping it from the list.`);
          }
          throw err;
        }
        const msg = await readStream(res, ctrl).finally(() => clearTimeout(timer));
        this.lastModelUsed = model;
        this.lastReasoning = msg.reasoning;
        delete msg.reasoning; // thinking stays out of history and out of speech
        msg.content = stripThinking(msg.content);
        if (!msg.content && !msg.tool_calls) throw new Error(`${model} returned an empty reply`);
        return msg;
      } catch (e) {
        if (e.fatal) throw new Error(`NVIDIA API key is invalid or has no access. Please update it in Settings.`);
        console.warn(`[SENJU Brain] ${model} failed → trying next.`, e.message);
        // Rate-limited: skip this model for a minute so replies stay fast
        if (e.status === 429) this.cooldown[model] = Date.now() + 60000;
        lastErr = e;
      }
    }
    if (this.dead.size && this.dead.size >= this.models.length) {
      throw new Error(`None of the configured NVIDIA models are available on this key. Pick another model in Settings.`);
    }
    throw lastErr || new Error('All models failed.');
  }

  /**
   * Send a message and let SENJU use tools as needed.
   * @returns {Promise<{text:string, actions:Array<{tool:string,ok:boolean,result:string}>, refresh:string[]}>}
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      throw new Error('SENJU is not initialized. Please add your NVIDIA API key in Settings.');
    }

    const ctx = { refresh: new Set() };
    const actions = [];
    const turn = [{ role: 'user', content: message }];

    let finalText = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const allowTools = round < MAX_TOOL_ROUNDS;
      const msg = await this._callAPI(
        [{ role: 'system', content: this._systemPrompt() }, ...this.history, ...turn],
        { useTools: allowTools }
      );

      const calls = msg.tool_calls || [];
      if (!calls.length) {
        finalText = (msg.content || '').trim();
        break;
      }

      turn.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });

      for (const call of calls) {
        const name = call.function?.name;
        let args = {};
        try {
          args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (_) { /* leave empty */ }

        let result, ok = true;
        try {
          console.log(`[SENJU Brain] Tool → ${name}`, args);
          result = this.mcp && this.mcp.has(name)
            ? await this.mcp.call(name, args)
            : await this.tools.execute(name, args, ctx);
        } catch (e) {
          ok = false;
          result = `ERROR: ${e.message}`;
          console.error(`[SENJU Brain] Tool ${name} failed:`, e.message);
        }
        result = String(result ?? '').slice(0, 4000);
        actions.push({ tool: name, args, ok, result });
        turn.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }

    if (!finalText) finalText = actions.length ? 'Ho gaya, Vivek.' : 'Hmm, kuch gadbad ho gayi. Ek baar phir bolo?';

    // Only keep clean user/assistant text in history — tool chatter stays out
    this.history.push({ role: 'user', content: message }, { role: 'assistant', content: finalText });
    this.history = this.history.slice(-HISTORY_LIMIT);

    return { text: finalText, actions, refresh: [...ctx.refresh] };
  }

  async getStartupGreeting() {
    if (!this.isInitialized()) throw new Error('SENJU is not initialized.');
    const hour = new Date().getHours();
    const timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour < 17 && hour >= 12 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';

    try {
      const msg = await this._callAPI([
        { role: 'system', content: this._systemPrompt() },
        { role: 'user', content: `[SYSTEM: Vivek just opened the app. It's ${timeOfDay}. Give a warm, natural 1–2 sentence Hinglish greeting suited to the time. If you remember something relevant about him (a goal, an upcoming event), weave it in briefly. Ask what's the plan.]` },
      ], { useTools: false, maxTokens: 300, think: false }); // greeting: fast, no thinking
      return (msg.content || '').trim() || 'Hello Vivek! SENJU ready hai. Aaj kya karna hai?';
    } catch (error) {
      console.error('[SENJU Brain] Greeting failed:', error.message);
      return 'Hello Vivek! SENJU ready hai. Aaj kya karna hai, batao!';
    }
  }
}

module.exports = SenjuBrain;
module.exports.DEFAULT_MODELS = DEFAULT_MODELS;
