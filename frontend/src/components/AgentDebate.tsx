import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Play, RotateCw, Sparkles, TriangleAlert } from 'lucide-react'
import { ApiError, apiGet, apiSend, pollJob } from '../lib/api'
import type { AgentTrace, AgentTurn, Negotiation, NegotiationEval, NegotiationJob, OpModeKey, RoomSetpoint } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtWon } from '../lib/format'
import { AGENT_META, AgentAvatar, type AgentKey } from './Characters'
import AgentStage from './AgentStage'
import { BRAND, HATCH, PillChip } from './Gantt'
import { SourceIcon, sourceMeta } from './dataSources'
import { Card, ErrorBox, Loading, Note, Spinner, More} from './ui'

/**
 * 에이전트 협의: 관리자 에이전트 '관리자 온디'(요금·전력)와 사용자 에이전트 '사용자 온디'(쾌적)가 설정온도를 두고 번갈아 제안하고,
 * 시뮬레이터가 매 제안을 검증하고, 판정이 합의안을 정리합니다. 진행 중에는 job.progress.turns가 차례로 늘어납니다.
 */

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function fmtPmv(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return '–'
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`
}

function fmtDelta(v: number, digits = 1, unit = '') {
  if (!v || Math.abs(v) < 10 ** -digits / 2) return `±0${unit}`
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}${unit}`
}

function normTurns(x: unknown): AgentTurn[] {
  if (!Array.isArray(x)) return []
  return x
    .filter((t): t is AgentTurn => !!t && typeof t === 'object' && 'agent' in t)
    .map((t) => ({ ...t, trace: Array.isArray(t.trace) ? t.trace : [], proposal: t.proposal && typeof t.proposal === 'object' ? t.proposal : {} }))
}

function normNeg(n: Negotiation | null | undefined): Negotiation | null {
  if (!n || typeof n !== 'object') return null
  return { ...n, turns: normTurns(n.turns), adjustment_ids: Array.isArray(n.adjustment_ids) ? n.adjustment_ids : [] }
}

