import uploadOnCloudinary from '../config/cloudinary.js'
import { getAIResponse, cleanInput, safeParseJson } from '../services/ai.service.js'
import User from '../models/user.model.js'
import moment from 'moment'
import { getYouTubeVideoUrl } from '../services/youtube.service.js'
import { initWhatsApp, getWhatsAppStatus, getWhatsAppWebUrl } from '../services/whatsapp.service.js'

// ─── Valid model ids ─────────────────────────────────────────────────────────
const VALID_MODELS = new Set(['gemini', 'openai', 'groq', 'huggingface'])

// ─── Local YouTube-play regex ─────────────────────────────────────────────────
const YT_PLAY_RE = /^(?:play|chalao|sunao|bajao|play karo|laga do|laga|chala)\s+(.+)/i
const detectYtSong = (input) => { const m = input.match(YT_PLAY_RE); return m ? m[1].trim() : null }

// ─── Safe math evaluator (server-side fallback) ────────────────────────────────
// Strips letters/words, evaluates only the numeric expression safely.
const safeMathEval = (expr) => {
  try {
    // Normalize: replace Hindi/Urdu number words and common operators
    const normalized = String(expr)
      .replace(/[^0-9+\-*/().%\s]/g, '')   // keep only numbers & operators
      .trim()
    if (!normalized) return null
    // Only allow safe math characters
    if (!/^[0-9+\-*/().%\s]+$/.test(normalized)) return null
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + normalized + ')')()
    return isFinite(result) ? String(result) : null
  } catch {
    return null
  }
}

// ─── Busy / limit fallback ───────────────────────────────────────────────────
const BUSY_RESPONSE = (lang = 'english') => ({
  type: 'general',
  language: lang,
  steps: ['error'],
  response: lang === 'hindi'
    ? 'Sir, abhi server thoda busy hai. Thodi der baad try karein ya model badlein.'
    : 'Server busy, try again. Or switch to a different model.',
  suggestion: lang === 'hindi'
    ? 'Aap model selector se model badal sakte hain.'
    : 'You can switch the AI model from the selector.',
  extra: null,
})

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  assistantName: user.assistantName || '',
  assistantImage: user.assistantImage || '',
  history: Array.isArray(user.history) ? user.history : [],
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
})

const normalizeText = (value = '') =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()

const cleanContactCandidate = (value = '') =>
  normalizeText(value)
    .replace(/^(to|for|contact|message|send|whatsapp|text)\s+/i, '')
    .replace(/\s+(on|via)\s+whatsapp$/i, '')
    .replace(/\s+ko$/i, '')
    .trim()

const cleanMessageCandidate = (value = '') =>
  normalizeText(value)
    .replace(/^(that|saying|message|text|bolo|bol|kehdo|kehna|kaho)\s+/i, '')
    .trim()

const isLikelyFullSentence = (value = '', command = '') => {
  const normalizedValue = normalizeText(value).toLowerCase()
  const normalizedCommand = normalizeText(command).toLowerCase()

  return Boolean(normalizedValue) && Boolean(normalizedCommand) && normalizedValue === normalizedCommand
}

