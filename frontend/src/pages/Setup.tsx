import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, CheckCircle2, Cloud, Copy, FileUp, LogOut, Network, RefreshCw, Router, Server, Upload } from 'lucide-react'
import { sourceMeta } from '../components/dataSources'
import { apiSend, invalidate, useApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { BmsConnection, BmsPoint, BuildingType, CollectResult, ConnectResult, OnboardQuestion, OpModeKey, Policy, ProfileParse } from '../lib/types'
import { cx, fmtNum } from '../lib/format'
import { ErrorBox, Note, Spinner, btnCls, tbl, toast } from '../components/ui'
import { Ondy } from '../components/PublicShell'
import { ChoiceCard, ObChips, ObCta, ObField, ObMore, ObShell, ObStep, ObTextButton, ObTitle, SuccessMark, obInput, useStepDir } from '../components/Onboarding'

// ---------------------------------------------------------------- vocabulary

/** One screen per step. The connection part is its own short flow: intro → method → details → verify → connected. */
const ORDER = ['describe', 'confirm', 'intro', 'method', 'details', 'verify', 'connected', 'rules', 'done'] as const
type Screen = (typeof ORDER)[number]
const at = (s: Screen) => ORDER.indexOf(s)

/** Onboarding registers the building and its equipment only; the timetable comes later on the dashboard. */
const FACILITY_QUESTIONS = ['policy_heat', 'policy_cool', 'hours']

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
  vendor_api: { label: '제조사 API', port: 443, note: '중앙제어기 제조사가 제공하는 웹 API(HTTPS)' },
  opcua: { label: 'OPC UA', port: 4840, note: '설비 통합 표준(TCP 4840)' },
}

const VENDORS = ['LG전자 중앙제어기', '삼성전자 중앙제어기', '범용 BACnet 컨트롤러', '기타 제조사']

const METHODS: { key: BmsConnection['method']; title: string; short: string; body: string; icon: typeof Router; badge?: string }[] = [
  {
    key: 'gateway',
    title: '현장 게이트웨이 설치',
    short: '가장 안정적인 방식',
    body: '중앙 제어 PC와 같은 내부망에 작은 게이트웨이를 설치합니다. 클라우드로 나가는 암호화 연결(TLS 443)만 쓰므로 방화벽을 열 필요가 없습니다.',
    icon: Router,
    badge: '권장',
  },
  {
    key: 'direct',
    title: '직접 연결',
    short: '네트워크 연결이 가능한 경우',
    body: '중앙 제어 PC가 외부 API를 제공하면 VPN이나 허용 IP로 직접 연결합니다. 전산 담당자의 방화벽 설정이 필요합니다.',
    icon: Network,
  },
  {
    key: 'file',
    title: '파일 업로드',
    short: '자동 제어 없이 분석만 진행',
    body: '네트워크 연결이 어려우면 중앙 제어 프로그램이 내보낸 운전 이력 CSV를 올립니다. 자동 운전은 쓸 수 없고 추천만 받습니다.',
    icon: FileUp,
  },
]

const EXAMPLE = '부산대학교 IT관입니다. 3층과 4층 강의실 10개를 시스템 에어컨으로 운영하고, 중앙 제어 PC가 시설과에 있습니다.'

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
  screen: Screen
  /** question index on the rules screen */
  qi: number
  /** furthest screen reached (index into ORDER) */
  reached: number
  text: string
  profile: ProfileDraft | null
  parseError: string | null
  form: ConnectForm
  result: ConnectResult | null
  connection: BmsConnection | null
  answers: Record<string, unknown>
  applied: string[] | null
  mode: OpModeKey
}

function pairCode() {
  const r = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X')
  return `TP-${r()}-${r()}`
}

function initialState(org: string): WizardState {
  return {
    screen: 'describe',
    qi: 0,
    reached: 0,
    text: org.includes('부산대') ? EXAMPLE : '',
    profile: null,
    parseError: null,
    form: { method: 'gateway', vendor: VENDORS[0], protocol: 'bacnet', host: '10.21.3.40', port: 47808, pairCode: pairCode(), fileName: '' },
    result: null,
    connection: null,
    answers: {},
    applied: null,
    mode: 'recommend',
  }
}

function useWizard(userId: string, org: string) {
  const key = `tp.setup.${userId}`
  const [s, setS] = useState<WizardState>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<WizardState>
        const merged = { ...initialState(org), ...saved }
        return ORDER.includes(merged.screen) ? merged : { ...merged, screen: 'describe' }
      }
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

/** Reveal n items one after another (the connection test "happens" in front of the operator). */
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

const HOST_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?!$)|$)){4}$|^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

// ---------------------------------------------------------------- building

