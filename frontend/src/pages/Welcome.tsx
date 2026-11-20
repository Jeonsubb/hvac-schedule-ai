import { Link, Navigate } from 'react-router-dom'
import { AgentAvatar } from '../components/Characters'
import {
  Building2,
  CalendarClock,
  CalendarRange,
  CalendarDays,
  CloudSun,
  Users,
  Wind,
  MessageSquareWarning,
  PlugZap,
  ShieldCheck,
  Bot,
  Hand,
  ArrowRight,
  Scale,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { btnCls } from '../components/ui'
import { PublicHeader } from '../components/PublicShell'
import { cx } from '../lib/format'

const PROBLEMS = [
  {
    icon: CalendarClock,
    title: '일정은 매일 바뀌는데 스케줄은 고정입니다',
    body: '휴강·보강·행사·예약이 생겨도 중앙 제어는 정해진 시간에 켜고 끕니다. 빈 강의실과 빈 매장이 냉난방됩니다.',
  },
  {
    icon: CloudSun,
    title: '날씨와 재실 인원을 운전에 반영하지 못합니다',
    body: '추운 아침에는 늦게 켜서 춥고, 사람이 적은 날에도 같은 출력으로 돌립니다. 비용과 쾌적이 함께 나빠집니다.',
  },
  {
    icon: MessageSquareWarning,
    title: '민원은 쌓이는데 판단 근거가 없습니다',
    body: '"춥다", "답답하다"는 문의가 올 때마다 담당자가 감으로 설정을 바꿉니다. 바꾼 결과가 비용에 어떤 영향을 줬는지 남지 않습니다.',
  },
]

const STEPS = [
  { icon: PlugZap, title: '데이터 수집', body: '중앙 제어 PC, 시간표·예약, 기상청 예보, CO₂·재실 센서, 재실자 의견을 한곳에 모읍니다.' },
  { icon: CalendarRange, title: '1차 · 월간 계획', body: '학사일정과 시간표, 평년 기온으로 한 달 운전 계획과 예상 요금을 만듭니다.' },
  { icon: CalendarDays, title: '2차 · 주간 조정', body: '주간 예보, 행사, 지난주 재실 밀도와 의견으로 설정온도와 환기 단계를 조정합니다.' },
  { icon: ShieldCheck, title: '3차 · 일일 검증', body: '매일 새로 들어온 실황·센서·민원으로 오늘 계획이 여전히 맞는지 정합성을 검증합니다.' },
  { icon: Bot, title: '자동 운전 또는 추천', body: '자동 운전 모드는 바로 반영하고, 추천 모드는 담당자가 승인한 조정만 반영합니다.' },
]

const DATA = [
  { icon: CalendarClock, label: '시간표·예약·행사' },
  { icon: CloudSun, label: '기상청 예보·실황' },
  { icon: Building2, label: '중앙 제어 PC(BMS)' },
  { icon: Wind, label: 'CO₂ 센서' },
  { icon: Users, label: '재실 밀도' },
  { icon: MessageSquareWarning, label: '재실자 의견' },
]

/** A small picture of the idea: schedules in, AI in the middle, an operating plan out. */
function HeroVisual() {
  const lectures = [
    [6, 22],
    [30, 52],
    [64, 86],
  ]
  const events = [
    [20, 36],
    [58, 70],
  ]
  const plan = [
    [4, 23],
    [28, 53],
    [62, 87],
  ]
  const lane = (items: number[][], cls: string) => (
    <div className="relative h-7 rounded-[8px] bg-well">
      {items.map(([a, b], i) => (
        <span key={i} className={cx('absolute top-1 bottom-1 rounded-[6px]', cls)} style={{ left: `${a}%`, width: `${b - a}%` }} />
      ))}
    </div>
  )
  return (
    <div className="rounded-[20px] border border-line bg-surface p-6 shadow-[0_24px_64px_rgb(20_32_51/0.08)]">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-3">강의 시간표</div>
          {lane(lectures, 'bg-[#c9dbf7]')}
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink-3">예약·행사 정보</div>
          {lane(events, 'bg-event-bg ring-1 ring-inset ring-[#d6d0f5]')}
        </div>
      </div>
      <div className="my-5 flex items-center justify-center gap-3">
        <span className="h-px flex-1 bg-line" aria-hidden />
        <span className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-[14px] font-semibold text-white">
          <Bot size={16} aria-hidden /> AI 일정 분석
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2">
          <CloudSun size={14} aria-hidden /> 날씨 반영
        </span>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink-3">
          <span>AI가 만든 운전 스케줄</span>
          <span className="text-brand-ink">일정이 바뀌면 다시 계산</span>
        </div>
        <div className="relative h-16 rounded-[10px] bg-well">
          {plan.map(([a, b], i) => (
            <span
              key={i}
              className="absolute bottom-2 h-10 rounded-t-[6px] border-x-2 border-t-2 border-brand bg-brand-bg"
              style={{ left: `${a}%`, width: `${b - a}%` }}
            />
          ))}
          <span className="absolute right-2 bottom-2 left-2 h-0.5 bg-brand/40" aria-hidden />
        </div>
      </div>
    </div>
  )
}

export default function Welcome() {
  const { user } = useAuth()
  if (user?.onboarded) return <Navigate to="/" replace />
  return (
    <div className="min-h-full bg-surface">
      <PublicHeader
        right={
          user ? (
            <Link to="/setup" className={btnCls('primary', 'md')}>
              건물 설정 이어 하기
            </Link>
          ) : (
            <>
              <Link to="/login" className={btnCls('ghost', 'md')}>
                로그인
              </Link>
              <Link to="/signup" className={btnCls('primary', 'md')}>
                무료로 시작하기
              </Link>
            </>
          )
        }
      />

      <main>
        {/* hero */}
        <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 pt-12 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-bg px-3 py-1 text-[13px] font-semibold text-brand-ink">
              건물 운영자를 위한 냉난방 자동 운전 AI
            </span>
            <h1 className="balance mt-5 text-[44px] leading-[1.12] font-bold tracking-[-0.035em] text-ink max-sm:text-[34px]">
              일정이 바뀌면,
              <br />
              냉난방도 바로 다시 계산합니다.
            </h1>
            <p className="pretty mt-5 max-w-[34em] text-[18px] leading-[1.6] text-ink-2">
              학교·쇼핑몰·호텔처럼 운영 일정이 자주 바뀌는 건물은 고정 스케줄로 효율적인 냉난방이 어렵습니다. ThermoPlan은 일정·날씨·재실·CO₂·민원 데이터로 비용은 최소로, 쾌적은 그대로 유지하는 운전 계획을 만들고 직접 운전하거나 추천합니다.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={user ? '/setup' : '/signup'} className={btnCls('primary', 'md', 'h-12 px-6 text-[15px]')}>
                내 건물 연결하기 <ArrowRight size={16} aria-hidden />
              </Link>
              <Link to="/login" state={{ demo: true }} className={btnCls('secondary', 'md', 'h-12 px-6 text-[15px]')}>
                부산대 IT관 데모 보기
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap gap-2" aria-label="수집하는 데이터">
              {DATA.map((d) => (
                <li key={d.label} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-2">
                  <d.icon size={14} className="text-ink-3" aria-hidden />
                  {d.label}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </section>

        {/* problem */}
        <section className="bg-paper py-20">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="text-[28px] font-bold tracking-[-0.025em] text-ink">왜 고정 스케줄로는 안 되나요</h2>
            <p className="mt-2 max-w-[60ch] text-[16px] text-ink-2">현장에서 시설 담당자가 매일 겪는 세 가지 문제에서 출발했습니다.</p>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {PROBLEMS.map((p) => (
                <article key={p.title} className="rounded-[16px] border border-line bg-surface p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-brand-bg text-brand" aria-hidden>
                    <p.icon size={20} />
                  </span>
                  <h3 className="mt-5 text-[17px] leading-snug font-[650] text-ink">{p.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{p.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* how */}
        <section className="py-20">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="text-[28px] font-bold tracking-[-0.025em] text-ink">어떻게 동작하나요</h2>
            <p className="mt-2 max-w-[64ch] text-[16px] text-ink-2">
              계획은 세 번 만들고, 매번 새로 들어온 데이터와 맞는지 정합성을 검증합니다. 숫자는 열모델 시뮬레이터가 계산하고, 생성형 AI는 해석과 협의를 맡습니다.
            </p>
            <ol className="mt-10 grid gap-4 md:grid-cols-5">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative rounded-[16px] border border-line bg-surface p-5">
                  <div className="flex items-center gap-2">
                    <span className="tnum flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white">{i + 1}</span>
                    <s.icon size={18} className="text-brand" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-[16px] font-[650] text-ink">{s.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* agents */}
        <section className="bg-paper py-20">
          <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-[28px] font-bold tracking-[-0.025em] text-ink">비용과 쾌적은 두 에이전트가 협의합니다</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-2">
                전기요금을 줄이면 누군가는 춥고, 쾌적을 높이면 요금이 오릅니다. ThermoPlan은 이 균형을 한쪽이 정하지 않게 두 에이전트에게 맡깁니다. 두 제안은 같은 날씨·같은 일정에서 시뮬레이터로 검증하고, 근거와 함께 합의안만 운전에 반영합니다.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="rounded-[16px] border border-line bg-surface p-6">
                <span aria-hidden>
                  <AgentAvatar agent="occupant" size={64} />
                </span>
                <h3 className="mt-4 text-[17px] font-[650] text-ink">사용자 에이전트</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">재실자 의견과 체감 쾌적도(PMV), CO₂를 근거로 쾌적을 대변합니다.</p>
              </article>
              <article className="rounded-[16px] border border-line bg-surface p-6">
                <span aria-hidden>
                  <AgentAvatar agent="building" size={64} />
                </span>
                <h3 className="mt-4 text-[17px] font-[650] text-ink">관리자 에이전트 북항이</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">전기요금, 전력 피크, 정부 냉난방 지침을 근거로 비용을 대변합니다.</p>
              </article>
              <article className="flex items-start gap-3 rounded-[16px] border border-line bg-surface p-5 sm:col-span-2">
                <Scale size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <p className="text-[14.5px] leading-relaxed text-ink-2">
                  담당자는 결론만 받는 것이 아니라, 에이전트가 어떤 데이터를 보고 왜 그렇게 판단했는지 근거를 확인할 수 있습니다.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* modes */}
        <section className="py-20">
          <div className="mx-auto max-w-[1200px] px-6">
            <h2 className="text-[28px] font-bold tracking-[-0.025em] text-ink">맡기는 정도는 직접 고릅니다</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="rounded-[16px] border border-line bg-surface p-6">
                <div className="flex items-center gap-2 text-[17px] font-[650] text-ink">
                  <Bot size={19} className="text-brand" aria-hidden /> 자동 운전 모드
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">AI 조정안을 바로 중앙 제어기에 반영하고, 모든 명령과 근거를 기록으로 남깁니다.</p>
              </article>
              <article className="rounded-[16px] border border-line bg-surface p-6">
                <div className="flex items-center gap-2 text-[17px] font-[650] text-ink">
                  <Hand size={19} className="text-brand" aria-hidden /> 추천 모드
                </div>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">AI는 조정안과 예상 효과만 제안하고, 담당자가 승인한 것만 반영합니다. 처음 도입할 때 권합니다.</p>
              </article>
            </div>
            <div className="mt-14 flex flex-col items-center gap-4 rounded-[20px] bg-ink px-6 py-12 text-center">
              <h2 className="text-[26px] font-bold tracking-[-0.025em] text-white">건물 하나로 시작해 보세요</h2>
              <p className="max-w-[48ch] text-[16px] text-[#c4cede]">중앙 제어 PC 주소만 있으면 연결부터 첫 월간 계획까지 10분 안에 끝납니다.</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link to={user ? '/setup' : '/signup'} className={cx(btnCls('secondary', 'md', 'h-12 px-6 text-[15px]'), 'border-white')}>
                  내 건물 연결하기
                </Link>
                <Link to="/login" state={{ demo: true }} className="inline-flex h-12 items-center rounded-[10px] px-6 text-[15px] font-medium text-white hover:bg-white/10">
                  데모 계정으로 로그인
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-[13px] text-ink-3">ThermoPlan은 2026 AWS x PNU AI 해커톤 과제 3 출품작입니다.</footer>
    </div>
  )
}
