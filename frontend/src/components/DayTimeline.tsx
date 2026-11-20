import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Interval, Session } from '../lib/types'
import { cx, fmtMin, hm } from '../lib/format'
import { intervalAt, mergeIntervals, sessionsOf } from '../lib/plans'

/**
 * The day of every room on one screen: class blocks (grey outline) above the HVAC ON runs of the shown
 * plan (the one accent colour). A second plan can sit under it as a thin grey track for comparison.
 * The vertical cursor is a chosen time of the simulated day, not the wall clock.
 */

const BRAND = 'var(--color-brand)'
const LABEL_W = 104

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
  const roomButtons = useRef(new Map<string, HTMLButtonElement>())
  const pointer = useRef<{ id: number; x: number; y: number; touch: boolean } | null>(null)
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

  const startDrag = (e: PointerEvent<HTMLDivElement>, room: string) => {
    if (!e.isPrimary || e.button !== 0) return
    const touch = e.pointerType === 'touch'
    pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY, touch }
    // Let touch gestures scroll the page or the timeline. A stationary tap selects on release.
    if (!touch) {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      onSelect(room)
      onMinute(minuteAt(e.clientX))
    }
  }

  const finishDrag = (e: PointerEvent<HTMLDivElement>, room: string) => {
    const p = pointer.current
    if (!p || p.id !== e.pointerId) return
    if (p.touch && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) {
      onSelect(room)
      onMinute(minuteAt(e.clientX))
    }
    pointer.current = null
  }

  const navigateRoom = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = e.key === 'ArrowDown' ? Math.min(rooms.length - 1, index + 1)
      : e.key === 'ArrowUp' ? Math.max(0, index - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? rooms.length - 1 : null
    if (next == null) return
    e.preventDefault()
    roomButtons.current.get(rooms[next])?.focus()
    onSelect(rooms[next])
  }

  const hours: number[] = []
  for (let h = Math.ceil(r0 / 60); h <= Math.floor(r1 / 60); h++) hours.push(h)

  return (
    <div className="timeline-root">
      <div className="thin-scroll overflow-x-auto overscroll-x-contain">
        <div className="min-w-[540px]">
          {/* hour axis */}
          <div className="flex h-9 items-end">
            <div style={{ width: LABEL_W }} className="sticky left-0 z-[4] shrink-0 bg-surface pb-1 pl-2 text-[12px] font-medium text-ink-3">
              강의실
            </div>
            <div className="relative h-full flex-1">
              {hours.map((h) => (
                <span
                  key={h}
                  className={cx('tnum absolute bottom-1 text-[12px] whitespace-nowrap text-ink-3', h * 60 >= r1 ? '-translate-x-full' : h * 60 <= r0 ? '' : '-translate-x-1/2', h % 2 !== 0 && h * 60 !== r1 && 'hidden')}
                  style={{ left: `${x(h * 60)}%` }}
                >
                  {String(h).padStart(2, '0')}
                </span>
              ))}
              <span
                className="tnum absolute top-0 z-[2] rounded-[4px] bg-ink px-1.5 py-[1px] text-[11px] font-semibold whitespace-nowrap text-white"
                style={{ left: `clamp(22px, ${x(minute)}%, calc(100% - 22px))`, transform: 'translateX(-50%)' }}
              >
                {fmtMin(minute)}
              </span>
            </div>
          </div>

          <div className="relative">
            {/* grid lines and the cursor, behind and above the rows */}
            <div className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden" style={{ left: LABEL_W }} ref={tracks}>
              {hours.map((h) => (
                <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${x(h * 60)}%`, opacity: h % 2 === 0 ? 1 : 0.5 }} />
              ))}
              <span className="absolute inset-y-0 z-[2] w-[2px] -translate-x-1/2 bg-ink" style={{ left: `${x(minute)}%` }} aria-hidden />
            </div>

            {rooms.map((room, index) => {
              const ss = sessionsOf(sessions, room)
              const runs = mergeIntervals(plan[room])
              const base = compare ? mergeIntervals(compare.plan[room]) : []
              const on = selected === room
              const cur = intervalAt(runs, minute)
              const stateTxt = cur ? (cur.kind === 'fan' ? '송풍' : 'ON') : 'OFF'
              return (
                <div
                  key={room}
                  className={cx('timeline-row group relative flex border-t border-line transition-colors duration-150 ease-out', on ? 'bg-brand-bg/50' : 'hover:bg-well/50')}
                  style={{ height: rowH }}
                >
                  <button
                    type="button"
                    ref={(node) => { if (node) roomButtons.current.set(room, node); else roomButtons.current.delete(room) }}
                    onClick={() => onSelect(room)}
                    onKeyDown={(e) => navigateRoom(e, index)}
                    aria-pressed={on}
                    aria-label={`${room}호 상세 보기 · ${stateTxt}`}
                    className={cx('timeline-room sticky left-0 z-[3] flex shrink-0 items-center justify-between gap-1 pr-3 pl-2 text-left transition-colors duration-150 focus-visible:z-[5] focus-visible:outline-offset-[-2px]', on ? 'bg-[#f0f6ff]' : 'bg-surface group-hover:bg-[#fafbfc]')}
                    style={{ width: LABEL_W }}
                    title={`${room}호 상세 보기`}
                  >
                    <span className={cx('tnum text-[14px] font-semibold', on ? 'text-brand-ink' : 'text-ink')}>{room}호</span>
                    <span className={cx('text-[11.5px] font-semibold', cur ? 'text-brand-ink' : 'text-ink-3')}>{stateTxt}</span>
                  </button>
                  <div
                    className="relative flex-1 cursor-col-resize touch-auto"
                    onPointerDown={(e) => startDrag(e, room)}
                    onPointerMove={(e) => { if (pointer.current?.id === e.pointerId && !pointer.current.touch) onMinute(minuteAt(e.clientX)) }}
                    onPointerUp={(e) => finishDrag(e, room)}
                    onPointerCancel={() => { pointer.current = null }}
                    onLostPointerCapture={() => { pointer.current = null }}
                  >
                    {ss.map((s) => {
                      const a = hm(s.start)
                      const b = hm(s.end)
                      if (b <= r0 || a >= r1) return null
                      return (
                        <span
                          key={s.id}
                          className={cx(
                            'absolute overflow-hidden text-ellipsis rounded-[3px] border bg-[#f3f4f6] px-1 text-[11px] leading-[13px] whitespace-nowrap text-ink-2',
                            s.kind === 'event' ? 'border-dashed border-ink-3' : 'border-line-strong',
                          )}
                          style={{ left: `${x(a)}%`, width: `${x(b) - x(a)}%`, top: 7, height: 15 }}
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
                          className="absolute rounded-[2px] transition-[filter] duration-150 group-hover:brightness-110"
                          style={{ left: `${x(iv.s)}%`, width: `${Math.max(0.4, x(iv.e) - x(iv.s))}%`, top: 26, height: 10, background: iv.kind === 'fan' ? STRIPE : BRAND }}
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-3" aria-label="타임라인 범례">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-[3px] border border-line-strong bg-[#f1f3f5]" aria-hidden /> 수업 일정
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 rounded-[3px] border border-dashed border-ink-3 bg-[#f1f3f5]" aria-hidden /> 특별 일정
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[9px] w-5 rounded-[2px]" style={{ background: BRAND }} aria-hidden /> 냉난방 ON
          </span>
          {compare && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[5px] w-5 rounded-[2px] bg-ink-3" aria-hidden /> {compare.label}
            </span>
          )}
        </div>
        <label className="ml-auto flex min-w-[210px] flex-1 items-center gap-2 text-[12px] text-ink-3 sm:max-w-[280px]">
          <span className="shrink-0">선택 시각</span>
          <input
            type="range"
            min={r0}
            max={r1}
            step={5}
            value={minute}
            onChange={(e) => onMinute(Number(e.target.value))}
            className="h-6 w-full cursor-pointer accent-[var(--color-brand)]"
            aria-label="선택 시각"
            aria-valuetext={fmtMin(minute)}
          />
          <span className="tnum w-11 shrink-0 text-right font-semibold text-ink">{fmtMin(minute)}</span>
        </label>
      </div>
      <p className="mt-2 text-[11px] text-ink-3">{planLabel} · 시뮬레이션 계획 · 강의실을 선택하면 상세정보가 표시됩니다.</p>
    </div>
  )
}
