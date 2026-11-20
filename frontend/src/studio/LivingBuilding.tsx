import { useId } from 'react'
import type { Meta } from '../lib/types'
import type { PlanModel } from '../lib/plans'
import { intervalAt, mergeIntervals } from '../lib/plans'
import { fmtMin } from '../lib/format'

/** An explicitly conceptual floor arrangement, driven only by the selected simulation plan. */
export default function LivingBuilding({ meta, plan, rooms, minute, selected, onSelect }: {
  meta: Meta; plan: PlanModel; rooms: string[]; minute: number; selected: string | null; onSelect: (room: string) => void
}) {
  const id = useId().replaceAll(':', '')
  const floors = [...new Set(rooms.map((r) => meta.rooms[r].floor))].sort((a, b) => b - a)
  return (
    <div className="living-building">
      <svg viewBox={`0 0 960 ${floors.length * 160 + 20}`} role="group" aria-label="강의실 개념 배치도 · 선택 시각의 예측 운전 상태">
        <defs><pattern id={`grid${id}`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 H 0 V 32" fill="none" stroke="#ffffff" strokeOpacity=".035" strokeWidth="1" /></pattern></defs>
        <rect width="960" height={floors.length * 160 + 20} fill={`url(#grid${id})`} />
        {floors.map((floor, f) => {
          const row = rooms.filter((r) => meta.rooms[r].floor === floor)
          const y = 28 + f * 160
          const width = Math.min(142, 690 / row.length - 10)
          const start = 145 + (690 - row.length * (width + 10)) / 2
          return <g key={floor}>
            <text x="30" y={y + 43} className="living-floor">{String(floor).padStart(2, '0')}</text>
            <text x="32" y={y + 62} className="living-floor-caption">FLOOR</text>
            <path d={`M 115 ${y - 8} H 841 L 890 ${y + 109} H 164 Z`} fill="#1b222e" stroke="#ffffff" strokeOpacity=".12" />
            <path d={`M 164 ${y + 109} H 890 V ${y + 117} H 164 Z`} fill="#0c111b" />
            <path d={`M 145 ${y + 91} H 856`} fill="none" stroke="#ffffff" strokeOpacity=".12" strokeDasharray="4 6" />
            {row.map((room, i) => {
              const data = plan.rooms[room]
              const active = intervalAt(data?.plan, minute)
              const temp = data?.ta?.[Math.min((data.ta?.length ?? 1) - 1, Math.floor(minute / 5))]
              const next = mergeIntervals(data?.plan).find((iv) => iv.s > minute)
              const x = start + i * (width + 10)
              const chosen = selected === room
              const state = active ? active.kind === 'fan' ? '송풍' : 'ON' : 'OFF'
              const label = `${room}호 · ${Number.isFinite(temp) ? `예측 ${temp!.toFixed(1)}도 · ` : ''}${state}${next ? ` · 다음 운전 ${fmtMin(next.s)}` : ''}`
              return <g key={room} role="button" tabIndex={0} aria-label={label} aria-pressed={chosen} onClick={() => onSelect(room)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(room) } }} className={`living-room${active ? ' is-on' : ''}${chosen ? ' is-selected' : ''}`} style={{ transformOrigin: `${x + width / 2 + 14}px ${y + 35}px` }}>
                <title>{label} · 시뮬레이션 계획</title>
                <path className="living-room-side" d={`M ${x + 27} ${y + 73} H ${x + width + 27} V ${y + 82} H ${x + 27} Z`} />
                <path className="living-room-face" d={`M ${x} ${y + 8} H ${x + width} L ${x + width + 27} ${y + 73} H ${x + 27} Z`} />
                <path d={`M ${x + 12} ${y + 19} H ${x + width - 6}`} stroke="currentColor" strokeOpacity=".2" strokeWidth="1" />
                <text x={x + width / 2 + 14} y={y + 41} className="living-room-name" textAnchor="middle">{room}</text>
                <text x={x + width / 2 + 14} y={y + 58} className="living-room-temperature" textAnchor="middle">{Number.isFinite(temp) ? `${temp!.toFixed(1)}°` : '—'} <tspan className="living-room-state">{state}</tspan></text>
                <circle className="living-room-dot" cx={x + width - 1} cy={y + 22} r="2.5" />
              </g>
            })}
          </g>
        })}
      </svg>
      <div className="living-caption"><span><i /> HVAC ON <i className="off" /> OFF</span><span>CONCEPTUAL PLAN · 실제 건물 도면 아님</span></div>
    </div>
  )
}
