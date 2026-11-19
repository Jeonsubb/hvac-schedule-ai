import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { LayoutDashboard, CalendarRange, ShieldCheck, TrendingDown, Database, SlidersHorizontal, Sparkles, X, CloudSun } from 'lucide-react'
import { useMeta, useCopilot } from '../lib/context'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import { Spinner, ToastHost } from './ui'

const Copilot = lazy(() => import('./Copilot'))

const NAV = [
  { to: '/', label: '운영 현황', icon: LayoutDashboard, desc: '지금 건물 상태와 오늘의 운전' },
  { to: '/schedule', label: '스케줄·타임라인', icon: CalendarRange, desc: '날짜별 강의와 냉난방 운전 비교' },
  { to: '/validation', label: '정합성 검증', icon: ShieldCheck, desc: '계획대로 켜고 껐는지 매일 확인' },
  { to: '/energy', label: '절감 효과', icon: TrendingDown, desc: '4가지 운전 방식의 전력·요금·쾌적 비교' },
  { to: '/data', label: '일정·데이터', icon: Database, desc: '강의 시간표와 시간표 밖 일정 관리' },
  { to: '/settings', label: '운영 규칙', icon: SlidersHorizontal, desc: '운전 규칙·설정온도·설비 정보' },
]

/** Mark: two floor slabs (4F warm, 3F cool), the same drawing as the building section. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#142033" />
      <path d="M6 21.5h13.5l6.5-5H12.5z" fill="#7ea7e0" />
      <path d="M6 21.5h13.5v2.2H6z" fill="#4f7fc4" />
      <path d="M6 13h13.5l6.5-5H12.5z" fill="#f2915c" />
      <path d="M6 13h13.5v2.2H6z" fill="#dc5a2a" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[15.5px] font-bold tracking-[-0.02em] text-ink">ThermoPlan</div>
        <div className="text-[11.5px] text-ink-3">IT관 냉난방 자동 운영</div>
      </div>
    </div>
  )
}

function Sidebar() {
  const { meta } = useMeta()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r border-line bg-paper lg:flex">
      <div className="px-5 pt-5 pb-6">
        <Logo />
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="주 메뉴">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            title={n.desc}
            className={({ isActive }) =>
              cx(
                'flex h-9 items-center gap-2.5 rounded-[6px] px-2.5 text-[13.5px] transition-colors',
                isActive ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'font-medium text-ink-2 hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={17} strokeWidth={isActive ? 2.3 : 1.9} className={isActive ? 'text-ink' : 'text-ink-3'} />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mx-5 mb-5 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-3">
        <div className="font-semibold text-ink-2">{meta ? `${meta.building.campus.replace('부산캠퍼스', '').trim() || '부산대학교'} ${meta.building.name}` : '부산대학교 IT관'}</div>
        <div>
          3·4층 강의실 {meta ? Object.keys(meta.rooms).length : 10}개, 실외기 {meta ? Object.keys(meta.odus).length : 3}대
        </div>
        <div className="tnum">
          {meta
            ? `${meta.semester.year}년 ${meta.semester.term} ${meta.semester.start.slice(5).replace('-', '/')}–${meta.semester.end.slice(5).replace('-', '/')}`
            : '2026년 2학기'}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-ink-2">
          <span className="inline-block h-2 w-2 rounded-full bg-s-ai" aria-hidden />
          AI 예측 제어로 운영 중
        </div>
      </div>
    </aside>
  )
}

function TopBar() {
  const { meta, error: metaError } = useMeta()
  const { open, setOpen } = useCopilot()
  const live = useApi<Live>('/api/live', { maxAgeMs: 60_000, refreshMs: 60_000 })
  const now = meta?.now
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-line bg-paper/90 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-4">
        <span className="lg:hidden">
          <LogoMark size={26} />
        </span>
        {now ? (
          <div className="flex min-w-0 items-center gap-2 text-[13px]" title={now.reason}>
            <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', now.live ? 'bg-good' : 'bg-warn')} aria-hidden />
            <span className={cx('shrink-0 font-semibold', now.live ? 'text-good-ink' : 'text-warn-ink')}>{now.live ? '실시간' : '대체 기준'}</span>
            <span className="tnum truncate font-medium text-ink">
              {fmtDateK(now.date)} {fmtMin(now.minute)}
            </span>
          </div>
        ) : metaError ? (
          <span className="flex items-center gap-2 text-[13px] font-semibold text-crit-ink" title={metaError.message}>
            <span className="inline-block h-2 w-2 rounded-full bg-crit" aria-hidden />
            서버 연결 끊김
          </span>
        ) : (
          <span className="text-[13px] text-ink-3">기준 시각 확인 중…</span>
        )}
        {live.data && (
          <div className="hidden items-center gap-1.5 border-l border-line pl-4 text-[13px] sm:flex" title={`${live.data.outdoor.src} 기준`}>
            <CloudSun size={15} className="text-ink-3" aria-hidden />
            <span className="text-ink-3">지금 외기</span>
            <span className="tnum font-semibold text-ink">{live.data.outdoor.t.toFixed(1)}℃</span>
            <span className="tnum text-ink-3">습도 {Math.round(live.data.outdoor.rh)}%</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
      <SystemStatus />
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cx(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] px-3 text-[13px] font-semibold transition-colors',
          open ? 'border border-line-strong bg-surface text-ink hover:bg-hover' : 'bg-ink text-white hover:bg-[#24334d]',
        )}
      >
        {open ? <X size={15} /> : <Sparkles size={15} className="text-[#7fd6a8]" />}
        {open ? '코파일럿 닫기' : 'AI 코파일럿'}
      </button>
      </div>
    </header>
  )
}

function shortTs(ts?: string | null) {
  if (!ts) return null
  const m = ts.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}` : ts
}

/** AI (Bedrock) health and storage fallback, from /api/meta (refreshed every minute). */
function SystemStatus() {
  const { meta } = useMeta()
  const ai = meta?.ai
  const st = meta?.storage
  if (!ai && !st) return null
  const fallback = st?.mode === 'local-fallback'
  const okAt = shortTs(ai?.last_ok)
  const errAt = shortTs(ai?.last_error)
  // ok === null/undefined means no AI call has been made since the server started: not a failure
  const unknown = ai != null && ai.ok == null
  return (
    <div className="hidden items-center gap-3 text-[12.5px] md:flex">
      {unknown && (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title="서버가 시작된 뒤 아직 AI(Bedrock)를 호출하지 않았습니다. 첫 호출 결과로 상태가 표시됩니다."
        >
          <span className="inline-block h-2 w-2 rounded-full bg-ink-4" aria-hidden />
          <span className="font-medium text-ink-3">AI 대기</span>
        </span>
      )}
      {ai && !unknown && (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap"
          title={
            ai.ok
              ? `AI(Bedrock) 호출이 정상입니다. 마지막 성공 ${okAt ?? '기록 없음'}`
              : `AI 호출이 실패하고 있습니다${errAt ? ` (${errAt})` : ''}. ${ai.error ?? ''} 코파일럿은 같은 질문의 이전 답을 보여 줄 수 있습니다.`
          }
        >
          <span className={cx('inline-block h-2 w-2 rounded-full', ai.ok ? 'bg-good' : 'bg-warn')} aria-hidden />
          <span className={cx('font-medium', ai.ok ? 'text-ink-2' : 'text-warn-ink')}>{ai.ok ? 'AI 연결 정상' : 'AI 연결 불안정'}</span>
          {okAt && <span className="tnum text-ink-3">{ai.ok ? okAt.split(' ')[1] : `마지막 성공 ${okAt}`}</span>}
        </span>
      )}
      {fallback && (
        <span
          className="inline-flex items-center gap-1.5 rounded-[4px] bg-warn-bg px-1.5 py-[1px] font-medium whitespace-nowrap text-warn-ink"
          title={`AWS 저장소에 연결하지 못해 서버의 임시 저장소를 쓰고 있습니다. 변경 내용이 서버 재시작 때 사라질 수 있습니다.${st?.last_error ? ` (${st.last_error})` : ''}`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-warn" aria-hidden />
          데이터 저장소 대체 모드
        </span>
      )}
    </div>
  )
}

function MobileNav() {
  return (
    <nav className="thin-scroll sticky top-14 z-20 flex gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 lg:hidden" aria-label="주 메뉴">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            cx(
              'flex shrink-0 items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap',
              isActive ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2 hover:bg-hover',
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
  const loc = useLocation()
  // load the copilot (markdown renderer, cards) the first time it is opened, then keep it mounted
  const [loaded, setLoaded] = useState(open)
  useEffect(() => {
    if (open) setLoaded(true)
  }, [open])
  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-[6px] focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        본문으로 건너뛰기
      </a>
      <Sidebar />
      <div className={cx('min-h-full transition-[padding] duration-200 lg:pl-[216px]', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        <main id="main" className="mx-auto max-w-[1600px] px-6 pt-6 pb-10">
          {/* keyed by route: moving to another screen clears a crashed page */}
          <ErrorBoundary key={loc.pathname} area="이 화면">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {loaded && (
        <Suspense
          fallback={
            <div className="fixed top-0 right-0 bottom-0 z-40 flex w-[440px] max-w-[100vw] items-center justify-center border-l border-line bg-surface text-[13px] text-ink-3">
              <Spinner /> <span className="ml-2">코파일럿을 여는 중…</span>
            </div>
          }
        >
          <ErrorBoundary area="AI 코파일럿 패널" wrapClassName="fixed top-0 right-0 bottom-0 z-40 w-[440px] max-w-[100vw] overflow-y-auto border-l border-line bg-paper p-4">
            <Copilot />
          </ErrorBoundary>
        </Suspense>
      )}
      <ToastHost />
    </div>
  )
}
