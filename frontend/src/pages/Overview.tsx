import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Clock,
  RotateCcw,
  Zap,
  Leaf,
  Smile,
  ShieldCheck,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Droplets,
  WindIcon,
  Wrench,
  Sparkles,
  ArrowRight,
  Power,
  Info,
} from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, Live, StrategyKey, WeatherNow } from '../lib/types'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { STRATEGY, decisionLabel, statusInfo } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, fmtPct, hm, pctSaving } from '../lib/format'
import FloorPlan from '../components/FloorPlan'
import Gantt, { DecisionIcon, GanttLegend, decisionMinute } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'
import { Badge, Button, Card, CardHeader, ErrorBox, LegendItem, Loading, Segmented, StatTile, inputBase } from '../components/ui'

export default function Overview() {
  const { meta } = useMeta()
  const [params, setParams] = useSearchParams()
  const at = params.get('at')
  const live = useApi<Live>(at ? `/api/live?at=${encodeURIComponent(at)}` : '/api/live', { maxAgeMs: 30_000, refreshMs: at ? undefined : 60_000 })
  const date = live.data?.now.date
  const day = useApi<Day>(date ? `/api/day/${date}` : null)
  const weather = useApi<WeatherNow>('/api/weather', { maxAgeMs: 10 * 60_000 })
  const [drawerRoom, setDrawerRoom] = useState<string | null>(null)
  const nav = useNavigate()

  if (live.error) return <ErrorBox error={live.error} onRetry={live.reload} />
  if (!meta || !live.data) return <Loading label="건물 상태를 불러오는 중…" />

  const L = live.data
  const now = L.now
  const ds = L.date_summary
  const so = L.kwh_so_far
  const ai = so.ai
  const svFixed = pctSaving(so.fixed, ai)
  const diffRule = ai - so.rule
  const counts = { ON: 0, FAN: 0, OFF: 0 }
  L.rooms.forEach((r) => counts[r.state]++)
  const inSession = L.rooms.filter((r) => r.session).length

  return (
    <div className="space-y-5">
      <TimeBanner
        now={now}
        at={at}
        onSet={(v) => setParams(v ? { at: v } : {})}
        semester={meta.semester}
        loading={live.loading}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="AI 사용 전력 (지금까지)"
          accent={STRATEGY.ai.color}
          value={fmtKwh(ai)}
          unit="kWh"
          sub={`하루 예상 ${fmtKwh(ds.strategies.ai.kwh)} kWh`}
        />
        <StatTile
          label="고정 스케줄 대비 절감"
          icon={<Leaf size={13} className="text-ink-3" />}
          value={svFixed != null ? svFixed.toFixed(1) : '–'}
          unit="%"
          delta={`−${fmtKwh(so.fixed - ai)} kWh`}
          deltaGood={so.fixed - ai >= 0}
          sub={`고정 ${fmtKwh(so.fixed)} kWh`}
        />
        <StatTile
          label="규칙 기반 대비"
          icon={<Zap size={13} className="text-ink-3" />}
          value={`${diffRule > 0 ? '+' : diffRule < 0 ? '−' : ''}${fmtKwh(Math.abs(diffRule))}`}
          unit="kWh"
          delta={
            so.rule
              ? `${diffRule > 0 ? '+' : '−'}${Math.abs((diffRule / so.rule) * 100).toFixed(1)}%`
              : undefined
          }
          deltaGood={
            diffRule <= 0
              ? true
              : (ds.strategies.ai.comfort_pct ?? 0) > (ds.strategies.rule.comfort_pct ?? 0)
                ? null // spent on comfort the rule could not deliver: neutral, not a loss
                : false
          }
          sub={
            diffRule > 0
              ? `쾌적 확보 비용 · 규칙은 쾌적 ${fmtPct(ds.strategies.rule.comfort_pct)} (AI ${fmtPct(ds.strategies.ai.comfort_pct)})`
              : `규칙 ${fmtKwh(so.rule)} kWh`
          }
        />
        <StatTile
          label="쾌적 유지율 (오늘)"
          icon={<Smile size={13} className="text-ink-3" />}
          value={ds.strategies.ai.comfort_pct != null ? ds.strategies.ai.comfort_pct.toFixed(1) : '–'}
          unit="%"
          sub={`규칙 ${fmtPct(ds.strategies.rule.comfort_pct)} · 수동 ${fmtPct(ds.strategies.manual.comfort_pct)}`}
        />
        <StatTile
          label="정합성 (계획·실행 일치)"
          icon={<ShieldCheck size={13} className="text-ink-3" />}
          value={ds.match_rate != null ? ds.match_rate.toFixed(1) : '–'}
          unit="%"
          sub={`강의 ${ds.sessions}건 · 계획 반영 ${fmtPct(ds.plan_coverage, 0)}`}
        />
      </div>

      {/* floor plan */}
      <Card>
        <CardHeader
          title="IT관 실시간 평면도"
          sub={`${fmtDateK(now.date)} ${fmtMin(now.minute)} 기준 · 강의실을 누르면 온도·전력·이력을 봅니다`}
          right={
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-4 rounded-[3px] border-[1.5px] border-s-ai bg-[#e2f5ed]" />
                가동 <b className="text-ink">{counts.ON}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-4 rounded-[3px] border-[1.5px] border-[#86d3b6] bg-[#f1faf6]" />
                송풍 <b className="text-ink">{counts.FAN}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-4 rounded-[3px] border border-[#d6d5ce] bg-white" />
                정지 <b className="text-ink">{counts.OFF}</b>
              </span>
              <span className="text-[#c3c2b7]">|</span>
              <span>
                강의 중 <b className="text-ink">{inSession}</b>실
              </span>
            </div>
          }
        />
        <FloorPlan live={L} meta={meta} onRoomClick={setDrawerRoom} selected={drawerRoom} />
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={at ? `${fmtDateK(now.date)} 강의 · AI 운전 타임라인` : '오늘의 강의 · AI 운전 타임라인'}
            sub="강의 시간과 실제 냉난방 가동을 한눈에 비교 · 행을 누르면 상세"
            right={
              <Button size="sm" onClick={() => nav(`/schedule?date=${now.date}`)}>
                전체 보기 <ArrowRight size={13} />
              </Button>
            }
          />
          <div className="mb-3">
            <GanttLegend primary="ai" compact />
          </div>
          {day.data && day.data.date === now.date ? (
            <>
              <Gantt day={day.data} meta={meta} primary="ai" compact nowMinute={now.minute} onRoomClick={setDrawerRoom} selectedRoom={drawerRoom} />
              <HourlyEnergy day={day.data} nowMinute={now.minute} />
            </>
          ) : day.error ? (
            <ErrorBox error={day.error} onRetry={day.reload} />
          ) : (
            <Loading />
          )}
        </Card>
        <div className="space-y-5">
          <WeatherCard live={L} weather={weather.data} day={day.data?.date === now.date ? day.data : undefined} replay={!!at} />
          <OduCard live={L} meta={meta} />
        </div>
      </div>

      <Feed day={day.data?.date === now.date ? day.data : undefined} nowMinute={now.minute} title={at ? `${fmtDateK(now.date)} AI 판단 · 자동 조치` : '오늘의 AI 판단 · 자동 조치'} onOpen={setDrawerRoom} />

      <RoomDrawer open={!!drawerRoom} onClose={() => setDrawerRoom(null)} day={day.data} meta={meta} room={drawerRoom} />
    </div>
  )
}

function HourlyEnergy({ day, nowMinute }: { day: Day; nowMinute: number }) {
  const keys: StrategyKey[] = ['fixed', 'rule', 'ai']
  const hours = Array.from({ length: 17 }, (_, i) => i + 7)
  const option = useMemo<EChartsOption>(
    () => ({
      grid: { left: 40, right: 12, top: 12, bottom: 22 },
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
        areaStyle: k === 'ai' ? { color: 'rgba(27,175,122,0.10)' } : undefined,
        z: k === 'ai' ? 5 : 2,
        data: hours.map((h) => day.strategies[k]?.kwh_by_hour[h] ?? 0),
        ...(k === 'fixed'
          ? {
              markLine: {
                silent: true,
                symbol: 'none',
                lineStyle: { color: '#0b0b0b', width: 1, type: 'solid' },
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
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">시간대별 전력량 (kWh)</span>
        <span className="flex gap-3 text-[11.5px] text-ink-2">
          {(['ai', 'rule', 'fixed'] as StrategyKey[]).map((k) => (
            <LegendItem key={k} color={STRATEGY[k].color} label={STRATEGY[k].short} kind="line" />
          ))}
          <span className="text-ink-3">· 세로선 = 현재</span>
        </span>
      </div>
      <EChart option={option} height={150} />
    </div>
  )
}

function TimeBanner({
  now,
  at,
  onSet,
  semester,
  loading,
}: {
  now: Live['now']
  at: string | null
  onSet: (v: string | null) => void
  semester: { start: string; end: string }
  loading: boolean
}) {
  const [val, setVal] = useState(at ?? `${now.date}T${fmtMin(now.minute)}`)
  const fallback = !now.live && !at
  return (
    <div
      className={cx(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3',
        at ? 'border-[#c9dcf5] bg-[#f3f8fe]' : fallback ? 'border-[#f5dca0] bg-[#fffaf0]' : 'border-[#cfeadf] bg-[#f3fbf7]',
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            at ? 'bg-[#dceafb] text-[#1c5cab]' : fallback ? 'bg-[#fdeccc] text-warn-ink' : 'bg-[#d5f2e7] text-brand',
          )}
        >
          {fallback ? <Info size={18} /> : <Clock size={18} />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink tnum">
              {fmtDateK(now.date)} {fmtMin(now.minute)}
            </span>
            {at ? (
              <Badge tone="info">선택한 기준 시각</Badge>
            ) : now.live ? (
              <Badge tone="good">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-good" /> 실시간
              </Badge>
            ) : (
              <Badge tone="warn">대체 기준</Badge>
            )}
            {loading && <span className="text-[12px] text-ink-3">갱신 중…</span>}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-ink-2">
            {at ? '과거·미래 시점을 재현해 보는 중입니다. 시뮬레이션 결과는 같은 입력이면 항상 같습니다.' : now.reason === '실시간' ? '현재 시각의 강의와 냉난방 상태를 1분마다 갱신합니다.' : now.reason}
          </div>
        </div>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (val) onSet(val)
        }}
      >
        <input
          type="datetime-local"
          className={cx(inputBase, 'w-[200px] bg-white')}
          value={val}
          min={`${semester.start}T00:00`}
          max={`${semester.end}T23:55`}
          step={300}
          onChange={(e) => setVal(e.target.value)}
          aria-label="기준 시각"
        />
        <Button type="submit" size="md">
          이 시각으로 보기
        </Button>
        {at && (
          <Button
            variant="ghost"
            onClick={() => {
              onSet(null)
              setVal('')
            }}
          >
            <RotateCcw size={14} /> 실시간
          </Button>
        )}
      </form>
    </div>
  )
}

function skyIcon(sky: number, pty: number, size = 18) {
  if (pty === 1 || pty === 4 || pty === 5) return <CloudRain size={size} className="text-[#2a78d6]" />
  if (pty === 2 || pty === 3 || pty === 6 || pty === 7) return <CloudSnow size={size} className="text-[#6da7ec]" />
  if (sky === 1) return <Sun size={size} className="text-[#eda100]" />
  if (sky === 3) return <CloudSun size={size} className="text-ink-3" />
  return <Cloud size={size} className="text-ink-3" />
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
  return (
    <Card>
      <CardHeader
        title="외기 날씨"
        icon={<CloudSun size={15} />}
        sub={
          kmaCovers
            ? `기상청 단기예보${weather?.kma_base ? ` (${weather.kma_base.slice(4, 6)}/${weather.kma_base.slice(6, 8)} ${weather.kma_base.slice(8, 10)}시 발표)` : ''} · Open-Meteo`
            : `${day?.weather.src_actual ?? 'Open-Meteo'} · 시간별 기온`
        }
      />
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-3">
          {cur ? skyIcon(cur.sky, cur.pty, 34) : <CloudSun size={34} className="text-ink-3" />}
          <div>
            <div className="text-[34px] leading-none font-semibold tracking-tight text-ink">
              {live.outdoor.t.toFixed(1)}
              <span className="text-[16px] font-normal text-ink-3">℃</span>
            </div>
            <div className="mt-1 text-[12px] text-ink-3">{live.outdoor.src} · {fmtMin(now.minute)}</div>
          </div>
        </div>
        <div className="space-y-0.5 text-right text-[12px] text-ink-2">
          <div className="flex items-center justify-end gap-1">
            <Droplets size={12} /> 습도 {Math.round(live.outdoor.rh)}%
          </div>
          {cur && <div>{skyLabel(cur.sky, cur.pty)} · 강수 {cur.pop}%</div>}
        </div>
      </div>
      {nc && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-[#f6f6f3] px-3 py-2 text-[12px] text-ink-2">
          <span className="font-medium text-ink">기상청 초단기실황</span>
          <span className="tnum">
            {nc.t.toFixed(1)}℃ · {Math.round(nc.rh)}% ·{' '}
            <WindIcon size={11} className="inline" /> {nc.wind}m/s · {nc.time.slice(5, 10).replace('-', '/')} {nc.time.slice(11, 13)}시 관측
          </span>
        </div>
      )}
      {upcoming.length > 0 && (
        <div className="mt-3 grid grid-cols-8 gap-1">
          {upcoming.map((k) => {
            const h = hourly[k]
            return (
              <div key={k} className="flex flex-col items-center rounded-lg py-1.5 text-center hover:bg-[#f6f6f3]" title={`${skyLabel(h.sky, h.pty)} · 습도 ${h.rh}% · 강수확률 ${h.pop}%`}>
                <span className="text-[10.5px] text-ink-3">{k.slice(11, 13)}시</span>
                <span className="my-1">{skyIcon(h.sky, h.pty, 16)}</span>
                <span className="tnum text-[12px] font-semibold text-ink">{Math.round(h.t)}°</span>
                <span className="tnum text-[10px] text-ink-3">{h.pop ? `${h.pop}%` : ''}</span>
              </div>
            )
          })}
        </div>
      )}
      {!weather && <div className="mt-3 text-[12px] text-ink-3">예보를 불러오는 중…</div>}
    </Card>
  )
}

function OduCard({ live, meta }: { live: Live; meta: NonNullable<ReturnType<typeof useMeta>['meta']> }) {
  return (
    <Card>
      <CardHeader title="실외기 상태" icon={<Power size={15} />} sub="연결된 실내기가 모두 꺼지면 실외기도 정지" />
      <div className="space-y-2">
        {Object.values(meta.odus).map((o) => {
          const st = live.odus[o.id]
          const rooms = Object.values(meta.rooms).filter((r) => r.odu === o.id)
          const onRooms = live.rooms.filter((r) => r.odu === o.id && r.state !== 'OFF').map((r) => r.room)
          const load = st ? st.power_w / 1000 / o.cap_kw : 0
          return (
            <div key={o.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 font-semibold text-ink">
                  <span className={cx('inline-block h-2 w-2 rounded-full', st?.on ? 'bg-s-ai' : 'bg-[#c3c2b7]')} />
                  {o.id}
                </span>
                <span className="tnum text-ink-2">{st?.on ? `${(st.power_w / 1000).toFixed(1)} / ${o.cap_kw} kW` : '정지'}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#d5f2e7]/60">
                <div className="h-full rounded-full bg-s-ai" style={{ width: `${Math.min(100, load * 100)}%` }} />
              </div>
              <div className="mt-1 text-[11px] text-ink-3">
                {rooms.map((r) => r.id).join('·')}호 · 가동 {onRooms.length ? onRooms.join(', ') : '없음'}
              </div>
            </div>
          )
        })}
      </div>
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
      out.push({
        minute: decisionMinute(d, plan[d.room]),
        kind: 'decision',
        room: d.room,
        title: `${decisionLabel(d.type)} · ${d.title}`,
        detail: d.detail,
        type: d.type,
      })
    }
    for (const v of day.validation.sessions) {
      const info = statusInfo(v.status)
      if (info.group !== 'auto') continue
      out.push({ minute: hm(v.start), kind: 'auto', room: v.room, title: `${info.label} · ${v.title}`, detail: v.notes.join(' / ') })
    }
    for (const h of day.history) {
      if (!h.room) continue
      if (!/자동|감지|수동|재전송|보정/.test(h.cause)) continue
      out.push({ minute: h.minute, kind: 'history', room: h.room, title: `${h.device} ${h.state === 'ON' ? 'On' : 'Off'}`, detail: h.cause })
    }
    return out.sort((a, b) => a.minute - b.minute)
  }, [day])

  const shown = items.filter((i) => filter === 'all' || (filter === 'decision' ? i.kind === 'decision' : i.kind !== 'decision'))
  const nDec = items.filter((i) => i.kind === 'decision').length
  const nAuto = items.length - nDec

  return (
    <Card>
      <CardHeader
        title={title}
        icon={<Sparkles size={15} />}
        sub="AI가 무엇을, 왜 했는지 시간순으로 · 현재 이후 항목은 예정"
        right={
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `전체 ${items.length}` },
              { value: 'decision', label: `AI 판단 ${nDec}` },
              { value: 'auto', label: `자동 조치 ${nAuto}` },
            ]}
          />
        }
      />
      {!day ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-ink-3">해당 항목이 없습니다.</div>
      ) : (
        <ol className="thin-scroll grid max-h-[520px] grid-cols-1 gap-x-6 overflow-y-auto pr-1 lg:grid-cols-2">
          {shown.map((it, i) => {
            const future = it.minute > nowMinute
            return (
              <li key={i} className={cx('flex gap-3 border-b border-[#f0efec] py-2.5', future && 'opacity-55')}>
                <div className="tnum w-11 shrink-0 pt-0.5 text-[12px] font-semibold text-ink-2">{fmtMin(it.minute)}</div>
                <span
                  className={cx(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                    it.kind === 'decision' ? 'bg-ink text-white' : 'bg-[#fff6e0] text-[#c98500]',
                  )}
                >
                  {it.kind === 'decision' ? <DecisionIcon type={it.type ?? ''} size={12} /> : <Wrench size={12} strokeWidth={2.4} />}
                </span>
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(it.room)}>
                  <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <span className="rounded bg-[#f0efec] px-1 text-[11px] font-semibold text-ink-2">{it.room}</span>
                    <span className="truncate">{it.title}</span>
                    {future && <Badge tone="outline">예정</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2">{it.detail}</div>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

