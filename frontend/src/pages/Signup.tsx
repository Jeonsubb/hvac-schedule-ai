import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Building2, CalendarClock, Check, Eye, EyeOff, Plus, UserRound, Users, Wrench } from 'lucide-react'
import { accountExists, useAuth } from '../lib/auth'
import { useApi } from '../lib/api'
import type { BuildingProfile } from '../lib/types'
import { cx } from '../lib/format'
import { ErrorBox, Spinner } from '../components/ui'
import { ChoiceCard, ObCta, ObField, ObMore, ObShell, ObStep, ObTextButton, ObTitle, SuccessMark, obInput, useStepDir } from '../components/Onboarding'

type Path = 'new' | 'join'

const ROLES = [
  { key: 'facility', title: '시설 관리', desc: '냉난방 설비를 직접 운영해요', icon: Wrench },
  { key: 'operations', title: '공간·일정 운영', desc: '강의실이나 매장 일정을 맡고 있어요', icon: CalendarClock },
  { key: 'other', title: '그 외', desc: '함께 보거나 둘러봐요', icon: UserRound },
] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Signup() {
  const { user, signup } = useAuth()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const dir = useStepDir(step)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [agree, setAgree] = useState(false)
  const [org, setOrg] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [path, setPath] = useState<Path | null>(null)
  const [done, setDone] = useState<{ join?: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const building = useApi<BuildingProfile>(path === 'join' && step >= 3 ? '/api/building' : null)

  // an account created in this flow stays on the last screen; anyone already signed in moves on
  if (user && !done) return <Navigate to={user.onboarded ? '/' : '/setup'} replace />

  const total = path === 'join' ? 5 : 4
  const go = (i: number) => {
    setErr(null)
    setStep(i)
    window.scrollTo({ top: 0 })
  }

  const emailOk = EMAIL_RE.test(email.trim())
  const accountOk = !!name.trim() && emailOk && pw.length >= 4 && agree

  const create = (join?: string) => {
    const r = signup({ id: email.trim(), password: pw, name, org, role: role ?? undefined, join })
    if (!r.ok) return setErr(r.error)
    setDone({ join })
    go(total - 1)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step === 0) {
      if (!accountOk) return
      if (accountExists(email)) return setErr('이미 가입된 이메일이에요. 로그인해 주세요.')
      return go(1)
    }
    if (step === 1) return org.trim() && role && go(2)
    if (step === 2) {
      if (path === 'new') return create()
      if (path === 'join') return go(3)
    }
    if (step === 3 && path === 'join' && building.data?.onboarded_at) return create(building.data.name)
  }

  const back = done ? undefined : step > 0 ? () => go(step - 1) : () => nav('/welcome')

  let screen: ReactNode
  if (done) {
    screen = (
      <div className="flex flex-1 flex-col items-center pt-[6vh] text-center">
        <SuccessMark />
        <div className="mt-8">
          <ObTitle
            center
            title={done.join ? `${done.join}에 참여했어요` : `${name.trim()}님, 가입을 마쳤어요`}
            desc={done.join ? '운영 현황부터 볼게요.' : '이제 건물을 등록하고 중앙 제어 시스템을 연결해요.'}
          />
        </div>
        <div className="w-full">
          <ObCta onClick={() => nav(done.join ? '/' : '/setup', { replace: true })}>{done.join ? '운영 현황 보기' : '건물 등록 시작'}</ObCta>
        </div>
      </div>
    )
  } else if (step === 0) {
    screen = (
      <>
        <ObTitle title="계정을 만들어요" desc="ON:D에서 쓸 이름과 로그인 정보예요." />
        <div className="ob-rise ob-d2 space-y-5">
          <ObField label="이름">
            <input className={obInput} name="name" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </ObField>
          <ObField label="이메일" error={email && !emailOk ? '이메일 형식을 확인해 주세요' : err}>
            <input
              className={obInput}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
              value={email}
              aria-invalid={!!err || (!!email && !emailOk)}
              onChange={(e) => {
                setEmail(e.target.value)
                setErr(null)
              }}
              placeholder="name@company.com"
            />
          </ObField>
          <ObField label="비밀번호" hint={pw && pw.length < 4 ? '4자 이상 입력해 주세요' : undefined}>
            <span className="relative block">
              <input
                className={cx(obInput, 'pr-14')}
                type={showPw ? 'text' : 'password'}
                name="new-password"
                autoComplete="new-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="4자 이상"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute top-1/2 right-2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[9px] text-ink-3 transition-colors duration-200 hover:bg-[#f2f4f6] hover:text-ink"
              >
                {showPw ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
              </button>
            </span>
          </ObField>
          <div className="pt-1">
            <label className="flex cursor-pointer items-center gap-3 text-[15px] text-ink">
              <input type="checkbox" className="peer sr-only" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#d3d7dd] text-white transition-colors duration-200 peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-focus)] [&>svg]:scale-0 [&>svg]:transition-transform [&>svg]:duration-300 peer-checked:[&>svg]:scale-100"
                aria-hidden
              >
                <Check size={14} strokeWidth={3} />
              </span>
              <span>
                운전 데이터 수집에 동의해요 <span className="text-ink-3">(필수)</span>
              </span>
            </label>
            <ObMore label="내용 보기" className="mt-2 pl-9">
              <p className="text-[14px] leading-[1.6] text-ink-2">중앙 제어 시스템의 운전 데이터(실내기 상태·설정온도·센서값)를 수집해요. 재실자의 이름·학번은 받지 않아요.</p>
            </ObMore>
          </div>
        </div>
        <ObCta
          type="submit"
          disabled={!accountOk}
          below={
            <span className="text-ink-3">
              이미 계정이 있나요?{' '}
              <Link to="/login" className="font-semibold text-brand-ink underline-offset-4 hover:underline">
                로그인
              </Link>
              <span className="mt-2 block text-[12.5px] text-ink-4">시연용이라 계정은 이 브라우저에만 저장돼요</span>
            </span>
          }
        >
          다음
        </ObCta>
      </>
    )
  } else if (step === 1) {
    screen = (
      <>
        <ObTitle title="어디에서 일하세요?" desc="학교나 회사 이름, 맡은 일을 알려 주세요." />
        <div className="ob-rise ob-d2 space-y-7">
          <ObField label="학교·회사">
            <input className={obInput} name="organization" autoComplete="organization" autoFocus value={org} onChange={(e) => setOrg(e.target.value)} placeholder="예: 부산대학교" />
          </ObField>
          <div>
            <span className="mb-2 block text-[14px] font-medium text-ink-2">하는 일</span>
            <div role="radiogroup" aria-label="하는 일" className="space-y-2.5">
              {ROLES.map((r) => (
                <ChoiceCard key={r.key} selected={role === r.key} onSelect={() => setRole(r.key)} icon={<r.icon size={20} aria-hidden />} title={r.title} desc={r.desc} />
              ))}
            </div>
          </div>
        </div>
        <ObCta type="submit" disabled={!org.trim() || !role}>
          다음
        </ObCta>
      </>
    )
  } else if (step === 2) {
    screen = (
      <>
        <ObTitle title="어떻게 시작할까요?" />
        <div role="radiogroup" aria-label="시작 방식" className="ob-rise ob-d1 space-y-3">
          <ChoiceCard selected={path === 'new'} onSelect={() => setPath('new')} icon={<Plus size={21} aria-hidden />} title="새 건물 등록" desc="중앙 제어 시스템을 연결해 시작해요" />
          <ChoiceCard selected={path === 'join'} onSelect={() => setPath('join')} icon={<Users size={20} aria-hidden />} title="기존 건물에 참여" desc="이미 등록된 건물을 함께 운영해요" />
        </div>
        {err && <p className="mt-4 text-[14px] text-crit-ink">{err}</p>}
        <ObCta type="submit" disabled={!path}>
          {path === 'join' ? '다음' : '가입하기'}
        </ObCta>
      </>
    )
  } else {
    const b = building.data
    screen = (
      <>
        <ObTitle title="참여할 건물을 골라요" desc="이 ON:D에 등록된 건물이에요." />
        <div className="ob-rise ob-d1">
          {building.error ? (
            <ErrorBox error={building.error} onRetry={building.reload} />
          ) : !b ? (
            <div className="flex items-center gap-2 py-6 text-[15px] text-ink-3">
              <Spinner size={16} /> 건물을 찾는 중…
            </div>
          ) : !b.onboarded_at ? (
            <div className="rounded-[14px] border border-line px-5 py-6 text-center">
              <p className="text-[16px] font-semibold text-ink">아직 등록된 건물이 없어요</p>
              <p className="mt-1 text-[14.5px] text-ink-3">새 건물로 시작해 주세요.</p>
              <div className="mt-4">
                <ObTextButton
                  onClick={() => {
                    setPath('new')
                    go(2)
                  }}
                >
                  새 건물 등록으로
                </ObTextButton>
              </div>
            </div>
          ) : (
            <div role="radiogroup" aria-label="참여할 건물">
              <ChoiceCard
                selected
                onSelect={() => undefined}
                icon={<Building2 size={20} aria-hidden />}
                title={`${b.org ? `${b.org} ` : ''}${b.name}`}
                badge={b.demo ? '시연' : undefined}
                desc={b.connection ? `중앙 제어 연결됨 · ${b.connection.vendor}` : '중앙 제어 연결 전'}
              />
            </div>
          )}
        </div>
        {err && <p className="mt-4 text-[14px] text-crit-ink">{err}</p>}
        <ObCta type="submit" disabled={!b?.onboarded_at}>
          참여하기
        </ObCta>
      </>
    )
  }

  return (
    <ObShell progress={(step + 1) / total} onBack={back}>
      <ObStep k={done ? 'done' : `s${step}`} dir={dir}>
        <form onSubmit={submit} className="flex flex-1 flex-col" noValidate>
          {screen}
        </form>
      </ObStep>
    </ObShell>
  )
}
