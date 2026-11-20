import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CloudSun,
  Cpu,
  Database,
  Landmark,
  MessageSquareWarning,
  Radio,
  Server,
  Sun,
  Thermometer,
  Users,
  Wifi,
  Wind,
} from 'lucide-react'
import type { SourceOrigin } from '../lib/types'

/** Data feeds the planner and the agents read. Keys match DataSource.key / AgentTrace.source. */
export const SOURCE_META: Record<string, { label: string; icon: LucideIcon }> = {
  timetable: { label: '강의 시간표', icon: BookOpen },
  calendar: { label: '학사일정', icon: CalendarDays },
  weather: { label: '날씨 실측', icon: CloudSun },
  forecast: { label: '날씨 예보', icon: CloudSun },
  nowcast: { label: '초단기 실황', icon: Radio },
  climatology: { label: '평년 기후', icon: Sun },
  sensor: { label: '실내 온도 (시뮬레이션)', icon: Thermometer },
  co2: { label: 'CO₂ 추정', icon: Wind },
  occupancy: { label: '재실 인원 추정', icon: Users },
  density: { label: '재실 밀도 추정', icon: Wifi },
  events: { label: '행사·예약', icon: CalendarClock },
  feedback: { label: '쾌적 의견', icon: MessageSquareWarning },
  bms: { label: '중앙 제어기', icon: Server },
  tariff: { label: '전기 요금', icon: Banknote },
  policy: { label: '온도 정책', icon: Landmark },
  simulator: { label: '시뮬레이터', icon: Cpu },
}

export function sourceMeta(key: string): { label: string; icon: LucideIcon } {
  return SOURCE_META[key] ?? { label: key, icon: Database }
}

export const ORIGIN_META: Record<SourceOrigin, { label: string; bg: string; ink: string }> = {
  live: { label: '실데이터', bg: '#eaf6ea', ink: '#0a6b0a' },
  simulated: { label: '시뮬레이션 센서', bg: '#eaf2fc', ink: '#1c5cab' },
  input: { label: '운영자 입력', bg: '#efedfb', ink: '#4a3aa7' },
  assumption: { label: '가정값', bg: '#fff4dc', ink: '#8a5a00' },
}

export function SourceIcon({ k, size = 15, className }: { k: string; size?: number; className?: string }) {
  const Icon = sourceMeta(k).icon
  return <Icon size={size} strokeWidth={2.1} className={className} aria-hidden />
}
