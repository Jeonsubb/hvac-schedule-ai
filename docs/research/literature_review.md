# 문헌 조사: 시간표 기반 HVAC 자동운전 AI (부산대 IT관, 강의실 10실)

- 작성일: 2026-11-19 (발표 2026-11-21)
- 범위: A~H 8개 주제, 2020~2026 문헌을 우선했고 기준 문헌(seminal)은 일부 포함
- 검증 표기 (모든 인용에 붙임)
  - **[원문 확인]**: 본문 PDF, 공식 페이지 또는 소스코드를 직접 열어 수치를 확인함
  - **[초록 확인]**: 출판사, 저장소 또는 서지 페이지의 초록과 서지 정보만 확인함
  - **[2차 출처]**: 언론 기사나 다른 문헌의 인용으로만 확인함 (원 공문은 열지 못함)
  - **[스니펫]**: 검색 결과 요약문으로만 확인함 (발표에서 단독 근거로 쓰지 말 것)
- 표에서 "우리 계산"이라고 쓴 값은 문헌 계수를 넣어 직접 계산한 값이며, 논문이 보고한 값이 아니다.

---

## 0. 한눈에 보는 핵심 숫자

| 주제 | 핵심 수치 | 출처 | 검증 |
|---|---|---|---|
| 국내 강의실 EHP를 시간표로 제어 | 제어한 강의실이 제어하지 않은 강의실보다 에너지 **30~60%** 적게 사용 | 정기범 2014 | 초록 확인 |
| 시간표 연동 제어 (Penn State) | 300개 실의 장비 가동시간 **60%** 감소, 일부 실은 80% | Penn State 2019 | 원문 확인 |
| 학습형 최적 기동·정지 | 연간 HVAC 에너지 **6.5~7.6%** 절감 (급기 ramp-up을 더하면 **9.7%**), 쾌적 달성일 97~99% | Park & Kim 2024 | 초록 확인 |
| 데이터 기반 optimal start (실증) | 소형 공조기(RTU) 1대당 하루 **2~5 kWh** 절감, 월요일 예측이 가장 나쁨 | Kim et al. 2024 | 초록 확인 |
| 에너지를 목적함수에 넣은 강의 시간표 | **4%** 절감, hard constraint를 완화하면 최대 **5.0%** | Song et al. 2017 | 초록 확인 |
| 실제 강의실 배정 ILP (브라질) | 수작업 배정 대비 최대 **26%** 절감 | Alves et al. 2022 | 초록 확인 |
| HVAC를 고려한 스케줄링 (MILP) | 실 수·공백 최소화 휴리스틱으로 배정하면 배정+공조 공동 최적해보다 에너지 **46%** 더 사용 | Lim et al. 2015 | 원문 확인 |
| VRF MPC + 피크전력 제약 | 전력 30% 제약에서 최대 **16%** 절감, 평균 온도편차 2°C 미만 | Thu et al. 2025 | 원문 확인 |
| LLM이 HVAC를 직접 제어 | ChatGPT 16.8% vs DQN 24.1% 절감 | Ahn et al. 2023 | 초록 확인 |
| LLM-HVAC 논문 66편 리뷰 | 파일럿 수준 4편, 지속 운영 배포 **0편** | Neubauer et al. 2026 | 초록 확인 |
| 국가 전력배출계수 (2023년도) | **0.4173 tCO2eq/MWh** (이전 2020~2022 평균 0.4541) | 쿠키뉴스 2025-12-18 (기후에너지환경부 발표 인용) | 2차 출처 |
| 공공기관 여름철 실내온도 (2025) | 평상시 **26°C**, 전력수급 위기 시 28°C | 산업부 보도자료 2025-06-26 | 원문 확인 |

---

## A. 최적 기동·정지(Optimal start/stop)와 사전 공조 시간 예측

### A1. Kim, Yu, Lutes, Katipamula (2024): 데이터 기반 optimal start 실증
- **제목**: Implementation and validation of optimal start control strategy for air conditioners and heat pumps
- **저자/학술지**: Woohyun Kim et al. (PNNL), *Applied Thermal Engineering* 257 (Part A), 124256, 2024
- **링크**: https://doi.org/10.1016/j.applthermaleng.2024.124256 · OSTI https://www.osti.gov/biblio/2440867 **[초록 확인]**
- **핵심 결과**
  - 소형 상업건물의 RTU(옥상형 공조기)는 보통 재실 60~120분 전에 고정 스케줄로 켜진다.
  - 센서를 최소로 쓰는 데이터 기반 optimal start 모델 4종을 2개 건물에서 냉방기와 난방기에 번갈아 적용했다.
  - 네 모델 모두 RTU 1대당 하루 **2~5 kWh**를 절감했고, 난방기의 절감이 냉방기보다 컸다.
  - 네 모델 모두 **월요일에 기동 시간을 짧게 예측**해 오차가 컸다. 저자들은 주말·휴일 다음 날에 쓸 별도 모델을 향후 과제로 제시했다.
- **적용 방법**
  - 예측 모델 입력에 `idle_hours_before`(직전 비가동 시간)와 `is_first_after_holiday` 피처를 넣는다.
  - 일요일을 쉬고 맞는 월요일 1교시, 그리고 추석 연휴 직후에는 lead time을 별도로 보정한다. 질량 노드 온도가 더 많이 떨어진 상태이므로, 아래 C의 RC 모델에서 초기 `T_e`를 낮게 두면 자연스럽게 반영된다.
  - 발표 포인트: 고정 10분 lead(규칙 기반)는 월요일 아침과 한파 아침에 쾌적 미달을 낸다. 날씨와 직전 비가동 시간을 반영한 예측형 기동이 필요하다는 근거로 쓴다.

### A2. Seem, House, Alcala (2016): 복귀 시간(return time) 모델 선택
- **제목**: Model Selection for Predicting the Return Time from Night Setback
- **학회**: International High Performance Buildings Conference (Purdue), 2016, paper 231
- **링크**: https://docs.lib.purdue.edu/ihpbc/231 **[초록 확인]**
- **관련 특허**: US9739496 "Systems and methods for estimating a return time" https://patents.google.com/patent/US9739496 **[원문 일부 확인, 수식 렌더링 깨짐]**
- **핵심 결과**
  - 후보 모델 57개를 시뮬레이션 데이터(냉방 140세트, 난방 104세트)로 비교했다.
  - 가장 좋은 모델은 **실온 변화량(T_f − T_i)**과 **냉난방 요구량의 지수가중이동평균(EWMA, u)**을 쓰는 2-파라미터 모델이었다. 최소제곱으로 적합했다.
  - **외기온도는 최적 모델에 들어가지 않았다.** 외기의 영향이 냉난방 요구량 EWMA에 이미 담겨 있기 때문으로 보인다.
- **특허에서 확인한 구현 요소**
  - EWMA 갱신: `ū_t = ū_{t−1} + α·(u_t/u_max − ū_{t−1})`, α는 약 0.05. 비재실 상태로 바뀔 때 0으로 초기화한다.
  - 가중치는 지수가중 정규화 최소제곱(EWRLS)으로 갱신하고, 음수가 되지 않게 제약한다.
  - 난방 모델은 (설정온도 − 실온)의 **세제곱 항**을 쓴다.
  - 실제 기동은 `τ_start = τ̂ + n·σ̂`처럼 예측 오차의 표준편차만큼 여유를 더한다. n이 크면 쾌적 달성 확률이 오르는 대신 에너지가 는다.
- **적용 방법 (우리 구현안)**
  - 실별로 `τ̂ = w1·ΔT + w2·ΔT·ū` (냉방), `τ̂ = w1·ΔT³ + w2·ū` (난방)을 RLS(forgetting factor 0.98)로 온라인 학습한다.
  - 정확한 함수형은 특허 원문 수식이 깨져 있어 확인하지 못했다. 이 식은 논문의 구조에서 착안한 우리 설계다.
  - 시뮬레이터에서는 RC 모델(A4)의 결과를 "실측"으로 삼아 학습 곡선을 보여 줄 수 있다. 예: "운영 2주 후 기동 시간 오차가 X분에서 Y분으로 감소".

### A3. Park & Kim (2024): Random Forest 반복학습 기동·정지
- **제목**: Supervised learning based iterative learning control platform for optimal HVAC start-stop in a real building context
- **저자/학술지**: Moonki Park, Sean Hay Kim (서울과기대), *Case Studies in Thermal Engineering* 61, 105055, 2024
- **링크**: https://doi.org/10.1016/j.csite.2024.105055 · https://pure.seoultech.ac.kr/en/publications/supervised-learning-based-iterative-learning-control-platform-for/ **[초록 확인]**
- **핵심 결과**
  - Random Forest로 기동·정지 시각을 정하고, 매일 전날의 오차로 학습 라벨을 조정한다(iterative learning). 최근 이력만 쓰므로 RL처럼 긴 탐색이 필요 없다.
  - 실측으로 보정한 TRNSYS 모델로 검증했다. 기존 방식 대비 연간 HVAC 에너지를 **6.5~7.6%** 절감했고, 운영일의 **97~98%**에서 쾌적을 달성했다.
  - 급기 풍량 ramp-up과 optimal start를 결합하면 쾌적 달성일이 **최대 99%**, 절감이 **9.7%**였다.
- **적용 방법**
  - "AI 최적화" 전략에 일일 오차 보정 루프를 넣는다: `lead[d+1] = model(features) + β·err[d]` (β≈0.5).
  - 정지 측(early-off)에도 같은 방식을 적용한다. 수업 종료 시점의 실온이 허용 밴드 안쪽에 여유가 있으면 다음 날 off를 1슬롯 앞당긴다.
  - 발표에서 "AI 절감률 목표 6~10%"를 말할 때 이 논문을 근거로 쓰면 보수적이다.

