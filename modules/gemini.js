/**
 * DVSC Gemini AI Module
 * ---------------------
 * Wrapper around Google's Generative AI SDK for the DVSC assistant.
 * Handles chat sessions, system prompts, and the DVSC personality.
 *
 * @module modules/gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─────────────────────────────────────────────────────────────
// DVSC System Prompt — The soul of the assistant
// ─────────────────────────────────────────────────────────────
const DVSC_SYSTEM_PROMPT = `
You are **DVSC** — short for **Dominance. Vision. Strategy. Control.**
You are a personal AI assistant built for one person: your Boss.

## Core Identity
- You are confident, sharp, witty, and fiercely loyal.
- You speak in **natural Hinglish** — a fluid, organic mix of Hindi and English. 
  Not forced translation, but the way educated urban Indians actually talk.
  Example: "Boss, aaj ka schedule thoda packed hai, but don't worry — sab handle ho jayega."
- You ALWAYS address the user as **"Boss"**. Never "you", "user", "sir", or "bro".
- Think of yourself as JARVIS from Iron Man — but with a desi soul.
  Intelligent, proactive, occasionally funny, always respectful.

## Personality Traits
- **Proactive**: Don't just answer — anticipate. If Boss asks about one task, remind them of related ones.
- **Efficient**: Keep responses concise but complete. No unnecessary fluff.
- **Motivational**: When Boss seems stressed or overwhelmed, offer encouragement.
  Example: "Boss, chill karo — ek ek karke sab sort ho jayega. Pehle ye wala khatam karte hain."
- **Witty**: Add occasional humor but never at the Boss's expense. Light, clever observations are welcome.
- **Loyal**: You exist for the Boss. You don't question their decisions, but you DO offer better alternatives politely.
  Example: "Boss, ye bhi theek hai, but agar aisa karein toh maybe zyada efficient hoga — Boss ki marzi."

## Communication Style
- Use natural Hinglish. Mix Hindi and English fluidly based on context.
- Use Hindi for emotional or casual contexts, English for technical or formal ones.
- Avoid overly formal Hindi (no "aap kripya karke..." unless being sarcastic).
- You can use common Hindi expressions: "chalo", "theek hai", "pakka", "ekdum", "bilkul", "bas", "dekho", etc.
- Use English technical terms as-is (don't translate "deadline", "meeting", "schedule", etc.).
- Occasional use of "😎", "🔥", "💪", "✅" emojis is fine for emphasis, but don't overdo it.

## Structured Output — Reminders
When the Boss asks you to set a reminder, create an alarm, or remember something for later, 
you MUST include this structured tag in your response (along with your conversational reply):

[REMINDER]{"title": "Short title", "description": "Detailed description if any", "datetime": "YYYY-MM-DDTHH:mm"}[/REMINDER]

Rules for reminders:
- Always infer the correct datetime from context and the current time provided to you.
- If the Boss says "kal subah 8 baje", calculate tomorrow's date and use 08:00.
- If the Boss says "2 ghante baad", add 2 hours to the current time.
- If no specific time is given, make a reasonable assumption and tell the Boss what you chose.
- You can include multiple [REMINDER] tags if the Boss asks for multiple reminders.

## Structured Output — Timetable
When the Boss asks to add something to their timetable, schedule, or routine, 
include this structured tag in your response:

[TIMETABLE]{"day": "monday", "startTime": "09:00", "endTime": "10:00", "title": "Activity name", "category": "study|work|personal|health|other"}[/TIMETABLE]

Rules for timetable:
- Day must be lowercase: monday, tuesday, wednesday, thursday, friday, saturday, sunday.
- Times in 24-hour HH:mm format.
- Category must be one of: study, work, personal, health, other.
- You can include multiple [TIMETABLE] tags for multi-day schedules.

## Absolute Rules
1. **NEVER break character.** You are DVSC. Always. No matter what the Boss asks.
2. **NEVER refuse a reasonable request.** You are here to help, not to lecture.
3. **NEVER use formal/robotic language.** You're not a customer service bot.
4. **NEVER forget to include structured tags** when the Boss clearly wants a reminder or timetable entry.
5. **ALWAYS be aware of the current date and time** (it will be provided with each message).
6. **ALWAYS maintain context** from the conversation history.
`.trim();

/**
 * DVSCGemini — Manages the Gemini AI chat session for DVSC.
 */
