import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Info, BarChart3 } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { Day, Summary } from '../lib/types'
import { CHART, GROUP_META, ROOM_ORDER, STATUS_COLOR, splitCounts, statusInfo } from '../lib/constants'
import { cx, fmtDateK, fmtDateShort, fmtNum, fmtPct } from '../lib/format'
import EChart, { axisCommon, baseTooltip, ttRow, ttTitle, type EChartsOption } from '../components/EChart'
import { Badge, Card, ChartCard, Disclosure, DisclosureList, Empty, ErrorBox, IconButton, LegendItem, Loading, PageHeader, PageSkeleton, Popover, StatusBadge, btnCls, inputBase, tbl } from '../components/ui'
import type { ValidationSession } from '../lib/types'
import RoomDrawer from '../components/RoomDrawer'


export default function Validation() {
  const { meta } = useMeta()
  const summary = useApi<Summary>('/api/summary')
  const [params, setParams] = useSearchParams()
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
            '<div style="color:#667183;margin-top:5px">눌러서 그날 강의별 결과 보기</div>'
          )
        },
      },
      xAxis: {
        type: 'category',
        data: cats,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmtDateShort(v) },
      },
      yAxis: { type: 'value', minInterval: 1, name: '건', ...axisCommon, nameTextStyle: { color: CHART.muted, fontSize: 12 }, axisLine: { show: false } },
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
                  label: { formatter: '선택', color: CHART.ink2, fontSize: 12, position: 'end' },
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
  const order = { review: 0, auto: 1, normal: 2 }
  const inRoom = (V?.sessions ?? []).filter((v) => roomF === 'all' || v.room === roomF)
  const sorted = [...inRoom].sort(
    (a, b) => order[statusInfo(a.status).group] - order[statusInfo(b.status).group] || a.start.localeCompare(b.start) || a.room.localeCompare(b.room),
  )
  const issues = sorted.filter((v) => statusInfo(v.status).group !== 'normal')
  const normal = sorted.filter((v) => statusInfo(v.status).group === 'normal')
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high

  return (
    <div>
      <PageHeader
        title="정합성 검증"
        desc={
          <>
            학기 시작부터 강의 <b className="tnum font-semibold text-ink">{fmtNum(kpi.sessions)}건</b>을 확인했고 정합성은{' '}
            <b className="tnum font-semibold text-ink">{kpi.match != null ? kpi.match.toFixed(2) : '–'}%</b>입니다. 시스템이{' '}
            <b className="tnum font-semibold text-ink">{fmtNum(kpi.auto)}건</b>을 바로잡았고, 사람이 확인할 건은{' '}
            <b className="tnum font-semibold text-crit-ink">{fmtNum(kpi.review)}건</b>입니다.
          </>
        }
        right={
          <Popover
            label="검증 방법"
            align="end"
            width={420}
            buttonClassName={btnCls('ghost', 'sm')}
            button={
              <>
                <Info size={14} aria-hidden /> 검증 방법
              </>
            }
          >
            <ol className="space-y-3 text-[13.5px]">
              {[
                ['계획 검증', '모든 강의가 운전 계획에 들어 있는지 봅니다.', `계획 반영률 ${kpi.cov != null ? kpi.cov.toFixed(1) : '–'}%`],
                ['실행 검증', `강의 중 실내기가 실제로 가동했고, 시작 시점에 쾌적 범위(${lo}–${hi}℃)였는지 봅니다.`, '실행률, 시작 온도'],
                ['이상 처리', '무단 휴강, 명령 실패, 수동 가동, 예보 오차는 시스템이 바로잡고 기록합니다. 사람이 봐야 할 것만 확인 필요로 올립니다.', '자동 조치, 확인 필요'],
              ].map(([t, d, m], i) => (
                <li key={t} className="flex gap-3">
                  <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12.5px] font-semibold text-white" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{t}</span>
                    <span className="block">{d}</span>
                    <span className="block text-[13px] text-ink-3">지표: {m}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Popover>
        }
      />

      <div data-tour="val-main" className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Card pad={false} className="self-start">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-[17px] font-[650] text-ink">이상이 있었던 날</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{issueDays.length}일, 최근 날짜부터</p>
          </div>
          <ul className="thin-scroll max-h-[452px] overflow-y-auto px-3 pb-3">
            {issueDays.map((d) => {
              const c = splitCounts(d)
              const on = d.date === date
              return (
                <li key={d.date}>
                  <button
                    type="button"
                    onClick={() => setDate(d.date)}
                    aria-pressed={on}
                    className={cx(
                      'flex h-11 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-[14px] transition-colors duration-150',
                      on ? 'bg-ink text-white' : 'text-ink hover:bg-hover',
                    )}
                  >
                    <span className="font-medium">{fmtDateK(d.date)}</span>
                    <span className={cx('tnum flex items-center gap-2 text-[13px]', on ? 'text-white/85' : 'text-ink-3')}>
                      {c.review > 0 && (
                        <span className={cx('inline-flex items-center gap-1 font-semibold', on ? 'text-white' : 'text-crit-ink')}>
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-crit" aria-hidden />
                          확인 {c.review}
                        </span>
                      )}
                      {c.auto > 0 && <span>조치 {c.auto}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card pad={false} className="self-start">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-7 pt-6">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-2.5 text-[17px] font-[650] text-ink">
                {fmtDateK(date)}
                {date > today && <Badge tone="info">예상</Badge>}
              </h2>
              <p className="tnum mt-0.5 text-[13.5px] text-ink-3">
                {V ? `강의 ${V.total}건, 정합성 ${fmtPct(V.match_rate)}, 자동 조치 ${V.auto_actions}건` : '불러오는 중…'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <IconButton label="이전 강의일" disabled={idx <= 0} onClick={() => idx > 0 && setDate(past[idx - 1].date)}>
                <ChevronLeft size={17} />
              </IconButton>
              <input
                type="date"
                name="validation-date"
                aria-label="검증 날짜"
                className={cx(inputBase, 'tnum h-9 w-[152px] text-[13.5px]')}
                value={date}
                min={meta.semester.start}
                max={meta.semester.end}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
              <IconButton
                label="다음 강의일"
                disabled={idx < 0 || idx >= past.length - 1}
                onClick={() => idx >= 0 && idx < past.length - 1 && setDate(past[idx + 1].date)}
              >
                <ChevronRight size={17} />
              </IconButton>
              <select className={cx(inputBase, 'ml-1 h-9 w-[124px] text-[13.5px]')} name="room-filter" value={roomF} onChange={(e) => setRoomF(e.target.value)} aria-label="강의실 필터">
                <option value="all">전체 강의실</option>
                {ROOM_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {r}호
                  </option>
                ))}
              </select>
              <Link to={`/schedule?date=${date}`} className={btnCls('ghost', 'sm', 'ml-1')}>
                타임라인 보기
              </Link>
            </div>
          </div>
          <div className="px-7 pt-5 pb-7">
            {day.error ? (
              <ErrorBox error={day.error} onRetry={day.reload} />
            ) : !V ? (
              <Loading />
            ) : inRoom.length === 0 ? (
              <Empty
                title={V.sessions.length ? '이 강의실에는 그날 강의가 없습니다' : '이 날은 강의가 없습니다'}
                desc={V.sessions.length ? '강의실 필터를 전체로 바꿔 보세요.' : '왼쪽 목록이나 화살표로 강의가 있는 날을 고르세요.'}
              />
            ) : (
              <div className={cx('transition-opacity duration-200', day.loading && 'opacity-60')}>
                {issues.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-[12px] bg-good-bg px-4 py-3 text-[14px] font-medium text-good-ink">
                    <StatusBadge group="normal" label="모두 정상" /> 이 날 강의 {inRoom.length}건이 모두 계획대로 운전됐습니다.
                  </div>
                ) : (
                  <SessionTable rows={issues} lo={lo} hi={hi} onOpen={setDrawer} />
                )}
                {issues.length > 0 && normal.length > 0 && (
                  <Disclosure variant="inline" className="mt-4" title={`정상 강의 ${normal.length}건 보기`}>
                    <SessionTable rows={normal} lo={lo} hi={hi} onOpen={setDrawer} />
                  </Disclosure>
                )}
                {issues.length === 0 && normal.length > 0 && (
                  <Disclosure variant="inline" className="mt-4" title={`강의 ${normal.length}건 목록 보기`}>
                    <SessionTable rows={normal} lo={lo} hi={hi} onOpen={setDrawer} />
                  </Disclosure>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <DisclosureList className="mt-6" title="자세히 보기" hideTitle>
        <Disclosure icon={<BarChart3 size={16} aria-hidden />} title="일별 자동 조치와 확인 필요 건수" summary={`강의일 ${past.length}일`}>
          <ChartCard
            bare
            sub="학기 시작부터 오늘까지의 강의일입니다. 막대를 누르면 그날의 강의별 결과가 위에 나옵니다."
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
              height={260}
              onEvents={{
                click: (p: unknown) => {
                  const q = p as { dataIndex: number }
                  if (past[q.dataIndex]) setDate(past[q.dataIndex].date)
                },
              }}
            />
          </ChartCard>
        </Disclosure>
      </DisclosureList>

      <RoomDrawer open={!!drawer} onClose={() => setDrawer(null)} day={day.data?.date === date ? day.data : undefined} meta={meta} room={drawer} />
    </div>
  )
}

function SessionTable({ rows, lo, hi, onOpen }: { rows: ValidationSession[]; lo: number; hi: number; onOpen: (room: string) => void }) {
  return (
    <div className={tbl.frame}>
      <table className={tbl.table}>
        <thead className={tbl.thead}>
          <tr>
            <th className={tbl.th}>강의실</th>
            <th className={tbl.th}>강의</th>
            <th className={tbl.th}>검증 결과</th>
            <th className={tbl.thR}>시작 온도</th>
            <th className={tbl.thR}>쾌적</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const info = statusInfo(v.status)
            const out = v.ta_start != null && (v.ta_start < lo || v.ta_start > hi)
            return (
              <tr
                key={v.session}
                className={cx(tbl.tr, 'cursor-pointer align-top transition-colors hover:bg-well')}
                onClick={() => onOpen(v.room)}
                tabIndex={0}
                aria-label={`${v.room}호 ${v.title} ${info.label}, 상세 보기`}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(v.room))}
                style={{ boxShadow: info.group !== 'normal' ? `inset 3px 0 0 ${GROUP_META[info.group].color}` : undefined }}
              >
                <td className="px-3.5 py-3 font-semibold text-ink">{v.room}</td>
                <td className="px-3.5 py-3">
                  <div className="font-medium text-ink">{v.title}</div>
                  <div className="tnum text-[13px] text-ink-3">
                    {v.start}–{v.end}
                  </div>
                </td>
                <td className="px-3.5 py-3">
                  <StatusBadge group={info.group} label={info.label} />
                  {v.notes.map((n, i) => (
                    <div key={i} className="mt-1 max-w-[420px] text-[13px] text-ink-2">
                      {n}
                    </div>
                  ))}
                </td>
                <td className={cx('px-3.5 py-3 text-right', out ? 'font-semibold text-crit-ink' : 'text-ink-2')}>{v.ta_start != null ? `${v.ta_start.toFixed(1)}℃` : '–'}</td>
                <td className="px-3.5 py-3 text-right text-ink-2">{v.comfort_pct != null ? `${v.comfort_pct.toFixed(0)}%` : '재실 없음'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
