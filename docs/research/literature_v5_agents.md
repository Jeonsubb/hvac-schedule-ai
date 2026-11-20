# 문헌 점검 v5: 두 에이전트 협의, 1·2·3차 계획, 쾌적 의견, 실측 보정

- 작성일: 2026-11-20 (발표 2026-11-21)
- 대상: `docs/design_v5.md`, `backend/app/agents.py`, `backend/app/planning.py`, `backend/app/lab.py`
- 범위: 2023~2026 문헌을 우선했고, 꼭 필요한 기준 문헌만 더했습니다. [literature_review.md](literature_review.md)(이하 "기존 조사")가 다룬 최적 기동·정지, 시간표 기반 제어, 2R2C, VRF·MPC, 강의실 배정, LLM-HVAC(Neubauer 2026, Ahn 2023, Song 2023, Zhang & Chen 2024, He & Jazizadeh 2025, EPlus-LLM), PMV·CO₂, 국내 기준은 다시 정리하지 않고 필요한 곳에서만 짧게 인용합니다.
- 검증 표기 (기존 조사와 같습니다)
  - **[원문 확인]**: 본문 PDF나 공식 문서를 직접 열어 수치를 확인했습니다.
  - **[초록 확인]**: 출판사·arXiv·저장소의 초록과 서지 정보만 확인했습니다.
  - **[스니펫]**: 검색 결과 요약으로만 확인했습니다. 발표에서 단독 근거로 쓰지 마십시오.
  - **[우리 계산]**: 저장소 코드를 직접 실행해 얻은 값입니다. 논문 값이 아닙니다.

---

## 0. 한눈에 보기

### 0.1 설계 요소별 판정

| 설계 요소 | 판정 | 핵심 근거 | 한 줄 조치 |
|---|---|---|---|
| 수치는 결정적 엔진, LLM은 제안·설명 | **문헌과 맞음** | LLM-Modulo(Kambhampati 2024), Neubauer 2026, Jonah 2026 | 그대로 유지하고 발표에서 이 이름으로 설명 |
| 매 제안을 시뮬레이터로 다시 계산 | **문헌과 맞음** | 외부 피드백 없는 자기 수정은 실패(Huang 2024), 결정적 검증기 권고(Jonah 2026) | "GAN" 대신 "제안–검증 루프"로 부르기 |
| 두 LLM의 2라운드 협상이 더 나은 답을 찾는다는 가정 | **약함** | 토론이 단순 방법보다 낫지 않음(Smit 2024), 아첨으로 조기 합의(Yao 2025), 다자 공정 배분 4.2%만 사용 가능(Albayaydh 2026) | 결정 공간이 작으니(9개 설정 × 강의실) 판정이 전체 격자를 계산하고, LLM은 설명 역할로 한정 |
| 판정 가중치 `COMFORT_WON = 600`원/PMV·강의실·일 | **약함** | 가중치에 따라 결과가 크게 바뀜(Manjavacas 2024, [우리 계산] 2.1절) | 정책 값으로 노출하고 민감도를 함께 표시 |
| 쾌적 지표 = 수업 중 평균 PMV | **약함** | PMV가 실제 온열감을 맞힌 비율 34%(Cheung 2019), 우리 엔진에서 설정온도에 거의 반응하지 않음([우리 계산]) | 이미 계산하는 불쾌 지표(K·분, BOPTEST식)를 판정에 병기 |
| 의견 집계 (평균 ≤ -0.8, 2건 이상 → 0.5℃) | **보통** | 원하는 온열감이 중립이 아닌 경우 57%(Humphreys & Hancock 2007), 불만은 주로 제어 불량·고장(Federspiel 1998) | 최소 표본·응답률·'괜찮아요' 표, 고장 점검 먼저 |
| 사용자 에이전트가 재실자를 대변 | **약함** | 검증되지 않은 재실자 대리 모델은 연구 단계(Neubauer 2026), LLM 온열감 분포는 사람과 다름(TCEval 2025) | "의견 집계를 대변"으로 범위를 좁혀 설명 |
| 사고 과정(trace) 표시 | **보통** | 모델이 쓴 설명은 실제 판단 이유와 다를 수 있음(Turpin 2023, Chen 2025) | 이름을 "확인한 근거"로 바꾸고 수치를 자동 대조 |
| 1·2·3차 재계획 | **구조는 맞음, 불확실성 처리는 약함** | 계층형 MPC(Langner 2024: 24 h/15분 + 2 h/5분), 결정적 계획은 예보 오차에 약함 | 기동 여유값과 하위→상위 정보 전달 점검 |
| 자동 운전 모드 | **보통** | 현장 LLM 연구는 사람이 설정 적용(Sawada 2025), 자동화 수준은 기능별로 나눠 정함(Parasuraman 2000) | 자동 적용은 한 단계·정책 범위 안으로 제한하고 되돌리기 제공 |
| 실측 대비 ASHRAE Guideline 14 판정 (`lab.py`) | **지표는 맞음, 해석 주의** | 시간 NMBE ±10%·CV(RMSE) 30%(Kim 2018), 통과해도 파라미터가 맞다는 뜻은 아님(Garrett & New 2016) | 공조 전력만 비교하고, 절감은 보정된 모델끼리 계산 |

### 0.2 이번 점검에서 가장 중요한 문헌 5편

| 문헌 | 한 줄 요지 | 검증 |
|---|---|---|
| Sawada et al. 2025, *Data-Centric Engineering* (Office-in-the-Loop) | 실제 사무실에서 LLM이 7점 온열감 투표를 받아 설정온도를 제안했습니다. 에너지 최대 47.92% 절감을 보고했지만 설정은 사람이 바꿨고, 시행 간 제안 편차가 약 2℃였습니다. | 원문 확인(본문 일부) |
| Kambhampati et al. 2024, ICML (LLM-Modulo) | LLM은 스스로 계획·검증하지 못하므로 외부 모델 기반 검증기와 묶어야 한다는 입장입니다. 우리 구조의 이론적 이름입니다. | 초록 확인 |
| Smit et al. 2024, ICML + Yao et al. 2025 | 다중 에이전트 토론은 self-consistency보다 꾸준히 낫지 않고, 아첨 때문에 조기 합의로 무너집니다. "합의했다"는 품질 근거가 아닙니다. | 초록 확인 |
| Langner et al. 2024, *J. Building Engineering* | 결정적 MPC는 예보·모델 오차 때문에 5실 중 2실에서 허용할 수 없는 온도 위반을 냈고, 계층형·확률형 MPC가 이를 줄였습니다. | 원문 확인 |
| Kim, Cox, Cho, Im 2018, *Energy and Buildings* (VRF 보정) | VRF 모델 보정 전 시간 CV(RMSE) 32.3%·NMBE 10.9%에서 보정 후 15.7%·3.8%로 Guideline 14를 통과했습니다. 실측 비교의 현실적 기대치입니다. | 원문 확인 |

---

## 1. 주제별 문헌

### 1.1 LLM 다중 에이전트: 건물 에너지·HVAC·수요반응, 협상·토론·제안–검증 패턴

#### L1. Office-in-the-Loop: 실사무실 LLM 설정온도 제안 (가장 가까운 현장 사례)
- **제목**: Office-in-the-Loop: an investigation into Agentic AI for advanced building HVAC control systems
- **저자/연도/게재**: Sawada, Mizuno, Hasegawa, Yokoyama, Kono, 2025, *Data-Centric Engineering* 6, e31
- **링크**: https://doi.org/10.1017/dce.2025.10010 · https://www.cambridge.org/core/product/B6CE619AC4EBC5EB1E917F55835B4692 **[원문 확인]** (본문 약 85%를 읽음, 결론 일부 미확인)
- **핵심 결과**
  - 322 m² 사무실, 실내기 7대, 재실자 30명(하루 평균 18.6명)에서 1월 15일~2월 9일, 2월 26일~3월 8일 두 기간 시험했습니다.
  - 재실자는 2시간마다 7점 척도(-3~+3)로 실내기별 온열감을 입력했고, 이 값이 프롬프트에 들어갔습니다. 의견은 구역별로 하루 단위 절댓값 평균을 냈습니다.
  - 기준 운전 대비 에너지 **최대 47.92%(LLM만)**, **34.97%(LLM + 멀티모달 모델)** 절감, 쾌적(의견 RMS 감소) **26.36%** 개선을 보고했습니다. 외기온·재실을 넣은 회귀에서도 절감이 유의했습니다(p < 0.05).
  - **설정은 LLM이 직접 바꾸지 않았습니다.** 예측된 설정온도를 재실자가 온도조절기로 입력했고, 운영자가 안전을 위해 다시 확인했습니다.
  - 같은 입력에서도 시행마다 예측이 **약 2℃** 달랐고(self-consistency IQR 약 2℃), 10회 추론의 최빈값을 썼습니다. 한 모델은 실제로는 꺼져 있는데 켜라고 자주 답했습니다.
- **우리 설계와의 관계**
  - 7점 투표 → LLM → 설정온도라는 흐름은 우리와 거의 같습니다. "LLM 설정 제안이 현장에서 쓰인 사례가 있다"는 근거가 됩니다.
  - 그러나 현장 근거는 **사람이 적용하는 추천 모드**까지입니다. 우리 자동 모드는 이 연구보다 한 단계 더 나갑니다.
  - 시행 간 2℃ 편차는 우리가 LLM 제안을 정책 범위·0.5℃ 격자로 자르고, 판정을 결정적으로 하는 이유를 뒷받침합니다.

#### L2. Conversational Demand Response: LLM 에이전트 두 개가 자연어로 협상
- **제목**: Conversational Demand Response: Bidirectional Aggregator-Prosumer Coordination through Agentic AI
- **저자/연도/게재**: El Makroum, Zwickl-Bernhard, Kranzl, Auer, 2026, arXiv:2603.06217
- **링크**: https://arxiv.org/abs/2603.06217 **[초록 확인]**
- **핵심 결과**: 수요반응 사업자 에이전트와 가정 HEMS 에이전트가 자연어로 유연성 요청을 주고받습니다. HEMS는 **최적화 도구를 호출**해 이행 가능성과 손익을 계산합니다. 상호작용은 12초 안에 끝났고, 코드는 공개됐습니다. 개념 검증 수준이며 실증은 없습니다.
- **우리 설계와의 관계**: "두 이해관계자 에이전트 + 도구가 계산한 숫자"라는 구조가 같습니다. 이 논문도 협상의 가치를 최적성보다 **투명성·설명·사용자 참여**에서 찾습니다. 우리 발표도 같은 논리로 서는 편이 안전합니다.

