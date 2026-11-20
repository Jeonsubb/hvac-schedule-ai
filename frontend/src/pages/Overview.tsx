import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, CircleCheck, Download, FileUp, Inbox, TriangleAlert, X } from 'lucide-react'
import { invalidate, useApi } from '../lib/api'
import { useDay, useMeta } from '../lib/context'
import { DECISION, statusInfo } from '../lib/constants'
import { PendingList } from '../components/ModeSwitch'
import { useAuth } from '../lib/auth'
import type { Day, Iaq, Interval, Meta, NegCompare, OpMode } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, fmtNum, hm } from '../lib/format'
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
import { Button, ErrorBox, PageSkeleton, Popover, Segmented, Skeleton, btnCls, More} from '../components/ui'

/**
 * 운영 현황: the whole day's operating plan first. Three numbers, the ten-room ON/OFF timeline, one
 * selected room in detail, and the latest agent negotiation in one line. The floor map is a second view.
 * Indoor temperature, CO2, PMV and energy are simulated or estimated; nothing here is a sensor reading.
 */
export default function Overview() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const { date, setDate, defaultDate } = useDay()
  const [params, setParams] = useSearchParams()
  const day = useApi<Day>(date ? `/api/day/${date}` : null, { maxAgeMs: 0 })
  const cmpQ = useApi<NegCompare>(date ? `/api/negotiate/compare?date=${date}` : null, { maxAgeMs: 0 })
  const iaqQ = useApi<Iaq>(date ? `/api/iaq/${date}` : null, { maxAgeMs: 0 })
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
      if (ai) out.base = fromStrategy('base', cmp ? '기본 예측 제어' : '현재 예측 계획', ai, D, meta, spKey,
        cmp?.state === 'partial' ? '일부 적용' : !cmp ? cmpQ.error ? '협의 상태 미확인' : '협의 확인 중' : undefined)
      if (usable) out.nego = fromView('nego', 'AI 협의 반영', cmp!.after!, meta, spKey, cmp!.state === 'pending' ? '미적용 추천안' : cmp!.state === 'rejected' ? '거절됨 · 미적용' : '추천안 전체')
    }
    return out
  }, [D, meta, cmp, block, spKey, cmpQ.error])

  const operating: PlanKey = !applied ? 'fixed' : cmp?.state === 'applied' && plans?.nego ? 'nego' : 'base'
  const [picked, setPicked] = useState<PlanKey | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [minute, setMinute] = useState<number | null>(null)
  const [view, setView] = useState<'timeline' | 'map'>('timeline')
  const [kpiMore, setKpiMore] = useState(false)
  const requestsLoading = useRef(false)
  requestsLoading.current = day.loading || cmpQ.loading || iaqQ.loading
  // A plan approved in another screen/tab must be reflected when the operator returns.
  useEffect(() => {
    if (!date) return
    const refresh = () => {
      if (requestsLoading.current) return
      invalidate(`/api/day/${date}`)
      invalidate(`/api/negotiate/compare?date=${date}`)
      invalidate(`/api/iaq/${date}`)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [date])
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
  const [sheet, setSheet] = useState(!!roomParam)
  const [desktopInspector, setDesktopInspector] = useState(() => window.matchMedia('(min-width: 1200px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1200px)')
    const change = () => setDesktopInspector(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  const sheetRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sheet || desktopInspector || !sheetRef.current) return
    const previous = document.activeElement as HTMLElement | null
    const panel = sheetRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel?.focus()
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSheet(false); previous?.focus() }
      if (e.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) { e.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previous?.focus() }
  }, [sheet, desktopInspector, !!D, !!meta, roomParam])

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
  const selectedRoom = roomParam && meta.rooms[roomParam] ? roomParam : null
  const room = selectedRoom ?? withClass ?? rooms[0]
  const noClass = D.sessions.length === 0

  // comparison partner: the plan the selected one is naturally measured against
  const partnerKey: PlanKey | null = key === 'fixed' ? (plans.base ? 'base' : null) : key === 'base' ? 'fixed' : 'base'
  const partner = showCompare && partnerKey ? plans[partnerKey] : undefined
  const planMap = (p: PlanModel) => Object.fromEntries(Object.entries(p.rooms).map(([r, v]) => [r, v.plan]))
  const saving = fixed && fixed.kwh > 0 && key !== 'fixed' ? ((fixed.kwh - sel.kwh) / fixed.kwh) * 100 : null
  const band = `${meta.settings.comfort_low}~${meta.settings.comfort_high}℃`
  const cta = cmp?.same_conditions === false ? 'AI 재분석' : cmp?.state === 'pending' || cmp?.state === 'partial' ? '조정안 검토' : cmp && cmp.state !== 'none' ? '협의 결과 보기' : 'AI 운전계획 검토'
  const planOptions: { value: PlanKey; label: string; title?: string }[] = [
    ...(plans.fixed ? [{ value: 'fixed' as PlanKey, label: '고정 운전', title: `평일 ${meta.settings.fixed_on}~${meta.settings.fixed_off} 전 강의실 일괄 가동` }] : []),
    ...(plans.base ? [{ value: 'base' as PlanKey, label: plans.base.label, title: '시간표와 예보로 물리 계산 엔진이 정한 운전계획' }] : []),
    ...(plans.nego ? [{ value: 'nego' as PlanKey, label: `AI 협의 반영 · ${plans.nego.badge}`, title: 'AI가 협의한 설정온도를 반영해 물리 계산 엔진이 다시 계산한 운전계획' }] : []),
  ]

  return (
    <div className="overview-page">
      <div className="overview-heading flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-[32px] font-bold tracking-[-0.02em] text-ink">운영 현황</h1>
          <p className="tnum mt-0.5 text-[13.5px] text-ink-3">
            {meta.building.campus.replace('부산캠퍼스', '').trim()} {meta.building.name} · 강의실 {rooms.length}곳 · {fmtDateK(date)} 기준
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/plan?date=${date}&room=${room}`} className={btnCls('primary', 'md', 'overview-primary')}>
            {cta} <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
      </div>

      {applied && <Brief day={D} meta={meta} date={date} />}
      {(day.error || (cmpQ.error && cmp)) && <p role="alert" className="mb-3 text-[13px] text-warn-ink">새 데이터를 받지 못해 마지막 응답을 표시합니다. <button type="button" className="underline underline-offset-4" onClick={() => { day.reload(); cmpQ.reload() }}>다시 시도</button></p>}

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
      <section data-tour="ov-summary" className="overview-kpis grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="핵심 지표">
        <Kpi
          showSub={kpiMore}
          label="하루 예상 전력 사용량"
          value={fmtKwh(sel.kwh)}
          unit="kWh"
          basis={`${sel.label}${sel.badge ? ` · ${sel.badge}` : ''}`}
          sub={`${sel.costKrw != null ? `전기요금 약 ${fmtNum(sel.costKrw)}원 · ` : ''}${sel.label}${sel.badge ? ` (${sel.badge})` : ''} · 시뮬레이션`}
        />
        <Kpi
          showSub={kpiMore}
          label="고정 운전 대비 예상 절감률"
          value={saving != null ? `${saving >= 0 ? '−' : '+'}${Math.abs(saving).toFixed(1)}` : '—'}
          unit={saving != null ? '%' : undefined}
          basis={fixed ? `고정 운전 ${fmtKwh(fixed.kwh)} kWh 기준` : '비교 기준 없음'}
          sub={
            key === 'fixed'
              ? '고정 운전이 비교 기준입니다'
              : fixed
                ? `${saving != null && saving < 0 ? '고정 운전보다 많이 씀 · ' : ''}${meta.settings.fixed_on}~${meta.settings.fixed_off} 전 강의실 가동 시 ${fmtKwh(fixed.kwh)} kWh${fixed.costKrw != null && sel.costKrw != null && fixed.costKrw > sel.costKrw ? ` · 하루 약 ${fmtNum(fixed.costKrw - sel.costKrw)}원 절약` : ''}`
                : '고정 운전 계산 결과가 없습니다'
          }
        />
        <Kpi
          showSub={kpiMore}
          label="수업 중 쾌적 기준 충족"
          value={noClass ? '—' : sel.comfortPct != null ? sel.comfortPct.toFixed(0) : '—'}
          unit={!noClass && sel.comfortPct != null ? '%' : undefined}
          basis={noClass ? '등록된 수업 없음' : `실내온도 ${band} 기준`}
          sub={
            noClass
              ? '이 날짜에는 수업이 없습니다'
              : `수업 중 실내가 ${band} 안이었던 시간${sel.outBandMin != null && sel.classMin ? (sel.outBandMin > 0 ? ` · 벗어난 시간 ${sel.outBandMin}분(전체 ${fmtNum(sel.classMin)}분)` : ` · 수업 ${fmtNum(sel.classMin)}분 모두 범위 안`) : ''}`
          }
        />
      </section>

      <div className="overview-basis flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">선택 계획의 하루 시뮬레이션 · 실측 데이터 아님</span>
        <button
          type="button"
          aria-expanded={kpiMore}
          onClick={() => setKpiMore(!kpiMore)}
          className="ond-press inline-flex h-7 items-center gap-0.5 rounded-full px-2 text-[12px] font-semibold text-ink-3 hover:bg-hover hover:text-ink"
        >
          {kpiMore ? '산출 기준 접기' : '산출 기준'}
          <ChevronDown size={14} className={cx('transition-transform duration-150', kpiMore && 'rotate-180')} aria-hidden />
        </button>
      </div>

      <div ref={workspaceRef} className={cx('overview-workspace grid grid-cols-1 gap-6', selectedRoom && 'min-[1200px]:grid-cols-[minmax(0,1fr)_300px] min-[1200px]:items-start')}>
        <section data-tour="ov-building" className="overview-schedule min-w-0" aria-labelledby="tl-title">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="tl-title" className="text-[16px] font-bold tracking-[-0.015em] text-ink">
                {view === 'timeline' ? '강의실 운전계획' : '강의실 배치 개념도'}
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
          </div>
          <div className="overview-strategies flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 overflow-x-auto thin-scroll">
              {planOptions.length > 1 && <Segmented size="sm" label="운전계획" value={key} onChange={(v) => setPicked(v)} options={planOptions} />}
            </div>
              {view === 'timeline' && partnerKey && plans[partnerKey] && (
                <Button size="sm" variant="ghost" className={cx('overview-compare', showCompare && 'bg-well')} aria-pressed={showCompare} onClick={() => setShowCompare(!showCompare)}>
                  비교 보기
                </Button>
              )}
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
              selected={selectedRoom}
              onSelect={(r) => {
                setRoom(r)
                setSheet(true)
              }}
            />
          ) : (
            <div>
              <More className="mb-2"><p>
                실제 도면이 아닌 배치 개념도입니다. 색은 선택 시각 {fmtMin(m)}의 예측 실내온도와 계획 운전 상태({sel.label})입니다.
              </p></More>
              <div className="thin-scroll overflow-x-auto">
                <BuildingView
                  meta={meta}
                  state={stateAt(sel, D, meta, m)}
                  onRoomClick={(r) => {
                    setRoom(r)
                    setSheet(true)
                  }}
                  selected={selectedRoom}
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
            <More label="데이터 출처"><span>
              수업: 실제 시간표·등록 일정 · 냉난방 ON/OFF: 물리 계산 엔진의 계획(시뮬레이션) · 날씨: {D.weather.src_forecast}
              {partner && key !== 'fixed' && partnerKey !== 'fixed' && (
                <>
                  {' '}
                  · 운전시간 {planMinutes(Object.values(partner.rooms).flatMap((r) => r.plan)) === planMinutes(Object.values(sel.rooms).flatMap((r) => r.plan)) && rooms.every((r) => samePlan(sel.rooms[r].plan, partner.rooms[r].plan)) ? '변화 없음' : '변화 있음'}
                </>
              )}
              </span>
            </More>
            {key !== 'nego' && !(key === 'base' && cmp?.state === 'applied' && !block) && (
              <a href={`/api/export/plan.csv?date=${date}&strategy=${key === 'fixed' ? 'fixed' : 'ai'}`} className={btnCls('ghost', 'sm')} download>
                <Download size={13} aria-hidden /> 운전계획 CSV
              </a>
            )}
          </div>
        </section>

        {/* selected room: beside the timeline on wide screens, a bottom sheet on narrow ones */}
        {selectedRoom && <aside data-tour="ov-time" className="overview-inspector hidden min-[1200px]:block" aria-label="선택 강의실 상세">
          <button type="button" onClick={() => {
            setRoom(null); setSheet(false)
            requestAnimationFrame(() => {
              const buttons = workspaceRef.current?.querySelectorAll<HTMLButtonElement>('.timeline-room')
              const target = buttons && [...buttons].find((b) => b.title === `${room}호 상세 보기`)
              ;(target || workspaceRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]'))?.focus()
            })
          }} className="overview-inspector-close" aria-label="강의실 상세 닫기"><X size={16} aria-hidden /></button>
          <RoomPanel room={selectedRoom} minute={m} plan={sel} day={D} meta={meta} iaq={iaq} iaqError={iaqQ.error} onIaqRetry={iaqQ.reload} spKey={spKey} planKey={key} date={date} cmp={cmp} range={range} />
        </aside>
        }
        {selectedRoom && sheet && (
          <>
          <div className="fixed inset-0 z-30 bg-black/15 min-[1200px]:hidden" onClick={() => setSheet(false)} aria-hidden />
          <div ref={sheetRef} tabIndex={-1} className="overview-room-sheet fixed inset-x-0 bottom-0 z-30 max-h-[78vh] overflow-y-auto rounded-t-[12px] border-t border-line bg-surface p-5 shadow-[0_-12px_32px_rgb(12_14_19/0.14)] min-[1200px]:hidden" role="dialog" aria-modal="true" aria-label={`${room}호 상세`}>
            <div className="mb-1 flex justify-end">
              <button type="button" onClick={() => setSheet(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-well" aria-label="상세 닫기">
                <X size={16} aria-hidden />
              </button>
            </div>
            <RoomPanel room={room} minute={m} plan={sel} day={D} meta={meta} iaq={iaq} iaqError={iaqQ.error} onIaqRetry={iaqQ.reload} spKey={spKey} planKey={key} date={date} cmp={cmp} range={range} bare />
          </div>
          </>
        )}
      </div>

      <AiSummary cmp={cmp} loading={cmpQ.loading && !cmp} error={cmpQ.error} onRetry={cmpQ.reload} date={date} room={room} onPreview={plans.nego ? () => { setPicked('nego'); setShowCompare(true); setView('timeline') } : undefined} />

      <NextSteps />
    </div>
  )
}

/** Operational exceptions stay visible without repeating the KPI story. */
function Brief({ day, meta, date }: { day: Day; meta: Meta; date: string }) {
  const modeQ = useApi<OpMode>('/api/mode', { maxAgeMs: 20_000, refreshMs: 60_000 })
  const pending = Number(modeQ.data?.pending) || 0
  const review = (day.validation?.sessions ?? []).filter((v) => statusInfo(String(v.status)).group === 'review')
  const wxErr = Object.keys(meta.weather?.errors ?? {}).length > 0
  const aiDown = meta.ai?.ok === false
  const clear = !!modeQ.data && !modeQ.error && pending === 0 && review.length === 0 && !wxErr && !aiDown
  return (
    <section data-tour="ov-brief" className="overview-brief" aria-label="오늘 요약과 확인할 일">
      <span className="tnum text-ink-2">수업 {day.sessions.length}건 <span className="mx-1 text-ink-4">·</span> {new Set(day.sessions.map((s) => s.room)).size}개 강의실</span>
      {clear && <span className="inline-flex items-center gap-1.5 text-ink-3"><CircleCheck size={14} aria-hidden /> 검토할 항목 없음</span>}
      {pending > 0 && (
        <Popover label="승인 대기 조정안" align="start" width={400}
          buttonClassName="inline-flex min-h-7 items-center gap-1.5 rounded-[6px] bg-warn-bg px-2 text-[13px] font-medium text-warn-ink hover:brightness-95"
          button={<><Inbox size={14} aria-hidden /> 승인 대기 {pending}건</>}>
          <div className="mb-3 font-semibold text-ink">승인을 기다리는 AI 조정안</div>
          <PendingList onDone={modeQ.reload} />
          <p className="mt-3 text-[13px] text-ink-3">승인한 조정안만 운전계획에 반영됩니다.</p>
        </Popover>
      )}
      {review.length > 0 && <Link to={`/validation?date=${date}`} className="inline-flex items-center gap-1.5 text-warn-ink hover:underline"><TriangleAlert size={14} aria-hidden /> 수업 확인 {review.length}건</Link>}
      {wxErr && <span className="text-warn-ink">날씨 자료 일부 수신 실패</span>}
      {aiDown && <span className="text-warn-ink">AI 연결 불안정</span>}
      {modeQ.error && <button type="button" onClick={modeQ.reload} className="text-warn-ink underline underline-offset-4">운영 상태 수신 실패 · 재시도</button>}
      {!modeQ.data && !modeQ.error && <span role="status" className="text-ink-3">운영 상태 확인 중…</span>}
      {modeQ.data && <span className="ml-auto text-[12px] text-ink-3">{modeQ.data.mode === 'auto' ? '설정온도 자동 반영 모드' : '설정온도 승인 후 반영'}</span>}
    </section>
  )
}

/** In words: what the room is doing at the chosen time and why. */
function roomStatus(iv: Interval | undefined, cur: { title: string; end: string } | undefined, next: { title: string; start: string } | undefined, runs: Interval[], minute: number, fixed: boolean): string {
  if (iv && fixed) return `고정 운전계획에 따라 ${fmtMin(iv.e)}까지 켜 둡니다.${next ? ` 다음 수업은 ${next.start}입니다.` : ''}`
  if (iv && cur) return `수업 중 · 냉난방 ON. 계획 종료 시각은 ${fmtMin(iv.e)}입니다.`
  if (iv && next) return `${next.start} 수업에 맞춰 미리 켜 둔 상태입니다.`
  if (iv) return '계획에 따라 켜 둔 상태입니다.'
  if (cur) return '수업 중 · 냉난방 OFF로 계획되어 있습니다. 예측온도와 쾌적 기준을 함께 확인하세요.'
  const run = runs.find((x) => x.s > minute)
  if (next && run) return `지금은 수업이 없어 꺼 둡니다. ${next.start} 수업에 맞춰 ${fmtMin(run.s)}에 켭니다.`
  if (next) return `지금은 수업이 없어 꺼 둡니다. 다음 수업은 ${next.start}입니다.`
  return '오늘 남은 수업이 없어 꺼 둡니다.'
}

/** Quiet shortcuts for follow-up work; negotiation has its own entry above. */
function NextSteps() {
  return (
    <nav className="overview-shortcuts" aria-label="관련 작업">
      <span className="text-ink-3">관련 작업</span>
      <Link to="/data">시간표·일정 관리 <ArrowUpRight size={13} aria-hidden /></Link>
      <Link to="/energy">학기 절감 효과 <ArrowUpRight size={13} aria-hidden /></Link>
      <Link to="/settings">운영 규칙 <ArrowUpRight size={13} aria-hidden /></Link>
    </nav>
  )
}

function Kpi({ label, value, unit, sub, basis, showSub = false }: { label: string; value: string; unit?: string; sub: string; basis: string; showSub?: boolean }) {
  return (
    <div className="overview-kpi min-w-0">
      <div className="text-[13px] font-medium text-ink-3">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tnum text-[36px] leading-[1.1] font-[600] tracking-[-0.035em] text-ink">{value}</span>
        {unit && <span className="text-[14px] font-medium text-ink-3">{unit}</span>}
      </div>
      <div className="tnum mt-2 text-[12px] text-ink-3">{basis}</div>
      {showSub && <div className="tnum fade-in mt-2 text-[12.5px] leading-relaxed text-ink-2">{sub}</div>}
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
  iaqError,
  onIaqRetry,
  spKey,
  planKey,
  date,
  cmp,
  range,
  bare = false,
}: {
  room: string
  minute: number
  plan: PlanModel
  day: Day
  meta: Meta
  iaq: Iaq | undefined
  iaqError: Error | undefined
  onIaqRetry: () => void
  spKey: SpKey
  planKey: PlanKey
  date: string
  cmp: NegCompare | undefined
  range: [number, number]
  bare?: boolean
}) {
  const r = plan.rooms[room]
  const idx = Math.max(0, Math.min(287, Math.floor(minute / 5)))
  const ta = r?.ta?.[idx]
  const runs = mergeIntervals(r?.plan)
  const iv = intervalAt(runs, minute)
  const ss = sessionsOf(day.sessions, room)
  const cur = ss.find((s) => hm(s.start) <= minute && minute < hm(s.end))
  const next = ss.find((s) => hm(s.start) > minute)
  const iaqRoom = iaq?.rooms[room]
  const iaqIndex = Math.max(0, Math.floor(minute / (iaq?.step_min || 15)))
  const co2 = iaqRoom?.co2?.[Math.min(iaqRoom.co2.length - 1, iaqIndex)]
  const people = iaqRoom?.people?.[Math.min(iaqRoom.people.length - 1, iaqIndex)]
  const mode = iv ? (iv.kind === 'fan' ? 'air' : condMode(day, room, ta ?? 20, meta, planKey === 'fixed' ? 'fixed' : 'ai')) : 'off'
  const info = meta.rooms[room]
  const why = (day.decisions ?? []).filter((d) => d.room === room)
  return (
    <div className={cx('room-panel', !bare && 'pt-0.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="tnum text-[22px] font-semibold tracking-[-0.025em] text-ink">
          {room}호
        </h2>
        <span className="mr-8 text-[12px] text-ink-3">예측</span>
      </div>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {info?.type_label ?? '강의실'} · 정원 {info?.capacity ?? '—'}명 · {plan.label}
        {plan.badge ? ` (${plan.badge})` : ''}
      </p>
      <div className="mt-5 flex items-center justify-between gap-3 text-[13px]">
        <span className="tnum text-ink-3">선택 시각 {fmtMin(minute)}</span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><span className="h-1.5 w-1.5 rounded-full" style={{ background: iv ? 'var(--color-brand)' : 'var(--color-ink-4)' }} aria-hidden />{iv ? `ON · ${MODE[mode as Mode].label}` : '냉난방 OFF'}</span>
      </div>
      <p className="mt-2 text-[14px] leading-[1.65] text-ink">{roomStatus(iv, cur, next, runs, minute, planKey === 'fixed')}</p>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <div className="text-[12px] text-ink-3">선택 시각 예측 실내온도</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="tnum text-[28px] leading-[1.3] font-[600] tracking-[-0.03em] text-ink">{ta != null && Number.isFinite(ta) ? ta.toFixed(1) : '—'}</span>
            <span className="text-[15px] font-medium text-ink-3">℃</span>
          </div>
        </div>
        <div>
          <div className="text-[12px] text-ink-3">{spKey === 'sp_heat' ? '난방' : '냉방'} 설정온도</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="tnum text-[28px] leading-[1.3] font-[600] tracking-[-0.03em] text-ink">{r?.sp != null ? r.sp.toFixed(1) : '—'}</span><span className="text-[15px] text-ink-3">℃</span>
          </div>
        </div>
      </div>

      {r?.ta && <TempSpark ta={r.ta} minute={minute} lo={meta.settings.comfort_low} hi={meta.settings.comfort_high} runs={runs} range={range} />}

      <dl className="mt-4 divide-y divide-line border-y border-line text-[13.5px]">
        <Row k="켜 두는 시간" v={runs.length ? runs.map((x) => `${fmtMin(x.s)}–${fmtMin(x.e)}`).join(', ') : '운전 없음'} />
        <Row k="진행 중인 수업" v={cur ? `${cur.title} ${cur.start}–${cur.end}` : '없음'} />
        <Row k="다음 수업" v={next ? `${next.title} ${next.start}–${next.end}` : '없음'} />
        {co2 != null && <Row k="추정 CO₂" v={`${Math.round(co2).toLocaleString('ko-KR')} ppm${iaq ? ` (기준 ${iaq.co2_max})` : ''}`} />}
        {people != null && people > 0 && <Row k="추정 재실 인원" v={`${Math.round(people)}명`} />}
        {r?.kwh != null && <Row k="하루 예상 전기 사용" v={`${r.kwh.toFixed(1)} kWh`} />}
      </dl>
      <p className="mt-2 text-[11.5px] text-ink-3">CO₂·인원은 현재 운영계획 기준 추정값입니다.</p>
      {iaqError && <p role="alert" className="mt-2 text-[12px] text-warn-ink">{iaq ? '공기질 갱신 실패 · 마지막 응답 표시.' : '공기질 추정값 수신 실패.'} <button type="button" onClick={onIaqRetry} className="underline underline-offset-4">다시 시도</button></p>}
      {!iaq && !iaqError && <p role="status" className="mt-2 text-[12px] text-ink-3">공기질 추정값 확인 중…</p>}
      <div className="mt-5">
        <h3 className="text-[13px] font-semibold text-ink">왜 이렇게 운영하나요?</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{planKey === 'fixed' ? '고정 운전 시간에 맞춰 계산한 계획입니다.' : '시간표와 기상예보를 바탕으로 물리 계산 엔진이 운전 시각을 계산합니다.'}</p>
        {planKey === 'nego' && cmp?.same_conditions === true && cmp.base_sp?.[room] != null && cmp.final_sp?.[room] != null && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">설정온도 협의 {cmp.base_sp[room].toFixed(1)} → {cmp.final_sp[room].toFixed(1)}℃ · {NEG_STATE[cmp.state]?.label} <Link to={`/plan?date=${date}&room=${room}#evidence`} className="text-brand-ink underline-offset-4 hover:underline">협의 근거</Link></p>}
      </div>
      {planKey !== 'fixed' && why.length > 0 && (
        <More className="mt-2" label="현재 운영계획의 계산 근거">
          <ul className="space-y-1.5">
            {why.map((d, i) => (
              <li key={i} className="border-l border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink-2">
                <span className="font-semibold">{DECISION[d.type]?.label ?? d.type}</span>
                <span className="tnum"> · {d.start} 수업</span>
                <span className="mt-0.5 block text-ink-2">{d.detail}</span>
              </li>
            ))}
          </ul>
        </More>
      )}
      <More className="mt-2" label="데이터 출처"><p>
        실내온도·켜고 끄는 시각·전력은 열모델 시뮬레이션, CO₂·인원은 정원×출석률 가정으로 계산한 추정값입니다. 실제 센서 값이 아닙니다.
      </p></More>
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
function TempSpark({ ta, minute, lo, hi, runs, range }: { ta: number[]; minute: number; lo: number; hi: number; runs: Interval[]; range: [number, number] }) {
  const a = Math.max(0, Math.floor(range[0] / 5))
  const b = Math.min(ta.length - 1, Math.floor(range[1] / 5))
  const seg = ta.slice(a, b + 1).filter((v) => Number.isFinite(v))
  if (seg.length < 2) return null
  const W = 300
  const H = 64
  const min = Math.min(lo - 1, ...seg)
  const max = Math.max(hi + 1, ...seg)
  const px = (i: number) => ((i * 5) / (range[1] - range[0])) * W
  const py = (v: number) => H - ((v - min) / (max - min)) * H
  const path = ta
    .slice(a, b + 1)
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`)
    .join(' ')
  const minuteX = (m: number) => Math.max(0, Math.min(W, ((m - range[0]) / (range[1] - range[0])) * W))
  const cx_ = minuteX(minute)
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H + 6}`} className="block w-full" role="img" aria-label="예측 실내온도 추이">
        <rect x={0} y={py(hi)} width={W} height={Math.max(0, py(lo) - py(hi))} fill="rgb(12 14 19 / 0.05)" />
        {runs.map((iv, i) => {
          const x0 = minuteX(iv.s)
          const x1 = minuteX(iv.e)
          return x1 > x0 ? <rect key={i} x={x0} y={H + 2} width={x1 - x0} height={3} rx={1.5} fill="var(--color-brand)" /> : null
        })}
        <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <line x1={cx_} x2={cx_} y1={0} y2={H} stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="tnum mt-1 text-[11.5px] text-ink-3">
        <span className="flex justify-between">
          <span>{fmtMin(range[0])}</span>
          <span>{fmtMin(range[1])}</span>
        </span>
        <span className="mt-0.5 block">
          예측 실내온도 추이 · 음영 {lo}~{hi}℃ · 파란 선 냉난방 ON
        </span>
      </figcaption>
    </figure>
  )
}

