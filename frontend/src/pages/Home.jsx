import React, { useContext, useEffect, useRef, useState, useCallback } from 'react'
import { userDataContext } from '../context/UserContext'
import { useNavigate } from 'react-router-dom'
import aiImg from '../assets/ai.gif'
import { CgMenuRight } from 'react-icons/cg'
import { RxCross1 } from 'react-icons/rx'
import userImg from '../assets/user.gif'

// ── AI Model options ──────────────────────────────────────────────────────────
const MODEL_OPTIONS = [
  { id: 'gemini',      label: 'Gemini',      color: '#4285F4' },
  { id: 'openai',      label: 'OpenAI',      color: '#10a37f' },
  { id: 'groq',        label: 'Groq',        color: '#f55036' },
  { id: 'huggingface', label: 'HuggingFace', color: '#ff9d00' },
]

// ── Step labels (bilingual) ───────────────────────────────────────────────────
const STEP_LABELS = {
  open_whatsapp:      { hindi: 'WhatsApp kholna...',             english: 'Opening WhatsApp...' },
  search_contact:     { hindi: 'Contact dhoondna...',            english: 'Searching contact...' },
  open_chat:          { hindi: 'Chat kholna...',                 english: 'Opening chat...' },
  type_message:       { hindi: 'Message type karna...',          english: 'Typing message...' },
  send_message:       { hindi: 'Message bhejna...',              english: 'Sending message...' },
  search_youtube:     { hindi: 'YouTube par search ho rahi hai...', english: 'Searching on YouTube...' },
  get_video_id:       { hindi: 'Video dhoondi ja rahi hai...',   english: 'Finding video...' },
  play_video:         { hindi: 'Video play ho rahi hai...',      english: 'Playing video...' },
  open_youtube:       { hindi: 'YouTube khul raha hai...',       english: 'Opening YouTube...' },
  enter_search_query: { hindi: 'Query enter ho rahi hai...',     english: 'Entering search query...' },
  open_spotify:       { hindi: 'Spotify khul raha hai...',       english: 'Opening Spotify...' },
  search_song:        { hindi: 'Gaana dhoondh raha hoon...',     english: 'Searching song...' },
  play_song:          { hindi: 'Gaana play ho raha hai...',      english: 'Playing song...' },
  parse_expression:   { hindi: 'Expression parse ho raha hai...', english: 'Parsing expression...' },
  calculate:          { hindi: 'Calculate ho raha hai...',       english: 'Calculating...' },
  return_result:      { hindi: 'Result taiyar hai!',             english: 'Result ready!' },
  analyze_query:      { hindi: 'Query samajh raha hoon...',      english: 'Analyzing query...' },
  fetch_info:         { hindi: 'Jaankari le raha hoon...',       english: 'Fetching information...' },
  summarize:          { hindi: 'Summary taiyar kar raha hoon...', english: 'Summarizing...' },
  open_google:        { hindi: 'Google khul raha hai...',        english: 'Opening Google...' },
  search_weather:     { hindi: 'Weather dekh raha hoon...',      english: 'Checking weather...' },
  open_calculator:    { hindi: 'Calculator khul raha hai...',    english: 'Opening calculator...' },
  open_instagram:     { hindi: 'Instagram khul raha hai...',     english: 'Opening Instagram...' },
  open_facebook:      { hindi: 'Facebook khul raha hai...',      english: 'Opening Facebook...' },
  get_system_time:    { hindi: 'Samay dekh raha hoon...',        english: 'Checking system time...' },
  get_system_date:    { hindi: 'Date dekh raha hoon...',         english: 'Checking date...' },
  get_system_day:     { hindi: 'Din dekh raha hoon...',          english: 'Checking day...' },
  get_system_month:   { hindi: 'Month dekh raha hoon...',        english: 'Checking month...' },
  generate_response:  { hindi: 'Jawab taiyar ho raha hai...',    english: 'Preparing response...' },
  error:              { hindi: 'Kuch galat ho gaya.',            english: 'Something went wrong.' },
}
const getStepLabel = (step, lang) => {
  const entry = STEP_LABELS[step]
  if (!entry) return step
  return lang === 'english' ? entry.english : entry.hindi
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Load voices, resolving only after voices are available (handles async load)
const loadVoices = () =>
  new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) return resolve(voices)
    window.speechSynthesis.onvoiceschanged = () =>
      resolve(window.speechSynthesis.getVoices())
  })

