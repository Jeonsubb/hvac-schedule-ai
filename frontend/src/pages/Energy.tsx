import { useEffect, useMemo, useState } from 'react'
import { MoveRight, Sparkles, Printer, CalendarDays, TrendingDown, ScatterChart as ScatterIcon, ListChecks, ArrowLeftRight } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../lib/api'
import { useMeta, useCopilot } from '../lib/context'
import type { AttributionScope, AttributionVariant, Consolidation, StrategyKey, Summary, TotalsRow } from '../lib/types'
import { CHART, COLD_START, DECISION, STRATEGY, STRATEGY_KEYS, sumDays } from '../lib/constants'
import { cx, fmtDateShort, fmtKwh, fmtNum, fmtPct, pctSaving } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import {
  Badge,
  Button,
  ChartCard,
  Disclosure,
  DisclosureList,
  ErrorBox,
  Figure,
  LegendItem,
  Loading,
  PageHeader,
  PageSkeleton,
  Segmented,
  Skeleton,
  Spinner,
  StrategyName,
  TableToggle,
  DataTable,
} from '../components/ui'
import { Waterfall, WaterfallLegend, splitNote, useAttribution, waterfallTable } from '../components/Attribution'
import { DecisionIcon } from '../components/Gantt'

type Scope = 'to_date' | 'all'

export default function Energy() {
  const { meta } = useMeta()
  const summary = useApi<Summary>('/api/summary')
  const attr = useAttribution()
  const [params, setParams] = useSearchParams()
  const scope: Scope = params.get('scope') === 'all' ? 'all' : 'to_date'
  const setScope = (v: Scope) => {
    const p = new URLSearchParams(params)
    if (v === 'all') p.set('scope', 'all')
    else p.delete('scope')
    setParams(p, { replace: true })
  }

  if (summary.error) return <ErrorBox title="학기 비교 결과를 불러오지 못했습니다" error={summary.error} onRetry={summary.reload} />
  if (!summary.data || !meta) return <PageSkeleton label="학기 전체 시뮬레이션 결과를 불러오는 중…" />
  const S = summary.data
  const T = S.totals[scope]
  const until = scope === 'to_date' ? S.today : undefined
  const cold = Object.fromEntries(STRATEGY_KEYS.map((k) => [k, sumDays(S.days, k, 'cold_starts', until)])) as Record<StrategyKey, number>
  // only use the attribution scope when its shape is complete; otherwise keep the computing state
  const rawA = attr.data?.[scope]
  const okRow = (r: unknown) => !!r && typeof (r as { kwh?: unknown }).kwh === 'number'
  const A =
    rawA &&
    Array.isArray(rawA.waterfall) &&
    rawA.waterfall.length > 1 &&
    rawA.waterfall.every((w) => okRow(w) && typeof w.label === 'string') &&
    okRow(rawA.variants?.ai) &&
    okRow(rawA.variants?.rule30)
      ? rawA
      : undefined
  const attrBroken = !!rawA && !A && !attr.computing
  const vs30 = A ? pctSaving(A.variants.rule30.kwh, A.variants.ai.kwh) : null

  return (
    <div>
      <PageHeader
        title="절감 효과"
        desc={
          vs30 != null
            ? `규칙 기반을 30분 앞당겨 쾌적도를 AI만큼 맞춰도, AI 예측 제어가 전력을 ${vs30 >= 0 ? '덜' : '더'} 씁니다.`
            : '같은 시간표와 같은 날씨로 네 가지 운전 방식을 시뮬레이션해 비교합니다.'
        }
        right={
          <Segmented
            label="집계 범위"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'to_date', label: `오늘까지 (9/1–${fmtDateShort(S.today)})` },
              { value: 'all', label: '학기 전체 (예상 포함)' },
            ]}
          />
        }
      />

      <section data-tour="energy-hero" className="rounded-[16px] border border-line bg-surface" aria-label="절감 요약">
        <Hero T={T} A={A} cold={cold} scope={scope} computing={attr.computing} />
        <div className="border-t border-line px-8 pt-7 pb-6">
          <WaterfallSection A={A} attr={attr} broken={attrBroken} />
        </div>
      </section>

      <DisclosureList className="mt-6" title="자세히 보기" hideTitle>
        <Disclosure icon={<ArrowLeftRight size={16} aria-hidden />} title="운전 방식 4가지 비교" summary={`AI ${fmtNum(T.ai.kwh)} kWh, 고정 ${fmtNum(T.fixed.kwh)} kWh`}>
          <StrategyTable T={T} cold={cold} />
        </Disclosure>
        <Disclosure icon={<CalendarDays size={16} aria-hidden />} title="일별 전력량과 외기온도" summary={`강의일 ${S.days.filter((d) => d.sessions > 0).length}일`}>
          <DailyChart S={S} />
        </Disclosure>
        <Disclosure icon={<TrendingDown size={16} aria-hidden />} title="AI 누적 절감량" summary={`학기 말 고정 대비 ${fmtNum(S.totals.all.fixed.kwh - S.totals.all.ai.kwh)} kWh 예상`}>
          <CumulativeChart S={S} />
        </Disclosure>
        <Disclosure icon={<ScatterIcon size={16} aria-hidden />} title="전기를 아끼느라 쾌적을 포기했는가" summary={`AI 쾌적 유지율 ${fmtPct(T.ai.comfort_pct, 2)}`}>
          <ScatterChart T={T} A={A} scope={scope} />
        </Disclosure>
        <Disclosure icon={<ListChecks size={16} aria-hidden />} title="AI 판단 유형별 횟수" summary={`학기 ${fmtNum(Object.values(S.decisions).reduce((a, v) => a + v, 0))}회`}>
          <DecisionChart S={S} />
        </Disclosure>
        <Disclosure icon={<MoveRight size={16} aria-hidden />} title="강의실 재배치 권고" summary="학사 부서 검토용">
          <ConsolidationReport />
        </Disclosure>
      </DisclosureList>
    </div>
  )
}

