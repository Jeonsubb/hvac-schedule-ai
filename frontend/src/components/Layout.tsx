import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { LayoutDashboard, CalendarRange, Sparkles, X, CloudSun, LogOut, BookOpenText } from 'lucide-react'
import { useMeta, useCopilot } from '../lib/context'
import { useAuth } from '../lib/auth'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import { Popover, Spinner, ToastHost } from './ui'
import ModeSwitch from './ModeSwitch'
import TourOverlay from './TourOverlay'
import { useTour } from '../lib/tour'

const Copilot = lazy(() => import('./Copilot'))

/** Two sections only (v5): the other screens live as tabs inside them. */
export const NAV_GROUPS = [
  {
    to: '/',
    label: '운전 현황',
    icon: LayoutDashboard,
    desc: '지금 건물 상태, 절감 효과, 쾌적 의견, 운영 규칙',
    tabs: [
      { to: '/', label: '현황' },
      { to: '/energy', label: '절감 효과' },
      { to: '/comfort', label: '쾌적 의견' },
      { to: '/settings', label: '운영 규칙' },
    ],
  },
  {
    to: '/schedule',
    label: '스케줄 타임라인',
    icon: CalendarRange,
    desc: '운전 타임라인, AI 1·2·3차 스케줄, 정합성 검증, 일정·데이터',
    tabs: [
      { to: '/schedule', label: '타임라인' },
      { to: '/plan', label: 'AI 스케줄링' },
      { to: '/validation', label: '정합성 검증' },
      { to: '/data', label: '일정·데이터' },
    ],
  },
]

export function groupOf(pathname: string) {
  return NAV_GROUPS.find((g) => g.tabs.some((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))) ?? NAV_GROUPS[0]
}

