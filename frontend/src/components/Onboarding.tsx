import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown } from 'lucide-react'
import { cx } from '../lib/format'
import { Spinner } from './ui'
import { Wordmark } from './PublicShell'

/*
 * Onboarding building blocks (sign-up and building registration):
 * a white full-screen frame with one centered column, a thin progress line,
 * one question per screen, big inputs and one clear call to action.
 */

/** Which way the flow moved, so the next screen slides in from the right (forward) or the left (back). */
export function useStepDir(step: number): 1 | -1 {
  const prev = useRef(step)
  const dir = step >= prev.current ? 1 : -1
  useEffect(() => {
    prev.current = step
  }, [step])
  return dir
}

export function ObShell({
  progress,
  onBack,
  right,
  wide = false,
  children,
}: {
  /** 0..1 */
  progress: number
  onBack?: () => void
  right?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  const p = Math.max(0, Math.min(1, progress))
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onBack}
              aria-label="이전 단계"
              className={cx('ob-icon-btn', !onBack && 'pointer-events-none opacity-0')}
              tabIndex={onBack ? 0 : -1}
            >
              <ArrowLeft size={21} aria-hidden />
            </button>
            <Link to="/welcome" className="rounded-[8px] px-1" aria-label="ON:D 소개로 가기">
              <Wordmark size={20} />
            </Link>
          </div>
          {right && <div className="flex items-center gap-3 text-[14px]">{right}</div>}
        </div>
        <div
          className="h-[3px] w-full bg-[#eef0f3]"
          role="progressbar"
          aria-label="진행률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p * 100)}
        >
          <div className="ob-progress h-full bg-brand" style={{ transform: `scaleX(${p})` }} />
        </div>
      </header>
      {/* the call to action sits at the bottom of the column, but never further down than ~720px on tall screens */}
      <main className={cx('mx-auto flex w-full flex-1 flex-col px-5 pt-[clamp(28px,7vh,72px)] pb-8 sm:flex-none sm:min-h-[min(720px,calc(100dvh-67px))] sm:px-6', wide ? 'max-w-[720px]' : 'max-w-[520px]')}>
        {children}
      </main>
    </div>
  )
}

/** One screen of the flow; re-keyed on every step so it enters with a short fade and slide. */
export function ObStep({ k, dir, children }: { k: string; dir: 1 | -1; children: ReactNode }) {
  return (
    <div key={k} className={cx('flex flex-1 flex-col', dir > 0 ? 'ob-in-fwd' : 'ob-in-back')}>
      {children}
    </div>
  )
}

export function ObTitle({ eyebrow, title, desc, center = false }: { eyebrow?: ReactNode; title: ReactNode; desc?: ReactNode; center?: boolean }) {
  return (
    <div className={cx('mb-9', center && 'text-center')}>
      {eyebrow && <p className="ob-rise mb-3 text-[14px] font-semibold text-brand-ink">{eyebrow}</p>}
      <h1 className="ob-rise balance text-[28px] leading-[1.32] font-bold tracking-[-0.03em] text-ink sm:text-[32px]">{title}</h1>
      {desc && <p className="ob-rise ob-d1 pretty mt-3 text-[16.5px] leading-[1.55] text-ink-3">{desc}</p>}
    </div>
  )
}

export const obInput =
  'h-14 w-full rounded-[12px] border border-[#dfe2e6] bg-surface px-4 text-[17px] text-ink outline-none placeholder:text-ink-4 transition-[border-color,box-shadow] duration-200 hover:border-[#c7ccd3] focus:border-brand focus:shadow-[0_0_0_3px_rgb(49_101_204/0.14)] aria-[invalid=true]:border-crit'

export function ObField({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-2 block text-[14px] font-medium text-ink-2">{label}</span>
      {children}
      {(error || hint) && <span className={cx('mt-2 block text-[13.5px]', error ? 'text-crit-ink' : 'text-ink-3')}>{error || hint}</span>}
    </label>
  )
}

/** A selectable row: icon, title, one line, and a round check that fills when chosen. */
export function ChoiceCard({
  selected,
  onSelect,
  icon,
  title,
  desc,
  badge,
}: {
  selected: boolean
  onSelect: () => void
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  badge?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx('ob-card flex w-full items-center gap-4 rounded-[14px] border px-5 py-[18px] text-left', selected ? 'is-on border-brand bg-[#f5f8fe]' : 'border-line bg-surface')}
    >
      {icon && <span className="ob-card-icon flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[17px] leading-[1.35] font-semibold text-ink">
          {title}
          {badge && <span className="rounded-[5px] bg-brand-bg px-1.5 py-[2px] text-[12px] leading-none font-semibold text-brand-ink">{badge}</span>}
        </span>
        {desc && <span className="mt-1 block text-[14.5px] leading-[1.45] text-ink-3">{desc}</span>}
      </span>
      <span className="ob-radio" aria-hidden>
        <Check size={14} strokeWidth={3} />
      </span>
    </button>
  )
}

/** Small pill choices (vendor, protocol, building type). */
export function ObChips<T extends string>({ value, options, onChange, label, cols = 2 }: { value: T; options: { value: T; label: string; sub?: string }[]; onChange: (v: T) => void; label: string; cols?: 2 | 3 }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('grid gap-2', cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'ob-chip min-h-12 rounded-[12px] border px-3.5 py-2.5 text-left text-[15px] leading-[1.3]',
              on ? 'border-brand bg-[#f5f8fe] font-semibold text-ink' : 'border-line font-medium text-ink-2',
            )}
          >
            {o.label}
            {o.sub && <span className="tnum mt-0.5 block text-[12.5px] font-normal text-ink-3">{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The bottom call to action; on phones it stays at the bottom edge. */
export function ObCta({
  children,
  onClick,
  disabled,
  busy,
  type = 'button',
  below,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  type?: 'button' | 'submit'
  below?: ReactNode
}) {
  return (
    <div className="ob-cta-bar mt-auto pt-10">
      <button type={type} onClick={onClick} disabled={disabled || busy} className="ob-cta">
        {busy && <Spinner size={17} className="text-white" />}
        {children}
      </button>
      {below && <div className="mt-4 text-center text-[14.5px]">{below}</div>}
    </div>
  )
}

export function ObTextButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-[6px] px-1 font-medium text-ink-3 underline-offset-4 transition-colors duration-200 hover:text-ink hover:underline">
      {children}
    </button>
  )
}

/** "자세히 보기": longer explanations stay folded. */
export function ObMore({ label = '자세히 보기', children, className }: { label?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-[6px] text-[14px] font-medium text-ink-3 transition-colors duration-200 hover:text-ink"
      >
        {label}
        <ChevronDown size={15} className={cx('transition-transform duration-300', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="ob-reveal mt-3">{children}</div>}
    </div>
  )
}

/** A filled circle that pops in, then a check that draws itself. */
export function SuccessMark({ size = 76 }: { size?: number }) {
  return (
    <svg className="ob-success" width={size} height={size} viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r="36" className="ob-success-ring" />
      <path d="M24 39.5l9.5 9.5L53 29.5" className="ob-success-check" />
    </svg>
  )
}
