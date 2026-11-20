import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useApi } from './api'
import type { Meta } from './types'

interface MetaCtx {
  meta: Meta | undefined
  error: Error | undefined
  reload: () => void
}

const MetaContext = createContext<MetaCtx>({ meta: undefined, error: undefined, reload: () => {} })

export function MetaProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi<Meta>('/api/meta', { maxAgeMs: 60_000, refreshMs: 60_000 })
  const v = useMemo(() => ({ meta: data, error, reload }), [data, error, reload])
  return <MetaContext.Provider value={v}>{children}</MetaContext.Provider>
}

export function useMeta() {
  return useContext(MetaContext)
}

interface CopilotCtx {
  open: boolean
  setOpen: (v: boolean) => void
  ask: (prompt: string) => void
  pending: string | null
  consumePending: () => string | null
}

const CopilotContext = createContext<CopilotCtx>({
  open: false,
  setOpen: () => {},
  ask: () => {},
  pending: null,
  consumePending: () => null,
})

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const ask = useCallback((p: string) => {
    setPending(p)
    setOpen(true)
  }, [])
  const consumePending = useCallback(() => {
    const p = pending
    setPending(null)
    return p
  }, [pending])
  const v = useMemo(() => ({ open, setOpen, ask, pending, consumePending }), [open, ask, pending, consumePending])
  return <CopilotContext.Provider value={v}>{children}</CopilotContext.Provider>
}

export function useCopilot() {
  return useContext(CopilotContext)
}

// ---------------------------------------------------------------- reference date shared by the operator screens

interface DayCtx {
  /** the date every screen plans for (undefined until the server's reference date is known) */
  date: string | undefined
  setDate: (d: string) => void
  /** the server's own reference date: today, or the latest day with classes */
  defaultDate: string | undefined
}

const DayContext = createContext<DayCtx>({ date: undefined, setDate: () => {}, defaultDate: undefined })
const DAY_KEY = 'ond.date'

export function DayProvider({ children }: { children: ReactNode }) {
  const { meta } = useMeta()
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DAY_KEY)
    } catch {
      return null
    }
  })
  const lo = meta?.semester.start
  const hi = meta?.semester.end
  const valid = picked && /^\d{4}-\d{2}-\d{2}$/.test(picked) && (!lo || picked >= lo) && (!hi || picked <= hi) ? picked : null
  const date = valid ?? meta?.now.date
  useEffect(() => {
    if (picked && meta && !valid) setPicked(null)
  }, [picked, meta, valid])
  const setDate = useCallback((d: string) => {
    setPicked(d)
    try {
      sessionStorage.setItem(DAY_KEY, d)
    } catch {
      /* private mode */
    }
  }, [])
  const v = useMemo(() => ({ date, setDate, defaultDate: meta?.now.date }), [date, setDate, meta?.now.date])
  return <DayContext.Provider value={v}>{children}</DayContext.Provider>
}

export function useDay() {
  return useContext(DayContext)
}
