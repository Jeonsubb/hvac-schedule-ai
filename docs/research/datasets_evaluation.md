# 데이터셋·벤치마크·평가 방법 조사: 계량 데이터 없는 시뮬레이션 HVAC AI와 두 에이전트 협의를 어떻게 검증할 것인가

- 작성일: 2026-11-20 (발표 2026-11-21)
- 대상: ThermoPlan (부산대 IT관 강의실 10실, 시스템 에어컨 VRF/EHP, 강의실별 2R2C 열모델 + VRF 곡선, 기상청·Open-Meteo 날씨, 비용 측 '북항이'와 쾌적 측 '사용자 에이전트'의 협의 + 결정적 판정)
- 범위: (A) 쓸 수 있는 공개 데이터셋과 벤치마크, (B) 에이전트 시스템 평가 방법, 오늘 밤 돌릴 최소 프로토콜
- 검증 표기 (literature_review.md와 같은 규칙)
  - **[원문 확인]**: 공식 페이지, README, 데이터 저장소 기록, 논문 본문을 직접 열어 사실을 확인함
  - **[초록 확인]**: 초록이나 서지 페이지만 확인함
  - **[2차 출처]**: 원문(유료 표준 등)을 열지 못하고, 그것을 인용한 공개 문헌으로 확인함
  - **[스니펫]**: 검색 결과 요약으로만 확인함. 발표에서 단독 근거로 쓰지 마십시오.
- "우리 계산"이라고 쓴 값은 공개 메타데이터나 우리 README 수치로 직접 계산한 값이며, 원 출처가 보고한 값이 아닙니다.
- 링크 주의
  - NREL은 "National Laboratory of the Rockies"로 이름이 바뀌었습니다. 오늘 `www.nrel.gov`는 DNS 조회에 실패했고, BuildingsBench·EnergyPlus 저장소는 GitHub `NatLabRockies` 조직으로 옮겨져 있었습니다 [원문 확인]. 옛 nrel.gov 링크는 깨질 수 있습니다.
  - BOPTEST 공개 서비스 `api.boptest.net`은 응답하지만(버전 0.9.0), TLS 인증서가 2026-10-26에 만료되었습니다(오늘 openssl로 확인). 로컬 Docker 실행이 안전합니다.

---

## 0. 한눈에 보기

쓰임 표기: **(a)** 시뮬레이터 보정·검증, **(b)** 표준 시험대에서 제어·에이전트 벤치마크, **(c)** 재실자 의견 → 설정온도 로직 검증, **(d)** 재실·CO₂ 모델 검증, **(e)** 규모·부하 형상 상식 점검. ★는 우선순위가 높은 항목입니다.

### 0-1. 실측 데이터셋 (해외)

| 데이터셋 | 무엇이 측정됐나 | 규모·기간·간격 | 라이선스 | 우리 쓰임 | 링크 | 검증 |
|---|---|---|---|---|---|---|
| ★ PLEIAData (스페인 무르시아대) | **Toshiba VRF 실내기 88대**의 on/off·모드·**사용자 설정온도**, 방 온도 센서 191개, 블록별 전력(kWh), 기상, 일부 방 CO₂·재실 | 대학 건물 3개 블록 10,983 m²(사무실·실험실·강의실·도서관), 2021-01-01~12-18, 약 10분 | CC BY 4.0 | (a) VRF 곡선·방별 2R2C, (c) 실제 설정온도 분포 | https://doi.org/10.5281/zenodo.7620136 | [원문 확인] |
| ★ ASHRAE Global Thermal Comfort Database II v2.1 | 온열감 투표(−3~+3), 선호(더 시원/그대로/더 따뜻), 수용도, 기온·복사온도·습도·풍속·clo·met, PMV/PPD | 109,033행, 809개 건물. **강의실 11,710건(35개 건물)**. 한국은 서울 3개 건물 530건(사무실 등, 강의실 없음) | CC0 (Dryad) | (c) 의견 → 설정온도 규칙, PMV 오차 | https://doi.org/10.6078/D1F671 | [원문 확인] |
| ★ Bologna Cesena 스마트 캠퍼스 (2025) | 강의실 2·실습실 2의 온도·습도·CO₂·소음, **재실 인원**, **쾌적 투표 1,830건(182명)** | 2025-09-15~12-19, 약 5분 | CC BY 4.0 | (c) 수업 중 투표와 실온 대응, (d) | https://doi.org/10.5281/zenodo.18016442 | [원문 확인] 데이터 / 논문 [초록 확인] |
| ★ ROBOD (NUS) | **강의실 2**·사무실 2·도서관의 실내환경, Wi-Fi 접속 수, HVAC·조명·콘센트 에너지, HVAC 운전, 실제 재실 인원 | 181일, 5분 | CC BY 4.0 | (a) 강의실 열모델, (d) 인원 → CO₂ | https://doi.org/10.6084/m9.figshare.19234530 | [원문 확인] |
| SDU OU44 (덴마크) | 강의실 1·학습 공간 2의 재실 인원, 급기량, CO₂, 습도, 조도, 온도 | 44일, 원자료 + 1분 | CC0 | (d) | https://doi.org/10.6084/m9.figshare.9959417 | [원문 확인] |
| LBNL Building 59 | 존 온도(51존), 냉난방 설정온도(41존), HVAC·조명·콘센트 kW(15분), CO₂(13존), RTU 운전, 카메라 재실 인원, Wi-Fi | 사무소 2층 4,650 m², 57존, 2018-01~2020-12, 1~15분. 규칙·MPC 제어 기간 포함 | CC0 | (a) 보정 방법 시연 | https://doi.org/10.7941/D1N33Q | [원문 확인] |
| CU-BEMS (방콕) | **에어컨 실내기별 kW**, 조명·콘센트 kW, 존 온도·습도·조도 | 7층 사무소 11,700 m², 33존, 실내기 55대, 2018-07~2019-12, 1분 | CC BY 4.0 | (a) 실내기별 전력 vs 실온 | https://doi.org/10.6084/m9.figshare.11726517 | [원문 확인] |
| Building Data Genome Project 2 | 전기·냉수·온수·증기 등 계량 | 1,636개 건물, 계량기 3,053개, 19개 사이트, 2016~2017 시간별. 교육 용도 617동(College Classroom 133동 등, 우리 계산) | CC BY-SA 4.0(저장소 LICENSE) | (e) 대학 강의동 부하 형상 | https://github.com/buds-lab/building-data-genome-project-2 | [원문 확인] |
| ASHRAE GEPIII (Kaggle 2019) | 전기·냉수·증기·온수 계량, 기상 | 1,448개 건물, 계량기 2,380개, 16개 사이트, 시간별(학습 2016) | **이용 조건 미확인**(규칙 페이지 열람 실패) → BDG2를 대신 인용 | (e) | https://www.kaggle.com/c/ashrae-energy-prediction | [원문 확인] 논문 / 규칙 미확인 |
| 중국 열쾌적 데이터셋 (Sci Data 2023) | 투표 + 실내환경, 사무실·주거·**강의실**·기숙사 | 41,977세트, 49개 도시, 5개 기후대 | **미확인** | (c) 기후가 부산과 가까운 하계고온·동계한랭 기후대(우리 추정) | https://doi.org/10.17605/OSF.IO/D465N | [원문 확인] / 라이선스 미확인 |
| I-BLEND (인도 IIIT-Delhi) | 캠퍼스 7개 건물(강의동 포함) 전력, 건물별 재실, 기상, **학기 일정** | 2013-08~2017-12, 전력 1분·재실 10분 | CC0 | (e) 학기 일정 → 부하 | https://doi.org/10.6084/m9.figshare.c.3893581 | [원문 확인] |
| UCI Occupancy Detection | 온도·습도·조도·CO₂, 재실 여부(0/1) | 사무실 1실, 20,560행, 1분, 2015-02 | CC BY 4.0 | (d) 재실 감지 시험용(낮음) | https://archive.ics.uci.edu/dataset/357/occupancy+detection | [원문 확인] |
| ecobee Donate Your Data | 주거용 온도조절기 5분 데이터 | 전체 20만+ 가구(신청제), 공개 부분집합 1,000가구(2017) | 신청 필요, 부분집합 조건 미확인 | 낮음(주거·덕트식) | https://www.ecobee.com/en-us/donate-your-data/ | [원문 확인] / 조건 미확인 |
| Smart* (UMass) | 주거 회로별 전력, 환경, 재실 | 주거 | CC BY 4.0 | 낮음 | https://traces.cs.umass.edu/docs/traces/smartstar/ | [원문 확인] |
| Smart meters in London (Kaggle) | 가구 스마트미터 | 5,567가구, 30분, 2011-11~2014-02 | Open Database 표기 | 낮음 | https://www.kaggle.com/datasets/jeanmidev/smart-meters-in-london | [원문 확인] (Kaggle API) |

### 0-2. 국내 공개 자료

| 자료 | 무엇이 측정됐나 | 규모·기간·간격 | 라이선스 | 우리 쓰임 | 링크 | 검증 |
|---|---|---|---|---|---|---|
| ★ 국토교통부 건축HUB 건물에너지정보 서비스(API) | **지번별 월별 전기·가스 사용량** | 전국, 월 단위 | 이용허락범위 제한 없음(인증키) | (a) 부산대 지번 월 kWh vs 시뮬레이션 | https://www.data.go.kr/data/15135963/openapi.do | [원문 확인] |
| 국토교통부 건물에너지 전기에너지(파일) | 같은 내용의 파일판 | 월 단위 | 제한 없음 | (a) | https://www.data.go.kr/data/15054214/fileData.do | [원문 확인] |
| 한전 전력데이터 개방포털 계약종별 전력사용량 API | 시도·시군구·월별 계약종(**교육용** 포함) 사용량·요금 | 월 단위 | 회원 가입 후 API 키 | (e) 금정구 교육용 계절 패턴 | https://bigdata.kepco.co.kr | [원문 확인] |
| 한전 KBEMS 월별 소비전력량 | 한전 사옥의 용도별(조명·콘센트·**냉난방·공조** 등) 전력 | 2025-01~12, 월 | 제한 없음 | (e) 총량 중 냉난방 비중 범위 | https://www.data.go.kr/data/15131467/fileData.do | [원문 확인] |
| 온실가스종합정보센터 명세서 주요정보 | 사업장(부산대 포함) 연간 배출량·에너지 사용량 | 연 단위 | 공개 | (e) 캠퍼스 총량 대비 크기 | https://www.gir.go.kr/home/index.do?menuId=37 | [원문 확인] |
| DACON 전력사용량 예측 AI 경진대회 2023 / 2025 (한국에너지공단 주최) | 건물 100동 시간별 전력 + 기상, 건물 유형·면적 | 2023: '대학교' 8동, 2022-06~08 / 2025: '학교' 10동, 2024-06~08, 시간별 | **규칙·재사용 조건 미확인** | (e) 대학 여름 일중 부하 형상 | https://dacon.io (대회 236125, 236531) | [2차 출처] (참가자 GitHub로 교차 확인) |
| 공공기관 그린버튼 | 583개 기관 전력(시간·일·월) | — | 공개 | 부산대 **미포함** | https://min24.energy.or.kr/gb | [원문 확인] |
| AI Hub | 건물 HVAC·강의실 실내환경 데이터셋 **없음** | — | 내국인 신청제 | 해당 없음 | https://aihub.or.kr | [원문 확인] (목록 검색) |
| 기상청 ASOS 시간자료 API | 기온·습도·일사(icsr) 등 | 시간 | 공공누리 제1유형 | 입력 기상 실측 대조 | https://www.data.go.kr/data/15057210/openapi.do | [원문 확인] |

