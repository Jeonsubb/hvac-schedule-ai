import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, CustomChart, HeatmapChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  DataZoomComponent,
  VisualMapComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { CHART } from '../lib/constants'

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  CustomChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  DataZoomComponent,
  VisualMapComponent,
  TitleComponent,
  CanvasRenderer,
])

export type { EChartsOption }

export const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'

/** Shared chrome: recessive hairline grid, muted axis text, white tooltip with value-first rows. */
export const baseTooltip = {
  backgroundColor: '#ffffff',
  borderColor: 'rgba(11,11,11,0.10)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: CHART.ink, fontSize: 12, fontFamily: FONT },
  extraCssText: 'box-shadow: 0 4px 16px rgba(11,11,11,0.10); border-radius: 8px;',
}

export const axisCommon = {
  axisLine: { lineStyle: { color: CHART.axis } },
  axisTick: { show: false },
  axisLabel: { color: CHART.muted, fontSize: 11, fontFamily: FONT },
  splitLine: { lineStyle: { color: CHART.grid, width: 1 } },
}

/** tooltip row with a short line key (series color) — value leads, label follows */
export function ttRow(color: string, label: string, value: string, kind: 'line' | 'rect' = 'line') {
  const key =
    kind === 'line'
      ? `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle"></span>`
      : `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle"></span>`
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;line-height:1.7">
    <span style="color:#52514e">${key}${escapeHtml(label)}</span><b style="color:#0b0b0b;font-variant-numeric:tabular-nums">${value}</b></div>`
}

export function ttTitle(t: string) {
  return `<div style="font-weight:600;color:#0b0b0b;margin-bottom:3px">${escapeHtml(t)}</div>`
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export default function EChart({
  option,
  height = 280,
  onEvents,
  className,
  notMerge = true,
}: {
  option: EChartsOption
  height?: number
  onEvents?: Record<string, (params: unknown) => void>
  className?: string
  notMerge?: boolean
}) {
  return (
    <ReactEChartsCore
      echarts={echarts}
      option={{ animationDuration: 400, textStyle: { fontFamily: FONT }, ...option }}
      notMerge={notMerge}
      lazyUpdate
      style={{ height, width: '100%' }}
      className={className}
      onEvents={onEvents}
      opts={{ renderer: 'canvas' }}
    />
  )
}
