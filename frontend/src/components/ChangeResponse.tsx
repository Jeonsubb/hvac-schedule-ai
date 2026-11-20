import { useState } from 'react'
import { CalendarX2, CalendarPlus, CloudSnow, ThumbsDown, UserX, Radar, Cpu, Wrench, Check, Zap } from 'lucide-react'
import { apiSend, invalidateAll } from '../lib/api'
import { cx, fmtDateK, fmtMin } from '../lib/format'
import { Button, Card, CardHeader, ErrorBox, Spinner, toast } from './ui'

type Kind = 'cancel' | 'add' | 'weather' | 'feedback' | 'noshow'

interface Block {
  s: number
  e: number
  kind?: string
  title?: string
}

interface RoomSide {
  plan: Block[]
  actual: Block[]
  lectures: Block[]
  kwh: number
  on_min: number
  pmv: number | null
  cold_starts: number
}

interface Totals {
  kwh: number
  cost_krw: number
  cold_starts: number
  on_minutes: number
}

interface Preview {
  kind: Kind
  title: string
  date: string
  elapsed_ms: number
  steps: { label: string; text: string }[]
  rooms: { room: string; before: RoomSide; after: RoomSide }[]
  totals: { before: Totals; after: Totals }
  variants?: { no_replan?: Totals }
  event: Record<string, unknown> | null
  before_label: string
  after_label: string
}

const SCENARIOS: { kind: Kind; label: string; icon: typeof CalendarX2; hint: string }[] = [
  { kind: 'cancel', label: '휴강이 생기면', icon: CalendarX2, hint: '다음 수업 하나가 휴강됩니다' },
  { kind: 'add', label: '특강이 잡히면', icon: CalendarPlus, hint: '오후 빈 강의실에 45명 특강이 생깁니다' },
  { kind: 'weather', label: '갑자기 추워지면', icon: CloudSnow, hint: '실황이 예보보다 3℃ 낮아집니다' },
  { kind: 'feedback', label: '"춥다"가 몰리면', icon: ThumbsDown, hint: '한 강의실에 춥다는 의견 3건' },
  { kind: 'noshow', label: '아무도 안 오면', icon: UserX, hint: '수업에 재실 인원이 0명입니다' },
]

const R0 = 420 // 07:00
const R1 = 1380 // 23:00
const pct = (m: number) => `${(Math.max(0, Math.min(1, (m - R0) / (R1 - R0))) * 100).toFixed(2)}%`
const wid = (s: number, e: number) => `${(Math.max(0, (Math.min(e, R1) - Math.max(s, R0)) / (R1 - R0)) * 100).toFixed(2)}%`

function Row({ label, side, accent }: { label: string; side: RoomSide; accent: boolean }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)_92px] items-center gap-3">
      <span className={cx('text-[12.5px] font-medium', accent ? 'text-brand-ink' : 'text-ink-3')}>{label}</span>
      <div className="relative h-7 rounded-[8px] bg-well">
        {side.lectures.map((l, i) => (
          <span
            key={`l${i}`}
            className="absolute top-0 h-full rounded-[6px] border border-dashed border-[#9aa4b2]"
            style={{ left: pct(l.s), width: wid(l.s, l.e) }}
            title={`수업 ${fmtMin(l.s)}~${fmtMin(l.e)} ${l.title ?? ''}`}
          />
        ))}
        {side.actual.map((b, i) => (
          <span
            key={`a${i}`}
            className={cx('absolute top-1.5 h-4 rounded-[5px]', b.kind === 'fan' ? 'bg-air' : accent ? 'bg-s-ai' : 'bg-[#9fd8c0]')}
            style={{ left: pct(b.s), width: wid(b.s, b.e) }}
            title={`운전 ${fmtMin(b.s)}~${fmtMin(b.e)}`}
          />
        ))}
      </div>
      <span className="tnum text-right text-[12.5px] text-ink-2">
        {side.kwh.toFixed(2)} kWh
        {side.pmv != null && <span className="block text-[11.5px] text-ink-3">PMV {side.pmv.toFixed(2)}</span>}
      </span>
    </div>
  )
}

const STEP_ICON = [Radar, Cpu, Wrench]

/**
 * "What if the day changes now?" — one click applies a change, the engine recomputes the day, and the
 * card shows detect → recompute → action with the affected rooms before/after. Nothing is saved unless
 * the operator registers the event for real.
 */
