import { Children, Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Table2, BarChart3, Wrench, X, Info, RotateCw } from 'lucide-react'
import { cx } from '../lib/format'
import { GROUP_META, STRATEGY, type StatusGroup } from '../lib/constants'
import type { StrategyKey } from '../lib/types'

// ---------------------------------------------------------------- surfaces

/** Panel: surface + hairline + 10px radius. No shadow (only floating layers get one). */
export function Card({
  children,
  className,
  pad = true,
  as: As = 'section',
}: {
  children: ReactNode
  className?: string
  pad?: boolean | 'dense'
  as?: 'section' | 'div'
}) {
  return (
    <As className={cx('rounded-[10px] border border-line bg-surface', pad === true && 'p-5', pad === 'dense' && 'p-4', className)}>
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
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-4 flex items-start justify-between gap-x-4 gap-y-2 max-sm:flex-wrap', className)}>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-[15px] leading-snug font-[650] tracking-[-0.01em] text-ink">
          {icon && <span className="flex text-ink-3">{icon}</span>}
          {title}
        </h2>
        {sub && <div className="mt-1 text-[12.5px] leading-normal text-ink-3">{sub}</div>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div>}
    </div>
  )
}

export function PageHeader({ title, desc, right }: { title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {desc && <p className="mt-1.5 max-w-[78ch] text-[13.5px] leading-relaxed text-ink-2">{desc}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

/** Meta facts separated by space and a hairline tick, instead of 'A · B · C' strings. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter((c) => c !== '')
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5', className)}>
      {items.map((c, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="inline-block h-2.5 w-px bg-line-strong" />}
          <span className="whitespace-nowrap">{c}</span>
        </Fragment>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------- figures

/** One panel split into stat cells by hairlines (replaces rows of identical cards). */
export function StatStrip({ children, className, cols }: { children: ReactNode; className?: string; cols?: string }) {
  return (
    <section className={cx('overflow-hidden rounded-[10px] border border-line bg-line', className)}>
      <div className={cx('grid gap-px', cols ?? 'grid-cols-2 lg:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2')}>{children}</div>
    </section>
  )
}

export function StatTile({
  label,
  value,
  unit,
  delta,
  deltaGood,
  sub,
  accent,
  icon,
  className,
  emphasis,
}: {
  label: ReactNode
  value: ReactNode
  unit?: string
  delta?: ReactNode
  deltaGood?: boolean | null
  sub?: ReactNode
  accent?: string
  icon?: ReactNode
  className?: string
  emphasis?: boolean
}) {
  return (
    <div className={cx('relative bg-surface px-5 py-4', className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        {accent && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />}
        {icon && <span className="flex shrink-0 text-ink-3">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={cx('pnum leading-none font-[650] tracking-[-0.02em] text-ink', emphasis ? 'text-[30px]' : 'text-[26px]')}>{value}</span>
        {unit && <span className="text-[13px] font-medium text-ink-3">{unit}</span>}
        {delta && (
          <span
            className={cx(
              'tnum ml-1.5 text-[12.5px] font-semibold',
              deltaGood === true && 'text-good-ink',
              deltaGood === false && 'text-crit-ink',
              deltaGood == null && 'text-ink-2',
            )}
          >
            {delta}
          </span>
        )}
      </div>
      {sub && <div className="mt-2 text-[12px] leading-snug text-ink-3">{sub}</div>}
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
    <span
      title={title}
      className={cx('inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] text-[11.5px] leading-[18px] font-medium whitespace-nowrap', tones[tone], className)}
    >
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
      className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] text-[11.5px] leading-[18px] font-semibold whitespace-nowrap"
      style={{ background: m.bg, color: m.ink }}
    >
      <GroupIcon group={group} size={12} />
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

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function btnCls(variant: Variant = 'secondary', size: 'sm' | 'md' = 'md', className?: string) {
  const v: Record<Variant, string> = {
    primary: 'bg-ink text-white border border-ink hover:bg-[#24334d]',
    secondary: 'bg-surface text-ink border border-line-strong hover:bg-hover',
    ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-hover hover:text-ink',
    danger: 'bg-surface text-crit-ink border border-[#efc6c6] hover:bg-crit-bg',
  }
  const s = size === 'sm' ? 'h-7 px-2.5 text-[12.5px] gap-1' : 'h-8 px-3 text-[13px] gap-1.5'
  return cx(
    'inline-flex shrink-0 items-center justify-center rounded-[6px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45',
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
      className={cx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-ink-3 transition-colors hover:bg-hover hover:text-ink disabled:opacity-35', className)}
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
    <div className="inline-flex rounded-[7px] border border-line bg-well p-[2px]" role="radiogroup" aria-label={label}>
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
              'inline-flex items-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7 px-2.5 text-[12.5px]',
              on ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line-strong)]' : 'text-ink-3 hover:text-ink',
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
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
              on ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink',
            )}
          >
            <span className={on ? 'text-ink' : 'text-ink-4'}>{t.icon}</span>
            {t.label}
            {t.count !== undefined && <span className="tnum rounded-[4px] bg-well px-1.5 text-[11.5px] font-semibold text-ink-2 ring-1 ring-line ring-inset">{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-snug text-ink-3">{hint}</span>}
    </label>
  )
}

export const inputBase =
  'h-[34px] rounded-[6px] border border-line-strong bg-surface px-2.5 text-[13px] text-ink transition-[border-color,box-shadow] placeholder:text-ink-4 focus:border-focus focus:shadow-[0_0_0_3px_rgb(47_111_222/0.16)] focus-visible:outline-none disabled:bg-well disabled:text-ink-3'

export const inputCls = `${inputBase} w-full`

// ---------------------------------------------------------------- states

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-ink-3', className)} aria-hidden />
}

export function Loading({ label = '불러오는 중…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-[13px] text-ink-3', className)} role="status">
      <Spinner />
      {label}
    </div>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx('skeleton', className)} style={style} aria-hidden />
}

/** First-load placeholder shaped like the page: header, strip, two panels. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" role="status" aria-label={label}>
      <div className="flex items-center gap-2 text-[13px] text-ink-3">
        <Spinner size={14} /> {label}
      </div>
      <Skeleton className="h-[92px] rounded-[10px]" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Skeleton className="h-[320px] rounded-[10px] xl:col-span-2" />
        <Skeleton className="h-[320px] rounded-[10px]" />
      </div>
    </div>
  )
}

export function ErrorBox({ error, onRetry, title }: { error: Error | string; onRetry?: () => void; title?: string }) {
  const msg = typeof error === 'string' ? error : error.message
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-[6px] border border-[#efc6c6] bg-crit-bg px-4 py-3" role="alert">
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-crit" aria-hidden />
        <div className="min-w-0">
          {title && <div className="text-[13px] font-semibold text-crit-ink">{title}</div>}
          <div className="text-[13px] text-crit-ink">{msg || '요청이 실패했습니다. 잠시 뒤 다시 시도하세요.'}</div>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RotateCw size={12} /> 다시 시도
        </Button>
      )}
    </div>
  )
}

export function Empty({ title, desc, icon, action }: { title: string; desc?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-well text-ink-3 ring-1 ring-line">{icon ?? <Info size={17} />}</div>
      <div className="text-[13.5px] font-semibold text-ink">{title}</div>
      {desc && <div className="max-w-sm text-[12.5px] leading-relaxed text-ink-3">{desc}</div>}
      {action && <div className="mt-2">{action}</div>}
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
      <div className="fade-in absolute inset-0 bg-[rgb(20_32_51/0.32)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className="slide-in absolute top-0 right-0 flex h-full max-w-[96vw] flex-col bg-paper shadow-[var(--shadow-cover)] outline-none"
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line bg-surface px-6 py-4">
          <div className="min-w-0">
            <div className="text-[17px] font-bold tracking-[-0.015em] text-ink">{title}</div>
            {sub && <div className="mt-1 text-[12.5px] text-ink-3">{sub}</div>}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <IconButton onClick={onClose} label="닫기">
              <X size={18} />
            </IconButton>
          </div>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-5">{children}</div>
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
      <div className="fade-in absolute inset-0 bg-[rgb(20_32_51/0.36)]" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="fade-in relative max-h-[90vh] overflow-y-auto rounded-[10px] bg-surface shadow-[var(--shadow-cover)] outline-none"
        style={{ width }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-[650] text-ink">{title}</div>
          <IconButton onClick={onClose} label="닫기">
            <X size={17} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-well px-5 py-3">{footer}</div>}
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
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            'fade-in pointer-events-auto flex items-center gap-2 rounded-[8px] px-4 py-2.5 text-[13px] font-medium shadow-[var(--shadow-float)]',
            t.tone === 'good' && 'bg-ink text-white',
            t.tone === 'crit' && 'bg-crit-ink text-white',
            t.tone === 'neutral' && 'border border-line bg-surface text-ink',
          )}
        >
          {t.tone === 'good' ? <CheckCircle2 size={15} className="text-[#7fd6a8]" /> : t.tone === 'crit' ? <AlertTriangle size={15} /> : <Info size={15} />}
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

export function ChartCard({
  title,
  sub,
  right,
  legend,
  table,
  children,
  className,
  footer,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
  legend?: ReactNode
  table?: TableSpec
  children: ReactNode
  className?: string
  footer?: ReactNode
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        sub={sub}
        right={
          <>
            {right}
            {table && (
              <button
                onClick={() => setAsTable((v) => !v)}
                className={btnCls('secondary', 'sm')}
                aria-pressed={asTable}
                title={asTable ? '차트로 보기' : '같은 데이터를 표로 보기'}
              >
                {asTable ? <BarChart3 size={13} /> : <Table2 size={13} />}
                {asTable ? '차트' : '표'}
              </button>
            )}
          </>
        }
      />
      {legend && !asTable && <div className="-mt-1 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">{legend}</div>}
      {asTable && table ? <DataTable spec={table} /> : children}
      {footer}
    </Card>
  )
}

export function DataTable({ spec, maxHeight = 360 }: { spec: TableSpec; maxHeight?: number }) {
  const al = (i: number) => spec.align?.[i] ?? (i === 0 ? 'left' : 'right')
  return (
    <div className="thin-scroll overflow-auto rounded-[6px] border border-line" style={{ maxHeight }}>
      <table className="tnum w-full text-[12.5px]">
        <thead className="sticky top-0 bg-well">
          <tr>
            {spec.columns.map((c, i) => (
              <th key={c} className={cx('border-b border-line px-3 py-2 font-semibold text-ink-2', al(i) === 'right' ? 'text-right' : 'text-left')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line first:border-t-0">
              {r.map((v, i) => (
                <td key={i} className={cx('px-3 py-1.5 text-ink', al(i) === 'right' ? 'text-right' : 'text-left')}>
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
  frame: 'overflow-hidden rounded-[6px] border border-line',
  table: 'tnum w-full text-[12.5px]',
  thead: 'bg-well text-ink-2',
  th: 'border-b border-line px-3 py-2 text-left font-semibold whitespace-nowrap',
  thR: 'border-b border-line px-3 py-2 text-right font-semibold whitespace-nowrap',
  tr: 'border-t border-line first:border-t-0',
}
