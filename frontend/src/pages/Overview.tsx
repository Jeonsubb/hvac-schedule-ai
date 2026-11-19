import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RotateCcw, CloudSun, Cloud, CloudRain, CloudSnow, Sun, Droplets, WindIcon, Wrench, History, Info } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, Live, StrategyKey, WeatherNow } from '../lib/types'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { COLD_START, STRATEGY, decisionLabel, statusInfo } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, fmtPct, hm, pctSaving } from '../lib/format'
import { buildingAt, buildingFromLive } from '../lib/thermal'
import BuildingView, { ModeLegend, ThermalRuler, TimeScrubber } from '../components/BuildingView'
import Gantt, { DecisionIcon, GanttLegend, decisionMinute } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'
import { Badge, Button, Card, CardHeader, ErrorBox, LegendItem, Loading, PageSkeleton, Segmented, Skeleton, StatStrip, StatTile, inputBase } from '../components/ui'

export default function Overview() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const [params, setParams] = useSearchParams()
  const at = params.get('at')
  const live = useApi<Live>(at ? `/api/live?at=${encodeURIComponent(at)}` : '/api/live', { maxAgeMs: 30_000, refreshMs: at ? undefined : 60_000 })
  const date = live.data?.now.date
  const day = useApi<Day>(date ? `/api/day/${date}` : null)
  const weather = useApi<WeatherNow>('/api/weather', { maxAgeMs: 10 * 60_000 })
  const [drawerRoom, setDrawerRoom] = useState<string | null>(null)
  const [viewMinute, setViewMinute] = useState<number | null>(null)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const nav = useNavigate()

  // scrubbed minute belongs to one reference date; reset when the date changes
  const key = `${date}|${at ?? ''}`
  if (viewKey !== key) {
    setViewKey(key)
    setViewMinute(null)
  }
  const onScrub = useCallback((m: number) => setViewMinute(m), [])

  if (live.error) return <ErrorBox title="건물 상태를 불러오지 못했습니다" error={live.error} onRetry={live.reload} />
  if (metaError && !meta) return <ErrorBox title="기본 정보를 불러오지 못했습니다" error={metaError} onRetry={reloadMeta} />
  if (!meta || !live.data) return <PageSkeleton label="건물 상태를 불러오는 중…" />

  const L = live.data
  const now = L.now
  const D = day.data?.date === now.date ? day.data : undefined
  const scrubbing = viewMinute != null && viewMinute !== now.minute && !!D
  const shown = scrubbing ? buildingAt(D!, meta, viewMinute!) : buildingFromLive(L, meta, D)
  const minute = scrubbing ? viewMinute! : now.minute
  const outdoorAt = scrubbing && D ? interpHour(D.weather.actual.t, minute) : L.outdoor.t

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">운영 현황</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-2">
            {at ? (
              <>
                <b className="font-semibold text-ink">{fmtDateK(now.date)} {fmtMin(now.minute)}</b> 시점을 재현하고 있습니다. 같은 입력이면 결과도 항상 같습니다.
              </>
            ) : now.live ? (
              'IT관 강의실 10개의 지금 온도와 냉난방, 오늘 AI가 운전한 내용입니다. 1분마다 갱신합니다.'
            ) : (
              <span className="text-warn-ink">{now.reason}</span>
            )}
          </p>
        </div>
        <ReplayControl now={now} at={at} semester={meta.semester} onSet={(v) => setParams(v ? { at: v } : {})} />
      </div>

      {/* hero: the building */}
      <section className="overflow-hidden rounded-[10px] border border-line bg-surface" aria-labelledby="bv-title">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id="bv-title" className="flex flex-wrap items-center gap-2 text-[15px] font-[650] tracking-[-0.01em] text-ink">
              IT관 3·4층 단면
              <span className={cx('tnum rounded-[4px] px-1.5 py-[1px] text-[12.5px] font-semibold', scrubbing ? 'bg-ink text-white' : 'bg-well text-ink-2 ring-1 ring-line ring-inset')}>
                {fmtMin(minute)} {scrubbing ? (minute > now.minute ? '계획' : '기록') : at ? '재현' : '현재'}
              </span>
              {scrubbing && (
                <Button size="sm" variant="ghost" onClick={() => setViewMinute(null)}>
                  <RotateCcw size={12} /> {at ? '기준 시각으로' : '지금으로'}
                </Button>
              )}
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-3">바닥 색은 실내온도, 앞면 색은 운전 모드입니다. 강의실을 누르면 온도·전력·설비 이력을 봅니다.</p>
          </div>
          <ModeLegend state={shown} />
        </div>
        <div className="drafting-grid border-y border-line px-5 py-4">
          <BuildingView meta={meta} state={shown} onRoomClick={setDrawerRoom} selected={drawerRoom} />
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 pt-6 pb-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <div className="mb-1 text-[12.5px] font-semibold text-ink-2">실내온도 분포 (점 하나 = 강의실 하나)</div>
            <ThermalRuler meta={meta} state={shown} outdoor={outdoorAt} />
          </div>
          <div>
            <div className="mb-[26px] text-[12.5px] font-semibold text-ink-2">시간을 옮겨 하루 운전 보기</div>
            {D ? (
              <TimeScrubber day={D} meta={meta} minute={minute} nowMinute={now.minute} onChange={onScrub} refLabel={at ? '기준 시각' : '지금'} />
            ) : day.error ? (
              <ErrorBox error={day.error} onRetry={day.reload} />
            ) : (
              <Skeleton className="h-[38px]" />
            )}
          </div>
        </div>
      </section>

      <TodayStrip L={L} at={!!at} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={at ? `${fmtDateK(now.date)} 강의와 AI 운전` : '오늘 강의와 AI 운전'}
            sub="위 막대는 강의, 아래 막대는 AI가 실제로 켠 시간입니다. 강의실 번호를 누르면 상세를 봅니다."
            right={
              <Button size="sm" onClick={() => nav(`/schedule?date=${now.date}`)}>
                스케줄 화면에서 보기
              </Button>
            }
          />
          <div className="mb-3">
            <GanttLegend primary="ai" compact />
          </div>
          {D ? (
            <>
              <Gantt day={D} meta={meta} primary="ai" compact nowMinute={minute} onRoomClick={setDrawerRoom} selectedRoom={drawerRoom} />
              <HourlyEnergy day={D} nowMinute={now.minute} />
            </>
          ) : day.error ? (
            <ErrorBox error={day.error} onRetry={day.reload} />
          ) : (
            <Loading label="오늘의 운전 기록을 불러오는 중…" />
          )}
        </Card>
        {/* right column takes the timeline's height; the feed scrolls inside it */}
        <div className="relative min-h-[560px]">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0">
            <WeatherCard live={L} weather={weather.data} day={D} replay={!!at} />
            <Feed day={D} nowMinute={now.minute} title={at ? `${fmtDateK(now.date)} AI 판단과 자동 조치` : '오늘 AI 판단과 자동 조치'} onOpen={setDrawerRoom} />
          </div>
        </div>
      </div>

      <RoomDrawer open={!!drawerRoom} onClose={() => setDrawerRoom(null)} day={D} meta={meta} room={drawerRoom} />
    </div>
  )
}

