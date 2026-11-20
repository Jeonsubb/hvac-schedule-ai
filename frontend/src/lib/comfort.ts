// Shared vocabulary for occupant thermal feedback (ASHRAE 7-point scale).

export const VOTES: { v: number; label: string; short: string; color: string }[] = [
  { v: -3, label: '춥다', short: '춥다', color: '#7ea7e0' },
  { v: -2, label: '서늘하다', short: '서늘', color: '#a9c6ee' },
  { v: -1, label: '약간 서늘하다', short: '약간 서늘', color: '#d4e3f7' },
  { v: 0, label: '적당하다', short: '적당', color: '#eef1f4' },
  { v: 1, label: '약간 따뜻하다', short: '약간 따뜻', color: '#fbe0cf' },
  { v: 2, label: '따뜻하다', short: '따뜻', color: '#f5bb97' },
  { v: 3, label: '덥다', short: '덥다', color: '#ec915f' },
]

export const TAGS: { key: string; label: string }[] = [
  { key: 'stuffy', label: '답답해요' },
  { key: 'draft', label: '바람이 세요' },
  { key: 'humid', label: '습해요' },
  { key: 'dry', label: '건조해요' },
  { key: 'noise', label: '시끄러워요' },
]

export function voteLabel(v: number): string {
  return VOTES.find((x) => x.v === Math.round(v))?.label ?? `${v}`
}

export function tagLabel(k: string): string {
  return TAGS.find((t) => t.key === k)?.label ?? k
}

/** Diverging colour for a (mean) vote; the neutral band is grey like the comfort band elsewhere. */
export function voteColor(mean: number | null | undefined): string {
  if (mean == null || Number.isNaN(mean)) return '#f7f8fa'
  if (mean <= -1.5) return VOTES[0].color
  if (mean <= -0.75) return VOTES[1].color
  if (mean < -0.25) return VOTES[2].color
  if (mean <= 0.25) return VOTES[3].color
  if (mean < 0.75) return VOTES[4].color
  if (mean < 1.5) return VOTES[5].color
  return VOTES[6].color
}

/** Words for a mean vote: "약간 서늘" / "적당" / … */
export function meanWord(mean: number | null | undefined): string {
  if (mean == null || Number.isNaN(mean)) return '의견 없음'
  if (mean <= -1.5) return '춥다는 의견'
  if (mean <= -0.75) return '서늘하다는 의견'
  if (mean < -0.25) return '약간 서늘'
  if (mean <= 0.25) return '대체로 적당'
  if (mean < 0.75) return '약간 따뜻'
  if (mean < 1.5) return '따뜻하다는 의견'
  return '덥다는 의견'
}

export const SOURCE_LABEL: Record<string, string> = {
  occupant: '재실자',
  operator: '운영자',
  simulated: '시뮬레이션',
}

export function signed(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '–'
  const s = v.toFixed(digits)
  return v > 0 ? `+${s}` : s
}