#### L3. LLMs for Agentic Home Energy Management: 결정적 검증기 없이는 위험
- **저자/연도/게재**: Jonah, Moses, Babatunde, Ajao-Olarinoye, Bammeke, 2026, arXiv:2607.04569
- **링크**: https://arxiv.org/abs/2607.04569 **[초록 확인]**
- **핵심 결과**: 도구를 호출하는 ReAct 에이전트로 가전 일정을 짜고, LLM 5종을 MILP 최적해와 비교했습니다. 7일 운영에서 타이머와 MILP 사이 절감 여지의 **96.7~98.0%**를 얻었습니다. 그러나 **지어낸 일정, 지키지 못한 약속, 설명은 맞는데 잘못된 일정을 확정하는 실패**가 나왔고, 저자들은 **모든 일정을 독립된 결정적 검증기로 확인한 뒤에만 실행**하라고 결론냅니다.
- **우리 설계와의 관계**: 우리 `_clean_proposal`(정책 범위·0.5℃ 반올림)과 재시뮬레이션이 이 권고를 따릅니다. 다만 **메시지 안의 수치**는 검증하지 않습니다(2.3절).

#### L4. OptAgent: 물리 기반 환경 + 전문 에이전트 11개
- **저자/연도/게재**: Jiang, Xu, Dong, 2026, arXiv:2601.20005
- **링크**: https://arxiv.org/abs/2601.20005 **[초록 확인]**
- **핵심 결과**: 물리 기반 ML(PIML) 디지털 환경 위에 전문 에이전트 11개와 MCP 도구 72개를 올렸습니다. 약 4,000회 실행 벤치마크로 지능 모드, 모델 크기, 작업 복잡도, 조율 방식이 정확도·토큰·시간·비용에 주는 영향을 정량화했습니다.
- **우리 설계와의 관계**: "에이전트는 물리 기반 환경과 상호작용한다"는 방향이 같습니다. 이 논문처럼 **같은 작업을 여러 번 돌려 정확도·비용을 재는 평가**가 우리에게는 없습니다(규칙 기반 대비 LLM 협의의 이득을 보여 준 적이 없습니다).

#### L5. LLM은 행동 공간을 줄이고, 수치 최적화는 다른 방법이 맡는 구조
- **Zhong et al. 2026**, Hierarchical Control Framework Integrating LLMs with RL for Decarbonized HVAC Operation, arXiv:2603.26050, https://arxiv.org/abs/2603.26050 **[초록 확인]**
  - 미세조정한 LLM이 실현 가능한 행동 마스크를 만들고, 마스크 안에서 RL이 최적화합니다. 실데이터로 보정한 7구역 사무소 시뮬레이터에서 평균 PPD 7.30%로 DQN 대비 39.1%, 최고 LLM 단독 기준 대비 53.1% 낮았습니다.
  - 저자들은 "LLM 단독으로는 신뢰할 만한 폐루프 수치 최적화를 하지 못한다"고 동기를 밝힙니다.
- **Bhatt et al. 2026**, ThermoLLM, arXiv:2606.22911, https://arxiv.org/abs/2606.22911 **[초록 확인]**: Brick 형식 건물 의미 그래프와 최근 이력을 LLM 맥락에 넣어 5구역 시뮬레이션 6개 시나리오에서 TOPSIS 순위 1위를 보고했습니다.
- **우리 설계와의 관계**: 두 연구 모두 "LLM은 후보를 줄이거나 맥락을 주고, 숫자는 최적화기가 정한다"는 분업입니다. 우리는 후보가 이미 9개뿐이고 시뮬레이터가 모두 계산해 두었으므로(`build_dossier`의 `grid`), **최적화 자체는 전수 계산으로 끝납니다.** LLM 협상이 최적화에 보태는 몫은 작습니다.

#### L6. LLM-Modulo: LLM은 생성기, 검증은 외부 모델이
- **제목**: Position: LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks
- **저자/연도/게재**: Kambhampati, Valmeekam, Guan, Verma, Stechly, Bhambri, Saldyt, Murthy, ICML 2024 (PMLR 235)
- **링크**: https://proceedings.mlr.press/v235/kambhampati24a.html · https://arxiv.org/abs/2402.01817 **[초록 확인]**
- **핵심 내용**: 자기회귀 LLM은 혼자서 계획하거나 **자기 검증**을 하지 못합니다. 대신 근사적 지식원·후보 생성기로 쓰고, 외부의 모델 기반 검증기·비평가·사람과 양방향으로 묶는 LLM-Modulo 구조를 제안합니다.
- **우리 설계와의 관계**: 우리 루프(LLM 제안 → 시뮬레이터 검증 → 다음 턴)는 LLM-Modulo의 사례로 설명할 수 있습니다. 단, 이 구조에서 **판별자는 시뮬레이터**입니다. 상대 LLM 에이전트는 판별자가 아니라 또 하나의 생성기입니다. 설계 문서의 "GAN 생성자·판별자" 비유는 학습이 없다는 점에서도 맞지 않습니다.

#### L7. 외부 피드백 없는 자기 수정은 실패한다
- **제목**: Large Language Models Cannot Self-Correct Reasoning Yet
- **저자/연도/게재**: Huang, Chen, Mishra, Zheng, Yu, Song, Zhou, ICLR 2024
- **링크**: https://arxiv.org/abs/2310.01798 **[초록 확인]**
- **핵심 결과**: 외부 피드백 없이 스스로 답을 고치게 하면 추론 성능이 오르지 않고 때로 떨어집니다. 효과가 있어 보였던 기존 방법은 정답 신호(oracle)를 쓴 경우였습니다.
- **우리 설계와의 관계**: 사용자 에이전트의 반박은 시뮬레이터 결과(외부 피드백)를 받으므로 이 함정을 일부 피합니다. 그러나 반박의 근거 중 "재실자는 이렇게 느낄 것"이라는 부분은 외부 피드백이 아니라 LLM의 추측입니다.

#### L8. 다중 에이전트 토론의 실제 효과와 아첨 문제
- **Smit et al. 2024**, Should we be going MAD? A Look at Multi-Agent Debate Strategies for LLMs, ICML 2024, https://proceedings.mlr.press/v235/smit24a.html · https://arxiv.org/abs/2311.17371 **[초록 확인]**
  - 토론 방식은 지금 형태로는 self-consistency나 다중 추론 앙상블보다 **꾸준히 낫지 않았습니다.** 하이퍼파라미터에 민감하고, 에이전트의 동의 수준을 조절하면 나아졌습니다.
- **Yao et al. 2025**, Peacemaker or Troublemaker: How Sycophancy Shapes Multi-Agent Debate, arXiv:2509.23055, https://arxiv.org/abs/2509.23055 **[초록 확인]**
  - 아첨(과도한 동의)이 토론을 **조기 합의로 무너뜨리고**, 단일 에이전트보다 정확도가 낮아지는 핵심 실패 원인이었습니다. 토론자 쪽과 판정자 쪽 실패가 따로 있었습니다.
- **우리 설계와의 관계**: 우리 판정은 `accepts=true`이고 두 제안이 같으면 **목적함수를 계산하지 않고 그 안을 채택**합니다(`negotiate`의 `agreed` 분기). 같은 모델(Haiku)이 양쪽을 맡으므로 조기 합의 위험이 큽니다. 합의안도 판정 목적함수로 점수를 매겨 함께 보여 주는 편이 안전합니다.

#### L9. LLM 협상의 합리성·공정성
- **Abdelnabi et al.**, Cooperation, Competition, and Maliciousness: LLM-Stakeholders Interactive Negotiation, arXiv:2309.17234, https://arxiv.org/abs/2309.17234 **[초록 확인]** (게재 학회는 확인하지 못했습니다)
  - 점수화한 다자·다쟁점 협상 게임에서 GPT-4급 모델도 성능이 부족했고, 탐욕적·적대적 참가자가 다른 에이전트의 행동을 바꿨습니다.
- **Albayaydh & Zhao 2026**, Do LLM Agents Negotiate Rationally? A Mechanism-Design Framework for Verifiable Multi-Agent Interaction over A2A/MCP, arXiv:2608.14613, https://arxiv.org/abs/2608.14613 **[초록 확인]**
  - 메시지를 규칙(불변식)으로 검증·수정하면 결과 분산이 줄었고, 구조화 프로토콜은 성공률 100%였습니다. 그러나 경매에서 한 모델은 진실한 입찰을 3.3%만 했고, **3자 공정 배분 과제는 4.2%만 쓸 만한 결과**였습니다.
- **우리 설계와의 관계**: 우리 협상은 구조화 출력(JSON 스키마)과 결정적 판정을 갖춰 이 논문의 권고 방향과 맞습니다. 그러나 "LLM끼리 협상하면 공정한 절충에 도달한다"는 주장은 근거가 약합니다. 공정성은 판정 규칙이 보장해야 하고, 그 규칙(가중치)이 명시돼야 합니다.

---

### 1.2 에너지–쾌적 절충: 협상, 다목적 최적화, 쾌적 가중치

#### T1. MACES: 다중 에이전트 + 다목적 MDP (기준 문헌)
- **제목**: Coordinating occupant behavior for building energy and comfort management using multi-agent systems
- **저자/연도/게재**: Klein, Kwak, Kavulya, Jazizadeh, Becerik-Gerber, Varakantham, Tambe, 2012, *Automation in Construction* 22, 525–536
- **링크**: https://doi.org/10.1016/j.autcon.2011.11.012 (서지는 Crossref로 확인) **[스니펫]** (수치)
- **핵심 결과**: 재실자의 회의 일정까지 바꾸는 다목적 MDP 에이전트 시스템으로, 기준 제어 대비 에너지 12% 절감과 쾌적 5% 개선을 보고했습니다(검색 요약 기준).
- **우리 설계와의 관계**: "에너지와 쾌적을 에이전트가 조율한다"는 발상은 2012년부터 있었습니다. 그때도 조율은 **명시된 다목적 목적함수**로 풀었습니다. 우리 새로움은 LLM 대화 자체보다 **자연어 설명과 시뮬레이터 근거를 사람에게 보여 주는 점**입니다.

