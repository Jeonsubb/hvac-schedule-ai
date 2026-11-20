import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Send, Thermometer, Wind, Clock3, Info, ArrowLeft } from 'lucide-react'
import { apiSend } from '../lib/api'
import type { FeedbackReply } from '../lib/types'
import { ROOM_ORDER } from '../lib/constants'
import { TAGS, VOTES } from '../lib/comfort'
import { cx } from '../lib/format'
import { Button, ErrorBox, Spinner } from '../components/ui'
import { Brand } from '../components/PublicShell'

const STATE_LABEL: Record<string, string> = { ON: '냉난방 가동 중', FAN: '송풍(환기) 중', OFF: '정지' }

function RoomPicker({ onPick, invalid }: { onPick: (r: string) => void; invalid?: string | null }) {
  return (
    <div>
      <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-ink">어느 강의실에 계신가요?</h1>
      <p className="mt-2 text-[15px] text-ink-2">강의실 문 옆 QR 코드로 들어오면 이 단계는 건너뜁니다.</p>
      {invalid && <p className="mt-3 text-[14px] text-crit-ink">{invalid}호는 등록된 강의실이 아닙니다. 아래에서 골라 주세요.</p>}
      <div className="mt-6 grid grid-cols-3 gap-2.5">
        {ROOM_ORDER.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className="tnum h-14 rounded-[12px] border border-line-strong bg-surface text-[17px] font-semibold text-ink transition-colors hover:border-brand hover:bg-brand-bg"
          >
            {r}호
          </button>
        ))}
      </div>
    </div>
  )
}

function Reply({ r, onAgain }: { r: FeedbackReply; onAgain: () => void }) {
  const st = r.reply?.room
  return (
    <div className="reveal">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-good-ink">
        <CheckCircle2 size={18} aria-hidden /> 의견을 받았습니다
      </div>
      <p className="pretty mt-3 text-[20px] leading-[1.45] font-semibold tracking-[-0.015em] text-ink">{r.reply?.message ?? '감사합니다. 의견을 운전 계획에 반영하겠습니다.'}</p>

      {st && (
        <div className="mt-6 rounded-[16px] border border-line bg-surface p-5">
          <div className="text-[13.5px] font-medium text-ink-3">지금 {r.feedback?.room}호 상태</div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] text-ink-3">
                <Thermometer size={14} aria-hidden /> 실내온도
              </div>
              <div className="tnum mt-1 text-[26px] leading-none font-[650] text-ink">
                {st.ta == null ? '–' : st.ta.toFixed(1)}
                <span className="ml-0.5 text-[14px] font-medium text-ink-3">℃</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[13px] text-ink-3">
                <Wind size={14} aria-hidden /> 운전
              </div>
              <div className="mt-1 text-[17px] font-semibold text-ink">{STATE_LABEL[st.state] ?? st.state}</div>
            </div>
            <div>
              <div className="text-[13px] text-ink-3">설정온도</div>
              <div className="tnum mt-1 text-[15px] font-medium text-ink">
                난방 {st.sp_heat}℃, 냉방 {st.sp_cool}℃
              </div>
            </div>
            <div>
              <div className="text-[13px] text-ink-3">이산화탄소</div>
              <div className="tnum mt-1 text-[15px] font-medium text-ink">{st.co2 == null ? '–' : `${Math.round(st.co2).toLocaleString('ko-KR')} ppm`}</div>
            </div>
          </div>
          {st.session && (
            <div className="mt-4 flex items-center gap-1.5 border-t border-line pt-3 text-[13.5px] text-ink-2">
              <Clock3 size={14} aria-hidden /> {st.session}
            </div>
          )}
        </div>
      )}

      {r.reply?.policy && (
        <div className="mt-4 flex items-start gap-2 rounded-[12px] bg-well px-4 py-3 text-[14px] leading-relaxed text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
          <span>{r.reply.policy}</span>
        </div>
      )}
      {r.reply?.next && <p className="mt-4 text-[15px] leading-relaxed text-ink">{r.reply.next}</p>}

      <Button className="mt-8 h-12 w-full text-[15px]" onClick={onAgain}>
        다른 의견 보내기
      </Button>
    </div>
  )
}

