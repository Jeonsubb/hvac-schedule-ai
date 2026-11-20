import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Chapter tour: the operator screens are dense, so the demo walks through them one idea at a time.
 * Each step names a screen (path) and one anchored block (`data-tour="..."`) that is spotlighted.
 */
export interface TourStep {
  path: string
  target: string
  title: string
  body: string
}

export interface TourChapter {
  id: string
  title: string
  question: string
  steps: TourStep[]
}

export const CHAPTERS: TourChapter[] = [
  {
    id: 'now',
    title: '운영 현황',
    question: '오늘 어느 방을 언제 운전하나',
    steps: [
      {
        path: '/overview',
        target: 'ov-brief',
        title: '오늘 요약과 확인할 일',
        body: '강의 시간표에 수업이 있는 강의실만, 수업 전에 미리 켜고 끝나면 끄는 서비스입니다. 담당자가 승인하거나 확인해야 할 일이 있으면 이 줄에 먼저 나옵니다.',
      },
      {
        path: '/overview',
        target: 'ov-summary',
        title: '핵심 지표 세 가지',
        body: '오늘 쓸 전기와 요금, 모든 강의실을 종일 켜 둘 때와의 차이, 수업 시간 중 실내가 쾌적했던 비율입니다. 모두 시뮬레이션 값입니다.',
      },
      {
        path: '/overview',
        target: 'ov-building',
        title: '강의실 전체 운전 타임라인',
        body: '회색 칸은 수업 일정, 파란 막대는 냉난방을 켜는 구간입니다. 세로선을 끌면 선택 시각이 바뀌고, 공간 보기로 바꾸면 배치 개념도로 볼 수 있습니다.',
      },
      {
        path: '/overview',
        target: 'ov-time',
        title: '선택한 강의실 상세',
        body: '타임라인에서 강의실을 누르면 선택 시각의 예측 실내온도, 설정온도, 운전 상태, 추정 CO₂를 보여 줍니다. 실제 센서 값이 아닙니다.',
      },
      {
        path: '/energy',
        target: 'energy-hero',
        title: '학기 전체 절감 효과',
        body: '이번 학기에 아낀 전기와 요금, 탄소입니다. 아래 그래프는 절감이 어디서 나왔는지 나눠 보여 줍니다. 수업 시간에만 켜는 것이 가장 크고, 예측 기동과 날씨 판단은 쾌적을 지키면서 조금 더 줄입니다.',
      },
    ],
  },
  {
    id: 'today',
    title: '오늘 운전',
    question: '언제 무엇을 켜고 껐나',
    steps: [
      {
        path: '/schedule',
        target: 'sch-calendar',
        title: '날짜 고르기',
        body: '달력의 색은 그날 AI가 아낀 비율입니다. 날짜를 누르면 오른쪽에 그날 요약이 나옵니다.',
      },
      {
        path: '/schedule',
        target: 'sch-timeline',
        title: '강의실별 운전 타임라인',
        body: '회색은 수업, 색 막대는 AI가 실제로 켠 구간입니다. 수업 전에 미리 켜고(예열) 끝나기 전에 끄는(관성 정지) 모습이 보입니다.',
      },
    ],
  },
  {
    id: 'tiers',
    title: 'AI 스케줄 1·2·3차',
    question: '계획은 어떻게 다듬어지나',
    steps: [
      {
        path: '/plan?tier=1',
        target: 'plan-tiers',
        title: '계획은 세 번 만듭니다',
        body: '1차는 한 달 기본 계획, 2차는 이번 주 조정, 3차는 오늘 검증입니다. 단계가 내려갈수록 새로 들어온 데이터로 다시 확인합니다.',
      },
      {
        path: '/plan?tier=1',
        target: 'plan-summary',
        title: '1차 · 월간 기본 계획',
        body: '시간표, 학사일정, 날씨로 한 달 운전과 날짜별 전력을 계산합니다. 미리 만들어 두지 않고, "1차 계획 만들기"를 누르면 그 자리에서 단계별로 계산하며 걸린 시간을 보여 줍니다.',
      },
      {
        path: '/plan?tier=3',
        target: 'plan-respond',
        title: '상황이 바뀌면 바로 대응합니다',
        body: '휴강, 특강, 날씨 급변, "춥다" 의견, 무단 공강 버튼을 눌러 보세요. 그날 운전을 0.1초 안팎으로 다시 계산하고, 무엇을 감지해서 어떻게 바꿨는지 전후 타임라인으로 보여 줍니다.',
      },
      {
        path: '/plan?tier=3',
        target: 'plan-checks',
        title: '새 데이터와 어긋난 곳만',
        body: '"3차 검증 실행"을 누르면 실황, 센서, CO₂, 의견을 읽어 오늘 계획을 다시 계산하고, 어긋난 곳만 보여 줍니다. 정상인 점검은 접어 두어서 관리자는 조치가 필요한 것만 봅니다.',
      },
    ],
  },
  {
    id: 'comfort',
    title: '쾌적 의견',
    question: '이용자는 어떻게 느끼나',
    steps: [
      {
        path: '/comfort',
        target: 'comfort-rooms',
        title: '강의실별 체감',
        body: '재실자 QR과 관리자 입력으로 모은 의견의 평균입니다. 파랄수록 춥다는 의견이 많습니다.',
      },
      {
        path: '/comfort',
        target: 'comfort-form',
        title: '관리자도 입력합니다',
        body: '전화나 메일로 받은 불편도 같은 형식으로 남기면 다음 검증에 반영됩니다.',
      },
    ],
  },
  {
    id: 'agents',
    title: '두 에이전트',
    question: '비용과 쾌적을 어떻게 맞추나',
    steps: [
      {
        path: '/plan?tier=2&debate=1',
        target: 'plan-debate',
        title: '관리자 온디와 사용자 온디',
        body: '파란 관리자 온디는 비용을, 주황 사용자 온디는 쾌적을 맡아 설정온도를 주고받습니다. 제안마다 시뮬레이터가 다시 계산하고 마지막 판정은 규칙으로 정합니다. "협의 시작"을 누르면 30초 안팎으로 대화가 차례로 나옵니다.',
      },
    ],
  },
  {
    id: 'mode',
    title: '자동 운전',
    question: '누가 적용하나',
    steps: [
      {
        path: '/plan?tier=3',
        target: 'plan-adjustments',
        title: '조정안',
        body: '점검과 협의 결과는 조정안이 됩니다. 추천 모드에서는 담당자가 승인해야 중앙제어기로 보냅니다.',
      },
      {
        path: '/settings',
        target: 'mode',
        title: '자동 운전과 추천 모드',
        body: '자동 운전이면 작은 조정(0.5℃ 이내, 의견 3건 이상)은 바로 적용하고, 나머지는 승인을 기다립니다.',
      },
    ],
  },
  {
    id: 'verify',
    title: '정합성 검증',
    question: '계획대로 켜고 껐나',
    steps: [
      {
        path: '/validation',
        target: 'val-main',
        title: '계획과 실행 대조',
        body: '강의마다 계획과 실행 이력을 맞춰 보고, 이상이 있던 날과 강의를 골라 보여 줍니다.',
      },
    ],
  },
]

