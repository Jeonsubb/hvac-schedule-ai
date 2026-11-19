import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Sun, AlertTriangle, Wrench } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, DaySummary, StrategyKey, Summary } from '../lib/types'
import { STRATEGY, STRATEGY_KEYS, WEEKDAY, splitCounts } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtPct, fmtWon, isoDate, pctSaving, weekdayOf } from '../lib/format'
import Gantt, { GanttLegend } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle } from '../components/EChart'
import { Badge, Card, CardHeader, ErrorBox, Facts, Loading, PageHeader, PageSkeleton, Segmented, StrategyName, btnCls } from '../components/ui'

// sequential, one hue (AI): darker = larger saving vs fixed schedule
const SAVE_STEPS = [
  { min: 85, bg: 'rgba(20,166,115,0.42)', label: '85% 이상' },
  { min: 75, bg: 'rgba(20,166,115,0.28)', label: '75–85%' },
  { min: 65, bg: 'rgba(20,166,115,0.17)', label: '65–75%' },
  { min: 50, bg: 'rgba(20,166,115,0.09)', label: '50–65%' },
  { min: -999, bg: 'rgba(20,166,115,0.03)', label: '50% 미만' },
]

function saveBg(p: number | null) {
  if (p == null) return undefined
  return SAVE_STEPS.find((s) => p >= s.min)!.bg
}

export default function Schedule() {
  const { meta } = useMeta()
  const [params, setParams] = useSearchParams()
  const summary = useApi<Summary>('/api/summary')
  const today = meta?.now.date ?? summary.data?.today ?? '2026-11-20'
  const date = params.get('date') ?? today
  const primary = (params.get('s') as StrategyKey) || 'ai'
  const overlay = (params.get('o') as StrategyKey | null) || null
  const room = params.get('room')
  const month = params.get('m') ?? date.slice(0, 7)
  const day = useApi<Day>(`/api/day/${date}`)

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') p.delete(k)
      else p.set(k, v)
    }
    setParams(p, { replace: true })
  }

  const byDate = useMemo(() => {
    const m: Record<string, DaySummary> = {}
    for (const d of summary.data?.days ?? []) m[d.date] = d
    return m
  }, [summary.data])

  if (!meta) return <PageSkeleton label="스케줄을 불러오는 중…" />
  const ds = byDate[date]
  const isToday = date === meta.now.date

  return (
    <div className="space-y-4">
      <PageHeader
        title="스케줄·타임라인"
        desc="강의 시간표와 냉난방 운전을 날짜별로 맞춰 봅니다. 달력에서 날짜를 고르면 아래에 10개 강의실의 강의, 운전 계획, 실제 가동이 한 화면에 나옵니다."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <MonthCalendar
          month={month}
          onMonth={(m) => set({ m })}
          selected={date}
          onSelect={(d) => set({ date: d, m: d.slice(0, 7), room: null })}
          byDate={byDate}
          today={summary.data?.today ?? today}
          semester={meta.semester}
          holidays={meta.holidays}
          loading={summary.loading && !summary.data}
        />
        <DayPanel ds={ds} day={day.data?.date === date ? day.data : undefined} date={date} isFuture={date > (summary.data?.today ?? today)} />
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              {fmtDateK(date)} 강의실별 운전 타임라인
              {ds?.holiday && <Badge tone="crit">{ds.holiday}</Badge>}
              {ds && !ds.workday && !ds.holiday && <Badge>주말</Badge>}
            </span>
          }
          sub="행마다 위는 강의, 아래 옅은 띠는 운전 계획, 진한 막대는 실제 가동입니다. 강의실 번호를 누르면 온도·전력 상세를 봅니다."
          right={
            <a href={`/api/export/plan.csv?date=${date}&strategy=${primary}`} className={btnCls('secondary')} download>
              <Download size={14} /> 운전 계획 CSV
            </a>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
            운전 방식
            <Segmented
              label="운전 방식"
              value={primary}
              onChange={(v) => set({ s: v === 'ai' ? null : v, o: overlay === v ? null : overlay })}
              options={(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => ({ value: k, label: <StrategyName k={k} short /> }))}
            />
          </div>
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
            겹쳐 비교
            <Segmented
              label="겹쳐 비교할 운전 방식"
              value={(overlay ?? 'none') as string}
              onChange={(v) => set({ o: v === 'none' ? null : v })}
              options={[
                { value: 'none', label: '없음' },
                ...(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[])
                  .filter((k) => k !== primary)
                  .map((k) => ({ value: k as string, label: <StrategyName k={k} short line /> })),
              ]}
            />
          </div>
        </div>
        <div className="mb-3 border-b border-line pb-3">
          <GanttLegend primary={primary} overlay={overlay} />
        </div>
        {day.error ? (
          <ErrorBox error={day.error} onRetry={day.reload} />
        ) : !day.data ? (
          <Loading label="하루 시뮬레이션을 불러오는 중…" />
        ) : (
          <div className={cx('transition-opacity', day.loading || day.data.date !== date ? 'opacity-50' : '')}>
            {day.data.sessions.length === 0 && (
              <div className="mb-3 flex items-center gap-2 rounded-[6px] bg-well px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-line ring-inset">
                <Sun size={14} className="text-ink-3" /> 이 날은 강의가 없어 AI·규칙·수동 운전 모두 가동하지 않습니다. 고정 스케줄만 평일에 켜집니다.
              </div>
            )}
            <Gantt
              day={day.data}
              meta={meta}
              primary={primary}
              overlay={overlay}
              nowMinute={isToday ? meta.now.minute : null}
              onRoomClick={(r) => set({ room: r })}
              selectedRoom={room}
            />
          </div>
        )}
      </Card>

      <RoomDrawer
        open={!!room}
        onClose={() => set({ room: null })}
        day={day.data?.date === date ? day.data : undefined}
        meta={meta}
        room={room}
        initial={overlay ? [primary, overlay] : primary === 'ai' ? ['ai', 'rule'] : [primary, 'ai']}
      />
    </div>
  )
}

