import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CalendarRange,
  ShieldCheck,
  TrendingDown,
  Database,
  SlidersHorizontal,
  Sparkles,
  Thermometer,
  Clock,
  Building2,
  CloudSun,
} from 'lucide-react'
import { useMeta, useCopilot } from '../lib/context'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import Copilot from './Copilot'
import { ToastHost } from './ui'

const NAV = [
  { to: '/', label: '운영 현황', icon: LayoutDashboard, desc: '지금 건물 상태' },
  { to: '/schedule', label: '스케줄·타임라인', icon: CalendarRange, desc: '강의 vs 냉난방' },
  { to: '/validation', label: '정합성 검증', icon: ShieldCheck, desc: '계획·실행 확인' },
  { to: '/energy', label: '절감 효과', icon: TrendingDown, desc: '전략 비교' },
  { to: '/data', label: '일정·데이터', icon: Database, desc: '시간표·이벤트' },
  { to: '/settings', label: '운영 규칙', icon: SlidersHorizontal, desc: '설정·설비' },
]

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-white shadow-sm">
        <Thermometer size={19} strokeWidth={2.4} />
      </div>
      <div className="leading-tight">
        <div className="text-[16px] font-bold tracking-tight text-ink">ThermoPlan</div>
        <div className="text-[11px] text-ink-3">스케줄 기반 냉난방 자동 운영</div>
      </div>
    </div>
  )
}

function Sidebar() {
  const { meta } = useMeta()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-line bg-white lg:flex">
      <div className="px-5 pt-5 pb-4">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              cx(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                isActive ? 'bg-brand-50 text-brand' : 'text-ink-2 hover:bg-[#f6f6f3] hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                <div className="leading-tight">
                  <div className={cx('text-[13.5px]', isActive ? 'font-semibold' : 'font-medium')}>{n.label}</div>
                  <div className="text-[11px] text-ink-3">{n.desc}</div>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-lg border border-line bg-[#fafaf8] p-3 text-[11.5px] leading-relaxed text-ink-2">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-ink">
          <Building2 size={13} /> {meta ? `${meta.building.campus.replace('부산캠퍼스', '')} ${meta.building.name}` : '부산대학교 IT관'}
        </div>
        <div>3층·4층 강의실 {meta ? Object.keys(meta.rooms).length : 10}개 · 실외기 {meta ? Object.keys(meta.odus).length : 3}대</div>
        <div>
          {meta ? `${meta.semester.year}년 ${meta.semester.term} (${meta.semester.start.slice(5).replace('-', '/')}–${meta.semester.end.slice(5).replace('-', '/')})` : '2026년 2학기'}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-s-ai" />
          운영 전략: <b className="font-semibold text-ink">AI 예측 제어</b>
        </div>
      </div>
    </aside>
  )
}

const TITLES: Record<string, string> = {
  '/': '운영 현황',
  '/schedule': '스케줄·타임라인',
  '/validation': '정합성 검증',
  '/energy': '절감 효과',
  '/data': '일정·데이터',
  '/settings': '운영 규칙',
}

function TopBar() {
  const { meta } = useMeta()
  const { open, setOpen } = useCopilot()
  const loc = useLocation()
  const live = useApi<Live>('/api/live', { maxAgeMs: 60_000, refreshMs: 60_000 })
  const now = meta?.now
  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center justify-between gap-4 border-b border-line bg-white/90 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <span className="lg:hidden">
          <Thermometer size={20} className="text-brand" />
        </span>
        <span className="text-[15px] font-semibold whitespace-nowrap text-ink">{TITLES[loc.pathname] ?? 'ThermoPlan'}</span>
        <span className="hidden text-[12px] text-ink-3 xl:inline">부산대학교 IT관 시설 담당자용</span>
      </div>
      <div className="flex items-center gap-2.5">
        {now && (
          <div
            className="hidden h-8 items-center gap-2 rounded-lg border border-line bg-white px-2.5 text-[12.5px] sm:flex"
            title={now.reason}
          >
            <span className={cx('inline-block h-2 w-2 rounded-full', now.live ? 'pulse-dot bg-good' : 'bg-warn')} />
            <Clock size={13} className="text-ink-3" />
            <span className="tnum font-medium text-ink">
              {fmtDateK(now.date)} {fmtMin(now.minute)}
            </span>
            <span className={cx('text-[11.5px]', now.live ? 'text-good-ink' : 'text-warn-ink')}>{now.live ? '실시간' : '대체 기준'}</span>
          </div>
        )}
        {live.data && (
          <div className="hidden h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[12.5px] lg:flex" title={live.data.outdoor.src}>
            <CloudSun size={14} className="text-ink-3" />
            <span className="tnum font-medium">{live.data.outdoor.t.toFixed(1)}℃</span>
            <span className="text-ink-3">습도 {Math.round(live.data.outdoor.rh)}%</span>
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className={cx(
            'flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors',
            open ? 'bg-ink text-white' : 'bg-brand text-white hover:bg-[#0b5f58]',
          )}
        >
          <Sparkles size={15} />
          AI 코파일럿
        </button>
      </div>
    </header>
  )
}

function MobileNav() {
  return (
    <nav className="thin-scroll sticky top-[60px] z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-4 py-2 lg:hidden">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            cx(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap',
              isActive ? 'bg-brand-50 text-brand' : 'text-ink-2 hover:bg-[#f6f6f3]',
            )
          }
        >
          <n.icon size={15} />
          {n.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { open } = useCopilot()
  return (
    <div className="min-h-full">
      <Sidebar />
      <div className={cx('min-h-full transition-[padding] duration-200 lg:pl-[232px]', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        <main className="mx-auto max-w-[1680px] px-6 py-6">
          <Outlet />
        </main>
      </div>
      <Copilot />
      <ToastHost />
    </div>
  )
}