### A4. 우리 구현: RC 모델 기반 기동·정지 (물리식, 약 1시간)
1R1C에서 외기와 투입열이 일정하다고 가정하면 다음 식이 성립한다(교과서적 1차계 해).
- 투입열 Q: 냉방은 음수, 실외기 성능곡선(D1)에서 얻는 가용 용량을 쓴다.
- `T(t) = T∞ + (T0 − T∞)·e^(−t/τ)`, 여기서 `τ = R·C`, `T∞ = T_out + Q·R`
- **사전 공조 시간**: `t_pre = τ · ln((T0 − T∞) / (T_set − T∞))`. T_set이 T0와 T∞ 사이에 있어야 하며, 그렇지 않으면 용량 부족이다.
- **관성 운전(coasting) 가능 시간**: off 후 `T∞_off = T_out + Q_internal·R`로 수렴하므로 `t_coast = τ · ln((T_lim − T∞_off) / (T_now − T∞_off))`

2R2C에서는 닫힌 해 대신 아래처럼 **예보를 넣은 전방 시뮬레이션과 이분 탐색**을 권장한다(코드는 C절 참고).
```python
def optimal_start(room, t_lecture, forecast, band=(T_lo, T_hi), max_lead_min=120, step=5):
    # 가장 늦게 켜도 t_lecture에 밴드 안에 들어오는 시각을 찾는다
    lo, hi = 0, max_lead_min          # lead(분), 단조성 가정
    while hi - lo > step:
        mid = (lo + hi) // 2
        T_i = simulate(room, start=t_lecture - mid, until=t_lecture, forecast=forecast, hvac_on_after_start=True)
        if band[0] <= T_i <= band[1]: hi = mid
        else: lo = mid
    return t_lecture - (hi + room.margin_min)   # margin = n·σ (A2)
```
- **용량 제한을 꼭 반영한다**: 겨울 아침 외기 습구 −5°C에서 난방 용량은 정격의 약 80%다(D1 표). 같은 층 여러 실이 동시에 기동하면 실외기 PLR이 1에 걸린다. 그러면 다른 실을 먼저 켜는 **staggered start**가 필요하다. 이것이 실외기 staging 기능의 근거가 된다.

---

## B. 대학 강의실·캠퍼스의 시간표·재실 기반 HVAC 제어

### B1. 정기범 (2014): 대학 강의실 EHP 시간표 제어 (국내, 가장 직접적인 근거)
- **제목**: 대학교 강의실 EHP 제어를 이용한 에너지 절약 시스템 (Energy Saving System of EHP Control at the College Lecture Room)
- **학술지**: 대한안전경영과학회지 16(2), 167–174, 2014
- **링크**: https://doi.org/10.12812/ksms.2014.16.2.167 · https://koreascience.kr/article/JAKO201421154208693.pub **[초록 확인]**
- **핵심 결과**
  - 국내 학교의 개별식 EHP는 빈 강의실에서도 켜져 있어 낭비가 생긴다.
  - 중앙 통제실의 수업 시간표로 비사용 강의실의 EHP 공급을 차단했다.
  - 제어한 강의실은 제어하지 않은 강의실보다 에너지를 **30~60%** 적게 썼고, 쾌적성도 함께 측정했다.
- **적용 방법**: Baseline(고정 스케줄) 대비 Rule-based의 절감률을 이 범위와 비교해 시뮬레이터 타당성을 확인한다. 우리 값이 30~60% 범위 근처면 "국내 실측 연구와 일치"라고 말할 수 있다. 단, 2014년 연구이고 설비와 운영 조건이 다르다.

### B2. Penn State Events2HVAC (2019, 운영 사례)
- **링크**: https://www.psu.edu/news/campus-life/story/software-and-scheduling-combine-improve-hvac-efficiency-penn-state **[원문 확인]**, 프로그램 페이지 https://fas.psu.edu/who-we-are/enterprise-utility-management-system/events2hvac-program **[원문 확인]**
- **핵심 결과**
  - 실 예약(25Live) 데이터로 HVAC를 재실/비재실 모드로 전환한다. 재실 전에 목표 온도에 도달하도록 **lead-in time**을 둔다.
  - 300개 실의 장비 가동시간이 **60%** 줄었고, 일부 실은 **80%** 줄었다.
  - 2018년 2월 42개 실로 시작해 475개 공간에 적용했고, 목표는 약 1,800개다.
- **주의**: 가동시간 감소는 에너지 감소와 같지 않다. 기사도 에너지(kWh)와 금액은 정량화하지 않았다.
- **적용 방법**: KPI에 "실내기 가동시간(h)"과 "에너지(kWh)"를 **따로 표시**한다. 가동시간이 크게 줄어도 에너지는 덜 줄어드는 이유(기동 부하, 실외기 부분부하 효율)를 시뮬레이터로 설명하면 설득력이 크다.

### B3. Ye et al. (2021): 초등학교 재실 기반 제어(OCC)의 전국 절감 잠재량
- **제목**: Energy-saving potential evaluation for primary schools with occupant-centric controls
- **저자/학술지**: Yunyang Ye, Yan Chen, Jian Zhang, Zhihong Pang, Zheng O'Neill, Bing Dong, Hwakong Cheng, *Applied Energy* 293, 2021
- **링크**: https://doi.org/10.1016/j.apenergy.2021.116854 · https://ideas.repec.org/a/eee/appene/v293y2021ics0306261921003469.html **[초록 확인]**
- **핵심 결과**: 미국 16개 기후대, 2개 에너지 코드 버전, OCC 적용 여부를 조합한 건물 에너지 모델 96개로 비교했다. 재실 감지 기반 OCC는 최대 **10.2%**, 재실 인원 계수 기반 OCC는 최대 **12.41%** 절감했고, 기후와 코드에 따라 범위는 **1.79~12.41%**였다.
- **적용 방법**: 인원 비례 환기와 부하(occupancy-scaled)의 효과는 "수 % ~ 10%대"로 보수적으로 제시한다. 우리 시뮬레이터에서 출석률(예: 수강인원의 70%)을 파라미터로 둔다.

### B4. Pang et al. (2020): 사무소 OCC의 전국 절감 잠재량
- **제목**: Nationwide HVAC energy-saving potential quantification for office buildings with occupant-centric controls in various climates
- **학술지**: *Applied Energy* 279, 115727, 2020
- **링크**: https://doi.org/10.1016/j.apenergy.2020.115727 · https://www.pnnl.gov/publications/nationwide-hvac-energy-saving-potential-quantification-office-buildings-occupant **[초록 확인]**
- **핵심 결과**
  - 재실 감지 센서는 비재실 구역의 설정온도와 환기량을 함께 재설정할 수 있어 효과가 컸다. 인원 계수 센서의 추가 이득은 작았다.
  - **난방이 지배적인 기후에서 절감이 더 컸다.** 최소 외기량 재설정이 난방 모드에서 더 많은 에너지를 줄이기 때문이다.
- **적용 방법**: 비재실 슬롯에서는 실내기를 끄는 것만이 아니라 **외기 도입(환기)도 차단**하는 옵션을 둔다. 겨울(11~12월) 결과에서 절감 기여를 분해해 보여 준다.

---

## C. Grey-box RC 열모델 (1R1C / 2R2C / 3R2C)

### C1. Bacher & Madsen (2011): 모델 차수 선택 절차 (기준 문헌)
- **제목**: Identifying suitable models for the heat dynamics of buildings
- **학술지**: *Energy and Buildings* 43(7), 1511–1522, 2011
- **링크**: https://doi.org/10.1016/j.enbuild.2011.02.005 · https://orbit.dtu.dk/en/publications/identifying-suitable-models-for-the-heat-dynamics-of-buildings/ **[서지 확인, 파라미터 표는 접근 실패]**
- **핵심 내용**: 가장 단순한 모델(Ti)부터 시작해 상태를 하나씩 추가하는 forward selection을 쓴다. 상태 후보는 Te(외피), Th(난방기), Ts(센서), Tm(내부질량)이며, 우도비 검정으로 더 복잡한 모델이 유의하게 나은지 판단한다. 결과적으로 열전도, 부위별 열용량, 유효 창면적 같은 건물 특성을 추정한다.
- **적용 방법**: 1R1C → 2R2C(TiTe) → 3R2C(창·환기 직결 경로 추가) 순서로 적합한다. 검증 RMSE가 0.1 K 이상 개선될 때만 차수를 올린다(우리 기준).

### C2. Brastein et al. (2018): 식별된 파라미터를 과신하지 말 것
- **제목**: Parameter estimation for grey-box models of building thermal behaviour
- **저자/학술지**: O. M. Brastein, D. W. U. Perera, C. Pfeifer, N.-O. Skeie, *Energy and Buildings* 169, 58–68, 2018
- **링크**: https://openarchive.usn.no/usn-xmlui/handle/11250/2631860 **[초록 확인]** (DOI는 확인하지 못해 적지 않음)
- **핵심 결과**: 초기값을 무작위로 바꾸는 Monte Carlo 실험에서 추정 파라미터가 넓게 흩어졌다. 그런데도 독립 데이터에 대한 예측 성능은 좋았다. 파라미터를 물리적으로 해석하려면 초기값과 데이터셋에 상관없이 수렴해야 한다.
- **적용 방법**: 식별은 **다중 초기값(예: 20회) + 물리적 상하한**으로 하고, 가장 좋은 해와 함께 해의 분산을 보고한다. 발표에서 "R, C 값 자체보다 예측 성능(RMSE)으로 검증했다"고 말한다.

