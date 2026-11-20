import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileUp, RotateCcw, Clock3, ArrowLeft, Download } from 'lucide-react'
import { useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import { useAuth } from '../lib/auth'
import TimetableApply, { type AppliedSummary } from '../components/TimetableApply'
import { Ondy } from '../components/PublicShell'
import type { Day, Live, Meta, OpMode } from '../lib/types'
import { COLD_START, STRATEGY, decisionLabel, statusInfo } from '../lib/constants'
import { cx, fmtDateK, fmtKwh, fmtMin, fmtPct, fmtWon, hm, pctSaving } from '../lib/format'
import { MODE, buildingAt, buildingFromLive, type BuildingState } from '../lib/thermal'
import BuildingView, { MapLegend, TimeScrubber } from '../components/BuildingView'
import { DecisionIcon, decisionMinute } from '../components/Gantt'
import { RoomDetails, RoomHero, type RoomNow } from '../components/RoomDrawer'
import {
  Button,
  ErrorBox,
  Figure,
  PageSkeleton,
  Popover,
  Segmented,
  Skeleton,
  btnCls,
  inputBase,
} from '../components/ui'

export default function Overview() {
  const { meta, error: metaError, reload: reloadMeta } = useMeta()
  const [params, setParams] = useSearchParams()
  const at = params.get('at')
  const live = useApi<Live>(at ? `/api/live?at=${encodeURIComponent(at)}` : '/api/live', { maxAgeMs: 30_000, refreshMs: at ? undefined : 60_000 })
  const date = live.data?.now.date
  const day = useApi<Day>(date ? `/api/day/${date}` : null)
  // the selected room lives in the URL (?room=407): the page shows that room instead of the whole building
  const drawerRoom = params.get('room')
  const setDrawerRoom = useCallback(
    (r: string | null) =>
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (r) n.set('room', r)
          else n.delete('room')
          return n
        },
        { replace: false },
      ),
    [setParams],
  )
  const [viewMinute, setViewMinute] = useState<number | null>(null)
  const [viewKey, setViewKey] = useState<string | null>(null)

  // scrubbed minute belongs to one reference date; reset when the date changes
  const key = `${date}|${at ?? ''}`
  if (viewKey !== key) {
    setViewKey(key)
    setViewMinute(null)
  }
  const onScrub = useCallback((m: number) => setViewMinute(m), [])
  // before ON:D AI is applied the dashboard shows the building as it runs today (central control,
  // fixed schedule); after the timetable is reflected and AI is applied it switches to the AI operation
  const { user } = useAuth()
  const applied = user?.applied !== false
  const [view, setView] = useState<'current' | 'ai'>(applied ? 'ai' : 'current')
  const [ttOpen, setTtOpen] = useState(false)
  const [justApplied, setJustApplied] = useState<AppliedSummary | null>(null)
  useEffect(() => setView(applied ? 'ai' : 'current'), [applied])

  if (live.error) return <ErrorBox title="건물 상태를 불러오지 못했습니다" error={live.error} onRetry={live.reload} />
  if (metaError && !meta) return <ErrorBox title="기본 정보를 불러오지 못했습니다" error={metaError} onRetry={reloadMeta} />
  if (!meta || !live.data) return <PageSkeleton label="건물 상태를 불러오는 중…" />

  const L = live.data
  const now = L.now
  const D = day.data?.date === now.date ? day.data : undefined
  const scrubbing = viewMinute != null && viewMinute !== now.minute && !!D
  const cur = view === 'current'
  const minute = scrubbing ? viewMinute! : now.minute
  if (cur && !D) return <PageSkeleton label="현재 운영 상태를 불러오는 중…" />
  const shown = cur ? buildingAt(D!, meta, minute, 'fixed') : scrubbing ? buildingAt(D!, meta, viewMinute!) : buildingFromLive(L, meta, D)
  const ref: 'now' | 'replay' | 'scrub' = scrubbing ? 'scrub' : at ? 'replay' : 'now'
  const drawerNow = drawerRoom ? roomNow(shown, meta, drawerRoom, minute, scrubbing ? (minute > now.minute ? '계획' : '기록') : at ? '재현' : '현재') : undefined

  return (
    <div>
      {/* the page's answer: one sentence from the data, set as the landing's display type, + key numbers.
          Keyed on the view so switching current <-> ON:D AI replays the rise: the change is the moment. */}
      <header data-tour="ov-summary" className="mb-9 grid grid-cols-1 gap-x-14 gap-y-7 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h1 className="sr-only">운영 현황</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            {at && (
              <span className="inline-flex items-center gap-2 rounded-full bg-brand px-3 py-1 text-[13px] font-semibold text-white">
                <Clock3 size={14} aria-hidden />
                <span className="tnum">
                  {fmtDateK(now.date)} {fmtMin(now.minute)} 재현 중
                </span>
              </span>
            )}
          </div>
          {(() => {
            const text = cur ? currentSentence(shown, meta, D!, minute, applied) : now.live || at ? summarize(shown, meta, D, minute, ref) : null
            if (!text) return <p className="mt-4 max-w-[62ch] text-[16.5px] leading-[1.6] text-warn-ink">{now.reason}</p>
            const [l1, l2, rest] = splitHead(text)
            return (
              <div key={view}>
                <p className="display balance mt-4 max-w-[24em] text-[clamp(28px,2.5vw,38px)]">
                  <span className="rise-mask">
                    <span className="rise-line">{l1}</span>
                  </span>
                  {l2 && (
                    <span className="rise-mask">
                      <span className="rise-line d1">{l2}</span>
                    </span>
                  )}
                </p>
                {rest && <p className="pretty fade-in mt-4 max-w-[62ch] text-[17px] leading-[1.55] text-ink-2">{rest}</p>}
              </div>
            )
          })()}
          <div className="mt-7">{cur ? <CurrentFigures L={L} /> : <ManagerFigures L={L} at={!!at} />}</div>
        </div>
        {cur && !applied ? <ApplyCta onUpload={() => setTtOpen(true)} /> : <div className="xl:pt-1"><ViewSwitch view={view} onChange={setView} /></div>}
      </header>
      <TimetableApply
        open={ttOpen}
        onClose={() => setTtOpen(false)}
        onApplied={(sum) => {
          setJustApplied(sum)
          setView('ai')
        }}
      />
      {justApplied && !cur && <AppliedBanner s={justApplied} L={L} onCompare={() => setView('current')} onClose={() => setJustApplied(null)} />}

      {drawerRoom && meta.rooms[drawerRoom] ? (
        /* one room in focus (mock 1): the room card, its status and its chart, then the day's detail */
        <section aria-labelledby="room-focus-title">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => setDrawerRoom(null)}>
                <ArrowLeft size={14} aria-hidden /> 건물 전체
              </Button>
              <h2 id="room-focus-title" className="sr-only">
                {drawerRoom}호 상세
              </h2>
              <RoomPicker meta={meta} state={shown} value={drawerRoom} onChange={setDrawerRoom} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('tnum rounded-full px-3 py-1 text-[13.5px] font-semibold', scrubbing ? 'bg-brand text-white' : 'bg-well text-ink-2')}>
                {fmtMin(minute)} {scrubbing ? (minute > now.minute ? '계획' : '기록') : at ? '재현' : '현재'}
              </span>
              {D && (
                <a href={`/api/export/plan.csv?date=${D.date}&strategy=ai`} className={btnCls('ghost', 'sm')} download>
                  <Download size={14} aria-hidden /> 운전 계획 CSV
                </a>
              )}
            </div>
          </div>
          <RoomHero day={D} meta={meta} room={drawerRoom} now={drawerNow} layout="page" />
          {D ? (
            <div className="mt-6">
              <RoomDetails day={D} meta={meta} room={drawerRoom} />
            </div>
          ) : day.error ? (
            <div className="mt-6">
              <ErrorBox error={day.error} onRetry={day.reload} />
            </div>
          ) : (
            <Skeleton className="mt-6 h-[120px]" />
          )}
        </section>
      ) : (
        /* hero: the building as floor plates */
        <section data-tour="ov-building" className="relative overflow-hidden rounded-[26px] border border-line bg-[#fafafb]" aria-labelledby="bv-title">
          <div className="ground-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-8 pt-7">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h2 id="bv-title" className="text-[20px] leading-[1.3] font-bold tracking-[-0.025em] text-ink">
                IT관 3·4층
              </h2>
              {(scrubbing || at) && (
                <span className={cx('tnum rounded-full px-3 py-1 text-[13px] font-semibold', scrubbing ? 'bg-brand text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>
                  {fmtMin(minute)} {scrubbing ? (minute > now.minute ? '계획' : '기록') : '재현'}
                </span>
              )}
              {scrubbing && (
                <Button size="sm" variant="ghost" onClick={() => setViewMinute(null)}>
                  <RotateCcw size={13} aria-hidden /> {at ? '기준 시각으로' : '지금으로'}
                </Button>
              )}
            </div>
          </div>
          <div className="relative px-5 pt-4 pb-2">
            <BuildingView meta={meta} state={shown} onRoomClick={setDrawerRoom} selected={drawerRoom} showOdus={false} />
          </div>
          <div data-tour="ov-time" className="relative border-t border-line bg-surface px-8 pt-9 pb-7">
            {D ? (
              <TimeScrubber day={D} meta={meta} minute={minute} nowMinute={now.minute} onChange={onScrub} refLabel={at ? '기준 시각' : '지금'} />
            ) : day.error ? (
              <ErrorBox error={day.error} onRetry={day.reload} />
            ) : (
              <Skeleton className="h-[40px]" />
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <MapLegend meta={meta} />
              {at && (
                <ReplayControl
                  now={now}
                  at={at}
                  semester={meta.semester}
                  onSet={(v) =>
                    setParams((prev) => {
                      const n = new URLSearchParams(prev)
                      if (v) n.set('at', v)
                      else n.delete('at')
                      return n
                    })
                  }
                />
              )}
            </div>
          </div>
        </section>
      )}

      {!drawerRoom && !cur && <NextActions day={D} nowMinute={now.minute} onOpen={setDrawerRoom} />}
    </div>
  )
}

// ---------------------------------------------------------------- the one-sentence summary (computed, no LLM)

const MODE_VERB: Record<string, string> = { heat: '난방하며', cool: '냉방하며', air: '송풍(외기 냉방)으로 식히며' }

/** "지금 강의실 2곳을 난방하며 수업 중인 2곳은 모두 쾌적하고, 다음 AI 조치는 13:11 405호 최적 기동입니다." */
function summarize(state: BuildingState, meta: Meta, day: Day | undefined, minute: number, ref: 'now' | 'replay' | 'scrub'): string {
  const lo = meta.settings.comfort_low
  const hi = meta.settings.comfort_high
  const running = state.rooms.filter((r) => r.mode !== 'off')
  const occupied = state.rooms.filter((r) => r.session)
  const outBand = occupied.filter((r) => Number.isFinite(r.ta) && (r.ta < lo || r.ta > hi))
  const modes = [...new Set(running.map((r) => r.mode))]
  const prefix = ref === 'now' ? '지금 ' : ref === 'replay' ? `${fmtMin(minute)} 현재 ` : `${fmtMin(minute)}에는 `
  const rooms = (rs: { room: string }[]) => rs.map((r) => `${r.room}호`).join(', ')

  let a = ''
  if (running.length) {
    a = `강의실 ${running.length}곳을 ${modes.length === 1 ? MODE_VERB[modes[0]] : '가동하며'} `
    if (!occupied.length) a += '수업 전 미리 맞추고 있고'
    else if (!outBand.length) a += occupied.length === 1 ? `수업 중인 ${occupied[0].room}호는 쾌적하고` : `수업 중인 ${occupied.length}곳은 모두 쾌적하고`
    else a += `수업 중인 ${rooms(outBand)}가 아직 쾌적 범위 밖이고`
  } else if (occupied.length) {
    a = outBand.length
      ? `수업 중인 ${rooms(outBand)}가 쾌적 범위 밖이고`
      : occupied.length === 1
        ? `수업 중인 ${occupied[0].room}호가 가동 없이도 쾌적하고`
        : `수업 중인 ${occupied.length}곳이 가동 없이도 쾌적하고`
  } else {
    a = '모든 강의실이 정지해 있고'
  }

  let b = '이후 예정된 AI 조치는 없습니다.'
  if (day) {
    const plan = day.strategies.ai?.plan ?? {}
    const next = day.decisions
      .map((d) => ({ d, m: decisionMinute(d, plan[d.room]) }))
      .filter((x) => x.m > minute)
      .sort((x, y) => x.m - y.m)[0]
    if (next) b = `다음 AI 조치는 ${fmtMin(next.m)} ${next.d.room}호 ${decisionLabel(next.d.type)}입니다.`
    else if (!day.sessions.some((s) => hm(s.end) > minute)) b = '오늘 남은 강의는 없습니다.'
  } else {
    b = ''
  }
  return `${prefix}${a}${b ? `, ${b}` : '.'}`
}

/** What the drawer shows under "지금": this room's state and its outdoor unit at the shown minute. */
function roomNow(state: BuildingState, meta: Meta, room: string, minute: number, label: string): RoomNow | undefined {
  const r = state.rooms.find((x) => x.room === room)
  if (!r) return undefined
  const oduId = meta.rooms[room]?.odu
  const odu = oduId ? state.odus[oduId] : undefined
  return { ...r, minute, label, odu: odu && oduId ? { id: oduId, ...odu } : undefined }
}

// ---------------------------------------------------------------- room picker (switch rooms without going back)

function RoomPicker({ meta, state, value, onChange }: { meta: Meta; state: BuildingState; value: string; onChange: (r: string) => void }) {
  const rooms = Object.values(meta.rooms).sort((a, b) => b.floor - a.floor || a.id.localeCompare(b.id))
  return (
    <div className="thin-scroll flex max-w-full gap-1 overflow-x-auto" role="group" aria-label="강의실 선택">
      {rooms.map((r) => {
        const st = state.rooms.find((x) => x.room === r.id)
        const on = r.id === value
        const run = st && st.mode !== 'off'
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(r.id)}
            className={cx(
              'tnum inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150',
              on ? 'border-brand bg-brand-bg text-brand-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            {run && <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: MODE[st!.mode].color }} aria-hidden />}
            {r.id}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- the manager's three numbers: money, comfort, to-do

function ManagerFigures({ L, at }: { L: Live; at: boolean }) {
  const ds = L.date_summary
  const so = L.kwh_so_far
  const ai = ds.strategies.ai
  const fx = ds.strategies.fixed
  const pct = pctSaving(fx.cost_krw, ai.cost_krw)
  const modeQ = useApi<OpMode>('/api/mode', { maxAgeMs: 20_000, refreshMs: 60_000 })
  const pending = Number(modeQ.data?.pending) || 0
  const review = ds.needs_review ?? Math.max((ds.anomalies ?? 0) - (ds.auto_actions ?? 0), 0)
  const todo = pending + review
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-5">
      <Figure
        label={at ? '이 날 전기요금 (AI 운전)' : '오늘 전기요금 (AI 운전)'}
        value={fmtWon(ai.cost_krw)}
        accent={STRATEGY.ai.color}
        sub={`기존 방식이면 ${fmtWon(fx.cost_krw)}${pct != null ? ` · −${pct.toFixed(0)}%` : ''}`}
        info={
          <div className="space-y-2 text-[13.5px]">
            <p>기존 방식은 중앙 제어 고정 스케줄(평일 08:30–22:30 일괄 가동)입니다. 같은 시간표와 날씨로 열모델 시뮬레이션해 비교했고, 요금은 한전 교육용(을) 시간대별 단가입니다.</p>
            <div className="tnum">
              {at ? '이 시각까지' : '지금까지'} 전력: 기존 방식 {fmtKwh(so.fixed)} kWh → AI {fmtKwh(so.ai)} kWh
            </div>
            <div className="tnum">
              하루 전체: {fmtKwh(fx.kwh)} → {fmtKwh(ai.kwh)} kWh
            </div>
          </div>
        }
      />
      <Figure
        label="수업 중 쾌적"
        value={ai.comfort_pct != null ? ai.comfort_pct.toFixed(0) : '–'}
        unit="%"
        sub={`강의 ${ds.sessions}건 · ${COLD_START.short} ${ai.cold_starts ?? 0}건`}
        info={
          <div className="space-y-2 text-[13.5px]">
            <p>강의 시간 중 실내온도가 쾌적 범위 안이었던 비율입니다(오늘 하루, 지금 이후는 AI 계획 기준). {COLD_START.desc}</p>
            <div className="tnum">기존 방식 {fmtPct(fx.comfort_pct)} · 계획·실행 정합 {fmtPct(ds.match_rate)}</div>
          </div>
        }
      />
      <Link to="/plan?tier=3" className="group -m-2 block rounded-[14px] p-2 transition-colors hover:bg-hover" title="AI 스케줄링 › 3차 검증으로">
        <Figure
          label="할 일"
          value={todo}
          unit="건"
          align="right"
          sub={pending ? `승인 대기 ${pending}${review ? ` · 확인 필요 ${review}` : ''}` : review ? `확인 필요 ${review}` : '지금 할 일이 없습니다'}
        />
      </Link>
    </div>
  )
}

/** What the AI will do next today, as three lines the manager can read without opening anything. */
function NextActions({ day, nowMinute, onOpen }: { day: Day | undefined; nowMinute: number; onOpen: (r: string) => void }) {
  if (!day) return null
  const items = feedItems(day)
    .filter((i) => i.kind === 'decision' && i.minute > nowMinute)
    .slice(0, 3)
  if (items.length === 0) return null
  return (
    <section className="mt-6 rounded-[22px] border border-line bg-surface p-6" aria-labelledby="next-title" data-tour="ov-next">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="next-title" className="text-[17px] leading-[1.35] font-[650] tracking-[-0.015em] text-ink">
          오늘 남은 AI 조치
        </h2>
        {items.length > 0 && <span className="text-[13px] text-ink-3">시각이 되면 자동으로 실행됩니다. 누르면 그 강의실로 갑니다.</span>}
      </div>
      {(
        <ol className="mt-3 divide-y divide-line">
          {items.map((it, i) => (
            <li key={i}>
              <button type="button" onClick={() => onOpen(it.room)} className="flex w-full items-center gap-4 rounded-[10px] px-2 py-3 text-left transition-colors hover:bg-well">
                <span className="tnum w-14 shrink-0 text-[16px] font-bold text-ink">{fmtMin(it.minute)}</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden>
                  <DecisionIcon type={it.type ?? ''} size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold text-ink">
                    <span className="tnum text-ink-2">{it.room}호</span> {it.title}
                  </span>
                  <span className="block truncate text-[13px] leading-[1.5] text-ink-3">{it.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- replay another time (behind a popover)

function ReplayControl({ now, at, semester, onSet }: { now: Live['now']; at: string | null; semester: { start: string; end: string }; onSet: (v: string | null) => void }) {
  const [val, setVal] = useState(at ?? `${now.date}T${fmtMin(now.minute)}`)
  return (
    <>
      {at && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onSet(null)
            setVal('')
          }}
        >
          <RotateCcw size={13} aria-hidden /> 실시간으로
        </Button>
      )}
      <Popover
        label="다른 시점 재현"
        align="end"
        width={320}
        buttonClassName={btnCls('secondary', 'sm')}
        button={
          <>
            <Clock3 size={14} aria-hidden /> 다른 시점
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (val) onSet(val)
          }}
        >
          <div>
            <label className="text-[14px] font-semibold text-ink" htmlFor="replay-at">
              다른 시점 재현
            </label>
            <p className="mt-0.5 text-[13px] text-ink-3">학기 중 어느 시각이든 그때의 건물 상태를 다시 계산해 보여 줍니다.</p>
          </div>
          <input
            id="replay-at"
            name="replay-at"
            type="datetime-local"
            className={cx(inputBase, 'tnum w-full')}
            value={val}
            min={`${semester.start}T00:00`}
            max={`${semester.end}T23:55`}
            step={300}
            onChange={(e) => setVal(e.target.value)}
          />
          <Button type="submit" variant="primary" className="w-full">
            이 시점 보기
          </Button>
        </form>
      </Popover>
    </>
  )
}

// ---------------------------------------------------------------- detail: decision feed

type FeedItem = {
  minute: number
  kind: 'decision' | 'auto' | 'history'
  room: string
  title: string
  detail: string
  type?: string
}

function feedItems(day: Day): FeedItem[] {
  const out: FeedItem[] = []
  const plan = day.strategies.ai?.plan ?? {}
  for (const d of day.decisions) {
    out.push({ minute: decisionMinute(d, plan[d.room]), kind: 'decision', room: d.room, title: `${decisionLabel(d.type)}, ${d.title}`, detail: d.detail, type: d.type })
  }
  for (const v of day.validation.sessions) {
    const info = statusInfo(v.status)
    if (info.group !== 'auto') continue
    out.push({ minute: hm(v.start), kind: 'auto', room: v.room, title: `${info.label}, ${v.title}`, detail: v.notes.join(' / ') })
  }
  for (const h of day.history) {
    if (!h.room) continue
    if (!/자동|감지|수동|재전송|보정/.test(h.cause)) continue
    out.push({ minute: h.minute, kind: 'history', room: h.room, title: `${h.device} ${h.state === 'ON' ? '켬' : '끔'}`, detail: h.cause })
  }
  return out.sort((a, b) => a.minute - b.minute)
}

// ---------------------------------------------------------------- current operation (before ON:D AI)

/** Headline lines for the display sentence: first sentence split at its first comma, then the rest as body. */
function splitHead(text: string): [string, string | null, string | null] {
  const m = text.match(/^(.+?[.!?])(\s+.+)?$/s)
  const first = (m?.[1] ?? text).trim()
  const rest = m?.[2]?.trim() || null
  const i = first.indexOf(', ')
  if (i > 0) return [first.slice(0, i + 1), first.slice(i + 2), rest]
  return [first, null, rest]
}

function currentSentence(b: BuildingState, meta: Meta, D: Day, minute: number, applied: boolean) {
  const on = b.rooms.filter((r) => r.state !== 'OFF')
  const occ = on.filter((r) => r.session)
  const empty = on.length - occ.length
  const fx = D.strategies.fixed
  const total = fx ? fx.kwh : null
  const hours = `${String(meta.settings.fixed_on ?? '08:30')}~${String(meta.settings.fixed_off ?? '22:30')}`
  // before applying, the call to action beside the sentence already says what the timetable does
  const tail = applied ? ' ON:D를 적용했을 때와 바로 비교할 수 있습니다.' : ''
  if (!on.length)
    return `지금(${fmtMin(minute)})은 운전 시간 밖이라, 모든 강의실이 꺼져 있습니다. 중앙 제어가 매일 ${hours}에 일괄로 켜고 끄며, 오늘 전력은 ${total != null ? `${fmtKwh(total)} kWh` : '계산 중'}입니다.${tail}`
  return `강의실 ${on.length}곳이 켜져 있고, 그중 ${empty}곳은 빈 강의실입니다. 중앙 제어가 매일 ${hours}에 일괄로 켜고 끄며, 수업 중인 곳은 ${occ.length}곳입니다.${tail}`
}

function CurrentFigures({ L }: { L: Live }) {
  const so = L.kwh_so_far
  const ds = L.date_summary
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-4">
      <Figure label="지금까지 전력" value={fmtKwh(so.fixed)} unit="kWh" accent={STRATEGY.fixed.color} />
      <Figure label="오늘 예상 전력" value={fmtKwh(ds.strategies.fixed?.kwh)} unit="kWh" />
    </div>
  )
}

/** Before ON:D AI is applied: the one place to act, with Ondy holding the timetable. */
function ApplyCta({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="relative w-full overflow-hidden rounded-[26px] bg-[#f4f7fd] p-7 xl:w-[380px]">
      <Ondy pose="schedule" size={108} pop className="absolute -top-1 right-5" />
      <p className="max-w-[11em] pr-24 text-[20px] leading-[1.35] font-bold tracking-[-0.02em] text-ink">시간표를 넣으면 AI가 1차 계획을 만듭니다</p>
      <p className="mt-3 text-[14px] leading-[1.6] text-ink-2">수업이 있는 강의실만 필요한 만큼 미리 켜는 계획입니다. 적용하면 이 화면이 바로 AI 운전으로 바뀝니다.</p>
      <Button variant="primary" className="mt-5 h-12 w-full text-[15px]" onClick={onUpload}>
        <FileUp size={16} aria-hidden /> 시간표 넣기
      </Button>
    </div>
  )
}

function ViewSwitch({ view, onChange }: { view: 'current' | 'ai'; onChange: (v: 'current' | 'ai') => void }) {
  return (
    <Segmented
      label="운전 비교"
      value={view}
      onChange={onChange}
      options={[
        { value: 'current', label: '기존 방식' },
        { value: 'ai', label: 'ON:D' },
      ]}
    />
  )
}

function AppliedBanner({ s, L, onCompare, onClose }: { s: AppliedSummary; L: Live; onCompare: () => void; onClose: () => void }) {
  const fx = L.date_summary.strategies.fixed?.kwh ?? 0
  const ai = L.date_summary.strategies.ai?.kwh ?? 0
  const today = fx > 0 ? Math.round((100 * (fx - ai)) / fx) : null
  return (
    <div className="reveal relative mb-8 flex flex-wrap items-center justify-between gap-4 rounded-[22px] bg-ink py-5 pr-6 pl-[112px] text-white" role="status">
      <div className="absolute top-1/2 left-5 -translate-y-1/2" aria-hidden>
        <Ondy pose="main" size={70} pop className="rounded-full" />
      </div>
      <div>
        <div className="text-[16px] leading-[1.35] font-[650]">ON:D AI 운전을 적용했습니다 ({s.mode === 'auto' ? '자동 운전' : '추천 모드'})</div>
        <div className="mt-1 text-[14px] leading-[1.5] text-white/70">
          {s.month} 1차 계획: 기존 방식 {fmtKwh(s.baseline_kwh)} kWh → AI {fmtKwh(s.kwh)} kWh{s.saving_pct != null ? ` (−${s.saving_pct}%)` : ''} · 오늘 하루: {fmtKwh(fx)} → {fmtKwh(ai)} kWh
          {today != null ? ` (−${today}%)` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCompare} className="inline-flex h-9 items-center rounded-full bg-white px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-white/85">
          기존 방식과 비교해 보기
        </button>
        <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white">
          닫기
        </button>
      </div>
    </div>
  )
}
