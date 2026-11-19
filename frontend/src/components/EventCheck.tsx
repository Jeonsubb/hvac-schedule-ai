import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Fan, Info, Users } from 'lucide-react'
import { apiSend } from '../lib/api'
import { hm, cx } from '../lib/format'
import type { EventCheck, EventDraft } from '../lib/types'
import { Badge, Button, Disclosure, Spinner } from './ui'
import type { EventCheck as Check } from '../lib/types'

/** The fields /api/events/check needs, or null while the draft is still incomplete. */
export function checkBody(d: EventDraft): Record<string, unknown> | null {
  if (!d.date) return null
  if (d.type === 'add' && (!d.room || !d.start || !d.end || hm(d.end) <= hm(d.start))) return null
  if (d.type === 'cancel' && !d.course_id) return null
  if (d.type === 'move' && (!d.course_id || !d.new_room)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d)) if (!CLIENT_ONLY.includes(k) && v !== null && v !== undefined && v !== '') out[k] = v
  return out
}

const CLIENT_ONLY = ['check', 'clarification', 'from_cache', 'cached_at']

/** Payloads are guarded: missing lists become empty, a missing verdict is treated as not ok. */
export function normCheck(c: unknown): EventCheck | null {
  if (!c || typeof c !== 'object') return null
  const x = c as Partial<EventCheck>
  return {
    ok: x.ok === true,
    conflicts: Array.isArray(x.conflicts) ? x.conflicts : [],
    capacity_ok: x.capacity_ok !== false,
    capacity: x.capacity && typeof x.capacity === 'object' ? x.capacity : null,
    alternatives: Array.isArray(x.alternatives) ? x.alternatives : [],
    note: typeof x.note === 'string' ? x.note : null,
    alternatives_note: typeof x.alternatives_note === 'string' ? x.alternatives_note : null,
    target: Array.isArray(x.target) ? x.target : [],
  }
}

/** Draft without client-only fields, ready for POST /api/events. */
export function eventBody(d: EventDraft): Record<string, unknown> {
  const body: Record<string, unknown> = { ...d }
  for (const k of CLIENT_ONLY) delete body[k]
  return body
}

/**
 * Re-checks conflicts, capacity and alternative rooms 600 ms after the draft stops changing.
 * `initial` (the check returned with a parsed draft) is used as-is while the draft is unchanged.
 */