function MonthCalendar({
  month,
  onMonth,
  selected,
  onSelect,
  byDate,
  today,
  semester,
  holidays,
  loading,
}: {
  month: string
  onMonth: (m: string) => void
  selected: string
  onSelect: (d: string) => void
  byDate: Record<string, DaySummary>
  today: string
  semester: { start: string; end: string }
  holidays: Record<string, string>
  loading: boolean
}) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysIn; d++) cells.push(isoDate(new Date(y, m - 1, d)))
  while (cells.length % 7) cells.push(null)

  const minM = semester.start.slice(0, 7)
  const maxM = semester.end.slice(0, 7)
  const prev = isoDate(new Date(y, m - 2, 1)).slice(0, 7)
  const next = isoDate(new Date(y, m, 1)).slice(0, 7)

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1">
            <button
              className="rounded-[6px] p-1 text-ink-2 hover:bg-hover disabled:opacity-30"
              disabled={prev < minM}
              onClick={() => onMonth(prev)}
              aria-label="이전 달"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="tnum w-[104px] text-center">
              {y}년 {m}월
            </span>
            <button
              className="rounded-[6px] p-1 text-ink-2 hover:bg-hover disabled:opacity-30"
              disabled={next > maxM}
              onClick={() => onMonth(next)}
              aria-label="다음 달"
            >
              <ChevronRight size={17} />
            </button>
          </span>
        }
        right={
          <div className="flex items-center gap-1.5 text-[12px] text-ink-3" aria-label="칸 색: 고정 스케줄 대비 AI 절감률">
            고정 대비 AI 절감
            <span className="tnum">50%</span>
            {[...SAVE_STEPS].reverse().map((s, i) => (
              <span key={i} className="inline-block h-3 w-4 rounded-[3px] ring-1 ring-line ring-inset" style={{ background: s.bg }} title={s.label} />
            ))}
            <span className="tnum">85%</span>
          </div>
        }
      />
      {loading && <Loading label="학기 요약을 계산하는 중…" />}
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-medium text-ink-3">
        {WEEKDAY.map((w, i) => (
          <div key={w} className={cx('pb-1', i === 5 && 'text-info-ink', i === 6 && 'text-crit-ink')}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const s = byDate[d]
          const inSem = d >= semester.start && d <= semester.end
          const hol = holidays[d]
          const wd = weekdayOf(d)
          const sv = s && s.sessions > 0 ? pctSaving(s.strategies.fixed.kwh, s.strategies.ai.kwh) : null
          const sel = d === selected
          const isT = d === today
          const future = d > today
          const { review, auto } = s ? splitCounts(s) : { review: 0, auto: 0 }
          return (
            <button
              key={d}
              disabled={!inSem}
              onClick={() => onSelect(d)}
              className={cx(
                'relative flex h-[68px] flex-col rounded-[6px] border px-1.5 py-1 text-left transition-colors',
                sel ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-ink-4',
                !inSem && 'cursor-default opacity-35',
                wd >= 5 && 'bg-well',
              )}
              style={{ background: sv != null ? saveBg(sv) : undefined }}
              title={
                s
                  ? `${fmtDateK(d)}${hol ? `, ${hol}` : ''}\n강의 ${s.sessions}건${s.events ? ` (이벤트 ${s.events})` : ''}\nAI ${fmtKwh(s.strategies.ai.kwh)} kWh, 고정 ${fmtKwh(s.strategies.fixed.kwh)} kWh${sv != null ? ` (−${sv.toFixed(0)}%)` : ''}\n정합성 ${fmtPct(s.match_rate)}${future ? '\n(예보·평년 기반 예상)' : ''}`
                  : fmtDateK(d)
              }
            >
              <div className="flex items-center justify-between">
                <span
                  className={cx(
                    'tnum text-[12.5px] font-semibold',
                    hol || wd === 6 ? 'text-crit-ink' : wd === 5 ? 'text-info-ink' : 'text-ink',
                    isT && 'rounded-full bg-ink px-1.5 text-white',
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {future && inSem && s && s.sessions > 0 && <span className="text-[11px] text-ink-3">예상</span>}
                {!future && (review > 0 || auto > 0) && (
                  <span className="flex items-center gap-0.5">
                    {review > 0 && <AlertTriangle size={10} color="#d03b3b" strokeWidth={2.6} />}
                    {auto > 0 && review === 0 && <Wrench size={10} color="#c98500" strokeWidth={2.6} />}
                  </span>
                )}
              </div>
              {hol ? (
                <span className="mt-0.5 truncate text-[11px] font-medium text-crit-ink">{hol}</span>
              ) : s && s.sessions > 0 ? (
                <>
                  <span className="mt-auto text-[11px] text-ink-2">강의 {s.sessions}</span>
                  <span className="tnum text-[12px] font-semibold text-ink">{sv != null ? `−${sv.toFixed(0)}%` : ''}</span>
                </>
              ) : null}
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function DayPanel({ ds, day, date, isFuture }: { ds: DaySummary | undefined; day: Day | undefined; date: string; isFuture: boolean }) {
  const hourOpt = useMemo(() => {
    if (!day) return null
    const hours = Array.from({ length: 17 }, (_, i) => i + 7)
    const keys = STRATEGY_KEYS.filter((k) => day.strategies[k])
    return {
      grid: { left: 36, right: 12, top: 10, bottom: 24 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis' as const,
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; axisValue: string }[]
          let h = ttTitle(`${arr[0]?.axisValue}시대 전력량`)
          for (const p of arr) h += ttRow(p.color, p.seriesName, `${p.value.toFixed(2)} kWh`)
          return h
        },
      },
      xAxis: { type: 'category' as const, data: hours.map(String), ...axisCommon, axisLabel: { ...axisCommon.axisLabel, interval: 1 } },
      yAxis: { type: 'value' as const, ...axisCommon, axisLine: { show: false } },
      series: keys.map((k) => ({
        name: STRATEGY[k].label,
        type: 'line' as const,
        showSymbol: false,
        step: 'middle' as const,
        lineStyle: { width: 2, color: STRATEGY[k].color },
        itemStyle: { color: STRATEGY[k].color },
        data: hours.map((h) => day.strategies[k]!.kwh_by_hour[h]),
        z: k === 'ai' ? 5 : 2,
      })),
    }
  }, [day])

  if (!ds) return <Card>{<Loading label="일자 요약을 계산하는 중…" />}</Card>
  const base = ds.strategies.fixed.kwh
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {fmtDateK(date)}
            {isFuture && <Badge tone="info">예상</Badge>}
          </span>
        }
        sub={
          ds.sessions > 0
            ? <Facts>{`강의 ${ds.sessions}건${ds.events ? `, 이벤트 ${ds.events}건` : ''}`}{`외기 ${ds.t_min.toFixed(1)}~${ds.t_max.toFixed(1)}℃`}{`정합성 ${fmtPct(ds.match_rate)}`}</Facts>
            : <Facts>{ds.holiday ?? (ds.workday ? '강의 없음' : '주말')}{`외기 ${ds.t_min.toFixed(1)}~${ds.t_max.toFixed(1)}℃`}</Facts>
        }
      />
      <table className="tnum w-full text-[13px]">
        <thead>
          <tr className="text-[12px] text-ink-3">
            <th className="pb-2 text-left font-medium">운전 방식</th>
            <th className="pb-2 text-right font-medium">전력량</th>
            <th className="pb-2 text-right font-medium">고정 대비</th>
            <th className="pb-2 text-right font-medium">요금</th>
            <th className="pb-2 text-right font-medium">쾌적</th>
          </tr>
        </thead>
        <tbody>
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => {
            const v = ds.strategies[k]
            const sv = pctSaving(base, v.kwh)
            return (
              <tr key={k} className={cx('border-t border-line', k === 'ai' && 'font-semibold')}>
                <td className="py-2">
                  <StrategyName k={k} />
                </td>
                <td className="py-2 text-right">{fmtKwh(v.kwh)} kWh</td>
                <td className={cx('py-2 text-right', k === 'fixed' ? 'text-ink-3' : '')}>{k === 'fixed' ? '기준' : sv != null ? `−${sv.toFixed(1)}%` : '–'}</td>
                <td className="py-2 text-right">{fmtWon(v.cost_krw)}</td>
                <td className="py-2 text-right">{fmtPct(v.comfort_pct)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">시간대별 전력량 (kWh)</span>
        <span className="flex flex-wrap gap-x-3 text-[12px] text-ink-2">
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
            <StrategyName key={k} k={k} short line />
          ))}
        </span>
      </div>
      {hourOpt ? <EChart option={hourOpt} height={150} /> : <Loading className="py-6" />}
      {Object.keys(ds.decisions).length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-ink-3">이 날 AI 판단</span>
          {Object.entries(ds.decisions).map(([k, v]) => (
            <Badge key={k} tone="ai">
              {({ optimal_start: '최적 기동', late_start: '지연 기동', skip: '가동 생략', economizer: '외기 냉방', early_stop: '관성 정지', bridge: '공백 유지' } as Record<string, string>)[k] ?? k} {v}
            </Badge>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] text-ink-3">
        {isFuture ? '미래 날짜는 기상청 단기예보·평년 기온으로 계산한 예상치입니다.' : '실측(또는 예보) 날씨로 하루를 시뮬레이션한 결과입니다.'}
      </p>
    </Card>
  )
}