#### T2. 논증 기반 협상의 현장 시험 (비 LLM)
- **제목**: Agreement Technologies for Energy Optimization at Home
- **저자/연도/게재**: González-Briones, Chamoso, De La Prieta, Demazeau, Corchado, 2018, *Sensors* 18(5), 1633
- **링크**: https://doi.org/10.3390/s18051633 · https://pmc.ncbi.nlm.nih.gov/articles/PMC5982660/ **[원문 확인]**
- **핵심 결과**: 사용자별 선호·허용 범위·성향(안전/중립/경제)을 가진 에이전트가 논증 기반으로 협상하고, 합의가 없으면 협상 관리자가 결정합니다. 같은 구조의 사무실 2곳에서 약 한 달씩 시험해, 실험실의 하루 평균 소비가 44.00 → 36.45 Wh(**-17.15%**)였고 대조실도 약 8% 줄었습니다. 직접적인 쾌적 설문은 없었습니다.
- **우리 설계와의 관계**: "협상이 결렬되면 관리자 규칙이 정한다"는 우리 판정 구조와 같습니다. 이 연구도 대조실이 함께 줄어든 점(계절·휴일 영향)을 보면, 우리 효과를 말할 때 **같은 날씨·같은 재실로 다시 시뮬레이션한 차이**만 쓰는 현재 방식이 맞습니다.

#### T3. 계층형 MPC에서 하위 계층이 "추가 예산"을 요청하는 방식
- **제목**: Hierarchical MPC for building energy management: Incorporating data-driven error compensation and mitigating information asymmetry
- **저자/연도/게재**: Engel, Schmitt, Rodemann, Adamy, 2024, *Applied Energy* 372, 123780
- **링크**: https://doi.org/10.1016/j.apenergy.2024.123780 · https://ideas.repec.org/a/eee/appene/v372y2024ics0306261924011632.html **[초록 확인]**
- **핵심 결과**: 건물 전체 에너지 흐름을 관리하는 aggregator 계층과 구역에 열을 나누는 distributor 계층으로 나눕니다. distributor는 **예산이 부족하면 생길 성능 손실을 보고하면서 추가 열 예산을 요청**하고, aggregator가 이를 저울질합니다(1회 통신). 데이터 기반 오차 보정을 더해, 물리 기반 디지털 트윈 SIL 시험에서 단순 계층형보다 낫고 단일(monolithic) MPC와 비슷했습니다.
- **우리 설계와의 관계**: "관리자 쪽 vs 구역(재실자) 쪽이 수치로 주고받는다"는 우리 협의를 **최적화 언어로 쓴 버전**입니다. 발표에서 "협의 구조는 계층형 MPC의 예산 요청과 같은 발상이며, 우리는 그 주고받음을 사람이 읽을 수 있는 말로 보여 준다"고 설명할 수 있습니다.

#### T4. 쾌적 가중치에 따라 결과가 달라진다
- **제목**: An experimental evaluation of deep reinforcement learning algorithms for HVAC control
- **저자/연도/게재**: Manjavacas, Campoy-Nieves, Jiménez-Raboso, Molina-Solana, Gómez-Romero, 2024, *Artificial Intelligence Review* 57(7), 173
- **링크**: https://doi.org/10.1007/s10462-024-10819-x · https://arxiv.org/html/2401.05737v3 **[원문 확인]**
- **핵심 결과**: 보상은 전력과 쾌적 위반(목표 범위 밖 온도 거리)의 선형 가중합입니다. 쾌적 가중치 25/50/75/100%를 비교했더니 **25% → 50%에서 쾌적 개선이 가장 컸고** 그 뒤로는 효과가 줄었습니다. 쾌적이 좋아지면 대개 전력이 늘었습니다.
- **우리 설계와의 관계**: 우리 `COMFORT_WON = 600`(1 PMV·강의실·일당 600원)은 근거 없이 정한 값입니다. 문헌은 가중치를 여러 개 돌려 **절충 곡선을 보여 주는 것**을 표준으로 씁니다. 2.1절의 우리 계산도 결과가 가중치에 좌우됨을 보여 줍니다.

#### T5. 다목적 RL 벤치마크
- **Liu, Umenberger, Chen 2025**, BEAVER: Building Environments with Assessable Variation for Evaluating Multi-Objective Reinforcement Learning, ICML 2025 CO-BUILD 워크숍, https://arxiv.org/abs/2507.07769 **[초록 확인]**: 기존 다목적 RL은 쾌적·에너지 사이에서 합리적인 절충을 찾지만, 기후·열전달 조건이 바뀌면 성능이 떨어졌습니다.
- **우리 설계와의 관계**: 가중치를 하나로 고정하지 않고 **선호(가중치)를 입력으로 받는 구조**가 연구의 흐름입니다. 우리는 가중치를 운영 규칙에서 바꿀 수 있게 하는 것으로 충분합니다.

#### T6. BOPTEST: 지표를 합치지 않고 따로 보고한다
- **제목**: Building optimization testing framework (BOPTEST) for simulation-based benchmarking of control strategies in buildings
- **저자/연도/게재**: Blum, Arroyo, Huang, Drgoňa, Jorissen, Walnum, Chen, Benne 외, 2021, *Journal of Building Performance Simulation* 14(5), 586–610
- **링크**: https://doi.org/10.1080/19401493.2021.1986574 · KPI 문서 https://ibpsa.github.io/project1-boptest/docs-design/core_kpi.html **[원문 확인]** (KPI 문서)
- **핵심 내용**: 핵심 KPI는 열적 불쾌, 에너지, 피크, CO₂, 운영비, 공기질 위반 등이며 **가중합 점수 없이 따로 보고**합니다. 열적 불쾌는 "쾌적 범위에서 벗어난 온도 편차의 적분"이고 단위는 **K·h/구역**입니다.
- **우리 설계와의 관계**: README의 "불쾌 지표(K·분)"가 BOPTEST 정의와 같은 계열입니다. 판정에 쓰는 쾌적 벌점도 수업 평균 PMV보다 이 지표가 설정온도에 직접 반응하고 설명하기 쉽습니다(2.1절).

#### T7. 쾌적을 돈으로 바꾸는 근거들 (주의해서 쓸 것)
- **Tushar et al. 2017**, Policy design for controlling set-point temperature of ACs in shared spaces of buildings, *Energy and Buildings* 134, 105–114, https://doi.org/10.1016/j.enbuild.2016.10.027 · https://arxiv.org/abs/1610.07687 **[초록 확인]**: 회의실 사용자가 선호 온도를 내고, 선호대로 되지 않은 사람에게 쾌적을 얻은 사람이 보상하는 정책입니다. 쾌적 손실을 **명시적인 금액**으로 다룬 사례입니다.
- **Wargocki, Porras-Salazar, Contreras-Espinoza 2019**, The relationship between classroom temperature and children's performance in school, *Building and Environment* 157, 197–204, https://doi.org/10.1016/j.buildenv.2019.04.046 **[스니펫]**: 18개 연구 메타분석으로 교실 온도 30℃ → 20℃에서 학습 수행이 평균 약 20% 올랐습니다. **어린이, 온대 기후, 20~30℃ 범위**에만 유효합니다.
- **우리 설계와의 관계**: 600원이라는 값을 학습 성과로 정당화하려면 이런 근거가 필요하지만, 대학생·난방 구간(18~22℃)에 바로 옮길 수 있는 근거는 이번 조사에서 찾지 못했습니다. 그래서 "600원은 정책 값이며 바꿀 수 있다"고 말하는 것이 정직합니다.

---

### 1.3 재실자 참여형 쾌적: 투표·불만·개인 모델

#### H1. Thermovote: 참여형 투표로 공조 제어 (기준 문헌)
- **저자/연도/게재**: Erickson, Cerpa, 2012, BuildSys '12, 9–16
- **링크**: https://doi.org/10.1145/2422531.2422534 **[스니펫]**
- **핵심 내용**: 센서 대신 재실자에게 직접 쾌적을 묻고, **PMV 모델 추정과 실제 투표를 맞춰 보정**하는 제어를 BACnet 건물에서 시험했습니다. 39명, 7개 구역, 5개월 시험이었다는 2차 요약이 있으나 원문은 열지 못했습니다.
- **우리 설계와의 관계**: 우리는 PMV(시뮬레이터)와 의견(투표)을 따로 씁니다. Thermovote처럼 **의견으로 강의실별 PMV 편향을 보정**하면, 2.1절에서 본 "의견은 춥다(-1.0)인데 PMV는 -0.46" 같은 불일치를 줄일 수 있습니다.

#### H2. TherMOOstat: 대학 캠퍼스 전체의 학생 의견 (가장 비슷한 환경)
- **제목**: Occupant thermal feedback for improved efficiency in university buildings
- **저자/연도/게재**: Pritoni, Salmon, Sanguinetti, Morejohn, Modera, 2017, *Energy and Buildings* 144, 241–250
- **링크**: https://doi.org/10.1016/j.enbuild.2017.03.048 · https://bies.lbl.gov/publications/occupant-thermal-feedback-improved **[초록 확인]**
- **핵심 결과**: UC Davis 중앙 캠퍼스 어디서나 학생이 온열 의견을 보내는 도구를 운영해 1년에 **10,000건 이상**을 받았습니다. 기존 작업지시(work order) 방식은 느리고 학생이 거의 쓰지 않았습니다. 의견을 에너지관리시스템에 **수동·자동으로 연결**하는 방법을 시험해 효율과 쾌적이 개선됐다고 보고했습니다(세부 수치는 원문 미확인).
- **우리 설계와의 관계**: QR 의견 페이지의 직접 선례입니다. 이 연구는 의견을 **"의미 있는 센서"**로 써서 과열·과냉과 고장을 찾는 데 썼습니다. 우리도 의견을 설정온도 조정 전에 **기기·스케줄 이상 신호**로 먼저 보는 편이 맞습니다.

#### H3. 불만은 대개 제어 불량·고장 신호다
- **Federspiel 1998**, Statistical analysis of unsolicited thermal sensation complaints in commercial buildings, ASHRAE Transactions, https://www.osti.gov/biblio/649422 **[스니펫]**: 상업 건물 690곳의 재실자 약 23,500명 불만을 분석해, 온열 불만이 가장 흔한 불만이고 **주로 제어 성능 불량과 HVAC 고장** 때문이며 개인 선호 차이 때문은 아니라고 봤습니다.
- **Federspiel 2000**, Predicting the frequency and cost of hot and cold complaints in buildings, *HVAC&R Research* 6(4), 289–305, https://doi.org/10.1080/10789669.2000.10391418 **[스니펫]**: 쾌적 범위 경계에서 운전할 때의 에너지 절감과 불만 대응 비용을 저울질하는 모델입니다.
- **Goins & Moezzi 2013**, Linking occupant complaints to building performance, *Building Research & Information* 41(3), 361–372, https://doi.org/10.1080/09613218.2013.763714 **[스니펫]**: 불만 처리 과정이 운영자에게 건물 관리 정보를 준다고 봅니다.
- **우리 설계와의 관계**: 지금은 반복된 "춥다" → 설정온도 +0.5℃가 거의 자동입니다. 같은 강의실 의견이 반복되면 **먼저 실내기 상태·기동 시각·창문 개방을 확인**하라는 안내를 조정안 앞에 두는 것이 문헌에 맞습니다. 또 Federspiel 2000의 틀은 우리 판정의 "쾌적 벌점(원)"을 **불만 대응 비용**으로 해석할 근거가 됩니다.