### 0-3. 벤치마크·시뮬레이션 시험대

| 시험대 | 무엇을 제공하나 | 규모·대상 | 라이선스 | 우리 쓰임 | 링크 | 검증 |
|---|---|---|---|---|---|---|
| ★ BOPTEST (IBPSA) | Modelica 건물 에뮬레이터 + REST API + **표준 KPI** 계산기 | 시험 케이스 12개. `singlezone_commercial_hydronic`은 **덴마크 대학 건물(강의실 포함)**, `multizone_office_simple_air`는 5존 VAV | BSD-3 계열 | (b) KPI 정의 차용, 이후 제어 로직 시험 | https://github.com/ibpsa/project1-boptest | [원문 확인] |
| BOPTEST-Gym | BOPTEST의 Gymnasium 래퍼 | — | BSD 계열 | (b) | https://github.com/ibpsa/project1-boptest-gym | [원문 확인] |
| CityLearn | 수요반응·건물군 제어 Gym 환경, 기준 대비 비율 KPI | v3.6.0(2026-11) | MIT | (b) KPI 정의 차용(쾌적 위반 비율, 피크) | https://github.com/citylearn-project/CityLearn | [원문 확인] |
| Sinergym | EnergyPlus Gymnasium, 에너지·쾌적 가중 보상 | 5존·사무소·데이터센터 등 | MIT | (b) 발표 후 EnergyPlus 모델 시험 | https://github.com/ugr-sail/sinergym | [원문 확인] |
| ★ EnergyPlus VRF 예제 파일 | `VariableRefrigerantFlow_5Zone.idf` 등 VRF 예제 9종 | — | BSD 계열 | (a) 우리 VRF 곡선을 EnergyPlus VRF 모델과 교차 검증 | https://github.com/NatLabRockies/EnergyPlus (testfiles) | [원문 확인] |
| DOE 참조 건물 / PNNL 프로토타입 | Primary School·Secondary School 모델 | 16개 유형 × 다수 기후 | 공개 | (a) 학교 건물 기준 모델 | https://www.energycodes.gov/prototype-building-models | [원문 확인] |
| ComStock / End-Use Load Profiles | 미국 건물 15분 용도별(냉방·난방·팬 등) 시뮬레이션 부하. PrimarySchool·SecondarySchool 포함 | 미국 건물 스톡 | CC BY 4.0 | (e) 학교 HVAC 원단위·일중 형상 | https://data.openei.org/submissions/4520 | [원문 확인] |
| BuildingsBench / Buildings-900K | 부하 예측 벤치마크(제어 아님), 합성 90만 동 + 실측 7종 | 약 110 GB | 코드 BSD-3, 데이터 CC BY 4.0 | 예측기 정확도 보고 시에만 | https://github.com/NatLabRockies/BuildingsBench | [원문 확인] |
| Modelica Buildings Library | 건물·HVAC 모델 라이브러리 | v14.0.0. **VRF 모델 없음** | BSD 계열 | 낮음 | https://github.com/lbl-srg/modelica-buildings | [원문 확인] |
| ACTB | Spawn of EnergyPlus 기반 시험대 | 2024-04 이후 갱신 없음, LICENSE 파일 없음 | 없음 | 쓰지 않음 | https://github.com/henze-research-group/MODRLC | [원문 확인] |

### 0-4. 결론 세 줄

1. **우리 상황(VRF, 강의실, 계량 데이터 없음)에 가장 가까운 공개 실측 데이터는 PLEIAData(대학 건물 VRF)와 ROBOD(강의실 2실)입니다.** 사용자 의견 로직 검증은 ASHRAE DB II 강의실 부분집합과 Bologna 강의실 투표가 맞습니다.
2. **표준 시험대 중 VRF를 가진 곳은 없습니다.** 오늘은 BOPTEST의 KPI 정의만 빌려 우리 시뮬레이터 결과에 붙이고 "BOPTEST 방식 KPI(우리 시뮬레이터)"라고 표기하십시오. BOPTEST 결과라고 부르면 안 됩니다.
3. **부산대 실측과 가장 가까운 공개 경로는 건축HUB 지번별 월 전력입니다.** IT관 단독 계량은 시설과 요청이나 정보공개청구로 받아야 합니다.

---

## 1. 데이터셋 상세

### 1.0 보정 합격선: ASHRAE Guideline 14

| 데이터 간격 | NMBE | CV(RMSE) |
|---|---|---|
| 월 단위 | ±5% | 15% |
| 시간 단위 | ±10% | 30% |

- 수식(측정값 y, 시뮬레이션 ŷ, 측정 평균 ȳ, 데이터 수 n, 모델 파라미터 수 p):
  - NMBE = Σ(y_i − ŷ_i) / ((n − p)·ȳ) × 100%
  - CV(RMSE) = √[Σ(y_i − ŷ_i)² / (n − p)] / ȳ × 100%
- 검증 수준 **[2차 출처]**: Guideline 14는 유료 표준이라 원문을 열지 못했습니다. 위 값은 다음 공개 문헌으로 확인했습니다.
  - 시간 단위 NMBE 10%·CV(RMSE) 30%: Mosteiro-Romero et al., arXiv:2210.06124 본문 [원문 확인], Digital Twin 논문 arXiv:2603.01198 본문 [원문 확인]
  - 2002년판 문구 "hourly MBE ±10%, CV(RMSE) ±30%, monthly 5%~15%": LEEDuser 포럼 인용 [2차 출처]
  - 월 단위 ±5%·15%: 여러 검색 결과가 일치 [스니펫]
- 주의
  - arXiv:2603.01198은 **Guideline 14-2014가 14-2023으로 대체되었다**고 적고 있습니다. 2023년판에서 기준값이 바뀌었는지는 확인하지 못했습니다. 발표에서는 "Guideline 14-2014 기준"이라고 판본을 밝히십시오.
  - p 값과 MBE/NMBE 표기는 문헌마다 다릅니다. arXiv:2603.01198은 보정 시뮬레이션에 p = 1을 썼고 [원문 확인], Ruiz & Bandera(2017)는 지침들 사이의 공식·표기 불일치를 지적했습니다 [초록 확인]. 계산식을 결과와 함께 적으십시오.
  - 이 기준은 **건물(또는 계량기) 에너지**를 측정값과 맞출 때 쓰는 것입니다. 실내온도에는 기준이 없으므로 RMSE(K)로 따로 보고합니다.
  - Garrett & New(2016, ORNL)는 2만 회 이상의 자동 보정에서 출력 오차가 작아도(CV(RMSE) < 4%) 입력 파라미터 오차가 평균 20%를 넘을 수 있음을 보였습니다 [원문 확인]. **G14를 통과해도 R·C 값이 물리적으로 맞다는 뜻은 아닙니다.**

### 1.1 PLEIAData: 대학 건물 VRF 실측 (가장 가까운 사례) [원문 확인]

- 출처: Ibarra, González-Vidal, Skarmeta, *Scientific Data* 10:118 (2023), doi:10.1038/s41597-023-02023-3. Zenodo 7620136 (CC BY 4.0, Data_Nature.zip 약 283 MB).
- 확인한 사실: 논문 본문에 "the HVAC units are Toshiba VRF"라고 적혀 있습니다. 방 사용자가 리모컨으로 모드·설정온도를 바꾸고, 전력은 건물(블록) 단위로 계량합니다. 3개 블록 10,983 m², 사무실·실험실·강의실·도서관이 포함됩니다.
- 쓰는 법
  - **(a) VRF 곡선 검증**: 블록별 시간 전력과 그 시각 실내기 가동 대수·설정온도·외기온도로 우리 VRF 부분부하 곡선을 돌려 비교합니다. 시간별 CV(RMSE) ≤ 30%, NMBE ±10%를 목표로 합니다.
  - **(a) 방별 2R2C 식별**: 실내기 on/off·모드와 방 온도, 기상으로 방마다 R·C를 맞추고 수업 1회(최대 3시간) 예측 RMSE(K)를 보고합니다. 우리 파이프라인을 실측 데이터에 처음 적용해 보는 시연으로 적합합니다.
  - **(c) 설정온도 분포**: 사용자가 실제로 고른 계절별 설정온도 분포로 정책 범위와 기본값의 근거를 만듭니다.
- 주의: 전력이 실내기별이 아니라 블록별입니다(HVAC 전용인지 총량인지는 파일에서 확인 필요). 무르시아 기후는 부산과 다르고, 어느 방이 강의실인지는 매핑 표로 확인해야 합니다.

### 1.2 ASHRAE Global Thermal Comfort Database II: 의견 로직 검증 [원문 확인]

- 출처: Földváry Ličina et al., *Building and Environment* 142:502–512 (2018), doi:10.1016/j.buildenv.2018.06.022. Dryad v2.1(CC0). GitHub https://github.com/CenterForTheBuiltEnvironment/ashrae-db-II (CSV, 예제 스크립트, 라이선스 파일 없음).
- 확인한 사실(조사 시 행 수를 직접 셈): 109,033행 중 온열감 투표가 있는 행 106,171, 선호 투표가 있는 행 85,991. 강의실 11,710건(35개 건물; 자연환기 6,791, 혼합 3,208, 공조 1,311). 한국은 서울 3개 건물 530건이며 강의실은 없습니다. v2.1의 PMV/PPD는 pythermalcomfort로 다시 계산되어 있습니다.
- 같은 데이터로 한 분석: PMV가 실제 온열감을 맞힌 비율은 약 34%, 평균 절대오차 1단위(Cheung et al. 2019) [초록 확인].
- **(c) 쓰는 법: 우리 규칙을 실제 투표로 채점합니다.**
  1. 강의실·공조/혼합 건물, 난방철(또는 냉방철) 기록만 고릅니다.
  2. **오경보 기준율**: PMV가 −0.5~+0.5인데 투표가 −1 이하("춥다")인 비율입니다. `complaint_rooms`의 기준(의견 2건 이상, 평균 −0.8 이하)이 쾌적한 방을 얼마나 자주 "반복 불만"으로 잡을지 추정합니다.
  3. **1℃당 투표 변화**: 건물별로 온열감 투표를 작용온도에 회귀해 기울기(투표/℃)를 구합니다. 평균 투표를 −0.8에서 0으로 올리는 데 필요한 ℃와 우리 규칙의 조정 폭(0.5~1℃, PMV 목표 +0.3)을 비교합니다.
  4. **규칙 재현**: 같은 건물·같은 날 기록을 한 "강의실"로 묶어 우리 규칙을 적용합니다. 정답을 "다수가 더 따뜻하길 원함(선호 투표)"으로 두고 정밀도·재현율을 계산합니다.
  5. **PMV 편향**: 강의실 난방철에서 평균(투표 − PMV)을 구합니다. 우리 시뮬레이터의 PMV −1 안팎 문제를 설명할 때 근거가 됩니다.
- 주의: 횡단 설문 스냅숏이라 "조정 → 다시 투표"의 폐루프는 없습니다.

### 1.3 Bologna Cesena 강의실 투표 (2025) [원문 확인(데이터) / 초록 확인(논문)]

