import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Table2, BarChart3, Wrench, X, Info } from 'lucide-react'
import { cx } from '../lib/format'
import { GROUP_META, STRATEGY, type StatusGroup } from '../lib/constants'
import type { StrategyKey } from '../lib/types'

// ---------------------------------------------------------------- layout primitives

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(11,11,11,0.04)]', pad && 'p-5', className)}>
      {children}
    </section>
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
    <div className={cx('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          {icon && <span className="text-ink-2">{icon}</span>}
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-ink-3">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  )
}

export function PageHeader({ title, desc, right }: { title: string; desc?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight text-ink">{title}</h1>
        {desc && <p className="mt-1 text-[13px] text-ink-2">{desc}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- figures

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
}: {
  label: string
  value: ReactNode
  unit?: string
  delta?: ReactNode
  deltaGood?: boolean | null
  sub?: ReactNode
  accent?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('relative rounded-xl border border-line bg-white px-4 py-3.5', className)}>
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        {accent && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: accent }} />}
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[26px] font-semibold leading-none tracking-tight text-ink">{value}</span>
        {unit && <span className="text-[13px] font-medium text-ink-3">{unit}</span>}
      </div>
      {(delta || sub) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
          {delta && (
            <span
              className={cx(
                'font-semibold',
                deltaGood === true && 'text-good-ink',
                deltaGood === false && 'text-crit-ink',
                deltaGood == null && 'text-ink-2',
              )}
            >
              {delta}
            </span>
          )}
          {sub && <span className="text-ink-3">{sub}</span>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- badges

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode
  tone?: 'neutral' | 'brand' | 'good' | 'warn' | 'crit' | 'info' | 'event' | 'outline'
  className?: string
  title?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[#f0efec] text-ink-2',
    brand: 'bg-brand-50 text-brand',
    good: 'bg-[#ecf8ec] text-good-ink',
    warn: 'bg-[#fff6e0] text-warn-ink',
    crit: 'bg-[#fdeeee] text-crit-ink',
    info: 'bg-[#eaf2fc] text-[#1c5cab]',
    event: 'bg-[#efedfb] text-[#4a3aa7]',
    outline: 'border border-line text-ink-2 bg-white',
  }
  return (
    <span
      title={title}
      className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium', tones[tone], className)}
    >
      {children}
    </span>
  )
}

export function GroupIcon({ group, size = 14 }: { group: StatusGroup; size?: number }) {
  const c = GROUP_META[group].color
  if (group === 'normal') return <CheckCircle2 size={size} color={c} strokeWidth={2.4} />
  if (group === 'auto') return <Wrench size={size} color="#c98500" strokeWidth={2.4} />
  return <AlertTriangle size={size} color={c} strokeWidth={2.4} />
}

export function StatusBadge({ group, label }: { group: StatusGroup; label?: string }) {
  const m = GROUP_META[group]
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: m.bg, color: m.ink }}
    >
      <GroupIcon group={group} size={12} />
      {label ?? m.label}
    </span>
  )
}

export function StrategySwatch({ k, line = false }: { k: StrategyKey; line?: boolean }) {
  return line ? (
    <span className="inline-block h-[3px] w-3.5 rounded-full" style={{ background: STRATEGY[k].color }} />
  ) : (
    <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: STRATEGY[k].color }} />
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

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
}) {
  const v: Record<string, string> = {
    primary: 'bg-brand text-white hover:bg-[#0b5f58] border border-brand',
    secondary: 'bg-white text-ink border border-[#dcdbd4] hover:bg-[#f6f6f3]',
    ghost: 'bg-transparent text-ink-2 hover:bg-[#f0efec] border border-transparent',
    danger: 'bg-white text-crit-ink border border-[#f1c9c9] hover:bg-[#fdeeee]',
  }
  const s = size === 'sm' ? 'h-7 px-2.5 text-[12.5px] gap-1' : 'h-9 px-3.5 text-[13px] gap-1.5'
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        v[variant],
        s,
        className,
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
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-[#dcdbd4] bg-[#f6f6f3] p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          title={o.title}
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-7.5 px-3 text-[12.5px]',
            o.value === value ? 'bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
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
    <div className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors',
            t.value === value ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && (
            <span className="rounded-full bg-[#f0efec] px-1.5 text-[11px] font-semibold text-ink-2">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-3">{hint}</span>}
    </label>
  )
}

export const inputBase =
  'h-9 rounded-lg border border-[#dcdbd4] bg-white px-2.5 text-[13px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15 disabled:bg-[#f6f6f3]'

export const inputCls = `${inputBase} w-full`

// ---------------------------------------------------------------- states

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-ink-3', className)} />
}