#### H4. 사람이 원하는 온열감은 '중립'이 아닐 때가 많다
- **제목**: Do people like to feel 'neutral'? Exploring the variation of the desired thermal sensation on the ASHRAE scale
- **저자/연도/게재**: Humphreys, Hancock, 2007, *Energy and Buildings* 39(7), 867–874
- **링크**: https://doi.org/10.1016/j.enbuild.2007.02.014 **[스니펫]**
- **핵심 결과**: **대학 강의**와 주거 자료에서 원하는 온열감이 중립이 아닌 경우가 **57%**였습니다. 원하는 감각은 실제 감각과 상관이 있었습니다.
- **우리 설계와의 관계**: 우리 QR은 감각(-3 춥다 ~ +3 덥다)만 묻습니다. "-1 약간 서늘"이 "더 따뜻하게 해 달라"는 뜻은 아닐 수 있습니다. **선호 질문(더 따뜻하게 / 그대로 / 더 시원하게)**을 한 줄 더하면 조정 근거가 더 정확해집니다.

#### H5. PMV의 실제 정확도
- **제목**: Analysis of the accuracy on PMV – PPD model using the ASHRAE Global Thermal Comfort Database II
- **저자/연도/게재**: Cheung, Schiavon, Parkinson, Li, Brager, 2019, *Building and Environment* 153, 205–217
- **링크**: https://doi.org/10.1016/j.buildenv.2019.01.055 **[스니펫]**
- **핵심 결과**: PMV가 관측 온열감을 맞힌 비율은 **34%**, 평균 절대오차는 약 1 척도 단위였습니다. 척도 양 끝으로 갈수록 정확도가 떨어졌습니다.
- **우리 설계와의 관계**: 설계 문서가 "협의는 PMV 절댓값이 아니라 현재 계획 대비 변화로 판단한다"고 한 선택을 지지합니다. 다만 2.1절처럼 변화량 자체도 작게 나오면 쾌적 쪽 근거가 약해집니다.

#### H6. 개인·집단 쾌적 모델과 집계
- **Kim, Schiavon, Brager 2018**, Personal comfort models – A new paradigm in thermal comfort for occupant-centric environmental control, *Building and Environment* 132, 114–124, https://doi.org/10.1016/j.buildenv.2018.01.023 **[스니펫]**: 집단 평균이 아니라 개인의 쾌적 반응을 예측하는 개인 쾌적 모델을 제안했습니다.
- **Jayathissa, Quintana, Abdelrahman, Miller 2020**, Humans-as-a-Sensor for Buildings—Intensive Longitudinal Indoor Comfort Models, *Buildings* 10(10), 174, https://doi.org/10.3390/buildings10100174 **[초록 확인]**: 30명이 2주 동안 스마트워치로 4,378건의 **선호** 응답을 남겼고, 온열 선호 분류 F1(micro)은 64%였습니다.
- **Wang, Cheng, Lu, Lin 2026**, Enhancing thermal comfort in shared building spaces: A group thermal preference framework and optimization strategies, *Building and Environment* 287, 113906, https://doi.org/10.1016/j.buildenv.2025.113906 **[초록 확인]**: ASHRAE Database II로 보면 50~500명 집단은 10명 집단보다 도달 가능한 최대 만족률이 3~14% 낮고, 구성원 선호 온도의 표준편차가 1℃ 커질 때마다 최대 만족률이 약 18% 떨어졌습니다.
- **Shin, Yus, Mehrotra, Venkatasubramanian 2017**, Exploring fairness in participatory thermal comfort control in smart buildings, BuildSys '17, https://doi.org/10.1145/3137133.3137156 **[스니펫]**: 다수결·평균·중앙값 같은 흔한 집계가 일부 재실자에게 불공정할 수 있다고 보고, 공정성을 보장하는 집계를 제안했습니다.
- **우리 설계와의 관계**: 40~70명이 듣는 강의실에서 **2건의 의견**으로 강의실 전체 설정을 바꾸는 것은 표본이 너무 작습니다(`complaint_rooms`: 2건 이상, 평균 ≤ -0.8). 큰 강의실은 누구도 다 만족시킬 수 없다는 점(Wang 2026)도 발표에서 미리 인정하는 편이 좋습니다.

#### H7. 의견 수집 방식: 묻는 시점과 참여 유지
- **Duarte Roa, Schiavon, Parkinson 2020**, Targeted occupant surveys, *Building and Environment* 184, 107129, https://doi.org/10.1016/j.buildenv.2020.107129 **[스니펫]**: 실내 조건이 특정 범위일 때 설문을 보내는 표적 설문으로, 의견과 환경 조건을 효율적으로 연결합니다.
- **Miller, Chua, Quintana, Lei, Biljecki, Frei 2025**, Make yourself comfortable: ... smartwatch-based Just-in-time Adaptive Interventions, *Building and Environment* 284, 113388, https://doi.org/10.1016/j.buildenv.2025.113388 **[초록 확인]**: 103명, 8개월, 마이크로 설문 12,000건 이상을 받았고, 처음 3주 동안 체감 유용성이 8~19% 올랐습니다.
- **Liang, de Nijs, Say, Wang 2025**, Human-in-the-Loop AI for HVAC Management Enhancing Comfort and Energy Efficiency, ACM e-Energy '25, 359–370, https://doi.org/10.1145/3679240.3734587 **[초록 확인]**: 실시간 사용자 의견과 전기요금을 RL에 넣어 비용을 줄이면서 쾌적을 유지했다고 보고했습니다(시뮬레이션).
- **Jung & Jazizadeh 2019**, Human-in-the-loop HVAC operations: A quantitative review, *Applied Energy* 239, 1471–1508, https://doi.org/10.1016/j.apenergy.2019.01.070 **[스니펫]**: 재실·쾌적 기반 HVAC 운영 연구를 5단계 분류로 정리한 리뷰입니다.
- **우리 설계와의 관계**: 자발적 QR 의견은 불편한 사람만 남기기 쉽습니다(우리 시드 의견도 춥거나 더운 경우만 만듭니다). **'괜찮아요' 원탭**과 **수업 중 한 번 표적 질문**을 두면 침묵을 만족으로 오해하는 문제와 불만 편향을 함께 줄일 수 있습니다. 이 편향 자체를 수치로 보여 준 연구는 이번 조사에서 확인하지 못했습니다.

#### H8. LLM을 재실자 대리인으로 쓰는 것의 근거
- **Yang, Siew, Joe-Wong 2024**, An LLM-Based Digital Twin for Optimizing Human-in-the Loop Systems, FMSys 2024 워크숍, https://arxiv.org/abs/2403.16809 **[초록 확인]**: 쇼핑몰의 인구 집단(가족, 노인 등) 행동과 온열 선호를 LLM 에이전트로 흉내 내 RL 환경으로 썼습니다. 실제 사람 자료로 검증하지는 않았습니다.
- **Li 2025**, TCEval: Using Thermal Comfort to Assess Cognitive and Perceptual Abilities of AI, arXiv:2512.23217, https://arxiv.org/abs/2512.23217 **[초록 확인]**: LLM 에이전트의 온열 의견을 ASHRAE·중국 쾌적 DB와 비교하니 정확히 일치하는 비율은 낮았고(±1 PMV 허용 시 방향성은 개선), **PMV 분포가 사람과 뚜렷이 달랐으며 이산 분류는 거의 무작위 수준**이었습니다.
- **Neubauer et al. 2026**(기존 조사 F1), arXiv:2609.05314, https://arxiv.org/abs/2609.05314 **[초록 확인]**: 초록에서 "자율 에이전트 운영과 **검증되지 않은 재실자 대리 모델**은 연구 단계"라고 정리합니다.
- **우리 설계와의 관계**: 사용자 에이전트가 근거로 쓰는 것은 실제 의견 집계, 시뮬레이터 PMV, CO₂뿐이라 위험이 상대적으로 작습니다. 그러나 "학생·교수의 쾌적을 대변한다"는 페르소나 문구는 LLM이 재실자의 체감을 안다는 인상을 줍니다. 발표에서는 **"의견 집계와 쾌적 지표를 대변하는 에이전트"**라고 범위를 좁혀 말하십시오.

---

### 1.4 계층·다중 시간 스케일 계획 (일전·일중 재계획, rolling horizon)

#### P1. 계층형·확률형 MPC: 결정적 계획은 예보 오차에 약하다
- **제목**: Hierarchical-stochastic model predictive control for a grid-interactive multi-zone residential building with distributed energy resources
- **저자/연도/게재**: Langner, Frahm, Wang, Matthes, Hagenmeyer, 2024, *Journal of Building Engineering* 89, 109401 (오픈 액세스)
- **링크**: https://doi.org/10.1016/j.jobe.2024.109401 **[원문 확인]**
- **핵심 결과**
  - 상위 계층은 **24시간 지평·15분 간격**으로 비용 최적 일정을 만들고, 하위 계층은 **2시간 지평·5분 간격**으로 일정을 따라가며 편차를 처리합니다.
  - 겨울 1주 시뮬레이션에서 **결정적 MPC는 5실 중 2실에서 허용할 수 없는 온도 위반**을 냈습니다. 계층형 MPC는 비용을 조금 더 써서 위반을 허용 수준으로 줄였고, 확률형 MPC는 비슷한 효과를 조금 낮은 비용으로 냈으며, 둘을 합친 방식이 위반과 비용 모두 가장 낮았습니다.
  - 측정 자료로 건물 모델을 식별했고, 예보 오차와 **모델 오차를 함께** 다뤘습니다.
- **우리 설계와의 관계**: 우리 1·2·3차 구조(월·주·일 + 매시 재검증)는 "긴 지평의 상위 계획 + 짧은 지평의 하위 보정"이라는 같은 발상입니다. 그러나 우리는 매 차수 **결정적 시뮬레이션**이고, 불확실성은 3차의 "예보–실황 편차 2℃ 이상이면 재계획" 규칙으로만 다룹니다. 이 논문 기준으로는 기동 시각에 **예보 오차 여유**를 두는 것이 다음 단계입니다(기존 조사 A2의 `τ̂ + n·σ̂` 방식과 같습니다).

