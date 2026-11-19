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

  const rowH = compact ? 40 : overlay ? 72 : 62
  const labelW = compact ? 86 : 128

  const show = (e: React.MouseEvent, node: ReactNode) => setTip({ x: e.clientX, y: e.clientY, node })
  const hide = () => setTip(null)

  const sessionTip = (s: Session) => {
    const v = vByS[s.id]
    const info = v ? statusInfo(v.status) : null
    return (
      <div className="max-w-[300px]">
        <div className="flex items-center gap-1.5 font-semibold text-ink">
          {s.kind === 'event' && <span className="rounded-[4px] bg-event-bg px-1 text-[11px] text-event-ink">이벤트</span>}
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
    <div className={cx('relative select-none', nowMinute != null && 'pb-5')} onMouseLeave={hide}>
      {/* hour header */}
      <div className="flex" style={{ height: compact ? 20 : 24 }}>
        <div style={{ width: labelW }} className="shrink-0" />
        <div className="relative flex-1">
          {hours.map((h) => (
            <div
              key={h}
              className="tnum absolute top-0 -translate-x-1/2 text-[11px] text-ink-3"
              style={{ left: `${pct(h * 60, r0, r1)}%` }}
            >
              {compact && h % 2 === 1 ? '' : `${String(h).padStart(2, '0')}시`}
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* gridlines + now line overlay */}
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: labelW }}>
          {hours.map((h) => (
            <div key={h} className="absolute inset-y-0 w-px bg-[#edf0f4]" style={{ left: `${pct(h * 60, r0, r1)}%` }} />
          ))}
          {nowIn && (
            <div className="absolute inset-y-0 z-10" style={{ left: `${pct(nowMinute!, r0, r1)}%` }}>
              <div className="absolute inset-y-0 -ml-px w-[2px] bg-ink" />
              <div className="tnum absolute -bottom-[18px] -translate-x-1/2 rounded-[4px] bg-ink px-1.5 py-[1px] text-[11px] font-semibold whitespace-nowrap text-white">
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
                sel ? 'bg-[#eaf0fb]' : onRoomClick && 'hover:bg-well',
              )}
              style={{ height: rowH }}
            >
              <button
                type="button"
                onClick={() => onRoomClick?.(room)}
                className={cx('flex shrink-0 flex-col justify-center pr-2 text-left', onRoomClick ? 'cursor-pointer' : 'cursor-default')}
                style={{ width: labelW }}
                title={onRoomClick ? `${room}호 상세 보기` : undefined}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className={cx('font-bold text-ink', compact ? 'text-[12.5px]' : 'text-[13.5px]')}>{room}</span>
                  {!compact && <span className="truncate text-[12px] text-ink-3">{rm.type_label}</span>}
                </div>
                {!compact && (
                  <div className="tnum mt-0.5 flex items-center gap-1.5 text-[12px] whitespace-nowrap text-ink-3" title={`${rm.odu} 연결`}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STRATEGY[primary].color }} />
                    {fmtKwh(sp?.rooms?.[room]?.kwh ?? 0)} kWh
                  </div>
                )}
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
                        'absolute flex items-center overflow-hidden rounded-[4px] border-l-[3px] pr-1 pl-1.5',
                        isEv ? 'border-event bg-event-bg' : 'border-ink bg-[#e8ecf2]',
                      )}
                      style={{
                        left: `${pct(a, r0, r1)}%`,
                        width: `calc(${pct(b, r0, r1) - pct(a, r0, r1)}% - 2px)`,
                        top: compact ? 5 : 6,
                        height: compact ? 18 : 22,
                      }}
                      onMouseMove={(e) => show(e, sessionTip(s))}
                      onMouseLeave={hide}
                    >
                      <span className={cx('truncate font-medium text-ink', compact ? 'text-[11px]' : 'text-[12px]')}>
                        {s.title}
                        {!compact && <span className="ml-1 font-normal text-ink-3">{s.start}</span>}
                      </span>
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
                {!compact &&
                  plan.map((p, i) => {
                    if (p.e <= r0 || p.s >= r1) return null
                    return (
                      <div
                        key={`p${i}`}
                        className="absolute rounded-[4px]"
                        style={{
                          left: `${pct(p.s, r0, r1)}%`,
                          width: `${pct(p.e, r0, r1) - pct(p.s, r0, r1)}%`,
                          top: 33,
                          height: 22,
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
                        top: compact ? 27 : 40,
                        height: compact ? 7 : 8,
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
                          top: 60,
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
                        style={{ left: `${pct(m, r0, r1)}%`, top: 35 }}
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
          className="pointer-events-none fixed z-[70] rounded-[8px] border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed shadow-[var(--shadow-float)]"
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

export function GanttLegend({ primary, overlay, compact = false }: { primary: StrategyKey; overlay?: StrategyKey | null; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2" aria-label="타임라인 범례">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[3px] border-l-[3px] border-ink bg-[#e8ecf2]" />
        강의
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-[3px] border-l-[3px] border-event bg-event-bg" />
        이벤트
      </span>
      {!compact && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-5 rounded-[3px]"
            style={{ background: STRATEGY[primary].wash, boxShadow: `inset 0 0 0 1px ${STRATEGY[primary].color}40` }}
          />
          {STRATEGY[primary].short} 계획
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-5 rounded-[2px]" style={{ background: STRATEGY[primary].color }} />
        {STRATEGY[primary].short} 실제 가동(냉난방)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-5 rounded-[2px]" style={{ background: STRATEGY[primary].color, opacity: 0.4 }} />
        송풍(외기 냉방)
      </span>
      {overlay && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded-[2px]" style={{ background: STRATEGY[overlay].color }} />
          {STRATEGY[overlay].short} 실행(비교)
        </span>
      )}
      {!compact && primary === 'ai' && (
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white">
            <Timer size={9} strokeWidth={2.6} />
          </span>
          AI 판단
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <Wrench size={12} color="#c98500" strokeWidth={2.6} /> 자동 조치
      </span>
      <span className="inline-flex items-center gap-1">
        <AlertTriangle size={12} color={GROUP_META.review.color} strokeWidth={2.6} /> 확인 필요
      </span>
    </div>
  )
}