function DescribeScreen({ s, patch, go }: { s: WizardState; patch: (p: Partial<WizardState>) => void; go: (x: Screen) => void }) {
  const [busy, setBusy] = useState(false)
  const blank: ProfileDraft = { name: '', org: '', type: 'school', address: '', floors: null, note: '', ai: null, clarification: null }

  const parse = async () => {
    setBusy(true)
    try {
      const r = await apiSend<ProfileParse>('POST', '/api/onboarding/profile', { text: s.text.trim() })
      patch({
        parseError: null,
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
      // keep going by hand: the next screen opens as an empty form
      patch({ parseError: (e as Error).message, profile: s.profile ?? blank })
    } finally {
      setBusy(false)
    }
    go('confirm')
  }

  return (
    <>
      <ObTitle eyebrow="건물 정보" title="어떤 건물인가요?" desc="이름과 용도를 편하게 적어 주세요. AI가 정리해요." />
      <div className="ob-rise ob-d2">
        <label htmlFor="bld-text" className="sr-only">
          건물 설명
        </label>
        <textarea
          id="bld-text"
          name="building-description"
          value={s.text}
          onChange={(e) => patch({ text: e.target.value })}
          rows={4}
          maxLength={500}
          autoFocus
          placeholder="예: 부산대학교 IT관, 3~4층 강의실 10개"
          className={cx(obInput, 'h-auto min-h-[140px] resize-none py-3.5 leading-[1.6]')}
        />
        <div className="mt-2.5 flex items-center justify-between text-[14px]">
          {s.text ? <span /> : <ObTextButton onClick={() => patch({ text: EXAMPLE })}>예시 넣기</ObTextButton>}
          <span className="tnum text-ink-4">{s.text.length}/500</span>
        </div>
      </div>
      <ObCta
        onClick={parse}
        busy={busy}
        disabled={s.text.trim().length < 2}
        below={
          <ObTextButton
            onClick={() => {
              patch({ parseError: null, profile: s.profile ?? blank })
              go('confirm')
            }}
          >
            {s.profile ? '앞서 정리한 내용으로 계속' : '직접 입력할게요'}
          </ObTextButton>
        }
      >
        {busy ? '정리하는 중…' : 'AI로 정리하기'}
      </ObCta>
    </>
  )
}

function ConfirmScreen({ s, patch, go }: { s: WizardState; patch: (p: Partial<WizardState>) => void; go: (x: Screen) => void }) {
  const p = s.profile
  if (!p) return null
  const set = (k: keyof ProfileDraft, v: unknown) => patch({ profile: { ...p, [k]: v } })
  const isDemoBuilding = /IT\s*관|아이티관/.test(p.name)
  const manual = p.ai === null && !p.name
  return (
    <>
      <ObTitle
        eyebrow="건물 정보"
        title={s.parseError || manual ? '건물 정보를 적어 주세요' : '이렇게 이해했어요'}
        desc={s.parseError ? 'AI로 정리하지 못했어요. 직접 입력해 주세요.' : p.ai === false ? 'AI 연결이 불안정해 규칙으로 읽었어요. 틀린 곳만 고쳐 주세요.' : manual ? undefined : '틀린 곳만 고쳐 주세요.'}
      />
      <div className="ob-rise ob-d2 space-y-5">
        {p.clarification && (
          <Note tone="warn" icon={<AlertTriangle size={15} aria-hidden />}>
            {p.clarification}
          </Note>
        )}
        <ObField label="건물 이름">
          <input className={obInput} name="building-name" autoComplete="off" value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="예: IT관" />
        </ObField>
        <ObField label="학교·회사">
          <input className={obInput} name="building-org" autoComplete="organization" value={p.org} onChange={(e) => set('org', e.target.value)} placeholder="예: 부산대학교" />
        </ObField>
        <div>
          <span className="mb-2 block text-[14px] font-medium text-ink-2">건물 유형</span>
          <ObChips
            label="건물 유형"
            cols={3}
            value={p.type}
            onChange={(v) => set('type', v)}
            options={(Object.keys(TYPE_LABEL) as BuildingType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
        </div>
        <ObField label="주소" hint={p.floors ? `${p.floors}개 층으로 이해했어요` : undefined}>
          <input className={obInput} name="building-address" autoComplete="street-address" value={p.address} onChange={(e) => set('address', e.target.value)} placeholder="선택 입력" />
        </ObField>
        {p.note && p.note.trim() !== s.text.trim() && <p className="text-[14px] leading-[1.6] text-ink-3">{p.note}</p>}
        {s.parseError && <p className="text-[13px] text-ink-4">{s.parseError}</p>}
        {!isDemoBuilding && p.name.trim() && <p className="text-[13.5px] text-ink-3">시연에서는 다음 단계가 부산대학교 IT관 시뮬레이터에 연결돼요.</p>}
      </div>
      <ObCta onClick={() => go('intro')} disabled={!p.name.trim()}>
        다음
      </ObCta>
    </>
  )
}

// ---------------------------------------------------------------- central control connection

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

function MethodScreen({ f, setF, go }: { f: ConnectForm; setF: (p: Partial<ConnectForm>) => void; go: (x: Screen) => void }) {
  return (
    <>
      <ObTitle eyebrow="중앙 제어 연결 · 1/3" title="어떻게 연결할까요?" />
      <div role="radiogroup" aria-label="연결 방식" className="ob-rise ob-d1 space-y-3">
        {METHODS.map((m) => (
          <ChoiceCard
            key={m.key}
            selected={f.method === m.key}
            onSelect={() => setF({ method: m.key })}
            icon={<m.icon size={20} aria-hidden />}
            title={m.title}
            desc={m.short}
            badge={m.badge}
          />
        ))}
      </div>
      <ObMore label="방식별 차이 보기" className="ob-rise ob-d2 mt-5">
        <dl className="space-y-3 text-[14px] leading-[1.6]">
          {METHODS.map((m) => (
            <div key={m.key}>
              <dt className="font-semibold text-ink">{m.title}</dt>
              <dd className="text-ink-2">{m.body}</dd>
            </div>
          ))}
        </dl>
      </ObMore>
      <ObCta onClick={() => go('details')}>다음</ObCta>
    </>
  )
}

function DetailsScreen({ f, setF, go }: { f: ConnectForm; setF: (p: Partial<ConnectForm>) => void; go: (x: Screen) => void }) {
  const file = f.method === 'file'
  const hostOk = file ? !!f.fileName : HOST_RE.test(f.host.trim())
  const portOk = Number.isInteger(f.port) && f.port > 0 && f.port < 65536
  const target = `${f.host || '<중앙제어 PC 주소>'}:${f.port}`
  const cmd = `# ThermoPlan 저장소의 gateway 폴더 (읽기 전용으로 시작, 명령 적용은 --allow-write)\ndocker build -t thermoplan-gateway . && docker run -d --restart=always --network host \\\n  thermoplan-gateway --pair ${f.pairCode} --controller ${target}\n# Docker 없이: pip install -r requirements.txt && python edge_gateway.py --pair ${f.pairCode} --controller ${target}`

  return (
    <>
      <ObTitle eyebrow="중앙 제어 연결 · 2/3" title={file ? '운전 이력 파일을 올려 주세요' : '연결 정보를 알려 주세요'} />
      <div className="ob-rise ob-d1 space-y-7">
        <div>
          <span className="mb-2 block text-[14px] font-medium text-ink-2">제조사</span>
          <ObChips label="제조사" value={f.vendor} onChange={(v) => setF({ vendor: v })} options={VENDORS.map((v) => ({ value: v, label: v }))} />
        </div>

        {file ? (
          <ObField label="운전 이력 파일" hint="중앙 제어 프로그램의 '운전 이력 내보내기' 파일 (CSV · XLSX · TXT)">
            <span
              className={cx(
                'flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-dashed px-4 text-center transition-colors duration-200',
                f.fileName ? 'border-brand bg-[#f5f8fe]' : 'border-[#d3d7dd] hover:border-ink-4 hover:bg-[#fafbfc]',
              )}
            >
              <Upload size={22} className={f.fileName ? 'text-brand' : 'text-ink-3'} aria-hidden />
              <span className="max-w-full truncate text-[16px] font-semibold text-ink">{f.fileName || '파일 선택'}</span>
              <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => setF({ fileName: e.target.files?.[0]?.name ?? '' })} />
            </span>
          </ObField>
        ) : (
          <>
            <div>
              <span className="mb-2 block text-[14px] font-medium text-ink-2">통신 방식</span>
              <ObChips
                label="통신 방식"
                value={f.protocol}
                onChange={(p) => {
                  // follow the protocol's default port unless the operator typed another one
                  const usedDefault = f.port === PROTOCOLS[f.protocol].port
                  setF({ protocol: p, port: usedDefault ? PROTOCOLS[p].port : f.port })
                }}
                options={(Object.keys(PROTOCOLS) as BmsConnection['protocol'][]).map((k) => ({ value: k, label: PROTOCOLS[k].label, sub: `포트 ${PROTOCOLS[k].port}` }))}
              />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-3">
              <ObField label="중앙 제어 PC 주소" error={f.host && !hostOk ? 'IP 주소나 호스트 이름 형식이 아니에요' : undefined}>
                <input
                  className={cx(obInput, 'tnum')}
                  name="bms-host"
                  autoComplete="off"
                  spellCheck={false}
                  value={f.host}
                  aria-invalid={!!f.host && !hostOk}
                  onChange={(e) => setF({ host: e.target.value })}
                  placeholder="10.21.3.40"
                />
              </ObField>
              <ObField label="포트" error={!portOk ? '1~65535' : undefined}>
                <input
                  className={cx(obInput, 'tnum')}
                  name="bms-port"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={!portOk}
                  value={Number.isFinite(f.port) ? String(f.port) : ''}
                  onChange={(e) => setF({ port: Number(e.target.value.replace(/\D/g, '')) })}
                />
              </ObField>
            </div>
          </>
        )}

        {f.method === 'gateway' && (
          <div className="rounded-[14px] border border-line px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-medium text-ink-2">게이트웨이 연결 코드</span>
              <button type="button" className={btnCls('ghost', 'sm')} onClick={() => setF({ pairCode: pairCode() })}>
                <RefreshCw size={13} aria-hidden /> 새로 만들기
              </button>
            </div>
            <div className="tnum mt-1 font-mono text-[22px] font-semibold tracking-[0.06em] text-ink" translate="no">
              {f.pairCode}
            </div>
            <ObMore label="설치 명령 보기" className="mt-2">
              <p className="mb-2 text-[13.5px] text-ink-3">중앙 제어 PC와 같은 망의 PC에서 실행하면 이 코드로 계정에 연결돼요.</p>
              <pre className="thin-scroll overflow-x-auto rounded-[10px] bg-[#0f1b2d] px-4 py-3 text-[12.5px] leading-relaxed text-[#d7e3f6]" translate="no">
                {cmd}
              </pre>
              <div className="mt-2 flex justify-end">
                <CopyText text={cmd.replace(/\\\n\s+/g, '')} label="설치 명령 복사" />
              </div>
            </ObMore>
          </div>
        )}
        <p className="text-[13.5px] text-ink-3">시연에서는 입력한 주소 대신 부산대학교 IT관 중앙 제어 시뮬레이터가 응답해요.</p>
      </div>
      <ObCta onClick={() => go('verify')} disabled={!hostOk || (!file && !portOk)}>
        다음
      </ObCta>
    </>
  )
}

type WireState = 'idle' | 'live' | 'ok' | 'fail'

/** The connection drawn large and simple: central control PC → (gateway) → ON:D. */
function Topology({ f, state }: { f: ConnectForm; state: WireState }) {
  const on = state === 'ok'
  const proto = PROTOCOLS[f.protocol].label
  const node = (icon: ReactNode, title: string, sub: string, brand = false) => (
    <div className="flex w-[76px] shrink-0 flex-col items-center text-center sm:w-[124px]">
      <span className={cx('ob-node flex h-14 w-14 items-center justify-center rounded-[16px] border border-line sm:h-16 sm:w-16 sm:rounded-[18px]', on && 'is-on', !on && (brand ? 'text-brand' : 'text-ink-2'))}>{icon}</span>
      <span className="mt-3 text-[14px] leading-tight font-semibold whitespace-nowrap text-ink sm:text-[15px]">{title}</span>
      <span className="tnum mt-1 max-w-full truncate text-[12.5px] text-ink-3">{sub}</span>
    </div>
  )
  const wire = (label: string) => (
    <div className="relative flex h-14 min-w-[30px] flex-1 items-center sm:h-16">
      <span className={cx('ob-wire', state === 'live' && 'is-live', state === 'ok' && 'is-ok', state === 'fail' && 'is-fail')} aria-hidden />
      <span className="absolute top-[3px] left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-ink-3 sm:top-[6px] sm:text-[12px]">{label}</span>
    </div>
  )
  return (
    <div className="flex items-start" role="img" aria-label="연결 구조">
      {node(<Server size={26} aria-hidden />, '중앙 제어 PC', f.method === 'file' ? 'CSV 내보내기' : `${f.host || '주소 미입력'}:${f.port || '-'}`)}
      {f.method === 'gateway' && (
        <>
          {wire(proto)}
          {node(<Router size={26} aria-hidden />, '게이트웨이', '건물 내부망')}
          {wire('TLS 443')}
        </>
      )}
      {f.method === 'direct' && wire(`VPN · ${proto}`)}
      {f.method === 'file' && wire('파일 업로드')}
      {node(<Cloud size={26} aria-hidden />, 'ON:D', 'AWS 서울 리전', true)}
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

function PointGroup({ room, pts }: { room: string; pts: BmsPoint[] }) {
  return (
    <>
      <tr className="bg-[#fafbfc]">
        <td colSpan={5} className="border-b border-line px-3.5 py-2 text-[13px] font-semibold text-ink">
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

function VerifyScreen({ s, patch, go }: { s: WizardState; patch: (p: Partial<WizardState>) => void; go: (x: Screen) => void }) {
  const f = s.form
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [runId, setRunId] = useState(0) // restarts the step animation on every test
  const res = s.result
  const steps = Array.isArray(res?.steps) ? res!.steps : []
  const shown = useReveal(steps.length, !!res && runId > 0, (i) => Math.min(Math.max(steps[i]?.ms ?? 400, 280), 900))
  const done = !!res && (runId === 0 || shown >= steps.length)
  const state: WireState = busy || (res && !done) ? 'live' : done && res?.ok ? 'ok' : done && res && !res.ok ? 'fail' : 'idle'

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

  const ok = done && !!res?.ok
  return (
    <>
      <ObTitle eyebrow="중앙 제어 연결 · 3/3" title="연결을 확인해요" desc={ok ? '연결했어요. 받은 값을 확인해 주세요.' : '구조를 확인하고 연결 테스트를 눌러 주세요.'} />
      <div className="ob-rise ob-d2 border-y border-line py-8">
        <Topology f={f} state={state} />
      </div>

      <div className="mt-6 space-y-5" aria-live="polite">
        {err && <ErrorBox title="연결하지 못했습니다" error={err} onRetry={test} />}
        {res && (
          <ol>
            {steps.slice(0, runId === 0 ? steps.length : shown).map((st) => (
              <li key={st.key} className="ob-reveal flex items-start gap-3 border-b border-line py-3">
                {st.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good" aria-hidden /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-crit" aria-hidden />}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-ink">{st.label}</div>
                  <div className="text-[14px] text-ink-3">{st.detail}</div>
                </div>
                <span className="tnum shrink-0 text-[13px] text-ink-4">{st.ms}ms</span>
              </li>
            ))}
            {!done && (
              <li className="flex items-center gap-2 py-3 text-[14.5px] text-ink-3">
                <Spinner size={14} /> 확인 중…
              </li>
            )}
          </ol>
        )}

        {done && res && !res.ok && <ErrorBox title="연결 테스트에 실패했습니다" error={res.error || '중앙 제어 PC가 응답하지 않습니다. 주소·포트·방화벽을 확인하세요.'} />}

        {ok && res && (
          <div className="ob-reveal">
            <dl className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5">
              {(
                [
                  ['강의실', res.summary.rooms, '개'],
                  ['실내기', res.summary.idus, '대'],
                  ['실외기', res.summary.odus, '대'],
                  ['센서', res.summary.sensors, '개'],
                  ['제어 포인트', res.summary.points, '개'],
                ] as const
              ).map(([l, v, u]) => (
                <div key={l}>
                  <dt className="text-[13.5px] text-ink-3">{l}</dt>
                  <dd className="tnum mt-1 text-[26px] leading-none font-bold tracking-[-0.02em] text-ink">
                    {fmtNum(v)}
                    <span className="ml-0.5 text-[14px] font-medium text-ink-3">{u}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {res.source && (
              <p className={cx('mt-5 text-[14px] leading-[1.6]', res.source === 'gateway' ? 'text-good-ink' : 'text-warn-ink')}>
                <b className="font-semibold">{res.source === 'gateway' ? '실제 게이트웨이에서 BACnet으로 읽은 값입니다.' : '시뮬레이터로 시험했습니다.'}</b> {res.note}
              </p>
            )}
            <p className="tnum mt-2 text-[13px] text-ink-4">
              게이트웨이 {res.gateway.id} · 버전 {res.gateway.version} · 지연 {res.gateway.latency_ms}ms
            </p>
            {res.points.length > 0 && (
              <ObMore label={`발견한 포인트 ${fmtNum(res.points.length)}개 보기`} className="mt-4">
                <div className={cx(tbl.frame, 'thin-scroll max-h-[340px] overflow-auto')}>
                  <table className={tbl.table}>
                    <thead className={cx(tbl.thead, 'sticky top-0 bg-surface')}>
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
              </ObMore>
            )}
          </div>
        )}
      </div>

      {ok ? (
        <ObCta onClick={() => go('connected')} below={<ObTextButton onClick={test}>다시 테스트</ObTextButton>}>
          다음
        </ObCta>
      ) : (
        <ObCta onClick={test} busy={busy || (!!res && !done)}>
          {busy ? '연결하는 중…' : res && !done ? '확인 중…' : res ? '다시 테스트' : '연결 테스트'}
        </ObCta>
      )}
    </>
  )
}

function ConnectedScreen({ s, go }: { s: WizardState; go: (x: Screen) => void }) {
  const r = s.result
  return (
    <div className="flex flex-1 flex-col items-center pt-[5vh] text-center">
      <SuccessMark />
      <div className="mt-8">
        <ObTitle center title="건물 연결 준비가 완료되었습니다" desc="이제 운영 규칙을 설정할 수 있습니다." />
      </div>
      {r?.ok && (
        <p className="ob-rise ob-d2 tnum -mt-3 text-[15px] text-ink-2">
          실내기 {fmtNum(r.summary.idus)}대 · 센서 {fmtNum(r.summary.sensors)}개 · 제어 포인트 {fmtNum(r.summary.points)}개
          {r.source && <span className="mt-1 block text-[13.5px] text-ink-3">{r.source === 'gateway' ? '실제 게이트웨이로 연결' : '시뮬레이터로 시험한 연결'}</span>}
        </p>
      )}
      <div className="w-full">
        <ObCta onClick={() => go('rules')}>운영 규칙 설정</ObCta>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- operating rules (one question per screen)

function defaultFor(q: OnboardQuestion): unknown {
  const d = q.default
  switch (q.kind) {
    case 'time_range':
      return Array.isArray(d) && d.length === 2 ? [String(d[0]), String(d[1])] : ['08:30', '18:00']
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

function validAnswer(q: OnboardQuestion, v: unknown) {
  if (q.kind === 'temp_range') return Array.isArray(v) && Number(v[0]) < Number(v[1])
  if (q.kind === 'time_range') return Array.isArray(v) && !!v[0] && !!v[1] && v[0] < v[1]
  if (q.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && (q.min == null || v >= q.min) && (q.max == null || v <= q.max)
  return v !== undefined && v !== ''
}

function RangeInputs({ a, b, unit, children }: { a: ReactNode; b: ReactNode; unit?: string; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">{a}</div>
        <span className="text-[18px] text-ink-4">~</span>
        <div className="min-w-0 flex-1">{b}</div>
        {unit && <span className="text-[16px] text-ink-3">{unit}</span>}
      </div>
      {children}
    </div>
  )
}

function QuestionInput({ q, value, onChange }: { q: OnboardQuestion; value: unknown; onChange: (v: unknown) => void }) {
  const unit = q.unit ?? ''
  const big = cx(obInput, 'tnum text-center text-[20px] font-semibold')
  if (q.kind === 'time_range') {
    const v = (Array.isArray(value) ? value : defaultFor(q)) as string[]
    return (
      <RangeInputs
        a={<input type="time" aria-label="시작" className={big} value={v[0]} onChange={(e) => onChange([e.target.value, v[1]])} />}
        b={<input type="time" aria-label="종료" className={big} value={v[1]} onChange={(e) => onChange([v[0], e.target.value])} />}
      />
    )
  }
  if (q.kind === 'temp_range') {
    const v = (Array.isArray(value) ? value : defaultFor(q)) as number[]
    const bad = Number(v[0]) >= Number(v[1])
    const num = (i: 0 | 1, label: string) => (
      <input
        type="number"
        aria-label={label}
        className={big}
        step={q.step ?? 0.5}
        min={q.min}
        max={q.max}
        value={v[i]}
        aria-invalid={bad}
        onChange={(e) => onChange(i === 0 ? [Number(e.target.value), v[1]] : [v[0], Number(e.target.value)])}
      />
    )
    return (
      <RangeInputs a={num(0, '최소')} b={num(1, '최대')} unit={unit || '℃'}>
        {bad && <p className="mt-2 text-[13.5px] text-crit-ink">최소값은 최대값보다 낮아야 해요.</p>}
      </RangeInputs>
    )
  }
  if (q.kind === 'number') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="number"
          aria-label={q.title}
          className={cx(big, 'max-w-[200px]')}
          step={q.step ?? 1}
          min={q.min}
          max={q.max}
          value={typeof value === 'number' ? value : Number(defaultFor(q))}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {unit && <span className="text-[16px] text-ink-3">{unit}</span>}
      </div>
    )
  }
  const options = q.kind === 'choice' ? (q.options ?? []).map((o) => ({ v: o.value as unknown, l: o.label })) : [{ v: true as unknown, l: '네, 맞아요' }, { v: false as unknown, l: '아니요' }]
  return (
    <div role="radiogroup" aria-label={q.title} className="space-y-2.5">
      {options.map((o) => (
        <ChoiceCard key={String(o.v)} selected={value === o.v} onSelect={() => onChange(o.v)} title={o.l} />
      ))}
    </div>
  )
}

function RulesScreen({
  s,
  patch,
  go,
  questions,
  collect,
}: {
  s: WizardState
  patch: (p: Partial<WizardState>) => void
  go: (x: Screen, qi?: number) => void
  questions: OnboardQuestion[]
  collect: { loading: boolean; error?: Error; reload: () => void; ready: boolean }
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const value = (q: OnboardQuestion) => (q.id in s.answers ? s.answers[q.id] : defaultFor(q))

  if (collect.error) {
    return (
      <>
        <ObTitle eyebrow="운영 규칙" title="질문을 불러오지 못했어요" />
        <ErrorBox error={collect.error} onRetry={collect.reload} />
      </>
    )
  }
  if (!collect.ready) {
    return (
      <>
        <ObTitle eyebrow="운영 규칙" title="확인할 것을 고르는 중이에요" />
        <div className="flex items-center gap-2 text-[15px] text-ink-3">
          <Spinner size={16} /> 중앙 제어 PC에서 받은 값을 보고 있어요…
        </div>
      </>
    )
  }
  if (questions.length === 0) {
    return (
      <>
        <ObTitle eyebrow="운영 규칙" title="더 정할 것이 없어요" desc="바로 마무리할게요." />
        <ObCta onClick={() => go('done')}>다음</ObCta>
      </>
    )
  }

  const qi = Math.min(s.qi, questions.length - 1)
  const q = questions[qi]
  const last = qi === questions.length - 1

  const submit = async (answersIn: Record<string, unknown>) => {
    setBusy(true)
    setErr(null)
    try {
      const answers: Record<string, unknown> = {}
      for (const x of questions) answers[x.id] = x.id in answersIn ? answersIn[x.id] : defaultFor(x)
      const r = await apiSend<{ policy?: Policy; applied?: string[] }>('POST', '/api/onboarding/answers', { answers })
      const applied = Array.isArray(r?.applied) ? r.applied : []
      const mode = answers.mode === 'auto' || answers.mode === 'recommend' ? (answers.mode as OpModeKey) : s.mode
      patch({ answers, applied, mode })
      // settings changed: schedules and plans must be recomputed
      invalidate('/api/')
      go('done')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    const answers = { ...s.answers, [q.id]: value(q) }
    if (last) return submit(answers)
    patch({ answers, applied: null })
    go('rules', qi + 1)
  }

  return (
    <>
      <ObTitle eyebrow={`운영 규칙 · ${qi + 1}/${questions.length}`} title={q.title} desc="제안값이에요. 다르면 고쳐 주세요." />
      <div className="ob-rise ob-d2">
        <QuestionInput q={q} value={value(q)} onChange={(v) => patch({ answers: { ...s.answers, [q.id]: v }, applied: null })} />
        <p className="mt-4 text-[13.5px] text-ink-3">
          출처 {sourceMeta(q.source).label}
          {q.affects ? ` · 반영: ${q.affects}` : ''}
        </p>
        {q.why && (
          <ObMore label="왜 묻나요?" className="mt-3">
            <p className="text-[14px] leading-[1.65] text-ink-2">{q.why}</p>
          </ObMore>
        )}
      </div>
      {err && (
        <div className="mt-5">
          <ErrorBox title="답변을 반영하지 못했습니다" error={err} onRetry={next} />
        </div>
      )}
      <ObCta
        onClick={next}
        busy={busy}
        disabled={!validAnswer(q, value(q))}
        below={!last && <ObTextButton onClick={() => submit(s.answers)}>나머지는 제안값으로</ObTextButton>}
      >
        {busy ? '반영하는 중…' : last ? '반영하기' : '다음'}
      </ObCta>
    </>
  )
}

function DoneScreen({ s, onFinish }: { s: WizardState; onFinish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-1 flex-col items-center pt-[5vh] text-center">
      <SuccessMark />
      <div className="mt-8">
        <ObTitle center title="모든 준비가 끝났어요" desc="지금 운영을 먼저 보여 드려요. 시간표를 넣으면 AI 운전으로 바뀌어요." />
      </div>
      {s.applied && s.applied.length > 0 && (
        <ul className="ob-rise ob-d2 -mt-2 w-full space-y-2 border-y border-line py-5 text-left text-[15px] text-ink-2">
          {s.applied.map((a) => (
            <li key={a} className="flex items-start gap-2.5">
              <Check size={16} className="mt-1 shrink-0 text-brand" strokeWidth={2.6} aria-hidden /> {a}
            </li>
          ))}
        </ul>
      )}
      <div className="w-full">
        <ObCta
          busy={busy}
          onClick={() => {
            setBusy(true)
            onFinish().catch((e: Error) => {
              toast(e.message, 'crit')
              setBusy(false)
            })
          }}
        >
          운영 현황으로
        </ObCta>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function Setup() {
  const { user, logout, completeOnboarding } = useAuth()
  const nav = useNavigate()
  const { s, patch, clear } = useWizard(user?.id ?? 'anon', user?.org ?? '')
  const [collect, setCollect] = useState<CollectResult | null>(null)

  // the collect response is cached by useApi; keep a copy so the rules screens can use it after a reload
  const collectQ = useApi<CollectResult>(s.reached >= at('connected') && !collect ? '/api/onboarding/collect' : null)
  useEffect(() => {
    if (collectQ.data && !collect) setCollect(collectQ.data)
  }, [collectQ.data, collect])
  const questions = useMemo(
    () => (Array.isArray(collect?.questions) ? collect!.questions.filter((q) => FACILITY_QUESTIONS.includes(q.id)) : []),
    [collect],
  )

  const nQ = Math.max(questions.length, 1)
  const pos = s.screen === 'rules' ? at('rules') + s.qi : s.screen === 'done' ? at('rules') + nQ : at(s.screen)
  const dir = useStepDir(pos)
  const total = at('rules') + nQ + 1

  const go = (screen: Screen, qi = 0) => {
    patch({ screen, qi, reached: Math.max(s.reached, at(screen)) })
    window.scrollTo({ top: 0 })
  }
  const setF = (p: Partial<ConnectForm>) => patch({ form: { ...s.form, ...p }, result: null, connection: null })

  const back: Record<Screen, (() => void) | undefined> = {
    describe: undefined,
    confirm: () => go('describe'),
    intro: () => go('confirm'),
    method: () => go('intro'),
    details: () => go('method'),
    verify: () => go('details'),
    connected: () => go('verify'),
    rules: () => (s.qi > 0 ? go('rules', s.qi - 1) : go('connected')),
    done: () => (questions.length ? go('rules', questions.length - 1) : go('connected')),
  }

  const finish = async () => {
    const name = s.profile?.name.trim() || '내 건물'
    await apiSend('PUT', '/api/building', {
      name,
      org: s.profile?.org ?? user?.org ?? '',
      type: s.profile?.type ?? 'etc',
      address: s.profile?.address ?? '',
      connection: s.connection,
      onboarded_at: new Date().toISOString(),
    })
    invalidate('/api/')
    completeOnboarding(name)
    clear()
    toast('건물 등록을 마쳤습니다. 지금은 현재 운영을 보여 줍니다. 오른쪽 위 "시간표 넣기"로 AI 1차 스케줄을 만드세요.')
    nav('/', { replace: true })
  }

  // a screen that needs an earlier answer sends the operator back to it
  const screen: Screen = (s.screen !== 'describe' && !s.profile) ? 'describe' : (at(s.screen) > at('verify') && !s.connection) ? 'verify' : s.screen

  let body: ReactNode
  switch (screen) {
    case 'describe':
      body = <DescribeScreen s={s} patch={patch} go={go} />
      break
    case 'confirm':
      body = <ConfirmScreen s={s} patch={patch} go={go} />
      break
    case 'intro':
      body = (
        <div className="flex flex-1 flex-col">
          <div className="ob-rise flex justify-center pb-6">
            <Ondy pose="hvac" size={148} pop />
          </div>
          <ObTitle center eyebrow="중앙 제어 연결" title="건물의 중앙 제어 시스템을 연결합니다" desc="연결 방식을 선택하면 ON:D가 운전 계획을 만들 수 있습니다." />
          <ObCta onClick={() => go('method')}>시작하기</ObCta>
        </div>
      )
      break
    case 'method':
      body = <MethodScreen f={s.form} setF={setF} go={go} />
      break
    case 'details':
      body = <DetailsScreen f={s.form} setF={setF} go={go} />
      break
    case 'verify':
      body = <VerifyScreen s={s} patch={patch} go={go} />
      break
    case 'connected':
      body = <ConnectedScreen s={s} go={go} />
      break
    case 'rules':
      body = (
        <RulesScreen
          s={s}
          patch={patch}
          go={go}
          questions={questions}
          collect={{ loading: collectQ.loading, error: collect ? undefined : collectQ.error, reload: collectQ.reload, ready: !!collect }}
        />
      )
      break
    case 'done':
      body = <DoneScreen s={s} onFinish={finish} />
      break
  }

  return (
    <ObShell
      progress={(pos + 1) / total}
      onBack={back[screen]}
      wide={screen === 'verify'}
      right={
        <>
          <span className="hidden max-w-[220px] truncate text-ink-3 sm:inline">
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
        </>
      }
    >
      <ObStep k={screen === 'rules' ? `rules-${s.qi}` : screen} dir={dir}>
        {body}
      </ObStep>
    </ObShell>
  )
}
