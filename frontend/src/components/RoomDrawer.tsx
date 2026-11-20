import { useMemo, useState } from 'react'
import { CalendarClock, Crosshair, Download, Fan, Flame, Thermometer } from 'lucide-react'
import type { Day, Meta, RoomDay, StrategyKey } from '../lib/types'
import { CHART, STRATEGY, STRATEGY_KEYS, statusInfo, decisionLabel } from '../lib/constants'
import { cx, fmtDateK, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'
import { MODE, shade, thermalFill, type Mode, type RoomState } from '../lib/thermal'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from './EChart'
import { Badge, DataTable, Disclosure, DisclosureList, Drawer, Empty, Figure, StatusBadge, btnCls, tbl } from './ui'
import { DecisionIcon } from './Gantt'
import { ModeIcon } from './BuildingView'

/** The room's state at the minute the overview shows, with its outdoor unit (opened from the building view). */
export type RoomNow = RoomState & { minute: number; label: string; odu?: { id: string; on: boolean; power_w: number; mode: Mode } }

function comfortPct(rd: RoomDay | undefined): number | null {
  const occ = (rd?.sessions ?? []).reduce((a, s) => a + s.minutes, 0)
  if (!occ) return null
  return ((rd?.sessions ?? []).reduce((a, s) => a + s.in_band_minutes, 0) / occ) * 100
}

/** Heating season by month, else by the day's mean outdoor temperature. */
function seasonOf(day: Day | undefined): 'heat' | 'cool' {
  const month = day ? Number(day.date.slice(5, 7)) : new Date().getMonth() + 1
  if ([11, 12, 1, 2, 3].includes(month)) return 'heat'
  if ([6, 7, 8, 9].includes(month)) return 'cool'
  const t = day ? day.weather.actual.t.reduce((a, b) => a + b, 0) / 24 : 15
  return t < 16 ? 'heat' : 'cool'
}

const STATE_WORD: Record<Mode, string> = { heat: '난방 중', cool: '냉방 중', air: '송풍 중', off: '정지' }

// ---------------------------------------------------------------- room hero (mock 1): room card + status + chart

/**
 * The room at a glance: a big "4F - 407" card with the room drawn as a slab (seats filled by expected people),
 * the HVAC status card (state, target, next class) and the indoor-temperature/power chart with strategy chips.
 */
export function RoomHero({ day, meta, room, now, layout = 'page' }: { day: Day | undefined; meta: Meta; room: string; now?: RoomNow; layout?: 'page' | 'drawer' }) {
  const rm = meta.rooms[room]
  if (!rm) return null
  const sessions = (day?.sessions ?? []).filter((s) => s.room === room).sort((a, b) => hm(a.start) - hm(b.start))
  const current = now?.session ?? null
  const upcoming = now ? now.next : (sessions[0] ?? null)
  const people = current?.expected_people ?? upcoming?.expected_people ?? null
  const peopleLabel = current ? '지금 예상 재실 인원' : upcoming ? '다음 수업 예상 인원' : '예상 재실 인원'
  const mode: Mode = now?.mode ?? 'off'
  const season = seasonOf(day)
  const coolSide = mode === 'cool' || (mode !== 'heat' && season === 'cool')
  // an applied schedule adjustment (feedback / agent consensus) sets this room's own setpoint for the day
  const roomSp = day?.room_sp?.[room]
  const adjusted = coolSide ? roomSp?.sp_cool != null : roomSp?.sp_heat != null
  const target = coolSide ? (roomSp?.sp_cool ?? meta.settings.sp_cool) : (roomSp?.sp_heat ?? meta.settings.sp_heat)
  const targetWord = coolSide ? '냉방' : '난방'
  const aiRd = day?.strategies.ai?.rooms[room]
  return (
    <div className={cx('grid grid-cols-1 gap-5', layout === 'page' ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : 'md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]')}>
      {/* left: the room itself */}
      <section className="flex flex-col rounded-[14px] border border-line bg-surface px-8 pt-7 pb-8" aria-label={`${room}호 개요`}>
        <div className="flex items-baseline justify-between gap-3">
          <div className={cx('tnum leading-none font-[750] tracking-[-0.035em] text-[#2b3447]', layout === 'page' ? 'text-[56px]' : 'text-[44px]')}>
            {rm.floor}F - {room}
          </div>
          <span className="shrink-0 text-[14px] text-ink-3">
            {rm.type_label}, 정원 {rm.capacity}명
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center py-6">
          <RoomShape room={room} meta={meta} people={people ?? 0} mode={mode} ta={now?.ta ?? NaN} size={layout === 'page' ? 'lg' : 'md'} />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-ink-2">{peopleLabel}</div>
          {people != null ? (
            <div className="mt-1.5 flex items-baseline gap-1.5 text-ink">
              <span className="text-[17px] font-semibold text-ink-2">약</span>
              <span className="tnum text-[44px] leading-none font-[750] tracking-[-0.03em] text-[#2b3447]">{people}</span>
              <span className="text-[17px] font-semibold text-ink-2">명</span>
              {(current ?? upcoming)?.people_estimated && <span className="ml-2 text-[13px] text-ink-3">출석률로 추정한 가정값</span>}
            </div>
          ) : (
            <div className="mt-1.5 text-[15px] text-ink-3">{day ? '이 날은 이 강의실에 수업이 없습니다.' : '불러오는 중…'}</div>
          )}
        </div>
      </section>

      {/* right: status + chart */}
      <div className="flex min-w-0 flex-col gap-5">
        <section className="rounded-[14px] border border-line bg-surface px-7 py-6" aria-label="냉난방 상태">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-3.5 text-[15px]">
            <dt className="inline-flex items-center gap-2.5 text-ink-2">
              <Flame size={18} className="text-heat" aria-hidden />
              HVAC 상태
            </dt>
            <dd className="flex flex-wrap items-center gap-2">
              {now ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[14px] font-semibold"
                  style={{ background: mode === 'off' ? '#f0f2f5' : MODE[mode].tint, color: MODE[mode].deep }}
                >
                  <ModeIcon mode={mode} size={13} />
                  {STATE_WORD[mode]}
                  {mode !== 'off' && <span className="tnum font-medium">{(now.power_w / 1000).toFixed(1)} kW</span>}
                </span>
              ) : (
                <span className="text-ink">그날 AI 가동 {fmtDuration(aiRd?.on_minutes ?? 0)}</span>
              )}
              {now && (
                <span className="tnum text-[13px] text-ink-3">
                  {fmtMin(now.minute)} {now.label}
                </span>
              )}
            </dd>
            <dt className="inline-flex items-center gap-2.5 text-ink-2">
              <Crosshair size={18} className="text-ink-3" aria-hidden />
              목표 온도
            </dt>
            <dd className="tnum font-semibold text-ink">
              {target.toFixed(1)}℃ <span className="text-[13px] font-normal text-ink-3">{targetWord} 설정온도{adjusted ? ' · AI 조정 적용' : ''}</span>
            </dd>
            {now && (
              <>
                <dt className="inline-flex items-center gap-2.5 text-ink-2">
                  <Thermometer size={18} className="text-ink-3" aria-hidden />
                  실내 온도
                </dt>
                <dd className="tnum font-semibold text-ink">{Number.isFinite(now.ta) ? `${now.ta.toFixed(1)}℃` : '–'}</dd>
              </>
            )}
            <dt className="inline-flex items-center gap-2.5 text-ink-2">
              <CalendarClock size={18} className="text-ink-3" aria-hidden />
              {current ? '진행 중 수업' : '다음 수업 시간'}
            </dt>
            <dd className="min-w-0 text-ink">
              {current ?? upcoming ? (
                <span>
                  <b className="tnum font-semibold">
                    {(current ?? upcoming)!.start} ~ {(current ?? upcoming)!.end}
                  </b>{' '}
                  <span className="text-ink-2">({(current ?? upcoming)!.title})</span>
                </span>
              ) : (
                <span className="text-ink-3">{day ? '오늘 남은 수업이 없습니다' : '–'}</span>
              )}
            </dd>
            {now?.odu && (
              <>
                <dt className="inline-flex items-center gap-2.5 text-ink-2">
                  <Fan size={18} className="text-ink-3" aria-hidden />
                  실외기 {now.odu.id.replace('ODU-', '')}
                </dt>
                <dd className="tnum text-ink">{now.odu.on ? `가동 ${(now.odu.power_w / 1000).toFixed(1)} kW` : '정지'}</dd>
              </>
            )}
          </dl>
        </section>
        <RoomChart day={day} meta={meta} room={room} nowMinute={now?.minute} compact={layout === 'drawer'} />
      </div>
    </div>
  )
}

