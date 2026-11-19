import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ClipboardCheck, CalendarSearch, ListChecks, ArrowUpRight } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, DaySummary, Summary } from '../lib/types'
import { CHART, GROUP_META, ROOM_ORDER, STATUS_COLOR, decisionLabel, statusInfo, type StatusGroup } from '../lib/constants'
import { cx, fmtDateK, fmtDateShort, fmtNum, fmtPct } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { Badge, Card, CardHeader, ChartCard, Empty, ErrorBox, GroupIcon, LegendItem, Loading, PageHeader, Segmented, StatTile, StatusBadge, inputBase } from '../components/ui'
import { DecisionIcon } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'

function splitCounts(d: DaySummary) {
  const review = d.match_rate != null && d.match_rate < 100 ? Math.round(d.sessions * (1 - d.match_rate / 100)) : 0
  const auto = Math.max(0, d.anomalies - review)
  return { review, auto }
}

export default function Validation() {
  const { meta } = useMeta()
  const summary = useApi<Summary>('/api/summary')
  const [params, setParams] = useSearchParams()
  const [group, setGroup] = useState<'all' | StatusGroup>('all')
  const [roomF, setRoomF] = useState<string>('all')
  const [drawer, setDrawer] = useState<string | null>(null)

  const today = summary.data?.today ?? meta?.now.date ?? '2026-11-20'
  const past = useMemo(() => (summary.data?.days ?? []).filter((d) => d.date <= today && d.sessions > 0), [summary.data, today])
  // default: the most recent lecture day that had something to look at (else today)
  const latestIssue = useMemo(() => [...past].reverse().find((d) => d.anomalies > 0 || (d.match_rate ?? 100) < 100)?.date, [past])
  const date = params.get('date') ?? (summary.data ? latestIssue ?? today : null)
  const day = useApi<Day>(date ? `/api/day/${date}` : null)

  const kpi = useMemo(() => {
    let sessions = 0
    let match = 0
    let cov = 0
    let review = 0
    let auto = 0
    for (const d of past) {
      sessions += d.sessions
      match += (d.match_rate ?? 100) * d.sessions
      cov += (d.plan_coverage ?? 100) * d.sessions
      const c = splitCounts(d)
      review += c.review
      auto += c.auto
    }
    return { sessions, match: sessions ? match / sessions : null, cov: sessions ? cov / sessions : null, review, auto, days: past.length }
  }, [past])

  const option = useMemo<EChartsOption>(() => {
    const cats = past.map((d) => d.date)
    return {
      grid: { left: 36, right: 12, top: 16, bottom: 28 },
      tooltip: {
        ...baseTooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(11,11,11,0.04)' } },
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[]
          const d = past[arr[0].dataIndex]
          const c = splitCounts(d)
          return (
            ttTitle(fmtDateK(d.date)) +
            ttRow('#0b0b0b', '정합성', fmtPct(d.match_rate), 'rect') +
            ttRow(STATUS_COLOR.crit, '확인 필요', `${c.review}건`, 'rect') +
            ttRow(STATUS_COLOR.warn, '자동 조치', `${c.auto}건`, 'rect') +
            ttRow('#c3c2b7', '검증 강의', `${d.sessions}건`, 'rect') +
            '<div style="color:#898781;margin-top:4px">막대를 누르면 그날 상세</div>'
          )
        },
      },
      xAxis: {
        type: 'category',
        data: cats,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmtDateShort(v) },
      },
      yAxis: { type: 'value', minInterval: 1, name: '건', nameTextStyle: { color: CHART.muted, fontSize: 11 }, ...axisCommon, axisLine: { show: false } },
      series: [
        {
          name: '확인 필요',
          type: 'bar',
          stack: 'n',
          barMaxWidth: 14,
          itemStyle: { color: STATUS_COLOR.crit, borderColor: '#ffffff', borderWidth: 1 },
          data: past.map((d) => ({
            value: splitCounts(d).review,
            itemStyle: { opacity: d.date === date ? 1 : 0.85 },
          })),
        },
        {
          name: '자동 조치',
          type: 'bar',
          stack: 'n',
          barMaxWidth: 14,
          itemStyle: { color: STATUS_COLOR.warn, borderRadius: [3, 3, 0, 0], borderColor: '#ffffff', borderWidth: 1 },
          data: past.map((d) => splitCounts(d).auto),
          markLine:
            date && cats.includes(date)
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: CHART.ink, width: 1, type: 'solid' },
                  label: { formatter: '선택', color: CHART.ink2, fontSize: 10.5, position: 'end' },
                  data: [{ xAxis: date }],
                }
              : undefined,
        },
      ] as never,
    }
  }, [past, date])

  if (summary.error) return <ErrorBox error={summary.error} onRetry={summary.reload} />
  if (!summary.data || !meta || !date) return <Loading label="검증 결과를 불러오는 중…" />

  const setDate = (d: string) => {
    const p = new URLSearchParams(params)
    p.set('date', d)
    setParams(p, { replace: true })
  }
  const idx = past.findIndex((d) => d.date === date)
  const issueDays = [...past].filter((d) => d.anomalies > 0 || (d.match_rate ?? 100) < 100).reverse()

  const V = day.data?.date === date ? day.data.validation : undefined
  const rows = (V?.sessions ?? [])
    .filter((v) => group === 'all' || statusInfo(v.status).group === group)
    .filter((v) => roomF === 'all' || v.room === roomF)
    .sort((a, b) => {
      const order = { review: 0, auto: 1, normal: 2 }
      return order[statusInfo(a.status).group] - order[statusInfo(b.status).group] || a.start.localeCompare(b.start) || a.room.localeCompare(b.room)
    })
  const gcount = (g: StatusGroup) => (V?.sessions ?? []).filter((v) => statusInfo(v.status).group === g).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="정합성 검증"
        desc="강의가 있는 시간에 냉난방이 계획대로 켜지고 꺼졌는지 매일 자동으로 확인합니다."
      />

      <div className="flex items-start gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[13px] text-ink-2">
        <ClipboardCheck size={18} className="mt-0.5 shrink-0 text-brand" />
        <p>
          <b className="text-ink">검증 방법</b> — ① <b className="text-ink">계획 검증</b>: 모든 강의가 운전 계획에 들어 있는지(계획 반영률) ②{' '}
          <b className="text-ink">실행 검증</b>: 강의 중 실내기가 실제로 가동됐고 시작 시점에 쾌적 범위({meta.settings.comfort_low}~{meta.settings.comfort_high}℃)였는지(실행률·시작 온도).
          무단 휴강·명령 실패·수동 가동·예보 오차 같은 현장 이상은 시스템이 <b className="text-ink">자동 조치</b>하고 기록하며, 사람이 봐야 할 것만 <b className="text-ink">확인 필요</b>로 올립니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="정합성 (일치율)" value={kpi.match != null ? kpi.match.toFixed(2) : '–'} unit="%" sub={`학기 시작 ~ 오늘 · ${kpi.days}일`} />
        <StatTile label="계획 반영률" value={kpi.cov != null ? kpi.cov.toFixed(1) : '–'} unit="%" sub="강의 중 계획에서 빠진 비율 0%" />
        <StatTile label="검증한 강의" value={fmtNum(kpi.sessions)} unit="건" sub="강의·이벤트 세션 단위" />
        <StatTile
          label="자동 조치"
          icon={<GroupIcon group="auto" size={13} />}
          value={fmtNum(kpi.auto)}
          unit="건"
          sub="재실 감지 정지·재전송·피드백 보정"
        />
        <StatTile
          label="확인 필요"
          icon={<GroupIcon group="review" size={13} />}
          value={fmtNum(kpi.review)}
          unit="건"
          sub={kpi.sessions ? `전체의 ${((kpi.review / kpi.sessions) * 100).toFixed(2)}% · 주로 선행 가동 부족` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <ChartCard
          title="일별 자동 조치 · 확인 필요 건수"
          sub="학기 시작부터 오늘까지 강의일 · 막대를 누르면 아래에 그날의 강의별 검증 결과가 나옵니다"
          legend={
            <>
              <LegendItem color={STATUS_COLOR.crit} label="확인 필요" />
              <LegendItem color={STATUS_COLOR.warn} label="자동 조치" />
            </>
          }
          table={{
            columns: ['날짜', '강의', '정합성 %', '자동 조치', '확인 필요'],
            rows: past.map((d) => {
              const c = splitCounts(d)
              return [d.date, d.sessions, d.match_rate, c.auto, c.review]
            }),
          }}
        >
          <EChart
            option={option}
            height={250}
            onEvents={{
              click: (p: unknown) => {
                const q = p as { dataIndex: number }
                if (past[q.dataIndex]) setDate(past[q.dataIndex].date)
              },
            }}
          />
        </ChartCard>
        <Card>
          <CardHeader title="이상이 있었던 날" icon={<CalendarSearch size={15} />} sub={`${issueDays.length}일 · 최근 순`} />
          <ul className="thin-scroll -mx-1 max-h-[268px] overflow-y-auto px-1">
            {issueDays.map((d) => {
              const c = splitCounts(d)
              return (
                <li key={d.date}>
                  <button
                    onClick={() => setDate(d.date)}
                    className={cx(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[#f6f6f3]',
                      d.date === date && 'bg-[#f0efec]',
                    )}
                  >
                    <span className="font-medium text-ink">{fmtDateK(d.date)}</span>
                    <span className="flex items-center gap-1.5">
                      {c.review > 0 && <StatusBadge group="review" label={`${c.review}`} />}
                      {c.auto > 0 && <StatusBadge group="auto" label={`${c.auto}`} />}
                      <span className="tnum w-12 text-right text-ink-2">{fmtPct(d.match_rate, 1)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <ListChecks size={16} className="text-ink-2" />
              {fmtDateK(date)} 강의별 검증 결과
              {date > today && <Badge tone="info">예상</Badge>}
            </span>
          }
          sub={
            V
              ? `강의 ${V.total}건 · 정합성 ${fmtPct(V.match_rate)} · 계획 반영 ${fmtPct(V.plan_coverage, 0)} · 자동 조치 ${V.auto_actions}건`
              : '불러오는 중…'
          }
          right={
            <div className="flex items-center gap-1.5">
              <button
                className="rounded-md border border-[#dcdbd4] p-1.5 text-ink-2 hover:bg-[#f6f6f3] disabled:opacity-30"
                disabled={idx <= 0}
                onClick={() => idx > 0 && setDate(past[idx - 1].date)}
                aria-label="이전 강의일"
              >
                <ChevronLeft size={15} />
              </button>
              <input
                type="date"
                className={cx(inputBase, 'h-8 w-[150px]')}
                value={date}
                min={meta.semester.start}
                max={meta.semester.end}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
              <button
                className="rounded-md border border-[#dcdbd4] p-1.5 text-ink-2 hover:bg-[#f6f6f3] disabled:opacity-30"
                disabled={idx < 0 || idx >= past.length - 1}
                onClick={() => idx >= 0 && idx < past.length - 1 && setDate(past[idx + 1].date)}
                aria-label="다음 강의일"
              >
                <ChevronRight size={15} />
              </button>
              <Link
                to={`/schedule?date=${date}`}
                className="ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg whitespace-nowrap border border-[#dcdbd4] px-2.5 text-[12.5px] font-medium text-ink hover:bg-[#f6f6f3]"
              >
                타임라인 <ArrowUpRight size={13} />
              </Link>
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented
            value={group}
            onChange={setGroup}
            options={[
              { value: 'all', label: `전체 ${V?.sessions.length ?? 0}` },
              { value: 'normal', label: <span className="inline-flex items-center gap-1"><GroupIcon group="normal" size={12} />정상 {gcount('normal')}</span> },
              { value: 'auto', label: <span className="inline-flex items-center gap-1"><GroupIcon group="auto" size={12} />자동 조치 {gcount('auto')}</span> },
              { value: 'review', label: <span className="inline-flex items-center gap-1"><GroupIcon group="review" size={12} />확인 필요 {gcount('review')}</span> },
            ]}
          />
          <select className={cx(inputBase, 'h-8 w-[130px]')} value={roomF} onChange={(e) => setRoomF(e.target.value)} aria-label="강의실 필터">
            <option value="all">전체 강의실</option>
            {ROOM_ORDER.map((r) => (
              <option key={r} value={r}>
                {r}호
              </option>
            ))}
          </select>
        </div>
        {day.error ? (
          <ErrorBox error={day.error} onRetry={day.reload} />
        ) : !V ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title={V.sessions.length ? '조건에 맞는 강의가 없습니다' : '이 날은 강의가 없습니다'} />
        ) : (
          <div className={cx('overflow-hidden rounded-lg border border-line', day.loading && 'opacity-60')}>
            <table className="tnum w-full text-[12.5px]">
              <thead className="bg-[#f6f6f3] text-ink-2">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">강의실</th>
                  <th className="px-3 py-2 text-left font-semibold">시간</th>
                  <th className="px-3 py-2 text-left font-semibold">강의</th>
                  <th className="px-3 py-2 text-left font-semibold">검증 결과</th>
                  <th className="px-3 py-2 text-left font-semibold">계획</th>
                  <th className="w-[130px] px-3 py-2 text-left font-semibold">실행률</th>
                  <th className="px-3 py-2 text-right font-semibold">시작 온도</th>
                  <th className="px-3 py-2 text-right font-semibold">쾌적</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const info = statusInfo(v.status)
                  const er = v.exec_ratio ?? 0
                  return (
                    <tr
                      key={v.session}
                      className="cursor-pointer border-t border-line align-top hover:bg-[#fafaf8]"
                      onClick={() => setDrawer(v.room)}
                      style={{ boxShadow: info.group !== 'normal' ? `inset 3px 0 0 ${GROUP_META[info.group].color}` : undefined }}
                    >
                      <td className="px-3 py-2 font-semibold text-ink">{v.room}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                        {v.start}–{v.end}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink">{v.title}</div>
                        {v.decisions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {v.decisions.map((d) => (
                              <Badge key={d} tone="neutral">
                                <DecisionIcon type={d} size={10} />
                                {decisionLabel(d)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge group={info.group} label={info.label} />
                        {v.notes.map((n, i) => (
                          <div key={i} className="mt-1 max-w-[340px] text-[11.5px] text-ink-2">
                            {n}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-ink-2">{v.planned === false ? <span className="text-crit-ink">누락</span> : '반영'}</td>
                      <td className="px-3 py-2">
                        {v.exec_ratio != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-[#e7e6e0]">
                              <div className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.min(100, er * 100)}%` }} />
                            </div>
                            <span className="text-ink-2">{(er * 100).toFixed(0)}%</span>
                          </div>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td className={cx('px-3 py-2 text-right', v.ta_start != null && (v.ta_start < meta.settings.comfort_low || v.ta_start > meta.settings.comfort_high) ? 'font-semibold text-crit-ink' : 'text-ink-2')}>
                        {v.ta_start != null ? `${v.ta_start.toFixed(1)}℃` : '–'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2">{v.comfort_pct != null ? `${v.comfort_pct.toFixed(0)}%` : '재실 없음'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RoomDrawer open={!!drawer} onClose={() => setDrawer(null)} day={day.data?.date === date ? day.data : undefined} meta={meta} room={drawer} />
    </div>
  )
}
