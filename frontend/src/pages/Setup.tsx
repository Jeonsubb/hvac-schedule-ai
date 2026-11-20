import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { sourceMeta } from '../components/dataSources'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  CloudSun,
  Copy,
  FileUp,
  Hand,
  LogOut,
  Network,
  PlugZap,
  Receipt,
  Router,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Upload,
  Wrench,
  Cloud,
  Wind,
  Users,
  MessageSquareWarning,
  Thermometer,
} from 'lucide-react'
import { apiSend, invalidate, useApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type {
  BmsConnection,
  BmsPoint,
  BuildingType,
  CollectResult,
  ConnectResult,
  DataSource,
  OnboardQuestion,
  OpModeKey,
  Policy,
  ProfileParse,
  TierCheck,
  TierDay,
  TierPlan,
} from '../lib/types'
import { cx, fmtKwh, fmtNum, fmtPct, fmtWon, parseDate, weekdayOf } from '../lib/format'
import { Badge, Button, ErrorBox, Field, Figure, Note, Spinner, btnCls, inputCls, tbl, toast } from '../components/ui'
import { AiAvatar, Brand } from '../components/PublicShell'

// ---------------------------------------------------------------- vocabulary

const STEPS = [
  { key: 'profile', label: '건물 알려주기', desc: '어떤 건물인지 말로 설명' },
  { key: 'connect', label: '중앙 제어 연결', desc: '중앙 제어 PC와 게이트웨이' },
  { key: 'collect', label: '데이터 수집', desc: '시간표·설비·날씨·센서' },
  { key: 'questions', label: '부족한 정보 확인', desc: 'AI가 묻고 담당자가 답함' },
  { key: 'plan', label: 'AI 1차 스케줄', desc: '월간 기본 운전 계획' },
  { key: 'mode', label: '운전 모드', desc: '자동 운전 또는 추천' },
] as const

const TYPE_LABEL: Record<BuildingType, string> = {
  school: '학교',
  mall: '쇼핑몰',
  hotel: '호텔',
  office: '오피스',
  hospital: '병원',
  etc: '기타',
}

const PROTOCOLS: Record<BmsConnection['protocol'], { label: string; port: number; note: string }> = {
  bacnet: { label: 'BACnet/IP', port: 47808, note: '빌딩 자동제어 표준(UDP 47808)' },
  modbus: { label: 'Modbus TCP', port: 502, note: '산업용 표준(TCP 502)' },
  vendor_api: { label: '제조사 API (HTTPS)', port: 443, note: '중앙제어기 제조사가 제공하는 웹 API' },
  opcua: { label: 'OPC UA', port: 4840, note: '설비 통합 표준(TCP 4840)' },
}

const VENDORS = ['LG전자 중앙제어기', '삼성전자 중앙제어기', '범용 BACnet 컨트롤러', '기타 제조사']

const METHODS: { key: BmsConnection['method']; title: string; body: string; icon: typeof Router; badge?: string }[] = [
  {
    key: 'gateway',
    title: '현장 게이트웨이 설치',
    body: '중앙 제어 PC와 같은 내부망에 작은 게이트웨이를 설치합니다. 게이트웨이가 클라우드로 나가는 암호화 연결(TLS 443)만 쓰므로 방화벽을 열 필요가 없습니다.',
    icon: Router,
    badge: '권장',
  },
  {
    key: 'direct',
    title: '직접 연결',
    body: '중앙 제어 PC가 외부 API를 제공하면 VPN이나 허용 IP로 직접 연결합니다. 학내 전산 담당자의 방화벽 설정이 필요합니다.',
    icon: Network,
  },
  {
    key: 'file',
    title: '파일 업로드',
    body: '네트워크 연결이 어려우면 중앙 제어 프로그램이 내보낸 운전 이력 CSV를 올립니다. 자동 운전은 쓸 수 없고 추천만 받습니다.',
    icon: FileUp,
  },
]

const ORIGIN: Record<DataSource['origin'], { label: string; tone: 'good' | 'info' | 'event' | 'warn' }> = {
  live: { label: '실데이터', tone: 'good' },
  simulated: { label: '시뮬레이션 센서', tone: 'info' },
  input: { label: '운영자 입력', tone: 'event' },
  assumption: { label: '가정값', tone: 'warn' },
}

const SOURCE_ICON: Record<string, typeof Server> = {
  timetable: CalendarDays,
  calendar: CalendarDays,
  weather: CloudSun,
  forecast: CloudSun,
  nowcast: CloudSun,
  bms: Server,
  tariff: Receipt,
  policy: Scale,
  events: CalendarDays,
  co2: Wind,
  occupancy: Users,
  density: Users,
  feedback: MessageSquareWarning,
  sensor: Thermometer,
}

const EXAMPLES = [
  '부산대학교 IT관입니다. 3층과 4층 강의실 10개를 시스템 에어컨으로 운영하고, 중앙 제어 PC가 시설과에 있습니다.',
  '해운대구에 있는 지상 5층 쇼핑몰 본관입니다. 매장과 푸드코트, 주말 행사장이 있습니다.',
  '서면의 비즈니스호텔입니다. 객실 120실과 연회장 2개를 운영합니다.',
]

// ---------------------------------------------------------------- persistence (survive an accidental reload during the demo)

interface ProfileDraft {
  name: string
  org: string
  type: BuildingType
  address: string
  floors: number | null
  note: string
  ai: boolean | null
  clarification: string | null
}

interface ConnectForm {
  method: BmsConnection['method']
  vendor: string
  protocol: BmsConnection['protocol']
  host: string
  port: number
  pairCode: string
  fileName: string
}

interface WizardState {
  step: number
  reached: number
  text: string
  profile: ProfileDraft | null
  form: ConnectForm
  result: ConnectResult | null
  connection: BmsConnection | null
  answers: Record<string, unknown>
  confirmed: string[]
  applied: string[] | null
  mode: OpModeKey
}

function pairCode() {
  const r = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X')
  return `TP-${r()}-${r()}`
}

function initialState(org: string): WizardState {
  const pnu = org.includes('부산대')
  return {
    step: 0,
    reached: 0,
    text: pnu ? EXAMPLES[0] : '',
    profile: null,
    form: { method: 'gateway', vendor: VENDORS[0], protocol: 'bacnet', host: '10.21.3.40', port: 47808, pairCode: pairCode(), fileName: '' },
    result: null,
    connection: null,
    answers: {},
    confirmed: [],
    applied: null,
    mode: 'recommend',
  }
}

function useWizard(userId: string, org: string) {
  const key = `tp.setup.${userId}`
  const [s, setS] = useState<WizardState>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) return { ...initialState(org), ...(JSON.parse(raw) as WizardState) }
    } catch {
      /* ignore */
    }
    return initialState(org)
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(s))
    } catch {
      /* ignore */
    }
  }, [key, s])
  const patch = useCallback((p: Partial<WizardState>) => setS((x) => ({ ...x, ...p })), [])
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }, [key])
  return { s, patch, clear }
}

/** Reveal n items one after another (for steps that "happen" in front of the operator). */
function useReveal(total: number, active: boolean, delay: (i: number) => number = () => 320) {
  const [n, setN] = useState(0)
  const delayRef = useRef(delay)
  delayRef.current = delay
  useEffect(() => {
    if (!active) {
      setN(0)
      return
    }
    if (n >= total) return
    const t = window.setTimeout(() => setN((v) => v + 1), delayRef.current(n))
    return () => window.clearTimeout(t)
  }, [active, n, total])
  return n
}

// ---------------------------------------------------------------- frame

