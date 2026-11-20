import { useEffect, useRef, useState } from 'react'
import { Bot, Check, Download, FileUp, Hand, Sparkles } from 'lucide-react'
import { apiSend, invalidateAll, pollJob } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { ImportPreview, ImportResponse, Job, OpModeKey, TierDay, TierPlan } from '../lib/types'
import { Ondy } from './PublicShell'
import { RunSteps, useTierRun } from './TierRun'
import { cx, fmtKwh, fmtNum, parseDate, weekdayOf } from '../lib/format'
import { Button, ErrorBox, Modal, Spinner, toast } from './ui'

const WEEK = ['월', '화', '수', '목', '금', '토', '일']

export interface AppliedSummary {
  month: string
  kwh: number
  baseline_kwh: number
  saving_pct: number | null
  cost_krw: number
  sessions: number
  mode: OpModeKey
}

function MonthMini({ days }: { days: TierDay[] }) {
  if (!days.length) return null
  const max = Math.max(...days.map((d) => d.kwh), ...days.map((d) => d.baseline_kwh), 1)
  const lead = weekdayOf(days[0].date)
  const cells: (TierDay | null)[] = [...Array(lead).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-medium text-ink-3">
        {WEEK.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) =>
          d ? (
            <div
              key={d.date}
              className={cx('h-[46px] rounded-[8px] border px-1.5 py-1', d.holiday ? 'border-line bg-well' : 'border-line')}
              title={`${d.date} 수업 ${d.sessions}회 · AI ${fmtKwh(d.kwh)} kWh · 현재 운영 ${fmtKwh(d.baseline_kwh)} kWh`}
            >
              <div className="tnum text-[12px] font-semibold text-ink">{parseDate(d.date).getDate()}</div>
              {d.sessions > 0 && (
                <div className="mt-1 space-y-0.5" aria-hidden>
                  <div className="h-1.5 rounded-full bg-[#b9bec6]" style={{ width: `${(d.baseline_kwh / max) * 100}%` }} />
                  <div className="h-1.5 rounded-full bg-s-ai" style={{ width: `${(d.kwh / max) * 100}%` }} />
                </div>
              )}
            </div>
          ) : (
            <div key={i} />
          ),
        )}
      </div>
      <div className="mt-2 flex gap-4 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-[#b9bec6]" /> 현재 운영
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-4 rounded-full bg-s-ai" /> AI 1차 계획
        </span>
      </div>
    </div>
  )
}

/**
 * Dashboard flow: upload the timetable → see what was read → reflect it and build the 1차 (monthly) plan
 * → choose auto or recommend → apply. The dashboard then switches from the current operation to AI.
 */
