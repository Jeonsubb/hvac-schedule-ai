# 운영 현황 리디자인 검증

- 기준: `main`을 `4323450`까지 동기화한 뒤 `codex/overview-operations-redesign`에서 작업.
- 범위: 프론트엔드 표시·상태·접근성. HVAC 엔진, Bedrock 협의 로직, AWS API 계약·인프라·데이터 출처는 변경하지 않음.
- 기존 SEED 토큰·CSS·Pretendard로 구현. 신규 패키지 없음. 기존 lockfile 기준 `npm ci`로 의존성 복원.
- 참고한 원본: [Linear](https://linear.app)의 정보 위계·간결한 내비게이션, [shadcn/ui](https://github.com/shadcn-ui/ui)의 컨트롤·접근성, [Motion](https://github.com/motiondivision/motion)의 절제된 상태 전환. [React Bits](https://github.com/DavidHDev/react-bits)도 검토했으며 장식 애니메이션은 추가하지 않았다.

## 구조와 데이터 흐름

`Overview → Brief + Kpi + DayTimeline / BuildingView + RoomPanel + AiSummary`

| 조회 | 표시 기준 |
| --- | --- |
| `/api/meta` | 건물·강의실·설정·기준 날짜 |
| `/api/day/{date}` | 선택 날짜의 수업·운전계획·시뮬레이션 |
| `/api/negotiate/compare?date={date}` | 협의 상태·동일 조건 여부·협의 전후 하루 계획 |
| `/api/iaq/{date}` | 현재 운영계획 기준 CO₂·인원 추정값 |
| `/api/mode` | 운영 모드·승인 대기 상태 |

날짜는 공유 상태, 강의실은 `?room=`, 전략·선택 시각·화면 전환은 Overview 상태다. 명시적으로 강의실을 선택해야 상세가 나타난다. `/plan` 복귀 시 실제 응답을 다시 조회한다.

## 실제 API 확인

Chrome에서 로컬 Vite 프록시를 통해 배포 CloudFront API를 조회했다. 수치를 가공한 응답이나 목업 데이터는 사용하지 않았다. 원본 근거: [api-evidence.json](screenshots/overview-redesign/api-evidence.json).

| 항목 | 확인값 |
| --- | --- |
| 고정 운전 | 177.6 kWh |
| 기본 예측 | 44.6 kWh |
| 협의 반영 | 44.1 kWh |
| 비교 원본 | `before.kwh=44.61`, `after.kwh=44.05` |
| 협의 조건·상태 | `same_conditions=true`, `state=applied`, `ai=true` |
| 협의 추가 효과 | −0.56 kWh, 쾌적 이탈 0 → 0분 |

이 응답의 `baseline/final`도 44.61/44.05였다. 화면의 44.0/44.1 차이는 `toFixed`와 `Intl` 기반 `fmtKwh`의 반올림 차이였다. KPI와 협의 요약은 같은 하루 계획 `before/after`와 일관된 표시 형식을 사용한다. 고정 운전 대비 절감률과 협의 추가 효과는 별개로 표시한다.

## 브라우저·기능 검증

| 환경 | 결과 |
| --- | --- |
| 1440×900 | 10개 강의실 행 표시, 타임라인 하단 약 870px |
| 1280×800 | 페이지 가로 넘침 없음. 강의실 선택 시 타임라인 폭 약 676px |
| 390×844 | 페이지 가로 넘침 없음. 약 541px 타임라인은 내부에서만 가로 스크롤 |
| 모바일 상세 | 직접 링크·화면 크기 변경·포커스 가두기·Escape 닫기 확인 |

확인한 상호작용:

- 공간 보기와 강의실 선택, 행 위·아래 이동, 전략 라디오 화살표 이동.
- 시각 슬라이더 End → 23:00, 왼쪽 화살표 → 22:55, 커서 동기화.
- 비교 토글, KPI 산출 기준, 협의 상세 펼침, CSV 다운로드.
- 상태 CTA → `/plan` 이동과 복귀 후 재조회.
- AI 도우미 열기·닫기, 빈 입력 전송 비활성, 계정 메뉴 Escape, 사이드바.
- 2026-11-22 실제 빈 날짜: 0 kWh·쾌적 비율 없음·협의 기록 없음.
- CDP로 day·iaq·compare 요청을 차단해 실제 네트워크 실패를 유도하고 오류·재시도·복구 확인. 응답 데이터 대체 없음.
- reduced-motion에서 전환 시간 `0.00001s` 확인.

`npm run typecheck`, `npm run build` 성공. 저장소에 기존 프론트엔드 테스트 러너는 없다.

## 전후 화면

| 자료 | 파일 |
| --- | --- |
| 변경 전 1440 | [before-1440.jpg](screenshots/overview-redesign/before-1440.jpg) |
| 변경 후 전체 | [after-1440-full.jpg](screenshots/overview-redesign/after-1440-full.jpg) |
| 선택 강의실 | [after-selected-1440.jpg](screenshots/overview-redesign/after-selected-1440.jpg) |
| 1280 | [after-1280.jpg](screenshots/overview-redesign/after-1280.jpg) |
| 모바일 | [after-mobile-390.jpg](screenshots/overview-redesign/after-mobile-390.jpg) |
| 모바일 상세 | [mobile-selected-390.jpg](screenshots/overview-redesign/mobile-selected-390.jpg) |
| 빈 날짜 | [empty-date.jpg](screenshots/overview-redesign/empty-date.jpg) |
| API 오류 | [api-error.jpg](screenshots/overview-redesign/api-error.jpg) |

전후를 직접 비교해 장문 브리핑·중첩 카드·중복 강조를 줄이고, 열린 KPI 행과 타임라인 중심으로 정리했다. 선택 전 상세 영역을 비워 타임라인 너비를 확보하고, 선택 후 운영 시각·상태를 온도보다 먼저 읽도록 배치했다. 텍스트 잘림·간격·정렬·타임라인 가독성과 모바일 넘침을 수정했다.

## 검증 한계

승인 대기·거절·일부 적용·입력 조건 변경 상태는 코드 검토로 확인했으며 실제 런타임에서는 관찰하지 않았다. 새 Bedrock 협의 실행, 조정안 승인, 마이크 사용, AWS 쓰기·설정 변경, 프로덕션 배포는 수행하지 않았다.
