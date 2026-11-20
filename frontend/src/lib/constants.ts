import type { DaySummary, StrategyKey } from './types'

export const STRATEGY_KEYS: StrategyKey[] = ['fixed', 'manual', 'rule', 'ai']

export const STRATEGY: Record<StrategyKey, { label: string; short: string; color: string; wash: string; desc: string }> = {
  fixed: {
    label: '현재 운영',
    short: '현재',
    color: '#565a60',
    wash: 'rgba(86,90,96,0.14)',
    desc: '강의실에서 첫 수업 때 켜고 중앙이 18:00에 일괄 차단(이후 재가동 불가), 온도는 정부 지침 범위 안(켜는 시각은 가정)',
  },
  manual: {
    label: '수동 운영',
    short: '수동',
    color: '#e09a00',
    wash: 'rgba(224,154,0,0.16)',
    desc: '첫 강의에 켜고 마지막 강의 30분 뒤 끔',
  },
  rule: {
    label: '규칙 기반',
    short: '규칙',
    color: '#2a78d6',
    wash: 'rgba(42,120,214,0.14)',
    desc: '시작 10분 전 켜고 종료 5분 전 끔, 15분 이내 공백은 유지',
  },
  ai: {
    label: 'AI 예측 제어',
    short: 'AI',
    color: '#14a673',
    wash: 'rgba(20,166,115,0.15)',
    desc: '열모델과 예보로 최적 기동, 가동 생략, 외기 냉방, 관성 정지, 재실 감지, 피드백 보정',
  },
}

export const CHART = {
  ink: '#142033',
  ink2: '#4a5668',
  muted: '#667183',
  grid: '#e6eaef',
  axis: '#c9d1db',
  surface: '#ffffff',
  outdoor: '#8a94a3',
  comfortBand: 'rgba(20,32,51,0.05)',
  comfortInk: '#4a5668',
  event: '#6250d6',
  lecture: '#334155',
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

export const GROUP_META: Record<StatusGroup, { label: string; color: string; ink: string; bg: string; icon: string }> = {
  normal: { label: '정상', color: STATUS_COLOR.good, ink: '#0a6b0a', bg: '#eaf6ea', icon: '#0ca30c' },
  auto: { label: '자동 조치', color: STATUS_COLOR.warn, ink: '#8a5a00', bg: '#fff4dc', icon: '#c98500' },
  review: { label: '확인 필요', color: STATUS_COLOR.crit, ink: '#a12a2a', bg: '#fdeeee', icon: '#d03b3b' },
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
  fixed_on: '현재 운영 시작',
  fixed_off: '중앙 일괄 정지 시각',
  manual_off_delay_min: '수동 운영 정지 지연(분)',
  auto_off_after_min: '빈 강의실 자동 정지(분)',
}

/** Per-day counts: the API now returns them; older responses only had match_rate + anomalies. */
export function splitCounts(d: DaySummary): { review: number; auto: number } {
  if (d.needs_review != null && d.auto_actions != null) return { review: d.needs_review, auto: d.auto_actions }
  const review = d.match_rate != null && d.match_rate < 100 ? Math.round(d.sessions * (1 - d.match_rate / 100)) : 0
  return { review, auto: Math.max(0, d.anomalies - review) }
}

/** cold_starts in the API counts classes that began too cold OR too hot, so the Korean label avoids "저온". */
export const COLD_START = {
  label: '시작 시 쾌적 이탈',
  short: '시작 이탈',
  desc: '강의가 시작될 때 실내온도가 쾌적 범위(±0.3℃)를 벗어나 있던 횟수입니다. 너무 춥거나 더운 교실에서 수업이 시작된 경우를 셉니다.',
}

/** Sum a per-day strategy field over the days of a scope (summary totals omit cold_starts). */
export function sumDays(days: DaySummary[], k: StrategyKey, field: 'cold_starts', until?: string): number {
  return days.filter((d) => !until || d.date <= until).reduce((a, d) => a + (d.strategies[k]?.[field] ?? 0), 0)
}
