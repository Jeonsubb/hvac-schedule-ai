import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { CHAPTERS, useTour } from '../lib/tour'
import { AiAvatar } from './PublicShell'
import { cx } from '../lib/format'

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 10

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Spotlight for the chapter tour: dims the screen except one anchored block, explains it in a small
 * card, and moves screen by screen. The page stays interactive (buttons inside the spotlight work).
 */
export default function TourOverlay() {
  const t = useTour()
  const nav = useNavigate()
  const loc = useLocation()
  const [rect, setRect] = useState<Rect | null>(null)
  const [missing, setMissing] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)

  const ch = CHAPTERS[t.chapter]
  const st = ch?.steps[t.step]

  // go to the step's screen, then find, scroll to and keep measuring its anchored block
  useEffect(() => {
    if (!t.active || !st) return
    if (loc.pathname + loc.search !== st.path) nav(st.path)
    setRect(null)
    setMissing(false)
    let alive = true
    let el: Element | null = null
    let tries = 0
    const find = window.setInterval(() => {
      el = document.querySelector(`[data-tour="${st.target}"]`)
      tries++
      if (el) {
        window.clearInterval(find)
        const r = el.getBoundingClientRect()
        const tall = r.height > window.innerHeight * 0.62
        el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: tall ? 'start' : 'center' })
      } else if (tries > 60) {
        window.clearInterval(find)
        if (alive) setMissing(true)
      }
    }, 150)
    const measure = window.setInterval(() => {
      if (!el || !alive) return
      const r = el.getBoundingClientRect()
      setRect((old) =>
        old && Math.abs(old.top - r.top) < 0.5 && Math.abs(old.left - r.left) < 0.5 && Math.abs(old.width - r.width) < 0.5 && Math.abs(old.height - r.height) < 0.5
          ? old
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      )
    }, 120)
    return () => {
      alive = false
      window.clearInterval(find)
      window.clearInterval(measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.active, t.chapter, t.step])

  useEffect(() => {
    if (!t.active) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') t.stop()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        t.next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        t.prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [t])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  })

  if (!t.active || !ch || !st) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const hole = rect
    ? {
        top: Math.max(rect.top - PAD, 4),
        left: Math.max(rect.left - PAD, 4),
        width: Math.min(rect.width + PAD * 2, vw - 8),
        height: Math.min(rect.height + PAD * 2, vh - Math.max(rect.top - PAD, 4) - 76),
      }
    : null

  // callout: below the spotlight if it fits, else above, else pinned to the bottom right
  const W = Math.min(420, vw - 32)
  // the chapter bar sits at the bottom (64px), so cards stay above it
  let cardStyle: React.CSSProperties = { right: 24, bottom: 84, width: W }
  if (hole) {
    const below = hole.top + hole.height + 14
    const above = hole.top - 14 - cardH
    const left = Math.min(Math.max(hole.left, 16), vw - W - 16)
    if (below + cardH < vh - 84) cardStyle = { top: below, left, width: W }
    else if (above > 16) cardStyle = { top: above, left, width: W }
  }
  const total = CHAPTERS.reduce((a, c) => a + c.steps.length, 0)
  const index = CHAPTERS.slice(0, t.chapter).reduce((a, c) => a + c.steps.length, 0) + t.step + 1
  const last = t.chapter === CHAPTERS.length - 1 && t.step === ch.steps.length - 1

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-live="polite">
      {/* dim everything except the spotlight */}
      {hole ? (
        <div
          className="absolute rounded-[22px] ring-2 ring-brand transition-[top,left,width,height] duration-300 ease-out"
          style={{ ...hole, boxShadow: '0 0 0 9999px rgba(12, 14, 19, 0.55)' }}
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(12,14,19,0.55)]" aria-hidden />
      )}

      {/* chapter bar */}
      <nav className="pointer-events-auto absolute bottom-4 left-1/2 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full bg-surface p-1.5 shadow-[0_18px_48px_rgb(12_14_19/0.3)]" aria-label="챕터">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => t.goChapter(i)}
            aria-current={i === t.chapter ? 'step' : undefined}
            className={cx(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
              i === t.chapter ? 'bg-ink font-semibold text-white' : i < t.chapter ? 'text-ink-2 hover:bg-hover' : 'text-ink-3 hover:bg-hover',
            )}
          >
            <span className={cx('tnum text-[12px] font-bold', i === t.chapter ? 'text-[#8fb3f0]' : 'text-ink-4')}>{String(i + 1).padStart(2, '0')}</span>
            {c.title}
          </button>
        ))}
        <button type="button" onClick={t.stop} className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-hover hover:text-ink" aria-label="챕터 보기 끝내기">
          <X size={16} />
        </button>
      </nav>

      {/* explanation card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`${ch.title}: ${st.title}`}
        className="pointer-events-auto absolute rounded-[24px] bg-surface p-6 shadow-[0_32px_80px_rgb(12_14_19/0.35)] transition-[top,left] duration-300 ease-out"
        style={cardStyle}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2.5 text-[13px] font-semibold text-ink-2">
            <AiAvatar size={30} />
            <span className="tnum font-bold text-brand-ink">{String(t.chapter + 1).padStart(2, '0')}</span>
            {ch.title}
          </span>
          <span className="tnum text-[12.5px] text-ink-3">
            {index} / {total}
          </span>
        </div>
        <div className="mt-4 text-[13px] font-medium text-ink-3">{ch.question}</div>
        <h2 className="mt-1 text-[19px] leading-[1.35] font-bold tracking-[-0.015em] text-ink">{st.title}</h2>
        <p className="mt-2 text-[15px] leading-[1.6] text-ink-2">{missing ? '이 부분은 아직 계산 전이거나 불러오지 못했습니다. 화면의 계산 버튼을 누르거나 다음으로 넘어가도 됩니다.' : st.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {ch.steps.map((_, i) => (
              <span key={i} className={cx('h-1.5 rounded-full transition-all', i === t.step ? 'w-5 bg-brand' : 'w-1.5 bg-line-strong')} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={t.prev}
              disabled={t.chapter === 0 && t.step === 0}
              className="inline-flex h-10 items-center gap-1 rounded-full px-3.5 text-[14px] font-semibold text-ink-2 hover:bg-hover disabled:opacity-40"
            >
              <ArrowLeft size={15} aria-hidden /> 이전
            </button>
            <button type="button" onClick={t.next} className="inline-flex h-10 items-center gap-1 rounded-full bg-ink px-5 text-[14px] font-semibold text-white hover:bg-[#2a2e37]">
              {last ? '끝내기' : '다음'} {!last && <ArrowRight size={15} aria-hidden />}
            </button>
          </div>
        </div>
        <div className="mt-3 text-[12px] text-ink-4">← → 키로 넘기고 Esc로 닫습니다. 밝은 부분은 직접 눌러 볼 수 있습니다.</div>
      </div>
    </div>
  )
}
