import { useMemo, useState } from 'react'
import { ArrowRight, Building, FileText, Leaf, MoveRight, Sparkles, Printer } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta, useCopilot } from '../lib/context'
import type { Consolidation, StrategyKey, Summary, TotalsRow } from '../lib/types'
import { CHART, DECISION, STRATEGY, STRATEGY_KEYS } from '../lib/constants'
import { cx, fmtDateShort, fmtKwh, fmtNum, fmtPct, pctSaving } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { Badge, Button, Card, CardHeader, ChartCard, ErrorBox, LegendItem, Loading, PageHeader, Segmented } from '../components/ui'
import { DecisionIcon } from '../components/Gantt'

type Scope = 'to_date' | 'all'

export default function Energy() {
  const { meta } = useMeta()
  const summary = useApi<Summary>('/api/summary')
  const [scope, setScope] = useState<Scope>('to_date')

  if (summary.error) return <ErrorBox error={summary.error} onRetry={summary.reload} />
  if (!summary.data || !meta) return <Loading label="학기 전체 시뮬레이션 결과를 불러오는 중…" />
  const S = summary.data
  const T = S.totals[scope]

  return (
    <div className="space-y-5">
      <PageHeader
        title="절감 효과"
        desc="같은 시간표·같은 날씨로 4가지 운전 방식을 시뮬레이션해 전력·요금·탄소·쾌적도를 비교합니다."
        right={
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'to_date', label: `오늘까지 (09/01–${S.today.slice(5).replace('-', '/')})` },
              { value: 'all', label: '학기 전체 (예상 포함)' },
            ]}
          />
        }
      />

      <Hero T={T} scope={scope} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
          <StrategyTile key={k} k={k} T={T} />
        ))}
      </div>

      <DailyChart S={S} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <CumulativeChart S={S} />
        <ScatterChart T={T} scope={scope} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <DecisionChart S={S} />
        <ConsolidationReport />
      </div>
    </div>
  )
}

function Hero({ T, scope }: { T: Record<StrategyKey, TotalsRow>; scope: Scope }) {
  const vsFixed = pctSaving(T.fixed.kwh, T.ai.kwh) ?? 0
  const vsRule = pctSaving(T.rule.kwh, T.ai.kwh) ?? 0
  return (
    <Card className="overflow-hidden" pad={false}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="border-b border-line p-6 lg:border-r lg:border-b-0">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-s-ai" />
            AI 예측 제어 · 고정 스케줄 대비 전력 절감 {scope === 'all' && <Badge tone="info">학기 전체 예상</Badge>}
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[56px] leading-none font-bold tracking-tight text-ink">{vsFixed.toFixed(1)}</span>
            <span className="text-[22px] font-semibold text-ink-3">%</span>
          </div>
          <p className="mt-3 max-w-[520px] text-[13.5px] leading-relaxed text-ink-2">
            고정 스케줄로 운영했다면 <b className="text-ink">{fmtNum(T.fixed.kwh)} kWh</b>를 썼을 IT관 10개 강의실을{' '}
            <b className="text-ink">{fmtNum(T.ai.kwh)} kWh</b>로 운영했습니다. 강의 중 쾌적 유지율은{' '}
            <b className="text-ink">{fmtPct(T.ai.comfort_pct, 2)}</b>입니다.
          </p>
        </div>
        <div className="grid grid-cols-2">
          <HeroCell
            label="규칙 기반 대비 추가 절감"
            value={`${vsRule.toFixed(1)}%`}
            sub={`${fmtNum(T.rule.kwh - T.ai.kwh)} kWh · 쾌적 ${fmtPct(T.rule.comfort_pct, 2)} → ${fmtPct(T.ai.comfort_pct, 2)}`}
          />
          <HeroCell label="절감 요금 (고정 대비)" value={`${fmtNum((T.fixed.cost_krw - T.ai.cost_krw) / 10000, 1)}만원`} sub="한전 교육용(을) 고압A 선택I" />
          <HeroCell
            label="감축 탄소 (고정 대비)"
            value={`${((T.fixed.co2_kg - T.ai.co2_kg) / 1000).toFixed(2)} tCO₂`}
            sub="배출계수 0.4173 kgCO₂/kWh"
            border
          />
          <HeroCell
            label="가동 시간 (실내기 기준)"
            value={`−${fmtNum(((T.fixed.on_minutes - T.ai.on_minutes) / 60))}시간`}
            sub={`고정 ${fmtNum(T.fixed.on_minutes / 60)}h → AI ${fmtNum(T.ai.on_minutes / 60)}h`}
            border
          />
        </div>
      </div>
    </Card>
  )
}