function Hero({
  T,
  A,
  cold,
  scope,
  computing,
}: {
  T: Record<StrategyKey, TotalsRow>
  A: AttributionScope | undefined
  cold: Record<StrategyKey, number>
  scope: Scope
  computing: boolean
}) {
  const vsFixed = pctSaving(T.fixed.kwh, T.ai.kwh) ?? 0
  const vsRule = pctSaving(T.rule.kwh, T.ai.kwh) ?? 0
  const r30 = A?.variants.rule30
  const ai = A?.variants.ai
  const vs30 = r30 && ai ? pctSaving(r30.kwh, ai.kwh) : null
  const sameComfort = r30 && ai && vs30 != null && (
    <div className="space-y-3">
      <p className="text-[13.5px]">규칙 기반을 강의 30분 전에 켜도록 앞당겨 AI와 쾌적도를 맞춘 뒤, 같은 기간의 전력을 비교했습니다. 더 좋은 쪽을 굵게 표시합니다.</p>
      <table className="tnum w-full text-[13.5px]">
        <thead>
          <tr className="text-[13px] text-ink-3">
            <th className="py-1 text-left font-medium">같은 기간</th>
            <th className="py-1 text-right font-medium">규칙 30분 전</th>
            <th className="py-1 text-right font-medium">AI</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['전력', `${fmtNum(r30.kwh, 1)} kWh`, `${fmtNum(ai.kwh, 1)} kWh`, ai.kwh <= r30.kwh],
              ['강의 중 쾌적 유지율', fmtPct(r30.comfort_pct, 2), fmtPct(ai.comfort_pct, 2), (ai.comfort_pct ?? 0) >= (r30.comfort_pct ?? 0)],
              [COLD_START.label, `${fmtNum(r30.cold_starts)}회`, `${fmtNum(ai.cold_starts)}회`, ai.cold_starts <= r30.cold_starts],
              ['불쾌 누적', `${fmtNum(r30.discomfort_dm)} ℃·분`, `${fmtNum(ai.discomfort_dm)} ℃·분`, ai.discomfort_dm <= r30.discomfort_dm],
            ] as [string, string, string, boolean][]
          ).map(([k, a, b, aiBetter]) => (
            <tr key={k} className="border-t border-line">
              <th className="py-1.5 text-left font-medium text-ink-2" title={k === COLD_START.label ? COLD_START.desc : undefined}>
                {k}
              </th>
              <td className={cx('py-1.5 text-right', aiBetter ? 'text-ink-2' : 'font-semibold text-ink')}>{a}</td>
              <td className={cx('py-1.5 text-right', aiBetter ? 'font-semibold text-ink' : 'text-ink-2')}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rounded-[10px] bg-well px-3 py-2.5 text-[13.5px]">
        {T.rule.kwh < T.ai.kwh
          ? `10분 전에 켜는 규칙은 AI보다 ${fmtNum(T.ai.kwh - T.rule.kwh, 1)} kWh 적게 쓰지만, 강의 ${fmtNum(cold.rule)}건이 쾌적하지 않은 교실에서 시작합니다(AI ${fmtNum(cold.ai)}건).`
          : `10분 전에 켜는 규칙보다도 ${fmtPct(vsRule)} 적게 쓰면서, 쾌적하지 않게 시작한 강의를 ${fmtNum(cold.rule)}건에서 ${fmtNum(cold.ai)}건으로 줄였습니다.`}
      </p>
    </div>
  )
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8 px-8 pt-8 pb-7">
      <div className="min-w-0">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink-2">
          <span className="inline-block h-2 w-2 rounded-full bg-s-ai" aria-hidden />
          이전 운영(중앙 제어 고정 스케줄) 대비 전력
          {scope === 'all' && <Badge tone="info">학기 전체 예상</Badge>}
        </span>
        <span className="mt-2 flex items-baseline gap-1.5">
          <span className="tnum text-[64px] leading-none font-[650] tracking-[-0.035em] text-ink">−{vsFixed.toFixed(1)}</span>
          <span className="text-[26px] font-semibold text-ink-3">%</span>
        </span>
        <span className="tnum mt-3 block text-[15px] text-ink-2">
          이전 운영 {fmtNum(T.fixed.kwh)} kWh → AI <b className="font-semibold text-ink">{fmtNum(T.ai.kwh)} kWh</b> · 아낀 요금 <b className="font-semibold text-ink">{fmtNum((T.fixed.cost_krw - T.ai.cost_krw) / 10000, 1)}만원</b> (시뮬레이션)
        </span>
      </div>
      <div className="flex flex-wrap gap-x-12 gap-y-5 pb-1">
        {sameComfort ? (
          <Figure
            label="같은 쾌적도의 규칙 기반 대비"
            value={`${vs30! >= 0 ? '−' : '+'}${Math.abs(vs30!).toFixed(1)}`}
            unit="%"
            sub={`규칙 30분 전 ${fmtNum(r30!.kwh, 1)} → AI ${fmtNum(ai!.kwh, 1)} kWh`}
            infoTitle="같은 쾌적도 비교의 근거"
            info={sameComfort}
          />
        ) : (
          <div className="min-w-[200px]" role="status">
            <div className="flex items-center gap-2 text-[13px] font-medium text-ink-3">
              {computing && <Spinner size={13} />}
              {computing ? '같은 쾌적도 비교 계산 중…' : '같은 쾌적도 비교를 불러오지 못했습니다'}
            </div>
            {computing && <Skeleton className="mt-2 h-[34px] w-[120px]" />}
          </div>
        )}
        <Figure
          label="강의 중 쾌적 유지율"
          value={T.ai.comfort_pct != null ? T.ai.comfort_pct.toFixed(1) : '–'}
          unit="%"
          info={
            <p className="text-[13.5px]">
              강의 시간 중 실내온도가 쾌적 범위 안이었던 비율입니다. 이전 운영은 {fmtPct(T.fixed.comfort_pct)}, {COLD_START.short}는 이전 운영 {fmtNum(cold.fixed)}회, AI {fmtNum(cold.ai)}회입니다.
            </p>
          }
        />
        <Figure
          label="줄인 탄소"
          value={((T.fixed.co2_kg - T.ai.co2_kg) / 1000).toFixed(2)}
          unit="tCO₂"
          align="right"
          info={<p className="text-[13.5px]">이전 운영 대비입니다. 전력량에 국가 전력배출계수 0.4173 kgCO₂eq/kWh(2023년도)를 곱했습니다.</p>}
        />
      </div>
    </div>
  )
}

