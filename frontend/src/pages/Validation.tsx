import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, Summary } from '../lib/types'
import { CHART, GROUP_META, ROOM_ORDER, STATUS_COLOR, decisionLabel, splitCounts, statusInfo, type StatusGroup } from '../lib/constants'
import { cx, fmtDateK, fmtDateShort, fmtNum, fmtPct } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { Badge, Card, CardHeader, ChartCard, Empty, ErrorBox, Facts, GroupIcon, IconButton, LegendItem, Loading, PageHeader, PageSkeleton, Segmented, StatStrip, StatTile, StatusBadge, btnCls, inputBase, tbl } from '../components/ui'
import { DecisionIcon } from '../components/Gantt'
import RoomDrawer from '../components/RoomDrawer'


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
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(20,32,51,0.05)' } },
        formatter: (ps: unknown) => {
          const arr = ps as { dataIndex: number }[]
          const d = past[arr[0].dataIndex]
          const c = splitCounts(d)
          return (
            ttTitle(fmtDateK(d.date)) +
            ttRow(CHART.ink, '정합성', fmtPct(d.match_rate), 'rect') +
            ttRow(STATUS_COLOR.crit, '확인 필요', `${c.review}건`, 'rect') +
            ttRow(STATUS_COLOR.warn, '자동 조치', `${c.auto}건`, 'rect') +
            ttRow(CHART.axis, '검증 강의', `${d.sessions}건`, 'rect') +
            '<div style="color:#667183;margin-top:4px">눌러서 그날 강의별 결과 보기</div>'
          )
        },
      },
      xAxis: {
        type: 'category',
        data: cats,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmtDateShort(v) },
      },
      yAxis: { type: 'value', minInterval: 1, name: '건', ...axisCommon, nameTextStyle: { color: CHART.muted, fontSize: 11 }, axisLine: { show: false } },
      series: [
        {
          name: '확인 필요',
          type: 'bar',
          stack: 'n',
          barMaxWidth: 14,
          itemStyle: { color: STATUS_COLOR.crit, borderColor: '#ffffff', borderWidth: 1 },
          emphasis: { itemStyle: { color: '#b52e2e' } },
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
          itemStyle: { color: STATUS_COLOR.warn, borderRadius: [4, 4, 0, 0], borderColor: '#ffffff', borderWidth: 1 },
          emphasis: { itemStyle: { color: '#e09a00' } },
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
  if (!summary.data || !meta || !date) return <PageSkeleton label="학기 검증 결과를 불러오는 중…" />

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
    <div className="space-y-4">
      <PageHeader title="정합성 검증" desc="강의가 있는 시간에 냉난방이 계획대로 켜지고 꺼졌는지 매일 자동으로 확인합니다." />

      {/* the method is a real sequence: plan check, then execution check, then triage */}
      <section className="overflow-hidden rounded-[10px] border border-line bg-line" aria-label="검증 방법">
        <ol className="grid grid-cols-1 gap-px md:grid-cols-3">
          {[
            ['계획 검증', '모든 강의가 운전 계획에 들어 있는지 봅니다.', '계획 반영률'],
            ['실행 검증', `강의 중 실내기가 실제로 가동했고, 시작 시점에 쾌적 범위(${meta.settings.comfort_low}–${meta.settings.comfort_high}℃)였는지 봅니다.`, '실행률, 시작 온도'],
            ['이상 처리', '무단 휴강, 명령 실패, 수동 가동, 예보 오차는 시스템이 바로잡고 기록합니다. 사람이 봐야 할 것만 확인 필요로 올립니다.', '자동 조치, 확인 필요'],
          ].map(([t, d, m], i) => (
            <li key={t} className="flex gap-3 bg-surface px-5 py-4">
              <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-white" aria-hidden>
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-ink">{t}</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{d}</p>
                <div className="mt-1 text-[12px] text-ink-3">지표: {m}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <StatStrip>
        <StatTile label="정합성 (일치율)" value={kpi.match != null ? kpi.match.toFixed(2) : '–'} unit="%" sub={`학기 시작부터 오늘까지 강의일 ${kpi.days}일`} />
        <StatTile label="계획 반영률" value={kpi.cov != null ? kpi.cov.toFixed(1) : '–'} unit="%" sub={kpi.cov != null ? `계획에서 빠진 강의 ${(100 - kpi.cov).toFixed(1)}%` : undefined} />
        <StatTile label="검증한 강의" value={fmtNum(kpi.sessions)} unit="건" sub="강의와 이벤트를 회차별로 셈" />
        <StatTile label="자동 조치" icon={<GroupIcon group="auto" size={13} />} value={fmtNum(kpi.auto)} unit="건" sub="재실 감지 정지, 명령 재전송, 예보 보정" />
        <StatTile
          label="확인 필요"
          icon={<GroupIcon group="review" size={13} />}
          value={fmtNum(kpi.review)}
          unit="건"
          sub={kpi.sessions ? `검증한 강의의 ${((kpi.review / kpi.sessions) * 100).toFixed(2)}%` : undefined}
        />
      </StatStrip>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
        <ChartCard
          title="일별 자동 조치와 확인 필요 건수"
          sub="학기 시작부터 오늘까지의 강의일입니다. 막대를 누르면 아래에 그날의 강의별 결과가 나옵니다."
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
          <CardHeader title="이상이 있었던 날" sub={`${issueDays.length}일, 최근 날짜부터`} />
          <ul className="thin-scroll -mx-1 max-h-[268px] overflow-y-auto px-1">
            {issueDays.map((d) => {
              const c = splitCounts(d)
              return (
                <li key={d.date}>
                  <button
                    onClick={() => setDate(d.date)}
                    className={cx(
                      'flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-hover',
                      d.date === date && 'bg-well ring-1 ring-line-strong ring-inset',
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
              {fmtDateK(date)} 강의별 검증 결과
              {date > today && <Badge tone="info">예상</Badge>}
            </span>
          }
          sub={
            V ? (
              <Facts>
                {`강의 ${V.total}건`}
                {`정합성 ${fmtPct(V.match_rate)}`}
                {`계획 반영 ${fmtPct(V.plan_coverage, 0)}`}
                {`자동 조치 ${V.auto_actions}건`}
              </Facts>
            ) : (
              '불러오는 중…'
            )
          }
          right={
            <div className="flex items-center gap-1.5">
              <IconButton label="이전 강의일" disabled={idx <= 0} onClick={() => idx > 0 && setDate(past[idx - 1].date)} className="border border-line-strong">
                <ChevronLeft size={15} />
              </IconButton>
              <input
                type="date"
                aria-label="검증 날짜"
                className={cx(inputBase, 'tnum h-8 w-[150px]')}
                value={date}
                min={meta.semester.start}
                max={meta.semester.end}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
              <IconButton
                label="다음 강의일"
                disabled={idx < 0 || idx >= past.length - 1}
                onClick={() => idx >= 0 && idx < past.length - 1 && setDate(past[idx + 1].date)}
                className="border border-line-strong"
              >
                <ChevronRight size={15} />
              </IconButton>
              <Link to={`/schedule?date=${date}`} className={btnCls('secondary', 'md', 'ml-1')}>
                이 날 타임라인 보기
              </Link>
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented
            label="검증 결과 필터"
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
          <Empty
            title={V.sessions.length ? '조건에 맞는 강의가 없습니다' : '이 날은 강의가 없습니다'}
            desc={V.sessions.length ? '위의 결과 필터나 강의실 필터를 바꿔 보세요.' : '달력이나 위 화살표로 강의가 있는 날을 고르세요.'}
          />
        ) : (
          <div className={cx(tbl.frame, 'transition-opacity', day.loading && 'opacity-60')}>
            <table className={tbl.table}>
              <thead className={tbl.thead}>
                <tr>
                  <th className={tbl.th}>강의실</th>
                  <th className={tbl.th}>시간</th>
                  <th className={tbl.th}>강의</th>
                  <th className={tbl.th}>검증 결과</th>
                  <th className={tbl.th}>계획</th>
                  <th className={cx(tbl.th, 'w-[130px]')}>실행률</th>
                  <th className={tbl.thR}>시작 온도</th>
                  <th className={tbl.thR}>쾌적</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const info = statusInfo(v.status)
                  const er = v.exec_ratio ?? 0
                  return (
                    <tr
                      key={v.session}
                      className={cx(tbl.tr, 'cursor-pointer align-top hover:bg-well')}
                      onClick={() => setDrawer(v.room)}
                      tabIndex={0}
                      aria-label={`${v.room}호 ${v.title} 상세 보기`}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setDrawer(v.room))}
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
                          <div key={i} className="mt-1 max-w-[340px] text-[12px] text-ink-2">
                            {n}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-ink-2">{v.planned === false ? <span className="text-crit-ink">누락</span> : '반영'}</td>
                      <td className="px-3 py-2">
                        {v.exec_ratio != null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 rounded-full bg-[#e3e8ee]">
                              <div className="h-1.5 rounded-full bg-ink-2" style={{ width: `${Math.min(100, er * 100)}%` }} />
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
