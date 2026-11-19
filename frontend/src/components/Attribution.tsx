import { useEffect, useState } from 'react'
import { useApi } from '../lib/api'
import type { Attribution, AttributionScope } from '../lib/types'
import { COLD_START, STRATEGY } from '../lib/constants'
import { cx, fmtNum, fmtPct } from '../lib/format'
import type { TableSpec } from './ui'

/** GET /api/attribution answers 202 {status:"computing"} until ready (first run ~1 min); poll every 10 s. */
export function useAttribution() {
  const a = useApi<Attribution | { status: string }>('/api/attribution', { maxAgeMs: 10 * 60_000 })
  const raw = a.data
  const computing = !!raw && 'status' in raw
  const data = raw && !('status' in raw) ? raw : undefined
  const stale = !!data?.stale
  const { reload } = a
  useEffect(() => {
    if (!computing && !stale) return
    const t = window.setTimeout(reload, 10_000)
    return () => window.clearTimeout(t)
  }, [computing, stale, reload, raw])
  return { data, computing: computing || (a.loading && !data), stale, error: a.error, reload }
}

/** Split the API note into the method sentence(s) and the occupancy-sensor assumption. */
export function splitNote(note: string) {
  const parts = note.split(/(?<=다\.)\s+/)
  const sensor = parts.filter((p) => p.includes('재실'))
  const method = parts.filter((p) => !p.includes('재실'))
  return { method: method.join(' '), sensor: sensor.join(' ') }
}

type Col = {
  key: string
  title: string
  sub?: string
  kind: 'total' | 'delta'
  from: number
  to: number
  delta: number | null
  cold: number
  comfort: number | null
  color: string
  sensor?: boolean
}

function niceMax(v: number) {
  const step = v > 5000 ? 1000 : v > 2000 ? 500 : v > 500 ? 100 : 50
  return Math.ceil((v * 1.08) / step) * step
}

/**
 * Which feature saved what: fixed → rule → predictive start/stop → weather → occupancy = AI.
 * Default view: bars, change labels and step names. `detail` adds the per-step comfort rows and the sensor footnote.
 */
