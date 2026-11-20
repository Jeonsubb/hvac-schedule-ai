# ThermoPlan: 스케줄 기반 HVAC 자동 운전 AI

2026 AWS x PNU AI 해커톤 과제 3 (Cloud). 부산대학교 IT관 강의 시간표와 기상청·Open-Meteo 날씨로 강의실별 냉난방 운전 계획을 자동으로 만들고, 실내기(IDU)·실외기(ODU) 시뮬레이터로 실행 이력을 남기고, 강의 시간과 맞았는지 검증하고, 기존 방식 대비 절감 효과를 보여주는 시설 담당자용 웹 서비스입니다.

## v5: 어느 건물이든 연결하는 B2B 흐름

자세한 설계는 [docs/design_v5.md](docs/design_v5.md), API는 [docs/api_v5.md](docs/api_v5.md)에 있습니다.

- **진입**: 랜딩(`/welcome`) → 목업 로그인·가입. 데모 계정 `부산대학교 / 부산대학교`는 온보딩을 마친 IT관 운영 화면으로 바로 들어갑니다.
- **건물 설정 6단계**(새 계정): 건물을 말로 설명(AI가 프로필로 정리) → 중앙제어 PC 주소·프로토콜 입력과 현장 게이트웨이 연결 테스트(데모는 시뮬레이터가 응답) → 서버에서 데이터 수집 → AI가 부족한 정보를 묻고 답을 반영 → AI 1차 월간 스케줄 → 자동 운전 / 추천 모드 선택.
- **1·2·3차 스케줄**: 월간 기본 계획 → 주간 조정(예보·행사·의견·재실·CO₂) → 일일 검증(실황·센서·의견). 차수마다 새 데이터와 계획의 정합성을 점검하고 조정안을 만듭니다.
- **쾌적 의견**: 재실자 QR 페이지(`/feedback?room=306`)와 관리자 입력. 반복된 의견은 설정온도 조정안이 됩니다.
- **두 에이전트 협의**: 관리자 에이전트 '북항이'(비용)와 사용자 에이전트(쾌적)가 같은 자료와 시뮬레이터 결과로 설정온도를 주고받고, 사고 과정(어떤 데이터를 보고 무엇을 확인했는지)과 근거를 남깁니다.
- **운전 모드**: 자동 운전은 조정안을 바로 중앙제어기로 보내고, 추천 모드는 담당자 승인 뒤에 보냅니다. 적용된 설정온도 조정은 AI 운전 시뮬레이션에 그대로 반영됩니다.
- **메뉴 두 개**: 운전 현황(현황·절감 효과·쾌적 의견·운영 규칙), 스케줄 타임라인(타임라인·AI 스케줄링·정합성 검증·일정·데이터).
- **평가와 문헌 점검**: [docs/evaluation_agents.md](docs/evaluation_agents.md)(기간 성과, 판정 최적안과의 차이, 쾌적 가중치 민감도, LLM 수치 직접 인용률·일관성), [docs/research/literature_v5_agents.md](docs/research/literature_v5_agents.md), [docs/research/datasets_evaluation.md](docs/research/datasets_evaluation.md).
- **시뮬레이션 랩**(`/lab`, 별도 페이지): 에이전트가 정한 설정온도로 운전을 다시 시뮬레이션해서 현재 운영(22℃ 고정)·규칙·AI 단독·실측 전력량과 전력·요금·체감 쾌적을 비교합니다. 실측 CSV를 올리면 ASHRAE Guideline 14 보정 오차(NMBE, CV(RMSE))도 계산합니다.

## 핵심 결과 (2026-2학기, IT관 10개 강의실, 시뮬레이션)

<!-- numbers:README:start -->
_2026-11-20T02:53+09:00 기준 배포 API에서 자동 생성 (엔진 v13)._

| 전략 | 전력량 | 전기요금 | 쾌적 시간 | 불쾌 지표(K·분) | 최대 피크 |
|---|---|---|---|---|---|
| 고정 스케줄 | 6,365 kWh | 749,938원 | 99.88% | 391 | 45.1 kW |
| 수동 운영 | 3,626 kWh | 428,407원 | 98.44% | 11,889 | 28.4 kW |
| 규칙 기반 | 2,993 kWh | 346,868원 | 98.51% | 3,775 | 24.9 kW |
| **AI 예측 제어** | 2,864 kWh | 326,416원 | 99.94% | 32 | 24.7 kW |

- 학기 전체(9/1~12/18): AI 예측 제어는 고정 스케줄 대비 **55.0% 절감**, 수동 운영 대비 21.0%, 규칙 기반 대비 4.3% 절감합니다. 전기요금은 749,938원 → 326,416원, CO₂는 1,461 kg 줄어듭니다.
- 오늘(2026-11-20)까지: 고정 대비 50.4%, 규칙 기반 대비 9.3% 절감.
- **같은 쾌적도 기준**: 규칙 기반이 AI의 쾌적도에 다가가려면 30분 전에 켜야 하고 3,254 kWh를 씁니다(수업 시작 시 저온 16회). AI는 2,864 kWh로 **12.0% 적게** 쓰고 저온 시작은 7회입니다. 10분 전 규칙은 저온 시작이 152회입니다.
<!-- numbers:README:end -->

