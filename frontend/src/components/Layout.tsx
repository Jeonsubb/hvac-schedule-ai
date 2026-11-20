import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { AudioLines, LayoutDashboard, CalendarRange, MessageCircle, Sparkles, X, CloudSun, LogOut, BookOpenText, ChevronRight, ChevronsLeft, ChevronsRight, Settings as SettingsIcon } from 'lucide-react'
import { Wordmark } from './PublicShell'
import { useMeta, useCopilot, useDay } from '../lib/context'
import { useAuth } from '../lib/auth'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import { Popover, Spinner, ToastHost } from './ui'
import TourOverlay from './TourOverlay'
import { useTour } from '../lib/tour'
import VoiceDock from './voice/VoiceDock'

const Copilot = lazy(() => import('./Copilot'))

/** Three sections in the order of the work: see the day, change the timetable, let the agents review it. */
export const NAV_GROUPS = [
  {
    to: '/overview',
    label: '운영 현황',
    icon: LayoutDashboard,
    desc: '선택한 날짜의 전체 운전계획과 예상 효과',
    tabs: [
      { to: '/overview', label: '현황' },
      { to: '/energy', label: '절감 효과' },
      { to: '/comfort', label: '쾌적 의견' },
    ],
  },
  {
    to: '/data',
    label: '일정 관리',
    icon: CalendarRange,
    desc: '시간표 업로드, 특별 일정 등록, 달력',
    tabs: [
      { to: '/data', label: '시간표·일정' },
      { to: '/schedule', label: '달력' },
      { to: '/validation', label: '정합성 검증' },
    ],
  },
  {
    to: '/plan',
    label: 'AI 최적화',
    icon: Sparkles,
    desc: '비용·쾌적 Agent의 설정온도 협의와 협의 전후 비교',
    tabs: [{ to: '/plan', label: 'AI 최적화' }],
  },
  {
    to: '/settings',
    label: '설정',
    icon: SettingsIcon,
    desc: '온도 범위와 운전 시간 등 운영 규칙 설정',
    tabs: [{ to: '/settings', label: '설정' }],
  },
]

/** 온디 (voice): not in the menu; the ON:D logo opens it */
const HOME_GROUP = { to: '/', label: '온디', icon: AudioLines, desc: '말로 묻고, 답과 데이터를 보고, 화면으로 이동', tabs: [{ to: '/', label: '온디' }] }

export function groupOf(pathname: string) {
  if (pathname === '/') return HOME_GROUP
  return NAV_GROUPS.find((g) => g.tabs.some((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))) ?? NAV_GROUPS[0]
}

/** Kept for older call sites: the ON:D wordmark at a size. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return <Wordmark size={Math.round(size * 0.72)} />
}

export function Logo() {
  return <Wordmark size={24} />
}

const SIDE_KEY = 'ond.sidebar.collapsed'

function tabOn(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * The whole service in one column: every screen is one click away, and the section names say what the
 * product does (see the day, manage the timetable, let the AI review it). Collapses to an icon rail.
 * SEED side-navigation anatomy: 40px rows, r2 corners, neutral-weak fill for the current screen.
 */
