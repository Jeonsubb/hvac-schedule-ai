import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Play, RotateCw, TriangleAlert, X } from 'lucide-react'
import { ApiError, apiGet, apiSend, invalidateAll, pollJob, useApi } from '../lib/api'
import type { AgentTurn, Day, Meta, NegAdjustment, NegCompare, Negotiation, NegotiationJob, OpMode, PlanView } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, hm } from '../lib/format'
import { NEG_STATE, changedLabel, mergeIntervals, samePlan, signed } from '../lib/plans'
import EChart, { axisCommon, type EChartsOption } from './EChart'
import DayTimeline from './DayTimeline'
import { DebateEvidence } from './AgentDebate'
import { Badge, Button, Disclosure, DisclosureList, ErrorBox, Note, Skeleton, Spinner, btnCls, toast, More, HeadMore } from './ui'

/**
 * AI 최적화: the day's base plan, one button that runs the real two-agent negotiation, and — as soon as the
 * job is stored — the before/after of the same day (same timetable, weather, initial state): energy, comfort,
 * ON/OFF runs. The agents negotiate setpoints only; the physics engine recomputes when to switch on and off.
 */

const INK = '#0c0e13'
const BRAND = '#2f6fde'
const GREY = '#a3a8b1'

export default function AgentOptimize({ date, meta }: { date: string; meta: Meta }) {
  const dayQ = useApi<Day>(`/api/day/${date}`)
  const cmpQ = useApi<NegCompare>(`/api/negotiate/compare?date=${date}`, { maxAgeMs: 5_000 })
  const modeQ = useApi<OpMode>('/api/mode', { maxAgeMs: 20_000 })
  const D = dayQ.data?.date === date ? dayQ.data : undefined
  const cmp = cmpQ.data?.date === date ? cmpQ.data : undefined

  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [liveTurns, setLiveTurns] = useState<AgentTurn[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** created_at of the negotiation finished in this visit: older records are labelled as earlier runs */
  const [ranAt, setRanAt] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLElement | null>(null)
  const scrollTo = useRef<string | null>(null)

  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => {
    setError(null)
    setRanAt(null)
    setLiveTurns([])
  }, [date])
  useEffect(() => {
    if (!running) return
    const t0 = Date.now()
    setElapsed(0)
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const start = useCallback(async () => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setRunning(true)
    setError(null)
    setLiveTurns([])
    setPhase(null)
    try {
      const r = await apiSend<{ job: string }>('POST', '/api/negotiate', { tier: 3, date })
      if (!r?.job) throw new Error('협의 작업을 시작하지 못했습니다.')
      const job = await pollJob<Negotiation>(
        r.job,
        (j) => {
          const p = (j as unknown as NegotiationJob).progress
          if (Array.isArray(p?.turns)) setLiveTurns(p!.turns as AgentTurn[])
          if (p?.phase) setPhase(p.phase)
        },
        { intervalMs: 1200, timeoutMs: 300_000, signal: ac.signal },
      )
      if (job.status === 'error' || !job.result) throw new Error(job.error || '협의가 끝나지 않았습니다.')
      // the result is stored: re-read it from the server (comparison, adjustments, the day itself)
      setRanAt(job.result.created_at)
      scrollTo.current = job.result.created_at
      invalidateAll()
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message)
    } finally {
      if (!ac.signal.aborted) {
        setRunning(false)
        setPhase(null)
      }
    }
  }, [date])

  // once the refetched comparison is the one just computed, bring the result into view
  useEffect(() => {
    if (cmp?.created_at && scrollTo.current && cmp.created_at === scrollTo.current && !running) {
      scrollTo.current = null
      const el = resultRef.current
      if (el) {
        el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
        el.focus({ preventScroll: true })
      }
    }
  }, [cmp?.created_at, running])

  if (dayQ.error && !D) return <ErrorBox title="이 날짜의 기본 운전계획을 불러오지 못했습니다" error={dayQ.error} onRetry={dayQ.reload} />
  if (!D) return <Skeleton className="h-[320px]" />

  const mode = modeQ.data?.mode ?? cmp?.mode
  const noClass = D.sessions.length === 0
  const events = D.sessions.filter((s) => s.kind === 'event')
  const fx = D.strategies.fixed
  const ai = D.strategies.ai
  const has = !!cmp && cmp.state !== 'none'

  return (
    <div className="space-y-5">
      {/* 1. the base plan the negotiation starts from */}
      <section className="rounded-[16px] border border-line bg-surface p-6" aria-labelledby="opt-base">
        <StepTitle n={1} id="opt-base" title="협의 전 기본 운전계획" sub={`${fmtDateK(date)} · 물리 계산 엔진이 시간표와 예보로 만든 계획입니다 (시뮬레이션)`} />
        <dl className="tnum mt-4 grid grid-cols-2 gap-x-8 gap-y-3 text-[13.5px] lg:grid-cols-4">
          <Fact k="수업 일정" v={noClass ? '없음' : `${D.sessions.length}건${events.length ? ` (특별 일정 ${events.length}건 포함)` : ''}`} />
          <Fact k="기상 자료" v={D.weather.src_forecast} />
          <Fact k="운전 모드" v={mode === 'auto' ? '자동 운전' : mode === 'recommend' ? '추천 모드' : '—'} />
          <Fact k="AI 협의 적용 상태" v={has ? (NEG_STATE[cmp!.state]?.label ?? '—') : '협의 기록 없음'} />
        </dl>
        {fx && ai ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[13.5px] font-semibold text-ink">첫 번째 비교 · 고정 스케줄 vs 기본 예측 제어</div>
            <More className="mt-0.5"><p>물리 계산 엔진의 효과입니다. AI Agent 협의와는 별개이며, 같은 시간표·날씨·초기 조건으로 계산했습니다.</p></More>
            <div className="mt-3 space-y-2">
              <HBar label={`고정 스케줄 (${meta.settings.fixed_on}~${meta.settings.fixed_off} 일괄)`} kwh={fx.kwh} max={Math.max(fx.kwh, ai.kwh)} color={GREY} comfort={fx.comfort_pct} />
              <HBar label={`기본 예측 제어${cmp?.state === 'applied' ? ' (AI 협의 설정온도 적용 중)' : ''}`} kwh={ai.kwh} max={Math.max(fx.kwh, ai.kwh)} color={INK} comfort={ai.comfort_pct} />
            </div>
            <p className="tnum mt-2 text-[13px] text-ink-2">
              {fx.kwh > 0 ? `예상 소비량 ${signed(ai.kwh - fx.kwh, 1)} kWh (${signed(((ai.kwh - fx.kwh) / fx.kwh) * 100, 1)}%)` : '고정 스케줄 운전이 없는 날입니다'} · 하루 전체 · 시뮬레이션
            </p>
          </div>
        ) : (
          <p className="mt-4 text-[13.5px] text-ink-3">이 날짜의 기준 전략 계산 결과가 없습니다.</p>
        )}
      </section>

      {/* 2. the one button that calls Bedrock */}
      <section className="rounded-[16px] border border-line bg-surface p-6" aria-labelledby="opt-run">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <StepTitle
            n={2}
            id="opt-run"
            title="비용·쾌적 두 Agent 협의"
            sub="비용 Agent와 쾌적 Agent가 Bedrock으로 강의실별 설정온도를 협의합니다(최대 2라운드). 제안마다 물리 시뮬레이터가 검증하고, 최종 판정은 정해진 규칙이 내립니다."
          />
          <button
            type="button"
            onClick={start}
            disabled={running || noClass}
            className="ond-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[8px] px-4 text-[14px] font-bold text-white hover:bg-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: BRAND }}
          >
            {running ? <Spinner size={15} className="text-white" /> : has ? <RotateCw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {running ? '협의 실행 중…' : has ? '비용·쾌적 Agent 다시 협의' : '비용·쾌적 Agent 협의 실행'}
          </button>
        </div>
        <More label="실행 조건" className="mt-3"><p>
          실행 대상: {fmtDateK(date)} 하루 · 협의 대상은 설정온도뿐이며 켜고 끄는 시각은 엔진이 다시 계산합니다 · 다시 협의하면 이전 협의안 위에 쌓이지 않고 새 결과로 바뀝니다 · 설정온도는 쾌적 범위 아래로 내려가지 않습니다 ·{' '}
          {mode === 'auto'
            ? '자동 운전 모드: 0.5℃ 이내 변경은 바로 적용되고, 그보다 큰 변경은 승인을 기다립니다.'
            : '추천 모드: 결과는 승인 대기 추천안으로만 저장되고, 승인하기 전에는 운영계획이 바뀌지 않습니다.'}
        </p></More>
        {noClass && <Note tone="warn">이 날짜에는 수업이 없어 협의할 대상이 없습니다. 상단에서 수업이 있는 평일을 고르세요.</Note>}
        {running && (
          <div className="mt-4 rounded-[12px] bg-well px-4 py-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink">
              <Spinner size={14} />
              <span className="font-semibold">{phase ? progressLabel(phase) : 'Bedrock 협의 실행 중'}</span>
              <span className="tnum text-ink-3">경과 {elapsed}초 · 보통 1분 안팎 걸립니다</span>
            </div>
            {liveTurns.length > 0 && (
              <ol className="mt-2 space-y-1 text-[13px] text-ink-2">
                {liveTurns.map((t, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Check size={13} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
                    <span>
                      {t.round}라운드 {t.agent === 'building' ? '비용 Agent 제안' : t.agent === 'occupant' ? '쾌적 Agent 검토' : '판정'} 완료
                      {t.eval ? ` · 시뮬레이터 검증 ${t.eval.kwh.toFixed(1)} kWh` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {error && !running && (
          <div className="mt-4">
            <ErrorBox title="협의를 끝내지 못했습니다. 운영계획은 바뀌지 않았습니다." error={error} onRetry={start} />
          </div>
        )}
      </section>

      {/* 3. the result of the stored negotiation */}
      {cmpQ.error && !cmp ? (
        <ErrorBox title="협의 기록을 불러오지 못했습니다" error={cmpQ.error} onRetry={cmpQ.reload} />
      ) : !cmp ? (
        <Skeleton className="h-[120px]" />
      ) : !has ? (
        <section className="rounded-[16px] border border-dashed border-line-strong bg-surface p-6 text-[13.5px] text-ink-3">
          <StepTitle n={3} title="협의 결과" sub="아직 이 날짜의 협의 기록이 없습니다. 협의를 실행하면 같은 조건의 전후 비교가 이곳에 바로 표시됩니다." />
        </section>
      ) : (
        <Result cmp={cmp} day={D} meta={meta} justRan={!!ranAt && ranAt === cmp.created_at} sectionRef={resultRef} onChanged={() => invalidateAll()} />
      )}
    </div>
  )
}

function progressLabel(phase: string): string {
  return phase.replace('관리자 온디', '비용 Agent').replace('사용자 온디', '쾌적 Agent')
}

function StepTitle({ n, title, sub, id }: { n: number; title: string; sub?: string; id?: string }) {
  const h = (
    <h2 id={id} className="flex items-center gap-2.5 text-[17px] leading-[1.35] font-bold tracking-[-0.015em] text-ink">
      <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12.5px] font-bold text-white">{n}</span>
      {title}
    </h2>
  )
  return <div className="min-w-0 flex-1">{sub ? <HeadMore heading={h}>{sub}</HeadMore> : h}</div>
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3">{k}</dt>
      <dd className="mt-0.5 font-medium text-ink">{v}</dd>
    </div>
  )
}

function HBar({ label, kwh, max, color, comfort }: { label: string; kwh: number; max: number; color: string; comfort: number | null }) {
  return (
    <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
      <span className="truncate text-ink-2">{label}</span>
      <span className="h-3 rounded-[3px] bg-well">
        <span className="block h-3 rounded-[3px]" style={{ width: `${max > 0 ? Math.max(1, (kwh / max) * 100) : 0}%`, background: color }} />
      </span>
      <span className="tnum whitespace-nowrap text-ink">
        <b className="font-semibold">{fmtKwh(kwh)} kWh</b>
        <span className="text-ink-3"> · 쾌적 범위 {comfort != null ? `${comfort.toFixed(0)}%` : '—'}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- result

/** What changed, said as it is: no "improved" unless the numbers say so. */
function verdict(b: PlanView, a: PlanView, changedRooms: number): { text: string; tone: 'neutral' | 'warn' } {
  const dk = a.kwh - b.kwh
  const same = Math.abs(dk) < 0.05
  const pb = b.pmv_mean
  const pa = a.pmv_mean
  const dp = pb != null && pa != null ? Math.abs(pb) - Math.abs(pa) : 0 // > 0: closer to neutral
  const outUp = a.out_band_min > b.out_band_min
  if (!changedRooms || (same && Math.abs(dp) < 0.005 && !outUp)) return { text: 'AI 협의로 추가 변경 없음', tone: 'neutral' }
  const comfort = outUp ? '쾌적 범위 밖 시간 증가' : dp > 0.005 ? '쾌적 지표(PMV) 개선' : dp < -0.005 ? '쾌적 지표(PMV) 하락' : '쾌적 지표 변화 없음'
  if (same) return { text: `예상 소비량 변화 없음 · ${comfort}`, tone: 'neutral' }
  if (dk > 0) return { text: dp > 0.005 && !outUp ? '쾌적성 조건 우선으로 예상 소비량 증가' : `예상 소비량 증가 · ${comfort}`, tone: 'warn' }
  return { text: `예상 소비량 감소 · ${comfort}`, tone: dp < -0.005 || outUp ? 'warn' : 'neutral' }
}

function Result({
  cmp,
  day,
  meta,
  justRan,
  sectionRef,
  onChanged,
}: {
  cmp: NegCompare
  day: Day
  meta: Meta
  justRan: boolean
  sectionRef: React.RefObject<HTMLElement | null>
  onChanged: () => void
}) {
  const st = NEG_STATE[cmp.state] ?? NEG_STATE.pending
  const stale = cmp.same_conditions === false
  const b = cmp.before
  const a = cmp.after
  const key = cmp.key ?? 'sp_heat'
  const lab = key === 'sp_heat' ? '난방' : '냉방'
  const rooms = useMemo(() => {
    const ids = Object.keys(meta.rooms)
    return ids.sort((x, y) => ROOM_ORDER.indexOf(x) - ROOM_ORDER.indexOf(y) || x.localeCompare(y))
  }, [meta])
  const [minute, setMinute] = useState(() => (day.sessions.length ? Math.min(...day.sessions.map((s) => hm(s.start))) + 30 : 600))
  const [room, setRoom] = useState<string | null>(null)
  const [show, setShow] = useState<'after' | 'before'>('after')

  const changed = Object.entries(cmp.final_sp ?? {}).filter(([r, v]) => cmp.base_sp?.[r] != null && Math.abs((cmp.base_sp[r] as number) - v) > 0.01)
  const created = cmp.created_at ? cmp.created_at.slice(5, 16).replace('T', ' ') : ''

  return (
    <section ref={sectionRef} tabIndex={-1} className="scroll-mt-24 rounded-[16px] border border-line bg-surface p-6 outline-none" aria-labelledby="opt-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <StepTitle n={3} id="opt-result" title="협의 결과 · AI 협의 설정온도를 반영한 운전계획" sub={`${fmtDateK(cmp.date)} · 협의 전과 후를 같은 시간표·예보·초기 조건으로 계산했습니다 (시뮬레이션)`} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={cmp.ai ? 'outline' : 'warn'}>{cmp.ai ? 'Bedrock 두 Agent 협의 완료' : '규칙 기반 대체 실행 (Bedrock 응답 아님)'}</Badge>
          <Badge tone={st.tone === 'good' ? 'good' : st.tone === 'warn' ? 'warn' : 'neutral'}>{st.label}</Badge>
          <Badge tone="outline">{justRan ? `방금 실행 ${created}` : `이전 실행 기록 ${created}`}</Badge>
        </div>
      </div>

      {!cmp.ai && (
        <div className="mt-4">
          <Note tone="warn" icon={<TriangleAlert size={15} aria-hidden />}>
            Bedrock 호출이 실패해 두 Agent 대신 규칙 기반 로직이 같은 절차를 실행했습니다. 아래 수치는 같은 시뮬레이터로 검증한 값이지만 Bedrock AI 협의 결과는 아닙니다. 다시 실행해 보세요.
          </Note>
        </div>
      )}
      {stale && (
        <div className="mt-4">
          <Note tone="crit" icon={<TriangleAlert size={15} aria-hidden />}>
            이 협의 이후 {changedLabel(cmp)}이(가) 바뀌었습니다. 아래는 바뀌기 전 조건에서 계산한 기록이라 현재 운전계획과는 비교할 수 없습니다. 위 버튼으로 다시 협의하세요.
          </Note>
        </div>
      )}

      {!b || !a ? (
        <div className="mt-4">
          <Note tone="warn">이 기록에는 협의 전후 운전계획 자료가 없어 그래프를 그릴 수 없습니다(이전 버전에서 실행한 협의). 다시 협의하면 표시됩니다.</Note>
          {cmp.baseline && cmp.final && (
            <p className="tnum mt-3 text-[13.5px] text-ink-2">
              기록된 수치: 예상 소비량 {cmp.baseline.kwh.toFixed(1)} → {cmp.final.kwh.toFixed(1)} kWh, 평균 PMV {cmp.baseline.pmv_mean ?? '—'} → {cmp.final.pmv_mean ?? '—'}
            </p>
          )}
        </div>
      ) : (
        <>
          {(() => {
            const v = verdict(b, a, changed.length)
            return (
              <p className={cx('mt-4 text-[18px] leading-[1.45] font-bold tracking-[-0.015em]', v.tone === 'warn' ? 'text-warn-ink' : 'text-ink')}>
                {v.text}
                {stale && <span className="ml-2 text-[13px] font-medium text-crit-ink">(이전 조건 기준)</span>}
              </p>
            )
          })()}
          {cmp.summary && <p className="mt-1.5 max-w-[90ch] text-[13.5px] leading-[1.6] text-ink-2">{cmp.summary.replace(/현재 계획 대비/g, '협의 전 대비')}</p>}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="rounded-[12px] border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-ink">예상 소비전력 (kWh)</h3>
                <span className="tnum text-[13.5px] font-semibold text-ink">
                  {signed(a.kwh - b.kwh, 2)} kWh{b.kwh > 0 ? ` (${signed(((a.kwh - b.kwh) / b.kwh) * 100, 1)}%)` : ''}
                </span>
              </div>
              <EChart height={210} option={kwhOption(b.kwh, a.kwh)} />
              <p className="text-[12px] text-ink-3">{fmtDateK(cmp.date)} 하루 · 같은 시간표·예보·초기 조건 · 시뮬레이션 값</p>
            </div>
            <div className="rounded-[12px] border border-line p-4">
              <h3 className="text-[14px] font-semibold text-ink">쾌적성 (수업 중)</h3>
              <dl className="tnum mt-3 space-y-3 text-[13.5px]">
                <Cmp
                  k="쾌적 범위를 벗어난 수업 시간"
                  before={`${b.out_band_min}분`}
                  after={`${a.out_band_min}분`}
                  note={`수업 ${a.class_min}분 중 예측 실내온도가 ${meta.settings.comfort_low}~${meta.settings.comfort_high}℃를 벗어난 시간입니다. 운영 기준으로 보는 값입니다.`}
                />
                <Cmp
                  k="체감 지표 (PMV)"
                  before={b.pmv_mean != null ? signed(b.pmv_mean, 2) : '—'}
                  after={a.pmv_mean != null ? signed(a.pmv_mean, 2) : '—'}
                  note={
                    b.pmv_mean == null
                      ? '수업 중 PMV 산출값이 없습니다'
                      : '0에 가까울수록 쾌적합니다. 난방을 수업 때만 켜면 벽과 바닥이 차가워 같은 실내온도에서도 서늘한 쪽으로 계산됩니다. 그래서 춥다는 의견이 반복된 강의실은 쾌적 Agent가 온도를 올립니다.'
                  }
                />
                {b.pmv_mean != null && a.pmv_mean != null && <PmvScale before={b.pmv_mean} after={a.pmv_mean} />}
              </dl>
            </div>
          </div>

          {/* ON/OFF: same rooms, before under after */}
          <div className="mt-5 rounded-[12px] border border-line p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-ink">냉난방 ON/OFF 계획 변화 (엔진 계산 결과)</h3>
              <div className="inline-flex rounded-full bg-well p-1 text-[13px]" role="radiogroup" aria-label="위에 그릴 계획">
                {(['after', 'before'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={show === k}
                    onClick={() => setShow(k)}
                    className={cx('h-7 rounded-full px-3 whitespace-nowrap', show === k ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_rgb(12_14_19/0.08)]' : 'font-medium text-ink-3')}
                  >
                    {k === 'after' ? '협의 후를 위에' : '협의 전을 위에'}
                  </button>
                ))}
              </div>
            </div>
            <RunDiff rooms={rooms} b={b} a={a} />
            <div className="mt-3">
              <DayTimeline
                rooms={rooms.filter((r) => day.sessions.some((s) => s.room === r) || (a.rooms[r]?.plan.length ?? 0) > 0 || (b.rooms[r]?.plan.length ?? 0) > 0)}
                sessions={day.sessions}
                plan={Object.fromEntries(rooms.map((r) => [r, (show === 'after' ? a : b).rooms[r]?.plan ?? []]))}
                planLabel={show === 'after' ? '협의 후' : '협의 전'}
                compare={{ plan: Object.fromEntries(rooms.map((r) => [r, (show === 'after' ? b : a).rooms[r]?.plan ?? []])), label: show === 'after' ? '협의 전' : '협의 후' }}
                range={[360, 1320]}
                minute={minute}
                onMinute={setMinute}
                selected={room}
                onSelect={setRoom}
              />
            </div>
          </div>

          {/* per-room table */}
          <div className="thin-scroll mt-5 overflow-x-auto">
            <table className="tnum w-full min-w-[720px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
                  <th className="py-2 pr-3 font-medium">강의실</th>
                  <th className="py-2 pr-3 text-right font-medium">{lab} 설정온도</th>
                  <th className="py-2 pr-3 text-right font-medium">예상 kWh</th>
                  <th className="py-2 pr-3 text-right font-medium">평균 예측 PMV</th>
                  <th className="py-2 text-right font-medium">운전 구간 (협의 전 → 후)</th>
                </tr>
              </thead>
              <tbody>
                {rooms
                  .filter((r) => (b.rooms[r]?.class_min ?? 0) > 0 || (a.rooms[r]?.class_min ?? 0) > 0)
                  .map((r) => {
                    const x = b.rooms[r]
                    const y = a.rooms[r]
                    const spCh = Math.abs(x[key] - y[key]) > 0.01
                    const same = samePlan(x.plan, y.plan)
                    const fmt = (p: PlanView['rooms'][string]) =>
                      mergeIntervals(p.plan)
                        .map((iv) => `${fmtMin(iv.s)}–${fmtMin(iv.e)}`)
                        .join(', ') || '운전 없음'
                    return (
                      <tr key={r} className="border-b border-line/70 last:border-0">
                        <td className="py-2 pr-3 font-semibold text-ink">{r}호</td>
                        <td className={cx('py-2 pr-3 text-right', spCh ? 'font-semibold text-brand-ink' : 'text-ink-2')}>{spCh ? `${x[key].toFixed(1)} → ${y[key].toFixed(1)}℃` : `${x[key].toFixed(1)}℃ (유지)`}</td>
                        <td className="py-2 pr-3 text-right text-ink-2">
                          {x.kwh.toFixed(2)} → <span className="text-ink">{y.kwh.toFixed(2)}</span>
                        </td>
                        <td className="py-2 pr-3 text-right text-ink-2">
                          {x.pmv != null ? signed(x.pmv, 2) : '—'} → <span className="text-ink">{y.pmv != null ? signed(y.pmv, 2) : '—'}</span>
                        </td>
                        <td className="py-2 text-right text-ink-2">{same ? `${fmt(x)} (변화 없음)` : `${fmt(x)} → ${fmt(y)}`}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <NegotiationAdjustments cmp={cmp} stale={stale} onChanged={onChanged} />

      <div id="evidence" className="mt-5 scroll-mt-24">
        <DisclosureList title="근거" hideTitle>
          <Disclosure title="협의 근거 자세히 보기" summary={`${cmp.rounds ?? 0}라운드 · 실제 발언, 제안 온도, 확인한 자료, 재시뮬레이션 결과`} defaultOpen={typeof window !== 'undefined' && window.location.hash === '#evidence'}>
            <NegotiationEvidence cmp={cmp} />
          </Disclosure>
        </DisclosureList>
      </div>
    </section>
  )
}

function Cmp({ k, before, after, note }: { k: string; before: string; after: string; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-ink-3">{k}</dt>
        <dd className="text-[15px] font-semibold text-ink">
          <span className="font-medium text-ink-3">협의 전 </span>
          {before}
          <span className="mx-1.5 text-ink-4">→</span>
          <span className="font-medium text-ink-3">후 </span>
          {after}
        </dd>
      </div>
      {note && <div className="mt-0.5 text-[12px] text-ink-3">{note}</div>}
    </div>
  )
}

/** PMV on its own scale (−2 … +2): the recommended band shaded, before hollow, after filled. */
function PmvScale({ before, after }: { before: number; after: number }) {
  const x = (v: number) => ((Math.max(-2, Math.min(2, v)) + 2) / 4) * 100
  return (
    <div aria-hidden>
      <div className="relative mt-1 h-5">
        <span className="absolute inset-x-0 top-[9px] h-[2px] bg-line-strong" />
        <span className="absolute top-[3px] h-[14px] rounded-[3px] bg-[rgb(12_14_19/0.07)]" style={{ left: `${x(-0.5)}%`, width: `${x(0.5) - x(-0.5)}%` }} />
        <span className="absolute top-[4px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-ink-3 bg-surface" style={{ left: `${x(before)}%` }} />
        <span className="absolute top-[4px] h-3 w-3 -translate-x-1/2 rounded-full" style={{ left: `${x(after)}%`, background: BRAND }} />
      </div>
      <div className="flex justify-between text-[11.5px] text-ink-3">
        <span>−2 춥다</span>
        <span>0 쾌적</span>
        <span>+2 덥다</span>
      </div>
      <div className="mt-1 flex gap-4 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink-3" /> 협의 전
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: BRAND }} /> 협의 후
        </span>
      </div>
    </div>
  )
}

function kwhOption(before: number, after: number): EChartsOption {
  const max = Math.max(before, after)
  return {
    grid: { left: 44, right: 16, top: 26, bottom: 28 },
    xAxis: { type: 'category', data: ['협의 전', '협의 후'], ...axisCommon, axisLabel: { ...axisCommon.axisLabel, fontSize: 13, color: '#454a54' } },
    yAxis: { type: 'value', min: 0, max: Math.ceil((max * 1.18) / 5) * 5 || 5, ...axisCommon, axisLine: { show: false } },
    series: [
      {
        type: 'bar',
        barWidth: 64,
        data: [
          { value: before, itemStyle: { color: GREY, borderRadius: [4, 4, 0, 0] } },
          { value: after, itemStyle: { color: BRAND, borderRadius: [4, 4, 0, 0] } },
        ],
        label: { show: true, position: 'top', formatter: (p) => `${Number((p as { value: number }).value).toFixed(2)} kWh`, color: INK, fontSize: 13, fontWeight: 600 },
      },
    ],
  }
}

/** Which rooms start or stop at a different time, in words. */
function RunDiff({ rooms, b, a }: { rooms: string[]; b: PlanView; a: PlanView }) {
  const diff = rooms.filter((r) => !samePlan(b.rooms[r]?.plan, a.rooms[r]?.plan))
  const d = a.plan_minutes - b.plan_minutes
  if (!diff.length) return <p className="text-[13.5px] text-ink-2">운전시간 변화 없음: 설정온도가 달라져도 엔진이 계산한 켜고 끄는 시각은 그대로입니다.</p>
  return (
    <p className="tnum text-[13.5px] text-ink-2">
      켜고 끄는 시각이 달라진 강의실: {diff.map((r) => `${r}호`).join(', ')} · 전체 계획 운전시간 {b.plan_minutes}분 → {a.plan_minutes}분 ({signed(d, 0)}분). 시각은 AI가 아니라 물리 계산 엔진이 새 설정온도로 다시 계산했습니다.
    </p>
  )
}

export function NegotiationAdjustments({ cmp, stale, onChanged }: { cmp: NegCompare; stale: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const list = cmp.adjustments ?? []
  const decide = async (a: NegAdjustment, action: 'approve' | 'reject') => {
    setBusy(a.id)
    try {
      await apiSend('POST', `/api/adjustments/${encodeURIComponent(a.id)}/${action}`)
      toast(action === 'approve' ? `${a.title}: 승인해 운영계획에 반영했습니다.` : `${a.title}: 거절했습니다.`, action === 'approve' ? 'good' : 'neutral')
      onChanged()
    } catch (e) {
      toast(`처리하지 못했습니다. ${(e as Error).message}`, 'crit')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[14px] font-semibold text-ink">적용 상태</h3>
      {list.length === 0 ? (
        <p className="mt-1 text-[13.5px] text-ink-2">바꿀 설정온도가 없어 조정안을 만들지 않았습니다. 운영계획은 그대로입니다.</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-ink-3">
            {cmp.state === 'pending'
              ? '추천안 시뮬레이션입니다. 승인하기 전에는 현재 운영계획이 바뀌지 않습니다.'
              : cmp.state === 'applied'
                ? '승인되어 현재 운영계획에 반영되어 있습니다.'
                : cmp.state === 'partial'
                  ? '일부만 반영되어 있습니다. 위 그래프의 ‘협의 후’는 모든 조정안을 반영했을 때의 값입니다.'
                  : '거절되어 운영계획에 반영되지 않았습니다.'}
          </p>
          <ul className="mt-3 space-y-2">
            {list.map((a) => {
              const s = a.status === 'applied' ? { l: '적용됨', t: 'good' as const } : a.status === 'rejected' ? { l: '거절됨', t: 'neutral' as const } : { l: '승인 대기', t: 'warn' as const }
              return (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-ink">
                      {a.title.replace(' (에이전트 합의)', '')}
                      <Badge tone={s.t}>{s.l}</Badge>
                      {a.status === 'pending' && a.auto_ok === false && <Badge tone="outline">0.5℃ 초과 변경 · 자동 운전에서도 승인 필요</Badge>}
                    </div>
                    {a.decided_at && a.status !== 'pending' && (
                      <div className="tnum mt-0.5 text-[12.5px] text-ink-3">
                        {a.decided_by ? `${a.decided_by} · ` : ''}
                        {a.decided_at.slice(5, 16).replace('T', ' ')}
                      </div>
                    )}
                  </div>
                  {a.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={busy === a.id || stale} onClick={() => decide(a, 'approve')} title={stale ? '조건이 바뀌어 다시 협의해야 합니다' : undefined}>
                        {busy === a.id ? <Spinner size={13} className="text-white" /> : <Check size={14} aria-hidden />} 승인하고 적용
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => decide(a, 'reject')}>
                        <X size={14} aria-hidden /> 거절
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <div className="mt-3">
        <Link to="/overview" className={btnCls('link', 'sm')}>
          운영 현황 타임라인에서 확인
        </Link>
      </div>
    </div>
  )
}

/** The recorded negotiation itself: fetched only when the operator opens it. */
export function NegotiationEvidence({ cmp }: { cmp: NegCompare }) {
  const [neg, setNeg] = useState<Negotiation | null | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setNeg(undefined)
    setErr(null)
    apiGet<Negotiation>(`/api/negotiate/latest?tier=3&date=${cmp.date}`)
      .then((n) => alive && setNeg(n))
      .catch((e: Error) => {
        if (!alive) return
        setNeg(null)
        if (!(e instanceof ApiError && e.status === 404)) setErr(e.message)
      })
    return () => {
      alive = false
    }
  }, [cmp.date, cmp.created_at])
  const src = cmp.feedback_sources
  const prov = cmp.provenance
  return (
    <div className="space-y-5">
      <div className="rounded-[12px] bg-well px-4 py-3 text-[13px] leading-[1.65] text-ink-2">
        <div className="font-semibold text-ink">두 Agent가 본 자료의 출처</div>
        {prov ? (
          <ul className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {[
              ['시간표', prov.timetable],
              ['날씨', prov.forecast],
              ['설정온도 범위·CO₂ 기준', prov.policy],
              ['전기요금', prov.tariff],
              ['재실 인원', prov.density],
              ['CO₂', prov.co2],
              ['전력·PMV·실내온도', prov.simulator],
            ].map(([k, v]) => (
              <li key={k}>
                <span className="text-ink-3">{k}: </span>
                {v}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1">이 기록에는 출처 정보가 저장되지 않았습니다(이전 버전에서 실행한 협의).</p>
        )}
        {src && (
          <p className="mt-1.5">
            <span className="text-ink-3">재실자 의견: </span>
            {src.simulated > 0 && src.real === 0
              ? `${src.simulated}건 모두 시뮬레이션으로 만든 가상 의견입니다. 실제 학생·교수의 민원이 아닙니다.`
              : src.simulated > 0
                ? `실제 접수 ${src.real}건, 시뮬레이션으로 만든 가상 의견 ${src.simulated}건`
                : `실제 접수 ${src.real}건`}
          </p>
        )}
        <More className="mt-1.5"><p>실제 실내 센서 값은 쓰이지 않았습니다. Agent의 말과 수치가 다르면 시뮬레이터 수치를 따릅니다.</p></More>
      </div>
      {neg === undefined ? (
        <Skeleton className="h-[160px]" />
      ) : err ? (
        <Note tone="warn">협의 기록을 불러오지 못했습니다. {err}</Note>
      ) : !neg ? (
        <Note>저장된 협의 대화가 없습니다.</Note>
      ) : (
        <DebateEvidence turns={neg.turns} baseline={neg.baseline} season={neg.season} running={false} agreed={!!neg.final?.agreed} />
      )}
    </div>
  )
}
