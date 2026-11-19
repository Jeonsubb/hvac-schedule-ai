import { useMemo, useState, type ReactNode } from 'react'
import { Timer, Hourglass, SkipForward, Wind, Power, Link2, Wrench, AlertTriangle, Sparkles } from 'lucide-react'
import type { Day, Decision, Interval, Meta, Session, StrategyKey, ValidationSession } from '../lib/types'
import { DECISION, ROOM_ORDER, STRATEGY, statusInfo, GROUP_META } from '../lib/constants'
import { cx, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'

export function DecisionIcon({ type, size = 12, className }: { type: string; size?: number; className?: string }) {
  const p = { size, strokeWidth: 2.4, className }
  switch (type) {
    case 'optimal_start':
      return <Timer {...p} />
    case 'late_start':
      return <Hourglass {...p} />
    case 'skip':
      return <SkipForward {...p} />
    case 'economizer':
      return <Wind {...p} />
    case 'early_stop':
      return <Power {...p} />
    case 'bridge':
      return <Link2 {...p} />
    default:
      return <Sparkles {...p} />
  }
}

interface Tip {
  x: number
  y: number
  node: ReactNode
}

function pct(m: number, r0: number, r1: number) {
  return ((Math.min(Math.max(m, r0), r1) - r0) / (r1 - r0)) * 100
}

export function decisionMinute(d: Decision, plan: Interval[] | undefined): number {
  const sid = d.session ?? d.sessions?.[0]
  const iv = plan?.find((p) => sid && p.sessions?.includes(sid))
  const at = DECISION[d.type]?.at ?? 'start'
  if (iv) return at === 'end' ? iv.e : iv.s
  return at === 'end' ? hm(d.end) : hm(d.start)
}

export default function Gantt({
  day,
  meta,
  primary,
  overlay,
  nowMinute,
  compact = false,
  range = [420, 1410],
  onRoomClick,
  selectedRoom,
  showDecisions = true,
  showPlan = true,
}: {
  day: Day
  meta: Meta
  primary: StrategyKey
  overlay?: StrategyKey | null
  nowMinute?: number | null
  compact?: boolean
  range?: [number, number]
  onRoomClick?: (room: string) => void
  selectedRoom?: string | null
  showDecisions?: boolean
  /** planned (wash) intervals under the actual bars */
  showPlan?: boolean
}) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [r0, r1] = range
  const sp = day.strategies[primary]
  const so = overlay ? day.strategies[overlay] : undefined

  const vByS = useMemo(() => {
    const m: Record<string, ValidationSession> = {}
    for (const v of day.validation?.sessions ?? []) m[v.session] = v
    return m
  }, [day])

  const sessByRoom = useMemo(() => {
    const m: Record<string, Session[]> = {}
    for (const s of day.sessions) (m[s.room] ??= []).push(s)
    return m
  }, [day])

  const decByRoom = useMemo(() => {
    const m: Record<string, Decision[]> = {}
    for (const d of day.decisions ?? []) (m[d.room] ??= []).push(d)
    return m
  }, [day])

  const hours: number[] = []
  for (let h = Math.ceil(r0 / 60); h * 60 <= r1; h++) hours.push(h)

  // lane geometry: lecture bar on top, then (optional plan wash with) the actual bar, then the overlay strategy
  const plan_ = !compact && showPlan
  const lecTop = compact ? 6 : 8
  const lecH = compact ? 18 : 24
  const actTop = compact ? 28 : plan_ ? 44 : 40
  const actH = compact ? 7 : 8
  const ovTop = actTop + actH + 5
  const rowH = compact ? 42 : (plan_ ? 62 : 56) + (overlay ? 12 : 0)
  const labelW = compact ? 64 : 80

  const show = (e: React.MouseEvent, node: ReactNode) => setTip({ x: e.clientX, y: e.clientY, node })
  const hide = () => setTip(null)

  const sessionTip = (s: Session) => {
    const v = vByS[s.id]
    const info = v ? statusInfo(v.status) : null
    return (
      <div className="max-w-[300px]">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          {s.kind === 'event' && <span className="rounded-[6px] bg-event-bg px-1.5 text-[12.5px] text-event-ink">이벤트</span>}
          {s.title}
        </div>
        <div className="mt-0.5 text-ink-2">
          {s.start}–{s.end}, {s.room}호{s.professor ? `, ${s.professor}` : ''}
        </div>
        <div className="text-ink-2">
          예상 인원 {s.expected_people ?? '–'}명{s.people_estimated ? ' (추정)' : ''}
        </div>
        {v && info && (
          <div className="mt-1.5 border-t border-line pt-1.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: GROUP_META[info.group].color }} />
              <b>{info.label}</b>
              {v.comfort_pct != null && <span className="text-ink-3">쾌적 {v.comfort_pct.toFixed(0)}%</span>}
            </div>
            {v.ta_start != null && <div className="text-ink-3">시작 시 실내 {v.ta_start.toFixed(1)}℃</div>}
            {v.notes.map((n, i) => (
              <div key={i} className="text-ink-2">
                {n}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const nowIn = nowMinute != null && nowMinute >= r0 && nowMinute <= r1

  return (
    <div className={cx('relative select-none', nowMinute != null && 'pb-6')} onMouseLeave={hide}>
      {/* hour header */}
      <div className="flex" style={{ height: 26 }}>
        <div style={{ width: labelW }} className="shrink-0" />
        <div className="relative flex-1">
          {hours.map((h) => (
            <div
              key={h}
              className="tnum absolute top-0 -translate-x-1/2 text-[12px] text-ink-3"
              style={{ left: `${pct(h * 60, r0, r1)}%` }}
            >
              {h % 2 === 1 ? '' : `${String(h).padStart(2, '0')}시`}
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* gridlines + now line overlay */}
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: labelW }}>
          {hours.map((h) => (
            <div key={h} className={cx('absolute inset-y-0 w-px', h % 2 ? 'bg-[#f3f5f8]' : 'bg-[#eaedf1]')} style={{ left: `${pct(h * 60, r0, r1)}%` }} />
          ))}
          {nowIn && (
            <div className="absolute inset-y-0 z-10" style={{ left: `${pct(nowMinute!, r0, r1)}%` }}>
              <div className="absolute inset-y-0 -ml-px w-[2px] bg-ink" />
              <div className="tnum absolute -bottom-[22px] -translate-x-1/2 rounded-[6px] bg-ink px-2 py-[2px] text-[12.5px] font-semibold whitespace-nowrap text-white">
                현재 {fmtMin(nowMinute!)}
              </div>
            </div>
          )}
        </div>

        {ROOM_ORDER.filter((r) => meta.rooms[r]).map((room, ri) => {
          const rm = meta.rooms[room]
          const sessions = sessByRoom[room] ?? []
          const plan = sp?.plan?.[room] ?? []
          const actual = sp?.rooms?.[room]?.actual ?? []
          const ovActual = so?.rooms?.[room]?.actual ?? []
          const decs = showDecisions && primary === 'ai' ? decByRoom[room] ?? [] : []
          const sel = selectedRoom === room
          const floorBreak = ri > 0 && rm.floor !== meta.rooms[ROOM_ORDER[ri - 1]]?.floor
          return (
            <div
              key={room}
              className={cx(
                'group flex border-t',
                floorBreak ? 'border-line-strong' : 'border-line',
                sel ? 'bg-[#eef3fb]' : onRoomClick && 'hover:bg-well',
              )}
              style={{ height: rowH }}
            >
              <button
                type="button"
                onClick={() => onRoomClick?.(room)}
                className={cx('flex shrink-0 flex-col justify-center pr-2 text-left', onRoomClick ? 'cursor-pointer' : 'cursor-default')}
                style={{ width: labelW }}
                title={onRoomClick ? `${room}호 ${rm.type_label}, ${STRATEGY[primary].short} ${fmtKwh(sp?.rooms?.[room]?.kwh ?? 0)} kWh. 눌러서 상세 보기` : undefined}
                aria-label={onRoomClick ? `${room}호 상세 보기` : undefined}
              >
                <span className={cx('tnum font-bold text-ink', compact ? 'text-[13px]' : 'text-[14px]')}>{room}</span>
              </button>

              <div className="relative flex-1">
                {/* lecture lane */}
                {sessions.map((s) => {
                  const a = hm(s.start)
                  const b = hm(s.end)
                  if (b <= r0 || a >= r1) return null
                  const v = vByS[s.id]
                  const g = v ? statusInfo(v.status).group : 'normal'
                  const isEv = s.kind === 'event'
                  return (
                    <div
                      key={s.id}
                      className={cx(
                        'absolute flex items-center overflow-hidden rounded-[6px] border-l-[3px] pr-1 pl-2',
                        isEv ? 'border-event bg-event-bg' : 'border-ink-2 bg-[#eceff3]',
                      )}
                      style={{
                        left: `${pct(a, r0, r1)}%`,
                        width: `calc(${pct(b, r0, r1) - pct(a, r0, r1)}% - 2px)`,
                        top: lecTop,
                        height: lecH,
                      }}
                      onMouseMove={(e) => show(e, sessionTip(s))}
                      onMouseLeave={hide}
                    >
                      <span className={cx('truncate font-medium text-ink', compact ? 'text-[12px]' : 'text-[13px]')}>{s.title}</span>
                      {g !== 'normal' && (
                        <span className="ml-auto shrink-0 pl-0.5">
                          {g === 'auto' ? (
                            <Wrench size={compact ? 10 : 11} color="#c98500" strokeWidth={2.6} />
                          ) : (
                            <AlertTriangle size={compact ? 10 : 11} color={GROUP_META.review.color} strokeWidth={2.6} />
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}

                {/* planned (wash) */}
                {plan_ &&
                  plan.map((p, i) => {
                    if (p.e <= r0 || p.s >= r1) return null
                    return (
                      <div
                        key={`p${i}`}
                        className="absolute rounded-[4px]"
                        style={{
                          left: `${pct(p.s, r0, r1)}%`,
                          width: `${pct(p.e, r0, r1) - pct(p.s, r0, r1)}%`,
                          top: actTop - 7,
                          height: actH + 14,
                          background: STRATEGY[primary].wash,
                          boxShadow: `inset 0 0 0 1px ${STRATEGY[primary].color}40`,
                        }}
                        onMouseMove={(e) =>
                          show(
                            e,
                            <div>
                              <div className="font-semibold">
                                {STRATEGY[primary].label} 계획: {p.kind === 'fan' ? '송풍(외기 냉방)' : '냉난방'}
                              </div>
                              <div className="tnum text-ink-2">
                                {fmtMin(p.s)}–{fmtMin(p.e)} ({fmtDuration(p.e - p.s)})
                              </div>
                              {p.reason && <div className="text-ink-3">{p.reason}</div>}
                            </div>,
                          )
                        }
                        onMouseLeave={hide}
                      />
                    )
                  })}

                {/* actual (solid) */}
                {actual.map((a, i) => {
                  if (a.e <= r0 || a.s >= r1) return null
                  const fan = a.kind === 'fan'
                  return (
                    <div
                      key={`a${i}`}
                      className="absolute rounded-[3px]"
                      style={{
                        left: `${pct(a.s, r0, r1)}%`,
                        width: `max(2px, ${pct(a.e, r0, r1) - pct(a.s, r0, r1)}%)`,
                        top: actTop,
                        height: actH,
                        background: STRATEGY[primary].color,
                        opacity: fan ? 0.4 : 1,
                      }}
                      onMouseMove={(e) =>
                        show(
                          e,
                          <div>
                            <div className="font-semibold">
                              {STRATEGY[primary].label} 실제 가동: {fan ? '송풍' : '냉난방'}
                            </div>
                            <div className="tnum text-ink-2">
                              {fmtMin(a.s)}–{fmtMin(a.e)} ({fmtDuration(a.e - a.s)})
                            </div>
                          </div>,
                        )
                      }
                      onMouseLeave={hide}
                    />
                  )
                })}

                {/* overlay strategy actual */}
                {overlay &&
                  !compact &&
                  ovActual.map((a, i) => {
                    if (a.e <= r0 || a.s >= r1) return null
                    return (
                      <div
                        key={`o${i}`}
                        className="absolute rounded-[3px]"
                        style={{
                          left: `${pct(a.s, r0, r1)}%`,
                          width: `max(2px, ${pct(a.e, r0, r1) - pct(a.s, r0, r1)}%)`,
                          top: ovTop,
                          height: 6,
                          background: STRATEGY[overlay].color,
                          opacity: a.kind === 'fan' ? 0.4 : 1,
                        }}
                        onMouseMove={(e) =>
                          show(
                            e,
                            <div>
                              <div className="font-semibold">
                                {STRATEGY[overlay].label} 실제 가동: {a.kind === 'fan' ? '송풍' : '냉난방'}
                              </div>
                              <div className="tnum text-ink-2">
                                {fmtMin(a.s)}–{fmtMin(a.e)} ({fmtDuration(a.e - a.s)})
                              </div>
                            </div>,
                          )
                        }
                        onMouseLeave={hide}
                      />
                    )
                  })}

                {/* decision markers */}
                {!compact &&
                  decs.map((d, i) => {
                    const m = decisionMinute(d, plan)
                    if (m < r0 || m > r1) return null
                    return (
                      <div
                        key={`d${i}`}
                        className="absolute z-[5] flex h-[18px] w-[18px] -translate-x-1/2 items-center justify-center rounded-full border-2 border-white bg-ink text-white"
                        style={{ left: `${pct(m, r0, r1)}%`, top: actTop + actH / 2 - 9 }}
                        onMouseMove={(e) =>
                          show(
                            e,
                            <div className="max-w-[280px]">
                              <div className="flex items-center gap-1.5 font-semibold">
                                <DecisionIcon type={d.type} />
                                AI 판단: {DECISION[d.type]?.label ?? d.type}
                              </div>
                              <div className="text-ink-2">
                                {d.title} ({d.start}–{d.end})
                              </div>
                              <div className="mt-1 text-ink">{d.detail}</div>
                              {d.saved_min != null && d.saved_min !== 0 && (
                                <div className="mt-1 text-ink-3">
                                  규칙 대비 가동 {d.saved_min > 0 ? `${d.saved_min}분 단축` : `${-d.saved_min}분 추가(쾌적 확보)`}
                                </div>
                              )}
                            </div>,
                          )
                        }
                        onMouseLeave={hide}
                      >
                        <DecisionIcon type={d.type} size={10} />
                      </div>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-[70] rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-[var(--shadow-float)]"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 320),
            top: tip.y + 16 + 160 > window.innerHeight ? tip.y - 12 : tip.y + 16,
            transform: tip.y + 16 + 160 > window.innerHeight ? 'translateY(-100%)' : undefined,
          }}
        >
          {tip.node}
        </div>
      )}
    </div>
  )
}

export function GanttLegend({
  primary,
  overlay,
  compact = false,
  showPlan = !compact,
  showDecisions = !compact,
}: {
  primary: StrategyKey
  overlay?: StrategyKey | null
  compact?: boolean
  showPlan?: boolean
  showDecisions?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2" aria-label="타임라인 범례">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded-[4px] border-l-[3px] border-ink-2 bg-[#eceff3]" aria-hidden />
        강의
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-5 rounded-[4px] border-l-[3px] border-event bg-event-bg" aria-hidden />
        이벤트
      </span>
      {showPlan && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-[4px]" style={{ background: STRATEGY[primary].wash, boxShadow: `inset 0 0 0 1px ${STRATEGY[primary].color}40` }} aria-hidden />
          {STRATEGY[primary].short} 계획
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-5 rounded-[2px]" style={{ background: STRATEGY[primary].color }} aria-hidden />
        {STRATEGY[primary].short} 실제 가동
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-5 rounded-[2px]" style={{ background: STRATEGY[primary].color, opacity: 0.4 }} aria-hidden />
        송풍(외기 냉방)
      </span>
      {overlay && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-[2px]" style={{ background: STRATEGY[overlay].color }} aria-hidden />
          {STRATEGY[overlay].short} 실제 가동(비교)
        </span>
      )}
      {showDecisions && primary === 'ai' && (
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
            <Timer size={9} strokeWidth={2.6} />
          </span>
          AI 판단
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Wrench size={13} color="#c98500" strokeWidth={2.6} aria-hidden /> 자동 조치
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertTriangle size={13} color={GROUP_META.review.color} strokeWidth={2.6} aria-hidden /> 확인 필요
      </span>
    </div>
  )
}