function HeroCell({ label, value, sub, border }: { label: string; value: string; sub: string; border?: boolean }) {
  return (
    <div className={cx('p-5 odd:border-r odd:border-line', border && 'border-t border-line')}>
      <div className="text-[12.5px] font-medium text-ink-2">{label}</div>
      <div className="mt-1 text-[24px] font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-1 text-[11.5px] text-ink-3">{sub}</div>
    </div>
  )
}

function StrategyTile({ k, T }: { k: StrategyKey; T: Record<StrategyKey, TotalsRow> }) {
  const v = T[k]
  const sv = pctSaving(T.fixed.kwh, v.kwh)
  const rows: [string, string][] = [
    ['요금', `${fmtNum(v.cost_krw)}원`],
    ['탄소', `${(v.co2_kg / 1000).toFixed(2)} tCO₂`],
    ['최대 전력', `${v.peak_kw.toFixed(1)} kW`],
    ['쾌적 유지율', fmtPct(v.comfort_pct, 2)],
    ['불쾌 누적', `${fmtNum(v.discomfort_dm, 0)} ℃·분`],
  ]
  return (
    <div className={cx('rounded-xl border bg-white p-4', k === 'ai' ? 'border-s-ai shadow-[0_0_0_1px_#1baf7a]' : 'border-line')}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STRATEGY[k].color }} />
          {STRATEGY[k].label}
        </span>
        {k === 'ai' ? <Badge tone="brand">운영 중</Badge> : k === 'fixed' ? <Badge>비교 기준</Badge> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[24px] font-semibold tracking-tight text-ink">{fmtNum(v.kwh)}</span>
        <span className="text-[12px] text-ink-3">kWh</span>
        {k !== 'fixed' && sv != null && <span className="ml-auto text-[12.5px] font-semibold text-good-ink">−{sv.toFixed(1)}%</span>}
      </div>
      <dl className="tnum mt-2 space-y-1 border-t border-line pt-2 text-[12px]">
        {rows.map(([a, b]) => (
          <div key={a} className="flex justify-between">
            <dt className="text-ink-3">{a}</dt>
            <dd className="font-medium text-ink">{b}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 text-[11px] leading-snug text-ink-3">{STRATEGY[k].desc}</div>
    </div>
  )
}

function DailyChart({ S }: { S: Summary }) {
  const days = S.days.filter((d) => d.sessions > 0)
  const todayIdx = days.findIndex((d) => d.date > S.today)
  const option = useMemo<EChartsOption>(() => {
    const cats = days.map((d) => d.date)
    const futureStart = todayIdx >= 0 ? cats[todayIdx] : null
    return {
      grid: [
        { left: 48, right: 20, top: 16, height: 230 },
        { left: 48, right: 20, top: 290, height: 80 },
      ],
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#898781' } },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; dataIndex: number }[]
          if (!arr.length) return ''
          const d = days[arr[0].dataIndex]
          let h = ttTitle(`${fmtDateShort(d.date)} (${'월화수목금토일'[d.weekday]})${d.date > S.today ? ' · 예상' : ''}`)
          for (const k of ['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]) h += ttRow(STRATEGY[k].color, STRATEGY[k].label, `${fmtKwh(d.strategies[k].kwh)} kWh`)
          h += ttRow(CHART.outdoor, '외기 평균', `${d.t_mean.toFixed(1)}℃ (${d.t_min.toFixed(0)}~${d.t_max.toFixed(0)})`)
          return h
        },
      },
      xAxis: [
        { type: 'category', data: cats, gridIndex: 0, ...axisCommon, axisLabel: { show: false }, axisTick: { show: false } },
        {
          type: 'category',
          data: cats,
          gridIndex: 1,
          ...axisCommon,
          axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmtDateShort(v), interval: 'auto' },
        },
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, name: 'kWh/일', nameTextStyle: { color: CHART.muted, fontSize: 11, align: 'left' }, ...axisCommon, axisLine: { show: false } },
        {
          type: 'value',
          gridIndex: 1,
          name: '외기 ℃',
          nameTextStyle: { color: CHART.muted, fontSize: 11, align: 'left' },
          ...axisCommon,
          axisLine: { show: false },
          splitNumber: 2,
        },
      ],
      series: [
        ...(['fixed', 'manual', 'rule', 'ai'] as StrategyKey[]).map((k) => ({
          name: STRATEGY[k].label,
          type: 'line' as const,
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          lineStyle: { width: 2, color: STRATEGY[k].color },
          itemStyle: { color: STRATEGY[k].color },
          data: days.map((d) => d.strategies[k].kwh),
          z: k === 'ai' ? 6 : 3,
          ...(k === 'fixed' && futureStart
            ? {
                markArea: {
                  silent: true,
                  itemStyle: { color: 'rgba(137,135,129,0.07)' },
                  label: { show: true, position: 'insideTop' as const, color: CHART.muted, fontSize: 11, formatter: '예보·평년 기반 예상' },
                  data: [[{ xAxis: futureStart }, { xAxis: cats[cats.length - 1] }]] as never,
                },
              }
            : {}),
        })),
        {
          name: '최저~최고',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: 'tband',
          showSymbol: false,
          lineStyle: { opacity: 0 },
          data: days.map((d) => d.t_min),
          tooltip: { show: false },
        },
        {
          name: '기온 범위',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: 'tband',
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(137,135,129,0.18)' },
          data: days.map((d) => +(d.t_max - d.t_min).toFixed(1)),
          tooltip: { show: false },
        },
        {
          name: '외기 평균',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          lineStyle: { width: 1.5, color: CHART.outdoor },
          itemStyle: { color: CHART.outdoor },
          data: days.map((d) => d.t_mean),
        },
      ] as never,
    }
  }, [days, todayIdx, S.today])

  return (
    <ChartCard
      title="일별 전력량과 외기온도"
      sub="강의일 기준 · 냉방철(9월)과 난방철(11~12월) 사이 간절기에는 AI가 외기 냉방·가동 생략으로 전력을 크게 줄입니다"
      legend={
        <>
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
            <LegendItem key={k} color={STRATEGY[k].color} label={STRATEGY[k].label} kind="line" />
          ))}
          <LegendItem color={CHART.outdoor} label="외기 평균(띠: 최저~최고) — 아래 칸" kind="line" />
        </>
      }
      table={{
        columns: ['날짜', 'AI', '규칙', '수동', '고정', '외기 평균℃'],
        rows: days.map((d) => [
          `${d.date}${d.date > S.today ? ' (예상)' : ''}`,
          d.strategies.ai.kwh.toFixed(1),
          d.strategies.rule.kwh.toFixed(1),
          d.strategies.manual.kwh.toFixed(1),
          d.strategies.fixed.kwh.toFixed(1),
          d.t_mean.toFixed(1),
        ]),
      }}
    >
      <EChart option={option} height={392} />
    </ChartCard>
  )
}