export function Waterfall({ A, note, detail = false }: { A: AttributionScope; note: string; detail?: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const steps = A.waterfall
  const cols: Col[] = steps.map((s, i) => {
    const [title, sub] = s.label.includes(' (') ? [s.label.slice(0, s.label.indexOf(' (')), s.label.slice(s.label.indexOf(' (') + 2, -1)] : [s.label, undefined]
    return {
      key: s.variant,
      title,
      sub,
      kind: i === 0 ? 'total' : 'delta',
      from: i === 0 ? 0 : steps[i - 1].kwh,
      to: s.kwh,
      delta: s.delta_kwh,
      cold: s.cold_starts,
      comfort: s.comfort_pct,
      color: s.variant === 'fixed' ? STRATEGY.fixed.color : s.variant === 'rule' ? STRATEGY.rule.color : STRATEGY.ai.color,
      sensor: s.variant === 'ai',
    }
  })
  const ai = A.variants.ai
  cols.push({ key: 'ai_total', title: 'AI 예측 제어', sub: '운영 중인 방식', kind: 'total', from: 0, to: ai.kwh, delta: null, cold: ai.cold_starts, comfort: ai.comfort_pct, color: STRATEGY.ai.color })

  const H = 240
  const yMax = niceMax(Math.max(...cols.map((c) => Math.max(c.from, c.to))))
  const y = (v: number) => (v / yMax) * H
  const raw = yMax / 4
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw
  const ticks: number[] = []
  for (let t = 0; t <= yMax + 1e-6; t += tickStep) ticks.push(t)
  const { sensor } = splitNote(note)
  // fixed label column so toggling the comfort rows never shifts the bars
  const grid = { gridTemplateColumns: `112px repeat(${cols.length}, minmax(0, 1fr))` }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* plot */}
        <div className="grid" style={grid}>
          <div className="relative" style={{ height: H + 30 }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="tnum absolute right-3 translate-y-1/2 text-[12px] leading-none text-ink-3" style={{ bottom: y(t) }}>
                {fmtNum(t)}
              </span>
            ))}
            <span className="absolute top-0 right-3 text-[12px] text-ink-3">kWh</span>
          </div>
          <div className="relative" style={{ gridColumn: `2 / span ${cols.length}`, height: H + 30 }}>
            {ticks.map((t) => (
              <div key={t} className={cx('absolute inset-x-0 h-px', t === 0 ? 'bg-line-strong' : 'bg-[#f0f2f5]')} style={{ bottom: y(t) }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex">
              {cols.map((c, i) => {
                const lo = Math.min(c.from, c.to)
                const hi = Math.max(c.from, c.to)
                const up = c.kind === 'delta' && c.to > c.from
                const h = Math.max(2, y(hi) - y(lo))
                return (
                  <div
                    key={c.key}
                    className={cx('relative flex-1 transition-colors', hover === c.key && 'bg-well')}
                    onMouseEnter={() => setHover(c.key)}
                    onMouseLeave={() => setHover(null)}
                    title={`${c.title}: ${fmtNum(c.to, 1)} kWh${c.delta != null ? ` (${c.delta > 0 ? '+' : '−'}${fmtNum(Math.abs(c.delta), 1)})` : ''}, ${COLD_START.label} ${c.cold}회, 쾌적 ${fmtPct(c.comfort, 2)}`}
                  >
                    {/* connectors at the running level */}
                    {i > 0 && <div className="absolute left-0 h-px bg-ink-4" style={{ bottom: y(c.from), right: 'calc(50% + 12px)' }} aria-hidden />}
                    {i < cols.length - 1 && <div className="absolute right-0 h-px bg-ink-4" style={{ bottom: y(c.kind === 'total' ? c.to : c.to), left: 'calc(50% + 12px)' }} aria-hidden />}
                    <div
                      className="absolute left-1/2 w-6 -translate-x-1/2"
                      style={{
                        bottom: y(lo),
                        height: h,
                        background: up ? 'rgba(20,166,115,0.16)' : c.color,
                        boxShadow: up ? `inset 0 0 0 1.5px ${c.color}` : undefined,
                        borderRadius: c.kind === 'total' ? '4px 4px 0 0' : 2,
                      }}
                      aria-hidden
                    />
                    <div className="absolute inset-x-1 text-center" style={{ bottom: y(hi) + 6 }}>
                      <div className={cx('tnum leading-tight font-[650]', c.kind === 'total' ? 'text-[15px] text-ink' : up ? 'text-[14px] text-heat-ink' : 'text-[14px] text-ink')}>
                        {c.kind === 'total' ? fmtNum(c.to) : `${(c.delta ?? 0) > 0 ? '+' : '−'}${fmtNum(Math.abs(c.delta ?? 0), 1)}`}
                      </div>
                      {up && <div className="text-[13px] leading-tight font-medium text-heat-ink">쾌적을 위한 전력</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* step names */}
        <div className="grid border-t border-line pt-3" style={grid}>
          <div aria-hidden />
          {cols.map((c, i) => (
            <div key={c.key} className={cx('px-1.5 text-center', hover === c.key && 'bg-well')}>
              <div className="text-[14px] leading-snug font-semibold text-ink">
                {i > 0 && i < cols.length - 1 && <span className="mr-0.5 text-ink-3">+</span>}
                {i === cols.length - 1 && <span className="mr-0.5 text-ink-3">=</span>}
                {c.title}
                {c.sensor && detail && <sup className="ml-0.5 text-[11px] font-semibold text-ink-2">1</sup>}
              </div>
              {c.sub && <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{c.sub}</div>}
            </div>
          ))}
        </div>

        {detail && (
          <>
        {/* cold starts and comfort under each step */}
        <div className="mt-3 grid items-center border-t border-line py-2.5" style={grid}>
          <div className="pr-3 text-right text-[13px] leading-tight font-medium text-ink-2" title={COLD_START.desc}>
            {COLD_START.label}
          </div>
          {cols.map((c, i) => {
            const prev = i > 0 && i < cols.length - 1 ? cols[i - 1].cold : null
            const drop = prev != null ? c.cold - prev : 0
            return (
              <div key={c.key} className={cx('tnum text-center text-[14px]', hover === c.key && 'bg-well')}>
                <b className={cx('font-[650]', c.cold === 0 ? 'text-good-ink' : 'text-ink')}>{fmtNum(c.cold)}회</b>
                {prev != null && Math.abs(drop) >= 5 && (
                  <span className={cx('ml-1 text-[13px] font-semibold', drop < 0 ? 'text-good-ink' : 'text-crit-ink')}>
                    {drop < 0 ? '−' : '+'}
                    {Math.abs(drop)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div className="grid items-center border-t border-line py-2.5" style={grid}>
          <div className="pr-3 text-right text-[13px] font-medium text-ink-2">쾌적 유지율</div>
          {cols.map((c) => (
            <div key={c.key} className={cx('tnum text-center text-[14px] text-ink-2', hover === c.key && 'bg-well')}>
              {fmtPct(c.comfort, 2)}
            </div>
          ))}
        </div>
        {sensor && (
          <p className="mt-2 border-t border-line pt-2.5 text-[13px] leading-relaxed text-ink-3">
            <sup className="mr-0.5 font-semibold text-ink-2">1</sup>
            {sensor}
          </p>
        )}
          </>
        )}
      </div>
    </div>
  )
}

export function WaterfallLegend() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: STRATEGY.fixed.color }} aria-hidden />
        고정 스케줄
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: STRATEGY.rule.color }} aria-hidden />
        규칙이 줄인 몫
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: STRATEGY.ai.color }} aria-hidden />
        AI 기능이 줄인 몫
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: 'rgba(20,166,115,0.16)', boxShadow: `inset 0 0 0 1.5px ${STRATEGY.ai.color}` }} aria-hidden />
        AI가 더 쓴 몫(쾌적 확보)
      </span>
    </>
  )
}

export function waterfallTable(A: AttributionScope): TableSpec {
  return {
    columns: ['단계', '전력량 kWh', '변화 kWh', `${COLD_START.label}(회)`, '쾌적 유지율 %', '불쾌 누적 ℃·분'],
    rows: A.waterfall.map((s) => [s.label, s.kwh, s.delta_kwh, s.cold_starts, s.comfort_pct, A.variants[s.variant]?.discomfort_dm ?? null]),
  }
}
