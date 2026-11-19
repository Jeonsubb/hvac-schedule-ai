import { Children, Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Table2, BarChart3, Wrench, X, Info, RotateCw, ChevronDown } from 'lucide-react'
import { cx } from '../lib/format'
import { GROUP_META, STRATEGY, type StatusGroup } from '../lib/constants'
import type { StrategyKey } from '../lib/types'

// ---------------------------------------------------------------- surfaces

/** Card: white surface + one hairline + 16px radius. No shadow (only floating layers get one). */
export function Card({
  children,
  className,
  pad = true,
  as: As = 'section',
  ...rest
}: {
  children: ReactNode
  className?: string
  pad?: boolean | 'dense' | 'lg'
  as?: 'section' | 'div'
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  return (
    <As className={cx('rounded-[16px] border border-line bg-surface', pad === true && 'p-6', pad === 'dense' && 'p-5', pad === 'lg' && 'p-8', className)} {...rest}>
      {children}
    </As>
  )
}

export function CardHeader({
  title,
  sub,
  right,
  icon,
  className,
  id,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  icon?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div className={cx('mb-5 flex items-start justify-between gap-x-4 gap-y-2 max-sm:flex-wrap', className)}>
      <div className="min-w-0 flex-1">
        <h2 id={id} className="flex items-center gap-2 text-[17px] leading-snug font-[650] tracking-[-0.01em] text-ink">
          {icon && <span className="flex text-ink-3">{icon}</span>}
          {title}
        </h2>
        {sub && <div className="mt-1 text-[13px] leading-normal text-ink-3">{sub}</div>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div>}
    </div>
  )
}

/** Page title + the page's one-sentence answer + at most one action group. */
export function PageHeader({ title, desc, right, className }: { title: string; desc?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-7 flex flex-wrap items-end justify-between gap-x-8 gap-y-4', className)}>
      <div className="min-w-0 flex-[1_1_20rem]">
        <h1 className="balance text-[28px] leading-[1.2] font-bold tracking-[-0.025em] text-ink">{title}</h1>
        {desc && <p className="pretty mt-2 max-w-[64ch] text-[17px] leading-[1.55] text-ink-2">{desc}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

/** Meta facts separated by space and a hairline tick, instead of 'A · B · C' strings. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter((c) => c !== '')
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-3 gap-y-0.5', className)}>
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="inline-block h-3 w-px bg-line-strong" />}
          <span className="whitespace-nowrap">{c}</span>
        </Fragment>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- figures

/**
 * One key number: label above, large tabular value below. With `info`, the whole figure is a button
 * that opens a popover with the number's basis (progressive disclosure for KPI explanations).
 */
export function Figure({
  label,
  value,
  unit,
  sub,
  info,
  infoTitle,
  size = 'md',
  accent,
  align = 'left',
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  sub?: ReactNode
  info?: ReactNode
  infoTitle?: string
  size?: 'sm' | 'md' | 'lg'
  accent?: string
  align?: 'left' | 'right'
  className?: string
}) {
  const body = (
    <>
      <span className={cx('flex items-center gap-1.5 text-[13px] font-medium text-ink-3', align === 'right' && 'justify-end')}>
        {accent && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden />}
        <span className="truncate">{label}</span>
        {info && <Info size={13} className="shrink-0 text-ink-4 transition-colors group-hover:text-ink-2" aria-hidden />}
      </span>
      <span className={cx('mt-1.5 flex items-baseline gap-1', align === 'right' && 'justify-end')}>
        <span
          className={cx(
            'tnum leading-none font-[650] tracking-[-0.025em] whitespace-nowrap text-ink',
            size === 'lg' ? 'text-[40px]' : size === 'sm' ? 'text-[24px]' : 'text-[30px]',
          )}
        >
          {value}
        </span>
        {unit && <span className={cx('font-medium text-ink-3', size === 'lg' ? 'text-[17px]' : 'text-[14px]')}>{unit}</span>}
      </span>
      {sub && <span className={cx('mt-1.5 block text-[13px] text-ink-3', align === 'right' && 'text-right')}>{sub}</span>}
    </>
  )
  if (!info) return <div className={cx('min-w-0', className)}>{body}</div>
  return (
    <Popover
      label={infoTitle ?? (typeof label === 'string' ? `${label} 근거` : '수치 근거')}
      align={align === 'right' ? 'end' : 'start'}
      className={className}
      buttonClassName="group -m-2 block min-w-0 rounded-[12px] p-2 text-left transition-colors hover:bg-hover"
      button={body}
    >
      {info}
    </Popover>
  )
}

/** Legacy strip (kept for compatibility). New screens use Figure rows without boxes. */
export function StatStrip({ children, className, cols }: { children: ReactNode; className?: string; cols?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[16px] border border-line bg-line', className)}>
      <div className={cx('grid gap-px', cols ?? 'grid-cols-2 lg:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2')}>{children}</div>
    </section>
  )
}

export function StatTile({
  label,
  value,
  unit,
  sub,
  accent,
  icon,
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  sub?: ReactNode
  accent?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('relative bg-surface px-6 py-5', className)}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-3">
        {accent && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} />}
        {icon && <span className="flex shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="tnum text-[28px] leading-none font-[650] tracking-[-0.02em] text-ink">{value}</span>
        {unit && <span className="text-[14px] font-medium text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-2 text-[13px] leading-snug text-ink-3">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- badges

type Tone = 'neutral' | 'brand' | 'ai' | 'good' | 'warn' | 'crit' | 'info' | 'event' | 'outline' | 'heat'

export function Badge({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-well text-ink-2 ring-1 ring-inset ring-line',
    brand: 'bg-[#e6f5ee] text-s-ai-ink',
    ai: 'bg-[#e6f5ee] text-s-ai-ink',
    good: 'bg-good-bg text-good-ink',
    warn: 'bg-warn-bg text-warn-ink',
    crit: 'bg-crit-bg text-crit-ink',
    info: 'bg-info-bg text-info-ink',
    event: 'bg-event-bg text-event-ink',
    outline: 'text-ink-3 ring-1 ring-inset ring-line-strong',
    heat: 'bg-[#fdeee6] text-heat-ink',
  }
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-[6px] px-2 py-[1px] text-[13px] leading-[20px] font-medium whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  )
}

export function GroupIcon({ group, size = 14 }: { group: StatusGroup; size?: number }) {
  const c = GROUP_META[group].icon
  if (group === 'normal') return <CheckCircle2 size={size} color={c} strokeWidth={2.4} aria-hidden />
  if (group === 'auto') return <Wrench size={size} color={c} strokeWidth={2.4} aria-hidden />
  return <AlertTriangle size={size} color={c} strokeWidth={2.4} aria-hidden />
}

export function StatusBadge({ group, label }: { group: StatusGroup; label?: string }) {
  const m = GROUP_META[group]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[6px] px-2 py-[1px] text-[13px] leading-[20px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, color: m.ink }}
    >
      <GroupIcon group={group} size={13} />
      {label ?? m.label}
    </span>
  )
}

export function StrategySwatch({ k, line = false }: { k: StrategyKey; line?: boolean }) {
  return line ? (
    <span aria-hidden className="inline-block h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: STRATEGY[k].color }} />
  ) : (
    <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: STRATEGY[k].color }} />
  )
}

export function StrategyName({ k, short = false, line = false }: { k: StrategyKey; short?: boolean; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <StrategySwatch k={k} line={line} />
      {short ? STRATEGY[k].short : STRATEGY[k].label}
    </span>
  )
}

// ---------------------------------------------------------------- controls

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'

export function btnCls(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md', className?: string) {
  const v: Record<Variant, string> = {
    primary: 'bg-ink text-white border border-ink hover:bg-[#25344e] active:bg-[#0d1726]',
    secondary: 'bg-surface text-ink border border-line-strong hover:bg-hover hover:border-ink-4',
    ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-hover hover:text-ink',
    danger: 'bg-surface text-crit-ink border border-[#efc6c6] hover:bg-crit-bg hover:border-[#e3a9a9]',
    link: 'bg-transparent text-ink border border-transparent underline-offset-4 hover:underline !px-0',
  }
  const s = size === 'sm' ? 'h-8 px-3 text-[13px] gap-1.5' : 'h-10 px-4 text-[14px] gap-2'
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-[10px] font-medium whitespace-nowrap transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-45',
    v[variant],
    s,
    className,
  )
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
  ...rest
}: {
  children: ReactNode
  onClick?: () => void
  variant?: Variant
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
  'aria-label'?: string
  'aria-pressed'?: boolean
  'aria-expanded'?: boolean
}) {
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={btnCls(variant, size, className)} {...rest}>
      {children}
    </button>
  )
}

