# Zoom-Out Review (Skeptical Architect / Goldfish) — docs/design.md

Mode: REVIEW. Target: `docs/design.md` ("ThermoPlan"). Reviewed against: Task 3 official requirements ①–⑥, organizer advice/talk hints, judging rubric (fitness incl. GenAI appropriateness 25 / creativity 25 / technical incl. AWS GenAI + architecture + demo 30 / impact & presentation 20), and a ~36 h build by a single AI coding agent.

Codebase reuse check: repo is greenfield (`backend/`, `frontend/`, `infra/` empty; only `data/raw/timetable_3_4.csv`). No existing components to reuse; all reuse comments below refer to reusing parts of this design or standard platform features.

Verdict: the problem framing (customer = facility operator, deterministic control + LLM as interface, assumptions labelled) is sound and covers every official requirement on paper. The material risks are (a) scope far beyond what one agent can finish and demo reliably in 36 h, with no cut line, and (b) the four points judges are most likely to attack: where the generative AI matters, whether the savings numbers are credible, whether weather/humidity actually changes anything, and the organizer's own "professor absent" hint.

---

## [P0] No cut line, build order, or demo script for a 36 h single-agent build

**Scope:** §3, §4, §7, §8, §9, §10, "Detailed Implementation Plan".

The plan commits to: 4 strategies, a 2R2C + VRF part-load + ISO 7730 PMV simulator, fault injection, room-consolidation search, 4 Bedrock features (image extraction, NL events, tool-using copilot, daily briefing), 8–9 screens incl. a react-three-fiber 3D view, CloudFront+OAC+S3+Lambda URL+DynamoDB+S3 cache+SSM+EventBridge via hand-written CloudFormation, async semester recompute, and headless-browser verification. Every item is listed at equal weight. The implementation plan is a module list, not a sequence. There is no "what we show if hour 30 arrives and half of this is broken" fallback. The 30-point technical score explicitly includes demo quality. A half-working 8-screen app scores worse than a polished 4-screen one.

**Fix:**
1. Write the 3–4 minute demo script first (see P1 items for its beats) and mark every feature as on-script or off-script.
2. Tier the work. **Tier 1 (must, by ~H16):** CSV → sessions → rule strategy + one baseline → simulator → day gantt + month calendar + savings chart, deployed end-to-end on AWS with the copilot answering one question. **Tier 2:** predictive strategy, weather integration, NL event → recompute with before/after, image import. **Tier 3 (only if green):** 3D, consolidation, PMV, fault injection, briefing, tCO2.
3. Build a vertical slice first (one room, one day, through to a deployed URL), then widen.
4. Keep a local-run fallback and a screen recording of the full demo by H30.

## [P1] Generative AI is peripheral, and the "AI 최적화" label invites "where is the AI?"

**Scope:** §4 (last bullet), §7.

The control decisions are deterministic search over a physics model. That is correct engineering, but it is not "AI" in the sense judges will score, and the LLM's four uses are spread thin. Two of them, the daily briefing and summarisation, are commodity. Judges scoring "appropriateness of generative AI" (25) and "AWS GenAI usage" (part of 30) will ask what breaks if Bedrock is removed. The organizer's talk names the intended pattern directly: "find energy-saving methods by conversing with AI".

**Fix:** Make one GenAI loop the hero and put it on the demo script. Here is the loop:
- The operator asks something like "이번 주 낭비가 큰 곳은?".
- The copilot calls tools to analyse the timetable: fragmentation, short gaps, under-filled evening slots, rooms on the same ODU.
- It proposes concrete policies, e.g. "move Fri 18:00+ 4F classes onto ODU-4F-A" or "lead time 10→20 min on Mondays".
- It runs the simulator what-if tool for each proposal and reports the verified kWh and comfort delta.
- One click applies the proposal as an event or rule, with a before/after view. The LLM proposes, the simulator verifies, and a human approves.

Rename "AI 최적화" to something accurate, such as "예측 최적화 (물리모델 기반)", and say on a slide why the LLM is kept out of the control loop. Judges reward that honesty. Drop the separate daily briefing; make it the copilot's opening message.