function interpHour(t: number[], minute: number) {
  const h = minute / 60 - 0.5
  const i = Math.max(0, Math.min(t.length - 1, Math.floor(h)))
  const j = Math.min(t.length - 1, i + 1)
  const f = Math.max(0, Math.min(1, h - i))
  return t[i] + (t[j] - t[i]) * f
}

function TodayStrip({ L, at }: { L: Live; at: boolean }) {
  const ds = L.date_summary
  const so = L.kwh_so_far
  const ai = so.ai
  const svFixed = pctSaving(so.fixed, ai)
  // compare whole days (cold starts are per day), not the so-far totals
  const dayDiff = ds.strategies.ai.kwh - ds.strategies.rule.kwh
  const coldRule = ds.strategies.rule.cold_starts
  const coldAi = ds.strategies.ai.cold_starts
  const aiC = ds.strategies.ai.comfort_pct
  const ruleC = ds.strategies.rule.comfort_pct
  const when = at ? '이 시각까지' : '지금까지'
  return (
    <StatStrip>
      <StatTile label={`${when} AI 사용 전력`} accent={STRATEGY.ai.color} value={fmtKwh(ai)} unit="kWh" sub={`하루 전체 예상 ${fmtKwh(ds.strategies.ai.kwh)} kWh`} />
      <StatTile
        label="고정 스케줄 대비 절감"
        value={svFixed != null ? svFixed.toFixed(1) : '–'}
        unit="%"
        sub={`고정 스케줄이었다면 ${fmtKwh(so.fixed)} kWh (−${fmtKwh(so.fixed - ai)})`}
      />
      <StatTile
        label="규칙 기반(10분 전) 대비, 하루"
        value={`${dayDiff > 0 ? '+' : dayDiff < 0 ? '−' : ''}${fmtKwh(Math.abs(dayDiff))}`}
        unit="kWh"
        sub={
          ds.sessions > 0 && coldRule != null && coldAi != null ? (
            <span title={COLD_START.desc}>
              {COLD_START.label}: 규칙 <b className="font-semibold text-ink-2">{coldRule}/{ds.sessions}</b>, AI <b className="font-semibold text-ink">{coldAi}/{ds.sessions}</b>
              {dayDiff > 0 && coldAi < coldRule ? <span className="block">더 쓴 전력은 수업 전에 미리 데운 몫입니다</span> : null}
            </span>
          ) : (
            `규칙 기반 하루 ${fmtKwh(ds.strategies.rule.kwh)} kWh`
          )
        }
      />
      <StatTile label="강의 중 쾌적 유지율" value={aiC != null ? aiC.toFixed(1) : '–'} unit="%" sub={`규칙 ${fmtPct(ruleC)}, 수동 ${fmtPct(ds.strategies.manual.comfort_pct)}`} />
      <StatTile label="계획·실행 정합성" value={ds.match_rate != null ? ds.match_rate.toFixed(1) : '–'} unit="%" sub={`강의 ${ds.sessions}건, 계획 반영 ${fmtPct(ds.plan_coverage, 0)}`} />
    </StatStrip>
  )
}

