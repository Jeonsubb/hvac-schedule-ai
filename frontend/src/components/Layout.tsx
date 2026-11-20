import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { LayoutDashboard, CalendarRange, Sparkles, X, CloudSun, LogOut, BookOpenText, Settings as SettingsIcon } from 'lucide-react'
import { Wordmark } from './PublicShell'
import { useMeta, useCopilot } from '../lib/context'
import { useAuth } from '../lib/auth'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import { Popover, Spinner, ToastHost } from './ui'
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
      { to: '/comfort', label: '쾌적 의견' },
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
  {
    to: '/settings',
    label: '설정',
    icon: SettingsIcon,
    desc: '온도 범위와 운전 시간 등 운영 규칙 설정',
    tabs: [{ to: '/settings', label: '설정' }],
  },
]

export function groupOf(pathname: string) {
  return NAV_GROUPS.find((g) => g.tabs.some((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))) ?? NAV_GROUPS[0]
}

/** Kept for older call sites: the ON:D wordmark at a size. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return <Wordmark size={Math.round(size * 0.72)} />
}

export function Logo() {
  return <Wordmark size={24} />
}

/** The two sections as words, the way /welcome names its scenes; the live one carries the blue dot. */
function MainNav() {
  const loc = useLocation()
  const active = groupOf(loc.pathname)
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="주 메뉴">
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
              'inline-flex h-10 items-center gap-2 rounded-full px-4 text-[15px] leading-none transition-colors duration-200',
              on ? 'font-semibold text-ink' : 'font-medium text-ink-3 hover:bg-[rgb(12_14_19/0.05)] hover:text-ink',
            )}
          >
            <span className={cx('inline-block h-[7px] w-[7px] rounded-full transition-colors duration-200', on ? 'bg-brand' : 'bg-transparent')} aria-hidden />
            {n.label}
          </NavLink>
        )
      })}
    </nav>
  )
}

