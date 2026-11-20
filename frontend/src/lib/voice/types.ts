export type Phase = 'off' | 'idle' | 'listening' | 'thinking' | 'speaking'

export interface VoiceStat {
  label: string
  value: string
  unit?: string | null
  delta?: string | null
  tone?: 'good' | 'warn' | null
}

export interface VoiceRow {
  label: string
  value: string
  sub?: string | null
  /** 0..1 */
  bar?: number | null
  tag?: string | null
  tone?: 'on' | 'fan' | 'off' | 'warn' | null
}

export interface VoiceCard {
  /** client-side id */
  id?: string
  kind: string
  title: string
  subtitle?: string | null
  to?: string | null
  to_label?: string | null
  date?: string | null
  stats?: VoiceStat[]
  rows?: VoiceRow[]
  note?: string | null
  job?: { id: string; kind: 'negotiate' | 'tier_run' }
}

export interface VoiceAudio {
  b64: string
  mime: string
  voice: string
}

export interface VoiceStep {
  tool: string
  label: string
  ok?: boolean
}

export interface VoiceTurn {
  say: string
  audio: VoiceAudio | null
  cards: VoiceCard[]
  steps: VoiceStep[]
  navigate: { to: string; label: string; date?: string } | null
  copilot: string | null
  memo: string | null
  ai: boolean
}

export interface VoiceSession {
  wake: string
  region: string
  ack: { text: string; audio: VoiceAudio | null }
  stt: { engine: string; url: string | null; sample_rate: number; language: string; error?: string }
  llm: { engine: string; model: string }
  tts: { engine: string; voice: string | null; error?: string }
}

export interface Levels {
  /** overall loudness 0..1 of whoever is talking (operator while listening, ON:D while speaking) */
  level: number
  /** 16 spectrum bands 0..1, low to high */
  bands: Float32Array
}