/** Mark (v5): a blue disc with two floor slabs (4F warm, 3F cool), the same drawing as the building plan. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="16" fill="#2f6fde" />
      <path d="M7.5 20.6h12.2l5-4.1H12.5z" fill="#cfe0fb" />
      <path d="M7.5 20.6h12.2v2H7.5z" fill="#9dbdf2" />
      <path d="M7.5 13.6h12.2l5-4.1H12.5z" fill="#ffffff" />
      <path d="M7.5 13.6h12.2v2H7.5z" fill="#f2a477" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={34} />
      <div className="text-[17px] font-bold tracking-[-0.02em] text-brand" translate="no">
        ThermoPlan
      </div>
    </div>
  )
}

function Sidebar() {
  const { meta } = useMeta()
  const { user, logout } = useAuth()
  const loc = useLocation()
  const active = groupOf(loc.pathname)
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col border-r border-line bg-surface lg:flex">
      <div className="px-6 pt-7 pb-10">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1" aria-label="주 메뉴">
        {NAV_GROUPS.map((n) => {
          const on = active === n
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              title={n.desc}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'relative flex h-11 items-center gap-3 px-6 text-[15px] transition-colors duration-150',
                on ? 'font-semibold text-brand' : 'font-medium text-ink-3 hover:text-ink',
              )}
            >
              <n.icon size={19} strokeWidth={on ? 2.3 : 1.9} className={on ? 'text-brand' : 'text-ink-4'} aria-hidden />
              {n.label}
              {/* active marker sits on the sidebar's hairline, as in the mock */}
              {on && <span className="absolute top-1.5 right-[-1px] bottom-1.5 w-[3px] rounded-l-full bg-brand" aria-hidden />}
            </NavLink>
          )
        })}
      </nav>
      <div className="space-y-4 px-6 pb-6">
        <div className="text-[13px] leading-relaxed text-ink-3">
          <div className="font-medium text-ink-2">{meta ? `${meta.building.campus.replace('부산캠퍼스', '').trim() || '부산대학교'} ${meta.building.name}` : '부산대학교 IT관'}</div>
          <div className="tnum">{meta ? `${meta.semester.year}년 ${meta.semester.term}` : '2026년 2학기'}</div>
        </div>
        {user && (
          <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold text-ink">{user.name}</div>
              <div className="truncate text-[12.5px] text-ink-3">{user.id}</div>
            </div>
            <button
              type="button"
              onClick={logout}
              aria-label="로그아웃"
              title="로그아웃"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-colors duration-150 hover:bg-hover hover:text-ink"
            >
              <LogOut size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

/** Tabs of the current section (the screens that used to be separate menu items). */
function SectionTabs() {
  const loc = useLocation()
  const g = groupOf(loc.pathname)
  return (
    <nav className="thin-scroll flex min-w-0 overflow-x-auto" aria-label={`${g.label} 하위 화면`}>
      <div className="inline-flex shrink-0 gap-0.5 rounded-full bg-[#edf1f7] p-1">
        {g.tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cx(
                'inline-flex h-8 shrink-0 items-center rounded-full px-4 text-[14px] whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
                isActive
                  ? 'bg-surface font-semibold text-brand-ink shadow-[0_1px_2px_rgb(20_32_51/0.08),0_0_0_1px_rgb(20_32_51/0.05)]'
                  : 'font-medium text-ink-3 hover:text-ink',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** "11월 20일 (금) 12:04 | 18.8℃ (부산)" — the reference clock and outdoor air, as one quiet pill. */
function ClockPill() {
  const { meta } = useMeta()
  const live = useApi<Live>('/api/live', { maxAgeMs: 60_000, refreshMs: 60_000 })
  const now = meta?.now
  if (!now) return <span className="hidden h-9 items-center rounded-[10px] bg-[#edf1f7] px-3.5 text-[13.5px] text-ink-3 xl:inline-flex">기준 시각 확인 중…</span>
  const out = live.data?.outdoor
  return (
    <div
      className="hidden h-9 items-center gap-3 rounded-[10px] bg-[#edf1f7] px-3.5 text-[13.5px] xl:inline-flex"
      title={now.live ? `실시간 기준 시각입니다.${out ? ` 지금 외기 ${out.t.toFixed(1)}℃, 습도 ${Math.round(out.rh)}% (${out.src})` : ''}` : now.reason}
    >
      {!now.live && <span className="font-semibold whitespace-nowrap text-warn-ink">대체 기준</span>}
      <span className="tnum font-medium whitespace-nowrap text-ink">
        {fmtDateK(now.date)} {fmtMin(now.minute)}
      </span>
      {out && (
        <>
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
            <CloudSun size={16} className="text-ink-3" aria-hidden />
            <span className="sr-only">지금 외기</span>
            <span className="tnum font-medium">{out.t.toFixed(1)}℃</span>
            <span className="text-ink-3">(부산)</span>
          </span>
        </>
      )}
    </div>
  )
}

function TopBar() {
  const { open, setOpen } = useCopilot()
  const tour = useTour()
  const loc = useLocation()
  const g = groupOf(loc.pathname)
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-paper/90 backdrop-blur-md">
      <div className="flex h-[68px] items-center justify-between gap-4 px-8">
        <div className="flex min-w-0 items-center gap-4">
          <span className="lg:hidden">
            <LogoMark size={30} />
          </span>
          {/* section name, like the mock's page title; the section's screens are the tabs below */}
          <div className="hidden truncate text-[20px] font-bold tracking-[-0.02em] text-ink lg:block">{g.label}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => tour.start(0)}
            title="화면을 챕터별로 하나씩 안내합니다"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 text-[13.5px] font-semibold text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink"
          >
            <BookOpenText size={15} aria-hidden /> 챕터로 보기
          </button>
          <ModeSwitch />
          <SystemStatus />
          <ClockPill />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cx(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3.5 text-[14px] font-semibold transition-colors duration-150',
              open ? 'border border-line-strong bg-surface text-ink hover:bg-hover' : 'bg-brand text-white hover:bg-brand-ink',
            )}
          >
            {open ? <X size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
            {open ? '코파일럿 닫기' : 'AI 코파일럿'}
          </button>
        </div>
      </div>
    </header>
  )
}

function shortTs(ts?: string | null) {
  if (!ts) return null
  const m = ts.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}` : ts
}

/**
 * The status pill: green "시스템 정상 운영 중" while the server answers and AI/storage are fine,
 * amber when AI calls fail or storage fell back, red when the server is unreachable. Opens the details.
 */
function SystemStatus() {
  const { meta, error: metaError } = useMeta()
  const ai = meta?.ai
  const st = meta?.storage
  const fallback = st?.mode === 'local-fallback'
  const okAt = shortTs(ai?.last_ok)
  const errAt = shortTs(ai?.last_error)
  // ok === null/undefined means no AI call has been made since the server started: not a failure
  const unknown = ai == null || ai.ok == null
  const bad = !!ai && !unknown && !ai.ok
  const down = !meta && !!metaError
  const tone: 'good' | 'warn' | 'crit' | 'idle' = down ? 'crit' : !meta ? 'idle' : bad || fallback ? 'warn' : 'good'
  const label = down ? '서버 연결 끊김' : !meta ? '상태 확인 중' : bad ? 'AI 연결 불안정' : fallback ? '저장소 대체 모드' : '시스템 정상 운영 중'
  const pill = {
    good: 'bg-good-bg text-good-ink',
    warn: 'bg-warn-bg text-warn-ink',
    crit: 'bg-crit-bg text-crit-ink',
    idle: 'bg-[#edf1f7] text-ink-3',
  }[tone]
  const dot = { good: 'bg-good soft-ping', warn: 'bg-warn', crit: 'bg-crit', idle: 'bg-ink-4' }[tone]
  return (
    <div className="hidden md:block">
    <Popover
      label="시스템 상태"
      align="end"
      width={300}
      buttonClassName={cx('inline-flex h-9 items-center gap-2 rounded-[10px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap transition-[filter] duration-150 hover:brightness-[0.97]', pill)}
      button={
        <>
          <span className={cx('inline-block h-2 w-2 rounded-full', dot)} aria-hidden />
          {label}
        </>
      }
    >
      <div className="space-y-3">
        {down && (
          <div>
            <div className="text-[14px] font-semibold text-crit-ink">서버 연결 끊김</div>
            <div className="mt-0.5 text-[13.5px] break-all">{metaError?.message}</div>
          </div>
        )}
        <div>
          <div className="text-[14px] font-semibold text-ink">AI 연결 (Bedrock)</div>
          <div className="mt-0.5 text-[13.5px]">
            {!ai
              ? '상태 정보가 없습니다.'
              : unknown
                ? '서버가 시작된 뒤 아직 AI를 호출하지 않았습니다. 첫 호출 결과로 상태가 표시됩니다.'
                : ai.ok
                  ? `정상입니다. 마지막 성공 ${okAt ?? '기록 없음'}`
                  : `호출이 실패하고 있습니다${errAt ? ` (${errAt})` : ''}. ${okAt ? `마지막 성공 ${okAt}. ` : ''}코파일럿은 같은 질문의 이전 답을 보여 줄 수 있습니다.`}
          </div>
          {bad && ai?.error && <div className="mt-1 text-[13px] break-all text-ink-3">{ai.error}</div>}
        </div>
        <div className="border-t border-line pt-3">
          <div className="text-[14px] font-semibold text-ink">데이터 저장소</div>
          <div className="mt-0.5 text-[13.5px]">
            {fallback
              ? `대체 모드: AWS 저장소에 연결하지 못해 서버 임시 저장소를 쓰고 있습니다. 변경 내용이 서버 재시작 때 사라질 수 있습니다.${st?.last_error ? ` (${st.last_error})` : ''}`
              : `정상 (${st?.mode ?? '알 수 없음'})`}
          </div>
        </div>
        {meta?.now && (
          <div className="border-t border-line pt-3">
            <div className="text-[14px] font-semibold text-ink">기준 시각</div>
            <div className="tnum mt-0.5 text-[13.5px]">
              {fmtDateK(meta.now.date)} {fmtMin(meta.now.minute)} {meta.now.live ? '(실시간)' : `(${meta.now.reason})`}
            </div>
          </div>
        )}
      </div>
    </Popover>
    </div>
  )
}

function MobileNav() {
  const loc = useLocation()
  const active = groupOf(loc.pathname)
  return (
    <nav className="thin-scroll sticky top-[68px] z-20 flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 lg:hidden" aria-label="주 메뉴">
      {NAV_GROUPS.flatMap((g) =>
        g.tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium whitespace-nowrap',
                isActive ? 'bg-brand-bg text-brand-ink' : active === g ? 'text-ink-2 hover:bg-hover' : 'text-ink-3 hover:bg-hover',
              )
            }
          >
            {t.to === g.to && <g.icon size={15} aria-hidden />}
            {t.label}
          </NavLink>
        )),
      )}
    </nav>
  )
}

export default function Layout() {
  const tour = useTour()
  const { user } = useAuth()
  // the demo account sees the chapter tour once, on its first visit (the full screens are dense)
  useEffect(() => {
    if (user?.id === '부산대학교' && !tour.seen()) tour.start(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
  const { open } = useCopilot()
  const loc = useLocation()
  // load the copilot (markdown renderer, cards) the first time it is opened, then keep it mounted
  const [loaded, setLoaded] = useState(open)
  useEffect(() => {
    if (open) setLoaded(true)
  }, [open])
  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-[10px] focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        본문으로 건너뛰기
      </a>
      <Sidebar />
      <div className={cx('min-h-full lg:pl-[220px]', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        <div className="mx-auto hidden max-w-[1480px] px-8 pt-6 lg:block">
          <SectionTabs />
        </div>
        <main id="main" className="mx-auto max-w-[1480px] px-8 pt-6 pb-20">
          {/* keyed by route: moving to another screen clears a crashed page */}
          <ErrorBoundary key={loc.pathname} area="이 화면">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {loaded && (
        <Suspense
          fallback={
            <div className="fixed top-0 right-0 bottom-0 z-40 flex w-[440px] max-w-[100vw] items-center justify-center border-l border-line bg-surface text-[14px] text-ink-3">
              <Spinner /> <span className="ml-2">코파일럿을 여는 중…</span>
            </div>
          }
        >
          <ErrorBoundary area="AI 코파일럿 패널" wrapClassName="fixed top-0 right-0 bottom-0 z-40 w-[440px] max-w-[100vw] overflow-y-auto border-l border-line bg-paper p-4">
            <Copilot />
          </ErrorBoundary>
        </Suspense>
      )}
      <TourOverlay />
      <ToastHost />
    </div>
  )
}
