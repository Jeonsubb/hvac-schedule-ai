import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../lib/format'

/** Brand mark for screens outside the app chrome (landing, sign-in, setup, occupant feedback). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#2f6fde" />
      <path d="M16 6.5 25.5 16 16 25.5 6.5 16z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M11.2 16h9.6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.1" fill="#9cc0f5" />
    </svg>
  )
}

export function Brand({ sub, size = 32 }: { sub?: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={size} />
      <span className="leading-tight">
        <span className="block text-[16px] font-bold tracking-[-0.02em] text-ink" translate="no">
          ThermoPlan
        </span>
        {sub && <span className="block text-[12.5px] text-ink-3">{sub}</span>}
      </span>
    </span>
  )
}

export function PublicHeader({ right, className }: { right?: ReactNode; className?: string }) {
  return (
    <header className={cx('mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-6', className)}>
      <Link to="/welcome" className="rounded-[10px]" aria-label="ThermoPlan 소개로 가기">
        <Brand />
      </Link>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  )
}

/** Small round avatar for the AI in conversational steps. */
export function AiAvatar({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-bg" style={{ width: size, height: size }} aria-hidden>
      <BrandMark size={Math.round(size * 0.62)} />
    </span>
  )
}

/** Sign-in / sign-up frame: a calm brand panel on the left, the form on the right. */
export function AuthLayout({ title, desc, children, aside }: { title: string; desc?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0f2a52] px-12 py-10 text-white lg:flex">
        <Link to="/welcome" className="rounded-[10px]" aria-label="ThermoPlan 소개로 가기">
          <span className="inline-flex items-center gap-2.5">
            <BrandMark size={34} />
            <span className="text-[17px] font-bold tracking-[-0.02em]" translate="no">
              ThermoPlan
            </span>
          </span>
        </Link>
        <div className="relative z-10 max-w-[30em]">
          {aside ?? (
            <>
              <p className="text-[30px] leading-[1.25] font-bold tracking-[-0.03em]">비용은 최소로, 쾌적은 그대로.</p>
              <p className="mt-4 text-[16px] leading-relaxed text-[#c2d3ee]">
                일정·날씨·재실·CO₂·민원 데이터로 냉난방 운전 계획을 매월·매주·매일 다시 만들고, 바뀐 데이터와 맞는지 검증합니다.
              </p>
            </>
          )}
        </div>
        <div className="text-[13px] text-[#9fb5d8]">시설 담당자 전용 콘솔</div>
        <svg className="pointer-events-none absolute -right-24 -bottom-24 opacity-30" width="420" height="420" viewBox="0 0 420 420" aria-hidden>
          <circle cx="210" cy="210" r="200" fill="none" stroke="#5b8de0" strokeWidth="1.5" />
          <circle cx="210" cy="210" r="140" fill="none" stroke="#5b8de0" strokeWidth="1.5" />
          <circle cx="210" cy="210" r="80" fill="none" stroke="#5b8de0" strokeWidth="1.5" />
        </svg>
      </aside>
      <main className="flex flex-col">
        <div className="flex h-16 items-center px-6 lg:hidden">
          <Link to="/welcome" aria-label="ThermoPlan 소개로 가기">
            <Brand />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[400px]">
            <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em] text-ink">{title}</h1>
            {desc && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{desc}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}