function StepFooter({
  onBack,
  onNext,
  nextLabel = '다음',
  nextDisabled,
  busy,
  extra,
}: {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: ReactNode
  nextDisabled?: boolean
  busy?: boolean
  extra?: ReactNode
}) {
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
      <div>
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden /> 이전
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {extra}
        {onNext && (
          <Button variant="primary" onClick={onNext} disabled={nextDisabled || busy} className="h-11 px-5 text-[15px]">
            {busy && <Spinner size={15} className="text-white" />}
            {nextLabel}
            {!busy && <ArrowRight size={15} aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  )
}

function StepHead({ n, title, desc }: { n: number; title: string; desc: ReactNode }) {
  return (
    <div className="mb-8">
      <div className="text-[13px] font-semibold text-brand-ink">
        {n} / {STEPS.length} 단계
      </div>
      <h1 className="mt-1.5 text-[28px] leading-tight font-bold tracking-[-0.025em] text-ink">{title}</h1>
      <p className="pretty mt-2 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">{desc}</p>
    </div>
  )
}

function AiBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <AiAvatar size={34} />
      <div className="min-w-0 flex-1 rounded-[14px] rounded-tl-[4px] bg-well px-4 py-3 text-[15px] leading-relaxed text-ink">{children}</div>
    </div>
  )
}

function UserBubble({ children, onEdit }: { children: ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex items-start justify-end gap-2">
      {onEdit && (
        <button type="button" onClick={onEdit} className="mt-2 text-[13px] font-medium text-ink-3 hover:text-ink">
          수정
        </button>
      )}
      <div className="max-w-[80%] rounded-[14px] rounded-tr-[4px] bg-brand px-4 py-2.5 text-[15px] leading-relaxed text-white">{children}</div>
    </div>
  )
}

function OriginBadge({ origin }: { origin: DataSource['origin'] }) {
  const o = ORIGIN[origin] ?? { label: origin, tone: 'neutral' as const }
  return <Badge tone={o.tone}>{o.label}</Badge>
}

function StatusDot({ status }: { status: DataSource['status'] }) {
  const c = status === 'ok' ? 'bg-good' : status === 'stale' ? 'bg-warn' : 'bg-crit'
  const l = status === 'ok' ? '정상' : status === 'stale' ? '지연' : '없음'
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-3">
      <span className={cx('inline-block h-2 w-2 rounded-full', c)} aria-hidden />
      {l}
    </span>
  )
}

// ---------------------------------------------------------------- step 1: building

function ProfileStep({ s, patch, onNext }: { s: WizardState; patch: (p: Partial<WizardState>) => void; onNext: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const p = s.profile

  const parse = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await apiSend<ProfileParse>('POST', '/api/onboarding/profile', { text: s.text.trim() })
      patch({
        profile: {
          name: String(r?.name ?? ''),
          org: String(r?.org ?? ''),
          type: (r?.type && r.type in TYPE_LABEL ? r.type : 'etc') as BuildingType,
          address: String(r?.address ?? ''),
          floors: typeof r?.floors === 'number' ? r.floors : null,
          note: String(r?.note ?? ''),
          ai: r?.ai ?? null,
          clarification: r?.clarification ?? null,
        },
      })
    } catch (e) {
      setErr((e as Error).message)
      // keep going by hand: an empty form the operator can fill in
      if (!s.profile) patch({ profile: { name: '', org: '', type: 'school', address: '', floors: null, note: '', ai: null, clarification: null } })
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof ProfileDraft, v: unknown) => p && patch({ profile: { ...p, [k]: v } })
  const isDemoBuilding = !!p && /IT\s*관|아이티관/.test(p.name)

  return (
    <div>
      <StepHead n={1} title="어떤 건물을 운영하시나요?" desc="건물 이름, 용도, 위치를 편하게 적어 주세요. AI가 건물 정보로 정리하고, 확실하지 않은 부분은 다시 묻습니다." />
      <AiBubble>안녕하세요. 냉난방을 맡길 건물을 알려 주세요. 예를 들어 &ldquo;부산대학교 IT관, 3~4층 강의실 10개&rdquo;처럼 적으면 됩니다.</AiBubble>

      <div className="mt-5 ml-[46px]">
        <label htmlFor="bld-text" className="sr-only">
          건물 설명
        </label>
        <textarea
          id="bld-text"
          name="building-description"
          value={s.text}
          onChange={(e) => patch({ text: e.target.value })}
          rows={3}
          maxLength={500}
          placeholder="예: 부산대학교 IT관입니다. 3층과 4층 강의실 10개를 시스템 에어컨으로 운영합니다…"
          className={cx(inputCls, 'h-auto min-h-[96px] py-3 leading-relaxed')}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              type="button"
              onClick={() => patch({ text: ex })}
              className="max-w-full truncate rounded-full border border-line px-3 py-1 text-[13px] text-ink-2 hover:border-ink-4 hover:text-ink"
              title={ex}
            >
              {i === 0 ? '예시: 대학 강의동' : i === 1 ? '예시: 쇼핑몰' : '예시: 호텔'}
            </button>
          ))}
          <span className="flex-1" />
          <Button variant="primary" onClick={parse} disabled={busy || s.text.trim().length < 2}>
            {busy ? <Spinner size={15} className="text-white" /> : <Sparkles size={15} aria-hidden />}
            {busy ? '정리하는 중…' : 'AI로 정리하기'}
          </Button>
        </div>
        {err && (
          <div className="mt-4">
            <ErrorBox title="AI로 정리하지 못했습니다" error={`${err} 아래 양식에 직접 입력해도 됩니다.`} />
          </div>
        )}
      </div>

      {p && (
        <div className="reveal mt-8 space-y-4">
          <AiBubble>
            {p.ai === false ? '규칙으로 읽은 결과입니다(AI 연결이 불안정합니다).' : '이렇게 이해했습니다.'} 틀린 부분이 있으면 고쳐 주세요.
            {p.note && <span className="mt-1 block text-[14px] text-ink-2">{p.note}</span>}
          </AiBubble>
          {p.clarification && (
            <div className="ml-[46px]">
              <Note tone="warn" icon={<AlertTriangle size={15} aria-hidden />}>
                {p.clarification}
              </Note>
            </div>
          )}
          <div className="ml-[46px] grid gap-4 rounded-[16px] border border-line bg-surface p-5 sm:grid-cols-2">
            <Field label="건물 이름">
              <input className={inputCls} name="building-name" autoComplete="off" value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="예: IT관…" />
            </Field>
            <Field label="기관·회사">
              <input className={inputCls} name="building-org" autoComplete="organization" value={p.org} onChange={(e) => set('org', e.target.value)} placeholder="예: 부산대학교…" />
            </Field>
            <Field label="건물 유형">
              <select className={inputCls} name="building-type" value={p.type} onChange={(e) => set('type', e.target.value as BuildingType)}>
                {(Object.keys(TYPE_LABEL) as BuildingType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="주소" hint={p.floors ? `층수: ${p.floors}개 층으로 이해했습니다.` : undefined}>
              <input className={inputCls} name="building-address" autoComplete="street-address" value={p.address} onChange={(e) => set('address', e.target.value)} placeholder="예: 부산 금정구 부산대학로 63번길 2…" />
            </Field>
          </div>
          {!isDemoBuilding && p.name && (
            <p className="ml-[46px] text-[13.5px] text-ink-3">시연 환경에서는 다음 단계의 중앙 제어 게이트웨이가 부산대학교 IT관 시뮬레이터에 연결됩니다.</p>
          )}
        </div>
      )}

      <StepFooter onNext={onNext} nextDisabled={!p?.name.trim()} />
    </div>
  )
}

// ---------------------------------------------------------------- step 2: central control connection

const HOST_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?!$)|$)){4}$|^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function CopyText({ text, label = '복사' }: { text: string; label?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast('복사했습니다.', 'neutral')
    } catch {
      toast('복사하지 못했습니다. 직접 선택해서 복사하세요.', 'crit')
    }
  }
  return (
    <button type="button" onClick={copy} className={btnCls('ghost', 'sm')} aria-label={`${label}: ${text}`}>
      <Copy size={13} aria-hidden /> {label}
    </button>
  )
}