function CumulativeChart({ S }: { S: Summary }) {
  const option = useMemo<EChartsOption>(() => {
    let a = 0
    let b = 0
    const vsFixed: number[] = []
    const vsRule: number[] = []
    for (const d of S.days) {
      a += d.strategies.fixed.kwh - d.strategies.ai.kwh
      b += d.strategies.rule.kwh - d.strategies.ai.kwh
      vsFixed.push(+a.toFixed(1))
      vsRule.push(+b.toFixed(1))
    }
    const cats = S.days.map((d) => d.date)
    return {
      grid: { left: 52, right: 64, top: 28, bottom: 28 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; axisValue: string }[]
          let h = ttTitle(`${arr[0].axisValue}까지 누적${arr[0].axisValue > S.today ? ' (예상)' : ''}`)
          for (const p of arr) h += ttRow(p.color, p.seriesName, `${fmtNum(p.value)} kWh`)
          return h
        },
      },
      xAxis: { type: 'category', data: cats, ...axisCommon, axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmtDateShort(v) } },
      yAxis: {
        type: 'value',
        name: '누적 절감 kWh',
        nameTextStyle: { color: CHART.muted, fontSize: 11, align: 'left' },
        min: (v: { min: number }) => Math.floor(Math.min(0, v.min) / 100) * 100,
        ...axisCommon,
        axisLine: { show: false },
      },
      series: [
        {
          name: '고정 스케줄 대비',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2, color: STRATEGY.fixed.color },
          itemStyle: { color: STRATEGY.fixed.color },
          areaStyle: { color: 'rgba(82,81,78,0.06)' },
          data: vsFixed,
          endLabel: { show: true, formatter: (p: { value: number }) => `${fmtNum(p.value)}`, color: CHART.ink, fontSize: 11, fontWeight: 600 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: CHART.ink, width: 1, type: 'solid' },
            label: { formatter: '오늘', color: CHART.ink2, fontSize: 11, position: 'end', rotate: 0 },
            data: [{ xAxis: S.today }],
          },
        },
        {
          name: '규칙 기반 대비',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2, color: STRATEGY.rule.color },
          itemStyle: { color: STRATEGY.rule.color },
          data: vsRule,
          endLabel: { show: true, formatter: (p: { value: number }) => `${fmtNum(p.value)}`, color: CHART.ink, fontSize: 11, fontWeight: 600 },
        },
      ] as never,
    }
  }, [S])
  const last = S.days.length - 1
  return (
    <ChartCard
      title="AI 누적 절감량"
      sub="AI 예측 제어가 각 방식보다 덜 쓴 전력의 누적 · 오늘 이후는 예상"
      legend={
        <>
          <LegendItem color={STRATEGY.fixed.color} label="고정 스케줄 대비" kind="line" />
          <LegendItem color={STRATEGY.rule.color} label="규칙 기반 대비" kind="line" />
        </>
      }
      table={{
        columns: ['기준', '오늘까지 누적 kWh', '학기 말 예상 kWh'],
        rows: [
          ['고정 스케줄 대비', +(S.totals.to_date.fixed.kwh - S.totals.to_date.ai.kwh).toFixed(1), +(S.totals.all.fixed.kwh - S.totals.all.ai.kwh).toFixed(1)],
          ['규칙 기반 대비', +(S.totals.to_date.rule.kwh - S.totals.to_date.ai.kwh).toFixed(1), +(S.totals.all.rule.kwh - S.totals.all.ai.kwh).toFixed(1)],
        ],
      }}
      footer={
        <div className="mt-2 text-[11.5px] text-ink-3">
          {S.days[last] && `학기 말(${fmtDateShort(S.days[last].date)})까지 고정 대비 ${fmtNum(S.totals.all.fixed.kwh - S.totals.all.ai.kwh)} kWh, 규칙 대비 ${fmtNum(S.totals.all.rule.kwh - S.totals.all.ai.kwh)} kWh 절감 예상`}
        </div>
      }
    >
      <EChart option={option} height={260} />
    </ChartCard>
  )
}

