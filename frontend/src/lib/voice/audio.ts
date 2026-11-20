import type { Levels } from './types'

/**
 * Microphone capture and speech playback on one AudioContext.
 * - the microphone feeds an analyser (the orb reacts to the operator's voice) and a worklet that
 *   resamples to 16 kHz 16-bit PCM in 100 ms chunks (what Amazon Transcribe streaming expects)
 * - the last two seconds of PCM are kept, so a stream opened at the wake word still contains the
 *   words spoken right after it
 * - Amazon Polly audio plays through a second analyser (the orb reacts to ON:D's voice)
 */

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / 16000
    this.acc = 0; this.sum = 0; this.cnt = 0
    this.buf = new Int16Array(1600); this.n = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.cnt++; this.acc += 1
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio
        let v = this.sum / this.cnt
        this.sum = 0; this.cnt = 0
        v = Math.max(-1, Math.min(1, v))
        this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.buffer.slice(0)); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

const BANDS = 16
const PREROLL_CHUNKS = 20 // 2 s

export class AudioEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private micAnalyser: AnalyserNode | null = null
  private outAnalyser: AnalyserNode | null = null
  private ring: Uint8Array[] = []
  private onPcm: ((pcm: Uint8Array) => void) | null = null
  private playing: AudioBufferSourceNode | null = null
  private endPlay: (() => void) | null = null
  private freq = new Uint8Array(128)
  private bands = new Float32Array(BANDS)
  private level = 0
  private synth = false
  /** which analyser the orb follows */
  source: 'mic' | 'out' | 'none' = 'none'

  get micOn() {
    return !!this.stream
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctor()
      this.outAnalyser = this.ctx.createAnalyser()
      this.outAnalyser.fftSize = 256
      this.outAnalyser.smoothingTimeConstant = 0.7
      this.outAnalyser.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** browsers keep a context suspended until a user gesture */
  async resume() {
    try {
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
    } catch {
      /* stays suspended until the next gesture */
    }
  }

  private pending: Promise<void> | null = null

  startMic(): Promise<void> {
    if (this.stream) return Promise.resolve()
    if (!this.pending) this.pending = this.openMic().finally(() => (this.pending = null))
    return this.pending
  }

  private async openMic() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 마이크 입력을 지원하지 않습니다.')
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    const ctx = this.context()
    await this.resume()
    const src = ctx.createMediaStreamSource(stream)
    this.micAnalyser = ctx.createAnalyser()
    this.micAnalyser.fftSize = 256
    this.micAnalyser.smoothingTimeConstant = 0.6
    src.connect(this.micAnalyser)
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const node = new AudioWorkletNode(ctx, 'pcm-capture')
    node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      const pcm = new Uint8Array(ev.data)
      this.ring.push(pcm)
      if (this.ring.length > PREROLL_CHUNKS) this.ring.shift()
      this.onPcm?.(pcm)
    }
    src.connect(node)
    // a muted path to the output keeps the worklet pulled by the audio graph
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    this.stream = stream
  }

  stopMic() {
    this.onPcm = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.micAnalyser = null
    this.ring = []
  }

  /** start forwarding PCM; prerollMs of already-heard audio is delivered first */
  startCapture(onPcm: (pcm: Uint8Array) => void, prerollMs = 0) {
    const n = Math.min(this.ring.length, Math.round(prerollMs / 100))
    for (const c of this.ring.slice(this.ring.length - n)) onPcm(c)
    this.onPcm = onPcm
  }

  stopCapture() {
    this.onPcm = null
  }

  /** play base64 audio (Polly mp3); resolves when it ends or is stopped */
  async play(b64: string): Promise<void> {
    const ctx = this.context()
    await this.resume()
    this.stopPlayback()
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const buf = await ctx.decodeAudioData(bytes.buffer)
    return new Promise((resolve) => {
      const node = ctx.createBufferSource()
      node.buffer = buf
      node.connect(this.outAnalyser!)
      const done = () => {
        if (this.playing === node) {
          this.playing = null
          this.endPlay = null
        }
        resolve()
      }
      node.onended = done
      this.playing = node
      this.endPlay = done
      node.start()
    })
  }

  /** browser voice when Polly is unavailable; the orb gets a synthetic rhythm */
  speakFallback(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'ko-KR'
      u.rate = 1.05
      const done = () => {
        this.synth = false
        this.endPlay = null
        resolve()
      }
      u.onend = done
      u.onerror = done
      this.synth = true
      this.endPlay = () => {
        window.speechSynthesis.cancel()
        done()
      }
      window.speechSynthesis.speak(u)
    })
  }

  stopPlayback() {
    const node = this.playing
    const end = this.endPlay
    this.playing = null
    this.endPlay = null
    try {
      node?.stop()
    } catch {
      /* not started */
    }
    end?.()
  }

  get speaking() {
    return !!this.playing || this.synth
  }

  /** called once per animation frame by the orb */
  sample(): Levels {
    const an = this.source === 'mic' ? this.micAnalyser : this.source === 'out' ? this.outAnalyser : null
    let target = 0
    if (this.source === 'out' && this.synth) {
      const t = performance.now() / 1000
      target = 0.3 + 0.25 * Math.abs(Math.sin(t * 9) * Math.sin(t * 2.3))
      for (let b = 0; b < BANDS; b++) this.bands[b] = 0.3 + 0.3 * Math.abs(Math.sin(t * (5 + b) + b))
    } else if (an) {
      an.getByteFrequencyData(this.freq)
      // 16 bands over the first 64 bins (about 0 to 6 kHz: where speech lives)
      let sum = 0
      for (let b = 0; b < BANDS; b++) {
        let s = 0
        for (let i = 0; i < 4; i++) s += this.freq[b * 4 + i]
        const v = s / 4 / 255
        this.bands[b] += (v - this.bands[b]) * 0.5
        sum += v
      }
      target = Math.min(1, (sum / BANDS) * 2.2)
    } else {
      for (let b = 0; b < BANDS; b++) this.bands[b] *= 0.9
    }
    this.level += (target - this.level) * (target > this.level ? 0.45 : 0.12)
    return { level: this.level, bands: this.bands }
  }
}