/** The room drawn as a slab (same lean as the building plan): seats filled by expected people, indoor units on the back wall. */
function RoomShape({ room, meta, people, mode, ta, size }: { room: string; meta: Meta; people: number; mode: Mode; ta: number; size: 'lg' | 'md' }) {
  const rm = meta.rooms[room]
  const W = size === 'lg' ? 380 : 320
  const H = size === 'lg' ? 230 : 196
  const lean = W * 0.2
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const run = mode !== 'off'
  const RUN_FILL: Record<Exclude<Mode, 'off'>, [string, string]> = { heat: ['#ffe2cf', '#f6ad83'], cool: ['#dde9fc', '#9dbdf2'], air: ['#dcf2f1', '#9dd9d5'] }
  const base = run ? RUN_FILL[mode as Exclude<Mode, 'off'>][1] : Number.isFinite(ta) ? thermalFill(ta, lo, hi) : '#e3ecf9'
  const top = run ? RUN_FILL[mode as Exclude<Mode, 'off'>][0] : shade(base, -0.45)
  const edge = run ? MODE[mode].color : shade(base, 0.14)
  // seats: rows × cols filling capacity; filled = expected people
  const cap = Math.max(1, rm?.capacity ?? 40)
  const cols = cap >= 50 ? 10 : 8
  const rows = Math.ceil(cap / cols)
  const pad = { t: 46, b: 22, l: 26, r: 26 }
  const P = (u: number, v: number): [number, number] => {
    // u: 0..1 across, v: 0..1 front(1) to back(0)
    const y = pad.t + v * (H - pad.t - pad.b)
    const xl = lean * (1 - y / H)
    return [xl + pad.l + u * (W - lean - pad.l - pad.r), y]
  }
  const seats: { x: number; y: number; on: boolean }[] = []
  let k = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && k < cap; c++, k++) {
      const [x, y] = P((c + 0.5) / cols, (r + 0.5) / rows)
      seats.push({ x, y, on: k < people })
    }
  }
  const idus = rm?.idus ?? []
  return (
    <svg width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`${room}호 평면: 좌석 ${cap}석 중 ${people}석에 예상 인원, 실내기 ${idus.length}대 ${MODE[mode].label}`} className="max-w-full">
      <defs>
        <linearGradient id={`rs-${room}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={base} />
        </linearGradient>
      </defs>
      {/* slab thickness */}
      <polygon points={`0,${H} ${W - lean},${H} ${W - lean},${H + 12} 0,${H + 12}`} fill={shade(base, 0.16)} />
      <polygon points={`${W - lean},${H} ${W},0 ${W},12 ${W - lean},${H + 12}`} fill={shade(base, 0.24)} />
      <polygon points={`${lean},0 ${W},0 ${W - lean},${H} 0,${H}`} fill={`url(#rs-${room})`} stroke={edge} strokeOpacity={run ? 0.55 : 0.35} strokeWidth="1.5" strokeLinejoin="round" />
      {/* indoor units on the back wall */}
      {idus.map((u, i) => {
        const [x, y] = P((i + 0.5) / idus.length, -0.12)
        return (
          <g key={u.id} transform={`translate(${x - 26} ${y - 12})`}>
            <rect width="52" height="22" rx="7" fill="#ffffff" stroke={run ? MODE[mode].color : '#c9d1db'} strokeWidth="1.5" />
            <g transform="translate(6 4.5)">{run ? <ModeIcon mode={mode} size={13} className="" /> : <Fan size={13} color="#97a1ae" strokeWidth={2.2} />}</g>
            <text x="34" y="15" textAnchor="middle" fontSize="11" fontWeight="600" fill={run ? MODE[mode].deep : '#667183'}>
              {u.id.split('-').pop()}
            </text>
          </g>
        )
      })}
      {/* seats */}
      {seats.map((s, i) => (
        <rect key={i} x={s.x - 4.5} y={s.y - 3.5} width="9" height="7" rx="2" fill={s.on ? '#2b3447' : '#ffffff'} fillOpacity={s.on ? 0.78 : 0.75} />
      ))}
    </svg>
  )
}

