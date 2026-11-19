import type { StrategyKey } from './types'

export const STRATEGY_KEYS: StrategyKey[] = ['fixed', 'manual', 'rule', 'ai']

export const STRATEGY: Record<StrategyKey, { label: string; short: string; color: string; wash: string; desc: string }> = {
  fixed: {
    label: '고정 스케줄',
    short: '고정',
    color: '#52514e',
    wash: 'rgba(82,81,78,0.14)',
    desc: '평일 전 강의실 08:30–22:30 가동',
  },
  manual: {
    label: '수동 운영',
    short: '수동',
    color: '#eda100',
    wash: 'rgba(237,161,0,0.16)',
    desc: '첫 강의에 켜고 마지막 강의 30분 뒤 끔',
  },
  rule: {
    label: '규칙 기반',
    short: '규칙',
    color: '#2a78d6',
    wash: 'rgba(42,120,214,0.14)',
    desc: '시작 10분 전 On · 종료 5분 전 Off · 15분 이내 공백 유지',
  },
  ai: {
    label: 'AI 예측 제어',
    short: 'AI',
    color: '#1baf7a',
    wash: 'rgba(27,175,122,0.16)',
    desc: '열모델+예보: 최적 기동·생략·외기냉방·관성정지·재실감지·피드백 보정',
  },
}

export const CHART = {
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  surface: '#fcfcfb',
  outdoor: '#898781',
  comfortBand: 'rgba(27,175,122,0.08)',
  event: '#6250d6',
}

export const STATUS_COLOR = {
  good: '#0ca30c',
  warn: '#fab219',
  serious: '#ec835a',
  crit: '#d03b3b',
}

export type StatusGroup = 'normal' | 'auto' | 'review'

export const VALIDATION_STATUS: Record<string, { label: string; group: StatusGroup }> = {
  ok: { label: '정상', group: 'normal' },
  skip_ok: { label: '가동 생략(쾌적 유지)', group: 'normal' },
  vacancy: { label: '재실 없음→자동 정지', group: 'auto' },
  recovered: { label: '명령 실패→재전송 복구', group: 'auto' },
  override: { label: '수동 가동→자동 정지', group: 'auto' },
  corrected: { label: '예보 오차→피드백 보정', group: 'auto' },
  not_ready: { label: '선행 가동 부족', group: 'review' },
  low_comfort: { label: '쾌적 미달', group: 'review' },
  exec_gap: { label: '실행 누락', group: 'review' },
  plan_missing: { label: '계획 누락', group: 'review' },
}

export function statusInfo(s: string): { label: string; group: StatusGroup } {
  return VALIDATION_STATUS[s] ?? { label: s, group: 'review' }
}

export const GROUP_META: Record<StatusGroup, { label: string; color: string; ink: string; bg: string }> = {
  normal: { label: '정상', color: STATUS_COLOR.good, ink: '#006300', bg: '#ecf8ec' },
  auto: { label: '자동 조치', color: STATUS_COLOR.warn, ink: '#7a5000', bg: '#fff6e0' },
  review: { label: '확인 필요', color: STATUS_COLOR.crit, ink: '#a12a2a', bg: '#fdeeee' },
}

export const DECISION: Record<string, { label: string; desc: string; at: 'start' | 'end' }> = {
  optimal_start: { label: '최적 기동', desc: '예측 실내온도로 필요한 만큼만 선행 가동', at: 'start' },
  late_start: { label: '지연 기동', desc: '실내가 이미 쾌적해 기동 시점을 늦춤', at: 'start' },
  skip: { label: '가동 생략', desc: '가동 없이도 쾌적 범위 유지', at: 'start' },
  economizer: { label: '외기 냉방', desc: '압축기 없이 송풍·환기로 냉방', at: 'start' },
  early_stop: { label: '관성 정지', desc: '건물 열관성으로 종료 전 정지', at: 'end' },
  bridge: { label: '공백 유지', desc: '짧은 공백은 끄지 않고 유지', at: 'start' },
}

export function decisionLabel(t: string) {
  return DECISION[t]?.label ?? t
}

export const TOOL_LABEL: Record<string, string> = {
  get_overview: '학기 현황 조회',
  get_day: '일자 분석',
  get_room_week: '강의실 주간 분석',
  simulate_policy: '규칙 시뮬레이션',
  propose_policy: '정책 제안',
  draft_event: '일정 초안',
  consolidation_advice: '재배치 분석',
  get_validation_issues: '정합성 이슈 조회',
}

export const WEEKDAY = ['월', '화', '수', '목', '금', '토', '일']

export const ROOM_ORDER = ['306', '307', '309', '310', '405', '406', '407', '408', '409', '410']

export const EVENT_TYPE: Record<string, string> = {
  add: '일정 추가',
  cancel: '휴강',
  move: '강의실 변경',
  closure: '휴관',
}

export const SETTING_LABEL: Record<string, string> = {
  pre_on_min: '선행 가동(분)',
  early_off_min: '조기 정지(분)',
  gap_merge_min: '공백 유지 기준(분)',
  sp_heat: '난방 설정온도(℃)',
  sp_cool: '냉방 설정온도(℃)',
  comfort_low: '쾌적 하한(℃)',
  comfort_high: '쾌적 상한(℃)',
  ai_max_lead_min: 'AI 최대 선행(분)',
  ai_max_early_off_min: 'AI 최대 조기 정지(분)',
  ai_gap_eval_max_min: 'AI 공백 평가 상한(분)',
  baseline: '절감 비교 기준',
  anomalies: '현장 이상 상황 시뮬레이션',
  fixed_on: '고정 스케줄 시작',
  fixed_off: '고정 스케줄 종료',
  manual_off_delay_min: '수동 운영 정지 지연(분)',
  auto_off_after_min: '빈 강의실 자동 정지(분)',
}
