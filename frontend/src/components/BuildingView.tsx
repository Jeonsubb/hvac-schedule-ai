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

// ---------------------------------------------------------------- schematic plan (not to scale)

interface Slot {
  room?: string
  label?: string
  w: number
}

const SLOTS: Record<number, Slot[]> = {
  4: [{ room: '405', w: 1 }, { room: '406', w: 1 }, { room: '407', w: 1 }, { room: '408', w: 1 }, { room: '409', w: 1 }, { room: '410', w: 0.92 }, { label: '계단·EV', w: 0.74 }],
  3: [{ room: '306', w: 1 }, { room: '307', w: 1 }, { label: '교수연구실', w: 1 }, { room: '309', w: 1 }, { room: '310', w: 1 }, { label: '세미나실', w: 0.92 }, { label: '계단·EV', w: 0.74 }],
}

// projection (px): plan laid back, height stood up. P(x, d, z) = (X0 + x + d·K, Yb − d − z)
const GUT = 56 // floor label gutter
const K = 0.58 // horizontal shift per px of projected depth
const HR = 84 // room depth
const HC = 34 // corridor depth (behind rooms)
const H = 16 // room height (facade)
const SLAB = 7
const CHIP = 26
const CHIP_GAP = 12
const GAP = 8 // wall gap between rooms
const FLOOR_GAP = 22
const DP = HR + H + (HC - H) / 2 // pipe depth, on the visible corridor strip

type Pt = [number, number]
const poly = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