### C3. ISO 13790 5R1C 계수 (Modelica Buildings 라이브러리 문서로 확인)
- **링크**: https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_ThermalZones_ISO13790_Data.html · https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_ThermalZones_ISO13790_Zone5R1C.html **[원문 확인]**
- **확인한 값**
  - 바닥면적당 내부 열용량 C_m: Light **110,000**, Medium **165,000**, Heavy **260,000 J/(K·m²)**
  - 유효 질량면적 계수 f_ms: Light와 Medium 2.5, Heavy 3
  - 실내공기-표면 결합 h_is = **3.45 W/(m²K)** × 실 내표면 총면적 A_tot
  - 표면-질량 결합 h_ms = **9.1 W/(m²K)** × f_ms × A_f
  - 내부발열의 50%는 공기 노드에, 나머지는 면적비에 따라 표면과 질량 노드에 배분한다.
- **적용 방법: 2R2C 초기값(prior)**. 아래는 **우리 계산**이다. 바닥 100 m², 층고 3 m, 철근콘크리트 Medium, 외벽 1면을 가정했다.

| 파라미터 | 계산식 | 100 m² 예시 |
|---|---|---|
| C_i (공기+가구) | 1.2·1005·V·k_f, k_f(가구 보정)=3~5 가정 후 식별 | 0.36 MJ/K × k_f = **1.1~1.8 MJ/K** |
| C_e (구조체 질량) | 165,000·A_f | **16.5 MJ/K** |
| R_ie (공기↔질량) | 1/[(h_is·A_tot)⁻¹ + (h_ms·2.5·A_f)⁻¹]⁻¹, A_tot≈3.2·A_f | H=743 W/K → **R_ie ≈ 1.35×10⁻³ K/W** |
| R_ia (공기↔외기: 창+침기+환기) | 1/(U_w·A_w + ρc_p·Q_inf + ρc_p·Q_vent) | 침기 0.5 ACH = 50 W/K, 환기는 1인당 10 m³/h당 3.35 W/K 추가 |
| R_ea (질량↔외기: 불투명 외피) | 1/(U_wall·A_wall) | 설계도서나 에너지절약계획서의 U값 사용 |
| 시정수 | 공기 τ_i ≈ C_i/(H_ie+H_ia), 질량 τ_e ≈ C_e/(H_ie+H_ea) | 공기 **약 20~40분**, 질량 **약 6시간** |

  - 해석: 공기는 20~40분이면 설정온도에 도달한다. 구조체는 수 시간 동안 부하를 빨아들이므로, 기동 직후 실내기가 최대 용량으로 도는 시간이 길어진다. 반대로 off 후에는 공기가 질량 온도 쪽으로 빠르게 되돌아가 **관성 운전이 10~20분 수준**으로 제한될 것으로 예상한다(우리 추정이며 식별로 확인할 것).
  - 실 유형별 내부발열: 재실자 현열 **75 W/인**(Lim et al. 2015가 쓴 값, E3), PC 실습실은 PC당 발열을 별도 입력한다(카탈로그 값 사용, 문헌 값은 미확인).

### C4. Raisch et al. (2026, arXiv): 2R2C 식별 정확도의 현실적 기대치
- **제목**: Transfer Learning for Neural Parameter Estimation applied to Building RC Models
- **저자**: Fabian Raisch, Timo Germann, J. Nathan Kutz, Christoph Goebel, Benjamin Tischler, arXiv:2604.05904, 2026-04-07
- **링크**: https://arxiv.org/abs/2604.05904 **[원문 확인]**
- **핵심 결과**
  - 2R2C는 숨은 외피온도 T_e를 둔 2개 ODE이며, 추정 파라미터는 R_ie, R_ea, C_i, C_e, A_eff(유효 일사면적) 5개다.
  - 72일 학습 기준 RMSE: 사전학습 추정기 **0.584 K**, 처음부터 학습 0.623 K. 유전 알고리즘(GA)의 최고 성능은 24일 학습에서 1.153 K였다.
  - 초기 파라미터 범위는 Harb et al.(2016, E&B 117)을 따랐다.
- **적용 방법**: 우리 식별 목표는 1-step이 아니라 **수업 1회(최대 3시간) 예측 RMSE 1 K 이하**로 잡는다. 이는 이 논문 수준과 비슷하다. 데이터가 없으면 EnergyPlus나 우리 고해상도 모델로 만든 합성 데이터로 식별 파이프라인을 시연한다.

### C5. 구현 코드 골격 (2R2C, 1분 Euler, scipy 식별)
```python
import numpy as np
from scipy.optimize import least_squares
RHO_CP = 1.2 * 1005.0

def step_2r2c(Ti, Te, To, Q_hvac, Q_int, Q_sol, p, dt=60.0):
    """p = dict(Ci, Ce, Rie, Ria, Rea, a_sol). Q_hvac: + 난방, - 냉방 [W]"""
    dTi = ((Te - Ti)/p['Rie'] + (To - Ti)/p['Ria'] + Q_hvac + 0.5*Q_int + p['a_sol']*Q_sol) / p['Ci']
    dTe = ((Ti - Te)/p['Rie'] + (To - Te)/p['Rea'] + 0.5*Q_int) / p['Ce']
    return Ti + dt*dTi, Te + dt*dTe

def fit(data, x0, lb, ub, n_starts=20, rng=np.random.default_rng(0)):
    keys = ['Ci','Ce','Rie','Ria','Rea','a_sol']
    def resid(logx):
        p = dict(zip(keys, np.exp(logx)))
        Ti, Te, out = data.Ti[0], data.Ti[0], []
        for k in range(len(data.To)):
            out.append(Ti); Ti, Te = step_2r2c(Ti, Te, data.To[k], data.Q[k], data.Qint[k], data.Qsol[k], p)
        return np.array(out) - data.Ti
    best = None
    for _ in range(n_starts):  # C2: 다중 초기값
        z0 = np.log(x0) + rng.normal(0, 0.5, len(x0))
        r = least_squares(resid, np.clip(z0, np.log(lb), np.log(ub)), bounds=(np.log(lb), np.log(ub)))
        best = r if best is None or r.cost < best.cost else best
    return dict(zip(keys, np.exp(best.x))), np.sqrt(2*best.cost/len(data.Ti))
```

---

## D. VRF 성능곡선과 날씨 예보 기반 예측 제어(MPC/휴리스틱)

### D1. EnergyPlus VRF(System Curve 모델) 식과 실제 계수 (바로 구현 가능)
- **식 출처**: EnergyPlus Engineering Reference 9.6, "Variable Refrigerant Flow Heat Pumps" https://bigladdersoftware.com/epx/docs/9-6/engineering-reference/variable-refrigerant-flow-heat-pumps.html **[원문 확인]**
- **계수 출처**: NREL EnergyPlus 공식 예제 `testfiles/VariableRefrigerantFlow_5Zone.idf` https://raw.githubusercontent.com/NREL/EnergyPlus/develop/testfiles/VariableRefrigerantFlow_5Zone.idf **[원문 확인, 직접 파싱]**
- **식 요약**
  - 가용 용량 = 정격용량 × CAPFT(T_wb,in, T_out) × 조합비 보정
  - 소비전력 = (정격용량 × CAPFT / 정격 COP) × EIRFT(T_wb,in, T_out) × EIRFPLR(PLR) × RTF
  - CAPFT와 EIRFT는 바이쿼드러틱이다: `f(x,y)=c1+c2·x+c3·x²+c4·y+c5·y²+c6·x·y`
    - 냉방: x = 실내 습구온도(부하 가중 평균), y = 실외 건구온도
    - 난방: x = 실내 건구온도, y = 실외 온도(이 예제는 **습구**)
  - 경계곡선(cubic)이 실내온도의 함수로 실외온도 경계를 준다. 실외온도가 경계보다 낮으면 Low 곡선, 그렇지 않으면 High 곡선을 쓴다.
  - PLR이 최소 PLR보다 작으면 on/off 사이클링으로 처리한다: `CR = PLR/PLR_min`, `PLF = 0.85 + 0.15·CR`, `RTF = CR/PLF`. 이 예제에서 **PLR_min = 0.25**다.
- **예제 IDF 계수** (정격 냉방 COP 3.2917, 난방 COP 3.5484. 이 값은 예제 값이므로 실제 실외기 카탈로그 값으로 교체할 것)

| 곡선 | 형태 | 계수 (c1…c6 또는 c1…c4) | 유효범위 |
|---|---|---|---|
| CoolCapFT Low | biquad | 0.576882692, 0.017447952, 0.000583269, −1.76324E−06, −7.474E−09, −1.30413E−07 | x 15~24, y −5~23 |
| CoolCapFT High | biquad | 0.6867358, 0.0207631, 0.0005447, −0.0016218, −4.259E−07, −0.0003392 | x 15~24, y 16~43 |
| CoolCap/EIR Boundary | cubic | 25.73473775, −0.03150043, −0.01416595, 0 | |
| CoolEIRFT Low | biquad | 0.989010541, −0.02347967, 0.000199711, 0.005968336, −1.0289E−07, −0.00015686 | x 15~24, y −5~23 |
| CoolEIRFT High | biquad | 0.14351470, 0.01860035, −0.0003954, 0.02485219, 0.00016329, −0.0006244 | x 15~24, y 16~43 |
| Cool EIRFPLR (PLR≤1) | cubic | 0.4628123, −1.0402406, 2.17490997, −0.5974817 | 0~1 |
| HeatCapFT Low | biquad | 1.014599599, −0.002506703, −0.000141599, 0.026931595, 1.83538E−06, −0.000358147 | x 15~27, y −20~15 |
| HeatCapFT High | biquad | 1.161134821, 0.027478868, −0.00168795, 0.001783378, 2.03208E−06, −6.8969E−05 | x 15~27, y −10~15 |
| HeatCap/EIR Boundary | cubic | −7.6000882, 3.05090016, −0.1162844, 0 | |
| HeatEIRFT Low | biquad | 0.87465501, −0.01319754, 0.00110307, −0.0133118, 0.00089017, −0.00012766 | x 15~27, y −20~12 |
| HeatEIRFT High | biquad | 2.504005146, −0.05736767, 4.07336E−05, −0.12959669, 0.00135839, 0.00317047 | x 15~27, y −10~15 |
| Heat EIRFPLR (PLR≤1) | cubic | 0.1400093, 0.6415002, 0.1339047, 0.0845859 | 0~1 |
| Part-load fraction | quad | 0.85, 0.15, 0 | |
| 조합비 보정 (냉방) | linear | 0.618055, 0.381945 (CR 1.0~1.5 → 1.0~1.2) | |
| 크랭크케이스 히터 | 상수 | 압축기당 15 W, 압축기 3대, 외기 7°C 이하에서 동작 | |

