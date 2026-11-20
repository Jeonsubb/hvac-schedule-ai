// Types derived from real backend responses (http://localhost:8000).

export type StrategyKey = 'fixed' | 'manual' | 'rule' | 'ai'

export interface Idu {
  id: string
  cool_kw: number
  heat_kw: number
}

export interface RoomMeta {
  id: string
  building: string
  floor: number
  type: string
  type_label: string
  area: number
  capacity: number
  pcs: number
  odu: string
  idus: Idu[]
  assumption: boolean
}

export interface OduMeta {
  id: string
  label: string
  floor: number
  cap_kw: number
}

export interface Tariff {
  light: number
  mid: number
  peak: number
}

export interface Settings {
  pre_on_min: number
  early_off_min: number
  gap_merge_min: number
  sp_heat: number
  sp_cool: number
  comfort_low: number
  comfort_high: number
  fixed_on: string
  fixed_off: string
  manual_off_delay_min: number
  baseline: string
  ai_max_lead_min: number
  ai_max_early_off_min: number
  ai_gap_eval_max_min: number
  dehum_rh: number
  dehum_temp: number
  anomalies: boolean
  override_rate: number
  failure_rate: number
  auto_off_after_min: number
  tariff: { summer: Tariff; spring_fall: Tariff; winter: Tariff }
  co2_kg_per_kwh: number
  [k: string]: unknown
}

export interface NowInfo {
  date: string
  minute: number
  live: boolean
  reason: string
  real: string
}

export interface Meta {
  building: { id: string; name: string; campus: string; lat: number; lon: number; kma_nx: number; kma_ny: number }
  rooms: Record<string, RoomMeta>
  odus: Record<string, OduMeta>
  semester: { year: string; term: string; start: string; end: string }
  holidays: Record<string, string>
  strategies: Record<StrategyKey, string>
  settings: Settings
  now: NowInfo
  counts: { courses: number; events: number }
  weather: { fetched_at: string | null; errors: Record<string, string>; kma_base: string | null }
  models: Record<string, string>
  /** Bedrock health: last success / last failure */
  ai?: { ok: boolean | null; last_ok?: string | null; last_error?: string | null; error?: string | null }
  /** 'aws' | 'local-fallback' in production; a class name (e.g. 'LocalStore') in local development */
  storage?: { mode: string; last_error?: string | null }
}

export interface Session {
  id: string
  date: string
  room: string
  start: string
  end: string
  title: string
  professor?: string
  kind: 'lecture' | 'event'
  course_id?: string
  expected_people: number | null
  people_estimated?: boolean
  event_id?: string
}

export interface StrategyDayTotals {
  /** classes that began outside the comfort band (days only; totals omit it) */
  cold_starts?: number
  kwh: number
  cost_krw: number
  co2_kg: number
  peak_kw: number
  comfort_pct: number | null
  on_minutes: number
  odu_on_minutes: number
  discomfort_dm: number
}

export interface DaySummary {
  date: string
  weekday: number
  workday: boolean
  holiday: string | null
  sessions: number
  events: number
  t_mean: number
  t_min: number
  t_max: number
  strategies: Record<StrategyKey, StrategyDayTotals>
  match_rate: number | null
  plan_coverage: number | null
  anomalies: number
  /** present in current backend; older responses only had `anomalies` */
  auto_actions?: number
  needs_review?: number
  decisions: Record<string, number>
}

export interface LiveRoom {
  room: string
  type: string
  floor: number
  odu: string
  state: 'ON' | 'FAN' | 'OFF'
  ta: number
  power_w: number
  session: Session | null
  next: Session | null
}

export interface Live {
  now: NowInfo
  rooms: LiveRoom[]
  odus: Record<string, { on: boolean; power_w: number }>
  outdoor: { t: number; rh: number; src: string }
  kwh_so_far: Record<StrategyKey, number>
  date_summary: DaySummary
}