export default function AgentDebate({ tier, date, mode, onChanged }: { tier: 2 | 3; date: string; mode?: OpModeKey; onChanged?: () => void }) {
  const [latest, setLatest] = useState<Negotiation | null | undefined>(undefined)
  const [latestErr, setLatestErr] = useState<Error | null>(null)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [liveTurns, setLiveTurns] = useState<AgentTurn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  // last result for this tier/date first (404 = never negotiated)
  useEffect(() => {
    let alive = true
    setLatest(undefined)
    setLatestErr(null)
    apiGet<Negotiation>(`/api/negotiate/latest?tier=${tier}&date=${date}`)
      .then((n) => alive && setLatest(normNeg(n)))
      .catch((e: Error) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) setLatest(null)
        else {
          setLatest(null)
          setLatestErr(e)
        }
      })
    return () => {
      alive = false
    }
  }, [tier, date])

  useEffect(() => () => abort.current?.abort(), [])

  const start = useCallback(async () => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setRunning(true)
    setError(null)
    setLiveTurns([])
    setSelected(null)
    setPhase('협의를 준비하는 중…')
    try {
      const r = await apiSend<{ job: string }>('POST', '/api/negotiate', { tier, date })
      if (!r?.job) throw new Error('협의 작업을 시작하지 못했습니다.')
      const job = await pollJob<Negotiation>(
        r.job,
        (j) => {
          const p = (j as unknown as NegotiationJob).progress
          setLiveTurns(normTurns(p?.turns))
          if (p?.phase) setPhase(p.phase)
        },
        { intervalMs: 1200, timeoutMs: 300_000, signal: ac.signal },
      )
      if (job.status === 'error' || !job.result) throw new Error(job.error || '협의가 끝나지 않았습니다.')
      setLatest(normNeg(job.result))
      setLiveTurns([])
      onChanged?.()
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message)
    } finally {
      if (!ac.signal.aborted) {
        setRunning(false)
        setPhase(null)
      }
    }
  }, [tier, date, onChanged])

  const neg = latest ?? null
  const turns = running ? liveTurns : (neg?.turns ?? [])
  const baseline = neg?.baseline
  const season = neg?.season ?? 'heat'

  return (
    <Card pad={false} className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4 px-7 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em] text-ink">
            에이전트 협의
            <span className="rounded-full bg-brand-bg px-2.5 py-[2px] text-[12.5px] font-semibold text-brand-ink">{tier === 2 ? '2차 · 주간' : '3차 · 일일'}</span>
          </h2>
          <More className="mt-1"><p>
            {fmtDateK(date)} 기준. 요금과 쾌적은 서로 맞바꾸는 관계라서, 두 에이전트가 같은 데이터를 보고 설정온도를 주고받은 뒤 시뮬레이터 결과로 합의합니다.
          </p></More>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <span className="inline-flex items-center gap-2 text-[13.5px] text-ink-2" role="status" aria-live="polite">
              <Spinner size={15} />
              {phase ?? '협의 중…'}
            </span>
          )}
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white shadow-[0_6px_18px_rgb(47_111_222/0.25)] transition-colors hover:bg-brand-ink disabled:opacity-55"
            style={{ background: BRAND }}
          >
            {neg ? <RotateCw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {neg ? '다시 협의' : '협의 시작'}
          </button>
        </div>
      </div>

      <div className="mx-7 mb-6">
        <AgentStage turns={turns} running={running} phase={phase} completed={!!neg} failed={!!error} fallback={neg?.ai === false} />
      </div>

      <div className="space-y-6 px-7 pb-7">
        {error && <ErrorBox title="협의를 끝내지 못했습니다" error={error} onRetry={start} />}
        {latestErr && !neg && !running && <Note tone="warn">지난 협의 결과를 불러오지 못했습니다. {latestErr.message}</Note>}
        {latest === undefined && !running ? (
          <Loading label="지난 협의 결과를 확인하는 중…" />
        ) : turns.length === 0 && !running ? (
          <EmptyDebate onStart={start} />
        ) : (
          <>
            {neg && !neg.ai && !running && (
              <Note tone="warn" icon={<TriangleAlert size={15} aria-hidden />}>
                AI(Bedrock) 연결이 불안정해서 규칙 기반 에이전트로 협의했습니다. 수치는 같은 시뮬레이터로 검증했습니다.{neg.note ? ` ${neg.note}` : ''}
              </Note>
            )}
            <DebateTimeline turns={turns} running={running} agreed={!running && !!neg?.final?.agreed} selected={selected} onSelect={setSelected} />
            <Conversation turns={turns} baseline={baseline} season={season} running={running} selected={selected} />
            {!running && neg?.final && <Consensus neg={neg} mode={mode} />}
          </>
        )}
      </div>
    </Card>
  )
}

/** The recorded exchange as evidence: who said what in which round, the data each turn cited, and the simulator's check. */
export function DebateEvidence({ turns, baseline, season, running, agreed }: { turns: AgentTurn[]; baseline: NegotiationEval | undefined; season: 'heat' | 'cool'; running: boolean; agreed: boolean }) {
  const [selected, setSelected] = useState<number | null>(null)
  const list = normTurns(turns)
  if (!list.length) return null
  return (
    <div className="space-y-6">
      <DebateTimeline turns={list} running={running} agreed={agreed} selected={selected} onSelect={setSelected} />
      <Conversation turns={list} baseline={baseline} season={season} running={running} selected={selected} />
    </div>
  )
}

