import { useCallback, useEffect, useRef, useState } from 'react'
import type { Job } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = ''
  let fromApp = false // a JSON body means the backend itself answered (not a proxy error page)
  try {
    const body = await res.json()
    if (body && typeof body.detail === 'string') detail = body.detail
    else if (body && Array.isArray(body.detail)) detail = body.detail.map((d: { msg?: string }) => d.msg ?? '').filter(Boolean).join(', ')
    else if (body && body.detail) detail = JSON.stringify(body.detail)
    fromApp = true
  } catch {
    /* not json */
  }
  if (!fromApp && (res.status === 502 || res.status === 503 || res.status === 504))
    return new ApiError(res.status, `백엔드 서버에 연결하지 못했습니다 (${res.status}). 서버가 실행 중인지 확인한 뒤 다시 시도하세요.`)
  if (detail && res.status >= 500) return new ApiError(res.status, detail)
  if (res.status >= 500) return new ApiError(res.status, `서버가 요청을 처리하다 실패했습니다 (${res.status}).${detail ? ` ${detail}` : ''} 잠시 뒤 다시 시도하세요.`)
  if (res.status === 404) return new ApiError(404, detail || '요청한 데이터가 없습니다 (404).')
  return new ApiError(res.status, detail || `요청이 거절되었습니다 (${res.status} ${res.statusText}).`)
}

const OFFLINE = '서버에 연결하지 못했습니다. 백엔드가 실행 중인지, 네트워크가 연결되어 있는지 확인한 뒤 다시 시도하세요.'

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, OFFLINE)
  }
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

export async function apiSend<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await request(url, {
    method,
    headers: body instanceof FormData ? headers : { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  })
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

// ---------------------------------------------------------------- tiny SWR-style cache

type Entry = { data?: unknown; promise?: Promise<unknown>; ts: number }
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

export function invalidate(prefix?: string) {
  if (!prefix) cache.clear()
  else for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
  listeners.forEach((l) => l())
}

/** Invalidate everything derived from inputs (courses/events/settings changed). */
export function invalidateAll() {
  invalidate()
}

export function fetchCached<T>(url: string, maxAgeMs = 5 * 60_000): Promise<T> {
  const hit = cache.get(url)
  const now = Date.now()
  if (hit?.data !== undefined && now - hit.ts < maxAgeMs) return Promise.resolve(hit.data as T)
  if (hit?.promise) return hit.promise as Promise<T>
  const p = apiGet<T>(url)
    .then((d) => {
      cache.set(url, { data: d, ts: Date.now() })
      return d
    })
    .catch((e) => {
      cache.delete(url)
      throw e
    })
  cache.set(url, { ...(hit ?? { ts: 0 }), promise: p })
  return p
}

export function peekCache<T>(url: string): T | undefined {
  return cache.get(url)?.data as T | undefined
}

export interface ApiState<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => void
}

/** Fetch + cache. Keeps the previous data while a new key loads (no layout jump). */
export function useApi<T>(url: string | null, opts: { maxAgeMs?: number; refreshMs?: number } = {}): ApiState<T> {
  const { maxAgeMs = 5 * 60_000, refreshMs } = opts
  const [data, setData] = useState<T | undefined>(() => (url ? peekCache<T>(url) : undefined))
  const [error, setError] = useState<Error | undefined>()
  const [loading, setLoading] = useState<boolean>(!!url && peekCache(url) === undefined)
  const [tick, setTick] = useState(0)
  const urlRef = useRef(url)
  urlRef.current = url

  useEffect(() => {
    const l = () => setTick((t) => t + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (!url) return
    let alive = true
    setLoading(true)
    setError(undefined)
    fetchCached<T>(url, maxAgeMs)
      .then((d) => {
        if (alive && urlRef.current === url) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: Error) => {
        if (alive && urlRef.current === url) {
          setError(e)
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [url, tick, maxAgeMs])

  useEffect(() => {
    if (!url || !refreshMs) return
    const id = window.setInterval(() => {
      invalidate(url)
    }, refreshMs)
    return () => window.clearInterval(id)
  }, [url, refreshMs])

  const reload = useCallback(() => {
    if (url) invalidate(url)
  }, [url])

  return { data, error, loading, reload }
}

/** Poll /api/jobs/{id} until done|error. */
export async function pollJob<R>(
  id: string,
  onProgress?: (job: Job<R>) => void,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Job<R>> {
  const { intervalMs = 1500, timeoutMs = 180_000, signal } = opts
  const t0 = Date.now()
  for (;;) {
    if (signal?.aborted) throw new Error('작업을 취소했습니다.')
    const job = await apiGet<Job<R>>(`/api/jobs/${id}`)
    onProgress?.(job)
    if (job.status === 'done' || job.status === 'error') return job
    if (Date.now() - t0 > timeoutMs) throw new Error(`${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 기다리기를 멈췄습니다. 잠시 뒤 다시 시도하세요.`)
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
