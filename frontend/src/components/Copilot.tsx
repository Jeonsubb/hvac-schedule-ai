import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Sparkles,
  X,
  Send,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Wrench,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  CalendarPlus,
  FlaskConical,
  Pencil,
  AlertTriangle,
  History,
} from 'lucide-react'
import { apiSend, invalidateAll, pollJob } from '../lib/api'
import { useCopilot, useMeta } from '../lib/context'
import type { ChatResult, ChatStep, EventDraft, EventResult, Job, Proposal, WhatIf } from '../lib/types'
import { EVENT_TYPE, SETTING_LABEL, TOOL_LABEL, WEEKDAY } from '../lib/constants'
import { cx, fmtDateK, fmtTs, weekdayOf } from '../lib/format'
import { Badge, Button, Modal, Spinner, toast } from './ui'
import { WhatIfTable } from '../pages/Settings'
import { EventCheckPanel, eventBody, useEventCheck } from './EventCheck'
import { BeforeAfter, EventForm } from '../pages/Data'

interface Msg {
  id: number
  role: 'user' | 'assistant'
  content: string
  status?: 'running' | 'done' | 'error'
  steps?: ChatStep[]
  result?: ChatResult
  error?: string
  startedAt?: number
  elapsed?: number
}

const SUGGESTIONS = [
  '이번 주 에너지 낭비가 가장 큰 강의실과 이유는?',
  '선행 가동을 5분으로 줄이면 어떻게 돼? 시뮬레이션해줘',
  '다음 주 수요일 405호 18~21시 특강 일정 등록해줘',
  '금요일 강의실 재배치로 얼마나 절감돼?',
  '오늘 정합성 이슈가 있었어? 원인과 조치를 알려줘',
  '난방 설정온도를 19.5℃로 낮추면 쾌적도는 괜찮을까?',
]

const STORE_KEY = 'thermoplan.copilot.v1'
let idSeq = Date.now()

function stepInput(s: ChatStep): string {
  const i = s.input || {}
  const parts: string[] = []
  if (typeof i.date === 'string') parts.push(i.date)
  if (typeof i.room === 'string') parts.push(`${i.room}호`)
  if (typeof i.start_date === 'string') parts.push(`${i.start_date}${i.days ? `부터 ${i.days}일` : i.end_date ? `~${i.end_date}` : ''}`)
  if (i.overrides && typeof i.overrides === 'object')
    parts.push(
      Object.entries(i.overrides as Record<string, unknown>)
        .map(([k, v]) => `${SETTING_LABEL[k] ?? k} ${v}`)
        .join(', '),
    )
  if (typeof i.weekday === 'number') parts.push(`${WEEKDAY[i.weekday]}요일`)
  if (typeof i.title === 'string') parts.push(i.title)
  if (typeof i.text === 'string') parts.push(`“${i.text}”`)
  return parts.join(', ')
}

