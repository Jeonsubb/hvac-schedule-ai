import { Cpu, Scale } from 'lucide-react'
import { cx } from '../lib/format'

/**
 * The supplied bunny represents cost; the cat represents comfort.
 * Face crops are shared by the conversation, timeline and simulation lab.
 */

export type AgentKey = 'building' | 'occupant' | 'arbiter' | 'simulator'

export const AGENT_CHARACTER = { building: 'bunny', occupant: 'cat' } as const

export const AGENT_META: Record<AgentKey, { name: string; role: string; color: string; bg: string; ink: string; tint: string }> = {
  building: { name: '비용 Agent · 관리자 온디', role: '비용 Agent · 에너지와 요금', color: '#3d6fb6', bg: '#e9f0fa', ink: '#24508f', tint: '#b9d0f5' },
  occupant: { name: '쾌적 Agent · 사용자 온디', role: '쾌적 Agent · 수업 중 쾌적', color: '#e8894f', bg: '#fdf0e7', ink: '#a8521f', tint: '#f8c9a6' },
  simulator: { name: '시뮬레이터', role: '열모델로 제안 검증', color: '#14a673', bg: '#e6f5ee', ink: '#0d7f5a', tint: '#e6f5ee' },
  arbiter: { name: '판정 (결정적 규칙)', role: '두 안의 합의 정리 · LLM 아님', color: '#6250d6', bg: '#efedfb', ink: '#4a3aa7', tint: '#efedfb' },
}

/** Supplied character face inside the participant's colour ring. */
export function OndyAgent({ side, size = 48, className, title }: { side: 'building' | 'occupant'; size?: number; className?: string; title?: string }) {
  const m = AGENT_META[side]
  const ring = Math.max(1.5, size / 26)
  return (
    <span
      role="img"
      aria-label={title ?? m.name}
      className={cx('relative inline-flex shrink-0 overflow-hidden rounded-full isolate', className)}
      style={{ width: size, height: size, background: m.tint, boxShadow: `inset 0 0 0 ${ring}px ${m.color}` }}
    >
      <img
        src={`/assets/agents/${AGENT_CHARACTER[side]}-face.webp`}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-contain"
      />
    </span>
  )
}

/** Avatar for any participant of the negotiation. */
export function AgentAvatar({ agent, size = 36, className }: { agent: AgentKey; size?: number; className?: string }) {
  if (agent === 'building' || agent === 'occupant') return <OndyAgent side={agent} size={size} className={className} />
  const m = AGENT_META[agent]
  const Icon = agent === 'simulator' ? Cpu : Scale
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size, background: m.bg, color: m.ink }}
      role="img"
      aria-label={m.name}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2.2} aria-hidden />
    </span>
  )
}
