import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Beaker, ChevronDown, FileUp, Info, Play, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { ApiError, apiGet, apiSend, pollJob } from '../lib/api'
import type { AgentTrace, Job } from '../lib/types'
import { addDays, cx, fmtDateK, fmtDateShort, fmtNum, weekdayOf } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { PublicHeader } from '../components/PublicShell'
import { AgentAvatar, AGENT_META } from '../components/Characters'
import { sourceMeta } from '../components/dataSources'
import { Button, ErrorBox, Segmented, Spinner, btnCls, inputBase, toast, ToastHost } from '../components/ui'

// ---------------------------------------------------------------- response shapes (/api/lab/*)

type LabKey = 'current' | 'rule' | 'ai' | 'agents'
const KEYS: LabKey[] = ['current', 'rule', 'ai', 'agents']

interface LabMetrics {
  kwh: number
  cost_krw: number
  peak_kw: number
  pmv_mean: number | null
  pmv_ok_pct: number | null
  discomfort_dm: number
  cold_starts: number
  kwh_by_hour?: number[]
  room_pmv?: Record<string, number | null>
}

interface LabTurn {
  round: number
  agent: 'building' | 'occupant' | 'arbiter'
  stance: string
  message: string
  trace: AgentTrace[]
  accepts?: boolean
}

interface LabDay {
  date: string
  weekday: number
  sessions: number
  t_mean: number
  measured_kwh?: number | null
  strategies: Record<LabKey, LabMetrics>
  agents: {
    setpoints: Record<string, number>
    base_sp: Record<string, number>
    key: 'sp_heat' | 'sp_cool'
    agreed: boolean
    rounds: number
    summary: string
    ai: boolean
    complaint_rooms: string[]
    in_policy: boolean
    turns: LabTurn[]
    optimum?: { setpoints: Record<string, number>; kwh: number | null; pmv_mean: number | null; comfort_won: number | null } | null
  }
}

interface Calibration {
  source: string
  granularity: 'hour' | 'day'
  start: string
  end: string
  count: number
  overlap?: number
  nmbe_pct?: number | null
  cvrmse_pct?: number | null
  threshold?: { nmbe: number; cvrmse: number }
  calibrated?: boolean
  measured_kwh?: number
  current_sim_kwh?: number
  agents_sim_kwh?: number
  saving_vs_measured_pct?: number | null
  series?: { t: string; measured: number; current: number; agents: number }[]
  note?: string
}

interface LabResult {
  params: { start: string; days: number; mode: 'rule' | 'llm' }
  dates: string[]
  labels: Record<LabKey, string>
  days: LabDay[]
  totals: Record<LabKey, LabMetrics>
  kpis: {
    saving_vs_current_pct: number | null
    saving_vs_ai_pct: number | null
    cost_saving_vs_current_krw: number
    pmv_delta_vs_ai: number | null
    agreement_rate_pct: number
    policy_compliance_pct: number
    complaint_room_days: number
    complaint_room_pmv?: Partial<Record<LabKey, number | null>>
    llm_calls: number
    seconds: number
  }
  measured: Calibration | null
  ai_used: boolean
  created_at: string
  notes: string[]
}

interface MeasuredInfo {
  source: string
  granularity: 'hour' | 'day'
  start: string
  end: string
  count: number
  uploaded_at: string
}

const COLOR: Record<LabKey | 'measured', string> = {
  current: '#565a60',
  rule: '#2a78d6',
  ai: '#14a673',
  agents: '#6250d6',
  measured: '#142033',
}

const SHORT: Record<LabKey, string> = { current: '현재 운영', rule: '규칙', ai: 'AI', agents: 'AI+에이전트' }

const fmtPmv = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`)
const fmtPctSigned = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '' : '+'}${(-v).toFixed(1)}%`)

function mondayOf(iso: string) {
  const wd = weekdayOf(iso)
  return addDays(iso, -wd)
}

function todayIso() {
  const d = new Date()
  const k = new Date(d.getTime() + 9 * 3600_000) // KST
  return k.toISOString().slice(0, 10)
}

function isLab(x: unknown): x is LabResult {
  const r = x as LabResult
  return !!r && Array.isArray(r.days) && !!r.totals && !!r.kpis
}

// ---------------------------------------------------------------- page

