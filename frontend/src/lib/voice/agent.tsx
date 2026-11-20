import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiGet, apiSend, invalidateAll } from '../api'
import { useCopilot, useDay } from '../context'
import { AudioEngine } from './audio'
import { TranscribeStream } from './transcribe'
import { WakeListener, matchWake, stripWake, wakeSupported } from './wake'
import type { Levels, Phase, VoiceAudio, VoiceCard, VoiceSession, VoiceStep, VoiceTurn } from './types'

/**
 * Hey ON:D: one voice session for the whole operator area. It lives above the routes, so a turn that
 * jumps to another screen keeps talking there (the dock shows it).
 *
 *   off ── 마이크 켜기 ──▶ idle ── "헤이 온디" / tap ──▶ listening ──▶ thinking ──▶ speaking ──▶ listening (follow-up) ──▶ idle
 */

interface HistoryMsg {
  role: 'user' | 'assistant'
  content: string
  memo?: string | null
}

interface VoiceCtx {
  phase: Phase
  micOn: boolean
  starting: boolean
  /** "헤이 온디" can be heard (Web Speech API present and allowed); otherwise tap the orb */
  wakeOn: boolean
  error: string | null
  /** what the operator is saying right now */
  transcript: string
  /** the operator's last finished request */
  userText: string
  say: string
  steps: VoiceStep[]
  cards: VoiceCard[]
  session: VoiceSession | null
  /** seconds the last answer took (model + tools + speech synthesis) */
  tookMs: number | null
  usedAi: boolean
  enable: () => Promise<void>
  disable: () => void
  /** start listening without the wake word (tap, Space) */
  wake: () => void
  sendText: (text: string) => void
  stop: () => void
  dismissCard: (id: string) => void
  clear: () => void
  /** say one sentence (job finished, etc.) */
  announce: (text: string) => void
  open: (to: string, date?: string | null) => void
  sample: () => Levels
}

const Ctx = createContext<VoiceCtx | null>(null)
const PREF_KEY = 'ond.voice.mic'
const SILENT: Levels = { level: 0, bands: new Float32Array(16) }
let cardSeq = 0