export default function ChangeResponse() {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [res, setRes] = useState<Preview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function run(kind: Kind) {
    setBusy(kind)
    setErr(null)
    try {
      const r = await apiSend<Preview>('POST', '/api/respond/preview', { kind })
      if (!r || !Array.isArray(r.steps)) throw new Error('응답 형식이 올바르지 않습니다.')
      setRes(r)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function apply() {
    if (!res?.event) return
    setApplying(true)
    try {
      await apiSend('POST', '/api/events', res.event)
      invalidateAll()
      toast('실제로 등록했습니다. 그날 계획과 모든 화면이 다시 계산됩니다.')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setApplying(false)
    }
  }

  const tb = res?.totals.before
  const ta = res?.totals.after
  const dk = tb && ta ? ta.kwh - tb.kwh : 0
  const hours = [8, 10, 12, 14, 16, 18, 20, 22]

  return (
    <Card data-tour="plan-respond">
      <CardHeader
        title="상황이 바뀌면 바로 대응합니다"
        sub="버튼을 누르면 그 변화를 넣고 그날 운전을 같은 열모델로 다시 계산합니다. 시험이라 저장되지 않습니다."
      />
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.kind}
            type="button"
            onClick={() => run(s.kind)}
            disabled={!!busy}
            title={s.hint}
            className={cx(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition-colors disabled:opacity-60',
              res?.kind === s.kind ? 'border-ink bg-ink text-white' : 'border-[rgb(12_14_19/0.18)] bg-surface text-ink-2 hover:border-[rgb(12_14_19/0.5)] hover:text-ink',
            )}
          >
            {busy === s.kind ? <Spinner size={15} /> : <s.icon size={16} aria-hidden />}
            {s.label}
          </button>
        ))}
      </div>

      {err && (
        <div className="mt-4">
          <ErrorBox title="다시 계산하지 못했습니다" error={err} />
        </div>
      )}

      {res && tb && ta && (
        <div className="reveal mt-5 space-y-5" aria-live="polite">
          <ol className="grid gap-3 md:grid-cols-3">
            {res.steps.map((st, i) => {
              const Icon = STEP_ICON[i] ?? Check
              return (
                <li key={st.label} className="rounded-[18px] bg-well p-5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-brand-ink">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white">
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="tnum">{String(i + 1).padStart(2, '0')}</span> {st.label}
                  </div>
                  <p className="mt-2 text-[15px] leading-[1.6] text-ink">{st.text}</p>
                </li>
              )
            })}
          </ol>

          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-[12.5px] font-medium text-ink-3">그날 전력</div>
              <div className="tnum text-[26px] leading-[1.1] font-[650] tracking-[-0.02em] text-ink">
                {tb.kwh.toFixed(1)} → {ta.kwh.toFixed(1)} kWh{' '}
                <span className={cx('text-[14px]', dk < -0.05 ? 'text-good-ink' : dk > 0.05 ? 'text-warn-ink' : 'text-ink-3')}>
                  ({dk > 0 ? '+' : ''}
                  {dk.toFixed(2)})
                </span>
              </div>
            </div>
            <div>
              <div className="text-[12.5px] font-medium text-ink-3">수업 시작 시 쾌적 이탈</div>
              <div className="tnum text-[26px] leading-[1.1] font-[650] tracking-[-0.02em] text-ink">
                {tb.cold_starts} → {ta.cold_starts}건
              </div>
            </div>
            <div>
              <div className="text-[12.5px] font-medium text-ink-3">다시 계산</div>
              <div className="tnum flex items-center gap-1 text-[26px] leading-[1.1] font-[650] tracking-[-0.02em] text-ink">
                <Zap size={16} className="text-brand" aria-hidden /> {res.elapsed_ms}ms
              </div>
            </div>
            <div className="text-[13px] text-ink-3">{fmtDateK(res.date)} 기준</div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-[86px_minmax(0,1fr)_92px] gap-3 text-[11.5px] text-ink-4">
              <span />
              <div className="relative h-3">
                {hours.map((h) => (
                  <span key={h} className="absolute -translate-x-1/2 tnum" style={{ left: pct(h * 60) }}>
                    {h}시
                  </span>
                ))}
              </div>
              <span />
            </div>
            {res.rooms.map((r) => (
              <div key={r.room} className="space-y-1.5">
                <div className="text-[14px] font-semibold text-ink">{r.room}호</div>
                <Row label={res.before_label} side={r.before} accent={false} />
                <Row label={res.after_label} side={r.after} accent />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded-[4px] border border-dashed border-[#9aa4b2]" /> 수업
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded-[4px] bg-s-ai" /> AI 운전(바뀐 뒤)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 rounded-[4px] bg-[#9fd8c0]" /> AI 운전(바뀌기 전)
              </span>
            </div>
          </div>

          {res.event && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-well px-5 py-4">
              <span className="text-[13.5px] text-ink-2">이 변화를 실제 일정으로 등록하면 그날 계획과 모든 화면이 바로 다시 계산됩니다.</span>
              <Button variant="primary" size="sm" onClick={apply} disabled={applying}>
                {applying ? <Spinner size={14} /> : <Check size={14} aria-hidden />} 실제로 등록하기
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