export function IconButton({ onClick, label, children, disabled, className }: { onClick?: () => void; label: string; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-35',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** A pressed/unpressed chip for showing or hiding a layer (e.g. "AI 판단" markers). */
export function ToggleChip({ pressed, onChange, children, title }: { pressed: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={() => onChange(!pressed)}
      className={cx(
        'inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
        pressed ? 'border-ink bg-ink text-white hover:bg-[#25344e]' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'sm' | 'md'
  label?: string
}) {
  return (
    <div className="inline-flex rounded-[10px] bg-[#eef0f4] p-[3px]" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            title={o.title}
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-[13.5px]',
              on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(20_32_51/0.08),0_0_0_1px_rgb(20_32_51/0.06)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T
  onChange: (v: T) => void
  tabs: { value: T; label: string; icon?: ReactNode; count?: number }[]
}) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 pt-1 pb-3 text-[14.5px] font-medium transition-colors duration-150',
              on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            {t.icon && <span className={on ? 'text-ink' : 'text-ink-4'}>{t.icon}</span>}
            {t.label}
            {t.count !== undefined && <span className="tnum text-[13px] font-medium text-ink-3">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] leading-snug text-ink-3">{hint}</span>}
    </label>
  )
}

export const inputBase =
  'h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-[14px] text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-focus focus:shadow-[0_0_0_3px_rgb(47_111_222/0.16)] focus-visible:outline-none disabled:bg-well disabled:text-ink-3'

export const inputCls = `${inputBase} w-full`

// ---------------------------------------------------------------- disclosure (progressive detail)

/**
 * A row that reveals its content in place. Content mounts on first open (charts and requests start then)
 * and fades in; nothing animates height.
 */
export function Disclosure({
  title,
  summary,
  icon,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  variant = 'row',
  className,
}: {
  title: ReactNode
  summary?: ReactNode
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (v: boolean) => void
  variant?: 'row' | 'inline'
  className?: string
}) {
  const [own, setOwn] = useState(defaultOpen)
  const open = openProp ?? own
  const id = useId()
  const toggle = () => {
    const v = !open
    if (openProp === undefined) setOwn(v)
    onOpenChange?.(v)
  }
  if (variant === 'inline')
    return (
      <div className={className}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="inline-flex items-center gap-1.5 rounded-[8px] py-1 text-[13.5px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          {title}
          <ChevronDown size={15} className={cx('transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </button>
        {open && (
          <div id={id} className="reveal mt-3">
            {children}
          </div>
        )}
      </div>
    )
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="group flex min-h-[60px] w-full items-center gap-3 px-6 py-3 text-left transition-colors duration-150 hover:bg-[#fafbfc]"
      >
        {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-well text-ink-2">{icon}</span>}
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-ink">{title}</span>
        {summary != null && <span className="tnum hidden shrink-0 text-[14px] text-ink-3 sm:inline">{summary}</span>}
        <ChevronDown size={18} className={cx('shrink-0 text-ink-4 transition-transform duration-200 group-hover:text-ink-2', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} className="reveal px-6 pt-1 pb-6">
          {children}
        </div>
      )}
    </div>
  )
}

/** Grouped list of disclosures inside one card (settings-app style). */
export function DisclosureList({ children, title, hideTitle = false, className }: { children: ReactNode; title?: string; hideTitle?: boolean; className?: string }) {
  return (
    <section className={className} aria-label={title}>
      {title && !hideTitle && <h2 className="mb-3 px-1 text-[17px] font-[650] text-ink">{title}</h2>}
      <div className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------- popover

/** A small floating explanation anchored to a button. Esc or an outside click closes it and focus returns. */
export function Popover({
  button,
  children,
  label,
  align = 'start',
  width = 340,
  className,
  buttonClassName,
}: {
  button: ReactNode
  children: ReactNode
  label: string
  align?: 'start' | 'end'
  width?: number
  className?: string
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'start' | 'end'>(align)
  const wrap = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const id = useId()
  // keep the panel inside the viewport: flip to the other edge when the preferred side would overflow
  useLayoutEffect(() => {
    if (!open || !wrap.current) return
    const r = wrap.current.getBoundingClientRect()
    const w = Math.min(width, window.innerWidth - 32)
    if (align === 'start' && r.left + w > window.innerWidth - 16) setSide('end')
    else if (align === 'end' && r.right - w < 16) setSide('start')
    else setSide(align)
  }, [open, align, width])
  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }, [])
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    document.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open, close])
  return (
    <span ref={wrap} className={cx('relative inline-block', className)}>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(
            'pop absolute top-full z-50 mt-2 rounded-[14px] border border-line bg-surface p-4 text-left text-[14px] leading-relaxed font-normal text-ink-2 shadow-[var(--shadow-float)]',
            side === 'end' ? 'right-0' : 'left-0',
          )}
          style={{ width, maxWidth: 'calc(100vw - 32px)' }}
        >
          {children}
        </div>
      )}
    </span>
  )
}