#### P2. 계층 사이 정보 비대칭
- **Engel et al. 2024**(T3 참고), https://doi.org/10.1016/j.apenergy.2024.123780 **[초록 확인]**: 계층형 MPC는 계층 사이 **정보 비대칭** 때문에 불일치가 생기고, 모델 오차가 이를 키운다고 지적합니다. 하위 계층이 손실을 보고하는 1회 통신과 데이터 기반 오차 보정으로 이를 줄였습니다.
- **우리 설계와의 관계**: 3차(일일)에서 관측한 예보 오차·의견·기동 지연이 **2차·1차 계획의 여유값으로 돌아가는지** 확인해야 합니다. 지금 설계 문서에는 하위 → 상위 전달이 명시돼 있지 않습니다(조정안의 `_covered`는 상위 차수 조정안이 있으면 하위 차수가 겹치지 않게 하는 방향만 다룹니다).

#### P3. 일전 계획 + 실시간 MPC (사무소 냉방)
- **제목**: A Hierarchical Control Framework for HVAC Systems: Day-Ahead Scheduling and Real-Time Model Predictive Control Co-Optimization
- **저자/연도/게재**: Wang, Zhou, Gong, Liu, Liu, 2025, *Energies* 18(23), 6266
- **링크**: https://doi.org/10.3390/en18236266 **[초록 확인]**
- **핵심 결과**: 어텐션 LSTM으로 24시간 냉방 부하를 예측하고, MPC가 PSO로 rolling 최적화를 합니다. TRNSYS 시뮬레이션에서 PID 대비 1주 **9.23%**, 1개월 **8.25%** 절감했습니다.
- **우리 설계와의 관계**: 일전 계획과 실시간 보정을 나누는 구조의 최근 사례입니다. 절감 폭(한 자릿수 %)은 같은 계층 구조라도 **고정 스케줄 대비 55%**처럼 큰 숫자가 주로 "빈 강의실을 끈 효과"에서 온다는 점을 다시 일깨웁니다. 우리 README의 규칙 기반 대비 4.3%가 문헌 범위와 더 비슷한 비교입니다.

#### 기존 조사에서 이어지는 근거 (짧게)
- 예보 기반 MPC의 기준 문헌 Oldewurtel et al. 2012(기존 조사 D3), 건물 MPC 리뷰 Drgoňa et al. 2020(D4)
- 주말 뒤 월요일 기동 예측 오차가 가장 컸다는 Kim et al. 2024(A1): 3차 점검에 "월요일·연휴 다음 날"을 별도 항목으로 두는 근거입니다.

---

### 1.5 LLM 제어의 안전·신뢰: 수치 근거, 환각 점검, 사람 승인, 설명

#### S1. 설명(사고 과정)은 실제 판단 이유와 다를 수 있다
- **Turpin, Michael, Perez, Bowman 2023**, Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting, NeurIPS 2023, https://arxiv.org/abs/2305.04388 **[초록 확인]**: 입력에 편향 신호를 넣으면 모델은 그 영향을 설명에서 말하지 않고 틀린 답을 그럴듯하게 합리화했습니다. 정확도가 최대 36% 떨어졌습니다.
- **Chen et al. 2025**, Reasoning Models Don't Always Say What They Think, arXiv:2505.05410, https://arxiv.org/abs/2505.05410 **[초록 확인]**: 추론 모델이 프롬프트의 힌트를 실제로 쓰고도 그 사실을 드러내는 비율이 대개 20% 미만이었습니다.
- **우리 설계와의 관계**: 우리 `trace`(source → query → finding)는 도구 호출 기록이 아니라 **모델이 JSON 필드에 쓴 자기 보고**입니다. 자료 전체가 처음부터 프롬프트에 들어 있으므로 "어떤 자료를 확인했는지"는 실제 조회 순서가 아닙니다. 화면 이름을 "확인한 근거"로 바꾸고, finding 안의 숫자를 자료와 **자동 대조해 일치한 것만 '확인됨'으로 표시**하면 이 문제를 정직하게 다룰 수 있습니다.

#### S2. 자동화 수준은 기능별로 정한다
- **Parasuraman, Sheridan, Wickens 2000**, A model for types and levels of human interaction with automation, *IEEE Trans. SMC-A* 30(3), 286–297, https://doi.org/10.1109/3468.844354 **[스니펫]**: 자동화를 정보 수집, 정보 분석, 결정·행동 선택, 행동 실행의 4유형으로 나누고 유형마다 수준을 따로 정하라고 제안합니다. 평가 기준은 사람의 수행 결과가 1차, 신뢰성과 잘못된 결정의 비용이 2차입니다.
- **우리 설계와의 관계**: 우리 "자동 / 추천" 스위치는 모든 조정안에 하나의 수준을 적용합니다. 문헌대로라면 **정보 수집·분석(1·2·3차 점검)은 자동**, **작은 설정 변경(의견 기반 0.5℃)은 자동 가능**, **에이전트 협의안처럼 여러 강의실을 한 번에 바꾸는 결정은 승인**으로 나누는 편이 설득력이 큽니다.

#### S3. 실제 건물에서 AI 제어를 돌린 근거와 조건
- **Luo et al. 2022** (DeepMind·Google, Trane), Controlling Commercial Cooling Systems Using Reinforcement Learning, arXiv:2211.07357, https://arxiv.org/abs/2211.07357 **[초록 확인]**: 실제 시설 2곳의 라이브 실험에서 약 **9%와 13%** 에너지 절감을 냈습니다. 평가, 오프라인 자료 학습, **제약 만족**이 주요 과제였다고 밝힙니다.
- **Blum et al. 2022**, Field demonstration and implementation analysis of model predictive control in an office HVAC system, *Applied Energy* 318, 119104, https://doi.org/10.1016/j.apenergy.2022.119104 · https://eta-publications.lbl.gov/publications/field-demonstration-and **[초록 확인]**: 실사무소 2개월 시험에서 기존 제어 대비 HVAC 에너지 약 **40%** 절감, 자료 수집과 제어기 배포가 **각각 모델 작성만큼의 노력**이 들었습니다.
- **Sawada et al. 2025**(L1): LLM 설정 제안은 사람이 적용하고 운영자가 확인했습니다.
- **우리 설계와의 관계**: 실제로 자동 운전까지 간 사례는 학습·최적화 제어기(RL·MPC)이고, 모두 **제약 검사와 기존 제어기로 돌아가는 경로**를 뒀습니다. LLM 제안은 현장에서 아직 추천 단계입니다(Neubauer 2026: 지속 운영 0편). 발표에서 "자동 운전"은 **결정적 엔진의 계획을 자동 적용**하는 것이고, LLM 협의안은 정책 범위 안에서만 움직인다고 구분해 말하십시오.

#### S4. 기존 조사에서 이어지는 근거
- He & Jazizadeh 2025(기존 조사 F5): LLM 에이전트의 **비용 추정 정확도 49%** → 숫자는 도구가 계산해야 합니다.
- Song et al. 2023(F3): 자기 생성 코멘트가 성능을 떨어뜨렸습니다 → LLM이 스스로 채점하는 루프를 두지 않는 근거입니다.

---

### 1.6 디지털 트윈 보정: 시뮬레이션 전력과 실측 전력 비교

#### C1. ASHRAE Guideline 14 기준값
- **출처**: Kim et al. 2018(C2) 본문의 Guideline 14-2014 인용 **[원문 확인]**
- **기준**: 시간 단위 자료는 **NMBE ±10%, CV(RMSE) 30% 이내**, 월 단위 자료는 **NMBE ±5%, CV(RMSE) 15% 이내**면 보정된 모델로 봅니다. 일 단위 기준은 Guideline 14에 없습니다.
- **우리 구현**: `backend/app/lab.py`의 `calibration()`이 이미 이 기준(시간 단위)과 (n−1) 분모 식을 씁니다. 일 단위는 월 기준을 "참고"로 표시합니다. 문헌과 맞습니다.

#### C2. VRF 보정 사례: 현실적인 기대치
- **제목**: Model calibration of a variable refrigerant flow system with a dedicated outdoor air system: A case study
- **저자/연도/게재**: Kim, Cox, Cho, Im, 2018, *Energy and Buildings* 158, 884–896
- **링크**: https://doi.org/10.1016/j.enbuild.2017.10.049 · 수락 원고 https://www.osti.gov/biblio/1409253 **[원문 확인]**
- **핵심 결과**
  - 실내기별 전력·온도·풍량을 **25일**(냉방·난방 기간) 측정하고, EnergyPlus 8.1 소스를 고쳐 실제 VRF-DOAS를 모델링했습니다.
  - 시간 단위 CV(RMSE)·NMBE가 **보정 전 32.3%·10.9% → 보정 후 15.7%·3.8%**, 일 단위는 20.1%·9.6% → 8.7%·0.2%였습니다.
  - 보정 후에도 건물 전체 에너지가 실측보다 **1.9%(78.8 kWh)** 낮았습니다.
  - 저자들은 공조 시스템을 맞추기 전에 **외피 부하(건물 부하)를 먼저 보정**하라고 권합니다.
- **우리 설계와의 관계**: 우리 열모델은 아직 실측으로 보정하지 않았으므로, 첫 비교에서 시간 CV(RMSE)가 30% 안팎으로 나와도 이상하지 않습니다. 순서는 (1) 실온(2R2C)을 먼저 맞추고(기존 조사 C4의 2R2C RMSE 약 0.6 K 참고), (2) 실외기 전력을 맞추는 것이 이 사례와 같습니다.

#### C3. 기준을 통과해도 파라미터가 맞다는 뜻은 아니다
- **Garrett & New 2016**, Suitability of ASHRAE Guideline 14 Metrics for Calibration, *ASHRAE Transactions* 122, 469–477, PDF https://web.eecs.utk.edu/~jnew1/publications/2016_ASHRAE_G14.pdf **[원문 확인]**
- **핵심 결과**: DOE 기준 건물 15종(입력 36~139개)에서 20,000회 이상 보정해 보니, 출력 오차(CV(RMSE), NMBE)와 **입력 파라미터 오차의 상관이 통계적으로 유의하지 않았습니다.** 다른 출력 지표들도 나을 것이 없었습니다.
- **우리 설계와의 관계**: 기존 조사 C2(Brastein 2018, 파라미터 비식별성)와 같은 결론입니다. "Guideline 14를 통과했다"는 **예측이 맞는다**는 뜻이지 R·C 값이 물리적으로 맞다는 뜻이 아닙니다. 발표에서도 그렇게 말하십시오.

