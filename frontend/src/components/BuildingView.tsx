import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Flame, Snowflake, Wind, Fan, Users, CloudSun, Play, Pause } from 'lucide-react'
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

function textWidth(s: string, fs: number) {
  let w = 0
  for (const ch of s) w += /[ㄱ-힝]/.test(ch) ? fs * 0.94 : /[0-9]/.test(ch) ? fs * 0.6 : /[A-Z]/.test(ch) ? fs * 0.66 : /\s/.test(ch) ? fs * 0.28 : fs * 0.55
  return w
}

function fit(s: string, maxW: number, fs: number) {
  if (textWidth(s, fs) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', fs) > maxW) break
    out += ch
  }
  return out ? out + '…' : ''
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
const GUT = 54 // floor label gutter
const K = 0.58 // horizontal shift per px of projected depth
const HR = 78 // room depth
const HC = 40 // corridor depth (behind rooms)
const H = 18 // room height (facade)
const SLAB = 7
const CHIP = 24
const CHIP_GAP = 10
const GAP = 7 // wall gap between rooms
const FLOOR_GAP = 14
const BLOCK = CHIP + CHIP_GAP + HC + HR + SLAB
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
}: {
  meta: Meta
  state: BuildingState
  onRoomClick?: (room: string) => void
  selected?: string | null
  minWidth?: number
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
  const totalH = floors.length * BLOCK + (floors.length - 1) * FLOOR_GAP + 8

  const tipRoom = hover ?? focus
  const tipData = tipRoom ? byRoom[tipRoom] : undefined

  return (
    <div ref={wrapRef} className="relative w-full overflow-x-auto">
      <svg width={W} height={totalH} role="group" aria-label="IT관 3층·4층 단면도: 방 바닥색은 실내온도, 앞면 색은 운전 모드" className="block select-none">
        <defs>
          <pattern id="bv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#d5dbe3" strokeWidth="1.4" />
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
          const Yb = T + CHIP + CHIP_GAP + HC + HR
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
              <text x={6} y={Yb - H - HR / 2 + 2} fontSize="26" fontWeight="300" fill="#667183" style={{ letterSpacing: '-0.02em' }}>
                {floor}F
              </text>
              {/* slab: top (corridor surface), front lip, right side */}
              <polygon points={poly([P(-6, -6, 0), P(L + 6, -6, 0), P(L + 6, HR + HC, 0), P(-6, HR + HC, 0)])} fill="#e7ebf0" />
              <polygon points={poly([P(-6, -6, -SLAB), P(L + 6, -6, -SLAB), P(L + 6, -6, 0), P(-6, -6, 0)])} fill="#cdd4dd" />
              <polygon points={poly([P(L + 6, -6, -SLAB), P(L + 6, HR + HC, -SLAB), P(L + 6, HR + HC, 0), P(L + 6, -6, 0)])} fill="#b9c2cd" />

              {/* refrigerant lines along the corridor, one per outdoor unit */}
              {odus.map((o) => {
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
                      <rect width={chipW} height={CHIP} rx="6" fill="#ffffff" stroke={on ? col : '#d5dbe3'} strokeWidth={on ? 1.5 : 1} />
                      <g transform="translate(7 5)" className={on ? 'fan-spin' : undefined}>
                        <Fan size={14} color={on ? col : '#97a1ae'} strokeWidth={2.2} />
                      </g>
                      <text x="26" y="16.5" fontSize="12" fontWeight="600" fill="#142033">
                        실외기 {o.id.replace('ODU-', '')}
                      </text>
                      <text x={chipW - 9} y="16.5" fontSize="12" fontWeight={on ? 650 : 500} textAnchor="end" fill={on ? MODE[st.mode].deep : '#667183'} style={{ fontVariantNumeric: 'tabular-nums' }}>
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
                      <polygon points={side} fill="#cfd6df" />
                      <polygon points={top} fill="#f1f3f6" />
                      <polygon points={top} fill="url(#bv-hatch)" />
                      <polygon points={front} fill="#dbe1e8" />
                      <text x={lx} y={ly + 4} textAnchor="middle" fontSize="11.5" fill="#667183">
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
                const w = s.x1 - s.x0
                const pad = 10
                const tx = (d: number) => P(s.x0, d, H)[0] + pad
                const ty = (d: number) => P(s.x0, d, H)[1]
                const inner = w - pad * 2
                const silhouette = poly([P(s.x0, 0, 0), P(s.x1, 0, 0), P(s.x1, 0, H), P(s.x1, HR, H), P(s.x0, HR, H), P(s.x0, 0, H)])
                let line3 = '남은 강의 없음'
                if (r.session) line3 = r.session.title
                else if (r.next) line3 = `다음 ${r.next.start} ${r.next.title}`
                const label = `${s.room}호 ${rm.type_label}, 실내 ${r.ta.toFixed(1)}도, ${MODE[r.mode].label}${run ? ` ${(r.power_w / 1000).toFixed(1)}킬로와트` : ''}${
                  r.session ? `, 강의 중: ${r.session.title}` : r.next ? `, 다음 강의 ${r.next.start}` : ''
                }`
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
                    <polygon points={side} fill={shade(fill, 0.2)} />
                    <polygon points={top} fill={fill} />
                    {run && <polygon points={top} fill={`url(#bv-rise-${r.mode})`} />}
                    <polygon points={front} fill={run ? MODE[r.mode].deep : shade(fill, 0.1)} />
                    {/* facade: mode + power */}
                    {run && (
                      <>
                        <g transform={`translate(${P(s.x0, 0, 0)[0] + 7} ${Yb - H / 2 - 6})`}>
                          <ModeIcon mode={r.mode} size={12} className="text-white" />
                        </g>
                        {w >= 100 && (
                          <text x={P(s.x0, 0, 0)[0] + 22} y={Yb - 5} fontSize="11.5" fontWeight="650" fill="#ffffff">
                            {MODE[r.mode].label}
                          </text>
                        )}
                        <text x={P(s.x1, 0, 0)[0] - 7} y={Yb - 5} fontSize="11.5" fontWeight="600" fill="#ffffff" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {(r.power_w / 1000).toFixed(1)} kW
                        </text>
                      </>
                    )}
                    {/* top face: number, temperature, lecture */}
                    <text x={tx(HR - 19)} y={ty(HR - 19)} fontSize="13.5" fontWeight="700" fill="#142033">
                      {s.room}
                      {w > 150 && (
                        <tspan fontSize="11.5" fontWeight="400" fill="#4a5668" dx="6">
                          {rm.type_label}
                        </tspan>
                      )}
                    </text>
                    <text x={tx(27)} y={ty(27)} fontSize="23" fontWeight="650" fill={outBand ? '#a12a2a' : '#142033'} style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
                      {Number.isFinite(r.ta) ? r.ta.toFixed(1) : '–'}
                      <tspan fontSize="12.5" fontWeight="500" fill="#4a5668" dx="1.5">
                        ℃
                      </tspan>
                    </text>
                    {outBand && (
                      <text x={tx(27) + 70} y={ty(27)} fontSize="11.5" fontWeight="650" fill="#a12a2a">
                        쾌적 이탈
                      </text>
                    )}
                    {occupied && (
                      <g transform={`translate(${tx(6) - 1} ${ty(6) - 10.5})`}>
                        <Users size={12} color="#142033" strokeWidth={2.4} />
                      </g>
                    )}
                    <text x={tx(6) + (occupied ? 15 : 0)} y={ty(6)} fontSize="11.5" fontWeight={occupied ? 650 : 400} fill={occupied ? '#142033' : '#4a5668'}>
                      {fit(line3, inner - (occupied ? 15 : 0), 11.5)}
                    </text>
                    {/* hit area, selection, hover and keyboard focus outlines */}
                    <polygon points={silhouette} fill="transparent" stroke={isFocus ? '#2f6fde' : isSel ? '#142033' : isHover ? '#4a5668' : 'none'} strokeWidth={isFocus ? 2.5 : isSel ? 2 : 1.25} strokeLinejoin="round" />
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
        'pointer-events-none absolute top-1 z-10 w-[248px] rounded-[8px] border border-line bg-surface px-3 py-2.5 text-[12.5px] shadow-[var(--shadow-float)]',
        side === 'left' ? 'right-1' : 'left-14',
      )}
      aria-hidden
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold text-ink">{r.room}호</span>
        <span className="text-[12px] text-ink-3">
          {rm?.type_label}, 정원 {rm?.capacity}명
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="tnum text-[20px] font-[650] tracking-[-0.02em] text-ink">{r.ta.toFixed(1)}℃</span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: MODE[r.mode].deep }}>
          <ModeIcon mode={r.mode} size={12} />
          {MODE[r.mode].label}
          {r.mode !== 'off' && <span className="tnum font-medium">{(r.power_w / 1000).toFixed(2)} kW</span>}
        </span>
      </div>
      <div className="mt-1.5 border-t border-line pt-1.5 text-ink-2">
        {r.session ? (
          <>
            <b className="font-semibold text-ink">강의 중</b> {r.session.title}
            <div className="tnum text-ink-3">
              {r.session.start}–{r.session.end}, {r.session.expected_people ?? '–'}명
            </div>
          </>
        ) : r.next ? (
          <>
            다음 강의 <b className="font-semibold text-ink">{r.next.title}</b>
            <div className="tnum text-ink-3">
              {r.next.start}–{r.next.end}
            </div>
          </>
        ) : (
          '오늘 남은 강의가 없습니다'
        )}
      </div>
      <div className="mt-1.5 text-[11.5px] text-ink-3">눌러서 온도·전력·이력 보기</div>
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
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
      {items.map(([m, label]) => (
        <li key={m} className={cx('inline-flex items-center gap-1.5', c[m] === 0 && m !== 'off' && 'opacity-55')}>
          <span
            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px]"
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
  const H_ = 38

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={() => {
          if (!playing && minute >= r1) onChange(r0)
          setPlaying((p) => !p)
        }}
        className="mt-[3px] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-white hover:bg-[#24334d]"
        aria-label={playing ? '재생 멈춤' : '하루 운전 재생'}
        title={playing ? '재생 멈춤' : '선택한 시각부터 하루 운전을 재생'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
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
          className="relative cursor-ew-resize touch-none rounded-[6px] bg-well ring-1 ring-line ring-inset"
          style={{ height: H_ }}
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
          <div className="absolute inset-y-0 right-0 rounded-r-[6px] bg-[repeating-linear-gradient(135deg,transparent_0_5px,rgb(20_32_51/0.035)_5px_6px)]" style={{ left: `${pct(nowMinute)}%` }} />
          {profile && (
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${profile.n} ${H_}`} preserveAspectRatio="none" aria-hidden>
              {profile.occ.map((v, i) =>
                v ? <rect key={`o${i}`} x={i} y={H_ - 3 - (v / profile.max) * (H_ - 8)} width={1.02} height={(v / profile.max) * (H_ - 8)} fill="#c9d1db" /> : null,
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
            <div className="tnum absolute -top-[22px] left-1/2 -translate-x-1/2 rounded-[4px] bg-ink px-1.5 py-[1px] text-[11.5px] font-semibold whitespace-nowrap text-white">
              {fmtMin(minute)}
              {future ? ' 예정' : ''}
            </div>
          </div>
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-ink-3" aria-hidden>
          {hours.map((h) =>
            h % 2 === 0 ? (
              <span key={h} className="tnum absolute -translate-x-1/2" style={{ left: `${pct(h * 60)}%` }}>
                {String(h).padStart(2, '0')}시
              </span>
            ) : null,
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-line-strong" aria-hidden />
            강의 중인 강의실 수
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3.5 rounded-full" style={{ background: STRATEGY.ai.color }} aria-hidden />
            AI가 가동한 강의실 수
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-ink-3" aria-hidden />
            {refLabel}({fmtMin(nowMinute)}) 이후는 AI 운전 계획
          </span>
        </div>
      </div>
    </div>
  )
}
