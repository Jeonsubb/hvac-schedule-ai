import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Compass,
  MessagesSquare,
  Power,
  RefreshCw,
  Thermometer,
  Wind,
  X,
  Check,
} from 'lucide-react'
import { apiSend, invalidateAll, useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import { useAuth } from '../lib/auth'
import { Link } from 'react-router-dom'
import type { Adjustment, DataSource, Meta, TierCheck, TierDay, TierPlan, TierRoomRow, TierRun, TierRuns, Verdict } from '../lib/types'
import { ROOM_ORDER, WEEKDAY } from '../lib/constants'
import { cx, fmtDateK, fmtDateShort, fmtKwh, fmtMin, fmtWon, hm, isoDate } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { BRAND, HATCH, NowLine, PillChip, ROOM_TYPE_TONE, RoomTypeIcon, TimePills, pct } from '../components/Gantt'
import { ORIGIN_META, SourceIcon, sourceMeta } from '../components/dataSources'
import AgentDebate from '../components/AgentDebate'
import { AgentAvatar } from '../components/Characters'
import { Button, Card, CardHeader, Disclosure, DisclosureList, Empty, ErrorBox, Figure, PageHeader, PageSkeleton, Segmented, Spinner, btnCls, inputBase, toast } from '../components/ui'
import ChangeResponse from '../components/ChangeResponse'
import { Ondy } from '../components/PublicShell'
import { RunGate, RunLine, RunSteps, useTierRun } from '../components/TierRun'
import ScenarioCard from '../components/ScenarioCard'

type TierN = 1 | 2 | 3

const TIERS: Record<TierN, { label: string; title: string; desc: string; data: string; icon: typeof CalendarDays }> = {
  1: { label: '1차 · 월간', title: '월간 기본 계획', desc: '시간표·학사일정·평년 기후로 한 달 운전 계획을 세웁니다.', data: '시간표·학사일정·평년 기후·설비', icon: CalendarDays },
  2: { label: '2차 · 주간', title: '주간 조정', desc: '이번 주 예보·행사·지난주 의견과 재실 추세로 월간 계획을 다시 맞춥니다.', data: '주간 예보·행사·의견·재실 추세', icon: CalendarRange },
  3: { label: '3차 · 일일', title: '일일 검증', desc: '오늘 들어온 실황·CO₂·재실·의견으로 오늘 계획이 맞는지 검증합니다.', data: '실황·CO₂·재실 밀도·센서·의견', icon: CalendarCheck },
}

const VERDICT: Record<Verdict, { label: string; ink: string; bg: string; color: string; icon: typeof CheckCircle2 }> = {
  ok: { label: '정상', ink: '#0a6b0a', bg: '#eaf6ea', color: '#0ca30c', icon: CheckCircle2 },
  adjust: { label: '조정', ink: '#8a5a00', bg: '#fff4dc', color: '#c98500', icon: RefreshCw },
  review: { label: '확인 필요', ink: '#a12a2a', bg: '#fdeeee', color: '#d03b3b', icon: AlertTriangle },
}

const ORIGIN_LABEL: Record<Adjustment['origin'], string> = { tier: '정합성 점검', agents: '에이전트 협의', feedback: '쾌적 의견' }
const VENT_LABEL: Record<string, string> = { low: '약', mid: '중', high: '강' }

/** Guard the response: missing arrays become empty, unknown verdicts fall back to review. */
function normalize(p: TierPlan | undefined): TierPlan | undefined {
  if (!p || typeof p !== 'object') return undefined
  return {
    ...p,
    summary: p.summary ?? { sentence: '', kwh: 0, baseline_kwh: 0, cost_krw: 0, saving_pct: null, sessions: 0, comfort_pct: null },
    sources: Array.isArray(p.sources) ? p.sources : [],
    checks: (Array.isArray(p.checks) ? p.checks : []).map((c) => ({ ...c, verdict: VERDICT[c.verdict] ? c.verdict : 'review', sources: c.sources ?? [] })),
    adjustments: Array.isArray(p.adjustments) ? p.adjustments : [],
    days: Array.isArray(p.days) ? p.days : [],
    rooms: Array.isArray(p.rooms) ? p.rooms : [],
  }
}

export default function Plan() {
  const { meta } = useMeta()
  const [params, setParams] = useSearchParams()
  const tier = (Number(params.get('tier')) || 3) as TierN
  const t: TierN = tier === 1 || tier === 2 || tier === 3 ? tier : 3
  const date = params.get('date')
  const debateOpen = params.get('debate') === '1'
  // the plan is computed when the operator asks (RunGate); until then nothing is fetched or shown
  const runs = useApi<TierRuns>('/api/plan/runs', { maxAgeMs: 10_000 })
  const runDate = date ?? runs.data?.defaults?.[String(t)] ?? null
  const ran = useMemo(() => (Array.isArray(runs.data?.runs) ? runs.data!.runs.find((r) => r.tier === t && r.date === runDate) : undefined), [runs.data, t, runDate])
  const tr = useTierRun(t, date)
  const url = `/api/plan/tier/${t}${date ? `?date=${date}` : ''}`
  const res = useApi<TierPlan>(ran ? url : null, { maxAgeMs: 60_000 })
  const plan = normalize(res.data?.tier === t ? res.data : undefined)

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') p.delete(k)
      else p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  const anchor = date ?? plan?.period.start ?? meta?.now.date ?? isoDate(new Date())
  const { user } = useAuth()
  if (user?.applied === false)
    return (
      <div>
        <PageHeader title="AI 스케줄링" desc="1차 월간 계획을 2차 주간, 3차 일일 데이터로 다시 검증하고, 맞지 않으면 조정합니다." />
        <Card>
          <Empty
            art={<Ondy pose="schedule" size={128} pop />}
            title="아직 AI 스케줄이 없습니다"
            desc="운전 현황 화면 오른쪽 위의 '시간표 넣기'로 시간표를 반영하면 1차 스케줄이 만들어지고, AI 운전을 적용하면 2·3차 검증이 이어집니다."
            action={
              <Link to="/" className={btnCls('primary', 'md')}>
                운전 현황으로 가기
              </Link>
            }
          />
        </Card>
      </div>
    )

  return (
    <div>
      <PageHeader
        title="AI 스케줄링"
        desc="1차 월간 계획을 2차 주간, 3차 일일 데이터로 다시 검증하고, 맞지 않으면 조정합니다."
        right={
          <>
            <label className="sr-only" htmlFor="plan-date">
              기준 날짜
            </label>
            <input
              id="plan-date"
              name="date"
              type="date"
              className={cx(inputBase, 'tnum h-10 w-[160px]')}
              value={anchor}
              min={meta?.semester.start}
              max={meta?.semester.end}
              onChange={(e) => set({ date: e.target.value || null })}
            />
          </>
        }
      />

      <div data-tour="plan-tiers" className="mb-2">
        <TierPipeline tier={t} onChange={(n) => set({ tier: String(n), debate: n === 1 ? null : params.get('debate') })} />
      </div>

      {runs.error && !runs.data ? (
        <div className="mt-6">
          <ErrorBox title="계산 기록을 불러오지 못했습니다" error={runs.error} onRetry={runs.reload} />
        </div>
      ) : !runs.data || !meta ? (
        <div className="mt-6">
          <PageSkeleton label="불러오는 중…" />
        </div>
      ) : !ran ? (
        <div className="mt-6 space-y-6">
          <RunGate key={`${t}:${runDate}`} tier={t} run={tr} data-tour="plan-summary" />
          {t === 3 && <ChangeResponse />}
        </div>
      ) : res.error && !plan ? (
        <div className="mt-6">
          <ErrorBox title={`${TIERS[t].label} 계획을 불러오지 못했습니다`} error={res.error} onRetry={res.reload} />
        </div>
      ) : !plan ? (
        <div className="mt-6">
          <PageSkeleton label={`${TIERS[t].label} 계획을 불러오는 중…`} />
        </div>
      ) : (
        <div className={cx('mt-6 space-y-6 transition-opacity duration-200', res.loading && 'opacity-60')}>
          {tr.running || (tr.steps && tr.steps.length > 0 && !tr.result && !tr.err) ? (
            <Card>
              <CardHeader title={`${TIERS[t].label} 다시 계산 중`} sub="지금 데이터로 처음부터 다시 계산합니다. 끝나면 아래 내용이 바뀝니다." />
              <RunSteps tier={t} steps={tr.steps ?? []} shown={tr.shown} running={tr.running} done={tr.done} />
            </Card>
          ) : null}
          {tr.err && <ErrorBox title="다시 계산하지 못했습니다" error={tr.err} />}
          <div data-tour="plan-summary" className="reveal">
            <SummaryRow plan={plan} run={ran} onRerun={tr.start} rerunning={tr.running} onDebate={t === 1 ? undefined : () => set({ debate: debateOpen ? null : '1' })} debateOpen={debateOpen} />
          </div>
          {ran?.scenarios && ran.scenarios.scenarios?.length > 0 && <ScenarioCard r={ran.scenarios} />}
          {t === 3 && <ChangeResponse />}
          {/* only what the operator has to look at; the room-by-room visual is one click away */}
          {plan.checks.every((c) => c.verdict === 'ok') && plan.adjustments.length === 0 ? (
            <div data-tour="plan-checks">
              <AllClear checks={plan.checks} />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <div data-tour="plan-checks" className="min-w-0">
                <ChecksCard checks={plan.checks} />
              </div>
              <div data-tour="plan-adjustments" className="min-w-0">
                <AdjustmentsCard items={plan.adjustments} mode={plan.mode} onChanged={() => invalidateAll()} />
              </div>
            </div>
          )}
          <div data-tour="plan-sources">
            <DisclosureList title="자세히" hideTitle>
              <Disclosure title={t === 1 ? '날짜별 계획 전력과 강의실별 운전' : t === 2 ? '이번 주 날짜별 계획과 강의실별 운전' : '오늘 강의실별 운전 시간'}>
                <div data-tour="plan-visual">
                  <TierVisual plan={plan} meta={meta} />
                </div>
              </Disclosure>
              <Disclosure title="이번 판단에 쓴 데이터" summary={`${plan.sources.length}개 · 실데이터 ${plan.sources.filter((x) => x.origin === 'live').length}개`}>
                <SourcesStrip sources={plan.sources} bare />
              </Disclosure>
            </DisclosureList>
          </div>
          {t !== 1 && debateOpen && (
            <section id="debate" data-tour="plan-debate" className="scroll-mt-24">
              <AgentDebate tier={t as 2 | 3} date={anchor} mode={plan.mode} onChanged={() => invalidateAll()} />
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- header pieces

/** 1차 → 2차 → 3차 is a real sequence: drawn like the landing's step track, filled up to the chosen tier. */
function TierPipeline({ tier, onChange }: { tier: TierN; onChange: (t: TierN) => void }) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-3" role="tablist" aria-label="스케줄 차수">
      {([1, 2, 3] as TierN[]).map((n) => {
        const m = TIERS[n]
        const on = n === tier
        return (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(n)}
            className={cx('group block rounded-[4px] text-left transition-colors duration-200', on ? 'text-ink' : 'text-ink-3 hover:text-ink')}
          >
            <span
              className={cx('block h-[3px] rounded-full transition-colors duration-300', on ? 'bg-brand' : n < tier ? 'bg-brand/35' : 'bg-line group-hover:bg-line-strong')}
              aria-hidden
            />
            <span className="mt-4 flex items-baseline gap-2.5">
              <span className={cx('tnum text-[28px] leading-[1.1] font-bold tracking-[-0.03em]', on ? 'text-ink' : 'text-ink-4 group-hover:text-ink-3')}>{n}차</span>
              <span className="text-[16px] leading-[1.35] font-semibold tracking-[-0.01em]">{m.title}</span>
            </span>
            <span className="mt-1.5 block truncate text-[13px] leading-[1.5] text-ink-3">{m.data}</span>
          </button>
        )
      })}
    </div>
  )
}

function SummaryRow({
  plan,
  run,
  onRerun,
  rerunning,
  onDebate,
  debateOpen,
}: {
  plan: TierPlan
  run?: TierRun
  onRerun?: () => void
  rerunning?: boolean
  onDebate?: () => void
  debateOpen: boolean
}) {
  const s = plan.summary
  const counts = { ok: 0, adjust: 0, review: 0 }
  for (const c of plan.checks) counts[c.verdict] += 1
  return (
    <Card pad="lg">
      {run && onRerun && (
        <div className="mb-5 border-b border-line pb-4">
          <RunLine run={run} onRerun={onRerun} running={!!rerunning} />
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-6">
        <div className="min-w-0 flex-[1_1_28rem]">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink-3">
            <span className="rounded-full bg-well px-2.5 py-0.5 font-semibold text-ink-2">{plan.label || TIERS[plan.tier].label}</span>
            <span className="tnum">{plan.period.label || `${fmtDateK(plan.period.start)} – ${fmtDateK(plan.period.end)}`}</span>
          </div>
          <p className="pretty mt-3 max-w-[56ch] text-[18px] leading-[1.55] font-medium text-ink">{s.sentence || TIERS[plan.tier].desc}</p>
          {onDebate && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onDebate}
                aria-expanded={debateOpen}
                aria-controls="debate"
                className="inline-flex h-11 items-center gap-2.5 rounded-full pr-5 pl-1.5 text-[14.5px] font-semibold text-white shadow-[0_6px_18px_rgb(47_111_222/0.28)] transition-[background-color] duration-150 hover:bg-brand-ink"
                style={{ background: BRAND }}
              >
                <span className="flex -space-x-2">
                  <AgentAvatar agent="building" size={32} className="ring-2 ring-white" />
                  <AgentAvatar agent="occupant" size={32} className="ring-2 ring-white" />
                </span>
                <MessagesSquare size={16} aria-hidden />
                {debateOpen ? '에이전트 협의 닫기' : '에이전트 협의 열기'}
              </button>
              <span className="text-[13.5px] text-ink-3">관리자 온디(요금·전력)와 사용자 온디(쾌적)가 설정온도를 두고 협의합니다.</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <Figure
            label="기존 방식 대비 전력"
            value={s.saving_pct != null ? `−${Math.abs(s.saving_pct).toFixed(1)}` : '–'}
            unit={s.saving_pct != null ? '%' : undefined}
            sub={`${fmtKwh(s.baseline_kwh)} → ${fmtKwh(s.kwh)} kWh${s.cost_krw ? ` · 요금 ${fmtWon(s.cost_krw)}` : ''} (시뮬레이션)`}
            accent="#14a673"
          />
          <Figure
            label="정합성 점검"
            value={
              <span className="flex items-baseline gap-3 text-[26px]">
                <span style={{ color: VERDICT.ok.color }}>{counts.ok}</span>
                <span style={{ color: VERDICT.adjust.color }}>{counts.adjust}</span>
                <span style={{ color: VERDICT.review.color }}>{counts.review}</span>
              </span>
            }
            sub="정상, 조정, 확인 필요"
          />
        </div>
      </div>
    </Card>
  )
}

function SourcesStrip({ sources, bare = false }: { sources: DataSource[]; bare?: boolean }) {
  if (!sources.length) return null
  const Wrap = bare ? ({ children }: { children: React.ReactNode }) => <div>{children}</div> : Card
  return (
    <Wrap>
      {!bare && <CardHeader title="이번 판단에 쓴 데이터" sub="AI가 이 차수에서 읽은 데이터입니다. 실데이터와 시뮬레이션 센서, 운영자 입력, 가정값을 구분합니다." />}
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {sources.map((s) => {
          const o = ORIGIN_META[s.origin] ?? ORIGIN_META.assumption
          const dot = s.status === 'ok' ? '#0ca30c' : s.status === 'stale' ? '#fab219' : '#d03b3b'
          return (
            <li key={s.key + s.label} className="flex items-start gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3" title={s.detail}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-well text-ink-2">
                <SourceIcon k={s.key} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-semibold text-ink">{s.label || sourceMeta(s.key).label}</span>
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-label={s.status === 'ok' ? '정상' : s.status === 'stale' ? '지난 값' : '없음'} />
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{s.detail}</span>
                <span className="mt-1.5 inline-flex rounded-[6px] px-1.5 py-[1px] text-[12px] font-semibold" style={{ background: o.bg, color: o.ink }}>
                  {o.label}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </Wrap>
  )
}

// ---------------------------------------------------------------- checks & adjustments

/** Nothing to act on: one line instead of every check, the full list one click away. */
function AllClear({ checks }: { checks: TierCheck[] }) {
  const [open, setOpen] = useState(false)
  if (open) return <ChecksCard checks={checks} />
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <Ondy pose="comfort" size={84} pop />
          <div>
            <div className="flex items-center gap-2 text-[17px] leading-[1.35] font-[650] tracking-[-0.015em] text-ink">
              <CheckCircle2 size={18} className="text-good" aria-hidden /> 계획이 새 데이터와 모두 맞고, 승인할 조정안이 없습니다
            </div>
            <div className="mt-1 text-[13.5px] text-ink-3">점검 {checks.length}개: {checks.map((c) => c.title).join(', ')}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          점검 {checks.length}개 보기
        </Button>
      </div>
    </Card>
  )
}

function ChecksCard({ checks }: { checks: TierCheck[] }) {
  const attn = checks.filter((c) => c.verdict !== 'ok')
  const [filter, setFilter] = useState<'attn' | 'all'>('attn')
  const shown = filter === 'all' ? checks : attn
  return (
    <Card>
      <CardHeader
        title={attn.length ? `새 데이터와 어긋난 곳 ${attn.length}개` : '계획이 새 데이터와 모두 맞습니다'}
        sub={`점검 ${checks.length}개 중 ${checks.length - attn.length}개는 정상이라 접어 두었습니다. 어긋난 곳은 AI가 조정했거나 확인이 필요합니다.`}
        right={
          <Segmented
            size="sm"
            label="보기"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'attn', label: `어긋난 곳 ${attn.length}` },
              { value: 'all', label: `전체 ${checks.length}` },
            ]}
          />
        }
      />
      {shown.length === 0 ? (
        <Empty title={checks.length ? '어긋난 곳이 없습니다' : '점검 결과가 없습니다'} desc={checks.length ? '"전체"를 누르면 정상인 점검도 볼 수 있습니다.' : '이 기간에는 비교할 데이터가 아직 없습니다.'} />
      ) : (
        <ol className="space-y-3">
          {shown.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ol>
      )}
    </Card>
  )
}

function CheckRow({ c }: { c: TierCheck }) {
  const v = VERDICT[c.verdict]
  return (
    <li className="rounded-[14px] border border-line px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: v.bg, color: v.color }}>
          <v.icon size={15} strokeWidth={2.4} aria-hidden />
        </span>
        <span className="text-[15px] font-semibold text-ink">{c.title}</span>
        {c.idea != null && (
          <span className="rounded-full bg-brand-bg px-2 py-[1px] text-[12px] font-semibold text-brand-ink" title="과제가 제시한 아이디어 번호">
            아이디어 {c.idea}
          </span>
        )}
        <span className="ml-auto rounded-full px-2.5 py-[1px] text-[12.5px] font-semibold" style={{ background: v.bg, color: v.ink }}>
          {v.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="rounded-[10px] bg-well px-3 py-2">
          <div className="text-[12px] font-semibold text-ink-3">계획 가정</div>
          <div className="mt-0.5 text-[13.5px] leading-snug text-ink-2">{c.expected || '–'}</div>
        </div>
        <div className="hidden items-center justify-center text-ink-4 sm:flex" aria-hidden>
          <ArrowRight size={16} />
        </div>
        <div className="rounded-[10px] bg-well px-3 py-2">
          <div className="text-[12px] font-semibold text-ink-3">새 데이터</div>
          <div className="mt-0.5 text-[13.5px] leading-snug text-ink">{c.observed || '–'}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-start gap-2 text-[13.5px] leading-snug">
        <span className="shrink-0 font-semibold text-brand-ink">AI 판단</span>
        <span className="text-ink">{c.action}</span>
      </div>
      {(c.sources.length > 0 || (c.rooms?.length ?? 0) > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {c.sources.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-[1px] text-[12px] text-ink-2">
              <SourceIcon k={k} size={12} />
              {sourceMeta(k).label}
            </span>
          ))}
          {(c.rooms ?? []).slice(0, 8).map((r) => (
            <span key={r} className="tnum rounded-full bg-well px-2 py-[1px] text-[12px] font-medium text-ink-2">
              {r}호
            </span>
          ))}
          {(c.rooms?.length ?? 0) > 8 && <span className="text-[12px] text-ink-3">외 {(c.rooms?.length ?? 0) - 8}실</span>}
        </div>
      )}
    </li>
  )
}

function fmtSigned(v: number | null | undefined, digits = 1, unit = '') {
  if (v == null || Number.isNaN(v)) return '–'
  const s = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${s}${Math.abs(v).toFixed(digits)}${unit}`
}

function changeText(a: Adjustment) {
  const parts: string[] = []
  if (a.change.sp_heat != null) parts.push(`난방 ${a.change.sp_heat.toFixed(1)}℃`)
  if (a.change.sp_cool != null) parts.push(`냉방 ${a.change.sp_cool.toFixed(1)}℃`)
  if (a.change.vent) parts.push(`환기 ${VENT_LABEL[a.change.vent] ?? a.change.vent} 단계`)
  return parts.join(', ') || '변경 없음'
}

function AdjustmentsCard({ items, mode, onChanged }: { items: Adjustment[]; mode: TierPlan['mode']; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [local, setLocal] = useState<Record<string, Adjustment>>({})
  const list = items.map((a) => local[a.id] ?? a)
  const pending = list.filter((a) => a.status === 'pending').length

  const decide = async (a: Adjustment, action: 'approve' | 'reject') => {
    setBusy(a.id)
    try {
      const r = await apiSend<Adjustment>('POST', `/api/adjustments/${encodeURIComponent(a.id)}/${action}`)
      setLocal((m) => ({ ...m, [a.id]: r && r.id ? r : { ...a, status: action === 'approve' ? 'applied' : 'rejected' } }))
      toast(action === 'approve' ? `${a.title}: 적용하고 중앙 제어기에 명령을 보냈습니다.` : `${a.title}: 거절했습니다.`, action === 'approve' ? 'good' : 'neutral')
      onChanged()
    } catch (e) {
      toast(`처리하지 못했습니다. ${(e as Error).message}`, 'crit')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title="조정안"
        sub={mode === 'auto' ? '자동 운전 모드: 조정안은 만들어지는 즉시 적용되고 제어 명령이 기록됩니다.' : `추천 모드: 승인해야 적용됩니다.${pending ? ` 승인 대기 ${pending}건.` : ''}`}
      />
      {list.length === 0 ? (
        <Empty title="이 기간의 조정안이 없습니다" desc="데이터가 계획과 맞으면 조정하지 않습니다. 에이전트 협의를 열면 설정온도 조정안을 새로 만들 수 있습니다." />
      ) : (
        <ul className="space-y-3">
          {list.map((a) => (
            <AdjustmentRow key={a.id} a={a} busy={busy === a.id} onDecide={(act) => decide(a, act)} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function AdjustmentRow({ a, busy, onDecide }: { a: Adjustment; busy: boolean; onDecide: (a: 'approve' | 'reject') => void }) {
  const st =
    a.status === 'applied'
      ? { label: '적용됨', bg: '#eaf6ea', ink: '#0a6b0a' }
      : a.status === 'rejected'
        ? { label: '거절', bg: '#f7f8fa', ink: '#667183' }
        : { label: '승인 대기', bg: '#fff4dc', ink: '#8a5a00' }
  const Icon = a.kind === 'vent' ? Wind : Thermometer
  const imp = a.impact ?? { kwh: 0, cost_krw: 0 }
  return (
    <li id={`adj-${a.id}`} className={cx('scroll-mt-24 rounded-[14px] border px-4 py-3.5', a.status === 'pending' ? 'border-[#f1d9a3]' : 'border-line', a.status === 'rejected' && 'opacity-65')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-well text-ink-2">
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-semibold text-ink">{a.title}</span>
            <span className="rounded-full px-2 py-[1px] text-[12px] font-semibold" style={{ background: st.bg, color: st.ink }}>
              {st.label}
            </span>
            <span className="rounded-full border border-line px-2 py-[1px] text-[12px] text-ink-3">{ORIGIN_LABEL[a.origin] ?? a.origin}</span>
          </div>
          <div className="tnum mt-1 text-[13px] text-ink-3">
            {(a.rooms ?? []).map((r) => `${r}호`).join(', ') || '전체'} ·{' '}
            {a.date_from === a.date_to ? fmtDateShort(a.date_from) : `${fmtDateShort(a.date_from)}–${fmtDateShort(a.date_to)}`} · {changeText(a)}
          </div>
          {a.reason && <p className="mt-1.5 text-[13.5px] leading-snug text-ink-2">{a.reason}</p>}
          <div className="tnum mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <span>
              <span className="text-ink-3">전력 </span>
              <b className={cx('font-semibold', imp.kwh > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>{fmtSigned(imp.kwh, 1, ' kWh')}</b>
            </span>
            <span>
              <span className="text-ink-3">요금 </span>
              <b className="font-semibold text-ink">{imp.cost_krw ? `${imp.cost_krw > 0 ? '+' : '−'}${fmtWon(Math.abs(imp.cost_krw))}` : '±0원'}</b>
            </span>
            {(imp.pmv_before != null || imp.pmv_after != null) && (
              <span>
                <span className="text-ink-3">체감(PMV) </span>
                <b className="font-semibold text-ink">
                  {fmtSigned(imp.pmv_before, 2)} → {fmtSigned(imp.pmv_after, 2)}
                </b>
              </span>
            )}
          </div>
          {imp.note && <div className="mt-1 text-[12.5px] text-ink-3">{imp.note}</div>}
          {(a.evidence ?? []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {a.evidence.slice(0, 4).map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-2">
                  <span className="mt-[1px] inline-flex shrink-0 items-center gap-1 rounded-full bg-well px-1.5 text-[11.5px] font-medium text-ink-3">
                    <SourceIcon k={e.source} size={11} />
                    {sourceMeta(e.source).label}
                  </span>
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          )}
          {a.status === 'pending' && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide('approve')}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#2a2e37] disabled:opacity-50"
              >
                {busy ? <Spinner size={14} className="text-white" /> : <Check size={15} aria-hidden />} 승인하고 적용
              </button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide('reject')} className="h-9">
                <X size={14} aria-hidden /> 거절
              </Button>
            </div>
          )}
          {a.status !== 'pending' && a.decided_at && (
            <div className="mt-2 text-[12.5px] text-ink-3">
              {a.decided_by ? `${a.decided_by} · ` : ''}
              {a.decided_at.slice(5, 16).replace('T', ' ')}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------- tier visuals

function TierVisual({ plan, meta }: { plan: TierPlan; meta: Meta }) {
  if (plan.tier === 1) return <MonthVisual plan={plan} meta={meta} />
  if (plan.tier === 2) return <WeekVisual plan={plan} meta={meta} />
  return <DayVisual plan={plan} meta={meta} />
}

const SRC_LABEL: Record<TierDay['src'], string> = { actual: '실측', forecast: '예보', climatology: '평년' }

function MonthVisual({ plan, meta }: { plan: TierPlan; meta: Meta }) {
  const days = plan.days ?? []
  const byDate = useMemo(() => Object.fromEntries(days.map((d) => [d.date, d])), [days])
  const max = Math.max(1, ...days.map((d) => d.kwh))
  const start = plan.period.start
  const [y, m] = start.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(isoDate(new Date(y, m - 1, d)))
  while (cells.length % 7) cells.push(null)
  const today = meta.now.date

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`${y}년 ${m}월 일별 계획 전력`}
          sub="칸이 진할수록 AI 계획 전력이 큽니다. 실선은 실측, 점선은 예보, 옅은 칸은 평년 기후로 계산했습니다."
        />
        <div className="grid grid-cols-7 gap-1.5 text-center text-[13px] font-medium text-ink-3">
          {WEEKDAY.map((w, i) => (
            <div key={w} className={cx('pb-1', i === 5 && 'text-info-ink', i === 6 && 'text-crit-ink')}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const x = byDate[d]
            const a = x ? 0.05 + 0.5 * (x.kwh / max) : 0
            const isT = d === today
            return (
              <div
                key={d}
                className={cx(
                  'relative flex h-[66px] flex-col rounded-[10px] px-2 py-1.5',
                  x?.src === 'forecast' && 'border border-dashed border-[#9fb7e6]',
                  x?.src === 'climatology' && 'border border-dotted border-line-strong',
                  (!x || x.src === 'actual') && 'border border-line',
                  isT && 'shadow-[0_0_0_2px_var(--color-brand)]',
                )}
                style={x && x.sessions > 0 ? { background: `rgba(47,111,222,${a.toFixed(3)})` } : !x?.workday ? HATCH : undefined}
                title={
                  x
                    ? `${fmtDateK(d)}${x.holiday ? `, ${x.holiday}` : ''}\n수업 ${x.sessions}건${x.events ? `, 이벤트 ${x.events}건` : ''}\nAI ${fmtKwh(x.kwh)} kWh · 현재 운영 ${fmtKwh(x.baseline_kwh)} kWh\n외기 ${x.t_min.toFixed(1)}~${x.t_max.toFixed(1)}℃ (${SRC_LABEL[x.src] ?? x.src})`
                    : fmtDateK(d)
                }
              >
                <span className="flex items-center gap-1">
                  <span className={cx('tnum text-[13px] font-semibold', x?.holiday ? 'text-crit-ink' : 'text-ink', isT && 'rounded-full bg-brand px-1.5 text-white')}>{Number(d.slice(8))}</span>
                  {x && x.sessions > 0 && x.src !== 'actual' && <span className="ml-auto text-[11px] font-medium text-ink-3">{SRC_LABEL[x.src]}</span>}
                  {x?.adjusted && <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full bg-brand', (x.src === 'actual' || !x.sessions) && 'ml-auto')} title="적용된 조정이 있는 날" aria-label="조정 적용" />}
                </span>
                {x?.holiday ? (
                  <span className="mt-auto truncate text-[12px] font-medium text-crit-ink">{x.holiday}</span>
                ) : x && x.sessions > 0 ? (
                  <span className="mt-auto">
                    <span className="tnum block text-[13px] font-semibold text-ink">{fmtKwh(x.kwh)}</span>
                    <span className="block text-[11.5px] text-ink-3">수업 {x.sessions}</span>
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>
      <DisclosureList title="월간 계획 자세히" hideTitle className="self-start">
        <Disclosure title="강의실 × 요일 수업 패턴" summary="월간 계획의 뼈대">
          <p className="mb-3 text-[13.5px] text-ink-3">막대는 08–22시 사이 수업 시간이고, 이 패턴에 예열·관성 정지를 더해 운전 시간을 정합니다.</p>
          <WeekPattern rooms={plan.rooms ?? []} meta={meta} />
        </Disclosure>
      </DisclosureList>
    </div>
  )
}

function WeekPattern({ rooms, meta }: { rooms: TierRoomRow[]; meta: Meta }) {
  const R: [number, number] = [480, 1320]
  const list = [...rooms].sort((a, b) => ROOM_ORDER.indexOf(a.room) - ROOM_ORDER.indexOf(b.room))
  if (!list.length) return <Empty title="수업 패턴이 없습니다" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-y-1.5 text-[13px]">
        <thead>
          <tr className="text-ink-3">
            <th className="w-[92px] pb-1 text-left font-medium">강의실</th>
            {[0, 1, 2, 3, 4, 5].map((w) => (
              <th key={w} className="pb-1 text-center font-medium">
                {WEEKDAY[w]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const tone = ROOM_TYPE_TONE[meta.rooms[r.room]?.type ?? 'lecture'] ?? ROOM_TYPE_TONE.lecture
            return (
              <tr key={r.room}>
                <td className="pr-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <span className="flex h-6 w-6 items-center justify-center rounded-[7px]" style={{ background: tone.bg, color: tone.ink }}>
                      <RoomTypeIcon type={meta.rooms[r.room]?.type} size={13} />
                    </span>
                    <span className="tnum">{r.room}</span>
                  </span>
                </td>
                {[0, 1, 2, 3, 4, 5].map((w) => {
                  const blocks = r.week?.[w] ?? (r.week as Record<string, typeof r.windows> | undefined)?.[String(w)] ?? []
                  return (
                    <td key={w} className="px-0.5">
                      <div className="relative h-[22px] overflow-hidden rounded-[7px] bg-well" title={blocks?.map((b) => `${fmtMin(b.s)}–${fmtMin(b.e)}${b.label ? ` ${b.label}` : ''}`).join('\n')}>
                        {(blocks ?? []).map((b, i) => (
                          <div
                            key={i}
                            className="absolute inset-y-[3px] rounded-[4px]"
                            style={{ left: `${pct(b.s, R[0], R[1])}%`, width: `${Math.max(2, pct(b.e, R[0], R[1]) - pct(b.s, R[0], R[1]))}%`, background: tone.ink, opacity: 0.75 }}
                          />
                        ))}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WeekVisual({ plan, meta }: { plan: TierPlan; meta: Meta }) {
  const days = plan.days ?? []
  const max = Math.max(1, ...days.map((d) => Math.max(d.kwh, d.baseline_kwh)))
  const rooms = [...(plan.rooms ?? [])].sort((a, b) => ROOM_ORDER.indexOf(a.room) - ROOM_ORDER.indexOf(b.room))
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="이번 주 7일" sub="주간 예보와 행사를 반영한 날별 AI 계획 전력입니다. 회색 막대는 현재 운영(고정 스케줄)입니다." />
        {days.length === 0 ? (
          <Empty title="주간 데이터가 없습니다" />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7">
            {days.map((d) => {
              const isT = d.date === meta.now.date
              return (
                <div
                  key={d.date}
                  className={cx('flex flex-col rounded-[14px] border px-3.5 py-3', isT ? 'border-transparent shadow-[0_0_0_2px_var(--color-brand)]' : 'border-line')}
                  style={!d.workday && !d.sessions ? HATCH : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className={cx('text-[14px] font-bold', d.holiday || d.weekday === 6 ? 'text-crit-ink' : d.weekday === 5 ? 'text-info-ink' : 'text-ink')}>
                      {WEEKDAY[d.weekday]} <span className="tnum font-semibold text-ink-2">{fmtDateShort(d.date)}</span>
                    </span>
                    {d.adjusted && <span className="inline-block h-2 w-2 rounded-full bg-brand" title="적용된 조정이 있는 날" aria-label="조정 적용" />}
                  </div>
                  <div className="tnum mt-1 text-[12.5px] text-ink-3">
                    {d.t_min.toFixed(0)}~{d.t_max.toFixed(0)}℃ · {SRC_LABEL[d.src] ?? d.src}
                  </div>
                  <div className="mt-2 text-[12.5px] text-ink-2">{d.holiday ?? (d.sessions ? `수업 ${d.sessions}${d.events ? ` · 행사 ${d.events}` : ''}` : '수업 없음')}</div>
                  <div className="mt-auto space-y-1 pt-3" aria-label={`AI ${fmtKwh(d.kwh)} kWh, 현재 운영 ${fmtKwh(d.baseline_kwh)} kWh`}>
                    <div className="h-2 rounded-full bg-well">
                      <div className="h-2 rounded-full" style={{ width: `${(d.kwh / max) * 100}%`, background: '#14a673' }} />
                    </div>
                    <div className="h-2 rounded-full bg-well">
                      <div className="h-2 rounded-full bg-[#9aa1aa]" style={{ width: `${(d.baseline_kwh / max) * 100}%` }} />
                    </div>
                    <div className="tnum pt-0.5 text-[13px] font-semibold text-ink">{fmtKwh(d.kwh)} kWh</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
      <DisclosureList title="주간 계획 자세히" hideTitle>
        <Disclosure title="강의실별 주간 계획" summary="설정온도 · CO₂ · 환기 · 의견 · 일사">
          <p className="mb-3 text-[13.5px] text-ink-3">설정온도는 적용된 조정을 포함합니다. CO₂ 최고값은 예상 인원과 환기 단계로 예측했고, 일사는 방향을 반영한 오후 부하입니다.</p>
          <RoomTable rooms={rooms} meta={meta} />
        </Disclosure>
      </DisclosureList>
    </div>
  )
}

function co2Tone(v: number | null) {
  if (v == null) return 'text-ink-3'
  if (v > 1000) return 'text-crit-ink font-semibold'
  if (v > 850) return 'text-warn-ink font-semibold'
  return 'text-ink'
}

function feedbackText(f: TierRoomRow['feedback']) {
  if (!f || !f.n) return '–'
  const m = f.mean
  const word = m == null ? '' : m <= -1 ? '추움' : m <= -0.4 ? '약간 추움' : m >= 1 ? '더움' : m >= 0.4 ? '약간 더움' : '적당'
  return `${f.n}건${word ? ` · ${word}` : ''}`
}

function RoomTable({ rooms, meta, today = false }: { rooms: TierRoomRow[]; meta: Meta; today?: boolean }) {
  const sp0 = { h: Number(meta.settings?.sp_heat ?? 20), c: Number(meta.settings?.sp_cool ?? 26) }
  if (!rooms.length) return <Empty title="강의실 데이터가 없습니다" />
  return (
    <div className="thin-scroll overflow-x-auto px-6 pb-6">
      <table className="tnum w-full min-w-[820px] text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
            <th className="py-2 pr-3 font-medium">강의실</th>
            <th className="py-2 pr-3 font-medium">방향·오후 일사</th>
            <th className="py-2 pr-3 text-right font-medium">수업</th>
            <th className="py-2 pr-3 text-right font-medium">{today ? '최대 인원' : '예상 인원'}</th>
            <th className="py-2 pr-3 text-right font-medium">난방 / 냉방</th>
            <th className="py-2 pr-3 text-right font-medium">CO₂ 최고</th>
            <th className="py-2 pr-3 text-center font-medium">환기</th>
            <th className="py-2 pr-3 font-medium">쾌적 의견</th>
            <th className="py-2 text-right font-medium">AI 전력</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => {
            const changed = r.sp_heat !== sp0.h || r.sp_cool !== sp0.c
            return (
              <tr key={r.room} className="border-b border-line/70 last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="font-semibold text-ink">{r.room}호</span> <span className="text-[12.5px] text-ink-3">{r.type}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="inline-flex items-center gap-1 text-ink-2">
                    <Compass size={13} className="text-ink-3" aria-hidden />
                    {r.orient || '–'}향
                    <span className="text-ink-3">· {r.solar_index.toFixed(1)} kW</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right">{r.sessions}</td>
                <td className="py-2.5 pr-3 text-right">{r.people}명</td>
                <td className={cx('py-2.5 pr-3 text-right', changed && 'font-semibold text-brand-ink')} title={changed ? '조정이 적용된 설정온도' : undefined}>
                  {r.sp_heat.toFixed(1)} / {r.sp_cool.toFixed(1)}℃
                </td>
                <td className={cx('py-2.5 pr-3 text-right', co2Tone(r.co2_peak))}>{r.co2_peak != null ? `${Math.round(r.co2_peak).toLocaleString('ko-KR')} ppm` : '–'}</td>
                <td className="py-2.5 pr-3 text-center">
                  <span className={cx('rounded-full px-2 py-[1px] text-[12px] font-semibold', r.vent === 'high' ? 'bg-info-bg text-info-ink' : 'bg-well text-ink-2')}>{VENT_LABEL[r.vent] ?? r.vent}</span>
                </td>
                <td className="py-2.5 pr-3 text-ink-2">{feedbackText(r.feedback)}</td>
                <td className="py-2.5 text-right font-semibold text-ink">{fmtKwh(r.kwh)} kWh</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---- tier 3: today's room timeline + weather + CO2

function DayVisual({ plan, meta }: { plan: TierPlan; meta: Meta }) {
  const rooms = [...(plan.rooms ?? [])].sort((a, b) => ROOM_ORDER.indexOf(a.room) - ROOM_ORDER.indexOf(b.room))
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`${fmtDateK(plan.period.start)} 강의실별 운전`}
          sub="회색 알약은 수업, 초록 알약은 AI가 오늘 데이터로 다시 확인한 운전 구간입니다. 빗금은 정규 운영 시간 밖입니다."
        />
        <RoomDayTimeline rooms={rooms} meta={meta} nowMinute={plan.now_minute ?? null} />
      </Card>
      <DisclosureList title="오늘 데이터 자세히" hideTitle>
        <Disclosure title="예보 대비 실황" summary="차이가 크면 운전 계획을 다시 계산">
          <p className="mb-3 text-[13.5px] text-ink-3">계획에 쓴 예보(점선)와 실제로 들어온 기온(실선)입니다.</p>
          <WeatherChart plan={plan} />
        </Disclosure>
        <Disclosure title="CO₂와 재실" summary="강의실별 15분 간격, 시뮬레이션 센서">
          <CO2Panel plan={plan} rooms={rooms} />
        </Disclosure>
        <Disclosure title="강의실별 오늘 상태" summary="실내 온도 · 설정온도 · CO₂ · 환기 · 의견">
          <p className="mb-3 text-[13.5px] text-ink-3">실내 온도는 중앙 제어기 센서값, CO₂·재실은 시뮬레이션 센서입니다.</p>
          <RoomTable rooms={rooms} meta={meta} today />
        </Disclosure>
      </DisclosureList>
    </div>
  )
}

function RoomDayTimeline({ rooms, meta, nowMinute }: { rooms: TierRoomRow[]; meta: Meta; nowMinute: number | null }) {
  const range: [number, number] = [420, 1410]
  const [r0, r1] = range
  const opOn = hm(String(meta.settings?.fixed_on ?? '08:30'))
  const opOff = hm(String(meta.settings?.fixed_off ?? '22:30'))
  const labelW = 184
  const color = '#14a673'
  const focus = nowMinute != null && nowMinute >= r0 && nowMinute <= r1 ? nowMinute : null
  if (!rooms.length) return <Empty title="오늘 운전할 강의실이 없습니다" />
  return (
    <div className={cx('relative', focus != null && 'pb-7')}>
      <div className="mb-2 flex">
        <div style={{ width: labelW }} className="shrink-0 pr-3">
          <div className="flex h-[34px] items-center pl-1 text-[13px] font-semibold text-ink-3">강의실</div>
        </div>
        <div className="min-w-0 flex-1">
          <TimePills range={range} focusMinute={focus} />
        </div>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: labelW }}>
          {opOn > r0 && <div className="absolute inset-y-0 rounded-l-[10px]" style={{ left: 0, width: `${pct(opOn, r0, r1)}%`, ...HATCH }} />}
          {opOff < r1 && <div className="absolute inset-y-0 rounded-r-[10px]" style={{ left: `${pct(opOff, r0, r1)}%`, right: 0, ...HATCH }} />}
          {focus != null && <NowLine minute={focus} range={range} label={`현재 ${fmtMin(focus)}`} />}
        </div>
        {rooms.map((r) => {
          const tone = ROOM_TYPE_TONE[meta.rooms[r.room]?.type ?? 'lecture'] ?? ROOM_TYPE_TONE.lecture
          return (
            <div key={r.room} className="flex" style={{ height: 66 }}>
              <div className="shrink-0 py-1 pr-3" style={{ width: labelW }}>
                <div className="flex h-full items-center gap-2.5 rounded-[12px] border border-line bg-surface px-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]" style={{ background: tone.bg, color: tone.ink }}>
                    <RoomTypeIcon type={meta.rooms[r.room]?.type} />
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="tnum block text-[14px] font-bold text-ink">{r.room}호</span>
                    <span className="tnum mt-0.5 block truncate text-[12.5px] text-ink-3">
                      {r.ta_now != null ? `실내 ${r.ta_now.toFixed(1)}℃` : r.type}
                      {r.co2_peak != null ? ` · CO₂ ${Math.round(r.co2_peak)}` : ''}
                    </span>
                  </span>
                </div>
              </div>
              <div className="relative flex-1 border-b border-line/70">
                {(r.lectures ?? []).map((b, i) => {
                  if (b.e <= r0 || b.s >= r1) return null
                  const ev = b.kind === 'event'
                  return (
                    <div
                      key={`l${i}`}
                      className={cx('absolute flex items-center overflow-hidden rounded-full border px-2.5', ev ? 'border-[#d6d0f5] bg-event-bg' : 'border-line bg-[#f1f3f6]')}
                      style={{ left: `${pct(b.s, r0, r1)}%`, width: `calc(${pct(b.e, r0, r1) - pct(b.s, r0, r1)}% - 2px)`, top: 6, height: 21 }}
                      title={`${b.label ?? '수업'} ${fmtMin(b.s)}–${fmtMin(b.e)}`}
                    >
                      <span className={cx('truncate text-[12.5px] font-medium', ev ? 'text-event-ink' : 'text-ink-2')}>{b.label ?? '수업'}</span>
                    </div>
                  )
                })}
                {(r.windows ?? []).map((b, i) => {
                  if (b.e <= r0 || b.s >= r1) return null
                  const fan = b.kind === 'fan'
                  const w = pct(b.e, r0, r1) - pct(b.s, r0, r1)
                  const done = focus != null && b.e <= focus
                  return (
                    <div
                      key={`w${i}`}
                      className="absolute flex items-center gap-1.5 overflow-hidden rounded-full px-1"
                      style={{
                        left: `${pct(b.s, r0, r1)}%`,
                        width: `max(8px, ${w}%)`,
                        top: 33,
                        height: 25,
                        background: fan ? `${color}66` : `linear-gradient(90deg, ${color}, ${color}dd)`,
                      }}
                      title={`AI 운전 ${fmtMin(b.s)}–${fmtMin(b.e)}${b.label ? ` · ${b.label}` : ''}`}
                    >
                      {w > 2.2 && (
                        <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full bg-white/90" style={{ color }}>
                          {fan ? <Wind size={10} strokeWidth={2.6} aria-hidden /> : <Power size={10} strokeWidth={2.6} aria-hidden />}
                        </span>
                      )}
                      {w > 5.5 && <span className="truncate text-[12px] font-semibold text-white">{fan ? '송풍' : '가동'}</span>}
                      {w > 11 && (
                        <span className="ml-auto">
                          <PillChip dot={done ? '#0ca30c' : BRAND}>{b.label ?? (done ? '검증됨' : '예정')}</PillChip>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeatherChart({ plan }: { plan: TierPlan }) {
  const h = plan.hourly
  const opt = useMemo<EChartsOption | null>(() => {
    if (!h || !Array.isArray(h.t_forecast)) return null
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}시`)
    return {
      grid: [
        { left: 44, right: 14, top: 14, height: 150 },
        { left: 44, right: 14, top: 196, height: 52 },
      ],
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number | null; color: string; axisValue: string }[]
          let s = ttTitle(arr[0]?.axisValue ?? '')
          for (const p of arr) if (p.value != null) s += ttRow(p.color, p.seriesName, p.seriesName === '일사' ? `${Math.round(p.value)} W/㎡` : `${p.value.toFixed(1)}℃`)
          return s
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [
        { type: 'category', data: hours, gridIndex: 0, ...axisCommon, axisLabel: { show: false } },
        { type: 'category', data: hours, gridIndex: 1, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 2 } },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, ...axisCommon, axisLine: { show: false }, splitNumber: 4, axisLabel: { ...axisCommon.axisLabel, formatter: '{value}℃' } },
        { type: 'value', gridIndex: 1, ...axisCommon, axisLine: { show: false }, splitNumber: 1, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => (v ? `${v}` : '') } },
      ],
      series: [
        { name: '계획 예보', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, data: h.t_forecast, lineStyle: { width: 2, type: 'dashed', color: BRAND }, itemStyle: { color: BRAND } },
        { name: '실황', type: 'line', xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, connectNulls: false, data: h.t_actual ?? [], lineStyle: { width: 2.2, color: '#142033' }, itemStyle: { color: '#142033' } },
        { name: '일사', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barWidth: '60%', data: h.ghi ?? [], itemStyle: { color: '#f5bb97', borderRadius: [3, 3, 0, 0] } },
      ],
    }
  }, [h])
  if (!opt) return <Empty title="시간별 날씨가 없습니다" />
  return (
    <>
      <div className="mb-1 flex flex-wrap gap-x-4 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: BRAND }} aria-hidden /> 계획에 쓴 예보
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-4 bg-ink" aria-hidden /> 실황
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#f5bb97]" aria-hidden /> 일사(W/㎡)
        </span>
      </div>
      <EChart option={opt} height={262} />
    </>
  )
}

