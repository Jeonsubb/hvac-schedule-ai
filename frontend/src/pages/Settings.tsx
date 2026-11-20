import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, RotateCcw, Save, Info, AlertTriangle, CheckCircle2, Sparkles, PlugZap, Building2, Scale, Compass, Send } from 'lucide-react'
import { apiSend, invalidate, invalidateAll, useApi } from '../lib/api'
import { useMeta, useCopilot } from '../lib/context'
import { useAuth } from '../lib/auth'
import type { BmsCommand, BuildingProfile, GatewayStatus, Policy, Settings, StrategyKey, WhatIf } from '../lib/types'
import { COLD_START, ROOM_ORDER, SETTING_LABEL, STRATEGY } from '../lib/constants'
import { addDays, cx, fmtDateK, fmtKwh, fmtPct, fmtTs, weekdayOf } from '../lib/format'
import ModeSwitch from '../components/ModeSwitch'
import OperatorNotifications from '../components/OperatorNotifications'
import { Badge, Button, Card, CardHeader, Disclosure, DisclosureList, ErrorBox, Field, Modal, Note, PageHeader, PageSkeleton, Spinner, StrategyName, inputBase, inputCls, tbl, toast, More} from '../components/ui'

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
            <ModeSwitch />
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
      <BuildingAndPolicy />
      <OperatorNotifications />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {SECTIONS.map((sec) => (
            <Card key={sec.key} flat>
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

        <Card flat className="xl:sticky xl:top-[88px]">
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
        <More className="mt-3"><p>
          규칙 값은 주로 &lsquo;규칙 기반&rsquo;에, 설정온도와 쾌적 범위는 모든 방식에 영향을 줍니다. 시작 이탈은 강의가 시작될 때 실내가 쾌적 범위 밖(너무 춥거나 더움)이었던 횟수입니다.
        </p></More>
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
          <More className="mt-3"><p>
            실외기는 연결된 실내기가 하나라도 켜져 있으면 가동하고, 모두 꺼지면 정지합니다. 같은 실외기에 묶인 강의실끼리 강의를 모으면 실외기 가동 시간이 줄어듭니다(절감 효과의 강의실 재배치 권고).
          </p></More>
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

// ---------------------------------------------------------------- 건물 연결과 정책 (v5)

const TYPE_LABEL: Record<string, string> = { school: '학교', mall: '쇼핑몰', hotel: '호텔', office: '오피스', hospital: '병원', etc: '기타' }
const METHOD_LABEL: Record<string, string> = { gateway: '현장 게이트웨이', direct: '직접 연결', file: '파일 업로드' }
const PROTOCOL_LABEL: Record<string, string> = { bacnet: 'BACnet/IP', modbus: 'Modbus TCP', vendor_api: '제조사 API', opcua: 'OPC UA' }
const ORIENTS = ['남', '북', '동', '서']

type PolicyNum = 'heat_min' | 'heat_max' | 'cool_min' | 'cool_max' | 'co2_max' | 'weather_jump_c' | 'attendance' | 'comfort_won'

const POLICY_FIELDS: { k: PolicyNum; label: string; unit: string; step: number; min: number; max: number; hint: string }[] = [
  { k: 'heat_min', label: '난방 하한', unit: '℃', step: 0.5, min: 14, max: 24, hint: '학교보건법 교실 기준 18℃ 이상' },
  { k: 'heat_max', label: '난방 상한', unit: '℃', step: 0.5, min: 16, max: 26, hint: '에너지이용 합리화법 난방 20℃ 이하(학교는 자체 기준 가능)' },
  { k: 'cool_min', label: '냉방 하한', unit: '℃', step: 0.5, min: 22, max: 30, hint: '정부 권장 냉방 26℃ 이상' },
  { k: 'cool_max', label: '냉방 상한', unit: '℃', step: 0.5, min: 24, max: 30, hint: '학교보건법 교실 기준 28℃ 이하' },
  { k: 'co2_max', label: 'CO₂ 상한', unit: 'ppm', step: 50, min: 600, max: 2000, hint: '학교보건법 교실 기준 1,000ppm' },
  { k: 'weather_jump_c', label: '날씨 급변 기준', unit: '℃', step: 0.5, min: 0.5, max: 8, hint: '예보와 실황 차이가 이보다 크면 다시 계산' },
  { k: 'attendance', label: '예상 출석률', unit: '%', step: 5, min: 20, max: 100, hint: '수강 인원이 없는 강의의 재실 인원 추정' },
  { k: 'comfort_won', label: '쾌적 가중치(판정)', unit: '원', step: 50, min: 0, max: 5000, hint: '체감(PMV) 1만큼 나빠지는 것을 강의실·하루당 몇 원으로 볼지. 작으면 절감, 크면 쾌적 쪽으로 판정합니다' },
]

/** attendance may come back as a ratio (0.75) or a percentage (75); edit it as a percentage, save it back in the same scale. */
function attendancePct(v: number) {
  return v <= 1 ? Math.round(v * 100) : Math.round(v)
}

const CMD_STATUS: Record<BmsCommand['status'], { label: string; tone: 'good' | 'info' | 'warn' | 'crit' | 'neutral' }> = {
  queued: { label: '대기', tone: 'neutral' },
  sent: { label: '게이트웨이로 전송', tone: 'info' },
  acked: { label: '쓰기·되읽기 확인', tone: 'good' },
  failed: { label: '실패', tone: 'crit' },
  refused: { label: '게이트웨이 거절', tone: 'warn' },
  blocked: { label: '읽기 전용', tone: 'warn' },
}

function CommandStatus({ c }: { c: BmsCommand }) {
  const s = CMD_STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }
  const label = c.simulated ? '시뮬레이터가 받음 · 중앙제어기 미연결' : s.label
  const title = [c.gateway_id && `게이트웨이 ${c.gateway_id}`, c.readback != null && `되읽은 값 ${c.readback}`, c.error].filter(Boolean).join(' · ')
  return (
    <span title={title || undefined}>
      <Badge tone={c.simulated ? 'neutral' : s.tone}>{label}</Badge>
    </span>
  )
}

/** Live edge gateway: is it reporting, what controller did it find, what does it read right now. */
function GatewayLive() {
  const q = useApi<GatewayStatus>('/api/gateway/status', { maxAgeMs: 10_000, refreshMs: 15_000 })
  const gs = Array.isArray(q.data?.gateways) ? q.data!.gateways : []
  if (q.error) return <ErrorBox title="게이트웨이 상태를 불러오지 못했습니다" error={q.error} onRetry={q.reload} />
  if (!q.data)
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-ink-3">
        <Spinner size={14} /> 불러오는 중…
      </div>
    )
  if (!gs.length)
    return (
      <p className="text-[13.5px] leading-relaxed text-ink-2">
        아직 연결된 게이트웨이가 없습니다. 지금은 시뮬레이터가 중앙제어기 역할을 합니다. 저장소의 <code>gateway/</code> 폴더에서 <code>python edge_gateway.py --pair 연결코드 --controller 주소:47808</code>을 실행하면 이곳에
        실시간으로 나타납니다.
      </p>
    )
  const g = gs[0]
  const temps = (g.sample ?? []).filter((p) => p.kind === 'room_temp').slice(0, 6)
  const sps = (g.sample ?? []).filter((p) => p.kind === 'setpoint' && p.point.endsWith('HeatSetpoint')).slice(0, 6)
  return (
    <div className="space-y-3 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('inline-block h-2.5 w-2.5 rounded-full', g.online ? 'bg-good' : 'bg-ink-4')} aria-hidden />
        <b className="text-[14.5px] text-ink">{g.id}</b>
        <Badge tone={g.online ? 'good' : 'neutral'}>{g.online ? `온라인 · ${g.seen_s_ago ?? 0}초 전 보고` : `오프라인 · 마지막 보고 ${g.seen_s_ago != null ? `${Math.round(g.seen_s_ago / 60)}분 전` : '없음'}`}</Badge>
        <Badge tone={g.allow_write ? 'info' : 'warn'}>{g.allow_write ? '쓰기 허용' : '읽기 전용'}</Badge>
        <span className="text-ink-3">버전 {g.version || '-'} · 연결 코드 {g.code}</span>
      </div>
      <div className="text-ink-2">
        중앙제어기 {g.controller?.protocol === 'bacnet' ? 'BACnet/IP' : g.controller?.protocol} {g.device?.address ?? `${g.controller?.host}:${g.controller?.port}`} · 장치 {g.device?.instance ?? g.controller?.device_instance} '
        {g.device?.name ?? g.controller?.device_name}' · 포인트 {g.n_points}개 · 강의실 {g.rooms_mapped ?? 0}곳 매핑
        {g.unmapped ? ` · 매핑 안 됨 ${g.unmapped}개` : ''}
      </div>
      {(temps.length > 0 || sps.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {temps.map((p) => (
            <span key={p.point} className="rounded-full bg-well px-2.5 py-1 font-mono text-[12.5px] text-ink-2" translate="no">
              {p.point} = {String(p.value)}
              {p.unit}
            </span>
          ))}
          {sps.map((p) => (
            <span key={p.point} className="rounded-full bg-info-bg px-2.5 py-1 font-mono text-[12.5px] text-info-ink" translate="no">
              {p.point} = {String(p.value)}
              {p.unit}
            </span>
          ))}
        </div>
      )}
      {g.snapshot_ts && <div className="text-[12.5px] text-ink-3">마지막 읽기 {fmtTs(g.snapshot_ts)} (BACnet ReadProperty)</div>}
    </div>
  )
}

function PolicyCommands() {
  const q = useApi<BmsCommand[]>('/api/commands?limit=20', { maxAgeMs: 15_000 })
  const rows = Array.isArray(q.data) ? q.data : []
  if (q.error) return <ErrorBox title="제어 명령 기록을 불러오지 못했습니다" error={q.error} onRetry={q.reload} />
  if (!q.data)
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-ink-3">
        <Spinner size={14} /> 불러오는 중…
      </div>
    )
  if (!rows.length) return <p className="text-[13.5px] text-ink-3">아직 보낸 제어 명령이 없습니다. 조정안이 적용되면 여기에 기록됩니다.</p>
  return (
    <div className={cx(tbl.frame, 'thin-scroll max-h-[360px] overflow-auto')}>
      <table className={tbl.table}>
        <thead className={cx(tbl.thead, 'sticky top-0')}>
          <tr>
            <th className={tbl.th}>시각</th>
            <th className={tbl.th}>장치</th>
            <th className={tbl.th}>포인트</th>
            <th className={tbl.thR}>값</th>
            <th className={tbl.th}>적용 구간</th>
            <th className={tbl.th}>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={tbl.tr}>
              <td className="px-3.5 py-2 whitespace-nowrap text-ink-2">{fmtTs(c.ts)}</td>
              <td className="px-3.5 py-2 text-ink">{c.device}</td>
              <td className="px-3.5 py-2 font-mono text-[12.5px] text-ink-2" translate="no">
                {c.point}
              </td>
              <td className="px-3.5 py-2 text-right text-ink">{c.value}</td>
              <td className="px-3.5 py-2 text-ink-2">{c.window}</td>
              <td className="px-3.5 py-2">
                <CommandStatus c={c} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BuildingAndPolicy() {
  const nav = useNavigate()
  const { restartOnboarding, setApplied, user } = useAuth()
  const b = useApi<BuildingProfile>('/api/building')
  const pol = useApi<Policy>('/api/policy')
  const [form, setForm] = useState<Policy | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (pol.data) setForm({ ...pol.data, orient: { ...(pol.data.orient ?? {}) } })
  }, [pol.data])

  const P = pol.data
  const ratio = P ? P.attendance <= 1 : true
  const diff = useMemo(() => {
    if (!P || !form) return {} as Partial<Policy>
    const out: Partial<Policy> = {}
    for (const f of POLICY_FIELDS) if (form[f.k] !== P[f.k]) (out as Record<string, unknown>)[f.k] = form[f.k]
    const o = form.orient ?? {}
    const po = P.orient ?? {}
    if (Object.keys(o).some((r) => o[r] !== po[r])) out.orient = o
    return out
  }, [P, form])
  const nDiff = Object.keys(diff).length
  const problems: string[] = []
  if (form) {
    if (form.heat_min >= form.heat_max) problems.push('난방 하한은 상한보다 낮아야 합니다.')
    if (form.cool_min >= form.cool_max) problems.push('냉방 하한은 상한보다 낮아야 합니다.')
    if (form.heat_max >= form.cool_min) problems.push('난방 상한은 냉방 하한보다 낮아야 합니다.')
  }

  const save = async () => {
    if (!nDiff) return
    setBusy(true)
    setErr(null)
    try {
      await apiSend<Policy>('PUT', '/api/policy', diff)
      invalidate('/api/policy')
      invalidate('/api/plan')
      toast('운전 정책을 저장했습니다. 다음 스케줄 검증부터 반영됩니다.')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    restartOnboarding()
    nav('/setup')
  }

  const B = b.data
  const c = B?.connection ?? null
  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-[14px]">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="tnum min-w-0 truncate text-right font-medium text-ink">{value}</span>
    </div>
  )

  return (
    <section className="mb-6 space-y-4" aria-label="건물 연결과 정책">
      <Card flat>
        <CardHeader
          title="건물 연결과 정책"
          sub="온보딩에서 연결한 중앙 제어 시스템과, AI가 스케줄을 바꿀 때 넘지 않는 운전 정책입니다."
          right={
            <div className="flex flex-wrap gap-2">
              {user?.applied !== false && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setApplied(false)
                    nav('/overview')
                  }}
                  title="시연용: 대시보드를 시간표를 넣기 전(현재 운영) 상태로 되돌립니다"
                >
                  적용 전 화면부터 다시 보기
                </Button>
              )}
              <Button size="sm" onClick={restart}>
                온보딩 다시 보기
              </Button>
            </div>
          }
        />
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <Building2 size={15} className="text-ink-3" aria-hidden /> 건물
            </div>
            {b.error ? (
              <p className="text-[13.5px] text-crit-ink">건물 정보를 불러오지 못했습니다.</p>
            ) : !B ? (
              <Spinner size={14} />
            ) : (
              <div className="divide-y divide-line">
                {fact('이름', `${B.org ? `${B.org} ` : ''}${B.name}`)}
                {fact('유형', TYPE_LABEL[B.type] ?? B.type)}
                {fact('주소', B.address || '–')}
                {fact('온보딩', B.onboarded_at ? fmtTs(B.onboarded_at) : '진행 전')}
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <PlugZap size={15} className="text-ink-3" aria-hidden /> 중앙 제어 연결
              {c?.connected_at ? (
                <span className="inline-flex items-center gap-1 text-[13px] font-medium text-good-ink">
                  <span className="inline-block h-2 w-2 rounded-full bg-good" aria-hidden /> 연결됨
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-3">
                  <span className="inline-block h-2 w-2 rounded-full bg-ink-4" aria-hidden /> 미연결
                </span>
              )}
            </div>
            {!B ? null : c ? (
              <div className="divide-y divide-line">
                {fact('방식', `${METHOD_LABEL[c.method] ?? c.method}, ${c.vendor}`)}
                {fact('통신', `${PROTOCOL_LABEL[c.protocol] ?? c.protocol} ${c.method === 'file' ? '' : `${c.host}:${c.port}`}`)}
                {fact('게이트웨이', c.gateway_id ?? '–')}
                {fact('제어 포인트', c.points != null ? `${c.points}개` : '–')}
              </div>
            ) : (
              <p className="text-[13.5px] text-ink-3">연결 정보가 없습니다. 온보딩을 다시 진행해 중앙 제어 PC를 연결하세요.</p>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-ink">
              <Scale size={15} className="text-ink-3" aria-hidden /> 운전 정책
            </div>
            {pol.error ? (
              <p className="text-[13.5px] text-crit-ink">정책을 불러오지 못했습니다.</p>
            ) : !P ? (
              <Spinner size={14} />
            ) : (
              <div className="divide-y divide-line">
                {fact('난방 허용', `${P.heat_min}~${P.heat_max}℃`)}
                {fact('냉방 허용', `${P.cool_min}~${P.cool_max}℃`)}
                {fact('CO₂ 상한', `${P.co2_max.toLocaleString('ko-KR')} ppm`)}
                {fact('날씨 급변', `±${P.weather_jump_c}℃`)}
              </div>
            )}
          </div>
        </div>
      </Card>

      {form && P && (
        <DisclosureList>
          <Disclosure title="운전 정책 바꾸기" icon={<Scale size={16} aria-hidden />} summary={nDiff ? `변경 ${nDiff}개` : `출석률 ${attendancePct(P.attendance)}% 가정`}>
            <More className="mb-4"><p>AI와 두 에이전트는 이 범위 밖으로 설정온도를 바꾸지 않습니다. 근거는 정부 지침과 학교보건법이며, 학교는 자체 기준을 정할 수 있습니다.</p></More>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
              {POLICY_FIELDS.map((f) => {
                const raw = form[f.k] as number
                const shown = f.k === 'attendance' ? attendancePct(raw) : raw
                const changed = form[f.k] !== P[f.k]
                return (
                  <Field key={f.k} label={f.label} hint={f.hint}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        name={f.k}
                        className={cx(inputCls, 'tnum', changed && 'border-s-rule bg-info-bg')}
                        step={f.step}
                        min={f.min}
                        max={f.max}
                        value={Number.isFinite(shown) ? shown : ''}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setForm((x) => (x ? { ...x, [f.k]: f.k === 'attendance' && ratio ? v / 100 : v } : x))
                        }}
                      />
                      <span className="shrink-0 text-[13.5px] text-ink-3">{f.unit}</span>
                    </div>
                  </Field>
                )
              })}
            </div>
            {problems.length > 0 && (
              <div className="mt-4 space-y-1">
                {problems.map((p) => (
                  <Note key={p} tone="crit">
                    {p}
                  </Note>
                ))}
              </div>
            )}
            {err && (
              <div className="mt-4">
                <ErrorBox title="정책을 저장하지 못했습니다" error={err} />
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" disabled={!nDiff || busy} onClick={() => setForm({ ...P, orient: { ...(P.orient ?? {}) } })}>
                되돌리기
              </Button>
              <Button variant="primary" disabled={!nDiff || busy || problems.length > 0} onClick={save}>
                {busy ? <Spinner size={15} className="text-white" /> : <Save size={15} aria-hidden />} 정책 저장
              </Button>
            </div>
          </Disclosure>
          <Disclosure title="강의실 방향(일사 반영)" icon={<Compass size={16} aria-hidden />} summary="가정값">
            <More className="mb-4"><p>
              <Badge tone="warn">가정값</Badge> 도면 확인 전 가정한 방향입니다. 2차·3차 스케줄은 이 방향으로 오후 일사 부하를 추정합니다. 바꾼 뒤 위의 &lsquo;정책 저장&rsquo;을 누르세요.
            </p></More>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {ROOM_ORDER.map((r) => {
                const v = form.orient?.[r] ?? ''
                const changed = v !== (P.orient?.[r] ?? '')
                return (
                  <Field key={r} label={`${r}호`}>
                    <select
                      name={`orient-${r}`}
                      className={cx(inputCls, changed && 'border-s-rule bg-info-bg')}
                      value={v}
                      onChange={(e) => setForm((x) => (x ? { ...x, orient: { ...(x.orient ?? {}), [r]: e.target.value } } : x))}
                    >
                      {!v && <option value="">미정</option>}
                      {ORIENTS.map((o) => (
                        <option key={o} value={o}>
                          {o}향
                        </option>
                      ))}
                    </select>
                  </Field>
                )
              })}
            </div>
          </Disclosure>
          <Disclosure title="현장 게이트웨이" icon={<PlugZap size={16} aria-hidden />} summary="BACnet/IP로 중앙제어기와 통신">
            <GatewayLive />
          </Disclosure>
          <Disclosure title="최근 제어 명령" icon={<Send size={16} aria-hidden />} summary="중앙 제어기로 보낸 기록">
            <More className="mb-3"><p>자동 운전 모드이거나 담당자가 승인한 조정안만 중앙 제어기에 보냅니다. 게이트웨이가 연결되어 있으면 BACnet으로 쓰고 되읽어 확인하며, 없으면 시뮬레이터가 대신 받습니다.</p></More>
            <PolicyCommands />
          </Disclosure>
        </DisclosureList>
      )}
    </section>
  )
}