function ReplayControl({ now, at, semester, onSet }: { now: Live['now']; at: string | null; semester: { start: string; end: string }; onSet: (v: string | null) => void }) {
  const [val, setVal] = useState(at ?? `${now.date}T${fmtMin(now.minute)}`)
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (val) onSet(val)
      }}
    >
      <label className="text-[12.5px] font-medium text-ink-2" htmlFor="replay-at">
        다른 시점 재현
      </label>
      <input
        id="replay-at"
        type="datetime-local"
        className={cx(inputBase, 'tnum w-[196px]')}
        value={val}
        min={`${semester.start}T00:00`}
        max={`${semester.end}T23:55`}
        step={300}
        onChange={(e) => setVal(e.target.value)}
      />
      <Button type="submit">보기</Button>
      {at && (
        <Button
          variant="ghost"
          onClick={() => {
            onSet(null)
            setVal('')
          }}
        >
          <RotateCcw size={13} /> 실시간으로
        </Button>
      )}
    </form>
  )
}

function HourlyEnergy({ day, nowMinute }: { day: Day; nowMinute: number }) {
  const keys: StrategyKey[] = ['fixed', 'rule', 'ai']
  const hours = Array.from({ length: 17 }, (_, i) => i + 7)
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 36, right: 12, top: 10, bottom: 22 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; axisValue: string }[]
          let h = ttTitle(`${arr[0]?.axisValue}시대${Number(arr[0]?.axisValue) * 60 > nowMinute ? ' (계획)' : ''}`)
          for (const p of arr) h += ttRow(p.color, p.seriesName, `${p.value.toFixed(2)} kWh`)
          return h
        },
      },
      xAxis: { type: 'category', data: hours.map(String), ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => `${v}시` } },
      yAxis: { type: 'value', ...axisCommon, axisLine: { show: false }, splitNumber: 3 },
      series: keys.map((k) => ({
        name: STRATEGY[k].label,
        type: 'line',
        step: 'middle',
        showSymbol: false,
        lineStyle: { width: 2, color: STRATEGY[k].color },
        itemStyle: { color: STRATEGY[k].color },
        areaStyle: k === 'ai' ? { color: 'rgba(20,166,115,0.10)' } : undefined,
        z: k === 'ai' ? 5 : 2,
        data: hours.map((h) => day.strategies[k]?.kwh_by_hour[h] ?? 0),
        ...(k === 'fixed'
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#142033', width: 1, type: 'solid' },
                label: { show: false },
                data: [{ xAxis: String(Math.min(23, Math.max(7, Math.floor(nowMinute / 60)))) }],
              },
            }
          : {}),
      })) as never,
    }),
    [day, nowMinute],
  )
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">시간대별 전력량 (kWh)</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-2">
          {(['ai', 'rule', 'fixed'] as StrategyKey[]).map((k) => (
            <LegendItem key={k} color={STRATEGY[k].color} label={STRATEGY[k].label} kind="line" />
          ))}
          <LegendItem color="#142033" label="현재 시각" kind="line" />
        </span>
      </div>
      <EChart option={option} height={150} />
    </div>
  )
}