export default function Copilot() {
  const { open, setOpen, pending, consumePending } = useCopilot()
  const { meta } = useMeta()
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY)
      return raw ? (JSON.parse(raw) as Msg[]).filter((m) => m.status !== 'running') : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [, setTick] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const busy = msgs.some((m) => m.status === 'running')

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-40)))
    } catch {
      /* quota */
    }
  }, [msgs])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, open])

  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    const user: Msg = { id: ++idSeq, role: 'user', content: q }
    const asst: Msg = { id: ++idSeq, role: 'assistant', content: '', status: 'running', steps: [], startedAt: Date.now() }
    const history = [...msgs.filter((m) => m.status !== 'error'), user]
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }))
    setMsgs((x) => [...x, user, asst])
    setInput('')
    const patch = (p: Partial<Msg>) => setMsgs((x) => x.map((m) => (m.id === asst.id ? { ...m, ...p } : m)))
    try {
      const { job } = await apiSend<{ job: string }>('POST', '/api/chat', { messages: history })
      const final = await pollJob<ChatResult>(
        job,
        (j: Job<ChatResult>) => {
          if (j.progress?.steps) patch({ steps: j.progress.steps })
        },
        { intervalMs: 1500, timeoutMs: 180_000 },
      )
      if (final.status === 'error' || !final.result) {
        patch({ status: 'error', error: final.error || '답변을 만들지 못했습니다. 질문을 조금 더 구체적으로 바꿔 다시 보내 보세요.', elapsed: Date.now() - asst.startedAt! })
      } else {
        patch({
          status: 'done',
          content: final.result.answer ?? '',
          result: final.result,
          steps: final.result.steps ?? [],
          elapsed: Date.now() - asst.startedAt!,
        })
      }
    } catch (e) {
      patch({ status: 'error', error: (e as Error).message, elapsed: Date.now() - asst.startedAt! })
    }
  }

  // prompts sent from other screens
  useEffect(() => {
    if (open && pending && !busy) {
      const p = consumePending()
      if (p) send(p)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending])

  if (!open) return null

  return (
    <aside
      className="slide-in fixed top-0 right-0 bottom-0 z-40 flex w-[440px] max-w-[100vw] flex-col border-l border-line bg-surface shadow-[var(--shadow-cover)] 2xl:shadow-none"
      aria-label="AI 코파일럿"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-ink text-[#7fd6a8]" aria-hidden>
            <Sparkles size={16} />
          </span>
          <div className="leading-tight">
            <div className="text-[14.5px] font-[650] text-ink">AI 코파일럿</div>
            <div className="text-[12px] text-ink-3">운영 데이터와 시뮬레이터를 직접 조회해 답합니다</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && (
            <button
              onClick={() => !busy && setMsgs([])}
              disabled={busy}
              className="rounded-[6px] p-1.5 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-40"
              title="새 대화"
              aria-label="새 대화"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button onClick={() => setOpen(false)} className="rounded-[6px] p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label="코파일럿 닫기">
            <X size={18} />
          </button>
        </div>
      </header>

      <div ref={listRef} className="thin-scroll flex-1 space-y-4 overflow-y-auto bg-paper px-4 py-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="pt-2">
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              전력 낭비 원인 분석, 운영 규칙 시뮬레이션과 제안, 일정 등록 초안, 강의실 재배치 분석을 맡길 수 있습니다. 규칙 변경과 일정 등록은 담당자가 확인을 눌러야
              적용됩니다.
            </p>
            {meta && (
              <p className="mt-2 text-[12px] text-ink-3">
                기준 시각 {fmtDateK(meta.now.date)}, 모델 {meta.models.sonnet?.replace('global.anthropic.', '')}
              </p>
            )}
            <div className="mt-5 mb-2 text-[12.5px] font-semibold text-ink-2">자주 묻는 질문</div>
            <ul className="overflow-hidden rounded-[8px] border border-line bg-surface">
              {SUGGESTIONS.map((s) => (
                <li key={s} className="border-t border-line first:border-t-0">
                  <button onClick={() => send(s)} className="w-full px-3.5 py-2.5 text-left text-[13px] text-ink hover:bg-well">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {msgs.map((m) => (m.role === 'user' ? <UserBubble key={m.id} text={m.content} /> : <AssistantMsg key={m.id} m={m} onRetry={() => {
          const idx = msgs.findIndex((x) => x.id === m.id)
          const q = msgs[idx - 1]?.content
          if (q) {
            setMsgs((x) => x.filter((y) => y.id !== m.id && y.id !== msgs[idx - 1].id))
            setTimeout(() => send(q), 0)
          }
        }} />))}
      </div>

      <div className="border-t border-line bg-surface p-3">
        {msgs.length > 0 && !busy && (
          <div className="thin-scroll mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="shrink-0 rounded-[6px] border border-line px-2.5 py-1 text-[12px] whitespace-nowrap text-ink-2 hover:border-line-strong hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={2}
            aria-label="코파일럿에게 질문"
            placeholder="질문이나 요청을 입력하세요 (Enter 보내기, Shift+Enter 줄바꿈)"
            className="thin-scroll max-h-32 min-h-[44px] flex-1 resize-none rounded-[6px] border border-line-strong px-3 py-2 text-[13px] placeholder:text-ink-4 focus:border-focus focus:shadow-[0_0_0_3px_rgb(47_111_222/0.16)] focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-[6px] bg-ink text-white hover:bg-[#24334d] disabled:opacity-40"
            aria-label="보내기"
          >
            {busy ? <Spinner className="text-white" /> : <Send size={17} />}
          </button>
        </form>
      </div>
    </aside>
  )
}

/** The backend appends its own "AI 연결이 불안정해서…" blockquote to cached answers; we show a quieter line instead. */
function stripCacheNote(text: string) {
  return text.replace(/\n*>\s*지금은 AI 연결이 불안정해서[^\n]*\s*$/, '')
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[10px] rounded-br-[3px] bg-ink px-3.5 py-2 text-[13px] whitespace-pre-wrap text-white">{text}</div>
    </div>
  )
}

function Steps({ steps, running }: { steps: ChatStep[]; running: boolean }) {
  const [open, setOpen] = useState(running)
  useEffect(() => {
    setOpen(running)
  }, [running])
  if (!steps.length && !running) return null
  return (
    <div className="rounded-[6px] border border-line bg-surface">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12.5px] font-medium text-ink-2">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={12} />
        {running ? '데이터를 조회하는 중' : `조회 ${steps.length}회`}
        {!running && (
          <span className="ml-1 truncate font-normal text-ink-3">{[...new Set(steps.map((s) => TOOL_LABEL[s.tool] ?? s.tool))].join(', ')}</span>
        )}
      </button>
      {open && (
        <ol className="space-y-1 border-t border-line px-3 py-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px]">
              {s.ok === false ? (
                <XCircle size={13} className="mt-0.5 shrink-0 text-crit" />
              ) : s.ok ? (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-good" />
              ) : (
                <Spinner size={13} className="mt-0.5 shrink-0" />
              )}
              <span>
                <span className="font-medium text-ink">{TOOL_LABEL[s.tool] ?? s.tool}</span>
                {stepInput(s) && <span className="text-ink-3"> {stepInput(s)}</span>}
              </span>
            </li>
          ))}
          {running && (
            <li className="flex items-center gap-2 text-[12px] text-ink-3">
              <Spinner size={13} /> {steps.length ? '결과를 해석하는 중…' : '질문을 이해하고 필요한 데이터를 고르는 중…'}
            </li>
          )}
        </ol>
      )}
    </div>
  )
}

function AssistantMsg({ m, onRetry }: { m: Msg; onRetry: () => void }) {
  const running = m.status === 'running'
  const secs = Math.round(((m.elapsed ?? (m.startedAt ? Date.now() - m.startedAt : 0)) as number) / 1000)
  const r = m.result
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-ink text-[#7fd6a8]" aria-hidden>
          <Sparkles size={11} />
        </span>
        코파일럿
        <span className="tnum">{running ? `${secs}초째` : `${secs}초`}</span>
      </div>
      <Steps steps={m.steps ?? []} running={running} />
      {m.status === 'error' && (
        <div className="flex items-center justify-between gap-2 rounded-[6px] border border-[#efc6c6] bg-crit-bg px-3 py-2 text-[12.5px] text-crit-ink">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} /> {m.error}
          </span>
          <Button size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      )}
      {r?.from_cache && (
        <div className="flex items-start gap-1.5 rounded-[6px] bg-well px-2.5 py-1.5 text-[12px] text-ink-2 ring-1 ring-line ring-inset">
          <History size={12} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
          AI 연결이 불안정해 {r.cached_at ? fmtTs(r.cached_at) : '이전'}에 같은 질문으로 받은 답을 보여 줍니다. 수치가 지금과 다를 수 있습니다.
        </div>
      )}
      {m.content && (
        <div className="md rounded-[10px] rounded-tl-[3px] border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink">
          <ReactMarkdown
            remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
            components={{
              table: ({ children }) => (
                <div className="table-wrap">
                  <table>{children}</table>
                </div>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer" className="font-medium text-info-ink underline">
                  {children}
                </a>
              ),
            }}
          >
            {r?.from_cache ? stripCacheNote(m.content) : m.content}
          </ReactMarkdown>
        </div>
      )}
      {r?.simulations && r.simulations.length > 0 && <SimGroup sims={r.simulations} />}
      {r?.proposals?.map((p, i) => <ProposalCard key={i} p={p} />)}
      {r?.event_drafts?.map((d, i) => <DraftCard key={i} d={d} />)}
    </div>
  )
}

function SimGroup({ sims }: { sims: WhatIf[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? sims : sims.slice(0, 2)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-0.5 text-[12px] text-ink-3">
        <span>시뮬레이터 검증 {sims.length}건, 눌러서 전략별 결과 보기</span>
        {sims.length > 2 && (
          <button className="font-semibold text-ink hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? '접기' : `모두 보기 (+${sims.length - 2})`}
          </button>
        )}
      </div>
      {shown.map((s, i) => (
        <SimCard key={i} wi={s} />
      ))}
    </div>
  )
}

function SimCard({ wi }: { wi: WhatIf }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[8px] border border-line bg-surface">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px]">
        <FlaskConical size={13} className="text-ink-3" />
        <span className="shrink-0 font-medium whitespace-nowrap text-ink">시뮬레이션</span>
        <span className="truncate text-ink-3">
          {Object.entries(wi.overrides)
            .map(([k, v]) => `${SETTING_LABEL[k] ?? k} ${v}`)
            .join(', ')}{' '}
          ({wi.dates[0]?.slice(5)}~{wi.dates[wi.dates.length - 1]?.slice(5)})
        </span>
        {open ? <ChevronDown size={13} className="ml-auto shrink-0" /> : <ChevronRight size={13} className="ml-auto shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-2">
          <WhatIfTable wi={wi} compact />
        </div>
      )}
    </div>
  )
}

