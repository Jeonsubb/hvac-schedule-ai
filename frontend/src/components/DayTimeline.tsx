import { useCallback, useRef } from 'react'
import type { Interval, Session } from '../lib/types'
import { cx, fmtMin, hm } from '../lib/format'
import { intervalAt, mergeIntervals, sessionsOf } from '../lib/plans'

/**
 * The day of every room on one screen: class blocks (grey outline) above the HVAC ON runs of the shown
 * plan (the one accent colour). A second plan can sit under it as a thin grey track for comparison.
 * The vertical cursor is a chosen time of the simulated day, not the wall clock.
 */

const BRAND = 'var(--color-brand)'
const LABEL_W = 92

const STRIPE = 'repeating-linear-gradient(135deg, rgb(47 111 222 / 0.55) 0 4px, rgb(47 111 222 / 0.18) 4px 8px)'

export default function DayTimeline({
  rooms,
  sessions,
  plan,
  planLabel,
  compare,
  range,
  minute,
  onMinute,
  selected,
  onSelect,
}: {
  rooms: string[]
  sessions: Session[]
  plan: Record<string, Interval[]>
  planLabel: string
  compare?: { plan: Record<string, Interval[]>; label: string } | null
  range: [number, number]
  minute: number
  onMinute: (m: number) => void
  selected: string | null
  onSelect: (room: string) => void
}) {
  const [r0, r1] = range
  const span = r1 - r0
  const x = (m: number) => ((Math.max(r0, Math.min(r1, m)) - r0) / span) * 100
  const tracks = useRef<HTMLDivElement | null>(null)
  const rowH = compare ? 52 : 44

  const minuteAt = useCallback(
    (clientX: number) => {
      const el = tracks.current
      if (!el) return minute
      const b = el.getBoundingClientRect()
      const m = r0 + ((clientX - b.left) / Math.max(1, b.width)) * span
      return Math.max(r0, Math.min(r1, Math.round(m / 5) * 5))
    },
    [minute, r0, r1, span],
  )

  const startDrag = (e: React.PointerEvent, room: string) => {
    onSelect(room)
    onMinute(minuteAt(e.clientX))
    const move = (ev: PointerEvent) => onMinute(minuteAt(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const hours: number[] = []
  for (let h = Math.ceil(r0 / 60); h <= Math.floor(r1 / 60); h++) hours.push(h)

  return (
    <div>
      <div className="thin-scroll overflow-x-auto">
        <div className="min-w-[660px]">
          {/* hour axis */}
          <div className="flex h-11 items-end">
            <div style={{ width: LABEL_W }} className="shrink-0 pb-1 text-[12px] font-medium text-ink-3">
              강의실
            </div>
            <div className="relative h-full flex-1">
              {hours.map((h) => (
                <span
                  key={h}
                  className={cx('tnum absolute bottom-1 text-[12px] whitespace-nowrap text-ink-3', h * 60 >= r1 ? '-translate-x-full' : h * 60 <= r0 ? '' : '-translate-x-1/2', h % 2 !== 0 && 'hidden lg:inline')}
                  style={{ left: `${x(h * 60)}%` }}
                >
                  {String(h).padStart(2, '0')}
                </span>
              ))}
              <span
                className="tnum absolute top-0 z-[2] -translate-x-1/2 rounded-full bg-ink px-2 py-[1px] text-[11.5px] font-semibold whitespace-nowrap text-white"
                style={{ left: `${x(minute)}%` }}
              >
                {fmtMin(minute)}
              </span>
            </div>
          </div>

          <div className="relative">
            {/* grid lines and the cursor, behind and above the rows */}
            <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }} ref={tracks}>
              {hours.map((h) => (
                <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(h * 60)}%`, opacity: h % 2 === 0 ? 1 : 0.5 }} />
              ))}
              <span className="absolute inset-y-0 z-[2] w-[2px] -translate-x-1/2 bg-ink" style={{ left: `${x(minute)}%` }} aria-hidden />
            </div>

            {rooms.map((room) => {
              const ss = sessionsOf(sessions, room)
              const runs = mergeIntervals(plan[room])
              const base = compare ? mergeIntervals(compare.plan[room]) : []
              const on = selected === room
              const cur = intervalAt(runs, minute)
              const stateTxt = cur ? (cur.kind === 'fan' ? '송풍' : 'ON') : 'OFF'
              return (
                <div
                  key={room}
                  className={cx('relative flex border-t border-line transition-colors', on ? 'bg-brand-bg/60' : 'hover:bg-well/70')}
                  style={{ height: rowH }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(room)}
                    aria-pressed={on}
                    className="flex shrink-0 items-center justify-between gap-1 pr-3 pl-2 text-left"
                    style={{ width: LABEL_W }}
                    title={`${room}호 상세 보기`}
                  >
                    <span className={cx('tnum text-[14px] font-semibold', on ? 'text-brand-ink' : 'text-ink')}>{room}호</span>
                    <span className={cx('text-[11.5px] font-semibold', cur ? 'text-brand-ink' : 'text-ink-3')}>{stateTxt}</span>
                  </button>
                  <div className="relative flex-1 cursor-col-resize touch-none" onPointerDown={(e) => startDrag(e, room)}>
                    {ss.map((s) => {
                      const a = hm(s.start)
                      const b = hm(s.end)
                      if (b <= r0 || a >= r1) return null
                      return (
                        <span
                          key={s.id}
                          className={cx(
                            'absolute overflow-hidden rounded-[4px] border bg-[#f1f3f5] px-1 text-[11px] leading-[12px] whitespace-nowrap text-ink-2',
                            s.kind === 'event' ? 'border-dashed border-ink-3' : 'border-line-strong',
                          )}
                          style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%`, top: 6, height: 14 }}
                          title={`${s.kind === 'event' ? '특별 일정' : '수업'}: ${s.title}\n${s.start}–${s.end}${s.expected_people != null ? ` · 예상 ${s.expected_people}명${s.people_estimated ? '(추정)' : ''}` : ''}`}
                        >
                          {s.kind === 'event' ? `특별 · ${s.title}` : s.title}
                        </span>
                      )
                    })}
                    {runs.map((iv, i) => {
                      if (iv.e <= r0 || iv.s >= r1) return null
                      return (
                        <span
                          key={i}
                          className="absolute rounded-[3px]"
                          style={{ left: `${x(iv.s)}%`, width: `${Math.max(0.4, x(iv.e) - x(iv.s))}%`, top: 24, height: 11, background: iv.kind === 'fan' ? STRIPE : BRAND }}
                          title={`${room}호 ${iv.kind === 'fan' ? '송풍' : '냉난방 ON'} ${fmtMin(iv.s)}–${fmtMin(iv.e)} (${iv.e - iv.s}분)\n계획: ${planLabel} · 시뮬레이션`}
                        />
                      )
                    })}
                    {base.map((iv, i) => {
                      if (iv.e <= r0 || iv.s >= r1) return null
                      return (
                        <span
                          key={`b${i}`}
                          className="absolute rounded-[2px] bg-ink-3"
                          style={{ left: `${x(iv.s)}%`, width: `${Math.max(0.4, x(iv.e) - x(iv.s))}%`, top: 39, height: 5 }}
                          title={`${room}호 ${compare!.label} ${fmtMin(iv.s)}–${fmtMin(iv.e)} (${iv.e - iv.s}분)`}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div className="border-t border-line" />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-[3px] border border-line-strong bg-[#f1f3f5]" aria-hidden /> 수업 일정
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-ink-3 bg-[#f1f3f5]" aria-hidden /> 특별 일정
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-5 rounded-[3px]" style={{ background: BRAND }} aria-hidden /> 냉난방 ON ({planLabel})
          </span>
          {compare && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[5px] w-5 rounded-[2px] bg-ink-3" aria-hidden /> {compare.label}
            </span>
          )}
        </div>
        <label className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 text-[12.5px] text-ink-3 sm:max-w-[360px]">
          <span className="shrink-0">선택 시각</span>
          <input
            type="range"
            min={r0}
            max={r1}
            step={5}
            value={minute}
            onChange={(e) => onMinute(Number(e.target.value))}
            className="h-1 w-full accent-[var(--color-ink)]"
            aria-label="선택 시각"
            aria-valuetext={fmtMin(minute)}
          />
          <span className="tnum w-11 shrink-0 text-right font-semibold text-ink">{fmtMin(minute)}</span>
        </label>
      </div>
    </div>
  )
}
