import './thermoplan-design.css'
import { lazy, Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import { LayoutDashboard, CalendarRange, ShieldCheck, TrendingDown, Database, SlidersHorizontal, Sparkles, X, CloudSun } from 'lucide-react'
import { useMeta, useCopilot } from '../lib/context'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { useApi } from '../lib/api'
import type { Live } from '../lib/types'
import { Popover, Spinner, ToastHost } from './ui'

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
      <rect width="32" height="32" rx="16" fill="#347dff" />
      <path d="M6 21.5h13.5l6.5-5H12.5z" fill="#ffffff" />
      <path d="M6 21.5h13.5v2.2H6z" fill="#cce0ff" />
      <path d="M6 13h13.5l6.5-5H12.5z" fill="#e4efff" />
      <path d="M6 13h13.5v2.2H6z" fill="#b6d4ff" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark size={32} />
      <div className="leading-tight">
        <div className="text-[16px] font-bold tracking-[-0.02em] text-ink" translate="no">
          ThermoPlan
        </div>
        <div className="mt-0.5 text-[13px] text-ink-3">IT관 냉난방 자동 운영</div>
      </div>
    </div>
  )
}

function Sidebar() {
  const { meta } = useMeta()
  return (
    <aside className="tp-sidebar fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col bg-paper lg:flex">
      <div className="px-6 pt-6 pb-8">
        <Logo />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="주 메뉴">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            title={n.desc}
            className={({ isActive }) =>
              cx(
                'tp-nav-link flex h-10 items-center gap-3 rounded-[10px] px-3 text-[14.5px] transition-colors duration-150',
                isActive ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'font-medium text-ink-2 hover:bg-hover hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <n.icon size={18} strokeWidth={isActive ? 2.2 : 1.8} className={isActive ? 'text-ink' : 'text-ink-3'} aria-hidden />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="px-6 pb-6 text-[13px] leading-relaxed text-ink-3">
        <div className="font-medium text-ink-2">{meta ? `${meta.building.campus.replace('부산캠퍼스', '').trim() || '부산대학교'} ${meta.building.name}` : '부산대학교 IT관'}</div>
        <div className="tnum">{meta ? `${meta.semester.year}년 ${meta.semester.term}` : '2026년 2학기'}</div>
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
    <header className="tp-topbar sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line/70 bg-paper/85 px-8 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-5">
        <span className="lg:hidden">
          <LogoMark size={28} />
        </span>
        {now ? (
          <div
            className="flex min-w-0 items-center gap-2.5 text-[14px]"
            title={now.live ? `실시간 기준 시각입니다. ${now.reason}` : now.reason}
          >
            <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', now.live ? 'bg-good' : 'bg-warn')} aria-hidden />
            {!now.live && <span className="shrink-0 font-semibold text-warn-ink">대체 기준</span>}
            <span className="tnum truncate font-medium text-ink">
              {fmtDateK(now.date)} {fmtMin(now.minute)}
            </span>
            <span className="sr-only">{now.live ? '실시간' : ''}</span>
          </div>
        ) : metaError ? (
          <span className="flex items-center gap-2 text-[14px] font-semibold text-crit-ink" title={metaError.message}>
            <span className="inline-block h-2 w-2 rounded-full bg-crit" aria-hidden />
            서버 연결 끊김
          </span>
        ) : (
          <span className="text-[14px] text-ink-3">기준 시각 확인 중…</span>
        )}
        {live.data && (
          <div className="hidden items-center gap-1.5 text-[14px] text-ink-2 sm:flex" title={`지금 외기 ${live.data.outdoor.t.toFixed(1)}℃, 습도 ${Math.round(live.data.outdoor.rh)}% (${live.data.outdoor.src})`}>
            <CloudSun size={17} className="text-ink-3" aria-hidden />
            <span className="sr-only">지금 외기</span>
            <span className="tnum font-medium text-ink">{live.data.outdoor.t.toFixed(1)}℃</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SystemStatus />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={cx(
            'inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-4 text-[14px] font-semibold transition-colors duration-150',
            open ? 'border border-line-strong bg-surface text-ink hover:bg-hover' : 'bg-ink text-white hover:bg-[#25344e]',
          )}
        >
          {open ? <X size={16} aria-hidden /> : <Sparkles size={16} className="text-[#7fd6a8]" aria-hidden />}
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

/** AI (Bedrock) health and storage fallback: a dot that opens the details; the fallback badge stays visible. */
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
  const bad = !!ai && !unknown && !ai.ok
  const dot = unknown || !ai ? 'bg-ink-4' : ai.ok ? 'bg-good' : 'bg-warn'
  const short = !ai ? '시스템' : unknown ? 'AI 대기' : ai.ok ? 'AI 정상' : 'AI 불안정'
  return (
    <div className="hidden items-center gap-2 md:flex">
      {fallback && (
        <span
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-warn-bg px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-warn-ink"
          title={`AWS 저장소에 연결하지 못해 서버의 임시 저장소를 쓰고 있습니다. 변경 내용이 서버 재시작 때 사라질 수 있습니다.${st?.last_error ? ` (${st.last_error})` : ''}`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-warn" aria-hidden />
          데이터 저장소 대체 모드
        </span>
      )}
      <Popover
        label="시스템 상태"
        align="end"
        width={300}
        buttonClassName={cx(
          'inline-flex h-10 items-center gap-2 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors duration-150 hover:bg-hover',
          bad ? 'text-warn-ink' : 'text-ink-2',
        )}
        button={
          <>
            <span className={cx('inline-block h-2 w-2 rounded-full', dot)} aria-hidden />
            {short}
          </>
        }
      >
        <div className="space-y-3">
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
              {fallback ? '대체 모드: 서버 임시 저장소를 쓰고 있습니다. 변경 내용이 서버 재시작 때 사라질 수 있습니다.' : `정상 (${st?.mode ?? '알 수 없음'})`}
            </div>
          </div>
        </div>
      </Popover>
    </div>
  )
}

function MobileNav() {
  return (
    <nav className="thin-scroll sticky top-16 z-20 flex gap-1 overflow-x-auto border-b border-line bg-paper px-4 py-2 lg:hidden" aria-label="주 메뉴">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === '/'}
          className={({ isActive }) =>
            cx(
              'flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-2 text-[14px] font-medium whitespace-nowrap',
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
    <div className="tp-app min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-[10px] focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        본문으로 건너뛰기
      </a>
      <Sidebar />
      <div className={cx('tp-main-shell min-h-full lg:pl-[232px]', open && '2xl:pr-[440px]')}>
        <TopBar />
        <MobileNav />
        <main id="main" className="tp-main mx-auto max-w-[1480px] px-8 pt-8 pb-20">
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
      <ToastHost />
    </div>
  )
}
