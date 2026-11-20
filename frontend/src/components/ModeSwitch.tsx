import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Hand, Inbox, Check, X } from 'lucide-react'
import { apiSend, invalidate, useApi } from '../lib/api'
import type { Adjustment, OpMode, OpModeKey } from '../lib/types'
import { cx, fmtDateShort, fmtKwh, fmtNum } from '../lib/format'
import { Popover, Spinner, btnCls, toast } from './ui'

const TIER_LABEL: Record<number, string> = { 1: '1차 월간', 2: '2차 주간', 3: '3차 일일' }

function changeText(a: Adjustment): string {
  const c = a.change ?? {}
  const parts: string[] = []
  if (c.sp_heat != null) parts.push(`난방 ${c.sp_heat}℃`)
  if (c.sp_cool != null) parts.push(`냉방 ${c.sp_cool}℃`)
  if (c.vent) parts.push(`환기 ${c.vent === 'low' ? '약' : c.vent === 'mid' ? '중' : '강'}`)
  return parts.join(', ')
}

function period(a: Adjustment) {
  return a.date_from === a.date_to ? fmtDateShort(a.date_from) : `${fmtDateShort(a.date_from)}~${fmtDateShort(a.date_to)}`
}

/** Pending adjustments, loaded only while the popover is open. */
function PendingList({ onDone }: { onDone: () => void }) {
  const q = useApi<Adjustment[]>('/api/adjustments?status=pending', { maxAgeMs: 10_000 })
  const [busy, setBusy] = useState<string | null>(null)
  const list = Array.isArray(q.data) ? q.data : []

  const act = async (a: Adjustment, what: 'approve' | 'reject') => {
    setBusy(a.id + what)
    try {
      await apiSend('POST', `/api/adjustments/${encodeURIComponent(a.id)}/${what}`)
      toast(what === 'approve' ? `승인했습니다. ${a.rooms.join('·')}호에 제어 명령을 보냈습니다.` : '조정안을 거절했습니다.', what === 'approve' ? 'good' : 'neutral')
      invalidate('/api/')
      onDone()
    } catch (e) {
      toast((e as Error).message || '처리하지 못했습니다.', 'crit')
    } finally {
      setBusy(null)
    }
  }

  if (q.error) return <p className="text-[13.5px] text-crit-ink">승인 대기 목록을 불러오지 못했습니다. {q.error.message}</p>
  if (!q.data)
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-ink-3">
        <Spinner size={14} /> 불러오는 중…
      </div>
    )
  if (!list.length) return <p className="text-[13.5px] text-ink-3">승인을 기다리는 조정안이 없습니다.</p>
  return (
    <ul className="thin-scroll -mx-1 max-h-[420px] space-y-2 overflow-y-auto overscroll-contain px-1">
      {list.map((a) => {
        const kwh = a.impact?.kwh ?? 0
        return (
          <li key={a.id} className="rounded-[12px] border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] leading-snug font-semibold text-ink">{a.title}</div>
                <div className="tnum mt-0.5 text-[12.5px] text-ink-3">
                  {TIER_LABEL[a.tier] ?? `${a.tier}차`}, {a.rooms.map((r) => `${r}호`).join(' ')}, {period(a)}
                </div>
              </div>
              <span className={cx('tnum shrink-0 text-[13px] font-semibold', kwh > 0 ? 'text-heat-ink' : 'text-s-ai-ink')}>
                {kwh > 0 ? '+' : ''}
                {fmtKwh(kwh)} kWh
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              {changeText(a) && <span className="font-medium text-ink">{changeText(a)}. </span>}
              {a.reason}
            </p>
            {a.impact?.cost_krw ? <p className="tnum mt-0.5 text-[12.5px] text-ink-3">요금 {a.impact.cost_krw > 0 ? '+' : ''}{fmtNum(a.impact.cost_krw)}원 예상</p> : null}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act(a, 'approve')}
                className={btnCls('primary', 'sm')}
              >
                {busy === a.id + 'approve' ? <Spinner size={13} className="text-white" /> : <Check size={13} aria-hidden />} 승인
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() => act(a, 'reject')}
                className={btnCls('secondary', 'sm')}
              >
                {busy === a.id + 'reject' ? <Spinner size={13} /> : <X size={13} aria-hidden />} 거절
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Top-bar control: 자동 운전 / 추천 모드, plus the approval inbox in recommend mode. */
export default function ModeSwitch() {
  const q = useApi<OpMode>('/api/mode', { maxAgeMs: 20_000, refreshMs: 60_000 })
  const [saving, setSaving] = useState(false)
  const m = q.data
  if (!m || (m.mode !== 'auto' && m.mode !== 'recommend')) return null

  const set = async (mode: OpModeKey) => {
    if (mode === m.mode || saving) return
    setSaving(true)
    try {
      await apiSend<OpMode>('PUT', '/api/mode', { mode })
      toast(mode === 'auto' ? '자동 운전 모드로 바꿨습니다. 새 조정안은 바로 반영됩니다.' : '추천 모드로 바꿨습니다. 조정안은 승인한 것만 반영됩니다.')
      invalidate('/api/mode')
      invalidate('/api/adjustments')
      invalidate('/api/plan')
    } catch (e) {
      toast((e as Error).message || '모드를 바꾸지 못했습니다.', 'crit')
    } finally {
      setSaving(false)
    }
  }

  const opts: { key: OpModeKey; label: string; icon: typeof Bot; title: string }[] = [
    { key: 'auto', label: '자동 운전', icon: Bot, title: 'AI 조정안을 바로 중앙 제어기에 반영합니다' },
    { key: 'recommend', label: '추천 모드', icon: Hand, title: 'AI 조정안을 승인한 것만 반영합니다' },
  ]
  const pending = Number(m.pending) || 0

  return (
    <div className="hidden items-center gap-2 md:flex">
      <div className="inline-flex rounded-[10px] bg-[#eef0f4] p-[3px]" role="radiogroup" aria-label="운전 모드">
        {opts.map((o) => {
          const on = m.mode === o.key
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              title={o.title}
              disabled={saving}
              onClick={() => set(o.key)}
              className={cx(
                'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
                on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(20_32_51/0.08),0_0_0_1px_rgb(20_32_51/0.06)]' : 'text-ink-3 hover:text-ink',
              )}
            >
              <o.icon size={14} className={on ? (o.key === 'auto' ? 'text-brand' : 'text-ink-2') : undefined} aria-hidden />
              <span className="hidden 2xl:inline">{o.label}</span>
              <span className="2xl:hidden">{o.key === 'auto' ? '자동' : '추천'}</span>
            </button>
          )
        })}
      </div>
      {pending > 0 && (
        <Popover
          label="승인 대기 조정안"
          align="end"
          width={380}
          buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-warn-bg px-3 text-[13px] font-semibold whitespace-nowrap text-warn-ink transition-colors hover:bg-[#ffeec4]"
          button={
            <>
              <Inbox size={14} aria-hidden />
              승인 대기 <span className="tnum">{pending}</span>
            </>
          }
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-[14.5px] font-semibold text-ink">승인을 기다리는 조정안</div>
            <Link to="/plan?tier=3" className="text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline">
              근거 보기
            </Link>
          </div>
          <PendingList onDone={q.reload} />
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">승인하면 해당 강의실 실내기에 설정온도·환기 명령을 보내고, AI 운전 시뮬레이션을 다시 계산합니다.</p>
        </Popover>
      )}
    </div>
  )
}