- 시뮬레이터는 실외기 용량 한계(동시 기동 시 포화)를 반영하고, AI는 실외기 용량을 나눠 쓰는 출력으로 예열 시간을 계산합니다.
- 요금은 한전 교육용(을) 고압A 선택I 시간대별 요금(2023-05-16 게시본), 탄소는 2023년도 국가 전력배출계수 0.4173 kgCO₂/kWh로 환산했습니다.
- 모든 수치는 `scripts/gen_numbers.py`가 배포된 API에서 다시 생성합니다. 절감 요인 분해와 재현 방법은 [docs/evaluation.md](docs/evaluation.md)에 있습니다.

## 요구사항 대응

| # | 요구사항 | 구현 |
|---|---|---|
| ① | 강의 스케줄 DB화 (API/DB/Excel/이미지) | CSV·Excel·JSON 파서, `POST /api/import/api` 연동 API, 이미지·PDF는 Claude Sonnet 5.5가 표준 스키마로 추출 (검증: 42/42 블록 일치) |
| ② | IDU/ODU 시뮬레이터와 On/Off 이력 | 강의실별 2R2C 열모델 + 환기 + VRF 부분부하 곡선, 1분 간격. 기기별 상태 전이 이력과 원인 기록 |
| ③ | 캘린더·강의실 타임라인 정합성 확인 | 월간 캘린더, 강의실별 간트(강의·계획·실행·실내온도), 계획 검증 + 실행 검증 2단계 |
| ④ | 기상청 데이터 병합 | 기상청 단기예보·초단기실황(공공데이터포털), Open-Meteo 실측·전날 예보. 외기 온·습도로 가동 생략·외기 냉방·제습 판단 |
| ⑤ | 현장 요구 대응 | 시작 N분 전 On, 종료 M분 전 Off, G분 이내 연속 유지(설정 가능), 시간표 밖 이벤트(보강·행사·휴강·강의실 변경·휴관), 자연어 등록, 변경 즉시 재계산과 전후 비교 |
| ⑥ | 절감 효과 가시화 | 4개 전략 비교(kWh·원·tCO₂·피크·쾌적도), 일별·누적 차트, 에너지-쾌적도 산점도, 강의실 재배치 권고 |
| 11 | 기상 예보 기반 예냉·예열 | 열모델과 예보로 강의실마다 켜는 시각 계산(최적 기동). 1·2·3차 점검에 횟수·선행 시간·내일 예보 표시 |
| 12 | 일사량·방향 기반 제어 | 강의실 방향(가정값, 운영 규칙에서 변경)과 시간별 일사로 오후 일사 부하(kW) 계산, 2·3차 점검에 반영 |
| 13 | CO₂ 기반 환기 계획 | 예상 인원·환기 단계로 CO₂를 1분 간격으로 계산(시뮬레이션 센서), 기준(1,000ppm)을 넘는 수업은 강 단계, 적은 수업은 약 단계 조정안 |
| 14 | 잔열·잔냉 활용 | 종료 전 정지해도 쾌적 범위에 남는 수업만 일찍 끄는 관성 정지. 2·3차 점검에 횟수 표시 |
| 15 | 날씨 급변 대응 | 3차 점검에서 계획 예보와 실황 편차가 기준(기본 2℃) 이상이면 실황으로 다시 계획해 예열 변화를 보여 줌. 매시 갱신 때 바뀐 날짜만 재계산 |

## 구성

서버 없이 관리형 서비스로만 운영합니다. 그림: [docs/architecture.png](docs/architecture.png)

```
브라우저 ─▶ CloudFront ─┬─ /*      ─▶ S3 (React 정적 파일, OAC)
                        └─ /api/*  ─▶ Lambda Function URL (FastAPI + Mangum, arm64, 비밀 헤더 검사)
                                         ├─ DynamoDB (강의·이벤트·설정·변경기록·작업 상태)
                                         ├─ S3 (날짜별 계산 결과, 날씨 캐시, 큰 작업 결과)
                                         ├─ Amazon Bedrock (Claude Sonnet 5.5 / Haiku 5.5)
                                         ├─ SSM Parameter Store (기상청 인증키)
                                         └─ 기상청 API(공공데이터포털), Open-Meteo
EventBridge Scheduler (매시 20분) ─▶ Lambda: 날씨 수집 → 예보 스냅숏 저장 → 바뀐 날짜만 재계산
```

- 오래 걸리는 AI 작업(시간표 이미지 추출, 코파일럿)은 작업 상태를 DynamoDB에 기록하고, Lambda가 자기 자신을 비동기로 호출해서 처리합니다. 화면은 작업 상태를 조회해서 결과를 받습니다. 재시도가 와도 같은 작업을 다시 실행하지 않습니다.
- 실행 역할은 두 개입니다. API 역할(`hvac-ai-api-role`)은 이 프로젝트의 테이블·버킷·파라미터와 Bedrock 모델 호출만 허용하고, 스케줄러 역할(`hvac-ai-scheduler-role`)은 Lambda 호출만 허용합니다(`infra/admin-setup.sh`).
- 모든 리소스는 CloudFormation 스택 `hvac-ai`(`infra/template.yaml`) 하나로 관리합니다.

