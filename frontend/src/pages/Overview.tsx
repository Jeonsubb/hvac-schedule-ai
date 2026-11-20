import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, Download, FileUp, Sparkles, X } from 'lucide-react'
import { useApi } from '../lib/api'
import { useDay, useMeta } from '../lib/context'
import { useAuth } from '../lib/auth'
import type { Day, Iaq, Interval, Meta, NegCompare } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, hm } from '../lib/format'
import { MODE, condMode, type BuildingState, type Mode, type RoomState } from '../lib/thermal'
import {
  NEG_STATE,
  changedLabel,
  fromStrategy,
  fromView,
  intervalAt,
  mergeIntervals,
  negoBlock,
  planMinutes,
  samePlan,
  seasonKey,
  sessionsOf,
  signed,
  type PlanKey,
  type PlanModel,
  type SpKey,
} from '../lib/plans'
import BuildingView, { MapLegend } from '../components/BuildingView'
import DayTimeline from '../components/DayTimeline'
import TimetableApply from '../components/TimetableApply'
import { SectionTabs } from '../components/Layout'
import { Badge, Button, ErrorBox, PageSkeleton, Segmented, Skeleton, btnCls } from '../components/ui'

/**
 * 운영 현황: the whole day's operating plan first. Three numbers, the ten-room ON/OFF timeline, one
 * selected room in detail, and the latest agent negotiation in one line. The floor map is a second view.
 * Indoor temperature, CO2, PMV and energy are simulated or estimated; nothing here is a sensor reading.
 */
