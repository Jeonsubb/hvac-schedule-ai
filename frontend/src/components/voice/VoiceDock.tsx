import { Link, useLocation } from 'react-router-dom'
import { Home as HomeIcon, Square } from 'lucide-react'
import { cx } from '../../lib/format'
import { useVoice } from '../../lib/voice/agent'
import Orb from './Orb'

/** ON:D on every other screen: the same session as the start screen, small, in the corner. */
export default function VoiceDock() {
  const v = useVoice()
  const loc = useLocation()
  if (loc.pathname === '/') return null
  const active = v.phase === 'listening' || v.phase === 'thinking' || v.phase === 'speaking'
  const line =
    v.phase === 'listening' ? v.transcript || '네, 말씀하세요' : v.phase === 'thinking' ? `“${v.userText}” 확인하는 중…` : v.phase === 'speaking' ? v.say : ''
  return (
    <div className={cx('flex max-w-[calc(100vw-32px)] items-end gap-2 lg:bottom-4 lg:left-5', active ? 'fixed bottom-3 left-4 z-40' : 'relative mx-4 mb-4 z-10 lg:fixed lg:mx-0 lg:mb-0 lg:z-20')}>
      <div
        className={cx(
          'flex items-center rounded-full border border-line bg-surface text-ink transition-[padding] duration-150 ease-out',
          active ? 'pr-4' : 'pr-0',
        )}
      >
        <button
          type="button"
          onClick={v.wake}
          className="relative h-11 w-11 shrink-0 rounded-full transition-colors duration-150 hover:bg-hover active:bg-well"
          aria-label={v.phase === 'listening' ? '듣기 멈추기' : '온디 부르기'}
          title={v.micOn ? (v.wakeOn ? '“온디”라고 부르거나 눌러서 말하기' : '눌러서 말하기') : '눌러서 마이크 켜고 말하기'}
        >
          <Orb phase={v.phase} sample={v.sample} points={420} className="absolute inset-0 h-full w-full" />
        </button>
        {active && (
          <div className="fade-in flex min-w-0 items-center gap-2 py-2 pl-1" role="status" aria-live="polite">
            <p className="line-clamp-2 max-w-[min(420px,60vw)] text-[13.5px] leading-snug text-ink">{line}</p>
            {v.phase === 'speaking' && (
              <button type="button" onClick={v.stop} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-well text-ink hover:bg-hover" aria-label="말 멈추기">
                <Square size={10} fill="currentColor" />
              </button>
            )}
          </div>
        )}
      </div>
      {!active && (v.cards.length > 0 || v.say) && (
        <Link
          to="/"
          className="ond-press mb-0.5 inline-flex h-10 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          <HomeIcon size={14} aria-hidden /> 온디{v.cards.length > 0 ? ` · 카드 ${v.cards.length}` : ''}
        </Link>
      )}
    </div>
  )
}