export default function Lab() {
  const [start, setStart] = useState(() => mondayOf(todayIso()))
  const [days, setDays] = useState(5)
  const [mode, setMode] = useState<'rule' | 'llm'>('rule')
  const [res, setRes] = useState<LabResult | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<{ phase?: string; done?: number; total?: number } | null>(null)
  const [runErr, setRunErr] = useState<string | null>(null)
  const [measured, setMeasured] = useState<MeasuredInfo | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    apiGet<LabResult>('/api/lab/last')
      .then((r) => isLab(r) && setRes(r))
      .catch((e: ApiError) => {
        if (e.status !== 404) setLoadErr(e.message)
      })
    apiGet<MeasuredInfo | null>('/api/lab/measured')
      .then((m) => setMeasured(m && m.count ? m : null))
      .catch(() => {})
    return () => abort.current?.abort()
  }, [])

  const maxDays = mode === 'llm' ? 3 : 10
  const nDays = Math.min(days, maxDays)

  async function run() {
    setRunErr(null)
    setRunning(true)
    setPhase({ phase: '작업을 시작하는 중' })
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    try {
      const { job } = await apiSend<{ job: string }>('POST', '/api/lab/run', { start, days: nDays, mode })
      const done = await pollJob<LabResult>(job, (j: Job<LabResult>) => setPhase((j.progress as { phase?: string; done?: number; total?: number }) ?? null), {
        intervalMs: 1200,
        timeoutMs: mode === 'llm' ? 360_000 : 180_000,
        signal: ac.signal,
      })
      if (done.status === 'error' || !isLab(done.result)) throw new Error(done.error || '시뮬레이션이 실패했습니다.')
      setRes(done.result)
      toast(`${done.result.days.length}일 시뮬레이션을 마쳤습니다.`)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setRunErr((e as Error).message)
    } finally {
      setRunning(false)
      setPhase(null)
    }
  }

  return (
    <div className="min-h-full bg-paper">
      <div className="border-b border-line bg-surface">
        <PublicHeader
          className="max-w-[1320px]"
          right={
            <Link to="/plan" className={btnCls('ghost', 'sm')}>
              <ArrowLeft size={15} aria-hidden /> 운영 화면으로
            </Link>
          }
        />
      </div>
      <main className="mx-auto max-w-[1320px] px-6 pt-8 pb-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[760px]">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#efedfb] px-3 py-1 text-[13px] font-semibold text-[#4a3aa7]">
              <Beaker size={14} aria-hidden /> 시뮬레이션 랩 · 격리 실행
            </div>
            <h1 className="mt-3 text-[30px] font-bold tracking-[-0.025em] text-ink">에이전트 판단으로 운전하면 전력은 얼마나 달라지나</h1>
            <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
              날마다 북항이와 사용자 에이전트가 강의실별 설정온도를 협의하고, 그 결과로 하루 운전을 다시 시뮬레이션합니다. 현재 운영(중앙 22℃ 고정)·규칙·AI 단독과 전력·요금·체감 쾌적을 나란히
              비교하고, 실측 전력량을 올리면 실제 사용량과도 비교합니다. 운영 중인 계획과 제어 명령에는 영향을 주지 않습니다.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AgentAvatar agent="building" size={52} />
            <span className="text-[13px] font-semibold text-ink-3">vs</span>
            <AgentAvatar agent="occupant" size={52} />
          </div>
        </div>

        {/* setup */}
        <section className="mt-8 rounded-[16px] border border-line bg-surface p-6" aria-labelledby="lab-setup">
          <h2 id="lab-setup" className="text-[17px] font-[650] text-ink">
            실험 설정
          </h2>
          <div className="mt-4 flex flex-wrap items-end gap-5">
            <label className="block">
              <span className="text-[13px] font-medium text-ink-3">시작일</span>
              <input
                type="date"
                name="lab-start"
                min="2026-09-01"
                max="2026-12-18"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={cx(inputBase, 'mt-1.5 h-10 w-[170px]')}
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-ink-3">수업일 수 (최대 {maxDays}일)</span>
              <input
                type="number"
                name="lab-days"
                inputMode="numeric"
                min={1}
                max={maxDays}
                value={nDays}
                onChange={(e) => setDays(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className={cx(inputBase, 'mt-1.5 h-10 w-[110px]')}
              />
            </label>
            <div>
              <span className="text-[13px] font-medium text-ink-3">에이전트</span>
              <div className="mt-1.5">
                <Segmented
                  value={mode}
                  onChange={(v) => setMode(v as 'rule' | 'llm')}
                  options={[
                    { value: 'rule', label: '규칙 기반 (빠름)' },
                    { value: 'llm', label: 'LLM 에이전트 (Bedrock)' },
                  ]}
                />
              </div>
            </div>
            <Button variant="primary" onClick={run} disabled={running || !start} className="h-10 px-5">
              {running ? <Spinner size={15} /> : <Play size={15} aria-hidden />}
              {running ? '시뮬레이션 중…' : '시뮬레이션 실행'}
            </Button>
          </div>
          <p className="mt-3 text-[13.5px] text-ink-3">
            {mode === 'llm'
              ? 'LLM 에이전트는 하루에 4번 Bedrock(Claude Haiku 5.5)을 호출해 약 30~40초가 걸립니다. 그래서 최대 3일까지 실행합니다.'
              : '규칙 기반 에이전트는 LLM과 같은 협의 절차를 규칙으로 따라갑니다. 하루에 1초 안팎이라 기간 비교에 씁니다.'}{' '}
            주말·공휴일은 건너뛰고 수업이 있는 날만 셉니다.
          </p>
          {running && phase && (
            <div className="mt-4" aria-live="polite">
              <div className="flex items-center justify-between text-[13.5px] text-ink-2">
                <span>{phase.phase ?? '진행 중'}</span>
                {phase.total ? (
                  <span className="tnum">
                    {phase.done ?? 0}/{phase.total}일
                  </span>
                ) : null}
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-well">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300"
                  style={{ width: `${phase.total ? Math.max(4, (100 * (phase.done ?? 0)) / phase.total) : 8}%` }}
                />
              </div>
            </div>
          )}
          {runErr && (
            <div className="mt-4">
              <ErrorBox title="시뮬레이션을 끝내지 못했습니다" error={runErr} onRetry={run} />
            </div>
          )}
        </section>

        <MeasuredCard measured={measured} onChange={setMeasured} />

        {loadErr && !res && (
          <div className="mt-6">
            <ErrorBox title="지난 결과를 불러오지 못했습니다" error={loadErr} />
          </div>
        )}
        {res ? <Results r={res} /> : !loadErr && <EmptyState />}
        <EvaluationPanel />
      </main>
      <ToastHost />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-6 rounded-[16px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <Beaker className="mx-auto text-ink-4" size={28} aria-hidden />
      <div className="mt-3 text-[16px] font-semibold text-ink">아직 실행한 시뮬레이션이 없습니다</div>
      <p className="mt-1 text-[14px] text-ink-3">기간과 에이전트를 고르고 "시뮬레이션 실행"을 누르세요.</p>
    </div>
  )
}

// ---------------------------------------------------------------- measured meter data

function MeasuredCard({ measured, onChange }: { measured: MeasuredInfo | null; onChange: (m: MeasuredInfo | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(f: File) {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const m = await apiSend<MeasuredInfo>('POST', '/api/lab/measured', fd)
      onChange(m)
      toast(`실측 ${m.count}개 값을 올렸습니다. 다음 실행부터 비교합니다.`)
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function clear() {
    setBusy(true)
    try {
      await apiSend('DELETE', '/api/lab/measured')
      onChange(null)
      toast('실측 전력량을 지웠습니다.')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 rounded-[16px] border border-line bg-surface p-6" aria-labelledby="lab-measured">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="lab-measured" className="text-[17px] font-[650] text-ink">
            실측 전력량
          </h2>
          <p className="mt-1 text-[14px] text-ink-2">
            {measured
              ? `${measured.source} · ${measured.granularity === 'hour' ? '시간' : '일'} 단위 ${fmtNum(measured.count)}개 · ${measured.start}~${measured.end}`
              : '냉난방 계량값(실외기 분전반 계량기, 중앙제어기 전력량 내보내기)을 올리면 같은 기간의 시뮬레이션과 비교합니다. 데모 건물은 실측값이 없어 비어 있습니다.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            id="lab-measured-file"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <label htmlFor="lab-measured-file" className={cx(btnCls('secondary', 'md'), busy && 'pointer-events-none opacity-60')}>
            <FileUp size={15} aria-hidden /> CSV 올리기
          </label>
          {measured && (
            <Button variant="ghost" onClick={clear} disabled={busy}>
              <Trash2 size={15} aria-hidden /> 지우기
            </Button>
          )}
          <button type="button" className={btnCls('ghost', 'md')} aria-expanded={open} onClick={() => setOpen(!open)}>
            <Info size={15} aria-hidden /> 형식
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-4 rounded-[12px] bg-well p-4 text-[13.5px] leading-relaxed text-ink-2">
          <div className="font-semibold text-ink">CSV 형식</div>
          <pre className="mt-2 overflow-x-auto rounded-[8px] bg-surface p-3 text-[13px] text-ink">{`timestamp,kwh\n2026-11-18 09:00,12.4\n2026-11-18 10:00,9.8`}</pre>
          <p className="mt-2">
            시간 단위(<code>YYYY-MM-DD HH:MM</code>)나 일 단위(<code>YYYY-MM-DD</code>) 중 하나로 맞춥니다. <code>date,hour,kwh</code> 열도 읽습니다. 건물 전체가 아니라 냉난방(시스템 에어컨) 전력만 계량한 값이어야 비교가
            공정합니다.
          </p>
          <p className="mt-2">
            비교 방법: 먼저 "현재 운영" 시뮬레이션이 실측을 얼마나 재현하는지 ASHRAE Guideline 14로 확인합니다(시간 단위 NMBE ±10%, CV(RMSE) 30% 이내). 이 기준을 통과해야 같은 시뮬레이터로 계산한
            에이전트 운전의 절감을 실제 사용량 대비로 읽을 수 있습니다.
          </p>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- results

function Results({ r }: { r: LabResult }) {
  const [sel, setSel] = useState(r.days[0]?.date ?? '')
  useEffect(() => setSel(r.days[0]?.date ?? ''), [r])
  const day = r.days.find((d) => d.date === sel) ?? r.days[0]
  const k = r.kpis
  const cp = k.complaint_room_pmv ?? {}
  const hasMeasured = r.days.some((d) => d.measured_kwh != null)

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-bold tracking-[-0.02em] text-ink">
          {fmtDateK(r.dates[0])} ~ {fmtDateK(r.dates[r.dates.length - 1])} · 수업일 {r.days.length}일
        </h2>
        <span className="text-[13.5px] text-ink-3">
          {r.params.mode === 'llm' ? (r.ai_used ? `LLM 에이전트 · Bedrock 호출 ${k.llm_calls}회` : 'LLM 호출 실패로 규칙 기반 에이전트로 대체') : '규칙 기반 에이전트'} · 계산 {k.seconds}초 ·{' '}
          {r.created_at.slice(5, 16).replace('T', ' ')} 실행
        </span>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="현재 운영 대비 전력"
          value={fmtPctSigned(k.saving_vs_current_pct)}
          tone="good"
          sub={`${fmtNum(r.totals.current.kwh, 1)} → ${fmtNum(r.totals.agents.kwh, 1)} kWh · 요금 ${fmtNum(k.cost_saving_vs_current_krw)}원 절약`}
        />
        <Kpi
          label="AI 단독 대비 전력"
          value={fmtPctSigned(k.saving_vs_ai_pct)}
          tone={(k.saving_vs_ai_pct ?? 0) >= 0 ? 'good' : 'warn'}
          sub={`쾌적을 위해 쓴 전력 포함 · ${fmtNum(r.totals.ai.kwh, 1)} → ${fmtNum(r.totals.agents.kwh, 1)} kWh`}
        />
        <Kpi
          label="의견이 반복된 강의실의 체감(PMV)"
          value={`${fmtPmv(cp.ai)} → ${fmtPmv(cp.agents)}`}
          tone={(cp.agents ?? 0) >= (cp.ai ?? 0) ? 'good' : 'warn'}
          sub={`AI 단독 → 에이전트 · 강의실·일 ${k.complaint_room_days}건 · 현재 운영 ${fmtPmv(cp.current)}`}
        />
        <Kpi
          label="합의·정책 준수"
          value={`${k.agreement_rate_pct.toFixed(0)}% · ${k.policy_compliance_pct.toFixed(0)}%`}
          tone={k.policy_compliance_pct >= 100 ? 'good' : 'warn'}
          sub="두 에이전트가 합의한 날 · 모든 설정이 정책 범위 안인 날"
        />
      </div>

      <StrategyTable r={r} hasMeasured={hasMeasured} />

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartPanel title="날짜별 전력량" desc="막대는 시뮬레이션, 검은 선은 실측(올린 경우)입니다. 막대를 누르면 그날을 아래에서 자세히 봅니다.">
          <DailyChart r={r} onPick={setSel} />
        </ChartPanel>
        <ChartPanel title="전력과 체감 쾌적" desc="점 하나가 하루입니다. 오른쪽일수록 전력이 많고, 위로 갈수록 덜 서늘합니다(PMV 0이 중립).">
          <ScatterChartPanel r={r} />
        </ChartPanel>
      </div>

      {day && (
        <section className="rounded-[16px] border border-line bg-surface p-6" aria-labelledby="lab-day">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="lab-day" className="text-[17px] font-[650] text-ink">
              {fmtDateK(day.date)} · 수업 {day.sessions}회 · 외기 평균 {day.t_mean}℃
            </h3>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="날짜 선택">
              {r.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  role="tab"
                  aria-selected={d.date === day.date}
                  onClick={() => setSel(d.date)}
                  className={cx(
                    'h-8 rounded-full px-3 text-[13.5px] font-medium tnum transition-colors',
                    d.date === day.date ? 'bg-brand text-white' : 'bg-well text-ink-2 hover:bg-hover',
                  )}
                >
                  {fmtDateShort(d.date)}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
            <div>
              <div className="text-[14px] font-semibold text-ink">시간대별 전력</div>
              <HourlyChart day={day} measured={r.measured} />
            </div>
            <AgentDecision day={day} />
          </div>
        </section>
      )}

      {r.measured && <CalibrationPanel c={r.measured} />}

      <section className="rounded-[16px] border border-line bg-surface p-6">
        <h3 className="text-[17px] font-[650] text-ink">이 실험을 읽는 법</h3>
        <ul className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-ink-2">
          {r.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
              {n}
            </li>
          ))}
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-4" aria-hidden />
            모든 전략은 같은 날씨·같은 재실(무단 공강·조기 종료 포함)·같은 시작 상태로 계산했습니다. PMV는 ISO 7730 식으로 수업 중 15분마다 계산한 평균입니다.
          </li>
        </ul>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'good' | 'warn' }) {
  return (
    <div className="rounded-[16px] border border-line bg-surface p-5">
      <div className="text-[13px] font-medium text-ink-3">{label}</div>
      <div className={cx('mt-1.5 text-[28px] font-[650] tracking-[-0.02em] tnum', tone === 'good' ? 'text-ink' : 'text-warn-ink')}>{value}</div>
      <div className="mt-1 text-[13px] leading-snug text-ink-3">{sub}</div>
    </div>
  )
}

function ChartPanel({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[16px] border border-line bg-surface p-6">
      <h3 className="text-[17px] font-[650] text-ink">{title}</h3>
      <p className="mt-1 text-[13.5px] text-ink-3">{desc}</p>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Legend({ keys, measured }: { keys: LabKey[]; measured?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COLOR[k] }} aria-hidden />
          {SHORT[k]}
        </span>
      ))}
      {measured && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[3px] w-4 rounded" style={{ background: COLOR.measured }} aria-hidden />
          실측
        </span>
      )}
    </div>
  )
}

function StrategyTable({ r, hasMeasured }: { r: LabResult; hasMeasured: boolean }) {
  const rows = KEYS.map((k) => ({ k, t: r.totals[k] }))
  const base = r.totals.current.kwh
  const measuredTotal = hasMeasured ? r.days.reduce((a, d) => a + (d.measured_kwh ?? 0), 0) : null
  return (
    <section className="overflow-hidden rounded-[16px] border border-line bg-surface" aria-label="전략별 비교">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[14px]">
          <thead className="bg-well text-[13px] text-ink-3">
            <tr>
              <th className="px-5 py-3 text-left font-medium">운전 방식</th>
              <th className="px-4 py-3 text-right font-medium">전력량</th>
              <th className="px-4 py-3 text-right font-medium">현재 운영 대비</th>
              <th className="px-4 py-3 text-right font-medium">요금</th>
              <th className="px-4 py-3 text-right font-medium">최대 전력</th>
              <th className="px-4 py-3 text-right font-medium">평균 PMV</th>
              <th className="px-4 py-3 text-right font-medium">PMV ±0.5 안</th>
              <th className="px-4 py-3 text-right font-medium">쾌적 범위 이탈(K·분)</th>
              <th className="px-5 py-3 text-right font-medium">시작 이탈</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map(({ k, t }) => (
              <tr key={k} className={cx('border-t border-line', k === 'agents' && 'bg-[#f6f5fe]')}>
                <td className="px-5 py-3 font-semibold text-ink">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COLOR[k] }} aria-hidden />
                    {r.labels[k]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{fmtNum(t.kwh, 1)} kWh</td>
                <td className="px-4 py-3 text-right">{k === 'current' ? '기준' : `${(((t.kwh - base) / base) * 100).toFixed(1)}%`}</td>
                <td className="px-4 py-3 text-right">{fmtNum(t.cost_krw)}원</td>
                <td className="px-4 py-3 text-right">{t.peak_kw.toFixed(1)} kW</td>
                <td className="px-4 py-3 text-right">{fmtPmv(t.pmv_mean)}</td>
                <td className="px-4 py-3 text-right">{t.pmv_ok_pct == null ? '–' : `${t.pmv_ok_pct.toFixed(1)}%`}</td>
                <td className="px-4 py-3 text-right">{fmtNum(t.discomfort_dm, 1)}</td>
                <td className="px-5 py-3 text-right">{t.cold_starts}회</td>
              </tr>
            ))}
            {measuredTotal != null && (
              <tr className="border-t border-line">
                <td className="px-5 py-3 font-semibold text-ink">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-[3px] w-3 rounded" style={{ background: COLOR.measured }} aria-hidden />
                    실측
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{fmtNum(measuredTotal, 1)} kWh</td>
                <td className="px-4 py-3 text-right">{base ? `${(((measuredTotal - base) / base) * 100).toFixed(1)}%` : '–'}</td>
                <td className="px-4 py-3 text-right text-ink-3" colSpan={6}>
                  실측은 전력량만 비교합니다
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DailyChart({ r, onPick }: { r: LabResult; onPick: (d: string) => void }) {
  const hasMeasured = r.days.some((d) => d.measured_kwh != null)
  const option = useMemo<EChartsOption>(() => {
    const cats = r.days.map((d) => fmtDateShort(d.date))
    const series: EChartsOption['series'] = KEYS.map((k) => ({
      name: SHORT[k],
      type: 'bar',
      barMaxWidth: 18,
      itemStyle: { color: COLOR[k], borderRadius: [4, 4, 0, 0] },
      data: r.days.map((d) => d.strategies[k].kwh),
    }))
    if (hasMeasured)
      (series as unknown[]).push({
        name: '실측',
        type: 'line',
        symbolSize: 8,
        lineStyle: { color: COLOR.measured, width: 2 },
        itemStyle: { color: COLOR.measured, borderColor: '#fff', borderWidth: 2 },
        data: r.days.map((d) => d.measured_kwh ?? null),
      })
    return {
      grid: { left: 48, right: 12, top: 16, bottom: 28 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { axisIndex: number; dataIndex: number; seriesName: string; value: number | null; color: string }[]
          const d = r.days[arr[0]?.dataIndex ?? 0]
          return ttTitle(fmtDateK(d.date)) + arr.map((p) => ttRow(p.color, p.seriesName, p.value == null ? '–' : `${p.value.toFixed(1)} kWh`, 'rect')).join('')
        },
      },
      xAxis: { type: 'category', data: cats, ...axisCommon, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'kWh', nameTextStyle: { color: '#667183', fontSize: 12 }, ...axisCommon },
      series,
    }
  }, [r, hasMeasured])
  return (
    <>
      <Legend keys={KEYS} measured={hasMeasured} />
      <EChart
        option={option}
        height={280}
        onEvents={{
          click: (p: unknown) => {
            const i = (p as { dataIndex?: number }).dataIndex
            if (i != null && r.days[i]) onPick(r.days[i].date)
          },
        }}
      />
    </>
  )
}

function ScatterChartPanel({ r }: { r: LabResult }) {
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 52, right: 16, top: 16, bottom: 40 },
      tooltip: {
        ...baseTooltip,
        trigger: 'item',
        formatter: (p: unknown) => {
          const q = p as { seriesName: string; color: string; value: [number, number, string] }
          return ttTitle(`${fmtDateK(q.value[2])} · ${q.seriesName}`) + ttRow(q.color, '전력', `${q.value[0].toFixed(1)} kWh`) + ttRow(q.color, '평균 PMV', fmtPmv(q.value[1]))
        },
      },
      xAxis: { type: 'value', name: 'kWh', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: '#667183', fontSize: 12 }, ...axisCommon },
      yAxis: { type: 'value', name: 'PMV', nameTextStyle: { color: '#667183', fontSize: 12 }, ...axisCommon, scale: true },
      series: KEYS.map((k) => ({
        name: SHORT[k],
        type: 'scatter',
        symbolSize: 11,
        itemStyle: { color: COLOR[k], borderColor: '#fff', borderWidth: 2 },
        data: r.days.filter((d) => d.strategies[k].pmv_mean != null).map((d) => [d.strategies[k].kwh, d.strategies[k].pmv_mean as number, d.date]),
        markLine:
          k === 'current'
            ? { silent: true, symbol: 'none', lineStyle: { color: '#c9d1db', type: 'dashed' }, label: { color: '#667183', formatter: 'PMV −0.5', position: 'insideStartTop' }, data: [{ yAxis: -0.5 }] }
            : undefined,
      })),
    }),
    [r],
  )
  return (
    <>
      <Legend keys={KEYS} />
      <EChart option={option} height={280} />
    </>
  )
}