export default function FeedbackPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('room')
  const room = raw && ROOM_ORDER.includes(raw) ? raw : null
  const [vote, setVote] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reply, setReply] = useState<FeedbackReply | null>(null)

  const reset = () => {
    setVote(null)
    setTags([])
    setText('')
    setReply(null)
    setErr(null)
  }

  const send = async () => {
    if (!room || vote == null) return
    setBusy(true)
    setErr(null)
    try {
      const r = await apiSend<FeedbackReply>('POST', '/api/feedback', { room, vote, tags, text: text.trim(), source: 'occupant' })
      setReply(r)
      window.scrollTo({ top: 0 })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[520px] items-center justify-between px-5">
          <Brand size={28} />
          {room && (
            <span className="tnum rounded-full bg-brand-bg px-3 py-1 text-[14px] font-semibold text-brand-ink" aria-label={`강의실 ${room}호`}>
              {room}호
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[520px] px-5 pt-6 pb-16">
        {!room ? (
          <RoomPicker invalid={raw} onPick={(r) => setParams({ room: r })} />
        ) : reply ? (
          <Reply r={reply} onAgain={reset} />
        ) : (
          <div>
            <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em] text-ink">지금 {room}호 어떠세요?</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">느끼는 대로 하나만 골라 주세요. 의견은 다음 수업의 냉난방 계획에 반영됩니다.</p>

            <fieldset className="mt-6">
              <legend className="sr-only">체감 온도</legend>
              <div className="space-y-2" role="radiogroup" aria-label="체감 온도">
                {VOTES.map((v) => {
                  const on = vote === v.v
                  return (
                    <button
                      key={v.v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setVote(v.v)}
                      className={cx(
                        'flex h-[52px] w-full items-center gap-3 rounded-[14px] border px-4 text-left text-[16px] font-semibold transition-[border-color,box-shadow,background-color] duration-150',
                        on ? 'border-ink bg-surface shadow-[0_0_0_2px_var(--color-ink)]' : 'border-line bg-surface hover:border-ink-4',
                      )}
                    >
                      <span className="h-7 w-7 shrink-0 rounded-full ring-1 ring-inset ring-black/5" style={{ background: v.color }} aria-hidden />
                      <span className="flex-1 text-ink">{v.label}</span>
                      {on && <CheckCircle2 size={20} className="text-ink" aria-hidden />}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="text-[15px] font-semibold text-ink">다른 불편이 있나요? (선택)</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {TAGS.map((t) => {
                  const on = tags.includes(t.key)
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTags((x) => (on ? x.filter((k) => k !== t.key) : [...x, t.key]))}
                      className={cx(
                        'h-10 rounded-full border px-4 text-[14.5px] font-medium transition-colors',
                        on ? 'border-brand bg-brand-bg text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4',
                      )}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <label className="mt-6 block">
              <span className="text-[15px] font-semibold text-ink">한마디 (선택)</span>
              <textarea
                name="comment"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="예: 창가 쪽 자리가 특히 추워요…"
                className="mt-2 block w-full rounded-[12px] border border-line-strong bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-4 focus:border-focus focus:shadow-[0_0_0_3px_rgb(47_111_222/0.16)] focus-visible:outline-none"
              />
              <span className="tnum mt-1 block text-right text-[12.5px] text-ink-3">{text.length}/200</span>
            </label>

            {err && (
              <div className="mt-4">
                <ErrorBox title="의견을 보내지 못했습니다" error={err} onRetry={send} />
              </div>
            )}

            <Button variant="primary" className="mt-6 h-12 w-full text-[16px]" disabled={vote == null || busy} onClick={send}>
              {busy ? <Spinner size={16} className="text-white" /> : <Send size={16} aria-hidden />}
              {busy ? '보내는 중…' : '의견 보내기'}
            </Button>
            <p className="mt-4 text-center text-[13px] leading-relaxed text-ink-3">이름이나 학번은 받지 않습니다. 강의실 번호와 시각만 기록됩니다.</p>
            <button type="button" onClick={() => setParams({})} className="mx-auto mt-3 flex items-center gap-1 text-[13.5px] font-medium text-ink-3 hover:text-ink">
              <ArrowLeft size={14} aria-hidden /> 다른 강의실 고르기
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