- 출처: Tumedei, Ceccarini, Delnevo, Prandi, *Data*(MDPI) 11(2):31 (2026), doi:10.3390/data11020031. Zenodo 18016442(CC BY 4.0, 약 1.1 MB).
- 내용: 강의실 2·실습실 2, 2025-09-15~12-19. 약 5분 간격 온도·습도·CO₂·소음·기압(약 10만 9천 행), 재실 인원, 182명의 투표 1,830건(온열감 −2~+2, 선호 온도대, 공기질, 소음, 전반 쾌적).
- 쓰는 법: (c) 투표 시각의 실온과 짝지어 중립온도와 "1표당 ℃"를 추정합니다. 한 사람이 여러 번 투표하므로 **개인 편향(늘 춥다는 사람)의 크기**를 재서 §3.7 견고성 시나리오 R2의 현실성을 확인합니다. (d) 인원 수와 CO₂로 질량수지 모델을 검증합니다.
- 주의: 투표 척도가 5점(−2~+2)이라 우리 7점(−3~+3)과 환산이 필요합니다. HVAC 방식은 확인하지 못했습니다.

### 1.4 ROBOD·SDU OU44: 강의실 재실과 CO₂ [원문 확인]

- **ROBOD**: Tekler et al., *Building Simulation* 15:2127–2137 (2022), doi:10.1007/s12273-022-0925-9. 강의실 2·사무실 2·도서관, 181일 5분, 실내환경·Wi-Fi·HVAC 에너지·HVAC 운전·실제 재실 인원. 싱가포르(위치는 [스니펫]).
- **SDU OU44**: Schwee et al., *Scientific Data* 6:287 (2019), doi:10.1038/s41597-019-0274-4. 강의실 1·학습 공간 2, 44일, 재실 인원·급기량·CO₂, 좌석 수와 실 체적 포함, CC0.
- 쓰는 법: (d) 시간표 → 예상 인원 → CO₂ 모델(우리 1분 질량수지)을 실측 인원·CO₂로 검증하고 CO₂ RMSE(ppm)를 보고합니다. ROBOD는 강의실 HVAC 에너지가 있어서 (a) 강의실 열모델 식별에도 씁니다.
- 주의: 열대(싱가포르)·북유럽(덴마크) 기후이며 설비가 VRF가 아닙니다.

### 1.5 LBNL Building 59·CU-BEMS: 보정 방법 시연용 [원문 확인]

- **LBNL Building 59**: Luo et al., *Scientific Data* 9:156 (2022), doi:10.1038/s41597-022-01257-x. Dryad CC0(zip 263 MB, 풀면 2.38 GB). 사무소 57존, 2018~2020. 존 온도·설정온도·HVAC kW·CO₂·재실 인원이 모두 있고 규칙·MPC 제어 기간이 들어 있습니다. 설비는 수냉식 DX 옥상형 공조기 4대 + 바닥 급기입니다.
- **CU-BEMS**: Pipattanasomporn et al., *Scientific Data* 7:241 (2020), doi:10.1038/s41597-020-00582-3. 방콕 7층 사무소, 33존, **실내기 55대의 kW**, 1분, 2018-07~2019-12, CC BY 4.0. 논문은 1~2 kW 벽걸이형과 20~40 kW 대형 압축기를 언급합니다(조사 중 "split-type"이라는 표현은 확인하지 못함).
- 쓰는 법: (a) 우리 2R2C 식별 → 보정 기간/검증 기간 분리 → G14 지표·RMSE 보고까지 전체 절차를 실측 데이터로 한 번 보여 주는 용도입니다. CU-BEMS는 "실내기별 전력 + 존 온도"라는 점에서 우리 모델 구조와 가장 비슷합니다.
- 주의: 사무소이고, CU-BEMS는 냉방만 하며 설정온도·재실 정보가 없습니다.

### 1.6 BDG2·GEPIII·I-BLEND: 대학 건물 부하 형상 점검 [원문 확인]

- **BDG2**: Miller et al., *Scientific Data* 7:368 (2020), doi:10.1038/s41597-020-00712-x. 저장소 LICENSE는 CC BY-SA 4.0(Kaggle 사본도 CC BY-SA 4.0), 논문은 CC BY 4.0입니다. 교육 용도 617동 중 College Classroom 133동, College Laboratory 121동(조사 중 메타데이터로 셈, 우리 계산).
- **GEPIII**: Miller et al., *Science and Technology for the Built Environment* 26(10):1427–1447 (2020), doi:10.1080/23744731.2020.1795514. 건물의 약 73%가 대학 캠퍼스 소속이고 가장 흔한 유형이 교육입니다. Kaggle 데이터 이용 조건은 확인하지 못했으므로 **인용과 재사용은 BDG2로 하십시오**.
- **I-BLEND**: Rashid, Singh, Singh, *Scientific Data* 6:190015 (2019). 캠퍼스 7개 건물 1분 전력 + 재실 + **학기 일정**, CC0.
- 쓰는 법: (e) College Classroom 건물들의 평일/주말 비, 방학 감소, kWh/m², 일중 피크 시각을 우리 시뮬레이션 패턴과 나란히 놓고 상식 점검합니다. 건물 총량이고 대부분 중앙식이라 VRF 강의실 HVAC와 절대값 비교는 할 수 없습니다.

### 1.7 그 밖의 해외 데이터

- **중국 열쾌적 데이터셋**(Yang et al., *Scientific Data* 10:662 (2023), doi:10.1038/s41597-023-02568-3): 41,977세트, 강의실 포함, OSF 공개, 라이선스 미확인. 하계고온·동계한랭 기후대(11,787세트)가 부산과 가장 비슷할 것으로 보입니다(우리 추정, 논문 주장 아님).
- **UCI Occupancy Detection**(Candanedo & Feldheim, *Energy and Buildings* 112:28–39 (2016)): CO₂·조도 기반 재실 감지 시험용입니다. 인원 수가 없어 우리에게는 쓰임이 작습니다.
- **ecobee DYD, Smart\*, Smart meters in London**: 주거용이라 관련도가 낮습니다.
- 찾지 못한 것: 한국 강의실 쾌적·CO₂ 공개 데이터셋, 공개된 대규모 VRF 운전 데이터(중국 VRF 287,000대 연구는 [스니펫]이고 데이터 공개는 확인하지 못함).

### 1.8 국내 공개 자료 상세

**(1) 국토교통부 건축HUB 건물에너지정보 서비스** [원문 확인]
- 오퍼레이션 `getBeElctyUsgInfo`(전기), `getBeGasUsgInfo`(가스). 필수 파라미터는 시군구코드, 법정동코드, 번, 지, 사용연월(YYYYMM)입니다. 지번 단위 월별 사용량이며, 단독주택·200세대 미만 공동주택과 산업·수송·발전용 등은 제외됩니다. 이용허락범위 제한 없음, 개발계정 자동 승인.
- 쓰는 법: 부산대 장전동 지번으로 2023~2025년 월별 kWh를 받습니다. 그다음 월 kWh를 난방·냉방 도일(HDD/CDD)에 회귀(change-point 모델)해 날씨에 반응하는 부분만 떼어 내고, 시뮬레이터의 월별 냉난방 kWh와 **계절 패턴과 비율**을 비교합니다.
- 주의: 지번 합계이고 조명·콘센트·연구장비가 섞여 있습니다. 부산대 건물이 여러 지번에 걸쳐 있다는 제3자 자료가 있으므로 [스니펫], IT관의 지번은 건축물대장으로 확인해야 합니다. 필수 파라미터에 대지구분이 없어서 '산' 지번이 조회되는지는 실제 호출로 시험해야 합니다.

**(2) 한전 전력데이터 개방포털** [원문 확인]
- 계약종별 전력사용량 API(`/openapi/v1/powerUsage/contractType.do`): 연·월 필수, 시도(부산 26)·시군구 선택. 응답에 고객호수·사용량(kWh)·요금·평균판매단가가 있고, 가이드 예시에 '교육용'이 있습니다. 포털 가입 후 API 키를 받습니다.
- 쓰는 법: 금정구 교육용 월 kWh로 냉방철(7~8월)·난방철(12~2월) 비율이 우리 시뮬레이션의 계절 비율과 비슷한지 교차 점검합니다. 지역 학교 전체 합이라 절대값 비교는 하지 않습니다.

**(3) 온실가스종합정보센터 명세서 주요정보** [원문 확인]
- 부산대학교의 연간 에너지 사용량이 대상년도 2024는 648 TJ(국토교통부 관장, 업종 '건물'), 2025는 851 TJ(기후에너지환경부 관장, 업종 '고등 교육기관')로 조회됩니다. 두 해 사이 관장기관·업종 분류가 바뀌었으므로 산정 범위가 같은지 확인한 뒤 써야 합니다.
- 쓰는 법: 캠퍼스 전체 대비 IT관 강의실 냉난방 시뮬레이션 값의 크기가 상식 범위인지 점검합니다(예: 연면적 비례 배분). 전기·가스를 합친 TJ이므로 kWh 환산 기준을 확인해야 합니다.

**(4) 한전 KBEMS 데이터** [원문 확인, 메타데이터만]
- 월별 소비전력량(15131467)은 조명·콘센트·냉난방·충전소·공조·배터리충전·기타로 나뉩니다. 사업소별(15131429), 수요관리예측(15131462)도 있습니다.
- 쓰는 법: 건물 총량에서 "냉난방 + 공조" 몫의 범위를 잡는 근거로 씁니다. 한전 사옥(업무시설)이라 강의실 패턴과 다릅니다.

**(5) DACON 전력사용량 예측 AI 경진대회** [2차 출처]
- 2023년(대회 236125): 100개 건물의 시간별 전력 + 기온·강수·풍속·습도·일조·일사, 건물 유형·연면적·냉방면적. 유형 중 '대학교' 8동, 2022-06-01~08-24 학습 기간. 2025년(대회 236531): '학교' 10동, 2024-06-01~08-24.
- dacon.io는 자동 접근이 막혀 공식 페이지를 열지 못했고, 참가자 GitHub의 building_info와 README로 교차 확인했습니다. **규칙·재사용 조건을 대회 페이지에서 직접 확인하기 전에는 발표·보고서에 데이터를 싣지 마십시오.**
- 쓰는 법: (e) 국내 대학 캠퍼스의 여름 일중 부하 형상(평일/주말, 피크 시각, 외기 1℃당 kWh)을 정성 비교합니다. 연면적(약 15만~66만 m²)으로 보아 캠퍼스 단위 계량으로 보입니다(추정).

**(6) 확인 결과 쓰기 어려운 곳**
- 공공기관 그린버튼: '국·공립 대학교' 분류 아래 기관이 없고 부산대는 포함되지 않았습니다 [원문 확인].
- 그린투게더: 건물에너지 사용량 조회 메뉴는 있지만 결과 화면이 스크립트로 그려져 공개 범위를 확인하지 못했습니다 [초록 확인].
- 대학알리미·부산대 사전정보공개: 에너지 사용량 항목을 찾지 못했습니다 [스니펫]. **정보공개포털(open.go.kr)로 IT관 월별 전력을 청구하는 것이 가장 확실한 경로입니다.**
- AI Hub: 건물 HVAC·강의실 실내환경 데이터셋이 없습니다 [원문 확인].
- 서울 열린데이터광장: 가정 위주 자료라 관련도가 낮습니다 [원문 확인].

---

## 2. 벤치마크 상세

### 2.1 BOPTEST [원문 확인]