// ---------------------------------------------------------------- latest negotiation

/** Compare the same full-day PlanViews as the KPIs; never substitute the older evaluation totals. */
function AiSummary({ cmp, loading, error, onRetry, date, room, onPreview }: {
  cmp: NegCompare | undefined
  loading: boolean
  error: Error | undefined
  onRetry: () => void
  date: string
  room: string
  onPreview?: () => void
}) {
  const to = `/plan?date=${date}&room=${room}`
  if (loading) return <div className="overview-ai" role="status"><Skeleton className="h-4 w-60" /><span className="sr-only">협의 기록 확인 중…</span></div>
  if (error && !cmp) return <section className="overview-ai" aria-label="AI 협의 요약"><p role="alert" className="text-[13px] text-warn-ink">협의 기록을 불러오지 못했습니다. <button type="button" onClick={onRetry} className="underline underline-offset-4">다시 시도</button></p></section>
  if (!cmp || cmp.state === 'none') return <section className="overview-ai flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="AI 협의 요약"><span className="text-[13px] font-semibold text-ink">AI 협의</span><p className="text-[13px] text-ink-3">선택한 날짜의 협의 기록 없음</p><Link to={to} className="ml-auto inline-flex items-center gap-1 text-[13px] text-brand-ink hover:underline">운전계획 검토 <ArrowUpRight size={14} aria-hidden /></Link></section>
  const st = NEG_STATE[cmp.state] ?? NEG_STATE.pending
  const stale = cmp.same_conditions === false
  const comparable = cmp.same_conditions === true && !!cmp.before && !!cmp.after
  const changes = Object.entries(cmp.final_sp ?? {})
    .map(([r, to_]) => ({ r, from: cmp.base_sp?.[r], to: to_ }))
    .filter((x) => x.from != null && Math.abs(x.from - x.to) > 0.01)
    .sort((a, b) => a.r.localeCompare(b.r))
  const before = comparable ? cmp.before : null
  const after = comparable ? cmp.after : null
  const delta = before && after ? after.kwh - before.kwh : null
  const label = cmp.state === 'applied' ? '적용된 협의 효과' : cmp.state === 'partial' ? '전체 추천안 예상 효과 · 일부 적용' : cmp.state === 'rejected' ? '거절된 추천안 예상 효과' : cmp.state === 'no_change' ? '설정온도 변경 없음' : '미적용 추천안 예상 효과'
  return (
    <section className="overview-ai" aria-labelledby="ai-sum">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        <h2 id="ai-sum" className="font-semibold text-ink">AI 협의</h2>
        <span className={st.tone === 'warn' ? 'text-warn-ink' : 'text-ink-3'}>{st.label}</span>
        <p className="min-w-0 text-ink-2">
          {stale ? `${changedLabel(cmp)} 변경 · 이전 조건의 기록` : before && after && delta != null ? <>{label} · 예상 사용량 <span className="tnum font-semibold text-ink">{signed(delta, 2)} kWh</span> · 쾌적 이탈 {before.out_band_min} → {after.out_band_min}분</> : '동일 조건의 하루 계획 비교 자료 없음'}
        </p>
        <Link to={`${to}#evidence`} className="ml-auto inline-flex items-center gap-1 whitespace-nowrap text-brand-ink hover:underline">협의 결과 <ArrowUpRight size={14} aria-hidden /></Link>
      </div>
      <More className="mt-1" label="설정온도·협의 상세">
        <p>{cmp.ai ? 'Amazon Bedrock의 비용·쾌적성 두 Agent가 설정온도를 협의했습니다.' : '규칙 기반 대체 실행 결과입니다. Bedrock 협의 결과가 아닙니다.'} 물리 계산 엔진이 해당 설정온도로 운전계획을 다시 계산합니다.</p>
        {stale && <p className="mt-2 text-warn-ink">협의 이후 {changedLabel(cmp)}이(가) 바뀌었습니다. 현재 계획과 비교할 수 없어 효과 수치를 표시하지 않습니다.</p>}
        {!stale && !comparable && <p className="mt-2">이 기록에는 동일 조건으로 확인된 하루 계획 비교 자료가 없습니다. AI 최적화에서 재검토하세요.</p>}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><dt className="text-ink-3">{cmp.key === 'sp_cool' ? '냉방' : '난방'} 설정온도 조정</dt><dd className="tnum mt-1 text-ink">{changes.length ? changes.map((c) => `${c.r}호 ${c.from!.toFixed(1)} → ${c.to.toFixed(1)}℃`).join(', ') : '변경 없음'}</dd></div>
          <div><dt className="text-ink-3">하루 예상 사용량 · 협의 전 → 후</dt><dd className="tnum mt-1 text-ink">{before && after ? `${fmtKwh(before.kwh)} → ${fmtKwh(after.kwh)} kWh` : '비교 불가'}</dd></div>
        </dl>
        <p className="mt-3 text-ink-3">고정 운전 대비 절감률과는 별개인 설정온도 협의의 추가 효과입니다. {cmp.created_at ? `협의 시각 ${cmp.created_at.slice(5, 16).replace('T', ' ')}.` : ''}</p>
        {onPreview && !stale && <Button size="sm" variant="secondary" className="mt-3" onClick={onPreview}>{cmp.state === 'applied' ? '타임라인에서 협의 전과 비교' : '추천안 미리보기'}</Button>}
      </More>
    </section>
  )
}