#### C4. 보정 리뷰와 연속 보정
- **Chong, Gu, Jia 2021**, Calibrating building energy simulation models: A review of the basics to guide future work, *Energy and Buildings* 253, 111533, https://doi.org/10.1016/j.enbuild.2021.111533 **[스니펫]**: 명확한 지침과 모범 사례가 부족하다고 보고, 재현 가능한 보정 연구를 위한 단계적 접근을 제안합니다.
- **Vera-Piazzini & Scarpa 2024**, Building energy model calibration: A review of the state of the art in approaches, methods, and tools, *Journal of Building Engineering* 86, 108287, https://doi.org/10.1016/j.jobe.2023.108287 **[스니펫]**: 자료 수집, 모델링 방식, 소프트웨어, 보정 기법을 정리한 리뷰입니다.
- **Eneyew, Capretz, Bitsuamlak 2024**, Continuous model calibration framework for smart-building digital twin: A generative model-based approach, *Applied Energy* 375, 124080, https://doi.org/10.1016/j.apenergy.2024.124080 **[초록 확인]**: 미리 학습한 생성형 보정기로 연속 보정을 하며, 시설 전력 CV(RMSE)가 깨끗한 자료 6.33%, 잡음 10.18%, 잡음+결측 10.97%였습니다.
- **Goldfeder & Sipple 2023**, A Lightweight Calibrated Simulation Enabling Efficient Offline Learning for Optimal Control of Real Buildings, arXiv:2310.08569, https://arxiv.org/abs/2310.08569 **[초록 확인]**: 장치 127개인 2층 건물에서 운영 데이터로 시뮬레이터를 보정해 **6시간 동안 실온 편차 약 0.5℃**를 얻었습니다(Google `sbsim`).
- **우리 설계와의 관계**: 전력만이 아니라 **실온 추적 오차(℃)**도 함께 보고하는 것이 최근 디지털 트윈 연구의 기준입니다. 우리 계획의 핵심(예열 시각, 관성 정지)은 실온 예측에 달려 있기 때문입니다.

---

## 2. 우리 설계 평가

### 2.1 우리 계산: 판정 가중치와 쾌적 지표의 민감도 **[우리 계산]**

- **방법**: 저장소 코드를 임시 로컬 저장소와 `data/cache/weather_sources.json`으로 실행했습니다(테스트 `test_v5.py`와 같은 설정, Bedrock 미사용). 기준일은 **2026-11-18, 3차(하루)**, 수업 있는 강의실 9곳입니다. `build_dossier`가 만든 설정온도 격자(18~22℃, 0.5℃ 간격)에서, 판정 함수 `_room_score`의 `COMFORT_WON`만 바꿔 강의실마다 **전체 격자의 최소 점수**를 골랐습니다. 파일은 수정하지 않았습니다.
- **주의**: 하루, 규칙 기반 에이전트 결과입니다. 배포 환경이나 다른 날짜에서는 값이 다를 수 있습니다.

| `COMFORT_WON` (원/PMV·강의실·일) | 판정 목적함수의 강의실별 최적 설정온도 (℃) |
|---|---|
| 0, 150 | 9곳 모두 18.0 (406호만 18.5) |
| 300 | 410호 19.0, 나머지 18.0~18.5 |
| **600 (현재)** | 306호 21.5, 410호 22.0, 407호 20.0, 409호 19.5, 나머지 18.0~18.5 |
| 1,200, 2,400 | 306·410호 22.0, 307·406·407호 20.0, 409호 19.5, 나머지 18.0 |
| 사실상 무한대 | 위와 같고 405호만 20.0 |

- 같은 날 규칙 기반 협의의 최종안은 의견 강의실(306·410호) 20.5℃, 나머지 19.5℃였습니다.

**관찰**
1. **가중치가 결과를 정합니다.** 150원 이하면 정책 하한(18℃)으로, 600원이면 의견 강의실만 21.5~22℃로 갈립니다. 600원은 경계에 가깝습니다(예: 407호의 판정 점수는 18℃ 86.1원, 20℃ 84.4원으로 차이가 약 2원입니다).
2. **협의 결과는 판정 목적함수의 최적안이 아닙니다.** 판정은 마지막 두 제안 사이만 보므로, 협의는 사실상 "현재 설정에서 0.5~1℃만 움직이는 보수적 한 걸음(trust region)" 역할을 합니다. 이것은 장점일 수 있지만, 그렇다면 **그렇게 설명해야** 합니다.
3. **쾌적 지표가 설정온도에 거의 반응하지 않습니다.** 306호는 18℃ → 22℃에서 전력 0.70 → 1.46 kWh로 두 배가 되지만 수업 중 평균 PMV는 -0.48 → -0.41(0.07 변화)입니다. 309·310호는 설정온도와 무관하게 전력·PMV가 같았습니다(그날 난방이 필요 없었던 것으로 보입니다). 그 결과 의견 강의실의 "+0.3 PMV 목표"는 격자 안 어디서도 도달할 수 없고, 고르는 설정은 벌점의 작은 차이로 정해집니다.
4. **격자에 비단조 구간이 있습니다.** 406호는 18.0℃ 2.40 kWh, 18.5℃ 1.04 kWh, 405호는 18.0℃ 1.56 kWh, 18.5℃ 2.21 kWh였습니다. 격자는 "모든 강의실에 같은 설정"을 넣고 강의실별 값을 읽으므로(코드 주석: rooms barely interact), 실외기 용량 공유나 기동 시각 이산화가 섞였을 수 있습니다. 원인은 확인하지 않았습니다. 최종안은 다시 시뮬레이션하므로 숫자 자체는 맞지만, **강의실별로 따로 고르는 판정의 가정**은 점검이 필요합니다.
5. 효과가 0인 변경(309·310호 20.0 → 19.5℃)도 조정안·제어 명령이 됩니다. 전력과 쾌적 변화가 없으면 조정안에서 빼는 편이 좋습니다.

### 2.2 맞는 점

| 맞는 점 | 설명 | 근거 문헌 |
|---|---|---|
| LLM은 제안·설명, 수치는 결정적 엔진 | 설정온도 후보는 정책 범위·0.5℃ 격자로 잘리고, 전력·요금·PMV는 모두 시뮬레이터 값입니다. | LLM-Modulo(L6), Neubauer 2026(H8, 기존 F1), Zhong 2026(L5) |
| 매 제안 재시뮬레이션과 결정적 판정 | 자기 수정 대신 외부 검증을 씁니다. 최종안도 다시 계산합니다. | Huang 2024(L7), Jonah 2026(L3), Albayaydh 2026(L9) |
| 구조화 출력과 규칙 기반 대체 | JSON 스키마, Bedrock 실패 시 같은 흐름을 규칙으로 이어 갑니다. | Albayaydh 2026(구조화 프로토콜 100% 성공), Luo 2022(기존 제어기로 복귀) |
| PMV 절댓값 대신 현재 계획 대비 변화 | PMV 절댓값 정확도가 낮다는 점과 맞습니다. | Cheung 2019(H5) |
| '답답함' 의견을 온도 통계에서 분리 | 공기질 신호를 설정온도로 오해하지 않습니다. | Pritoni 2017(H2: 의견을 센서로 쓰기) |
| 0.5℃ 한 단계, 정책 범위 안 | 작은 변경만 자동으로 내보내는 설계입니다. | Parasuraman 2000(S2), Federspiel 2000(H3: 경계 운전의 비용) |
| 월·주·일 재계획 + 매시 갱신 | 긴 지평 계획과 짧은 지평 보정을 나누는 계층 구조입니다. | Langner 2024(P1), Wang 2025(P3) |
| Guideline 14 지표 구현 | 시간 NMBE ±10%, CV(RMSE) 30%를 (n−1) 식으로 계산합니다. | Kim 2018(C2) |

### 2.3 약한 점

| 약한 점 | 왜 문제인가 | 근거 문헌 | 고칠 방향 |
|---|---|---|---|
| **협상이 최적화에 기여한다는 주장** | 후보가 강의실당 9개이고 시뮬레이터가 모두 계산해 두었으므로 전수 계산이 정답입니다. LLM 토론은 단순 방법보다 꾸준히 낫지 않고 조기 합의로 무너집니다. | Smit 2024, Yao 2025(L8), Kambhampati 2024(L6) | 판정이 전체 격자 최적안을 함께 계산해 "참고 최적안 대비 차이"를 표시. LLM 역할은 설명·쟁점 제시로 한정 |
| **합의하면 목적함수를 계산하지 않음** | 같은 모델 두 개가 쉽게 합의합니다. | Yao 2025(L8) | 합의안에도 판정 점수를 매겨 표시 |
| **임의의 쾌적 가중치(600원)** | 결과가 가중치에 좌우됩니다(2.1절). | Manjavacas 2024(T4), BEAVER 2025(T5) | 운영 규칙에서 바꿀 수 있게 하고, 낮음/기본/높음 3개 결과를 함께 표시 |
| **쾌적 지표가 수업 평균 PMV** | 설정온도에 거의 반응하지 않아 쾌적 쪽 근거가 약합니다. MRT를 구조체 온도로 쓰는 한계(설계 문서에 명시)와 겹칩니다. | Cheung 2019(H5), BOPTEST(T6) | 판정 벌점에 강의실별 불쾌 지표(K·분, 엔진의 `discomfort_dm`)를 쓰거나 병기 |
| **의견 2건으로 강의실 설정 변경** | 40~70명 강의실에서 표본이 너무 작고, 자발적 의견은 불만 쪽으로 치우칩니다. 감각 척도는 선호와 다릅니다. | Humphreys & Hancock 2007(H4), Wang 2026, Shin 2017(H6), Federspiel 1998(H3) | 최소 표본·서로 다른 수업 2회 이상·응답률 표시, '괜찮아요'·선호 질문 추가, 고장 점검 먼저 |
| **PMV와 의견을 맞추지 않음** | 306호는 의견 평균 -1.0, 시뮬레이터 PMV -0.46으로 어긋납니다. | Thermovote(H1), Kim 2018 개인 쾌적 모델(H6) | 강의실별 "의견 − PMV" 편차를 누적해 PMV 보정값으로 사용(발표 뒤 과제) |
| **사용자 에이전트 = 재실자 대변** | LLM은 사람의 온열 반응을 잘 흉내 내지 못합니다. | TCEval 2025, Neubauer 2026(H8) | "의견 집계·쾌적 지표를 대변"으로 문구 수정 |
| **사고 과정 trace의 충실성** | 모델의 자기 보고이며 실제 조회 기록이 아닙니다. 메시지 속 수치는 검증하지 않습니다. | Turpin 2023, Chen 2025(S1), He & Jazizadeh 2025(기존 F5) | 이름을 "확인한 근거"로, 숫자 자동 대조 후 일치만 '확인됨' 표시 |
| **"GAN 생성자·판별자" 비유** | 학습이 없고, 판별자는 상대 에이전트가 아니라 시뮬레이터입니다. 심사에서 반박당하기 쉽습니다. | Kambhampati 2024(L6) | "제안–검증 루프(LLM-Modulo)"로 부르기 |
| **예보 불확실성을 결정적으로 처리** | 결정적 계획은 예보·모델 오차로 일부 실에서 쾌적 위반을 냅니다. | Langner 2024(P1), Kim 2024(기존 A1) | 기동 시각에 예보 오차 여유(n·σ), 월요일·연휴 다음 날 별도 점검 |
| **하위 → 상위 차수 정보 전달 불명확** | 3차에서 본 오차가 1·2차에 반영되지 않으면 같은 실수가 반복됩니다. | Engel 2024(P2) | 3차 관측 편차를 2차 계획의 여유값으로 넘기는 규칙 명시 |
| **자동 모드가 모든 조정안에 같은 수준** | 현장 LLM 연구는 사람이 적용했고, 자동 제어 사례는 제약 검사와 복귀 경로를 뒀습니다. | Sawada 2025(L1), Parasuraman 2000(S2), Luo 2022(S3) | 에이전트 협의안은 기본 승인, 자동은 한 단계·하루 1회, 되돌리기 제공 |
| **실측 비교의 범위·절감 산정** | 건물 전체 계량에는 조명·PC가 섞입니다. `lab.py`의 `saving_vs_measured_pct`는 실측(현재 운전)과 시뮬레이션(AI)을 섞어, 모델 편향(NMBE)이 그대로 절감에 들어갑니다. Guideline 14 통과가 파라미터 정확성을 뜻하지도 않습니다. | Kim 2018(C2), Garrett & New 2016(C3) | 공조(실외기) 전력만 비교, 절감은 보정된 모델끼리(시뮬레이션 현재 − 시뮬레이션 AI)로 표시하고 NMBE를 함께 표기 |

