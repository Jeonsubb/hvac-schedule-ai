import { useLayoutEffect, useRef, type PointerEvent } from 'react'
import gsap from 'gsap'
import type { Day } from '../lib/types'
import type { PlanModel } from '../lib/plans'
import { intervalAt, mergeIntervals, samePlan, sessionsOf } from '../lib/plans'
import { fmtMin, hm } from '../lib/format'

export default function OperationalTimeline({ day, rooms, plan, partner, range, minute, selected, onSelect, onMinute }: {
  day: Day; rooms: string[]; plan: PlanModel; partner?: PlanModel; range: [number, number]; minute: number; selected: string | null; onSelect: (room: string) => void; onMinute: (m: number) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const previous = useRef(plan)
  const span = range[1] - range[0]
  const x = (n: number) => Math.max(0, Math.min(100, (n - range[0]) / span * 100))
  useLayoutEffect(() => {
    const changed = rooms.filter((r) => !samePlan(previous.current.rooms[r]?.plan, plan.rooms[r]?.plan))
    previous.current = plan
    if (!changed.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      const bars = [...(root.current?.querySelectorAll<HTMLElement>('[data-studio-run]') ?? [])].filter((el) => changed.includes(el.dataset.room!))
      gsap.fromTo(bars, { opacity: .25, scaleY: .35 }, { opacity: 1, scaleY: 1, duration: .48, stagger: .015, ease: 'power3.out', clearProps: 'opacity,transform' })
    }, root)
    return () => context.revert()
  }, [plan, rooms])
  const timeAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return Math.max(range[0], Math.min(range[1], Math.round((range[0] + (e.clientX - box.left) / box.width * span) / 5) * 5))
  }
  const hours: number[] = []
  for (let h = range[0] / 60; h <= range[1] / 60; h++) if (h % 2 === 0 || h * 60 === range[1]) hours.push(h)
  return <div ref={root} className="operational-timeline" aria-label="10개 강의실 하루 운전 타임라인">
    <div className="operational-scroll"><div className="operational-grid">
      <div className="operational-axis"><span>SPACE / HVAC</span><div>{hours.map((h) => <span key={h} style={{ left: `${x(h * 60)}%`, transform: h * 60 === range[1] ? 'translateX(-100%)' : h * 60 === range[0] ? 'none' : 'translateX(-50%)' }}>{String(h).padStart(2, '0')}:00</span>)}</div></div>
      <div className="operational-rows">
        <div className="operational-cursor-field" aria-hidden><span className="operational-cursor" style={{ left: `${x(minute)}%` }}><b style={{ transform: minute > range[1] - 45 ? 'translateX(-100%)' : minute < range[0] + 45 ? 'none' : 'translateX(-50%)' }}>{fmtMin(minute)}</b></span></div>
        {rooms.map((room, index) => {
          const runs = mergeIntervals(plan.rooms[room]?.plan)
          const active = intervalAt(runs, minute)
          const classes = sessionsOf(day.sessions, room)
          const changed = !!partner && !samePlan(runs, partner.rooms[room]?.plan)
          return <div className={`operational-row${selected === room ? ' is-selected' : ''}${partner ? ' has-comparison' : ''}`} key={room}>
            <button type="button" onClick={() => onSelect(room)} aria-label={`${room}호 선택 · ${active ? 'ON' : 'OFF'}`} aria-pressed={selected === room} onKeyDown={(e) => {
              const n = e.key === 'ArrowDown' ? Math.min(rooms.length - 1, index + 1) : e.key === 'ArrowUp' ? Math.max(0, index - 1) : null
              if (n == null) return
              e.preventDefault(); onSelect(rooms[n]); root.current?.querySelectorAll<HTMLButtonElement>('.operational-row > button')[n]?.focus()
            }}><span>{room}<small>호</small></span><i className={active ? 'is-on' : ''} /></button>
            <div className="operational-track" onPointerDown={(e) => { if (e.button !== 0 || e.pointerType === 'touch') return; e.currentTarget.setPointerCapture(e.pointerId); onSelect(room); onMinute(timeAt(e)) }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onMinute(timeAt(e)) }} onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}>
              {hours.map((h) => <i className="operational-rule" key={h} style={{ left: `${x(h * 60)}%` }} aria-hidden />)}
              {classes.map((s) => <span key={s.id} className={`operational-class${s.kind === 'event' ? ' is-event' : ''}`} style={{ left: `${x(hm(s.start))}%`, width: `${x(hm(s.end)) - x(hm(s.start))}%` }} title={`${s.title} · ${s.start}–${s.end} · ${s.room}호`}>{s.title}</span>)}
              {runs.map((iv, i) => <span key={i} data-studio-run data-room={room} className={`operational-run${iv.kind === 'fan' ? ' is-fan' : ''}${changed ? ' is-changed' : ''}`} style={{ left: `${x(iv.s)}%`, width: `${x(iv.e) - x(iv.s)}%` }} title={`${room}호 ${iv.kind === 'fan' ? '송풍' : '냉난방 ON'} ${fmtMin(iv.s)}–${fmtMin(iv.e)} · ${plan.label} · 시뮬레이션`} />)}
              {partner && mergeIntervals(partner.rooms[room]?.plan).map((iv, i) => <span className="operational-partner" key={i} style={{ left: `${x(iv.s)}%`, width: `${x(iv.e) - x(iv.s)}%` }} title={`${partner.label} ${fmtMin(iv.s)}–${fmtMin(iv.e)}`} />)}
            </div>
          </div>
        })}
      </div>
    </div></div>
    <div className="operational-legend"><span><i className="class" /> 수업 일정</span><span><i className="run" /> HVAC ON</span>{partner && <span><i className="partner" /> {partner.label} · 비교</span>}<small>막대를 드래그하거나 가상 시각 슬라이더로 탐색</small></div>
  </div>
}