/** "실내온도와 전력": temperature on top, power below (shared time axis, no dual y-axis), strategies toggled by chips. */
function RoomChart({ day, meta, room, nowMinute, compact = false }: { day: Day | undefined; meta: Meta; room: string; nowMinute?: number; compact?: boolean }) {
  const [shown, setShown] = useState<StrategyKey[]>(['fixed', 'ai'])
  const toggle = (k: StrategyKey) => setShown((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : STRATEGY_KEYS.filter((x) => x === k || cur.includes(x))))
  const option = useMemo<EChartsOption | null>(() => {
    if (!day) return null
    const r0 = 480
    const r1 = 1350
    const lo = meta.settings.comfort_low
    const hi = meta.settings.comfort_high
    const keys = shown.filter((k) => day.strategies[k]?.rooms[room])
    const sessions = day.sessions.filter((s) => s.room === room)
    const taSeries = keys.map((k) => ({
      name: `${STRATEGY[k].short} 실내`,
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { width: k === 'ai' ? 2.5 : 2, color: STRATEGY[k].color },
      itemStyle: { color: STRATEGY[k].color },
      ...(k === 'ai' ? { areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(20,166,115,0.18)' }, { offset: 1, color: 'rgba(20,166,115,0)' }] } } } : {}),
      data: day.strategies[k]!.rooms[room].ta.map((v, i) => [i * 5 + 2.5, v]).filter((p) => p[0] >= r0 && p[0] <= r1),
      z: k === 'ai' ? 5 : 3,
    }))
    const pSeries = keys.map((k) => ({
      name: `${STRATEGY[k].short} 전력`,
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      step: 'middle' as const,
      showSymbol: false,
      lineStyle: { width: 2, color: STRATEGY[k].color },
      itemStyle: { color: STRATEGY[k].color },
      ...(k === 'ai' ? { areaStyle: { color: STRATEGY.ai.wash } } : {}),
      data: day.strategies[k]!.rooms[room].p.map((v, i) => [i * 5 + 2.5, +(v / 1000).toFixed(2)]).filter((p) => p[0] >= r0 && p[0] <= r1),
      z: k === 'ai' ? 5 : 3,
    }))
    const band = {
      name: '쾌적 범위',
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: CHART.comfortBand },
        label: { show: true, position: 'insideTopLeft' as const, color: CHART.comfortInk, fontSize: 12, formatter: `쾌적 ${lo}–${hi}℃` },
        data: [[{ yAxis: lo }, { yAxis: hi }]] as never,
      },
      ...(nowMinute != null && nowMinute >= r0 && nowMinute <= r1
        ? { markLine: { silent: true, symbol: 'none', lineStyle: { color: '#2f6fde', width: 1.25, type: 'dashed' as const }, label: { show: false }, data: [{ xAxis: nowMinute }] } }
        : {}),
    }
    const lect = {
      name: '강의',
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(20,32,51,0.05)' },
        label: { show: false },
        data: sessions.map((s) => [{ xAxis: hm(s.start), name: s.title }, { xAxis: hm(s.end) }]) as never,
      },
    }
    const all = keys.flatMap((k) => day.strategies[k]!.rooms[room].ta.slice(96, 270))
    const tmin = Math.floor(Math.min(lo - 1, ...all) / 5) * 5
    const tmax = Math.ceil(Math.max(hi + 0.5, ...all) / 5) * 5
    const xAx = (gi: number, show: boolean) => ({
      type: 'value' as const,
      gridIndex: gi,
      min: r0,
      max: r1,
      interval: 60,
      ...axisCommon,
      splitLine: { show: true, lineStyle: { color: CHART.grid } },
      axisLabel: {
        ...axisCommon.axisLabel,
        show,
        formatter: (v: number) => (compact ? (Math.floor(v / 60) % 2 ? '' : `${Math.floor(v / 60)}시`) : `${String(Math.floor(v / 60)).padStart(2, '0')}:00`),
      },
    })
    return {
      grid: [
        { left: 40, right: 12, top: 16, height: 128 },
        { left: 40, right: 12, top: 168, height: 70 },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: CHART.muted } },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number[]; color: string }[]
          if (!arr.length) return ''
          let html = ttTitle(fmtMin(arr[0].value[0] - 2.5))
          for (const p of arr) {
            const pw = p.seriesName.includes('전력')
            html += ttRow(p.color, p.seriesName, `${p.value[1].toFixed(pw ? 2 : 1)}${pw ? ' kW' : '℃'}`)
          }
          return html
        },
      },
      xAxis: [xAx(0, false), xAx(1, true)],
      yAxis: [
        { type: 'value', gridIndex: 0, min: tmin, max: tmax, splitNumber: 3, ...axisCommon, axisLine: { show: false } },
        { type: 'value', gridIndex: 1, splitNumber: 2, ...axisCommon, axisLine: { show: false } },
      ],
      series: [band, ...taSeries, lect, ...pSeries] as never,
    }
  }, [day, room, meta, shown, nowMinute, compact])

  return (
    <section className="rounded-[14px] border border-line bg-surface px-6 pt-5 pb-3" aria-labelledby={`rc-${room}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`rc-${room}`} className="text-[16px] font-[650] text-ink">
          실내온도와 전력
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="비교할 운전 방식">
          {STRATEGY_KEYS.map((k) => {
            const on = shown.includes(k)
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(k)}
                className={cx(
                  'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors duration-150',
                  on ? 'bg-surface text-ink' : 'border-line bg-surface text-ink-3 hover:text-ink',
                )}
                style={on ? { borderColor: STRATEGY[k].color } : undefined}
              >
                <span
                  className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border-[1.5px]"
                  style={{ borderColor: STRATEGY[k].color, background: on ? STRATEGY[k].color : 'transparent' }}
                  aria-hidden
                >
                  {on && (
                    <svg width="9" height="9" viewBox="0 0 10 10">
                      <path d="M2 5.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {k === 'ai' ? 'AI (적용 중)' : STRATEGY[k].short}
              </button>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
        <span>위: 실내온도(℃)</span>
        <span>아래: 전력(kW), 회색 띠는 수업 시간</span>
      </div>
      {option ? <EChart option={option} height={258} /> : <div className="skeleton mt-2 h-[258px]" />}
    </section>
  )
}

// ---------------------------------------------------------------- room details (figures + disclosures)

export function RoomDetails({ day, meta, room }: { day: Day; meta: Meta; room: string }) {
  const [showOdu, setShowOdu] = useState(false)
  const rm = meta.rooms[room]
  if (!rm) return null
  const sessions = day.sessions.filter((s) => s.room === room)
  const vals = day.validation.sessions.filter((v) => v.room === room)
  const decs = day.decisions.filter((d) => d.room === room)
  const hist = (day.history ?? []).filter((h) => h.room === room || (showOdu && h.device === rm.odu))
  const aiRd = day.strategies.ai?.rooms[room]
  const occ = (aiRd?.sessions ?? []).reduce((a, s) => a + s.minutes, 0)
  const inb = (aiRd?.sessions ?? []).reduce((a, s) => a + s.in_band_minutes, 0)
  const issues = vals.filter((v) => statusInfo(v.status).group !== 'normal').length
  const curRd = day.strategies.fixed?.rooms[room]
  const cmp = compare(curRd, aiRd, meta.settings.fixed_off)
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 rounded-[14px] border border-line bg-surface px-7 py-6" aria-label="하루 요약">
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <Figure label="AI 전력 (하루)" value={fmtKwh(aiRd?.kwh ?? 0)} unit="kWh" accent={STRATEGY.ai.color} size="sm" />
          <Figure label="AI 가동 시간" value={fmtDuration(aiRd?.on_minutes ?? 0)} size="sm" />
          <Figure label="강의 중 쾌적" value={occ ? ((inb / occ) * 100).toFixed(0) : '–'} unit={occ ? '%' : undefined} size="sm" />
          <Figure label="강의" value={String(sessions.length)} unit="건" size="sm" />
        </div>
        <div className="max-w-[46ch] text-[14px] text-ink-2">
          {cmp.pct != null && (
            <span className="tnum mr-1.5 font-semibold" style={{ color: cmp.saved >= 0 ? STRATEGY.ai.color : CHART.ink }}>
              현재 운영 대비 {cmp.saved >= 0 ? '−' : '+'}
              {Math.abs(cmp.pct).toFixed(0)}%
            </span>
          )}
          {cmp.sentence}
        </div>
      </section>

      <DisclosureList>
        <Disclosure title="강의별 검증 결과" summary={vals.length ? `${vals.length}건${issues ? `, 이상 ${issues}` : ', 모두 정상'}` : '강의 없음'}>
          {vals.length === 0 ? (
            <Empty title="이 날은 이 강의실에 강의가 없습니다" desc="강의가 없으면 AI는 냉난방을 켜지 않습니다." />
          ) : (
            <div className={tbl.frame}>
              <table className={tbl.table}>
                <thead className={tbl.thead}>
                  <tr>
                    <th className={tbl.th}>강의</th>
                    <th className={tbl.th}>상태</th>
                    <th className={tbl.thR}>실행률</th>
                    <th className={tbl.thR}>시작 온도</th>
                    <th className={tbl.thR}>쾌적</th>
                  </tr>
                </thead>
                <tbody>
                  {vals.map((v) => {
                    const info = statusInfo(v.status)
                    const s = sessions.find((x) => x.id === v.session)
                    return (
                      <tr key={v.session} className={cx(tbl.tr, 'align-top')}>
                        <td className="px-3.5 py-2.5">
                          <div className="font-medium text-ink">{v.title}</div>
                          <div className="text-[13px] text-ink-3">
                            {v.start}–{v.end}
                            {s?.professor ? `, ${s.professor}` : ''}, {s?.expected_people ?? '–'}명
                          </div>
                          {v.decisions.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {v.decisions.map((d) => (
                                <Badge key={d} tone="ai">
                                  <DecisionIcon type={d} size={11} />
                                  {decisionLabel(d)}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <StatusBadge group={info.group} label={info.label} />
                          {v.notes.map((n, i) => (
                            <div key={i} className="mt-1 text-[13px] text-ink-2">
                              {n}
                            </div>
                          ))}
                        </td>
                        <td className="px-3.5 py-2.5 text-right">{v.exec_ratio != null ? `${(v.exec_ratio * 100).toFixed(0)}%` : '–'}</td>
                        <td className="px-3.5 py-2.5 text-right">{v.ta_start != null ? `${v.ta_start.toFixed(1)}℃` : '–'}</td>
                        <td className="px-3.5 py-2.5 text-right">{v.comfort_pct != null ? `${v.comfort_pct.toFixed(0)}%` : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Disclosure>
        <Disclosure title="AI 판단 근거" summary={decs.length ? `${decs.length}건` : '없음'}>
          {decs.length === 0 ? (
            <p className="text-[14px] text-ink-3">이 날 이 강의실에서는 AI가 따로 판단한 운전이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {decs.map((d, i) => (
                <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white" aria-hidden>
                    <DecisionIcon type={d.type} size={13} />
                  </span>
                  <div className="text-[14px]">
                    <div className="font-semibold text-ink">
                      {decisionLabel(d.type)}{' '}
                      <span className="tnum font-normal text-ink-3">
                        {d.title} {d.start}–{d.end}
                      </span>
                    </div>
                    <div className="mt-0.5 text-ink-2">{d.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
        <Disclosure title="설비 켜고 끈 기록" summary={`${(day.history ?? []).filter((h) => h.room === room).length}건`}>
          <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-[13.5px] text-ink-2">
            <input type="checkbox" name="show-odu" checked={showOdu} onChange={(e) => setShowOdu(e.target.checked)} className="h-4 w-4 accent-[#2f6fde]" />
            실외기({rm.odu.replace('ODU-', '')}) 기록도 보기
          </label>
          {hist.length === 0 ? (
            <Empty title="이 날은 켜고 끈 기록이 없습니다" />
          ) : (
            <DataTable
              maxHeight={300}
              spec={{
                columns: ['시각', '장치', '상태', '원인'],
                align: ['left', 'left', 'left', 'left'],
                rows: hist.map((h) => [h.t, h.device, h.state === 'ON' ? '켬' : h.state === 'OFF' ? '끔' : h.state, h.cause]),
              }}
            />
          )}
        </Disclosure>
        <Disclosure title="설비 정보" summary={`실내기 ${rm.idus.length}대, ${rm.odu.replace('ODU-', '실외기 ')}`}>
          <dl className="tnum grid grid-cols-[120px_1fr] gap-y-2 text-[14px]">
            <dt className="text-ink-3">유형</dt>
            <dd className="text-ink">{rm.type_label}</dd>
            <dt className="text-ink-3">면적·정원</dt>
            <dd className="text-ink">
              {rm.area}㎡, {rm.capacity}명{rm.pcs ? `, PC ${rm.pcs}대` : ''}
            </dd>
            <dt className="text-ink-3">실내기</dt>
            <dd className="text-ink">
              {rm.idus.map((i) => (
                <div key={i.id}>
                  {i.id} <span className="text-ink-3">(냉방 {i.cool_kw} / 난방 {i.heat_kw} kW)</span>
                </div>
              ))}
            </dd>
            <dt className="text-ink-3">실외기</dt>
            <dd className="text-ink">
              {rm.odu} {meta.odus[rm.odu] && <span className="text-ink-3">({meta.odus[rm.odu].label}, 용량 {meta.odus[rm.odu].cap_kw} kW)</span>}
            </dd>
          </dl>
          {rm.assumption && <p className="mt-3 text-[13px] text-ink-3">현장 설비 대장과 대조하기 전의 가정값입니다.</p>}
        </Disclosure>
      </DisclosureList>
    </div>
  )
}

// ---------------------------------------------------------------- drawer (used by 타임라인 and 정합성 검증)

export default function RoomDrawer({
  open,
  onClose,
  day,
  meta,
  room,
  now,
}: {
  open: boolean
  onClose: () => void
  day: Day | undefined
  meta: Meta
  room: string | null
  now?: RoomNow
}) {
  const rm = room ? meta.rooms[room] : undefined
  if (!room || !rm) return null
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={940}
      title={
        <span className="flex items-baseline gap-2.5">
          {room}호 <span className="text-[15px] font-medium text-ink-3">{rm.type_label}</span>
        </span>
      }
      sub={day ? `${fmtDateK(day.date)}, 정원 ${rm.capacity}명` : '불러오는 중…'}
      right={
        day && (
          <a href={`/api/export/plan.csv?date=${day.date}&strategy=ai`} className={btnCls('ghost', 'sm')} download>
            <Download size={14} aria-hidden /> 운전 계획 CSV
          </a>
        )
      }
    >
      {!day ? (
        <div className="space-y-4" role="status" aria-label="강의실 데이터를 불러오는 중">
          <div className="skeleton h-[92px]" />
          <div className="skeleton h-[420px]" />
        </div>
      ) : (
        <div className="space-y-6 pb-2">
          <RoomHero day={day} meta={meta} room={room} now={now} layout="drawer" />
          <RoomDetails day={day} meta={meta} room={room} />
        </div>
      )}
    </Drawer>
  )
}

/** One sentence and a percentage from the day's numbers. Works on the kWh as displayed, so the legend values subtract to the stated saving. */
function compare(cur: RoomDay | undefined, ai: RoomDay | undefined, off: string) {
  const shown = (v: number | undefined) => Number(fmtKwh(v ?? 0).replace(/,/g, ''))
  const c = shown(cur?.kwh)
  const a = shown(ai?.kwh)
  const saved = c - a
  const pct = c > 0 ? (saved / c) * 100 : null
  const cc = comfortPct(cur)
  const ca = comfortPct(ai)
  const comfort =
    ca == null || cc == null ? '' : Math.round(cc) === Math.round(ca) ? ` 강의 중 쾌적은 ${ca.toFixed(0)}%로 같습니다.` : ` 강의 중 쾌적은 현재 운영 ${cc.toFixed(0)}%, AI ${ca.toFixed(0)}%입니다.`
  let sentence: string
  if (c <= 0 && a <= 0) sentence = '이 날은 현재 운영과 AI 모두 냉난방을 켜지 않습니다.'
  else if (c <= 0) sentence = `현재 운영은 이 날 가동하지 않고, AI는 일정에 맞춰 ${fmtKwh(a)} kWh를 씁니다.`
  else if (a <= 0)
    sentence = `${ai?.sessions.length ? `AI는 가동을 생략해 전력을 쓰지 않습니다.${comfort}` : '강의가 없어 AI는 냉난방을 켜지 않습니다.'} 현재 운영은 첫 수업에 켜서 ${off} 일괄 정지까지 돌려 ${fmtKwh(c)} kWh를 씁니다.`
  else if (saved >= 0) sentence = `AI는 현재 운영(첫 수업에 켜고 ${off} 일괄 정지)보다 전력을 ${fmtKwh(saved)} kWh 덜 씁니다.${comfort}`
  else sentence = `AI는 현재 운영(첫 수업에 켜고 ${off} 일괄 정지)보다 전력을 ${fmtKwh(-saved)} kWh 더 씁니다.${comfort}`
  return { saved, pct, sentence }
}