const parseWhatsAppIntent = (command, aiTarget, aiMessage) => {
  const cleanedCommand = normalizeText(command)
  const normalizedTarget = cleanContactCandidate(aiTarget)
  const normalizedMessage = cleanMessageCandidate(aiMessage)

  const candidate = {
    contactName: isLikelyFullSentence(normalizedTarget, cleanedCommand) ? '' : normalizedTarget,
    message: isLikelyFullSentence(normalizedMessage, cleanedCommand) ? '' : normalizedMessage,
  }

  const patterns = [
    /^(?:send(?: a)?(?: whatsapp)? message to|send whatsapp to|send to|message|text)\s+(.+?)\s+(?:saying|saying that|that says|with message|message(?:ing)?|text(?:ing)?)\s+(.+)$/i,
    /^(.+?)\s+ko\s+(?:whatsapp(?: par)?|message)\s+(?:bolo|bolna|kehdo|kehna|kaho|bhejo)\s+(.+)$/i,
    /^(?:whatsapp|message|text)\s+(.+?)\s+(?:saying|that|bolo|kehdo|kehna|kaho)\s+(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = cleanedCommand.match(pattern)
    if (!match) continue

    const parsedContact = cleanContactCandidate(match[1])
    const parsedMessage = cleanMessageCandidate(match[2])

    if (!candidate.contactName && parsedContact) candidate.contactName = parsedContact
    if (!candidate.message && parsedMessage) candidate.message = parsedMessage
  }

  if (!candidate.contactName) {
    const contactOnlyMatch = cleanedCommand.match(/(?:to|message|text|whatsapp)\s+([a-z0-9 ._-]{2,60})$/i)
    if (contactOnlyMatch) {
      candidate.contactName = cleanContactCandidate(contactOnlyMatch[1])
    }
  }

  return candidate
}

const validateWhatsAppPayload = ({ contactName, message }) => {
  if (!contactName) {
    return 'Contact name is required for WhatsApp.'
  }

  if (contactName.length < 2 || contactName.length > 60) {
    return 'Contact name looks invalid. Please say only the contact name.'
  }

  if (!message) {
    return 'Message text is required for WhatsApp.'
  }

  if (message.length < 1 || message.length > 500) {
    return 'Message length is invalid for WhatsApp.'
  }

  return null
}

// ─── getCurrentUser ───────────────────────────────────────────────────────────
export const getCurrentUser = async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    const user = await User.findById(req.userId).select('-password')
    if (!user) return res.status(404).json({ message: 'User not found.' })
    return res.status(200).json({ user: sanitizeUser(user) })
  } catch (error) {
    console.error('[getCurrentUser] Error:', error)
    return res.status(500).json({ message: 'Unable to fetch the current user.' })
  }
}

// ─── updateAssistant ─────────────────────────────────────────────────────────
export const updateAssistant = async (req, res) => {
  try {
    const { assistantName, imageUrl } = req.body
    const assistantImage = req.file ? await uploadOnCloudinary(req.file.path) : imageUrl
    const user = await User.findByIdAndUpdate(
      req.userId,
      { assistantName, assistantImage },
      { new: true }
    ).select('-password')
    if (!user) {
      return res.status(404).json({ message: 'User not found.' })
    }
    return res.status(200).json({ user: sanitizeUser(user) })
  } catch (error) {
    console.error('[updateAssistant] Error:', error)
    return res.status(500).json({ message: 'Unable to update assistant settings.' })
  }
}

