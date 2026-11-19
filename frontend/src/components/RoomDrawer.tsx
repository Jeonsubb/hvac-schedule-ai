import { useMemo, useState } from 'react'
import { Download, History } from 'lucide-react'
import type { Day, Meta, StrategyKey } from '../lib/types'
import { CHART, STRATEGY, STRATEGY_KEYS, statusInfo, decisionLabel } from '../lib/constants'
import { cx, fmtDateK, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from './EChart'
import { Badge, Card, CardHeader, DataTable, Drawer, Empty, Facts, StatusBadge, btnCls, tbl } from './ui'
import { DecisionIcon } from './Gantt'

export default function RoomDrawer({
  open,
  onClose,
  day,
  meta,
  room,
  initial = ['ai', 'rule'],
}: {
  open: boolean
  onClose: () => void
  day: Day | undefined
  meta: Meta
  room: string | null
  initial?: StrategyKey[]
}) {
  const [sel, setSel] = useState<StrategyKey[]>(initial)
  const [showOdu, setShowOdu] = useState(false)
  const rm = room ? meta.rooms[room] : undefined

  const toggle = (k: StrategyKey) => setSel((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k]))

  const option = useMemo<EChartsOption | null>(() => {
    if (!day || !room) return null
    const r0 = 420
    const r1 = 1410
    const lo = meta.settings.comfort_low
    const hi = meta.settings.comfort_high
    const sessions = day.sessions.filter((s) => s.room === room)
    const keys = STRATEGY_KEYS.filter((k) => sel.includes(k) && day.strategies[k])
    const taSeries = keys.map((k) => ({
      name: `${STRATEGY[k].short} 실내`,
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { width: 2, color: STRATEGY[k].color },
      itemStyle: { color: STRATEGY[k].color },
      data: day.strategies[k]!.rooms[room].ta.map((v, i) => [i * 5 + 2.5, v]).filter((p) => p[0] >= r0 && p[0] <= r1),
      z: k === 'ai' ? 5 : 3,
    }))
    const wx = day.weather.actual
    const outdoor = {
      name: '외기',
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      showSymbol: false,
      lineStyle: { width: 1.5, color: CHART.outdoor, type: 'solid' as const },
      itemStyle: { color: CHART.outdoor },
      data: wx.t.map((v, h) => [h * 60 + 30, v]).filter((p) => p[0] >= r0 - 60 && p[0] <= r1 + 60),
      z: 1,
    }
    const band = {
      name: '쾌적 범위',
      type: 'line' as const,
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: CHART.comfortBand },
        label: { show: true, position: 'insideTopLeft' as const, color: CHART.comfortInk, fontSize: 11, formatter: `쾌적 범위 ${lo}–${hi}℃` },
        data: [[{ yAxis: lo }, { yAxis: hi }]] as never,
      },
    }
    const sessArea = {
      name: '강의',
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: [],
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(20,32,51,0.06)' },
        label: { show: false },
        data: sessions.map((s) => [{ xAxis: hm(s.start), name: s.title }, { xAxis: hm(s.end) }]) as never,
      },
    }
    const pSeries = keys.map((k) => ({
      name: `${STRATEGY[k].short} 전력`,
      type: 'line' as const,
      xAxisIndex: 1,
      yAxisIndex: 1,
      step: 'middle' as const,
      showSymbol: false,
      lineStyle: { width: 2, color: STRATEGY[k].color },
      itemStyle: { color: STRATEGY[k].color },
      data: day.strategies[k]!.rooms[room].p.map((v, i) => [i * 5 + 2.5, +(v / 1000).toFixed(2)]).filter((p) => p[0] >= r0 && p[0] <= r1),
    }))
    const all = keys.flatMap((k) => day.strategies[k]!.rooms[room].ta.slice(84, 283))
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
      axisLabel: { ...axisCommon.axisLabel, show, formatter: (v: number) => `${Math.floor(v / 60)}시` },
    })
    return {
      grid: [
        { left: 44, right: 16, top: 16, height: 200 },
        { left: 44, right: 16, top: 262, height: 110 },
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
          min: tmin,
          max: tmax,
          interval: step,
          name: '℃',
          ...axisCommon,
          nameTextStyle: { color: CHART.muted, fontSize: 11, padding: [0, 24, 0, 0] },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'kW',
          ...axisCommon,
          nameTextStyle: { color: CHART.muted, fontSize: 11, padding: [0, 24, 0, 0] },
        },
      ],
      series: [band, outdoor, ...taSeries, sessArea, ...pSeries] as never,
    }
  }, [day, room, sel, meta])

  if (!room || !rm) return null
  const sessions = day?.sessions.filter((s) => s.room === room) ?? []
  const vals = day?.validation.sessions.filter((v) => v.room === room) ?? []
  const decs = day?.decisions.filter((d) => d.room === room) ?? []
  const hist = (day?.history ?? []).filter((h) => h.room === room || (showOdu && h.device === rm.odu))

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={820}
      title={
        <span className="flex items-baseline gap-2">
          {room}호 <span className="text-[13.5px] font-medium text-ink-3">{rm.type_label}</span>
        </span>
      }
      sub={
        day ? (
          <Facts>
            {fmtDateK(day.date)}
            {`정원 ${rm.capacity}명`}
            {`${rm.area}㎡`}
            {`실내기 ${rm.idus.length}대`}
            {`${rm.odu.replace('ODU-', '실외기 ')} 연결`}
          </Facts>
        ) : (
          '불러오는 중…'
        )
      }
      right={
        day && (
          <a href={`/api/export/plan.csv?date=${day.date}&strategy=ai`} className={btnCls('secondary', 'md')} download>
            <Download size={14} /> 운전 계획 CSV
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
        <div className="space-y-4">
          {/* strategy toggles: one strip, pressed = drawn in the chart */}
          <div className="overflow-hidden rounded-[10px] border border-line bg-line" role="group" aria-label="차트에 그릴 운전 방식">
            <div className="grid grid-cols-4 gap-px">
              {STRATEGY_KEYS.map((k) => {
                const rd = day.strategies[k]?.rooms[room]
                const on = sel.includes(k)
                const comfortVals = rd?.sessions ?? []
                const occ = comfortVals.reduce((a, s) => a + s.minutes, 0)
                const inb = comfortVals.reduce((a, s) => a + s.in_band_minutes, 0)
                return (
                  <button
                    key={k}
                    onClick={() => toggle(k)}
                    aria-pressed={on}
                    className={cx('relative bg-surface px-4 pt-3.5 pb-3 text-left transition-colors', on ? '' : 'hover:bg-well')}
                    title={on ? '차트에서 숨기기' : '차트에 표시'}
                  >
                    <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: on ? STRATEGY[k].color : 'transparent' }} aria-hidden />
                    <div className={cx('flex items-center gap-1.5 text-[12.5px] font-medium', on ? 'text-ink' : 'text-ink-3')}>
                      <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: on ? STRATEGY[k].color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${STRATEGY[k].color}` }} aria-hidden />
                      {STRATEGY[k].label}
                    </div>
                    <div className={cx('pnum mt-1.5 text-[20px] font-[650] tracking-[-0.02em]', on ? 'text-ink' : 'text-ink-3')}>
                      {fmtKwh(rd?.kwh ?? 0)} <span className="text-[12px] font-medium text-ink-3">kWh</span>
                    </div>
                    <div className="tnum mt-0.5 text-[12px] text-ink-3">
                      가동 {fmtDuration(rd?.on_minutes ?? 0)}, 쾌적 {occ ? `${((inb / occ) * 100).toFixed(0)}%` : '–'}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <Card>
            <CardHeader
              title="실내온도·전력 추이"
              sub="5분 간격 시뮬레이션입니다. 회색 띠는 강의 시간, 옅은 띠는 쾌적 범위이고, 위의 운전 방식을 눌러 선을 켜고 끕니다."
            />
            <div className="-mt-1 mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
              {STRATEGY_KEYS.filter((k) => sel.includes(k)).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: STRATEGY[k].color }} />
                  {STRATEGY[k].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: CHART.outdoor }} />
                외기온도 <span className="text-ink-3">{day.weather.src_actual}</span>
              </span>
            </div>
            {option && <EChart option={option} height={392} />}
          </Card>

          <Card>
            <CardHeader title="강의별 검증 결과" sub="계획에 들어갔는지, 실제로 가동했는지, 시작 시 실내온도와 쾌적 유지율입니다." />
            {vals.length === 0 ? (
              <Empty title="이 날은 이 강의실에 강의가 없습니다" desc="강의가 없으면 AI는 냉난방을 켜지 않습니다." />
            ) : (
              <div className={tbl.frame}>
                <table className={tbl.table}>
                  <thead className={tbl.thead}>
                    <tr>
                      <th className={tbl.th}>강의</th>
                      <th className={tbl.th}>시간</th>
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
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink">{v.title}</div>
                            <div className="text-[12px] text-ink-3">
                              {[s?.professor, `${s?.expected_people ?? '–'}명`].filter(Boolean).join(', ')}
                            </div>
                            {v.decisions.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {v.decisions.map((d) => (
                                  <Badge key={d} tone="ai">
                                    <DecisionIcon type={d} size={10} />
                                    {decisionLabel(d)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                            {v.start}–{v.end}
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge group={info.group} label={info.label} />
                            {v.notes.map((n, i) => (
                              <div key={i} className="mt-1 text-[12px] text-ink-2">
                                {n}
                              </div>
                            ))}
                          </td>
                          <td className="px-3 py-2 text-right">{v.exec_ratio != null ? `${(v.exec_ratio * 100).toFixed(0)}%` : '–'}</td>
                          <td className="px-3 py-2 text-right">{v.ta_start != null ? `${v.ta_start.toFixed(1)}℃` : '–'}</td>
                          <td className="px-3 py-2 text-right">{v.comfort_pct != null ? `${v.comfort_pct.toFixed(0)}%` : '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {decs.length > 0 && (
            <Card>
              <CardHeader title="AI 판단 근거" sub="열모델과 예보로 계산한 이 강의실의 운전 결정입니다." />
              <ul className="divide-y divide-line">
                {decs.map((d, i) => (
                  <li key={i} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                      <DecisionIcon type={d.type} size={12} />
                    </span>
                    <div className="text-[13px]">
                      <div className="font-semibold text-ink">
                        {decisionLabel(d.type)}{' '}
                        <span className="tnum font-normal text-ink-3">
                          {d.title} {d.start}–{d.end}
                        </span>
                      </div>
                      <div className="text-ink-2">{d.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              title="설비 On/Off 이력"
              icon={<History size={16} />}
              sub="AI 운전 기준으로 실내기에 보낸 켜기·끄기 명령입니다."
              right={
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                  <input type="checkbox" checked={showOdu} onChange={(e) => setShowOdu(e.target.checked)} className="h-3.5 w-3.5 accent-[#142033]" />
                  실외기({rm.odu}) 포함
                </label>
              }
            />
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
          </Card>
        </div>
      )}
    </Drawer>
  )
}