export interface WeatherSeries {
  t: number[]
  rh: number[]
  ghi: number[]
}

export interface DayWeather {
  actual: WeatherSeries
  forecast: WeatherSeries
  src_actual: string
  src_forecast: string
}

export interface Interval {
  s: number
  e: number
  kind?: 'cond' | 'fan'
  reason?: string
  sessions?: string[]
}

export interface SessionComfort {
  id: string
  start: string
  end: string
  minutes: number
  in_band_minutes: number
  ta_start: number
  ta_min: number
  ta_max: number
  discomfort_dm: number
  pmv?: number
}

export interface RoomDay {
  kwh: number
  heat_kwh_th?: number
  cool_kwh_th?: number
  on_minutes: number
  actual: Interval[]
  sessions: SessionComfort[]
  ta: number[]
  p: number[]
}

export interface OduDay {
  kwh: number
  on_minutes: number
  actual: Interval[]
  p: number[]
}

export interface StrategyDay {
  kwh: number
  kwh_by_hour: number[]
  peak_kw: number
  comfort_pct: number | null
  occupied_minutes?: number
  cost_krw: number
  co2_kg: number
  guard_events?: Record<string, unknown>
  plan: Record<string, Interval[]>
  rooms: Record<string, RoomDay>
  odus: Record<string, OduDay>
}

export type DecisionType = 'optimal_start' | 'late_start' | 'skip' | 'economizer' | 'early_stop' | 'bridge'

export interface Decision {
  session?: string
  sessions?: string[]
  room: string
  title: string
  start: string
  end: string
  type: DecisionType | string
  detail: string
  lead_min?: number
  saved_min?: number
}

export type ValidationStatus =
  | 'ok'
  | 'skip_ok'
  | 'vacancy'
  | 'recovered'
  | 'override'
  | 'corrected'
  | 'not_ready'
  | 'low_comfort'
  | 'exec_gap'
  | 'plan_missing'

export interface ValidationSession {
  session: string
  room: string
  title: string
  start: string
  end: string
  kind?: string
  status: ValidationStatus | string
  notes: string[]
  planned?: boolean
  exec_ratio: number | null
  ta_start: number | null
  comfort_pct: number | null
  decisions: string[]
}

export interface Validation {
  sessions: ValidationSession[]
  issues: ValidationSession[]
  total: number
  match_rate: number | null
  plan_coverage: number | null
  auto_actions: number
  anomaly_count: number
}

export interface HistoryRow {
  date: string
  t: string
  minute: number
  device: string
  room: string | null
  state: string
  cause: string
}

export interface Day {
  date: string
  weekday: number
  workday: boolean
  holiday: string | null
  sessions: Session[]
  weather: DayWeather
  strategies: Partial<Record<StrategyKey, StrategyDay>>
  decisions: Decision[]
  init?: Record<string, number[]>
  scenario?: Record<string, { type: string; session: string; s: number; e: number }[]>
  validation: Validation
  history: HistoryRow[]
  fingerprint?: string
  computed_at?: string
  /** per-room setpoints of applied schedule adjustments (AI operation only) */
  room_sp?: Record<string, { sp_heat?: number; sp_cool?: number }>
}

export interface TotalsRow extends StrategyDayTotals {}

export interface Summary {
  days: DaySummary[]
  totals: { all: Record<StrategyKey, TotalsRow>; to_date: Record<StrategyKey, TotalsRow> }
  decisions: Record<string, number>
  today: string
  computed_at: string
  weather_sources: [string, string][]
}

export interface KmaHour {
  t: number
  rh: number
  sky: number
  pty: number
  pop: number
}

export interface WeatherNow {
  nowcast: { time: string; t: number; rh: number; rain_mm: number; wind: number; pty: number } | null
  kma_base: string | null
  kma_hourly: Record<string, KmaHour>
  days: Record<string, DayWeather | null>
  fetched_at: string | null
}

