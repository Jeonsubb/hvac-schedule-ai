import { useMemo, useState } from 'react'
import { Download, Fan, Users } from 'lucide-react'
import type { Day, Meta, RoomDay } from '../lib/types'
import { CHART, STRATEGY, statusInfo, decisionLabel } from '../lib/constants'
import { cx, fmtDateK, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'
import { MODE, type Mode, type RoomState } from '../lib/thermal'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from './EChart'
import { Badge, DataTable, Disclosure, DisclosureList, Drawer, Empty, Figure, StatusBadge, btnCls, tbl } from './ui'
import { DecisionIcon } from './Gantt'
import { ModeIcon } from './BuildingView'

/** The room's state at the minute the overview shows, with its outdoor unit (opened from the building view). */
export type RoomNow = RoomState & { minute: number; label: string; odu?: { id: string; on: boolean; power_w: number; mode: Mode } }

/** The room chart compares exactly two ways of running: today's operation (the fixed schedule) and AI. */
const PAIR = [
  { key: 'fixed', name: '현재 운영' },
  { key: 'ai', name: 'AI' },
] as const

function comfortPct(rd: RoomDay | undefined): number | null {
  const occ = (rd?.sessions ?? []).reduce((a, s) => a + s.minutes, 0)
  if (!occ) return null
  return ((rd?.sessions ?? []).reduce((a, s) => a + s.in_band_minutes, 0) / occ) * 100
}

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
  const [showOdu, setShowOdu] = useState(false)
  const rm = room ? meta.rooms[room] : undefined

  const option = useMemo<EChartsOption | null>(() => {
    if (!day || !room) return null
    const r0 = 420
    const r1 = 1410
    const lo = meta.settings.comfort_low
    const hi = meta.settings.comfort_high
    const sessions = day.sessions.filter((s) => s.room === room)
    const pair = PAIR.filter((x) => day.strategies[x.key]?.rooms[room])
    // power on top: it carries the comparison; the temperature pane below shows comfort held
    const pSeries = pair.map((x) => ({
      name: `${x.name} 전력`,
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      step: 'middle' as const,
      showSymbol: false,
      lineStyle: { width: 2, color: STRATEGY[x.key].color },
      itemStyle: { color: STRATEGY[x.key].color },
      ...(x.key === 'ai' ? { areaStyle: { color: STRATEGY.ai.wash } } : {}),
      data: day.strategies[x.key]!.rooms[room].p.map((v, i) => [i * 5 + 2.5, +(v / 1000).toFixed(2)]).filter((p) => p[0] >= r0 && p[0] <= r1),
      z: x.key === 'ai' ? 5 : 3,
    }))
    const sessArea = {
      name: '강의',
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(20,32,51,0.06)' },
        label: { show: false },
        data: sessions.map((s) => [{ xAxis: hm(s.start), name: s.title }, { xAxis: hm(s.end) }]) as never,
      },
    }
    const taSeries = pair.map((x) => ({
      name: `${x.name} 실내`,
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      showSymbol: false,
      lineStyle: { width: 2, color: STRATEGY[x.key].color },
      itemStyle: { color: STRATEGY[x.key].color },
      data: day.strategies[x.key]!.rooms[room].ta.map((v, i) => [i * 5 + 2.5, v]).filter((p) => p[0] >= r0 && p[0] <= r1),
      z: x.key === 'ai' ? 5 : 3,
    }))
    const wx = day.weather.actual
    const outdoor = {
      name: '외기',
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      showSymbol: false,
      lineStyle: { width: 1.5, color: CHART.outdoor, type: 'solid' as const },
      itemStyle: { color: CHART.outdoor },
      data: wx.t.map((v, h) => [h * 60 + 30, v]).filter((p) => p[0] >= r0 - 60 && p[0] <= r1 + 60),
      z: 1,
    }
    const band = {
      name: '쾌적 범위',
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: CHART.comfortBand },
        label: { show: true, position: 'insideTopLeft' as const, color: CHART.comfortInk, fontSize: 12, formatter: `쾌적 범위 ${lo}–${hi}℃` },
        data: [[{ yAxis: lo }, { yAxis: hi }]] as never,
      },
    }
    const all = pair.flatMap((x) => day.strategies[x.key]!.rooms[room].ta.slice(84, 283))
    const rawMin = Math.min(lo - 1, ...all, ...wx.t.slice(7, 24))
    const rawMax = Math.max(hi + 1, ...all, ...wx.t.slice(7, 24))
    const step = rawMax - rawMin > 18 ? 5 : rawMax - rawMin > 9 ? 3 : 2
    const tmin = Math.floor(rawMin / step) * step
    const tmax = Math.ceil(rawMax / step) * step
    const xAx = (gi: number, show: boolean) => ({
      type: 'value' as const,
      gridIndex: gi,
      min: r0,
      max: r1,
      interval: 60,
      ...axisCommon,
      splitLine: { show: true, lineStyle: { color: CHART.grid } },
      axisLabel: { ...axisCommon.axisLabel, show, formatter: (v: number) => (Math.floor(v / 60) % 2 ? '' : `${Math.floor(v / 60)}시`) },
    })
    return {
      grid: [
        { left: 44, right: 16, top: 24, height: 150 },
        { left: 44, right: 16, top: 216, height: 150 },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: CHART.muted } },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number[]; color: string }[]
          if (!arr.length) return ''
          const m = arr[0].value[0]
          let html = ttTitle(`${fmtMin(m - 2.5)}`)
          for (const p of arr) {
            const unit = p.seriesName.includes('전력') ? ' kW' : '℃'
            html += ttRow(p.color, p.seriesName, `${p.value[1].toFixed(p.seriesName.includes('전력') ? 2 : 1)}${unit}`)
          }
          return html
        },
      },
      xAxis: [xAx(0, false), xAx(1, true)],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: 'kW',
          splitNumber: 3,
          ...axisCommon,
          nameTextStyle: { color: CHART.muted, fontSize: 12, padding: [0, 24, 0, 0] },
        },
        {
          type: 'value',
          gridIndex: 1,
          min: tmin,
          max: tmax,
          interval: step,
          name: '℃',
          ...axisCommon,
          nameTextStyle: { color: CHART.muted, fontSize: 12, padding: [0, 24, 0, 0] },
        },
      ],
      series: [sessArea, ...pSeries, band, outdoor, ...taSeries] as never,
    }
  }, [day, room, meta])

  if (!room || !rm) return null
  const sessions = day?.sessions.filter((s) => s.room === room) ?? []
  const vals = day?.validation.sessions.filter((v) => v.room === room) ?? []
  const decs = day?.decisions.filter((d) => d.room === room) ?? []
  const hist = (day?.history ?? []).filter((h) => h.room === room || (showOdu && h.device === rm.odu))
  const aiRd = day?.strategies.ai?.rooms[room]
  const occ = (aiRd?.sessions ?? []).reduce((a, s) => a + s.minutes, 0)
  const inb = (aiRd?.sessions ?? []).reduce((a, s) => a + s.in_band_minutes, 0)
  const issues = vals.filter((v) => statusInfo(v.status).group !== 'normal').length
  const curRd = day?.strategies.fixed?.rooms[room]
  const cmp = compare(curRd, aiRd, meta.settings.fixed_on, meta.settings.fixed_off)

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={860}
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
        <div className="space-y-8">
          {now && <NowBlock now={now} />}

          <div className="flex flex-wrap gap-x-12 gap-y-5">
            <Figure label="AI 전력 (하루)" value={fmtKwh(aiRd?.kwh ?? 0)} unit="kWh" accent={STRATEGY.ai.color} size="sm" />
            <Figure label="AI 가동 시간" value={fmtDuration(aiRd?.on_minutes ?? 0)} size="sm" />
            <Figure label="강의 중 쾌적" value={occ ? ((inb / occ) * 100).toFixed(0) : '–'} unit={occ ? '%' : undefined} size="sm" />
            <Figure label="강의" value={String(sessions.length)} unit="건" size="sm" />
          </div>

          <section aria-labelledby="rd-chart">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div>
                <h3 id="rd-chart" className="text-[17px] font-[650] text-ink">
                  현재 운영 vs AI 전력
                </h3>
                <p className="mt-1 max-w-[56ch] text-[14px] text-ink-2">{cmp.sentence}</p>
              </div>
              {cmp.pct != null && (
                <div className="text-right">
                  <div className="text-[13px] font-medium text-ink-3">{cmp.saved >= 0 ? '전력 절감' : '전력 증가'}</div>
                  <div className="tnum mt-1 text-[28px] leading-none font-[650] tracking-[-0.025em]" style={{ color: cmp.saved >= 0 ? STRATEGY.ai.color : CHART.ink }}>
                    {Math.abs(cmp.pct).toFixed(0)}
                    <span className="ml-0.5 text-[15px] font-medium text-ink-3">%</span>
                  </div>
                </div>
              )}
            </div>
            <ul className="mb-2 flex flex-wrap gap-x-6 gap-y-1.5 text-[14px] text-ink-2" aria-label="비교하는 두 운전 방식">
              {PAIR.map((x) => {
                const rd = x.key === 'ai' ? aiRd : curRd
                return (
                  <li key={x.key} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: STRATEGY[x.key].color }} aria-hidden />
                    <span className="font-medium text-ink">{x.name}</span>
                    <b className="tnum font-semibold text-ink">{fmtKwh(rd?.kwh ?? 0)} kWh</b>
                    <span className="tnum text-ink-3">가동 {fmtDuration(rd?.on_minutes ?? 0)}</span>
                  </li>
                )
              })}
            </ul>
            <div className="mb-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded-[3px] bg-[rgb(20_32_51/0.08)]" aria-hidden />
                강의 시간
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: CHART.outdoor }} aria-hidden />
                외기온도
              </span>
              <span className="text-ink-3">
                현재 운영: 평일 {meta.settings.fixed_on}–{meta.settings.fixed_off} 고정 가동
              </span>
            </div>
            {option && <EChart option={option} height={400} />}
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
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
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
                <input type="checkbox" name="show-odu" checked={showOdu} onChange={(e) => setShowOdu(e.target.checked)} className="h-4 w-4 accent-[#142033]" />
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
      )}
    </Drawer>
  )
}

