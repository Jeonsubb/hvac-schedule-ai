import { Check, Sparkles } from 'lucide-react'
import type { ScenarioResult } from '../lib/types'
import { cx, fmtWon } from '../lib/format'
import { Card, CardHeader } from './ui'
import { AgentAvatar } from './Characters'

const pmv = (v: number | null | undefined) => (v == null ? '–' : v.toFixed(2))

/**
 * The run's scenario table: what the agent proposed, what the engine computed for each, which one the
 * judge picked and why. Every number is the engine's; the pick is the lowest cost + comfort score.
 */
export default function ScenarioCard({ r }: { r: ScenarioResult }) {
  const chosen = r.scenarios.find((s) => s.id === r.chosen)
  const base = r.scenarios.find((s) => s.id === 'keep')
  const lab = r.season === 'heat' ? '난방' : '냉방'
  const nLlm = r.scenarios.filter((s) => s.source === 'llm').length
  return (
    <Card data-tour="plan-scenarios">
      <CardHeader
        icon={<AgentAvatar agent="building" size={28} />}
        title={chosen ? `시나리오 ${r.scenarios.length}개를 계산해 '${chosen.name}'을 골랐습니다` : '시나리오를 계산해서 골랐습니다'}
        sub={
          r.ai
            ? `에이전트(Haiku)가 자료를 종합해 ${nLlm}개를 제안하고 규칙 후보 ${r.scenarios.length - nLlm}개를 더해, 엔진이 ${r.dates.length}일을 하나씩 계산했습니다. 선택 기준은 전기요금 + 쾌적 가중치 ${Math.round(r.comfort_won).toLocaleString('ko-KR')}원 × PMV 악화(의견 반복 강의실 3배)입니다.`
            : `이번에는 에이전트 제안을 받지 못해 규칙 후보 ${r.scenarios.length}개만 계산했습니다${r.note ? ` (${r.note})` : ''}. 선택 기준은 전기요금 + 쾌적 가중치 × PMV 악화입니다.`
        }
      />
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead>
            <tr className="text-left text-[12.5px] text-ink-3">
              <th className="pb-2 pr-3 font-medium">시나리오</th>
              <th className="pb-2 pr-3 font-medium">바꾸는 강의실</th>
              <th className="pb-2 pr-3 text-right font-medium">전력</th>
              <th className="pb-2 pr-3 text-right font-medium">요금</th>
              <th className="pb-2 pr-3 text-right font-medium whitespace-nowrap">수업 중 PMV</th>
              <th className="pb-2 pr-3 text-right font-medium whitespace-nowrap">의견 해소</th>
              <th className="pb-2 text-right font-medium">점수</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {r.scenarios.map((s) => {
              const on = s.id === r.chosen
              const changes = s.changes ?? []
              return (
                <tr key={s.id} className={cx('border-t border-line align-top', on && 'bg-brand-bg/60')}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-start gap-2">
                      <span className={cx('mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full', on ? 'bg-brand text-white' : 'bg-well')} aria-hidden>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0">
                        <span className={cx('flex items-center gap-1.5 text-[14px] font-semibold', on ? 'text-ink' : 'text-ink-2')}>
                          {s.name}
                          {s.source === 'llm' && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-well px-1.5 text-[11px] font-semibold text-ink-3">
                              <Sparkles size={10} aria-hidden /> 에이전트
                            </span>
                          )}
                        </span>
                        <span className="block text-[12.5px] leading-[1.5] text-ink-3">{s.goal}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">
                    {changes.length === 0
                      ? '없음'
                      : changes
                          .slice(0, 4)
                          .map((room) => `${room} ${r.base_sp[room]}→${s.setpoints[room]}℃`)
                          .join(', ') + (changes.length > 4 ? ` 외 ${changes.length - 4}곳` : '')}
                  </td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap text-ink-2">{s.eval ? `${s.eval.kwh.toFixed(1)} kWh` : '–'}</td>
                  <td className="py-2.5 pr-3 text-right whitespace-nowrap text-ink-2">{s.eval ? fmtWon(s.eval.cost_krw) : '–'}</td>
                  <td className="py-2.5 pr-3 text-right text-ink-2">{pmv(s.eval?.pmv_mean)}</td>
                  <td className="py-2.5 pr-3 text-right text-ink-2">{s.eval ? `${s.eval.complaints_addressed}곳` : '–'}</td>
                  <td className={cx('py-2.5 text-right whitespace-nowrap', on ? 'font-semibold text-ink' : 'text-ink-2')}>{s.score != null ? fmtWon(s.score) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {chosen && (
        <p className="mt-4 text-[14px] leading-[1.6] text-ink">
          <b className="font-semibold">'{chosen.name}'</b>
          {chosen.id === 'keep' ? '이 가장 낮은 점수라 현재 계획을 그대로 둡니다. ' : `을 골랐습니다. `}
          {chosen.rationale}
          {base && chosen.eval && base.eval && chosen.id !== 'keep' && (
            <span className="text-ink-2">
              {' '}
              현재 계획 대비 전력 {(chosen.eval.kwh - base.eval.kwh).toFixed(1)} kWh, 요금 {fmtWon(chosen.eval.cost_krw - base.eval.cost_krw)}, {lab} 설정을 바꾸는 강의실 {chosen.changes?.length ?? 0}곳입니다.
            </span>
          )}
        </p>
      )}
      {r.complaint_rooms.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">의견이 반복된 강의실: {r.complaint_rooms.join(', ')}호 (쾌적 가중치 3배)</p>}
    </Card>
  )
}
