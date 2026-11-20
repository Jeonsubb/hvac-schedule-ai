# API v5 계약 (B2B 온보딩, 1·2·3차 스케줄, 쾌적 의견, 에이전트 협의, 운전 모드)

> 2026-11-21에 현재 `backend/app/main.py` 기준으로 갱신했습니다(단계별 계산 작업, 협의 전후 비교, 음성, 게이트웨이, 이메일 알림, 변경 대응 미리보기 추가).

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
| POST | /api/plan/tier/{1,2,3}/run | {date?} | {job} → GET /api/jobs/{job}. 해당 차수를 지금 단계별로 계산(진행 단계와 걸린 시간 포함) |
| GET | /api/plan/runs | | 차수별 계산 실행 기록 |
| GET | /api/adjustments?status= | pending/applied/rejected | Adjustment[] (최신순) |
| POST | /api/adjustments/{id}/approve | | Adjustment (적용 + 제어 명령 전송) |
| POST | /api/adjustments/{id}/reject | | Adjustment |
| GET | /api/commands?limit=50 | | BmsCommand[] (최신순) |
| POST | /api/feedback | {room, vote:-3..3, tags?:string[], text?, source?:'occupant'|'operator'} | FeedbackReply |
| GET | /api/feedback?days=14&room= | | FeedbackSummary |
| POST | /api/negotiate | {tier:2|3, date?} | {job} → GET /api/jobs/{job} = NegotiationJob (progress.phase와 progress.turns가 차례로 갱신됨, 각 턴의 `sims`는 에이전트가 직접 호출한 시뮬레이션). IP당 분당 6회 |
| GET | /api/negotiate/latest?tier=3&date= | | Negotiation 또는 404 |
| GET | /api/negotiate/compare?date= | | 최신 일일 협의의 전후 비교(양쪽 ON/OFF 계획, 전력량, 쾌적성, 계산에 쓴 입력이 지금도 유효한지). 협의한 적이 없으면 `state:'none'` |
| GET | /api/iaq/{date} | | 강의실별 추정 CO₂와 인원(15분 간격, `source:'estimated'`, 센서 값 아님) |
| POST | /api/respond/preview | {kind:'cancel'\|'add'\|'weather'\|'feedback'\|'noshow', date?} | 변경 하나를 가정해 하루를 다시 계산한 결과(저장하지 않음) |
| GET | /api/voice/session | | {wake, ack, region, …} 서명된 Amazon Transcribe 스트리밍 주소와 응답음 |
| POST | /api/voice/turn | {messages:[{role, content, memo?}], page?, date?, speak?} | 답변 문장 + Polly 음성 + 데이터 카드 + 화면 이동. 마지막 메시지는 user여야 함 |
| POST | /api/voice/tts | {text} | {audio} |
| GET | /api/building/notifications | | 알림 설정과 수신 상태(인증 대기 중이면 SNS에 확인) |
| PUT | /api/building/notifications | {email, enabled, approvals, checks, failures, completed} | 저장하고 필요하면 확인 메일 요청. IP당 분당 3회, 확인 메일은 건물 하루 5회(초과 시 429) |
| POST | /api/gateway/pair | {pair_code, controller, version, allow_write} | 게이트웨이 ID와 토큰 (게이트웨이 → 클라우드) |
| POST | /api/gateway/telemetry | {gateway_id, device, points, allow_write, stats}. 헤더 `x-gateway-token` | 대기 중인 설정온도·환기 명령 |
| POST | /api/gateway/ack | {gateway_id, id(명령 ID), ok, refused?}. 헤더 `x-gateway-token` | |
| GET | /api/gateway/status | | 게이트웨이 온라인 여부와 최근 보고 |
| POST | /api/lab/run | {start, days, mode:'rule'\|'llm'} | {job} → 작업 결과 LabResult (격리 실행: 조정안·명령 없음). 규칙 최대 10일, LLM 최대 3일 |
| GET | /api/lab/last | | 마지막 LabResult 또는 404 |
| GET/POST/DELETE | /api/lab/measured | CSV 파일(timestamp,kwh 또는 date,hour,kwh) | 실측 전력량 요약 (점 데이터 제외) |

- 자동 운전 모드: 새 조정안은 바로 `applied`가 되고 제어 명령이 기록됩니다. 추천 모드: `pending`으로 남고 승인해야 적용됩니다.
- 적용된 설정온도 조정은 AI 운전 시뮬레이션(운영 현황·타임라인·절감 효과)에 그대로 반영됩니다. 환기 단계 조정은 제어 명령과 CO₂ 예측에만 반영됩니다.
- 로그인·회원가입은 프런트엔드 목업(localStorage)입니다. `부산대학교 / 부산대학교`는 건물 설정을 마친 계정입니다.
- 건물 설정 화면은 3단계(건물 알려주기, 중앙 제어 연결, 설비·운영 정보)이며 `profile`, `connect`, `collect`(질문 목록), `answers`를 사용합니다. 화면은 질문 중에서 설비·운영 항목만 묻고, `answers`에는 `policy_heat`, `policy_cool`, `hours`만 보냅니다.
- 게이트웨이가 온라인이면 `/api/onboarding/connect`의 결과는 `source:'gateway'`이고, 없으면 시뮬레이터 응답입니다.
