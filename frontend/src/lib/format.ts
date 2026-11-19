
export function hm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}

export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** Compact: 1,284 / 12.9천 / 3.2만 style kept numeric-first for Korean readers. */
export function fmtCompact(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  const a = Math.abs(v)
  if (a >= 100_000_000) return `${(v / 100_000_000).toFixed(digits)}억`
  if (a >= 10_000) return `${(v / 10_000).toFixed(digits)}만`
  return v.toLocaleString('ko-KR', { maximumFractionDigits: a < 10 ? 2 : a < 100 ? 1 : 0 })
}

export function fmtKwh(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–'
  const a = Math.abs(v)
  return fmtNum(v, a < 10 ? 2 : a < 1000 ? 1 : 0)
}

export function fmtWon(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–'
  return `${fmtNum(v)}원`
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–'
  return `${v.toFixed(digits)}%`
}

export function pctSaving(base: number, val: number): number | null {
  if (!base) return null
  return ((base - val) / base) * 100
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return isoDate(d)
}

/** weekday 0=Mon */
export function weekdayOf(s: string): number {
  return (parseDate(s).getDay() + 6) % 7
}

const DATE_K = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
const DATE_K_NO_WD = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' })

/** "11월 20일 (금)" via Intl (same output as the hand-built format it replaces). */
export function fmtDateK(s: string, withWeekday = true): string {
  const d = parseDate(s)
  return (withWeekday ? DATE_K : DATE_K_NO_WD).format(d)
}

export function fmtDateShort(s: string): string {
  const d = parseDate(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function fmtTs(ts: string): string {
  // 2026-11-20T10:40:00+09:00 -> 11/20 10:40
  const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return ts
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}분`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

export function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v))
}

export function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0)
}

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

/** Korean particle by the last syllable's final consonant, e.g. josa('규칙', '과', '와') -> '과'. Latin endings take the vowel form. */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return withoutFinal
  return (c - 0xac00) % 28 ? withFinal : withoutFinal
}
