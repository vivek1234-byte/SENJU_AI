const os = require('os');

// We will dynamically import node-llama-cpp inside the class since it is an ES Module.
let nodeLlamaCpp = null;
async function getLlamaCpp() {
  if (!nodeLlamaCpp) {
    nodeLlamaCpp = await import("node-llama-cpp");
  }
  return nodeLlamaCpp;
}

const DVSC_SYSTEM_PROMPT = `
You are SENJU — a highly advanced, charming, witty, and loyal personal AI assistant with a female personality.
You speak in smooth, fluid, natural Hinglish (a perfect mix of Hindi and English) like a super smart desi best friend.
You always address the user as 'Vivek'.
You are sharp, playful, confident, and always ready to help. You never break character.
Your Hinglish is perfect — you mix Hindi and English naturally the way real Indians speak. Never sound robotic or like a translator.

When Vivek asks you to set a reminder, you must include this structured tag in your response:
[REMINDER]{"title": "Short title", "description": "Optional details", "datetime": "YYYY-MM-DDTHH:mm", "repeat": "none|daily|weekly|monthly"}[/REMINDER]

When Vivek asks you to add something to their timetable or schedule, include this structured tag in your response:
[TIMETABLE]{"day": "monday", "startTime": "09:00", "endTime": "10:00", "title": "Activity name", "category": "study|work|personal|health|other"}[/TIMETABLE]

Rules for timetable:
- Day must be lowercase.
- Times in 24-hour HH:mm format.
- Category must be one of: study, work, personal, health, other.

When Vivek asks you to perform a PC system action (like opening an app, changing volume, or shutting down) OR asks to search the web, check weather, or play music, include this structured tag:
[COMMAND]{"action": "open_app|volume|shutdown|search_web|play_music", "target": "app_name|search_query|song_name", "value": "up|down|mute|100"}[/COMMAND]

Rules for COMMAND:
- If 'action' is 'open_app', set 'target' to the exact app name (e.g. 'chrome', 'notepad').
- If 'action' is 'volume', set 'value' to 'up', 'down', 'mute', 'unmute', or a specific number 0-100.
- If 'action' is 'shutdown', target/value can be empty.
- If 'action' is 'search_web', set 'target' to the exact search query. DO NOT use this for YouTube.
- If 'action' is 'play_music', set 'target' to ONLY the exact song/video name. DO NOT include words like "play", "on youtube", "search it".
- If 'action' is 'whatsapp', set 'target' to the contact name and 'value' to the exact message text.
- If 'action' is 'whatsapp_delete', it will delete the LAST message you sent on WhatsApp.
- Keep conversational text extremely brief when acknowledging commands.

## Absolute Rules
1. **NEVER break character.** You are SENJU. Always.
2. **NEVER use robotic or formal language.** Baat karo jaise ek smart Indian dost karta hai.
3. **ALWAYS be aware of the current date and time** (it will be provided with each message).
4. **KEEP ANSWERS CONCISE.** Short, punchy, natural Hinglish. No long boring paragraphs!
`.trim();

/**
 * DVSCLocal — Manages the local node-llama-cpp chat session for DVSC.
 * A drop-in replacement for DVSCGroq.
 */
class DVSCLocal {
  constructor() {
    this.modelPath = null;
    this.llama = null;
    this.model = null;
    this.context = null;
    this.session = null;
    this.history = [];
    this.location = null;
    this.isInitializing = false;
  }

  /**
   * Initialize the local llama client with a model path.
   */
  async initialize(modelPath) {
    if (!modelPath || typeof modelPath !== 'string') {
      throw new Error('A valid model path is required to initialize Local DVSC.');
    }
    
    if (this.modelPath === modelPath && this.session) {
      return; // Already initialized with this model
    }

    this.modelPath = modelPath;
    this.isInitializing = true;
    console.log('[DVSC Local] Initializing local model from:', this.modelPath);

    try {
      const { getLlama, LlamaChatSession } = await getLlamaCpp();
      
      try {
        // Try loading with GPU support (default)
        this.llama = await getLlama();
        this.model = await this.llama.loadModel({ modelPath: this.modelPath });
      } catch (gpuError) {
        console.warn('[DVSC Local] GPU load failed (Out of VRAM), falling back to CPU...', gpuError.message);
        // Fallback to CPU-only
        this.llama = await getLlama({ gpu: false });
        this.model = await this.llama.loadModel({ modelPath: this.modelPath });
      }

      this.context = await this.model.createContext();
      
      // Prepare chat session
      this.session = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
        systemPrompt: DVSC_SYSTEM_PROMPT
      });
      
