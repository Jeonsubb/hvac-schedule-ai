import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Timer, Hourglass, SkipForward, Wind, Power, Link2, Wrench, AlertTriangle, Sparkles, Presentation, Monitor, Clapperboard } from 'lucide-react'
import type { Day, Decision, Interval, Meta, Session, StrategyKey, ValidationSession } from '../lib/types'
import { DECISION, ROOM_ORDER, STRATEGY, statusInfo, GROUP_META, type StatusGroup } from '../lib/constants'
import { cx, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'

// ---------------------------------------------------------------- shared timeline primitives (v5, mock image 3)

/** Diagonal stripes for time that is off-limits (outside regular operating hours, no data, future). */
export const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, rgba(20,32,51,0.075) 0 2px, transparent 2px 8px)',
  backgroundColor: 'rgba(240,242,245,0.55)',
}

export const BRAND = '#2f6fde'

export function pct(m: number, r0: number, r1: number) {
  return ((Math.min(Math.max(m, r0), r1) - r0) / (r1 - r0)) * 100
}

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

export function RoomTypeIcon({ type, size = 15 }: { type?: string; size?: number }) {
  if (type === 'lab') return <Monitor size={size} strokeWidth={2.1} aria-hidden />
  if (type === 'studio') return <Clapperboard size={size} strokeWidth={2.1} aria-hidden />
  return <Presentation size={size} strokeWidth={2.1} aria-hidden />
}

export const ROOM_TYPE_TONE: Record<string, { bg: string; ink: string }> = {
  lecture: { bg: '#eaf1fd', ink: '#1f56b8' },
  lab: { bg: '#e6f5ee', ink: '#0d7f5a' },
  studio: { bg: '#efedfb', ink: '#4a3aa7' },
}

