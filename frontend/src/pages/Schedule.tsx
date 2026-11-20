import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Sun, AlertTriangle, Timer } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, DaySummary, StrategyKey, Summary } from '../lib/types'
import { STRATEGY, STRATEGY_KEYS, WEEKDAY, decisionLabel, splitCounts } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtPct, fmtWon, isoDate, josa, pctSaving, weekdayOf } from '../lib/format'
import Gantt, { GanttLegend } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle } from '../components/EChart'
import { Badge, Card, Disclosure, ErrorBox, Figure, IconButton, Loading, Note, PageHeader, PageSkeleton, Segmented, StrategyName, ToggleChip, btnCls, inputBase } from '../components/ui'

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
  // optional layers live in the URL too, so a shared link opens the same view
  const showDecisions = params.get('dec') === '1'
  const showPlan = params.get('plan') === '1'
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
    <div>
      <PageHeader title="스케줄·타임라인" desc="날짜를 고르면 그날 강의와 냉난방 운전을 강의실별로 맞춰 봅니다." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
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

      <Card className="mt-6" pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-7 pt-6">
          <h2 className="flex items-center gap-2.5 text-[17px] font-[650] tracking-[-0.01em] text-ink">
            {fmtDateK(date)} 강의실별 운전
            {ds?.holiday && <Badge tone="crit">{ds.holiday}</Badge>}
            {ds && !ds.workday && !ds.holiday && <Badge>주말</Badge>}
          </h2>
          <a href={`/api/export/plan.csv?date=${date}&strategy=${primary}`} className={btnCls('ghost', 'sm')} download>
            <Download size={14} aria-hidden /> 운전 계획 CSV
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-7 pt-4">
          <Segmented
            label="운전 방식"
            value={primary}
            onChange={(v) => set({ s: v === 'ai' ? null : v, o: overlay === v ? null : overlay })}
            options={(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => ({ value: k, label: <StrategyName k={k} short /> }))}
          />
          <label className="sr-only" htmlFor="gantt-overlay">
            겹쳐 비교할 운전 방식
          </label>
          <select
            id="gantt-overlay"
            name="overlay"
            className={cx(inputBase, 'h-9 w-[150px] text-[13.5px]')}
            value={overlay ?? 'none'}
            onChange={(e) => set({ o: e.target.value === 'none' ? null : e.target.value })}
          >
            <option value="none">비교 없음</option>
            {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[])
              .filter((k) => k !== primary)
              .map((k) => (
                <option key={k} value={k}>
                  {STRATEGY[k].short}
                  {josa(STRATEGY[k].short, '과', '와')} 비교
                </option>
              ))}
          </select>
          <span className="mx-1 hidden h-5 w-px bg-line sm:inline-block" aria-hidden />
          <ToggleChip pressed={showPlan} onChange={(v) => set({ plan: v ? '1' : null })} title="운전 계획을 실제 가동 뒤에 옅은 띠로 겹쳐 봅니다">
            계획
          </ToggleChip>
          {primary === 'ai' && (
            <ToggleChip pressed={showDecisions} onChange={(v) => set({ dec: v ? '1' : null })} title="AI가 판단한 시점에 표식을 띄웁니다(마우스를 올리면 근거)">
              <Timer size={14} aria-hidden /> AI 판단
            </ToggleChip>
          )}
        </div>
        <div className="px-7 pt-4 pb-3">
          <GanttLegend primary={primary} overlay={overlay} showPlan={showPlan} showDecisions={showDecisions} />
        </div>
        <div className="px-7 pb-7">
          {day.error ? (
            <ErrorBox error={day.error} onRetry={day.reload} />
          ) : !day.data ? (
            <Loading label="하루 시뮬레이션을 불러오는 중…" />
          ) : (
            <div className={cx('transition-opacity duration-200', day.loading || day.data.date !== date ? 'opacity-50' : '')}>
              {day.data.sessions.length === 0 && (
                <div className="mb-3">
                  <Note icon={<Sun size={15} className="text-ink-3" aria-hidden />}>이 날은 강의가 없어 AI·규칙·수동 운전 모두 가동하지 않습니다. 고정 스케줄만 평일에 켜집니다.</Note>
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
                showDecisions={showDecisions}
                showPlan={showPlan}
              />
            </div>
          )}
        </div>
      </Card>

      <RoomDrawer
        open={!!room}
        onClose={() => set({ room: null })}
        day={day.data?.date === date ? day.data : undefined}
        meta={meta}
        room={room}
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton label="이전 달" disabled={prev < minM} onClick={() => onMonth(prev)}>
            <ChevronLeft size={18} />
          </IconButton>
          <h2 className="tnum w-[112px] text-center text-[17px] font-[650] text-ink">
            {y}년 {m}월
          </h2>
          <IconButton label="다음 달" disabled={next > maxM} onClick={() => onMonth(next)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink-3" aria-label="칸 색: 고정 스케줄 대비 AI 절감률">
          <span>고정 대비 AI 절감</span>
          <span className="tnum">50%</span>
          <span className="flex gap-0.5" aria-hidden>
            {[...SAVE_STEPS].reverse().map((s, i) => (
              <span key={i} className="inline-block h-3 w-4 rounded-[3px] ring-1 ring-line ring-inset" style={{ background: s.bg }} title={s.label} />
            ))}
          </span>
          <span className="tnum">85%</span>
        </div>
      </div>
      {loading && <Loading label="학기 요약을 계산하는 중…" />}
      <div className="grid grid-cols-7 gap-1.5 text-center text-[13px] font-medium text-ink-3">
        {WEEKDAY.map((w, i) => (
          <div key={w} className={cx('pb-1.5', i === 5 && 'text-info-ink', i === 6 && 'text-crit-ink')}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
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
          const { review } = s ? splitCounts(s) : { review: 0 }
          return (
            <button
              key={d}
              type="button"
              disabled={!inSem}
              onClick={() => onSelect(d)}
              aria-pressed={sel}
              aria-label={`${fmtDateK(d)}${hol ? `, ${hol}` : ''}${sv != null ? `, 고정 대비 AI 절감 ${sv.toFixed(0)}%${future ? ' 예상' : ''}` : ''}${!future && review > 0 ? `, 확인 필요 ${review}건` : ''}`}
              className={cx(
                'relative flex h-[60px] flex-col rounded-[10px] px-2 py-1.5 text-left transition-[box-shadow,background-color] duration-150',
                sel ? 'shadow-[0_0_0_2px_var(--color-ink)]' : 'hover:shadow-[0_0_0_1px_var(--color-ink-4)]',
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
              <span className="flex items-center justify-between">
                <span
                  className={cx(
                    'tnum text-[13.5px] font-semibold',
                    hol || wd === 6 ? 'text-crit-ink' : wd === 5 ? 'text-info-ink' : 'text-ink',
                    isT && 'rounded-full bg-ink px-1.5 text-white',
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {!future && review > 0 && <AlertTriangle size={12} color="#d03b3b" strokeWidth={2.6} aria-hidden />}
              </span>
              {hol ? (
                <span className="mt-auto truncate text-[13px] font-medium text-crit-ink">{hol}</span>
              ) : sv != null ? (
                <span className={cx('tnum mt-auto text-[14px] font-semibold', future ? 'text-ink-3' : 'text-ink')}>−{sv.toFixed(0)}%</span>
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-[13px] text-ink-3">
        회색 숫자는 예보로 계산한 예상,{' '}
        <AlertTriangle size={12} color="#d03b3b" strokeWidth={2.6} className="inline align-[-1px]" aria-hidden />
        는 확인이 필요한 강의가 있던 날입니다.
      </p>
    </Card>
  )
}

function DayPanel({ ds, day, date, isFuture }: { ds: DaySummary | undefined; day: Day | undefined; date: string; isFuture: boolean }) {
  const hourOpt = useMemo(() => {
    if (!day) return null
    const hours = Array.from({ length: 17 }, (_, i) => i + 7)
    const keys = STRATEGY_KEYS.filter((k) => day.strategies[k])
    return {
      grid: { left: 40, right: 12, top: 12, bottom: 24 },
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
      yAxis: { type: 'value' as const, ...axisCommon, axisLine: { show: false }, splitNumber: 3 },
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
  const ai = ds.strategies.ai
  const sv = ds.sessions > 0 ? pctSaving(base, ai.kwh) : null
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-[17px] font-[650] tracking-[-0.01em] text-ink">{fmtDateK(date)}</h2>
        {isFuture && <Badge tone="info">예상</Badge>}
      </div>
      <p className="mt-1 text-[13.5px] text-ink-3">
        {ds.sessions > 0 ? `강의 ${ds.sessions}건${ds.events ? `, 이벤트 ${ds.events}건` : ''}` : (ds.holiday ?? (ds.workday ? '강의 없음' : '주말'))}, 외기 {ds.t_min.toFixed(1)}~{ds.t_max.toFixed(1)}℃
      </p>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-5">
        <Figure label="AI 전력" value={fmtKwh(ai.kwh)} unit="kWh" accent={STRATEGY.ai.color} />
        <Figure label="고정 스케줄 대비" value={sv != null ? `−${sv.toFixed(0)}` : '–'} unit={sv != null ? '%' : undefined} />
        <Figure label="강의 중 쾌적" value={ai.comfort_pct != null ? ai.comfort_pct.toFixed(1) : '–'} unit={ai.comfort_pct != null ? '%' : undefined} />
      </div>
      <div className="mt-8">
        <div className="mb-3 text-[14px] font-semibold text-ink">운전 방식별 하루 전력</div>
        <ul className="space-y-3" aria-label="운전 방식별 하루 전력량">
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => {
            const v = ds.strategies[k].kwh
            const max = Math.max(...(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((x) => ds.strategies[x].kwh), 1)
            return (
              <li key={k} className="grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-3 text-[13.5px]">
                <span className={cx(k === 'ai' ? 'font-semibold text-ink' : 'text-ink-2')}>{STRATEGY[k].short}</span>
                <span className="h-2.5 rounded-full bg-[#eef0f3]" aria-hidden>
                  <span className="block h-2.5 rounded-full" style={{ width: `${Math.max(1, (v / max) * 100)}%`, background: STRATEGY[k].color }} />
                </span>
                <span className={cx('tnum text-right', k === 'ai' ? 'font-semibold text-ink' : 'text-ink-2')}>{fmtKwh(v)} kWh</span>
              </li>
            )
          })}
        </ul>
      </div>
      <Disclosure variant="inline" className="mt-auto pt-6" title="요금·쾌적과 시간대별 전력 보기">
        <table className="tnum w-full text-[14px]">
          <thead>
            <tr className="text-[13px] text-ink-3">
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
              const p = pctSaving(base, v.kwh)
              return (
                <tr key={k} className={cx('border-t border-line', k === 'ai' && 'font-semibold')}>
                  <td className="py-2">
                    <StrategyName k={k} />
                  </td>
                  <td className="py-2 text-right">{fmtKwh(v.kwh)} kWh</td>
                  <td className={cx('py-2 text-right', k === 'fixed' ? 'text-ink-3' : '')}>{k === 'fixed' ? '기준' : p != null ? `−${p.toFixed(1)}%` : '–'}</td>
                  <td className="py-2 text-right">{fmtWon(v.cost_krw)}</td>
                  <td className="py-2 text-right">{fmtPct(v.comfort_pct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="mt-5 mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[14px] font-semibold text-ink">시간대별 전력량 (kWh)</span>
          <span className="flex flex-wrap gap-x-3 text-[13px] text-ink-2">
            {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
              <StrategyName key={k} k={k} short line />
            ))}
          </span>
        </div>
        {hourOpt ? <EChart option={hourOpt} height={160} /> : <Loading className="py-6" />}
        {Object.keys(ds.decisions).length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-ink-3">이 날 AI 판단</span>
            {Object.entries(ds.decisions).map(([k, v]) => (
              <Badge key={k} tone="ai">
                {decisionLabel(k)} {v}
              </Badge>
            ))}
          </div>
        )}
        <p className="mt-3 text-[13px] text-ink-3">
          {isFuture ? '미래 날짜는 기상청 단기예보·평년 기온으로 계산한 예상치입니다.' : '실측(또는 예보) 날씨로 하루를 시뮬레이션한 결과입니다.'}
        </p>
      </Disclosure>
    </Card>
  )
}
