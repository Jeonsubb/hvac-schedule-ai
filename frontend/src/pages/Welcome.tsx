import { useLayoutEffect, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import gsap from 'gsap'
import { Observer } from 'gsap/Observer'
import { useAuth } from '../lib/auth'
import Building, { FH, FLOORS } from '../components/welcome/Building'
import { DAY_END, DAY_START, FOCUS, FOCUS_HOUR, MONDAY, ROOM_COUNT, SESSION_COUNT, fmtHour } from '../components/welcome/data'
import '../components/welcome/welcome.css'

gsap.registerPlugin(Observer)

const SPAN = DAY_END - DAY_START
const FOCUS_COUNT = Object.keys(FOCUS).length
const IDLE_COUNT = ROOM_COUNT - FOCUS_COUNT
const SCENES = ['브랜드', '스케줄', '공간 준비', '완성']

const ACCENT = '#2f6fde'
const INK_SOFT = 'rgba(12,14,19,0.16)'
const INK_STRONG = 'rgba(12,14,19,0.6)'

/** Deterministic scatter for the timetable blocks (same on every visit and every replay). */
const jitter = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v) - 0.5
}

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <>
      {lines.map((l) => (
        <span key={l} className={`ond-mask ${className ?? ''}`}>
          <span className="ond-line">{l}</span>
        </span>
      ))}
    </>
  )
}

/**
 * /welcome — ON:D brand story. The page does not scroll: one wheel notch, swipe or key press
 * plays the timeline to the next stop, so each step lands as a composed frame.
 */
