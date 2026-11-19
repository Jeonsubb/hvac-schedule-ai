import { useState } from 'react'
import type { LiveRoom, Meta, Live } from '../lib/types'
import { STRATEGY } from '../lib/constants'

const TEAL = STRATEGY.ai.color

function textWidth(s: string, fs: number) {
  let w = 0
  for (const ch of s) w += /[ㄱ-힝]/.test(ch) ? fs * 0.98 : /[A-Z0-9]/.test(ch) ? fs * 0.62 : fs * 0.54
  return w
}

function fit(s: string, maxW: number, fs: number) {
  if (textWidth(s, fs) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', fs) > maxW) break
    out += ch
  }
  return out + '…'
}

const STATE_STYLE = {
  ON: { fill: '#e2f5ed', stroke: TEAL, chip: TEAL, chipText: '#ffffff', label: '가동' },
  FAN: { fill: '#f1faf6', stroke: '#86d3b6', chip: '#ffffff', chipText: '#0d7a55', label: '송풍' },
  OFF: { fill: '#ffffff', stroke: '#d6d5ce', chip: '#f0efec', chipText: '#52514e', label: '정지' },
} as const

interface Slot {
  room?: string
  label?: string
  x: number
  w: number
}

// Schematic plan (not to scale): rooms along the south side, corridor, core on the north side.
const ROOM_W = 148
const GAP = 8
const PLAN_W = (ROOM_W + GAP) * 6 - 18 + 138 // 1056

const FLOORS: { floor: number; slots: Slot[]; odus: { id: string; rooms: string[] }[] }[] = [
  {
    floor: 4,
    slots: [
      { room: '405', x: 0, w: ROOM_W },
      { room: '406', x: (ROOM_W + GAP) * 1, w: ROOM_W },
      { room: '407', x: (ROOM_W + GAP) * 2, w: ROOM_W },
      { room: '408', x: (ROOM_W + GAP) * 3, w: ROOM_W },
      { room: '409', x: (ROOM_W + GAP) * 4, w: ROOM_W },
      { room: '410', x: (ROOM_W + GAP) * 5, w: ROOM_W - 18 },
      { label: '계단·EV', x: (ROOM_W + GAP) * 6 - 18, w: 138 },
    ],
    odus: [
      { id: 'ODU-4F-A', rooms: ['405', '406', '407'] },
      { id: 'ODU-4F-B', rooms: ['408', '409', '410'] },
    ],
  },
  {
    floor: 3,
    slots: [
      { room: '306', x: 0, w: ROOM_W },
      { room: '307', x: (ROOM_W + GAP) * 1, w: ROOM_W },
      { label: '교수연구실', x: (ROOM_W + GAP) * 2, w: ROOM_W },
      { room: '309', x: (ROOM_W + GAP) * 3, w: ROOM_W },
      { room: '310', x: (ROOM_W + GAP) * 4, w: ROOM_W },
      { label: '세미나실', x: (ROOM_W + GAP) * 5, w: ROOM_W - 18 },
      { label: '계단·EV', x: (ROOM_W + GAP) * 6 - 18, w: 138 },
    ],
    odus: [{ id: 'ODU-3F', rooms: ['306', '307', '309', '310'] }],
  },
]

const ROOM_H = 118
const TOP = 34 // ODU bracket band
const CORR = 26
const FLOOR_H = TOP + ROOM_H + CORR + 16

