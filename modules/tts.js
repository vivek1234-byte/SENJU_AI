/**
 * DVSC TTS Module (Edge Neural TTS)
 * -----------------------------------
 * Uses Microsoft Edge's Neural Text-to-Speech voices for
 * high-quality, natural-sounding Hinglish voice output.
 *
 * Voice: hi-IN-SwaraNeural (Female Hindi Neural Voice — Hinglish)
 * Fallback: en-IN-NeerjaNeural (Female Indian English Neural Voice)
 *
 * No API key required — uses the Edge Read Aloud service.
 *
 * @module modules/tts
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let EdgeTTS;

/**
 * DVSC Text-to-Speech Manager
 */
class DVSCTts {
  constructor() {
    this.voice = 'hi-IN-SwaraNeural'; // Female Hindi neural voice — perfect natural Hinglish
    this.rate = '+5%';
    this.pitch = '+8Hz'; // Slightly higher pitch for a natural female voice
    this.volume = '+0%';
    this.enabled = true;
    this.ttsInstance = null;
    this.initialized = false;
    this.audioDir = path.join(os.tmpdir(), 'dvsc-tts');

    // Create temp dir for audio files
    if (!fs.existsSync(this.audioDir)) {
      fs.mkdirSync(this.audioDir, { recursive: true });
    }
  }

  /**
   * Initialize the Edge TTS engine (async because edge-tts-universal is ESM)
   */
  async initialize() {
    try {
      EdgeTTS = (await import('edge-tts-universal')).EdgeTTS;
      this.ttsInstance = new EdgeTTS();
      this.initialized = true;
      console.log('[DVSC TTS] Edge Neural TTS initialized. Voice:', this.voice);
    } catch (error) {
      console.error('[DVSC TTS] Failed to initialize:', error.message);
      this.initialized = false;
    }
  }

  /**
   * Clean text before converting to speech.
   * Removes markdown, emojis, and special characters.
   * @param {string} text
   * @returns {string}
   */
  cleanText(text) {
    let clean = text;
    // Remove markdown formatting
    clean = clean.replace(/\*\*(.*?)\*\*/g, '$1'); // bold
    clean = clean.replace(/\*(.*?)\*/g, '$1');       // italic
    clean = clean.replace(/`(.*?)`/g, '$1');         // code
    clean = clean.replace(/#{1,6}\s/g, '');          // headers
    clean = clean.replace(/\[.*?\]\(.*?\)/g, '');    // links
    
    // Remove emojis
    clean = clean.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
    
    // Fix punctuation that causes Edge TTS to pause dramatically (the 'stuck' feeling)
    clean = clean.replace(/\.\.\./g, ','); // Replace ellipses with a short pause
    clean = clean.replace(/!/g, ',');      // Replace exclamation marks with a comma for smoother flow
    clean = clean.replace(/\?/g, ',');     // Replace question marks to avoid awkward upward inflection pauses
    
    // Remove multiple spaces/newlines
    clean = clean.replace(/\n+/g, '. ');
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean;
  }

  /**
   * Generate speech audio from text and return as base64 data URI.
   * @param {string} text - Text to speak
   * @returns {Promise<string|null>} Base64 data URI of the audio, or null on failure
   */
  async speak(text) {
    if (!this.enabled || !this.initialized || !text) {
      return null;
    }

    const cleanedText = this.cleanText(text);
    if (!cleanedText || cleanedText.length < 2) {
      return null;
    }

    try {
      // EdgeTTS constructor: (text, voice, options)
      const ttsInstance = new EdgeTTS(cleanedText, this.voice, {
        rate: this.rate,
        pitch: this.pitch,
        volume: this.volume,
      });

      const result = await ttsInstance.synthesize();

      // result.audio is a Blob, convert to Buffer then base64
      const arrayBuffer = await result.audio.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);
      const base64Audio = audioBuffer.toString('base64');
      const dataUri = `data:audio/mpeg;base64,${base64Audio}`;

      console.log('[DVSC TTS] Audio generated, size:', audioBuffer.length, 'bytes');
      return dataUri;
    } catch (error) {
      console.error('[DVSC TTS] Speech generation failed:', error.message);
      return null;
    }
  }

  /**
   * Remove old audio files to prevent temp dir bloat.
   */
  cleanupOldFiles() {
    try {
      const files = fs.readdirSync(this.audioDir)
        .filter(f => f.startsWith('dvsc_speech_') && f.endsWith('.mp3'))
        .map(f => ({
          name: f,
          path: path.join(this.audioDir, f),
          time: fs.statSync(path.join(this.audioDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      // Delete all except the 5 most recent
      files.slice(5).forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
      });
    } catch (e) {
      /* ignore cleanup errors */
    }
  }

  /**
   * Set TTS enabled/disabled.
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Set the voice to use.
   * @param {string} voice - Edge TTS voice name
   */
  setVoice(voice) {
    this.voice = voice;
  }
}

module.exports = DVSCTts;
