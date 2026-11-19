import type { Day, Interval, Live, LiveRoom, Meta, Session, StrategyKey } from './types'
import { hm } from './format'

// ---------------------------------------------------------------- thermal ramp (diverging, comfort band = neutral)

const NEUTRAL = '#eef1f4'
const COLD: [number, string][] = [
  [0, NEUTRAL],
  [2, '#d4e3f7'],
  [5, '#a9c6ee'],
  [8, '#7ea7e0'],
]
const WARM: [number, string][] = [
  [0, NEUTRAL],
  [2, '#fbe0cf'],
  [4, '#f5bb97'],
  [6, '#ec915f'],
]

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
function lerpHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t))
}
function ramp(stops: [number, string][], d: number): string {
  if (d <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const [d0, c0] = stops[i - 1]
      const [d1, c1] = stops[i]
      return lerpHex(c0, c1, (d - d0) / (d1 - d0))
    }
  }
  return stops[stops.length - 1][1]
}

/** Fill for an indoor temperature: neutral inside the comfort band, blue below, orange above. */
export function thermalFill(t: number, lo: number, hi: number): string {
  if (t < lo) return ramp(COLD, lo - t)
  if (t > hi) return ramp(WARM, t - hi)
  return NEUTRAL
}

/** Darken (amt>0) or lighten (amt<0) a hex color. */
export function shade(hex: string, amt: number): string {
  const c = hexToRgb(hex)
  return rgbToHex(amt >= 0 ? c.map((v) => v * (1 - amt)) : c.map((v) => v + (255 - v) * -amt))
}

/** CSS gradient of the thermal ramp across [t0, t1] °C. */
export function thermalGradient(t0: number, t1: number, lo: number, hi: number, steps = 24): string {
  const parts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps
    parts.push(`${thermalFill(t, lo, hi)} ${((i / steps) * 100).toFixed(1)}%`)
  }
  return `linear-gradient(to right, ${parts.join(', ')})`
}

// ---------------------------------------------------------------- HVAC modes

export type Mode = 'heat' | 'cool' | 'air' | 'off'

export const MODE: Record<Mode, { label: string; color: string; deep: string; tint: string }> = {
  heat: { label: '난방', color: '#dc5a2a', deep: '#b4441c', tint: '#fdeee6' },
  cool: { label: '냉방', color: '#3f7fe0', deep: '#2563c9', tint: '#e8f0fc' },
  air: { label: '송풍', color: '#21a0a0', deep: '#127474', tint: '#e3f4f4' },
  off: { label: '정지', color: '#97a1ae', deep: '#667183', tint: '#f3f5f8' },
}

export interface RoomState {
  room: string
  state: LiveRoom['state']
  mode: Mode
  ta: number
  power_w: number
  session: Session | null
  next: Session | null
}

export interface BuildingState {
  minute: number
  rooms: RoomState[]
  odus: Record<string, { on: boolean; power_w: number; mode: Mode }>
}

function covers(ivs: Interval[] | undefined, m: number) {
  return ivs?.find((iv) => m >= iv.s && m < iv.e)
}

/** Heating or cooling for a running room: from the day's thermal energy split, else from setpoints. */
export function condMode(day: Day | undefined, room: string, ta: number, meta: Meta, k: StrategyKey = 'ai'): 'heat' | 'cool' {
  const rd = day?.strategies[k]?.rooms[room]
  if (rd && (rd.heat_kwh_th ?? 0) + (rd.cool_kwh_th ?? 0) > 0) return (rd.heat_kwh_th ?? 0) >= (rd.cool_kwh_th ?? 0) ? 'heat' : 'cool'
  return ta < (meta.settings.sp_heat + meta.settings.sp_cool) / 2 ? 'heat' : 'cool'
}

function sessionsAt(day: Day, room: string, m: number) {
  const list = day.sessions.filter((s) => s.room === room).sort((a, b) => hm(a.start) - hm(b.start))
  return {
    session: list.find((s) => hm(s.start) <= m && m < hm(s.end)) ?? null,
    next: list.find((s) => hm(s.start) > m) ?? null,
  }
}

/** Reconstruct the building at any minute of a simulated day (same numbers /api/live returns). */
export function buildingAt(day: Day, meta: Meta, minute: number, k: StrategyKey = 'ai'): BuildingState {
  const sd = day.strategies[k]
  const idx = Math.max(0, Math.min(287, Math.floor(minute / 5)))
  const rooms: RoomState[] = Object.keys(meta.rooms).map((room) => {
    const rd = sd?.rooms[room]
    const iv = covers(rd?.actual, minute)
    const state: LiveRoom['state'] = iv ? (iv.kind === 'fan' ? 'FAN' : 'ON') : 'OFF'
    const ta = rd?.ta[idx] ?? NaN
    const mode: Mode = state === 'OFF' ? 'off' : state === 'FAN' ? 'air' : condMode(day, room, ta, meta, k)
    return { room, state, mode, ta, power_w: rd?.p[idx] ?? 0, ...sessionsAt(day, room, minute) }
  })
  const odus: BuildingState['odus'] = {}
  for (const o of Object.values(meta.odus)) {
    const od = sd?.odus[o.id]
    const on = !!covers(od?.actual, minute)
    const served = rooms.filter((r) => meta.rooms[r.room]?.odu === o.id && r.mode !== 'off')
    odus[o.id] = { on, power_w: od?.p[idx] ?? 0, mode: on ? (served.find((r) => r.mode === 'heat' || r.mode === 'cool')?.mode ?? 'air') : 'off' }
  }
  return { minute, rooms, odus }
}

/** The live snapshot in the same shape (mode taken from the day when it is loaded). */
export function buildingFromLive(live: Live, meta: Meta, day: Day | undefined): BuildingState {
  const rooms: RoomState[] = live.rooms.map((r) => ({
    room: r.room,
    state: r.state,
    mode: r.state === 'OFF' ? 'off' : r.state === 'FAN' ? 'air' : condMode(day, r.room, r.ta, meta),
    ta: r.ta,
    power_w: r.power_w,
    session: r.session,
    next: r.next,
  }))
  const odus: BuildingState['odus'] = {}
  for (const [id, o] of Object.entries(live.odus)) {
    const served = rooms.filter((r) => meta.rooms[r.room]?.odu === id && r.mode !== 'off')
    odus[id] = { on: o.on, power_w: o.power_w, mode: o.on ? (served.find((r) => r.mode === 'heat' || r.mode === 'cool')?.mode ?? 'air') : 'off' }
  }
  return { minute: live.now.minute, rooms, odus }
}
