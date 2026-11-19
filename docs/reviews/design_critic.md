# Design Critic (Goldfish) review: docs/design.md

Mode: REVIEW. Target: `/Users/jeondonghun/HVAC AI/docs/design.md` (whole document).
Target standard: hackathon rubric (GenAI fitness 25, creativity 25, technical implementation/AWS/demo 30, impact/presentation 20); one AI coding agent, ~36 h, ~$200 shared AWS account.

## What I checked

- **Data claims in §2 (line 15):** I re-derived them from `data/raw/timetable_3_4.csv`. All hold: 310 rows, 10 rooms × 31 slots, 129 merged blocks, earliest start 09:00, latest end 22:30, no Saturday classes, gaps of 0 min ×52 and 30 min ×3. Most blocks are 90 min (98 of 129). Friday has only 5 blocks.
- **Calendar facts:** 2026-09-01 is a Tuesday. The holiday list is correct (10/3 falls on a Saturday, so 10/5 is the substitute holiday). 2026-11-27 is a Friday.
- **Physics:** I re-implemented the §5 equations as written (2R2C, ideal thermostat, COP curves) for one 99 m² room. Inputs were 51 occupants, four 90-min classes (09:00–12:00 and 13:30–16:30), and synthetic Busan-like weather (daily mean ±4 K, with means of 24, 19, 13 and 7 °C for Sep, Oct, Nov and Dec). I compared fixed, rule-based and an exhaustive version of the §4 "AI" search. The numbers below come from that quick model. They show direction and order of magnitude, not exact values.
- **Bedrock models:** Claude Sonnet 5.5 and Haiku 5.5 exist. The behaviour notes in finding 12 come from current Claude API reference material.

The input data and the scenario (problem → simulator → validation → savings) are sound. The material issues are below, highest severity first.

---

### 1. [P1] The validation rule marks the system's own plans as mismatches

**Where:** §6 (line 70), together with §4 items 3–4 (lines 43–48).

"Normal" requires the unit to run for ≥ 95% of class time. The rule-based strategy (requirement ⑤) turns off 5 min before the end. A standalone 90-min class is therefore covered only 85/90 = 94.4% of the time and fails.

- From the real CSV, **48 of 129 weekly rule-based lectures fail** on this check.
- Every AI session that uses early stop (up to 15 min) or skip (0% run time) also fails by definition.
- The default view shows the AI strategy, so the calendar's match-rate colours will look broken. This is the requirement ③ screen.

**Fix:** Measure consistency against the plan, not against raw run time. A session is normal when:
- the actual on/off state matches the planned state for ≥ 95% of the planned window, **and**
- Ta at the start is inside the comfort band, **and**
- Ta stays inside the band during the class.

Early-stop and skip sessions are then judged on comfort only. Add a unit test: on an anomaly-free day, rule-based and AI must both score a 100% match rate.

### 2. [P1] Presentation day (2026-11-21) is a Saturday with zero classes

**Where:** line 3 (presentation date) and §9.1 (line 103).

The data has no Saturday classes. On presentation day the "now"-based home screen will show:
- every room off,
- an empty "today" timeline,
- 0 kWh saved and no alerts,
- a briefing about nothing.

Judges who open the URL on the weekend see the same thing.

**Fix:** Add a demo clock: a `?at=YYYY-MM-DDTHH:MM` parameter plus a UI time-travel control, with optional accelerated replay. When today has no sessions, default to the most recent weekday that has classes (for example Thu 11/19 at 10:20). Every "now" computation must read this clock, including the copilot and briefing prompts.

### 3. [P1] Long synchronous requests will time out behind CloudFront

**Where:** §8 (lines 88–92) and §7 (lines 78–83).

- CloudFront's origin response timeout defaults to 30 s and can be raised to 60 s without a quota increase.
- A Python Lambda behind Mangum returns a buffered response. Python has no native response streaming; it needs Lambda Web Adapter.
- **Image extraction:** a full 10-room × 31-slot × 6-day grid is about 129 blocks of JSON, roughly 6–10k output tokens. With adaptive thinking on (finding 12), that will often run past 60 s.
- **Copilot:** up to 4 tool rounds on Sonnet, each possibly running a what-if simulation, can also pass 60 s.
- Either case returns a 504 live on stage.
- §8's "asynchronous semester-wide recompute" has no mechanism. Background threads freeze once the Lambda response is returned.

**Fix:**
- Use a job pattern: `POST /api/jobs` writes a DynamoDB job record and self-invokes Lambda with `InvocationType=Event`; the UI polls `GET /api/jobs/{id}`. Use it for image extraction, the semester recompute and consolidation.
- Extract one weekday column per call, run in parallel.
- Cap copilot what-if tools at a one-day simulation.
- Set the CloudFront origin timeout to 60 s.

### 4. [P1] No ventilation (outdoor-air) load, so seasonal numbers are implausible

**Where:** §5 thermal model (lines 55–58).