// ---------------------------------------------------------------- states

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-ink-3', className)} aria-hidden />
}

export function Loading({ label = '불러오는 중…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-[14px] text-ink-3', className)} role="status">
      <Spinner />
      {label}
    </div>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('skeleton', className)} style={style} aria-hidden />
}

/** First-load placeholder shaped like the page: header, answer line, one large panel. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-label={label}>
      <div className="space-y-3">
        <Skeleton className="h-8 w-[200px] rounded-[10px]" />
        <Skeleton className="h-5 w-[min(560px,80%)] rounded-[8px]" />
      </div>
      <div className="flex items-center gap-2 text-[14px] text-ink-3">
        <Spinner size={15} /> {label}
      </div>
      <Skeleton className="h-[420px] rounded-[16px]" />
    </div>
  )
}

export function ErrorBox({ error, onRetry, title }: { error: Error | string; onRetry?: () => void; title?: string }) {
  const msg = typeof error === 'string' ? error : error.message
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] border border-[#efc6c6] bg-crit-bg px-4 py-3" role="alert">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0">
          {title && <div className="text-[14px] font-semibold text-crit-ink">{title}</div>}
          <div className="text-[13.5px] text-crit-ink">{msg || '요청이 실패했습니다. 잠시 뒤 다시 시도하세요.'}</div>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden /> 다시 시도
        </Button>
      )}
    </div>
  )
}

export function Empty({ title, desc, icon, action }: { title: string; desc?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-well text-ink-3" aria-hidden>
        {icon ?? <Info size={18} />}
      </div>
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      {desc && <div className="max-w-sm text-[13.5px] leading-relaxed text-ink-3">{desc}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/** One quiet line for a state that needs no box (info, ok, warning). */
export function Note({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'crit'; icon?: ReactNode }) {
  return (
    <div
      className={cx(
        'flex items-start gap-2 rounded-[10px] px-3.5 py-2.5 text-[13.5px] leading-relaxed',
        tone === 'neutral' && 'bg-well text-ink-2',
        tone === 'good' && 'bg-good-bg text-good-ink',
        tone === 'warn' && 'bg-warn-bg text-warn-ink',
        tone === 'crit' && 'bg-crit-bg text-crit-ink',
      )}
      role={tone === 'crit' ? 'alert' : undefined}
    >
      {icon && <span className="mt-[3px] flex shrink-0">{icon}</span>}
      <span className="min-w-0">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------- overlays

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
      prev?.focus?.()
    }
  }, [open, onClose])
  return ref
}