function ConnectDiagram({ f }: { f: ConnectForm }) {
  const node = (icon: ReactNode, title: string, sub: string, tone: 'site' | 'cloud' | 'gw') => (
    <div
      className={cx(
        'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[12px] border px-3 py-3 text-center',
        tone === 'cloud' ? 'border-brand/30 bg-brand-bg' : tone === 'gw' ? 'border-line-strong bg-surface' : 'border-line bg-well',
      )}
    >
      <span className={cx('flex', tone === 'cloud' ? 'text-brand' : 'text-ink-2')}>{icon}</span>
      <span className="text-[13.5px] font-semibold text-ink">{title}</span>
      <span className="tnum truncate text-[12.5px] text-ink-3">{sub}</span>
    </div>
  )
  const link = (label: string) => (
    <div className="flex shrink-0 flex-col items-center px-1 text-[12px] text-ink-3">
      <span className="whitespace-nowrap">{label}</span>
      <span className="mt-1 block h-px w-12 bg-line-strong" aria-hidden />
    </div>
  )
  const proto = PROTOCOLS[f.protocol].label
  return (
    <div className="flex items-center gap-1 overflow-x-auto" aria-label="연결 구성도">
      {node(<Server size={20} aria-hidden />, '중앙 제어 PC', `${f.host || '주소 미입력'}:${f.port || '-'}`, 'site')}
      {f.method === 'gateway' && (
        <>
          {link(proto)}
          {node(<Router size={20} aria-hidden />, '현장 게이트웨이', '건물 내부망', 'gw')}
          {link('TLS 443 아웃바운드')}
        </>
      )}
      {f.method === 'direct' && link(`VPN, ${proto}`)}
      {f.method === 'file' && link('CSV 내보내기')}
      {node(<Cloud size={20} aria-hidden />, 'ThermoPlan', 'AWS 서울 리전', 'cloud')}
    </div>
  )
}

function groupPoints(points: BmsPoint[]) {
  const m = new Map<string, BmsPoint[]>()
  for (const p of points) {
    const k = p.room ?? '공용·실외기'
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(p)
  }
  return [...m.entries()].sort(([a], [b]) => (a === '공용·실외기' ? 1 : b === '공용·실외기' ? -1 : a.localeCompare(b)))
}

const KIND_LABEL: Record<BmsPoint['kind'], string> = {
  onoff: '운전',
  mode: '모드',
  setpoint: '설정온도',
  room_temp: '실내온도',
  power: '전력',
  co2: 'CO₂',
  occupancy: '재실',
  humidity: '습도',
}

