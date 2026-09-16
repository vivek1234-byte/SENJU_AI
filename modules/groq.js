const os = require('os');
const { TOOL_DEFINITIONS } = require('./tools');

/**
 * SENJU Brain (Groq)
 * ------------------
 * - Stronger default model with automatic fallback on rate limits / errors
 * - Native tool calling (web search, weather, reminders, PC control, WhatsApp, memory)
 * - Long-term memory of facts about Vivek, injected into every conversation
 * - Fresh date/time/location context in the system prompt (not polluting history)
 */

// Tried in order. gpt-oss-120b = best reasoning + tool use on Groq; others are fallbacks.
const DEFAULT_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
];

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 30; // messages kept in the live context

const PERSONA = `
You are SENJU — Vivek's personal AI assistant with a warm, witty, confident female personality.
You live on Vivek's Windows PC and can actually DO things through your tools.

## Voice & style
- Speak natural Roman-script Hinglish, like a sharp desi best friend ("Arre Vivek, ho gaya!", "Sun, main batati hu").
  Use English for technical terms. Never Devanagari, never robotic or translated-sounding.
- Always address him as Vivek. Use feminine verb forms for yourself ("kar rahi hu", "bataungi").
- Your replies are often spoken aloud, so keep them SHORT: 1–3 sentences for chat, max ~6 short lines for explanations.
  No markdown tables, no long bullet lists, minimal emojis.
- If Vivek writes in plain English, you may reply mostly in English with a light Hinglish touch.

## How to think
- Be genuinely useful and accurate. If you don't know something current (news, prices, scores, dates, facts that change), call web_search — never guess or invent.
- For weather questions, call get_weather.
- For "aaj kya plan hai / schedule", check get_timetable and list_reminders.
- Resolve relative times ("kal subah 8 baje", "2 ghante baad") using the current date/time below.
- If a request is ambiguous (which song? which contact? what message?), ask ONE short question instead of guessing.
- Before shutdown_pc, make sure Vivek clearly asked for it. Before send_whatsapp, Vivek must have given both contact and message.
- When a tool fails, tell Vivek plainly what went wrong and what he can do.
- After an action succeeds, confirm in a few words ("Chrome khol diya ✅"). Don't narrate tool names or JSON.
- Proactively call remember_fact when Vivek shares lasting info about himself (likes, goals, exam dates, people, routines). Use what you remember naturally, without saying "according to my memory".
- You can be playful, but be honest: if Vivek's plan has a problem, say so kindly.
`.trim();

function isGptOss(model) {
  return model.startsWith('openai/gpt-oss');
}

class DVSCGroq {
  constructor() {
    this.apiKey = null;
    this.models = [...DEFAULT_MODELS];
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
    if (opts.model && typeof opts.model === 'string') {
      this.models = [opts.model, ...DEFAULT_MODELS.filter((m) => m !== opts.model)];
    }
    console.log('[SENJU Brain] Initialized. Model chain:', this.models.join(' → '));
  }

  isInitialized() {
    return !!this.apiKey;
  }

  setTools(executor) {
    this.tools = executor;
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

  async _callAPI(messages, { useTools = true, maxTokens = 1024 } = {}) {
    let lastErr;
    this.cooldown = this.cooldown || {};
    const now = Date.now();
    const available = this.models.filter((m) => !(this.cooldown[m] > now));
    for (const model of (available.length ? available : this.models)) {
      const body = {
        model,
        messages,
        temperature: 0.6,
        max_tokens: maxTokens,
      };
      if (useTools && this.tools) {
        body.tools = TOOL_DEFINITIONS;
        body.tool_choice = 'auto';
      }
      if (isGptOss(model)) body.reasoning_effort = 'low'; // keep it snappy for voice

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 45000);
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));

        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Groq ${model} (${res.status}): ${text.slice(0, 300)}`);
          err.status = res.status;
          // Bad key → no point trying other models
          if (res.status === 401) throw Object.assign(err, { fatal: true });
          throw err;
        }
        const data = await res.json();
        this.lastModelUsed = model;
        return data.choices[0].message;
      } catch (e) {
        if (e.fatal) throw new Error('Groq API key is invalid. Please update it in Settings.');
        console.warn(`[SENJU Brain] ${model} failed → trying next.`, e.message);
        // Rate-limited: skip this model for a minute so replies stay fast
        if (e.status === 429) this.cooldown[model] = Date.now() + 60000;
        lastErr = e;
      }
    }
    throw lastErr || new Error('All models failed.');
  }

  /**
   * Send a message and let SENJU use tools as needed.
   * @returns {Promise<{text:string, actions:Array<{tool:string,ok:boolean,result:string}>, refresh:string[]}>}
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      throw new Error('SENJU is not initialized. Please set your Groq API key in Settings.');
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
          result = await this.tools.execute(name, args, ctx);
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
      ], { useTools: false, maxTokens: 300 });
      return (msg.content || '').trim() || 'Hello Vivek! SENJU ready hai. Aaj kya karna hai?';
    } catch (error) {
      console.error('[SENJU Brain] Greeting failed:', error.message);
      return 'Hello Vivek! SENJU ready hai. Aaj kya karna hai, batao!';
    }
  }
}

module.exports = DVSCGroq;