- **곡선 형태 (우리 계산, 위 계수를 그대로 대입)**
  - 냉방(실내 습구 19.4°C): 경계 외기온도 19.8°C

    | 외기 건구 | 20 | 25 | 30 | 35 | 38 |
    |---|---|---|---|---|---|
    | 용량비 CAPFT | 1.13 | 1.09 | 1.05 | 1.01 | 0.98 |
    | 전부하 COP | 4.87 | 4.24 | 3.72 | 3.29 | 3.06 |

  - 난방(실내 건구 21.1°C, 외기 습구 기준): 경계 외기 습구 5.0°C

    | 외기 습구 | −10 | −5 | 0 | 5 | 10 |
    |---|---|---|---|---|---|
    | 용량비 CAPFT | 0.71 | 0.80 | 0.90 | 1.00 | 0.99 |
    | 전부하 COP | 2.66 | 2.98 | 3.26 | 3.45 | 4.32 |

  - 부분부하(냉방): PLR이 0.4, 0.5, 0.6, 0.75일 때 효율 배수 PLR/EIRFPLR가 1.12, 1.21, 1.22, 1.15다. PLR 0.25 이하에서는 사이클링으로 효율이 떨어진다(PLR 0.25에서 0.76배).
- **적용 방법 (핵심)**
  1. 층별 실외기 1대: `load_floor = Σ 실내기 부하`, `PLR = load_floor / (정격 × CAPFT)`
  2. **실 통합(E절)의 물리적 근거**: 한 층에서 강의실 1개만 켜면 PLR이 0.25 미만이 되어 사이클링 손실이 생긴다. 같은 층에 2~3실을 몰면 PLR이 0.5~0.6이 되어 효율이 약 1.2배다. 반대로 층을 통째로 비우면 실외기 대기전력과 크랭크케이스 히터까지 꺼진다.
  3. 난방 곡선의 실외 습구온도는 Open-Meteo/기상청의 기온과 상대습도로 계산한다(예: `psychrolib`).
```python
def bq(c,x,y): return c[0]+c[1]*x+c[2]*x*x+c[3]*y+c[4]*y*y+c[5]*x*y
def cub(c,x): return c[0]+c[1]*x+c[2]*x*x+c[3]*x**3
def vrf_power_kw(load_kw, t_out, mode, rated_kw, cop, t_in=19.4, plr_min=0.25):
    if mode == 'cool':
        lo = t_out < cub(COOL_BND, t_in)
        capft = bq(COOL_CAP_LO if lo else COOL_CAP_HI, t_in, t_out)
        eirft = bq(COOL_EIR_LO if lo else COOL_EIR_HI, t_in, t_out); plrc = COOL_EIRFPLR
    else:  # t_in=실내 건구, t_out=실외 습구
        lo = t_out < cub(HEAT_BND, t_in)
        capft = bq(HEAT_CAP_LO if lo else HEAT_CAP_HI, t_in, t_out)
        eirft = bq(HEAT_EIR_LO if lo else HEAT_EIR_HI, t_in, t_out); plrc = HEAT_EIRFPLR
    cap = rated_kw * capft                     # 입력값은 곡선 유효범위로 clamp할 것
    plr = min(load_kw / cap, 1.0) if load_kw > 0 else 0.0
    if plr == 0: return 0.0, cap, 0.0
    if plr < plr_min:
        cr = plr / plr_min; f = cub(plrc, plr_min) * cr / (0.85 + 0.15*cr)
    else:
        f = cub(plrc, plr)
    return cap / cop * eirft * f, cap, plr     # kW(전기), kW(가용 용량), PLR
```
  - PLR이 PLR_min보다 작을 때 EIRFPLR를 PLR_min에서 평가하는 부분은 연속성을 맞추려는 우리 구현이다. 엔지니어링 레퍼런스 원문으로 재확인하길 권한다.

### D2. Thu et al. (2025): 다실 VRF MPC + 피크전력 제약
- **제목**: Power-constrained VRF system optimization using symbolic regression for multiple zones environment
- **저자/학술지**: Theint Theint Thu, Kenshiro Kato, Dafang Zhao, Hiroki Nishikawa, Ittetsu Taniguchi, Takao Onoye (Osaka Univ.), *Energy and Buildings* 347, 116264, 2025 (CC BY 4.0)
- **링크**: https://doi.org/10.1016/j.enbuild.2025.116264 · 오픈 PDF https://ir.library.osaka-u.ac.jp/repo/ouka/all/102866/EnergyBuild_347.pdf **[원문 확인]**
- **핵심 결과**
  - 교육용 건물 사무실 4실의 VRF 운전 데이터로 PySR 기호회귀 모델을 만들고, 이를 MPC에 넣었다. 예측과 제어 horizon은 24시간, 시간 간격은 15분이다.
  - 피크전력은 hard constraint로 두었다. 전력 30% 제약에서 분산형 MPC 대비 최대 **16%** 절감했고, 평균 온도편차는 2°C 미만이었다.
  - 상세 시스템 식별이나 대량 학습 데이터가 필요 없다는 점을 장점으로 내세운다.
- **적용 방법 (휴리스틱 피크 셰이빙)**
  - 층별 실외기 전력의 합에 상한 `P_cap`을 둔다.
  - 기동 시점이 겹쳐 상한을 넘으면, 여유(slack = 허용 lead − 필요 lead)가 큰 실부터 **기동을 앞당기거나 뒤로 미룬다**(우선순위 greedy).
  - 교육용(을)은 기본요금이 kW당 부과되므로(H2) 피크 감소를 금액으로 환산해 보여 준다.

### D3. Oldewurtel et al. (2012): 기상예보 + (확률적) MPC (기준 문헌)
- **제목**: Use of model predictive control and weather forecasts for energy efficient building climate control
- **학술지**: *Energy and Buildings* 45, 15–27, 2012
- **링크**: https://doi.org/10.1016/j.enbuild.2011.09.022 (PDF 본문의 DOI와 일치) · PDF https://infoscience.epfl.ch/record/176005 **[원문 확인]**
- **핵심 결과**
  - 건물과 설비 조합 1,280개 사례의 대규모 요인 시뮬레이션을 수행했다.
  - **절반 이상의 사례에서 규칙 기반 제어(RBC)가 완전예측 벤치마크보다 비재생 1차에너지를 40% 이상 더 썼다.** 이것이 예측 제어의 이론적 잠재량이다.
  - 확률적 MPC(SMPC)는 RBC보다 에너지와 쾌적 위반 모두에서 우수했다. 예보 품질이 성능에 중요했다.
- **적용 방법**: 예보 오차에 대비해 lead에 여유(A2의 n·σ)를 둔다. "예보 대신 지속성 예측(어제와 같다고 가정)을 쓴 경우"를 대조 실험으로 넣으면 예보 사용의 가치를 정량화할 수 있다.

### D4. (참고) Drgoňa et al. (2020): 건물 MPC 종합 리뷰
- **제목**: All you need to know about model predictive control for buildings, *Annual Reviews in Control*, 2020
- **링크**: https://doi.org/10.1016/j.arcontrol.2020.09.001 **[서지 확인]**
- **내용**: MPC는 에너지와 온실가스를 크게 줄일 수 있지만 실제 적용은 아직 초기 단계라는 서술을 확인했다. 리뷰 본문의 절감률 범위는 확인하지 못했다.
- **적용 방법**: 해커톤에서는 full MPC 대신 **"모델 기반 예측 + 규칙 탐색"(휴리스틱 MPC)**을 택한 이유를 설명할 때 인용한다.

---

## E. 에너지 목적의 강의 시간표·강의실 배정 (실 통합)

### E1. Song, Kim, Park, Lee (2017): 에너지 효율 기반 강의 시간표 (서울대, 국내 연구진)
- **제목**: Energy efficiency-based course timetabling for university buildings
- **학술지**: *Energy* 139, 394–405, 2017
- **링크**: https://doi.org/10.1016/j.energy.2017.07.176 · https://ideas.repec.org/a/eee/energy/v139y2017icp394-405.html **[초록 확인]**
- **핵심 결과**
  - 강의실마다 공간과 기능 특성이 달라 에너지 사용이 다르다는 점에 착안해, 에너지를 최소화하는 시간표 알고리즘을 제안했다.
  - 기존 시간표 대비 냉방기와 난방기에 약 **4%** 절감했고, hard constraint를 완화하면 최대 **5.0%**였다.
  - 다른 2차 문헌은 이 연구의 방법을 GA로 소개한다 **[스니펫]**.
- **적용 방법**: "강의 시각은 바꾸지 않고 강의실만 바꾸는 것"은 이 논문보다 제약이 약하다. 따라서 절감 기대치를 **수 %대**로 제시하고, 시각 이동을 허용하는 what-if는 Copilot의 옵션으로 둔다.