/** One sentence and a percentage from the day's numbers. Works on the kWh as displayed, so the legend values subtract to the stated saving. */
function compare(cur: RoomDay | undefined, ai: RoomDay | undefined, on: string, off: string) {
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
    sentence = `${ai?.sessions.length ? `AI는 가동을 생략해 전력을 쓰지 않습니다.${comfort}` : '강의가 없어 AI는 냉난방을 켜지 않습니다.'} 현재 운영은 ${on}–${off} 고정 가동으로 ${fmtKwh(c)} kWh를 씁니다.`
  else if (saved >= 0) sentence = `AI는 현재 운영보다 전력을 ${fmtKwh(saved)} kWh 덜 씁니다.${comfort}`
  else sentence = `AI는 현재 운영보다 전력을 ${fmtKwh(-saved)} kWh 더 씁니다.${comfort}`
  return { saved, pct, sentence }
}

function NowBlock({ now }: { now: RoomNow }) {
  const run = now.mode !== 'off'
  return (
    <section className="rounded-[14px] bg-well px-6 py-5" aria-label={`${fmtMin(now.minute)} ${now.label} 상태`}>
      <div className="text-[13px] font-medium text-ink-3">
        <span className="tnum">{fmtMin(now.minute)}</span> {now.label}
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex items-center gap-4">
          <span className="tnum text-[40px] leading-none font-[650] tracking-[-0.03em] text-ink">
            {Number.isFinite(now.ta) ? now.ta.toFixed(1) : '–'}
            <span className="ml-0.5 text-[18px] font-medium text-ink-3">℃</span>
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[14px] font-semibold"
            style={{ background: run ? MODE[now.mode].tint : '#ffffff', color: MODE[now.mode].deep }}
          >
            <ModeIcon mode={now.mode} size={14} />
            {MODE[now.mode].label}
            {run && <span className="tnum font-medium">{(now.power_w / 1000).toFixed(1)} kW</span>}
          </span>
        </div>
        {now.odu && (
          <span className="inline-flex items-center gap-1.5 text-[14px] text-ink-2">
            <Fan size={15} className="text-ink-3" aria-hidden />
            실외기 {now.odu.id.replace('ODU-', '')}
            <b className="tnum font-semibold text-ink">{now.odu.on ? `가동 ${(now.odu.power_w / 1000).toFixed(1)} kW` : '정지'}</b>
          </span>
        )}
      </div>
      <div className="mt-3 text-[14px] text-ink-2">
        {now.session ? (
          <span className="inline-flex items-center gap-1.5">
            <Users size={15} className="text-ink-3" aria-hidden />
            강의 중 <b className="font-semibold text-ink">{now.session.title}</b>
            <span className="tnum text-ink-3">
              {now.session.start}–{now.session.end}, {now.session.expected_people ?? '–'}명
            </span>
          </span>
        ) : now.next ? (
          <span>
            다음 강의 <b className="font-semibold text-ink">{now.next.title}</b> <span className="tnum text-ink-3">{now.next.start}–{now.next.end}</span>
          </span>
        ) : (
          '오늘 남은 강의가 없습니다.'
        )}
      </div>
    </section>
  )
}