## [P1] Savings numbers are self-referential and baseline A is a strawman

**Scope:** §4 strategies 1–2, §5, §9 screen 5.

Every kWh, won, and tCO2 figure comes from a simulator whose parameters are all assumed (2R2C values, COP curves, 2×7.2 kW IDUs, occupancy ratios). Baseline A runs all 10 rooms 08:30–22:30, which will produce a very large headline percentage, and judges in an engineering school will discount it immediately. Baseline B's "+30 min forgot to switch off" is also asserted, not sourced. On comfort, baseline A will likely beat the predictive strategy, so the slide claim "energy saving and comfort improvement together" only holds against B. The doc never states this.

**Fix:**
- Headline the conservative comparisons: predictive vs rule-based (⑤), and predictive vs manual (B). Show A only as context.
- Sanity-check the annual kWh/m² of baseline A against a published Korean university or educational building energy intensity, and state the number.
- Show a sensitivity band (occupancy ±20 %, envelope conductance ×0.5/×2) so savings appear as a range.
- Plot all strategies on one energy-vs-comfort scatter. The predictive strategy should dominate B and the rule-based strategy on both axes; say so explicitly.

## [P1] Weather/humidity integration (requirement ④) will be nearly invisible in this model

**Scope:** §3 ④, §4, §5.

The requirement says to compare the setpoint with outdoor temperature *and humidity*. In the model:
- Outdoor air couples only through about 140 W/K of envelope: 80 W/K direct plus about 57 W/K through the mass node.
- Occupants plus lights add 4–5 kW per lecture room, and about 9 kW in the SW labs.
- The mass node's time constant to outdoors is several days.
- There is no ventilation/outdoor-air term and no latent or humidity state.

As a result, the day's forecast barely changes the plan (it mostly changes COP), "외기가 쾌적 범위면 가동 생략" will rarely fire in an occupied room, and humidity appears in no decision. On the 11-21 demo date (Busan around 10–15 °C), full rooms may well show cooling. Judges will ask why, and why humidity is missing.

**Fix:**
- Add occupancy-proportional ventilation, about 25 m³/h per person ≈ 8 W/K per person. That is about 400 W/K at 50 people, which makes outdoor temperature first-order during class.
- Add a simple RH/dew-point rule: no "skip" and dehumidify mode when outdoor dew point or RH is high. Add a "환기만 / 창문 개방 권장" mode when the outdoor air is inside the comfort band and dry. This economizer idea is a cheap creativity point.
- Before building UI, run the same day under a hot September day and a mild November day side by side. If the plans don't visibly differ, ④ isn't demonstrable.

## [P1] The organizer's explicit hint, "AC must be off when the professor is absent", is not addressed

**Scope:** §3 ⑤, §5 (fault injection), §6.

Cancellations exist only as manually registered 휴강 events. No-shows, early dismissals, and unannounced cancellations are the student-experience scenario the organizer named, and none is modelled. The design already has most of the machinery: fault injection, empty-room detection, and "빈 강의실 10분 뒤 자동 끄기".

**Fix:**
- Add a simulated occupancy signal (door counter or attendance check-in) with seeded no-show and early-dismissal rates.
- Add a rule: no occupancy by start+10 min, or empty for 10 min mid-session, means switch off and alert.
- Count these savings as their own bar in the savings waterfall.
- Optionally, let the LLM turn a pasted 휴강 notice (LMS or KakaoTalk text) into a cancellation event. This ties GenAI to the student story at little cost and reuses the NL event parser.

## [P2] Verification (③) is circular by construction

**Scope:** §5 fault injection, §6.

The simulator executes the plan, so the "actual vs plan" match rate is about 100 % minus the faults the team injected. Judges can call this self-fulfilling.

**Fix:** Present ③ as two checks.
- (a) Plan vs lecture DB: every session is covered, nothing runs outside a plan, and every optimizer deviation (skip, early stop) carries a stated reason.
- (b) Actual log vs plan, where "actual" comes through an import adapter (CSV, as a BMS export would provide) and the simulator is only one source.