export interface Course {
  id: string
  building: string
  room: string
  weekday: number | null
  date?: string
  start: string
  end: string
  class_name: string
  course_code?: string
  section?: string
  professor?: string
  dept?: string
  grade?: string
  expected_people: number | null
  people_estimated?: boolean
  source?: string
}

export type EventType = 'add' | 'cancel' | 'move' | 'closure'

export interface EventDraft {
  type: EventType
  date: string
  room?: string | null
  start?: string | null
  end?: string | null
  title?: string
  expected_people?: number | null
  course_id?: string | null
  new_room?: string | null
  clarification?: string | null
  /** conflict / capacity check returned with parsed drafts */
  check?: EventCheck | null
  /** parse result reused from today's cache because the AI was unavailable */
  from_cache?: boolean
  cached_at?: string
}

export interface EventConflict {
  room: string
  title: string
  start: string
  end: string
  kind: string
}

export interface EventAlternative {
  room: string
  type: string
  capacity: number
  odu: string
  odu_already_on: boolean
  extra_kwh: number
  requested: boolean
}

export interface EventCheck {
  ok: boolean
  conflicts: EventConflict[]
  capacity_ok: boolean
  capacity: { room: string; capacity: number; expected_people: number | null } | null
  alternatives: EventAlternative[]
  /** why ok=false when there is no conflict/capacity problem (e.g. the class does not meet that day) */
  note?: string | null
  alternatives_note?: string | null
  /** cancel/move: the class that will be cancelled or moved */
  target?: { room: string; title: string; start: string; end: string }[]
}

export type AttributionVariant = 'fixed' | 'rule' | 'rule30' | 'rule_vacancy' | 'ai_predictive' | 'ai_weather' | 'ai'

export interface AttributionRow {
  label: string
  kwh: number
  discomfort_dm: number
  cold_starts: number
  peak_kw: number
  comfort_pct: number | null
}

export interface WaterfallStep {
  label: string
  variant: AttributionVariant
  kwh: number
  delta_kwh: number | null
  cold_starts: number
  comfort_pct: number | null
}

export interface AttributionScope {
  variants: Record<AttributionVariant, AttributionRow>
  waterfall: WaterfallStep[]
}

export interface Attribution {
  all: AttributionScope
  to_date: AttributionScope
  labels: Record<string, string>
  note: string
  computed_at: string
  stale?: boolean
}

export interface EventRec extends EventDraft {
  id: string
  created_at?: string
  source?: string
}

export interface EventResult {
  event: EventRec
  before: DaySummary
  after: DaySummary
}

export interface ImportPreview {
  count: number
  added: Course[]
  removed: Course[]
  unchanged: number
  courses: Course[]
}

export interface ImportResponse {
  mode: 'sync' | 'job'
  source: string
  preview?: ImportPreview
  job?: string
}

export interface WhatIfRow {
  cold_starts?: number
  kwh: number
  discomfort_dm: number
  comfort_pct: number | null
}

export interface WhatIf {
  base: Record<StrategyKey, WhatIfRow>
  new: Record<StrategyKey, WhatIfRow>
  dates: string[]
  overrides: Record<string, unknown>
}

export interface ConsolidationMove {
  course_id: string
  title: string
  professor: string
  start: string
  end: string
  from_room: string
  to_room: string
  from_odu: string
  to_odu: string
  expected_people: number
  capacity: number
  kwh_gain_rep?: number
}

export interface ConsolidationDay {
  weekday: number
  weekday_label: string
  moves: ConsolidationMove[]
  odu_minutes_before?: number
  odu_minutes_after?: number
  room_minutes_before?: number
  room_minutes_after?: number
  dates?: number
  kwh_before?: number
  kwh_after?: number
  kwh_saving?: number
  saving_pct?: number
  comfort_before?: number
  comfort_after?: number
}

export interface Consolidation {
  /** previous result shown while it recomputes */
  stale?: boolean
  weekdays: ConsolidationDay[]
  semester_kwh_saving: number
  note: string
}

