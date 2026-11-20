# ON:D Building Operations Studio

현재 브랜치: `codex/overview-operations-redesign`. 기존 관리자 화면을 보존하고 별도 Studio 프리뷰에서 재구성했다.

## 화면과 복귀 경로

- 프리뷰: `/studio/overview`, `/studio/plan`, `/studio/data`, `/studio/schedule`, `/studio/energy`, `/studio/comfort`, `/studio/validation`, `/studio/settings`.
- 복귀: `/classic/*`에서 `ClassicOverview`, `ClassicPlan` 및 여섯 `Classic*` 페이지 사본을 제공한다. Studio 도구 레일·푸터에도 복귀 링크가 있다.
- `/overview` 등 기본 경로의 Studio 전환은 최종 브라우저 검증 후 확정한다. 최종 전환 여부는 아래 검증 기록에 남긴다.
- `/welcome`은 수정하지 않는다.

## 구성

| 영역 | 구현과 책임 |
| --- | --- |
| 공통 셸 | `studio/StudioShell.tsx`: 76px 도구 레일, 유틸리티 바, 작업 캔버스, 실제 기준 날짜, 계정·보조 도우미 |
| 운영 Studio | `OperationsStudio` + SVG `LivingBuilding` + `OperationalTimeline`: 개념 배치도와 10개 강의실 시간축, 선택 강의실, 전략 비교, 재생·가상 시각 동기화 |
| 데이터 연결 | `useOperations`: 기존 `/api/day`, `/api/negotiate/compare`, `/api/iaq`, `/api/meta`, `/api/mode` 응답과 기존 `fromStrategy`·`fromView` 어댑터 재사용 |
| 협의 전용 화면 | `NegotiationTheater`: 비용 Agent 북항이와 쾌적 Agent의 분리된 무대, 실제 저장 라운드 선택, 결과 비교 |
| 일정 입력 | `Data.tsx`: 입력·판독·검토·가져오기 작업대와 기존 적용 기능 |
| 계획 달력 | `Schedule.tsx`: 캘린더와 선택 날짜 계획·시간축 |
| 에너지 | `Energy.tsx`: 적용 계획의 큰 영향 지표, 기능 분해·일별 추이·전략 비교, 누적 변화와 근거 |
| 쾌적 | `Comfort.tsx`: 실제 의견 평균의 SVG 공간 아틀라스, 출처 구분, 시간별 분석·의견 기록·등록 |
| 검증·설정 | `Validation.tsx`, `Settings.tsx`: 정합성 콘솔과 운영 정책 구성 작업대 |

기존 폼, CSV, 표 전환, QR 의견 링크, 승인·거절 및 근거 조회 기능을 유지한다. 페이지별 구성을 달리하고 공통 토큰·타이포그래피·컨트롤 언어를 공유한다.

## 데이터와 협의 상태

- 건물 도면은 실측 도면이 아닌 **개념 배치도**다. 온도·에너지·CO₂·PMV는 시뮬레이션 또는 추정값이다.
- 시간축의 가동 구간과 건물 상태는 실제 API 계획·선택 시각에서 읽는다. 임의 가동 구간이나 수치를 만들지 않는다.
- 협의 실행은 기존 `POST /api/negotiate`와 작업 폴링 계약을 사용한다. 진행 표시는 실제 요청 상태·서버가 제공한 phase/turns만 사용한다.
- 무대의 저장 라운드는 날짜와 `created_at`이 비교 응답에 일치할 때 표시한다. 라운드 번호·제안 설정온도·PMV는 실제 기록이다.
- 결과는 동일 조건이 확인된 `before`·`after` 하루 계획을 비교한다. 입력 조건이 바뀌었거나 자료가 없으면 현재 효과 수치를 제시하지 않는다.
- 사용량 증가는 부호와 증가 표현을 유지한다. 고정 운전 대비 물리 엔진 효과와 Agent 설정온도 협의의 추가 효과를 구분한다.
- 승인 대기는 예상 추천안이며 적용 완료로 표현하지 않는다. 일부 적용은 전체 추천안 시나리오와 현재 적용 상태를 구분해야 한다.
- Bedrock 실패 시 규칙 기반 대체 실행이라는 출처를 명시한다.

