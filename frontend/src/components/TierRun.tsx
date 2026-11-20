import { useRef, useState } from 'react'
import { Check, Play, RefreshCw } from 'lucide-react'
import { apiSend, invalidateAll, pollJob } from '../lib/api'
import type { TierPlan, TierRun, TierRunStep } from '../lib/types'
import { cx, fmtDateK } from '../lib/format'
import { Ondy } from './PublicShell'
import { Button, Card, ErrorBox, Spinner } from './ui'

type TierN = 1 | 2 | 3

/** What each run reads and does, in the operator's words. Labels mirror the server's steps so pending ones can be shown. */
export const RUN_COPY: Record<TierN, { title: string; button: string; does: string; labels: string[] }> = {
  1: {
    title: '이번 달 1차 계획을 아직 만들지 않았습니다',
    button: '1차 계획 만들기',
    does: '시간표와 학사일정, 예보와 평년 기후, 설비·정책을 읽고 열모델로 한 달 운전을 계산합니다.',
    labels: ['시간표·학사일정 읽기', '예보·평년 기후 받기', '설비·정책 확인', '최근 쾌적 의견 모으기', '열모델로 한 달 운전 계산', '조정안·명령 정리'],
  },
  2: {
    title: '이번 주 2차 조정을 아직 실행하지 않았습니다',
    button: '2차 조정 실행',
    does: '주간 예보, 이번 주 일정, 지난주 의견과 재실 추세를 에이전트가 종합해 시나리오를 제안하고, 엔진이 하나씩 계산한 뒤 가장 좋은 안을 고릅니다.',
    labels: ['이번 주 시간표·일정 읽기', '주간 예보 받기', '센서·재실 추세 읽기', '지난주 쾌적 의견 모으기', '열모델로 주간 기본 운전 계산·점검', '에이전트: 자료 종합·시나리오 제안', '엔진: 시나리오별 전력·요금·쾌적 계산', '최적 시나리오 선택 → 조정안', '조정안·명령 정리'],
  },
  3: {
    title: '오늘 데이터로 3차 검증을 아직 실행하지 않았습니다',
    button: '3차 검증 실행',
    does: '실황과 예보, 실내 온도·CO₂·재실, 어제·오늘 의견을 에이전트가 종합해 시나리오를 제안하고, 엔진이 하나씩 계산한 뒤 가장 좋은 안을 고릅니다.',
    labels: ['오늘 시간표·일정 읽기', '실황·예보 받기', '실내 온도·CO₂·재실 읽기', '어제·오늘 쾌적 의견 모으기', '열모델로 오늘 기본 운전 계산·점검', '에이전트: 자료 종합·시나리오 제안', '엔진: 시나리오별 전력·요금·쾌적 계산', '최적 시나리오 선택 → 조정안', '조정안·명령 정리'],
  },
}

export interface RunResult {
  run: TierRun
  plan: TierPlan
}

/** Starts a tier run on the server and follows its steps. */
const DWELL_MS = 480 // a finished step stays on screen at least this long, so a fast run can still be read

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Starts a tier run on the server and follows its steps. The numbers are the server's real timings;
 * only the reveal is paced so each step can be read (steps that arrive together are shown one by one).
 */
