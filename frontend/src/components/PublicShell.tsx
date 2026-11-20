import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '../lib/format'

/** The ON:D wordmark, drawn in type the same way as /welcome: heavy, tight, a blue colon. */
export function Wordmark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('ond-word', className)} style={{ fontSize: size }} translate="no">
      ON<i>:</i>D
    </span>
  )
}

/** Kept for older call sites: the wordmark at a given size. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return <Wordmark size={Math.round(size * 0.66)} />
}

export function Brand({ sub, size = 32 }: { sub?: string; size?: number }) {
  return (
    <span className="inline-flex items-baseline gap-3">
      <Wordmark size={Math.round(size * 0.7)} />
      {sub && <span className="text-[13px] font-medium text-ink-3">{sub}</span>}
    </span>
  )
}

export function PublicHeader({ right, className }: { right?: ReactNode; className?: string }) {
  return (
    <header className={cx('mx-auto flex h-[72px] w-full max-w-[1280px] items-center justify-between gap-4 px-6', className)}>
      <Link to="/welcome" className="rounded-[10px]" aria-label="ON:D 소개로 가기">
        <Brand />
      </Link>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  )
}

export type OndyPose = 'main' | 'schedule' | 'hvac' | 'comfort'

/** Ondy, the ON:D mascot from /welcome. Decorative: the words next to it carry the meaning. */
export function Ondy({ pose = 'main', size = 120, className, pop = false }: { pose?: OndyPose; size?: number; className?: string; pop?: boolean }) {
  return (
    <img
      src={`/assets/mascot/ondy-${pose}.png`}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      className={cx('pointer-events-none block h-auto shrink-0 select-none', pop && 'ondy-pop', className)}
    />
  )
}

/** Ondy's face in a circle: the avatar for the AI in conversational steps. */
export function AiAvatar({ size = 32 }: { size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 overflow-hidden rounded-full bg-well ring-1 ring-line" style={{ width: size, height: size }} aria-hidden>
      <img
        src="/assets/mascot/ondy-main.png"
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={{ width: size * 1.7, left: -size * 0.28, top: -size * 0.12 }}
      />
    </span>
  )
}

/**
 * Sign-in / sign-up frame in the landing's language: the left half is the closing frame of /welcome
 * (the wordmark, one line, Ondy on the faint ground grid); the form sits on plain white on the right.
 */
export function AuthLayout({ title, desc, children, aside }: { title: string; desc?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-full bg-surface lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-[#fafafb] px-12 py-10 lg:flex">
        <div className="ground-grid pointer-events-none absolute inset-0" aria-hidden />
        <Link to="/welcome" className="relative z-10 self-start rounded-[10px]" aria-label="ON:D 소개로 가기">
          <Wordmark size={24} />
        </Link>
        <div className="relative z-10">
          {aside ?? (
            <>
              <p className="display text-[clamp(38px,3.8vw,56px)]">
                <span className="rise-mask">
                  <span className="rise-line">필요한 시간에,</span>
                </span>
                <span className="rise-mask">
                  <span className="rise-line d1">필요한 공간만.</span>
                </span>
              </p>
              <p className="mt-6 max-w-[28em] text-[17px] leading-[1.6] text-ink-2">
                일정·날씨·재실·CO₂·쾌적 의견을 보고 냉난방 운전 계획을 매월·매주·매일 다시 만듭니다. 비용은 줄이고, 수업 중 쾌적은 그대로 지킵니다.
              </p>
            </>
          )}
        </div>
        <div className="relative z-10 flex items-end justify-between">
          <span className="text-[13px] text-ink-3">시설 담당자 전용 콘솔</span>
          <Ondy pose="main" size={132} pop className="-mb-2" />
        </div>
      </aside>
      <main className="flex flex-col">
        <div className="flex h-16 items-center px-6 lg:hidden">
          <Link to="/welcome" aria-label="ON:D 소개로 가기">
            <Wordmark size={22} />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-[420px]">
            <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.025em] text-ink">{title}</h1>
            {desc && <p className="mt-2 text-[15px] leading-[1.6] text-ink-2">{desc}</p>}
            <div className="mt-9">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}
