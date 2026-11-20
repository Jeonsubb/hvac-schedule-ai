# API v5 계약 (B2B 온보딩, 1·2·3차 스케줄, 쾌적 의견, 에이전트 협의, 운전 모드)

타입은 `frontend/src/lib/types.ts`의 "v5" 블록이 기준입니다. 모든 경로는 `/api` 아래입니다.

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | /api/building | | BuildingProfile |
| PUT | /api/building | Partial<BuildingProfile> | BuildingProfile |
| POST | /api/onboarding/profile | {text} 건물 설명 자연어 | ProfileParse (Bedrock Haiku, 실패 시 규칙 해석 `ai:false`) |
| POST | /api/onboarding/connect | {method, vendor, protocol, host, port, pair_code?} | ConnectResult. 주소 형식이 틀리면 400 {detail} |
| GET | /api/onboarding/collect | | CollectResult (데이터 목록 + 부족한 정보 질문) |
| POST | /api/onboarding/answers | {answers: {policy_heat:[min,max], policy_cool:[min,max], hours:['08:30','22:30'], pre_on_min, gap_merge_min, attendance, mode, orient?: Record<room,'남'|'북'|'동'|'서'>}} | {policy: Policy, settings: Settings, applied: string[]} |
| GET/PUT | /api/policy | Partial<Policy> | Policy |
| GET | /api/mode | | OpMode |
| PUT | /api/mode | {mode:'auto'|'recommend'} | OpMode |
| GET | /api/plan/tier/{1,2,3}?date=YYYY-MM-DD | date 생략 시 기준일 | TierPlan |
| GET | /api/adjustments?status= | pending/applied/rejected | Adjustment[] (최신순) |
| POST | /api/adjustments/{id}/approve | | Adjustment (적용 + 제어 명령 전송) |
| POST | /api/adjustments/{id}/reject | | Adjustment |
| GET | /api/commands?limit=50 | | BmsCommand[] (최신순) |
| POST | /api/feedback | {room, vote:-3..3, tags?:string[], text?, source?:'occupant'|'operator'} | FeedbackReply |
| GET | /api/feedback?days=14&room= | | FeedbackSummary |
| POST | /api/negotiate | {tier:2|3, date?} | {job} → GET /api/jobs/{job} = NegotiationJob (progress.turns가 차례로 늘어남) |
| GET | /api/negotiate/latest?tier=3&date= | | Negotiation 또는 404 |
| POST | /api/lab/run | {start, days, mode:'rule'\|'llm'} | {job} → 작업 결과 LabResult (격리 실행: 조정안·명령 없음). 규칙 최대 10일, LLM 최대 3일 |
| GET | /api/lab/last | | 마지막 LabResult 또는 404 |
| GET/POST/DELETE | /api/lab/measured | CSV 파일(timestamp,kwh 또는 date,hour,kwh) | 실측 전력량 요약 (점 데이터 제외) |

- 자동 운전 모드: 새 조정안은 바로 `applied`가 되고 제어 명령이 기록됩니다. 추천 모드: `pending`으로 남고 승인해야 적용됩니다.
- 적용된 설정온도 조정은 AI 운전 시뮬레이션(운영 현황·타임라인·절감 효과)에 그대로 반영됩니다. 환기 단계 조정은 제어 명령과 CO₂ 예측에만 반영됩니다.
- 로그인·회원가입은 프런트엔드 목업(localStorage)입니다. `부산대학교 / 부산대학교`는 온보딩을 마친 계정입니다.