const SEEN_KEY = 'tp.tour.seen'

interface TourCtx {
  active: boolean
  chapter: number
  step: number
  start: (chapter?: number) => void
  stop: () => void
  next: () => void
  prev: () => void
  goChapter: (c: number) => void
  seen: () => boolean
}

const Ctx = createContext<TourCtx | null>(null)

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [chapter, setChapter] = useState(0)
  const [step, setStep] = useState(0)

  const markSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  const start = useCallback((c = 0) => {
    setChapter(c)
    setStep(0)
    setActive(true)
    markSeen()
  }, [])
  const stop = useCallback(() => setActive(false), [])
  const goChapter = useCallback((c: number) => {
    setChapter(Math.max(0, Math.min(CHAPTERS.length - 1, c)))
    setStep(0)
  }, [])
  const next = useCallback(() => {
    const ch = CHAPTERS[chapter]
    if (step < ch.steps.length - 1) setStep(step + 1)
    else if (chapter < CHAPTERS.length - 1) {
      setChapter(chapter + 1)
      setStep(0)
    } else setActive(false)
  }, [chapter, step])
  const prev = useCallback(() => {
    if (step > 0) setStep(step - 1)
    else if (chapter > 0) {
      setChapter(chapter - 1)
      setStep(CHAPTERS[chapter - 1].steps.length - 1)
    }
  }, [chapter, step])
  const seen = useCallback(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1'
    } catch {
      return true
    }
  }, [])

  const v = useMemo(() => ({ active, chapter, step, start, stop, next, prev, goChapter, seen }), [active, chapter, step, start, stop, next, prev, goChapter, seen])
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function useTour(): TourCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTour outside TourProvider')
  return c
}