---

## 3. 내일 발표 전에 바꿀 수 있는 작은 개선 Top 5

| 순위 | 개선 | 바꿀 곳 | 예상 시간 | 근거 |
|---|---|---|---|---|
| 1 | **판정을 투명하게**: (a) 합의 여부와 상관없이 전체 격자 최적안을 계산해 "판정 기준 최적안"과 최종안의 전력·쾌적 차이를 함께 표시, (b) `COMFORT_WON`을 운영 규칙(정책)으로 노출하고 화면에 "쾌적 1 PMV·강의실·일 = 600원(정책 값)"이라고 표기, (c) 전력·쾌적 변화가 0인 변경은 조정안에서 제외 | `agents.py` `negotiate`·`_room_score`, `planning.policy` | 1~1.5시간 | Manjavacas 2024, Yao 2025, BOPTEST, [우리 계산] 2.1 |
| 2 | **수치 자동 대조**: 메시지·trace의 숫자를 정규식으로 뽑아 자료 묶음과 해당 턴 시뮬레이터 결과의 숫자 집합과 대조(반올림 허용)하고, 일치하지 않으면 "확인 안 된 수치" 표시. 화면 이름 "사고 과정" → "확인한 근거(모델 작성, 수치 자동 대조)" | `agents.py` `_clean_trace` 뒤, 프론트 `AgentDebate.tsx` | 1시간 | Jonah 2026, He & Jazizadeh 2025, Turpin 2023, Chen 2025 |
| 3 | **의견 → 설정 규칙 보강**: (a) 최소 3건 이상이고 서로 다른 수업 2회 이상, (b) 조정안에 "응답 n건 / 예상 인원 m명" 표시, (c) QR에 '괜찮아요' 원탭과 선호 질문(더 따뜻하게/그대로/더 시원하게) 추가, (d) 조정안 첫 줄에 "실내기 상태·기동 시각 먼저 확인" 안내 | `planning.py` `_feedback_proposals`·`complaint_rooms`, `Feedback.tsx` | 1시간 | Humphreys & Hancock 2007, Wang 2026, Federspiel 1998, Pritoni 2017 |
| 4 | **자동 모드에 안전 범위**: 자동 적용은 의견 기반 0.5℃ 한 단계·정책 범위 안·강의실당 하루 1회로 제한하고, 에이전트 협의안은 자동 모드에서도 기본 `pending`. 적용된 조정안에 "되돌리기" 버튼 | `planning.py` `set_mode`·`apply_adjustment`, 상단 승인 막대 | 1시간 | Parasuraman 2000, Sawada 2025, Luo 2022, Neubauer 2026 |
| 5 | **실측 비교를 문헌대로 표시**: 공조 전력(실외기)만 비교한다고 명시, 판정은 시간 단위 기준, 절감은 "보정된 모델끼리"로 표시하고 `saving_vs_measured_pct`에는 "모델 편향(NMBE x%)이 포함됨" 주석. 가능하면 실온 추적 오차(℃)도 표시 | `lab.py` `calibration`, 랩 화면 | 30분~1시간 | Kim 2018, Garrett & New 2016, Goldfeder & Sipple 2023 |

시간이 부족하면 1(b)·2의 이름 변경·4·5의 문구만 먼저 바꾸고, 나머지는 "다음 단계"로 발표하십시오.

### 3.1 발표에서 쓸 수 있는 주장 (과장 없이)

1. "생성형 AI는 제안과 설명만 맡고, 전력·요금·쾌적 수치는 모두 시뮬레이터가 계산하며 최종 판정은 결정적 규칙이 합니다. LLM은 스스로 계획하고 검증하지 못하므로 외부 검증기와 묶어야 한다는 LLM-Modulo 구조와 같습니다." (Kambhampati et al., ICML 2024)
2. "2026년에 나온 LLM-HVAC 논문 66편 리뷰는 지속 운영 사례가 한 건도 없었고, 검증되지 않은 재실자 대리 모델은 아직 연구 단계라고 정리합니다. 그래서 우리 사용자 에이전트는 실제 의견 집계와 쾌적 지표만 근거로 말합니다." (Neubauer et al., arXiv:2609.05314)
3. "실제 사무실에서 LLM이 2시간마다 7점 온열감 투표를 받아 설정온도를 제안한 연구는 최대 47.9% 절감을 보고했지만, 설정은 사람이 적용했고 같은 조건에서 제안이 약 2℃씩 흔들렸습니다. 그래서 우리는 LLM 제안을 정책 범위와 0.5℃ 단위로 자르고 시뮬레이터로 검증합니다." (Sawada et al., Data-Centric Engineering 6:e31, 2025)
4. "두 에이전트 협의의 가치는 최적해를 찾는 데 있지 않습니다. 후보가 적어 최적안은 판정이 직접 계산합니다. 협의는 비용과 쾌적의 쟁점을 사람이 읽을 수 있는 말로 드러내고, 현재 설정에서 한 걸음만 움직이게 하는 장치입니다." (Smit et al., ICML 2024; Engel et al., Applied Energy 372, 2024) ← Top 5의 1번을 반영했을 때 쓰십시오.
5. "PMV가 실제 온열감을 맞힌 비율은 34%에 그친다는 대규모 분석이 있어, 협의는 PMV 절댓값이 아니라 현재 계획 대비 변화와 실제 의견으로 판단합니다." (Cheung et al., Building and Environment 153, 2019)
6. "대학 강의 자료를 포함한 연구에서 사람들이 원하는 온열감이 '중립'이 아닌 경우가 57%였습니다. 그래서 의견 한두 건으로 바로 바꾸지 않고, 반복된 의견만 정책 범위 안에서 한 단계 반영합니다." (Humphreys & Hancock, Energy and Buildings 39(7), 2007) ← Top 5의 3번을 반영했을 때 "최소 3건"으로 바꿔 말하십시오.
7. "계획을 월·주·일로 나눠 다시 세우는 구조는 긴 지평의 상위 계획과 짧은 지평의 하위 보정을 나누는 계층형 MPC와 같은 발상입니다. 다만 예보 불확실성을 확률적으로 다루지는 않고, 예보와 실황 차이가 2℃ 이상이면 다시 계획합니다." (Langner et al., J. Building Engineering 89, 2024)
8. "실측 전력이 들어오면 ASHRAE Guideline 14 기준(시간 단위 NMBE ±10%, CV(RMSE) 30%)으로 시뮬레이터를 판정합니다. VRF 보정 사례에서도 보정 전 시간 CV(RMSE) 32.3%가 보정 후 15.7%로 내려갔으므로, 첫 비교에서 오차가 크면 먼저 실온과 외피 부하를 맞춥니다." (Kim, Cox, Cho, Im, Energy and Buildings 158, 2018)

### 3.2 발표에서 하지 말 주장

- "GAN처럼 학습한다" → 학습이 없습니다. "제안–검증 루프"라고 하십시오.
- "AI의 사고 과정을 그대로 보여 준다" → 모델이 쓴 설명입니다(Turpin 2023). "AI가 인용한 근거와 그 수치의 확인 결과"라고 하십시오.
- "두 에이전트가 협상해 최적의 절충점을 찾는다" → 판정 규칙과 가중치가 정합니다(2.1절).
- "사용자 에이전트가 학생들의 체감을 대신 판단한다" → 근거가 없습니다(TCEval 2025).
- "Guideline 14를 통과했으니 모델 파라미터가 정확하다" → 예측 정확도만 뜻합니다(Garrett & New 2016).
- "LLM이 건물을 자율 운전한다" → 자동 적용되는 것은 결정적 엔진의 계획과 정책 범위 안의 한 단계 조정입니다.

---

## 4. 참고문헌

이번 점검에서 새로 확인한 문헌입니다. 기존 조사의 문헌은 [literature_review.md](literature_review.md) 부록 2를 보십시오.