function skyIcon(sky: number, pty: number, size = 18) {
  if (pty === 1 || pty === 4 || pty === 5) return <CloudRain size={size} className="text-cool" aria-hidden />
  if (pty === 2 || pty === 3 || pty === 6 || pty === 7) return <CloudSnow size={size} className="text-cool" aria-hidden />
  if (sky === 1) return <Sun size={size} className="text-[#d98a00]" aria-hidden />
  if (sky === 3) return <CloudSun size={size} className="text-ink-3" aria-hidden />
  return <Cloud size={size} className="text-ink-3" aria-hidden />
}

function skyLabel(sky: number, pty: number) {
  if (pty === 1) return '비'
  if (pty === 2) return '비/눈'
  if (pty === 3) return '눈'
  if (pty === 4) return '소나기'
  if (sky === 1) return '맑음'
  if (sky === 3) return '구름많음'
  return '흐림'
}

function WeatherCard({ live, weather, day, replay }: { live: Live; weather: WeatherNow | undefined; day: Day | undefined; replay: boolean }) {
  const now = live.now
  const h0 = Math.floor(now.minute / 60)
  const key = `${now.date}T${String(h0).padStart(2, '0')}`
  const kma = weather?.kma_hourly ?? {}
  const kmaKeys = Object.keys(kma).sort()
  const kmaCovers = kmaKeys.some((k) => k.startsWith(now.date))
  // KMA short-term forecast only covers the coming days; for other reference dates use that day's simulation weather.
  const hourly: Record<string, { t: number; rh: number; sky: number; pty: number; pop: number }> = kmaCovers
    ? kma
    : Object.fromEntries(
        (day?.weather.actual.t ?? []).map((t, h) => [
          `${now.date}T${String(h).padStart(2, '0')}`,
          { t, rh: day!.weather.actual.rh[h], sky: (day!.weather.actual.ghi[h] ?? 0) > 250 ? 1 : 3, pty: 0, pop: 0 },
        ]),
      )
  const keys = Object.keys(hourly).sort()
  const upcoming = keys.filter((k) => k >= key).slice(0, 8)
  const cur = hourly[keys.find((k) => k >= key) ?? '']
  const nc = replay ? null : weather?.nowcast
  const src = kmaCovers
    ? `기상청 단기예보${weather?.kma_base ? ` ${weather.kma_base.slice(4, 6)}/${weather.kma_base.slice(6, 8)} ${weather.kma_base.slice(8, 10)}시 발표` : ''}`
    : `${day?.weather.src_actual ?? 'Open-Meteo'} 시간별 기온`
  const temps = upcoming.map((k) => hourly[k].t)
  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  return (
    <Card pad="dense" className="shrink-0">
      <CardHeader className="mb-3" title={replay ? `재현 시각 외기 (${fmtDateK(now.date, false)} ${fmtMin(now.minute)})` : '지금 외기'} sub={src} />
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {cur ? skyIcon(cur.sky, cur.pty, 30) : <CloudSun size={30} className="text-ink-3" aria-hidden />}
          <div>
            <div className="pnum text-[32px] leading-none font-[650] tracking-[-0.03em] text-ink">
              {live.outdoor.t.toFixed(1)}
              <span className="ml-0.5 text-[16px] font-medium text-ink-3">℃</span>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-3">
              {live.outdoor.src}, {fmtMin(now.minute)}
            </div>
          </div>
        </div>
        <div className="space-y-0.5 text-right text-[12.5px] text-ink-2">
          <div className="flex items-center justify-end gap-1">
            <Droplets size={13} className="text-ink-3" aria-hidden /> 습도 {Math.round(live.outdoor.rh)}%
          </div>
          {cur && (
            <div>
              {skyLabel(cur.sky, cur.pty)}
              {kmaCovers ? `, 강수 ${cur.pop}%` : ''}
            </div>
          )}
        </div>
      </div>
      {nc && (
        <div className="mt-4 rounded-[6px] bg-well px-3 py-2 text-[12px] text-ink-2 ring-1 ring-line ring-inset">
          <div className="font-semibold text-ink">기상청 초단기실황</div>
          <div className="tnum mt-0.5">
            {nc.t.toFixed(1)}℃, 습도 {Math.round(nc.rh)}%, <WindIcon size={11} className="inline" aria-hidden /> {nc.wind}m/s ({nc.time.slice(5, 10).replace('-', '/')} {nc.time.slice(11, 13)}시 관측)
          </div>
        </div>
      )}
      {upcoming.length > 0 ? (
        <div className="mt-4">
          <div className="grid" style={{ gridTemplateColumns: `repeat(${upcoming.length}, minmax(0, 1fr))` }}>
            {upcoming.map((k) => {
              const h = hourly[k]
              return (
                <div key={k} className="flex flex-col items-center text-center" title={`${skyLabel(h.sky, h.pty)}, 습도 ${h.rh}%${kmaCovers ? `, 강수확률 ${h.pop}%` : ''}`}>
                  <span className="tnum text-[11px] text-ink-3">{k.slice(11, 13)}시</span>
                  <span className="my-1">{skyIcon(h.sky, h.pty, 15)}</span>
                  <span className="tnum text-[12.5px] font-semibold text-ink">{Math.round(h.t)}°</span>
                </div>
              )
            })}
          </div>
          <svg className="mt-1.5 block h-[22px] w-full" viewBox={`0 0 ${upcoming.length * 10} 22`} preserveAspectRatio="none" aria-hidden>
            <polyline
              fill="none"
              stroke="#8a94a3"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={upcoming.map((k, i) => `${i * 10 + 5},${19 - (tMax > tMin ? (hourly[k].t - tMin) / (tMax - tMin) : 0.5) * 16}`).join(' ')}
            />
          </svg>
        </div>
      ) : weather ? (
        <p className="mt-4 text-[12.5px] text-ink-3">이 시각 이후의 시간별 예보가 없습니다.</p>
      ) : (
        <Skeleton className="mt-4 h-[80px]" />
      )}
    </Card>
  )
}