In the demo, show an injected fault and the no-show case being caught.

## [P2] Per-day caching conflicts with a multi-day thermal state

**Scope:** §5 (warm-up), §8 "계산과 캐시".

The mass node carries heat across days, so day N's result depends on day N−1's end state. Recomputing only the edited date and caching by `results/{hash}/{date}.json` gives inconsistent results, and the effect of an evening event on the next morning disappears.

**Fix:** Pick one approach and state it.
- Each day starts from a deterministic warm-up of the previous 1–2 days of schedule and weather. This makes days independent and cacheable.
- Or, on an edit, recompute from the edited date to the end of the week.

Time a full-semester pure-Python run early. The optimal-start search costs about 13 rollouts per session, plus gap and early-stop searches. Use the result to decide whether the async recompute is really needed.

## [P2] Copilot latency vs CloudFront + Lambda/Mangum

**Scope:** §7 (copilot with up to 4 tool calls), §8.

A Sonnet tool loop with what-if simulations behind CloudFront (custom-origin read timeout defaults to 30 s) and Mangum (no response streaming) is likely to return 504 live on stage.

**Fix:**
- Set the origin read timeout to 60 s.
- Make what-if tools single-day and cache-backed.
- Use low effort or Haiku for the tool loop.
- Show tool-step progress in the UI, or switch to Lambda Web Adapter with RESPONSE_STREAM.
- Pre-test the exact demo prompts.

## [P2] YAGNI cut list (over-built relative to judging value)

**Scope:** §5, §7, §8, §9.

- **3D building view (react-three-fiber):** high build cost, little information for 10 rooms on 2 floors. Use an SVG/CSS isometric two-floor plan coloured by state and temperature. Do 3D only if Tier 1–2 are done.
- **ISO 7730 PMV:** duplicates the comfort-range metric and needs assumptions the doc doesn't have (air speed, MRT, RH). Cut.
- **Daily AI briefing:** fold into the copilot (see P1).
- **8 (or 9) screens:** collapse to about 5.
  - Home
  - Calendar → day gantt, with mismatches inline (this absorbs screen 4)
  - Room detail as a drill-down
  - Savings
  - Schedule & events
  - Settings move into a drawer.
- **DynamoDB with 6 entity types:** the data is tiny and single-writer. Use one table, or S3 JSON behind the existing storage adapter. Keep DynamoDB only if it is cheap for the agent.

## [P2] Requirement ① image path has no test asset and no accuracy evidence

**Scope:** §2, §3 ①, §7 row 1.

Only a CSV exists. The image-extraction demo needs a real timetable image, for example a rendered PNU timetable or a screenshot. Measuring extraction against the CSV ground truth ("129/129 blocks, 2 corrected in preview") is the strongest "appropriate GenAI" evidence available. Implementation note: Claude Sonnet 5.5 rejects forced `tool_choice` (`any`/`tool`). Use structured outputs (`output_config.format`) for extraction and NL-event parsing.

## [P3] Deployability answer for "how would this run tomorrow?"

**Scope:** §11.

"Adapter boundary only" is fine, but judges scoring impact will ask how this reaches real equipment. **Fix:** add an export of the daily or weekly per-IDU schedule in a VRF central-controller schedule CSV format. That is deployable without BACnet and costs one endpoint.

## [P3] Room consolidation has the wrong decision-maker

**Scope:** §10.

Moving lectures between rooms is a decision for academic affairs (학사/교무), not the facility operator. **Fix:** frame the output as a recommendation report for academic affairs, limited to low-occupancy evening and Friday slots on the same ODU. It is organizer-hinted, so keep it, but in Tier 3.

## [P3] Housekeeping

- The plan says "9장의 화면" while §9 lists 8 items (the copilot is a panel). Reconcile.
- Public, unauthenticated Bedrock-backed API: per-IP limits in a stateless Lambda need a store. Simpler guards: Lambda reserved concurrency, `max_tokens` caps, a daily request counter, and CloudFront OAC to the Function URL so it can't be called directly.
