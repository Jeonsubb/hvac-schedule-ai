import type { CSSProperties } from 'react'
import { ArrowLeftRight, Check, Cpu } from 'lucide-react'
import type { AgentTurn } from '../lib/types'
import { AGENT_CHARACTER, AGENT_META } from './Characters'
import { cx } from '../lib/format'
import './agent-stage.css'

/** Keep complete sentences and numeric evidence intact; the original stays available below. */
function summarizeMessage(message: string) {
  const original = message.trim()
  const sentences = original.split(/(?<=[.!?。！？])\s+/u)
  let summary = sentences[0] || ''
  let included = 1
  for (const sentence of sentences.slice(1, 2)) {
    if (summary.length + sentence.length + 1 > 100) break
    summary += ` ${sentence}`
    included++
  }
  return included < sentences.length ? summary : original
}

/** Only server progress and recorded turns drive the characters; no scripted conversation. */
export default function AgentStage({ turns, running, phase, completed = false, failed = false, fallback = false }: {
  turns: AgentTurn[]
  running: boolean
  phase?: string | null
  completed?: boolean
  failed?: boolean
  fallback?: boolean
}) {
  const active = running && phase?.includes('관리자 온디') ? 'building'
    : running && phase?.includes('사용자 온디') ? 'occupant' : null
  const last = turns[turns.length - 1]
  const status = failed ? '협의 중단 · 다시 실행할 수 있어요' : running
    ? phase?.replace('관리자 온디', '비용 Agent').replace('사용자 온디', '쾌적 Agent') || '협의 자료를 준비하고 있어요'
    : completed ? `${fallback ? '규칙 기반 대체 · ' : ''}협의 완료 · 아래에서 결과를 확인하세요` : '같은 데이터, 서로 다른 관점'

  return (
    <div className="agent-stage" aria-label="비용·쾌적 에이전트 대화">
      <div className="agent-stage-status" role="status" aria-live="polite">
        {completed && !running && !failed ? <Check size={14} aria-hidden /> : <Cpu size={14} aria-hidden />}
        <span>{status}</span>
      </div>
      <div className="agent-stage-pair">
        {(['building', 'occupant'] as const).map((side) => {
          const meta = AGENT_META[side]
          const character = AGENT_CHARACTER[side]
          const speaking = active === side
          const turn = [...turns].reverse().find((t) => t.agent === side)
          const message = turn?.message?.trim() || ''
          const summary = summarizeMessage(message)
          const goal = side === 'building' ? '에너지와 요금을 아끼는 설정을 제안해요.' : '수업 중 쾌적함과 사용자 의견을 살펴봐요.'
          return (
            <div key={side} className={cx('agent-stage-side', speaking && 'is-speaking')} style={{ '--agent-color': meta.color, '--agent-bg': meta.bg, '--agent-ink': meta.ink } as CSSProperties}>
              <div className="agent-stage-bubble" key={`${side}:${turns.length}:${speaking}`}>
                <span className="agent-stage-turn">{speaking ? '자료 확인 · 시뮬레이션 중' : turn ? `${turn.round}라운드 · ${turn.stance || '제안'}` : side === 'building' ? '비용 Agent' : '쾌적 Agent'}</span>
                <p>{speaking ? (phase?.includes('시뮬레이터') ? '제안할 설정온도를 시뮬레이터로 계산하고 있어요.' : '시간표와 날씨, 상대의 제안을 확인하고 있어요.') : summary || goal}</p>
                {!speaking && summary !== message && (
                  <details className="agent-stage-full-message">
                    <summary>전체 발언 보기</summary>
                    <p>{message}</p>
                  </details>
                )}
                {speaking && <span className="agent-stage-dots" aria-hidden><i /><i /><i /></span>}
              </div>
              <div className="agent-stage-character" aria-hidden="true">
                <img className="agent-stage-body" src={`/assets/agents/${character}.webp`} alt="" width={character === 'bunny' ? 392 : 408} height={480} draggable={false} />
                <img className="agent-stage-spark" src={`/assets/agents/${character}-spark.webp`} alt="" width={character === 'bunny' ? 392 : 408} height={480} draggable={false} />
              </div>
              <div className="agent-stage-name">{side === 'building' ? '비용 Agent · 관리자 온디' : '쾌적 Agent · 사용자 온디'}</div>
              <span className="agent-stage-role">{side === 'building' ? '에너지 · 요금' : '체감 쾌적 · 사용자 의견'}</span>
            </div>
          )
        })}
        <span className="agent-stage-exchange" aria-hidden><ArrowLeftRight size={20} /></span>
      </div>
      {!running && last?.agent === 'arbiter' && <p className="agent-stage-verdict">{last.stance} · 최종 수치와 조정안은 협의 결과에서 확인하세요.</p>}
    </div>
  )
}