function HourlyChart({ day, measured }: { day: LabDay; measured: Calibration | null }) {
  const meas = useMemo(() => {
    if (!measured?.series || measured.granularity !== 'hour') return null
    const m = new Map(measured.series.map((s) => [s.t, s.measured]))
    const arr = Array.from({ length: 24 }, (_, h) => m.get(`${day.date}T${String(h).padStart(2, '0')}`) ?? null)
    return arr.some((v) => v != null) ? arr : null
  }, [day, measured])
  const option = useMemo<EChartsOption>(() => {
    const hours = Array.from({ length: 24 }, (_, h) => `${h}시`)
    const series: unknown[] = KEYS.map((k) => ({
      name: SHORT[k],
      type: 'line',
      step: 'middle',
      showSymbol: false,
      lineStyle: { color: COLOR[k], width: k === 'agents' ? 2.5 : 1.8 },
      itemStyle: { color: COLOR[k] },
      data: day.strategies[k].kwh_by_hour ?? [],
    }))
    if (meas)
      series.push({
        name: '실측',
        type: 'line',
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { color: COLOR.measured, width: 2, type: 'dashed' },
        itemStyle: { color: COLOR.measured },
        data: meas,
      })
    return {
      grid: { left: 44, right: 12, top: 16, bottom: 28 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number; seriesName: string; value: number | null; color: string }[]
          return ttTitle(`${arr[0]?.dataIndex ?? 0}시`) + arr.map((p) => ttRow(p.color, p.seriesName, p.value == null ? '–' : `${p.value.toFixed(2)} kWh`)).join('')
        },
      },
      xAxis: { type: 'category', data: hours, ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, interval: 2 } },
      yAxis: { type: 'value', name: 'kWh', nameTextStyle: { color: '#667183', fontSize: 12 }, ...axisCommon },
      series: series as EChartsOption['series'],
    }
  }, [day, meas])
  return (
    <div className="mt-2">
      <Legend keys={KEYS} measured={!!meas} />
      <EChart option={option} height={300} />
    </div>
  )
}