- 출처: Blum et al., *Journal of Building Performance Simulation* 14(5):586–610 (2021), doi:10.1080/19401493.2021.1986574 [초록 확인]. 저장소 https://github.com/ibpsa/project1-boptest(최신 릴리스 v0.9.0, 2025-11-18), KPI 설계 문서 https://ibpsa.github.io/project1-boptest/docs-design/core_kpi.html. IBPSA Project 1에서 시작해 Project 2로 이어지고 있습니다.
- 핵심 KPI(§3.1에 수식): `tdis_tot`(K·h/zone), `idis_tot`(ppm·h/zone), `ener_tot`(kWh/m²), `cost_tot`(통화/m²), `emis_tot`(kgCO₂e/m²), `pele_tot`·`pgas_tot`·`pdih_tot`(15분 평균 최대, kW/m²), `time_rat`(계산 시간 비율).
- 시험 케이스 12개(저장소와 `GET /testcases` 응답 일치): `bestest_air`, `bestest_hydronic`, `bestest_hydronic_heat_pump`, `twozone_apartment_hydronic`, `multizone_residential_hydronic`, `singlezone_commercial_hydronic`, `multizone_office_simple_hydronic`, `multizone_office_simple_air`, `multizone_office_complex_air`, 개발용 `testcase1~3`.
  - `singlezone_commercial_hydronic`: 남덴마크대학교(SDU) 건물을 단순화한 단일 존 모델입니다. 문서에 강의실이 있는 3층 건물, 8,500 m²라고 적혀 있습니다(오늘 문서 확인). 지역난방·CO₂ 제어 환기, 난방 전용입니다.
  - `multizone_office_simple_air`: DOE 중형 사무소의 5존, VAV 재열, 시카고 기상, 재실 6~19시.
- 시나리오: 전기요금(constant / dynamic / highly_dynamic), 기간(peak/typical heat·cool day, mix_day; 2주 시험 + 1주 예열), 예보 불확실성(low/medium/high).
- 실행: 로컬 `docker compose up web worker provision` → `http://127.0.0.1:8000`. 공개 서비스는 인증서 만료 문제가 있습니다(머리말 참고).
- 쓰는 법
  - **하루 안**: KPI 정의만 빌려 우리 시뮬레이터 출력에 계산합니다(§3.1). 시간이 남으면 `bestest_air`에서 규칙 기반 최적 기동·정지를 한 번 돌려 볼 수 있습니다(덮어쓸 수 있는 설정값은 `GET /inputs`로 확인).
  - **발표 이후**: `multizone_office_simple_air`(5존)에서 두 에이전트 협의를 존별 설정온도 협상으로 옮겨 시험합니다. BOPTEST KPI를 그대로 보고하면 다른 논문과 비교할 수 있습니다.
- 한계: VRF 케이스가 없고, 강의실 케이스는 단일 존 난방 전용입니다.

### 2.2 CityLearn [원문 확인]

- 출처: Vázquez-Canteli et al., BuildSys '19, doi:10.1145/3360322.3360998; Nweye et al., *JBPS* (2024), doi:10.1080/19401493.2024.2418813 [초록 확인]. MIT, https://www.citylearn.net.
- KPI: ramping, 1 − 부하율, 일·전체 피크, 전력 소비, 탄소, 비용, 쾌적 위반 비율(전체·추움·더움), 정전 중 쾌적 위반 비율(1 − thermal resilience) 등. 대부분 **기준 운전 대비 비율**로 보고합니다.
- v2부터 EULP 기반의 데이터 구동 열역학 모델(LSTM)을 쓰고 냉난방 장치 설정을 행동으로 받습니다.
- 쓰는 법: KPI 정의(쾌적 위반 비율을 추움/더움으로 나누기, 기준 대비 비율 표기)를 빌립니다. 강의실별 VRF 제어 시험대로는 맞지 않습니다.

### 2.3 Sinergym [원문 확인]

- 출처: Campoy-Nieves et al., *Energy and Buildings* 327:115075 (2025), doi:10.1016/j.enbuild.2024.115075. MIT, v3.12.2, EnergyPlus 26.1.0 기반.
- 보상: r_t = −ω·λ_P·P_t − (1−ω)·λ_T·(|T_t − T_up| + |T_t − T_low|). 5Zone 기본값은 ω = 0.5, 쾌적 범위 겨울 20.0~23.5℃, 여름 23.0~26.0℃입니다.
- 쓰는 법: 발표 이후 EnergyPlus VRF 모델(2.4)을 Sinergym에 올려 에너지·쾌적 가중치를 바꿔 가며 우리 판정 목적함수와 같은 형태의 비교를 할 수 있습니다(사용자 정의 건물 적재는 조사에서 시험하지 않았음).

### 2.4 EnergyPlus VRF 예제와 학교 기준 모델 [원문 확인]