**LLM 에이전트·안전**
1. Sawada T., Mizuno M., Hasegawa T., Yokoyama K., Kono M. (2025) Office-in-the-Loop: an investigation into Agentic AI for advanced building HVAC control systems. *Data-Centric Engineering* 6:e31. https://doi.org/10.1017/dce.2025.10010
2. El Makroum R., Zwickl-Bernhard S., Kranzl L., Auer H. (2026) Conversational Demand Response. arXiv:2603.06217. https://arxiv.org/abs/2603.06217
3. Jonah S. et al. (2026) LLMs for Agentic Home Energy Management. arXiv:2607.04569. https://arxiv.org/abs/2607.04569
4. Jiang Z., Xu W., Dong B. (2026) OptAgent: an Agentic AI framework for Intelligent Building Operations. arXiv:2601.20005. https://arxiv.org/abs/2601.20005
5. Zhong D. et al. (2026) Hierarchical Control Framework Integrating LLMs with RL for Decarbonized HVAC Operation. arXiv:2603.26050. https://arxiv.org/abs/2603.26050
6. Bhatt K., Lin X., Amos M., Salim F.D., Hu W. (2026) ThermoLLM. arXiv:2606.22911. https://arxiv.org/abs/2606.22911
7. Kambhampati S. et al. (2024) Position: LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks. ICML 2024, PMLR 235. https://proceedings.mlr.press/v235/kambhampati24a.html · https://arxiv.org/abs/2402.01817
8. Huang J. et al. (2024) Large Language Models Cannot Self-Correct Reasoning Yet. ICLR 2024. https://arxiv.org/abs/2310.01798
9. Smit A., Duckworth P., Grinsztajn N., Barrett T.D., Pretorius A. (2024) Should we be going MAD? ICML 2024, PMLR 235. https://proceedings.mlr.press/v235/smit24a.html · https://arxiv.org/abs/2311.17371
10. Yao B. et al. (2025) Peacemaker or Troublemaker: How Sycophancy Shapes Multi-Agent Debate. arXiv:2509.23055. https://arxiv.org/abs/2509.23055
11. Abdelnabi S., Gomaa A., Sivaprasad S., Schönherr L., Fritz M. Cooperation, Competition, and Maliciousness: LLM-Stakeholders Interactive Negotiation. arXiv:2309.17234. https://arxiv.org/abs/2309.17234
12. Albayaydh W., Zhao R. (2026) Do LLM Agents Negotiate Rationally? arXiv:2608.14613. https://arxiv.org/abs/2608.14613
13. Neubauer A. et al. (2026) Large Language Models for HVAC Operations in Building Energy Systems: A Critical Review. arXiv:2609.05314. https://arxiv.org/abs/2609.05314
14. Yang H., Siew M., Joe-Wong C. (2024) An LLM-Based Digital Twin for Optimizing Human-in-the Loop Systems. FMSys 2024. https://arxiv.org/abs/2403.16809
15. Li J. (2025) TCEval: Using Thermal Comfort to Assess Cognitive and Perceptual Abilities of AI. arXiv:2512.23217. https://arxiv.org/abs/2512.23217
16. Turpin M., Michael J., Perez E., Bowman S.R. (2023) Language Models Don't Always Say What They Think. NeurIPS 2023. https://arxiv.org/abs/2305.04388
17. Chen Y. et al. (2025) Reasoning Models Don't Always Say What They Think. arXiv:2505.05410. https://arxiv.org/abs/2505.05410
18. Parasuraman R., Sheridan T.B., Wickens C.D. (2000) A model for types and levels of human interaction with automation. *IEEE Trans. SMC-A* 30(3):286–297. https://doi.org/10.1109/3468.844354
19. Luo J. et al. (2022) Controlling Commercial Cooling Systems Using Reinforcement Learning. arXiv:2211.07357. https://arxiv.org/abs/2211.07357
20. Blum D. et al. (2022) Field demonstration and implementation analysis of model predictive control in an office HVAC system. *Applied Energy* 318:119104. https://doi.org/10.1016/j.apenergy.2022.119104

**에너지–쾌적 절충·계층 계획**
21. Klein L. et al. (2012) Coordinating occupant behavior for building energy and comfort management using multi-agent systems. *Automation in Construction* 22:525–536. https://doi.org/10.1016/j.autcon.2011.11.012
22. González-Briones A. et al. (2018) Agreement Technologies for Energy Optimization at Home. *Sensors* 18(5):1633. https://doi.org/10.3390/s18051633
23. Engel J., Schmitt T., Rodemann T., Adamy J. (2024) Hierarchical MPC for building energy management. *Applied Energy* 372:123780. https://doi.org/10.1016/j.apenergy.2024.123780
24. Manjavacas A. et al. (2024) An experimental evaluation of deep reinforcement learning algorithms for HVAC control. *Artificial Intelligence Review* 57(7):173. https://doi.org/10.1007/s10462-024-10819-x
25. Liu R., Umenberger J., Chen Y. (2025) BEAVER. ICML 2025 CO-BUILD workshop. https://arxiv.org/abs/2507.07769
26. Blum D. et al. (2021) Building optimization testing framework (BOPTEST). *J. Building Performance Simulation* 14(5):586–610. https://doi.org/10.1080/19401493.2021.1986574 · KPI 문서 https://ibpsa.github.io/project1-boptest/docs-design/core_kpi.html
27. Tushar W. et al. (2017) Policy design for controlling set-point temperature of ACs in shared spaces of buildings. *Energy and Buildings* 134:105–114. https://doi.org/10.1016/j.enbuild.2016.10.027
28. Wargocki P. et al. (2019) The relationship between classroom temperature and children's performance in school. *Building and Environment* 157:197–204. https://doi.org/10.1016/j.buildenv.2019.04.046
29. Langner F., Frahm M., Wang W., Matthes J., Hagenmeyer V. (2024) Hierarchical-stochastic model predictive control for a grid-interactive multi-zone residential building with distributed energy resources. *J. Building Engineering* 89:109401. https://doi.org/10.1016/j.jobe.2024.109401
30. Wang X., Zhou S., Gong Y., Liu Y., Liu J. (2025) A Hierarchical Control Framework for HVAC Systems: Day-Ahead Scheduling and Real-Time MPC Co-Optimization. *Energies* 18(23):6266. https://doi.org/10.3390/en18236266

**재실자 참여형 쾌적**
31. Erickson V., Cerpa A. (2012) Thermovote: Participatory sensing for efficient building HVAC conditioning. BuildSys '12, 9–16. https://doi.org/10.1145/2422531.2422534
32. Pritoni M., Salmon K., Sanguinetti A., Morejohn J., Modera M. (2017) Occupant thermal feedback for improved efficiency in university buildings. *Energy and Buildings* 144:241–250. https://doi.org/10.1016/j.enbuild.2017.03.048
33. Federspiel C. (1998) Statistical analysis of unsolicited thermal sensation complaints in commercial buildings. *ASHRAE Transactions*. https://www.osti.gov/biblio/649422
34. Federspiel C. (2000) Predicting the frequency and cost of hot and cold complaints in buildings. *HVAC&R Research* 6(4):289–305. https://doi.org/10.1080/10789669.2000.10391418
35. Goins J., Moezzi M. (2013) Linking occupant complaints to building performance. *Building Research & Information* 41(3):361–372. https://doi.org/10.1080/09613218.2013.763714
36. Humphreys M.A., Hancock M. (2007) Do people like to feel 'neutral'? *Energy and Buildings* 39(7):867–874. https://doi.org/10.1016/j.enbuild.2007.02.014
37. Cheung T., Schiavon S., Parkinson T., Li P., Brager G. (2019) Analysis of the accuracy on PMV – PPD model using the ASHRAE Global Thermal Comfort Database II. *Building and Environment* 153:205–217. https://doi.org/10.1016/j.buildenv.2019.01.055
38. Kim J., Schiavon S., Brager G. (2018) Personal comfort models. *Building and Environment* 132:114–124. https://doi.org/10.1016/j.buildenv.2018.01.023
39. Jayathissa P., Quintana M., Abdelrahman M., Miller C. (2020) Humans-as-a-Sensor for Buildings. *Buildings* 10(10):174. https://doi.org/10.3390/buildings10100174
40. Wang J., Cheng Z., Lu Y., Lin Z. (2026) Enhancing thermal comfort in shared building spaces. *Building and Environment* 287:113906. https://doi.org/10.1016/j.buildenv.2025.113906
41. Shin E.-J., Yus R., Mehrotra S., Venkatasubramanian N. (2017) Exploring fairness in participatory thermal comfort control in smart buildings. BuildSys '17. https://doi.org/10.1145/3137133.3137156
42. Duarte Roa C., Schiavon S., Parkinson T. (2020) Targeted occupant surveys. *Building and Environment* 184:107129. https://doi.org/10.1016/j.buildenv.2020.107129
43. Miller C. et al. (2025) Make yourself comfortable: smartwatch-based JITAI. *Building and Environment* 284:113388. https://doi.org/10.1016/j.buildenv.2025.113388
44. Liang X., de Nijs F., Say B., Wang H. (2025) Human-in-the-Loop AI for HVAC Management Enhancing Comfort and Energy Efficiency. e-Energy '25, 359–370. https://doi.org/10.1145/3679240.3734587
45. Jung W., Jazizadeh F. (2019) Human-in-the-loop HVAC operations: A quantitative review. *Applied Energy* 239:1471–1508. https://doi.org/10.1016/j.apenergy.2019.01.070

**보정·디지털 트윈**
46. Kim D., Cox S.J., Cho H., Im P. (2018) Model calibration of a variable refrigerant flow system with a dedicated outdoor air system: A case study. *Energy and Buildings* 158:884–896. https://doi.org/10.1016/j.enbuild.2017.10.049 (수락 원고 https://www.osti.gov/biblio/1409253)
47. Garrett A., New J. (2016) Suitability of ASHRAE Guideline 14 Metrics for Calibration. *ASHRAE Transactions* 122:469–477. https://web.eecs.utk.edu/~jnew1/publications/2016_ASHRAE_G14.pdf
48. Chong A., Gu Y., Jia H. (2021) Calibrating building energy simulation models: A review of the basics to guide future work. *Energy and Buildings* 253:111533. https://doi.org/10.1016/j.enbuild.2021.111533
49. Vera-Piazzini, Scarpa (2024) Building energy model calibration: A review of the state of the art in approaches, methods, and tools. *J. Building Engineering* 86:108287. https://doi.org/10.1016/j.jobe.2023.108287
50. Eneyew D.D., Capretz M.A.M., Bitsuamlak G.T. (2024) Continuous model calibration framework for smart-building digital twin. *Applied Energy* 375:124080. https://doi.org/10.1016/j.apenergy.2024.124080
51. Goldfeder J., Sipple J. (2023) A Lightweight Calibrated Simulation Enabling Efficient Offline Learning for Optimal Control of Real Buildings. arXiv:2310.08569. https://arxiv.org/abs/2310.08569

### 부록: 확인하지 못했거나 주의할 항목
- Klein 2012의 12%·5%, Thermovote의 39명·5개월·10.1%, Federspiel 1998의 수치는 검색 요약으로만 확인했습니다.
- Abdelnabi et al.의 최종 게재 학회는 확인하지 못했습니다(arXiv로만 인용).
- Office-in-the-Loop은 본문의 약 85%만 읽었습니다. 기준 기간과 시험 기간의 날씨 차이를 회귀로 보정했다고 했지만, 기간 자체가 달라 절감률을 그대로 옮기기는 어렵습니다.
- 자발적 의견의 불만 편향, 응답 피로(참여율 감소)를 수치로 보여 준 동료심사 연구는 이번 조사에서 찾지 못했습니다.
- 대학생·난방 구간에서 쾌적을 금액(원)으로 환산할 근거는 찾지 못했습니다.
- 2.1절 [우리 계산]은 하루(2026-11-18), 규칙 기반 에이전트 결과이며, 격자 비단조의 원인은 확인하지 않았습니다.