// ─────────────────────────────────────────────────────────────────────────────
function Home() {
  const {
    userData, logout,
    getGeminiResponse, selectedModel, changeModel,
  } = useContext(userDataContext)
  const navigate = useNavigate()

  // ── UI state ────────────────────────────────────────────────────────────────
  const [listening,     setListening]     = useState(false)
  const [processing,    setProcessing]    = useState(false)   // while API call is in-flight
  const [userText,      setUserText]      = useState('')
  const [aiText,        setAiText]        = useState('')
  const [suggestionText,setSuggestion]    = useState('')
  const [steps,         setSteps]         = useState([])
  const [activeStep,    setActiveStep]    = useState(-1)
  const [stepsVisible,  setStepsVisible]  = useState(false)
  const [currentLang,   setCurrentLang]   = useState('hindi')
  const [ham,           setHam]           = useState(false)

  // ── Stable refs (avoid stale closures in event handlers) ────────────────────
  const recognitionRef    = useRef(null)
  const isSpeakingRef     = useRef(false)
  const isRecognizingRef  = useRef(false)
  const isProcessingRef   = useRef(false)   // prevents double-fire
  const isMountedRef      = useRef(true)
  // Keep latest callbacks accessible inside recognition event handler
  const getResponseRef    = useRef(getGeminiResponse)
  const userDataRef       = useRef(userData)

  useEffect(() => { getResponseRef.current = getGeminiResponse }, [getGeminiResponse])
  useEffect(() => { userDataRef.current    = userData          }, [userData])

  // ── Logout ───────────────────────────────────────────────────────────────────
  const handleLogOut = async () => {
    await logout()
    navigate('/signin')
  }

  // ── TTS — fixed: no double idx increment ─────────────────────────────────────
  const speak = useCallback((text, lang = 'hindi', onDone) => {
    if (!text) { if (onDone) onDone(); return }

    const synth = window.speechSynthesis
    synth.cancel()

    const isHindi = lang !== 'english'
    // Split on sentence-end punctuation; keep delimiter at end of each chunk
    const sentences = text.match(/[^।.!?]+[।.!?]*/g) ?? [text]

    loadVoices().then(voices => {
      let idx = 0
      isSpeakingRef.current = true

      const speakNext = () => {
        // All sentences done
        if (idx >= sentences.length) {
          isSpeakingRef.current = false
          console.log('[TTS] Done speaking.')
          if (onDone) onDone()
          // Resume listening after TTS finishes
          setTimeout(() => {
            if (isMountedRef.current && !isProcessingRef.current) {
              safeStartRecognition()
            }
          }, 600)
          return
        }

        const sentence = sentences[idx].trim()
        if (!sentence) { idx++; speakNext(); return }   // skip blank chunks

        const utt = new SpeechSynthesisUtterance(sentence)

        if (isHindi) {
          utt.voice = voices.find(v => v.lang === 'hi-IN')
                   || voices.find(v => v.lang.startsWith('hi'))
                   || voices.find(v => v.lang === 'en-IN')
                   || null
          utt.lang  = utt.voice?.lang ?? 'hi-IN'
        } else {
          utt.voice = voices.find(v => v.lang === 'en-US' && v.name.toLowerCase().includes('female'))
                   || voices.find(v => v.lang === 'en-US')
                   || voices.find(v => v.lang === 'en-IN')
                   || null
          utt.lang  = utt.voice?.lang ?? 'en-US'
        }
        utt.rate  = 1.0
        utt.pitch = 1.05

        // ✅ FIX: only increment idx in onend/onerror — NOT after synth.speak()
        utt.onend   = () => { idx++; speakNext() }
        utt.onerror = (e) => {
          console.warn('[TTS] utterance error:', e.error)
          idx++
          speakNext()
        }

        console.log(`[TTS] Speaking [${lang}]: "${sentence}"`)
        synth.speak(utt)
      }

      speakNext()
    })
  }, [])

  // ── Safe start recognition ────────────────────────────────────────────────
  const safeStartRecognition = useCallback(() => {
    if (isSpeakingRef.current || isRecognizingRef.current || isProcessingRef.current) return
    try {
      console.log('[STT] Starting recognition...')
      recognitionRef.current?.start()
    } catch (e) {
      if (e.name !== 'InvalidStateError') console.error('[STT] Start error:', e)
    }
  }, [])

  // ── Step animator ────────────────────────────────────────────────────────────
  const animateSteps = useCallback((stepsArr, lang) => {
    if (!stepsArr?.length) return
    setSteps(stepsArr)
    setStepsVisible(true)
    setActiveStep(0)
    stepsArr.forEach((_, i) => setTimeout(() => setActiveStep(i), i * 700))
    setTimeout(() => setActiveStep(stepsArr.length), stepsArr.length * 700 + 500)
  }, [])

  // ── Handle backend response + dispatch action ─────────────────────────────────
  const handleCommand = useCallback((data, transcript) => {
    console.log('[CMD] Handling command:', data)
    const { type, steps: stepsArr, userInput, response, suggestion, extra, videoTitle, language, result } = data
    const lang = language || 'hindi'

    setCurrentLang(lang)
    setSuggestion('')
    animateSteps(stepsArr || [], lang)

    const msg = response || (lang === 'english'
      ? "Yes sir, I'm here. How can I help you?"
      : 'Haan sir, main yahan hoon. Kya kaam hai aapka?')

    setAiText(msg)
    if (suggestion) setSuggestion(suggestion)

    const openUrl = (url) => {
      try {
        const openedWindow = window.open(url, 'jarvis_browser')
        return Boolean(openedWindow)
      } catch (error) {
        console.error('[Browser] Failed to open URL:', url, error)
        return false
      }
    }

    switch (type) {
      case 'youtube-play':
        if (extra?.startsWith('http')) openUrl(extra)
        else openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(userInput)}&sp=EgIQAQ%3D%3D`)
        break

      case 'youtube-search':
        openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(userInput)}`)
        break

      case 'whatsapp-send': {
        const opened = openUrl(extra || 'https://web.whatsapp.com/')
        if (!opened) {
          const openError = lang === 'english'
            ? 'I could not open WhatsApp in a new tab. Please allow pop-ups for this site and try again.'
            : 'Main WhatsApp ko naye tab mein nahin khol paaya. Kripya is site ke liye pop-ups allow karke dobara try kijiye.'

          setAiText(openError)
          speak(openError, lang)
          return
        }
        break
      }


      case 'spotify-play': {
        const url = extra || `https://open.spotify.com/search/${encodeURIComponent(userInput)}/tracks`
        openUrl(url)
        break
      }

      case 'google-search':
        openUrl(`https://www.google.com/search?q=${encodeURIComponent(userInput)}`)
        break

      case 'weather-show':
        openUrl(`https://www.google.com/search?q=${lang === 'english' ? 'weather+today' : 'aaj+ka+mausam'}`)
        break

      case 'calculator-open':
        openUrl('https://www.google.com/search?q=calculator')
        break

      case 'instagram-open':
        openUrl('https://www.instagram.com/')
        break

      case 'facebook-open':
        openUrl('https://www.facebook.com/')
        break

      case 'google-info': {
        const fullText = extra ? `${msg} ${extra}` : msg
        setAiText(fullText)
        speak(fullText, lang)
        return   // early return — speak called with combined text
      }

      default:
        break
    }

    speak(msg, lang)
  }, [speak, animateSteps])

  // ── Process a transcript (API call + response handling) ───────────────────────
  const processTranscript = useCallback(async (transcript) => {
    if (isProcessingRef.current) {
      console.log('[STT] Already processing, skipping:', transcript)
      return
    }

    console.log('[FLOW] Processing transcript:', transcript)
    isProcessingRef.current = true
    setProcessing(true)
    setAiText('')
    setSuggestion('')
    setSteps([])
    setActiveStep(-1)
    setStepsVisible(false)
    setUserText(transcript)

    try {
      console.log('[API] Sending to backend…')
      const data = await getResponseRef.current(transcript)
      console.log('[API] Raw response:', data)

      if (!data) {
        const fallbackMsg = 'Server busy, try again.'
        setAiText(fallbackMsg)
        speak(fallbackMsg, 'english')
        return
      }

      if (data.language) setCurrentLang(data.language)
      handleCommand(data, transcript)

    } catch (err) {
      console.error('[API] Error:', err)
      const errMsg = 'Something went wrong. Please try again.'
      setAiText(errMsg)
      speak(errMsg, 'english')
    } finally {
      isProcessingRef.current = false
      setProcessing(false)
      setUserText('')
    }
  }, [handleCommand, speak])

  // ── Speech Recognition setup (runs once on mount) ─────────────────────────────
  useEffect(() => {
    isMountedRef.current = true

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      console.error('[STT] SpeechRecognition not supported in this browser.')
      return
    }

    // ── Build recognition instance ─────────────────────────────────────────
    const recognition = new SR()
    recognition.continuous     = true
    recognition.interimResults = false
    recognition.lang           = 'hi-IN'   // hi-IN accepts both Hindi and English well
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition

    // ── Handlers ───────────────────────────────────────────────────────────
    recognition.onstart = () => {
      console.log('[STT] Recognition started ✓')
      isRecognizingRef.current = true
      setListening(true)
    }

    recognition.onend = () => {
      console.log('[STT] Recognition ended.')
      isRecognizingRef.current = false
      setListening(false)

      // Auto-restart unless unmounted, speaking, or processing
      if (isMountedRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          if (isMountedRef.current) safeStartRecognition()
        }, 800)
      }
    }

    recognition.onerror = (ev) => {
      console.warn('[STT] Error:', ev.error)
      isRecognizingRef.current = false
      setListening(false)

      // 'no-speech' and 'aborted' are safe — just restart
      const safeErrors = ['no-speech', 'aborted']
      if (safeErrors.includes(ev.error)) {
        if (isMountedRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
          setTimeout(() => { if (isMountedRef.current) safeStartRecognition() }, 800)
        }
        return
      }

      if (ev.error === 'not-allowed') {
        console.error('[STT] Microphone permission denied! Cannot start.')
        setAiText('Microphone permission denied. Please allow mic access and refresh.')
      }
    }

    recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1]
      if (!result.isFinal) return   // ignore interim results

      const transcript = result[0].transcript.trim()
      console.log('[STT] Heard:', transcript)

      if (!transcript) return

      // ── Process ALL recognized speech unconditionally ──────────────────────
      // No wake-word gate — every final transcript triggers the full flow.
      console.log('[STT] ✅ Transcript accepted:', transcript)
      try { recognition.stop() } catch (_) {}
      processTranscript(transcript)
    }

    // ── Greeting (wait for voices to load before speaking) ─────────────────
    loadVoices().then(voices => {
      if (!isMountedRef.current) return

      const assistantName = userDataRef.current?.assistantName ?? 'Jarvis'
      const name          = userDataRef.current?.name ?? 'sir'
      const greetMsg      = `Namaste ${name} sir! Main ${assistantName} hoon. Aapki kya seva kar sakta hoon?`

      const greet = new SpeechSynthesisUtterance(greetMsg)
      greet.voice = voices.find(v => v.lang === 'hi-IN')
                 || voices.find(v => v.lang.startsWith('hi'))
                 || null
      greet.lang  = greet.voice?.lang ?? 'hi-IN'
      greet.rate  = 1.0

      isSpeakingRef.current = true

      greet.onend = () => {
        console.log('[TTS] Greeting done, starting recognition.')
        isSpeakingRef.current = false
        if (isMountedRef.current) setTimeout(safeStartRecognition, 400)
      }
      greet.onerror = () => {
        console.warn('[TTS] Greeting error — starting recognition anyway.')
        isSpeakingRef.current = false
        if (isMountedRef.current) setTimeout(safeStartRecognition, 400)
      }

      console.log('[TTS] Speaking greeting…')
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(greet)
    })

    // ── Cleanup ────────────────────────────────────────────────────────────
    return () => {
      isMountedRef.current = false
      try { recognition.abort() } catch (_) {}
      window.speechSynthesis.cancel()
      setListening(false)
      isRecognizingRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className='w-full h-[100vh] bg-gradient-to-t from-[black] to-[#02023d] flex justify-center items-center flex-col gap-[15px] overflow-hidden relative'>

      {/* ── Hamburger (mobile) ── */}
      <CgMenuRight
        className='lg:hidden text-white absolute top-[20px] right-[20px] w-[25px] h-[25px] cursor-pointer z-50'
        onClick={() => setHam(true)}
      />

      {/* ── Mobile Drawer ── */}
      <div className={`absolute lg:hidden top-0 w-full h-full bg-[#00000080] backdrop-blur-lg p-[20px] flex flex-col gap-[20px] items-start z-40 ${ham ? 'translate-x-0' : 'translate-x-full'} transition-transform duration-300`}>
        <RxCross1 className='text-white absolute top-[20px] right-[20px] w-[25px] h-[25px] cursor-pointer' onClick={() => setHam(false)} />
        <button className='min-w-[150px] h-[55px] text-black font-semibold bg-white rounded-full cursor-pointer text-[17px]' onClick={handleLogOut}>Log Out</button>
        <button className='min-w-[150px] h-[55px] text-black font-semibold bg-white rounded-full cursor-pointer text-[17px] px-[20px]' onClick={() => navigate('/customize')}>Customize Assistant</button>

        {/* Mobile model selector */}
        <div className='w-full'>
          <p className='text-gray-400 text-[13px] mb-[8px] font-medium'>🤖 AI Model</p>
          <div className='flex flex-wrap gap-[8px]'>
            {MODEL_OPTIONS.map(m => (
              <button
                key={m.id}
                id={`model-mobile-btn-${m.id}`}
                onClick={() => { changeModel(m.id); setHam(false) }}
                style={{
                  background: selectedModel === m.id ? m.color : 'rgba(255,255,255,0.08)',
                  border: `1.5px solid ${selectedModel === m.id ? m.color : 'rgba(255,255,255,0.2)'}`,
                  color: '#fff',
                  fontWeight: selectedModel === m.id ? 700 : 400,
                }}
                className='h-[36px] px-[14px] rounded-full text-[13px] cursor-pointer'
              >
                {selectedModel === m.id ? '● ' : '○ '}{m.label}
              </button>
            ))}
          </div>
        </div>

        <div className='w-full h-[2px] bg-gray-500' />
        <h2 className='text-white font-semibold text-[17px]'>History</h2>
        <div className='w-full flex-1 overflow-y-auto flex flex-col gap-[12px]'>
          {userData.history?.map((his, i) => (
            <div key={i} className='text-gray-300 text-[15px] truncate'>{his}</div>
          ))}
        </div>
      </div>

      {/* ── Desktop buttons ── */}
      <button className='min-w-[150px] h-[55px] text-black font-semibold absolute hidden lg:block top-[20px] right-[20px] bg-white rounded-full cursor-pointer text-[17px]' onClick={handleLogOut}>Log Out</button>
      <button className='min-w-[150px] h-[55px] text-black font-semibold bg-white absolute top-[90px] right-[20px] rounded-full cursor-pointer text-[17px] px-[20px] hidden lg:block' onClick={() => navigate('/customize')}>Customize Assistant</button>

      {/* ── Desktop Model Selector ── */}
      <div className='absolute top-[165px] right-[20px] hidden lg:flex flex-col gap-[6px] items-end'>
        {MODEL_OPTIONS.map(m => (
          <button
            key={m.id}
            id={`model-btn-${m.id}`}
            onClick={() => changeModel(m.id)}
            title={`Switch to ${m.label}`}
            style={{
              background: selectedModel === m.id ? m.color : 'rgba(255,255,255,0.08)',
              border: `1.5px solid ${selectedModel === m.id ? m.color : 'rgba(255,255,255,0.15)'}`,
              color: selectedModel === m.id ? '#fff' : 'rgba(255,255,255,0.55)',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.22s ease',
              fontWeight: selectedModel === m.id ? 700 : 400,
            }}
            className='h-[34px] px-[14px] rounded-full text-[13px] cursor-pointer min-w-[120px]'
          >
            {selectedModel === m.id ? '● ' : '○ '}{m.label}
          </button>
        ))}
      </div>

      {/* ── Assistant Avatar ── */}
      <div className='w-[220px] h-[280px] flex justify-center items-center overflow-hidden rounded-3xl shadow-2xl border border-white/10'>
        <img src={userData?.assistantImage} alt='assistant' className='h-full w-full object-cover' />
      </div>

      <h1 className='text-white text-[18px] font-semibold tracking-wide'>
        Main hoon {userData?.assistantName} 🤖
      </h1>

      {/* ── Active model badge ── */}
      {(() => {
        const m = MODEL_OPTIONS.find(x => x.id === selectedModel)
        return (
          <div
            style={{ background: `${m?.color}22`, border: `1px solid ${m?.color}55`, color: m?.color }}
            className='px-[12px] py-[3px] rounded-full text-[11px] font-semibold tracking-wide -mt-2'
          >
            {m?.label || selectedModel}
          </div>
        )
      })()}

      {/* ── Status indicators ── */}
      {listening && !processing && (
        <div className='flex items-center gap-2'>
          <div className='w-2.5 h-2.5 bg-red-500 rounded-full animate-ping' />
          <span className='text-red-400 text-sm font-medium'>
            {currentLang === 'english' ? 'Listening...' : 'Sun raha hoon...'}
          </span>
        </div>
      )}
      {processing && (
        <div className='flex items-center gap-2'>
          <div className='w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse' />
          <span className='text-yellow-300 text-sm font-medium'>
            {currentLang === 'english' ? 'Processing...' : 'Soch raha hoon...'}
          </span>
        </div>
      )}

      {/* ── GIF ── */}
      {!aiText && <img src={userImg} alt='idle' className='w-[150px]' />}
      {aiText  && <img src={aiImg}  alt='speaking' className='w-[150px]' />}

      {/* ── User / AI text ── */}
      <p className='text-white text-[16px] font-semibold text-center px-8 max-w-[600px] leading-relaxed'>
        {userText ? userText : aiText ? aiText : null}
      </p>

      {/* ── Steps Progress ── */}
      {stepsVisible && steps.length > 0 && (
        <div className='flex flex-col gap-[6px] mt-1 px-6 py-4 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm max-w-[420px] w-full'>
          {steps.map((step, i) => (
            <div key={`${step}-${i}`} className={`flex items-center gap-3 transition-all duration-500 ${i < activeStep ? 'opacity-100' : i === activeStep ? 'opacity-100 scale-[1.02]' : 'opacity-30'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-all duration-300
                ${i < activeStep  ? 'bg-green-500 text-white' :
                  i === activeStep ? 'bg-blue-400 text-white animate-pulse' :
                  'bg-white/20 text-white/40'}`}>
                {i < activeStep ? '✓' : i + 1}
              </div>
              <span className={`text-[13px] font-medium transition-colors
                ${i < activeStep  ? 'text-green-300' :
                  i === activeStep ? 'text-blue-300' :
                  'text-white/30'}`}>
                {getStepLabel(step, currentLang)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Suggestion Card ── */}
      {suggestionText && !userText && (
        <div className='mt-1 px-5 py-3 bg-white/10 border border-blue-400/30 rounded-2xl backdrop-blur-sm max-w-[500px] text-center'>
          <p className='text-blue-300 text-[13px] font-medium'>💡 {suggestionText}</p>
        </div>
      )}

    </div>
  )
}

export default Home