// ─── askToAssistant (main endpoint) ─────────────────────────────────────────
export const askToAssistant = async (req, res) => {
  try {
    const { command, model: rawModel } = req.body
    if (!command || typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({
        type: 'general',
        steps: ['error'],
        language: 'english',
        response: 'Please provide a valid command.',
        suggestion: null,
        extra: null,
      })
    }

    const model = VALID_MODELS.has(rawModel) ? rawModel : 'gemini'

    const user = await User.findById(req.userId)
    if (!user) return res.status(401).json({ message: 'user not found' })

    user.history.push(command)
    user.save().catch(console.error)         // non-blocking save

    const { name: userName, assistantName } = user
    const cleanedCommand = cleanInput(command || '')
    const localYtSong = detectYtSong(cleanedCommand)

    // ── Call selected AI model ───────────────────────────────────────────────
    const raw = await getAIResponse(command, assistantName, userName, model)
    const gemResult = raw ? safeParseJson(raw) : null

    console.log(`[${model.toUpperCase()}] result:`, gemResult)

    // ── Fallback: Gemini/AI failed ───────────────────────────────────────────
    if (!gemResult) {
      // If we can resolve a YouTube intent locally, do it
      if (localYtSong) {
        const videoData = await getYouTubeVideoUrl(localYtSong).catch(() => null)
        if (videoData) {
          return res.json({
            type: 'youtube-play',
            language: 'english',
            steps: ['search_youtube', 'get_video_id', 'play_video'],
            userInput: localYtSong,
            response: `Yes sir, playing "${videoData.title}" on YouTube right now! Do you need anything else?`,
            suggestion: 'Would you like to hear more songs like this, sir?',
            extra: videoData.url,
            videoTitle: videoData.title,
            videoId: videoData.videoId,
          })
        }
      }
      return res.status(503).json(BUSY_RESPONSE())
    }

    const { type, steps, target, message, suggestion, extra, language } = gemResult
    const userInput = gemResult.userInput || cleanedCommand
    const isHindi = (language || 'english') === 'hindi'
    const lang = isHindi ? 'hindi' : 'english'

    // ── Override: local regex detected youtube-play but AI didn't ─────────────
    if (type !== 'youtube-play' && localYtSong) {
      const videoData = await getYouTubeVideoUrl(localYtSong).catch(() => null)
      if (videoData) {
        return res.json({
          type: 'youtube-play', language: lang,
          steps: ['search_youtube', 'get_video_id', 'play_video'],
          userInput: localYtSong,
          response: isHindi
            ? `Haan sir, "${videoData.title}" YouTube par play ho raha hai! Kya aur koi kaam hai?`
            : `Yes sir, playing "${videoData.title}" on YouTube right now! Do you need anything else?`,
          suggestion: suggestion || (isHindi
            ? 'Kya aap isi artist ka koi aur gaana sunna chahenge?'
            : 'Would you like to hear more songs from this artist, sir?'),
          extra: videoData.url,
          videoTitle: videoData.title,
          videoId: videoData.videoId,
        })
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DATE / TIME (always server-side — accurate regardless of model)
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'get-date') {
      const d = moment().format('Do MMMM YYYY')
      return res.json({
        type, steps, userInput, language: lang,
        response: isHindi ? `Haan sir, aaj ki date ${d} hai. Kya aur koi kaam hai?` : `Yes sir, today is ${d}. Do you need anything else?`,
        suggestion: isHindi ? 'Kya aap koi reminder set karna chahenge?' : 'Would you like to set a reminder, sir?',
        extra: null
      })
    }
    if (type === 'get-time') {
      const t = moment().format('hh:mm A')
      return res.json({
        type, steps, userInput, language: lang,
        response: isHindi ? `Ji sir, abhi ${t} baj rahe hain. Kya aur koi kaam hai?` : `Yes sir, the current time is ${t}. Do you need anything else?`,
        suggestion: isHindi ? 'Kya aap alarm set karna chahenge?' : 'Would you like to set an alarm, sir?',
        extra: null
      })
    }
    if (type === 'get-day') {
      const day = moment().format('dddd')
      return res.json({
        type, steps, userInput, language: lang,
        response: isHindi ? `Haan sir, aaj ${day} hai. Kya aur koi kaam hai?` : `Yes sir, today is ${day}. Do you need anything else?`,
        suggestion: isHindi ? 'Kya aap is hafte ka schedule dekhna chahenge?' : 'Would you like to check your schedule, sir?',
        extra: null
      })
    }
    if (type === 'get-month') {
      const month = moment().format('MMMM')
      return res.json({
        type, steps, userInput, language: lang,
        response: isHindi ? `Ji sir, ${month} chal raha hai. Kya aur koi kaam hai?` : `Yes sir, the current month is ${month}. Do you need anything else?`,
        suggestion: suggestion || null, extra: null
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // YOUTUBE PLAY
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'youtube-play') {
      const videoData = await getYouTubeVideoUrl(userInput).catch(() => null)
      if (videoData) {
        return res.json({
          type, steps, userInput, language: lang,
          response: gemResult.response || (isHindi
            ? `Haan sir, "${videoData.title}" play ho raha hai! Kya aur koi kaam hai?`
            : `Yes sir, playing "${videoData.title}" on YouTube! Do you need anything else?`),
          suggestion: suggestion || null,
          extra: videoData.url,
          videoTitle: videoData.title,
          videoId: videoData.videoId,
        })
      }
      // Fallback: search
      return res.json({
        type: 'youtube-search',
        steps: ['open_youtube', 'enter_search_query'],
        userInput, language: lang,
        response: isHindi ? `Sir, ${userInput} YouTube par search ho raha hai.` : `Yes sir, searching for ${userInput} on YouTube.`,
        suggestion: null, extra: null,
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WHATSAPP SEND
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'whatsapp-send') {
      const parsedWhatsApp = parseWhatsAppIntent(cleanedCommand, target, message || extra || '')
      const contactName = parsedWhatsApp.contactName
      const msgBody = parsedWhatsApp.message
      const validationError = validateWhatsAppPayload({ contactName, message: msgBody })

      if (validationError) {
        return res.status(422).json({
          type,
          steps: ['error'],
          target: contactName || null,
          message: msgBody || null,
          userInput,
          language: lang,
          response: isHindi
            ? 'Sir, WhatsApp ke liye contact ya message sahi samajh nahin aaya. Kripya contact naam aur message clearly boliye.'
            : 'I could not clearly understand the WhatsApp contact or message. Please say the contact name and message clearly.',
          suggestion: suggestion || null,
          extra: null,
          error: validationError,
        })
      }

      const whatsappUrl = getWhatsAppWebUrl()
      if (!whatsappUrl) {
        return res.status(503).json({
          type,
          steps: ['error'],
          target: contactName,
          message: msgBody,
          userInput,
          language: lang,
          response: isHindi
            ? 'Sir, WhatsApp Web URL taiyar nahin ho payi. Kripya dobara try kijiye.'
            : 'The WhatsApp Web URL could not be prepared. Please try again.',
          suggestion: suggestion || null,
          extra: null,
          error: 'WhatsApp URL unavailable',
        })
      }

      return res.json({
        type,
        steps: steps || ['open_whatsapp'],
        target: contactName, message: msgBody, userInput, language: lang,
        response: gemResult.response || (isHindi
          ? `Ji sir, ${contactName} ke liye WhatsApp same Chrome window mein khol raha hoon! Kya aur koi kaam hai?`
          : `Yes sir, opening WhatsApp for ${contactName} in the same Chrome window! Do you need anything else?`),
        suggestion: suggestion || null,
        extra: whatsappUrl,
        whatsappStatus: 'ready',
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SPOTIFY PLAY
    // Use track search URL — opens Spotify's track search (works in both app & web)
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'spotify-play') {
      // URI scheme: try the Spotify app first; fall back to web player search
      const encoded = encodeURIComponent(userInput)
      const spotifyWebUrl = `https://open.spotify.com/search/${encoded}/tracks`
      return res.json({
        type, steps, userInput, language: lang,
        response: gemResult.response || (isHindi
          ? `Haan sir, Spotify par "${userInput}" search ho raha hai! Kya aur koi kaam hai?`
          : `Yes sir, opening "${userInput}" on Spotify! Do you need anything else?`),
        suggestion: suggestion || null,
        extra: spotifyWebUrl,     // frontend opens this URL in the shared browser window
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MATH CALCULATE
    // If AI returned extra: null, compute server-side as fallback
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'math-calculate') {
      // Try AI result first; fall back to server-side safe eval
      const mathAnswer = extra || safeMathEval(userInput) || safeMathEval(cleanedCommand)
      const answerStr = mathAnswer ?? '?'

      // Build a guaranteed useful response with the actual number
      const mathResponse = isHindi
        ? `Haan sir, ${userInput} ka jawab ${answerStr} hai. Kya aur koi kaam hai?`
        : `Yes sir, the answer to ${userInput} is ${answerStr}. Do you need anything else?`

      return res.json({
        type, steps, userInput, language: lang,
        response: mathResponse,
        suggestion: suggestion || null,
        extra: answerStr,
      })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GOOGLE INFO / GENERAL (pass-through with engagement)
    // ─────────────────────────────────────────────────────────────────────────
    const baseResponse = gemResult.response || (isHindi ? 'Ji sir, ho gaya!' : 'Yes sir, done!')
    const engagementSuffix = isHindi ? ' Kya aur koi kaam hai?' : ' Do you need anything else?'
    const finalResponse = baseResponse.includes('koi kaam') || baseResponse.includes('anything else')
      ? baseResponse
      : baseResponse + engagementSuffix

    return res.json({
      type,
      steps: steps || [],
      target: target || null,
      message: message || null,
      userInput, language: lang,
      response: finalResponse,
      suggestion: suggestion || null,
      extra: extra || null,
    })

  } catch (error) {
    console.error('[askToAssistant] Unexpected error:', error)
    return res.status(500).json(BUSY_RESPONSE())
  }
}

// ─── WhatsApp status / init ──────────────────────────────────────────────────
export const whatsappInit = async (req, res) => {
  try {
    const result = await initWhatsApp()
    return res.json(result)
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message })
  }
}

export const whatsappStatus = async (req, res) =>
  res.json({ status: getWhatsAppStatus() })