The only air path to outdoors is 1/Rao = 80 W/K (windows plus infiltration). A 50–60-person classroom needs about 29 m³/h per person of outdoor air under the Korean building-equipment standard. That is about 9.7 W/K per person, or roughly 500–580 W/K per room, which is 6–7 times the whole envelope conductance. My reproduction, per room-day:

| Case (daily mean) | No ventilation | With 9.7 W/K/person |
|---|---|---|
| Dec (7 °C), rule-based heating | 1.8 kWh | 11.5 kWh |
| Dec (7 °C), afternoon class heating | 0 kWh (occupants self-heat the room) | — |
| Oct (19 °C), free-floating room temperature | 26–30 °C, so cooling all October | — |

- Without ventilation, winter heating comes out about 6× lower and October is in cooling mode throughout.
- Requirement ④ says to skip HVAC when outdoor air is comfortable. That cannot happen when outdoor air has almost no thermal path into the room.
- An HVAC-literate judge will notice either result.

**Fix:** Add one term while the room is occupied: `+ Uvent·(To − Ta)` in the Ta equation, with `Uvent = expected_people × 29 m³/h × 1.2 kg/m³ × 1005 J/kgK / 3600 ≈ 9.7 W/K per person`. Make the per-person rate configurable and label it as an assumed value.

### 5. [P1] On energy, "AI optimization" roughly ties the simple rule; the design doesn't say how its value will be shown

**Where:** §4 (lines 39–50) and §3 ⑥.

My reproduction, using an exhaustive search over start lead (0–60 min) × early stop (0–15 min) × skip, with a perfect model:

| Daily mean | AI vs rule, kWh (no ventilation) | Rule-based discomfort | AI discomfort |
|---|---|---|---|
| 24 °C | −1% | 4 degree-minutes (°C·min) | 0 |
| 19 °C | 0% | 2 degree-minutes | 0 |
| 13 °C | +4% | 0 | 0 |
| 7 °C | +5% | 0 | 0 |

- The structural cause is that the setpoints (20 and 26 °C) sit only 0.5 K inside the comfort band (19.5–26.5 °C). Early stop therefore buys at most about 0–4 min. In cooling season, the rule's own 5-min early off already pushes the room out of the band.
- The 15-min early-stop cap does not matter in practice.
- The AI's real gain is comfort, plus skipping in shoulder seasons. With ventilation added (finding 4), the 13 °C case becomes +39% for AI vs rule because skip turns on.
- If the strategy table puts kWh first, the "AI" row can lose to a three-line rule in front of the judges.

