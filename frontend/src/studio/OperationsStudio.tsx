import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Download, Expand, Pause, Play, RotateCcw, Upload, X } from 'lucide-react'
import gsap from 'gsap'
import { ErrorBox, PageSkeleton } from '../components/ui'
import TimetableApply from '../components/TimetableApply'
import { cx, fmtDateK, fmtKwh, fmtMin, hm } from '../lib/format'
import { intervalAt, mergeIntervals, NEG_STATE, sessionsOf, signed } from '../lib/plans'
import type { Meta } from '../lib/types'
import type { PlanModel } from '../lib/plans'
import { useOperations } from './useOperations'
import { useStudioPrefix } from './StudioShell'
import LivingBuilding from './LivingBuilding'
import OperationalTimeline from './OperationalTimeline'
import './operations.css'

export default function OperationsStudio() {
  const op = useOperations()
  const prefix = useStudioPrefix()
  const [params, setParams] = useSearchParams()
  const selected = params.get('room') && op.meta?.rooms[params.get('room')!] ? params.get('room')! : null
  const select = (room: string | null) => setParams((prev) => { const next = new URLSearchParams(prev); if (room) next.set('room', room); else next.delete('room'); return next }, { replace: true })
  const [focusTimeline, setFocusTimeline] = useState(false)
  const [upload, setUpload] = useState(false)
  const page = useRef<HTMLDivElement>(null)
  const clearSelected = () => {
    const focusTarget = page.current?.querySelector<SVGGElement>('.living-room[aria-pressed="true"]')
    select(null)
    requestAnimationFrame(() => focusTarget?.focus())
  }
  useLayoutEffect(() => {
    if (!op.plan || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.fromTo('.ops-title-word', { yPercent: 110, rotate: 3 }, { yPercent: 0, rotate: 0, duration: .8, stagger: .09, ease: 'power4.out' })
      gsap.fromTo('.living-room', { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: .025, duration: .65, ease: 'power3.out', clearProps: 'transform,opacity' })
    }, page)
    return () => context.revert()
  }, [!!op.plan])
  useEffect(() => { op.setPlaying(false) }, [focusTimeline]) // changing workspace view never silently keeps playing

  if (op.metaError && !op.meta) return <ErrorBox title="건물 정보를 불러오지 못했습니다" error={op.metaError} onRetry={op.reloadMeta} />
  if (op.dayQ.error && !op.day) return <ErrorBox title="운전계획 조회 실패" error={op.dayQ.error} onRetry={op.dayQ.reload} />
  if (!op.meta || !op.date || !op.day) return <PageSkeleton label="운영 Studio에 시뮬레이션 계획을 연결하는 중…" />
  if (!op.plan) return <ErrorBox title="운전계획이 없습니다" error="선택한 날짜의 시뮬레이션 결과를 확인하세요." onRetry={op.dayQ.reload} />
  const { meta, day, plan, time, range, compare } = op
  const active = op.rooms.filter((r) => intervalAt(plan.rooms[r]?.plan, time))
  const fixed = op.plans.fixed
  const saving = fixed && fixed.kwh > 0 && op.key !== 'fixed' ? (fixed.kwh - plan.kwh) / fixed.kwh * 100 : null
  const toPlan = `${prefix}/plan?date=${op.date}${selected ? `&room=${selected}` : ''}`
  const cta = compare?.same_conditions === false ? 'AI 재분석' : compare?.state === 'pending' || compare?.state === 'partial' ? '조정안 검토' : compare && compare.state !== 'none' ? '협의 Theater 열기' : 'AI 협의 실행'
  const delta = compare?.same_conditions === true && compare.before && compare.after ? compare.after.kwh - compare.before.kwh : null
  const nextRun = op.rooms.flatMap((room) => mergeIntervals(plan.rooms[room]?.plan).filter((iv) => iv.s > time).map((iv) => ({ room, ...iv }))).sort((a, b) => a.s - b.s)[0]
  const canExport = op.key === 'fixed' || op.key === 'base' && compare?.state !== 'applied'
  return <div ref={page} className="ops-studio">
    <header className="ops-masthead">
      <div><div className="studio-kicker">LIVE OPERATIONS STUDIO <span>01 / {meta.building.name}</span></div><h1 className="ops-title"><span><span className="ops-title-word">운영의</span></span> <span><span className="ops-title-word">모든 순간<span className="ops-title-dot">.</span></span></span></h1><p>{meta.building.campus.replace('부산캠퍼스', '').trim()} {meta.building.name} · {fmtDateK(op.date)} · 하루 운전계획 탐색</p></div>
      <div className="ops-impact" aria-label="선택 계획 핵심 지표">
        <div><span>하루 예상 사용량</span><strong>{fmtKwh(plan.kwh)}<small>kWh</small></strong><em>{plan.label} · {plan.badge ?? '시뮬레이션'}</em></div>
        <div><span>고정 운전 대비</span><strong>{saving == null ? '—' : `${saving >= 0 ? '−' : '+'}${Math.abs(saving).toFixed(1)}`}<small>{saving != null ? '%' : ''}</small></strong><em>{fixed ? `${fmtKwh(fixed.kwh)} kWh 기준` : '비교 기준 없음'}</em></div>
        <div><span>수업 중 쾌적 충족</span><strong>{day.sessions.length && plan.comfortPct != null ? plan.comfortPct.toFixed(0) : '—'}<small>{day.sessions.length && plan.comfortPct != null ? '%' : ''}</small></strong><em>{day.sessions.length ? `${meta.settings.comfort_low}–${meta.settings.comfort_high}℃` : '등록된 수업 없음'}</em></div>
      </div>
    </header>

    <div className="ops-command-line"><div className="ops-plan-switch" role="group" aria-label="Studio 운전 전략">{(['fixed', 'base', 'nego'] as const).filter((k) => !!op.plans[k]).map((k) => <button type="button" aria-pressed={op.key === k} key={k} onClick={() => { op.setPicked(k); op.setPlaying(false) }} className={op.key === k ? 'is-active' : ''}>{op.plans[k]!.label}{op.key === k && <Check size={12} aria-hidden />}</button>)}</div><div className="ops-command-actions"><button type="button" onClick={() => setFocusTimeline(!focusTimeline)} aria-pressed={focusTimeline}><Expand size={13} aria-hidden />{focusTimeline ? '건물 + 시간축' : '시간축 집중'}</button><Link to={toPlan}> {cta} <ArrowUpRight size={14} aria-hidden /></Link></div></div>
    {(!op.applied || Number(op.modeQ.data?.pending) > 0) && <div className="ops-alert-line">{!op.applied ? <><span>시간표 반영 전 · 고정 운전 기준</span><button type="button" onClick={() => setUpload(true)}><Upload size={13} /> 시간표 연결</button></> : <><span>전체 승인 대기 {op.modeQ.data?.pending}건</span><Link to={toPlan}>조정안 확인 <ArrowUpRight size={13} /></Link></>}</div>}
    {day.sessions.length === 0 && <div className="ops-alert-line"><span>선택 날짜에 등록된 수업이 없습니다. 계획에 포함된 운전만 표시합니다.</span>{op.defaultDate !== op.date && <button type="button" onClick={() => op.defaultDate && op.setDate(op.defaultDate)}>최근 수업일로 이동 <ArrowRight size={13} /></button>}</div>}
    {op.dayQ.error && <ErrorBox title="갱신 실패 · 마지막 계획 표시" error={op.dayQ.error} onRetry={op.dayQ.reload} />}

    <section className={cx('ops-stage', focusTimeline && 'ops-stage-compact')} aria-label="Living Building">
      <div className="ops-stage-top"><span><i /> LIVING BUILDING <small>개념 배치도</small></span><span>{op.rooms.length} SPACES <b>/</b> {day.sessions.length} CLASSES</span></div>
      {!focusTimeline && <div className="ops-stage-body"><LivingBuilding meta={meta} plan={plan} rooms={op.rooms} minute={time} selected={selected} onSelect={select} />
        <aside className="ops-moment" aria-label="선택 공간 정보">
          {selected ? <StudioRoom room={selected} plan={plan} meta={meta} day={day} time={time} iaq={op.iaq} iaqError={!!op.iaqQ.error} onRetry={op.iaqQ.reload} onClose={clearSelected} prefix={prefix} /> : <>
            <div className="ops-instrument-label">SELECTED MOMENT <span>예측</span></div>
            <div className="ops-active-count">{String(active.length).padStart(2, '0')}<small>/ {op.rooms.length}</small></div>
            <p className="ops-active-copy">선택 시각에 운전하는 공간</p>
            <div className="ops-next"><span>NEXT OPERATION</span><strong>{nextRun ? fmtMin(nextRun.s) : '—'}<small>{nextRun ? `${nextRun.room}호 ON` : '남은 운전 없음'}</small></strong></div>
            <p className="ops-explore-note">강의실을 선택해<br />예측 상태와 운전 이유를 탐색하세요. <ArrowUpRight size={17} aria-hidden /></p>
          </>}
        </aside>
      </div>}
      <div className="ops-time-desk"><button type="button" className="ops-play" aria-label={op.playing ? '가상 시간 재생 일시정지' : '가상 시간 재생'} aria-pressed={op.playing} onClick={() => { if (!op.playing && time >= range[1]) op.setMinute(range[0]); op.setPlaying(!op.playing) }}>{op.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><div className="ops-time-readout"><strong>{fmtMin(time)}</strong><span>VIRTUAL TIME</span></div><div className="ops-time-range"><label className="sr-only" htmlFor="ops-time">가상 시각</label><input id="ops-time" type="range" min={range[0]} max={range[1]} step={5} value={time} aria-valuetext={fmtMin(time)} onChange={(e) => { op.setMinute(Number(e.target.value)); op.setPlaying(false) }} /><div><span>{fmtMin(range[0])}</span><span>선택 시각 · 건물과 시간축 동기화</span><span>{fmtMin(range[1])}</span></div></div><button type="button" aria-label="하루 시작으로 이동" className="ops-reset" onClick={() => { op.setMinute(range[0]); op.setPlaying(false) }}><RotateCcw size={15} /></button></div>
    </section>

    <section className="ops-timeline-section" aria-labelledby="ops-timeline-heading">
      <div className="ops-section-heading"><div><span className="studio-kicker">THE DAY, ORCHESTRATED</span><h2 id="ops-timeline-heading">공간을 잇는 시간축<span> {op.rooms.length}</span></h2></div><div className="ops-timeline-tools">{op.partner && <button type="button" aria-pressed={op.showCompare} className={op.showCompare ? 'is-active' : ''} onClick={() => op.setShowCompare(!op.showCompare)}>계획 비교 <span>{op.showCompare ? 'ON' : 'OFF'}</span></button>}{canExport && <a href={`/api/export/plan.csv?date=${op.date}&strategy=${op.key === 'fixed' ? 'fixed' : 'ai'}`} download aria-label="Studio 운전계획 CSV 다운로드"><Download size={14} /> CSV</a>}</div></div>
      <OperationalTimeline day={day} rooms={op.rooms} plan={plan} partner={op.showCompare ? op.partner : undefined} range={range} minute={time} selected={selected} onSelect={select} onMinute={(m) => { op.setMinute(m); op.setPlaying(false) }} />
      <div className="ops-provenance"><span>수업 {day.sessions.length}건 · 시간표 / 특별 일정</span><span>{plan.label} {plan.badge && `· ${plan.badge}`}</span><details><summary>데이터 출처 <ChevronDown size={11} /></summary><p>HVAC ON/OFF·실내온도·전력은 물리 계산 엔진의 시뮬레이션입니다. 날씨: {day.weather.src_forecast}. CO₂·재실 인원은 현재 운영계획의 추정값입니다. 실측 센서가 아닙니다.</p></details></div>
    </section>

    <section className="ops-agent-bridge" aria-label="AI 설정온도 협의 요약"><div className="ops-dual-symbol" aria-hidden><i /><i /></div><div><span className="studio-kicker">TWO PERSPECTIVES. ONE POLICY.</span><p>{op.compareQ.error ? '협의 기록 조회 실패' : delta != null ? `${compare?.state === 'applied' ? '적용된' : '추천안 예상'} 설정온도 협의 효과 ${signed(delta, 2)} kWh · 쾌적 이탈 ${compare!.before!.out_band_min} → ${compare!.after!.out_band_min}분` : compare && compare.state !== 'none' ? op.block ?? '협의 기록 확인' : op.compareQ.loading ? '협의 기록 확인 중…' : '이 날짜의 협의 기록 없음'}</p><small>{compare && compare.state !== 'none' ? `${NEG_STATE[compare.state]?.label} · ${compare.ai ? 'Bedrock 두 Agent' : '규칙 기반 대체 실행'}` : '비용과 쾌적성, 두 관점에서 설정온도를 검토합니다.'} · 고정 운전 대비 절감과 별개</small></div>{op.compareQ.error && <button type="button" onClick={op.compareQ.reload}>다시 조회</button>}<Link className="studio-action" to={toPlan}>협의 Theater <ArrowUpRight size={16} /></Link></section>
    <TimetableApply open={upload} onClose={() => setUpload(false)} onApplied={() => op.setPicked('base')} />
  </div>
}

