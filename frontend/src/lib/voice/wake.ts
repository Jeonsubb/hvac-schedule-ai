/**
 * Wake word ("온디", also "헤이 온디") with the browser's built-in speech recognition. It only decides when to
 * start a turn; the turn's own audio goes to Amazon Transcribe. Browsers without the Web Speech API
 * (or without the permission) fall back to tapping the orb.
 */

// what Korean recognisers actually write for "헤이 온디"
const WAKE = /(헤이|해이|헤에이|헤|hey|에이)[\s,]*(온\s*디|언\s*디|온\s*띠|온\s*티|온\s*니|온\s*지|온\s*리|원\s*디|안\s*디|on\s*-?\s*d(?:i|ee|y)?)(야|아)?[\s,.!?~]*/i
// a looser shape for cutting the call off the front of an Amazon Transcribe result
const LEAD = /^\s*(헤이|해이|헤에이|hey|에이)[\s,]+\S{1,4}[\s,.!?~]+/i

// the name alone ("온디", "온디야") at the start of what was said; stricter spellings than with "헤이"
const BARE = /^\s*(온\s*디|온\s*띠|온\s*티)(야|아)?(?=[\s,.!?~]|$)[\s,.!?~]*/i

export function matchWake(text: string): { hit: boolean; rest: string } {
  const m = WAKE.exec(text) ?? BARE.exec(text)
  if (!m) return { hit: false, rest: text }
  return { hit: true, rest: text.slice(m.index + m[0].length).trim() }
}

/** the command without the call ("헤이 온디, …") and without the echo of our own "네" */
export function stripWake(text: string): string {
  let t = text.trim()
  const m = matchWake(t)
  if (m.hit) t = m.rest
  else t = t.replace(LEAD, '')
  t = t.replace(/^(네|예|넵)[\s,.!?]+/, '')
  return t.trim()
}

interface RecResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecEvent {
  resultIndex: number
  results: ArrayLike<RecResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function ctor(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const wakeSupported = () => typeof window !== 'undefined' && !!ctor()

export class WakeListener {
  private rec: Recognition | null = null
  private active = false
  private session = 0
  private restart = 0
  /** every utterance the browser hears: key identifies the utterance (stable while it grows) */
  onHeard: (text: string, isFinal: boolean, key: string) => void = () => {}
  onBlocked: (reason: string) => void = () => {}

  start() {
    const C = ctor()
    if (!C || this.active) return
    this.active = true
    this.spawn(C)
  }

  private spawn(C: new () => Recognition) {
    if (!this.active) return
    const rec = new C()
    const sid = ++this.session
    rec.lang = 'ko-KR'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        this.onHeard(r[0].transcript, r.isFinal, `${sid}:${i}`)
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false
        this.onBlocked(e.error)
      }
    }
    // the browser ends a session after a stretch of silence: keep listening
    rec.onend = () => {
      if (!this.active) return
      window.clearTimeout(this.restart)
      this.restart = window.setTimeout(() => this.spawn(C), 250)
    }
    this.rec = rec
    try {
      rec.start()
    } catch {
      /* already started */
    }
  }

  stop() {
    this.active = false
    window.clearTimeout(this.restart)
    try {
      this.rec?.abort()
    } catch {
      /* not running */
    }
    this.rec = null
  }
}