### E2. Alves, Cunha, Subramanian, Brito (2022): 실제 강의실 배정 ILP
- **제목**: Minimizing energy consumption in a real-life classroom assignment problem
- **학술지**: *OR Spectrum* 44(4), 1149–1175, 2022
- **링크**: https://doi.org/10.1007/s00291-022-00674-z · https://ideas.repec.org/a/spr/orspec/v44y2022i4d10.1007_s00291-022-00674-z.html **[초록 확인]**
- **핵심 결과**
  - 브라질 연방 교육기관의 문제로, 최대 3,046개 강좌와 97개 장소 규모다.
  - 작은 수업이 큰 강의실에 배정되는 비효율 같은 문제를 ILP로 풀었다. 모든 시나리오에서 수작업 배정 대비 크게 절감했고, 최대 **26%**였다.
- **적용 방법**: 우리 규모(10실, 주 6일 × 31슬롯)는 이보다 훨씬 작으므로 **PuLP + CBC로 수 초 안에 정확해**를 구할 수 있다.

### E3. Lim, van den Briel, Thiébaux, Backhaus, Bent (2015): HVAC를 고려한 재실 스케줄링
- **제목**: HVAC-Aware Occupancy Scheduling, AAAI 2015
- **링크**: https://ojs.aaai.org/index.php/AAAI/article/view/9236 · 전문 https://object.cloud.sdsc.edu/v1/AUTH_da4962d3368042ac8337e2dfdd3e7bf3/ml-papers-txt/AAAI/2015/hvacaware_occupancy_scheduling__09652e66.txt **[원문 확인]**
- **핵심 결과**
  - 회의(강의) 배정과 HVAC 제어를 **하나의 MILP로 동시에 최적화**했다. 열모델은 RC 네트워크이고, 쌍선형 항은 McCormick envelope로 선형화했다. 시간 간격은 30분, 1인당 75 W다.
  - 대규모 문제는 MILP를 Large Neighbourhood Search(LNS)에 내장해 풀었다. 최대 500개 회의, 50개 실, 15분 제한이다.
  - Table 1(70개 인스턴스 평균, 공동 최적 OS 대비 초과 소비): 무작위 스케줄(AN) **+74.84%**, 실 수와 공백을 최소화하는 휴리스틱(HS) **+46.14%**.
- **적용 방법 (ILP 정식화, 약 2시간)**
```python
# x[l,r]: 강의 l을 실 r에 배정, y[r,t]: 실 r이 슬롯 t에 공조, s[r,t]: 기동(start-up), z[f,t]: 층 f 실외기 ON
prob = LpProblem('consolidate', LpMinimize)
prob += lpSum(c_room[r][t]*y[r,t] for r,t in RT) \
      + lpSum(c_start[r][t]*s[r,t] for r,t in RT) \
      + lpSum(c_odu[f][t]*z[f,t] for f,t in FT) \
      + lam * lpSum(x[l,r] for l,r in LR if r != orig_room[l])          # 변경 최소화(현실성)
for l in L: prob += lpSum(x[l,r] for r in feasible[l]) == 1               # 수용인원·실 유형(PC실습) 적합
for r in R:
    for t in T: prob += lpSum(x[l,r] for l in L if t in slots[l]) <= 1     # 중복 금지
for (l,r) in LR:
    for t in slots[l]: prob += y[r,t] >= x[l,r]
for r,t in RT: prob += s[r,t] >= y[r,t] - y[r,t-1]                         # 연속 수업이면 기동비용 없음
for f,t in FT:
    for r in rooms_on_floor[f]: prob += z[f,t] >= y[r,t]
```
  - 계수 `c_room`, `c_start`, `c_odu`는 우리 시뮬레이터에서 (날씨, 실, 슬롯)별로 미리 계산한다. `c_start`는 사전 공조 에너지이고, `c_odu`는 실외기 기저전력과 사이클링 손실을 반영한다.
  - `lam`을 키우면 "변경 3건 이내" 같은 운영 친화적인 안이 나온다. 변경 건수와 절감 kWh의 파레토 곡선을 화면에 보여 주면 효과적이다.

### E4. (운영 사례) Michigan State University 야간 강의 집중 배치
- **링크**: https://www.fmlink.com/michigan-state-university-develops-strategy-for-saving-energy-and-space/ **[스니펫]**
- **내용**: 2008~09년 시범사업으로 야간 강의와 행사를 7개 건물에 모았고, 해당 건물의 에너지가 **2~20%** 줄었다고 학교 측이 밝혔다.
- **적용 방법**: 18시 이후 강의를 한 층(실외기 1대)으로 모으는 **"야간 집중 배치"** 시나리오를 프리셋으로 둔다. 2026년 개편 요금에서 18~21시가 최대부하로 바뀌었다는 보도(H2)와 함께 쓰면 메시지가 강해진다.

---

## F. 건물 에너지·HVAC를 위한 LLM / 생성형 AI (2023~2026)

### F1. Neubauer, Hong et al. (2026): LLM-HVAC 운영 비판적 리뷰 (가장 최신)
- **제목**: Large Language Models for HVAC Operations in Building Energy Systems: A Critical Review of Methods, Applications, and Deployment Readiness
- **저자**: Alexander Neubauer, Tianzhen Hong, Han Li, Mengbo Yu, Amin Darbandi, Yannick Fürst, Martin Kriegel, arXiv:2609.05314, 2026-09-04
- **링크**: https://arxiv.org/abs/2609.05314 **[초록 확인]**
- **핵심 결과**
  - 2023년부터 2026년 3월까지의 동료심사 논문 66편을 검토했다.
  - 파일럿 수준 근거는 **4편**뿐이고, 지속적인 운영 배포는 **0편**이었다. "즉시 산업 적용 가능"으로 분류된 연구도 0편이었다(근시일 3편, 연구 단계 63편).
  - 고빈도 제어와 단기 수치 예측에서는 기존 ML, MPC, RL이 앞선다.
  - LLM은 **의미·워크플로 계층**(포인트명 정규화, 문서 기반 운영 지원, BEM 워크플로 보조, 물리 기반 제어기를 감싸는 자문 인터페이스)으로 쓸 때 근거가 있다.
- **적용 방법**: 우리 아키텍처의 정당화 근거로 쓴다. **"Claude는 해석·설명·입력 구조화만 하고, 제어 수치는 결정론적 엔진이 만든다."**

### F2. Ahn, Kim, Cho, Chae (2023): ChatGPT가 HVAC를 직접 제어 (국내 연구진)
- **제목**: Alternative Approaches to HVAC Control of Chat Generative Pre-Trained Transformer (ChatGPT) for Autonomous Building System Operations
- **학술지**: *Buildings* 13(11), 2680, 2023
- **링크**: https://doi.org/10.3390/buildings13112680 · https://structurae.net/en/literature/journal-article/alternative-approaches-to-hvac-control-of-chat-generative-pre-trained-transformer-chatgpt-for-autonomous-building-system-operations **[초록 확인]**
- **핵심 결과**: EnergyPlus 기준 사무소 모델(공조기 4대, 냉동기 2대, 냉각탑, 펌프 2대)에 ChatGPT를 연결했다. 총 에너지 절감은 **ChatGPT 16.8%, DQN 24.1%**였고, 둘 다 CO2를 1,000 ppm 아래로 유지했다. ChatGPT는 학습 과정이 필요 없다는 장점이 있다.
- **적용 방법**: "LLM 직접 제어는 학습·최적화 제어기보다 성능이 낮다"는 근거로 쓴다. 우리는 LLM이 직접 제어하지 않는다.

### F3. Song, Zhang, Zhao, Bian (2023): GPT-4 in-context HVAC 제어 (Microsoft Research)
- **제목**: Pre-Trained Large Language Models for Industrial Control, arXiv:2308.03028
- **링크**: https://arxiv.org/abs/2308.03028 **[원문 확인]**
- **핵심 결과** (BEAR 시뮬레이터, OfficeMedium, 보상 평균)
  - 미래 날씨를 아는 MPC(oracle) **1.35**, GPT-4 최고 설정 1.23, PPO 1.21, GPT-4 최난 설정 1.16
  - 프롬프트 설계에 민감했다. 사람이 쓴 피드백 코멘트는 성능을 0.99에서 1.16으로 올렸지만, **자기 생성 코멘트는 0.59로 떨어뜨렸다**.
  - 한계: 상호작용으로 스스로 개선되지 않고, 다른 건물의 시연 예시가 오히려 오도할 수 있다.
- **적용 방법**: 모델 기반 최적화(MPC)가 LLM보다 위에 있다는 근거로 쓴다. Copilot의 자기평가 루프(LLM이 스스로 채점)는 넣지 않는다.

### F4. Zhang & Chen (2024): LLM + Shapley로 MPC 결정 설명
- **제목**: Large language model-based interpretable machine learning control in building energy systems
- **학술지**: *Energy and Buildings* 313, 114278, 2024
- **링크**: https://doi.org/10.1016/j.enbuild.2024.114278 · arXiv https://arxiv.org/abs/2402.09584 **[초록 확인]**
- **핵심 결과**: Shapley value와 LLM의 in-context learning을 결합해 ML 제어 결정을 설명한다. 수요반응 상황의 MPC 기반 예냉 사례에서, 생성된 설명이 규칙 기반 논리와 일치했다.
- **적용 방법**: `explain_decision(room, time)` 도구를 만든다.
  - 결정론적 엔진이 **결정 근거 트레이스**를 JSON으로 남긴다. 예: `{"lead_min":35, "drivers":{"T_out":-2.1, "idle_hours":38, "Te_init":15.2}, "counterfactual":{"no_forecast_lead":10, "unmet_min":12}}`
  - Claude는 이 JSON만 받아 한국어로 설명한다.
  - Shapley 전체 계산 대신, 입력 1개씩 기본값으로 바꿔 lead 변화를 보는 one-at-a-time 민감도로 단순화해도 된다.