function ScatterChart({ T, scope }: { T: Record<StrategyKey, TotalsRow>; scope: Scope }) {
  const option = useMemo<EChartsOption>(() => {
    const ks = STRATEGY_KEYS
    const minC = Math.min(...ks.map((k) => T[k].comfort_pct ?? 100))
    return {
      grid: { left: 44, right: 16, top: 24, bottom: 44 },
      tooltip: {
        ...baseTooltip,
        trigger: 'item',
        formatter: (p: unknown) => {
          const q = p as { data: { k: StrategyKey; value: number[] } }
          const k = q.data.k
          return (
            ttTitle(STRATEGY[k].label) +
            ttRow(STRATEGY[k].color, '전력량', `${fmtNum(T[k].kwh)} kWh`, 'rect') +
            ttRow(STRATEGY[k].color, '쾌적 유지율', fmtPct(T[k].comfort_pct, 2), 'rect') +
            ttRow(STRATEGY[k].color, '불쾌 누적', `${fmtNum(T[k].discomfort_dm)} ℃·분`, 'rect')
          )
        },
      },
      xAxis: {
        type: 'value',
        name: '전력량 (kWh) →  적을수록 좋음',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: CHART.muted, fontSize: 11 },
        min: 0,
        ...axisCommon,
      },
      yAxis: {
        type: 'value',
        name: '쾌적 유지율 (%) ↑ 높을수록 좋음',
        nameTextStyle: { color: CHART.muted, fontSize: 11, align: 'left' },
        min: Math.floor(minC - 0.5),
        max: 100.4,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => (v > 100 ? '' : `${v}`) },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 16,
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
          data: ks.map((k) => ({
            k,
            value: [T[k].kwh, T[k].comfort_pct ?? 0],
            itemStyle: { color: STRATEGY[k].color },
            label: {
              show: true,
              formatter: STRATEGY[k].short,
              position: k === 'fixed' ? 'left' : k === 'rule' ? 'right' : 'top',
              color: CHART.ink,
              fontSize: 11.5,
              lineHeight: 15,
              fontWeight: k === 'ai' ? 600 : 400,
              distance: 10,
            },
          })),
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(27,175,122,0.06)' },
            label: { show: true, position: 'insideBottomLeft', color: '#0d7a55', fontSize: 11, formatter: '이상적인 영역: 적게 쓰고 쾌적' },
            data: [[{ xAxis: 0, yAxis: 99.5 }, { xAxis: T.ai.kwh * 1.15, yAxis: 100.4 }]] as never,
          },
        },
      ] as never,
    }
  }, [T])
  return (
    <ChartCard
      title="전력 vs 쾌적 — 절감이 쾌적을 희생했는가?"
      sub={`${scope === 'all' ? '학기 전체(예상)' : '오늘까지'} · 왼쪽 위로 갈수록 좋은 운전 방식`}
      legend={STRATEGY_KEYS.map((k) => (
        <LegendItem key={k} color={STRATEGY[k].color} label={STRATEGY[k].label} kind="dot" />
      ))}
      table={{
        columns: ['전략', '전력량 kWh', '쾌적 유지율 %', '불쾌 누적 ℃·분'],
        rows: STRATEGY_KEYS.map((k) => [STRATEGY[k].label, T[k].kwh, T[k].comfort_pct, T[k].discomfort_dm]),
      }}
    >
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <EChart option={option} height={286} />
        </div>
        <ul className="tnum w-[150px] shrink-0 space-y-2 self-center text-[12px]">
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
            <li key={k} className={cx('rounded-lg border px-2.5 py-1.5', k === 'ai' ? 'border-s-ai' : 'border-line')}>
              <div className="flex items-center gap-1.5 font-medium text-ink">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STRATEGY[k].color }} />
                {STRATEGY[k].label}
              </div>
              <div className="mt-0.5 flex justify-between text-ink-2">
                <span>{fmtNum(T[k].kwh)} kWh</span>
                <span className="font-semibold text-ink">{fmtPct(T[k].comfort_pct, 2)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  )
}

