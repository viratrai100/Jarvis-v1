import axios from 'axios'

// ─── In-memory response cache (TTL: 60 s) ──────────────────────────────────
const cache = new Map()
const CACHE_TTL_MS = 60_000

const getCached = (key) => {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null }
  return entry.value
}
const setCache = (key, value) => cache.set(key, { value, ts: Date.now() })

// ─── Retry with exponential back-off ───────────────────────────────────────
const withRetry = async (fn, maxAttempts = 3, baseDelayMs = 2000) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = err?.response?.status
      const isRateLimit = status === 429 || status === 503
      const isLast      = attempt === maxAttempts

      if (isLast || !isRateLimit) throw err
      const delay = baseDelayMs * attempt
      console.warn(`[AI] attempt ${attempt} failed (${status}), retrying in ${delay}ms…`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

// ─── Safe JSON extractor ────────────────────────────────────────────────────
export const safeParseJson = (raw) => {
  if (!raw) return null
  try {
    const stripped = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim()
    const start = stripped.indexOf('{')
    const end   = stripped.lastIndexOf('}')
    if (start === -1 || end === -1 || end < start) return null
    return JSON.parse(stripped.slice(start, end + 1))
  } catch {
    return null
  }
}

// ─── Input cleaner ──────────────────────────────────────────────────────────
export const cleanInput = (input = '') =>
  input
    .replace(/\bjarvis\b/gi, '')
    .replace(/\bon youtube\b/gi, '')
    .replace(/\bon spotify\b/gi, '')
    .replace(/\bplay\s+on\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

// ─── Shared prompt builder ──────────────────────────────────────────────────
export const buildPrompt = (cleaned, assistantName, userName) => `
You are a smart voice assistant named "${assistantName}" created by "${userName}".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — DETECT LANGUAGE
Detect whether the input is:
  • Hindi (Devanagari OR Hinglish words like "karo", "bata", "sunao", "play karo", "bhejo")
  • English (clearly English sentence structure)

Set "language" to exactly: "hindi" or "english"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2 — RESPOND IN THE SAME LANGUAGE
• hindi → ALL fields in Hindi/Hinglish
• english → ALL fields in English
• NEVER mix languages

Acknowledgment + engagement pattern (ALWAYS end the response asking if they need anything else):
  Hindi  → "Ji sir, ... . Kya aur koi kaam hai?"
  English → "Yes sir, ... . Do you need anything else?"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3 — RETURN ONLY RAW JSON (no markdown, no backticks)

{
  "type": "<intent>",
  "language": "hindi" | "english",
  "steps": ["<step1>", "<step2>", ...],
  "target": "<WhatsApp only: contact name>",
  "message": "<WhatsApp only: message body>",
  "userInput": "<cleaned input — song/video/query name only>",
  "response": "<short voice-friendly acknowledgment + engagement question>",
  "suggestion": "<one follow-up question in detected language>",
  "extra": "<math result / factual summary / null>"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTENT TYPES:

1. "youtube-play"  — play a specific song/video on YouTube
   steps: ["search_youtube","get_video_id","play_video"]
   userInput: ONLY the song/video name

2. "youtube-search" — browse/search YouTube
   steps: ["open_youtube","enter_search_query"]

3. "whatsapp-send" — send a WhatsApp message
   steps: ["open_whatsapp","search_contact","open_chat","type_message","send_message"]
   target: contact name only | message: message body only
   NEVER put the full command in "message"
   NEVER put action words like "send", "whatsapp", "message", "bhejo", "bol", "kaho" inside "target"
   If the command is: "send whatsapp message to Rahul saying I will call you later"
   then target = "Rahul" and message = "I will call you later"
   If the command is: "Rahul ko whatsapp par bolo kal milte hain"
   then target = "Rahul" and message = "kal milte hain"

4. "math-calculate" — calculate an expression
   steps: ["parse_expression","calculate","return_result"]
   extra: numeric answer as string

5. "spotify-play" — play on Spotify
   steps: ["open_spotify","search_song","play_song"]
   userInput: song/artist name

6. "google-info" — answer factual query directly (no browser)
   steps: ["analyze_query","fetch_info","summarize"]
   extra: 2-3 sentence factual summary

7. "weather-show"   steps: ["open_google","search_weather"]
8. "google-search"  steps: ["open_google","enter_search_query"]
9. "general"        steps: ["analyze_query","generate_response"]
10. "get-time"       steps: ["get_system_time"]
11. "get-date"       steps: ["get_system_date"]
12. "get-day"        steps: ["get_system_day"]
13. "get-month"      steps: ["get_system_month"]
14. "calculator-open" steps: ["open_calculator"]
15. "instagram-open" steps: ["open_instagram"]
16. "facebook-open"  steps: ["open_facebook"]

User input: "${cleaned}"
`.trim()

// ─── GEMINI ─────────────────────────────────────────────────────────────────
const callGemini = async (prompt) => {
  const url = process.env.GEMINI_API_URL
  if (!url) throw new Error('GEMINI_API_URL not set')
  console.log('[Gemini] Sending request…')

  const res = await withRetry(() =>
    axios.post(url, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 20000 })
  )
  const text = res?.data?.candidates?.[0]?.content?.parts?.[0]?.text
  console.log('[Gemini] Raw reply:', text?.slice(0, 80))
  return text || null
}

// ─── OPENAI ──────────────────────────────────────────────────────────────────
const callOpenAI = async (prompt) => {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  console.log('[OpenAI] Sending request…')

  const res = await withRetry(() =>
    axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 600,
      },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 20000 }
    )
  )
  const text = res?.data?.choices?.[0]?.message?.content
  console.log('[OpenAI] Raw reply:', text?.slice(0, 80))
  return text || null
}