export function Loading({ label = '불러오는 중…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-[13px] text-ink-3', className)}>
      <Spinner />
      {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[#f1c9c9] bg-[#fdf6f6] px-4 py-3 text-[13px] text-crit-ink">
      <span className="flex items-center gap-2">
        <AlertTriangle size={15} />
        {typeof error === 'string' ? error : error.message || '요청을 처리하지 못했습니다.'}
      </span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  )
}

export function Empty({ title, desc, icon }: { title: string; desc?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
      <div className="text-ink-3">{icon ?? <Info size={20} />}</div>
      <div className="text-[13.5px] font-medium text-ink-2">{title}</div>
      {desc && <div className="max-w-sm text-[12.5px] text-ink-3">{desc}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- overlays

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
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40">
      <div className="fade-in absolute inset-0 bg-black/25" onClick={onClose} />
      <aside
        className="slide-in absolute top-0 right-0 flex h-full max-w-[96vw] flex-col bg-page shadow-2xl"
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-ink">{title}</div>
            {sub && <div className="mt-0.5 text-[12.5px] text-ink-3">{sub}</div>}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <button onClick={onClose} className="rounded-md p-1.5 text-ink-3 hover:bg-[#f0efec] hover:text-ink" aria-label="닫기">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="thin-scroll flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
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
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fade-in absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="fade-in relative max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl" style={{ width }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-[15px] font-semibold">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-[#f0efec]" aria-label="닫기">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
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
      window.setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), 3800)
    }
    return () => {
      pushToast = null
    }
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            'fade-in pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium shadow-lg',
            t.tone === 'good' && 'bg-[#0b0b0b] text-white',
            t.tone === 'crit' && 'bg-crit text-white',
            t.tone === 'neutral' && 'bg-white text-ink',
          )}
        >
          {t.tone === 'good' ? <CheckCircle2 size={15} /> : t.tone === 'crit' ? <AlertTriangle size={15} /> : <Info size={15} />}
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
                className="inline-flex h-7 items-center gap-1 rounded-md border border-[#dcdbd4] px-2 text-[12px] text-ink-2 hover:bg-[#f6f6f3]"
                title={asTable ? '차트로 보기' : '표로 보기'}
              >
                {asTable ? <BarChart3 size={13} /> : <Table2 size={13} />}
                {asTable ? '차트' : '표'}
              </button>
            )}
          </>
        }
      />
      {legend && !asTable && <div className="-mt-2 mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">{legend}</div>}
      {asTable && table ? <DataTable spec={table} /> : children}
      {footer}
    </Card>
  )
}

export function DataTable({ spec, maxHeight = 360 }: { spec: TableSpec; maxHeight?: number }) {
  return (
    <div className="thin-scroll overflow-auto rounded-lg border border-line" style={{ maxHeight }}>
      <table className="tnum w-full text-[12.5px]">
        <thead className="sticky top-0 bg-[#f6f6f3]">
          <tr>
            {spec.columns.map((c, i) => (
              <th
                key={c}
                className={cx('px-3 py-2 font-semibold text-ink-2', (spec.align?.[i] ?? (i === 0 ? 'left' : 'right')) === 'right' ? 'text-right' : 'text-left')}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.rows.map((r, ri) => (
            <tr key={ri} className="border-t border-line">
              {r.map((v, i) => (
                <td
                  key={i}
                  className={cx('px-3 py-1.5 text-ink', (spec.align?.[i] ?? (i === 0 ? 'left' : 'right')) === 'right' ? 'text-right' : 'text-left')}
                >
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
      {kind === 'line' && <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: color }} />}
      {kind === 'rect' && <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />}
      {kind === 'dot' && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
      {kind === 'wash' && <span className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: color }} />}
      {label}
    </span>
  )
}