function WaterfallSection({ A, attr, broken }: { A: AttributionScope | undefined; attr: ReturnType<typeof useAttribution>; broken: boolean }) {
  const [asTable, setAsTable] = useState(false)
  const [detail, setDetail] = useState(false)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-[17px] font-[650] tracking-[-0.01em] text-ink">
          AI 절감은 어디서 오는가
          {attr.stale && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-ink-3" title="이전 결과를 보여 주면서 최신 입력으로 다시 계산하고 있습니다">
              <Spinner size={13} /> 갱신 중
            </span>
          )}
        </h2>
        {A && <TableToggle asTable={asTable} onToggle={() => setAsTable((v) => !v)} />}
      </div>
      {A && attr.data ? (
        asTable ? (
          <DataTable spec={waterfallTable(A)} />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
              <WaterfallLegend />
            </div>
            <div className={cx('transition-opacity duration-200', attr.stale && 'opacity-70')}>
              <Waterfall A={A} note={attr.data.note ?? ''} detail={detail} />
            </div>
            <Disclosure variant="inline" className="mt-4" title={detail ? '단계별 쾌적 지표 접기' : '단계별 쾌적 지표와 계산 방법 보기'} open={detail} onOpenChange={setDetail}>
              <p className="max-w-[90ch] text-[13.5px] leading-relaxed text-ink-2">{splitNote(attr.data.note ?? '').method} 막대 위 숫자는 앞 단계 대비 전력 변화입니다.</p>
            </Disclosure>
          </>
        )
      ) : attr.error || broken ? (
        <ErrorBox title="기능별 절감 분석을 불러오지 못했습니다" error={attr.error ?? '서버 응답에 필요한 값이 빠져 있습니다. 잠시 뒤 다시 시도하세요.'} onRetry={attr.reload} />
      ) : (
        <div className="space-y-3" role="status">
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            <Spinner size={15} /> 학기 전체를 기능별로 다시 시뮬레이션하는 중입니다. 처음 한 번은 1분 정도 걸리고, 10초마다 확인합니다.
          </div>
          <Skeleton className="h-[300px]" />
        </div>
      )}
    </div>
  )
}