export default function Welcome() {
  const { user } = useAuth()
  const root = useRef<HTMLDivElement>(null)
  const goScene = useRef<(scene: number) => void>(() => {})

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const html = document.documentElement
    const prev = { bg: html.style.backgroundColor, body: document.body.style.backgroundColor, ob: html.style.overscrollBehavior }
    html.style.backgroundColor = '#ffffff'
    document.body.style.backgroundColor = '#ffffff'
    html.style.overscrollBehavior = 'none'

    const mm = gsap.matchMedia()
    mm.add(
      { reduce: '(prefers-reduced-motion: reduce)', motion: '(prefers-reduced-motion: no-preference)' },
      (c) => {
        const reduce = !!c.conditions?.reduce
        const q = gsap.utils.selector(el)
        // Under reduced motion, keep only opacity/colour changes: no travel, scale, rotation or wipes.
        const MOVE = ['x', 'y', 'z', 'xPercent', 'yPercent', 'scale', 'scaleX', 'rotation', 'rotationX', 'rotationY', 'clipPath']
        const v = (vars: gsap.TweenVars): gsap.TweenVars => {
          if (!reduce) return vars
          const out = { ...vars }
          for (const k of MOVE) delete (out as Record<string, unknown>)[k]
          return out
        }
        const cam = q('.ond-bcam')[0]
        const spin = q('.ond-bspin')[0]
        const fl = (f: number) => q(`.ond-fl[data-floor="${f}"]`)[0]
        const leaves = (f: number) => q(`.ond-leaf[data-floor="${f}"]`)
        const plans = q('.ond-fac-front[data-floor="3"], .ond-fac-front[data-floor="4"], .ond-fac-side[data-floor="3"], .ond-fac-side[data-floor="4"]')
        const focusHeat = q('.ond-room[data-focus] .ond-room-heat')
        const focusRoom = q('.ond-room[data-focus]')
        const idleRoom = q('.ond-room:not([data-focus])')
        const blocks = q('.ond-block')
        const focusBlocks = q('.ond-block[data-focus]')
        const otherBlocks = q('.ond-block:not([data-focus])')
        const cursor = q('.ond-cursor')[0]
        const cursorLabel = q('.ond-cursor-time')[0]
        const navItems = q('.ond-nav button')
        const wide = () => window.innerWidth >= 1024

        // ---- initial state -------------------------------------------------------------
        gsap.set(spin, { rotation: -38 })
        gsap.set(cam, { rotationX: 62, scale: 0.84, y: 150, x: 0 })
        FLOORS.forEach((f) => gsap.set(fl(f), { z: (f - 1) * FH }))
        gsap.set('.ond-blayer', { opacity: 0.55 })
        gsap.set(['.ond-s2', '.ond-s3', '.ond-s4', '.ond-brandmark'], { autoAlpha: 0 })
        gsap.set(q('.ond-s2 .ond-line, .ond-s3 .ond-line, .ond-s4 .ond-line'), reduce ? { opacity: 0 } : { yPercent: 112 })
        gsap.set(q('.ond-cap-b'), { autoAlpha: 0 })
        gsap.set(q('.ond-step'), { opacity: 0.3 })
        gsap.set(q('.ond-track-fill'), reduce ? { opacity: 0 } : { scaleX: 0 })
        gsap.set(q('.ond-cta'), reduce ? { opacity: 0 } : { opacity: 0, y: 18 })
        gsap.set(focusHeat, { opacity: 0 })
        gsap.set(q('.ond-win-lit'), { opacity: 0 })
        gsap.set(plans, { clipPath: 'inset(0% 0% 0% 0%)' })
        gsap.set(q('.ond-ondy'), reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.92, transformOrigin: '50% 100%' })
        // Ondy appears once per scene, after the copy has landed, and never loops.
        const pop = () => v({ opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'back.out(1.6)' })
        const drop = () => v({ opacity: 0, y: 10, scale: 0.94, duration: 0.25, ease: 'power2.in' })
        blocks.forEach((b, i) =>
          gsap.set(b, reduce ? { opacity: 0 } : { opacity: 0, x: jitter(i, 1) * 260, y: jitter(i, 2) * 220, rotation: jitter(i, 3) * 24 }),
        )

        // first paint: the wordmark rises out of its mask
        if (!reduce) {
          // fromTo, not from: a StrictMode re-run must never read a half-finished state as the end value
          gsap.fromTo(q('.ond-logo-in'), { yPercent: 108 }, { yPercent: 0, duration: 1.3, ease: 'expo.out', stagger: 0.09, delay: 0.1 })
          gsap.fromTo(q('.ond-s1 .ond-line'), { yPercent: 112 }, { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08, delay: 0.45 })
          gsap.fromTo(q('.ond-hint'), { opacity: 0 }, { opacity: 1, duration: 1, delay: 1.1 })
        }

        const time = { t: DAY_START }
        const setTime = () => {
          const pct = ((time.t - DAY_START) / SPAN) * 100
          cursor.style.transform = `translate3d(${pct}%,0,0)`
          cursorLabel.textContent = fmtHour(Math.round(time.t * 4) / 4)
        }
        setTime()

        const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } })

        // ---- Scene 1 → out: the wordmark splits and the building recedes ---------------
        tl.to(q('.ond-logo-on'), v({ xPercent: -38, opacity: 0, duration: 1.1, ease: 'power2.in' }), 0)
          .to(q('.ond-logo-d'), v({ xPercent: 60, opacity: 0, duration: 1.1, ease: 'power2.in' }), 0)
          .to(q('.ond-logo-colon'), v({ scale: 0.2, opacity: 0, duration: 0.7, ease: 'power2.in' }), 0.05)
          .to(q('.ond-s1 .ond-line'), v({ yPercent: -112, opacity: 0, duration: 0.55, stagger: 0.06, ease: 'power2.in' }), 0)
          .to(q('.ond-hint'), { opacity: 0, duration: 0.3 }, 0)
          .to('.ond-blayer', { opacity: 0.12, duration: 1 }, 0.1)
          .to(cam, v({ scale: 0.7, y: 220, duration: 1.2, ease: 'power1.inOut' }), 0)
          .to('.ond-brandmark', { autoAlpha: 1, duration: 0.4 }, 0.8)
          .set('.ond-s1', { autoAlpha: 0 }, 1.15)

        // ---- Scene 2: the schedule assembles, then a cursor sweeps the day ----------------
        tl.to('.ond-s2', { autoAlpha: 1, duration: 0.25 }, 1.0)
          .to(q('.ond-s2 .ond-line'), v({ yPercent: 0, opacity: 1, duration: 0.6, stagger: 0.07, ease: 'power3.out' }), 1.05)
          .to(blocks, v({ x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: { each: 0.012, from: 'random' } }), 1.2)
          .to(time, { t: DAY_END - 0.5, duration: 1.0, ease: 'power1.inOut', onUpdate: setTime }, 2.45)
          .to(time, { t: FOCUS_HOUR, duration: 0.4, ease: 'power2.inOut', onUpdate: setTime }, 3.45)
          .to(q('.ond-cap-a'), { autoAlpha: 0, duration: 0.2 }, 3.5)
          .to(otherBlocks, { opacity: 0.25, duration: 0.3 }, 3.6)
          .to(focusBlocks, { backgroundColor: ACCENT, color: '#ffffff', borderColor: ACCENT, duration: 0.3 }, 3.6)
          .to(q('.ond-cap-b'), { autoAlpha: 1, duration: 0.3 }, 3.65)
          .to(q('.ond-ondy-schedule'), pop(), 1.6)

        // ---- Scene 2 → 3: the schedule tips over into the floor plan --------------------
        const S2_OUT = 3.95
        tl.to(q('.ond-tt'), v({ rotationX: 58, y: 120, scale: 0.86, opacity: 0, transformPerspective: 1400, duration: 0.9, ease: 'power2.in' }), S2_OUT)
          .to(q('.ond-s2-head'), v({ y: -30, opacity: 0, duration: 0.5, ease: 'power2.in' }), S2_OUT)
          .set('.ond-s2', { autoAlpha: 0 }, S2_OUT + 0.9)

        // Building poses shared by both motion modes.
        const camPlan = { x: () => (wide() ? window.innerWidth * 0.2 : 0), y: () => (wide() ? window.innerHeight * 0.1 : window.innerHeight * 0.36), scale: () => 0.8 * Math.min(1, window.innerHeight / 1000), rotationX: 50 }
        // on short screens lift the building further so it clears the closing line
        const camEnd = { x: 0, y: () => -window.innerHeight * 0.07 - Math.max(0, 900 - window.innerHeight) * 0.3, scale: 0.62, rotationX: 58 }
        const apart: Record<number, number> = { 5: 4 * FH + 460, 4: 3 * FH + 230, 3: 2 * FH, 2: FH - 110, 1: -180 }
        const dim = [...leaves(2), ...leaves(1)]

        // ---- Scene 3: floors separate, the walls slice away, the booked spaces prepare ------
        const EX = S2_OUT + 0.95
        if (reduce) {
          // no travel: cut to the opened building while it is faded out, then fade it in
          tl.to('.ond-blayer', { opacity: 0, duration: 0.15 }, S2_OUT - 0.1)
            .set(cam, camPlan, S2_OUT + 0.05)
          FLOORS.forEach((f) => tl.set(fl(f), { z: apart[f] }, S2_OUT + 0.05))
          tl.set(leaves(5), { opacity: 0 }, S2_OUT + 0.05)
            .set(dim, { opacity: 0.25 }, S2_OUT + 0.05)
            .set(plans, { opacity: 0 }, S2_OUT + 0.05)
            .to('.ond-blayer', { opacity: 1, duration: 0.7 }, S2_OUT + 0.15)
        } else {
          tl.to('.ond-blayer', { opacity: 1, duration: 0.7 }, S2_OUT + 0.15)
            .to(cam, { ...camPlan, duration: 1.1, ease: 'power2.inOut' }, S2_OUT + 0.05)
          FLOORS.forEach((f) => tl.to(fl(f), { z: apart[f], duration: 1, ease: 'power2.inOut' }, EX))
          tl.to(leaves(5), { opacity: 0, duration: 0.6 }, EX + 0.2)
            .to(dim, { opacity: 0.25, duration: 0.8 }, EX + 0.1)
            .to(plans, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.8, ease: 'power2.inOut', stagger: 0.06 }, EX + 0.15)
        }
        tl.to('.ond-s3', { autoAlpha: 1, duration: 0.2 }, EX + 0.2)
          .to(q('.ond-s3 .ond-line'), v({ yPercent: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: 'power3.out' }), EX + 0.25)
          .to(q('.ond-step[data-step="1"]'), { opacity: 1, duration: 0.3 }, EX + 0.5)

        const PREP = EX + 1.1
        tl.to(q('.ond-step[data-step="1"]'), { opacity: 0.3, duration: 0.3 }, PREP)
          .to(q('.ond-step[data-step="2"]'), { opacity: 1, duration: 0.3 }, PREP)
          .to(q('.ond-track-fill'), reduce ? { opacity: 0.6, duration: 0.8 } : { scaleX: 0.66, duration: 0.8, ease: 'power1.inOut' }, PREP + 0.05)
          .to(focusHeat, { opacity: 0.55, duration: 0.8, stagger: 0.07 }, PREP + 0.1)
          .to(q('.ond-track-fill'), reduce ? { opacity: 1, duration: 0.3 } : { scaleX: 1, duration: 0.3 }, PREP + 0.95)
          .to(focusHeat, { opacity: 0.92, duration: 0.3 }, PREP + 0.95)
          .to(focusRoom, { borderColor: ACCENT, duration: 0.3 }, PREP + 0.95)
          .to(q('.ond-ondy-hvac'), pop(), EX + 0.55)
          // the moment the spaces are in use: preparing → comfortable
          .to(q('.ond-ondy-hvac'), drop(), PREP + 0.95)
          .to(q('.ond-ondy-comfort'), pop(), PREP + 1.1)

        const IDLE = PREP + 1.4
        tl.to(q('.ond-step[data-step="2"]'), { opacity: 0.3, duration: 0.3 }, IDLE)
          .to(q('.ond-step[data-step="3"]'), { opacity: 1, duration: 0.3 }, IDLE)
          .to(idleRoom, { borderColor: INK_STRONG, duration: 0.35 }, IDLE)

        // ---- Scene 4: the building closes up again and the system is whole --------------
        const FIN = IDLE + 0.5
        tl.to('.ond-s3', { autoAlpha: 0, duration: 0.4 }, FIN)
          .to(q('.ond-ondy-comfort'), drop(), FIN)
          .to(idleRoom, { borderColor: INK_SOFT, duration: 0.3 }, FIN)
        if (reduce) {
          tl.to('.ond-blayer', { opacity: 0, duration: 0.3 }, FIN)
            .set(cam, camEnd, FIN + 0.32)
            .set(spin, { rotation: -30 }, FIN + 0.32)
          FLOORS.forEach((f) => tl.set(fl(f), { z: (f - 1) * FH }, FIN + 0.32))
          tl.set([...leaves(5), ...dim], { opacity: 1 }, FIN + 0.32)
            .set(plans, { opacity: 1 }, FIN + 0.32)
            .to('.ond-blayer', { opacity: 1, duration: 0.5 }, FIN + 0.4)
        } else {
          FLOORS.forEach((f) => tl.to(fl(f), { z: (f - 1) * FH, duration: 1.1, ease: 'power3.inOut' }, FIN + 0.05))
          tl.to([...leaves(5), ...dim], { opacity: 1, duration: 0.8 }, FIN + 0.2)
            .to(plans, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.8, ease: 'power2.inOut' }, FIN + 0.35)
            .to(cam, { ...camEnd, duration: 1.3, ease: 'power2.inOut' }, FIN)
            .to(spin, { rotation: -30, duration: 1.6, ease: 'power1.inOut' }, FIN)
        }
        tl.to(q('.ond-win-lit'), { opacity: 1, duration: 0.5, stagger: 0.05 }, FIN + 0.9)
          .to('.ond-s4', { autoAlpha: 1, duration: 0.2 }, FIN + 0.9)
          .to(q('.ond-s4 .ond-line'), v({ yPercent: 0, opacity: 1, duration: 0.7, stagger: 0.12, ease: 'power3.out' }), FIN + 0.95)
          .to(q('.ond-cta'), v({ opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }), FIN + 1.45)
          .to(q('.ond-ondy-main'), pop(), FIN + 1.55)

        // ---- stops: one gesture plays to the next composed frame ----------------------------
        //   brand · schedule laid out · 09:00 focus · building opened · spaces prepared · idle spaces · final
        const STOPS = [0, 2.4, S2_OUT, EX + 0.95, IDLE - 0.05, FIN - 0.05, tl.duration()]
        const SCENE_OF = [0, 1, 1, 2, 2, 2, 3]
        const FIRST_STOP = [0, 1, 3, 6]
        let cur = 0
        let busy = false
        let readyAt = 0

        const mark = (i: number) => {
          const s = SCENE_OF[i]
          navItems.forEach((b, k) => b.toggleAttribute('data-active', k === s))
          el.setAttribute('data-stop', String(i))
        }
        const go = (i: number) => {
          const next = gsap.utils.clamp(0, STOPS.length - 1, i)
          if (next === cur || busy || performance.now() < readyAt) return
          const dist = Math.abs(STOPS[next] - tl.time())
          cur = next
          busy = true
          mark(next)
          tl.tweenTo(STOPS[next], {
            duration: reduce ? 0.6 : gsap.utils.clamp(0.9, 2, dist * 0.72),
            ease: 'power1.inOut',
            onComplete: () => {
              busy = false
              readyAt = performance.now() + 380 // swallow trackpad momentum after landing
            },
          })
        }
        goScene.current = (scene: number) => {
          readyAt = 0
          go(FIRST_STOP[scene])
        }
        mark(0)

        const obs = Observer.create({
          target: window,
          type: 'wheel,touch',
          wheelSpeed: -1,
          tolerance: 12,
          preventDefault: true,
          onUp: () => go(cur + 1),
          onDown: () => go(cur - 1),
        })
        const onKey = (e: KeyboardEvent) => {
          const t = e.target as HTMLElement | null
          if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
          const map: Record<string, number> = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 }
          if (e.key in map) {
            e.preventDefault()
            go(cur + (e.shiftKey && e.key === ' ' ? -1 : map[e.key]))
          } else if (e.key === 'Home') go(0)
          else if (e.key === 'End') go(STOPS.length - 1)
        }
        window.addEventListener('keydown', onKey)

        // function-based poses depend on the viewport: re-record them from the start state
        let rz = 0
        const onResize = () => {
          clearTimeout(rz)
          rz = window.setTimeout(() => {
            const t = tl.time()
            tl.time(0).invalidate().time(t)
          }, 150)
        }
        window.addEventListener('resize', onResize)

        return () => {
          obs.kill()
          window.removeEventListener('keydown', onKey)
          window.removeEventListener('resize', onResize)
          clearTimeout(rz)
          goScene.current = () => {}
        }
      },
    )

    return () => {
      mm.revert()
      html.style.backgroundColor = prev.bg
      document.body.style.backgroundColor = prev.body
      html.style.overscrollBehavior = prev.ob
    }
  }, [])

  if (user?.onboarded) return <Navigate to="/" replace />

  const primaryTo = user ? '/setup' : '/signup'
  const primaryLabel = user ? '건물 설정 이어 하기' : '내 건물 연결하기'

  return (
    <div ref={root} className="ond-root">
      <header className="ond-header">
        <Link to="/welcome" className="ond-brandlink" aria-label="ON:D 소개 처음으로" onClick={() => goScene.current(0)}>
          <span className="ond-brandmark" translate="no">
            ON<span>:</span>D
          </span>
        </Link>
        <nav className="ond-header-actions" aria-label="계정">
          {user ? (
            <Link to="/setup" className="ond-btn ond-btn-ghost">
              건물 설정 이어 하기
            </Link>
          ) : (
            <>
              <Link to="/login" className="ond-btn ond-btn-ghost">
                로그인
              </Link>
              <Link to="/signup" className="ond-btn ond-btn-line">
                시작하기
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="ond-stage" aria-label="ON:D 소개">
        <div className="ond-bg" aria-hidden />
        <div className="ond-blayer">
          <Building />
        </div>

        {/* Scene 1 — brand */}
        <div className="ond-scene ond-s1">
          <h1 className="ond-logo" aria-label="ON:D">
            <span className="ond-logo-part ond-logo-on">
              <span className="ond-logo-in">ON</span>
            </span>
            <span className="ond-logo-part ond-logo-colon">
              <span className="ond-logo-in">:</span>
            </span>
            <span className="ond-logo-part ond-logo-d">
              <span className="ond-logo-in">D</span>
            </span>
          </h1>
          <p className="ond-slogan">
            <Lines lines={['사람이 오기 전,', '공간을 먼저 준비합니다']} />
          </p>
          <p className="ond-desc">
            <Lines lines={['스케줄 기반 스마트 HVAC 최적화 서비스']} />
          </p>
          <div className="ond-hint" aria-hidden>
            <span />
            스크롤
          </div>
        </div>

        {/* Scene 2 — schedule */}
        <div className="ond-scene ond-s2">
          <div className="ond-s2-head">
            <div>
              <p className="ond-eyebrow">
                <Lines lines={['01  Schedule']} />
              </p>
              <h2 className="ond-h2">
                <Lines lines={['같은 건물,', '공간마다 다른 하루']} />
              </h2>
            </div>
            <div className="ond-caps-wrap">
            <div className="ond-caps">
              <p className="ond-cap ond-cap-a">
                강의실·회의실·객실·매장은 쓰이는 시간이 저마다 다릅니다.
                <br />
                예시 데이터: 부산대 IT관 3·4층 공간 {ROOM_COUNT}곳의 월요일 일정 {SESSION_COUNT}건.
              </p>
              <p className="ond-cap ond-cap-b">
                {fmtHour(FOCUS_HOUR)}에 일정이 시작되는 공간은 {FOCUS_COUNT}곳.
                <br />
                나머지 {IDLE_COUNT}곳은 아직 비어 있습니다.
              </p>
            </div>
            <img className="ond-ondy ond-ondy-schedule" src="/assets/mascot/ondy-schedule.png" alt="" aria-hidden width={694} height={694} />
            </div>
          </div>
          <div className="ond-tt" role="img" aria-label={`예시 건물 공간 ${ROOM_COUNT}곳의 월요일 일정`}>
            <div className="ond-tt-axis">
              {Array.from({ length: SPAN / 2 + 1 }, (_, i) => DAY_START + i * 2).map((t) => (
                <span key={t} style={{ left: `${((t - DAY_START) / SPAN) * 100}%` }}>
                  {fmtHour(t)}
                </span>
              ))}
            </div>
            <div className="ond-tt-rows">
              {MONDAY.map((r) => (
                <div key={r.room} className="ond-tt-row">
                  <span className="ond-tt-room">{r.room}</span>
                  <div className="ond-tt-track">
                    {r.sessions.length === 0 && <span className="ond-tt-empty">일정 없음</span>}
                    {r.sessions.map((x) => (
                      <span
                        key={`${x.start}-${x.name}`}
                        className="ond-block"
                        data-focus={x.start === FOCUS_HOUR ? '1' : undefined}
                        style={{ left: `${((x.start - DAY_START) / SPAN) * 100}%`, width: `${((x.end - x.start) / SPAN) * 100}%` }}
                      >
                        <span>{x.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="ond-cursor-lane" aria-hidden>
                <div className="ond-cursor">
                  <span className="ond-cursor-line" />
                  <span className="ond-cursor-time">08:00</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scene 3 — schedule meets space */}
        <div className="ond-scene ond-s3">
          <p className="ond-eyebrow">
            <Lines lines={['02  Intelligent HVAC']} />
          </p>
          <h2 className="ond-h2">
            <Lines lines={['일정이 곧', '운전 계획이 됩니다']} />
          </h2>
          <ol className="ond-steps">
            <li className="ond-step" data-step="1">
              <strong>층을 열어 공간을 봅니다</strong>
              <span>층마다 공간을 펼치고, 그 위에 일정을 겹칩니다.</span>
            </li>
            <li className="ond-step" data-step="2">
              <strong>사람이 오기 전에 준비합니다</strong>
              <span>
                {fmtHour(FOCUS_HOUR)} 일정이 있는 {FOCUS_COUNT}곳만 미리 냉난방을 켭니다. 켜는 시각은 날씨와 실내 온도를 보고 정합니다.
              </span>
            </li>
            <li className="ond-step" data-step="3">
              <strong>비어 있으면 켜지 않습니다</strong>
              <span>같은 시각 일정이 없는 {IDLE_COUNT}곳은 꺼진 채로 둡니다.</span>
            </li>
          </ol>
          <div className="ond-track" aria-hidden>
            <div className="ond-track-bar">
              <span className="ond-track-fill" />
            </div>
            <div className="ond-track-labels">
              <span>꺼짐</span>
              <span>사용 전 준비</span>
              <span>{fmtHour(FOCUS_HOUR)} 사용 시작</span>
            </div>
          </div>
          <p className="ond-note">예시는 부산대 IT관 강의실입니다. 배치는 도식이며, 운전은 열모델 시뮬레이션으로 계산합니다.</p>
        </div>

        {/* Ondy stands beside the opened building while it prepares the rooms */}
        <div className="ond-guide" aria-hidden>
          <img className="ond-ondy ond-ondy-hvac" src="/assets/mascot/ondy-hvac.png" alt="" width={652} height={732} />
          <img className="ond-ondy ond-ondy-comfort" src="/assets/mascot/ondy-comfort.png" alt="" width={682} height={538} />
        </div>

        {/* Scene 4 — final reveal */}
        <div className="ond-scene ond-s4">
          <div className="ond-s4-body">
          <img className="ond-ondy ond-ondy-main" src="/assets/mascot/ondy-main.png" alt="" aria-hidden width={676} height={724} />
          <h2 className="ond-final">
            <Lines lines={['필요한 시간에,', '필요한 공간만.']} />
          </h2>
          <div className="ond-cta">
            <p className="ond-cta-sub">학교·오피스·호텔·쇼핑몰, 일정이 있는 건물이라면 어디든.</p>
            <div className="ond-cta-row">
              <Link to={primaryTo} className="ond-btn ond-btn-primary">
                {primaryLabel} <ArrowRight size={18} aria-hidden />
              </Link>
              <Link to="/login" state={{ demo: true }} className="ond-btn ond-btn-line">
                부산대 IT관 데모 보기
              </Link>
            </div>
            <p className="ond-foot">
              <span translate="no">ON:D</span> · 2026 AWS x PNU AI 해커톤 과제 3 출품작
            </p>
          </div>
          </div>
        </div>

        <nav className="ond-nav" aria-label="소개 장면">
          {SCENES.map((s, i) => (
            <button key={s} type="button" onClick={() => goScene.current(i)} data-active={i === 0 ? '' : undefined}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              {s}
            </button>
          ))}
        </nav>
      </section>
    </div>
  )
}