/** Column header of rounded time pills; the column holding `focusMinute` is filled with the brand colour. */
export function TimePills({
  range,
  focusMinute,
  compact = false,
  stepMin = 60,
  format,
}: {
  range: [number, number]
  focusMinute?: number | null
  compact?: boolean
  stepMin?: number
  format?: (m: number) => string
}) {
  const [r0, r1] = range
  const cols: number[] = []
  for (let m = Math.floor(r0 / stepMin) * stepMin; m < r1; m += stepMin) cols.push(m)
  return (
    <div className="relative" style={{ height: compact ? 24 : 34 }} aria-hidden>
      {cols.map((m) => {
        const a = Math.max(m, r0)
        const b = Math.min(m + stepMin, r1)
        const on = focusMinute != null && focusMinute >= m && focusMinute < m + stepMin
        const label = format ? format(m) : compact ? String(Math.floor(m / 60)).padStart(2, '0') : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const narrow = b - a < stepMin * 0.6
        return (
          <div key={m} className="absolute inset-y-0 px-[2px]" style={{ left: `${pct(a, r0, r1)}%`, width: `${pct(b, r0, r1) - pct(a, r0, r1)}%` }}>
            <div
              className={cx(
                'tnum flex h-full items-center justify-center rounded-[9px] border font-medium whitespace-nowrap',
                compact ? 'text-[11.5px]' : 'text-[12.5px]',
                on ? 'border-transparent text-white shadow-[0_4px_12px_rgb(47_111_222/0.28)]' : 'border-line bg-surface text-ink-2',
              )}
              style={on ? { background: BRAND } : undefined}
            >
              {narrow ? '' : label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Small white status chip that sits inside a coloured pill (like "● Healthy"). */
export function PillChip({ children, dot }: { children: ReactNode; dot: string }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full bg-white/95 px-1.5 text-[11.5px] leading-none font-semibold whitespace-nowrap text-ink">
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden />
      {children}
    </span>
  )
}

/** Dashed brand line marking "now" (or a selected time) across the rows. */
export function NowLine({ minute, range, label }: { minute: number; range: [number, number]; label?: string }) {
  const [r0, r1] = range
  if (minute < r0 || minute > r1) return null
  return (
    <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${pct(minute, r0, r1)}%` }}>
      <div className="absolute inset-y-0 -ml-px border-l-2 border-dashed" style={{ borderColor: BRAND }} />
      {label && (
        <div className="tnum absolute -bottom-[24px] -translate-x-1/2 rounded-full px-2.5 py-[2px] text-[12.5px] font-semibold whitespace-nowrap text-white" style={{ background: BRAND }}>
          {label}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- schedule timeline

interface Tip {
  x: number
  y: number
  node: ReactNode
}

export function decisionMinute(d: Decision, plan: Interval[] | undefined): number {
  const sid = d.session ?? d.sessions?.[0]
  const iv = plan?.find((p) => sid && p.sessions?.includes(sid))
  const at = DECISION[d.type]?.at ?? 'start'
  if (iv) return at === 'end' ? iv.e : iv.s
  return at === 'end' ? hm(d.end) : hm(d.start)
}

const GROUP_RANK: Record<StatusGroup, number> = { normal: 0, auto: 1, review: 2 }

function chipFor(a: Interval, decs: Decision[], plan: Interval[], sessions: Session[], vByS: Record<string, ValidationSession>) {
  // decisions that land on this run (start-type at its start, end-type at its end)
  const hit = decs.filter((d) => {
    const m = decisionMinute(d, plan)
    return m >= a.s - 2 && m <= a.e + 2
  })
  let group: StatusGroup = 'normal'
  for (const s of sessions) {
    if (hm(s.end) <= a.s || hm(s.start) >= a.e) continue
    const v = vByS[s.id]
    if (!v) continue
    const g = statusInfo(v.status).group
    if (GROUP_RANK[g] > GROUP_RANK[group]) group = g
  }
  if (group !== 'normal') return { text: GROUP_META[group].label, dot: GROUP_META[group].color }
  const start = hit.find((d) => DECISION[d.type]?.at !== 'end') ?? hit[0]
  if (start) {
    const lead = (start as Decision & { lead_min?: number }).lead_min
    const text = start.type === 'optimal_start' && lead ? `예열 ${lead}분` : (DECISION[start.type]?.label ?? '판단')
    return { text, dot: BRAND, extra: hit.length > 1 ? hit.length - 1 : 0 }
  }
  return { text: '정상', dot: GROUP_META.normal.color }
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
  /** planned (dashed) intervals around the actual bars */
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
    for (const s of day.sessions ?? []) (m[s.room] ??= []).push(s)
    return m
  }, [day])

  const decByRoom = useMemo(() => {
    const m: Record<string, Decision[]> = {}
    for (const d of day.decisions ?? []) (m[d.room] ??= []).push(d)
    return m
  }, [day])

  // regular operating hours (current operation) — the rest is hatched like an off-limits column
  const opOn = hm(String(meta.settings?.fixed_on ?? '08:30'))
  const opOff = hm(String(meta.settings?.fixed_off ?? '18:00'))

  const plan_ = !compact && showPlan
  const lecTop = compact ? 5 : 7
  const lecH = compact ? 15 : 22
  const actTop = compact ? 24 : 36
  const actH = compact ? 12 : 26
  const ovTop = actTop + actH + 5
  const rowH = compact ? 44 : 72 + (overlay ? 10 : 0)
  const labelW = compact ? 76 : 184

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

  const focus = nowMinute != null && nowMinute >= r0 && nowMinute <= r1 ? nowMinute : null
  const rows = ROOM_ORDER.filter((r) => meta.rooms[r])

  return (
    <div className={cx('relative select-none', focus != null && 'pb-7')} onMouseLeave={hide}>
      {/* time header */}
      <div className="mb-2 flex">
        <div style={{ width: labelW }} className="shrink-0 pr-3">
          {!compact && <div className="flex h-[34px] items-center pl-1 text-[13px] font-semibold text-ink-3">강의실</div>}
        </div>
        <div className="min-w-0 flex-1">
          <TimePills range={range} focusMinute={focus} compact={compact} />
        </div>
      </div>

      <div className="relative">
        {/* hatched off-hours columns + now line, behind/over the lanes */}
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: labelW }}>
          {opOn > r0 && <div className="absolute inset-y-0 rounded-l-[10px]" style={{ left: 0, width: `${pct(opOn, r0, r1)}%`, ...HATCH }} />}
          {opOff < r1 && <div className="absolute inset-y-0 rounded-r-[10px]" style={{ left: `${pct(opOff, r0, r1)}%`, right: 0, ...HATCH }} />}
          {focus != null && <NowLine minute={focus} range={range} label={`현재 ${fmtMin(focus)}`} />}
        </div>

        {rows.map((room) => {
          const rm = meta.rooms[room]
          const sessions = sessByRoom[room] ?? []
          const plan = sp?.plan?.[room] ?? []
          const actual = sp?.rooms?.[room]?.actual ?? []
          const ovActual = so?.rooms?.[room]?.actual ?? []
          const decs = primary === 'ai' ? decByRoom[room] ?? [] : []
          const markers = showDecisions ? decs : []
          const sel = selectedRoom === room
          const tone = ROOM_TYPE_TONE[rm.type] ?? ROOM_TYPE_TONE.lecture
          const color = STRATEGY[primary].color
          return (
            <div key={room} className="flex" style={{ height: rowH }}>
              {/* row card */}
              <div className="shrink-0 py-1 pr-3" style={{ width: labelW }}>
                <button
                  type="button"
                  onClick={() => onRoomClick?.(room)}
                  className={cx(
                    'flex h-full w-full items-center gap-2.5 rounded-[8px] text-left transition-colors duration-200',
                    compact ? 'px-2' : 'px-2.5',
                    sel && 'bg-[#eef0f3]',
                    onRoomClick ? cx('cursor-pointer', !sel && 'hover:bg-[#f4f5f7]') : 'cursor-default',
                  )}
                  title={onRoomClick ? `${room}호 ${rm.type_label}, ${STRATEGY[primary].short} ${fmtKwh(sp?.rooms?.[room]?.kwh ?? 0)} kWh. 눌러서 상세 보기` : undefined}
                  aria-label={onRoomClick ? `${room}호 상세 보기` : undefined}
                >
                  {!compact && (
                    <span className="flex h-8 w-6 shrink-0 items-center justify-center" style={{ color: tone.ink }}>
                      <RoomTypeIcon type={rm.type} />
                    </span>
                  )}
                  <span className="min-w-0 leading-tight">
                    <span className={cx('tnum block font-semibold text-ink', compact ? 'text-[13px]' : 'text-[15px]')}>
                      {room}
                      {!compact && '호'}
                    </span>
                    {!compact && (
                      <span className="mt-0.5 block truncate text-[13px] text-ink-3">
                        {rm.type_label} · 수업 {sessions.length}
                      </span>
                    )}
                  </span>
                </button>
              </div>

              <div className={cx('relative flex-1 border-b border-line/70', sel && 'bg-brand-bg/50')}>
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
                        'absolute flex items-center overflow-hidden rounded-full border pr-1.5 pl-2.5',
                        isEv ? 'border-[#d6d0f5] bg-event-bg' : 'border-line bg-[#f1f3f6]',
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
                      <span className={cx('truncate font-medium', isEv ? 'text-event-ink' : 'text-ink-2', compact ? 'text-[11.5px]' : 'text-[12.5px]')}>{s.title}</span>
                      {g !== 'normal' && (
                        <span className="ml-auto shrink-0 pl-0.5">
                          {g === 'auto' ? (
                            <Wrench size={compact ? 10 : 12} color="#c98500" strokeWidth={2.6} />
                          ) : (
                            <AlertTriangle size={compact ? 10 : 12} color={GROUP_META.review.color} strokeWidth={2.6} />
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}

                {/* planned (dashed outline) */}
                {plan_ &&
                  plan.map((p, i) => {
                    if (p.e <= r0 || p.s >= r1) return null
                    return (
                      <div
                        key={`p${i}`}
                        className="absolute rounded-full border-[1.5px] border-dashed"
                        style={{
                          left: `calc(${pct(p.s, r0, r1)}% - 3px)`,
                          width: `calc(${pct(p.e, r0, r1) - pct(p.s, r0, r1)}% + 6px)`,
                          top: actTop - 4,
                          height: actH + 8,
                          borderColor: `${color}99`,
                          background: STRATEGY[primary].wash,
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

                {/* actual run: coloured pill with icon + label + status chip */}
                {actual.map((a, i) => {
                  if (a.e <= r0 || a.s >= r1) return null
                  const fan = a.kind === 'fan'
                  const w = pct(a.e, r0, r1) - pct(a.s, r0, r1)
                  const chip = !compact && primary === 'ai' ? chipFor(a, decs, plan, sessions, vByS) : null
                  return (
                    <div
                      key={`a${i}`}
                      className="absolute flex items-center gap-1.5 overflow-hidden rounded-full"
                      style={{
                        left: `${pct(a.s, r0, r1)}%`,
                        width: `max(${compact ? 3 : 8}px, ${w}%)`,
                        top: actTop,
                        height: actH,
                        background: fan ? `${color}66` : `linear-gradient(90deg, ${color}, ${color}dd)`,
                        paddingLeft: compact ? 0 : 4,
                        paddingRight: compact ? 0 : 4,
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
                            {chip && <div className="mt-0.5 text-ink-3">상태: {chip.text}</div>}
                          </div>,
                        )
                      }
                      onMouseLeave={hide}
                    >
                      {!compact && w > 2.2 && (
                        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white/90" style={{ color }}>
                          {fan ? <Wind size={11} strokeWidth={2.6} aria-hidden /> : <Power size={11} strokeWidth={2.6} aria-hidden />}
                        </span>
                      )}
                      {!compact && w > 5.5 && <span className="truncate text-[12.5px] font-semibold text-white">{fan ? '송풍' : '가동'}</span>}
                      {chip && w > 11 && (
                        <span className="ml-auto">
                          <PillChip dot={chip.dot}>
                            {chip.text}
                            {chip.extra ? ` +${chip.extra}` : ''}
                          </PillChip>
                        </span>
                      )}
                    </div>
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
                        className="absolute rounded-full"
                        style={{
                          left: `${pct(a.s, r0, r1)}%`,
                          width: `max(3px, ${pct(a.e, r0, r1) - pct(a.s, r0, r1)}%)`,
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
                  markers.map((d, i) => {
                    const m = decisionMinute(d, plan)
                    if (m < r0 || m > r1) return null
                    return (
                      <div
                        key={`d${i}`}
                        className="absolute z-[5] flex h-[17px] w-[17px] -translate-x-1/2 items-center justify-center rounded-full border-2 border-white text-white shadow-[0_2px_6px_rgb(20_32_51/0.2)]"
                        style={{ left: `${pct(m, r0, r1)}%`, top: actTop - 12, background: BRAND }}
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
                        <DecisionIcon type={d.type} size={9} />
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
  const color = STRATEGY[primary].color
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2" aria-label="타임라인 범례">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-6 rounded-full border border-line bg-[#f1f3f6]" aria-hidden />
        강의
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-6 rounded-full border border-[#d6d0f5] bg-event-bg" aria-hidden />
        이벤트
      </span>
      {showPlan && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-6 rounded-full border-[1.5px] border-dashed" style={{ background: STRATEGY[primary].wash, borderColor: `${color}99` }} aria-hidden />
          {STRATEGY[primary].short} 계획
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-6 rounded-full" style={{ background: color }} aria-hidden />
        {STRATEGY[primary].short} 실제 가동
      </span>
      {!compact && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-6 rounded-full" style={{ background: `${color}66` }} aria-hidden />
          송풍(외기 냉방)
        </span>
      )}
      {overlay && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-6 rounded-full" style={{ background: STRATEGY[overlay].color }} aria-hidden />
          {STRATEGY[overlay].short} 실제 가동(비교)
        </span>
      )}
      {showDecisions && primary === 'ai' && (
        <span className="inline-flex items-center gap-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: BRAND }} aria-hidden>
            <Timer size={9} strokeWidth={2.6} />
          </span>
          AI 판단
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3.5 w-6 rounded-[4px] border border-line" style={HATCH} aria-hidden />
        정규 운영 시간 밖
      </span>
      {!compact && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-0 border-l-2 border-dashed" style={{ borderColor: BRAND }} aria-hidden />
          현재 시각
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
