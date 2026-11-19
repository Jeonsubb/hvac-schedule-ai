import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, RotateCcw, Save, Info, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react'
import { apiSend, invalidateAll, useApi } from '../lib/api'
import { useMeta, useCopilot } from '../lib/context'
import type { Settings, StrategyKey, WhatIf } from '../lib/types'
import { COLD_START, ROOM_ORDER, SETTING_LABEL, STRATEGY } from '../lib/constants'
import { addDays, cx, fmtDateK, fmtKwh, fmtPct, weekdayOf } from '../lib/format'
import { Badge, Button, Card, CardHeader, Disclosure, DisclosureList, ErrorBox, Field, Modal, Note, PageHeader, PageSkeleton, Spinner, StrategyName, inputBase, inputCls, tbl, toast } from '../components/ui'

type NumKey =
  | 'pre_on_min'
  | 'early_off_min'
  | 'gap_merge_min'
  | 'sp_heat'
  | 'sp_cool'
  | 'comfort_low'
  | 'comfort_high'
  | 'ai_max_lead_min'
  | 'ai_max_early_off_min'

type Sec = { key: string; title: string; desc: string; fields: { k: NumKey; label: string; step: number; min: number; max: number; unit: string; help: string }[] }

// plain-language labels; the technical names (SETTING_LABEL) stay for proposals and the audit log
const SECTIONS: Sec[] = [
  {
    key: 'temp',
    title: '설정온도와 쾌적 범위',
    desc: '실내기 설정온도와 "쾌적"으로 판정하는 실내온도 범위입니다. 모든 운전 방식에 적용됩니다.',
    fields: [
      { k: 'sp_heat', label: '난방 설정온도', step: 0.5, min: 16, max: 24, unit: '℃', help: '난방 설정온도' },
      { k: 'sp_cool', label: '냉방 설정온도', step: 0.5, min: 22, max: 30, unit: '℃', help: '냉방 설정온도' },
      { k: 'comfort_low', label: '쾌적 하한', step: 0.5, min: 15, max: 23, unit: '℃', help: '이보다 낮으면 쾌적 이탈' },
      { k: 'comfort_high', label: '쾌적 상한', step: 0.5, min: 24, max: 30, unit: '℃', help: '이보다 높으면 쾌적 이탈' },
    ],
  },
  {
    key: 'rule',
    title: '규칙 기반 운전 시각',
    desc: '시간표만 보고 켜고 끄는 기본 규칙입니다. AI가 판단하지 못할 때의 안전 기준이기도 합니다.',
    fields: [
      { k: 'pre_on_min', label: '시작 전 미리 켜기', step: 1, min: 0, max: 60, unit: '분', help: '강의 시작 몇 분 전에 켤지' },
      { k: 'early_off_min', label: '종료 전 미리 끄기', step: 1, min: 0, max: 30, unit: '분', help: '강의 종료 몇 분 전에 끌지' },
      { k: 'gap_merge_min', label: '켜 둘 짧은 공백', step: 1, min: 0, max: 60, unit: '분', help: '강의 사이 공백이 이보다 짧으면 끄지 않음' },
    ],
  },
]

const AI_SECTION: Sec = {
  key: 'ai',
  title: 'AI 예측 제어 한계',
  desc: 'AI가 스스로 조정할 수 있는 범위의 상한(안전장치)입니다.',
  fields: [
    { k: 'ai_max_lead_min', label: '최대 선행 가동', step: 5, min: 0, max: 180, unit: '분', help: '최적 기동 시 최대 선행 시간' },
    { k: 'ai_max_early_off_min', label: '최대 조기 정지', step: 1, min: 0, max: 45, unit: '분', help: '관성 정지 시 최대 조기 정지' },
  ],
}

const EDIT_KEYS: (keyof Settings)[] = [
  'pre_on_min',
  'early_off_min',
  'gap_merge_min',
  'sp_heat',
  'sp_cool',
  'comfort_low',
  'comfort_high',
  'ai_max_lead_min',
  'ai_max_early_off_min',
  'baseline',
  'anomalies',
]