export function Drawer({
  open,
  onClose,
  title,
  sub,
  width = 760,
  children,
  right,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  width?: number
  children: ReactNode
  right?: ReactNode
}) {
  const ref = useDialog(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="fade-in absolute inset-0 bg-[rgb(20_32_51/0.28)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="slide-in absolute top-0 right-0 flex h-full max-w-[96vw] flex-col bg-surface shadow-[var(--shadow-cover)] outline-none"
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 px-8 pt-7 pb-5">
          <div className="min-w-0">
            <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h2>
            {sub && <div className="mt-1.5 text-[13.5px] text-ink-3">{sub}</div>}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <IconButton onClick={onClose} label="닫기">
              <X size={19} />
            </IconButton>
          </div>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto overscroll-contain px-8 pt-1 pb-10">{children}</div>
      </div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useDialog(open, onClose)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-[rgb(20_32_51/0.32)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="pop relative max-h-[90vh] overflow-y-auto overscroll-contain rounded-[16px] bg-surface shadow-[var(--shadow-cover)] outline-none"
        style={{ width, transformOrigin: 'center' }}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-[17px] font-[650] text-ink">{title}</h2>
          <IconButton onClick={onClose} label="닫기">
            <X size={18} />
          </IconButton>
        </div>
        <div className="px-6 pt-1 pb-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- toast

type ToastMsg = { id: number; text: string; tone: 'good' | 'crit' | 'neutral' }
let pushToast: ((t: ToastMsg) => void) | null = null
let toastId = 0

export function toast(text: string, tone: ToastMsg['tone'] = 'good') {
  pushToast?.({ id: ++toastId, text, tone })
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([])
  useEffect(() => {
    pushToast = (t) => {
      setItems((x) => [...x, t])
      window.setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), 4200)
    }
    return () => {
      pushToast = null
    }
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-8 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pop pointer-events-auto flex items-center gap-2.5 rounded-[12px] px-4 py-3 text-[14px] font-medium shadow-[var(--shadow-float)]',
            t.tone === 'good' && 'bg-ink text-white',
            t.tone === 'crit' && 'bg-crit-ink text-white',
            t.tone === 'neutral' && 'border border-line bg-surface text-ink',
          )}
        >
          {t.tone === 'good' ? <CheckCircle2 size={16} className="text-[#7fd6a8]" aria-hidden /> : t.tone === 'crit' ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- chart container with table-view twin

export interface TableSpec {
  columns: string[]
  rows: (string | number | null)[][]
  align?: ('left' | 'right')[]
}

/** The "표로 보기 / 차트로 보기" switch every major chart carries. */
export function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} type="button" className={btnCls('ghost', 'sm')} aria-pressed={asTable} title={asTable ? '차트로 보기' : '같은 데이터를 표로 보기'}>
      {asTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
      {asTable ? '차트로 보기' : '표로 보기'}
    </button>
  )
}

export function ChartCard({
  title,
  sub,
  right,
  legend,
  table,
  children,
  className,
  footer,
  bare = false,
}: {
  title?: ReactNode
  sub?: ReactNode
  right?: ReactNode
  legend?: ReactNode
  table?: TableSpec
  children: ReactNode
  className?: string
  footer?: ReactNode
  /** inside a disclosure: no card frame, title optional */
  bare?: boolean
}) {
  const [asTable, setAsTable] = useState(false)
  const actions = (
    <>
      {right}
      {table && <TableToggle asTable={asTable} onToggle={() => setAsTable((v) => !v)} />}
    </>
  )
  const inner = (
    <>
      {title ? (
        <CardHeader title={title} sub={sub} right={actions} />
      ) : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 text-[13.5px] text-ink-3">{sub}</div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
      )}
      {legend && !asTable && <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">{legend}</div>}
      {asTable && table ? <DataTable spec={table} /> : children}
      {footer}
    </>
  )
  if (bare) return <div className={className}>{inner}</div>
  return <Card className={className}>{inner}</Card>
}

export function DataTable({ spec, maxHeight = 360 }: { spec: TableSpec; maxHeight?: number }) {
  const al = (i: number) => spec.align?.[i] ?? (i === 0 ? 'left' : 'right')
  return (
    <div className="thin-scroll overflow-auto rounded-[12px] border border-line" style={{ maxHeight }}>
      <table className="tnum w-full text-[13.5px]">
        <thead className="sticky top-0 bg-well">
          <tr>
            {spec.columns.map((c, i) => (
              <th key={c} className={cx('border-b border-line px-3.5 py-2.5 text-[13px] font-semibold text-ink-3', al(i) === 'right' ? 'text-right' : 'text-left')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line first:border-t-0">
              {r.map((v, i) => (
                <td key={i} className={cx('px-3.5 py-2 text-ink', al(i) === 'right' ? 'text-right' : 'text-left')}>
                  {v === null ? '–' : typeof v === 'number' ? v.toLocaleString('ko-KR') : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LegendItem({ color, label, kind = 'rect' }: { color: string; label: ReactNode; kind?: 'rect' | 'line' | 'dot' | 'wash' }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {kind === 'line' && <span aria-hidden className="inline-block h-[3px] w-4 rounded-full" style={{ background: color }} />}
      {kind === 'rect' && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
      {kind === 'dot' && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {kind === 'wash' && <span aria-hidden className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: color }} />}
      {label}
    </span>
  )
}

/** Standard table frame + header cell classes, so every table reads the same. */
export const tbl = {
  frame: 'overflow-hidden rounded-[12px] border border-line',
  table: 'tnum w-full text-[13.5px]',
  thead: 'bg-well text-ink-3',
  th: 'border-b border-line px-3.5 py-2.5 text-left text-[13px] font-semibold whitespace-nowrap',
  thR: 'border-b border-line px-3.5 py-2.5 text-right text-[13px] font-semibold whitespace-nowrap',
  tr: 'border-t border-line first:border-t-0',
}
