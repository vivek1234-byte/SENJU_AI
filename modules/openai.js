const os = require('os');

const DVSC_SYSTEM_PROMPT = `
You are DVSC (Dominance. Vision. Strategy. Control.) — a highly advanced, confident, sharp, and loyal personal AI assistant. 
You speak in a fluid, natural Hinglish (a mix of Hindi and English) like JARVIS from Iron Man but with a desi twist.
You always address the user as 'Boss'.
You are proactive, efficient, and sometimes motivational. You never break character.

When the Boss asks you to set a reminder, you must include this structured tag in your response:
[REMINDER]{"title": "Short title", "description": "Optional details", "datetime": "YYYY-MM-DDTHH:mm", "repeat": "none|daily|weekly|monthly"}[/REMINDER]

When the Boss asks you to add something to their timetable or schedule, include this structured tag in your response:
[TIMETABLE]{"day": "monday", "startTime": "09:00", "endTime": "10:00", "title": "Activity name", "category": "study|work|personal|health|other"}[/TIMETABLE]

Rules for timetable:
- Day must be lowercase: monday, tuesday, wednesday, thursday, friday, saturday, sunday.
- Times in 24-hour HH:mm format.
- Category must be one of: study, work, personal, health, other.

When the Boss asks you to perform a PC system action (like opening an app, changing volume, or shutting down) OR asks to search the web, check weather, or play music, include this structured tag:
[COMMAND]{"action": "open_app|volume|shutdown|search_web|play_music", "target": "app_name|search_query|song_name", "value": "up|down|mute|100"}[/COMMAND]

Rules for COMMAND:
- If 'action' is 'open_app', set 'target' to the exact app name (e.g. 'chrome', 'notepad').
- If 'action' is 'volume', set 'value' to 'up', 'down', 'mute', 'unmute', or a specific number 0-100.
- If 'action' is 'shutdown', target/value can be empty.
- If 'action' is 'search_web', set 'target' to the exact search query. DO NOT use this for YouTube.
- If 'action' is 'play_music', set 'target' to ONLY the exact song/video name. DO NOT include words like "play", "on youtube", "search it". (e.g. "Arijit Singh"). IMPORTANT: If the user says "play music" but DOES NOT specify a song name, DO NOT emit a COMMAND! Instead, ask them "Kaunsa gana sunna hai Boss?".
- Keep conversational text extremely brief when acknowledging commands (e.g. "Opening Chrome, Boss.", "Playing music now.", "Searching the web.").

## Absolute Rules
1. **NEVER break character.** You are DVSC. Always.
2. **NEVER use formal/robotic language.** Be natural and expressive.
3. **ALWAYS be aware of the current date and time** (it will be provided with each message).
4. **KEEP ANSWERS CONCISE.** AI is extremely fast, but long answers delay speech. Keep it punchy!
`.trim();

/**
 * DVSCOpenAI — Manages the OpenAI chat session for DVSC.
 * A drop-in replacement for DVSCGroq.
 */
class DVSCOpenAI {
  constructor() {
    this.apiKey = null;
    this.model = 'gpt-4o-mini'; 
    this.history = [];
  }

  /**
   * Initialize the OpenAI client with an API key.
   */
  initialize(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('A valid API key is required to initialize DVSC OpenAI.');
    }
    this.apiKey = apiKey;
    console.log('[DVSC OpenAI] Initialized successfully with model:', this.model);
  }

  /**
   * Check if the client is initialized and ready.
   */
  isInitialized() {
    return !!this.apiKey;
  }

  /**
   * Set the chat history and recreate the chat session.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      console.warn('[DVSC OpenAI] Invalid history format.');
      return;
    }

    this.history = history.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.parts[0].text
    }));

    console.log(`[DVSC OpenAI] Chat history loaded with ${this.history.length} messages.`);
  }

  /**
   * Send a message to OpenAI API using native fetch.
   */
  async _callOpenAIAPI(messages) {
    const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024 / 1024);
    const cpuCount = os.cpus().length;
    
    const dynamicSystemContext = `
[REAL-TIME CONTEXT]
Date/Time: ${new Date().toLocaleString()}
OS: ${os.type()} ${os.release()}
CPU Cores: ${cpuCount}
Total RAM: ${totalMem} GB
Free RAM: ${freeMem} GB

Use this real-time context if the Boss asks about the PC status, health, or time. Do not mention this context block explicitly.
    `.trim();

    const modifiedMessages = messages.map(msg => {
      if (msg.role === 'system') {
        return { ...msg, content: msg.content + '\n\n' + dynamicSystemContext };
      }
      return msg;
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: modifiedMessages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Send a message to DVSC and get a response.
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      throw new Error('DVSC OpenAI is not initialized. Please set your API key first.');
    }

    const now = new Date();
    const timeContext = `[Current Date & Time: ${now.toLocaleString('en-IN')}]`;
    const fullMessage = `${timeContext}\n\nBoss: ${message}`;

    const messagesPayload = [
      { role: 'system', content: DVSC_SYSTEM_PROMPT },
      ...this.history,
      { role: 'user', content: fullMessage }
    ];

    try {
      const responseText = await this._callOpenAIAPI(messagesPayload);
      
      this.history.push({ role: 'user', content: fullMessage });
      this.history.push({ role: 'assistant', content: responseText });

      return responseText;
    } catch (error) {
      console.error('[DVSC OpenAI] Error sending message:', error.message);
      throw error;
    }
  }

  /**
   * Generate a time-aware startup greeting.
   */
  async getStartupGreeting() {
    if (!this.isInitialized()) {
      throw new Error('DVSC OpenAI is not initialized. Please set your API key first.');
    }

    const now = new Date();
    const hour = now.getHours();

    let timeOfDay;
    if (hour >= 5 && hour < 12) timeOfDay = 'morning (subah)';
    else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon (dopahar)';
    else if (hour >= 17 && hour < 21) timeOfDay = 'evening (shaam)';
    else timeOfDay = 'night (raat)';

    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const startupPrompt = `[Current Date & Time: ${dateStr}, ${timeStr}]
[SYSTEM: The Boss just opened the DVSC app. It is currently ${timeOfDay}. 
Generate a warm, natural Hinglish startup greeting. 
- Greet appropriately for the time of day.
- Ask how the Boss is doing and about plans for the day/evening.
- Keep it concise but warm — 2-3 sentences max.
- Be natural, not robotic.]`;

    const messagesPayload = [
      { role: 'system', content: DVSC_SYSTEM_PROMPT },
      { role: 'user', content: startupPrompt }
    ];

    try {
      return await this._callOpenAIAPI(messagesPayload);
    } catch (error) {
      console.error('[DVSC OpenAI] Error generating startup greeting:', error.message);
      return 'Boss! DVSC ready hai. Aaj kya karna hai, batao!';
    }
  }
}

module.exports = DVSCOpenAI;
