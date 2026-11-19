import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
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
