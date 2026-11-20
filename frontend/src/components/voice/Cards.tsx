import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CheckCircle2, X, XCircle } from 'lucide-react'
import { invalidateAll, pollJob } from '../../lib/api'
import { cx } from '../../lib/format'
import { useVoice } from '../../lib/voice/agent'
import type { VoiceCard as Card, VoiceRow } from '../../lib/voice/types'
import { More, Spinner } from '../ui'

/** What ON:D shows while it talks: the data behind the sentence, and the way to the screen that owns it. */

const ROW_TONE: Record<NonNullable<VoiceRow['tone']>, { dot: string; bar: string }> = {
  on: { dot: 'bg-brand', bar: 'bg-brand' },
  fan: { dot: 'bg-good', bar: 'bg-good' },
  warn: { dot: 'bg-warn', bar: 'bg-warn' },
  off: { dot: 'bg-line-strong', bar: 'bg-line-strong' },
}

function JobLine({ job, to }: { job: NonNullable<Card['job']>; to?: string | null }) {
  const voice = useVoice()
  const [state, setState] = useState<'running' | 'done' | 'error'>('running')
  const [line, setLine] = useState('시작하는 중…')
  const told = useRef(false)
  useEffect(() => {
    const ac = new AbortController()
    pollJob<unknown>(
      job.id,
      (j) => {
        const p = (j.progress ?? {}) as unknown as { steps?: { label: string; status?: string }[]; turns?: unknown[]; phase?: string }
        if (p.steps?.length) setLine(`${p.steps.length}단계 · ${p.steps[p.steps.length - 1].label}`)
        else if (p.turns) setLine(`협의 발언 ${p.turns.length}건 · ${p.phase ?? ''}`)
      },
      { intervalMs: 2000, timeoutMs: 240_000, signal: ac.signal },
    )
      .then((j) => {
        if (ac.signal.aborted) return
        const ok = j.status === 'done'
        setState(ok ? 'done' : 'error')
        setLine(ok ? '끝났습니다. 결과는 승인 대기 조정안으로 올라갔습니다.' : (j.error ?? '실행하지 못했습니다.'))
        if (ok) invalidateAll()
        if (!told.current) {
          told.current = true
          voice.announce(
            ok
              ? job.kind === 'negotiate'
                ? '에이전트 협의가 끝났습니다. 결과를 설명해 드릴까요?'
                : '일일 검증이 끝났습니다. 선택된 시나리오를 설명해 드릴까요?'
              : '실행 중에 문제가 생겨 끝내지 못했습니다.',
          )
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setState('error')
          setLine('진행 상태를 확인하지 못했습니다.')
        }
      })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id])
  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-[14px] bg-well px-3.5 py-3 text-[13.5px] text-ink" role="status">
      {state === 'running' ? <Spinner size={15} className="text-brand" /> : state === 'done' ? <CheckCircle2 size={16} className="text-good-ink" aria-hidden /> : <XCircle size={16} className="text-crit" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{line}</span>
      {state === 'done' && to && (
        <button type="button" onClick={() => voice.open(to)} className="shrink-0 font-semibold text-ink hover:underline">
          결과 보기
        </button>
      )}
    </div>
  )
}

export function VoiceCardView({ card, index = 0 }: { card: Card; index?: number }) {
  const voice = useVoice()
  const top = Math.max(...(card.rows ?? []).map((r) => r.bar ?? 0), 0)
  return (
    <article
      className="voice-card relative rounded-[16px] border border-line bg-surface p-5"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] leading-tight font-[650] tracking-[-0.01em] text-ink">{card.title}</h3>
          {card.subtitle && <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{card.subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => card.id && voice.dismissCard(card.id)}
          className="-mt-1 -mr-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover hover:text-ink"
          aria-label={`${card.title} 카드 닫기`}
        >
          <X size={14} />
        </button>
      </header>

      {card.stats && card.stats.length > 0 && (
        <dl className={cx('mt-4 grid gap-x-4 gap-y-3', card.stats.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
          {card.stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="truncate text-[12px] text-ink-3">{s.label}</dt>
              <dd className="mt-0.5 flex items-baseline gap-1">
                <span className={cx('tnum text-[24px] leading-none font-[680] tracking-[-0.02em]', s.tone === 'good' ? 'text-good-ink' : s.tone === 'warn' ? 'text-warn-ink' : 'text-ink')}>
                  {s.value}
                </span>
                {s.unit && <span className="text-[12px] whitespace-nowrap text-ink-3">{s.unit}</span>}
              </dd>
              {s.delta && <div className="tnum mt-1 truncate text-[11.5px] text-ink-3">{s.delta}</div>}
            </div>
          ))}
        </dl>
      )}

      {card.rows && card.rows.length > 0 && (
        <ul className="mt-4 space-y-2">
          {card.rows.map((r, i) => {
            const tone = ROW_TONE[r.tone ?? 'off']
            return (
              <li key={`${r.label}-${i}`} className="text-[13px]">
                <div className="flex items-baseline gap-2">
                  <span className={cx('relative top-[-1px] inline-block h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
                  <span className="tnum shrink-0 font-medium text-ink">{r.label}</span>
                  {r.tag && <span className="shrink-0 rounded-[4px] bg-well px-1.5 py-px text-[11px] leading-[1.5] font-semibold text-ink-2">{r.tag}</span>}
                  <span className="tnum ml-auto min-w-0 truncate text-right text-ink">{r.value}</span>
                </div>
                {top > 0 && r.bar != null && (
                  <div className="mt-1 ml-3.5 h-[3px] overflow-hidden rounded-full bg-well">
                    <div className={cx('voice-bar h-full rounded-full', tone.bar)} style={{ width: `${Math.max(2, Math.min(100, r.bar * 100))}%` }} />
                  </div>
                )}
                {r.sub && <div className="mt-0.5 ml-3.5 truncate text-[11.5px] text-ink-3">{r.sub}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {card.job && <JobLine job={card.job} to={card.to} />}
      {card.note && <More className="mt-2">{card.note}</More>}

      {card.to && (
        <button
          type="button"
          onClick={() => voice.open(card.to!, card.date)}
          className="mt-4 inline-flex h-9 items-center gap-1.5 ond-press rounded-full bg-bg-neutral-solid px-4 text-[13px] font-bold text-fg-on-neutral-solid hover:bg-bg-neutral-solid-pressed"
        >
          {card.to_label ?? '화면으로 이동'}
          <ArrowUpRight size={14} aria-hidden />
        </button>
      )}
    </article>
  )
}