### 에너지 집계의 기준 차이

`/api/summary`는 `day_settings(d, ctx)`를 통해 해당 날짜에 적용된 강의실별 설정온도(`room_sp`)를 포함한다. `/api/attribution`은 `ctx.settings`를 사용해 기능을 하나씩 켜는 분해 실험을 계산한다. 따라서 `T.ai`와 `A.variants.ai`는 서로 다른 계획 기준일 수 있다. 각 API가 별도로 `stale` 결과를 반환할 수도 있다. 표시값을 강제로 맞추거나 엔진 계산을 수정하지 않는다.

## 모션과 접근성

Motion for React의 [공식 문서](https://motion.dev/docs/react)를 검토했다. 현재 의존성의 GSAP과 CSS로 필요한 연출이 가능해 신규 패키지를 추가하지 않았다. 전환·무대 공개·선택 강조는 transform/opacity 중심이며 `prefers-reduced-motion`, 키보드 탐색, 명시적 focus 상태를 지원한다. 거짓 진행률이나 가상의 Agent 분석 단계를 연출하지 않는다.

## 확인한 브라우저 검증

실제 Chrome과 기존 배포 API를 연결한 로컬 Vite 프리뷰에서 확인했다. 응답 데이터 대체나 목업 수치를 사용하지 않았다.

| 확인 항목 | 관찰 결과 |
| --- | --- |
| 1440px 운영 Studio | 건물 Scene와 운전 Timeline 전환·표시 확인 |
| 협의 무대 | 실제 저장 라운드 01·02 선택, 두 Agent 제안 표시 |
| 협의 결과 | 협의 전 44.6 → 후 44.1 kWh, 차이 −0.56 kWh, PMV −1.44 → −1.43, 쾌적 이탈 0 → 0분 |
| 에너지 | 기능 분해·일별 변화·전략 비교 세 가지 보기 전환 |
| 쾌적 | 조회 의견 66건, 시뮬레이션 66건·실제 접수 0건 출처 확인 |
| 일정 입력 | 가져오기 탭과 입력이 없는 상태의 비활성 액션 확인 |
| 계획 달력 | Studio 날짜 20일 → 21일 변경과 달력 표시 전환 확인 |

스크린샷: [운영 전](screenshots/studio-rebuild/before-overview.jpg) / [운영 프리뷰](screenshots/studio-rebuild/preview-overview-1440.jpg), [협의 전](screenshots/studio-rebuild/before-plan.jpg) / [새 무대](screenshots/studio-rebuild/preview-plan-stage-1440.jpg) / [결과](screenshots/studio-rebuild/preview-plan-result-1440.jpg), [에너지](screenshots/studio-rebuild/preview-energy-1440.jpg), [쾌적](screenshots/studio-rebuild/preview-comfort-1440.jpg), [일정 입력](screenshots/studio-rebuild/preview-data-1440.jpg), [달력](screenshots/studio-rebuild/preview-schedule-1440.jpg).

## 최종 검증 기록 — 후속 기입

- [ ] 1920px·모바일 반응형, 텍스트 잘림·overflow·버튼 간격 최종 확인
- [ ] 날짜·강의실·전략·재생·키보드·reduced-motion 종합 확인
- [ ] 네트워크 loading/error/retry와 모든 주요 진입점 확인
- [ ] 타입 검사·프로덕션 빌드 최종 결과
- [ ] 기본 경로 전환 여부와 최종 커밋·스크린샷·가능한 녹화 기록

백엔드, `backend/hvac`, Bedrock Agent, AWS 인프라 및 기존 `lib` 계산식은 변경하지 않는다. 프로덕션 배포나 승인·설정 변경, 실제 협의 재실행 여부는 수행한 범위만 별도 기록한다.
