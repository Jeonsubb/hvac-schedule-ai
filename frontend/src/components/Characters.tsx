import { Cpu, Scale } from 'lucide-react'
import { cx } from '../lib/format'

/**
 * Agent characters (flat sticker style, readable at 24–96 px).
 * - OccupantAgent: 사용자 에이전트, the orange rounded character (comfort side).
 *   Drawn without the trademark arrow at the end of the smile.
 * - BukhangShark: 관리자 에이전트 '북항이', an original shark mascot for Busan North Port (energy/cost side).
 */

const OUTLINE = '#231f1c'

export function OccupantAgent({ size = 48, badge = true, className, title = '사용자 에이전트' }: { size?: number; badge?: boolean; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {badge && <circle cx="50" cy="50" r="49" fill={OUTLINE} />}
      <g transform="translate(50 51) scale(0.92) translate(-50 -50)">
        {/* stubby arms */}
        <circle cx="16.5" cy="62" r="8.5" fill="var(--color-occupant, #e8894f)" />
        <circle cx="84" cy="62" r="8.5" fill="var(--color-occupant, #e8894f)" />
        {/* wide rounded head-body with two short legs (notch between) */}
        <path
          d="M19.5 88 V28 C19.5 14 28.5 4.5 42 4.5 H60 C73.5 4.5 82.5 14 82.5 28 V88 H60.5 V81 C60.5 78.8 59.2 77.6 57 77.6 H44.5 C42.3 77.6 41 78.8 41 81 V88 Z"
          fill="var(--color-occupant, #e8894f)"
        />
        {/* big eyes looking up */}
        <circle cx="35" cy="23" r="9.6" fill="#fff" stroke={OUTLINE} strokeWidth="2" />
        <circle cx="63.5" cy="23" r="9.6" fill="#fff" stroke={OUTLINE} strokeWidth="2" />
        <ellipse cx="35" cy="19.2" rx="4.4" ry="5.1" fill={OUTLINE} />
        <ellipse cx="63.5" cy="19.2" rx="4.4" ry="5.1" fill={OUTLINE} />
        {/* wide smile (no logo mark) */}
        <path d="M25 45.5 Q47.5 66 72 45" fill="none" stroke={OUTLINE} strokeWidth="3.6" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function BukhangShark({ size = 48, badge = true, className, title = '관리자 에이전트 북항이' }: { size?: number; badge?: boolean; className?: string; title?: string }) {
  const body = 'var(--color-shark, #3d6fb6)'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
      {badge && <circle cx="50" cy="50" r="49" fill="#15304f" />}
      {/* tail behind the body */}
      <path d="M70 70 L86 60 L81.5 73 L88 84 L70 79 Z" fill={body} />
      {/* dorsal fin */}
      <path d="M44 22 L55 5.5 C59 12 61 17 61 23 Z" fill={body} />
      {/* body */}
      <path d="M25 60 C25 34 37 20 51 20 C67 20 77 35 77 58 C77 76 66 87 51 87 C36 87 25 76 25 60 Z" fill={body} />
      {/* belly */}
      <path d="M34 63 C34 53 42 48.5 51 48.5 C60 48.5 68 53 68 63 C68 75 60 82.5 51 82.5 C42 82.5 34 75 34 63 Z" fill="#d7e6f7" />
      {/* gills */}
      <path d="M29.5 43 q2.5 3 0 6 M32.5 41.5 q2.5 3 0 6" fill="none" stroke="#2a5591" strokeWidth="1.6" strokeLinecap="round" />
      {/* eyes */}
      <circle cx="42.5" cy="37" r="6" fill="#fff" />
      <circle cx="60" cy="37" r="6" fill="#fff" />
      <circle cx="43.4" cy="38" r="3.1" fill="#15304f" />
      <circle cx="60.9" cy="38" r="3.1" fill="#15304f" />
      <circle cx="44.4" cy="36.8" r="1" fill="#fff" />
      <circle cx="61.9" cy="36.8" r="1" fill="#fff" />
      {/* cheeks */}
      <circle cx="35.5" cy="48" r="3.2" fill="#f4a3a3" opacity="0.65" />
      <circle cx="67" cy="48" r="3.2" fill="#f4a3a3" opacity="0.65" />
      {/* toothy grin */}
      <path d="M39 51.5 Q51 64 63.5 51.5 Q51 56.5 39 51.5 Z" fill="#15304f" />
      <path d="M43 53.3 L45 56.4 L47 54.2 Z M49.3 54.6 L51.3 57.8 L53.3 54.6 Z M55.6 54.2 L57.6 56.4 L59.6 53.3 Z" fill="#fff" />
      {/* side fins, the right one holding a wrench (building manager) */}
      <path d="M27 64 Q16 66 18 75 Q24 73 30.5 70 Z" fill={body} />
      <path d="M75 63 Q84 62 86 69 Q80 70 74.5 70 Z" fill={body} />
      <g transform="rotate(-38 83 62)">
        <rect x="80.8" y="56" width="4.4" height="15" rx="2" fill="#f2b84b" />
        <path d="M78 52.5 a5 5 0 1 0 10 0 l-2.4 0 l0 3 l-5.2 0 l0 -3 Z" fill="#f2b84b" />
      </g>
    </svg>
  )
}

export type AgentKey = 'building' | 'occupant' | 'arbiter' | 'simulator'

export const AGENT_META: Record<AgentKey, { name: string; role: string; color: string; bg: string; ink: string }> = {
  building: { name: '북항이', role: '관리자 에이전트 · 에너지와 요금', color: '#3d6fb6', bg: '#e9f0fa', ink: '#24508f' },
  occupant: { name: '사용자 에이전트', role: '건물 이용자 · 쾌적', color: '#e8894f', bg: '#fdf0e7', ink: '#a8521f' },
  simulator: { name: '시뮬레이터', role: '열모델로 제안 검증', color: '#14a673', bg: '#e6f5ee', ink: '#0d7f5a' },
  arbiter: { name: '판정', role: '두 안의 합의 정리', color: '#6250d6', bg: '#efedfb', ink: '#4a3aa7' },
}

/** Avatar for any participant of the negotiation. */
export function AgentAvatar({ agent, size = 36, className }: { agent: AgentKey; size?: number; className?: string }) {
  if (agent === 'building') return <BukhangShark size={size} className={cx('shrink-0', className)} />
  if (agent === 'occupant') return <OccupantAgent size={size} className={cx('shrink-0', className)} />
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