function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const loc = useLocation()
  const active = groupOf(loc.pathname)
  const { meta } = useMeta()
  const building = meta ? `${meta.building.campus.replace('부산캠퍼스', '').trim() || '부산대학교'} ${meta.building.name}` : '부산대학교 IT관'
  const row = (on: boolean) =>
    cx(
      'nav-row ond-press relative flex h-9 items-center gap-2.5 rounded-[7px] px-3 text-[14px] leading-none transition-colors duration-200',
      on ? 'is-on bg-[#eef0f3] font-semibold text-ink' : 'font-medium text-ink-2 hover:bg-[#f1f2f4] hover:text-ink',
    )
  return (
    <aside
      className={cx('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-[#fafbfc] transition-[width] duration-200 ease-out lg:flex', collapsed ? 'w-[76px]' : 'w-[224px]')}
    >
      <div className={cx('flex h-16 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between pr-3 pl-5')}>
        <NavLink to="/" className="rounded-[10px]" aria-label="온디에게 말로 묻기" title="온디에게 말로 묻기">
          <Wordmark size={collapsed ? 15 : 22} />
        </NavLink>
        {!collapsed && (
          <button type="button" onClick={onToggle} aria-expanded className="ond-press inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink" title="메뉴 접기">
            <ChevronsLeft size={17} aria-hidden />
            <span className="sr-only">메뉴 접기</span>
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="mx-5 mt-2 mb-5 border-b border-line pb-5 text-[12px] leading-[1.5]">
          <div className="text-[13px] font-semibold text-ink">{building}</div>
          <div className="tnum mt-1 text-ink-3">
            {meta ? `${meta.semester.year}년 ${meta.semester.term}` : '2026년 2학기'} · 강의실 {meta ? Object.keys(meta.rooms).length : 10}곳
          </div>
        </div>
      )}
      <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4" aria-label="주 메뉴">
        {collapsed ? (
          <ul className="space-y-1">
            {NAV_GROUPS.map((g) => {
              const on = active === g
              return (
                <li key={g.to}>
                  <NavLink
                    to={g.to}
                    end={g.to === '/'}
                    title={`${g.label}: ${g.desc}`}
                    aria-current={on ? 'page' : undefined}
                    className={cx(
                      'ond-press flex flex-col items-center gap-1.5 rounded-[8px] px-1 py-2.5 text-[11px] leading-none whitespace-nowrap transition-colors duration-200',
                      on ? 'bg-[#eef0f3] font-semibold text-ink' : 'font-medium text-ink-3 hover:bg-[#f1f2f4] hover:text-ink',
                    )}
                  >
                    <g.icon size={20} strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                    {g.label}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        ) : (
          NAV_GROUPS.map((g) =>
            g.tabs.length === 1 ? (
              <NavLink key={g.to} to={g.to} end={g.to === '/'} title={g.desc} className={cx(row(active === g), 'mt-1')}>
                <g.icon size={18} strokeWidth={active === g ? 2.2 : 1.8} className={active === g ? 'text-ink' : 'text-ink-3'} aria-hidden />
                {g.label}
              </NavLink>
            ) : (
              <div key={g.to} className="mt-5 first:mt-1" role="group" aria-label={g.label}>
                <div className="mb-1 flex items-center gap-2.5 px-3 text-[12px] font-semibold tracking-[0.01em] text-ink-3" title={g.desc}>
                  <g.icon size={18} strokeWidth={active === g ? 2.2 : 1.8} className={active === g ? 'text-ink' : 'text-ink-4'} aria-hidden />
                  {g.label}
                </div>
                <ul className="space-y-0.5">
                  {g.tabs.map((t) => {
                    const on = tabOn(loc.pathname, t.to)
                    return (
                      <li key={t.to}>
                        <NavLink to={t.to} end={t.to === '/'} aria-current={on ? 'page' : undefined} className={cx(row(on), 'pl-[40px]')}>
                          {t.label}
                        </NavLink>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ),
          )
        )}
      </nav>
      {collapsed && (
        <div className="shrink-0 px-2 pb-2">
          <button type="button" onClick={onToggle} aria-expanded={false} className="ond-press inline-flex h-9 w-full items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover hover:text-ink" title="메뉴 펼치기">
            <ChevronsRight size={17} aria-hidden />
            <span className="sr-only">메뉴 펼치기</span>
          </button>
        </div>
      )}
      {/* the voice orb (헤이 온디) docks in this corner on every screen */}
      <div className="h-[76px] shrink-0" aria-hidden />
    </aside>
  )
}

/** Where this screen sits in the service: section › screen. */
function Crumbs() {
  const loc = useLocation()
  const { meta } = useMeta()
  const g = groupOf(loc.pathname)
  const t = g.tabs.find((x) => tabOn(loc.pathname, x.to))
  const leaf = t && (g.tabs.length > 1 || t.label !== g.label) ? t.label : null
  if (loc.pathname === '/overview') {
    return (
      <nav className="hidden min-w-0 items-center gap-2 text-[13px] sm:flex" aria-label="현재 위치">
        <span className="shrink-0 text-ink-3">워크스페이스</span>
        <span className="text-ink-4" aria-hidden>/</span>
        <span className="truncate font-medium text-ink-2">{meta?.building.name ?? 'IT관'}</span>
      </nav>
    )
  }
  return (
    <nav className="hidden min-w-0 items-center gap-1.5 text-[14px] sm:flex" aria-label="현재 위치">
      <span className="font-medium whitespace-nowrap text-ink-3">ON:D</span>
      <ChevronRight size={14} className="shrink-0 text-ink-4" aria-hidden />
      <span className={cx('whitespace-nowrap', leaf ? 'font-medium text-ink-3' : 'font-semibold text-ink')}>{g.label}</span>
      {leaf && (
        <>
          <ChevronRight size={14} className="shrink-0 text-ink-4" aria-hidden />
          <span className="truncate font-semibold text-ink">{leaf}</span>
        </>
      )}
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

/** The reference date of every screen, and a standing reminder that all building values are simulated. */
function DayPicker() {
  const { meta } = useMeta()
  const { date, setDate } = useDay()
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="ond-date">
        기준 날짜
      </label>
      <input
        id="ond-date"
        type="date"
        className="tnum h-10 max-w-[150px] rounded-[8px] border border-stroke-neutral-weak bg-surface px-3 text-[14px] font-medium text-ink sm:max-w-none sm:px-3.5"
        value={date ?? ''}
        min={meta?.semester.start}
        max={meta?.semester.end}
        onChange={(e) => e.target.value && setDate(e.target.value)}
        title="모든 화면의 기준 날짜입니다. 수업이 있는 평일을 고르세요."
      />
      <span
        className="hidden min-h-6 items-center rounded-[6px] bg-well px-2 text-[12px] leading-[16px] font-semibold whitespace-nowrap text-ink-2 md:inline-flex"
        title="실내온도·CO₂·PMV·전력·냉난방 운전은 모두 시뮬레이션 또는 추정값입니다. 실제 건물 센서나 냉난방 설비와 연결되어 있지 않습니다."
      >
        시뮬레이션
      </span>
    </div>
  )
}

function TopBar() {
  const { open, setOpen } = useCopilot()
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-7">
        <div className="flex min-w-0 items-center gap-4">
          <NavLink to="/" className="rounded-[10px] lg:hidden" aria-label="온디에게 말로 묻기" title="온디에게 말로 묻기">
            <Logo />
          </NavLink>
          <Crumbs />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DayPicker />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className={cx(
              'ond-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[8px] border px-3 text-[13px] font-medium',
              open ? 'border-line-strong bg-well text-ink hover:bg-hover' : 'border-transparent text-ink-2 hover:border-line hover:bg-hover hover:text-ink',
            )}
          >
            {open ? <X size={16} aria-hidden /> : <MessageCircle size={16} aria-hidden />}
            <span className="max-sm:sr-only">{open ? '도우미 닫기' : 'AI 도우미'}</span>
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
    <nav className="thin-scroll sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 lg:hidden" aria-label="주 메뉴">
      {NAV_GROUPS.flatMap((g) =>
        g.tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cx(
                'flex shrink-0 items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
                isActive ? 'bg-[#eef0f3] font-semibold text-ink' : active === g ? 'text-ink-2 hover:bg-hover' : 'text-ink-3 hover:bg-hover',
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
  const loc = useLocation()
  // the demo account sees the chapter tour once, on its first visit (the full screens are dense)
  useEffect(() => {
    // (not on the voice start screen: the tour begins with the first operating screen the operator opens)
    if (user?.id === '부산대학교' && loc.pathname !== '/' && !tour.seen()) tour.start(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, loc.pathname === '/'])
  // fetch the other screens' code while the browser is idle, so moving between them never waits on a download
  useEffect(() => {
    const load = () => {
      void import('../pages/Home')
      void import('../pages/Overview')
      void import('../pages/Energy')
      void import('../pages/Comfort')
      void import('../pages/Data')
      void import('../pages/Schedule')
      void import('../pages/Validation')
      void import('../pages/Plan')
      void import('../pages/Settings')
    }
    const t = window.setTimeout(load, 1200)
    return () => window.clearTimeout(t)
  }, [])
  const { open } = useCopilot()
  // load the copilot (markdown renderer, cards) the first time it is opened, then keep it mounted
  const [loaded, setLoaded] = useState(open)
  useEffect(() => {
    if (open) setLoaded(true)
  }, [open])
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleSide = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDE_KEY, c ? '0' : '1')
      } catch {
        /* private mode: the choice lasts for this visit only */
      }
      return !c
    })
  return (
    <div className="min-h-full bg-surface lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-[10px] focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        본문으로 건너뛰기
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggleSide} />
      <div className={cx('min-h-dvh min-w-0 flex-1', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        {/* the sidebar lists every screen of every section, so the pages need no tab strip of their own */}
        {/* 온디 (voice) fills the whole area under the top bar; the other screens keep a readable width */}
        <main id="main" className={loc.pathname === '/' ? 'min-w-0' : loc.pathname === '/overview' ? 'mx-auto max-w-[1440px] px-4 pt-6 pb-24 lg:px-7' : 'mx-auto max-w-[1320px] px-[clamp(16px,2.4vw,32px)] pt-7 pb-24'}>
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
      <VoiceDock />
      <TourOverlay />
      <ToastHost />
    </div>
  )
}