### F5. He & Jazizadeh (2025): LLM 기반 BEMS 에이전트 벤치마크
- **제목**: Context-aware LLM-based AI Agents for Human-centered Energy Management Systems in Smart Buildings, arXiv:2512.25055
- **링크**: https://arxiv.org/abs/2512.25055 **[초록 확인]**
- **핵심 결과**: 지각-두뇌-행동 3모듈 구조로, 실제 주거 데이터셋 4종에서 사용자 질의 120개로 평가했다. 정확도는 기기 제어 86%, 메모리 97%, 스케줄링 74%, 에너지 분석 77%, **비용 추정 49%**였다.
- **적용 방법**: **비용·kWh·CO2 같은 숫자는 반드시 도구(시뮬레이터, 요금 계산기)가 계산**하고, LLM은 결과를 인용만 하도록 시스템 프롬프트와 응답 검증으로 강제한다.

### F6. Jiang, Ma, Zhang, Chen (2024): EPlus-LLM, 자연어로 건물 모델 생성
- **제목**: EPlus-LLM: A large language model-based computing platform for automated building energy modeling
- **학술지**: *Applied Energy* 367, 123431, 2024
- **링크**: https://doi.org/10.1016/j.apenergy.2024.123431 · https://ideas.repec.org/a/eee/appene/v367y2024ics0306261924008146.html **[초록 확인]**
- **핵심 결과**: 파인튜닝한 T5가 자연어 건물 설명을 EnergyPlus 모델로 바꾸고 API로 시뮬레이션까지 실행한다. 모델링 노력을 **95% 이상** 줄였고, 그들의 테스트에서 모델 생성 정확도는 100%였다. 오타, 누락, 중복 입력에도 견고했다.
- **적용 방법**: 자연어 이벤트 등록("다음 주 수요일 3시 IT관 301호 세미나 40명")을 JSON 스키마(room, start, end, headcount, type)로 구조화한다. pydantic으로 검증하고 실패하면 재질문한다. 확인 후 시뮬레이터에 반영한다.

### F7. 우리 아키텍처 권고 (위 문헌 종합)
1. **LLM이 하는 일**: 시간표 이미지/Excel 파싱, 자연어 이벤트 등록, what-if 질의 해석, 결과 설명
2. **LLM이 하지 않는 일**: 설정온도와 기동 시각 같은 수치 결정, kWh·원·CO2 계산. 모두 결정론적 도구가 맡는다(F1, F5).
3. **도구 목록 (Bedrock tool use)**: `parse_timetable`, `register_event`, `run_simulation(strategy, period)`, `compare_strategies`, `recommend_consolidation(max_changes)`, `explain_decision(room, time)`, `get_tariff/get_emission_factor`
4. **가드레일**
   - 도구 출력에 없는 숫자를 응답에 쓰면 거부한다(응답 후처리에서 숫자 대조).
   - 시간표 변경 같은 쓰기 작업은 **사람 승인**(human-in-the-loop) 후 실행한다.
   - 파싱 결과는 "확인 화면"을 거친다.

---

## G. 열쾌적 지표와 CO2

### G1. pythermalcomfort (Tartarini & Schiavon 2020): 표준 준수 구현 라이브러리
- **제목**: pythermalcomfort: A Python package for thermal comfort research, *SoftwareX* 12, 100578, 2020
- **링크**: https://doi.org/10.1016/j.softx.2020.100578 · https://github.com/CenterForTheBuiltEnvironment/pythermalcomfort **[초록 확인]**
- **소스코드에서 확인한 식** **[원문 확인]**
  - https://pythermalcomfort.readthedocs.io/en/latest/_modules/pythermalcomfort/models/adaptive_ashrae.html
  - https://pythermalcomfort.readthedocs.io/en/latest/_modules/pythermalcomfort/models/adaptive_en.html
  - **ASHRAE 55 adaptive**: `t_cmf = 0.31·t_pma + 17.8`. 80% 허용은 −3.5 / +3.5, 90% 허용은 −2.5 / +2.5이며, 상한에는 기류 냉각효과(ce)를 더한다. 유효범위는 10 < t_pma < 33.5°C다.
  - **EN 16798-1 adaptive**: `t_cmf = 0.33·t_rm + 18.8`. Cat I은 −3 / +2, Cat II는 −4 / +3, Cat III는 −5 / +4다. 유효범위는 10 ≤ t_rm ≤ 30°C다.