export interface AuditRec {
  id: string
  ts: string
  kind: string
  message: string
  actor: string
  data?: Record<string, unknown>
}

export interface ChatStep {
  tool: string
  input: Record<string, unknown>
  ok?: boolean
}

export interface Proposal {
  overrides: Record<string, number>
  title: string
  rationale: string
  expected_effect: string
}

export interface ChatResult {
  /** answered from the cache because Bedrock failed */
  from_cache?: boolean
  cached_at?: string
  answer?: string
  steps?: ChatStep[]
  proposals?: Proposal[]
  event_drafts?: EventDraft[]
  simulations?: WhatIf[]
}

export interface Job<R = unknown> {
  id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'error'
  created_at?: string
  progress?: { steps?: ChatStep[] }
  result: R | null
  error?: string
}

// ---------------------------------------------------------------- v5: B2B onboarding, 1·2·3차 스케줄, 쾌적 의견, 에이전트 협의, 운전 모드

export type OpModeKey = 'auto' | 'recommend'
export type Verdict = 'ok' | 'adjust' | 'review'
export type SourceOrigin = 'live' | 'simulated' | 'input' | 'assumption'

/** One data feed the planner reads (기상청, CO2 센서, 재실 밀도, 민원 …). */
export interface DataSource {
  key: string // 'timetable' | 'calendar' | 'weather' | 'forecast' | 'nowcast' | 'co2' | 'occupancy' | 'density' | 'sensor' | 'events' | 'feedback' | 'bms' | 'tariff' | 'policy' | 'simulator'
  label: string // '기상청 단기예보'
  origin: SourceOrigin // 실데이터 / 시뮬레이션 센서 / 운영자 입력 / 가정값
  status: 'ok' | 'stale' | 'missing'
  detail: string // '11/20 14:00 발표, 3일치'
  updated_at?: string | null
}

/** A consistency check: does the plan still fit the data that just arrived? */
export interface TierCheck {
  id: string
  title: string // '날씨 급변 대응'
  idea?: number | null // 과제 아이디어 번호(11~15) 또는 요구사항 번호
  sources: string[] // DataSource keys
  expected: string // 계획이 가정한 것
  observed: string // 새로 들어온 데이터
  verdict: Verdict
  action: string // AI 판단/조치
  rooms?: string[]
}

export interface RoomSetpoint {
  sp_heat?: number
  sp_cool?: number
}

export interface Adjustment {
  id: string
  tier: 1 | 2 | 3
  origin: 'tier' | 'agents' | 'feedback'
  kind: 'setpoint' | 'vent'
  title: string
  reason: string
  rooms: string[]
  date_from: string
  date_to: string
  change: { sp_heat?: number; sp_cool?: number; vent?: 'low' | 'mid' | 'high' }
  impact: { kwh: number; cost_krw: number; pmv_before?: number | null; pmv_after?: number | null; note?: string }
  evidence: { source: string; text: string }[]
  status: 'pending' | 'applied' | 'rejected'
  created_at: string
  decided_at?: string | null
  decided_by?: string | null
}

export interface TierDay {
  date: string
  weekday: number
  workday: boolean
  holiday: string | null
  sessions: number
  events: number
  kwh: number // AI 계획
  baseline_kwh: number // 현재 운영(고정)
  on_hours: number
  t_mean: number
  t_min: number
  t_max: number
  src: 'actual' | 'forecast' | 'climatology'
  adjusted: boolean // 적용된 조정이 있는 날
}

export interface TierBlock {
  s: number // minute of day
  e: number
  kind?: string // 'cond' | 'fan' | 'lecture' | 'event'
  label?: string
}