export function VoiceProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const loc = useLocation()
  const { date, setDate } = useDay()
  const { ask } = useCopilot()

  const [phase, setPhaseState] = useState<Phase>('off')
  const [micOn, setMicOn] = useState(false)
  const [starting, setStarting] = useState(false)
  const [wakeOn, setWakeOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [userText, setUserText] = useState('')
  const [say, setSay] = useState('')
  const [steps, setSteps] = useState<VoiceStep[]>([])
  const [cards, setCards] = useState<VoiceCard[]>([])
  const [session, setSession] = useState<VoiceSession | null>(null)
  const [tookMs, setTookMs] = useState<number | null>(null)
  const [usedAi, setUsedAi] = useState(true)

  const engine = useRef<AudioEngine | null>(null)
  if (!engine.current) engine.current = new AudioEngine()
  const wakeRef = useRef<WakeListener | null>(null)
  const phaseRef = useRef<Phase>('off')
  const micRef = useRef(false)
  const history = useRef<HistoryMsg[]>([])
  const turnId = useRef(0)
  const capId = useRef(0)
  const capCleanup = useRef<(() => void) | null>(null)
  /** Web Speech text routed into the current capture when Amazon Transcribe is not available */
  const fallbackHeard = useRef<((text: string, isFinal: boolean) => void) | null>(null)
  const lastWakeKey = useRef('')
  const ackRef = useRef<VoiceAudio | null>(null)
  const sttUrl = useRef<{ url: string; at: number } | null>(null)
  const sttBroken = useRef(false)
  const pageRef = useRef(loc.pathname + loc.search)
  pageRef.current = loc.pathname + loc.search
  const dateRef = useRef(date)
  dateRef.current = date

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    const e = engine.current!
    e.source = p === 'listening' ? 'mic' : p === 'speaking' ? 'out' : p === 'idle' ? 'mic' : 'none'
    setPhaseState(p)
  }, [])

  const rest = useCallback(() => setPhase(micRef.current ? 'idle' : 'off'), [setPhase])

  // ---------------------------------------------------------------- session (STT URL, "네")

  const loadSession = useCallback(async () => {
    try {
      const s = await apiGet<VoiceSession>('/api/voice/session')
      setSession(s)
      ackRef.current = s.ack.audio
      if (s.stt.url) sttUrl.current = { url: s.stt.url, at: Date.now() }
      return s
    } catch {
      return null
    }
  }, [])

  /** a presigned URL is good for one connection and five minutes: hand one out and fetch the next */
  const takeSttUrl = useCallback((): string | null => {
    if (sttBroken.current) return null
    const cur = sttUrl.current
    sttUrl.current = null
    void loadSession()
    return cur && Date.now() - cur.at < 4 * 60_000 ? cur.url : null
  }, [loadSession])

  useEffect(() => {
    // keep a fresh URL ready while the microphone is on
    if (!micOn) return
    const t = window.setInterval(() => {
      if (phaseRef.current === 'idle' && (!sttUrl.current || Date.now() - sttUrl.current.at > 3 * 60_000)) void loadSession()
    }, 30_000)
    return () => window.clearInterval(t)
  }, [micOn, loadSession])

  // ---------------------------------------------------------------- speaking

  const speak = useCallback(
    async (text: string, audio: VoiceAudio | null) => {
      const e = engine.current!
      setPhase('speaking')
      try {
        if (audio) await e.play(audio.b64)
        else await e.speakFallback(text)
      } catch {
        /* no audio output: the caption still shows the answer */
      }
    },
    [setPhase],
  )

  // ---------------------------------------------------------------- one turn

  const beginCaptureRef = useRef<(o: { preroll: boolean; ack: boolean; followUp?: boolean }) => void>(() => {})

  const runTurn = useCallback(
    async (text: string) => {
      const id = ++turnId.current
      const t0 = performance.now()
      setError(null)
      setUserText(text)
      setTranscript('')
      setSay('')
      setSteps([])
      setPhase('thinking')
      const msgs = [...history.current, { role: 'user' as const, content: text }].slice(-10)
      try {
        const r = await apiSend<VoiceTurn>('POST', '/api/voice/turn', { messages: msgs, page: pageRef.current, date: dateRef.current })
        if (turnId.current !== id) return
        history.current = [...msgs, { role: 'assistant' as const, content: r.say, memo: r.memo }].slice(-10)
        setSay(r.say)
        setSteps(r.steps ?? [])
        setUsedAi(r.ai !== false)
        setTookMs(Math.round(performance.now() - t0))
        if (r.cards?.length) {
          const fresh = r.cards.map((c) => ({ ...c, id: `c${++cardSeq}` }))
          setCards((prev) => [...fresh, ...prev.filter((p) => !fresh.some((f) => f.kind === p.kind && f.title === p.title))].slice(0, 6))
        }
        if (r.copilot) ask(r.copilot)
        if (r.navigate) {
          if (r.navigate.date) setDate(r.navigate.date)
          if (r.steps?.some((s) => s.tool === 'run_optimization')) invalidateAll()
          nav(r.navigate.to)
        }
        await speak(r.say, r.audio)
        if (turnId.current !== id) return
        // stay in the conversation: a follow-up needs no wake word
        if (micRef.current && !r.copilot) beginCaptureRef.current({ preroll: false, ack: false, followUp: true })
        else rest()
      } catch (e) {
        if (turnId.current !== id) return
        setError((e as Error).message)
        rest()
      }
    },
    [ask, nav, rest, setDate, setPhase, speak],
  )

  // ---------------------------------------------------------------- listening (Amazon Transcribe, Web Speech fallback)

  const endCapture = useCallback(() => {
    capId.current++
    capCleanup.current?.()
    capCleanup.current = null
    fallbackHeard.current = null
  }, [])

  const beginCapture = useCallback(
    ({ preroll, ack, followUp }: { preroll: boolean; ack: boolean; followUp?: boolean }) => {
      if (phaseRef.current === 'listening' || phaseRef.current === 'thinking') return
      const e = engine.current!
      turnId.current++ // whatever was being said or fetched is over
      e.stopPlayback()
      endCapture()
      const id = capId.current
      setError(null)
      setTranscript('')
      setPhase('listening')

      let text = ''
      let lastChange = Date.now()
      let gotFinal = false
      const t0 = Date.now()
      let stt: TranscribeStream | null = null

      const update = (raw: string, isFinal: boolean) => {
        if (capId.current !== id) return
        const c = stripWake(raw)
        if (c !== text) {
          text = c
          lastChange = Date.now()
          gotFinal = false
          setTranscript(c)
        }
        if (isFinal && c) gotFinal = true
      }
      const useBrowser = () => {
        stt?.close()
        stt = null
        e.stopCapture()
        fallbackHeard.current = update
      }

      const url = e.micOn ? takeSttUrl() : null
      if (url) {
        stt = new TranscribeStream(url, {
          onText: update,
          onError: () => {
            // permission or network: this session keeps working on the browser recogniser
            sttBroken.current = true
            if (capId.current === id) useBrowser()
          },
        })
        const s = stt
        e.startCapture((pcm) => s.send(pcm), preroll ? 1800 : 0)
      } else {
        useBrowser()
      }
      if (ack && ackRef.current) void e.play(ackRef.current.b64).catch(() => {})

      const timer = window.setInterval(() => {
        if (capId.current !== id) return
        const now = Date.now()
        const quiet = now - lastChange
        const noSpeechLimit = followUp ? 5500 : 8000
        if (text ? (gotFinal && quiet > 700) || quiet > 1800 || now - t0 > 25_000 : now - t0 > noSpeechLimit) {
          const cmd = text.replace(/[\s.,!?]+$/, '')
          endCapture()
          if (cmd.length >= 2) void runTurn(cmd)
          else rest()
        }
      }, 120)
      capCleanup.current = () => {
        window.clearInterval(timer)
        e.stopCapture()
        stt?.close()
      }
    },
    [endCapture, rest, runTurn, setPhase, takeSttUrl],
  )
  beginCaptureRef.current = beginCapture

  // ---------------------------------------------------------------- wake word

  const startWake = useCallback(() => {
    if (!wakeSupported() || wakeRef.current) return
    const w = new WakeListener()
    w.onHeard = (text, isFinal, key) => {
      if (phaseRef.current === 'listening') {
        fallbackHeard.current?.(text, isFinal)
        return
      }
      if (phaseRef.current === 'thinking' || key === lastWakeKey.current) return
      if (matchWake(text).hit) {
        lastWakeKey.current = key
        beginCaptureRef.current({ preroll: true, ack: true })
        // the same utterance may already carry the request ("헤이 온디, 절감 효과 알려줘")
        fallbackHeard.current?.(text, isFinal)
      }
    }
    w.onBlocked = () => setWakeOn(false)
    w.start()
    wakeRef.current = w
    setWakeOn(true)
  }, [])

  // ---------------------------------------------------------------- controls

  const enable = useCallback(async () => {
    if (micRef.current || starting) return
    setStarting(true)
    setError(null)
    try {
      await engine.current!.startMic()
      micRef.current = true
      setMicOn(true)
      setPhase('idle')
      try {
        localStorage.setItem(PREF_KEY, '1')
      } catch {
        /* private mode */
      }
      startWake()
      void loadSession()
    } catch (e) {
      const name = (e as Error).name
      setError(
        name === 'NotAllowedError'
          ? '마이크 권한이 꺼져 있습니다. 주소창의 자물쇠에서 마이크를 허용한 뒤 다시 눌러 주세요.'
          : name === 'NotFoundError'
            ? '연결된 마이크를 찾지 못했습니다.'
            : (e as Error).message,
      )
    } finally {
      setStarting(false)
    }
  }, [loadSession, setPhase, startWake, starting])

  const disable = useCallback(() => {
    turnId.current++
    endCapture()
    wakeRef.current?.stop()
    wakeRef.current = null
    setWakeOn(false)
    engine.current!.stopPlayback()
    engine.current!.stopMic()
    micRef.current = false
    setMicOn(false)
    setPhase('off')
    try {
      localStorage.removeItem(PREF_KEY)
    } catch {
      /* private mode */
    }
  }, [endCapture, setPhase])

  const wake = useCallback(() => {
    void engine.current!.resume()
    if (!micRef.current) {
      void enable().then(() => {
        if (micRef.current) beginCaptureRef.current({ preroll: false, ack: true })
      })
      return
    }
    if (phaseRef.current === 'listening') {
      endCapture()
      rest()
      return
    }
    beginCaptureRef.current({ preroll: false, ack: true })
  }, [enable, endCapture, rest])

  const sendText = useCallback(
    (text: string) => {
      const q = text.trim()
      if (!q) return
      void engine.current!.resume()
      endCapture()
      engine.current!.stopPlayback()
      void runTurn(q)
    },
    [endCapture, runTurn],
  )

  const stop = useCallback(() => {
    turnId.current++
    endCapture()
    engine.current!.stopPlayback()
    rest()
  }, [endCapture, rest])

  const announce = useCallback(
    async (text: string) => {
      if (phaseRef.current === 'listening' || phaseRef.current === 'thinking' || phaseRef.current === 'speaking') return
      const id = ++turnId.current
      setSay(text)
      setUserText('')
      setSteps([])
      let audio: VoiceAudio | null = null
      try {
        audio = (await apiSend<{ audio: VoiceAudio | null }>('POST', '/api/voice/tts', { text })).audio
      } catch {
        /* browser voice instead */
      }
      if (turnId.current !== id) return
      history.current = [...history.current, { role: 'assistant' as const, content: text }].slice(-10)
      await speak(text, audio)
      if (turnId.current === id) rest()
    },
    [rest, speak],
  )

  const open = useCallback(
    (to: string, d?: string | null) => {
      if (d) setDate(d)
      nav(to)
    },
    [nav, setDate],
  )

  const dismissCard = useCallback((id: string) => setCards((c) => c.filter((x) => x.id !== id)), [])
  const clear = useCallback(() => {
    history.current = []
    setCards([])
    setSay('')
    setUserText('')
    setSteps([])
    setError(null)
  }, [])

  const sample = useCallback(() => engine.current?.sample() ?? SILENT, [])

  // the service names shown on the stage, and the "네" clip, are worth having before the first click
  useEffect(() => {
    void loadSession()
  }, [loadSession])

  // an operator who turned the microphone on keeps it on the next visit (the browser already holds the permission)
  useEffect(() => {
    let wanted = false
    try {
      wanted = localStorage.getItem(PREF_KEY) === '1'
    } catch {
      /* private mode */
    }
    if (!wanted || !navigator.permissions?.query) return
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        if (p.state === 'granted') void enable()
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const resume = () => void engine.current?.resume()
    window.addEventListener('pointerdown', resume)
    return () => {
      window.removeEventListener('pointerdown', resume)
      wakeRef.current?.stop()
      wakeRef.current = null
      capCleanup.current?.()
      engine.current?.stopPlayback()
      engine.current?.stopMic()
    }
  }, [])

  const v = useMemo<VoiceCtx>(
    () => ({
      phase, micOn, starting, wakeOn, error, transcript, userText, say, steps, cards, session, tookMs, usedAi,
      enable, disable, wake, sendText, stop, dismissCard, clear, announce: (t: string) => void announce(t), open, sample,
    }),
    [phase, micOn, starting, wakeOn, error, transcript, userText, say, steps, cards, session, tookMs, usedAi,
      enable, disable, wake, sendText, stop, dismissCard, clear, announce, open, sample],
  )
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function useVoice(): VoiceCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useVoice outside VoiceProvider')
  return c
}