| 경로 | 내용 |
|---|---|
| `backend/hvac/` | 결정적 엔진: 시간표 파서, 날씨, 열모델·VRF·PMV, 4개 전략, 시뮬레이터, 검증, 재배치 |
| `backend/app/` | FastAPI, 저장소 어댑터(로컬/AWS), Bedrock AI 기능, 비동기 작업, Lambda 핸들러 |
| `backend/tests/` | 엔진·규칙·검증·API 테스트 |
| `frontend/` | React + TypeScript + Tailwind + ECharts 웹앱 |
| `infra/` | CloudFormation 템플릿, 배포 스크립트, 배포용 IAM 정책 |
| `docs/` | 설계 문서, Goldfish 리뷰, 논문 조사, 검증 결과 |

## 생성형 AI의 역할

수치 제어는 결정적 엔진이 맡고, Claude는 사람이 하던 해석·입력·분석을 맡습니다.

- **시간표 이미지·PDF 추출** (Sonnet 5.5, 구조화 출력)
- **자연어 이벤트 등록**: "다음 주 수요일 405호 18~21시 특강 70명" → 이벤트 초안. 정원 초과 같은 문제를 확인 질문으로 돌려줍니다 (Haiku 5.5)
- **운영 코파일럿**: 학기 현황·일자 분석·규칙 시뮬레이션·재배치 분석 도구를 호출해서 근거 있는 답을 만들고, 검증된 규칙 변경만 "적용" 버튼으로 제안합니다. 수치는 도구 결과에서만 인용합니다 (Sonnet 5.5)
- **두 에이전트 협의**: 북항이(비용)와 사용자 에이전트(쾌적)가 4턴 동안 설정온도를 주고받습니다. 매 제안은 시뮬레이터가 검증하고, 판정은 결정적 규칙으로 합니다 (Haiku 5.5, 구조화 출력)
- **건물 설명 해석**: 온보딩에서 "부산대 IT관, 3·4층 강의실 10개…" → 건물 프로필 (Haiku 5.5)

## 로컬 실행

```bash
cd backend
uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python fastapi mangum "anthropic[bedrock]" "botocore[crt]" openpyxl python-multipart uvicorn pytest httpx
KMA_KEY=<공공데이터포털 인증키> AWS_PROFILE=<bedrock 권한 프로필> .venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest -q tests

cd ../frontend && npm install && npm run dev   # http://localhost:5173 (/api → :8000 프록시)
```

## 배포

| 모드 | 구성 | 명령 |
|---|---|---|
| `lambda` (현재) | CloudFront + S3 웹, Lambda API, DynamoDB + S3 데이터, Bedrock, EventBridge 매시 갱신 | 처음 한 번 `AWS_PROFILE=hvac bash infra/admin-setup.sh`로 실행 역할을 만든 뒤 `AWS_PROFILE=hvac ./infra/deploy.sh lambda` |
| `external` (비상용) | Lambda에 문제가 생겼을 때 API만 로컬 Mac에서 실행하고 Cloudflare 터널로 연결합니다. 웹·데이터·Bedrock은 그대로입니다. Mac의 로그인 세션을 쓰므로 최대 12시간만 동작합니다. | `AWS_PROFILE=hvac ./infra/run-local-api.sh start` → `AWS_PROFILE=hvac ./infra/deploy.sh external "$(cat infra/.run/tunnel.host)"` |

- 기상청 키는 처음 한 번 `KMA_KEY=<인증키>`로 넘기면 SSM Parameter Store(SecureString)에 저장됩니다.
- API는 CloudFront만 아는 비밀 헤더가 없으면 403으로 거절합니다.
- 프런트엔드만 다시 올릴 때: `AWS_PROFILE=hvac ./infra/deploy.sh frontend`
- 데모 초기화(이벤트 삭제, 운영 규칙과 시간표를 원본으로 복원): `AWS_PROFILE=hvac ./infra/deploy.sh demo-reset`. API는 SSM의 운영자 키가 헤더에 있어야만 초기화를 실행합니다.

## 가정과 한계

- 시간표에 없는 값(수강 인원, 강의실 면적, 설비 용량, 실외기 구성)은 가정값이며 화면에 "가정값"으로 표시합니다.
- 실제 설비 제어 대신 시뮬레이터로 실행합니다. 계획은 중앙제어기용 CSV로 내보낼 수 있습니다.
- 공휴일은 공공데이터포털 특일정보 API 사용 승인이 없어 설정값으로 둡니다.
- CO₂ 센서와 재실 밀도(Wi-Fi)는 시뮬레이션이고, 중앙제어기 연결은 게이트웨이 핸드셰이크를 시뮬레이션합니다. 데모 건물의 지난 의견도 시뮬레이션 PMV로 만든 값이며 화면에 표시합니다.
- 로그인·회원가입은 목업이고, 백엔드는 IT관 하나만 계산합니다.