/** Strategies as columns: one comparison table instead of four identical cards. */
function StrategyTable({ T, cold }: { T: Record<StrategyKey, TotalsRow>; cold: Record<StrategyKey, number> }) {
  const order: StrategyKey[] = ['ai', 'rule', 'manual', 'fixed']
  const maxKwh = Math.max(...order.map((k) => T[k].kwh))
  const minOf = (f: (k: StrategyKey) => number) => Math.min(...order.map(f))
  const rows: { label: string; cell: (k: StrategyKey) => React.ReactNode; best?: (k: StrategyKey) => boolean }[] = [
    {
      label: '전력량',
      cell: (k) => (
        <div>
          <div>
            <b className="text-[16px] font-[650] text-ink">{fmtNum(T[k].kwh)}</b> <span className="text-ink-3">kWh</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-[#eceff3]" aria-hidden>
            <div className="h-1.5 rounded-full" style={{ width: `${(T[k].kwh / maxKwh) * 100}%`, background: STRATEGY[k].color }} />
          </div>
        </div>
      ),
    },
    { label: '고정 스케줄 대비', cell: (k) => (k === 'fixed' ? <span className="text-ink-3">비교 기준</span> : <span className="font-semibold text-good-ink">−{pctSaving(T.fixed.kwh, T[k].kwh)?.toFixed(1)}%</span>) },
    { label: '전기요금', cell: (k) => `${fmtNum(T[k].cost_krw)}원`, best: (k) => T[k].cost_krw === minOf((x) => T[x].cost_krw) },
    { label: '탄소 배출', cell: (k) => `${(T[k].co2_kg / 1000).toFixed(2)} tCO₂`, best: (k) => T[k].co2_kg === minOf((x) => T[x].co2_kg) },
    { label: '최대 전력', cell: (k) => `${T[k].peak_kw.toFixed(1)} kW`, best: (k) => T[k].peak_kw === minOf((x) => T[x].peak_kw) },
    { label: '강의 중 쾌적 유지율', cell: (k) => fmtPct(T[k].comfort_pct, 2) },
    { label: COLD_START.label, cell: (k) => `${fmtNum(cold[k])}회`, best: (k) => cold[k] === Math.min(...order.map((x) => cold[x])) },
    { label: '불쾌 누적', cell: (k) => `${fmtNum(T[k].discomfort_dm, 0)} ℃·분`, best: (k) => T[k].discomfort_dm === minOf((x) => T[x].discomfort_dm) },
  ]
  return (
    <div>
      <p className="mb-4 text-[13.5px] text-ink-3">같은 시간표와 날씨로 네 가지 방식을 시뮬레이션했습니다. 굵은 값이 그 항목에서 가장 좋은 방식입니다.</p>
      <div className="overflow-x-auto rounded-[12px] border border-line">
        <table className="tnum w-full min-w-[760px] table-fixed text-[14px]">
          <colgroup>
            <col className="w-[180px]" />
            {order.map((k) => (
              <col key={k} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="border-b border-line px-5 py-3 text-left">
                <span className="sr-only">항목</span>
              </th>
              {order.map((k) => (
                <th key={k} className={cx('border-b border-line px-4 py-3 text-left align-bottom font-semibold', k === 'ai' && 'bg-[#f3faf6]')}>
                  <StrategyName k={k} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line last:border-b-0">
                <th className="px-5 py-3 text-left text-[13.5px] font-medium text-ink-2">{r.label}</th>
                {order.map((k) => (
                  <td key={k} className={cx('px-4 py-3 text-ink', k === 'ai' && 'bg-[#f3faf6]', r.best?.(k) && 'font-semibold')}>
                    {r.cell(k)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th className="px-5 py-3 text-left align-top text-[13.5px] font-medium text-ink-2">운전 방식</th>
              {order.map((k) => (
                <td key={k} className={cx('px-4 py-3 align-top text-[13px] leading-snug text-ink-3', k === 'ai' && 'bg-[#f3faf6]')}>
                  {STRATEGY[k].desc}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
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
      axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: CHART.muted } },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        formatter: (ps: unknown) => {
          const arr = ps as { seriesName: string; value: number; color: string; dataIndex: number }[]
          if (!arr.length) return ''
          const d = days[arr[0].dataIndex]
          let h = ttTitle(`${fmtDateShort(d.date)} (${'월화수목금토일'[d.weekday]})${d.date > S.today ? ', 예상' : ''}`)
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
        { type: 'value', gridIndex: 0, name: 'kWh/일', ...axisCommon, nameTextStyle: { color: CHART.muted, fontSize: 12, align: 'left' }, axisLine: { show: false } },
        {
          type: 'value',
          gridIndex: 1,
          name: '외기 ℃',
          ...axisCommon,
          nameTextStyle: { color: CHART.muted, fontSize: 12, align: 'left' },
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
                  itemStyle: { color: 'rgba(20,32,51,0.035)' },
                  label: { show: true, position: 'insideTop' as const, color: CHART.muted, fontSize: 12, formatter: '예보·평년 기반 예상' },
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
          areaStyle: { color: 'rgba(138,148,163,0.22)' },
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
      bare
      sub="강의일만 표시합니다. 냉방철(9월)과 난방철(11~12월) 사이 간절기에는 AI가 외기 냉방과 가동 생략으로 전력을 크게 줄입니다."
      legend={
        <>
          {(['ai', 'rule', 'manual', 'fixed'] as StrategyKey[]).map((k) => (
            <LegendItem key={k} color={STRATEGY[k].color} label={STRATEGY[k].label} kind="line" />
          ))}
          <LegendItem color={CHART.outdoor} label="외기 평균, 띠는 최저~최고 (아래 칸)" kind="line" />
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
        min: (v: { min: number }) => Math.floor(Math.min(0, v.min) / 100) * 100,
        ...axisCommon,
        nameTextStyle: { color: CHART.muted, fontSize: 12, align: 'left' },
        axisLine: { show: false },
      },
      series: [
        {
          name: '고정 스케줄 대비',
          type: 'line',
          showSymbol: false,
          lineStyle: { width: 2, color: STRATEGY.fixed.color },
          itemStyle: { color: STRATEGY.fixed.color },
          areaStyle: { color: 'rgba(86,90,96,0.06)' },
          data: vsFixed,
          endLabel: { show: true, formatter: (p: { value: number }) => `${fmtNum(p.value)}`, color: CHART.ink, fontSize: 12, fontWeight: 600 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: CHART.ink, width: 1, type: 'solid' },
            label: { formatter: '오늘', color: CHART.ink2, fontSize: 12, position: 'end', rotate: 0 },
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
          endLabel: { show: true, formatter: (p: { value: number }) => `${fmtNum(p.value)}`, color: CHART.ink, fontSize: 12, fontWeight: 600 },
        },
      ] as never,
    }
  }, [S])
  const last = S.days.length - 1
  return (
    <ChartCard
      bare
      sub="AI 예측 제어가 각 방식보다 덜 쓴 전력을 쌓아 올린 값입니다. 오늘 이후는 예상입니다."
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
        <div className="mt-2 text-[13px] text-ink-3">
          {S.days[last] && `학기 말(${fmtDateShort(S.days[last].date)})까지 고정 대비 ${fmtNum(S.totals.all.fixed.kwh - S.totals.all.ai.kwh)} kWh, 규칙 대비 ${fmtNum(S.totals.all.rule.kwh - S.totals.all.ai.kwh)} kWh 절감 예상`}
        </div>
      }
    >
      <EChart option={option} height={260} />
    </ChartCard>
  )
}

type Pt = { key: string; name: string; short: string; kwh: number; comfort: number; cold: number | null; dm: number; color: string; symbol: string; pos: string }

const RULE_VARIANTS: { v: AttributionVariant; name: string; short: string; symbol: string; pos: string }[] = [
  { v: 'rule', name: '규칙 기반(10분 전)', short: '규칙 10분 전', symbol: 'circle', pos: 'top' },
  { v: 'rule_vacancy', name: '규칙 기반 + 재실 감지', short: '+재실 감지', symbol: 'triangle', pos: 'bottom' },
  { v: 'rule30', name: '규칙 기반(30분 전)', short: '규칙 30분 전', symbol: 'diamond', pos: 'right' },
]

function ScatterChart({ T, A, scope }: { T: Record<StrategyKey, TotalsRow>; A: AttributionScope | undefined; scope: Scope }) {
  // with the attribution run: fixed, three rule variants and AI (same comfort metric everywhere); otherwise the four strategies
  const pts = useMemo<Pt[]>(() => {
    if (A) {
      const V = A.variants
      return [
        ...(V.fixed ? [{ key: 'fixed', name: '고정 스케줄', short: '고정', kwh: V.fixed.kwh, comfort: V.fixed.comfort_pct ?? 0, cold: V.fixed.cold_starts, dm: V.fixed.discomfort_dm, color: STRATEGY.fixed.color, symbol: 'circle', pos: 'left' }] : []),
        ...RULE_VARIANTS.filter((r) => V[r.v]).map((r) => ({
          key: r.v,
          name: r.name,
          short: r.short,
          kwh: V[r.v].kwh,
          comfort: V[r.v].comfort_pct ?? 0,
          cold: V[r.v].cold_starts,
          dm: V[r.v].discomfort_dm,
          color: STRATEGY.rule.color,
          symbol: r.symbol,
          pos: r.pos,
        })),
        { key: 'ai', name: 'AI 예측 제어', short: 'AI', kwh: V.ai.kwh, comfort: V.ai.comfort_pct ?? 0, cold: V.ai.cold_starts, dm: V.ai.discomfort_dm, color: STRATEGY.ai.color, symbol: 'circle', pos: 'top' },
      ]
    }
    return STRATEGY_KEYS.map((k) => ({
      key: k,
      name: STRATEGY[k].label,
      short: STRATEGY[k].short,
      kwh: T[k].kwh,
      comfort: T[k].comfort_pct ?? 0,
      cold: null,
      dm: T[k].discomfort_dm,
      color: STRATEGY[k].color,
      symbol: 'circle',
      pos: k === 'fixed' ? 'left' : k === 'rule' ? 'right' : 'top',
    }))
  }, [A, T])
  const option = useMemo<EChartsOption>(() => {
    const minC = Math.min(...pts.map((p) => p.comfort))
    const ai = pts.find((p) => p.key === 'ai')
    return {
      grid: { left: 44, right: 24, top: 28, bottom: 44 },
      tooltip: {
        ...baseTooltip,
        trigger: 'item',
        formatter: (p: unknown) => {
          const q = (p as { data: { p: Pt } }).data.p
          return (
            ttTitle(q.name) +
            ttRow(q.color, '전력량', `${fmtNum(q.kwh, 1)} kWh`, 'rect') +
            ttRow(q.color, '쾌적 유지율', fmtPct(q.comfort, 2), 'rect') +
            (q.cold != null ? ttRow(q.color, COLD_START.label, `${fmtNum(q.cold)}회`, 'rect') : '') +
            ttRow(q.color, '불쾌 누적', `${fmtNum(q.dm)} ℃·분`, 'rect')
          )
        },
      },
      xAxis: { type: 'value', name: '전력량 (kWh), 적을수록 좋음', nameLocation: 'middle', nameGap: 28, min: 0, ...axisCommon, nameTextStyle: { color: CHART.muted, fontSize: 12 } },
      yAxis: {
        type: 'value',
        name: '강의 중 쾌적 유지율 (%), 높을수록 좋음',
        min: Math.floor(minC - 0.4),
        max: 100.4,
        ...axisCommon,
        nameTextStyle: { color: CHART.muted, fontSize: 12, align: 'left' },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => (v > 100 ? '' : `${v}`) },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: (_: unknown, p: { data: { p: Pt } }) => (p.data.p.symbol === 'circle' ? 14 : 16),
          itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
          data: pts.map((q) => ({
            p: q,
            value: [q.kwh, q.comfort],
            symbol: q.symbol,
            itemStyle: { color: q.color },
            label: { show: true, formatter: q.short, position: q.pos, color: CHART.ink, fontSize: 13, fontWeight: q.key === 'ai' ? 650 : 400, distance: 9 },
          })),
          markArea: ai
            ? {
                silent: true,
                itemStyle: { color: 'rgba(20,166,115,0.07)' },
                label: { show: true, position: 'insideBottomLeft', color: CHART.ink2, fontSize: 12, formatter: '적게 쓰고 쾌적한 영역' },
                data: [[{ xAxis: 0, yAxis: 99.5 }, { xAxis: ai.kwh * 1.12, yAxis: 100.4 }]] as never,
              }
            : undefined,
        },
      ] as never,
    }
  }, [pts])
  return (
    <ChartCard
      bare
      sub={`${scope === 'all' ? '학기 전체(예상)' : '오늘까지'} 기준입니다. 왼쪽 위로 갈수록 적게 쓰고 쾌적한 운전이며, 규칙 기반은 켜는 시점과 재실 감지를 바꾼 경우도 함께 놓았습니다.`}
      legend={
        <>
          <LegendItem color={STRATEGY.fixed.color} label="고정 스케줄" kind="dot" />
          {RULE_VARIANTS.map((r) => (
            <span key={r.v} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                {r.symbol === 'circle' && <circle cx="6" cy="6" r="5" fill={STRATEGY.rule.color} />}
                {r.symbol === 'diamond' && <path d="M6 0.5 11.5 6 6 11.5 0.5 6z" fill={STRATEGY.rule.color} />}
                {r.symbol === 'triangle' && <path d="M6 1 11.5 11H0.5z" fill={STRATEGY.rule.color} />}
              </svg>
              {r.name}
            </span>
          ))}
          <LegendItem color={STRATEGY.ai.color} label="AI 예측 제어" kind="dot" />
        </>
      }
      table={{
        columns: ['운전 방식', '전력량 kWh', '쾌적 유지율 %', `${COLD_START.label}(회)`, '불쾌 누적 ℃·분'],
        rows: pts.map((q) => [q.name, q.kwh, q.comfort, q.cold, q.dm]),
      }}
    >
      <EChart option={option} height={300} />
    </ChartCard>
  )
}

function DecisionChart({ S }: { S: Summary }) {
  const entries = Object.entries(S.decisions).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const max = Math.max(1, ...entries.map(([, v]) => v))
  return (
    <ChartCard
      bare
      sub={`학기 전체 ${fmtNum(total)}회입니다. 강의마다 열모델로 판단합니다.`}
      table={{ columns: ['판단', '횟수'], rows: entries.map(([k, v]) => [DECISION[k]?.label ?? k, v]) }}
    >
      <ul className="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-2">
        {entries.map(([k, v]) => (
          <li key={k}>
            <div className="mb-1.5 flex items-center justify-between text-[14px]">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
                  <DecisionIcon type={k} size={10} />
                </span>
                {DECISION[k]?.label ?? k}
              </span>
              <span className="tnum font-semibold text-ink">{fmtNum(v)}회</span>
            </div>
            <div className="h-2 rounded-full bg-[#eceff3]" title={`${DECISION[k]?.label}: ${v}회`}>
              <div className="h-2 rounded-full bg-s-ai" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="mt-1.5 text-[13px] text-ink-3">{DECISION[k]?.desc}</div>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

function ConsolidationReport() {
  const c = useApi<Consolidation>('/api/consolidation', { maxAgeMs: 10 * 60_000 })
  // stale: the previous result is shown while the backend recomputes; check again shortly
  const stale = !!c.data?.stale
  const { reload: reloadC } = c
  useEffect(() => {
    if (!stale) return
    const t = window.setTimeout(reloadC, 10_000)
    return () => window.clearTimeout(t)
  }, [stale, reloadC, c.data])
  const { ask } = useCopilot()
  const { meta } = useMeta()
  const withMoves = (Array.isArray(c.data?.weekdays) ? c.data.weekdays : []).filter((w) => Array.isArray(w.moves) && w.moves.length > 0)
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[72ch] text-[13.5px] text-ink-3">같은 유형이고 정원이 맞으며 그 시간에 비어 있는 강의실로 옮겨, 같은 실외기에 강의를 모읍니다.</p>
        <div className="flex flex-wrap items-center gap-2">
          {stale && (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3" title="이전 결과를 보여 주면서 최신 시간표로 다시 계산하고 있습니다">
              <Spinner size={13} /> 갱신 중
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={() => ask('금요일 강의실 재배치로 얼마나 절감돼? 이유와 함께 설명해줘')}>
            <Sparkles size={14} aria-hidden /> 코파일럿에게 설명 듣기
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer size={14} aria-hidden /> 인쇄
          </Button>
        </div>
      </div>
      {c.error ? (
        <ErrorBox error={c.error} onRetry={c.reload} />
      ) : !c.data ? (
        <Loading label="요일별 재배치안을 학기 전체로 다시 시뮬레이션하는 중… (5초 정도 걸립니다)" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[12px] bg-well px-5 py-4">
            <Figure label="학기 예상 추가 절감" value={fmtNum(c.data.semester_kwh_saving, 1)} unit="kWh" size="sm" />
            <div className="hidden h-10 w-px bg-line-strong sm:block" />
            <div className="text-[14px] text-ink-2">
              <div>
                권고 이동 <b className="font-semibold text-ink">{withMoves.reduce((a, w) => a + w.moves.length, 0)}건</b>, 대상 요일{' '}
                <b className="font-semibold text-ink">{withMoves.map((w) => w.weekday_label).join('·') || '없음'}</b>
              </div>
              <div className="text-[13px] text-ink-3">쾌적 유지율은 그대로이고, AI 운전 기준으로 다시 시뮬레이션한 값입니다.</div>
            </div>
          </div>
          {withMoves.length === 0 && <div className="text-[14px] text-ink-2">현재 시간표에서는 옮겨서 아낄 수 있는 강의가 없습니다.</div>}
          {withMoves.map((w) => (
            <div key={w.weekday} className="overflow-hidden rounded-[12px] border border-line">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-well px-4 py-3">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                  매주 {w.weekday_label}요일
                  <span className="font-normal text-ink-3">학기 중 {w.dates}회</span>
                </div>
                <div className="tnum flex items-center gap-3 text-[13px] text-ink-2">
                  <span>
                    {fmtNum(w.kwh_before, 1)} → <b className="text-ink">{fmtNum(w.kwh_after, 1)} kWh</b>
                  </span>
                  <Badge tone="good">
                    −{fmtNum(w.kwh_saving, 1)} kWh ({fmtPct(w.saving_pct)})
                  </Badge>
                  {w.odu_minutes_before != null && w.odu_minutes_after != null && (
                    <span className="text-ink-3">
                      실외기 가동 {fmtNum(w.odu_minutes_before / 60, 1)}h → {fmtNum(w.odu_minutes_after / 60, 1)}h
                    </span>
                  )}
                </div>
              </div>
              <table className="tnum w-full text-[14px]">
                <thead className="text-[13px] text-ink-3">
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
                        <div className="text-[13px] text-ink-3">{m.professor}</div>
                      </td>
                      <td className="px-2 py-2 text-ink-2">
                        {m.start}–{m.end}
                      </td>
                      <td className="px-2 py-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                          {m.from_room}호 <MoveRight size={13} className="text-ink-3" /> {m.to_room}호
                        </span>
                        <div className="text-[13px] text-ink-3">{meta?.rooms[m.to_room]?.type_label}</div>
                      </td>
                      <td className="px-2 py-2 text-[13px] whitespace-nowrap text-ink-2">
                        {m.from_odu.replace('ODU-', '')} <MoveRight size={11} className="inline text-ink-3" aria-label="에서" /> {m.to_odu.replace('ODU-', '')}
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
          <p className="text-[13px] leading-relaxed text-ink-3">{c.data.note}</p>
        </div>
      )}
    </div>
  )
}