function StudioRoom({ room, plan, meta, day, time, iaq, iaqError, onRetry, onClose, prefix }: {
  room: string; plan: PlanModel; meta: Meta; day: NonNullable<ReturnType<typeof useOperations>['day']>; time: number; iaq: ReturnType<typeof useOperations>['iaq']; iaqError: boolean; onRetry: () => void; onClose: () => void; prefix: string
}) {
  const data = plan.rooms[room]
  const runs = mergeIntervals(data?.plan)
  const active = intervalAt(runs, time)
  const sessions = sessionsOf(day.sessions, room)
  const current = sessions.find((s) => hm(s.start) <= time && time < hm(s.end))
  const next = sessions.find((s) => hm(s.start) > time)
  const nextRun = runs.find((r) => r.s > time)
  const temp = data?.ta?.[Math.min((data?.ta?.length ?? 1) - 1, Math.floor(time / 5))]
  const iaqRoom = iaq?.rooms[room]
  const co2 = iaqRoom?.co2[Math.min(iaqRoom.co2.length - 1, Math.floor(time / (iaq?.step_min || 15)))]
  return <div className="ops-room-inspector" key={room}>
    <div className="ops-instrument-label">ROOM INSPECTOR <button type="button" aria-label="선택 강의실 해제" onClick={onClose}><X size={14} /></button></div>
    <div className="ops-room-heading"><h2>{room}<small>호</small></h2><span className={active ? 'is-on' : ''}>{active ? active.kind === 'fan' ? 'FAN' : 'ON' : 'OFF'}</span></div>
    <p className="ops-room-meaning">{active ? `${current ? '수업 중 운전' : '계획 운전'} · ${fmtMin(active.e)}까지 ON` : nextRun ? `${fmtMin(nextRun.s)} 다음 운전 시작` : '남은 운전 계획 없음'}<small>{current ? `${current.title} · ${current.start}–${current.end}` : next ? `${next.start} 다음 수업 · ${next.title}` : '남은 수업 없음'}</small></p>
    <div className="ops-room-readings"><div><span>예측 실내온도</span><strong>{Number.isFinite(temp) ? temp!.toFixed(1) : '—'}<small>℃</small></strong></div><div><span>설정온도</span><strong>{data?.sp?.toFixed(1) ?? '—'}<small>℃</small></strong></div></div>
    {data?.ta && <StudioTemperature values={data.ta} minute={time} lo={meta.settings.comfort_low} hi={meta.settings.comfort_high} />}
    <div className="ops-room-facts"><span>추정 CO₂ <b>{co2 == null ? '—' : `${Math.round(co2).toLocaleString()} ppm`}</b></span><span>하루 예상 사용량 <b>{data?.kwh == null ? '—' : `${fmtKwh(data.kwh)} kWh`}</b></span></div>
    {iaqError && <button type="button" className="ops-iaq-retry" onClick={onRetry}>공기질 조회 실패 · 다시 시도</button>}
    <Link className="ops-room-detail" to={`/classic/overview?room=${room}`}>일정·판단 근거 상세 <ArrowUpRight size={12} /></Link>
    <Link className="ops-room-detail" to={`${prefix}/plan?room=${room}&date=${day.date}`}>설정온도 협의 근거 <ArrowUpRight size={12} /></Link>
  </div>
}