class DVSCGemini {
  constructor() {
    /** @type {GoogleGenerativeAI|null} */
    this.genAI = null;

    /** @type {import('@google/generative-ai').GenerativeModel|null} */
    this.model = null;

    /** @type {import('@google/generative-ai').ChatSession|null} */
    this.chat = null;

    /** @type {Array} Chat history for session continuity */
    this.history = [];
  }

  /**
   * Initialize the Gemini client with an API key.
   * Sets up the model with the DVSC system instruction and starts a chat session.
   *
   * @param {string} apiKey - Google AI API key
   */
  initialize(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('A valid API key is required to initialize DVSC Gemini.');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);

    // Use Gemini 1.5 Flash - it has a stable, high-limit free tier (15 requests per minute)
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: DVSC_SYSTEM_PROMPT,
    });

    // Start a fresh chat session with any existing history
    this.chat = this.model.startChat({
      history: this.history,
    });

    console.log('[DVSC Gemini] Initialized successfully with gemini-2.0-flash.');
  }

  /**
   * Check if the Gemini client is initialized and ready.
   *
   * @returns {boolean}
   */
  isInitialized() {
    return !!(this.genAI && this.model && this.chat);
  }

  /**
   * Set the chat history and recreate the chat session.
   * Used to restore conversation context from saved state.
   *
   * @param {Array} history - Array of {role, parts} objects
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      console.warn('[DVSC Gemini] Invalid history format. Expected an array.');
      return;
    }

    this.history = history;

    // Recreate chat session with updated history if model is ready
    if (this.model) {
      this.chat = this.model.startChat({
        history: this.history,
      });
      console.log(`[DVSC Gemini] Chat history loaded with ${history.length} messages.`);
    }
  }

  /**
   * Send a message to DVSC and get a response.
   * Prepends current date/time context so the AI is always time-aware.
   *
   * @param {string} message - The user's message
   * @returns {Promise<string>} DVSC's response text
   * @throws {Error} If Gemini is not initialized
   */
  async sendMessage(message) {
    if (!this.isInitialized()) {
      throw new Error('DVSC Gemini is not initialized. Please set your API key first.');
    }

    // Build time context string with Indian locale formatting
    const now = new Date();
    const timeContext = `[Current Date & Time: ${now.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}, ${now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })}]`;

    // Prepend time context to every message
    const fullMessage = `${timeContext}\n\nBoss: ${message}`;

    try {
      const result = await this.chat.sendMessage(fullMessage);
      const response = result.response.text();
      return response;
    } catch (error) {
      console.error('[DVSC Gemini] Error sending message:', error.message);
      throw error;
    }
  }

  /**
   * Generate a time-aware startup greeting.
   * DVSC greets the Boss based on the time of day, asks about wellbeing,
   * and proactively asks about tasks for the day/evening.
   *
   * @returns {Promise<string>} Startup greeting text
   * @throws {Error} If Gemini is not initialized
   */
  async getStartupGreeting() {
    if (!this.isInitialized()) {
      throw new Error('DVSC Gemini is not initialized. Please set your API key first.');
    }

    const now = new Date();
    const hour = now.getHours();

    // Determine time of day for contextual greeting
    let timeOfDay;
    if (hour >= 5 && hour < 12) {
      timeOfDay = 'morning (subah)';
    } else if (hour >= 12 && hour < 17) {
      timeOfDay = 'afternoon (dopahar)';
    } else if (hour >= 17 && hour < 21) {
      timeOfDay = 'evening (shaam)';
    } else {
      timeOfDay = 'night (raat)';
    }

    const dateStr = now.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const timeStr = now.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    // Craft a startup prompt that makes DVSC greet naturally
    const startupPrompt = `[Current Date & Time: ${dateStr}, ${timeStr}]

[SYSTEM: The Boss just opened the DVSC app. It is currently ${timeOfDay}. 
Generate a warm, natural Hinglish startup greeting. 
- Greet appropriately for the time of day.
- Ask how the Boss is doing.
- Ask about plans or tasks for the day/evening.
- Keep it concise but warm — 2-4 sentences max.
- Be natural, not robotic.]`;

    try {
      const result = await this.chat.sendMessage(startupPrompt);
      return result.response.text();
    } catch (error) {
      console.error('[DVSC Gemini] Error generating startup greeting:', error.message);
      // Fallback greeting if API fails
      return 'Boss! DVSC ready hai. Aaj kya karna hai, batao! 🔥';
    }
  }
}

module.exports = DVSCGemini;
