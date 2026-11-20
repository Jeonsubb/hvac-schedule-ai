import type { Day, Interval, Meta, NegCompare, PlanView, Session, StrategyDay } from './types'
import { hm } from './format'

/**
 * One operating plan of one day in the shape the dashboard draws: ON/OFF intervals, predicted indoor
 * temperature and totals. Every number is a simulation result of the same engine; nothing is measured.
 */
export type PlanKey = 'fixed' | 'base' | 'nego'

export interface PlanRoom {
  plan: Interval[]
  /** predicted indoor temperature, 5-minute steps */
  ta: number[] | null
  /** policy setpoint of the season */
  sp: number | null
  kwh: number | null
  /** mean PMV while a class is in the room */
  pmv: number | null
}

export interface PlanModel {
  key: PlanKey
  label: string
  /** 'applied' | 'recommended' … shown next to the label */
  badge?: string
  kwh: number
  comfortPct: number | null
  /** minutes of class outside the comfort band / minutes of class */
  outBandMin: number | null
  classMin: number | null
  pmvMean: number | null
  rooms: Record<string, PlanRoom>
}

export type SpKey = 'sp_heat' | 'sp_cool'

/** Heating months use the heating setpoint; the same month rule the backend uses. */
export function seasonKey(date: string, cmp?: NegCompare): SpKey {
  if (cmp?.key) return cmp.key
  const m = Number(date.slice(5, 7))
  return m >= 6 && m <= 9 ? 'sp_cool' : 'sp_heat'
}

function mean(v: number[]): number | null {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

export function fromStrategy(key: PlanKey, label: string, sd: StrategyDay, day: Day, meta: Meta, spKey: SpKey, badge?: string): PlanModel {
  const rooms: Record<string, PlanRoom> = {}
  let out = 0
  let cls = 0
  const pmvs: number[] = []
  for (const r of Object.keys(meta.rooms)) {
    const rd = sd.rooms[r]
    const occ = (rd?.sessions ?? []).filter((c) => c.minutes > 0)
    const pm = occ.map((c) => c.pmv).filter((x): x is number => x != null)
    pmvs.push(...pm)
    for (const c of occ) {
      cls += c.minutes
      out += c.minutes - c.in_band_minutes
    }
    const applied = key === 'fixed' ? undefined : day.room_sp?.[r]?.[spKey]
    rooms[r] = { plan: sd.plan[r] ?? [], ta: rd?.ta ?? null, sp: applied ?? Number(meta.settings[spKey]), kwh: rd?.kwh ?? null, pmv: mean(pm) }
  }
  return { key, label, badge, kwh: sd.kwh, comfortPct: sd.comfort_pct, outBandMin: out, classMin: cls, pmvMean: mean(pmvs), rooms }
}

export function fromView(key: PlanKey, label: string, v: PlanView, meta: Meta, spKey: SpKey, badge?: string): PlanModel {
  const rooms: Record<string, PlanRoom> = {}
  for (const r of Object.keys(meta.rooms)) {
    const x = v.rooms[r]
    rooms[r] = { plan: x?.plan ?? [], ta: x?.ta ?? null, sp: x ? x[spKey] : null, kwh: x?.kwh ?? null, pmv: x?.pmv ?? null }
  }
  return { key, label, badge, kwh: v.kwh, comfortPct: v.comfort_pct, outBandMin: v.out_band_min, classMin: v.class_min, pmvMean: v.pmv_mean, rooms }
}

/** Join intervals that touch (the engine splits pre-heating and class time) so one run is one bar. */
export function mergeIntervals(ivs: Interval[] | undefined): Interval[] {
  const out: Interval[] = []
  for (const iv of [...(ivs ?? [])].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1]
    if (last && iv.s <= last.e && (last.kind ?? 'cond') === (iv.kind ?? 'cond')) last.e = Math.max(last.e, iv.e)
    else out.push({ s: iv.s, e: iv.e, kind: iv.kind ?? 'cond' })
  }
  return out
}

export function intervalAt(ivs: Interval[] | undefined, m: number): Interval | undefined {
  return ivs?.find((iv) => m >= iv.s && m < iv.e)
}

export function samePlan(a: Interval[] | undefined, b: Interval[] | undefined): boolean {
  const x = mergeIntervals(a)
  const y = mergeIntervals(b)
  return x.length === y.length && x.every((iv, i) => iv.s === y[i].s && iv.e === y[i].e && iv.kind === y[i].kind)
}

export function planMinutes(ivs: Interval[] | undefined): number {
  return mergeIntervals(ivs).reduce((a, iv) => a + (iv.e - iv.s), 0)
}

export function sessionsOf(sessions: Session[], room: string): Session[] {
  return sessions.filter((s) => s.room === room).sort((a, b) => hm(a.start) - hm(b.start))
}

/** Is the negotiation usable as a plan of this day? Otherwise the reason to show instead. */
export function negoBlock(cmp: NegCompare | undefined): string | null {
  if (!cmp) return '협의 기록을 확인하는 중입니다.'
  if (cmp.state === 'none') return '이 날짜에는 아직 AI 협의 기록이 없습니다.'
  if (cmp.same_conditions === false) return `협의 이후 ${changedLabel(cmp)}이(가) 바뀌어 같은 조건으로 비교할 수 없습니다. 다시 협의해야 합니다.`
  if (!cmp.before || !cmp.after || cmp.same_conditions == null) return '이전 버전에서 실행한 협의라 운전계획 비교 자료가 없습니다. 다시 협의해야 합니다.'
  if (cmp.state === 'no_change') return 'AI 협의 결과 설정온도 변경이 없습니다.'
  return null
}

const CHANGED: Record<string, string> = { schedule: '시간표', weather: '기상예보', settings: '운영 규칙' }

export function changedLabel(cmp: NegCompare): string {
  const c = (cmp.changed ?? []).map((k) => CHANGED[k] ?? k)
  return c.length ? c.join('·') : '입력 조건'
}

export const NEG_STATE: Record<string, { label: string; tone: 'warn' | 'good' | 'neutral' }> = {
  pending: { label: '승인 대기 · 미적용 추천안', tone: 'warn' },
  applied: { label: '적용됨', tone: 'good' },
  partial: { label: '일부만 적용됨', tone: 'warn' },
  rejected: { label: '거절됨 · 미적용', tone: 'neutral' },
  no_change: { label: '변경 없음', tone: 'neutral' },
}

/** Signed number with a real minus sign; ±0 when it rounds to zero. */
export function signed(v: number, digits = 1): string {
  if (Math.abs(v) < 10 ** -digits / 2) return `±${(0).toFixed(digits)}`
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`
}