export default function Overview() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const { date, setDate, defaultDate } = useDay()
  const [params, setParams] = useSearchParams()
  const day = useApi<Day>(date ? `/api/day/${date}` : null)
  const cmpQ = useApi<NegCompare>(date ? `/api/negotiate/compare?date=${date}` : null, { maxAgeMs: 15_000 })
  const iaqQ = useApi<Iaq>(date ? `/api/iaq/${date}` : null)
  const { user } = useAuth()
  const applied = user?.applied !== false
  const [ttOpen, setTtOpen] = useState(false)

  const D = day.data?.date === date ? day.data : undefined
  const cmp = cmpQ.data?.date === date ? cmpQ.data : undefined
  const iaq = iaqQ.data?.date === date ? iaqQ.data : undefined

  const spKey: SpKey = seasonKey(date ?? '2026-01-01', cmp)
  const block = negoBlock(cmp)

  // the plans this day really has: fixed schedule, predictive control, and (when comparable) the negotiated setpoints
  const plans = useMemo(() => {
    if (!D || !meta) return null
    const out: Partial<Record<PlanKey, PlanModel>> = {}
    const fx = D.strategies.fixed
    const ai = D.strategies.ai
    if (fx) out.fixed = fromStrategy('fixed', '고정 운전', fx, D, meta, spKey)
    const usable = !block && cmp?.before && cmp.after
    if (usable && cmp!.state === 'applied') {
      // the operating plan already runs the negotiated setpoints: "before" is the stored plan of the same conditions
      out.base = fromView('base', '기본 예측 제어', cmp!.before!, meta, spKey, '협의 전')
      out.nego = fromView('nego', 'AI 협의 반영', cmp!.after!, meta, spKey, '적용됨')
    } else {
      if (ai) out.base = fromStrategy('base', '기본 예측 제어', ai, D, meta, spKey, cmp?.state === 'partial' ? '일부 적용' : undefined)
      if (usable) out.nego = fromView('nego', 'AI 협의 반영', cmp!.after!, meta, spKey, cmp!.state === 'pending' ? '미적용 추천안' : cmp!.state === 'rejected' ? '거절됨 · 미적용' : '추천안 전체')
    }
    return out
  }, [D, meta, cmp, block, spKey])

  const operating: PlanKey = !applied ? 'fixed' : cmp?.state === 'applied' && plans?.nego ? 'nego' : 'base'
  const [picked, setPicked] = useState<PlanKey | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [minute, setMinute] = useState<number | null>(null)
  const [view, setView] = useState<'timeline' | 'map'>('timeline')
  // choices belong to one date: start again from the operating plan when the date changes
  useEffect(() => {
    setPicked(null)
    setMinute(null)
    setShowCompare(false)
  }, [date])

  const rooms = useMemo(() => {
    if (!meta) return []
    const ids = Object.keys(meta.rooms)
    return ids.sort((a, b) => (ROOM_ORDER.indexOf(a) < 0 ? 99 : ROOM_ORDER.indexOf(a)) - (ROOM_ORDER.indexOf(b) < 0 ? 99 : ROOM_ORDER.indexOf(b)) || a.localeCompare(b))
  }, [meta])

  const roomParam = params.get('room')
  const setRoom = useCallback(
    (r: string | null) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (r) n.set('room', r)
          else n.delete('room')
          return n
        },
        { replace: true },
      ),
    [setParams],
  )
  const [sheet, setSheet] = useState(false)

  if (metaError && !meta) return <ErrorBox title="기본 정보를 불러오지 못했습니다" error={metaError} onRetry={reloadMeta} />
  if (day.error && !D) return <ErrorBox title="이 날짜의 운전계획을 불러오지 못했습니다" error={day.error} onRetry={day.reload} />
  if (!meta || !date || !D || !plans) return <PageSkeleton label="운전계획을 불러오는 중…" />

  const key: PlanKey = picked && plans[picked] ? picked : plans[operating] ? operating : plans.base ? 'base' : 'fixed'
  const sel = plans[key]
  if (!sel) return <ErrorBox title="이 날짜의 운전계획이 없습니다" error="시뮬레이션 결과가 아직 만들어지지 않았습니다." onRetry={day.reload} />
  const fixed = plans.fixed

  // time axis: 06–22 unless a plan or a class runs outside it
  const all: Interval[] = Object.values(plans).flatMap((p) => Object.values(p!.rooms).flatMap((r) => r.plan))
  const lo = Math.min(360, ...all.map((iv) => iv.s), ...D.sessions.map((s) => hm(s.start)))
  const hi = Math.max(1320, ...all.map((iv) => iv.e), ...D.sessions.map((s) => hm(s.end)))
  const range: [number, number] = [Math.floor(lo / 60) * 60, Math.min(1440, Math.ceil(hi / 60) * 60)]
  const firstClass = D.sessions.length ? Math.min(...D.sessions.map((s) => hm(s.start))) : 600
  const m = Math.max(range[0], Math.min(range[1], minute ?? Math.min(range[1], Math.round((firstClass + 30) / 5) * 5)))

  const withClass = rooms.find((r) => D.sessions.some((s) => s.room === r))
  const room = roomParam && meta.rooms[roomParam] ? roomParam : (withClass ?? rooms[0])
  const noClass = D.sessions.length === 0

  // comparison partner: the plan the selected one is naturally measured against
  const partnerKey: PlanKey | null = key === 'fixed' ? (plans.base ? 'base' : null) : key === 'base' ? 'fixed' : 'base'
  const partner = showCompare && partnerKey ? plans[partnerKey] : undefined
  const planMap = (p: PlanModel) => Object.fromEntries(Object.entries(p.rooms).map(([r, v]) => [r, v.plan]))
  const saving = fixed && fixed.kwh > 0 && key !== 'fixed' ? ((fixed.kwh - sel.kwh) / fixed.kwh) * 100 : null
  const band = `${meta.settings.comfort_low}~${meta.settings.comfort_high}℃`
  const planOptions: { value: PlanKey; label: string; title?: string }[] = [
    ...(plans.fixed ? [{ value: 'fixed' as PlanKey, label: '고정 운전', title: `평일 ${meta.settings.fixed_on}~${meta.settings.fixed_off} 전 강의실 일괄 가동` }] : []),
    ...(plans.base ? [{ value: 'base' as PlanKey, label: '기본 예측 제어', title: '시간표와 예보로 물리 계산 엔진이 정한 운전계획' }] : []),
    ...(plans.nego ? [{ value: 'nego' as PlanKey, label: `AI 협의 반영 · ${plans.nego.badge}`, title: 'AI가 협의한 설정온도를 반영해 물리 계산 엔진이 다시 계산한 운전계획' }] : []),
  ]

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[20px] leading-[1.3] font-bold tracking-[-0.02em] text-ink">운영 현황</h1>
          <p className="tnum mt-0.5 text-[13.5px] text-ink-3">
            {meta.building.campus.replace('부산캠퍼스', '').trim()} {meta.building.name} · 강의실 {rooms.length}곳 · {fmtDateK(date)} 기준
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden lg:block">
            <SectionTabs />
          </div>
          <Link to={`/plan?date=${date}&room=${room}`} className={btnCls('primary', 'md')}>
            <Sparkles size={15} aria-hidden /> AI 협의로 운전계획 검토
          </Link>
        </div>
      </div>

      {!applied && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-well px-5 py-3.5">
          <p className="text-[14px] text-ink-2">아직 시간표를 반영하지 않아 고정 운전 기준으로 보여 줍니다. 시간표를 넣으면 예측 제어 계획이 만들어집니다.</p>
          <Button variant="secondary" size="sm" onClick={() => setTtOpen(true)}>
            <FileUp size={14} aria-hidden /> 시간표 넣기
          </Button>
        </div>
      )}
      <TimetableApply open={ttOpen} onClose={() => setTtOpen(false)} onApplied={() => setPicked('base')} />

      {/* three numbers, all of the selected plan */}
      <section data-tour="ov-summary" className="grid grid-cols-1 divide-y divide-line rounded-[16px] border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="핵심 지표">
        <Kpi label="예상 소비량" value={fmtKwh(sel.kwh)} unit="kWh" sub={`${sel.label}${sel.badge ? ` (${sel.badge})` : ''} · 하루 전체 · 시뮬레이션`} />
        <Kpi
          label="고정 운전 대비 예상 절감률"
          value={saving != null ? `${saving >= 0 ? '' : '+'}${Math.abs(saving).toFixed(1)}` : '—'}
          unit={saving != null ? '%' : undefined}
          sub={
            key === 'fixed'
              ? '고정 운전이 비교 기준입니다'
              : fixed
                ? `${saving != null && saving < 0 ? '고정 운전보다 많이 씀 · ' : ''}같은 시간표·날씨에서 고정 운전 ${fmtKwh(fixed.kwh)} kWh`
                : '고정 운전 계산 결과가 없습니다'
          }
        />
        <Kpi
          label="수업 중 쾌적 범위 충족"
          value={noClass ? '—' : sel.comfortPct != null ? sel.comfortPct.toFixed(0) : '—'}
          unit={!noClass && sel.comfortPct != null ? '%' : undefined}
          sub={
            noClass
              ? '이 날짜에는 수업이 없습니다'
              : `예측 실내온도 ${band} 기준${sel.outBandMin != null && sel.classMin ? ` · 범위 밖 ${sel.outBandMin}분/${sel.classMin}분` : ''}${sel.pmvMean != null ? ` · 평균 PMV ${signed(sel.pmvMean, 2)}` : ''}`
          }
        />
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section data-tour="ov-building" className="min-w-0 rounded-[16px] border border-line bg-surface p-5" aria-labelledby="tl-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="tl-title" className="text-[16px] font-bold tracking-[-0.015em] text-ink">
                {view === 'timeline' ? '전체 운전 타임라인' : '강의실 배치 개념도'}
              </h2>
              <Segmented
                size="sm"
                label="보기"
                value={view}
                onChange={setView}
                options={[
                  { value: 'timeline', label: '타임라인' },
                  { value: 'map', label: '공간 보기' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {planOptions.length > 1 && <Segmented size="sm" label="운전계획" value={key} onChange={(v) => setPicked(v)} options={planOptions} />}
              {view === 'timeline' && partnerKey && plans[partnerKey] && (
                <Button size="sm" variant={showCompare ? 'primary' : 'secondary'} aria-pressed={showCompare} onClick={() => setShowCompare(!showCompare)}>
                  비교 보기
                </Button>
              )}
            </div>
          </div>
          {!plans.nego && block && cmp && cmp.state !== 'none' && <p className="mb-3 text-[12.5px] text-ink-3">‘AI 협의 반영’ 계획을 고를 수 없는 이유: {block}</p>}
          {noClass && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-well px-4 py-2.5 text-[13.5px] text-ink-2">
              <span>{fmtDateK(date)}에는 등록된 수업이 없습니다{D.holiday ? ` (${D.holiday})` : ''}. 수업이 있는 평일을 고르세요.</span>
              {defaultDate && defaultDate !== date && (
                <Button size="sm" variant="secondary" onClick={() => setDate(defaultDate)}>
                  {fmtDateK(defaultDate)}로 이동
                </Button>
              )}
            </div>
          )}

          {view === 'timeline' ? (
            <DayTimeline
              rooms={rooms}
              sessions={D.sessions}
              plan={planMap(sel)}
              planLabel={`${sel.label}${sel.badge ? ` · ${sel.badge}` : ''}`}
              compare={partner ? { plan: planMap(partner), label: `${partner.label}${partner.badge ? ` · ${partner.badge}` : ''}` } : null}
              range={range}
              minute={m}
              onMinute={setMinute}
              selected={room}
              onSelect={(r) => {
                setRoom(r)
                setSheet(true)
              }}
            />
          ) : (
            <div>
              <p className="mb-2 text-[12.5px] text-ink-3">
                실제 도면이 아닌 배치 개념도입니다. 색은 선택 시각 {fmtMin(m)}의 예측 실내온도와 계획 운전 상태({sel.label})입니다.
              </p>
              <div className="thin-scroll overflow-x-auto">
                <BuildingView
                  meta={meta}
                  state={stateAt(sel, D, meta, m)}
                  onRoomClick={(r) => {
                    setRoom(r)
                    setSheet(true)
                  }}
                  selected={room}
                  minWidth={640}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <MapLegend meta={meta} />
                <label className="flex min-w-[220px] flex-1 items-center gap-2 text-[12.5px] text-ink-3 sm:max-w-[360px]">
                  <span className="shrink-0">선택 시각</span>
                  <input type="range" min={range[0]} max={range[1]} step={5} value={m} onChange={(e) => setMinute(Number(e.target.value))} className="h-1 w-full accent-[var(--color-ink)]" aria-label="선택 시각" />
                  <span className="tnum w-11 shrink-0 text-right font-semibold text-ink">{fmtMin(m)}</span>
                </label>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-ink-3">
            <span>
              수업: 실제 시간표·등록 일정 · 냉난방 ON/OFF: 물리 계산 엔진의 계획(시뮬레이션) · 날씨: {D.weather.src_forecast}
              {partner && key !== 'fixed' && partnerKey !== 'fixed' && (
                <>
                  {' '}
                  · 운전시간 {planMinutes(Object.values(partner.rooms).flatMap((r) => r.plan)) === planMinutes(Object.values(sel.rooms).flatMap((r) => r.plan)) && rooms.every((r) => samePlan(sel.rooms[r].plan, partner.rooms[r].plan)) ? '변화 없음' : '변화 있음'}
                </>
              )}
            </span>
            {key !== 'nego' && (
              <a href={`/api/export/plan.csv?date=${date}&strategy=${key === 'fixed' ? 'fixed' : 'ai'}`} className={btnCls('ghost', 'sm')} download>
                <Download size={13} aria-hidden /> 운전계획 CSV
              </a>
            )}
          </div>
        </section>

        {/* selected room: beside the timeline on wide screens, a bottom sheet on narrow ones */}
        <aside data-tour="ov-time" className="hidden xl:block" aria-label="선택 강의실 상세">
          <RoomPanel room={room} minute={m} plan={sel} day={D} meta={meta} iaq={iaq} spKey={spKey} planKey={key} />
        </aside>
        {sheet && (
          <div className="fixed inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto rounded-t-[20px] border-t border-line bg-surface p-4 shadow-[0_-12px_32px_rgb(12_14_19/0.14)] xl:hidden" role="dialog" aria-label={`${room}호 상세`}>
            <div className="mb-1 flex justify-end">
              <button type="button" onClick={() => setSheet(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-well" aria-label="상세 닫기">
                <X size={16} aria-hidden />
              </button>
            </div>
            <RoomPanel room={room} minute={m} plan={sel} day={D} meta={meta} iaq={iaq} spKey={spKey} planKey={key} bare />
          </div>
        )}
      </div>

      <AiSummary cmp={cmp} loading={cmpQ.loading && !cmp} error={cmpQ.error} date={date} room={room} onPreview={plans.nego ? () => { setPicked('nego'); setShowCompare(true); setView('timeline') } : undefined} />
    </div>
  )
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub: string }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="text-[13px] font-medium text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tnum text-[28px] leading-[1.15] font-[650] tracking-[-0.02em] text-ink">{value}</span>
        {unit && <span className="text-[14px] font-medium text-ink-3">{unit}</span>}
      </div>
      <div className="tnum mt-1 text-[12.5px] leading-snug text-ink-3">{sub}</div>
    </div>
  )
}

/** The building at one minute of the shown plan, in the shape the floor view draws. */
function stateAt(p: PlanModel, day: Day, meta: Meta, minute: number): BuildingState {
  const idx = Math.max(0, Math.min(287, Math.floor(minute / 5)))
  const rooms: RoomState[] = Object.keys(meta.rooms).map((room) => {
    const r = p.rooms[room]
    const iv = intervalAt(r?.plan, minute)
    const ta = r?.ta?.[idx] ?? NaN
    const state: RoomState['state'] = iv ? (iv.kind === 'fan' ? 'FAN' : 'ON') : 'OFF'
    const mode: Mode = state === 'OFF' ? 'off' : state === 'FAN' ? 'air' : condMode(day, room, ta, meta, p.key === 'fixed' ? 'fixed' : 'ai')
    const ss = sessionsOf(day.sessions, room)
    return {
      room,
      state,
      mode,
      ta,
      power_w: 0,
      session: ss.find((s) => hm(s.start) <= minute && minute < hm(s.end)) ?? null,
      next: ss.find((s) => hm(s.start) > minute) ?? null,
    }
  })
  const odus: BuildingState['odus'] = {}
  for (const o of Object.values(meta.odus)) {
    const served = rooms.filter((r) => meta.rooms[r.room]?.odu === o.id && r.mode !== 'off')
    odus[o.id] = { on: served.length > 0, power_w: 0, mode: served.find((r) => r.mode === 'heat' || r.mode === 'cool')?.mode ?? (served.length ? 'air' : 'off') }
  }
  return { minute, rooms, odus }
}

// ---------------------------------------------------------------- selected room

function RoomPanel({
  room,
  minute,
  plan,
  day,
  meta,
  iaq,
  spKey,
  planKey,
  bare = false,
}: {
  room: string
  minute: number
  plan: PlanModel
  day: Day
  meta: Meta
  iaq: Iaq | undefined
  spKey: SpKey
  planKey: PlanKey
  bare?: boolean
}) {
  const r = plan.rooms[room]
  const idx = Math.max(0, Math.min(287, Math.floor(minute / 5)))
  const ta = r?.ta?.[idx]
  const iv = intervalAt(r?.plan, minute)
  const ss = sessionsOf(day.sessions, room)
  const cur = ss.find((s) => hm(s.start) <= minute && minute < hm(s.end))
  const next = ss.find((s) => hm(s.start) > minute)
  const co2 = iaq?.rooms[room]?.co2?.[Math.max(0, Math.min(95, Math.floor(minute / 15)))]
  const people = iaq?.rooms[room]?.people?.[Math.max(0, Math.min(95, Math.floor(minute / 15)))]
  const mode = iv ? (iv.kind === 'fan' ? 'air' : condMode(day, room, ta ?? 20, meta, planKey === 'fixed' ? 'fixed' : 'ai')) : 'off'
  // PMV of the class in progress exists per class only in the day's own strategies
  const sd = planKey === 'fixed' ? day.strategies.fixed : planKey === 'base' && !plan.badge?.includes('협의 전') ? day.strategies.ai : undefined
  const curPmv = cur ? sd?.rooms[room]?.sessions.find((c) => c.id === cur.id)?.pmv : undefined
  const runs = mergeIntervals(r?.plan)
  const info = meta.rooms[room]
  return (
    <div className={cx(!bare && 'rounded-[16px] border border-line bg-surface p-5')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="tnum text-[16px] font-bold tracking-[-0.015em] text-ink">
          {room}호 · 선택 시각 {fmtMin(minute)}
        </h2>
        <Badge tone="outline">예측</Badge>
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {info?.type_label ?? '강의실'} · 정원 {info?.capacity ?? '—'}명 · {plan.label}
        {plan.badge ? ` (${plan.badge})` : ''}
      </p>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[12.5px] font-medium text-ink-3">예측 실내온도</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="tnum text-[40px] leading-none font-[650] tracking-[-0.03em] text-ink">{ta != null && Number.isFinite(ta) ? ta.toFixed(1) : '—'}</span>
            <span className="text-[15px] font-medium text-ink-3">℃</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-medium text-ink-3">시뮬레이션 ON/OFF</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-[16px] font-bold text-ink">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: iv ? 'var(--color-brand)' : 'var(--color-ink-4)' }} aria-hidden />
            {iv ? `ON · ${MODE[mode as Mode].label}` : 'OFF'}
          </div>
        </div>
      </div>

      {r?.ta && <TempSpark ta={r.ta} minute={minute} lo={meta.settings.comfort_low} hi={meta.settings.comfort_high} runs={runs} />}

      <dl className="mt-4 divide-y divide-line border-y border-line text-[13.5px]">
        <Row k={`정책 설정온도 (${spKey === 'sp_heat' ? '난방' : '냉방'})`} v={r?.sp != null ? `${r.sp.toFixed(1)} ℃` : '—'} />
        <Row k="계획 운전 구간" v={runs.length ? runs.map((x) => `${fmtMin(x.s)}–${fmtMin(x.e)}`).join(', ') : '운전 없음'} />
        <Row k="진행 중인 수업" v={cur ? `${cur.title} ${cur.start}–${cur.end}` : '없음'} />
        <Row k="다음 수업" v={next ? `${next.title} ${next.start}–${next.end}` : '없음'} />
        {co2 != null && <Row k="추정 CO₂" v={`${Math.round(co2).toLocaleString('ko-KR')} ppm${iaq ? ` (기준 ${iaq.co2_max})` : ''}`} />}
        {people != null && people > 0 && <Row k="추정 재실 인원" v={`${Math.round(people)}명`} />}
        {curPmv != null ? <Row k="이 수업의 예측 PMV" v={signed(curPmv, 2)} /> : r?.pmv != null ? <Row k="수업 중 평균 예측 PMV" v={signed(r.pmv, 2)} /> : null}
        {r?.kwh != null && <Row k="하루 예상 소비량" v={`${r.kwh.toFixed(1)} kWh`} />}
      </dl>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        실내온도·ON/OFF·PMV·전력은 열모델 시뮬레이션, CO₂·인원은 정원×출석률 가정으로 계산한 추정값입니다. 실제 센서 값이 아닙니다.
      </p>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-ink-3">{k}</dt>
      <dd className="tnum min-w-0 text-right font-medium text-ink">{v}</dd>
    </div>
  )
}

/** The room's predicted temperature over the day (06–22), comfort band shaded, cursor at the chosen time. */
function TempSpark({ ta, minute, lo, hi, runs }: { ta: number[]; minute: number; lo: number; hi: number; runs: Interval[] }) {
  const a = 72 // 06:00
  const b = 264 // 22:00
  const seg = ta.slice(a, b + 1).filter((v) => Number.isFinite(v))
  if (seg.length < 2) return null
  const W = 300
  const H = 64
  const min = Math.min(lo - 1, ...seg)
  const max = Math.max(hi + 1, ...seg)
  const px = (i: number) => (i / (b - a)) * W
  const py = (v: number) => H - ((v - min) / (max - min)) * H
  const path = ta
    .slice(a, b + 1)
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`)
    .join(' ')
  const cx_ = px(Math.max(0, Math.min(b - a, minute / 5 - a)))
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H + 6}`} className="block w-full" role="img" aria-label="예측 실내온도 추이">
        <rect x={0} y={py(hi)} width={W} height={Math.max(0, py(lo) - py(hi))} fill="rgb(12 14 19 / 0.05)" />
        {runs.map((iv, i) => {
          const x0 = px(Math.max(0, iv.s / 5 - a))
          const x1 = px(Math.min(b - a, iv.e / 5 - a))
          return x1 > x0 ? <rect key={i} x={x0} y={H + 2} width={x1 - x0} height={3} rx={1.5} fill="var(--color-brand)" /> : null
        })}
        <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <line x1={cx_} x2={cx_} y1={0} y2={H} stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="tnum mt-1 text-[11.5px] text-ink-3">
        <span className="flex justify-between">
          <span>06:00</span>
          <span>22:00</span>
        </span>
        <span className="mt-0.5 block">
          예측 실내온도 추이 · 음영 {lo}~{hi}℃ · 파란 선 냉난방 ON
        </span>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------- latest negotiation, one card

function AiSummary({
  cmp,
  loading,
  error,
  date,
  room,
  onPreview,
}: {
  cmp: NegCompare | undefined
  loading: boolean
  error: Error | undefined
  date: string
  room: string
  onPreview?: () => void
}) {
  const to = `/plan?date=${date}&room=${room}`
  const shell = 'mt-5 rounded-[16px] border border-line bg-surface p-5'
  if (loading) return <Skeleton className="mt-5 h-[88px]" />
  if (error && !cmp)
    return (
      <section className={shell}>
        <h2 className="text-[16px] font-bold text-ink">AI 추천 요약</h2>
        <p className="mt-1 text-[13.5px] text-ink-3">협의 기록을 불러오지 못했습니다. {error.message}</p>
      </section>
    )
  if (!cmp || cmp.state === 'none')
    return (
      <section className={cx(shell, 'flex flex-wrap items-center justify-between gap-3')} aria-labelledby="ai-sum">
        <div>
          <h2 id="ai-sum" className="text-[16px] font-bold tracking-[-0.015em] text-ink">
            AI 추천 요약
          </h2>
          <p className="mt-1 text-[13.5px] text-ink-3">{fmtDateK(date)} 계획은 아직 AI 협의를 거치지 않았습니다. 비용·쾌적 두 Agent가 설정온도를 협의하면 결과가 여기에 표시됩니다.</p>
        </div>
        <Link to={to} className={btnCls('secondary', 'md')}>
          AI 협의 실행하러 가기 <ArrowRight size={15} aria-hidden />
        </Link>
      </section>
    )
  const st = NEG_STATE[cmp.state] ?? NEG_STATE.pending
  const stale = cmp.same_conditions === false
  const key = cmp.key ?? 'sp_heat'
  const changes = Object.entries(cmp.final_sp ?? {})
    .map(([r, to_]) => ({ r, from: cmp.base_sp?.[r], to: to_ }))
    .filter((x) => x.from != null && x.to != null && Math.abs((x.from as number) - x.to) > 0.01)
    .sort((a, b) => a.r.localeCompare(b.r))
  const b = cmp.baseline
  const f = cmp.final
  const dk = b && f ? f.kwh - b.kwh : null
  return (
    <section className={shell} aria-labelledby="ai-sum">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="ai-sum" className="text-[16px] font-bold tracking-[-0.015em] text-ink">
            AI 추천 요약
          </h2>
          <Badge tone={st.tone === 'good' ? 'good' : st.tone === 'warn' ? 'warn' : 'neutral'}>{st.label}</Badge>
          <Badge tone={cmp.ai ? 'outline' : 'warn'}>{cmp.ai ? 'Bedrock 두 Agent 협의' : '규칙 기반 대체 실행 (Bedrock 아님)'}</Badge>
          {stale && <Badge tone="crit">이전 조건의 기록</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onPreview && !stale && (
            <Button size="sm" variant="secondary" onClick={onPreview}>
              {cmp.state === 'applied' ? '타임라인에서 협의 전과 비교' : '추천안 미리보기'}
            </Button>
          )}
          <Link to={`${to}#evidence`} className={btnCls('ghost', 'sm')}>
            협의 근거 보기 <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      </div>
      {stale && (
        <p className="mt-2 text-[13px] text-crit-ink">
          이 협의 이후 {changedLabel(cmp)}이(가) 바뀌었습니다. 아래 수치는 바뀌기 전 조건의 결과이므로 현재 계획과 비교할 수 없습니다. 다시 협의하세요.
        </p>
      )}
      <dl className="tnum mt-3 grid grid-cols-1 gap-x-8 gap-y-3 text-[13.5px] md:grid-cols-3">
        <div>
          <dt className="text-ink-3">{key === 'sp_heat' ? '난방' : '냉방'} 설정온도 조정</dt>
          <dd className="mt-0.5 font-medium text-ink">{changes.length ? changes.map((c) => `${c.r}호 ${(c.from as number).toFixed(1)}→${c.to.toFixed(1)}℃`).join(', ') : '변경 없음'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">예상 소비량 (협의 전 → 후)</dt>
          <dd className="mt-0.5 font-medium text-ink">{b && f ? `${b.kwh.toFixed(1)} → ${f.kwh.toFixed(1)} kWh (${signed(dk as number, 2)} kWh)` : '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">수업 중 평균 예측 PMV (협의 전 → 후)</dt>
          <dd className="mt-0.5 font-medium text-ink">{b?.pmv_mean != null && f?.pmv_mean != null ? `${signed(b.pmv_mean, 2)} → ${signed(f.pmv_mean, 2)}` : '—'}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[12.5px] text-ink-3">
        두 Agent가 협의하는 것은 설정온도이고, 켜고 끄는 시각은 물리 계산 엔진이 다시 계산합니다. {cmp.created_at ? `협의 시각 ${cmp.created_at.slice(5, 16).replace('T', ' ')} · ` : ''}
        {cmp.state === 'pending' ? '승인 전이므로 현재 운영계획은 바뀌지 않았습니다.' : cmp.state === 'applied' ? '승인되어 현재 운영계획에 반영되어 있습니다.' : ''}
      </p>
    </section>
  )
}

