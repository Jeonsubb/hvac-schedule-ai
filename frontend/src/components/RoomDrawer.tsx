import { useMemo, useState } from 'react'
import { Download, History } from 'lucide-react'
import type { Day, Meta, StrategyKey } from '../lib/types'
import { CHART, STRATEGY, STRATEGY_KEYS, statusInfo, decisionLabel } from '../lib/constants'
import { cx, fmtDateK, fmtDuration, fmtKwh, fmtMin, hm } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from './EChart'
import { Badge, Card, CardHeader, DataTable, Drawer, Empty, StatusBadge } from './ui'
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
        label: { show: true, position: 'insideTopLeft' as const, color: '#0d7a55', fontSize: 10.5, formatter: `쾌적 ${lo}–${hi}℃` },
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
        itemStyle: { color: 'rgba(51,65,85,0.07)' },
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
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#898781' } },
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
          nameTextStyle: { color: CHART.muted, fontSize: 11, padding: [0, 24, 0, 0] },
          ...axisCommon,
        },
        {
          type: 'value',
          gridIndex: 1,
          name: 'kW',
          nameTextStyle: { color: CHART.muted, fontSize: 11, padding: [0, 24, 0, 0] },
          ...axisCommon,
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
        <span className="flex items-center gap-2">
          {room}호 <span className="text-[13px] font-normal text-ink-3">· {rm.type_label}</span>
        </span>
      }
      sub={
        day
          ? `${fmtDateK(day.date)} · 정원 ${rm.capacity}명 · ${rm.area}㎡ · 실내기 ${rm.idus.length}대 → ${rm.odu}`
          : '불러오는 중…'
      }
      right={
        day && (
          <a
            href={`/api/export/plan.csv?date=${day.date}&strategy=ai`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdbd4] bg-white px-3 text-[12.5px] font-medium text-ink hover:bg-[#f6f6f3]"
            download
          >
            <Download size={14} /> 운전 계획 CSV
          </a>
        )
      }
    >
      {!day ? (
        <Empty title="데이터를 불러오는 중입니다" />
      ) : (
        <div className="space-y-4">
          {/* strategy tiles (toggle) */}
          <div className="grid grid-cols-4 gap-2.5">
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
                  className={cx(
                    'rounded-xl border bg-white px-3 py-2.5 text-left transition',
                    on ? 'border-ink/70 shadow-[0_0_0_1px_rgba(11,11,11,0.6)]' : 'border-line opacity-70 hover:opacity-100',
                  )}
                  title="차트에 표시/숨기기"
                >
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STRATEGY[k].color }} />
                    {STRATEGY[k].label}
                  </div>
                  <div className="mt-1 text-[19px] font-semibold text-ink">
                    {fmtKwh(rd?.kwh ?? 0)} <span className="text-[12px] font-normal text-ink-3">kWh</span>
                  </div>
                  <div className="tnum text-[11.5px] text-ink-3">
                    가동 {fmtDuration(rd?.on_minutes ?? 0)} · 쾌적 {occ ? `${((inb / occ) * 100).toFixed(0)}%` : '–'}
                  </div>
                </button>
              )
            })}
          </div>

          <Card>
            <CardHeader
              title="실내온도·전력 추이"
              sub="5분 해상도 · 회색 띠는 강의 시간, 초록 띠는 쾌적 범위 · 위 카드를 눌러 전략을 켜고 끕니다"
            />
            <div className="-mt-2 mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
              {STRATEGY_KEYS.filter((k) => sel.includes(k)).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: STRATEGY[k].color }} />
                  {STRATEGY[k].label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: CHART.outdoor }} />
                외기온도 ({day.weather.src_actual})
              </span>
            </div>
            {option && <EChart option={option} height={392} />}
          </Card>

          <Card>
            <CardHeader title="강의별 검증 결과" sub="계획 반영 여부와 실제 실행, 시작 시 실내온도, 쾌적 유지율" />
            {vals.length === 0 ? (
              <Empty title="이 날 이 강의실의 강의가 없습니다" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="tnum w-full text-[12.5px]">
                  <thead className="bg-[#f6f6f3] text-ink-2">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">강의</th>
                      <th className="px-3 py-2 text-left font-semibold">시간</th>
                      <th className="px-3 py-2 text-left font-semibold">상태</th>
                      <th className="px-3 py-2 text-right font-semibold">실행률</th>
                      <th className="px-3 py-2 text-right font-semibold">시작 온도</th>
                      <th className="px-3 py-2 text-right font-semibold">쾌적</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vals.map((v) => {
                      const info = statusInfo(v.status)
                      const s = sessions.find((x) => x.id === v.session)
                      return (
                        <tr key={v.session} className="border-t border-line align-top">
                          <td className="px-3 py-2">
                            <div className="font-medium text-ink">{v.title}</div>
                            <div className="text-[11.5px] text-ink-3">
                              {s?.professor ?? ''} · {s?.expected_people ?? '–'}명
                            </div>
                            {v.decisions.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {v.decisions.map((d) => (
                                  <Badge key={d} tone="brand">
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
                              <div key={i} className="mt-1 text-[11.5px] text-ink-2">
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
              <CardHeader title="AI 판단 근거" sub="열모델과 예보로 계산한 이 강의실의 운전 결정" />
              <ul className="space-y-2">
                {decs.map((d, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-line px-3 py-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                      <DecisionIcon type={d.type} size={12} />
                    </span>
                    <div className="text-[12.5px]">
                      <div className="font-semibold text-ink">
                        {decisionLabel(d.type)} <span className="font-normal text-ink-3">· {d.title} {d.start}–{d.end}</span>
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
              icon={<History size={15} />}
              sub="AI 운전 기준 실내기 명령 기록"
              right={
                <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                  <input type="checkbox" checked={showOdu} onChange={(e) => setShowOdu(e.target.checked)} className="accent-[#0f766e]" />
                  실외기({rm.odu}) 포함
                </label>
              }
            />
            {hist.length === 0 ? (
              <Empty title="기록이 없습니다" />
            ) : (
              <DataTable
                maxHeight={300}
                spec={{
                  columns: ['시각', '장치', '상태', '원인'],
                  align: ['left', 'left', 'left', 'left'],
                  rows: hist.map((h) => [h.t, h.device, h.state === 'ON' ? 'On' : h.state === 'OFF' ? 'Off' : h.state, h.cause]),
                }}
              />
            )}
          </Card>
        </div>
      )}
    </Drawer>
  )
}
