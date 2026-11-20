import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Flame, Snowflake, Wind, Fan, Users, CloudSun, Play, Pause, AlertTriangle } from 'lucide-react'
import type { Day, Meta } from '../lib/types'
import { MODE, shade, thermalFill, thermalGradient, type BuildingState, type Mode, type RoomState } from '../lib/thermal'
import { cx, fmtMin, hm } from '../lib/format'
import { STRATEGY } from '../lib/constants'

// ---------------------------------------------------------------- helpers

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const el = ref.current
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function ModeIcon({ mode, size = 13, className }: { mode: Mode; size?: number; className?: string }) {
  const p = { size, strokeWidth: 2.3, className, 'aria-hidden': true as const }
  if (mode === 'heat') return <Flame {...p} />
  if (mode === 'cool') return <Snowflake {...p} />
  if (mode === 'air') return <Wind {...p} />
  return <span className={cx('inline-block rounded-full border-[1.5px] border-ink-4', className)} style={{ width: size - 3, height: size - 3 }} aria-hidden />
}

// ---------------------------------------------------------------- floor plates (v5, not to scale)

interface Slot {
  room?: string
  label?: string
  w: number
}

/** Back row: the HVAC rooms (data tiles). Front row: other spaces, drawn low and neutral for orientation. */
const BACK: Record<number, Slot[]> = {
  4: [{ room: '405', w: 1 }, { room: '406', w: 1 }, { room: '407', w: 1 }, { room: '408', w: 1 }, { room: '409', w: 1 }, { room: '410', w: 1 }],
  3: [{ room: '306', w: 1 }, { room: '307', w: 1 }, { label: '교수연구실', w: 0.8 }, { room: '309', w: 1 }, { room: '310', w: 1 }, { label: '세미나실', w: 0.8 }],
}
const FRONT: Record<number, Slot[]> = {
  4: [{ label: '자율실습실', w: 1.5 }, { label: 'EV', w: 0.45 }, { label: '계단', w: 0.75 }, { label: '남자화장실', w: 1 }, { label: '여자화장실', w: 1 }, { label: 'EV', w: 0.45 }, { label: '교수연구실', w: 1.5 }],
  3: [{ label: '학과 사무실', w: 1.5 }, { label: 'EV', w: 0.45 }, { label: '계단', w: 0.75 }, { label: '남자화장실', w: 1 }, { label: '여자화장실', w: 1 }, { label: 'EV', w: 0.45 }, { label: '대학원 연구실', w: 1.5 }],
}

// oblique projection (px): plan depth recedes up-right. P(x, d, z) = (GUT + x + d·K, Yb − d·S − z)
const GUT = 64 // floor label gutter
const K = 0.42 // horizontal shift per px of depth
const S = 0.55 // vertical foreshortening of depth
const M_FRONT = 12
const D_FRONT = 78 // front row depth (other spaces)
const D_CORR = 34 // corridor
const D_BACK = 134 // back row depth (HVAC rooms)
const M_BACK = 18 // strip behind the rooms (refrigerant lines)
const D = M_FRONT + D_FRONT + D_CORR + D_BACK + M_BACK
const H_ROOM = 14 // extrusion of a room tile
const H_SPACE = 7 // extrusion of other spaces
const SLAB = 12 // plate thickness
const GAP = 8 // gap between tiles
const CHIP = 26
const CHIP_GAP = 14
const FLOOR_GAP = 30

type Pt = [number, number]
const poly = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

/** Tile colours: a running room wears its mode (heat orange, cool blue, fan teal); an idle room shows its temperature. */
const MODE_TILE: Record<Exclude<Mode, 'off'>, [string, string]> = {
  heat: ['#ffd3b8', '#f39462'],
  cool: ['#cfe0fb', '#86aef0'],
  air: ['#cdeeed', '#84d0cc'],
}

function place(slots: Slot[], L: number) {
  const unit = (L - GAP * (slots.length - 1)) / slots.reduce((a, s) => a + s.w, 0)
  let acc = 0
  return slots.map((s) => {
    const x0 = acc
    const x1 = acc + s.w * unit
    acc = x1 + GAP
    return { ...s, x0, x1 }
  })
}

// ---------------------------------------------------------------- building floor plates

