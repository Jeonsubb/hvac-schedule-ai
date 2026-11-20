import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { AudioLines, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Command, Gauge, HeartPulse, Layers3, LogOut, MessageCircle, RotateCcw, Settings2, ShieldCheck, Upload, X, Zap } from 'lucide-react'
import gsap from 'gsap'
import { useCopilot, useDay, useMeta } from '../lib/context'
import { useAuth } from '../lib/auth'
import { addDays, cx } from '../lib/format'
import { Popover, ToastHost } from '../components/ui'
import ErrorBoundary from '../components/ErrorBoundary'
import './studio.css'

const Copilot = lazy(() => import('../components/Copilot'))
const MODULES = [
  { path: 'overview', label: '운영 Studio', icon: Layers3, code: '01' },
  { path: 'plan', label: 'AI 협의', icon: Command, code: '02' },
  { path: 'data', label: '일정 입력', icon: Upload, code: '03' },
  { path: 'schedule', label: '계획 달력', icon: CalendarDays, code: '04' },
  { path: 'energy', label: '에너지', icon: Zap, code: '05' },
  { path: 'comfort', label: '쾌적 분석', icon: HeartPulse, code: '06' },
  { path: 'validation', label: '정합성', icon: ShieldCheck, code: '07' },
  { path: 'settings', label: '운영 설정', icon: Settings2, code: '08' },
]

export function useStudioPrefix() {
  return useLocation().pathname.startsWith('/studio') ? '/studio' : ''
}

/** A tool rail and a canvas, rather than a hierarchy of dashboard cards. */
export default function StudioShell() {
  const location = useLocation()
  const prefix = useStudioPrefix()
  const current = location.pathname.split('/').filter(Boolean).at(-1) || 'overview'
  const module = MODULES.find((m) => m.path === current) ?? MODULES[0]
  const usesDate = ['overview', 'plan', 'schedule', 'validation'].includes(current)
  const { meta } = useMeta()
  const { date, setDate } = useDay()
  const { user, logout } = useAuth()
  const { open, setOpen } = useCopilot()
  const [loaded, setLoaded] = useState(open)
  const canvas = useRef<HTMLElement>(null)
  useEffect(() => { if (open) setLoaded(true) }, [open])
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const context = gsap.context(() => {
      gsap.fromTo('[data-studio-enter]', { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: .55, stagger: .07, ease: 'power3.out', clearProps: 'transform,opacity' })
    }, canvas)
    return () => context.revert()
  }, [location.pathname])
  return (
    <div className="studio-app">
      <a href="#studio-main" className="studio-skip">작업 캔버스로 건너뛰기</a>
      <aside className="studio-rail">
        <Link className="studio-monogram" to={`${prefix}/overview`} aria-label="ON:D 운영 Studio">O<span>:</span>D</Link>
        <nav aria-label="Studio 도구">
          {MODULES.map((m) => <NavLink key={m.path} to={`${prefix}/${m.path}`} title={m.label} className={({ isActive }) => cx('studio-rail-link', isActive && 'is-active')}>
            <m.icon size={20} strokeWidth={1.6} aria-hidden /><span>{m.label}</span>
          </NavLink>)}
        </nav>
        <div className="studio-rail-bottom">
          <Link to="/" aria-label="음성 콘솔 열기" title="음성 콘솔"><AudioLines size={20} aria-hidden /></Link>
          <Link to={`/classic/${current}${location.search}`} aria-label="기존 화면으로 돌아가기" title="기존 화면"><RotateCcw size={18} aria-hidden /></Link>
          <span>ON:D<br />STUDIO</span>
        </div>
      </aside>
      <div className="studio-body">
        <header className="studio-topbar">
          <div className="studio-location"><span className="studio-wordmark">ON<span>:</span>D</span><i /><span>{meta?.building.name ?? 'BUILDING'} <span className="studio-location-sub">/ {module.code} {module.label}</span></span></div>
          <div className="studio-utilities">
            <span className="studio-simulation"><span /> SIMULATION</span>
            {usesDate && <div className="studio-date">
              <button type="button" onClick={() => date && setDate(addDays(date, -1))} disabled={!date || date === meta?.semester.start} aria-label="기준 날짜 하루 전"><ChevronLeft size={14} aria-hidden /></button>
              <input type="date" aria-label="Studio 기준 날짜" value={date ?? ''} min={meta?.semester.start} max={meta?.semester.end} onChange={(e) => e.target.value && setDate(e.target.value)} />
              <button type="button" onClick={() => date && setDate(addDays(date, 1))} disabled={!date || date === meta?.semester.end} aria-label="기준 날짜 하루 뒤"><ChevronRight size={14} aria-hidden /></button>
            </div>}
            <button className="studio-assistant" type="button" aria-label={open ? 'AI 도우미 닫기' : 'AI 도우미 열기'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={17} /> : <MessageCircle size={17} />}<span>도우미</span></button>
            <Popover label="Studio 계정" align="end" width={260} buttonClassName="studio-account" button={<span>{user?.name.charAt(0) || 'O'}</span>}>
              <strong>{user?.name}</strong><p className="mt-1 text-[13px]">{meta?.building.campus} {meta?.building.name}</p>
              <Link to="/" className="mt-4 flex items-center justify-between text-[13px]">음성 콘솔 <ArrowUpRight size={14} /></Link>
              <button type="button" onClick={logout} className="mt-4 flex items-center gap-2 text-[13px]"><LogOut size={14} /> 로그아웃</button>
            </Popover>
          </div>
        </header>
        <main id="studio-main" ref={canvas} className={cx('studio-canvas', current === 'plan' && 'studio-canvas-theater')}>
          <ErrorBoundary key={location.pathname} area="Studio 작업 화면"><Outlet /></ErrorBoundary>
        </main>
        <footer className="studio-footer"><span><Gauge size={13} aria-hidden /> 건물 운영 시뮬레이션 · 실측 센서 아님</span><Link to={`/classic/${current}${location.search}`}>기존 화면 <ArrowUpRight size={12} aria-hidden /></Link></footer>
      </div>
      {loaded && <Suspense fallback={null}><ErrorBoundary area="AI 도우미"><Copilot /></ErrorBoundary></Suspense>}
      <ToastHost />
    </div>
  )
}
