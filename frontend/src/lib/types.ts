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
