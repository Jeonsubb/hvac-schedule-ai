import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Mic, MicOff, RotateCcw, Square } from 'lucide-react'
import { useMeta } from '../lib/context'
import { cx } from '../lib/format'
import { useVoice } from '../lib/voice/agent'
import type { Phase } from '../lib/voice/types'
import Orb from '../components/voice/Orb'
import { VoiceCardView } from '../components/voice/Cards'
import { More } from '../components/ui'

/**
 * 온디: the operator's voice screen (the ON:D logo opens it). Call the orb, ask in words, get the answer spoken with the
 * data beside it, and jump to the screen that owns the data. Everything it says comes from the same
 * service layer the other screens read.
 */

const SUGGESTIONS = ['지금 어떻게 돌아가고 있어?', '절감 효과 알려줘', '최적 시나리오 설명해줘', '306호 타임라인 보여줘']

const PHASE_LABEL: Record<Phase, string> = { off: '마이크 꺼짐', idle: '대기 중', listening: '듣는 중', thinking: '확인하는 중', speaking: '말하는 중' }

function Pipeline() {
  const { phase, session, micOn, wakeOn } = useVoice()
  const nodes = [
    { key: 'mic', name: '마이크', sub: micOn ? (wakeOn ? '호출어 대기' : '눌러서 말하기') : '꺼짐', on: phase === 'listening' },
    { key: 'stt', name: 'Amazon Transcribe', sub: session?.stt.url ? '한국어 실시간 인식' : session ? '브라우저 인식으로 대체' : '음성 → 글', on: phase === 'listening' },
    { key: 'llm', name: 'Amazon Bedrock', sub: session ? `${session.llm.model} · 도구 호출` : 'Claude · 도구 호출', on: phase === 'thinking' },
    { key: 'tts', name: 'Amazon Polly', sub: session?.tts.voice ? `${session.tts.voice} 음성` : session ? '브라우저 음성으로 대체' : '글 → 음성', on: phase === 'speaking' },
  ]
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="음성 처리 단계">
      {nodes.map((n, i) => (
        <li key={n.key} className="flex items-center gap-1">
          {i > 0 && <span className={cx('h-px w-4 transition-colors duration-300 sm:w-6', n.on ? 'bg-ink-3' : 'bg-well')} aria-hidden />}
          <span
            className={cx(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-colors duration-300',
              n.on ? 'border-line-strong bg-well' : 'border-line bg-transparent',
            )}
            aria-current={n.on ? 'step' : undefined}
          >
            <span className={cx('h-1.5 w-1.5 rounded-full transition-colors duration-300', n.on ? 'voice-live bg-good' : 'bg-line-strong')} aria-hidden />
            <span className="leading-tight">
              <span className={cx('block text-[12px] font-semibold whitespace-nowrap', n.on ? 'text-ink' : 'text-ink-2')}>{n.name}</span>
              <span className="hidden text-[11px] whitespace-nowrap text-ink-3 md:block">{n.sub}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

export default function Home() {
  const v = useVoice()
  const { meta } = useMeta()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hasCards = v.cards.length > 0
  const busy = v.phase === 'thinking'

  // Space calls ON:D, Esc stops it (outside of text fields)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.code === 'Space' && !typing && !e.repeat) {
        e.preventDefault()
        v.wake()
      } else if (e.key === 'Escape') v.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [v])

  const building = meta ? meta.building.name : 'IT관'
  const headline =
    v.phase === 'listening'
      ? v.transcript || '네, 말씀하세요'
      : v.phase === 'thinking'
        ? `“${v.userText}”`
        : v.say
          ? v.say
          : v.micOn
            ? v.wakeOn
              ? '“온디”라고 불러 보세요'
              : '구체를 누르고 말씀하세요'
            : '온디'
  const quiet = !v.say && v.phase !== 'listening' && v.phase !== 'thinking'

  return (
    <div className="voice-stage relative overflow-hidden bg-surface text-ink">
      {/* edge to edge under the 64px top bar (plus the chip menu on narrow screens) */}
      <div className="relative flex min-h-[calc(100dvh-113px)] flex-col px-[clamp(18px,3vw,40px)] pt-5 pb-2 lg:min-h-[calc(100dvh-65px)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Pipeline />
          <div className="flex items-center gap-1.5">
            {(hasCards || v.say) && (
              <button
                type="button"
                onClick={v.clear}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
              >
                <RotateCcw size={14} aria-hidden /> 새 대화
              </button>
            )}
            <button
              type="button"
              onClick={() => (v.micOn ? v.disable() : void v.enable())}
              disabled={v.starting}
              aria-pressed={v.micOn}
              className={cx(
                'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
                v.micOn ? 'border border-line text-ink hover:border-line-strong' : 'bg-bg-neutral-solid text-fg-on-neutral-solid hover:bg-bg-neutral-solid-pressed',
              )}
            >
              {v.micOn ? <Mic size={15} className="text-good-ink" aria-hidden /> : <MicOff size={15} aria-hidden />}
              {v.starting ? '켜는 중…' : v.micOn ? '마이크 켜짐' : '마이크 켜기'}
            </button>
          </div>
        </div>

        <div className={cx('grid flex-1 items-center gap-8 pt-2', hasCards ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,480px)]' : '')}>
          <section className="flex min-w-0 flex-col items-center text-center" aria-label="온디와 대화">
            <button
              type="button"
              onClick={v.wake}
              className={cx(
                'group relative aspect-square shrink-0 cursor-pointer rounded-full transition-[width] duration-500 ease-[var(--ease-out)] focus-visible:outline-offset-[-12px]',
                hasCards ? 'w-[min(46vh,440px,84vw)]' : 'w-[min(52vh,540px,90vw)]',
              )}
              aria-label={v.phase === 'listening' ? '듣기 멈추기' : '온디 부르기'}
              title="눌러서 말하기 (Space)"
            >
              <Orb phase={v.phase} sample={v.sample} className="pointer-events-none absolute inset-[-12%] h-[124%] w-[124%]" />
            </button>

            <div className="relative z-10 mt-1 flex min-h-[120px] w-full max-w-[720px] flex-col items-center">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold tracking-[0.02em] text-ink-3" role="status" aria-live="polite">
                <span
                  className={cx(
                    'h-1.5 w-1.5 rounded-full',
                    v.phase === 'listening' ? 'voice-live bg-brand' : v.phase === 'speaking' ? 'voice-live bg-good' : v.phase === 'thinking' ? 'voice-live bg-white' : 'bg-line-strong',
                  )}
                  aria-hidden
                />
                {PHASE_LABEL[v.phase]}
                {v.phase === 'speaking' && (
                  <button type="button" onClick={v.stop} className="ml-1 inline-flex items-center gap-1 rounded-full bg-well px-2 py-0.5 text-[11.5px] text-ink hover:bg-hover">
                    <Square size={9} fill="currentColor" aria-hidden /> 멈추기
                  </button>
                )}
              </div>
              <p
                key={v.phase === 'listening' ? 'live' : headline}
                className={cx(
                  'voice-line balance mt-3 font-[680] tracking-[-0.025em] text-ink',
                  quiet ? 'text-[clamp(28px,4.2vw,44px)] leading-[1.15]' : headline.length > 70 ? 'text-[clamp(17px,1.9vw,21px)] leading-[1.5]' : 'text-[clamp(20px,2.5vw,28px)] leading-[1.38]',
                  v.phase === 'thinking' && 'text-ink-2',
                )}
              >
                {headline}
              </p>
              {quiet && (
                <p className="mt-3 max-w-[460px] text-[14.5px] leading-relaxed text-ink-3">
                  {v.micOn ? `${building}의 운전 현황과 절감 효과를 말로 물어보세요.` : '마이크를 켜고 “온디”라고 부르거나, 아래에 글로 물어보세요.'}
                </p>
              )}
              {v.phase === 'speaking' && v.userText && <p className="mt-2.5 max-w-full truncate text-[13px] text-ink-3">“{v.userText}”</p>}
              {v.say && v.phase !== 'listening' && v.phase !== 'thinking' && v.steps.length > 0 && (
                <ul className="mt-3 flex flex-wrap justify-center gap-1.5 text-[11.5px] text-ink-3">
                  {v.steps.map((s, i) => (
                    <li key={i} className="rounded-full border border-line px-2 py-0.5">
                      {s.label}
                    </li>
                  ))}
                  {v.tookMs != null && <li className="tnum px-1 py-0.5 text-ink-3">{(v.tookMs / 1000).toFixed(1)}초</li>}
                </ul>
              )}
              {v.error && (
                <p className="mt-3 rounded-[12px] bg-crit-bg px-3.5 py-2 text-[13px] text-crit-ink" role="alert">
                  {v.error}
                </p>
              )}
            </div>

            <div className="mt-4 w-full max-w-[640px]">
              <div className="thin-scroll flex gap-1.5 overflow-x-auto pb-2 sm:flex-wrap sm:justify-center sm:overflow-visible">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => v.sendText(s)}
                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] whitespace-nowrap text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <form
                className="mt-2 flex items-center gap-2 rounded-full border border-line bg-well py-1.5 pr-1.5 pl-5 transition-colors focus-within:border-line-strong"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (busy) return
                  v.sendText(text)
                  setText('')
                }}
              >
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  name="voice-text"
                  aria-label="온디에게 글로 묻기"
                  placeholder="말 대신 글로 물어보기"
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 bg-transparent text-[14.5px] text-ink placeholder:text-ink-3 focus-visible:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !text.trim()}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-neutral-solid text-fg-on-neutral-solid transition-opacity disabled:opacity-25"
                  aria-label="보내기"
                >
                  <ArrowUp size={17} aria-hidden />
                </button>
              </form>
              {!v.usedAi && <p className="mt-2 text-[12px] text-warn-ink">AI 연결이 불안정해 키워드로 찾은 데이터로 답했습니다.</p>}
            </div>
          </section>

          {hasCards && (
            <aside className="thin-scroll min-w-0 space-y-3 self-stretch overflow-y-auto lg:max-h-[calc(100dvh-270px)] lg:pr-1" aria-label="온디가 보여 주는 데이터">
              {v.cards.map((c, i) => (
                <VoiceCardView key={c.id} card={c} index={i} />
              ))}
            </aside>
          )}
        </div>

        <More className="mt-3 flex flex-col items-center text-center">
          호출어는 이 브라우저의 음성 인식이 듣고, 부른 뒤의 말만 Amazon Transcribe로 보냅니다. 실내온도·전력·요금은 시뮬레이션 값입니다.
        </More>
      </div>
    </div>
  )
}