function ProposalCard({ p }: { p: Proposal }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { meta, reload } = useMeta()
  const apply = async () => {
    setBusy(true)
    setErr(null)
    try {
      await apiSend('PUT', '/api/settings', p.overrides)
      invalidateAll()
      reload()
      setDone(true)
      toast('제안한 운영 규칙을 적용했습니다. 운전 계획을 다시 계산합니다.')
    } catch (e) {
      // e.g. 400: setpoint too close to the comfort band; shown on the card, not in a toast
      setErr((e as Error).message)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <div className={cx('rounded-[8px] border bg-surface p-3.5', done ? 'border-[#bfe3cf]' : 'border-[#c9dcf5]')}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-info-ink">
        <SlidersHorizontal size={12} /> 운영 규칙 변경 제안
      </div>
      <div className="mt-1 text-[13.5px] font-semibold text-ink">{p.title}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {Object.entries(p.overrides).map(([k, v]) => (
          <Badge key={k} tone="info">
            {SETTING_LABEL[k] ?? k}: {meta ? `${String(meta.settings[k])} → ` : ''}
            {String(v)}
          </Badge>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{p.rationale}</p>
      <div className="mt-2 rounded-[6px] bg-well px-2.5 py-1.5 text-[12.5px] text-ink-2 ring-1 ring-line ring-inset">
        <b className="font-semibold text-ink">예상 효과</b> {p.expected_effect}
      </div>
      {err && (
        <div className="mt-2 flex items-start gap-1.5 rounded-[6px] border border-[#efc6c6] bg-crit-bg px-2.5 py-1.5 text-[12.5px] text-crit-ink" role="alert">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            적용하지 못했습니다. {err}
          </span>
        </div>
      )}
      <div className="mt-2.5 flex justify-end">
        {done ? (
          <span className="flex items-center gap-1 text-[12.5px] font-medium text-good-ink">
            <CheckCircle2 size={14} /> 적용됨
          </span>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setConfirm(true)}>
            적용
          </Button>
        )}
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="운영 규칙 적용"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>취소</Button>
            <Button variant="primary" onClick={apply} disabled={busy}>
              {busy ? <Spinner className="text-white" /> : <CheckCircle2 size={14} />} 적용
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          <b className="text-ink">{p.title}</b>: 아래 값으로 운영 규칙을 바꾸고 운전 계획을 다시 계산합니다. 변경 기록에 남으며 운영 규칙 화면에서 되돌릴 수 있습니다.
        </p>
        <ul className="mt-2 space-y-1">
          {Object.entries(p.overrides).map(([k, v]) => (
            <li key={k} className="flex justify-between rounded-md bg-well px-3 py-1.5 text-[13px]">
              <span>{SETTING_LABEL[k] ?? k}</span>
              <span className="tnum font-medium">
                {meta ? String(meta.settings[k]) : '?'} → {String(v)}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  )
}

function DraftCard({ d }: { d: EventDraft }) {
  const [draft, setDraft] = useState<EventDraft>({ ...d, clarification: undefined })
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<EventResult | null>(null)
  // the editable form runs its own check; the summary view checks here
  const checked = useEventCheck(edit || res ? null : draft, d.check)
  const register = async () => {
    setBusy(true)
    try {
      const r = await apiSend<EventResult>('POST', '/api/events', eventBody(draft))
      setRes(r)
      invalidateAll()
      toast('일정을 등록하고 운전 계획을 다시 계산했습니다.')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setBusy(false)
    }
  }
  const wd = draft.date ? WEEKDAY[weekdayOf(draft.date)] : ''
  return (
    <div className="rounded-[8px] border border-[#d8d3f5] bg-surface p-3.5">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-event-ink">
        <CalendarPlus size={12} /> 일정 초안: {EVENT_TYPE[draft.type] ?? draft.type}
      </div>
      {d.from_cache && !res && (
        <div className="mt-1.5 text-[12px] text-ink-3">AI 연결이 불안정해 {d.cached_at ? fmtTs(d.cached_at) : '앞서'} 해석한 결과입니다.</div>
      )}
      {d.clarification && !res && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-[6px] bg-warn-bg px-2 py-1 text-[12.5px] text-warn-ink">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {d.clarification}
        </div>
      )}
      {res ? (
        <div className="mt-2">
          <BeforeAfter r={res} />
        </div>
      ) : edit ? (
        <div className="mt-2">
          <EventForm draft={draft} onChange={setDraft} saving={busy} onSave={register} onCancel={() => setEdit(false)} compact />
        </div>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[64px_1fr] gap-y-1 text-[12.5px]">
            <dt className="text-ink-3">날짜</dt>
            <dd className="font-medium text-ink">
              {draft.date} ({wd})
            </dd>
            {draft.room && (
              <>
                <dt className="text-ink-3">강의실</dt>
                <dd className="font-medium text-ink">
                  {draft.room}호{draft.new_room ? ` → ${draft.new_room}호` : ''}
                </dd>
              </>
            )}
            {draft.start && (
              <>
                <dt className="text-ink-3">시간</dt>
                <dd className="font-medium text-ink">
                  {draft.start}–{draft.end}
                </dd>
              </>
            )}
            {draft.title && (
              <>
                <dt className="text-ink-3">내용</dt>
                <dd className="font-medium text-ink">{draft.title}</dd>
              </>
            )}
            {draft.expected_people != null && (
              <>
                <dt className="text-ink-3">인원</dt>
                <dd className="font-medium text-ink">{draft.expected_people}명</dd>
              </>
            )}
          </dl>
          <div className="mt-2.5">
            <EventCheckPanel
              compact
              draft={draft}
              result={checked}
              onPickRoom={(r) => setDraft((x) => ({ ...x, ...(x.type === 'move' ? { new_room: r } : { room: r }), check: undefined }))}
            />
          </div>
          <div className="mt-2.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              <Pencil size={12} /> 수정
            </Button>
            <Button
              size="sm"
              variant={checked.check && !checked.check.ok ? 'danger' : 'primary'}
              onClick={register}
              disabled={busy || checked.checking}
            >
              {busy ? <Spinner size={13} className="text-white" /> : <CheckCircle2 size={13} />} {checked.check && !checked.check.ok ? '문제를 알고 등록' : '등록'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