function DecisionChart({ S }: { S: Summary }) {
  const entries = Object.entries(S.decisions).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const max = Math.max(1, ...entries.map(([, v]) => v))
  return (
    <ChartCard
      title="AI 판단 유형별 횟수"
      sub={`학기 전체 ${fmtNum(total)}회 · 강의마다 열모델로 판단`}
      table={{ columns: ['판단', '횟수'], rows: entries.map(([k, v]) => [DECISION[k]?.label ?? k, v]) }}
    >
      <ul className="space-y-3">
        {entries.map(([k, v]) => (
          <li key={k}>
            <div className="mb-1 flex items-center justify-between text-[12.5px]">
              <span className="flex items-center gap-1.5 font-medium text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                  <DecisionIcon type={k} size={10} />
                </span>
                {DECISION[k]?.label ?? k}
              </span>
              <span className="tnum font-semibold text-ink">{fmtNum(v)}회</span>
            </div>
            <div className="h-2 rounded-full bg-[#f0efec]" title={`${DECISION[k]?.label}: ${v}회`}>
              <div className="h-2 rounded-full bg-s-ai" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="mt-0.5 text-[11px] text-ink-3">{DECISION[k]?.desc}</div>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

function ConsolidationReport() {
  const c = useApi<Consolidation>('/api/consolidation', { maxAgeMs: 10 * 60_000 })
  const { ask } = useCopilot()
  const { meta } = useMeta()
  const withMoves = c.data?.weekdays.filter((w) => w.moves.length > 0) ?? []
  return (
    <Card>
      <CardHeader
        title="강의실 재배치 권고 (학사 부서 검토용)"
        icon={<FileText size={15} />}
        sub="같은 유형·정원 충족·시간이 빈 강의실로 옮겨 실외기 가동을 줄이는 방안"
        right={
          <>
            <Button size="sm" variant="ghost" onClick={() => ask('금요일 강의실 재배치로 얼마나 절감돼? 이유와 함께 설명해줘')}>
              <Sparkles size={13} /> 코파일럿 설명
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer size={13} /> 인쇄
            </Button>
          </>
        }
      />
      {c.error ? (
        <ErrorBox error={c.error} onRetry={c.reload} />
      ) : !c.data ? (
        <Loading label="요일별 재배치 시나리오를 학기 전체로 다시 시뮬레이션하는 중… (약 5초)" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-brand-50 px-4 py-3">
            <div>
              <div className="text-[12px] font-medium text-brand">학기 예상 추가 절감</div>
              <div className="text-[24px] font-semibold text-ink">
                {fmtNum(c.data.semester_kwh_saving, 1)} <span className="text-[13px] font-normal text-ink-3">kWh</span>
              </div>
            </div>
            <div className="h-10 w-px bg-[#bfe6d6]" />
            <div className="text-[12.5px] text-ink-2">
              <div>
                권고 이동 <b className="text-ink">{withMoves.reduce((a, w) => a + w.moves.length, 0)}건</b> · 대상 요일{' '}
                <b className="text-ink">{withMoves.map((w) => w.weekday_label).join('·') || '없음'}</b>
              </div>
              <div className="text-ink-3">쾌적 유지율 변화 없음 · AI 운전 기준 재시뮬레이션</div>
            </div>
          </div>
          {withMoves.length === 0 && <div className="text-[13px] text-ink-3">현재 시간표로는 권고할 재배치가 없습니다.</div>}
          {withMoves.map((w) => (
            <div key={w.weekday} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#fafaf8] px-4 py-2.5">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <Building size={14} className="text-ink-3" />
                  매주 {w.weekday_label}요일
                  <span className="font-normal text-ink-3">· 학기 중 {w.dates}회</span>
                </div>
                <div className="tnum flex items-center gap-3 text-[12px] text-ink-2">
                  <span>
                    {fmtNum(w.kwh_before, 1)} → <b className="text-ink">{fmtNum(w.kwh_after, 1)} kWh</b>
                  </span>
                  <Badge tone="good">
                    <Leaf size={11} /> −{fmtNum(w.kwh_saving, 1)} kWh ({fmtPct(w.saving_pct)})
                  </Badge>
                  {w.odu_minutes_before != null && w.odu_minutes_after != null && (
                    <span className="text-ink-3">
                      실외기 가동 {fmtNum(w.odu_minutes_before / 60, 1)}h → {fmtNum(w.odu_minutes_after / 60, 1)}h
                    </span>
                  )}
                </div>
              </div>
              <table className="tnum w-full text-[12.5px]">
                <thead className="text-ink-3">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">강의</th>
                    <th className="px-2 py-2 text-left font-medium">시간</th>
                    <th className="px-2 py-2 text-left font-medium">이동</th>
                    <th className="px-2 py-2 text-left font-medium">실외기</th>
                    <th className="px-4 py-2 text-right font-medium">인원/정원</th>
                  </tr>
                </thead>
                <tbody>
                  {w.moves.map((m) => (
                    <tr key={m.course_id + m.start} className="border-t border-line">
                      <td className="px-4 py-2">
                        <div className="font-medium text-ink">{m.title}</div>
                        <div className="text-[11.5px] text-ink-3">{m.professor}</div>
                      </td>
                      <td className="px-2 py-2 text-ink-2">
                        {m.start}–{m.end}
                      </td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                          {m.from_room}호 <MoveRight size={13} className="text-ink-3" /> {m.to_room}호
                        </span>
                        <div className="text-[11px] text-ink-3">{meta?.rooms[m.to_room]?.type_label}</div>
                      </td>
                      <td className="px-2 py-2 text-[11.5px] text-ink-2">
                        {m.from_odu.replace('ODU-', '')} <ArrowRight size={10} className="inline" /> {m.to_odu.replace('ODU-', '')}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-2">
                        {m.expected_people}/{m.capacity}명
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="text-[11.5px] leading-relaxed text-ink-3">{c.data.note}</p>
        </div>
      )}
    </Card>
  )
}
