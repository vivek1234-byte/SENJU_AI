/**
 * NVIDIA API helpers
 * ------------------
 * Small one-shot calls used outside the main chat loop: turning scraped pages
 * into JSON (trains), deciding the next click (booking agent), and
 * speech-to-text with Nemotron Omni (voice input).
 * Everything goes to build.nvidia.com's OpenAI-compatible endpoint.
 */

const CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

// Fast models first — these helpers run in loops, so latency matters more than depth
const FAST_MODELS = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-super-vl-120b-a12b',
];
const OMNI_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';

// Reasoning models may leak their thinking into the reply
function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
function parseJSON(text) {
  const t = stripThinking(text).replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (_) { return null; }
}

async function chatOnce({ apiKey, model, messages, maxTokens = 900, temperature = 0, timeoutMs = 40000 }) {
  if (!apiKey) throw new Error('NVIDIA API key missing — add it in Settings.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`NVIDIA ${model} (${res.status}): ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = JSON.parse(text);
    return stripThinking(data.choices?.[0]?.message?.content || '');
  } finally {
    clearTimeout(timer);
  }
}

/** One-shot chat with automatic fallback across the fast models. */
async function quickChat(opts) {
  let lastErr;
  for (const model of opts.models || FAST_MODELS) {
    try {
      return await chatOnce({ ...opts, model });
    } catch (e) {
      if (e.status === 401 || e.status === 403) throw new Error('NVIDIA API key is invalid or has no access. Update it in Settings.');
      console.warn('[NVIDIA] fallback:', e.message);
      lastErr = e;
    }
  }
  throw lastErr || new Error('All NVIDIA models failed.');
}

/**
 * Speech-to-text with Nemotron Omni.
 * @param {string} audioDataUrl - "data:audio/wav;base64,…" (16 kHz mono WAV works best)
 */
async function transcribe({ apiKey, audioDataUrl, hint = '' }) {
  const prompt =
    'Transcribe this audio exactly as spoken. The speaker mixes Hindi and English (Hinglish): ' +
    'write Hindi words in Roman script (e.g. "kal subah 8 baje yaad dilana"), never Devanagari, never translate. ' +
    (hint ? `Words that may appear: ${hint}. ` : '') +
    'If there is no clear speech, output nothing. Output ONLY the transcript.';
  const call = () => chatOnce({
    apiKey,
    model: OMNI_MODEL,
    maxTokens: 400,
    temperature: 0.2,
    timeoutMs: 30000,
    messages: [{
      role: 'user',
      content: [
        { type: 'audio_url', audio_url: { url: audioDataUrl } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  // The free shared pool often answers 503 "ResourceExhausted" / 429 for a moment — retry with backoff
  for (let attempt = 0; ; attempt++) {
    try {
      return (await call()).replace(/^["'\s]+|["'\s]+$/g, '');
    } catch (e) {
      if (attempt >= 3 || ![429, 502, 503, 504].includes(e.status)) {
        if (e.status === 401 || e.status === 403) throw new Error('NVIDIA API key is invalid or has no access. Update it in Settings.');
        throw e;
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
}

module.exports = { CHAT_URL, FAST_MODELS, OMNI_MODEL, stripThinking, parseJSON, quickChat, transcribe };