export interface TierRoomRow {
  room: string
  type: string
  orient: string // '남' | '북' | '동' | '서'
  sessions: number
  people: number // 예상 인원 합(주간) 또는 오늘 최대
  kwh: number
  sp_heat: number
  sp_cool: number
  co2_peak: number | null
  vent: 'low' | 'mid' | 'high'
  feedback: { n: number; mean: number | null }
  solar_index: number // 오후 일사 부하 kW (방향 반영)
  ta_now?: number | null
  windows?: TierBlock[] // 3차: 오늘 AI 운전 구간
  lectures?: TierBlock[] // 3차: 오늘 수업
  week?: Record<number, TierBlock[]> // 1차: 요일(0~5) → 수업 블록
}

export interface TierHourly {
  step_min: number // 15
  t_forecast: number[] // 24 (계획에 쓴 예보)
  t_actual: (number | null)[] // 24 (실황, 미래는 null)
  ghi: number[] // 24
  co2: Record<string, number[]> // room → 96 (ppm)
  people: Record<string, number[]> // room → 96
}

export interface TierPlan {
  tier: 1 | 2 | 3
  label: string // '1차 · 월간 기본 계획'
  period: { start: string; end: string; label: string }
  generated_at: string
  mode: OpModeKey
  summary: {
    sentence: string
    kwh: number
    baseline_kwh: number
    cost_krw: number
    saving_pct: number | null
    sessions: number
    comfort_pct: number | null
  }
  sources: DataSource[]
  checks: TierCheck[]
  adjustments: Adjustment[]
  days?: TierDay[]
  rooms?: TierRoomRow[]
  hourly?: TierHourly
  now_minute?: number | null
}

/** 사고 과정: 에이전트가 어떤 데이터를 보고 무엇을 확인했는지 */
export interface AgentTrace {
  source: string // DataSource key
  query: string
  finding: string
}

export interface NegotiationEval {
  kwh: number
  cost_krw: number
  pmv_mean: number | null
  cold_rooms: string[]
  hot_rooms: string[]
  discomfort_dm: number
  cold_starts: number
  complaints_addressed: number
  rooms: Record<string, { kwh: number; pmv: number | null; sp_heat?: number; sp_cool?: number }>
}

export interface AgentTurn {
  round: number
  agent: 'building' | 'occupant' | 'arbiter' // building = 관리자(건물) 에이전트 '북항이', occupant = 사용자 에이전트
  stance: string
  message: string
  trace: AgentTrace[]
  proposal: Record<string, RoomSetpoint>
  eval?: NegotiationEval
  accepts?: boolean
}

export interface Negotiation {
  tier: 2 | 3
  date: string
  dates: string[]
  season: 'heat' | 'cool'
  policy: { heat_min: number; heat_max: number; cool_min: number; cool_max: number }
  baseline: NegotiationEval
  turns: AgentTurn[]
  final: { proposal: Record<string, RoomSetpoint>; eval: NegotiationEval; summary: string; agreed: boolean }
  adjustment_ids: string[]
  ai: boolean // false: AI 연결 실패로 규칙 기반 협의
  note?: string
  created_at: string
}

export interface NegotiationJob {
  id: string
  kind: 'negotiate'
  status: 'queued' | 'running' | 'done' | 'error'
  progress?: { phase?: string; turns?: AgentTurn[] }
  result: Negotiation | null
  error?: string
}

export interface Feedback {
  id: string
  ts: string
  date: string
  minute: number
  room: string
  vote: number // ASHRAE 7점: -3 춥다 … 0 적당 … +3 덥다
  tags: string[] // 'stuffy' 답답함 | 'draft' 바람 | 'humid' 습함 | 'dry' 건조 | 'noise' 소음
  text: string
  source: 'occupant' | 'operator' | 'simulated'
  status: 'new' | 'reflected'
  reflected_in?: string | null
}

export interface FeedbackSummary {
  items: Feedback[]
  by_room: Record<string, { n: number; mean: number | null; cold: number; hot: number; stuffy: number; last_ts: string | null }>
  by_hour: Record<string, Record<string, { n: number; mean: number }>> // room → hour → …
  days: number
}