function AgentDecision({ day }: { day: LabDay }) {
  const [open, setOpen] = useState(false)
  const a = day.agents
  const word = a.key === 'sp_heat' ? '난방' : '냉방'
  const rooms = Object.keys(a.setpoints).sort()
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[14px] font-semibold text-ink">에이전트가 정한 {word} 설정온도</div>
        <span
          className={cx(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold',
            a.agreed ? 'bg-good-bg text-good-ink' : 'bg-warn-bg text-warn-ink',
          )}
        >
          {a.agreed ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}
          {a.agreed ? `${a.rounds}라운드 합의` : '판정으로 절충'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rooms.map((r) => {
          const b = a.base_sp[r]
          const v = a.setpoints[r]
          const up = b != null && v > b
          const down = b != null && v < b
          return (
            <span
              key={r}
              className={cx(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] tnum',
                a.complaint_rooms.includes(r) ? 'border-[#f2c6a6] bg-occupant-bg' : 'border-line bg-surface',
              )}
              title={a.complaint_rooms.includes(r) ? '의견이 반복된 강의실' : undefined}
            >
              <b className="font-semibold text-ink">{r}</b>
              {b != null && b !== v && <span className="text-ink-3">{b.toFixed(1)} →</span>}
              <span className={cx('font-semibold', up ? 'text-heat-ink' : down ? 'text-cool-ink' : 'text-ink-2')}>{v.toFixed(1)}℃</span>
            </span>
          )
        })}
      </div>
      <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{a.summary}</p>
      {a.optimum && a.optimum.kwh != null && (
        <div className="mt-3 rounded-[12px] bg-well p-3 text-[13px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">비교: 판정 기준 전체 최적안</b> (쾌적 가중치 {fmtNum(a.optimum.comfort_won ?? 0)}원) · {a.optimum.kwh.toFixed(1)} kWh · PMV{' '}
          {fmtPmv(a.optimum.pmv_mean)} · 협의안 {day.strategies.agents.kwh.toFixed(1)} kWh · PMV {fmtPmv(day.strategies.agents.pmv_mean)}
          <div className="mt-1 text-ink-3">
            협의는 두 제안 사이에서만 움직이므로, 판정 함수가 정책 범위 전체에서 고른 안과 다를 수 있습니다. 이 차이가 에이전트 협의의 비용(또는 쾌적)입니다.
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand-ink hover:underline"
      >
        협의 과정 {open ? '접기' : `보기 (${a.turns.length}턴)`}
        <ChevronDown size={15} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ol className="mt-3 space-y-3">
          {a.turns.map((t, i) => (
            <li key={i} className="flex gap-3">
              <AgentAvatar agent={t.agent} size={34} />
              <div className="min-w-0 flex-1 rounded-[12px] bg-well p-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <b style={{ color: AGENT_META[t.agent].ink }}>{AGENT_META[t.agent].name}</b>
                  <span className="text-ink-3">{t.round}라운드</span>
                  <span className="font-medium text-ink">{t.stance}</span>
                </div>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{t.message}</p>
                {t.trace.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.trace.map((tr, j) => (
                      <span key={j} className="rounded-full bg-surface px-2 py-0.5 text-[12.5px] text-ink-2" title={`${tr.query} → ${tr.finding}`}>
                        {j + 1}. {sourceMeta(tr.source).label}: {tr.finding.length > 38 ? `${tr.finding.slice(0, 38)}…` : tr.finding}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function CalibrationPanel({ c }: { c: Calibration }) {
  const ok = c.calibrated
  return (
    <section className="rounded-[16px] border border-line bg-surface p-6" aria-labelledby="lab-cal">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="lab-cal" className="text-[17px] font-[650] text-ink">
          실측 대비 보정 오차 (ASHRAE Guideline 14)
        </h3>
        {c.overlap != null && c.overlap >= 2 && (
          <span className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', ok ? 'bg-good-bg text-good-ink' : 'bg-warn-bg text-warn-ink')}>
            {ok ? '보정 기준 통과' : '보정 필요'}
          </span>
        )}
      </div>
      {c.overlap == null || c.overlap < 2 ? (
        <p className="mt-2 text-[14px] text-ink-2">{c.note ?? '랩 기간과 겹치는 실측값이 없습니다.'}</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="NMBE (평균 편향)" value={`${c.nmbe_pct?.toFixed(1)}%`} tone={Math.abs(c.nmbe_pct ?? 99) <= (c.threshold?.nmbe ?? 0) ? 'good' : 'warn'} sub={`기준 ±${c.threshold?.nmbe}%`} />
            <Kpi label="CV(RMSE)" value={`${c.cvrmse_pct?.toFixed(1)}%`} tone={(c.cvrmse_pct ?? 999) <= (c.threshold?.cvrmse ?? 0) ? 'good' : 'warn'} sub={`기준 ${c.threshold?.cvrmse}% 이하`} />
            <Kpi label="실측 vs 현재 운영 시뮬" value={`${fmtNum(c.measured_kwh, 1)} / ${fmtNum(c.current_sim_kwh, 1)}`} tone="good" sub={`겹치는 ${c.granularity === 'hour' ? '시간' : '일'} ${c.overlap}개, kWh`} />
            <Kpi
              label="실측 대비 에이전트 운전"
              value={c.saving_vs_measured_pct == null ? '–' : `${(-c.saving_vs_measured_pct).toFixed(1)}%`}
              tone={ok ? 'good' : 'warn'}
              sub={ok ? '보정 기준을 통과해 실측 대비로 읽을 수 있습니다' : '보정 전이라 참고값입니다'}
            />
          </div>
          <p className="mt-3 text-[13.5px] text-ink-3">{c.note}</p>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- offline agent evaluation (scripts/eval_agents.py)

interface EvalTotals {
  kwh: number
  cost_krw: number
  pmv_ok_pct: number
  pmv_mean: number
  discomfort_dm: number
  cold_starts: number
}

interface EvalLlmDay {
  date: string
  ai_runs: number
  seconds: number[]
  grounding: { checked: number; direct: number; direct_rate: number | null; null_pass_rate: number | null }
  consistency: { runs: number; rooms?: number; identical_rooms_pct: number | null; max_setpoint_spread_c?: number; kwh_min?: number; kwh_max?: number }
  llm_vs_rule: { llm_kwh: number[]; rule_kwh: number; llm_pmv: (number | null)[]; rule_pmv: number | null; baseline_kwh: number; baseline_pmv: number | null }
}

interface EvalResult {
  period: {
    dates: string[]
    totals: Record<LabKey, EvalTotals>
    agreement_pct: number
    policy_pct: number
    complaint_room_days: number
    complaint_room_pmv: Partial<Record<LabKey, number | null>>
    regret?: { regret_won: number; j_current_plan: number; j_negotiated: number; j_optimum: number }
    comfort_sweep?: { comfort_won: number; kwh: number; cost_krw: number; pmv_mean: number | null }[]
  }
  llm: EvalLlmDay[]
  created_at: string
}

function EvaluationPanel() {
  const [ev, setEv] = useState<EvalResult | null>(null)
  useEffect(() => {
    apiGet<EvalResult>('/api/lab/evaluation')
      .then((r) => r?.period?.totals && setEv(r))
      .catch(() => {})
  }, [])
  if (!ev) return null
  const p = ev.period
  const base = p.totals.current.kwh
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  return (
    <section className="mt-8 rounded-[16px] border border-line bg-surface p-6" aria-labelledby="lab-eval">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="lab-eval" className="text-[20px] font-bold tracking-[-0.02em] text-ink">
          에이전트 평가 결과
        </h2>
        <span className="text-[13px] text-ink-3">scripts/eval_agents.py · {ev.created_at.slice(0, 16).replace('T', ' ')} 실행</span>
      </div>
      <p className="mt-1 text-[14px] text-ink-2">
        {fmtDateK(p.dates[0])}~{fmtDateK(p.dates[p.dates.length - 1])} 수업일 {p.dates.length}일을 규칙 기반 에이전트로 돌리고, LLM 에이전트는 표본 날짜를 반복 실행해 수치 근거와 일관성을 쟀습니다.
      </p>

      <h3 className="mt-5 text-[15px] font-semibold text-ink">1. 기간 성과 (같은 날씨·재실, 시뮬레이션)</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[720px] text-[14px] tnum">
          <thead className="bg-well text-[13px] text-ink-3">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">운전 방식</th>
              <th className="px-4 py-2.5 text-right font-medium">전력량</th>
              <th className="px-4 py-2.5 text-right font-medium">현재 운영 대비</th>
              <th className="px-4 py-2.5 text-right font-medium">PMV ±0.5 안</th>
              <th className="px-4 py-2.5 text-right font-medium">평균 PMV</th>
              <th className="px-4 py-2.5 text-right font-medium">의견 강의실 PMV</th>
              <th className="px-4 py-2.5 text-right font-medium">시작 이탈</th>
            </tr>
          </thead>
          <tbody>
            {KEYS.map((k) => {
              const t = p.totals[k]
              return (
                <tr key={k} className={cx('border-t border-line', k === 'agents' && 'bg-[#f6f5fe]')}>
                  <td className="px-4 py-2.5 font-semibold text-ink">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COLOR[k] }} aria-hidden />
                      {SHORT[k]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{fmtNum(t.kwh, 1)} kWh</td>
                  <td className="px-4 py-2.5 text-right">{k === 'current' ? '기준' : `${(((t.kwh - base) / base) * 100).toFixed(1)}%`}</td>
                  <td className="px-4 py-2.5 text-right">{t.pmv_ok_pct.toFixed(1)}%</td>
                  <td className="px-4 py-2.5 text-right">{fmtPmv(t.pmv_mean)}</td>
                  <td className="px-4 py-2.5 text-right">{fmtPmv(p.complaint_room_pmv[k])}</td>
                  <td className="px-4 py-2.5 text-right">{t.cold_starts}회</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-ink-3">
        합의율 {p.agreement_pct}% · 정책 범위 준수 {p.policy_pct}% · 의견이 반복된 강의실·일 {p.complaint_room_days}건
      </p>

      {p.regret && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">2. 판정 기준 최적안과 비교</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
            판정 함수(전기요금 + 쾌적 벌점)로 보면 현재 계획 {fmtNum(p.regret.j_current_plan)}원 → 협의안 {fmtNum(p.regret.j_negotiated)}원이고, 정책 범위 전체에서 고른 최적안은{' '}
            {fmtNum(p.regret.j_optimum)}원입니다. 협의는 그 차이의{' '}
            <b className="text-ink">
              {p.regret.j_current_plan - p.regret.j_optimum > 0
                ? `${((100 * (p.regret.j_current_plan - p.regret.j_negotiated)) / (p.regret.j_current_plan - p.regret.j_optimum)).toFixed(0)}%`
                : '–'}
            </b>
            만 줄였습니다. 협의가 두 제안 사이에서만 움직이기 때문입니다.
          </p>
        </>
      )}

      {p.comfort_sweep && p.comfort_sweep.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">3. 쾌적 가중치에 따른 전력과 체감 (판정 최적안, 같은 기간)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px] tnum">
              <thead className="bg-well text-[13px] text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">쾌적 가중치 (원/PMV·실·일)</th>
                  <th className="px-4 py-2.5 text-right font-medium">전력량</th>
                  <th className="px-4 py-2.5 text-right font-medium">요금</th>
                  <th className="px-4 py-2.5 text-right font-medium">평균 PMV</th>
                </tr>
              </thead>
              <tbody>
                {p.comfort_sweep.map((w) => (
                  <tr key={w.comfort_won} className={cx('border-t border-line', w.comfort_won === 600 && 'bg-[#f6f5fe]')}>
                    <td className="px-4 py-2.5">
                      {fmtNum(w.comfort_won)}
                      {w.comfort_won === 600 ? ' (현재 기본값)' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right">{fmtNum(w.kwh, 1)} kWh</td>
                    <td className="px-4 py-2.5 text-right">{fmtNum(w.cost_krw)}원</td>
                    <td className="px-4 py-2.5 text-right">{fmtPmv(w.pmv_mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[13px] text-ink-3">가중치를 올려도 PMV가 일정 수준에서 멈춥니다. 정책 상한(난방 22℃)에 닿고, 체감은 설정온도보다 구조체 온도(예열 시간)에 더 좌우되기 때문입니다.</p>
        </>
      )}

      {ev.llm.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold text-ink">4. LLM 에이전트 (Bedrock Claude Haiku 5.5)</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[820px] text-[14px] tnum">
              <thead className="bg-well text-[13px] text-ink-3">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">날짜</th>
                  <th className="px-4 py-2.5 text-right font-medium">반복 · 평균 시간</th>
                  <th className="px-4 py-2.5 text-right font-medium" title="메시지·확인한 근거의 수치 중 자료·시뮬레이터 값을 그대로 인용한 비율">
                    수치 직접 인용률
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium" title="같은 수치에 0.37·1.13을 더한 가짜 값이 같은 검사를 통과한 비율">
                    대조군 통과율
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">반복 시 같은 결론</th>
                  <th className="px-4 py-2.5 text-right font-medium">전력 (LLM / 규칙 / 현재 계획)</th>
                </tr>
              </thead>
              <tbody>
                {ev.llm.map((x) => (
                  <tr key={x.date} className="border-t border-line">
                    <td className="px-4 py-2.5 font-semibold text-ink">{fmtDateK(x.date)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {x.ai_runs}회 · {avg(x.seconds).toFixed(0)}초
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{x.grounding.direct_rate ?? '–'}%</td>
                    <td className="px-4 py-2.5 text-right text-ink-3">{x.grounding.null_pass_rate ?? '–'}%</td>
                    <td className="px-4 py-2.5 text-right">
                      강의실 {x.consistency.identical_rooms_pct ?? '–'}% · 최대 차 {x.consistency.max_setpoint_spread_c ?? '–'}℃
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {x.llm_vs_rule.llm_kwh.map((v) => v.toFixed(1)).join('·')} / {x.llm_vs_rule.rule_kwh.toFixed(1)} / {x.llm_vs_rule.baseline_kwh.toFixed(1)} kWh
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 className="mt-6 text-[15px] font-semibold text-ink">5. 읽는 법</h3>
      <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed text-ink-2">
        <li>
          · 현재 운영 대비 전력은 크게 줄지만, PMV ±0.5 안 비율도 함께 낮아집니다. 절감의 대부분은 시간표 연동(빈 강의실 정지)에서 오고, 22℃ 고정보다 낮은 설정온도의 대가가 쾌적에 나타납니다.
        </li>
        <li>· 에이전트는 AI 단독보다 전력을 조금 더 쓰고 의견이 반복된 강의실의 PMV를 조금 올립니다. 설정온도 0.5℃ 조정만으로는 체감 개선 폭이 작습니다.</li>
        <li>· 수치 직접 인용률이 대조군 통과율보다 훨씬 높으면, 에이전트가 수치를 지어내지 않고 자료에서 가져왔다는 뜻입니다.</li>
        <li>· 같은 날을 반복하면 일부 강의실의 결론이 0.5~1℃ 달라집니다. 최종 결정은 결정적 판정과 시뮬레이터 검증을 거치고, 추천 모드에서는 담당자가 승인합니다.</li>
      </ul>
    </section>
  )
}