function EmptyDebate({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex items-end gap-2" aria-hidden>
        <AgentAvatar agent="building" size={56} />
        <AgentAvatar agent="occupant" size={56} />
      </div>
      <div className="text-[16px] font-semibold text-ink">아직 이 날짜로 협의한 기록이 없습니다</div>
      <More><p>
        협의를 시작하면 관리자 온디가 전력을 아끼는 설정온도를 먼저 제안하고, 사용자 온디가 쾌적 의견과 체감 지수로 반박합니다. 시뮬레이터가 매 제안을 검증합니다.
      </p></More>
      <button
        type="button"
        onClick={onStart}
        className="mt-1 inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-white hover:bg-brand-ink"
        style={{ background: BRAND }}
      >
        <Play size={15} aria-hidden /> 협의 시작
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- timeline (mock image 3 style)

type Lane = 'building' | 'occupant' | 'simulator' | 'arbiter'

function turnLabel(t: AgentTurn, firstOfAgent: boolean): { label: string; chip: string; dot: string } {
  if (t.agent === 'building') return { label: firstOfAgent ? '제안' : t.accepts ? '수용' : '수정안', chip: t.accepts ? '합의 가능' : '절감 우선', dot: t.accepts ? '#0ca30c' : BRAND }
  if (t.agent === 'occupant') return { label: t.accepts ? '수용' : '반박', chip: t.accepts ? '쾌적 충족' : '쾌적 부족', dot: t.accepts ? '#0ca30c' : '#e09a00' }
  return { label: '합의', chip: '판정', dot: '#6250d6' }
}

function DebateTimeline({
  turns,
  running,
  agreed,
  selected,
  onSelect,
}: {
  turns: AgentTurn[]
  running: boolean
  agreed: boolean
  selected: number | null
  onSelect: (i: number) => void
}) {
  const rounds = Math.max(1, ...turns.map((t) => t.round || 1))
  const cols = running ? rounds + 1 : Math.max(rounds, 2)
  const current = running ? (turns.length ? rounds + (turns[turns.length - 1].agent === 'occupant' ? 1 : 0) : 1) : null
  const lanes: { key: Lane; title: string; sub: string }[] = [
    { key: 'building', title: '비용 Agent', sub: '관리자 온디 · Bedrock' },
    { key: 'occupant', title: '쾌적 Agent', sub: '사용자 온디 · Bedrock' },
    { key: 'simulator', title: '시뮬레이터', sub: '물리 모델 검증' },
    { key: 'arbiter', title: '판정', sub: '결정적 규칙 (LLM 아님)' },
  ]
  const seen: Record<string, number> = {}
  const cells: Record<string, { idx: number; label: string; chip: string; dot: string }[]> = {}
  turns.forEach((t, idx) => {
    const r = t.round || 1
    const lane: Lane = t.agent === 'arbiter' ? 'arbiter' : t.agent
    const first = !(lane in seen)
    seen[lane] = (seen[lane] ?? 0) + 1
    ;(cells[`${lane}:${r}`] ??= []).push({ idx, ...turnLabel(t, first) })
    if (t.eval && t.agent !== 'arbiter') {
      const e = t.eval
      const chip = e.cold_rooms?.length || e.hot_rooms?.length ? `서늘·더움 ${(e.cold_rooms?.length ?? 0) + (e.hot_rooms?.length ?? 0)}실` : `PMV ${fmtPmv(e.pmv_mean)}`
      ;(cells[`simulator:${r}`] ??= []).push({ idx, label: '검증', chip, dot: e.cold_rooms?.length || e.hot_rooms?.length ? '#e09a00' : '#0ca30c' })
    }
  })
  const laneColor: Record<Lane, string> = { building: AGENT_META.building.color, occupant: AGENT_META.occupant.color, simulator: AGENT_META.simulator.color, arbiter: AGENT_META.arbiter.color }
  const labelW = 196
  return (
    <div className="thin-scroll overflow-x-auto">
      <div className="min-w-[720px]">
        <div className="mb-2 flex">
          <div className="shrink-0 pr-3" style={{ width: labelW }}>
            <div className="flex h-[34px] items-center pl-1 text-[13px] font-semibold text-ink-3">참여자</div>
          </div>
          <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
            {Array.from({ length: cols }, (_, i) => i + 1).map((r) => {
              const on = current === r
              return (
                <div
                  key={r}
                  className={cx('tnum flex h-[34px] items-center justify-center rounded-[9px] border text-[12.5px] font-medium', on ? 'border-transparent text-white' : 'border-line bg-surface text-ink-2')}
                  style={on ? { background: BRAND } : undefined}
                >
                  {r}라운드{agreed && r === rounds ? ' · 합의' : ''}
                </div>
              )
            })}
          </div>
        </div>
        {lanes.map((ln) => (
          <div key={ln.key} className="flex" style={{ height: 58 }}>
            <div className="shrink-0 py-1 pr-3" style={{ width: labelW }}>
              <div className="flex h-full items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3">
                <AgentAvatar agent={ln.key} size={32} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[14px] font-bold text-ink">{ln.title}</span>
                  <span className="block truncate text-[12.5px] text-ink-3">{ln.sub}</span>
                </span>
              </div>
            </div>
            <div className="relative grid flex-1 gap-1 border-b border-line/70" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
              {Array.from({ length: cols }, (_, i) => i + 1).map((r) => {
                const items = cells[`${ln.key}:${r}`] ?? []
                const future = running && current != null && r > current
                const isCurrent = running && current === r
                return (
                  <div key={r} className="relative flex items-center gap-1 px-0.5 py-2" style={future ? HATCH : undefined}>
                    {isCurrent && <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l-2 border-dashed" style={{ borderColor: BRAND }} aria-hidden />}
                    {items.map((c) => (
                      <button
                        key={`${c.idx}-${c.label}`}
                        type="button"
                        onClick={() => onSelect(c.idx)}
                        aria-pressed={selected === c.idx}
                        className={cx(
                          'relative z-[1] flex h-9 min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-full pr-1.5 pl-1 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-px',
                          selected === c.idx && 'shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--color-brand)]',
                        )}
                        style={{ background: `linear-gradient(90deg, ${laneColor[ln.key]}, ${laneColor[ln.key]}d9)` }}
                        title={`${ln.title} ${r}라운드 ${c.label}`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/95">
                          <AgentAvatar agent={ln.key} size={24} />
                        </span>
                        <span className="truncate text-[13px] font-semibold text-white">{c.label}</span>
                        <span className="ml-auto hidden sm:inline-flex">
                          <PillChip dot={c.dot}>{c.chip}</PillChip>
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- conversation

function changedRooms(p: Record<string, RoomSetpoint>, base: NegotiationEval | undefined, season: 'heat' | 'cool') {
  const key = season === 'heat' ? 'sp_heat' : 'sp_cool'
  const out: { room: string; from: number | null; to: number }[] = []
  for (const [room, sp] of Object.entries(p ?? {})) {
    const to = sp?.[key]
    if (to == null) continue
    const from = base?.rooms?.[room]?.[key] ?? null
    if (from != null && Math.abs(from - to) < 0.05) continue
    out.push({ room, from, to })
  }
  return out.sort((a, b) => ROOM_ORDER.indexOf(a.room) - ROOM_ORDER.indexOf(b.room))
}

function Conversation({
  turns,
  baseline,
  season,
  running,
  selected,
}: {
  turns: AgentTurn[]
  baseline: NegotiationEval | undefined
  season: 'heat' | 'cool'
  running: boolean
  selected: number | null
}) {
  const refs = useRef<Record<number, HTMLLIElement | null>>({})
  useEffect(() => {
    if (selected != null) refs.current[selected]?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' })
  }, [selected])
  const last = turns[turns.length - 1]
  const waiting: AgentKey | null = running ? (last?.agent === 'building' ? 'occupant' : 'building') : null
  return (
    <ol className="space-y-5" aria-label="협의 대화">
      {turns.map((t, i) => (
        <li key={i} ref={(el) => void (refs.current[i] = el)} className={cx('reveal flex', t.agent === 'occupant' ? 'justify-end' : t.agent === 'arbiter' ? 'justify-center' : 'justify-start')}>
          <TurnBubble t={t} baseline={baseline} season={season} highlight={selected === i} animate={running && i === turns.length - 1} />
        </li>
      ))}
      {waiting && (
        <li className={cx('flex items-center gap-3', waiting === 'occupant' ? 'justify-end' : 'justify-start')} aria-live="polite">
          {waiting === 'building' && <AgentAvatar agent="building" size={36} />}
          <span className="inline-flex items-center gap-2 rounded-full bg-well px-4 py-2 text-[13.5px] text-ink-2">
            <Spinner size={14} />
            {waiting === 'building' ? '관리자 온디가 데이터를 확인하는 중…' : '사용자 온디가 쾌적 데이터를 확인하는 중…'}
          </span>
          {waiting === 'occupant' && <AgentAvatar agent="occupant" size={36} />}
        </li>
      )}
    </ol>
  )
}

function TurnBubble({ t, baseline, season, highlight, animate }: { t: AgentTurn; baseline: NegotiationEval | undefined; season: 'heat' | 'cool'; highlight: boolean; animate: boolean }) {
  const m = AGENT_META[t.agent]
  const right = t.agent === 'occupant'
  const center = t.agent === 'arbiter'
  const diffs = changedRooms(t.proposal, baseline, season)
  return (
    <div className={cx('flex max-w-[min(920px,100%)] items-start gap-3', right && 'flex-row-reverse', center && 'w-full max-w-[980px]')}>
      <AgentAvatar agent={t.agent} size={center ? 40 : 48} className="mt-1" />
      <div
        className={cx('min-w-0 flex-1 rounded-[18px] border px-5 py-4 transition-shadow duration-200', highlight && 'shadow-[0_0_0_2px_var(--color-brand)]')}
        style={{ background: m.bg, borderColor: `${m.color}40` }}
      >
        <div className={cx('flex flex-wrap items-center gap-2', right && 'flex-row-reverse')}>
          <span className="text-[14.5px] font-bold" style={{ color: m.ink }}>
            {m.name}
          </span>
          <span className="tnum rounded-full bg-white/80 px-2 py-[1px] text-[12px] font-semibold text-ink-2">{t.round || 1}라운드</span>
          {t.accepts != null && t.agent !== 'arbiter' && (
            <span className={cx('rounded-full px-2 py-[1px] text-[12px] font-semibold', t.accepts ? 'bg-good-bg text-good-ink' : 'bg-white/80 text-ink-2')}>{t.accepts ? '수용' : '이견'}</span>
          )}
        </div>
        {t.stance && <div className={cx('mt-1.5 text-[16px] leading-snug font-semibold text-ink', right && 'text-right')}>{t.stance}</div>}
        {t.message && <p className="mt-1.5 text-[14.5px] leading-[1.65] whitespace-pre-line text-ink-2">{t.message}</p>}

        {t.sims && t.sims.length > 0 && (
          <div className="mt-3 rounded-[12px] bg-white/80 px-3.5 py-2.5">
            <div className="text-[12.5px] font-semibold text-ink-3">답하기 전에 시뮬레이터를 직접 {t.sims.length}회 실행</div>
            <ol className="mt-1.5 space-y-1.5">
              {t.sims.map((s, i) => (
                <li key={i} className="text-[13px] leading-snug text-ink-2">
                  <span className="tnum mr-1.5 font-semibold" style={{ color: m.ink }}>
                    {i + 1}
                  </span>
                  {s.why}
                  <span className="tnum ml-1.5 font-semibold whitespace-nowrap text-ink">
                    → {fmtKwh(s.kwh)} kWh · {fmtWon(s.cost_krw)}
                    {s.pmv_mean != null ? ` · PMV ${s.pmv_mean.toFixed(2)}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {t.trace.length > 0 && <DataHops trace={t.trace} color={m.color} animate={animate} />}

        {diffs.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[12.5px] font-semibold text-ink-3">제안한 {season === 'heat' ? '난방' : '냉방'} 설정온도</div>
            <div className="flex flex-wrap gap-1.5">
              {diffs.map((d) => (
                <span key={d.room} className="tnum inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[12.5px] font-medium text-ink">
                  <b>{d.room}</b>
                  {d.from != null && <span className="text-ink-3">{d.from.toFixed(1)}</span>}
                  {d.from != null && <ArrowRight size={11} className="text-ink-4" aria-hidden />}
                  <b style={{ color: m.ink }}>{d.to.toFixed(1)}℃</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {t.eval && <EvalStrip e={t.eval} base={baseline} />}
      </div>
    </div>
  )
}

function EvalStrip({ e, base }: { e: NegotiationEval; base: NegotiationEval | undefined }) {
  const dk = base ? e.kwh - base.kwh : null
  const dc = base ? e.cost_krw - base.cost_krw : null
  const uncomfy = [...(e.cold_rooms ?? []).map((r) => `${r} 추움`), ...(e.hot_rooms ?? []).map((r) => `${r} 더움`)]
  return (
    <div className="mt-3 rounded-[12px] bg-white/85 px-3.5 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-s-ai-ink">
        <AgentAvatar agent="simulator" size={18} /> 시뮬레이터 검증
      </div>
      <div className="tnum flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
        <span>
          <span className="text-ink-3">전력 </span>
          <b className="text-ink">{fmtKwh(e.kwh)} kWh</b>
          {dk != null && <span className={cx('ml-1', dk > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>({fmtDelta(dk, 1)})</span>}
        </span>
        <span>
          <span className="text-ink-3">요금 </span>
          <b className="text-ink">{fmtWon(e.cost_krw)}</b>
          {dc != null && Math.abs(dc) >= 1 && <span className={cx('ml-1', dc > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>({dc > 0 ? '+' : '−'}{fmtWon(Math.abs(dc))})</span>}
        </span>
        <span>
          <span className="text-ink-3">평균 체감 </span>
          <b className="text-ink">PMV {fmtPmv(e.pmv_mean)}</b>
        </span>
        {e.complaints_addressed > 0 && (
          <span>
            <span className="text-ink-3">반영한 의견(가상 포함) </span>
            <b className="text-ink">{e.complaints_addressed}건</b>
          </span>
        )}
        <span className={uncomfy.length ? 'text-warn-ink' : 'text-good-ink'}>{uncomfy.length ? `PMV ±0.5 밖: ${uncomfy.join(', ')}` : 'PMV ±0.5 밖 강의실 없음'}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- thinking trace: hops across data sources

const HOP_ORDER = ['forecast', 'nowcast', 'weather', 'climatology', 'sensor', 'co2', 'occupancy', 'density', 'events', 'timetable', 'calendar', 'feedback', 'tariff', 'policy', 'bms', 'simulator']
const HOP_BASE = ['forecast', 'co2', 'density', 'feedback', 'tariff', 'policy', 'simulator']

function DataHops({ trace, color, animate }: { trace: AgentTrace[]; color: string; animate: boolean }) {
  const nodes = useMemo(() => {
    const keys = new Set([...HOP_BASE, ...trace.map((h) => h.source)])
    const ordered = HOP_ORDER.filter((k) => keys.has(k))
    for (const k of keys) if (!ordered.includes(k)) ordered.push(k)
    return ordered
  }, [trace])
  const path = trace.map((h) => nodes.indexOf(h.source)).filter((i) => i >= 0)
  const [step, setStep] = useState(() => (animate && !reduced() ? 0 : path.length))
  const [open, setOpen] = useState<number | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    if (!animate || reduced()) {
      setStep(path.length)
      return
    }
    setStep(0)
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      setStep(i)
      if (i >= path.length) window.clearInterval(id)
    }, 650)
    return () => window.clearInterval(id)
  }, [animate, path.length])

  const N = nodes.length
  const x = (i: number) => ((i + 0.5) / N) * 100
  const visited = new Set(path.slice(0, step).map((i) => nodes[i]))
  const cursor = step > 0 ? path[Math.min(step, path.length) - 1] : null

  return (
    <div className="mt-3 rounded-[14px] bg-white/85 px-3 pt-2.5 pb-3">
      <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
        <Sparkles size={13} style={{ color }} aria-hidden /> 확인한 근거 · 데이터 {trace.length}곳 확인
      </div>
      {/* arcs between consecutive hops */}
      <div className="relative">
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="block h-[30px] w-full" aria-hidden>
          {path.slice(1).map((b, k) => {
            const a = path[k]
            if (k + 1 >= step) return null
            const x1 = x(a)
            const x2 = x(b)
            const h = a === b ? 22 : Math.max(4, 28 - Math.min(22, Math.abs(x2 - x1) * 0.6))
            const d = a === b ? `M ${x1 - 1.5} 29 C ${x1 - 5} ${h - 12} ${x1 + 5} ${h - 12} ${x1 + 1.5} 29` : `M ${x1} 29 Q ${(x1 + x2) / 2} ${h - 24} ${x2} 29`
            return (
              <path
                key={k}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={k + 2 === step && animate ? '4 3' : undefined}
                vectorEffect="non-scaling-stroke"
                opacity={k + 2 === step ? 1 : 0.55}
              />
            )
          })}
        </svg>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${N}, minmax(0,1fr))` }}>
        {nodes.map((k, i) => {
          const on = visited.has(k)
          const isCursor = cursor === i
          const order = path.map((p, j) => (p === i && j < step ? j + 1 : 0)).filter(Boolean)
          return (
            <div key={k} className="flex flex-col items-center gap-1 px-0.5" onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
              <span
                className={cx('relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] duration-300', isCursor && 'scale-110')}
                style={on ? { background: color, borderColor: color, color: '#fff' } : { background: '#fff', borderColor: '#e6e9ee', color: '#a3acb8' }}
              >
                <SourceIcon k={k} size={15} />
                {order.length > 0 && (
                  <span className="tnum absolute -top-1.5 -right-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-ink px-1 text-[10.5px] font-bold text-white">
                    {order.join('·')}
                  </span>
                )}
              </span>
              <span className={cx('max-w-full truncate text-center text-[11.5px]', on ? 'font-semibold text-ink' : 'text-ink-4')}>{sourceMeta(k).label}</span>
            </div>
          )
        })}
      </div>
      <ol className="mt-2.5 space-y-1">
        {trace.map((h, i) => {
          const shown = i < step
          const isOpen = open === i
          return (
            <li key={i} className={cx('transition-opacity duration-300', shown ? 'opacity-100' : 'opacity-0')} aria-hidden={!shown}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className={cx('flex w-full items-start gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-well', hover === h.source && 'bg-well')}
              >
                <span className="tnum mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: color }}>
                  {i + 1}
                </span>
                <span className="mt-[2px] inline-flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-ink-2">
                  <SourceIcon k={h.source} size={12} />
                  {sourceMeta(h.source).label}
                </span>
                <span className={cx('min-w-0 flex-1 text-[13px] leading-snug text-ink', !isOpen && 'truncate')}>{h.finding}</span>
                <ChevronDown size={14} className={cx('mt-[3px] shrink-0 text-ink-4 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
              {isOpen && (
                <div className="reveal ml-9 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed">
                  <div>
                    <span className="font-semibold text-ink-3">확인한 것 </span>
                    <span className="text-ink-2">{h.query}</span>
                  </div>
                  <div className="mt-0.5">
                    <span className="font-semibold text-ink-3">판단 근거 </span>
                    <span className="text-ink">{h.finding}</span>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------- consensus

function Consensus({ neg, mode }: { neg: Negotiation; mode?: OpModeKey }) {
  const f = neg.final
  const base = neg.baseline
  const key = neg.season === 'heat' ? 'sp_heat' : 'sp_cool'
  const rooms = Array.from(new Set([...Object.keys(f.proposal ?? {}), ...Object.keys(base?.rooms ?? {})])).sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b))
  const rows = rooms
    .map((r) => {
      const from = base?.rooms?.[r]?.[key] ?? null
      const to = f.proposal?.[r]?.[key] ?? from
      const kb = base?.rooms?.[r]?.kwh ?? null
      const kf = f.eval?.rooms?.[r]?.kwh ?? null
      return { r, from, to, dk: kb != null && kf != null ? kf - kb : null, pb: base?.rooms?.[r]?.pmv ?? null, pf: f.eval?.rooms?.[r]?.pmv ?? null }
    })
    .filter((x) => x.from != null || x.to != null)
  const dk = base ? f.eval.kwh - base.kwh : 0
  const dc = base ? f.eval.cost_krw - base.cost_krw : 0
  const ids = neg.adjustment_ids ?? []
  return (
    <section className="rounded-[18px] border-2 px-6 py-5" style={{ borderColor: `${AGENT_META.arbiter.color}55`, background: '#fbfaff' }} aria-label="합의 결과">
      <div className="flex flex-wrap items-center gap-3">
        <AgentAvatar agent="arbiter" size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-bold text-ink">합의안</h3>
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-[2px] text-[12.5px] font-semibold', f.agreed ? 'bg-good-bg text-good-ink' : 'bg-warn-bg text-warn-ink')}>
              {f.agreed ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
              {f.agreed ? '두 에이전트 합의' : '판정으로 절충'}
            </span>
          </div>
          {f.summary && <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{f.summary}</p>}
        </div>
      </div>
      <div className="tnum mt-4 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="text-[12.5px] font-medium text-ink-3">전력</div>
          <div className="text-[22px] font-[650] text-ink">
            {fmtKwh(f.eval.kwh)} <span className="text-[13px] font-medium text-ink-3">kWh</span>
            <span className={cx('ml-2 text-[14px] font-semibold', dk > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>{fmtDelta(dk, 1)}</span>
          </div>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-ink-3">요금</div>
          <div className="text-[22px] font-[650] text-ink">
            {fmtWon(f.eval.cost_krw)}
            {Math.abs(dc) >= 1 && <span className={cx('ml-2 text-[14px] font-semibold', dc > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>{dc > 0 ? '+' : '−'}{fmtWon(Math.abs(dc))}</span>}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-ink-3">평균 체감(PMV)</div>
          <div className="text-[22px] font-[650] text-ink">
            {fmtPmv(base?.pmv_mean)} <span className="text-[15px] text-ink-4">→</span> {fmtPmv(f.eval.pmv_mean)}
          </div>
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-ink-3">PMV ±0.5 밖 강의실</div>
          <div className="text-[22px] font-[650] text-ink">
            {(base?.cold_rooms?.length ?? 0) + (base?.hot_rooms?.length ?? 0)} <span className="text-[15px] text-ink-4">→</span> {(f.eval.cold_rooms?.length ?? 0) + (f.eval.hot_rooms?.length ?? 0)}
          </div>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="thin-scroll mt-4 overflow-x-auto">
          <table className="tnum w-full min-w-[560px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
                <th className="py-2 pr-3 font-medium">강의실</th>
                <th className="py-2 pr-3 text-right font-medium">기존 {neg.season === 'heat' ? '난방' : '냉방'}</th>
                <th className="py-2 pr-3 text-right font-medium">합의</th>
                <th className="py-2 pr-3 text-right font-medium">전력 변화</th>
                <th className="py-2 text-right font-medium">체감 PMV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const changed = x.from != null && x.to != null && Math.abs(x.from - x.to) >= 0.05
                return (
                  <tr key={x.r} className="border-b border-line/70 last:border-0">
                    <td className="py-2 pr-3 font-semibold text-ink">{x.r}호</td>
                    <td className="py-2 pr-3 text-right text-ink-2">{x.from != null ? `${x.from.toFixed(1)}℃` : '–'}</td>
                    <td className={cx('py-2 pr-3 text-right', changed ? 'font-semibold text-brand-ink' : 'text-ink-2')}>{x.to != null ? `${x.to.toFixed(1)}℃` : '–'}</td>
                    <td className={cx('py-2 pr-3 text-right', x.dk == null ? 'text-ink-3' : x.dk > 0.05 ? 'text-heat-ink' : x.dk < -0.05 ? 'text-s-ai-ink' : 'text-ink-3')}>{x.dk != null ? fmtDelta(x.dk, 2, ' kWh') : '–'}</td>
                    <td className="py-2 text-right text-ink-2">
                      {fmtPmv(x.pb)} → <span className="text-ink">{fmtPmv(x.pf)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="text-ink-2">
          {ids.length === 0
            ? '바꿀 설정온도가 없어 조정안을 만들지 않았습니다.'
            : mode === 'auto'
              ? `자동 운전 모드라 조정안 ${ids.length}건을 바로 적용하고 중앙 제어기에 명령을 보냈습니다.`
              : `추천 모드라 조정안 ${ids.length}건을 만들었습니다. 승인하면 적용됩니다.`}
        </span>
        {ids.map((id) => (
          <a key={id} href={`#adj-${id}`} className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-surface px-3 text-[13px] font-medium text-brand-ink hover:border-ink-4">
            조정안 보기 <ArrowRight size={13} aria-hidden />
          </a>
        ))}
      </div>
    </section>
  )
}