/** Tabs of the current section (the screens that used to be separate menu items). */
export function SectionTabs() {
  const loc = useLocation()
  const g = groupOf(loc.pathname)
  return (
    <nav className="thin-scroll flex min-w-0 overflow-x-auto" aria-label={`${g.label} 하위 화면`}>
      <div className="inline-flex shrink-0 gap-1">
        {g.tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cx(
                'inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[14px] whitespace-nowrap transition-[background-color,color] duration-200',
                isActive ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-3 hover:bg-[rgb(12_14_19/0.05)] hover:text-ink',
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

/** "11월 20일 (금) 12:04 | 18.8℃ (부산)" — the reference clock and outdoor air, one line in the account menu. */
function ClockLine() {
  const { meta } = useMeta()
  const live = useApi<Live>('/api/live', { maxAgeMs: 60_000, refreshMs: 60_000 })
  const now = meta?.now
  if (!now) return <span className="text-[13.5px] text-ink-3">기준 시각 확인 중…</span>
  const out = live.data?.outdoor
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]"
      title={now.live ? `실시간 기준 시각입니다.${out ? ` 지금 외기 ${out.t.toFixed(1)}℃, 습도 ${Math.round(out.rh)}% (${out.src})` : ''}` : now.reason}
    >
      {!now.live && <span className="font-semibold whitespace-nowrap text-warn-ink">대체 기준</span>}
      <span className="tnum font-semibold whitespace-nowrap text-ink">
        {fmtDateK(now.date)} {fmtMin(now.minute)}
      </span>
      {out && (
        <>
          <span className="h-3.5 w-px bg-line-strong" aria-hidden />
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink">
            <CloudSun size={16} className="text-ink-3" aria-hidden />
            <span className="sr-only">지금 외기</span>
            <span className="tnum font-semibold">{out.t.toFixed(1)}℃</span>
            <span className="text-ink-3">부산</span>
          </span>
        </>
      )}
    </div>
  )
}

/** The account: initial in a circle; the building, term and sign-out live behind it. */
function AccountMenu() {
  const { meta } = useMeta()
  const { user, logout } = useAuth()
  const tour = useTour()
  if (!user) return null
  const building = meta ? `${meta.building.campus.replace('부산캠퍼스', '').trim() || '부산대학교'} ${meta.building.name}` : '부산대학교 IT관'
  return (
    <Popover
      label="계정"
      align="end"
      width={260}
      buttonClassName="inline-flex h-10 w-10 items-center justify-center rounded-full bg-well text-[14px] font-bold text-ink ring-1 ring-line transition-colors duration-150 hover:bg-hover"
      button={
        <>
          <span aria-hidden>{user.name.trim().charAt(0) || 'O'}</span>
          <span className="sr-only">계정 메뉴 열기</span>
        </>
      }
    >
      <div className="text-[15px] leading-[1.35] font-semibold text-ink">{user.name}</div>
      <div className="text-[13px] leading-[1.5] text-ink-3">{user.id}</div>
      <div className="mt-3 border-t border-line pt-3 text-[13.5px] leading-relaxed">
        <div className="font-semibold text-ink-2">{building}</div>
        <div className="tnum text-ink-3">{meta ? `${meta.semester.year}년 ${meta.semester.term}` : '2026년 2학기'}</div>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <ClockLine />
        <SystemStatus />
      </div>
      <button
        type="button"
        onClick={() => tour.start(0)}
        className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-well text-[13.5px] font-semibold text-ink transition-colors hover:bg-hover"
      >
        <BookOpenText size={15} aria-hidden /> 화면 안내 보기
      </button>
      <button
        type="button"
        onClick={logout}
        className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-[rgb(12_14_19/0.18)] text-[13.5px] font-semibold text-ink transition-colors hover:border-[rgb(12_14_19/0.5)]"
      >
        <LogOut size={15} aria-hidden /> 로그아웃
      </button>
    </Popover>
  )
}

function TopBar() {
  const { open, setOpen } = useCopilot()
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur-md">
      <div className="flex h-[72px] items-center justify-between gap-4 px-[clamp(16px,3vw,40px)]">
        <div className="flex min-w-0 items-center gap-6">
          <NavLink to="/" className="rounded-[10px]" aria-label="ON:D 운전 현황으로">
            <Logo />
          </NavLink>
          <MainNav />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cx(
              'inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors duration-200',
              open ? 'border border-[rgb(12_14_19/0.18)] bg-surface text-ink hover:border-[rgb(12_14_19/0.5)]' : 'bg-ink text-white hover:bg-[#2a2e37]',
            )}
          >
            {open ? <X size={16} aria-hidden /> : <Sparkles size={16} className="text-[#8fb3f0]" aria-hidden />}
            {open ? '코파일럿 닫기' : 'AI 코파일럿'}
          </button>
          <AccountMenu />
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
    good: 'text-ink-2 hover:bg-[rgb(12_14_19/0.05)]',
    warn: 'bg-warn-bg text-warn-ink',
    crit: 'bg-crit-bg text-crit-ink',
    idle: 'text-ink-3',
  }[tone]
  const dot = { good: 'bg-good soft-ping', warn: 'bg-warn', crit: 'bg-crit', idle: 'bg-ink-4' }[tone]
  return (
    <div>
    <Popover
      label="시스템 상태"
      align="start"
      width={300}
      buttonClassName={cx('-ml-2.5 inline-flex h-8 items-center gap-2 rounded-full px-2.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150', pill)}
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
    <nav className="thin-scroll sticky top-[72px] z-20 flex gap-1 overflow-x-auto border-b border-line bg-white/90 px-4 py-2 backdrop-blur-md lg:hidden" aria-label="주 메뉴">
      {NAV_GROUPS.flatMap((g) =>
        g.tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-medium whitespace-nowrap',
                isActive ? 'bg-ink font-semibold text-white' : active === g ? 'text-ink-2 hover:bg-hover' : 'text-ink-3 hover:bg-hover',
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
      <div className={cx('min-h-full', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        {/* the dashboard draws its own tabs in its header; one-tab sections need none */}
        {loc.pathname !== '/' && groupOf(loc.pathname).tabs.length > 1 && (
          <div className="mx-auto hidden max-w-[1360px] px-[clamp(16px,3vw,40px)] pt-6 lg:block">
            <SectionTabs />
          </div>
        )}
        <main id="main" className="mx-auto max-w-[1360px] px-[clamp(16px,3vw,40px)] pt-8 pb-24">
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
          <ErrorBoundary area="AI 코파일럿 패널" wrapClassName="fixed top-0 right-0 bottom-0 z-40 w-[440px] max-w-[100vw] overflow-y-auto border-l border-line bg-[#fafafb] p-4">
            <Copilot />
          </ErrorBoundary>
        </Suspense>
      )}
      <TourOverlay />
      <ToastHost />
    </div>
  )
}
