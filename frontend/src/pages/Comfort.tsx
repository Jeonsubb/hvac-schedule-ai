import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Copy, ExternalLink, MessageSquarePlus, QrCode, Send, Users, Building2, CalendarDays, CalendarRange } from 'lucide-react'
import { apiSend, invalidate, useApi } from '../lib/api'
import type { Feedback, FeedbackSummary } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { SOURCE_LABEL, TAGS, VOTES, meanWord, signed, tagLabel, voteColor, voteLabel } from '../lib/comfort'
import { cx, fmtTs } from '../lib/format'
import '../studio/analytics.css'
import {
  Badge,
  Button,
  Disclosure,
  DisclosureList,
  Empty,
  ErrorBox,
  Field,
  PageSkeleton,
  Segmented,
  Spinner,
  btnCls,
  inputCls,
  toast,
  More,
} from '../components/ui'

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8) // 08–22

function safe(s: FeedbackSummary | undefined): FeedbackSummary | undefined {
  if (!s) return s
  return {
    items: Array.isArray(s.items) ? s.items : [],
    by_room: s.by_room && typeof s.by_room === 'object' ? s.by_room : {},
    by_hour: s.by_hour && typeof s.by_hour === 'object' ? s.by_hour : {},
    days: typeof s.days === 'number' ? s.days : 14,
  }
}

function answer(s: FeedbackSummary): string {
  const n = s.items.length
  if (!n) return `최근 ${s.days}일 동안 들어온 의견이 없습니다. 강의실 QR 링크를 붙여 재실자 의견을 받아 보세요.`
  const rooms = Object.entries(s.by_room).filter(([, v]) => v.n > 0)
  const cold = rooms.reduce((a, [, v]) => a + v.cold, 0)
  const hot = rooms.reduce((a, [, v]) => a + v.hot, 0)
  const top = [...rooms].sort((a, b) => b[1].n - a[1].n)[0]
  const lean = cold > hot ? `춥다는 쪽 의견이 ${cold}건으로 많고` : hot > cold ? `덥다는 쪽 의견이 ${hot}건으로 많고` : '춥다·덥다 의견이 비슷하고'
  return `최근 ${s.days}일 의견 ${n}건 중 ${lean}, ${top ? `${top[0]}호(${top[1].n}건)에 가장 많이 몰렸습니다` : '특정 강의실에 몰리지 않았습니다'}. 의견은 다음 2차·3차 스케줄과 에이전트 협의에 반영됩니다.`
}


function RoomTiles({ s, sel, onSel }: { s: FeedbackSummary; sel: string | null; onSel: (r: string | null) => void }) {
  return (
    <div className="comfort-atlas" aria-label="강의실별 체감 의견 평균">
      <div className="comfort-atlas-axis" aria-hidden><span>강의실</span><div><span>−3 / 춥다</span><span>0 / 적당하다</span><span>+3 / 덥다</span></div><span>평균 체감</span><span>의견</span></div>
      {ROOM_ORDER.map((r) => {
        const v = s.by_room[r]
        const mean = v?.n ? v.mean : null
        const hasMean = mean != null && Number.isFinite(mean)
        const position = hasMean ? ((Math.max(-3, Math.min(3, mean)) + 3) / 6) * 580 + 10 : null
        const on = sel === r
        return (
          <button key={r} type="button" aria-pressed={on} onClick={() => onSel(on ? null : r)}
            className={cx('comfort-atlas-room', on && 'is-selected')}
            title={`${r}호 · ${v?.n ?? 0}건 · ${hasMean ? `${meanWord(mean)}, 평균 ${signed(mean)}` : '의견 없음'}`}>
            <span className="comfort-atlas-room-id tnum">{r}<small>호</small></span>
            <svg className="comfort-atlas-trace" viewBox="0 0 600 36" aria-hidden>
              <line x1="10" x2="590" y1="18" y2="18" stroke="#e1e4ea" strokeWidth="1" />
              {[-3, -2, -1, 0, 1, 2, 3].map((v) => <line key={v} x1={((v + 3) / 6) * 580 + 10} x2={((v + 3) / 6) * 580 + 10} y1={v === 0 ? 5 : 14} y2={v === 0 ? 31 : 22} stroke={v === 0 ? '#a8aeb8' : '#dde1e7'} strokeWidth="1" />)}
              {position != null && <g className="comfort-trace-marker" style={{ transform: `translateX(${position}px)` }}>
                <circle className="comfort-trace-halo" cx="0" cy="18" r="15" fill={voteColor(mean)} opacity=".25" />
                <circle cx="0" cy="18" r={on ? 7 : 5} fill={voteColor(mean)} stroke={on ? '#1458ff' : '#fff'} strokeWidth="2" />
              </g>}
            </svg>
            <span className="comfort-atlas-mean"><b className="tnum">{hasMean ? signed(mean) : '—'}</b><small>{hasMean ? meanWord(mean) : '의견 없음'}</small></span>
            <span className="comfort-atlas-count tnum">{v?.n ?? 0}<small>건</small></span>
          </button>
        )
      })}
    </div>
  )
}

