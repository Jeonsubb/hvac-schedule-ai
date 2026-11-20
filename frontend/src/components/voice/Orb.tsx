import { useEffect, useRef } from 'react'
import type { Levels, Phase } from '../../lib/voice/types'

/**
 * The ON:D orb: points on a sphere, turning slowly. It is drawn from the audio itself:
 * while the operator speaks the microphone spectrum pushes latitude bands outward, while ON:D speaks
 * the Polly audio does, and a call ("온디") sends one wave from pole to pole.
 */

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

interface Look {
  /** rotation, rad/s */
  spin: number
  /** how far the audio pushes points out (fraction of the radius) */
  react: number
  /** standing ripple with no audio */
  breathe: number
  radius: number
  color: [number, number, number]
  glow: number
}

// colours for a light surface (SEED gray / blue / purple / green), drawn with normal blending
const LOOKS: Record<Phase, Look> = {
  off: { spin: 0.12, react: 0, breathe: 0.016, radius: 0.94, color: [134, 139, 148], glow: 0.05 },
  idle: { spin: 0.16, react: 0.1, breathe: 0.02, radius: 0.96, color: [85, 93, 109], glow: 0.06 },
  listening: { spin: 0.3, react: 0.55, breathe: 0.03, radius: 1.0, color: [26, 110, 227], glow: 0.16 },
  thinking: { spin: 1.5, react: 0, breathe: 0.07, radius: 0.86, color: [109, 80, 203], glow: 0.12 },
  speaking: { spin: 0.4, react: 0.5, breathe: 0.03, radius: 1.0, color: [7, 145, 113], glow: 0.16 },
}

export default function Orb({
  phase,
  sample,
  points = 1500,
  className,
}: {
  phase: Phase
  sample: () => Levels
  points?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef(phase)
  const sampleRef = useRef(sample)
  sampleRef.current = sample
  /** time the current phase began: the wake wave runs from it */
  const sinceRef = useRef(performance.now())
  if (phaseRef.current !== phase) {
    phaseRef.current = phase
    sinceRef.current = performance.now()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // fixed geometry: a Fibonacci sphere, plus a private phase per point for shimmer
    const ys = new Float32Array(points)
    const rs = new Float32Array(points)
    const th = new Float32Array(points)
    const seed = new Float32Array(points)
    for (let i = 0; i < points; i++) {
      const y = 1 - (2 * (i + 0.5)) / points
      ys[i] = y
      rs[i] = Math.sqrt(1 - y * y)
      th[i] = i * GOLDEN
      seed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1
    }

    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.round(rect.width * dpr))
      h = Math.max(1, Math.round(rect.height * dpr))
      canvas.width = w
      canvas.height = h
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // the look eases between phases instead of switching
    const cur: Look = { ...LOOKS[phaseRef.current], color: [...LOOKS[phaseRef.current].color] as [number, number, number] }
    let angle = 0
    let last = performance.now()
    let raf = 0

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) {
        last = now
        return
      }
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const t = now / 1000
      const ph = phaseRef.current
      const target = LOOKS[ph]
      const k = 1 - Math.exp(-dt * 5)
      cur.spin += (target.spin - cur.spin) * k
      cur.react += (target.react - cur.react) * k
      cur.breathe += (target.breathe - cur.breathe) * k
      cur.radius += (target.radius - cur.radius) * k
      cur.glow += (target.glow - cur.glow) * k
      for (let c = 0; c < 3; c++) cur.color[c] += (target.color[c] - cur.color[c]) * k
      angle += cur.spin * dt * (reduce ? 0.3 : 1)

      const { level, bands } = sampleRef.current()
      const since = (now - sinceRef.current) / 1000
      // one wave from the top pole to the bottom when listening starts
      const wave = ph === 'listening' && since < 0.9 ? since / 0.9 : -1

      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const cy = h / 2
      const R = Math.min(w, h) * 0.38 * cur.radius * (1 + level * cur.react * 0.12)
      const [cr, cg, cb] = cur.color

      // soft halo that swells with the voice
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.75)
      const ga = cur.glow * (0.7 + level * 1.4)
      halo.addColorStop(0, `rgba(${cr | 0},${cg | 0},${cb | 0},${Math.min(0.5, ga)})`)
      halo.addColorStop(0.55, `rgba(${cr | 0},${cg | 0},${cb | 0},${Math.min(0.5, ga) * 0.25})`)
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, w, h)

      ctx.globalCompositeOperation = 'source-over'
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)
      const tilt = 0.32 + Math.sin(t * 0.21) * 0.06
      const cosT = Math.cos(tilt)
      const sinT = Math.sin(tilt)
      const base = Math.max(1, Math.min(w, h) / 420) * dpr * 0.5
      const thinking = ph === 'thinking'

      for (let i = 0; i < points; i++) {
        const y0 = ys[i]
        const r0 = rs[i]
        const a = th[i]
        // displacement along the normal
        const band = bands[Math.min(15, ((1 - Math.abs(y0)) * 15.99) | 0)]
        let d = cur.breathe * Math.sin(y0 * 5 + t * 1.3 + seed[i] * 6.28)
        d += cur.react * (level * 0.22 + band * 0.42) * (0.55 + 0.45 * Math.sin(a * 3 + t * 5 + y0 * 4))
        if (thinking) d += 0.05 * Math.sin(y0 * 9 - t * 7)
        if (wave >= 0) {
          const gap = y0 - (1 - 2 * wave)
          d += 0.3 * Math.exp(-(gap * gap) / 0.018) * (1 - wave * 0.4)
        }
        const rr = 1 + d
        let x = r0 * Math.cos(a) * rr
        let y = y0 * rr
        let z = r0 * Math.sin(a) * rr
        // spin around the vertical axis, then lean toward the viewer
        const x1 = x * cosA + z * sinA
        const z1 = -x * sinA + z * cosA
        x = x1
        const y1 = y * cosT - z1 * sinT
        z = y * sinT + z1 * cosT
        y = y1
        const persp = 2.6 / (2.6 - z)
        const px = cx + x * R * persp
        const py = cy + y * R * persp
        const depth = (z + 1.3) / 2.6 // 0 far, 1 near
        const tw = thinking ? 0.6 + 0.4 * Math.sin(t * 9 + seed[i] * 40) : 1
        const alpha = (0.14 + 0.86 * depth * depth) * tw * (0.75 + Math.min(1, d * 6) * 0.5)
        const size = base * (0.7 + 1.5 * depth) * (1 + Math.max(0, d) * 5)
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha > 1 ? 1 : alpha < 0 ? 0 : alpha})`
        if (size < 1.4 * dpr) ctx.fillRect(px - size / 2, py - size / 2, size, size)
        else {
          ctx.beginPath()
          ctx.arc(px, py, size / 2, 0, 6.2832)
          ctx.fill()
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [points])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