function CO2Panel({ plan, rooms }: { plan: TierPlan; rooms: TierRoomRow[] }) {
  const co2 = plan.hourly?.co2 ?? {}
  const people = plan.hourly?.people ?? {}
  const keys = rooms.map((r) => r.room).filter((r) => Array.isArray(co2[r]))
  const worst = [...keys].sort((a, b) => Math.max(...(co2[b] ?? [0])) - Math.max(...(co2[a] ?? [0])))[0]
  const [pick, setPick] = useState<string | null>(null)
  const room = pick && keys.includes(pick) ? pick : worst
  const step = plan.hourly?.step_min ?? 15
  const opt = useMemo<EChartsOption | null>(() => {
    if (!room || !co2[room]) return null
    const n = co2[room].length
    const labels = Array.from({ length: n }, (_, i) => fmtMin(i * step))
    return {
      grid: [
        { left: 50, right: 14, top: 14, height: 140 },
        { left: 50, right: 14, top: 186, height: 50 },
      ],
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; axisValue: string }[]
          let s = ttTitle(`${room}호 ${arr[0]?.axisValue ?? ''}`)
          for (const p of arr) s += ttRow(p.color, p.seriesName, p.seriesName === 'CO₂' ? `${Math.round(p.value)} ppm` : `${Math.round(p.value)}명`)
          return s
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      xAxis: [
        { type: 'category', data: labels, gridIndex: 0, ...axisCommon, axisLabel: { show: false } },
        { type: 'category', data: labels, gridIndex: 1, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: Math.round(120 / step) - 1 } },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, min: 400, ...axisCommon, axisLine: { show: false }, splitNumber: 3 },
        { type: 'value', gridIndex: 1, ...axisCommon, axisLine: { show: false }, splitNumber: 1 },
      ],
      series: [
        {
          name: 'CO₂',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          data: co2[room],
          lineStyle: { width: 2, color: '#21a0a0' },
          itemStyle: { color: '#21a0a0' },
          areaStyle: { color: 'rgba(33,160,160,0.10)' },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: '#d03b3b', type: 'dashed', width: 1.5 },
            label: { formatter: '1,000 ppm', color: '#a12a2a', fontSize: 12, position: 'insideEndTop' },
            data: [{ yAxis: 1000 }],
          },
        },
        { name: '재실', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barWidth: '70%', data: people[room] ?? [], itemStyle: { color: '#a9c6ee', borderRadius: [2, 2, 0, 0] } },
      ],
    }
  }, [room, co2, people, step])
  return (
    <>
      <CardHeader title="CO₂와 재실" sub="학교보건법 기준 1,000 ppm을 넘지 않도록 예상 인원에 맞춰 환기 단계를 정합니다(아이디어 13)." />
      {keys.length === 0 ? (
        <Empty title="CO₂ 데이터가 없습니다" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="강의실 선택">
            {keys.map((k) => {
              const peak = Math.max(...(co2[k] ?? [0]))
              const on = k === room
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPick(k)}
                  className={cx(
                    'tnum inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold transition-colors',
                    on ? 'border-transparent text-white' : 'border-line bg-surface text-ink-2 hover:border-ink-4',
                  )}
                  style={on ? { background: BRAND } : undefined}
                >
                  {k}
                  <span className={cx('font-medium', on ? 'text-white/85' : peak > 1000 ? 'text-crit-ink' : 'text-ink-3')}>{Math.round(peak)}</span>
                </button>
              )
            })}
          </div>
          {opt ? <EChart option={opt} height={246} /> : <Empty title="강의실을 고르세요" />}
        </>
      )}
    </>
  )
}
