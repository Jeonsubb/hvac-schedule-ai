import { useEffect, useMemo, useRef, useState } from 'react'
import { invalidate, useApi } from '../lib/api'
import { useDay, useMeta } from '../lib/context'
import { useAuth } from '../lib/auth'
import type { Day, Iaq, Interval, NegCompare, OpMode } from '../lib/types'
import { fromStrategy, fromView, negoBlock, seasonKey, type PlanKey, type PlanModel } from '../lib/plans'
import { ROOM_ORDER } from '../lib/constants'
import { hm } from '../lib/format'

/** Presentation state only. All physical calculations stay in the existing engine/plan adapters. */
export function useOperations() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const { date, defaultDate, setDate } = useDay()
  const { user } = useAuth()
  const dayQ = useApi<Day>(date ? `/api/day/${date}` : null, { maxAgeMs: 0 })
  const compareQ = useApi<NegCompare>(date ? `/api/negotiate/compare?date=${date}` : null, { maxAgeMs: 0 })
  const iaqQ = useApi<Iaq>(date ? `/api/iaq/${date}` : null, { maxAgeMs: 0 })
  const modeQ = useApi<OpMode>('/api/mode', { maxAgeMs: 20_000 })
  const day = dayQ.data?.date === date ? dayQ.data : undefined
  const compare = compareQ.data?.date === date ? compareQ.data : undefined
  const iaq = iaqQ.data?.date === date ? iaqQ.data : undefined
  const [picked, setPicked] = useState<PlanKey | null>(null)
  const [minute, setMinute] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const spKey = seasonKey(date ?? '', compare)
  const block = negoBlock(compare)
  const plans = useMemo(() => {
    const out: Partial<Record<PlanKey, PlanModel>> = {}
    if (!day || !meta) return out
    if (day.strategies.fixed) out.fixed = fromStrategy('fixed', '고정 운전', day.strategies.fixed, day, meta, spKey)
    if (!block && compare?.before && compare.after && compare.state === 'applied') {
      out.base = fromView('base', '기본 예측', compare.before, meta, spKey, '협의 전')
      out.nego = fromView('nego', '협의 반영', compare.after, meta, spKey, '적용됨')
    } else {
      if (day.strategies.ai) out.base = fromStrategy('base', compare ? '기본 예측' : '현재 예측', day.strategies.ai, day, meta, spKey, compare?.state === 'partial' ? '일부 적용' : !compare ? compareQ.error ? '협의 상태 조회 실패' : '협의 상태 확인 중' : undefined)
      if (!block && compare?.after) out.nego = fromView('nego', '협의 추천안', compare.after, meta, spKey, compare.state === 'pending' ? '승인 대기 · 예상' : compare.state === 'rejected' ? '거절됨 · 예상' : '전체 추천안 · 예상')
    }
    return out
  }, [day, meta, compare, spKey, block, compareQ.error])
  const operating: PlanKey = user?.applied === false ? 'fixed' : compare?.state === 'applied' && plans.nego ? 'nego' : 'base'
  const key = picked && plans[picked] ? picked : plans[operating] ? operating : plans.base ? 'base' : 'fixed'
  const plan = plans[key]
  const partner = key === 'nego' ? plans.base : key === 'fixed' ? plans.base : plans.fixed
  const rooms = useMemo(() => Object.keys(meta?.rooms ?? {}).sort((a, b) => {
    const rank = (r: string) => ROOM_ORDER.includes(r) ? ROOM_ORDER.indexOf(r) : 99
    return rank(a) - rank(b) || a.localeCompare(b)
  }), [meta])
  const range = useMemo<[number, number]>(() => {
    const all: Interval[] = Object.values(plans).flatMap((p) => Object.values(p!.rooms).flatMap((r) => r.plan))
    const starts = day?.sessions.map((s) => hm(s.start)) ?? []
    const ends = day?.sessions.map((s) => hm(s.end)) ?? []
    return [Math.max(0, Math.floor(Math.min(360, ...all.map((iv) => iv.s), ...starts) / 60) * 60), Math.min(1440, Math.ceil(Math.max(1320, ...all.map((iv) => iv.e), ...ends) / 60) * 60)]
  }, [plans, day])
  const firstClass = day?.sessions.length ? Math.min(...day.sessions.map((s) => hm(s.start))) : 600
  const time = Math.max(range[0], Math.min(range[1], minute ?? Math.round((firstClass + 30) / 5) * 5))
  const timeRef = useRef(time)
  timeRef.current = time
  useEffect(() => { setPicked(null); setMinute(null); setPlaying(false); setShowCompare(false) }, [date])
  useEffect(() => {
    if (!playing) return
    const tick = window.setInterval(() => {
      if (timeRef.current >= range[1]) { setPlaying(false); return }
      setMinute(Math.min(range[1], timeRef.current + 5))
    }, 140)
    return () => window.clearInterval(tick)
  }, [playing, range])
  const loading = useRef(false)
  loading.current = dayQ.loading || compareQ.loading || iaqQ.loading
  useEffect(() => {
    const refresh = () => {
      if (!date || loading.current) return
      invalidate(`/api/day/${date}`); invalidate(`/api/negotiate/compare?date=${date}`); invalidate(`/api/iaq/${date}`)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [date])
  return { meta, metaError, reloadMeta, date, defaultDate, setDate, dayQ, compareQ, iaqQ, modeQ, day, compare, iaq, rooms, plan, plans, key, setPicked, partner, range, time, setMinute, playing, setPlaying, showCompare, setShowCompare, block, spKey, applied: user?.applied !== false }
}