export default function TimetableApply({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: (s: AppliedSummary) => void }) {
  const { setApplied } = useAuth()
  const [stage, setStage] = useState<'upload' | 'reading' | 'preview' | 'planning' | 'plan'>('upload')
  const [file, setFile] = useState<string>('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [plan, setPlan] = useState<TierPlan | null>(null)
  const run = useTierRun(1, null)
  const [mode, setMode] = useState<OpModeKey>('recommend')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setStage('upload')
      setPreview(null)
      setPlan(null)
      setErr(null)
    }
  }, [open])

  async function read(f: File) {
    setErr(null)
    setFile(f.name)
    setStage('reading')
    try {
      const fd = new FormData()
      fd.append('file', f)
      fd.append('hint', '')
      const r = await apiSend<ImportResponse>('POST', '/api/import', fd)
      let pv = r.preview
      if (r.mode === 'job' && r.job) {
        const j = await pollJob<{ preview: ImportPreview }>(r.job, undefined, { timeoutMs: 240_000 })
        if (j.status === 'error') throw new Error(j.error || '이미지에서 시간표를 읽지 못했습니다.')
        pv = (j as Job<{ preview: ImportPreview }>).result?.preview
      }
      if (!pv || !Array.isArray(pv.courses) || !pv.courses.length) throw new Error('파일에서 강의를 찾지 못했습니다. 형식을 확인하세요.')
      setPreview(pv)
      setStage('preview')
    } catch (e) {
      setErr((e as Error).message)
      setStage('upload')
    }
  }

  async function reflect() {
    if (!preview) return
    setErr(null)
    setStage('planning')
    try {
      await apiSend('POST', '/api/import/commit', { courses: preview.courses, source: file || '시간표', scope: 'rooms' })
      invalidateAll()
    } catch (e) {
      setErr((e as Error).message)
      setStage('preview')
      return
    }
    // the 1차 plan is computed now, as a server job whose real steps and timings show below
    await run.start()
  }
  useEffect(() => {
    if (stage !== 'planning') return
    if (run.result) {
      setPlan(run.result.plan)
      setStage('plan')
    } else if (run.err) {
      setErr(run.err)
      setStage('preview')
    }
  }, [run.result, run.err, stage])

  async function apply() {
    if (!plan) return
    setBusy(true)
    try {
      await apiSend('PUT', '/api/mode', { mode })
      invalidateAll()
      setApplied(true)
      onApplied({
        month: plan.period.label,
        kwh: plan.summary.kwh,
        baseline_kwh: plan.summary.baseline_kwh,
        saving_pct: plan.summary.saving_pct,
        cost_krw: plan.summary.cost_krw,
        sessions: plan.summary.sessions,
        mode,
      })
      toast(mode === 'auto' ? 'AI 자동 운전을 적용했습니다.' : 'AI 추천 모드를 적용했습니다. 조정안은 승인 후 반영됩니다.')
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rooms = preview ? [...new Set(preview.courses.map((c) => c.room))].sort() : []

  return (
    <Modal open={open} onClose={onClose} title="시간표 넣고 AI 1차 스케줄 만들기" width={760}>
      <ol className="mb-7 grid grid-cols-4 gap-3 text-[13px]">
        {['시간표 올리기', '읽은 내용 확인', '1차 스케줄', 'AI 운전 적용'].map((t, i) => {
          const at = stage === 'upload' || stage === 'reading' ? 0 : stage === 'preview' ? 1 : stage === 'planning' ? 2 : 3
          return (
            <li key={t} aria-current={i === at ? 'step' : undefined}>
              <span className={cx('block h-[3px] rounded-full transition-colors duration-300', i < at ? 'bg-brand/35' : i === at ? 'bg-brand' : 'bg-line')} aria-hidden />
              <span className={cx('mt-2.5 flex items-center gap-1.5 font-semibold', i === at ? 'text-ink' : i < at ? 'text-ink-2' : 'text-ink-4')}>
                {i < at ? <Check size={13} className="text-brand-ink" aria-hidden /> : <span className={cx('tnum', i === at && 'text-brand-ink')}>{String(i + 1).padStart(2, '0')}</span>}
                {t}
              </span>
            </li>
          )
        })}
      </ol>

      {err && (
        <div className="mb-4">
          <ErrorBox title="진행하지 못했습니다" error={err} />
        </div>
      )}

      {(stage === 'upload' || stage === 'reading') && (
        <div>
          <p className="text-[14.5px] leading-relaxed text-ink-2">
            학사 시스템에서 내려받은 강의 시간표를 올리세요. CSV·Excel·JSON은 바로 읽고, 이미지·PDF는 AI(Bedrock)가 표로 옮깁니다. 지금은 시간표가 없어 모든 강의실을 중앙 제어 고정 스케줄로
            운전하고 있습니다.
          </p>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xlsm,.json,.png,.jpg,.jpeg,.webp,.pdf"
            className="sr-only"
            id="tt-file"
            onChange={(e) => e.target.files?.[0] && read(e.target.files[0])}
          />
          <label
            htmlFor="tt-file"
            className={cx(
              'relative mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[22px] border-2 border-dashed border-line-strong bg-[#fafafb] px-6 pt-8 pb-10 text-center transition-colors hover:border-brand hover:bg-brand-bg',
              stage === 'reading' && 'pointer-events-none opacity-70',
            )}
          >
            <Ondy pose="schedule" size={96} className={cx('mb-2', stage === 'reading' && 'animate-pulse')} />
            <span className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-ink">
              {stage === 'reading' ? <Spinner size={16} /> : <FileUp size={17} className="text-brand" aria-hidden />}
              {stage === 'reading' ? `${file} 읽는 중…` : '시간표 파일 선택'}
            </span>
            <span className="text-[13px] text-ink-3">CSV, XLSX, JSON, PNG·JPG, PDF (최대 5MB)</span>
          </label>
          <a href="/api/import/sample.csv" className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-brand-ink hover:underline" download>
            <Download size={14} aria-hidden /> 예시 시간표 받기 (부산대 IT관 2026-2학기 CSV)
          </a>
        </div>
      )}

      {stage === 'preview' && preview && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['강의', `${fmtNum(preview.count)}개`],
              ['강의실', `${rooms.length}곳`],
              ['새로 추가', `${fmtNum(preview.added.length)}개`],
              ['그대로', `${fmtNum(preview.unchanged)}개`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[16px] bg-well px-4 py-3">
                <div className="text-[12.5px] font-medium text-ink-3">{k}</div>
                <div className="tnum mt-0.5 text-[22px] font-[780] tracking-[-0.035em] text-ink">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[13px] text-ink-3">
            {file} · 강의실 {rooms.join(', ')}
          </div>
          <div className="mt-3 max-h-[220px] overflow-auto rounded-[16px] border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-well text-ink-3">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">강의실</th>
                  <th className="px-3 py-2 text-left font-medium">요일</th>
                  <th className="px-3 py-2 text-left font-medium">시간</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-right font-medium">예상 인원</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {preview.courses.slice(0, 40).map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-1.5">{c.room}</td>
                    <td className="px-3 py-1.5">{c.weekday != null ? WEEK[c.weekday] : c.date}</td>
                    <td className="px-3 py-1.5">
                      {c.start}~{c.end}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{c.class_name}</td>
                    <td className="px-3 py-1.5 text-right">{c.expected_people}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex justify-between gap-3">
            <Button variant="ghost" onClick={() => setStage('upload')}>
              다른 파일
            </Button>
            <Button variant="primary" onClick={reflect}>
              <Sparkles size={15} aria-hidden /> 반영하고 1차 스케줄 만들기
            </Button>
          </div>
        </div>
      )}

      {stage === 'planning' && (
        <div className="py-2">
          <div className="mb-5 flex items-end gap-5">
            <Ondy pose="hvac" size={84} pop />
            <p className="pb-1 text-[18px] leading-[1.35] font-[650] tracking-[-0.015em] text-ink">수업에 맞춰 1차 계획을 계산하는 중입니다</p>
          </div>
          <RunSteps tier={1} steps={run.steps ?? []} shown={run.shown} running={run.running} done={run.done} />
        </div>
      )}

      {stage === 'plan' && plan && (
        <div>
          <div className="flex items-start gap-5">
            <p className="min-w-0 flex-1 text-[17px] leading-[1.55] font-medium text-ink">{plan.summary.sentence}</p>
            <Ondy pose="comfort" size={96} pop className="max-sm:hidden" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-[16px] bg-well px-4 py-3">
              <div className="text-[12.5px] font-medium text-ink-3">현재 운영 (고정 스케줄)</div>
              <div className="tnum mt-0.5 text-[22px] font-[780] tracking-[-0.035em] text-ink-2">
                {fmtKwh(plan.summary.baseline_kwh)} <span className="text-[13px] font-medium text-ink-3">kWh</span>
              </div>
            </div>
            <div className="rounded-[16px] bg-ink px-4 py-3 text-white">
              <div className="text-[12.5px] font-medium text-white/65">AI 1차 계획</div>
              <div className="tnum mt-0.5 text-[22px] font-[780] tracking-[-0.035em]">
                {fmtKwh(plan.summary.kwh)} <span className="text-[13px] font-medium text-white/60">kWh</span>
              </div>
            </div>
            <div className="rounded-[16px] bg-brand-bg px-4 py-3">
              <div className="text-[12.5px] font-medium text-brand-ink">{plan.period.label} 절감</div>
              <div className="tnum mt-0.5 text-[22px] font-[780] tracking-[-0.035em] text-brand-ink">{plan.summary.saving_pct != null ? `−${plan.summary.saving_pct}%` : '–'}</div>
            </div>
          </div>
          <div className="mt-4">
            <MonthMini days={plan.days ?? []} />
          </div>
          <div className="mt-5">
            <div className="text-[16px] font-bold tracking-[-0.015em] text-ink">어떻게 적용할까요?</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="운전 모드">
              {(
                [
                  { k: 'recommend', icon: Hand, t: '추천만 받기', d: '조정안은 담당자가 승인한 것만 중앙제어기로 보냅니다. 처음 도입할 때 권합니다.' },
                  { k: 'auto', icon: Bot, t: '자동 운전', d: '작은 조정은 AI가 바로 적용하고, 큰 변경만 승인을 기다립니다.' },
                ] as const
              ).map((o) => (
                <button
                  key={o.k}
                  type="button"
                  role="radio"
                  aria-checked={mode === o.k}
                  onClick={() => setMode(o.k)}
                  className={cx(
                    'rounded-[18px] border p-4 text-left transition-colors',
                    mode === o.k ? 'border-brand bg-brand-bg shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line hover:border-line-strong',
                  )}
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                    <o.icon size={15} aria-hidden /> {o.t}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-3">{o.d}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <Button variant="primary" className="h-12 px-6 text-[15px]" onClick={apply} disabled={busy}>
              {busy ? <Spinner size={15} /> : <Sparkles size={15} aria-hidden />} AI 운전 적용
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