**Fix:**
- Show energy and discomfort together everywhere: a 2-D chart of kWh against degree-minutes.
- Headline the savings against baseline B (today's real practice).
- Frame AI vs rule as "same energy, zero comfort violations, plus skip savings in shoulder seasons".
- Add a fair comparator: the rule with a lead time tuned to match the AI's comfort.
- Do not tune parameters until the AI wins on kWh.

### 6. [P1] No MVP cut line for a 36-hour, single-agent build

**Where:** Detailed Implementation Plan (lines 124–129) and §9.

The plan asks for all of the following at the same priority:
- 8 screens, including a react-three-fiber 3D building,
- 4 strategies, PMV, anomaly injection and room consolidation,
- 4 Bedrock features,
- CloudFormation infrastructure.

If the agent overruns, the demo path may be the part left unfinished.

**Fix:** Write down tiers.
- **T0 (must work):** CSV → sessions → 4 strategies → calendar and Gantt → savings → natural-language event → copilot → deploy.
- **T1:** image import, briefing, anomaly injection, validation heatmap.
- **T2:** PMV, consolidation, 3D. Replace the 3D view with a 2D SVG floor plan unless time is left.

Build in tier order, and deploy at the end of T0.

### 7. [P2] The optimal-start target is unreachable inside the deadband

**Where:** §4 (line 45).

The target "reach setpoint ±0.5 °C by the start time" means 26 ± 0.5 °C in cooling and 20 ± 0.5 °C in heating. If the room is already at 22 °C, the thermostat (line 60) holds fan mode, so Ta never reaches either target. A literal implementation will exhaust the search and pick the 60-min maximum lead, wasting energy on rooms that are already comfortable.

**Fix:** Set the target to `heat_set − 0.5 ≤ Ta(start) ≤ cool_set + 0.5`, which is the comfort band.

### 8. [P2] Weather for dates beyond the forecast horizon is undefined

**Where:** §2 (lines 16–17) and §8 (line 99).

- KMA forecasts cover only about +3 days, so roughly 11/23–12/18 has no data source. That leaves the December calendar, semester totals and cumulative charts without input.
- The Open-Meteo archive normally lags by several days.
- Past dates are planned with the observed weather. The AI therefore has perfect foresight for about 80% of the semester, which overstates its comfort advantage.

**Fix:**
- Use a fallback chain: archive → Open-Meteo forecast with `past_days` → Open-Meteo 16-day forecast → climatology (same dates in 2025 from the archive). Store the source per hour and badge it in the UI as observed, forecast or climatology.
- Optionally, plan past days from Open-Meteo's Historical Forecast API so that plan and actual weather differ.

### 9. [P2] Thermal state carries across days, but caching and recompute are per-day

**Where:** §8 (line 99).

- The mass node has a time constant of about 1.7 days, so the state at the end of one day drives the next day.
- Recomputing only the changed date leaves the following days starting from a stale state, which shows up as visible temperature jumps at midnight.
- The cache key `results/{settings hash}/{date}` ignores the event and weather versions. The "before" copy needed for the before/after comparison is overwritten.
- The hourly EventBridge re-plan of "today" can rewrite history that has already been executed. That contradicts requirement ②'s on/off history.

**Fix:**
- Persist the end-of-day (Ta, Tm) for each room and strategy.
- Recompute forward from the changed date until |ΔTm| < 0.05 K (usually 1–3 days).
- Make the past immutable: re-plan only from "now" (the demo clock) forward.
- Version the result objects (`.../{date}/{rev}.json`) and keep the previous revision for the diff view.

### 10. [P2] Cost control on a public, unauthenticated Bedrock endpoint won't work as written

**Where:** §7 (line 83), §8 and §11.

- Lambda sees CloudFront edge IPs, so a per-IP limit keyed on the source IP throttles everyone or no one.
- Counters held in Lambda memory are per instance.
- With auth type NONE, the Function URL can be called directly, bypassing CloudFront, with any spoofed X-Forwarded-For.
- There is no global spending cap on a shared $200 account.

**Fix:**
- Have CloudFront add a secret origin header, and have Lambda reject requests without it. This avoids the OAC trap where POST requests need a client-computed `x-amz-content-sha256`.
- Key the rate limit on `CloudFront-Viewer-Address`.
- Keep a DynamoDB counter with a daily Bedrock token or dollar cap (for example $10/day) and degrade gracefully when it is reached.
- Set reserved concurrency (check first that the account's unreserved concurrency limit allows it).
- Add an AWS Budgets alarm on the `project=hvac-ai` tag.

### 11. [P2] Result payloads can exceed the Lambda response limit

**Where:** §8 (line 99) and §9.2.

One day of minute-level series is 10 rooms × 4 strategies × 1,440 points × about 6 fields, roughly 3–6 MB of JSON. The buffered Lambda Function URL response cap is 6 MB. The monthly calendar would also need 30 such files per request.

**Fix:**
- Write a precomputed `summary/{hash}.json` with per-day KPIs for the calendar and cumulative charts.
- Store UI series at 5-min resolution.
- Serve result objects directly from S3 through a CloudFront path instead of streaming them through Lambda.

### 12. [P2] Bedrock invocation details that cause failures on demo day

**Where:** §7.

- Claude Sonnet 5.5 and Haiku 5.5 return **400 on forced `tool_choice` (`any` or `tool`)**, a common pattern for structured extraction. Use `output_config.format` (structured outputs), or `auto` with `strict: true`.
- They also return **400 on non-default `temperature` or `top_p`**.
- Adaptive thinking is on by default, and Sonnet's default effort is `high`. Set effort to `low` for chat and briefing to control latency (see finding 3).
- The Haiku model ID is not specified.
- The IAM policy for a `global.` inference profile must also allow the foundation-model ARNs in all destination regions.
- Add a `deploy.sh` smoke test that calls each model once, to confirm model access on the shared account.

### 13. [P2] Generative AI sits outside the scored core, and the demo has no storyline that ties it in

**Where:** §4 (line 50) and §7.

Keeping the LLM out of control is correct engineering. But the 25 GenAI-fitness points depend on judges seeing generative AI do real work.

**Fix:** Script the demo around one end-to-end loop:
1. A photo of a changed timetable, or a natural-language event.
2. Preview, then confirm.
3. That date and the following days are recomputed (finding 9).
4. A before/after diff.
5. The copilot explains why using tool outputs.

Show the copilot's tool-call trace in the panel. Require every number in a copilot reply to come from a tool result, and validate this in the prompt and tests.

### 14. [P3] Constants the formulas need are unspecified

**Where:** §2 (line 24) and §5 (lines 61–63).

- ODU rated capacities are missing, so PLR and g(PLR) are undefined. Suggested defaults: 57.6, 43.2 and 37.8 kW, the sum of each ODU's IDUs.
- No electricity tariff for "원" (educational tariff, and whether the basic demand charge applies).
- No tCO2 emission factor.
- Unclear whether the 300 W ODU base load applies in fan-only mode.
- Anomaly seeds should be identical across strategies, keyed by (date, room, session), so strategy comparisons are not noise.

**Fix:** Put defaults for all of these in the settings, each labelled as an assumed value.

### 15. [P3] Exam weeks are treated as normal timetable weeks

**Where:** §2 (line 22).

The weekly timetable is expanded unchanged across the midterm and final weeks. PNU judges will notice.

**Fix:** Add configurable default events for the exam weeks (mark them as exams or suspend regular sessions), with a visible label in the calendar.