export default function BuildingView({
  meta,
  state,
  onRoomClick,
  selected,
  minWidth = 760,
  showOdus = false,
}: {
  meta: Meta
  state: BuildingState
  onRoomClick?: (room: string) => void
  selected?: string | null
  minWidth?: number
  /** outdoor units and refrigerant lines: an opt-in detail layer */
  showOdus?: boolean
}) {
  const [wrapRef, measured] = useWidth<HTMLDivElement>()
  const W = Math.max(minWidth, measured || 1000)
  const [hover, setHover] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const byRoom = useMemo(() => Object.fromEntries(state.rooms.map((r) => [r.room, r])) as Record<string, RoomState>, [state])

  const L = W - GUT - D * K - 8
  const floors = [4, 3].filter((f) => Object.values(meta.rooms).some((r) => r.floor === f))
  const TOP = showOdus ? CHIP + CHIP_GAP : 4
  const BLOCK = TOP + D * S + H_ROOM + SLAB
  const totalH = floors.length * BLOCK + (floors.length - 1) * FLOOR_GAP + 6

  const tipRoom = hover ?? focus
  const tipData = tipRoom ? byRoom[tipRoom] : undefined

  // depth bands (d measured from the front edge)
  const dF0 = M_FRONT
  const dF1 = M_FRONT + D_FRONT
  const dB0 = dF1 + D_CORR
  const dB1 = dB0 + D_BACK
  const dPipe = dB1 + M_BACK / 2

  return (
    <div ref={wrapRef} className="relative w-full overflow-x-auto">
      <svg width={W} height={totalH} role="group" aria-label="IT관 3층·4층 평면: 강의실 타일 색은 실내온도(가동 중이면 운전 모드), 아이콘은 운전 모드" className="block select-none">
        <defs>
          {(Object.keys(MODE_TILE) as Exclude<Mode, 'off'>[]).map((m) => (
            <linearGradient key={m} id={`bv-tile-${m}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={MODE_TILE[m][0]} />
              <stop offset="1" stopColor={MODE_TILE[m][1]} />
            </linearGradient>
          ))}
          <linearGradient id="bv-plate" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f3f6fa" />
            <stop offset="1" stopColor="#e7ecf3" />
          </linearGradient>
        </defs>
        {floors.map((floor, fi) => {
          const T = fi * (BLOCK + FLOOR_GAP)
          const Yb = T + TOP + D * S + H_ROOM
          const P = (x: number, d: number, z: number): Pt => [GUT + x + d * K, Yb - d * S - z]
          const back = place(BACK[floor] ?? [], L)
          const front = place(FRONT[floor] ?? [], L)
          const odus = Object.values(meta.odus).filter((o) => o.floor === floor)
          const box = (x0: number, x1: number, d0: number, d1: number, h: number) => ({
            top: poly([P(x0, d0, h), P(x1, d0, h), P(x1, d1, h), P(x0, d1, h)]),
            front: poly([P(x0, d0, 0), P(x1, d0, 0), P(x1, d0, h), P(x0, d0, h)]),
            side: poly([P(x1, d0, 0), P(x1, d1, 0), P(x1, d1, h), P(x1, d0, h)]),
          })
          return (
            <g key={floor}>
              {/* floor label in the gutter */}
              <text x={6} y={P(0, D * 0.62, 0)[1] + 12} fontSize="34" fontWeight="750" fill="#2b3447" style={{ letterSpacing: '-0.03em' }}>
                {floor}F
              </text>
              {/* plate: top and front lip (rounded by a same-colour stroke) */}
              <polygon points={poly([P(-8, 0, -SLAB), P(L + 8, 0, -SLAB), P(L + 8, 0, 0), P(-8, 0, 0)])} fill="#d7dee8" stroke="#d7dee8" strokeWidth="6" strokeLinejoin="round" />
              <polygon points={poly([P(L + 8, 0, -SLAB), P(L + 8, D, -SLAB), P(L + 8, D, 0), P(L + 8, 0, 0)])} fill="#c9d2de" stroke="#c9d2de" strokeWidth="6" strokeLinejoin="round" />
              <polygon points={poly([P(-8, 0, 0), P(L + 8, 0, 0), P(L + 8, D, 0), P(-8, D, 0)])} fill="url(#bv-plate)" stroke="#e7ecf3" strokeWidth="6" strokeLinejoin="round" />

              {/* refrigerant lines behind the rooms, one per outdoor unit (opt-in layer) */}
              {showOdus &&
                odus.map((o) => {
                  const rs = back.filter((s) => s.room && meta.rooms[s.room]?.odu === o.id)
                  if (!rs.length) return null
                  const st = state.odus[o.id]
                  const on = !!st?.on
                  const col = on ? MODE[st.mode].color : '#b9c2cd'
                  const xa = (rs[0].x0 + rs[0].x1) / 2
                  const xb = (rs[rs.length - 1].x0 + rs[rs.length - 1].x1) / 2
                  const [ax, ay] = P(xa, dPipe, 0)
                  const [bx, by] = P(xb, dPipe, 0)
                  const mid = (ax + bx) / 2
                  const chipW = 168
                  return (
                    <g key={o.id}>
                      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={col} strokeWidth={on ? 2.5 : 1.5} strokeLinecap="round" />
                      {rs.map((s) => {
                        const r = byRoom[s.room!]
                        const [cx_, cy_] = P((s.x0 + s.x1) / 2, dPipe, 0)
                        const run = r && r.mode !== 'off'
                        return <circle key={s.room} cx={cx_} cy={cy_} r={3.2} fill={run ? MODE[r.mode].color : '#ffffff'} stroke={run ? '#ffffff' : '#b9c2cd'} strokeWidth={1.5} />
                      })}
                      <line x1={mid} y1={T + CHIP} x2={mid} y2={ay} stroke={col} strokeWidth="1.25" />
                      <g transform={`translate(${mid - chipW / 2} ${T})`}>
                        <title>{`실외기 ${o.id} (${o.label}, 용량 ${o.cap_kw} kW): ${on ? `가동 ${((st?.power_w ?? 0) / 1000).toFixed(1)} kW` : '정지'}`}</title>
                        <rect width={chipW} height={CHIP} rx="13" fill="#ffffff" stroke={on ? col : '#d5dbe3'} strokeWidth={on ? 1.5 : 1} />
                        <g transform="translate(9 6)" className={on ? 'fan-spin' : undefined}>
                          <Fan size={14} color={on ? col : '#97a1ae'} strokeWidth={2.2} />
                        </g>
                        <text x="29" y="17.5" fontSize="13" fontWeight="600" fill="#142033">
                          실외기 {o.id.replace('ODU-', '')}
                        </text>
                        <text x={chipW - 11} y="17.5" fontSize="13" fontWeight={on ? 650 : 500} textAnchor="end" fill={on ? MODE[st.mode].deep : '#667183'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {on ? `${((st?.power_w ?? 0) / 1000).toFixed(1)} kW` : '정지'}
                        </text>
                      </g>
                    </g>
                  )
                })}

              {/* back row: HVAC rooms and other spaces, left to right */}
              {back.map((s, si) => {
                const b = box(s.x0, s.x1, dB0, dB1, s.room ? H_ROOM : H_SPACE)
                if (!s.room) {
                  const [lx, ly] = P((s.x0 + s.x1) / 2, (dB0 + dB1) / 2, H_SPACE)
                  return (
                    <g key={`b${si}`} aria-hidden>
                      <polygon points={b.side} fill="#dfe4eb" />
                      <polygon points={b.front} fill="#e3e8ef" />
                      <polygon points={b.top} fill="#f8fafc" stroke="#e6ebf1" strokeWidth="1" strokeLinejoin="round" />
                      <text x={lx} y={ly + 4} textAnchor="middle" fontSize="12.5" fontWeight="500" fill="#8a94a3">
                        {s.label}
                      </text>
                    </g>
                  )
                }
                const r = byRoom[s.room]
                const rm = meta.rooms[s.room]
                if (!r || !rm) return null
                const run = r.mode !== 'off'
                const fill = Number.isFinite(r.ta) ? thermalFill(r.ta, lo, hi) : '#eef1f4'
                const topFill = run ? `url(#bv-tile-${r.mode})` : `url(#bv-idle-${s.room})`
                const base = run ? MODE_TILE[r.mode as Exclude<Mode, 'off'>][1] : fill
                const occupied = !!r.session
                const outBand = occupied && (r.ta < lo || r.ta > hi)
                const isSel = selected === s.room
                const isHover = hover === s.room
                const isFocus = focus === s.room
                const [cx0, cy0] = P((s.x0 + s.x1) / 2, (dB0 + dB1) / 2, H_ROOM)
                const [bx, by] = P(s.x1, dB1, H_ROOM)
                const label = `${s.room}호, 실내 ${Number.isFinite(r.ta) ? r.ta.toFixed(1) : '알 수 없음'}도, ${MODE[r.mode].label}${outBand ? ', 수업 중 쾌적 범위 밖' : ''}${
                  r.session ? `, 강의 중: ${r.session.title}` : r.next ? `, 다음 강의 ${r.next.start}` : ''
                }. 눌러서 상세 보기`
                return (
                  <g
                    key={s.room}
                    role={onRoomClick ? 'button' : undefined}
                    tabIndex={onRoomClick ? 0 : undefined}
                    aria-label={label}
                    aria-pressed={onRoomClick ? isSel : undefined}
                    className={cx('iso-room outline-none', onRoomClick && 'cursor-pointer')}
                    onClick={() => onRoomClick?.(s.room!)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onRoomClick?.(s.room!)
                      }
                    }}
                    onMouseEnter={() => setHover(s.room!)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={(e) => e.currentTarget.matches(':focus-visible') && setFocus(s.room!)}
                    onBlur={() => setFocus(null)}
                  >
                    {!run && (
                      <defs>
                        <linearGradient id={`bv-idle-${s.room}`} x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0" stopColor={shade(fill, -0.42)} />
                          <stop offset="1" stopColor={fill} />
                        </linearGradient>
                      </defs>
                    )}
                    <polygon points={b.side} fill={shade(base, 0.22)} />
                    <polygon points={b.front} fill={shade(base, 0.12)} />
                    <polygon points={b.top} fill={topFill} />
                    {isHover && !isSel && <polygon points={b.top} fill="#ffffff" opacity="0.18" />}
                    {/* number, temperature, mode badge. Nothing else. */}
                    <text x={cx0} y={cy0 - 9} textAnchor="middle" fontSize="15" fontWeight="700" fill="#142033" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {s.room}
                    </text>
                    <text x={cx0} y={cy0 + 20} textAnchor="middle" fontSize="26" fontWeight="700" fill={outBand ? '#a12a2a' : '#142033'} style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em' }}>
                      {Number.isFinite(r.ta) ? r.ta.toFixed(1) : '–'}
                      <tspan fontSize="14" fontWeight="500" fill={outBand ? '#a12a2a' : '#4a5668'} dx="1">
                        ℃
                      </tspan>
                    </text>
                    {outBand && (
                      <g transform={`translate(${cx0 + 46} ${cy0 + 4})`}>
                        <AlertTriangle size={15} color="#d03b3b" strokeWidth={2.4} />
                      </g>
                    )}
                    {run && (
                      <g transform={`translate(${bx - 38} ${by + 6})`}>
                        <circle cx="12" cy="12" r="12" fill={MODE[r.mode].color} stroke="#ffffff" strokeWidth="1.5" />
                        <g transform="translate(5.5 5.5)">
                          <ModeIcon mode={r.mode} size={13} className="text-white" />
                        </g>
                      </g>
                    )}
                    {occupied && (
                      <g transform={`translate(${P(s.x0, dB1, H_ROOM)[0] + 12} ${P(s.x0, dB1, H_ROOM)[1] + 8})`} aria-hidden>
                        <rect width="22" height="18" rx="9" fill="#ffffff" opacity="0.92" />
                        <g transform="translate(4 2)">
                          <Users size={14} color="#142033" strokeWidth={2.2} />
                        </g>
                      </g>
                    )}
                    {/* selection, hover and keyboard focus outlines on the top face */}
                    <polygon
                      points={b.top}
                      fill="transparent"
                      stroke={isFocus ? '#2f6fde' : isSel ? '#2f6fde' : isHover ? '#4a5668' : 'none'}
                      strokeWidth={isFocus ? 3 : isSel ? 2.5 : 1.25}
                      strokeLinejoin="round"
                    />
                  </g>
                )
              })}

              {/* front row: other spaces (low, neutral) */}
              {front.map((s, si) => {
                const b = box(s.x0, s.x1, dF0, dF1, H_SPACE)
                const [lx, ly] = P((s.x0 + s.x1) / 2, (dF0 + dF1) / 2, H_SPACE)
                const small = s.x1 - s.x0 < 54
                return (
                  <g key={`f${si}`} aria-hidden>
                    <polygon points={b.side} fill="#dfe4eb" />
                    <polygon points={b.front} fill="#e3e8ef" />
                    <polygon points={b.top} fill="#fbfcfd" stroke="#e6ebf1" strokeWidth="1" strokeLinejoin="round" />
                    <text x={lx} y={ly + 4} textAnchor="middle" fontSize={small ? 11.5 : 12.5} fontWeight="500" fill="#8a94a3">
                      {s.label}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      {tipData && <RoomTip r={tipData} meta={meta} side={roomSide(tipData.room)} />}
    </div>
  )
}

/** Which side of the drawing a room sits on, so its detail card opens on the other side. */
function roomSide(room: string): 'left' | 'right' {
  for (const slots of Object.values(BACK)) {
    const i = slots.findIndex((s) => s.room === room)
    if (i >= 0) return i < slots.length / 2 ? 'left' : 'right'
  }
  return 'left'
}

function RoomTip({ r, meta, side }: { r: RoomState; meta: Meta; side: 'left' | 'right' }) {
  const rm = meta.rooms[r.room]
  return (
    <div
      className={cx(
        'fade-in pointer-events-none absolute bottom-2 z-10 w-[260px] rounded-[14px] border border-line bg-surface px-4 py-3 text-[13.5px] shadow-[var(--shadow-float)]',
        side === 'left' ? 'right-2' : 'left-16',
      )}
      aria-hidden
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-bold text-ink">
          {rm?.floor}F - {r.room}
        </span>
        <span className="text-[13px] text-ink-3">
          {rm?.type_label}, {rm?.capacity}석
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="tnum text-[22px] font-[650] tracking-[-0.02em] text-ink">{Number.isFinite(r.ta) ? r.ta.toFixed(1) : '–'}℃</span>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: MODE[r.mode].deep }}>
          <ModeIcon mode={r.mode} size={13} />
          {MODE[r.mode].label}
          {r.mode !== 'off' && <span className="tnum font-medium">{(r.power_w / 1000).toFixed(1)} kW</span>}
        </span>
      </div>
      <div className="mt-2 border-t border-line pt-2 text-ink-2">
        {r.session ? (
          <>
            <span className="font-semibold text-ink">강의 중</span> {r.session.title}
            <div className="tnum text-[13px] text-ink-3">
              {r.session.start}–{r.session.end}, {r.session.expected_people ?? '–'}명
            </div>
          </>
        ) : r.next ? (
          <>
            다음 강의 <span className="font-semibold text-ink">{r.next.title}</span>
            <div className="tnum text-[13px] text-ink-3">
              {r.next.start}–{r.next.end}
            </div>
          </>
        ) : (
          '오늘 남은 강의가 없습니다'
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- thermal ruler (legend + distribution)

export function ThermalRuler({ meta, state, outdoor }: { meta: Meta; state: BuildingState; outdoor: number | null }) {
  const [ref, measured] = useWidth<HTMLDivElement>()
  const W = measured || 400
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const temps = state.rooms.map((r) => r.ta).filter(Number.isFinite)
  const all = outdoor != null ? [...temps, outdoor] : temps
  const t0 = Math.min(0, Math.floor(Math.min(...all) - 1))
  const t1 = Math.max(30, Math.ceil(Math.max(...all) + 1))
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 100
  const px = (t: number) => (x(t) / 100) * W
  const DOT = 10
  // beeswarm: stack dots that would overlap; compress the step when a stack gets tall
  const levels: { r: RoomState; lv: number }[] = []
  for (const r of [...state.rooms].filter((r) => Number.isFinite(r.ta)).sort((a, b) => a.ta - b.ta)) {
    let lv = 0
    while (levels.some((o) => o.lv === lv && Math.abs(px(o.r.ta) - px(r.ta)) < DOT + 1)) lv++
    levels.push({ r, lv })
  }
  const maxLv = levels.reduce((a, l) => Math.max(a, l.lv), 0)
  const step = maxLv > 0 ? Math.min(DOT + 1, 44 / maxLv) : DOT + 1
  const stackH = maxLv * step + DOT
  // labels: ticks on row 1; "comfort band" and the outdoor reading share row 2 unless they collide
  const bandMid = px((lo + hi) / 2)
  const outRow = outdoor != null && Math.abs(px(outdoor) - bandMid) < 92 ? 2 : 1
  const ticks = [t0, 10, lo, hi, t1].filter((t, i, a) => a.indexOf(t) === i && t >= t0 && t <= t1)
  const shownTicks = ticks.filter((t, i) => {
    if (t === lo || t === hi) return true
    const near = ticks.some((u, j) => j !== i && (u === lo || u === hi) && Math.abs(px(u) - px(t)) < 30)
    return !near
  })
  return (
    <div className="min-w-0">
      <div ref={ref} className="relative" style={{ paddingTop: stackH + 6 }}>
        {levels.map(({ r, lv }) => (
          <span
            key={r.room}
            title={`${r.room}호 ${r.ta.toFixed(1)}℃ ${MODE[r.mode].label}`}
            className="absolute -translate-x-1/2 rounded-full"
            style={{
              left: `${x(r.ta)}%`,
              bottom: 16 + lv * step,
              width: DOT,
              height: DOT,
              zIndex: 20 - lv,
              background: r.mode === 'off' ? '#ffffff' : MODE[r.mode].color,
              boxShadow: r.mode === 'off' ? 'inset 0 0 0 1.5px #667183, 0 0 0 1.5px #ffffff' : '0 0 0 1.5px #ffffff',
            }}
          />
        ))}
        <div className="relative h-2.5 rounded-full" style={{ background: thermalGradient(t0, t1, lo, hi) }}>
          <div className="absolute -inset-y-[3px] rounded-[3px] border-[1.5px] border-ink-2" style={{ left: `${x(lo)}%`, width: `${x(hi) - x(lo)}%` }} />
          {outdoor != null && <div className="absolute -top-[5px] -bottom-[6px] w-[2px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${x(outdoor)}%` }} />}
        </div>
      </div>
      <div className={cx('relative mt-1.5 text-[11.5px] text-ink-3', outRow === 2 ? 'h-[50px]' : 'h-[34px]')}>
        {shownTicks.map((t) => {
          const edge = t === lo || t === hi
          return (
            <span
              key={t}
              className={cx('tnum absolute top-0 whitespace-nowrap', t === t0 ? '' : t === t1 ? '-translate-x-full' : '-translate-x-1/2', edge && 'font-semibold text-ink-2')}
              style={{ left: `${x(t)}%` }}
            >
              {t}
              {t === t1 ? '℃' : ''}
            </span>
          )
        })}
        <span className="absolute top-[16px] -translate-x-1/2 font-medium whitespace-nowrap text-ink-2" style={{ left: `${(x(lo) + x(hi)) / 2}%` }}>
          쾌적 범위
        </span>
        {outdoor != null && (
          <span
            className={cx('tnum absolute inline-flex items-center gap-1 font-semibold whitespace-nowrap text-ink', px(outdoor) < 40 ? '' : px(outdoor) > W - 60 ? '-translate-x-full' : '-translate-x-1/2')}
            style={{ left: `${x(outdoor)}%`, top: outRow === 2 ? 32 : 16 }}
          >
            <CloudSun size={12} aria-hidden /> 외기 {outdoor.toFixed(1)}℃
          </span>
        )}
      </div>
    </div>
  )
}

export function ModeLegend({ state }: { state: BuildingState }) {
  const c: Record<Mode, number> = { heat: 0, cool: 0, air: 0, off: 0 }
  state.rooms.forEach((r) => c[r.mode]++)
  const inClass = state.rooms.filter((r) => r.session).length
  const items: [Mode, ReactNode][] = [
    ['heat', '난방'],
    ['cool', '냉방'],
    ['air', '송풍(외기 냉방)'],
    ['off', '정지'],
  ]
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
      {items.map(([m, label]) => (
        <li key={m} className={cx('inline-flex items-center gap-1.5', c[m] === 0 && m !== 'off' && 'opacity-55')}>
          <span
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full"
            style={{ background: m === 'off' ? '#eef1f4' : MODE[m].deep, color: '#fff', boxShadow: m === 'off' ? 'inset 0 0 0 1px #c9d1db' : undefined }}
          >
            {m !== 'off' && <ModeIcon mode={m} size={11} />}
          </span>
          {label}
          <b className="tnum font-semibold text-ink">{c[m]}</b>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5 border-l border-line pl-4">
        <Users size={14} className="text-ink" aria-hidden />
        강의 중 <b className="tnum font-semibold text-ink">{inClass}</b>
      </li>
    </ul>
  )
}

/**
 * The one legend the building view needs: an idle room shows its indoor temperature (neutral inside the
 * comfort band), a running room wears its mode colour and icon, and the people icon marks a class in progress.
 */
export function MapLegend({ meta }: { meta: Meta }) {
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const t0 = lo - 9
  const t1 = hi + 7
  const x = (t: number) => ((t - t0) / (t1 - t0)) * 100
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-ink-2">
      <span className="inline-flex items-center gap-2.5">
        <span className="text-ink-3">정지 중 실내온도</span>
        <span className="tnum">낮음</span>
        <span className="relative inline-block h-2 w-[120px] rounded-full" style={{ background: thermalGradient(t0, t1, lo, hi) }} aria-hidden>
          <span className="absolute -inset-y-[3px] rounded-[4px] border-[1.5px] border-ink-3" style={{ left: `${x(lo)}%`, width: `${x(hi) - x(lo)}%` }} />
        </span>
        <span className="tnum">높음</span>
        <span className="tnum text-ink-3">
          테두리 안이 쾌적 범위 {lo}–{hi}℃
        </span>
      </span>
      <span className="inline-flex items-center gap-3.5">
        <span className="text-ink-3">가동 중</span>
        {(['heat', 'cool', 'air'] as Mode[]).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-white" style={{ background: MODE[m].color }} aria-hidden>
              <ModeIcon mode={m} size={10} />
            </span>
            {m === 'air' ? '송풍(외기 냉방)' : MODE[m].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} className="text-ink" aria-hidden />
          수업 중
        </span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- time scrubber

export function TimeScrubber({
  day,
  meta,
  minute,
  nowMinute,
  onChange,
  range = [420, 1410],
  refLabel = '지금',
}: {
  day: Day | undefined
  meta: Meta
  minute: number
  nowMinute: number
  onChange: (m: number) => void
  range?: [number, number]
  /** '지금' when live, '기준 시각' when replaying another time */
  refLabel?: string
}) {
  const [r0, r1] = range
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const minuteRef = useRef(minute)
  minuteRef.current = minute

  // per 5-minute: rooms in class, rooms running (AI)
  const profile = useMemo(() => {
    if (!day) return null
    const n = Math.round((r1 - r0) / 5)
    const occ = new Array(n).fill(0)
    const run = new Array(n).fill(0)
    const rooms = Object.keys(meta.rooms)
    for (const s of day.sessions) {
      const a = hm(s.start)
      const b = hm(s.end)
      for (let i = 0; i < n; i++) {
        const m = r0 + i * 5
        if (m >= a && m < b) occ[i]++
      }
    }
    for (const room of rooms) {
      for (const iv of day.strategies.ai?.rooms[room]?.actual ?? []) {
        for (let i = 0; i < n; i++) {
          const m = r0 + i * 5
          if (m >= iv.s && m < iv.e) run[i]++
        }
      }
    }
    return { n, occ, run, max: Math.max(4, ...occ, ...run) }
  }, [day, meta, r0, r1])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const next = minuteRef.current + 5
      if (next > r1) {
        setPlaying(false)
        return
      }
      onChange(next)
    }, 90)
    return () => window.clearInterval(id)
  }, [playing, onChange, r1])

  const pct = (m: number) => ((Math.min(Math.max(m, r0), r1) - r0) / (r1 - r0)) * 100
  const fromX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return minute
    const b = el.getBoundingClientRect()
    const m = r0 + ((clientX - b.left) / b.width) * (r1 - r0)
    return Math.min(r1, Math.max(r0, Math.round(m / 5) * 5))
  }
  const hours: number[] = []
  for (let h = Math.ceil(r0 / 60); h * 60 <= r1; h++) hours.push(h)
  const future = minute > nowMinute
  const H_ = 40

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={() => {
          if (!playing && minute >= r1) onChange(r0)
          setPlaying((p) => !p)
        }}
        className="mt-[2px] inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors duration-150 hover:bg-brand-ink"
        aria-label={playing ? '재생 멈춤' : '하루 운전 재생'}
        title={playing ? '재생 멈춤' : '선택한 시각부터 하루 운전을 재생'}
      >
        {playing ? <Pause size={15} aria-hidden /> : <Play size={15} className="ml-0.5" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="보는 시각"
          aria-valuemin={r0}
          aria-valuemax={r1}
          aria-valuenow={minute}
          aria-valuetext={`${fmtMin(minute)}${future ? ' (예정)' : ''}`}
          className="relative cursor-ew-resize touch-none rounded-[10px] bg-well"
          style={{ height: H_ }}
          title="끌거나 ←/→로 시각을 옮깁니다. 회색 막대는 강의 중인 강의실 수, 청록 선은 AI가 가동한 강의실 수, 빗금은 지금 이후(AI 계획)입니다."
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
            setPlaying(false)
            onChange(fromX(e.clientX))
          }}
          onPointerMove={(e) => {
            if (e.buttons & 1) onChange(fromX(e.clientX))
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey || e.key === 'PageUp' || e.key === 'PageDown' ? 60 : 5
            let m = minute
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') m += step
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') m -= step
            else if (e.key === 'Home') m = r0
            else if (e.key === 'End') m = r1
            else return
            e.preventDefault()
            setPlaying(false)
            onChange(Math.min(r1, Math.max(r0, m)))
          }}
        >
          {/* future shading */}
          <div className="absolute inset-y-0 right-0 rounded-r-[10px] bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(20_32_51/0.04)_5px_6px)]" style={{ left: `${pct(nowMinute)}%` }} />
          {profile && (
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${profile.n} ${H_}`} preserveAspectRatio="none" aria-hidden>
              {profile.occ.map((v, i) =>
                v ? <rect key={`o${i}`} x={i} y={H_ - 3 - (v / profile.max) * (H_ - 8)} width={1.02} height={(v / profile.max) * (H_ - 8)} fill="#d6dbe2" /> : null,
              )}
              <polyline
                fill="none"
                stroke={STRATEGY.ai.color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                points={profile.run.flatMap((v, i) => [`${i},${H_ - 3 - (v / profile.max) * (H_ - 8)}`, `${i + 1},${H_ - 3 - (v / profile.max) * (H_ - 8)}`]).join(' ')}
              />
            </svg>
          )}
          {/* now */}
          <div className="absolute inset-y-0 w-0 border-l border-dashed border-brand/60" style={{ left: `${pct(nowMinute)}%` }} aria-hidden />
          {/* handle */}
          <div className="pointer-events-none absolute -inset-y-1 z-10 -ml-[1.5px] w-[3px] rounded-full bg-brand" style={{ left: `${pct(minute)}%` }} aria-hidden>
            <div className="tnum absolute -top-[26px] left-1/2 -translate-x-1/2 rounded-[6px] bg-brand px-2 py-[2px] text-[13px] font-semibold whitespace-nowrap text-white">
              {fmtMin(minute)}
              {future ? ' 예정' : ''}
            </div>
          </div>
        </div>
        <div className="relative mt-1.5 h-4 text-[12px] text-ink-3" aria-hidden>
          {hours.map((h) =>
            h % 2 === 0 ? (
              <span key={h} className="tnum absolute -translate-x-1/2" style={{ left: `${pct(h * 60)}%` }}>
                {String(h).padStart(2, '0')}시
              </span>
            ) : null,
          )}
        </div>
        <p className="sr-only">
          회색 막대는 강의 중인 강의실 수, 청록 선은 AI가 가동한 강의실 수입니다. {refLabel}({fmtMin(nowMinute)}) 이후는 AI 운전 계획입니다.
        </p>
      </div>
    </div>
  )
}
