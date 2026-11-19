# ThermoPlan: 스케줄 기반 HVAC 자동 운전 AI

2026 AWS x PNU AI 해커톤 과제 3 (Cloud). 부산대학교 IT관 강의 시간표와 기상청·Open-Meteo 날씨로 강의실별 냉난방 운전 계획을 자동으로 만들고, 실내기(IDU)·실외기(ODU) 시뮬레이터로 실행 이력을 남기고, 강의 시간과 맞았는지 검증하고, 기존 방식 대비 절감 효과를 보여주는 시설 담당자용 웹 서비스입니다.

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

## 구성

현재 운영 구성입니다. 배포 사용자에게 IAM 역할 생성 권한이 없어서 API만 EC2에서 실행합니다([이슈 #1](https://github.com/Jeonsubb/hvac-schedule-ai/issues/1)).

```
브라우저 ─▶ CloudFront ─┬─ /*      ─▶ S3 (React 정적 파일, OAC)
                        └─ /api/*  ─▶ EC2 t4g.small (Caddy HTTPS → FastAPI, 비밀 헤더 검사)
                                         ├─ DynamoDB (강의·이벤트·설정·변경기록·작업)
                                         ├─ S3 (날짜별 계산 결과, 날씨 캐시)  + 로컬 미러(ResilientStore)
                                         ├─ Amazon Bedrock (Claude Sonnet 5.5 / Haiku 5.5)
                                         └─ 기상청 API(공공데이터포털), Open-Meteo
EC2 systemd 타이머 (매시 20분) ─▶ 날씨 수집 → 예보 스냅숏 저장 → 바뀐 날짜만 재계산
```

목표 구성(`infra/template.yaml`의 `ApiMode=lambda`)은 API를 Lambda Function URL로, 매시 작업을 EventBridge Scheduler로 옮깁니다. 관리자가 `infra/admin-setup.sh`를 한 번 실행하면 `./infra/deploy.sh lambda`로 전환합니다.

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

## 로컬 실행

```bash
cd backend
uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python fastapi mangum "anthropic[bedrock]" "botocore[crt]" openpyxl python-multipart uvicorn pytest httpx
KMA_KEY=<공공데이터포털 인증키> AWS_PROFILE=<bedrock 권한 프로필> .venv/bin/uvicorn app.main:app --port 8000
.venv/bin/python -m pytest -q tests

cd ../frontend && npm install && npm run dev   # http://localhost:5173 (/api → :8000 프록시)
```

## 배포

배포 사용자(`hvac-dev-donghun`)에게는 IAM 역할 생성 권한이 없습니다. 그래서 두 가지 모드를 지원합니다.

| 모드 | 구성 | 명령 |
|---|---|---|
| `lambda` (목표) | CloudFront + S3 웹, Lambda API, DynamoDB + S3 데이터, Bedrock, EventBridge 매시 갱신 | 관리자가 CloudShell에서 `infra/admin-setup.sh`를 한 번 실행한 뒤 `AWS_PROFILE=hvac ./infra/deploy.sh lambda` |
| `external` (현재) | CloudFront + S3 웹, DynamoDB + S3 데이터, Bedrock은 그대로이고 API 서버만 로컬 Mac에서 실행해 Cloudflare 터널로 연결 | `AWS_PROFILE=hvac ./infra/run-local-api.sh start` → `AWS_PROFILE=hvac ./infra/deploy.sh external "$(cat infra/.run/tunnel.host)"` |

- 기상청 키는 처음 한 번 `KMA_KEY=<인증키>`로 넘기면 SSM Parameter Store(SecureString)에 저장됩니다.
- API는 CloudFront만 아는 비밀 헤더가 없으면 403으로 거절합니다.
- 프런트엔드만 다시 올릴 때: `AWS_PROFILE=hvac ./infra/deploy.sh frontend`

## 가정과 한계

- 시간표에 없는 값(수강 인원, 강의실 면적, 설비 용량, 실외기 구성)은 가정값이며 화면에 "가정값"으로 표시합니다.
- 실제 설비 제어 대신 시뮬레이터로 실행합니다. 계획은 중앙제어기용 CSV로 내보낼 수 있습니다.
- 공휴일은 공공데이터포털 특일정보 API 사용 승인이 없어 설정값으로 둡니다.