function ConnectStep({ s, patch, onBack, onNext }: { s: WizardState; patch: (p: Partial<WizardState>) => void; onBack: () => void; onNext: () => void }) {
  const f = s.form
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [runId, setRunId] = useState(0) // restarts the step animation on every test
  const res = s.result
  const steps = Array.isArray(res?.steps) ? res!.steps : []
  const shown = useReveal(steps.length, !!res && runId > 0, (i) => Math.min(Math.max(steps[i]?.ms ?? 400, 280), 900))
  const done = !!res && (runId === 0 || shown >= steps.length)

  const setF = (p: Partial<ConnectForm>) => patch({ form: { ...f, ...p }, result: null, connection: null })
  const hostOk = f.method === 'file' ? !!f.fileName : HOST_RE.test(f.host.trim())
  const portOk = Number.isInteger(f.port) && f.port > 0 && f.port < 65536

  const test = async () => {
    setBusy(true)
    setErr(null)
    patch({ result: null, connection: null })
    try {
      const body =
        f.method === 'file'
          ? { method: 'file', vendor: f.vendor, protocol: 'vendor_api', host: 'upload.local', port: 443, pair_code: null, file_name: f.fileName }
          : { method: f.method, vendor: f.vendor, protocol: f.protocol, host: f.host.trim(), port: f.port, pair_code: f.method === 'gateway' ? f.pairCode : null }
      const r = await apiSend<ConnectResult>('POST', '/api/onboarding/connect', body)
      const safe: ConnectResult = {
        ok: !!r?.ok,
        steps: Array.isArray(r?.steps) ? r.steps : [],
        points: Array.isArray(r?.points) ? r.points : [],
        summary: r?.summary ?? { rooms: 0, idus: 0, odus: 0, sensors: 0, points: 0 },
        gateway: r?.gateway ?? { id: '-', version: '-', latency_ms: 0 },
        error: r?.error,
        source: r?.source,
        note: r?.note,
      }
      setRunId((v) => v + 1)
      patch({
        result: safe,
        connection: safe.ok
          ? {
              method: f.method,
              vendor: f.vendor,
              protocol: f.method === 'file' ? 'vendor_api' : f.protocol,
              host: f.method === 'file' ? 'upload.local' : f.host.trim(),
              port: f.method === 'file' ? 443 : f.port,
              gateway_id: safe.gateway.id,
              connected_at: new Date().toISOString(),
              points: safe.summary.points,
            }
          : null,
      })
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const target = `${f.host || '<중앙제어 PC 주소>'}:${f.port}`
  const cmd = `# ThermoPlan 저장소의 gateway 폴더 (읽기 전용으로 시작, 명령 적용은 --allow-write)\ndocker build -t thermoplan-gateway . && docker run -d --restart=always --network host \\\n  thermoplan-gateway --pair ${f.pairCode} --controller ${target}\n# Docker 없이: pip install -r requirements.txt && python edge_gateway.py --pair ${f.pairCode} --controller ${target}`

  return (
    <div>
      <StepHead
        n={2}
        title="중앙 제어 시스템과 연결합니다"
        desc="건물의 중앙 제어 PC가 모으는 실내기 상태·설정온도·실내온도·전력을 ThermoPlan이 받아야 계획을 만들고 운전할 수 있습니다. 중앙 제어 PC에 접속하는 경로를 알려 주세요."
      />

      <fieldset>
        <legend className="mb-3 text-[15px] font-semibold text-ink">연결 방식</legend>
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="연결 방식">
          {METHODS.map((m) => {
            const on = f.method === m.key
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setF({ method: m.key })}
                className={cx(
                  'rounded-[14px] border p-4 text-left transition-[border-color,background-color,box-shadow] duration-150',
                  on ? 'border-brand bg-brand-bg/50 shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line bg-surface hover:border-ink-4',
                )}
              >
                <div className="flex items-center gap-2">
                  <m.icon size={18} className={on ? 'text-brand' : 'text-ink-3'} aria-hidden />
                  <span className="text-[15px] font-semibold text-ink">{m.title}</span>
                  {m.badge && <Badge tone="info">{m.badge}</Badge>}
                </div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{m.body}</p>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-6 rounded-[16px] border border-line bg-surface p-5">
        <ConnectDiagram f={f} />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="제조사">
            <select className={inputCls} name="vendor" value={f.vendor} onChange={(e) => setF({ vendor: e.target.value })}>
              {VENDORS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          {f.method !== 'file' ? (
            <>
              <Field label="통신 방식" hint={PROTOCOLS[f.protocol].note}>
                <select
                  className={inputCls}
                  name="protocol"
                  value={f.protocol}
                  onChange={(e) => {
                    const p = e.target.value as BmsConnection['protocol']
                    // follow the protocol's default port unless the operator typed another one
                    const usedDefault = f.port === PROTOCOLS[f.protocol].port
                    setF({ protocol: p, port: usedDefault ? PROTOCOLS[p].port : f.port })
                  }}
                >
                  {(Object.keys(PROTOCOLS) as BmsConnection['protocol'][]).map((k) => (
                    <option key={k} value={k}>
                      {PROTOCOLS[k].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="중앙 제어 PC 주소" hint={f.host && !hostOk ? <span className="text-crit-ink">IP 주소나 호스트 이름 형식이 아닙니다.</span> : '내부망 IP 또는 호스트 이름'}>
                <input
                  className={cx(inputCls, 'tnum')}
                  name="bms-host"
                  autoComplete="off"
                  spellCheck={false}
                  value={f.host}
                  onChange={(e) => setF({ host: e.target.value })}
                  placeholder="예: 10.21.3.40…"
                />
              </Field>
              <Field label="포트" hint={!portOk ? <span className="text-crit-ink">1~65535 사이로 입력하세요.</span> : undefined}>
                <input
                  className={cx(inputCls, 'tnum')}
                  name="bms-port"
                  inputMode="numeric"
                  autoComplete="off"
                  value={Number.isFinite(f.port) ? String(f.port) : ''}
                  onChange={(e) => setF({ port: Number(e.target.value.replace(/\D/g, '')) })}
                />
              </Field>
            </>
          ) : (
            <Field label="운전 이력 파일" className="sm:col-span-2 lg:col-span-3" hint="중앙 제어 프로그램의 '운전 이력 내보내기' CSV">
              <label className={cx(btnCls('secondary'), 'w-full cursor-pointer justify-start')}>
                <Upload size={15} aria-hidden />
                <span className="truncate">{f.fileName || '파일 선택…'}</span>
                <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => setF({ fileName: e.target.files?.[0]?.name ?? '' })} />
              </label>
            </Field>
          )}
        </div>

        {f.method === 'gateway' && (
          <div className="mt-5 rounded-[12px] bg-well p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[14px] font-semibold text-ink">
                게이트웨이 연결 코드 <span className="tnum ml-1 rounded-[6px] bg-surface px-2 py-0.5 font-mono text-[14px] text-brand-ink ring-1 ring-line">{f.pairCode}</span>
              </div>
              <div className="flex gap-1">
                <CopyText text={cmd.replace(/\\\n\s+/g, '')} label="설치 명령 복사" />
                <button type="button" className={btnCls('ghost', 'sm')} onClick={() => setF({ pairCode: pairCode() })}>
                  코드 새로 만들기
                </button>
              </div>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-2">중앙 제어 PC와 같은 망의 PC(또는 소형 장비)에서 아래 명령을 실행하면 게이트웨이가 이 코드로 계정에 연결됩니다.</p>
            <pre className="thin-scroll mt-3 overflow-x-auto rounded-[10px] bg-[#0f1b2d] px-4 py-3 text-[12.5px] leading-relaxed text-[#d7e3f6]" translate="no">
              {cmd}
            </pre>
          </div>
        )}
        <p className="mt-4 text-[13px] text-ink-3">시연 환경에서는 입력한 주소 대신 부산대학교 IT관 중앙 제어 시뮬레이터가 응답합니다. 쓰기 명령은 승인된 설정온도·환기 단계만 보냅니다.</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={test} disabled={busy || !hostOk || (f.method !== 'file' && !portOk)} className="h-11 px-5 text-[15px]">
          {busy ? <Spinner size={15} className="text-white" /> : <PlugZap size={16} aria-hidden />}
          {busy ? '연결하는 중…' : res ? '다시 연결 테스트' : '연결 테스트'}
        </Button>
        {busy && <span className="text-[14px] text-ink-3">게이트웨이와 중앙 제어 PC에 차례로 연결하고 있습니다…</span>}
      </div>
      {err && (
        <div className="mt-4">
          <ErrorBox title="연결하지 못했습니다" error={err} onRetry={test} />
        </div>
      )}

      {res && (
        <div className="mt-6 space-y-5" aria-live="polite">
          <ol className="space-y-2">
            {steps.slice(0, runId === 0 ? steps.length : shown).map((st) => (
              <li key={st.key} className="reveal flex items-start gap-3 rounded-[12px] border border-line bg-surface px-4 py-3">
                {st.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" aria-hidden /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-crit" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold text-ink">{st.label}</div>
                  <div className="text-[13.5px] text-ink-2">{st.detail}</div>
                </div>
                <span className="tnum shrink-0 text-[13px] text-ink-3">{st.ms}ms</span>
              </li>
            ))}
            {!done && (
              <li className="flex items-center gap-2 px-4 py-2 text-[14px] text-ink-3">
                <Spinner size={14} /> 확인 중…
              </li>
            )}
          </ol>

          {done && !res.ok && <ErrorBox title="연결 테스트에 실패했습니다" error={res.error || '중앙 제어 PC가 응답하지 않습니다. 주소·포트·방화벽을 확인하세요.'} />}

          {done && res.ok && (
            <div className="reveal rounded-[16px] border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[16px] font-[650] text-ink">
                  <CheckCircle2 size={18} className="text-good" aria-hidden /> 연결했습니다
                </div>
                <span className="tnum text-[13px] text-ink-3">
                  게이트웨이 {res.gateway.id}, 버전 {res.gateway.version}, 지연 {res.gateway.latency_ms}ms
                </span>
              </div>
              {res.source && (
                <div
                  className={cx(
                    'mt-3 rounded-[10px] px-3 py-2 text-[13.5px] leading-relaxed',
                    res.source === 'gateway' ? 'bg-good-bg text-good-ink' : 'bg-warn-bg text-warn-ink',
                  )}
                >
                  <b className="font-semibold">{res.source === 'gateway' ? '실제 게이트웨이에서 BACnet으로 읽은 값입니다.' : '시뮬레이터로 시험했습니다.'}</b> {res.note}
                </div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
                <Figure size="sm" label="강의실" value={fmtNum(res.summary.rooms)} unit="개" />
                <Figure size="sm" label="실내기" value={fmtNum(res.summary.idus)} unit="대" />
                <Figure size="sm" label="실외기" value={fmtNum(res.summary.odus)} unit="대" />
                <Figure size="sm" label="센서" value={fmtNum(res.summary.sensors)} unit="개" />
                <Figure size="sm" label="제어 포인트" value={fmtNum(res.summary.points)} unit="개" />
              </div>
              {res.points.length > 0 && (
                <details className="group mt-5">
                  <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink-2 hover:text-ink">
                    <span className="inline-flex items-center gap-1.5">
                      발견한 포인트 {fmtNum(res.points.length)}개 보기 <ArrowRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
                    </span>
                  </summary>
                  <div className={cx(tbl.frame, 'thin-scroll mt-3 max-h-[340px] overflow-auto')}>
                    <table className={tbl.table}>
                      <thead className={cx(tbl.thead, 'sticky top-0')}>
                        <tr>
                          <th className={tbl.th}>포인트</th>
                          <th className={tbl.th}>장치</th>
                          <th className={tbl.th}>종류</th>
                          <th className={tbl.thR}>현재값</th>
                          <th className={tbl.th}>쓰기</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupPoints(res.points).map(([room, pts]) => (
                          <PointGroup key={room} room={room} pts={pts} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={!s.connection} />
    </div>
  )
}

function PointGroup({ room, pts }: { room: string; pts: BmsPoint[] }) {
  return (
    <>
      <tr className="bg-[#fafbfc]">
        <td colSpan={5} className="border-t border-line px-3.5 py-2 text-[13px] font-semibold text-ink">
          {room === '공용·실외기' ? room : `${room}호`} <span className="font-normal text-ink-3">{pts.length}개</span>
        </td>
      </tr>
      {pts.map((p) => (
        <tr key={p.point} className={tbl.tr}>
          <td className="px-3.5 py-1.5 font-mono text-[12.5px] text-ink-2" translate="no">
            {p.point}
          </td>
          <td className="px-3.5 py-1.5 text-ink">{p.device}</td>
          <td className="px-3.5 py-1.5 text-ink-2">{KIND_LABEL[p.kind] ?? p.kind}</td>
          <td className="px-3.5 py-1.5 text-right text-ink">
            {String(p.value)}
            {p.unit ? <span className="ml-0.5 text-ink-3">{p.unit}</span> : null}
          </td>
          <td className="px-3.5 py-1.5 text-ink-3">{p.writable ? '가능' : '읽기'}</td>
        </tr>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- step 3: collect

function countSentence(c: CollectResult['counts']) {
  const parts = [
    c.courses ? `강의 시간표 ${fmtNum(c.courses)}개` : null,
    c.rooms ? `강의실 ${fmtNum(c.rooms)}개` : null,
    c.idus ? `실내기 ${fmtNum(c.idus)}대` : null,
    c.odus ? `실외기 ${fmtNum(c.odus)}대` : null,
    c.events ? `시간표 밖 일정 ${fmtNum(c.events)}건` : null,
    c.holidays ? `공휴일 ${fmtNum(c.holidays)}일` : null,
    c.weather_days ? `날씨 ${fmtNum(c.weather_days)}일치` : null,
    c.feedback ? `재실자 의견 ${fmtNum(c.feedback)}건` : null,
  ].filter(Boolean)
  return parts.length ? `서버에서 ${parts.join(', ')}를 가져왔습니다.` : '가져온 데이터가 없습니다.'
}

function CollectStep({ onBack, onNext }: { onBack: () => void; onNext: (c: CollectResult) => void }) {
  const q = useApi<CollectResult>('/api/onboarding/collect')
  const data = q.data
  const sources = Array.isArray(data?.sources) ? data!.sources : []
  const shown = useReveal(sources.length, !!data, () => 260)
  const done = !!data && shown >= sources.length
  const c = data?.counts

  return (
    <div>
      <StepHead n={3} title="서버에서 건물 데이터를 모읍니다" desc="중앙 제어 PC, 학사 시스템의 시간표, 기상청 예보, 센서, 재실자 의견을 한 번에 가져와 계획에 쓸 수 있는지 확인합니다." />
      {q.error && <ErrorBox title="데이터를 가져오지 못했습니다" error={q.error} onRetry={q.reload} />}
      {!data && !q.error && (
        <div className="flex items-center gap-2 text-[15px] text-ink-2">
          <Spinner /> 중앙 제어 PC와 학사 시스템에서 데이터를 가져오는 중…
        </div>
      )}
      {data && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-[16px] border border-line bg-surface">
            {sources.slice(0, shown).map((src) => {
              const Icon = SOURCE_ICON[src.key] ?? ShieldCheck
              return (
                <li key={src.key} className="reveal flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-well text-ink-2" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">{src.label}</span>
                      <OriginBadge origin={src.origin} />
                    </div>
                    <div className="text-[13.5px] text-ink-2">{src.detail}</div>
                  </div>
                  <StatusDot status={src.status} />
                </li>
              )
            })}
            {!done && (
              <li className="flex items-center gap-2 px-5 py-3 text-[14px] text-ink-3">
                <Spinner size={14} /> 다음 데이터 확인 중…
              </li>
            )}
          </ul>
          {done && c && (
            <div className="reveal mt-6 space-y-4">
              <AiBubble>
                {countSentence(c)}
                {c.estimated_people > 0 && <span className="mt-1 block text-[14px] text-ink-2">그중 {fmtNum(c.estimated_people)}개 강의는 수강 인원이 없어 추정했습니다. 다음 단계에서 몇 가지만 확인하겠습니다.</span>}
              </AiBubble>
              <p className="ml-[46px] text-[13px] text-ink-3">
                <Badge tone="good">실데이터</Badge> 외부에서 받은 실제 값, <Badge tone="info">시뮬레이션 센서</Badge> 시연용 센서 시뮬레이터 값, <Badge tone="warn">가정값</Badge> 담당자 확인이 필요한 값입니다.
              </p>
            </div>
          )}
        </>
      )}
      <StepFooter onBack={onBack} onNext={() => data && onNext(data)} nextDisabled={!done} />
    </div>
  )
}

// ---------------------------------------------------------------- step 4: questions

function defaultFor(q: OnboardQuestion): unknown {
  const d = q.default
  switch (q.kind) {
    case 'time_range':
      return Array.isArray(d) && d.length === 2 ? [String(d[0]), String(d[1])] : ['08:30', '22:30']
    case 'temp_range':
      return Array.isArray(d) && d.length === 2 ? [Number(d[0]), Number(d[1])] : [18, 22]
    case 'number':
      return typeof d === 'number' ? d : Number(d) || 0
    case 'choice':
      return typeof d === 'string' ? d : (q.options?.[0]?.value ?? '')
    case 'confirm':
      return typeof d === 'boolean' ? d : true
  }
  return d
}

function answerText(q: OnboardQuestion, v: unknown): string {
  const unit = q.unit ?? ''
  if (q.kind === 'time_range' && Array.isArray(v)) return `${v[0]} ~ ${v[1]}`
  if (q.kind === 'temp_range' && Array.isArray(v)) return `${v[0]} ~ ${v[1]}${unit || '℃'}`
  if (q.kind === 'choice') return q.options?.find((o) => o.value === v)?.label ?? String(v)
  if (q.kind === 'confirm') return v ? '네, 그렇게 해 주세요.' : '아니요, 나중에 직접 정하겠습니다.'
  return `${v}${unit}`
}

function QuestionInput({ q, value, onChange }: { q: OnboardQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const unit = q.unit ?? ''
  if (q.kind === 'time_range') {
    const v = (Array.isArray(value) ? value : defaultFor(q)) as string[]
    return (
      <div className="flex items-center gap-2">
        <input type="time" aria-label="시작" className={cx(inputCls, 'tnum w-[140px]')} value={v[0]} onChange={(e) => onChange([e.target.value, v[1]])} />
        <span className="text-ink-3">~</span>
        <input type="time" aria-label="종료" className={cx(inputCls, 'tnum w-[140px]')} value={v[1]} onChange={(e) => onChange([v[0], e.target.value])} />
      </div>
    )
  }
  if (q.kind === 'temp_range') {
    const v = (Array.isArray(value) ? value : defaultFor(q)) as number[]
    const bad = Number(v[0]) >= Number(v[1])
    return (
      <div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            aria-label="최소"
            className={cx(inputCls, 'tnum w-[110px]')}
            step={q.step ?? 0.5}
            min={q.min}
            max={q.max}
            value={v[0]}
            onChange={(e) => onChange([Number(e.target.value), v[1]])}
          />
          <span className="text-ink-3">~</span>
          <input
            type="number"
            aria-label="최대"
            className={cx(inputCls, 'tnum w-[110px]')}
            step={q.step ?? 0.5}
            min={q.min}
            max={q.max}
            value={v[1]}
            onChange={(e) => onChange([v[0], Number(e.target.value)])}
          />
          <span className="text-[14px] text-ink-3">{unit || '℃'}</span>
        </div>
        {bad && <p className="mt-1.5 text-[13px] text-crit-ink">최소값은 최대값보다 낮아야 합니다.</p>}
      </div>
    )
  }
  if (q.kind === 'number') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          aria-label={q.title}
          className={cx(inputCls, 'tnum w-[140px]')}
          step={q.step ?? 1}
          min={q.min}
          max={q.max}
          value={typeof value === 'number' ? value : Number(defaultFor(q))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {unit && <span className="text-[14px] text-ink-3">{unit}</span>}
      </div>
    )
  }
  if (q.kind === 'choice') {
    return (
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.title}>
        {(q.options ?? []).map((o) => {
          const on = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cx(
                'h-10 rounded-[10px] border px-4 text-[14px] font-medium transition-colors',
                on ? 'border-brand bg-brand-bg text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    )
  }
  // confirm
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.title}>
      {[
        { v: true, l: '네, 맞습니다' },
        { v: false, l: '아니요' },
      ].map((o) => (
        <button
          key={String(o.v)}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cx(
            'h-10 rounded-[10px] border px-4 text-[14px] font-medium transition-colors',
            value === o.v ? 'border-brand bg-brand-bg text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4',
          )}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

function validAnswer(q: OnboardQuestion, v: unknown) {
  if (q.kind === 'temp_range') return Array.isArray(v) && Number(v[0]) < Number(v[1])
  if (q.kind === 'time_range') return Array.isArray(v) && !!v[0] && !!v[1] && v[0] < v[1]
  if (q.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && (q.min == null || v >= q.min) && (q.max == null || v <= q.max)
  return v !== undefined && v !== ''
}

function QuestionsStep({
  questions,
  s,
  patch,
  onBack,
  onNext,
}: {
  questions: OnboardQuestion[]
  s: WizardState
  patch: (p: Partial<WizardState>) => void
  onBack: () => void
  onNext: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const confirmed = new Set(s.confirmed)
  const firstOpen = questions.findIndex((q) => !confirmed.has(q.id))
  const [cursor, setCursor] = useState(firstOpen === -1 ? questions.length : firstOpen)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [cursor])

  const value = (q: OnboardQuestion) => (q.id in s.answers ? s.answers[q.id] : defaultFor(q))
  const setValue = (q: OnboardQuestion, v: unknown) => patch({ answers: { ...s.answers, [q.id]: v }, applied: null })

  const confirm = (i: number) => {
    const q = questions[i]
    const next = new Set(confirmed)
    next.add(q.id)
    patch({ answers: { ...s.answers, [q.id]: value(q) }, confirmed: [...next], applied: null })
    const after = questions.findIndex((x, j) => j > i && !next.has(x.id))
    const before = questions.findIndex((x) => !next.has(x.id))
    setCursor(after !== -1 ? after : before !== -1 ? before : questions.length)
  }

  const acceptAll = () => {
    const ans = { ...s.answers }
    for (const q of questions) if (!(q.id in ans)) ans[q.id] = defaultFor(q)
    patch({ answers: ans, confirmed: questions.map((q) => q.id), applied: null })
    setCursor(questions.length)
  }

  const allDone = questions.every((q) => confirmed.has(q.id))

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const answers: Record<string, unknown> = {}
      for (const q of questions) answers[q.id] = value(q)
      const r = await apiSend<{ policy?: Policy; applied?: string[] }>('POST', '/api/onboarding/answers', { answers })
      const applied = Array.isArray(r?.applied) ? r.applied : []
      const mode = answers.mode === 'auto' || answers.mode === 'recommend' ? (answers.mode as OpModeKey) : s.mode
      patch({ applied, mode })
      // settings changed: schedules and plans must be recomputed
      invalidate('/api/')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepHead n={4} title="부족한 정보만 확인하겠습니다" desc="시간표와 중앙 제어 PC에 없는 값은 AI가 가정값을 제안합니다. 맞으면 그대로 확인하고, 다르면 고쳐 주세요. 답변은 바로 운전 계획에 반영됩니다." />

      {questions.length === 0 ? (
        <AiBubble>추가로 확인할 정보가 없습니다. 바로 1차 스케줄을 만들겠습니다.</AiBubble>
      ) : (
        <div className="space-y-5">
          {questions.map((q, i) => {
            if (i > cursor && !confirmed.has(q.id)) return null
            const isOpen = i === cursor
            return (
              <div key={q.id} className="space-y-3">
                <AiBubble>
                  <div className="font-semibold">{q.title}</div>
                  <div className="mt-1 text-[14px] text-ink-2">{q.why}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-3">
                    <span>출처: {sourceMeta(q.source).label}</span>
                    <span>반영: {q.affects}</span>
                  </div>
                </AiBubble>
                {isOpen ? (
                  <div className="reveal ml-[46px] flex flex-wrap items-end gap-3 rounded-[14px] border border-brand/40 bg-surface p-4">
                    <div className="min-w-0 flex-1">
                      <QuestionInput q={q} value={value(q)} onChange={(v) => setValue(q, v)} />
                    </div>
                    <Button variant="primary" onClick={() => confirm(i)} disabled={!validAnswer(q, value(q))}>
                      <Check size={15} aria-hidden /> 확인
                    </Button>
                  </div>
                ) : confirmed.has(q.id) ? (
                  <UserBubble onEdit={() => setCursor(i)}>{answerText(q, value(q))}</UserBubble>
                ) : null}
              </div>
            )
          })}
          <div ref={endRef} />
          {!allDone && (
            <div className="ml-[46px]">
              <button type="button" onClick={acceptAll} className="text-[14px] font-medium text-brand-ink underline-offset-4 hover:underline">
                남은 질문은 AI 제안값으로 확인하기
              </button>
            </div>
          )}
        </div>
      )}

      {allDone && questions.length > 0 && (
        <div className="reveal mt-6 space-y-3">
          {s.applied ? (
            <AiBubble>
              답변을 반영했습니다.
              {s.applied.length > 0 && (
                <ul className="mt-2 space-y-1 text-[14px] text-ink-2">
                  {s.applied.map((a) => (
                    <li key={a} className="flex items-start gap-2">
                      <Check size={14} className="mt-1 shrink-0 text-good" aria-hidden /> {a}
                    </li>
                  ))}
                </ul>
              )}
            </AiBubble>
          ) : (
            <div className="ml-[46px] flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={submit} disabled={busy}>
                {busy ? <Spinner size={15} className="text-white" /> : <CheckCircle2 size={15} aria-hidden />}
                {busy ? '반영하는 중…' : '답변 반영하기'}
              </Button>
              <span className="text-[13.5px] text-ink-3">정책 온도 범위, 운영 시간, 선행 가동 같은 값이 운영 규칙에 저장됩니다.</span>
            </div>
          )}
          {err && <ErrorBox title="답변을 반영하지 못했습니다" error={err} onRetry={submit} />}
        </div>
      )}

      <StepFooter onBack={onBack} onNext={onNext} nextDisabled={questions.length > 0 && !s.applied} nextLabel="1차 스케줄 만들기" />
    </div>
  )
}

// ---------------------------------------------------------------- step 5: AI first-pass plan

const HOPS: { key: string; keys: string[]; label: string; icon: typeof Server; doing: string }[] = [
  { key: 'timetable', keys: ['timetable'], label: '시간표', icon: CalendarDays, doing: '강의를 요일·강의실별로 정리하고 있습니다' },
  { key: 'calendar', keys: ['calendar', 'events'], label: '학사일정', icon: CalendarDays, doing: '공휴일과 시간표 밖 일정을 확인하고 있습니다' },
  { key: 'weather', keys: ['weather', 'forecast', 'climatology'], label: '날씨', icon: CloudSun, doing: '예보와 평년 기온으로 예열·예냉 시간을 계산하고 있습니다' },
  { key: 'bms', keys: ['bms', 'simulator'], label: '설비', icon: Server, doing: '실내기·실외기 용량으로 동시 기동 한계를 확인하고 있습니다' },
  { key: 'tariff', keys: ['tariff'], label: '요금', icon: Receipt, doing: '시간대별 전기요금으로 비용을 계산하고 있습니다' },
  { key: 'policy', keys: ['policy'], label: '정책', icon: Scale, doing: '정부 지침과 정책 온도 범위 안인지 확인하고 있습니다' },
]

const VERDICT: Record<TierCheck['verdict'], { label: string; icon: ReactNode; tone: 'good' | 'warn' | 'crit' }> = {
  ok: { label: '정상', icon: <CheckCircle2 size={16} className="text-good" aria-hidden />, tone: 'good' },
  adjust: { label: '조정', icon: <Wrench size={16} className="text-[#c98500]" aria-hidden />, tone: 'warn' },
  review: { label: '확인 필요', icon: <AlertTriangle size={16} className="text-crit" aria-hidden />, tone: 'crit' },
}

function MonthCalendar({ days }: { days: TierDay[] }) {
  if (!days.length) return null
  const max = Math.max(...days.map((d) => d.kwh), 1)
  const lead = weekdayOf(days[0].date)
  const cells: (TierDay | null)[] = [...Array(lead).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  const SRC = { actual: '실측', forecast: '예보', climatology: '평년' } as const
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[12.5px] font-medium text-ink-3">
        {['월', '화', '수', '목', '금', '토', '일'].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const a = d.kwh / max
          return (
            <div
              key={d.date}
              title={`${d.date} 강의 ${d.sessions}회, AI ${fmtKwh(d.kwh)} kWh (현재 운영 ${fmtKwh(d.baseline_kwh)} kWh), ${SRC[d.src] ?? d.src} 기온 ${d.t_min}~${d.t_max}℃${d.holiday ? `, ${d.holiday}` : ''}`}
              className={cx(
                'relative h-[54px] min-w-0 overflow-hidden rounded-[10px] border px-1.5 py-1.5 text-left',
                d.holiday ? 'border-line bg-well' : d.src === 'actual' ? 'border-line' : 'border-dashed border-ink-4',
              )}
              style={!d.holiday && d.kwh > 0 ? { background: `rgba(47,111,222,${((d.src === 'climatology' ? 0.05 : 0.08) + a * (d.src === 'climatology' ? 0.3 : 0.5)).toFixed(3)})` } : undefined}
            >
              <span className={cx('tnum block text-[12.5px] leading-none font-semibold', d.holiday ? 'text-crit-ink' : 'text-ink')}>{parseDate(d.date).getDate()}</span>
              <span className="tnum mt-1.5 block truncate text-[11.5px] text-ink-2">{d.holiday ? d.holiday : d.kwh > 0 ? fmtKwh(d.kwh) : '–'}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">칸의 숫자는 AI 계획의 하루 전력량(kWh)이고, 진할수록 많이 씁니다. 지난 날은 실측 날씨로, 점선 칸은 예보(가까운 날)나 평년 기온(먼 날)으로 계산했습니다.</p>
    </div>
  )
}

function PlanStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const q = useApi<TierPlan>('/api/plan/tier/1')
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (hop >= HOPS.length) return
    const t = window.setTimeout(() => setHop((h) => h + 1), 720)
    return () => window.clearTimeout(t)
  }, [hop])
  const plan = q.data
  const ready = !!plan && hop >= HOPS.length
  const findSource = (keys: string[]) => (Array.isArray(plan?.sources) ? plan!.sources.find((x) => keys.includes(x.key)) : undefined)
  const days = Array.isArray(plan?.days) ? plan!.days : []
  const checks = Array.isArray(plan?.checks) ? plan!.checks : []
  const sm = plan?.summary

  return (
    <div>
      <StepHead n={5} title="AI가 1차 월간 스케줄을 만듭니다" desc="모은 데이터를 차례로 확인해 이번 달 운전 계획과 예상 요금을 만들고, 계획이 데이터와 맞는지 정합성을 검증합니다." />

      {/* thinking: hops across the data sources */}
      <div className="rounded-[16px] border border-line bg-surface p-5" aria-live="polite">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
          {ready ? <CheckCircle2 size={16} className="text-good" aria-hidden /> : <Spinner size={15} />}
          {ready ? '판단을 마쳤습니다' : 'AI가 데이터를 오가며 판단하는 중…'}
        </div>
        <ol className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">
          {HOPS.map((h, i) => {
            const state = i < hop ? 'done' : i === hop && !ready ? 'now' : ready ? 'done' : 'todo'
            return (
              <li key={h.key} className="flex shrink-0 items-center gap-1">
                <span
                  className={cx(
                    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-[background-color,border-color,color] duration-200',
                    state === 'done' && 'border-brand/30 bg-brand-bg text-brand-ink',
                    state === 'now' && 'border-brand bg-brand text-white',
                    state === 'todo' && 'border-line text-ink-3',
                  )}
                >
                  <h.icon size={14} aria-hidden />
                  {h.label}
                </span>
                {i < HOPS.length - 1 && <span className={cx('h-px w-5', i < hop ? 'bg-brand/50' : 'bg-line')} aria-hidden />}
              </li>
            )
          })}
        </ol>
        <ul className="mt-4 space-y-1.5">
          {HOPS.slice(0, Math.min(hop + 1, HOPS.length)).map((h, i) => {
            const src = findSource(h.keys)
            const finished = i < hop || ready
            return (
              <li key={h.key} className="reveal flex items-start gap-2 text-[14px]">
                {finished ? <Check size={14} className="mt-1 shrink-0 text-good" aria-hidden /> : <Spinner size={13} className="mt-1" />}
                <span className="text-ink-2">
                  <span className="font-semibold text-ink">{h.label}</span> {finished && src ? src.detail : `${h.doing}…`}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {q.error && (
        <div className="mt-5">
          <ErrorBox title="1차 스케줄을 만들지 못했습니다" error={q.error} onRetry={q.reload} />
        </div>
      )}
      {!q.error && hop >= HOPS.length && !plan && (
        <div className="mt-5 flex items-center gap-2 text-[14px] text-ink-3">
          <Spinner size={14} /> 학기 운전 계획을 시뮬레이션하는 중입니다. 처음에는 1분 정도 걸릴 수 있습니다…
        </div>
      )}

      {ready && plan && sm && (
        <div className="reveal mt-6 space-y-5">
          <div className="rounded-[16px] border border-line bg-surface p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-[650] text-ink">{plan.label || '1차 · 월간 기본 계획'}</h2>
              <span className="text-[13.5px] text-ink-3">{plan.period?.label}</span>
            </div>
            <p className="pretty mt-2 text-[16px] leading-relaxed text-ink-2">{sm.sentence}</p>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Figure label="AI 운전 계획" value={fmtKwh(sm.kwh)} unit="kWh" />
              <Figure label="현재 운영" value={fmtKwh(sm.baseline_kwh)} unit="kWh" />
              <Figure label="절감" value={sm.saving_pct == null ? '–' : fmtPct(sm.saving_pct)} />
              <Figure label="예상 요금" value={fmtWon(sm.cost_krw)} />
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="rounded-[16px] border border-line bg-surface p-5">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">날짜별 계획 전력</h3>
              <MonthCalendar days={days} />
            </div>
            <div className="rounded-[16px] border border-line bg-surface p-5">
              <h3 className="mb-3 text-[15px] font-semibold text-ink">정합성 검증 {checks.length}건</h3>
              <ul className="space-y-3">
                {checks.map((c) => {
                  const v = VERDICT[c.verdict] ?? VERDICT.review
                  return (
                    <li key={c.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex shrink-0">{v.icon}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold text-ink">
                          {c.title}
                          <Badge tone={v.tone}>{v.label}</Badge>
                        </div>
                        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{c.action}</p>
                      </div>
                    </li>
                  )
                })}
                {checks.length === 0 && <li className="text-[14px] text-ink-3">검증 결과가 없습니다.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!ready && !q.error}
        extra={q.error ? <span className="text-[13.5px] text-ink-3">계획은 나중에 AI 스케줄링 화면에서 다시 만들 수 있습니다.</span> : undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------- step 6: mode

function ModeStep({
  s,
  patch,
  onBack,
  onFinish,
  collect,
}: {
  s: WizardState
  patch: (p: Partial<WizardState>) => void
  onBack: () => void
  onFinish: (force?: boolean) => Promise<void>
  collect: CollectResult | null
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const finish = async (force = false) => {
    setBusy(true)
    setErr(null)
    try {
      await onFinish(force)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const p = s.profile
  const c = s.connection
  const opts: { key: OpModeKey; title: string; body: string; icon: typeof Bot; note: string }[] = [
    {
      key: 'auto',
      title: '자동 운전',
      body: 'AI 조정안을 바로 중앙 제어기에 반영합니다. 보낸 명령과 근거는 모두 기록되고, 언제든 추천 모드로 바꿀 수 있습니다.',
      icon: Bot,
      note: '운영이 안정된 뒤 권합니다',
    },
    {
      key: 'recommend',
      title: '추천만 받기',
      body: 'AI는 조정안과 예상 효과(전력·요금·쾌적)만 제안합니다. 담당자가 승인한 조정만 중앙 제어기에 보냅니다.',
      icon: Hand,
      note: '처음 도입할 때 권합니다',
    },
  ]
  return (
    <div>
      <StepHead n={6} title="운전을 얼마나 맡길지 고르세요" desc="ThermoPlan은 매일 새로 들어온 데이터로 계획을 검증하고 조정안을 만듭니다. 그 조정안을 바로 운전에 반영할지, 담당자 승인을 거칠지 정합니다." />
      <div className="grid gap-4 md:grid-cols-2" role="radiogroup" aria-label="운전 모드">
        {opts.map((o) => {
          const on = s.mode === o.key
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => patch({ mode: o.key })}
              className={cx(
                'rounded-[16px] border p-6 text-left transition-[border-color,background-color,box-shadow] duration-150',
                on ? 'border-brand bg-brand-bg/50 shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line bg-surface hover:border-ink-4',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[18px] font-[650] text-ink">
                  <o.icon size={20} className={on ? 'text-brand' : 'text-ink-3'} aria-hidden /> {o.title}
                </span>
                <span className={cx('flex h-5 w-5 items-center justify-center rounded-full border-2', on ? 'border-brand bg-brand' : 'border-line-strong')} aria-hidden>
                  {on && <Check size={12} className="text-white" strokeWidth={3} />}
                </span>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{o.body}</p>
              <p className="mt-3 text-[13px] font-medium text-ink-3">{o.note}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-8 rounded-[16px] border border-line bg-surface p-5">
        <h2 className="text-[15px] font-semibold text-ink">설정 요약</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-ink-3">건물</dt>
            <dd className="font-medium text-ink">
              {p ? `${p.org ? `${p.org} ` : ''}${p.name}` : '–'} {p && <span className="text-ink-3">({TYPE_LABEL[p.type]})</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">중앙 제어 연결</dt>
            <dd className="tnum font-medium text-ink">
              {c ? `${PROTOCOLS[c.protocol]?.label ?? c.protocol} ${c.method === 'file' ? '파일 업로드' : `${c.host}:${c.port}`}` : '–'}
              {c?.points ? <span className="text-ink-3">, 포인트 {fmtNum(c.points)}개</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">수집한 데이터</dt>
            <dd className="font-medium text-ink">{collect ? `강의 ${fmtNum(collect.counts.courses)}개, 강의실 ${fmtNum(collect.counts.rooms)}개, 날씨 ${fmtNum(collect.counts.weather_days)}일치` : '–'}</dd>
          </div>
          <div>
            <dt className="text-ink-3">반영한 답변</dt>
            <dd className="font-medium text-ink">{s.applied ? `${s.applied.length}개 항목` : '기본값 사용'}</dd>
          </div>
        </dl>
      </div>

      {err && (
        <div className="mt-5 space-y-3">
          <ErrorBox title="서버에 설정을 저장하지 못했습니다" error={err} onRetry={() => finish(false)} />
          <button type="button" onClick={() => finish(true)} className="text-[14px] font-medium text-brand-ink underline-offset-4 hover:underline">
            저장하지 않고 운전 현황으로 이동
          </button>
        </div>
      )}

      <StepFooter onBack={onBack} onNext={() => finish(false)} busy={busy} nextLabel={s.mode === 'auto' ? '자동 운전 시작하기' : '추천 모드로 시작하기'} />
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function Setup() {
  const { user, logout, completeOnboarding } = useAuth()
  const nav = useNavigate()
  const { s, patch, clear } = useWizard(user?.id ?? 'anon', user?.org ?? '')
  const [collect, setCollect] = useState<CollectResult | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  // the collect response is cached by useApi; keep a copy so steps 4 and 6 can use it after a reload
  const collectQ = useApi<CollectResult>(s.reached >= 2 && !collect ? '/api/onboarding/collect' : null)
  useEffect(() => {
    if (collectQ.data && !collect) setCollect(collectQ.data)
  }, [collectQ.data, collect])
  const questions = useMemo(() => (Array.isArray(collect?.questions) ? collect!.questions : []), [collect])

  const go = (i: number) => {
    patch({ step: i, reached: Math.max(s.reached, i) })
    topRef.current?.scrollIntoView({ block: 'start' })
    window.scrollTo({ top: 0 })
  }

  const finish = async (force = false) => {
    const name = s.profile?.name.trim() || '내 건물'
    if (!force) {
      await apiSend('PUT', '/api/mode', { mode: s.mode })
      await apiSend('PUT', '/api/building', {
        name,
        org: s.profile?.org ?? user?.org ?? '',
        type: s.profile?.type ?? 'etc',
        address: s.profile?.address ?? '',
        connection: s.connection,
        onboarded_at: new Date().toISOString(),
      })
      invalidate('/api/')
    }
    completeOnboarding(name)
    clear()
    toast(s.mode === 'auto' ? '자동 운전을 시작했습니다.' : '추천 모드로 시작했습니다. 조정안은 승인 후 반영됩니다.')
    nav('/', { replace: true })
  }

  const step = s.step
  return (
    <div className="min-h-full bg-paper" ref={topRef}>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-6">
          <Brand sub="건물 연결 설정" />
          <div className="flex items-center gap-3 text-[14px]">
            <span className="hidden text-ink-2 sm:inline">
              {user?.org && user.org !== user.name ? `${user.org} ` : ''}
              {user?.name}
            </span>
            <button
              type="button"
              onClick={() => {
                logout()
                nav('/welcome', { replace: true })
              }}
              className={btnCls('ghost', 'sm')}
            >
              <LogOut size={14} aria-hidden /> 로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="설정 단계" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
            {STEPS.map((st, i) => {
              const state = i < step ? 'done' : i === step ? 'now' : 'todo'
              const can = i <= s.reached
              return (
                <li key={st.key} className="shrink-0">
                  <button
                    type="button"
                    disabled={!can}
                    onClick={() => can && go(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors',
                      i === step ? 'bg-surface shadow-[0_0_0_1px_var(--color-line)]' : can ? 'hover:bg-hover' : 'cursor-default',
                    )}
                  >
                    <span
                      className={cx(
                        'tnum flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                        state === 'done' && 'bg-brand text-white',
                        state === 'now' && 'bg-ink text-white',
                        state === 'todo' && 'bg-surface text-ink-3 ring-1 ring-line-strong',
                      )}
                    >
                      {state === 'done' ? <Check size={14} strokeWidth={3} aria-hidden /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cx('block text-[14.5px] font-semibold whitespace-nowrap', state === 'todo' ? 'text-ink-3' : 'text-ink')}>{st.label}</span>
                      <span className="hidden text-[12.5px] text-ink-3 lg:block">{st.desc}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="mt-6 hidden rounded-[12px] border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink-3 lg:block">
            <Building2 size={16} className="mb-1.5 text-ink-3" aria-hidden />
            중간에 새로 고쳐도 입력한 내용은 이 창에 남습니다.
          </div>
        </nav>

        <section className="min-w-0 rounded-[20px] border border-line bg-surface p-8 max-sm:p-5">
          {step === 0 && <ProfileStep s={s} patch={patch} onNext={() => go(1)} />}
          {step === 1 && <ConnectStep s={s} patch={patch} onBack={() => go(0)} onNext={() => go(2)} />}
          {step === 2 && (
            <CollectStep
              onBack={() => go(1)}
              onNext={(c) => {
                setCollect(c)
                go(3)
              }}
            />
          )}
          {step === 3 && <QuestionsStep questions={questions} s={s} patch={patch} onBack={() => go(2)} onNext={() => go(4)} />}
          {step === 4 && <PlanStep onBack={() => go(3)} onNext={() => go(5)} />}
          {step === 5 && <ModeStep s={s} patch={patch} onBack={() => go(4)} onFinish={finish} collect={collect} />}
        </section>
      </div>
    </div>
  )
}