export default function FloorPlan({
  live,
  meta,
  onRoomClick,
  selected,
}: {
  live: Live
  meta: Meta
  onRoomClick?: (room: string) => void
  selected?: string | null
}) {
  const [hover, setHover] = useState<string | null>(null)
  const byRoom: Record<string, LiveRoom> = Object.fromEntries(live.rooms.map((r) => [r.room, r]))
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const minute = live.now.minute

  return (
    <svg viewBox={`-40 0 ${PLAN_W + 48} ${FLOOR_H * 2 + 6}`} className="w-full" role="img" aria-label="IT관 3층·4층 평면도와 강의실 냉난방 상태">
      <defs>
        <pattern id="fp-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="#e7e6e0" strokeWidth="2" />
        </pattern>
        <filter id="fp-shadow" x="-10%" y="-10%" width="120%" height="130%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0b0b0b" floodOpacity="0.12" />
        </filter>
      </defs>
      {FLOORS.map((f, fi) => {
        const oy = fi * FLOOR_H
        return (
          <g key={f.floor} transform={`translate(0 ${oy})`}>
            {/* floor label */}
            <g transform={`translate(-40 ${TOP})`}>
              <rect width="30" height={ROOM_H + CORR} rx="6" fill="#f0efec" />
              <text x="15" y={(ROOM_H + CORR) / 2 + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#52514e">
                {f.floor}F
              </text>
            </g>
            {/* ODU group brackets */}
            {f.odus.map((o) => {
              const xs = f.slots.filter((s) => s.room && o.rooms.includes(s.room))
              const x0 = Math.min(...xs.map((s) => s.x))
              const x1 = Math.max(...xs.map((s) => s.x + s.w))
              const od = live.odus[o.id]
              const on = od?.on
              const label = `${o.id}`
              const pw = od ? (od.power_w / 1000).toFixed(1) : '0.0'
              const badgeW = 204
              return (
                <g key={o.id}>
                  <path d={`M${x0 + 2} ${TOP - 6} V${TOP - 13} H${x1 - 2} V${TOP - 6}`} fill="none" stroke={on ? TEAL : '#c3c2b7'} strokeWidth="1.5" />
                  <g transform={`translate(${(x0 + x1) / 2 - badgeW / 2} 2)`}>
                    <rect width={badgeW} height="22" rx="11" fill="#ffffff" stroke={on ? TEAL : '#d6d5ce'} />
                    <circle cx="13" cy="11" r="4.5" fill={on ? TEAL : '#c3c2b7'} />
                    <text x="24" y="15" fontSize="11.5" fontWeight="600" fill="#0b0b0b">
                      실외기 {label}
                    </text>
                    <text x={badgeW - 10} y="15" fontSize="11.5" textAnchor="end" fill={on ? '#0d7a55' : '#898781'} fontWeight="600">
                      {on ? `가동 ${pw}kW` : '정지'}
                    </text>
                  </g>
                </g>
              )
            })}
            {/* corridor */}
            <rect x="0" y={TOP + ROOM_H + 4} width={PLAN_W} height={CORR - 6} rx="4" fill="#f6f6f3" />
            <text x={PLAN_W / 2} y={TOP + ROOM_H + 18} textAnchor="middle" fontSize="10.5" fill="#a8a69e" letterSpacing="6">
              복도
            </text>
            {/* slots */}
            {f.slots.map((s, si) => {
              if (!s.room) {
                return (
                  <g key={si} transform={`translate(${s.x} ${TOP})`}>
                    <rect width={s.w} height={ROOM_H} rx="8" fill="url(#fp-hatch)" stroke="#e7e6e0" />
                    <text x={s.w / 2} y={ROOM_H / 2 + 4} textAnchor="middle" fontSize="11" fill="#a8a69e">
                      {s.label}
                    </text>
                  </g>
                )
              }
              const r = byRoom[s.room]
              const rm = meta.rooms[s.room]
              if (!r || !rm) return null
              const st = STATE_STYLE[r.state]
              const occupied = !!r.session
              const outBand = occupied && (r.ta < lo || r.ta > hi)
              const isSel = selected === s.room || hover === s.room
              const sess = r.session
              const next = r.next
              const pad = 10
              const innerW = s.w - pad * 2
              let line1 = '강의 없음'
              let line2 = rm.type_label
              if (sess) {
                line1 = sess.title
                line2 = `${sess.start}–${sess.end} · ${sess.expected_people ?? '–'}명`
              } else if (next) {
                const mins = Math.max(0, hm(next.start) - minute)
                line1 = `다음 ${next.start} ${next.title}`
                line2 = mins <= 120 ? `${mins}분 후 시작` : rm.type_label
              }
              return (
                <g
                  key={s.room}
                  transform={`translate(${s.x} ${TOP})`}
                  className={onRoomClick ? 'cursor-pointer' : undefined}
                  onClick={() => onRoomClick?.(s.room!)}
                  onMouseEnter={() => setHover(s.room!)}
                  onMouseLeave={() => setHover(null)}
                  role={onRoomClick ? 'button' : undefined}
                  aria-label={`${s.room}호 ${st.label} 실내 ${r.ta.toFixed(1)}도`}
                >
                  <rect
                    width={s.w}
                    height={ROOM_H}
                    rx="8"
                    fill={st.fill}
                    stroke={isSel ? '#0b0b0b' : st.stroke}
                    strokeWidth={isSel ? 2 : r.state === 'OFF' ? 1 : 1.8}
                    filter={isSel ? 'url(#fp-shadow)' : undefined}
                  />
                  {/* header */}
                  <text x={pad} y="22" fontSize="15" fontWeight="700" fill="#0b0b0b">
                    {s.room}
                  </text>
                  <g transform={`translate(${s.w - pad - 40} 9)`}>
                    <rect width="40" height="18" rx="9" fill={st.chip} stroke={r.state === 'FAN' ? '#86d3b6' : 'none'} />
                    <text x="20" y="13" textAnchor="middle" fontSize="10.5" fontWeight="700" fill={st.chipText}>
                      {st.label}
                    </text>
                  </g>
                  {/* temperature */}
                  <text x={pad} y="56" fontSize="25" fontWeight="650" fill={outBand ? '#a12a2a' : '#0b0b0b'} style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {r.ta.toFixed(1)}
                    <tspan fontSize="13" fontWeight="500" fill="#898781" dx="2">
                      ℃
                    </tspan>
                  </text>
                  {outBand && (
                    <text x={s.w - pad} y="54" textAnchor="end" fontSize="10.5" fontWeight="600" fill="#a12a2a">
                      {s.w >= 140 ? '⚠ 쾌적 이탈' : '⚠'}
                    </text>
                  )}
                  {!outBand && r.power_w > 0 && s.w >= 140 && (
                    <text x={s.w - pad} y="54" textAnchor="end" fontSize="11" fill="#52514e" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {(r.power_w / 1000).toFixed(1)} kW
                    </text>
                  )}
                  {/* lecture */}
                  <line x1={pad} x2={s.w - pad} y1="70" y2="70" stroke={r.state === 'OFF' ? '#efeee9' : 'rgba(27,175,122,0.25)'} />
                  {sess && <rect x={pad} y="79" width="3" height="28" rx="1.5" fill="#334155" />}
                  <text x={sess ? pad + 8 : pad} y="90" fontSize="11.5" fontWeight={sess ? 600 : 500} fill={sess ? '#0b0b0b' : '#52514e'}>
                    {fit(line1, innerW - (sess ? 8 : 0), 11.5)}
                  </text>
                  <text x={sess ? pad + 8 : pad} y="105" fontSize="10.5" fill="#898781">
                    {fit(line2, innerW - (sess ? 8 : 0), 10.5)}
                  </text>
                  <title>
                    {`${s.room}호 (${rm.type_label}, 정원 ${rm.capacity}명)\n상태: ${st.label} · 실내 ${r.ta.toFixed(1)}℃ · ${(r.power_w / 1000).toFixed(2)}kW\n${
                      sess ? `진행 중: ${sess.title} ${sess.start}–${sess.end}` : next ? `다음: ${next.title} ${next.start}–${next.end}` : '남은 강의 없음'
                    }`}
                  </title>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

function hm(s: string) {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