export interface FeedbackReply {
  feedback: Feedback
  reply: {
    message: string
    room: { ta: number | null; state: string; sp_heat: number; sp_cool: number; co2: number | null; session: string | null }
    policy: string
    next: string
  }
}

export interface OpMode {
  mode: OpModeKey
  changed_at: string | null
  by: string | null
  pending: number
}

export interface BmsCommand {
  id: string
  ts: string
  device: string
  room: string
  point: string
  value: string
  window: string
  adjustment_id: string
  /** queued → sent (to the edge gateway) → acked (written and read back) | failed | refused | blocked (read-only gateway) */
  status: 'queued' | 'sent' | 'acked' | 'failed' | 'refused' | 'blocked'
  gateway_id?: string | null
  readback?: number | string | null
  error?: string | null
  /** no gateway online: the simulator stood in for the controller */
  simulated?: boolean
}

export interface GatewayInfo {
  id: string
  code: string
  online: boolean
  seen_s_ago: number | null
  version: string
  allow_write: boolean
  n_points: number
  rooms_mapped?: number
  unmapped?: number
  controller: { protocol?: string; host?: string; port?: number; device_instance?: number; device_name?: string; vendor?: string }
  device?: { instance?: number; name?: string; address?: string }
  sample?: { point: string; room: string | null; kind: string; unit: string; value: number | string | null }[]
  snapshot_ts?: string | null
}

export interface GatewayStatus {
  gateways: GatewayInfo[]
  live: boolean
}

export type BuildingType = 'school' | 'mall' | 'hotel' | 'office' | 'hospital' | 'etc'

export interface BmsConnection {
  method: 'gateway' | 'direct' | 'file'
  vendor: string
  protocol: 'bacnet' | 'modbus' | 'vendor_api' | 'opcua'
  host: string
  port: number
  gateway_id?: string | null
  connected_at?: string | null
  points?: number
}

export interface BuildingProfile {
  name: string
  org: string
  type: BuildingType
  address: string
  onboarded_at: string | null
  connection: BmsConnection | null
  demo: boolean
}

export interface ProfileParse {
  name: string
  org: string
  type: BuildingType
  address: string
  floors: number | null
  note: string
  clarification: string | null
  ai: boolean
}

export interface ConnectStep {
  key: string
  label: string
  ok: boolean
  detail: string
  ms: number
}

export interface BmsPoint {
  point: string
  room: string | null
  device: string
  kind: 'onoff' | 'mode' | 'setpoint' | 'room_temp' | 'power' | 'co2' | 'occupancy' | 'humidity'
  unit: string
  value: string | number
  writable: boolean
}

export interface ConnectResult {
  ok: boolean
  steps: ConnectStep[]
  points: BmsPoint[]
  summary: { rooms: number; idus: number; odus: number; sensors: number; points: number }
  gateway: { id: string; version: string; latency_ms: number }
  error?: string
  /** 'gateway' = read by a live edge gateway over BACnet, 'simulated' = the simulator answered */
  source?: 'gateway' | 'simulated'
  note?: string
}

export interface OnboardQuestion {
  id: string
  title: string
  why: string
  kind: 'number' | 'time_range' | 'temp_range' | 'choice' | 'confirm'
  unit?: string
  default: unknown
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  step?: number
  source: string
  affects: string
}

export interface CollectResult {
  building: { name: string; campus: string }
  sources: DataSource[]
  counts: {
    courses: number
    rooms: number
    idus: number
    odus: number
    events: number
    holidays: number
    feedback: number
    weather_days: number
    estimated_people: number
  }
  questions: OnboardQuestion[]
}

export interface Policy {
  heat_min: number
  heat_max: number
  cool_min: number
  cool_max: number
  co2_max: number
  weather_jump_c: number
  attendance: number
  orient: Record<string, string>
  /** arbiter: won per PMV unit per room per day */
  comfort_won?: number
}