- **EN 16798 지수가중 이동평균 외기온도 (근사식)**: `θrm = (θ(d−1) + 0.8θ(d−2) + 0.6θ(d−3) + 0.5θ(d−4) + 0.4θ(d−5) + 0.3θ(d−6) + 0.2θ(d−7)) / 3.8` (REHVA Journal, B. W. Olesen) https://www.rehva.eu/rehva-journal/chapter/european-standardisation-on-thermal-environment **[스니펫]**
- **주의 (ASHRAE 55 적용 조건)**: adaptive 모델은 기계식 냉방이 없고 난방도 가동하지 않는 공간에, 대사량 1.0~1.3 met, 착의량 0.5~1.0 clo 조건으로 적용한다(ASHRAE 55-2010 addendum https://www.ashrae.org/File%20Library/Technical%20Resources/Standards%20and%20Guidelines/Standards%20Addenda/55_2010_a.pdf) **[스니펫]**.
  - 따라서 **공조 중 쾌적 평가는 PMV/PPD 또는 고정 밴드**로 하고, adaptive 밴드는 **"공조 생략 / 송풍만" 판단**(봄·가을, 창문 개방 가능)에만 쓰는 것이 방어 가능한 설계다.
- **적용 방법**
  - 쾌적 KPI는 (1) 수업 시작 시점 밴드 미달 분(unmet minutes at lecture start), (2) 수업 중 밴드 이탈 °C·h, (3) 평균 PMV(`pmv_ppd`, 착의 여름 0.5 / 겨울 1.0 clo, 대사 1.1~1.2 met, 기류 0.1 m/s)다.
  - **공조 생략 규칙**: RC 모델로 공조 없이 자유부동한 실온을 예측했을 때 수업 내내 EN Cat II 밴드 안이고, t_rm이 10~30°C 범위이며, 예측 CO2가 1,000 ppm 미만이면 "송풍/환기만"을 추천한다.

### G2. 국내 대학 강의실 쾌적 연구
- **Jung et al. (2011)**: Experimental research on thermal comfort in the university classroom of regular semesters in Korea, *J. Mech. Sci. Technol.* 25, 503–512. https://doi.org/10.1007/s12206-010-1219-1 **[스니펫]**
  - PMV가 중립~약간 서늘할 때 학생 평균 온열감(TSV)은 중립에 가까웠다. PMV가 약간 더움 수준이면 TSV가 약 +1.5까지 올라갔다. 즉 **더운 쪽에서 학생들은 PMV 예측보다 덥게 느낀다**.
  - 적용: 냉방 설정을 28°C로 올리는 시나리오는 쾌적 위험이 크다. 기본값은 26°C로 두고 28°C는 비상 모드로 둔다(H1과 일치). 2011년 문헌이고 원문은 열지 못했다.
- 2020년 이후 국내 대학 강의실의 계절별 중립온도를 직접 비교한 동료심사 논문은 **이번 조사에서 찾지 못했다**.

### G3. CO2 발생량과 실내 CO2 모델
- **Persily & de Jonge (2017)**: Carbon Dioxide Generation Rates from Building Occupants, Healthy Buildings 2017 Europe, Paper 0242 (NIST) https://www.nist.gov/publications/carbon-dioxide-generation-rates-building-occupants-0 · PDF https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=922955 **[원문 확인]**
  - 관련 저널 논문: Persily & de Jonge, *Indoor Air* 27, 2017, DOI 10.1111/ina.12383 **[서지만 확인]**
  - 근사식: 1 MJ/day 에너지 사용당 CO2 **0.00048 L/s** (RQ=0.85, 273 K / 101 kPa 기준), 따라서 `V_CO2 ≈ 0.00048 · BMR(MJ/day) · M(met)`
  - 표 2 (L/s/인)

    | 성별·연령 | 1.2 met | 1.4 met |
    |---|---|---|
    | 남 16~21세 | 0.0045 | 0.0053 |
    | 남 21~30세 | 0.0048 | 0.0056 |
    | 여 16~21세 | 0.0036 | 0.0042 |
    | 여 21~30세 | 0.0038 | 0.0044 |

    ASHRAE 62.1의 성인값은 0.0052 L/s다. 미국 체중 기준이므로 한국 학생에게는 약간 과대 추정이다.
- **국내 기준 (참고)**: 학교보건법 시행규칙의 교사 내 CO2 유지기준은 1,000 ppm(기계환기 시 1,500 ppm)이다. 2005년 개정 내용을 다룬 2006년 문헌에서 확인했다. https://koreascience.kr/article/JAKO200641848289900.pdf **[스니펫, 현행 별표 미확인]**
- **구현**
```python
def co2_step(C, n_people, Q_vent_m3s, V_m3, dt=60, C_out=420, g_lps=0.0042):
    G = n_people * g_lps / 1000.0                          # m3/s
    dC = (G*1e6 + Q_vent_m3s*(C_out - C)) / V_m3           # ppm/s
    return C + dt*dC
```
  - 출석 인원과 외기량에 비례해 환기 부하를 계산하고, "환기만 줄였을 때 CO2가 1,000 ppm을 넘는지"를 제약으로 둔다(Ahn et al. 2023도 1,000 ppm 제약을 썼다).

---

## H. 국내 기준 수치 (공식 출처 우선)

### H1. 공공기관 냉난방 실내온도 기준
| 항목 | 내용 | 출처 | 검증 |
|---|---|---|---|
| 규정 본문 (제14조, 2013년 확정) | 난방설비 가동 시 평균 **18°C 이하**, 냉방설비 가동 시 평균 **28°C 이상** | 서울신문 2024-08-08이 「공공기관 에너지이용 합리화 추진에 관한 규정」을 인용 https://m.go.seoul.co.kr/news/2024/08/08/20240808018004 | 2차 출처 |
| 2025 여름 운영 방침 | 공공기관은 **평상시 26°C** 유지. 예비전력 5.5 GW 미만 위기 시 **26→28°C** 즉시 상향. 피크 16:30~17:30 권역별 30분 순차 운휴(부산은 17:00~17:30) | 산업통상자원부 보도자료 2025-06-26 https://www.motir.go.kr/attach/down/095a2dda9c864e1d90d751f7668a1117/c7f7a3496d974d8c920f372ac221f346 | 원문 확인 |
| 2022 에너지 위기 조치 | 난방온도를 **18→17°C**로 일률 하향. 평상시에는 비전기 난방이 60% 이상이면 20°C 이내 허용. 대상에 **국·공립 대학 포함**(1,019개 기관) | 산업부 보도자료 2022-10-18 https://www.motir.go.kr/attach/down/095a2dda9c864e1d90d751f7668a1117/e0403e0e5971fbffa591f27802012f90/778bdbf5db9ced7c8fd52756c00bf0cd | 원문 확인 |
| 현행 고시 최신판 | 기후에너지환경부고시 제2026-111호, 2026-04-30 시행 (조문 본문은 열지 못함) | https://www.law.go.kr/행정규칙/공공기관에너지이용합리화추진에관한규정 | 서지만 확인 |
| 학교 수업공간 탄력 운영 예외 | 검색 요약에 "학교·도서관 등은 자체 위원회 결정으로 탄력 운영" 문구가 있었으나 원문 조문으로 확인하지 못함 | | **미확인** |
| 겨울 난방 20°C | 2025-12 기후에너지환경부 "난방온도 20도" 캠페인은 **국민(가정) 대상**이며 공공기관 의무가 아님 | https://www.korea.kr/news/policyNewsView.do?newsId=148956664 | 원문 확인 |

- **시뮬레이터 기본값 권고**
  - 냉방은 재실 시 **26°C**(정책 기본), 비상 모드는 28°C
  - 난방은 재실 시 **20°C**(비전기 20°C 이내 허용과 쾌적 사이의 절충), 절약 모드는 18°C
  - "공공기관 기준 준수율" KPI를 표시한다. 부산대는 국립대이므로 2022년 조치 대상에 포함됐다.
- 참고로 2025-06-26 보도자료에는 공공기관 그린버튼에 **기상정보와 연계한 냉난방 전력 예측과 "냉난방 민감도"(외기 1°C당 냉난방 에너지 변화량) 분석**을 도입한다는 계획이 있다. 우리 서비스의 날씨 연동 방향이 정부 방향과 일치한다는 근거로 쓸 수 있다.

### H2. 한전 교육용 전력 요금
- **출처**: 한전 사이버지점 교육용전력 요금표 https://cyber.kepco.co.kr/ckepco/front/jsp/CY/E/E/CYEEHP00204.jsp **[원문 확인, 2026-11-19 접속]**
  - 페이지에 게시된 최신 적용일은 **2023-05-16**이다.
  - 교육용(을)은 계약전력 1,000 kW 이상에 적용되며, 대학 캠퍼스는 대개 이 종별이다. 부산대의 실제 계약종별과 선택 요금은 시설과에 확인해야 한다.

| 교육용(을) 고압A | 기본요금(원/kW) | 시간대 | 여름(6~8월) | 봄·가을(3~5, 9~10월) | 겨울(11~2월) |
|---|---|---|---|---|---|
| 선택 I | 6,090 | 경부하 | 76.5 | 76.5 | 80.5 |
| | | 중간부하 | 121.2 | 90.9 | 119.7 |
| | | 최대부하 | 187.1 | 111.4 | 158.4 |
| 선택 II | 6,980 | 경부하 | 72.0 | 72.0 | 76.0 |
| | | 중간부하 | 116.7 | 86.4 | 115.2 |
| | | 최대부하 | 182.6 | 106.9 | 153.9 |

- 교육용(갑) 고압A 선택 I (계약전력 1,000 kW 미만, 시간대 구분 없음)은 기본요금 5,550원/kW, 여름 123.3원, 봄·가을 86.5원, 겨울 109.3원(원/kWh)이다.
- **시간대 구분 (위 페이지 기준)**

| 구분 | 봄·여름·가을 | 겨울 |
|---|---|---|
| 경부하 | 23~09시 | 23~09시 |
| 중간부하 | 09~10, 12~13, 17~23시 | 09~10, 12~17, 20~22시 |
| 최대부하 | 10~12, 13~17시 | 10~12, 17~20, 22~23시 |

- **2026년 시간대 개편 (보도 기준, 한전 요금표에서 아직 확인 못 함)** **[2차 출처]**
  - 2026-03-13 기후에너지환경부와 한전이 계절·시간대별 요금 개편을 발표했다. 산업용(을)은 2026-04-16부터, 산업용(갑)II·일반용·**교육용(을)**은 **2026-06-01**부터 적용한다고 보도됐다. https://www.newsis.com/view/NISX20260313_0003547625
  - 평일 3~10월 기준으로 경부하는 22시~익일 08시, **최대부하는 15~21시**, 나머지는 중간부하라고 보도됐다. 낮 11~15시는 최대에서 중간으로 내려가고 18~21시는 중간에서 최대로 올라간다. https://v.daum.net/v/20260511075813744 , https://www.newsis.com/view/NISX20260522_0003641664
  - 교육용(을)의 개편 후 kWh 단가와 겨울철 시간대는 **확인하지 못했다**. 일반용·교육용은 평균 1원/kWh 미만 하락 예상이라는 해설만 있다.
- **구현**: 요금표를 `tariff_2023_05_16.yaml`과 `tariff_2026_06_reported.yaml` 두 벌로 두고 토글한다. 2026 가을학기(9~12월)는 9~10월 봄·가을 요금과 11~12월 겨울 요금이 섞인다. **18~21시 야간 강의가 최대부하로 바뀌었다면** 야간 강의 집중 배치(E4)의 비용 효과가 커진다. 발표에서는 반드시 "보도 기준"이라고 단서를 단다.

### H3. 국가 전력 온실가스 배출계수
- **최신 값**: **2023년도 0.4173 tCO2eq/MWh**(= 0.4173 kgCO2eq/kWh)
  - 국가 온실가스 통계 관리위원회가 확정하고 기후에너지환경부가 2025-12-18 공표했다.
  - 2025년 3월 공표한 2020~2022년 평균 **0.4541** 대비 8.1% 낮다.
  - 갱신 주기는 **3년에서 1년으로 단축**됐다.
  - 출처: 쿠키뉴스 2025-12-18 https://www.kukinews.com/article/view/kuk202512180131 **[2차 출처]**. 갱신 주기 단축은 헤럴드경제 2026-03-24 https://www.heraldk.com/article/2026032421440138629 **[2차 출처]**
  - 공식 원문(온실가스종합정보센터 gir.go.kr 공지)은 열지 못했다. **발표 전 gir.go.kr에서 확인 필요**. 2024년도 계수가 이미 나왔는지도 확인하지 못했다.
- **구현**: `EF_KG_PER_KWH = 0.4173`을 설정값으로 두고 출처 주석을 단다. 절감 kWh × 0.4173 = kgCO2eq.

---

## I. 제한된 시간에 구현할 개선사항 Top 6 (우선순위)

| 순위 | 개선 | 기대 효과 | 구현 시간 | 근거 |
|---|---|---|---|---|
| 1 | **RC 기반 예측 기동 + 관성 조기정지 + 일일 오차 학습** | AI 전략의 핵심. 수업 시작 시 쾌적 미달을 거의 없애면서 고정 lead보다 에너지를 줄임. 문헌 기준 6.5~9.7% | 2시간 | A1, A3, A4, C |
| 2 | **층별 실외기(ODU)에 EnergyPlus VRF 곡선 적용** (CAPFT/EIRFT/EIRFPLR, 최소 PLR 사이클링) | kWh의 현실성(외기·부분부하 의존)을 확보하고 실 통합·staging 효과의 물리적 근거가 됨 | 1~1.5시간 | D1 |
| 3 | **실 통합 추천 ILP** (PuLP, 기동비용·층 ON 비용·변경 최소화) | 문헌 기준 4~26%. 변경 건수와 절감의 파레토로 운영자 수용성 확보 | 2시간 | E1~E3, D1 |
| 4 | **비용·탄소·피크 KPI** (교육용(을) TOU 2벌, 0.4173 kg/kWh, 피크 상한 greedy staging) | 절감을 원과 tCO2로 환산. 피크 상한으로 기본요금 절감 스토리 | 1시간 | H2, H3, D2 |
| 5 | **쾌적·공기질 KPI** (기동 시 미달 분, 밴드 이탈 °C·h, PMV, CO2) + 공조 생략 판단 | "아끼면서 덜 춥고 덜 덥다"를 증명. 쾌적을 희생한 절감이 아님을 보여줌 | 1시간 | G1, G3 |
| 6 | **LLM Copilot 가드레일** (숫자는 도구 출력만, JSON 스키마 검증, 변경은 사람 승인, 결정 트레이스 기반 설명) | 심사위원의 "LLM 환각" 질문에 대한 답. 2026 리뷰와 일치하는 아키텍처 | 1~2시간 | F1, F4, F5 |

**구현 스케치 요약**
1. `optimal_start()` 이분 탐색(A4)을 만든다. 피처 `idle_hours`, `is_monday` 보정과 `margin = n·σ` RLS 오차 추적을 더하고, 수업 중에는 `coast_off()` 탐색(종료 15분 전부터 1분 단위)을 돌린다.
2. `vrf_power_kw()`(D1)를 층 단위로 호출한다. 실내기 부하는 RC 모델이 요구하는 열량이고, 용량이 부족하면 기동을 앞당긴다.
3. `consolidate_ilp()`(E3)를 만든다. 계수는 1·2의 시뮬레이터에서 슬롯별로 사전 계산하고, `max_changes` 파라미터를 둔다.
4. `cost_krw = Σ kWh_t × price(season, band(t))`, `peak_kW = max_t P_t`, `CO2 = kWh × 0.4173`
5. `pythermalcomfort.models.pmv_ppd`와 adaptive_en 밴드를 쓰고, co2_step(G3)을 넣는다.
6. Bedrock tool use, pydantic 스키마, 응답 숫자 검증기, 승인 버튼을 만든다.

---

## J. 발표용 주장 (한국어, 인용 포함)

1. "수업 시간표로 강의실 냉난방기를 제어한 국내 대학 실험에서, 제어한 강의실은 제어하지 않은 강의실보다 에너지를 30~60% 적게 썼습니다." (정기범, 대한안전경영과학회지 16(2), 2014, doi:10.12812/ksms.2014.16.2.167)
2. "미국 Penn State는 강의실 예약 시스템을 공조 제어와 연동해 300개 실의 장비 가동시간을 60% 줄였습니다." (Penn State News, 2019-05-21)
3. "최근 운전 이력과 전날의 오차로 기동·정지 시각을 매일 학습하는 제어는 기존 방식 대비 연간 HVAC 에너지를 6.5~9.7% 줄이면서 운영일의 97~99%에서 쾌적을 지켰습니다. 우리 AI 전략의 목표치도 이 범위에서 보수적으로 잡았습니다." (Park & Kim, Case Studies in Thermal Engineering 61, 105055, 2024)
4. "강의실 배정만 에너지 관점으로 바꿔도 국내 대학 사례에서 4~5%, 실제 교육기관 배정 문제에서는 최대 26%까지 절감이 보고됐습니다." (Song et al., Energy 139, 2017; Alves et al., OR Spectrum 44, 2022)
5. "사용 강의실 수와 공백만 줄이는 휴리스틱으로 배정한 뒤 공조를 돌리면, 배정과 공조를 동시에 최적화한 경우보다 에너지를 46% 더 씁니다. 그래서 우리 서비스는 배정 추천과 공조 시뮬레이션을 한 엔진으로 묶었습니다." (Lim et al., AAAI 2015, Table 1의 HS 대 OS 비교)
6. "VRF 실외기는 부분부하 50~60%에서 같은 외기조건의 전부하 운전보다 약 1.2배 효율적이고, 25% 미만에서는 on/off 사이클링으로 효율이 떨어집니다. 같은 층에 수업을 모으는 것이 효율적인 이유입니다." (EnergyPlus VRF 예제 성능곡선으로 우리가 계산; NREL EnergyPlus VariableRefrigerantFlow_5Zone.idf)
7. "최근 66편의 연구를 검토한 2026년 리뷰에서 LLM이 HVAC를 지속적으로 직접 운전한 사례는 한 건도 없었습니다. 그래서 우리는 생성형 AI를 시간표 해석·설명·질의 같은 '의미 계층'에 쓰고, 제어 수치는 물리 모델과 최적화 엔진이 계산합니다." (Neubauer et al., arXiv:2609.05314, 2026)
8. "절감한 전력 1 MWh는 국가 전력배출계수 0.4173 tCO2eq/MWh 기준으로 약 417 kg의 온실가스 감축에 해당합니다." (2023년도 국가 전력배출계수, 기후에너지환경부 2025-12-18 공표, 쿠키뉴스 보도. 발표 전 gir.go.kr 원문 확인 필요)

---

## 부록 1. 확인하지 못했거나 주의가 필요한 항목
- 공공기관 규정 제14조의 **학교 수업공간 탄력 운영 예외** 문구와 2026-04-30 개정 고시의 온도 조항 본문
- 2026-06-01 이후 **교육용(을) 단가와 겨울철 시간대**(보도 기준 정보만 있음)
- 국가 전력배출계수 0.4173의 **온실가스종합정보센터 원문**과 2024년도 계수 공표 여부
- Bacher & Madsen(2011), Harb et al.(2016)의 **식별된 R/C 수치 표**(유료 또는 접근 차단). 본문 C3의 prior는 ISO 13790 계수로 계산한 우리 추정이다.
- Seem/House 복귀시간 모델의 **정확한 함수형**(특허 수식 렌더링 실패)
- 학교보건법 시행규칙의 **현행** CO2 기준 별표(2006년 문헌으로만 확인)
- 2020년 이후 국내 대학 강의실 계절별 중립온도 동료심사 연구(이번 조사에서 찾지 못함)

## 부록 2. 참고문헌 (DOI/URL)
1. Kim W. et al. (2024) Applied Thermal Engineering 257:124256. https://doi.org/10.1016/j.applthermaleng.2024.124256
2. Seem J.E., House J.M., Alcala C.F. (2016) IHPBC, Purdue. https://docs.lib.purdue.edu/ihpbc/231
3. US Patent 9739496, Systems and methods for estimating a return time. https://patents.google.com/patent/US9739496
4. Park M., Kim S.H. (2024) Case Studies in Thermal Engineering 61:105055. https://doi.org/10.1016/j.csite.2024.105055
5. 정기범 (2014) 대한안전경영과학회지 16(2):167–174. https://doi.org/10.12812/ksms.2014.16.2.167
6. Penn State News (2019). https://www.psu.edu/news/campus-life/story/software-and-scheduling-combine-improve-hvac-efficiency-penn-state
7. Ye Y. et al. (2021) Applied Energy 293. https://doi.org/10.1016/j.apenergy.2021.116854
8. Pang Z. et al. (2020) Applied Energy 279:115727. https://doi.org/10.1016/j.apenergy.2020.115727
9. Bacher P., Madsen H. (2011) Energy and Buildings 43(7):1511–1522. https://doi.org/10.1016/j.enbuild.2011.02.005
10. Brastein O.M. et al. (2018) Energy and Buildings 169:58–68. https://openarchive.usn.no/usn-xmlui/handle/11250/2631860
11. LBNL Modelica Buildings Library, ISO13790 Data / Zone5R1C. https://simulationresearch.lbl.gov/modelica/releases/latest/help/Buildings_ThermalZones_ISO13790_Data.html
12. Raisch F. et al. (2026) arXiv:2604.05904. https://arxiv.org/abs/2604.05904
13. EnergyPlus Engineering Reference 9.6, VRF Heat Pumps. https://bigladdersoftware.com/epx/docs/9-6/engineering-reference/variable-refrigerant-flow-heat-pumps.html
14. NREL EnergyPlus, VariableRefrigerantFlow_5Zone.idf. https://github.com/NREL/EnergyPlus/blob/develop/testfiles/VariableRefrigerantFlow_5Zone.idf
15. Thu T.T. et al. (2025) Energy and Buildings 347:116264. https://doi.org/10.1016/j.enbuild.2025.116264
16. Oldewurtel F. et al. (2012) Energy and Buildings 45:15–27. https://doi.org/10.1016/j.enbuild.2011.09.022 (PDF https://infoscience.epfl.ch/record/176005)
17. Drgoňa J. et al. (2020) Annual Reviews in Control. https://doi.org/10.1016/j.arcontrol.2020.09.001
18. Song K., Kim S., Park M., Lee H.-S. (2017) Energy 139:394–405. https://doi.org/10.1016/j.energy.2017.07.176
19. Alves R.M. et al. (2022) OR Spectrum 44(4):1149–1175. https://doi.org/10.1007/s00291-022-00674-z
20. Lim B.P. et al. (2015) AAAI. https://ojs.aaai.org/index.php/AAAI/article/view/9236
21. Neubauer A. et al. (2026) arXiv:2609.05314. https://arxiv.org/abs/2609.05314
22. Ahn K.U. et al. (2023) Buildings 13(11):2680. https://doi.org/10.3390/buildings13112680
23. Song L. et al. (2023) arXiv:2308.03028. https://arxiv.org/abs/2308.03028
24. Zhang L., Chen Z. (2024) Energy and Buildings 313:114278. https://doi.org/10.1016/j.enbuild.2024.114278
25. He T., Jazizadeh F. (2025) arXiv:2512.25055. https://arxiv.org/abs/2512.25055
26. Jiang G. et al. (2024) Applied Energy 367:123431. https://doi.org/10.1016/j.apenergy.2024.123431
27. Tartarini F., Schiavon S. (2020) SoftwareX 12:100578. https://doi.org/10.1016/j.softx.2020.100578
28. Persily A., de Jonge L. (2017) Healthy Buildings Europe, NIST. https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=922955
29. Jung et al. (2011) J. Mech. Sci. Technol. 25:503–512. https://doi.org/10.1007/s12206-010-1219-1
30. 한국전력 사이버지점 교육용전력 요금표. https://cyber.kepco.co.kr/ckepco/front/jsp/CY/E/E/CYEEHP00204.jsp
31. 산업통상자원부 보도자료 (2025-06-26) 여름철 공공기관 에너지 절감. https://www.motir.go.kr/attach/down/095a2dda9c864e1d90d751f7668a1117/c7f7a3496d974d8c920f372ac221f346
32. 산업통상자원부 보도자료 (2022-10-18) 공공기관 에너지사용의 제한에 관한 공고. https://www.motir.go.kr/attach/down/095a2dda9c864e1d90d751f7668a1117/e0403e0e5971fbffa591f27802012f90/778bdbf5db9ced7c8fd52756c00bf0cd
33. 쿠키뉴스 (2025-12-18) 전력배출계수 갱신 주기 단축. https://www.kukinews.com/article/view/kuk202512180131
34. 뉴시스 (2026-03-13) 계절·시간대별 요금 개편. https://www.newsis.com/view/NISX20260313_0003547625