export function useEventCheck(draft: EventDraft | null, initialRaw?: EventCheck | null) {
  const body = draft ? checkBody(draft) : null
  const key = body ? JSON.stringify(body) : ''
  // parse responses may omit `target` for cancel/move; re-check those so the target class is shown
  const needsTarget = draft?.type === 'cancel' || draft?.type === 'move'
  const initial = initialRaw && !(needsTarget && !Array.isArray(initialRaw.target)) ? initialRaw : null
  const [state, setState] = useState<{ key: string; check: EventCheck | null; error: string | null }>(() => ({
    key: initial && body ? key : '',
    check: normCheck(initial),
    error: null,
  }))
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!key || state.key === key) return
    const id = ++seq.current
    setBusy(true)
    const t = window.setTimeout(async () => {
      try {
        const r = await apiSend<unknown>('POST', '/api/events/check', JSON.parse(key))
        if (seq.current === id) setState({ key, check: normCheck(r), error: null })
      } catch (e) {
        if (seq.current === id) setState({ key, check: null, error: (e as Error).message })
      } finally {
        if (seq.current === id) setBusy(false)
      }
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = !!key && state.key === key
  return {
    complete: !!key,
    checking: !!key && (busy || !current),
    check: current ? state.check : null,
    error: current ? state.error : null,
  }
}

const VERDICT: Record<string, string> = {
  add: '겹치는 일정 없음',
  cancel: '휴강할 강의를 확인했습니다. 등록하면 그 시간에는 냉난방을 켜지 않습니다.',
  move: '옮길 강의실이 그 시간에 비어 있습니다',
  closure: '휴관으로 등록하면 그날 냉난방을 켜지 않습니다',
}

/** Conflicts, capacity and free rooms ranked by extra energy; "이 강의실로 변경" rewrites the draft. */
export function EventCheckPanel({
  draft,
  result,
  onPickRoom,
  compact = false,
}: {
  draft: EventDraft
  result: ReturnType<typeof useEventCheck>
  onPickRoom: (room: string) => void
  compact?: boolean
}) {
  const { complete, checking, check, error } = result
  if (!complete)
    return (
      <div className="flex items-center gap-2 rounded-[12px] bg-well px-3.5 py-2.5 text-[13.5px] text-ink-3">
        <Info size={14} aria-hidden /> 날짜{draft.type === 'add' ? ', 강의실, 시간' : draft.type === 'closure' ? '' : ', 대상 강의'}를 채우면 겹치는 일정과 정원을 확인합니다.
      </div>
    )
  if (checking && !check)
    return (
      <div className="flex items-center gap-2 rounded-[12px] bg-well px-3.5 py-2.5 text-[13.5px] text-ink-2" role="status">
        <Spinner size={14} /> 겹치는 일정과 정원을 확인하는 중…
      </div>
    )
  if (error)
    return (
      <div className="flex items-start gap-2 rounded-[12px] bg-crit-bg px-3.5 py-2.5 text-[13.5px] text-crit-ink" role="alert">
        <AlertTriangle size={14} className="mt-[3px] shrink-0" aria-hidden /> 겹치는 일정을 확인하지 못했습니다. {error}
      </div>
    )
  if (!check) return null

  const cap = check.capacity
  const requested = check.alternatives.find((a) => a.requested)
  const others = check.alternatives.filter((a) => !a.requested)
  const cheaper = requested ? others.filter((a) => a.extra_kwh < requested.extra_kwh - 0.05) : others
  const target = draft.type === 'move' ? draft.new_room : draft.room
  const problems = check.conflicts.length > 0 || !check.capacity_ok
  const showAlts = problems ? others : check.ok ? cheaper : []

  return (
    <div className={cx('space-y-3 transition-opacity duration-200', checking && 'opacity-60')} aria-live="polite">
      {/* verdict: conflicts/capacity, or another reason (note), or all clear */}
      {problems ? (
        <div className="space-y-1.5 rounded-[12px] bg-crit-bg px-3.5 py-2.5 text-[13.5px] text-crit-ink" role="alert">
          {check.conflicts.map((c, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertTriangle size={14} className="mt-[3px] shrink-0" aria-hidden />
              <span>
                <b className="font-semibold">{c.room}호</b>에 같은 시간 {c.kind === 'event' ? '일정' : '강의'}이 있습니다:{' '}
                <span className="tnum">
                  {c.title} {c.start}–{c.end}
                </span>
              </span>
            </div>
          ))}
          {!check.capacity_ok && cap && (
            <div className="flex items-start gap-2">
              <Users size={14} className="mt-[3px] shrink-0" aria-hidden />
              <span className="tnum">
                예상 {cap.expected_people}명이 {cap.room}호 정원 {cap.capacity}명을 넘습니다.
              </span>
            </div>
          )}
          {check.note && <div className="pl-[22px]">{check.note}</div>}
        </div>
      ) : !check.ok ? (
        <div className="flex items-start gap-2 rounded-[12px] bg-crit-bg px-3.5 py-2.5 text-[13.5px] text-crit-ink" role="alert">
          <AlertTriangle size={14} className="mt-[3px] shrink-0" aria-hidden />
          <span>{check.note || '이 일정은 확인되지 않았습니다. 날짜와 대상 강의를 다시 확인하세요.'}</span>
        </div>
      ) : (
        <div className="space-y-1 rounded-[12px] bg-good-bg px-3.5 py-2.5 text-[13.5px] text-good-ink">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CheckCircle2 size={14} className="shrink-0" aria-hidden />
            <span className="font-semibold">{VERDICT[draft.type] ?? '겹치는 일정 없음'}</span>
            {cap && cap.expected_people != null && (
              <span className="tnum">
                정원 안 ({cap.expected_people}/{cap.capacity}명)
              </span>
            )}
            {requested && <span className="tnum text-ink-2">이 강의실을 쓰면 AI 운전 전력 +{requested.extra_kwh.toFixed(2)} kWh</span>}
          </div>
          {check.note && <div className="pl-[22px] text-ink-2">{check.note}</div>}
        </div>
      )}
      {(check.target ?? []).length > 0 && (
        <div className="tnum flex flex-wrap items-baseline gap-x-2 text-[13.5px] text-ink-2">
          <span className="font-semibold text-ink">{draft.type === 'move' ? '옮길 강의' : '취소 대상'}</span>
          {(check.target ?? []).map((t, i) => (
            <span key={i}>
              {t.room}호 {t.start}–{t.end} {t.title}
            </span>
          ))}
        </div>
      )}

      {/* alternatives: with a problem the best free room is shown with its action, the rest one click away */}
      {showAlts.length > 0 &&
        (problems ? (
          <div>
            <div className="mb-1.5 text-[13.5px] font-semibold text-ink-2">
              그 시간에 비어 있고 정원이 맞는 강의실 <span className="font-normal text-ink-3">추가 전력이 적은 순</span>
            </div>
            <AltList alts={showAlts.slice(0, 1)} target={target} onPickRoom={onPickRoom} />
            {showAlts.length > 1 && (
              <Disclosure variant="inline" className="mt-1.5" title={`다른 빈 강의실 ${(compact ? showAlts.slice(1, 3) : showAlts.slice(1)).length}곳 보기`}>
                <AltList alts={compact ? showAlts.slice(1, 3) : showAlts.slice(1)} target={target} onPickRoom={onPickRoom} />
                {check.alternatives_note && !compact && <p className="mt-1.5 text-[13px] leading-snug text-ink-3">{check.alternatives_note}</p>}
              </Disclosure>
            )}
          </div>
        ) : (
          <Disclosure variant="inline" title={`전기를 더 적게 쓰는 빈 강의실 ${(compact ? showAlts.slice(0, 3) : showAlts).length}곳 보기`}>
            <AltList alts={compact ? showAlts.slice(0, 3) : showAlts} target={target} onPickRoom={onPickRoom} />
            {check.alternatives_note && !compact && <p className="mt-1.5 text-[13px] leading-snug text-ink-3">{check.alternatives_note}</p>}
          </Disclosure>
        ))}
      {checking && (
        <div className="flex items-center gap-1.5 text-[13px] text-ink-3" role="status">
          <Spinner size={13} /> 바뀐 내용으로 다시 확인하는 중…
        </div>
      )}
    </div>
  )
}

function AltList({ alts, target, onPickRoom }: { alts: Check['alternatives']; target: string | undefined | null; onPickRoom: (room: string) => void }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[12px] border border-line">
      {alts.map((a) => (
        <li key={a.room} className="flex items-center gap-3 bg-surface px-3.5 py-2.5 text-[13.5px]">
          <div className="min-w-0 flex-1">
            <div className="text-ink">
              <b className="font-semibold">{a.room}호</b>{' '}
              <span className="text-ink-3">
                {a.type}, {a.capacity}석
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tnum text-ink-2">
                추가 전력 {a.extra_kwh >= 0 ? '+' : '−'}
                {Math.abs(a.extra_kwh).toFixed(2)} kWh
              </span>
              {a.odu_already_on && (
                <Badge tone="ai" title={`${a.odu}가 그 시간에 이미 가동 중이라 함께 쓰면 효율적입니다`}>
                  <Fan size={12} aria-hidden /> {a.odu.replace('ODU-', '실외기 ')} 이미 가동
                </Badge>
              )}
            </div>
          </div>
          {a.room === target ? (
            <Badge tone="outline">선택됨</Badge>
          ) : (
            <Button size="sm" onClick={() => onPickRoom(a.room)}>
              이 강의실로 변경
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