function StudioTemperature({ values, minute, lo, hi }: { values: number[]; minute: number; lo: number; hi: number }) {
  const data = values.map((v, i) => ({ v, i })).filter(({ v }) => Number.isFinite(v))
  if (data.length < 2) return null
  const min = Math.min(lo - 1, ...data.map((d) => d.v))
  const max = Math.max(hi + 1, ...data.map((d) => d.v))
  const y = (v: number) => 52 - (v - min) / (max - min) * 44
  const path = data.map(({ v, i }, n) => `${n ? 'L' : 'M'}${i * 5 / 1440 * 240},${y(v)}`).join(' ')
  return <figure className="ops-temp-chart"><svg viewBox="0 0 240 60" role="img" aria-label="하루 예측 실내온도 추이"><rect x="0" y={y(hi)} width="240" height={y(lo) - y(hi)} fill="#ffffff" fillOpacity=".045" /><path d={path} fill="none" stroke="#c5d5ff" strokeWidth="1.4" /><line x1={minute / 1440 * 240} x2={minute / 1440 * 240} y1="0" y2="60" stroke="#ffffff" strokeOpacity=".5" strokeDasharray="2 3" /></svg><figcaption><span>00:00</span><span>예측 온도 · 음영 {lo}–{hi}℃</span><span>24:00</span></figcaption></figure>
}
