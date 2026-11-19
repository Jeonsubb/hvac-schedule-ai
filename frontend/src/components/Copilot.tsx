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
} from 'lucide-react'
import { apiSend, invalidateAll, pollJob } from '../lib/api'
import { useCopilot, useMeta } from '../lib/context'
import type { ChatResult, ChatStep, EventDraft, EventResult, Job, Proposal, WhatIf } from '../lib/types'
import { EVENT_TYPE, SETTING_LABEL, TOOL_LABEL, WEEKDAY } from '../lib/constants'
import { cx, fmtDateK, weekdayOf } from '../lib/format'
import { Badge, Button, Modal, Spinner, toast } from './ui'
import { WhatIfTable } from '../pages/Settings'
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
  return parts.join(' · ')
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
        patch({ status: 'error', error: final.error || '답변을 만들지 못했습니다.', elapsed: Date.now() - asst.startedAt! })
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
    <aside className="slide-in fixed top-0 right-0 bottom-0 z-40 flex w-[440px] max-w-[100vw] flex-col border-l border-line bg-white shadow-[-8px_0_32px_rgba(11,11,11,0.08)]">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <Sparkles size={16} />
          </span>
          <div className="leading-tight">
            <div className="text-[14.5px] font-semibold text-ink">AI 코파일럿</div>
            <div className="text-[11px] text-ink-3">운영 데이터·시뮬레이터 직접 조회 · 수치는 도구 결과만 인용</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {msgs.length > 0 && (
            <button
              onClick={() => !busy && setMsgs([])}
              disabled={busy}
              className="rounded-md p-1.5 text-ink-3 hover:bg-[#f0efec] hover:text-ink disabled:opacity-40"
              title="새 대화"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-ink-3 hover:bg-[#f0efec] hover:text-ink" aria-label="닫기">
            <X size={18} />
          </button>
        </div>
      </header>

      <div ref={listRef} className="thin-scroll flex-1 space-y-4 overflow-y-auto bg-[#fafaf8] px-4 py-4">
        {msgs.length === 0 && (
          <div className="pt-4">
            <div className="rounded-xl border border-line bg-white p-4">
              <div className="text-[14px] font-semibold text-ink">무엇을 도와드릴까요?</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                전력 낭비 원인 분석, 운영 규칙 시뮬레이션·제안, 일정 등록 초안, 강의실 재배치 분석을 할 수 있습니다. 규칙 변경과 일정 등록은 담당자가 확인 버튼을
                눌러야 적용됩니다.
              </p>
              {meta && (
                <p className="mt-2 text-[11.5px] text-ink-3">
                  기준 시각 {fmtDateK(meta.now.date)} · {meta.models.sonnet?.replace('global.anthropic.', '')}
                </p>
              )}
            </div>
            <div className="mt-4 mb-2 text-[12px] font-medium text-ink-3">이렇게 물어보세요</div>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-lg border border-line bg-white px-3 py-2 text-left text-[13px] text-ink hover:border-brand/40 hover:bg-brand-50"
                >
                  {s}
                </button>
              ))}
            </div>
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

      <div className="border-t border-line bg-white p-3">
        {msgs.length > 0 && !busy && (
          <div className="thin-scroll mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(0, 4).map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] whitespace-nowrap text-ink-2 hover:border-[#c3c2b7] hover:text-ink"
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
            placeholder="질문이나 요청을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)"
            className="thin-scroll max-h-32 min-h-[44px] flex-1 resize-none rounded-lg border border-[#dcdbd4] px-3 py-2 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-lg bg-brand text-white hover:bg-[#0b5f58] disabled:opacity-40"
            aria-label="보내기"
          >
            {busy ? <Spinner className="text-white" /> : <Send size={17} />}
          </button>
        </form>
      </div>
    </aside>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13px] whitespace-pre-wrap text-white">{text}</div>
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
    <div className="rounded-lg border border-line bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-medium text-ink-2">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Wrench size={12} />
        {running ? '분석 중' : `도구 ${steps.length}개 사용`}
        {!running && (
          <span className="ml-1 truncate font-normal text-ink-3">{[...new Set(steps.map((s) => TOOL_LABEL[s.tool] ?? s.tool))].join(' · ')}</span>
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
                {stepInput(s) && <span className="text-ink-3"> · {stepInput(s)}</span>}
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
      <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand text-white">
          <Sparkles size={11} />
        </span>
        코파일럿
        {running ? <span className="pulse-dot">· {secs}초</span> : <span>· {secs}초</span>}
      </div>
      <Steps steps={m.steps ?? []} running={running} />
      {m.status === 'error' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#f1c9c9] bg-[#fdf6f6] px-3 py-2 text-[12.5px] text-crit-ink">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} /> {m.error}
          </span>
          <Button size="sm" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      )}
      {m.content && (
        <div className="md rounded-xl rounded-tl-md border border-line bg-white px-3.5 py-2.5 text-[13px] text-ink">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="table-wrap">
                  <table>{children}</table>
                </div>
              ),
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer" className="text-brand underline">
                  {children}
                </a>
              ),
            }}
          >
            {m.content}
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
      <div className="flex items-center justify-between px-0.5 text-[11.5px] text-ink-3">
        <span>시뮬레이터 검증 {sims.length}건 · 눌러서 전략별 결과 보기</span>
        {sims.length > 2 && (
          <button className="font-medium text-brand hover:underline" onClick={() => setAll((v) => !v)}>
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
    <div className="rounded-xl border border-line bg-white">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px]">
        <FlaskConical size={13} className="text-ink-3" />
        <span className="shrink-0 font-medium whitespace-nowrap text-ink">시뮬레이션</span>
        <span className="truncate text-ink-3">
          {Object.entries(wi.overrides)
            .map(([k, v]) => `${SETTING_LABEL[k] ?? k} ${v}`)
            .join(', ')}{' '}
          · {wi.dates[0]?.slice(5)}~{wi.dates[wi.dates.length - 1]?.slice(5)}
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
  const { meta, reload } = useMeta()
  const apply = async () => {
    setBusy(true)
    try {
      await apiSend('PUT', '/api/settings', p.overrides)
      invalidateAll()
      reload()
      setDone(true)
      toast('제안한 운영 규칙을 적용했습니다')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }
  return (
    <div className={cx('rounded-xl border bg-white p-3', done ? 'border-[#bfe6d6]' : 'border-[#c9dcf5]')}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#1c5cab]">
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
      <div className="mt-2 rounded-lg bg-[#f6f6f3] px-2.5 py-1.5 text-[12px] text-ink-2">
        <b className="text-ink">예상 효과</b> · {p.expected_effect}
      </div>
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
          <b className="text-ink">{p.title}</b> — 아래 값으로 운영 규칙을 바꾸고 운전 계획을 다시 계산합니다. 변경 기록에 남으며 운영 규칙 화면에서 되돌릴 수 있습니다.
        </p>
        <ul className="mt-2 space-y-1">
          {Object.entries(p.overrides).map(([k, v]) => (
            <li key={k} className="flex justify-between rounded-md bg-[#f6f6f3] px-3 py-1.5 text-[13px]">
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
  const register = async () => {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { ...draft }
      delete body.clarification
      const r = await apiSend<EventResult>('POST', '/api/events', body)
      setRes(r)
      invalidateAll()
      toast('일정을 등록하고 운전 계획을 다시 계산했습니다')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setBusy(false)
    }
  }
  const wd = draft.date ? WEEKDAY[weekdayOf(draft.date)] : ''
  return (
    <div className="rounded-xl border border-[#d8d3f5] bg-white p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#4a3aa7]">
        <CalendarPlus size={12} /> 일정 초안 · {EVENT_TYPE[draft.type] ?? draft.type}
      </div>
      {d.clarification && !res && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-md bg-[#fff6e0] px-2 py-1 text-[12px] text-warn-ink">
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
          <div className="mt-2.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
              <Pencil size={12} /> 수정
            </Button>
            <Button size="sm" variant="primary" onClick={register} disabled={busy}>
              {busy ? <Spinner size={13} className="text-white" /> : <CheckCircle2 size={13} />} 등록
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
