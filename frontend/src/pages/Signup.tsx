import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Button, Field, Note, inputCls } from '../components/ui'
import { AuthLayout } from '../components/PublicShell'

export default function Signup() {
  const { user, signup } = useAuth()
  const nav = useNavigate()
  const [org, setOrg] = useState('')
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (user) return <Navigate to={user.onboarded ? '/' : '/setup'} replace />

  const mismatch = pw2.length > 0 && pw !== pw2
  const ready = org.trim() && name.trim() && id.trim() && pw.length >= 4 && pw === pw2 && agree

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (pw.length < 4) return setErr('비밀번호는 4자 이상으로 정하세요.')
    if (pw !== pw2) return setErr('비밀번호 확인이 일치하지 않습니다.')
    const r = signup({ id, password: pw, name, org })
    if (!r.ok) return setErr(r.error)
    nav('/setup', { replace: true })
  }

  return (
    <AuthLayout
      title="회원가입"
      desc="계정을 만들면 바로 건물 연결 단계로 이동합니다. 중앙 제어 PC 주소와 담당자가 아는 운영 정보만 있으면 됩니다."
      aside={
        <>
          <p className="display text-[clamp(36px,3.6vw,52px)]">
            <span className="rise-mask">
              <span className="rise-line">가입은</span>
            </span>
            <span className="rise-mask">
              <span className="rise-line d1">건물 정보까지만.</span>
            </span>
          </p>
          <ol className="mt-9 grid max-w-[30em] gap-5">
            {[
              ['건물 알려 주기', '건물 이름, 용도, 층과 강의실 수를 편하게 적습니다.'],
              ['중앙 제어 연결', '중앙 제어 PC에 닿는 경로와 게이트웨이를 정합니다.'],
              ['설비·운영 정보', '허용 온도와 지금 운전 시간을 확인합니다.'],
            ].map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-2">
                <span className="tnum pt-[3px] text-[13px] font-bold text-brand-ink">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <strong className="block text-[17px] leading-[1.35] font-[650] tracking-[-0.01em] text-ink">{t}</strong>
                  <span className="mt-1 block text-[15px] leading-[1.6] text-ink-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-7 max-w-[30em] text-[14px] leading-[1.6] text-ink-3">
            등록을 마치면 지금 방식(정부 지침 온도 범위, 18시 일괄 정지)의 운전이 먼저 보입니다. 시간표는 대시보드에서 넣고, 넣는 순간 AI 1차 스케줄로 바뀝니다.
          </p>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field label="기관·회사">
            <input className={inputCls} name="organization" autoComplete="organization" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="예: 부산대학교…" />
          </Field>
          <Field label="담당자 이름">
            <input className={inputCls} name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 시설과 김담당…" />
          </Field>
        </div>
        <Field label="아이디">
          <input className={inputCls} name="username" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder="로그인에 쓸 아이디…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="비밀번호" hint="4자 이상">
            <input className={inputCls} type="password" name="new-password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="비밀번호 확인" hint={mismatch ? <span className="text-crit-ink">일치하지 않습니다</span> : undefined}>
            <input className={inputCls} type="password" name="confirm-password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-ink-2">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[#2f6fde]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>중앙 제어 시스템의 운전 데이터(실내기 상태·설정온도·센서값)를 수집하는 데 동의합니다. 재실자의 이름·학번은 받지 않습니다.</span>
        </label>
        {err && (
          <div role="alert">
            <Note tone="crit">{err}</Note>
          </div>
        )}
        <Button type="submit" variant="primary" className="h-12 w-full text-[15.5px]" disabled={!ready}>
          <UserPlus size={16} aria-hidden /> 가입하고 건물 연결하기
        </Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-ink-2">
        이미 계정이 있나요?{' '}
        <Link to="/login" className="font-semibold text-brand-ink underline-offset-4 hover:underline">
          로그인
        </Link>
      </p>
      <p className="mt-3 text-center text-[12.5px] text-ink-3">시연용 화면이라 계정 정보는 이 브라우저에만 저장됩니다.</p>
    </AuthLayout>
  )
}