- EnergyPlus 저장소(https://github.com/NatLabRockies/EnergyPlus, v26.2.0, BSD 계열) `testfiles`에 `VariableRefrigerantFlow_5Zone.idf`, `_5Zone_wAirloop`, `_wSuppHeater_5Zone`, `_FluidTCtrl_5Zone`, `_FluidTCtrl_HR_5Zone`, `_FluidTCtrl_wSuppHeater_5Zone`, `HVACTemplate-5ZoneVRF.idf`, `VRFMultispeedFan.idf`, `DOAToVRF.idf`가 있습니다.
- DOE 참조 건물(Primary School 1층, Secondary School 2층)과 PNNL 프로토타입(16개 유형 × 19개 지역, EnergyPlus 22.1.0)이 공개되어 있습니다. 프로토타입 중 VRF를 쓰는 모델이 있는지는 확인하지 못했습니다.
- 쓰는 법: **(a) 실측 없이도 할 수 있는 교차 검증**입니다. 5존 VRF 예제를 부산 기상(EPW)과 우리 강의실 크기·내부 발열로 바꿔 돌리고, 같은 입력을 우리 2R2C + VRF 곡선에 넣어 시간별 전력·실온을 비교합니다. "고해상도 물리 모델 대비 CV(RMSE)"로 보고하되, 실측 검증이 아니라 모델 간 비교라고 밝힙니다.

### 2.5 ComStock / End-Use Load Profiles [원문 확인]

- OEDI 4520(https://data.openei.org/submissions/4520), CC BY 4.0, doi:10.25984/1876417. 미국 건물 스톡의 보정된 15분 용도별 부하. 최신 ComStock 2025 release 3에는 PrimarySchool·SecondarySchool이 있고 냉방·난방·팬·펌프·배열 kWh 열이 있습니다. 방법론: Wilson et al. (2022), doi:10.2172/1854582.
- 쓰는 법: (e) 학교 건물의 HVAC 원단위(kWh/m²)와 일중 형상을 우리 값과 견줍니다. 미국 초·중등학교이므로 참고치로만 씁니다.

### 2.6 BuildingsBench, Modelica Buildings, ACTB

- **BuildingsBench**(Emami, Sahu, Graf, NeurIPS 2023 Datasets & Benchmarks, arXiv:2307.00142): 부하 예측 벤치마크입니다. 예측기를 따로 만들 때만 의미가 있습니다 [원문 확인].
- **Modelica Buildings Library**(Wetter et al., *JBPS* 7(4):253–270, 2014): v14.0.0, 3-clause BSD 계열. 라이브러리 전체에서 VRF 모델을 찾지 못했습니다 [원문 확인].
- **ACTB**(Marzullo et al., *JBPS* 15(3):379–397, 2022): 저장소가 2024-04 이후 멈췄고 LICENSE 파일이 없습니다. 쓰지 않는 것을 권합니다 [원문 확인].

### 2.7 LLM 에이전트 HVAC 연구와 벤치마크 현황

- **LLM 에이전트 전용 HVAC 벤치마크는 찾지 못했습니다.** 기존 연구는 BOPTEST·Sinergym·CityLearn·EnergyPlus를 다시 씁니다. **비용 측과 쾌적 측 LLM 에이전트가 설정온도를 협상하는 논문도 찾지 못했습니다**(찾지 못했다는 뜻이지 없다는 뜻은 아닙니다).
- 가까운 연구
  - Xin, Liang, Chong, "Causality-constrained hierarchical LLM agents for online rule adaptation in building HVAC control", *Applied Energy* 427 (2026), doi:10.1016/j.apenergy.2026.129012 [초록 확인]. BOPTEST 1·2·5존 케이스와 규칙·MPC·PPO·MAPPO 비교를 썼다는 내용은 [스니펫].
  - ThermoLLM(Bhatt et al.), arXiv:2606.22911 (2026): 5존 환경, 기후·계절 시나리오 6개 [초록 확인].
  - DRBENCH(Rui Wang), SSRN 2026, doi:10.2139/ssrn.7447344: "PPO와 SAC가 평가한 모든 온라인 LLM 에이전트보다 비용·피크 제어에서 낫다" [초록 확인]. LLM이 직접 제어하지 않는 우리 설계의 근거로 씁니다.
  - Sawada et al., "Office-in-the-Loop", *Data-Centric Engineering* 6 (2025), doi:10.1017/dce.2025.10010: 실제 사무실 배포에서 데이터 근거를 요구하자 예측 안정성이 좋아졌습니다 [초록 확인].
  - Sasaki et al., BuildSys 2025, doi:10.1145/3736425.3772325: LLM 재실자 에이전트가 온열감 투표를 생성하는 평가 틀입니다 [스니펫].
  - Neubauer, Hong et al., arXiv:2609.05314 (2026): 2023~2026-03 동료심사 논문 66편 중 파일럿 수준 근거 4편, 즉시 적용 가능 0편. LLM은 물리 기반 제어기를 감싸는 자문 계층으로 쓰라고 권합니다 [초록 확인].
  - Song et al., arXiv:2308.03028 (2023), Ahn et al., *Buildings* 13:2680 (2023), He & Jazizadeh, arXiv:2512.25055 (2025)는 literature_review.md F2~F5에 정리되어 있습니다.

---

## 3. 평가 방법

### 3.1 제어 KPI 정의와 수식 (BOPTEST 방식)

모든 KPI는 **같은 날씨·같은 재실(이상 주입 시드 고정)·같은 시작 상태**에서 전략만 바꿔 계산합니다. Z는 강의실 수, A는 강의실 바닥면적 합, 적분은 별도 표기가 없으면 평가 기간 전체입니다(쾌적 범위는 수업 시간에만 좁고 나머지 시간에는 넓게 둡니다). 정의는 BOPTEST 핵심 KPI 문서를 따랐습니다 [원문 확인].

| KPI | 수식 | 단위 | BOPTEST 키 | 지금 코드 |
|---|---|---|---|---|
| 에너지 | E = Σ_t P(t)·Δt, 정규화 E/A | kWh, kWh/m² | `ener_tot` | kWh 있음. 면적 정규화만 추가 |
| 비용 | C = Σ_t P(t)·π(t)·Δt (π: 교육용(을) 시간대 요금) | 원, 원/m² | `cost_tot` | 있음 |
| 탄소 | Σ_t P(t)·e·Δt (e = 0.4173 kgCO₂/kWh, 고정) | kgCO₂ | `emis_tot` (BOPTEST는 시간별 배출계수) | 있음 |
| 열 불쾌 | D_th = (1/Z)·Σ_z ∫ [max(T_low,z − T_z, 0) + max(T_z − T_up,z, 0)] dt | K·h/zone | `tdis_tot` | "불쾌 지표(K·분)"가 합계로 있음 → ÷60 ÷Z로 환산 |
| 공기질 불쾌 | D_IAQ = (1/Z)·Σ_z ∫ max(CO₂_z − CO₂_up, 0) dt | ppm·h/zone | `idis_tot` | CO₂ 1분 시뮬레이션 있음 → 적분만 추가 (CO₂_up = 1,000 ppm) |
| 최대 수요 | 15분 평균 전력의 최댓값, 정규화 ÷A | kW, kW/m² | `pele_tot` | "최대 피크" 있음. 15분 평균인지 명시 |
| 계산 시간 | 계획·협의 1회에 걸린 시간 / 제어 주기 | 비율 | `time_rat` | 협의 30~40초. 측정·기록 추가 |

- CityLearn은 KPI를 **기준 운전 대비 비율**(1.0 = 기준과 같음)로 보고합니다 [원문 확인]. 우리도 표 옆에 "고정 스케줄 = 1.00" 비율 열을 붙이면 단위가 다른 KPI를 한 줄에 놓고 비교할 수 있습니다.
- CityLearn의 discomfort 지표는 "쾌적 범위를 벗어난 재실 시간 단계의 비율(전체·추움·더움)"입니다 [원문 확인]. 우리의 "쾌적 시간 %"와 같은 개념이므로 추움/더움을 나눠 보고합니다.

### 3.2 쾌적 지표

| 지표 | 기준 | 계산 | 검증 |
|---|---|---|---|
| PMV 적합률 | ASHRAE 55-2023: −0.5 < PMV < +0.5 | 수업 시간 중 범위 안 시간 비율 | pythermalcomfort 문서 [원문 확인] |
| EN 16798-1 범주 | I: PPD < 6%, −0.2 < PMV < +0.2 · II: < 10%, ±0.5 · III: < 15%, ±0.7 · IV: < 25%, ±1.0 | 범주별 수업 시간 비율 | REHVA Journal 2024 표 [원문 확인] |
| 작용온도 범위(난방철, 1 clo, 1.2 met) | 범주 II 20.0~24.0℃, 범주 III 19.0~25.0℃ | 수업 중 작용온도가 범위 안인 비율 | 같은 표 [원문 확인] |
| 작용온도 범위(냉방철, 0.5 clo) | 범주 II 23.0~26.0℃, 범주 III 22.0~27.0℃ | 같음 | 같은 표 [원문 확인] |
| 평균 PPD | ISO 7730 PMV→PPD 식 | 수업 시간 가중 평균 | pythermalcomfort로 계산 |

주의할 점이 두 가지 있습니다.

1. **PMV 자체의 정확도가 낮습니다.** ASHRAE Global Thermal Comfort Database II로 검증한 결과 PMV가 실제 온열감을 맞힌 비율은 약 34%였고, 평균 절대오차는 온열감 척도 1단위였습니다(Cheung et al. 2019) [초록 확인]. pythermalcomfort 문서는 Tartarini & Schiavon(2025)을 인용해 PMV를 −0.5~+0.5 범위에서만 쓰라고 권합니다 [원문 확인]. 그래서 PMV는 **전략 간 상대 비교**에만 쓰고, 절대 쾌적 판정은 작용온도 범위와 재실자 의견으로 보완하는 편이 안전합니다.
2. **우리 시뮬레이터는 11월 말에 정책 범위 안에서도 PMV가 −1 안팎**으로 나옵니다(구조체 온도를 평균복사온도로 쓰기 때문, design_v5 §가정과 한계). 발표에서는 "PMV는 상대 변화로만 판단했다"고 밝히고, 작용온도 기준 범주 II 시간 비율을 함께 보여 주면 이 약점을 방어할 수 있습니다.

### 3.3 기준선과 보고 방식

| ID | 구성 | 목적 |
|---|---|---|
| B0 | 고정 스케줄 | 기존 방식 (비율 1.00 기준) |
| B1 | 수동 운영 | 현장 현실 |
| B2 | 규칙 기반 (N분 전 On) | 단순 자동화 |
| B3 | AI 예측 제어 (협의 없음 = 현재 계획) | 에이전트 없는 AI |
| B4 | B3 + **결정적 최적 설정온도** (같은 목적함수로 강의실마다 격자 전수 탐색) | 에이전트가 넘을 수 없는 상한(오라클) |
| B5 | B3 + 규칙 기반 에이전트 협의 (`use_ai=False`) | LLM 없는 협의 |
| B6 | B3 + LLM 에이전트 협의 (Haiku, k회 반복) | 제출 시스템 |
| B7 | B3 + LLM 1라운드 + 판정 (선택) | 협의 라운드의 기여 분리 |

- **B4가 핵심 대조군입니다.** 판정의 목적함수 J = Σ_r [kWh_r·요금 + w_r·gap_r·600원·일수](`agents._room_score`)는 결정적이므로, 격자 전체에서 J를 최소화한 안을 바로 구할 수 있습니다. 그러면 LLM 협의의 가치를 "B4보다 J가 얼마나 나쁜가(regret)"와 "설명·근거를 얼마나 잘 남기는가"로 나눠 정직하게 보여 줄 수 있습니다. Choi et al.(2025)는 다중 에이전트 토론의 이득 대부분이 다수결에서 나온다고 보고했고 [초록 확인], Smit et al.(2024)은 토론이 단순 앙상블을 안정적으로 이기지 못했다고 보고했습니다 [초록 확인]. 심사위원이 "에이전트 없이 최적화하면 되지 않느냐"고 물을 때 B4 대비 수치가 답이 됩니다.
- **단순 기준선을 반드시 넣습니다.** Kapoor et al.(2024)은 재시도 같은 단순 기준선이 복잡한 에이전트와 대등한 경우가 많았다며 정확도와 비용을 함께(파레토) 보고하라고 권합니다 [원문 확인]. 우리에게는 B5(규칙 에이전트)가 그 기준선입니다.
- **짝지은 비교**: 일 단위로 같은 날의 차이를 계산하고, 날짜를 1,000회 부트스트랩해 95% 신뢰구간을 붙입니다. LLM 구성(B6, B7)은 같은 입력을 n회 반복해 min·중앙값·max를 보고합니다. Atil et al.(2024)은 temperature 0에서도 분포가 정규분포가 아니어서 표준편차 대신 범위를 썼습니다 [원문 확인].
- **같은 쾌적도 비교**(iso-comfort)는 이미 evaluation.md에 있습니다. 협의 구성에도 같은 방식으로 "같은 PMV 적합률에서 kWh"를 붙입니다.
- **에너지-쾌적 산점도**: x = kWh(또는 원), y = K·h/zone. B0~B7을 점으로 찍고, B4에서 쾌적 가중치를 바꿔 얻은 곡선(파레토 프런티어)을 함께 그립니다.

### 3.4 에이전트 평가 항목

| # | 항목 | 정의 | 로그에서 계산하는 방법 | 제안 합격선 |
|---|---|---|---|---|
| 1 | 목적함수 regret | J(최종안) − J(B4) | `_room_score`를 강의실별로 합산 | 0원에 가까울수록 좋음, 중앙값 보고 |
| 2 | 최적 대비 달성률 | (J(B3) − J(최종)) / (J(B3) − J(B4)) | 같음 | 보고만 |
| 3 | 합의율·판정 개입률 | `final.agreed` 비율 / 판정 절충 비율 | 협의 결과 JSON | 보고만 |
| 4 | 라운드 수 | 합의까지 턴 수 | `turns` 길이 | 보고만 |
| 5 | 정책 준수(원시) | 클리핑 **전** 제안 중 범위 밖·0.5℃ 단위 위반·강의실 누락 비율 | `_clean_proposal` 전에 원시 JSON 기록 필요 | 0% 목표. 위반은 숨기지 말고 "보정됨" 건수로 보고 |
| 6 | 스키마·대체율 | JSON 실패, Bedrock 실패로 규칙 에이전트 전환 비율 | `ai` 플래그 | 보고만 |
| 7 | 수치 근거율 | 메시지·trace 숫자 중 자료 묶음·시뮬레이터 값과 일치하는 비율 | §3.5 알고리즘 | ≥ 95%, 근거 없는 숫자는 사례로 제시 |
| 8 | 방향 주장 정확도 | "올리면 PMV가 좋아진다"처럼 부호가 있는 주장이 시뮬레이터와 맞는 비율 | 20개 수작업 라벨 + 자동 | 보고만 |
| 9 | trace 충실도 | trace의 source가 실제 자료 항목이고 finding의 숫자가 그 항목 값과 일치 | §3.5와 같은 방식 | 보고만 |
| 10 | 메시지-제안 일치 | 메시지에 쓴 설정온도와 JSON 제안이 같은 비율 (MAST FM-2.6에 해당) | 정규식 | 100% 목표 |
| 11 | 일관성 | 같은 입력 n회에서 최종 설정온도가 모두 같은 비율(TARa@n), pass^k | §3.6 | 보고만 |
| 12 | 지연·비용 | 턴별·협의별 p50/p95 지연, 입력·출력 토큰, 협의 1회 비용 | 타이머와 응답 `usage` 기록 추가 | 보고만 |
| 13 | 민감도 | 쾌적 가중치(600원), 반복 의견 가중(3배), 목표 이동(0.3)을 바꿨을 때 결과 | §3.7 | 곡선으로 제시 |
| 14 | 견고성 | 잡음·편향·스팸 의견에서 잘못 조정한 강의실 비율 | §3.7 | 보고만 |
| 15 | 변형 시험 | 입력을 바꿨을 때 결과가 바뀌어야 할 방향 (아래 MR) | pytest | 위반 0건 |
| 16 | 사람 평가 | 운영자가 설명을 보고 승인·거절을 맞게 판단한 비율, 설명 만족도 | §3.8 | 보고만 |

변형 시험(metamorphic relation)은 정답을 몰라도 확인할 수 있는 성질입니다. 규칙 에이전트(B5)와 판정은 결정적이라 pytest로 바로 확인할 수 있고, LLM(B6)은 3회 반복해 위반 횟수를 셉니다.

- MR1 (의견 단조성): 난방철에 강의실 X의 '춥다' 의견을 늘리면 X의 최종 설정온도는 내려가지 않습니다.
- MR2 (요금 단조성, 판정 수준): 요금 단가를 올리면 판정 단계에서 선택된 안의 kWh는 늘지 않습니다.
- MR3 (순서 불변): 자료 묶음에서 강의실 순서만 섞으면 최종안이 같아야 합니다(LLM은 위치 편향 점검).
- MR4 (정책 범위): 정책 범위를 좁히면 최종 설정온도는 모두 새 범위 안에 있습니다.
- MR5 (무관 의견 불변): '답답함' 태그만 늘리면 설정온도는 바뀌지 않고 환기 조정만 생깁니다.

### 3.5 수치 근거율 계산 (결정적 매칭, LLM 판정관 없이)

LLM이 쓴 숫자는 LLM 판정관이 아니라 **결정적 매칭**으로 확인합니다. FActScore(Min et al. 2023)처럼 문장을 원자 단위 주장으로 나누는 발상을 숫자에 적용한 것입니다 [초록 확인].

1. 허용 집합 S: 그 턴에서 LLM이 본 텍스트(`dossier_text(ds)` + 이전 턴 요약)의 모든 숫자와, 시뮬레이터 평가(`eval`의 kWh·원·PMV·강의실별 값), 강의실 번호, 날짜, 정책 범위.
2. 메시지와 trace.finding에서 숫자를 정규식으로 뽑습니다(천 단위 쉼표 제거, ℃·kWh·원·ppm 단위 함께 기록).
3. 판정: (a) S에 표시 자릿수 기준으로 같은 값이 있으면 "근거 있음", (b) S의 두 값의 차·비율(±0.5% 허용)이면 "파생", (c) 그 외는 "근거 없음".
4. 지표: 근거율 = (a+b)/전체, 환각률 = c/전체. 근거 없는 숫자 전부를 표로 남겨 사람이 확인합니다(초기 20건은 수작업 라벨로 매칭기 정확도를 같이 보고).

현재 설계는 이미 Neubauer et al.(2026)의 권고("물리 기반 제어기를 감싸는 자문 계층")와 맞습니다 [초록 확인]. 화면 숫자는 시뮬레이터에서 바로 그리고 LLM 메시지 속 숫자는 감사 대상으로만 두는 것이 좋습니다. 도구 출력을 LLM이 다시 서식화할 때 값이 손상되는 사례가 보고되었습니다(Hoang 2026, ICML 워크숍) [초록 확인]. 또 Sethi et al.(2026)은 도구가 쓸 수 없는 값을 "정상"으로 돌려주면 에이전트가 값을 지어내는 비율이 크게 오르고, 실패 상태를 명시하면 줄어든다고 보고했습니다 [초록 확인]. 시뮬레이터 값이 `None`일 때(예: 격자에서 kWh가 비는 경우) 상태를 분명히 적어 주는지 점검할 만합니다.

### 3.6 일관성

- 같은 자료 묶음(같은 날짜, `fb_until` 고정, `sandbox=True`)으로 n회(오늘 밤 5회, 이후 10회 이상) 실행합니다.
- **TARa@n**: n회의 최종 설정온도가 모두 같은 비율(강의실 단위·협의 단위). 메시지 원문 일치(TARr@n)는 의미가 작으니 참고로만 둡니다(Atil et al. 2024) [원문 확인].
- **pass^k**: τ-bench의 정의(과제별로 k회 시도가 모두 성공할 확률, C(c,k)/C(n,k)의 평균)를 씁니다 [원문 확인]. "성공"은 정책 준수 + 근거율 100% + regret ≤ ε(예: 협의 기간 요금의 1%)로 정의합니다.
- 강의실별 최종 설정온도의 분포를 점 그림(strip plot)으로 그리면 한눈에 보입니다.

### 3.7 민감도와 견고성

**민감도** (결정적이므로 B4와 B5로 빠르게 돌립니다)
- 쾌적 가중치 `COMFORT_WON` ∈ {0, 150, 300, 600, 1200, 2400, 10000}원/(PMV·강의실·일) → kWh와 K·h/zone(또는 평균 PMV 하락)의 곡선. 현재 값 600이 곡선의 어디에 있는지 표시합니다.
- 반복 의견 가중 ∈ {1, 2, 3, 5}배, 목표 이동 ∈ {0, 0.3, 0.5} → 의견 강의실의 PMV 변화와 추가 kWh.
- 이 곡선이 있으면 "600원은 왜 600원인가"에 "운영자가 고를 수 있는 손잡이이고, 지금은 이 지점"이라고 답할 수 있습니다.

**견고성** (의견 주입 시나리오, `source: simulated`로 표시해 실제 의견과 섞이지 않게)

| 시나리오 | 주입 방법 | 기대 동작 | 측정 |
|---|---|---|---|
| R0 의견 없음 | — | 의견 강의실 없음, 절감안만 | 기준 |
| R1 사실 기반 잡음 | 투표 = clip(round(PMV_sim + ε), −3, 3), ε ~ N(0, 1.25²) | PMV가 낮은 강의실만 조정 | 오조정률·미조정률 |
| R2 한 명의 반복 불만(스팸) | 쾌적한 강의실(PMV 최고)에 '춥다' −2를 10건 | 3배 가중이 과잉 반응하는지 확인 | 추가 kWh, 설정 변화 |
| R3 상충 의견 | 같은 강의실 '춥다' 5건 + '덥다' 5건 | 평균 0 → 조정 없음 | 오조정 여부 |
| R4 '답답함'만 | 태그만 10건 | 설정온도 불변, 환기 조정 | MR5 |
| R5 라벨 뒤집기 | 의견 부호를 확률 p ∈ {0, 0.1, 0.2, 0.3}로 뒤집기 | 성능이 완만하게 떨어짐 | 곡선 |

- ε의 크기 1.25는 PMV의 평균 절대오차가 약 1단위라는 보고(Cheung et al. 2019) [초록 확인]에 맞춘 값입니다(정규분포의 평균 절대오차 = σ·√(2/π) ≈ 0.8σ). 발표 이후에는 ASHRAE Global Thermal Comfort Database II의 실제 투표로 바꿉니다(§1).
- 오조정률 = (시뮬레이터 PMV가 −0.5 이상인데 설정을 올린 강의실) / (조정한 강의실), 미조정률 = (PMV < −0.5이고 의견도 있는데 바꾸지 않은 강의실) / (그런 강의실).
- QR 의견은 로그인 없이 받으므로 R2(스팸)가 현실적인 위협입니다. 현재 `complaint_rooms`는 의견 2건 이상·평균 −0.8 이하이면 반복 의견으로 보고 가중을 3배로 줍니다. 기기·세션당 하루 1표 같은 제한이 필요한지 R2 결과로 판단합니다. 자유 텍스트 의견은 LLM 프롬프트에 들어가지 않고 집계값만 들어가므로, 의견을 통한 프롬프트 주입 경로는 설계상 막혀 있습니다(코드 확인: `dossier_text`).
- 의견 기반 제어의 선행 연구로 Thermovote(Erickson & Cerpa 2012) [스니펫]와 개인 쾌적 모델(Kim, Schiavon, Brager 2018) [스니펫]이 있습니다. 개인차가 크다는 리뷰(Wang et al. 2018) [스니펫]도 "한 사람의 반복 의견을 얼마나 믿을 것인가"(R2)의 배경입니다.
- NegotiationArena(Bianchi et al. 2024)는 "절박한 척"하는 전술로 협상 결과가 바뀌는 것을 보였습니다 [초록 확인]. 사용자 에이전트의 감정적 호소가 판정 결과(결정적 J)를 바꾸지 않는다는 점은 우리 설계의 강점이므로 B6 로그로 보여 줍니다.

### 3.8 사람 평가 (운영자)

- 대상: 시설 담당자 2~5명(어려우면 교직원·팀 외부 학생으로 대체하고 그렇게 표시).
- 방식: 같은 조정안에 대해 (a) 규칙 에이전트 설명과 (b) LLM 에이전트 설명을 순서를 무작위로, 출처를 가리고 보여 줍니다.
- 측정: (1) 승인·거절 판단이 시뮬레이터 기준 정답과 맞는 비율과 판단 시간, (2) 설명 만족도·신뢰 문항(Hoffman et al. 2018/2023의 설명 평가 척도) [초록 확인], (3) 화면 전체에 대해 SUS 10문항(Brooke 1996) [스니펫].
- 해석: 표본이 작으므로 통계 검정보다 사례(어떤 설명에서 판단을 틀렸는가)를 보고합니다.

### 3.9 LLM 판정관(LLM-as-judge)을 쓸 때의 함정

- 숫자 정확성에는 LLM 판정관을 쓰지 않습니다(§3.5의 결정적 매칭으로 충분).
- 설명의 명료성처럼 정답이 없는 항목에만 쓰고, 다음을 지킵니다.
  - **위치 편향**: 두 설명의 순서를 바꿔 두 번 채점하고, 결과가 다르면 무승부로 처리합니다(Zheng et al. 2023; Wang et al. 2023) [원문 확인 / 초록 확인].
  - **장황함 편향**: 긴 설명이 유리해지지 않도록 길이를 맞추거나 길이를 공변량으로 기록합니다(Zheng et al. 2023) [원문 확인].
  - **자기 선호**: 생성 모델과 같은 계열(Claude)을 판정관으로 쓰지 않습니다(Panickssery et al. 2024) [초록 확인].
  - **사람과의 일치도**: 20~30건을 사람이 함께 채점해 Cohen's κ를 보고합니다. 단순 일치율은 판정관의 관대함을 가립니다(Thakur et al. 2025) [초록 확인].
  - 협의 로그의 실패 유형 분류에는 MAST(Cemri et al. 2025)의 14개 실패 모드 중 역할 위반(FM-1.2), 상대 입력 무시(FM-2.5), 말과 행동 불일치(FM-2.6)를 씁니다 [원문 확인].

---

## 4. 오늘 밤 돌릴 최소 평가 프로토콜 (약 4시간, 외부 데이터 없이)

외부 데이터 없이 우리 시뮬레이터만으로 돌릴 수 있는 범위입니다. LLM 호출은 약 100~150회(Haiku)이고, 나머지는 결정적 계산입니다.

### 4.0 고정할 조건 (10분)

- [ ] 평가 날짜: 11/16(월)~11/20(금) 중 수업이 있는 5일의 **3차(일일) 협의** + 11/16 주의 **2차(주간) 협의** 1회. 모두 난방철입니다. 냉방철을 보여 주려면 9월 하루를 B4·B5로만 추가합니다.
- [ ] 의견: 지금 저장된 시뮬레이션 의견(`source: simulated`)을 그대로 쓰고, `fb_until`을 평가일로 고정합니다.
- [ ] 실행: `agents.negotiate(tier, d, use_ai=..., sandbox=True, ctx=ctx, fb_until=...)`. sandbox는 조정안·저장·감사 기록을 남기지 않습니다.
- [ ] `NOW_OVERRIDE`와 이상 주입 시드를 고정하고, 결과를 날짜·구성·반복 번호별 JSON으로 저장합니다.
- [ ] 계측 추가(코드 두 곳): ① `_llm_turn` 앞뒤 시간과 응답 `usage`(입력·출력 토큰), ② `_clean_proposal` 전 원시 제안. 이것이 없으면 지연·비용·원시 정책 위반을 셀 수 없습니다.

### 4.1 표 A: 학기 전략 KPI를 BOPTEST 방식으로 (30분)

- [ ] 기존 4개 전략(고정·수동·규칙·AI)에 열 추가: kWh/m², 원/m², **K·h/zone**, ppm·h/zone(CO₂ > 1,000 ppm), 15분 최대 kW(이미 15분 평균), PMV 적합률(−0.5~+0.5), 작용온도 범주 II 시간 비율, 고정 스케줄 = 1.00 비율.
- [ ] 환산 예시(우리 계산): "불쾌 지표(K·분)"는 10개 강의실·전 수업의 합계입니다(`simulate.py`). 따라서 K·h/zone = K·분 ÷ 60 ÷ 10이고, README 수치로는 고정 0.65, 수동 19.8, 규칙 6.29, AI 0.05 K·h/zone(학기 전체)입니다. BOPTEST는 2주 시험 기간 기준이라 숫자를 BOPTEST 공개 결과와 직접 비교하면 안 됩니다.

### 4.2 표 B: 협의 어블레이션 (60분, LLM 약 100회)

- [ ] 구성: B3(현재 계획) · B4(결정적 최적) · B5(규칙 에이전트) · B6(LLM, 날짜마다 5회) · B7(LLM 1라운드 + 판정, 날짜마다 3회, 시간이 남으면).
- [ ] B4 구하는 법(예시, 실행 전 검토 필요):

```python
from datetime import date
from app import agents, planning, service
ctx = service.Ctx()
ds = agents.build_dossier(3, d, ctx, fb_until=d)
hot, days = agents.complaint_rooms(ds), len(ds["dates"])
oracle = {r: {ds["key"]: min((g for g in ds["grid"][r] if g["kwh"] is not None),
                             key=lambda g: agents._room_score(ds, r, g, hot, days))["sp"]}
          for r in ds["rooms"]}
ev = planning.evaluate([date.fromisoformat(x) for x in ds["dates"]], ctx, oracle, ds["feedback"])
J = lambda prop: sum(agents._room_score(ds, r, agents._grid(ds, r, prop[r][ds["key"]]), hot, days) for r in ds["rooms"])
```

- [ ] 열: ΔkWh, Δ원, ΔPMV(의견 강의실), ΔPMV(나머지), J, regret(J − J_B4), 바뀐 강의실 수, 합의율, 턴 수, 지연 p50/p95, 토큰, 협의 1회 비용.
- [ ] 주의: 격자 값은 "모든 강의실을 같은 설정온도로 바꾼" 시뮬레이션에서 강의실별로 읽은 값입니다(`build_dossier` 주석: 강의실 간 상호작용이 작다고 가정). 실외기 용량을 나눠 쓰므로 최종안은 반드시 `planning.evaluate`로 다시 계산한 값을 표에 씁니다.

### 4.3 표 C: 에이전트 품질 (40분, 추가 LLM 호출 없음)

- [ ] 수치 근거율·환각률(§3.5), 근거 없는 숫자 전체 목록.
- [ ] 원시 정책 위반률, JSON 실패율, 규칙 에이전트 전환율.
- [ ] 메시지에 적힌 설정온도와 JSON 제안의 일치율.
- [ ] TARa@5(최종안 일치), pass^5(정책 준수 + 근거율 100% + regret ≤ 기간 요금의 1%).

### 4.4 그림 1: 쾌적 가중치 파레토 (30분, 결정적)

- [ ] `agents.COMFORT_WON` ∈ {0, 150, 300, 600, 1200, 2400, 10000}으로 바꿔 가며 B4를 5일 모두 계산합니다.
- [ ] x = 5일 합계 kWh(또는 원), y = 의견 강의실 평균 PMV 하락(또는 K·h/zone). 600원 지점과 B5·B6(5회) 점을 같은 그림에 찍습니다.

### 4.5 그림 2·표 D: 일관성과 견고성 (50분)

- [ ] 그림 2: 강의실(x)별 B6 5회의 최종 설정온도(y) 점 그림. B4 값을 가로 표시로 겹칩니다.
- [ ] 표 D: R2(스팸) · R3(상충) · R4('답답함'만) 시나리오를 B5 1회, B6 3회 실행해 오조정률·추가 kWh를 기록합니다. 주입한 의견은 평가가 끝나면 지웁니다(또는 별도 로컬 저장소에서 실행).

### 4.6 변형 시험 (20분)

- [ ] MR1(의견 단조성), MR4(정책 범위), MR5('답답함' → 설정 불변)를 규칙 에이전트로 pytest에 추가합니다. LLM은 3회씩 돌려 위반 건수만 표에 적습니다.

### 4.7 슬라이드에 올릴 숫자 (빈칸은 오늘 밤 결과로 채움)

| 슬라이드 문구 | 출처 |
|---|---|
| "AI 예측 제어: 고정 대비 전력 −55.0%, 불쾌 0.65 → 0.05 K·h/zone (학기, 시뮬레이션)" | 표 A (기존 수치 환산) |
| "LLM 협의안은 결정적 최적해 대비 목적함수 차이 중앙값 ___원(5일 × 5회)" | 표 B regret |
| "에이전트 메시지의 숫자 ___개 중 ___%가 자료·시뮬레이터 값과 일치" | 표 C |
| "같은 입력 5회 실행에서 최종 설정온도 일치 ___%, 협의 1회 ___초·___원" | 표 C, 표 B |
| "한 사람이 10번 '춥다'를 눌러도 설정 변화 ___℃, 추가 전력 ___kWh" | 표 D |

- 모든 숫자에 "시뮬레이션" 표시를 붙입니다. 결과가 나쁘게 나온 항목(예: regret이 0보다 큼)도 숨기지 않고 "판정이 막아 준 만큼"으로 설명하는 편이 심사에서 신뢰를 얻습니다.
- 발표 문장 예: "LLM은 숫자를 정하지 않습니다. 제안은 매번 시뮬레이터가 다시 계산하고, 최종 판정은 결정적 규칙이 합니다. 그래서 LLM이 틀려도 최종안은 결정적 최적해에서 ___원 이내였습니다."

## 5. 발표 이후 계획 (실측 데이터로)

### 5.1 1~2주: 공개 데이터로 방법 검증

| 순서 | 할 일 | 데이터 | 합격선 |
|---|---|---|---|
| 1 | 2R2C 식별 파이프라인을 실측 강의실 데이터에 적용 | ROBOD 강의실 2곳, SDU OU44 강의실, PLEIAData 방별 온도 + 실내기 on/off·설정온도 | 수업 1회(최대 3시간) 예측 RMSE ≤ 1 K(문헌 C4 수준), 시간별 CV(RMSE) 보고 |
| 2 | VRF 부분부하 곡선 검증 | PLEIAData 블록별 HVAC kWh (Toshiba VRF), 실외 기상 | 시간별 CV(RMSE) ≤ 30%, NMBE ±10% (Guideline 14) |
| 3 | 의견 → 설정온도 규칙 검증 | ASHRAE DB II 강의실·공조 건물 부분집합, Bologna 강의실 투표, 중국 열쾌적 데이터(하계고온·동계한랭 기후대) | 투표가 PMV보다 얼마나 어긋나는지, "춥다" 1표당 필요한 ℃ 변화 추정 |
| 4 | 재실-CO₂ 질량수지 검증 | ROBOD, SDU OU44(인원 수 + CO₂) | CO₂ 예측 RMSE(ppm) 보고 |
| 5 | 표준 시험대에서 제어 로직 시험 | BOPTEST `singlezone_commercial_hydronic`(덴마크 대학 건물, 강의실 포함) 또는 `multizone_office_simple_air`(5개 존) | BOPTEST 핵심 KPI 그대로 보고 |

### 5.2 1~3개월: 부산대 IT관 실측으로 보정

1. **자료 요청**(시설과): 중앙제어기 운전 이력(실내기 on/off, 설정온도, 실내온도, 모드), 실외기 또는 분전반 전력량(가능하면 15분·시간 단위), IT관 월별 전력 사용량(한전 청구서 또는 교내 계량기).
2. **월 단위 보정**: 건물 월 전력에는 조명·콘센트·서버가 섞여 있으므로, 월 kWh를 난방·냉방 도일(HDD/CDD)에 회귀(change-point 모델)해 날씨에 반응하는 부분을 분리한 뒤 시뮬레이터 냉난방 kWh와 비교합니다. 합격선은 월별 CV(RMSE) ≤ 15%, NMBE ±5%입니다.
3. **시간 단위 보정**: 실외기 전력이 있으면 시간별 CV(RMSE) ≤ 30%, NMBE ±10%를 목표로 강의실별 R·C와 VRF 곡선 계수를 맞춥니다. 실내온도는 G14 기준이 없으므로 RMSE(K)로 보고합니다.
4. **보정 기간과 검증 기간을 나눕니다**(예: 9~10월 보정, 11월 검증). 같은 기간으로 맞추고 검증하면 과적합을 숨깁니다.
5. **현장 A/B**: 비슷한 강의실 두 곳 또는 같은 강의실의 격주 교대로 "현재 운전 vs AI 추천 모드"를 비교하고, QR 의견 응답률·평균 투표를 함께 기록합니다. 추천 모드에서 운영자 승인률과 거절 사유를 모으면 §3.8 사람 평가가 됩니다.

### 5.3 에이전트 평가 고도화

- 반복 실행을 10회 이상으로 늘리고, 실제 QR 의견이 쌓이면 R1~R5 시나리오를 실제 투표 분포로 다시 만듭니다.
- 비용-성능 파레토(Kapoor et al. 2024): x = 협의 1회 비용·지연, y = J. 규칙 에이전트, Haiku, 상위 모델을 같은 그림에 놓고 어느 모델이 비용 대비 의미가 있는지 판단합니다.
- 협의 로그 전체를 저장해 MAST 실패 유형으로 월 1회 코딩합니다.

---

## 6. 참고문헌

### 6.1 보정 기준·쾌적 기준

1. ASHRAE Guideline 14-2014, *Measurement of Energy, Demand, and Water Savings*(14-2023으로 대체됨). 원문 미열람 [2차 출처]
2. Mosteiro-Romero, Miller, Chong, Stouffs, "Elastic buildings: Calibrated district-scale simulation of occupant-flexible campus operation for hybrid work optimization", arXiv:2210.06124. https://arxiv.org/abs/2210.06124 [원문 확인]
3. "Digital Twin-Based Cooling System Optimization for Data Center", arXiv:2603.01198 (G14-2014 대체 사실, p = 1 적용). https://arxiv.org/abs/2603.01198 [원문 확인]
4. Ramos Ruiz, Fernández Bandera, "Validation of Calibrated Energy Models: Common Errors", *Energies* 10(10):1587 (2017). https://doi.org/10.3390/en10101587 [초록 확인]
5. Garrett, New, "Suitability of ASHRAE Guideline 14 Metrics for Calibration", ASHRAE Winter Conference 2016. https://web.eecs.utk.edu/~jnew1/publications/2016_ASHRAE_G14.pdf [원문 확인]
6. LEEDuser 포럼(Guideline 14-2002 문구 인용). https://leeduser.buildinggreen.com/node/47961 [2차 출처]
7. Olesen, "European Standardisation on Thermal Environment", *REHVA Journal* 06/2024(EN 16798-1 범주 표). https://www.rehva.eu/rehva-journal/chapter/european-standardisation-on-thermal-environment [원문 확인]
8. pythermalcomfort 문서(ASHRAE 55-2023 PMV 허용 범위, Tartarini & Schiavon 2025 인용). https://pythermalcomfort.readthedocs.io/en/latest/documentation/models.html [원문 확인]
9. Cheung, Schiavon, Parkinson, Li, Brager, "Analysis of the accuracy on PMV–PPD model using the ASHRAE Global Thermal Comfort Database II", *Building and Environment* 153:205–217 (2019). https://doi.org/10.1016/j.buildenv.2019.01.055 [초록 확인]

### 6.2 데이터셋

10. Ibarra, González-Vidal, Skarmeta, PLEIAData, *Scientific Data* 10:118 (2023). https://doi.org/10.1038/s41597-023-02023-3 · https://doi.org/10.5281/zenodo.7620136 [원문 확인]
11. Földváry Ličina et al., ASHRAE Global Thermal Comfort Database II, *Building and Environment* 142:502–512 (2018). https://doi.org/10.1016/j.buildenv.2018.06.022 · https://doi.org/10.6078/D1F671 [원문 확인]
12. Tumedei, Ceccarini, Delnevo, Prandi, Bologna Cesena smart campus comfort data, *Data* 11(2):31 (2026). https://doi.org/10.3390/data11020031 · https://doi.org/10.5281/zenodo.18016442 [초록 확인 / 데이터 원문 확인]
13. Tekler, Ono, Peng, Zhan, Lasternas, Chong, ROBOD, *Building Simulation* 15:2127–2137 (2022). https://doi.org/10.1007/s12273-022-0925-9 · https://doi.org/10.6084/m9.figshare.19234530 [원문 확인]
14. Schwee et al., SDU OU44, *Scientific Data* 6:287 (2019). https://doi.org/10.1038/s41597-019-0274-4 [원문 확인]
15. Luo, Wang, Blum, Weyandt, Bourassa, Piette, Hong, LBNL Building 59, *Scientific Data* 9:156 (2022). https://doi.org/10.1038/s41597-022-01257-x · https://doi.org/10.7941/D1N33Q [원문 확인]
16. Pipattanasomporn et al., CU-BEMS, *Scientific Data* 7:241 (2020). https://doi.org/10.1038/s41597-020-00582-3 [원문 확인]
17. Miller et al., Building Data Genome Project 2, *Scientific Data* 7:368 (2020). https://doi.org/10.1038/s41597-020-00712-x [원문 확인]
18. Miller et al., ASHRAE Great Energy Predictor III, *Science and Technology for the Built Environment* 26(10):1427–1447 (2020). https://doi.org/10.1080/23744731.2020.1795514 [원문 확인]
19. Yang et al., Chinese thermal comfort dataset, *Scientific Data* 10:662 (2023). https://doi.org/10.1038/s41597-023-02568-3 [원문 확인]
20. Rashid, Singh, Singh, I-BLEND, *Scientific Data* 6:190015 (2019). https://doi.org/10.6084/m9.figshare.c.3893581 [원문 확인]
21. Candanedo, Feldheim, UCI Occupancy Detection, *Energy and Buildings* 112:28–39 (2016). https://doi.org/10.24432/C5X01N [원문 확인]
22. ecobee Donate Your Data. https://www.ecobee.com/en-us/donate-your-data/ · 부분집합 https://doi.org/10.25584/ecobee/1854924 [원문 확인]
23. Barker et al., Smart*, SustKDD 2012. https://traces.cs.umass.edu/docs/traces/smartstar/ [원문 확인]
24. 국토교통부 건축HUB 건물에너지정보 서비스. https://www.data.go.kr/data/15135963/openapi.do [원문 확인]
25. 한국전력공사 전력데이터 개방포털. https://bigdata.kepco.co.kr [원문 확인]
26. 한국전력공사 KBEMS 월별 소비전력량. https://www.data.go.kr/data/15131467/fileData.do [원문 확인]
27. 온실가스종합정보센터 명세서 주요정보. https://www.gir.go.kr/home/index.do?menuId=37 [원문 확인]
28. DACON 전력사용량 예측 AI 경진대회(2023, 2025). https://dacon.io [2차 출처]
29. 기상청 ASOS 시간자료 조회서비스. https://www.data.go.kr/data/15057210/openapi.do [원문 확인]

### 6.3 벤치마크·시험대

30. Blum et al., "Building optimization testing framework (BOPTEST) for simulation-based benchmarking of control strategies in buildings", *JBPS* 14(5):586–610 (2021). https://doi.org/10.1080/19401493.2021.1986574 [초록 확인] · KPI 문서 https://ibpsa.github.io/project1-boptest/docs-design/core_kpi.html [원문 확인]
31. Arroyo, Manna, Spiessens, Helsen, BOPTEST-Gym, Proc. Building Simulation 2021. https://github.com/ibpsa/project1-boptest-gym [원문 확인]
32. Vázquez-Canteli, Kämpf, Henze, Nagy, CityLearn, BuildSys '19. https://doi.org/10.1145/3360322.3360998 · Nweye et al., *JBPS* (2024). https://doi.org/10.1080/19401493.2024.2418813 [초록 확인] · https://github.com/citylearn-project/CityLearn [원문 확인]
33. Campoy-Nieves et al., Sinergym, *Energy and Buildings* 327:115075 (2025). https://doi.org/10.1016/j.enbuild.2024.115075 · https://github.com/ugr-sail/sinergym [원문 확인]
34. EnergyPlus testfiles(VRF 예제). https://github.com/NatLabRockies/EnergyPlus [원문 확인]
35. DOE Commercial Reference Buildings. https://www.energy.gov/eere/buildings/commercial-reference-buildings · PNNL Prototype Building Models https://www.energycodes.gov/prototype-building-models [원문 확인]
36. End-Use Load Profiles / ComStock, OEDI 4520. https://data.openei.org/submissions/4520 · Wilson et al. (2022) https://doi.org/10.2172/1854582 [원문 확인]
37. Emami, Sahu, Graf, BuildingsBench, NeurIPS 2023 Datasets & Benchmarks, arXiv:2307.00142. https://github.com/NatLabRockies/BuildingsBench [원문 확인]
38. Wetter, Zuo, Nouidui, Pang, Modelica Buildings Library, *JBPS* 7(4):253–270 (2014). https://github.com/lbl-srg/modelica-buildings [원문 확인]
39. Marzullo, Dey, Long, Leiva Vilaplana, Henze, ACTB, *JBPS* 15(3):379–397 (2022). https://doi.org/10.1080/19401493.2022.2058091 [초록 확인]

### 6.4 LLM 에이전트 평가

40. Kapoor, Stroebl, Siegel, Nadgir, Narayanan, "AI Agents That Matter", arXiv:2407.01502 (2024). [원문 확인]
41. Yao, Shinn, Razavi, Narasimhan, "τ-bench", arXiv:2406.12045 (2024). [원문 확인]
42. Kapoor et al., "Holistic Agent Leaderboard", arXiv:2510.11977 (2025). [초록 확인]
43. Liu et al., "AgentBench", arXiv:2308.03688 (ICLR 2024). [초록 확인]
44. Yehudai et al., "Survey on Evaluation of LLM-based Agents", arXiv:2503.16416 (2025). [초록 확인]
45. Mohammadi, Li, Lo, Yip, "Evaluation and Benchmarking of LLM Agents: A Survey", arXiv:2507.21504 (2025). [초록 확인]
46. Bianchi et al., "How Well Can LLMs Negotiate? NegotiationArena", arXiv:2402.05863 (2024). [초록 확인]
47. Abdelnabi, Gomaa, Sivaprasad, Schönherr, Fritz, "Cooperation, Competition, and Maliciousness: LLM-Stakeholders Interactive Negotiation", arXiv:2309.17234. [원문 확인]
48. Zhu et al., "MultiAgentBench", arXiv:2503.01935 (2025). [초록 확인]
49. Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST), arXiv:2503.13657 (2025). [원문 확인]
50. Du, Li, Torralba, Tenenbaum, Mordatch, "Improving Factuality and Reasoning in Language Models through Multiagent Debate", arXiv:2305.14325. [초록 확인]
51. Smit et al., "Should we be going MAD? A Look at Multi-Agent Debate Strategies for LLMs", arXiv:2311.17371. [초록 확인]
52. Choi, Zhu, Li, "Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?", arXiv:2508.17536 (2025). [초록 확인]
53. Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", arXiv:2306.05685 (NeurIPS 2023 D&B). [원문 확인]
54. Wang et al., "Large Language Models are not Fair Evaluators", arXiv:2305.17926. [초록 확인]
55. Panickssery, Bowman, Feng, "LLM Evaluators Recognize and Favor Their Own Generations", arXiv:2404.13076. [초록 확인]
56. Shi et al., "Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge", arXiv:2406.07791. [초록 확인]
57. Thakur et al., "Judging the Judges: Evaluating Alignment and Vulnerabilities in LLMs-as-Judges", arXiv:2406.12624. [초록 확인]
58. Gu et al., "A Survey on LLM-as-a-Judge", arXiv:2411.15594. [초록 확인]
59. Min et al., "FActScore", arXiv:2305.14251 (EMNLP 2023). [초록 확인]
60. Es, James, Espinosa-Anke, Schockaert, "Ragas: Automated Evaluation of Retrieval Augmented Generation", arXiv:2309.15217. [초록 확인]
61. Chern et al., "FacTool: Factuality Detection in Generative AI", arXiv:2307.13528. [초록 확인]
62. Sethi et al., "Fabrication After Tool Failure: Tool-Augmented Agents Assert Values Their Tools Did Not Return", arXiv:2609.14758 (2026). [초록 확인]
63. Hoang, "Structured Hallucination in Tool-Using Agents", ICML 2026 Agents in the Wild 워크숍. https://icml.cc/virtual/2026/67945 [초록 확인]
64. Atil et al., "Non-Determinism of 'Deterministic' LLM Settings", arXiv:2408.04667. [원문 확인]
65. Hoffman, Mueller, Klein, Litman, "Metrics for Explainable AI: Challenges and Prospects", arXiv:1812.04608 (2018) · 개정판 *Frontiers in Computer Science* 5 (2023), https://doi.org/10.3389/fcomp.2023.1096257 [초록 확인]
66. Brooke, "SUS: A 'Quick and Dirty' Usability Scale" (1996). [스니펫]
67. Erickson, Cerpa, "Thermovote", BuildSys 2012, https://doi.org/10.1145/2422531.2422534 [스니펫] · Kim, Schiavon, Brager, "Personal comfort models", *Building and Environment* 132:114–124 (2018) [스니펫] · Wang, de Dear et al., "Individual difference in thermal comfort: A literature review", *Building and Environment* 138:181–193 (2018) [스니펫]

### 6.5 LLM과 HVAC

68. Neubauer, Hong et al., "Large Language Models for HVAC Operations in Building Energy Systems: A Critical Review", arXiv:2609.05314 (2026). [초록 확인]
69. Xin, Liang, Chong, "Causality-constrained hierarchical LLM agents for online rule adaptation in building HVAC control", *Applied Energy* 427 (2026). https://doi.org/10.1016/j.apenergy.2026.129012 [초록 확인]
70. Bhatt, Lin, Amos, Salim, Hu, ThermoLLM, arXiv:2606.22911 (2026). [초록 확인]
71. Rui Wang, DRBENCH, SSRN (2026). https://doi.org/10.2139/ssrn.7447344 [초록 확인]
72. Sawada et al., "Office-in-the-Loop", *Data-Centric Engineering* 6 (2025). https://doi.org/10.1017/dce.2025.10010 [초록 확인]
73. Sasaki et al., LLM 재실자 에이전트 평가 틀, BuildSys 2025. https://doi.org/10.1145/3736425.3772325 [스니펫]
74. Song, Zhang, Zhao, Bian, arXiv:2308.03028 · Ahn, Kim, Cho, Chae, *Buildings* 13:2680 (2023) · He & Jazizadeh, arXiv:2512.25055 (2025): literature_review.md F2~F5 참고.

### 6.6 확인하지 못했거나 주의할 항목

- Guideline 14-2023판의 기준값 변경 여부, IPMVP·FEMP의 정확한 기준값(조사에서 일관된 원문을 찾지 못해 이 문서에 넣지 않았습니다).
- ISO 7730의 A/B/C 범주 표(2025년 개정판이 나왔다는 검색 결과만 있음 [스니펫]). 이 문서는 EN 16798-1 범주(REHVA 2024 표)로 대신했습니다.
- Kaggle GEPIII 데이터 이용 조건, DACON 대회 데이터 재사용 조건, 중국 열쾌적 데이터 라이선스, ecobee 부분집합 이용 조건.
- 건축HUB API에서 '산' 지번 조회 가능 여부, 부산대 IT관의 지번.
- ASU Campus Metabolism, UC Berkeley·Glasgow 캠퍼스 데이터, BTS(Building TimeSeries)는 확인하지 못해 표에서 뺐습니다.