type FeedItem = {
  minute: number
  kind: 'decision' | 'auto' | 'history'
  room: string
  title: string
  detail: string
  type?: string
}

function Feed({ day, nowMinute, title, onOpen }: { day: Day | undefined; nowMinute: number; title: string; onOpen: (r: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'decision' | 'auto'>('all')
  const items = useMemo<FeedItem[]>(() => {
    if (!day) return []
    const out: FeedItem[] = []
    const plan = day.strategies.ai?.plan ?? {}
    for (const d of day.decisions) {
      out.push({ minute: decisionMinute(d, plan[d.room]), kind: 'decision', room: d.room, title: `${decisionLabel(d.type)}, ${d.title}`, detail: d.detail, type: d.type })
    }
    for (const v of day.validation.sessions) {
      const info = statusInfo(v.status)
      if (info.group !== 'auto') continue
      out.push({ minute: hm(v.start), kind: 'auto', room: v.room, title: `${info.label}, ${v.title}`, detail: v.notes.join(' / ') })
    }
    for (const h of day.history) {
      if (!h.room) continue
      if (!/자동|감지|수동|재전송|보정/.test(h.cause)) continue
      out.push({ minute: h.minute, kind: 'history', room: h.room, title: `${h.device} ${h.state === 'ON' ? '켬' : '끔'}`, detail: h.cause })
    }
    return out.sort((a, b) => a.minute - b.minute)
  }, [day])

  const shown = items.filter((i) => filter === 'all' || (filter === 'decision' ? i.kind === 'decision' : i.kind !== 'decision'))
  const nDec = items.filter((i) => i.kind === 'decision').length
  const nAuto = items.length - nDec

  return (
    <Card className="flex min-h-[360px] flex-1 flex-col" pad="dense">
      <CardHeader className="mb-3" title={title} sub="무엇을 왜 했는지 시간순으로 보여 줍니다." />
      <div className="mb-2">
        <Segmented
          size="sm"
          label="항목 종류"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `전체 ${items.length}` },
            { value: 'decision', label: `AI 판단 ${nDec}` },
            { value: 'auto', label: `자동 조치 ${nAuto}` },
          ]}
        />
      </div>
      {!day ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[6px] bg-well px-3 py-3 text-[13px] text-ink-2 ring-1 ring-line ring-inset">
          <Info size={14} className="text-ink-3" aria-hidden />
          {filter === 'auto' ? '오늘은 사람이 개입하거나 시스템이 바로잡은 이상 상황이 없었습니다.' : '이 날은 강의가 없어 AI가 판단할 일이 없었습니다.'}
        </div>
      ) : (
        <ol className="thin-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {shown.map((it, i) => {
            const future = it.minute > nowMinute
            return (
              <li key={i} className="border-b border-line last:border-b-0">
                <button className="flex w-full gap-2.5 rounded-[6px] py-2.5 text-left hover:bg-well" onClick={() => onOpen(it.room)}>
                  <span className={cx('tnum w-11 shrink-0 pt-0.5 text-[12.5px] font-semibold', future ? 'text-ink-3' : 'text-ink')}>{fmtMin(it.minute)}</span>
                  <span
                    className={cx(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      it.kind === 'decision' ? (future ? 'bg-well text-ink-2 ring-1 ring-line-strong ring-inset' : 'bg-ink text-white') : 'bg-warn-bg text-[#c98500]',
                    )}
                    aria-hidden
                  >
                    {it.kind === 'decision' ? <DecisionIcon type={it.type ?? ''} size={12} /> : it.kind === 'auto' ? <Wrench size={12} strokeWidth={2.4} /> : <History size={12} strokeWidth={2.4} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <span className="tnum shrink-0 rounded-[4px] bg-well px-1 text-[11.5px] font-semibold whitespace-nowrap text-ink-2 ring-1 ring-line ring-inset">{it.room}</span>
                      <span className="truncate">{it.title}</span>
                      {future && <Badge tone="outline" className="shrink-0">예정</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-2">{it.detail}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

