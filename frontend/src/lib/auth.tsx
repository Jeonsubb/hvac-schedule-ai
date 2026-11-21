import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

/**
 * Mock authentication (no backend): accounts live in localStorage.
 * '부산대학교 / 부산대학교' is the built-in tenant that has already finished onboarding.
 */
export interface Account {
  id: string
  password: string
  name: string
  org: string
  /** what the person does at the building (sign-up step 2) */
  role?: string
  onboarded: boolean
  building?: string
  created_at: string
  /** ThermoPlan AI operation applied (false: the dashboard shows the current central-control operation) */
  applied?: boolean
}

const ACCOUNTS_KEY = 'tp.accounts'
const SESSION_KEY = 'tp.session'

export const DEMO_ACCOUNT: Account = {
  id: '부산대학교',
  password: '부산대학교',
  name: '부산대학교 시설과',
  org: '부산대학교',
  onboarded: true,
  building: 'IT관',
  created_at: '2026-09-01T09:00:00+09:00',
  applied: true,
}

function readAccounts(): Record<string, Account> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, Account>) : {}
    return { ...parsed, [DEMO_ACCOUNT.id]: { ...DEMO_ACCOUNT, ...(parsed[DEMO_ACCOUNT.id] ?? {}), password: DEMO_ACCOUNT.password, onboarded: true } }
  } catch {
    return { [DEMO_ACCOUNT.id]: DEMO_ACCOUNT }
  }
}

function writeAccounts(a: Record<string, Account>) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a))
  } catch {
    /* private mode: session-only */
  }
}

/** Sign-up checks the address before the last step (accounts are local to this browser). */
export function accountExists(id: string): boolean {
  return !!readAccounts()[id.trim()]
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

interface AuthCtx {
  user: Account | null
  login: (id: string, password: string) => { ok: true } | { ok: false; error: string }
  /** `join`: join a building that is already registered instead of registering a new one */
  signup: (a: { id: string; password: string; name: string; org: string; role?: string; join?: string }) => { ok: true } | { ok: false; error: string }
  logout: () => void
  completeOnboarding: (building: string) => void
  /** restart the setup wizard for the current account (demo) */
  restartOnboarding: () => void
  /** switch the dashboard between the current operation and ThermoPlan AI operation */
  setApplied: (v: boolean) => void
}

const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Record<string, Account>>(readAccounts)
  const [sessionId, setSessionId] = useState<string | null>(readSession)
  const user = sessionId ? (accounts[sessionId] ?? null) : null

  const save = useCallback((next: Record<string, Account>) => {
    setAccounts(next)
    writeAccounts(next)
  }, [])

  const setSession = useCallback((id: string | null) => {
    setSessionId(id)
    try {
      if (id) localStorage.setItem(SESSION_KEY, id)
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const login = useCallback<AuthCtx['login']>(
    (id, password) => {
      const a = accounts[id.trim()]
      if (!a) return { ok: false, error: '등록되지 않은 아이디입니다. 회원가입을 먼저 진행하세요.' }
      if (a.password !== password) return { ok: false, error: '비밀번호가 맞지 않습니다.' }
      setSession(a.id)
      return { ok: true }
    },
    [accounts, setSession],
  )

  const signup = useCallback<AuthCtx['signup']>(
    ({ id, password, name, org, role, join }) => {
      const key = id.trim()
      if (!key || !password) return { ok: false, error: '아이디와 비밀번호를 입력하세요.' }
      if (accounts[key]) return { ok: false, error: '이미 사용 중인 아이디입니다.' }
      // a member who joins a running building sees it the way the account that runs it does
      const owner = join ? Object.values(accounts).find((a) => a.onboarded && a.building === join) : undefined
      const acc: Account = {
        id: key,
        password,
        name: name.trim() || key,
        org: org.trim() || name.trim() || key,
        role,
        onboarded: !!join,
        building: join,
        created_at: new Date().toISOString(),
        applied: join ? (owner?.applied ?? false) : false,
      }
      save({ ...accounts, [key]: acc })
      setSession(key)
      return { ok: true }
    },
    [accounts, save, setSession],
  )

  const logout = useCallback(() => setSession(null), [setSession])

  const completeOnboarding = useCallback(
    (building: string) => {
      if (!user) return
      save({ ...accounts, [user.id]: { ...user, onboarded: true, building } })
    },
    [accounts, save, user],
  )

  const restartOnboarding = useCallback(() => {
    if (!user) return
    save({ ...accounts, [user.id]: { ...user, onboarded: false, applied: false } })
  }, [accounts, save, user])

  const setApplied = useCallback(
    (v: boolean) => {
      if (!user) return
      save({ ...accounts, [user.id]: { ...user, applied: v } })
    },
    [accounts, save, user],
  )

  const v = useMemo(
    () => ({ user, login, signup, logout, completeOnboarding, restartOnboarding, setApplied }),
    [user, login, signup, logout, completeOnboarding, restartOnboarding, setApplied],
  )
  return <AuthContext.Provider value={v}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(AuthContext)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}

/** Protected area: not signed in → landing; signed in but not onboarded → setup wizard. */
export function RequireAuth({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/welcome" replace state={{ from: loc.pathname + loc.search }} />
  if (!onboarding && !user.onboarded) return <Navigate to="/setup" replace />
  return <>{children}</>
}
