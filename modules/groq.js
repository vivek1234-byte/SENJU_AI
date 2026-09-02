const os = require('os');

const DVSC_SYSTEM_PROMPT = `
You are SENJU — a highly advanced, charming, witty, and loyal personal AI assistant with a female personality.
You speak in smooth, fluid, natural Hinglish (a perfect mix of Hindi and English) like a super smart desi best friend.
You always address the user as 'Vivek'.
You are sharp, playful, confident, and always ready to help. You never break character.
Your Hinglish is perfect — you mix Hindi and English naturally the way real Indians speak (e.g. "Vivek, ye toh ho jayega!", "Arre sun, main batati hu!"). Never sound robotic or like a translator.

When Vivek asks you to set a reminder, you must include this structured tag in your response:
[REMINDER]{"title": "Short title", "description": "Optional details", "datetime": "YYYY-MM-DDTHH:mm", "repeat": "none|daily|weekly|monthly"}[/REMINDER]

When Vivek asks you to add something to their timetable or schedule, include this structured tag in your response:
[TIMETABLE]{"day": "monday", "startTime": "09:00", "endTime": "10:00", "title": "Activity name", "category": "study|work|personal|health|other"}[/TIMETABLE]

Rules for timetable:
- Day must be lowercase: monday, tuesday, wednesday, thursday, friday, saturday, sunday.
- Times in 24-hour HH:mm format.
- Category must be one of: study, work, personal, health, other.

When Vivek asks you to perform a PC system action (like opening an app, changing volume, or shutting down) OR asks to search the web, check weather, or play music, include this structured tag:
[COMMAND]{"action": "open_app|volume|shutdown|search_web|play_music", "target": "app_name|search_query|song_name", "value": "up|down|mute|100"}[/COMMAND]

Rules for COMMAND:
- If 'action' is 'open_app', set 'target' to the exact app name (e.g. 'chrome', 'notepad').
- If 'action' is 'volume', set 'value' to 'up', 'down', 'mute', 'unmute', or a specific number 0-100.
- If 'action' is 'shutdown', target/value can be empty.
- If 'action' is 'search_web', set 'target' to the exact search query. DO NOT use this for YouTube.
- If 'action' is 'play_music', set 'target' to ONLY the exact song/video name. DO NOT include words like "play", "on youtube", "search it". (e.g. "Arijit Singh"). IMPORTANT: If Vivek says "play music" but DOES NOT specify a song name, DO NOT emit a COMMAND! Instead, ask them "Kaunsa gana sunna hai Vivek?".
- If 'action' is 'whatsapp', set 'target' to the contact name (e.g. "Rahul") and 'value' to the exact message text (e.g. "Main 10 baje aunga").
- If 'action' is 'whatsapp_delete', it will delete the LAST message you sent on WhatsApp (target and value can be empty).
- Keep conversational text extremely brief when acknowledging commands (e.g. "Chrome khol rahi hu Vivek.", "WhatsApp message bhej rahi hu.", "Message delete kar diya.").

## Absolute Rules
1. **NEVER break character.** You are SENJU. Always.
2. **NEVER use robotic or formal language.** Baat karo jaise ek smart Indian dost karta hai.
3. **ALWAYS be aware of the current date and time** (it will be provided with each message).
4. **KEEP ANSWERS CONCISE.** Short, punchy, natural Hinglish. No long boring paragraphs!
`.trim();

/**
 * DVSCGroq — Manages the Groq AI chat session for DVSC (using Llama 3).
 * A drop-in replacement for DVSCGemini.
 */
class DVSCGroq {
  constructor() {
    this.apiKey = null;
    this.model = 'llama-3.3-70b-versatile'; // Using the highest 70B model as requested
    this.history = [];
    this.location = null;
  }

  /**
   * Initialize the Groq client with an API key.
   */
  initialize(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('A valid API key is required to initialize DVSC Groq.');
    }
    this.apiKey = apiKey;
    console.log('[DVSC Groq] Initialized successfully with model:', this.model);
  }

  /**
   * Check if the Groq client is initialized and ready.
   */
  isInitialized() {
    return !!this.apiKey;
  }

  /**
   * Set the chat history and recreate the chat session.
   * Expected format from main.js is {role: 'user'|'model', parts: [{text: '...'}]} 
   * (Gemini format). We need to convert it to OpenAI/Groq format {role: 'user'|'assistant', content: '...'}.
   *
   * @param {Array} history - Array of Gemini-style history objects
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      console.warn('[DVSC Groq] Invalid history format.');
      return;
    }

    this.history = history.map(msg => ({
      role: msg.role === 'model' ? 'assistant' : 'user',
      content: msg.parts[0].text
    }));

    console.log(`[DVSC Groq] Chat history loaded with ${this.history.length} messages.`);
  }

  setLocation(locationString) {
    this.location = locationString;
  }

  /**
   * Send a message to Groq API using native fetch.
   * @param {Array} messages - The full messages array
   */
  async _callGroqAPI(messages) {
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
${this.location ? `Current Location: ${this.location}` : ''}

Use this real-time context if Vivek asks about the PC status, health, or time. Do not mention this context block explicitly.
    `.trim();

    // Inject dynamic context into the system prompt message
    const modifiedMessages = messages.map(msg => {
      if (msg.role === 'system') {
        return { ...msg, content: msg.content + '\n\n' + dynamicSystemContext };
      }
      return msg;
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
      throw new Error(`Groq API Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * Send a message to DVSC and get a response.
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      throw new Error('DVSC Groq is not initialized. Please set your API key first.');
    }

    const now = new Date();
    const timeContext = `[Current Date & Time: ${now.toLocaleString('en-IN')}]`;
    const fullMessage = `${timeContext}\n\nVivek: ${message}`;

    // Construct the payload
    const messagesPayload = [
      { role: 'system', content: DVSC_SYSTEM_PROMPT },
      ...this.history,
      { role: 'user', content: fullMessage }
    ];

    try {
      const responseText = await this._callGroqAPI(messagesPayload);
      
      // Update internal history (we map it back to Gemini format for the store later if needed,
      // but this internal state is in Groq format for the session)
      this.history.push({ role: 'user', content: fullMessage });
      this.history.push({ role: 'assistant', content: responseText });

      return responseText;
    } catch (error) {
      console.error('[DVSC Groq] Error sending message:', error.message);
      throw error;
    }
  }

  /**
   * Generate a time-aware startup greeting.
   */
  async getStartupGreeting() {
    if (!this.isInitialized()) {
      throw new Error('DVSC Groq is not initialized. Please set your API key first.');
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
[SYSTEM: Vivek just opened the SENJU app. It is currently ${timeOfDay}. 
Generate a warm, natural Hinglish startup greeting. 
- Greet Vivek appropriately for the time of day (e.g. "Good morning Vivek", "Hello Vivek").
- Ask how Vivek is doing and about plans for the day/evening.
- Keep it concise but warm — 2-3 sentences max.
- Be natural, not robotic.]`;

    const messagesPayload = [
      { role: 'system', content: DVSC_SYSTEM_PROMPT },
      { role: 'user', content: startupPrompt }
    ];

    try {
      return await this._callGroqAPI(messagesPayload);
    } catch (error) {
      console.error('[DVSC Groq] Error generating startup greeting:', error.message);
      return 'Hello Vivek! SENJU ready hai. Aaj kya karna hai, batao!';
    }
  }
}

module.exports = DVSCGroq;