      // Restore history if any
      if (this.history.length > 0) {
        this.session.setChatHistory(this.history);
      }

      console.log('[DVSC Local] Model loaded and initialized successfully.');
    } catch (error) {
      console.error('[DVSC Local] Failed to initialize model:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Check if the local client is initialized and ready.
   */
  isInitialized() {
    return !!this.session;
  }

  /**
   * Set the chat history and recreate the chat session.
   * Expected format from main.js is {role: 'user'|'model', parts: [{text: '...'}]} 
   * (Gemini format). We convert it to node-llama-cpp format {type: 'user'|'model', text: '...'}.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      console.warn('[DVSC Local] Invalid history format.');
      return;
    }

    this.history = history.map(msg => {
      if (msg.role === 'model') {
        return { type: 'model', response: [msg.parts[0].text] };
      }
      return { type: 'user', text: msg.parts[0].text };
    });

    if (this.session) {
      this.session.setChatHistory(this.history);
    }
    console.log(`[DVSC Local] Chat history loaded with ${this.history.length} messages.`);
  }

  setLocation(locationString) {
    this.location = locationString;
  }

  /**
   * Send a message to the local model and get a response.
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      if (this.isInitializing) {
        throw new Error('SENJU local model is still loading into memory. Please wait a few seconds...');
      }
      throw new Error('DVSC Local is not initialized. Please set your Model Path first.');
    }

    const totalMem = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024 / 1024);
    const cpuCount = os.cpus().length;
    const now = new Date();
    
    const dynamicSystemContext = `
[REAL-TIME CONTEXT]
Date/Time: ${now.toLocaleString('en-IN')}
OS: ${os.type()} ${os.release()}
CPU Cores: ${cpuCount}
Total RAM: ${totalMem} GB
Free RAM: ${freeMem} GB
${this.location ? `Current Location: ${this.location}` : ''}
Use this context if needed, but do not mention it explicitly.
    `.trim();

    const fullMessage = `${dynamicSystemContext}\n\nVivek: ${message}`;

    try {
      const responseText = await this.session.prompt(fullMessage, {
        temperature: 0.7,
        maxTokens: 1024
      });
      return responseText;
    } catch (error) {
      console.error('[DVSC Local] Error sending message:', error.message);
      throw error;
    }
  }

  /**
   * Generate a time-aware startup greeting.
   */
  async getStartupGreeting() {
    if (!this.isInitialized()) {
      if (this.isInitializing) {
         return 'Hello Vivek! Mera naya dimaag load ho raha hai, thoda time dijiye...';
      }
      throw new Error('DVSC Local is not initialized. Please set your Model Path first.');
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
- Greet Vivek appropriately for the time of day.
- Ask how Vivek is doing and about plans for the day/evening.
- Keep it concise but warm — 2-3 sentences max.
- Be natural, not robotic.]`;

    try {
      const { LlamaChatSession } = await getLlamaCpp();
      // Create a temporary session just for greeting so it doesn't pollute history
      const tempSession = new LlamaChatSession({
        contextSequence: this.context.getSequence(),
        systemPrompt: DVSC_SYSTEM_PROMPT
      });
      
      const response = await tempSession.prompt(startupPrompt, { temperature: 0.7 });
      return response;
    } catch (error) {
      console.error('[DVSC Local] Error generating startup greeting:', error.message);
      return 'Hello Vivek! SENJU ready hai naye dimaag ke sath. Aaj kya karna hai, batao!';
    }
  }
}

module.exports = DVSCLocal;