// ---------------------------------------------------------------- building section

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

  const L = W - GUT - (HR + HC) * K - 10
  const floors = [4, 3].filter((f) => Object.values(meta.rooms).some((r) => r.floor === f))
  const TOP = showOdus ? CHIP + CHIP_GAP : 0
  const BLOCK = TOP + HC + HR + SLAB
  const totalH = floors.length * BLOCK + (floors.length - 1) * FLOOR_GAP + 8

  const tipRoom = hover ?? focus
  const tipData = tipRoom ? byRoom[tipRoom] : undefined

  return (
    <div ref={wrapRef} className="relative w-full overflow-x-auto">
      <svg width={W} height={totalH} role="group" aria-label="IT관 3층·4층 단면도: 방 바닥색은 실내온도, 앞면 색과 아이콘은 운전 모드" className="block select-none">
        <defs>
          <pattern id="bv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#e1e5ea" strokeWidth="1.2" />
          </pattern>
          {(['heat', 'cool', 'air'] as Mode[]).map((m) => (
            <linearGradient key={m} id={`bv-rise-${m}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={MODE[m].color} stopOpacity="0.34" />
              <stop offset="0.75" stopColor={MODE[m].color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {floors.map((floor, fi) => {
          const T = 4 + fi * (BLOCK + FLOOR_GAP)
          const Yb = T + TOP + HC + HR
          const P = (x: number, d: number, z: number): Pt => [GUT + x + d * K, Yb - d - z]
          const slots = SLOTS[floor] ?? []
          const unit = (L - GAP * (slots.length - 1)) / slots.reduce((a, s) => a + s.w, 0)
          let acc = 0
          const placed = slots.map((s) => {
            const x0 = acc
            const x1 = acc + s.w * unit
            acc = x1 + GAP
            return { ...s, x0, x1 }
          })
          const odus = Object.values(meta.odus).filter((o) => o.floor === floor)
          return (
            <g key={floor}>
              {/* floor marker */}
              <text x={4} y={Yb - H - HR / 2 + 6} fontSize="24" fontWeight="400" fill="#8a94a3" style={{ letterSpacing: '-0.02em' }}>
                {floor}F
              </text>
              {/* slab: top (corridor surface), front lip, right side */}
              <polygon points={poly([P(-6, -6, 0), P(L + 6, -6, 0), P(L + 6, HR + HC, 0), P(-6, HR + HC, 0)])} fill="#eceff3" />
              <polygon points={poly([P(-6, -6, -SLAB), P(L + 6, -6, -SLAB), P(L + 6, -6, 0), P(-6, -6, 0)])} fill="#d6dbe2" />
              <polygon points={poly([P(L + 6, -6, -SLAB), P(L + 6, HR + HC, -SLAB), P(L + 6, HR + HC, 0), P(L + 6, -6, 0)])} fill="#c3cad4" />

              {/* refrigerant lines along the corridor, one per outdoor unit (opt-in layer) */}
              {showOdus && odus.map((o) => {
                const rs = placed.filter((s) => s.room && meta.rooms[s.room]?.odu === o.id)
                if (!rs.length) return null
                const st = state.odus[o.id]
                const on = !!st?.on
                const col = on ? MODE[st.mode].color : '#b9c2cd'
                const xa = (rs[0].x0 + rs[0].x1) / 2
                const xb = (rs[rs.length - 1].x0 + rs[rs.length - 1].x1) / 2
                const [ax, ay] = P(xa, DP, 0)
                const [bx, by] = P(xb, DP, 0)
                const mid = (ax + bx) / 2
                const chipW = 168
                return (
                  <g key={o.id}>
                    <line x1={ax} y1={ay} x2={bx} y2={by} stroke={col} strokeWidth={on ? 2.5 : 1.5} strokeLinecap="round" />
                    {rs.map((s) => {
                      const r = byRoom[s.room!]
                      const [cx_, cy_] = P((s.x0 + s.x1) / 2, DP, 0)
                      const run = r && r.mode !== 'off'
                      return <circle key={s.room} cx={cx_} cy={cy_} r={3.2} fill={run ? MODE[r.mode].color : '#ffffff'} stroke={run ? '#ffffff' : '#b9c2cd'} strokeWidth={1.5} />
                    })}
                    <line x1={mid} y1={T + CHIP} x2={mid} y2={ay} stroke={col} strokeWidth="1.25" />
                    <g transform={`translate(${mid - chipW / 2} ${T})`}>
                      <title>{`실외기 ${o.id} (${o.label}, 용량 ${o.cap_kw} kW): ${on ? `가동 ${((st?.power_w ?? 0) / 1000).toFixed(1)} kW` : '정지'}`}</title>
                      <rect width={chipW} height={CHIP} rx="8" fill="#ffffff" stroke={on ? col : '#d5dbe3'} strokeWidth={on ? 1.5 : 1} />
                      <g transform="translate(8 6)" className={on ? 'fan-spin' : undefined}>
                        <Fan size={14} color={on ? col : '#97a1ae'} strokeWidth={2.2} />
                      </g>
                      <text x="28" y="17.5" fontSize="13" fontWeight="600" fill="#142033">
                        실외기 {o.id.replace('ODU-', '')}
                      </text>
                      <text x={chipW - 10} y="17.5" fontSize="13" fontWeight={on ? 650 : 500} textAnchor="end" fill={on ? MODE[st.mode].deep : '#667183'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {on ? `${((st?.power_w ?? 0) / 1000).toFixed(1)} kW` : '정지'}
                      </text>
                    </g>
                  </g>
                )
              })}

              {/* rooms and other spaces, left to right (right neighbours occlude side faces) */}
              {placed.map((s, si) => {
                const top = poly([P(s.x0, 0, H), P(s.x1, 0, H), P(s.x1, HR, H), P(s.x0, HR, H)])
                const front = poly([P(s.x0, 0, 0), P(s.x1, 0, 0), P(s.x1, 0, H), P(s.x0, 0, H)])
                const side = poly([P(s.x1, 0, 0), P(s.x1, HR, 0), P(s.x1, HR, H), P(s.x1, 0, H)])
                if (!s.room) {
                  const [lx, ly] = P((s.x0 + s.x1) / 2, HR / 2, H)
                  return (
                    <g key={si} aria-hidden>
                      <polygon points={side} fill="#d8dde4" />
                      <polygon points={top} fill="#f4f6f8" />
                      <polygon points={top} fill="url(#bv-hatch)" />
                      <polygon points={front} fill="#e2e6eb" />
                      <text x={lx} y={ly + 4} textAnchor="middle" fontSize="12" fill="#8a94a3">
                        {s.label}
                      </text>
                    </g>
                  )
                }
                const r = byRoom[s.room]
                const rm = meta.rooms[s.room]
                if (!r || !rm) return null
                const fill = Number.isFinite(r.ta) ? thermalFill(r.ta, lo, hi) : '#eef1f4'
                const run = r.mode !== 'off'
                const occupied = !!r.session
                const outBand = occupied && (r.ta < lo || r.ta > hi)
                const isSel = selected === s.room
                const isHover = hover === s.room
                const isFocus = focus === s.room
                const pad = 12
                const tx = (d: number) => P(s.x0, d, H)[0] + pad
                const ty = (d: number) => P(s.x0, d, H)[1]
                const silhouette = poly([P(s.x0, 0, 0), P(s.x1, 0, 0), P(s.x1, 0, H), P(s.x1, HR, H), P(s.x0, HR, H), P(s.x0, 0, H)])
                const label = `${s.room}호, 실내 ${Number.isFinite(r.ta) ? r.ta.toFixed(1) : '알 수 없음'}도, ${MODE[r.mode].label}${outBand ? ', 수업 중 쾌적 범위 밖' : ''}${
                  r.session ? `, 강의 중: ${r.session.title}` : r.next ? `, 다음 강의 ${r.next.start}` : ''
                }. 눌러서 상세 보기`
                // mode badge: right end of the room-number row, inside the top face
                const [bx0, by0] = P(s.x1, HR - 27, H)
                const ix = bx0 - pad - 13
                const iy = by0
                return (
                  <g
                    key={s.room}
                    role={onRoomClick ? 'button' : undefined}
                    tabIndex={onRoomClick ? 0 : undefined}
                    aria-label={label}
                    className={cx('outline-none', onRoomClick && 'cursor-pointer')}
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
                    <polygon points={side} fill={shade(fill, 0.18)} />
                    <polygon points={top} fill={isHover && !isSel ? shade(fill, 0.03) : fill} />
                    {run && <polygon points={top} fill={`url(#bv-rise-${r.mode})`} />}
                    <polygon points={front} fill={run ? MODE[r.mode].deep : shade(fill, 0.1)} />
                    {/* top face: number, temperature, mode icon. Nothing else. */}
                    <text x={tx(HR - 22)} y={ty(HR - 22)} fontSize="15" fontWeight="700" fill="#142033" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {s.room}
                    </text>
                    <text x={tx(16)} y={ty(16)} fontSize="27" fontWeight="650" fill={outBand ? '#a12a2a' : '#142033'} style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em' }}>
                      {Number.isFinite(r.ta) ? r.ta.toFixed(1) : '–'}
                      <tspan fontSize="14" fontWeight="500" fill={outBand ? '#a12a2a' : '#667183'} dx="2">
                        ℃
                      </tspan>
                    </text>
                    {outBand && (
                      <g transform={`translate(${tx(16) + 86} ${ty(16) - 15})`}>
                        <AlertTriangle size={15} color="#d03b3b" strokeWidth={2.4} />
                      </g>
                    )}
                    {run && (
                      <g transform={`translate(${ix - 13} ${iy - 13})`}>
                        <circle cx="13" cy="13" r="13" fill={MODE[r.mode].deep} />
                        <g transform="translate(6.5 6.5)">
                          <ModeIcon mode={r.mode} size={13} className="text-white" />
                        </g>
                      </g>
                    )}
                    {/* hit area, selection, hover and keyboard focus outlines */}
                    <polygon points={silhouette} fill="transparent" stroke={isFocus ? '#2f6fde' : isSel ? '#142033' : isHover ? '#667183' : 'none'} strokeWidth={isFocus ? 2.5 : isSel ? 2 : 1.25} strokeLinejoin="round" />
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
  for (const slots of Object.values(SLOTS)) {
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
        'fade-in pointer-events-none absolute top-1 z-10 w-[260px] rounded-[14px] border border-line bg-surface px-4 py-3 text-[13.5px] shadow-[var(--shadow-float)]',
        side === 'left' ? 'right-1' : 'left-14',
      )}
      aria-hidden
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-bold text-ink">{r.room}호</span>
        <span className="text-[13px] text-ink-3">
          {rm?.type_label}, {rm?.capacity}석
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="tnum text-[22px] font-[650] tracking-[-0.02em] text-ink">{r.ta.toFixed(1)}℃</span>
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
 * The one legend the building view needs: indoor-temperature colour (neutral inside the comfort band)
 * and the mode icons. Counts are not repeated here (the page sentence carries them).
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
        <span className="text-ink-3">실내온도</span>
        <span className="tnum">낮음</span>
        <span className="relative inline-block h-2 w-[132px] rounded-full" style={{ background: thermalGradient(t0, t1, lo, hi) }} aria-hidden>
          <span className="absolute -inset-y-[3px] rounded-[4px] border-[1.5px] border-ink-3" style={{ left: `${x(lo)}%`, width: `${x(hi) - x(lo)}%` }} />
        </span>
        <span className="tnum">높음</span>
        <span className="tnum text-ink-3">
          테두리 안이 쾌적 범위 {lo}–{hi}℃
        </span>
      </span>
      <span className="inline-flex items-center gap-3.5">
        {(['heat', 'cool', 'air'] as Mode[]).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-white" style={{ background: MODE[m].deep }} aria-hidden>
              <ModeIcon mode={m} size={10} />
            </span>
            {m === 'air' ? '송풍(외기 냉방)' : MODE[m].label}
          </span>
        ))}
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
        className="mt-[2px] inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-colors duration-150 hover:bg-[#25344e]"
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
          <div className="absolute inset-y-0 w-px bg-ink-3" style={{ left: `${pct(nowMinute)}%` }} aria-hidden />
          {/* handle */}
          <div className="pointer-events-none absolute -inset-y-1 z-10 -ml-[1.5px] w-[3px] rounded-full bg-ink" style={{ left: `${pct(minute)}%` }} aria-hidden>
            <div className="tnum absolute -top-[26px] left-1/2 -translate-x-1/2 rounded-[6px] bg-ink px-2 py-[2px] text-[13px] font-semibold whitespace-nowrap text-white">
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