// ─── GROQ ────────────────────────────────────────────────────────────────────
const callGroq = async (prompt) => {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set')
  console.log('[Groq] Sending request…')

  const res = await withRetry(() =>
    axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
      },
      { headers: { Authorization: `Bearer ${key}` }, timeout: 20000 }
    )
  )
  const text = res?.data?.choices?.[0]?.message?.content
  console.log('[Groq] Raw reply:', text?.slice(0, 80))
  return text || null
}

// ─── HUGGINGFACE ─────────────────────────────────────────────────────────────
const callHuggingFace = async (prompt) => {
  const token = process.env.HF_TOKEN
  if (!token) throw new Error('HF_TOKEN not set')
  console.log('[HuggingFace] Sending request…')

  const res = await withRetry(() =>
    axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
      {
        inputs: `<s>[INST] ${prompt} [/INST]`,
        parameters: { max_new_tokens: 600, temperature: 0.3, return_full_text: false },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 40000 }  // HF can be slow
    )
  )

  // HF cold-start: returns { error: "Loading...", estimated_time: N }
  if (res?.data?.error) {
    console.warn('[HuggingFace] Model loading:', res.data.error)
    throw Object.assign(new Error('HF model loading'), { response: { status: 503 } })
  }

  const raw = Array.isArray(res?.data)
    ? res.data[0]?.generated_text
    : res?.data?.generated_text
  console.log('[HuggingFace] Raw reply:', raw?.slice(0, 80))
  return raw || null
}

// ─── MODEL LIMIT FALLBACK message ────────────────────────────────────────────
const LIMIT_FALLBACK = {
  type: 'general',
  language: 'english',
  steps: ['error'],
  response: 'Sir, my API limit is reached. Please try later or switch the model.',
  suggestion: 'You can switch to a different AI model from the selector.',
  extra: null,
}

// ─── Unified dispatcher ───────────────────────────────────────────────────────
/**
 * @param {string} command  - raw user command
 * @param {string} assistantName
 * @param {string} userName
 * @param {'gemini'|'openai'|'groq'|'huggingface'} model
 * @returns {string|null}   - raw text from the model
 */
export const getAIResponse = async (command, assistantName, userName, model = 'gemini') => {
  const cleaned = cleanInput(command)
  const cacheKey = `${model}::${cleaned.toLowerCase()}`

  // Check cache first
  const cached = getCached(cacheKey)
  if (cached) { console.log(`[AI] Cache hit for "${cleaned}"`) ; return cached }

  const prompt = buildPrompt(cleaned, assistantName, userName)

  try {
    let raw = null

    switch (model) {
      case 'openai':      raw = await callOpenAI(prompt);    break
      case 'groq':        raw = await callGroq(prompt);      break
      case 'huggingface': raw = await callHuggingFace(prompt); break
      case 'gemini':
      default:            raw = await callGemini(prompt);    break
    }

    if (raw) setCache(cacheKey, raw)
    return raw

  } catch (err) {
    const status = err?.response?.status
    console.error(`[AI:${model}] Final error [${status || 'unknown'}]:`, err?.message)

    if (status === 429 || status === 503) return JSON.stringify(LIMIT_FALLBACK)
    return null
  }
}