export function useTierRun(tier: TierN, date: string | null | undefined) {
  const [steps, setSteps] = useState<TierRunStep[] | null>(null)
  const [shown, setShown] = useState(0)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [done, setDone] = useState(false)
  const shownRef = useRef(0)

  const reveal = async (n: number) => {
    while (shownRef.current < n) {
      shownRef.current += 1
      setShown(shownRef.current)
      await sleep(DWELL_MS)
    }
  }

  async function start() {
    if (running) return
    setRunning(true)
    setErr(null)
    setSteps([])
    setResult(null)
    setDone(false)
    shownRef.current = 0
    setShown(0)
    try {
      const r = await apiSend<{ job: string }>('POST', `/api/plan/tier/${tier}/run`, date ? { date } : {})
      let revealing: Promise<void> = Promise.resolve()
      const j = await pollJob<RunResult>(
        r.job,
        (jb) => {
          const p = jb.progress as { steps?: TierRunStep[] } | undefined
          if (Array.isArray(p?.steps)) {
            setSteps(p!.steps)
            const done = p!.steps.filter((x) => x.status !== 'running').length
            revealing = revealing.then(() => reveal(done))
          }
        },
        { intervalMs: 350, timeoutMs: 240_000 },
      )
      if (j.status === 'error' || !j.result?.run || !j.result.plan) throw new Error(j.error || '계산을 마치지 못했습니다.')
      const full = j.result.run.steps
      setSteps(full)
      await revealing
      await reveal(full.length)
      setDone(true) // "끝났습니다" stays readable before the result replaces the steps
      await sleep(900)
      setResult(j.result)
      invalidateAll()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return { start, steps, shown, running, done, err, result, reset: () => setResult(null) }
}

/** The step list while a run is going (and just after): label, what it found, real milliseconds. */
export function RunSteps({ tier, steps, shown, running, done = false }: { tier: TierN; steps: TierRunStep[]; shown: number; running: boolean; done?: boolean }) {
  const labels = RUN_COPY[tier].labels
  // steps the server has finished but the screen has not yet revealed read as "running"
  const rows: (TierRunStep | { label: string; status: 'pending' | 'running' })[] = labels.map((l, i) => {
    const s = steps[i]
    if (!s) return { label: l, status: i === shown && (running || steps.length > shown) ? 'running' : 'pending' }
    if (i < shown) return s
    return { label: l, status: i === shown ? 'running' : 'pending' }
  })
  const total = steps.slice(0, shown).reduce((a, s) => a + (s.ms ?? 0), 0)
  const finished = done || (!running && shown >= labels.length)
  return (
    <div aria-live="polite">
      <ol className="space-y-2.5">
        {rows.map((s, i) => {
          const st = s.status
          return (
            <li key={i} className={cx('grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-x-3', st === 'pending' && 'opacity-45')}>
              <span className="mt-[2px] flex h-5 w-5 items-center justify-center">
                {st === 'done' ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check size={12} strokeWidth={3} aria-hidden />
                  </span>
                ) : st === 'running' ? (
                  <Spinner size={16} className="text-brand" />
                ) : st === 'error' ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-crit text-white text-[11px] font-bold">!</span>
                ) : (
                  <span className="h-2 w-2 rounded-full bg-line-strong" />
                )}
              </span>
              <span className="min-w-0">
                <span className={cx('block text-[14px] leading-[1.5] font-semibold', st === 'pending' ? 'text-ink-3' : 'text-ink')}>{s.label}</span>
                {'text' in s && s.text && <span className={cx('block text-[13px] leading-[1.5]', st === 'error' ? 'text-crit-ink' : 'text-ink-2')}>{s.text}</span>}
              </span>
              <span className="tnum pt-[2px] text-[12.5px] text-ink-3">{'ms' in s && s.ms != null ? `${s.ms} ms` : ''}</span>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 flex items-center gap-2 text-[13px] text-ink-3">
        {finished ? (
          <>
            <Check size={13} aria-hidden /> 끝났습니다. 총 {(total / 1000).toFixed(1)}초
          </>
        ) : (
          <>
            <Spinner size={13} /> 계산 중…
          </>
        )}
      </div>
    </div>
  )
}

/** Shown instead of a plan that has not been computed yet: what the run will read, and the one button that runs it. */
export function RunGate({
  tier,
  run,
  'data-tour': tour,
}: {
  tier: TierN
  run: ReturnType<typeof useTierRun>
  'data-tour'?: string
}) {
  const c = RUN_COPY[tier]
  const busy = run.running || (!!run.steps && run.steps.length > 0 && !run.err)
  return (
    <Card data-tour={tour} pad="lg">
      <div className="grid gap-8 md:grid-cols-[auto_minmax(0,1fr)]">
        <Ondy pose={tier === 1 ? 'schedule' : tier === 2 ? 'hvac' : 'comfort'} size={116} pop className="max-md:hidden" />
        <div className="min-w-0">
          {!busy ? (
            <>
              <h2 className="text-[22px] leading-[1.3] font-bold tracking-[-0.02em] text-ink">{c.title}</h2>
              <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.6] text-ink-2">{c.does} 결과는 눌렀을 때 계산되고, 각 단계에 걸린 시간을 그대로 보여 줍니다.</p>
              <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-ink-3">
                {c.labels.slice(0, 5).map((l, i) => (
                  <li key={l} className="inline-flex items-center gap-1.5">
                    <span className="tnum font-semibold text-brand-ink">{String(i + 1).padStart(2, '0')}</span>
                    {l}
                  </li>
                ))}
              </ul>
              {run.err && (
                <div className="mt-4">
                  <ErrorBox title="계산하지 못했습니다" error={run.err} />
                </div>
              )}
              <Button variant="primary" className="mt-6" onClick={run.start}>
                <Play size={16} aria-hidden /> {c.button}
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-[18px] leading-[1.35] font-[650] tracking-[-0.015em] text-ink">{c.button.replace(/ 만들기$| 실행$/, '')} 계산 중</h2>
              <div className="mt-4">
                <RunSteps tier={tier} steps={run.steps ?? []} shown={run.shown} running={run.running} done={run.done} />
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

/** One quiet line under a computed plan: when it was computed, by whom, where commands went, and a button to do it again. */
export function RunLine({ run, onRerun, running }: { run: TierRun; onRerun: () => void; running: boolean }) {
  const o = run.outcome
  const sim = o?.simulated
  const where = !o
    ? null
    : o.commands > 0
      ? sim
        ? `명령 ${o.commands}건을 시뮬레이터가 받았습니다(중앙제어기 미연결)`
        : `명령 ${o.commands}건을 게이트웨이 ${o.gateway}로 보냈습니다`
      : o.pending > 0
        ? `조정안 ${o.pending}건 승인 대기 · 승인하면 ${sim ? '시뮬레이터가 받습니다(중앙제어기 미연결)' : `게이트웨이 ${o.gateway}로 나갑니다`}`
        : null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] leading-[1.5] text-ink-3">
      <span className="tnum">
        {fmtDateK(run.date)} 계산 {run.at.slice(11, 16)} · {run.actor} · {(run.elapsed_ms / 1000).toFixed(1)}초
      </span>
      {where && (
        <>
          <span className="h-3 w-px bg-line-strong" aria-hidden />
          <span>{where}</span>
        </>
      )}
      <button
        type="button"
        onClick={onRerun}
        disabled={running}
        className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        {running ? <Spinner size={13} /> : <RefreshCw size={13} aria-hidden />} 지금 데이터로 다시 계산
      </button>
    </div>
  )
}
