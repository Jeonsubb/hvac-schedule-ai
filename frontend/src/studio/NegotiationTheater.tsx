import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Play, RotateCw, SlidersHorizontal } from 'lucide-react'
import { ApiError, apiSend, invalidateAll, pollJob, useApi } from '../lib/api'
import { useDay, useMeta } from '../lib/context'
import type { AgentTurn, Day, Meta, NegCompare, Negotiation, NegotiationJob, PlanView } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, hm } from '../lib/format'
import { changedLabel, intervalAt, NEG_STATE, samePlan, signed } from '../lib/plans'
import DayTimeline from '../components/DayTimeline'
import { NegotiationAdjustments, NegotiationEvidence } from '../components/AgentOptimize'
import { ErrorBox, PageSkeleton, Spinner } from '../components/ui'
import './negotiation.css'

type TheaterView = 'stage' | 'result'

/** The theater is a new presentation of the existing daily negotiation contract.
 * Only server-provided turns are shown, and a result reveal always reads the stored full-day PlanViews.
 */
export default function NegotiationTheater() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const dayContext = useDay()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const linked = params.get('date')
  const validLink = linked && /^\d{4}-\d{2}-\d{2}$/.test(linked) ? linked : null
  const date = validLink ?? dayContext.date
  const prefix = location.pathname.startsWith('/studio') ? '/studio' : ''
  const dayQ = useApi<Day>(date ? `/api/day/${date}` : null, { maxAgeMs: 0 })
  const cmpQ = useApi<NegCompare>(date ? `/api/negotiate/compare?date=${date}` : null, { maxAgeMs: 0 })
  const cmp = cmpQ.data?.date === date ? cmpQ.data : undefined
  const day = dayQ.data?.date === date ? dayQ.data : undefined
  const hasRecord = !!cmp && cmp.state !== 'none'
  const latestQ = useApi<Negotiation>(date && hasRecord ? `/api/negotiate/latest?tier=3&date=${date}` : null, { maxAgeMs: 0 })
  const record = latestQ.data?.date === date && latestQ.data?.created_at === cmp?.created_at ? latestQ.data : undefined
  const [view, setView] = useState<TheaterView>('stage')
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [liveTurns, setLiveTurns] = useState<AgentTurn[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [finishedAt, setFinishedAt] = useState<string | null>(null)
  const [round, setRound] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!validLink) return
    dayContext.setDate(validLink)
    const next = new URLSearchParams(params)
    next.delete('date')
    setParams(next, { replace: true })
    // This is a one-time deep-link handoff to the shared date selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLink])

  useEffect(() => {
    abort.current?.abort()
    setRunning(false)
    setPhase(null)
    setLiveTurns([])
    setFinishedAt(null)
    setRound(null)
    setError(null)
    setView('stage')
  }, [date])
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const run = useCallback(async () => {
    if (!date || running) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setRunning(true)
    setView('stage')
    setError(null)
    setPhase(null)
    setLiveTurns([])
    setRound(null)
    setFinishedAt(null)
    try {
      const request = await apiSend<{ job: string }>('POST', '/api/negotiate', { tier: 3, date })
      if (!request?.job) throw new Error('협의 작업을 시작하지 못했습니다.')
      const job = await pollJob<Negotiation>(request.job, (j) => {
        if (controller.signal.aborted) return
        const progress = (j as unknown as NegotiationJob).progress
        if (Array.isArray(progress?.turns)) setLiveTurns(progress.turns)
        if (progress?.phase) setPhase(progress.phase)
      }, { intervalMs: 1200, timeoutMs: 300_000, signal: controller.signal })
      if (controller.signal.aborted) return
      if (job.status === 'error' || !job.result) throw new Error(job.error || '협의를 끝내지 못했습니다.')
      setFinishedAt(job.result.created_at)
      invalidateAll()
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message)
    } finally {
      if (!controller.signal.aborted) { setRunning(false); setPhase(null) }
    }
  }, [date, running])

  const awaitingResult = !!finishedAt && cmp?.created_at !== finishedAt
  useEffect(() => {
    if (!finishedAt || awaitingResult || running) return
    setView('result')
    const frame = requestAnimationFrame(() => {
      const result = resultRef.current
      result?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
      result?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [finishedAt, awaitingResult, running])

  const rawTurns = running ? liveTurns : record?.turns
  const turns = Array.isArray(rawTurns) ? rawTurns : []
  const rounds = useMemo(() => [...new Set(turns.filter((t) => t.agent !== 'arbiter').map((t) => t.round))].sort((a, b) => a - b), [turns])
  const selectedRound = round && rounds.includes(round) ? round : rounds.at(-1) ?? null
  const building = turns.findLast((t) => t.agent === 'building' && t.round === selectedRound)
  const occupant = turns.findLast((t) => t.agent === 'occupant' && t.round === selectedRound)
  const stored = !running && record
  const roundIndex = selectedRound == null ? -1 : rounds.indexOf(selectedRound)

  if (metaError && !meta) return <ErrorBox error={metaError} onRetry={reloadMeta} />
  if (dayQ.error && !day) return <ErrorBox title="운전계획을 불러오지 못했습니다" error={dayQ.error} onRetry={dayQ.reload} />
  if (!date || !meta || !day) return <PageSkeleton label="협의 무대와 운전계획을 준비하는 중…" />
  const noClass = day.sessions.length === 0
  const state = cmp ? NEG_STATE[cmp.state]?.label ?? '협의 기록 없음' : cmpQ.error ? '상태 확인 실패' : '상태 확인 중'

  return (
    <div className="neg-theater">
      <section className="neg-prologue" aria-labelledby="neg-heading">
        <div className="neg-eyebrow"><span className="neg-square" /> DECISION THEATER <span>02 / ON:D</span></div>
        <div className="neg-prologue-grid">
          <div>
            <h1 id="neg-heading">비용과 쾌적,<br /><span>그 사이의 합의.</span></h1>
            <p className="neg-intro">같은 건물을 바라보는 두 가지 관점.<br />설정온도를 협의하고, 물리 엔진으로 그 차이를 확인합니다.</p>
          </div>
          <div className="neg-command">
            <span className="neg-date">{fmtDateK(date)} <span>하루 계획 · 시뮬레이션</span></span>
            <button className="neg-run" type="button" onClick={run} disabled={running || noClass || awaitingResult}>
              {running ? <Spinner size={18} /> : <Play size={17} fill="currentColor" aria-hidden />}
              {running ? '협의 요청 진행 중' : awaitingResult ? '비교 결과 갱신 중' : hasRecord ? 'AI 다시 협의' : 'AI 협의 실행'}
              {!running && !awaitingResult && <ArrowUpRight size={20} aria-hidden />}
            </button>
            <p>{cmp?.mode === 'auto' ? '자동 반영 모드 · 0.5℃ 초과 변경은 승인 후 적용' : cmp?.mode === 'recommend' ? '추천 모드 · 승인 전에는 운영계획을 바꾸지 않습니다' : '운영 모드를 확인한 뒤 협의 상태를 표시합니다.'}</p>
          </div>
        </div>
        <div className="neg-mode-row">
          <div className="neg-switch" role="group" aria-label="협의 화면">
            <button type="button" aria-pressed={view === 'stage'} onClick={() => setView('stage')}>협의 무대 <span>01</span></button>
            <button type="button" aria-pressed={view === 'result'} onClick={() => setView('result')}>결과 비교 <span>02</span></button>
          </div>
          <span className="neg-state"><i />{state}</span>
        </div>
      </section>

      {error && <div className="neg-error" role="alert"><strong>협의를 끝내지 못했습니다.</strong><span>{error}</span><button type="button" onClick={run}><RotateCw size={14} /> 다시 요청</button></div>}
      {noClass && <div className="neg-notice">선택 날짜에는 등록된 수업이 없습니다. 상단에서 수업이 있는 날짜를 선택하세요.</div>}
      {cmpQ.error && <div className="neg-notice" role="alert">협의 상태를 새로 받지 못했습니다. <button type="button" onClick={cmpQ.reload}>다시 조회</button></div>}

      {view === 'stage' ? (
        <section className="neg-stage" aria-label="두 Agent 협의 무대">
          <div className="neg-stage-caption"><span>{running ? 'LIVE REQUEST' : stored ? 'RECORDED SESSION' : 'SETPOINT NEGOTIATION'}</span><span>{running ? `경과 ${elapsed}초` : cmp?.created_at ? `저장 ${cmp.created_at.slice(5, 16).replace('T', ' ')}` : '실제 응답을 기다립니다'}</span></div>
          <div className="neg-agents">
            <AgentStage kind="building" turn={building} round={selectedRound} season={record?.season ?? cmp?.season ?? 'heat'} running={running} />
            <div className="neg-convergence" aria-hidden="true"><svg viewBox="0 0 140 160"><path d="M0 26 C95 26 42 120 70 120 M140 26 C45 26 98 120 70 120 M70 120 V160" /><circle cx="70" cy="120" r="5" /></svg><span>COMMON<br />GROUND</span></div>
            <AgentStage kind="occupant" turn={occupant} round={selectedRound} season={record?.season ?? cmp?.season ?? 'heat'} running={running} />
          </div>
          {running && <div className="neg-request" role="status" aria-live="polite"><span className="neg-request-line" /><Spinner size={15} /><span>{phase ? phase.replaceAll('관리자 온디', '비용 Agent').replaceAll('사용자 온디', '쾌적 Agent') : '서버에 협의를 요청했습니다. Bedrock 응답을 기다립니다.'}</span><span>가상 진행률을 표시하지 않습니다</span></div>}
          {awaitingResult && !running && <div className="neg-request" role="status"><Spinner size={15} /> 협의가 완료되어 서버의 저장된 비교 자료를 다시 조회하고 있습니다.</div>}
          <div className="neg-round-control">
            <div><span className="neg-label">{running ? '수신한 실제 라운드' : '저장된 실제 라운드'}</span><strong>{selectedRound == null ? '기록 대기' : `ROUND ${String(selectedRound).padStart(2, '0')}`}</strong></div>
            <div className="neg-round-buttons" role="group" aria-label="협의 라운드 선택">
              <button type="button" onClick={() => setRound(rounds[roundIndex - 1])} disabled={roundIndex <= 0} aria-label="이전 협의 라운드"><ChevronLeft size={18} /></button>
              {rounds.map((r) => <button key={r} type="button" aria-pressed={selectedRound === r} onClick={() => setRound(r)}>{String(r).padStart(2, '0')}</button>)}
              <button type="button" onClick={() => setRound(rounds[roundIndex + 1])} disabled={roundIndex < 0 || roundIndex >= rounds.length - 1} aria-label="다음 협의 라운드"><ChevronRight size={18} /></button>
            </div>
            <button className="neg-result-link" type="button" onClick={() => setView('result')}>검증된 결과 보기 <ArrowRight size={16} aria-hidden /></button>
          </div>
          {hasRecord && !running && !record && <p className="neg-record-note" role={latestQ.error && !(latestQ.error instanceof ApiError && latestQ.error.status === 404) ? 'alert' : 'status'}>{latestQ.error ? '이 기록의 라운드 상세를 불러오지 못했습니다.' : '같은 버전의 협의 라운드를 확인하고 있습니다.'} <button type="button" onClick={latestQ.reload}>다시 조회</button></p>}
          {cmp?.ai === false && !running && <p className="neg-record-note">이 기록은 Bedrock 응답이 아닌 규칙 기반 대체 실행입니다.</p>}
          <p className="neg-stage-footnote">두 Agent는 설정온도를 협의합니다. 냉난방 ON/OFF 시각은 물리 계산 엔진이 다시 계산합니다.</p>
        </section>
      ) : (
        <ResultReveal cmp={cmp} day={day} meta={meta} resultRef={resultRef} justRan={!!finishedAt && cmp?.created_at === finishedAt} />
      )}

      <section className="neg-basis" aria-label="엔진 효과와 협의 효과 구분">
        <span className="neg-label">TWO DIFFERENT COMPARISONS</span>
        <div><b>01</b><strong>고정 운전 → 기본 예측 제어</strong><p>시간표와 날씨를 이용한 물리 엔진의 효과입니다.</p></div>
        <div><b>02</b><strong>기본 예측 → 협의 설정온도</strong><p>두 Agent 협의의 추가 효과입니다. 결과 비교에는 이 차이만 표시합니다.</p></div>
        <Link to="/classic/plan?view=tiers">기존 단계별 계획 검증 <ArrowUpRight size={15} aria-hidden /></Link>
      </section>
      <Link className="neg-back" to={`${prefix}/overview`}>Operations Studio로 돌아가기 <ArrowUpRight size={15} aria-hidden /></Link>
    </div>
  )
}

function AgentStage({ kind, turn, round, season, running }: { kind: 'building' | 'occupant'; turn: AgentTurn | undefined; round: number | null; season: 'heat' | 'cool'; running: boolean }) {
  const cost = kind === 'building'
  const sp = season === 'heat' ? 'sp_heat' : 'sp_cool'
  const proposals = Object.entries(turn?.proposal ?? {}).filter(([, v]) => v[sp] != null)
  return (
    <article className={cx('neg-agent', cost ? 'neg-agent-cost' : 'neg-agent-comfort')} aria-label={cost ? '비용 Agent 북항이' : '쾌적 Agent'}>
      <div className="neg-agent-role"><span>{cost ? '01 / COST INTELLIGENCE' : '02 / COMFORT INTELLIGENCE'}</span><span>{cost ? '북항이' : '쾌적 Agent'}</span></div>
      <div className="neg-agent-identity">
        <AgentSymbol cost={cost} />
        <h2>{cost ? <>낮추는<br /><em>에너지.</em></> : <>지키는<br /><em>쾌적함.</em></>}</h2>
      </div>
      <p className="neg-agent-goal">{cost ? '전기요금·전력 최소화' : '수업 중 쾌적성 확보'}<span>{cost ? '같은 조건에서 더 적게 쓰는 설정온도를 제안합니다.' : 'PMV·이용자 의견을 보고 제안 온도를 검토합니다.'}</span></p>
      <div className="neg-turn" key={`${kind}-${round}-${turn?.stance ?? ''}`}>
        <span className="neg-label">{turn ? `ROUND ${String(turn.round).padStart(2, '0')} / ACTUAL RESPONSE` : running ? 'REQUEST IN PROGRESS' : 'ACTUAL PROPOSAL'}</span>
        {turn ? <><h3>{turn.stance || '설정온도 제안'}</h3><div className="neg-proposals">{proposals.map(([room, v]) => <span key={room}><small>{room}호</small><strong>{v[sp]!.toFixed(1)}<i>°</i></strong></span>)}</div>{!proposals.length && <p className="neg-await">이 응답에는 설정온도 제안이 없습니다.</p>}<div className="neg-turn-metrics">{turn.eval && <><span>엔진 검증 <b>{fmtKwh(turn.eval.kwh)} kWh</b></span><span>평균 PMV <b>{turn.eval.pmv_mean == null ? '—' : signed(turn.eval.pmv_mean, 2)}</b></span></>}</div><details className="neg-turn-evidence"><summary>이 제안의 근거</summary><p>{turn.message}</p>{turn.trace?.map((trace, i) => <p key={i}><b>{trace.query}</b><br />{trace.finding}</p>)}</details></> : <div className="neg-await"><span className="neg-empty-dash">—</span><p>{running ? '서버가 이 Agent의 응답을 보내면 이곳에 표시됩니다.' : '저장된 라운드가 있으면 실제 제안 설정온도를 표시합니다.'}</p></div>}
      </div>
    </article>
  )
}

function AgentSymbol({ cost }: { cost: boolean }) {
  return <svg className="neg-symbol" viewBox="0 0 144 144" aria-hidden="true">{cost ? <><path d="M18 105 72 20 126 105Z" /><path d="M32 95 72 34 112 95Z" /><path d="M46 85 72 48 98 85Z" /><path d="M18 105h108M72 20v100M36 76l72 0" /><circle cx="72" cy="84" r="8" /></> : <><circle cx="72" cy="72" r="49" /><circle cx="72" cy="72" r="31" /><circle cx="72" cy="72" r="12" /><path d="M14 72h116M72 14v116M30 30l84 84M30 114l84-84" /><circle cx="72" cy="23" r="5" /><circle cx="121" cy="72" r="5" /><circle cx="72" cy="121" r="5" /><circle cx="23" cy="72" r="5" /></>}</svg>
}

function ResultReveal({ cmp, day, meta, resultRef, justRan }: { cmp: NegCompare | undefined; day: Day; meta: Meta; resultRef: React.RefObject<HTMLElement | null>; justRan: boolean }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [minute, setMinute] = useState<number | null>(null)
  const [show, setShow] = useState<'after' | 'before'>('after')
  const [evidence, setEvidence] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => { setMinute(null); setSelected(null); setRevealed(false); setEvidence(false) }, [cmp?.date, cmp?.created_at])
  useEffect(() => { const frame = requestAnimationFrame(() => setRevealed(true)); return () => cancelAnimationFrame(frame) }, [cmp?.date, cmp?.created_at])
  const rooms = Object.keys(meta.rooms).sort((a, b) => (ROOM_ORDER.indexOf(a) < 0 ? 99 : ROOM_ORDER.indexOf(a)) - (ROOM_ORDER.indexOf(b) < 0 ? 99 : ROOM_ORDER.indexOf(b)) || a.localeCompare(b))
  const before = cmp?.before
  const after = cmp?.after
  const comparable = cmp?.same_conditions === true && !!before && !!after
  const delta = comparable ? after.kwh - before.kwh : null
  const intervals = [before, after].flatMap((p) => Object.values(p?.rooms ?? {}).flatMap((r) => r.plan))
  const start = Math.floor(Math.min(360, ...intervals.map((iv) => iv.s), ...day.sessions.map((s) => hm(s.start))) / 60) * 60
  const end = Math.min(1440, Math.ceil(Math.max(1320, ...intervals.map((iv) => iv.e), ...day.sessions.map((s) => hm(s.end))) / 60) * 60)
  const m = Math.max(start, Math.min(end, minute ?? (day.sessions.length ? Math.min(...day.sessions.map((s) => hm(s.start))) + 30 : 630)))
  const changed = comparable ? rooms.filter((r) => !samePlan(before.rooms[r]?.plan, after.rooms[r]?.plan)) : []
  const max = Math.max(before?.kwh ?? 0, after?.kwh ?? 0) * 1.06
  const st = cmp ? NEG_STATE[cmp.state]?.label ?? '협의 기록 없음' : '협의 기록 확인 중'
  return (
    <section ref={resultRef} tabIndex={-1} className={cx('neg-reveal', revealed && 'is-revealed')} aria-labelledby="neg-result-title">
      <div className="neg-reveal-top"><span className="neg-label">RESULT / SAME-DAY SIMULATION</span><span>{justRan ? '방금 완료한 협의' : '저장된 협의 결과'} · {st}</span></div>
      <div className="neg-reveal-title"><h2 id="neg-result-title">설정온도가 바꾼<br /><span>운영의 차이.</span></h2><p>{cmp?.state === 'applied' ? '적용된 협의안의 하루 예상 효과' : '미적용 추천안의 하루 예상 효과'}<span className={cx('neg-delta', delta != null && delta > 0 && 'is-increase')}>{delta == null ? '—' : signed(delta, 2)}<small>kWh</small></span></p></div>
      {!cmp || cmp.state === 'none' ? <div className="neg-no-result">아직 이 날짜의 협의 결과가 없습니다. 협의 무대에서 실제 AI 협의를 실행하면 검증된 전후 비교를 볼 수 있습니다.</div> : !comparable ? <div className="neg-no-result">{cmp.same_conditions === false ? `협의 이후 ${changedLabel(cmp)}이(가) 바뀌었습니다. 이전 기록을 현재 계획의 효과로 표시하지 않습니다.` : '동일 조건의 협의 전후 계획을 확인할 수 없습니다. AI 협의를 다시 실행하면 비교 자료가 저장됩니다.'}</div> : <>
        <div className="neg-comparison">
          <div className="neg-energy-chart" aria-label="협의 전후 예상 에너지 비교">
            <div><span className="neg-label">ENERGY / kWh</span><span>같은 시간표 · 날씨 · 초기 조건</span></div>
            <EnergyBar label="협의 전" value={before.kwh} max={max} before revealed={revealed} />
            <EnergyBar label="협의 후" value={after.kwh} max={max} revealed={revealed} increase={delta! > 0} />
            <p>고정 운전 대비 엔진 절감 효과를 포함하지 않는, 설정온도 협의의 추가 변화입니다.</p>
          </div>
          <div className="neg-comfort-chart">
            <span className="neg-label">COMFORT / 수업 시간 기준</span>
            <div className="neg-comfort-pair"><span>쾌적 범위 이탈시간</span><strong>{before.out_band_min}<i>→</i>{after.out_band_min}<small>분</small></strong></div>
            <div className="neg-comfort-pair"><span>평균 예측 PMV</span><strong>{before.pmv_mean == null ? '—' : signed(before.pmv_mean, 2)}<i>→</i>{after.pmv_mean == null ? '—' : signed(after.pmv_mean, 2)}</strong></div>
            <p>PMV는 0에 가까울수록 중립입니다. 실내온도·에너지·PMV는 모두 시뮬레이션 값입니다.</p>
          </div>
        </div>
        <div className="neg-setpoint-section">
          <div><span className="neg-label">POLICY SHIFT</span><h3>{cmp.key === 'sp_cool' ? '냉방' : '난방'} 설정온도</h3></div>
          <div className="neg-setpoint-strip">{rooms.filter((r) => before.rooms[r] && after.rooms[r] && (before.rooms[r].class_min > 0 || after.rooms[r].class_min > 0)).map((room) => {
            const key = cmp.key ?? 'sp_heat'
            const b = before.rooms[room][key]
            const a = after.rooms[room][key]
            const changed = Math.abs(b - a) > .01
            return <button key={room} type="button" className={cx('neg-setpoint', selected === room && 'is-selected', !changed && 'is-unchanged')} onClick={() => setSelected(room)} aria-pressed={selected === room}><span>{room}호</span><strong>{b.toFixed(1)}<ArrowRight size={12} aria-hidden /><b>{a.toFixed(1)}<small>℃</small></b></strong><em>{changed ? a > b ? '온도 상향' : '온도 하향' : '유지'}</em></button>
          })}</div>
        </div>
        <div className="neg-result-timeline">
          <div className="neg-timeline-heading"><div><span className="neg-label">ENGINE RESPONSE</span><h3>실제 달라진 운전 구간.</h3><p>{changed.length ? `${changed.map((r) => `${r}호`).join(' · ')}에서 ON/OFF 시각이 바뀌었습니다.` : '설정온도 협의 후 ON/OFF 시각 변화가 없습니다.'}</p></div><div className="neg-timeline-switch" role="group" aria-label="비교 타임라인 주 계획"><button type="button" aria-pressed={show === 'before'} onClick={() => setShow('before')}>협의 전</button><button type="button" aria-pressed={show === 'after'} onClick={() => setShow('after')}>협의 후</button></div></div>
          <DayTimeline rooms={rooms} sessions={day.sessions} plan={planMap(show === 'after' ? after : before)} planLabel={show === 'after' ? '협의 후' : '협의 전'} compare={{ plan: planMap(show === 'after' ? before : after), label: show === 'after' ? '협의 전' : '협의 후' }} range={[start, end]} minute={m} onMinute={setMinute} selected={selected} onSelect={setSelected} />
          {selected && <div className="neg-selected-result"><strong>{selected}호 · {fmtMin(m)}</strong><span>계획 {intervalAt(before.rooms[selected]?.plan, m) ? 'ON' : 'OFF'} <ArrowRight size={12} aria-hidden /> {intervalAt(after.rooms[selected]?.plan, m) ? 'ON' : 'OFF'}</span><span>선택 시각 예측 실내온도 {before.rooms[selected]?.ta?.[Math.min(287, Math.floor(m / 5))]?.toFixed(1) ?? '—'} → {after.rooms[selected]?.ta?.[Math.min(287, Math.floor(m / 5))]?.toFixed(1) ?? '—'}℃</span></div>}
        </div>
      </>}
      {cmp && cmp.state !== 'none' && <><div className="neg-decisions"><NegotiationAdjustments cmp={cmp} stale={cmp.same_conditions !== true} onChanged={invalidateAll} /></div><div id="evidence" className="neg-evidence"><button type="button" onClick={() => setEvidence(!evidence)} aria-expanded={evidence}><SlidersHorizontal size={16} aria-hidden /> 데이터 출처와 협의 원문 <ArrowDown size={16} className={evidence ? 'rotate-180' : ''} aria-hidden /></button>{evidence && <NegotiationEvidence cmp={cmp} />}</div></>}
    </section>
  )
}

function EnergyBar({ label, value, max, before = false, increase = false, revealed }: { label: string; value: number; max: number; before?: boolean; increase?: boolean; revealed: boolean }) {
  return <div className={cx('neg-energy-row', before && 'is-before', increase && 'is-increase')}><span>{label}</span><div className="neg-energy-track"><span style={{ '--bar-scale': max > 0 ? value / max : 0, transform: `scaleX(${revealed && max > 0 ? value / max : 0})` } as CSSProperties} /></div><strong>{fmtKwh(value)}<small>kWh</small></strong></div>
}

function planMap(view: PlanView) { return Object.fromEntries(Object.entries(view.rooms).map(([room, value]) => [room, value.plan])) }