export default function SettingsPage() {
  const { meta, reload: reloadMeta } = useMeta()
  const cur = useApi<Settings>('/api/settings')
  const [form, setForm] = useState<Partial<Settings>>({})
  const [wi, setWi] = useState<WhatIf | null>(null)
  const [wiBusy, setWiBusy] = useState(false)
  const [wiErr, setWiErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'save' | 'reset' | null>(null)
  const today = meta?.now.date ?? '2026-11-20'
  const monday = addDays(today, -weekdayOf(today))
  const [wiStart, setWiStart] = useState(monday)
  const [wiDays, setWiDays] = useState(5)

  useEffect(() => {
    if (cur.data) setForm(Object.fromEntries(EDIT_KEYS.map((k) => [k, cur.data![k]])) as Partial<Settings>)
  }, [cur.data])

  const changes = useMemo(() => {
    if (!cur.data) return {}
    const out: Record<string, unknown> = {}
    for (const k of EDIT_KEYS) if (form[k] !== undefined && form[k] !== cur.data[k]) out[k] = form[k]
    return out
  }, [form, cur.data])
  const nChanged = Object.keys(changes).length
  // mirrors the backend rule: setpoints must sit at least 0.3 ℃ inside the comfort band
  const MARGIN = 0.3
  const lo = form.comfort_low ?? 0
  const hi = form.comfort_high ?? 99
  const problems: Partial<Record<NumKey, string>> = {}
  if (lo >= hi) problems.comfort_low = '쾌적 하한은 상한보다 낮아야 합니다.'
  if ((form.sp_heat ?? 0) >= (form.sp_cool ?? 99)) problems.sp_heat = '난방 설정온도는 냉방 설정온도보다 낮아야 합니다.'
  else if (form.sp_heat != null && form.sp_heat < lo + MARGIN - 1e-9)
    problems.sp_heat = `쾌적 하한(${lo}℃)보다 ${MARGIN}℃ 이상 높아야 합니다. ${(lo + MARGIN).toFixed(1)}℃ 이상으로 정하세요.`
  if (form.sp_cool != null && form.sp_cool > hi - MARGIN + 1e-9)
    problems.sp_cool = `쾌적 상한(${hi}℃)보다 ${MARGIN}℃ 이상 낮아야 합니다. ${(hi - MARGIN).toFixed(1)}℃ 이하로 정하세요.`
  const invalid = Object.keys(problems).length > 0
  const [saveErr, setSaveErr] = useState<string | null>(null)

  useEffect(() => {
    setWi(null)
  }, [form])

  const preview = async () => {
    setWiBusy(true)
    setWiErr(null)
    try {
      const r = await apiSend<WhatIf>('POST', '/api/whatif', { overrides: changes, start_date: wiStart, days: wiDays })
      setWi(r)
    } catch (e) {
      setWiErr((e as Error).message)
    } finally {
      setWiBusy(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setSaveErr(null)
    try {
      await apiSend('PUT', '/api/settings', changes)
      invalidateAll()
      reloadMeta()
      toast('운영 규칙을 저장했습니다. 학기 전체 운전 계획을 다시 계산합니다.')
    } catch (e) {
      // e.g. 400 with a Korean detail (setpoint too close to the comfort band): show it on the page
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  const reset = async () => {
    setSaving(true)
    try {
      await apiSend('POST', '/api/settings/reset')
      invalidateAll()
      reloadMeta()
      toast('기본 운영 규칙으로 되돌렸습니다.')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setSaving(false)
      setConfirm(null)
    }
  }

  if (cur.error) return <ErrorBox title="운영 규칙을 불러오지 못했습니다" error={cur.error} onRetry={cur.reload} />
  if (!cur.data || !meta) return <PageSkeleton label="운영 규칙을 불러오는 중…" />
  const S = cur.data

  const fields = (sec: Sec) => (
    <>
      <div className={cx('grid grid-cols-2 gap-x-4 gap-y-5', sec.fields.length === 4 ? 'lg:grid-cols-4' : sec.fields.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
        {sec.fields.map((f) => {
          const changed = f.k in changes
          return (
            <Field
              key={f.k}
              label={f.label}
              hint={
                changed ? (
                  <span className="tnum font-semibold text-info-ink">
                    지금 {String(S[f.k])}
                    {f.unit} → {String(form[f.k])}
                    {f.unit}
                  </span>
                ) : undefined
              }
            >
              <div className="relative" title={f.help}>
                <input
                  type="number"
                  inputMode="decimal"
                  name={f.k}
                  autoComplete="off"
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  aria-invalid={!!problems[f.k]}
                  aria-description={f.help}
                  className={cx(inputCls, 'tnum pr-10 text-[15px]', changed && 'border-s-rule bg-info-bg', problems[f.k] && 'border-crit bg-crit-bg')}
                  value={(form[f.k] as number | undefined) ?? ''}
                  onChange={(e) => setForm((x) => ({ ...x, [f.k]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13.5px] text-ink-3">{f.unit}</span>
              </div>
            </Field>
          )
        })}
      </div>
      {sec.fields.some((f) => problems[f.k]) && (
        <ul className="mt-4 space-y-1 text-[13.5px] text-crit-ink" role="alert">
          {sec.fields
            .filter((f) => problems[f.k])
            .map((f) => (
              <li key={f.k} className="flex items-start gap-1.5">
                <AlertTriangle size={14} className="mt-[3px] shrink-0" aria-hidden />
                <span>
                  <b className="font-semibold">{f.label}</b>: {problems[f.k]}
                </span>
              </li>
            ))}
        </ul>
      )}
    </>
  )
  const aiChanged = AI_SECTION.fields.filter((f) => f.k in changes).length
  const optChanged = ['baseline', 'anomalies'].filter((k) => k in changes).length

  return (
    <div>
      <PageHeader
        title="운영 규칙"
        desc="값을 바꾸면 저장하기 전에 시뮬레이션으로 전력과 쾌적 변화를 먼저 확인합니다. 모든 변경은 변경 기록에 남습니다."
        right={
          <>
            <Button variant="ghost" onClick={() => setConfirm('reset')}>
              <RotateCcw size={15} aria-hidden /> 기본값으로
            </Button>
            <Button variant="primary" disabled={!nChanged || invalid || saving} onClick={() => setConfirm('save')}>
              <Save size={15} aria-hidden /> {nChanged > 0 ? `변경 ${nChanged}개 저장` : '저장'}
            </Button>
          </>
        }
      />

      {saveErr && (
        <div className="mb-5">
          <ErrorBox title="저장하지 못했습니다" error={saveErr} />
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {SECTIONS.map((sec) => (
            <Card key={sec.key}>
              <CardHeader title={sec.title} sub={sec.desc} />
              {fields(sec)}
            </Card>
          ))}

          <DisclosureList title="고급 설정과 참고 정보" hideTitle>
            <Disclosure title="AI 예측 제어 한계" summary={aiChanged ? `변경 ${aiChanged}개` : `선행 최대 ${S.ai_max_lead_min}분, 조기 정지 최대 ${S.ai_max_early_off_min}분`} defaultOpen={AI_SECTION.fields.some((f) => problems[f.k])}>
              <p className="mb-4 text-[13.5px] text-ink-3">{AI_SECTION.desc}</p>
              {fields(AI_SECTION)}
            </Disclosure>
            <Disclosure title="비교 기준과 시연 옵션" summary={optChanged ? `변경 ${optChanged}개` : `${STRATEGY[(form.baseline as StrategyKey) ?? 'fixed']?.label ?? '고정 스케줄'} 기준, 현장 이상 ${form.anomalies ? '켜짐' : '꺼짐'}`}>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Field label={SETTING_LABEL.baseline} hint="절감률(%)을 무엇과 비교할지 정합니다.">
                  <select
                    name="baseline"
                    className={cx(inputCls, 'baseline' in changes && 'border-s-rule bg-info-bg')}
                    value={String(form.baseline ?? 'fixed')}
                    onChange={(e) => setForm((x) => ({ ...x, baseline: e.target.value }))}
                  >
                    {(['fixed', 'manual', 'rule'] as StrategyKey[]).map((k) => (
                      <option key={k} value={k}>
                        {STRATEGY[k].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium text-ink-2" id="anomalies-label">
                    {SETTING_LABEL.anomalies}
                  </span>
                  <label
                    className={cx(
                      'flex h-10 cursor-pointer items-center justify-between rounded-[10px] border px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                      'anomalies' in changes ? 'border-s-rule bg-info-bg' : 'border-line-strong',
                    )}
                  >
                    <span className="text-[14px] text-ink">{form.anomalies ? '켜짐' : '꺼짐'}</span>
                    <input
                      type="checkbox"
                      name="anomalies"
                      aria-labelledby="anomalies-label"
                      className="peer sr-only"
                      checked={!!form.anomalies}
                      onChange={(e) => setForm((x) => ({ ...x, anomalies: e.target.checked }))}
                    />
                    <span className={cx('relative h-5 w-9 rounded-full transition-colors duration-150', form.anomalies ? 'bg-ink' : 'bg-line-strong')} aria-hidden>
                      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-[0_1px_2px_rgb(20_32_51/0.25)] transition-transform duration-150', form.anomalies ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                    </span>
                  </label>
                  <span className="mt-1.5 block text-[13px] text-ink-3">
                    무단 휴강, 명령 실패({fmtPct(S.failure_rate * 100, 0)}), 수동 가동({fmtPct(S.override_rate * 100, 0)}) 같은 상황을 넣어 자동 조치를 검증합니다.
                  </span>
                </div>
              </div>
              <div className="tnum mt-5 grid grid-cols-2 gap-x-4 gap-y-2 rounded-[12px] bg-well p-4 text-[13.5px] text-ink-2">
                <div>
                  고정 스케줄 <b className="text-ink">{S.fixed_on}–{S.fixed_off}</b>
                </div>
                <div>
                  수동 운영 정지 지연 <b className="text-ink">{S.manual_off_delay_min}분</b>
                </div>
                <div>
                  빈 강의실 자동 정지 <b className="text-ink">{S.auto_off_after_min}분</b>
                </div>
                <div>
                  제습 기준 <b className="text-ink">RH {S.dehum_rh}%, {S.dehum_temp}℃</b>
                </div>
              </div>
            </Disclosure>
            <Disclosure title="설비 정보" summary={`강의실 ${Object.keys(meta.rooms).length}개, 실외기 ${Object.keys(meta.odus).length}대`}>
              <Equipment />
            </Disclosure>
            <Disclosure title="전기요금과 탄소 배출계수" summary={`교육용(을) 고압A, ${S.co2_kg_per_kwh} kgCO₂/kWh`}>
              <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <Tariff s={S} />
                <div>
                  <div className="text-[14px] font-semibold text-ink">탄소 배출계수</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="tnum text-[30px] font-[650] tracking-[-0.02em] text-ink">{S.co2_kg_per_kwh}</span>
                    <span className="text-[14px] text-ink-3">kgCO₂eq / kWh</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-[13.5px] text-ink-2">
                    <div>
                      <b className="font-semibold text-ink">출처</b> 2023년도 국가 전력배출계수 0.4173 tCO₂eq/MWh (기후에너지환경부 공표 기준)
                    </div>
                    <div>
                      <b className="font-semibold text-ink">적용</b> 운전 방식별 전력량(kWh) × 계수 = 배출량. 절감 효과 화면의 tCO₂ 값에 쓰입니다.
                    </div>
                  </div>
                </div>
              </div>
            </Disclosure>
          </DisclosureList>
        </div>

        <Card className="xl:sticky xl:top-[88px]">
          <CardHeader title="시뮬레이션으로 미리보기" sub="바꾼 값으로 실제 시간표와 날씨를 다시 돌려 지금 규칙과 비교합니다. 저장 전이라 운영에는 영향이 없습니다." />
          {nChanged > 0 ? (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {Object.entries(changes).map(([k, v]) => (
                <Badge key={k} tone="info">
                  {SETTING_LABEL[k] ?? k}: {String(S[k])} → {String(v)}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="mb-4">
              <Note icon={<Info size={15} className="text-ink-3" aria-hidden />}>왼쪽에서 값을 하나 이상 바꾸면 미리보기를 실행할 수 있습니다.</Note>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="시작일">
              <input type="date" name="whatif-start" className={cx(inputBase, 'tnum w-[156px]')} value={wiStart} min={meta.semester.start} max={meta.semester.end} onChange={(e) => setWiStart(e.target.value)} />
            </Field>
            <Field label="기간">
              <select name="whatif-days" className={cx(inputBase, 'w-[92px]')} value={wiDays} onChange={(e) => setWiDays(Number(e.target.value))}>
                {[1, 3, 5, 7].map((d) => (
                  <option key={d} value={d}>
                    {d}일
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="primary" onClick={preview} disabled={!nChanged || invalid || wiBusy}>
              {wiBusy ? <Spinner className="text-white" /> : <FlaskConical size={15} aria-hidden />}
              미리보기 실행
            </Button>
          </div>
          <div className="tnum mt-2 text-[13px] text-ink-3">
            {fmtDateK(wiStart)} ~ {fmtDateK(addDays(wiStart, wiDays - 1))}
          </div>
          {wiErr && (
            <div className="mt-4">
              <ErrorBox error={wiErr} />
            </div>
          )}
          {wi && <WhatIfTable wi={wi} />}
          <CopilotHint />
        </Card>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm === 'reset' ? '기본 운영 규칙으로 되돌리기' : '운영 규칙 저장'}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>취소</Button>
            <Button variant="primary" onClick={confirm === 'reset' ? reset : save} disabled={saving}>
              {saving ? <Spinner className="text-white" /> : <CheckCircle2 size={15} aria-hidden />}
              {confirm === 'reset' ? '되돌리기' : '저장'}
            </Button>
          </>
        }
      >
        {confirm === 'save' ? (
          <div className="space-y-2.5 text-[14px] text-ink-2">
            <p>다음 변경을 저장하면 오늘 이후 운전 계획과 학기 비교 결과가 다시 계산됩니다.</p>
            <ul className="space-y-1">
              {Object.entries(changes).map(([k, v]) => (
                <li key={k} className="flex justify-between rounded-[10px] bg-well px-3 py-2">
                  <span>{SETTING_LABEL[k] ?? k}</span>
                  <span className="tnum font-medium text-ink">
                    {String(S[k])} → {String(v)}
                  </span>
                </li>
              ))}
            </ul>
            {!wi && <p className="text-[13.5px] text-warn-ink">아직 미리보기를 실행하지 않았습니다. 오른쪽 패널에서 효과를 먼저 확인할 수 있습니다.</p>}
          </div>
        ) : (
          <p className="text-[14px] text-ink-2">모든 운영 규칙을 초기값(선행 가동 10분, 조기 정지 5분, 공백 유지 15분, 난방 20℃, 냉방 26℃ 등)으로 되돌리고 운전 계획을 다시 계산합니다.</p>
        )}
      </Modal>
    </div>
  )
}

export function WhatIfTable({ wi, compact = false }: { wi: WhatIf; compact?: boolean }) {
  const keys: StrategyKey[] = ['ai', 'rule', 'manual', 'fixed']
  const cell = (b: string, n: string, d: number, good: boolean, fmt: (x: number) => string) => (
    <td className="py-1.5 text-right align-top">
      <div className="whitespace-nowrap">
        <span className="text-ink-3">{b} →</span> {n}
      </div>
      <Change v={d} good={good} fmt={fmt} />
    </td>
  )
  return (
    <div className={cx('fade-in', compact ? 'mt-2' : 'mt-5 border-t border-line pt-4')}>
      {!compact && <div className="mb-2 text-[13.5px] text-ink-3">{wi.dates.length}일 합계, 지금 규칙 → 바꾼 규칙</div>}
      <table className={cx('tnum w-full', compact ? 'text-[13px]' : 'text-[13.5px]')}>
        <thead className="text-[13px] text-ink-3">
          <tr>
            <th className="py-1.5 text-left font-medium">운전 방식</th>
            <th className="py-1.5 text-right font-medium">전력량 kWh</th>
            <th className="py-1.5 text-right font-medium">쾌적 %</th>
            <th className="py-1.5 text-right font-medium whitespace-nowrap" title={COLD_START.desc}>
              {COLD_START.short}(회)
            </th>
          </tr>
        </thead>
        <tbody>
          {keys
            .filter((k) => wi.base[k] && wi.new[k])
            .map((k) => {
              const b = wi.base[k]
              const n = wi.new[k]
              const dk = n.kwh - b.kwh
              const dc = (n.comfort_pct ?? 0) - (b.comfort_pct ?? 0)
              const hasCold = b.cold_starts != null && n.cold_starts != null
              const dcs = (n.cold_starts ?? 0) - (b.cold_starts ?? 0)
              return (
                <tr key={k} className={cx('border-t border-line', k === 'ai' && 'font-medium')}>
                  <td className="py-1.5 align-top">
                    <StrategyName k={k} short={compact} />
                  </td>
                  {cell(fmtKwh(b.kwh), fmtKwh(n.kwh), dk, dk < 0, (x) => fmtKwh(x))}
                  {cell(fmtPct(b.comfort_pct), fmtPct(n.comfort_pct), dc, dc > 0, (x) => x.toFixed(1))}
                  {hasCold ? cell(String(b.cold_starts), String(n.cold_starts), dcs, dcs < 0, (x) => String(Math.round(x))) : <td className="py-1.5 text-right align-top">–</td>}
                </tr>
              )
            })}
        </tbody>
      </table>
      {!compact && (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
          규칙 값은 주로 &lsquo;규칙 기반&rsquo;에, 설정온도와 쾌적 범위는 모든 방식에 영향을 줍니다. 시작 이탈은 강의가 시작될 때 실내가 쾌적 범위 밖(너무 춥거나 더움)이었던 횟수입니다.
        </p>
      )}
    </div>
  )
}

function Change({ v, good, fmt }: { v: number; good: boolean; fmt: (x: number) => string }) {
  if (Math.abs(v) < 0.05) return <div className="text-[13px] text-ink-3">변화 없음</div>
  return (
    <div className={cx('text-[13px] font-semibold', good ? 'text-good-ink' : 'text-crit-ink')}>
      {v > 0 ? '+' : '−'}
      {fmt(Math.abs(v))}
    </div>
  )
}


function CopilotHint() {
  const { ask } = useCopilot()
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      <span className="text-[13.5px] text-ink-3">어떤 값이 좋을지 모르겠다면</span>
      <Button size="sm" variant="ghost" onClick={() => ask('쾌적도를 지키면서 이번 주 전력을 더 줄일 규칙을 제안해줘')}>
        <Sparkles size={14} aria-hidden /> 코파일럿에게 추천받기
      </Button>
    </div>
  )
}

function Equipment() {
  const { meta } = useMeta()
  if (!meta) return null
  const rooms = ROOM_ORDER.map((r) => meta.rooms[r]).filter(Boolean)
  // when every row is an assumption, say it once in the header instead of on every row
  const allAssumed = rooms.every((r) => r.assumption)
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-ink-3">강의실, 실내기(IDU), 실외기(ODU) 구성입니다.</p>
        <Badge tone="warn" title="설비 대장 확인 전 추정치">
          {allAssumed ? '모든 값이 가정값: 설비 대장과 대조 필요' : '가정값: 설비 대장과 대조 필요'}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className={tbl.frame}>
          <table className={tbl.table}>
            <thead className={tbl.thead}>
              <tr>
                <th className={tbl.th}>강의실</th>
                <th className={tbl.th}>유형</th>
                <th className={tbl.thR}>면적</th>
                <th className={tbl.thR}>정원</th>
                <th className={tbl.thR}>PC</th>
                <th className={tbl.th}>실내기 (냉방/난방 kW)</th>
                <th className={tbl.th}>실외기</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id} className={tbl.tr}>
                  <td className="px-3.5 py-2 font-semibold">
                    {r.id}
                    {r.assumption && !allAssumed && (
                      <Badge tone="warn" className="ml-1.5">
                        가정값
                      </Badge>
                    )}
                  </td>
                  <td className="px-3.5 py-2 text-ink-2">{r.type_label}</td>
                  <td className="px-3.5 py-2 text-right">{r.area}㎡</td>
                  <td className="px-3.5 py-2 text-right">{r.capacity}명</td>
                  <td className="px-3.5 py-2 text-right">{r.pcs || '–'}</td>
                  <td className="px-3.5 py-2 text-ink-2">
                    {r.idus.map((i) => (
                      <div key={i.id}>
                        {i.id} <span className="text-ink-3">({i.cool_kw}/{i.heat_kw})</span>
                      </div>
                    ))}
                  </td>
                  <td className="px-3.5 py-2">{r.odu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <ul className="grid grid-cols-1 divide-y divide-line overflow-hidden rounded-[12px] border border-line md:grid-cols-3 md:divide-x md:divide-y-0">
          {Object.values(meta.odus).map((o) => {
            const rs = rooms.filter((r) => r.odu === o.id)
            const idu = rs.reduce((a, r) => a + r.idus.reduce((b, i) => b + i.cool_kw, 0), 0)
            return (
              <li key={o.id} className="px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink">{o.id}</span>
                  {!allAssumed && <Badge tone="warn">가정값</Badge>}
                </div>
                <div className="tnum mt-0.5 text-[13.5px] text-ink-2">
                  {o.label}, 용량 {o.cap_kw} kW
                </div>
                <div className="tnum mt-1 text-[13px] text-ink-3">
                  {rs.map((r) => r.id).join(', ')}호 연결, 실내기 {rs.reduce((a, r) => a + r.idus.length, 0)}대 (냉방 합계 {idu.toFixed(1)} kW)
                </div>
              </li>
            )
          })}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            실외기는 연결된 실내기가 하나라도 켜져 있으면 가동하고, 모두 꺼지면 정지합니다. 같은 실외기에 묶인 강의실끼리 강의를 모으면 실외기 가동 시간이 줄어듭니다(절감 효과의 강의실 재배치 권고).
          </p>
        </div>
      </div>
    </div>
  )
}

function Tariff({ s }: { s: Settings }) {
  const seasons: { k: 'summer' | 'spring_fall' | 'winter'; label: string; months: string }[] = [
    { k: 'summer', label: '여름철', months: '6~8월' },
    { k: 'spring_fall', label: '봄·가을철', months: '3~5월, 9~10월' },
    { k: 'winter', label: '겨울철', months: '11~2월' },
  ]
  return (
    <div>
      <div className="text-[14px] font-semibold text-ink">시간대별 전기요금</div>
      <p className="mt-0.5 mb-3 text-[13px] text-ink-3">전력량요금(원/kWh)이며 기본요금은 제외했습니다.</p>
      <table className="tnum w-full text-[14px]">
        <thead className="text-[13px] text-ink-3">
          <tr>
            <th className="py-1.5 text-left font-medium">계절</th>
            <th className="py-1.5 text-right font-medium">경부하</th>
            <th className="py-1.5 text-right font-medium">중간부하</th>
            <th className="py-1.5 text-right font-medium">최대부하</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((x) => (
            <tr key={x.k} className="border-t border-line">
              <td className="py-1.5">
                <span className="font-medium text-ink">{x.label}</span> <span className="text-[13px] text-ink-3">{x.months}</span>
              </td>
              <td className="py-1.5 text-right">{s.tariff[x.k].light}</td>
              <td className="py-1.5 text-right">{s.tariff[x.k].mid}</td>
              <td className="py-1.5 text-right font-medium">{s.tariff[x.k].peak}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 space-y-1 text-[13.5px] text-ink-2">
        <div>
          <b className="font-semibold text-ink">출처</b> 한국전력공사 전기요금표 교육용전력(을) 고압A 선택I, 2023-05-16 게시본
        </div>
        <div>경부하는 23~09시입니다. 최대부하는 겨울 10~12시, 17~20시, 22~23시, 그 외 계절 10~12시, 13~17시이고 나머지는 중간부하입니다.</div>
      </div>
    </div>
  )
}
