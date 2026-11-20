import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, Building2 } from 'lucide-react'
import { DEMO_ACCOUNT, useAuth } from '../lib/auth'
import { Button, Field, Note, inputCls } from '../components/ui'
import { AuthLayout } from '../components/PublicShell'

export default function Login() {
  const { user, login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const state = (loc.state ?? {}) as { from?: string; demo?: boolean }
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)

  // "데모 보기" from the landing page pre-fills the demo account
  useEffect(() => {
    if (state.demo) {
      setId(DEMO_ACCOUNT.id)
      setPw(DEMO_ACCOUNT.password)
    }
  }, [state.demo])

  if (user) return <Navigate to={user.onboarded ? '/' : '/setup'} replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const r = login(id, pw)
    if (!r.ok) {
      setErr(r.error)
      return
    }
    // RequireAuth sends accounts that have not finished onboarding to /setup
    const from = state.from && !state.from.startsWith('/login') ? state.from : '/'
    nav(from, { replace: true })
  }

  const fillDemo = () => {
    setId(DEMO_ACCOUNT.id)
    setPw(DEMO_ACCOUNT.password)
    setErr(null)
  }

  return (
    <AuthLayout title="로그인" desc="시설 담당자 계정으로 로그인하세요. 건물 연결을 마친 계정은 바로 운전 현황으로 이동합니다.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="아이디">
          <input
            className={inputCls}
            name="username"
            autoComplete="username"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="아이디를 입력하세요…"
            autoFocus
            required
          />
        </Field>
        <Field label="비밀번호">
          <input
            className={inputCls}
            type="password"
            name="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="비밀번호를 입력하세요…"
            required
          />
        </Field>
        {err && (
          <div role="alert">
            <Note tone="crit">{err}</Note>
          </div>
        )}
        <Button type="submit" variant="primary" className="h-12 w-full text-[15.5px]" disabled={!id || !pw}>
          <LogIn size={16} aria-hidden /> 로그인
        </Button>
      </form>

      <div className="mt-7 rounded-[18px] bg-well p-5">
        <div className="flex items-start gap-3">
          <Building2 size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-ink">데모 계정: 부산대학교 IT관</div>
            <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">
              아이디 <b className="font-semibold text-ink">부산대학교</b>, 비밀번호 <b className="font-semibold text-ink">부산대학교</b>로 로그인하면 건물 연결과 데이터 수집을 마친 IT관 운영 화면이 열립니다.
            </p>
            <button type="button" onClick={fillDemo} className="mt-2 text-[13.5px] font-semibold text-brand-ink underline-offset-4 hover:underline">
              데모 계정 입력하기
            </button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[14px] text-ink-2">
        처음 사용하시나요?{' '}
        <Link to="/signup" className="font-semibold text-brand-ink underline-offset-4 hover:underline">
          회원가입하고 건물 연결하기
        </Link>
      </p>
      <p className="mt-3 text-center text-[12.5px] text-ink-3">시연용 화면이라 계정 정보는 이 브라우저에만 저장됩니다.</p>
    </AuthLayout>
  )
}