function HourGrid({ s, sel }: { s: FeedbackSummary; sel: string | null }) {
  const rooms = sel ? [sel] : ROOM_ORDER
  const any = rooms.some((r) => s.by_hour[r] && Object.keys(s.by_hour[r]).length)
  if (!any) return <p className="text-[14px] text-ink-3">시간대별로 나눌 의견이 아직 없습니다.</p>
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="tnum w-full min-w-[640px] border-separate border-spacing-1 text-[12.5px]">
        <thead>
          <tr>
            <th className="w-14" />
            {HOURS.map((h) => (
              <th key={h} className="font-medium text-ink-3">
                {h}시
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r}>
              <th className="pr-2 text-left text-[13px] font-semibold whitespace-nowrap text-ink">{r}호</th>
              {HOURS.map((h) => {
                const c = s.by_hour[r]?.[String(h)]
                return (
                  <td
                    key={h}
                    title={c ? `${r}호 ${h}시: ${c.n}건, 평균 ${signed(c.mean)} (${voteLabel(c.mean)})` : `${r}호 ${h}시: 의견 없음`}
                    className="h-8 rounded-[6px] text-center font-medium text-ink"
                    style={{ background: c ? voteColor(c.mean) : '#f7f8fa' }}
                  >
                    {c ? c.n : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
        {VOTES.filter((v) => v.v % 1 === 0 && [-3, -1, 0, 1, 3].includes(v.v)).map((v) => (
          <span key={v.v} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[3px] ring-1 ring-inset ring-black/5" style={{ background: v.color }} aria-hidden />
            {v.label}
          </span>
        ))}
        <span className="text-ink-3">칸의 숫자는 의견 수입니다.</span>
      </div>
    </div>
  )
}

function FeedbackRow({ f }: { f: Feedback }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10" style={{ background: voteColor(f.vote) }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tnum text-[14.5px] font-semibold text-ink">{f.room}호</span>
          <span className="text-[14.5px] text-ink">{voteLabel(f.vote)}</span>
          {f.tags?.map((t) => (
            <Badge key={t} tone="neutral">
              {tagLabel(t)}
            </Badge>
          ))}
          <Badge tone={f.source === 'occupant' ? 'info' : f.source === 'operator' ? 'event' : 'outline'}>{SOURCE_LABEL[f.source] ?? f.source}</Badge>
        </div>
        {f.text && <p className="mt-1 text-[14px] leading-relaxed text-ink-2">&ldquo;{f.text}&rdquo;</p>}
        <div className="mt-1 text-[13px] text-ink-3">
          {fmtTs(f.ts)}
          {f.status === 'reflected' ? <span className="text-good-ink">, {f.reflected_in ? `${f.reflected_in}에 반영` : '반영됨'}</span> : <span>, 다음 검증 때 반영 예정</span>}
        </div>
      </div>
    </li>
  )
}

function OperatorForm({ defaultRoom, onSent }: { defaultRoom: string | null; onSent: () => void }) {
  const [room, setRoom] = useState(defaultRoom ?? ROOM_ORDER[0])
  const [vote, setVote] = useState<number>(-2)
  const [tags, setTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const send = async () => {
    setBusy(true)
    setErr(null)
    try {
      await apiSend('POST', '/api/feedback', { room, vote, tags, text: text.trim(), source: 'operator' })
      toast(`${room}호 의견을 등록했습니다. 다음 검증에 반영됩니다.`)
      setText('')
      setTags([])
      onSent()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
        <Field label="강의실">
          <select className={inputCls} name="room" value={room} onChange={(e) => setRoom(e.target.value)}>
            {ROOM_ORDER.map((r) => (
              <option key={r} value={r}>
                {r}호
              </option>
            ))}
          </select>
        </Field>
        <Field label="들어온 불편">
          <select className={inputCls} name="vote" value={vote} onChange={(e) => setVote(Number(e.target.value))}>
            {VOTES.map((v) => (
              <option key={v.v} value={v.v}>
                {v.label} ({signed(v.v, 0)})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="추가 불편">
        {TAGS.map((t) => {
          const on = tags.includes(t.key)
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => setTags((x) => (on ? x.filter((k) => k !== t.key) : [...x, t.key]))}
              className={cx(
                'h-8 rounded-full border px-3 text-[13px] font-medium transition-colors',
                on ? 'border-brand bg-brand-bg text-brand-ink' : 'border-line-strong text-ink-2 hover:border-ink-4',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <Field label="내용 (전화·메일로 받은 문의 요약)">
        <input className={inputCls} name="note" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="예: 3교시 창가 쪽이 춥다는 전화 문의…" />
      </Field>
      {err && <ErrorBox title="등록하지 못했습니다" error={err} />}
      <Button variant="primary" onClick={send} disabled={busy}>
        {busy ? <Spinner size={15} className="text-white" /> : <Send size={15} aria-hidden />}
        의견 등록
      </Button>
    </div>
  )
}

function LinkList() {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast('링크를 복사했습니다.', 'neutral')
    } catch {
      toast('복사하지 못했습니다. 링크를 직접 선택하세요.', 'crit')
    }
  }
  return (
    <div>
      <More className="mb-3"><p>강의실 문 옆에 QR 코드로 붙여 두면 재실자가 로그인 없이 바로 의견을 보냅니다. 이름이나 학번은 받지 않습니다.</p></More>
      <ul className="grid gap-2 sm:grid-cols-2">
        {ROOM_ORDER.map((r) => {
          const url = `${base}/feedback?room=${r}`
          return (
            <li key={r} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2">
              <span className="tnum w-12 shrink-0 text-[14px] font-semibold text-ink">{r}호</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-3" translate="no">
                {url}
              </span>
              <button type="button" onClick={() => copy(url)} className={btnCls('ghost', 'sm')} aria-label={`${r}호 링크 복사`}>
                <Copy size={13} aria-hidden />
              </button>
              <a href={`/feedback?room=${r}`} target="_blank" rel="noreferrer" className={btnCls('ghost', 'sm')} aria-label={`${r}호 의견 화면 새 창으로 열기`}>
                <ExternalLink size={13} aria-hidden />
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function HowItFeeds() {
  const rows = [
    {
      icon: CalendarRange,
      title: '2차 · 주간 조정',
      body: '지난 7일 의견이 2건 이상 몰린 강의실은 정책 온도 범위 안에서 설정온도 조정안을 만들고, 시뮬레이터로 전력 변화를 계산합니다.',
    },
    {
      icon: CalendarDays,
      title: '3차 · 일일 검증',
      body: '오늘 들어온 의견은 그 강의실의 다음 수업 설정온도와 환기 단계(답답함은 CO₂ 기준과 함께)에 반영합니다.',
    },
    {
      icon: Users,
      title: '사용자 온디',
      body: '의견을 근거로 쾌적을 대변합니다. 관리자 온디는 요금과 정부 지침을 근거로 비용을 대변하고, 두 제안을 시뮬레이터로 검증합니다.',
    },
    {
      icon: Building2,
      title: '운전 모드',
      body: '자동 운전 모드에서는 합의된 조정이 바로 반영되고, 추천 모드에서는 상단의 승인 대기에서 담당자가 승인해야 반영됩니다.',
    },
  ]
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.title} className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-bg text-brand" aria-hidden>
            <r.icon size={16} />
          </span>
          <div>
            <div className="text-[14.5px] font-semibold text-ink">{r.title}</div>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{r.body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Comfort() {
  const [params, setParams] = useSearchParams()
  const days = Number(params.get('days')) || 14
  const sel = params.get('room')
  const q = useApi<FeedbackSummary>(`/api/feedback?days=${days}`, { maxAgeMs: 30_000, refreshMs: 60_000 })
  const s = safe(q.data)
  const [showAll, setShowAll] = useState(false)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v == null) p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }

  const items = useMemo(() => {
    const list = s ? [...s.items].sort((a, b) => (a.ts < b.ts ? 1 : -1)) : []
    return sel ? list.filter((f) => f.room === sel) : list
  }, [s, sel])

  if (q.error && !s) return <ErrorBox title="쾌적 의견을 불러오지 못했습니다" error={q.error} onRetry={q.reload} />
  if (!s) return <PageSkeleton label="쾌적 의견을 불러오는 중…" />

  const shown = showAll ? items : items.slice(0, 12)
  const reloadAll = () => {
    invalidate('/api/feedback')
    invalidate('/api/plan')
  }

  const simulated = s.items.filter((f) => f.source === 'simulated').length
  const real = s.items.filter((f) => f.source === 'occupant' || f.source === 'operator').length
  const selectedStats = sel ? s.by_room[sel] : undefined
  return (
    <div className="analytics-experience comfort-experience">
      <header className="analytics-masthead" data-studio-enter>
        <div>
          <p className="analytics-kicker"><span>06 / HUMAN SIGNALS</span><span>체감 의견 분석</span></p>
          <h1>쾌적은,<br /><em>사람의 언어로.</em></h1>
        </div>
        <div className="analytics-masthead-aside">
          <p>센서가 아닌 의견으로 읽는 공간.<br />재실자의 체감을 운전 판단의 근거로 연결합니다.</p>
          <Segmented label="기간" value={String(days) as '7' | '14' | '30'} onChange={(v) => setParam('days', v)} options={[
            { value: '7', label: '최근 7일' }, { value: '14', label: '14일' }, { value: '30', label: '30일' },
          ]} />
        </div>
      </header>

      {q.error && <div className="analytics-stale-message" role="alert">의견을 갱신하지 못해 마지막 응답을 표시합니다. <button type="button" onClick={q.reload}>다시 시도</button></div>}
      <div className="comfort-source-ledger" aria-label="의견 출처 구분">
        <div className="comfort-ledger-total"><strong className="tnum">{s.items.length}</strong><span>조회된 의견<br /><small>최근 {s.days}일</small></span></div>
        <div><strong className="tnum">{real}</strong><span>재실자·운영자 의견</span></div>
        <div><strong className="tnum">{simulated}</strong><span>시뮬레이션 의견</span></div>
        <p>아래 평균에는 조회된 출처가 함께 포함됩니다.<br />각 의견의 출처와 반영 상태는 기록에서 확인합니다.</p>
      </div>

      <section className="comfort-opinion-field" data-tour="comfort-rooms" aria-labelledby="comfort-field-title">
        <div className="analytics-section-head">
          <div><span className="analytics-section-index">01</span><h2 id="comfort-field-title">10개의 공간, 서로 다른 체감</h2></div>
          {sel ? <Button size="sm" variant="ghost" onClick={() => setParam('room', null)}>전체 강의실</Button> : <span className="analytics-small-note">강의실을 선택해 시간대와 기록 탐색</span>}
        </div>
        <RoomTiles s={s} sel={sel} onSel={(r) => setParam('room', r)} />
        <p className="analytics-source-note">ASHRAE 7점 체감 척도 −3(춥다) ~ +3(덥다)의 의견 평균입니다. 예측 실내온도나 PMV와는 다른 지표입니다.</p>
      </section>

      <div className="comfort-analysis-layout">
        <div className="comfort-analysis-main">
          <section className="comfort-hour-field" data-tour="comfort-hours" aria-labelledby="comfort-hours-title">
            <div className="analytics-section-head"><div><span className="analytics-section-index">02</span><h2 id="comfort-hours-title">{sel ? `${sel}호의 시간별 체감` : '반복되는 시간, 반복되는 신호'}</h2></div></div>
            <p className="comfort-section-intro">같은 시간대의 반복 의견은 예열·예냉과 설정온도를 검토할 근거가 됩니다.</p>
            <HourGrid s={s} sel={sel} />
          </section>
          <section className="comfort-feedback-stream" aria-labelledby="comfort-stream-title">
            <div className="analytics-section-head"><div><span className="analytics-section-index">03</span><h2 id="comfort-stream-title">{sel ? `${sel}호 의견 기록` : '공간에서 온 기록'}</h2></div><span className="analytics-small-note tnum">{items.length}건 {q.loading && <Spinner size={13} />}</span></div>
            {items.length === 0 ? <Empty title="의견이 없습니다" desc="재실자 QR 링크를 공유하거나 운영자가 받은 문의를 등록하세요." icon={<MessageSquarePlus size={18} />} /> : <>
              <ul className="comfort-stream-list">{shown.map((f) => <FeedbackRow key={f.id} f={f} />)}</ul>
              {items.length > shown.length && <button type="button" onClick={() => setShowAll(true)} className="comfort-more-records">{items.length - shown.length}건 더 보기 <span aria-hidden>↓</span></button>}
            </>}
          </section>
        </div>
        <aside className="comfort-intake-rail">
          <div className="comfort-selection-summary">
            <span className="analytics-kicker">{sel ? 'SELECTED SPACE' : 'READ THE SIGNAL'}</span>
            <h2>{sel ? <>{sel}<small>호</small></> : '의견이 정책이 되는 과정.'}</h2>
            {sel && <p>{selectedStats?.n ? `${meanWord(selectedStats.mean)} · 평균 ${signed(selectedStats.mean)} · ${selectedStats.n}건` : '선택 기간에 등록된 의견이 없습니다.'}</p>}
            <p>{answer(s)}</p>
          </div>
          <section className="comfort-intake-form" data-tour="comfort-form" aria-labelledby="comfort-intake-title">
            <p className="analytics-kicker">CAPTURE / OPERATOR INPUT</p>
            <h2 id="comfort-intake-title">들은 의견을,<br />판단의 근거로.</h2>
            <p className="comfort-section-intro">전화·메일·민원으로 들어온 불편을 운영자 의견으로 등록합니다.</p>
            <OperatorForm key={sel ?? 'all'} defaultRoom={sel} onSent={reloadAll} />
          </section>
          <DisclosureList className="analytics-disclosures" hideTitle>
            <Disclosure title="재실자 의견 링크 / QR" icon={<QrCode size={16} aria-hidden />} summary="10개 강의실"><LinkList /></Disclosure>
            <Disclosure title="운전계획에 반영되는 방식" icon={<Users size={16} aria-hidden />}>
              <HowItFeeds /><p className="mt-4 text-[13px] text-ink-3">조정안과 협의 근거는 <Link to="/plan" className="text-brand-ink hover:underline">AI 협의 화면</Link>에서 확인합니다.</p>
            </Disclosure>
          </DisclosureList>
        </aside>
      </div>
    </div>
  )
}
