# Product Review (Goldfish: Zoom-Out + Design Critic) — ThermoPlan, as the panel will see it

Mode: REVIEW of the deployed product, judged the way the 2026 AWS x PNU hackathon panel will see it at tomorrow's (2026-11-21) presentation.
Inputs: live site and API (https://d32ggz3cj7s7bx.cloudfront.net), `README.md`, `docs/design.md` (§12), `docs/evaluation.md`, `docs/demo_script.md`, `docs/research/literature_review.md`, `frontend/screenshots/*.png`, and reads of `backend/` where a number needed explaining.
Bedrock usage during this review: 2 requests (1 × `POST /api/events/parse`, 1 × `POST /api/chat`; the chat made several Sonnet calls internally). Everything else used deterministic endpoints (`/api/summary`, `/api/live?at=`, `/api/day/*`, `/api/whatif`, `/api/consolidation`, `/api/courses`).

**The product changed while I was reviewing it.** At 01:52 KST the summary matched the docs (v8-era numbers). By 01:56 the live engine reported `v11` (`/api/health`), `backend/hvac/*.py` had been modified, and the semester totals, peaks, lead times and consolidation figures had all moved. Unless marked otherwise, the numbers below come from the v11 snapshot (`/api/summary computed_at 2026-11-20T01:56:01+09:00`). That drift is itself finding P0-2.

---

## Verdict

The product covers requirements ①–⑥ and every organizer hint, at least on paper. The UI is polished and easy to read (floor plan, Gantt, validation table, strategy scatter). Deterministic control plus an LLM for interpretation is the right architecture, and the literature review backs it. The panel will not dock points for missing features. They will dock points in four places:

1. **The central claim, "energy saving AND comfort improvement" against the requirement-⑤ rule, is not what the demo shows.** On the demo date (11/20, a cold Friday) the first screen shows AI using 39 % *more* energy than the rule so far that day. AI also uses more than the rule for the whole of next week. Most of the AI-vs-rule energy gap probably comes from an occupancy sensor that only the AI strategy gets and that no document explains.
2. **The numbers are not one set.** README, evaluation, demo script, UI default view and the copilot all quote different figures. The live engine is still changing, and the "semester" headline includes four weeks of forecast and climatology days that move every hour.
3. **The demo is fragile.** Bedrock runs on a 12-hour personal login session copied to EC2, and that session expires before the presentation. All write endpoints are public on the shared instance. Some waits are long: 16 s for consolidation, about 60 s for a copilot answer, about 25 s for image extraction.
4. **The GenAI moments are thin when probed.** The copilot's best "saving" lowers the setpoint to the edge of the comfort band and then reports "쾌적 100 % 유지". The scripted NL-event examples double-book room 405 and nothing notices. The image-import accuracy was measured on images rendered from the same CSV.

None of these needs new IAM permissions. Together they fit in about 10 hours (plan at the end).

---

## Findings

### [P0-1] GenAI features die when the borrowed `aws login` session expires, which happens before the demo
- **Scope:** `infra/ec2-deploy.sh` lines 7–9 and `sync_login()`; `app/ai.py` (`AnthropicBedrock`); `app/store.py` (`ResilientStore`).
- **Finding:** The EC2 host has no instance role. It uses the operator's `aws login` cache, which lasts at most 12 hours according to the script's own comment. The deployment files are timestamped about 01:44 on 11/20, so the session lapses around midday on 11/20, roughly a day before the slot. After expiry, DynamoDB and S3 calls quietly fall back to the local mirror, but every Bedrock call fails. That takes out NL events, image import and the copilot, which is the whole "appropriateness of generative AI" story (25 points) and part of the demo-quality score (30 points). Nothing on screen tells the presenter that credentials are dead until a live call fails.
- **Fix (≈1 h):**
  1. Add "run `ec2-deploy.sh sync-login` ≤ 60 min before the slot, then hit `/api/health`" as step 0 of `docs/demo_script.md`.
  2. Extend `/api/health` with `bedrock_ok` (a cheap `count_tokens` call or a cached last-success timestamp) and the credential expiry time from `boto3.Session().get_credentials()`. Show it as a red/green chip in the header.
  3. Add a replay fallback: persist the last successful result for each scripted prompt (the 3 copilot suggestion chips and the 4 NL chips), keyed by prompt hash. When a Bedrock call raises an auth error, return the cached result labelled "(저장된 응답)". The demo then never shows a stack trace.

### [P0-2] Numbers disagree across README, evaluation, demo script, UI and copilot, and the engine is still changing
- **Scope:** `README.md` "핵심 결과"; `docs/evaluation.md` §1 ("엔진 버전 v8", "16 tests"); `docs/demo_script.md` §1, §5 and §6; Energy page default scope; copilot output.

| Claim | Docs | Live (v11, 01:56–02:00 KST) |
|---|---|---|
| AI vs fixed / manual / rule, semester | 56 % / 22 % / 6 % | 55.0 % / 21.0 % / **4.3 %** |
| Same, to date (UI default "오늘까지") | (not in docs) | 50.5 % / 22.2 % / 9.5 % (screenshot shows 50.8 / 9.8) |
| Peak AI vs rule | 37.1 > 34.2 kW, "피크 분산은 향후 과제" | **24.7 < 24.9 kW** (claim now reversed) |
| Cost fixed → AI | 75.5만 → 32.5만 원 | 75.1만 → 32.7만 원 |
| Pre-heat lead on 11/20 | "16~29분 (410호 29분)" | 18–39 min (410: 39) |
| Consolidation, semester | 59.6 kWh (doc, screenshot) | 59.8 (01:52) → **62.2** (02:00); Friday 18.9 % → 19.6 % |
| Tests | 16 | 22 `def test_` |

- **Finding:** A judge who reads the README and then opens the UI sees different headline numbers. The "학기 전체" totals include 11/21–12/18, computed from KMA, Open-Meteo forecasts and previous-year climatology, so they change with every hourly refresh. The copilot quotes whatever is live, which may not match the slide that is on screen.
- **Fix (≈1 h):**
  1. Freeze the engine version for the event.
  2. Add a small script that reads `/api/summary` and `/api/consolidation` and rewrites the README table, the `evaluation.md` table and the demo-script figures, stamping the snapshot time.
  3. Make the headline the to-date figure (measured weather, 9/1–today). Label "학기 말 예상" as secondary everywhere.
  4. For the presentation window, add a `FREEZE_SUMMARY` env flag that makes `semester_summary()` serve `summary/latest.json` without recomputing.

### [P1-3] The first screen of the demo contradicts the "saving AND comfort" promise
- **Scope:** `frontend/src/pages/Overview.tsx` KPI "규칙 기반 대비" (uses `kwh_so_far` for today); `docs/demo_script.md` anchor "11/20 10:40".
- **Evidence (v11):**
  - `GET /api/live?at=2026-11-20T10:40` gives AI 6.54 kWh against rule 4.71 kWh so far, so the tile reads **"+39 %"**. Over the whole day AI is 37.9 kWh against 35.0 (+8 %).
  - 11/20 is one of 24 of the 75 lecture days where AI uses more than the rule.
  - The copilot's own simulation for next week (11/23–29) gives AI 288.0 kWh against rule 263.8 kWh (+9 %).
  - In winter the AI buys comfort with energy. The "saving" half of the claim against the requirement-⑤ rule only holds in shoulder season.
  - 11/20 is cold, so the demo day never shows requirement ④, deciding *whether* to run. It only shows *when* to start.
- **Fix (≈2–3 h, part of the top recommendation):**
  1. **Compare at equal comfort.** Rule with a 10-min lead is not comfortable on cold mornings: on 11/20 all 5 of its lectures start below 19.5 °C (410 starts at 15.8 °C). Evidence from `POST /api/whatif` for 11/16–20:
     - rule, 10-min lead: 138.6 kWh, discomfort 12.8 K·min
     - rule, 30-min lead: 159.6 kWh, still 2.2 K·min
     - AI: 121.3 kWh, 0 K·min

     So **AI uses 24 % less energy than the lead time a fixed rule would need, and is still more comfortable.** Add rule-20 and rule-30 as points on the existing "전력 vs 쾌적" scatter so the rule forms a frontier and AI sits below it. Replace the Overview tile with a week-to-date comparison at equal comfort.
  2. **Add a 20-second shoulder-season beat** at `?at=2026-11-18T14:00`: AI 6.5 kWh against rule 8.9 so far, and 12.8 against 20.2 kWh for the day, with 6 "가동 생략" and 3 "외기 냉방" decisions on screen. That is requirement ④ made visible.
  3. **Lead with the student-experience number, not "불쾌 지표 99.9 % 감소"** (rule discomfort is only about 1 K·min per session): count lectures that start below 19.5 °C. Rule 163 against AI 48 over the semester; 5/5 against 0/5 on 11/20. (I counted these from `/api/day/*` session `ta_start`.)

### [P1-4] Most of the AI-vs-rule energy gap probably comes from a sensor only the AI gets, and no document names that sensor
- **Scope:** `backend/hvac/engine.py`, `ai_field_controls()` and `simulate_day(..., guard=(st == "ai"))` (around lines 274–278); `docs/design.md` §12 "교수 부재 시 정지".
- **Finding:** No-show (3 %) and early-dismissal (8 %) vacancy auto-off, plus the closed-loop correction ("guard"), apply only to the AI strategy. Rough estimate at about 0.8 kW per occupied room (rule: 2,998 kWh over about 3,700 room-hours):
  - no-show: about 59 sessions × 1.6 h × 0.8 kW ≈ 75 kWh
  - early dismissal: about 157 × 0.25 h × 0.8 kW ≈ 30 kWh

  That is about 105 kWh, the same order as the entire semester AI–rule gap of 130 kWh (v11). So "AI 예측 제어 saves 4–10 % vs rule" may be mostly *vacancy detection*, not *prediction*. Meanwhile prediction adds energy in winter (P1-3). A search of README, design, demo and evaluation for 센서, 출결 or CO2 finds nothing, so the obvious judge question, "how do you know the professor is absent?", has no prepared answer. This is the organizer's own hint.
- **Fix:** The savings-attribution waterfall in the top recommendation. Also:
  - Name the signal, for example 전자출결 체크인 0명, a CO₂ or PIR sensor, or no local remote activity.
  - Give the rule baseline the same sensor in one variant, so the comparison is fair.
  - Label the 3 % and 8 % rates as assumptions on the Energy page.

### [P1-5] Vacancy auto-off breaks the next lecture's pre-heat, and the comfort metric hides it
- **Scope:** `engine.ai_field_controls()` (forced_off runs to the vacated session's end with no re-plan); `simulate.session_comfort()` (comfort is sampled from the end of the first 5-min bucket, but `ta_start` uses the bucket before).
- **Evidence:** Of the AI's 27 to-date lectures that started below 19.5 °C, **14 follow a vacancy auto-off in the same room**. Example: 11/09, room 307. The 15:00 class is a no-show, auto-off runs 15:10–16:30, and the 16:30 class starts at **16.84 °C**. Room 405 the same day starts at 18.36 °C. The Validation page marks these "확인 필요 / not_ready: 시작 시 실내 16.84℃". At the same time, `in_band_minutes = 90/90`, discomfort is 0 and comfort is 100 %. The two pages contradict each other, and the bug sits inside the organizer-hint feature.
- **Fix (≈1.5 h + recompute):**
  - In `ai_field_controls`, end `forced_off` at `next_session_start − lead`, using the existing forward-sim search, or re-run `plan_ai_room` for the remaining sessions from the state at the forced-off time.
  - In `session_comfort`, include the start sample (`k = a//5 − 1`) so comfort and validation agree. All strategies shift slightly, which is fair.

### [P1-6] Unauthenticated writes on a demo instance everyone shares
- **Scope:** `app/main.py`: `PUT /api/settings`, `POST /api/settings/reset`, `POST /api/import/commit` (`scope=all` replaces the whole course DB), `POST /api/import/api` with `commit`, `POST` and `DELETE /api/events`; the copilot "적용" button.
- **Finding:** Judges will get the URL. One click on "적용" for the copilot's 19.5 °C proposal changes every viewer's numbers. It also starts a full-semester precompute in a thread inside the single-worker uvicorn on EC2, which slows every request while it runs.
- **Fix (≈1 h):**
  - Require an `OPERATOR_TOKEN` header on settings, import-commit and delete. Without it, "적용" shows a what-if preview only.
  - Tag visitor-created events with a browser session id and either hide them from others or give them a 2-hour TTL.
  - Add `infra/reset-demo.sh` (seed courses, default settings, 0 events, re-run precompute) and run it before the slot.

### [P1-7] The copilot's "saving" lowers the setpoint to the edge of the comfort band and calls it comfort-neutral
- **Scope:** `app/ai.py` `copilot_system`, `simulate_policy` and `propose_policy`; `service.what_if()`; screenshot `10-copilot-proposal-1920.png`.
- **Evidence:** I asked live: "다음 주에 쾌적도는 지키면서 전기를 더 아낄 방법을 찾아줘" (about 60 s, 6 tool steps). The top proposal was **난방 20.0 → 19.5 ℃**, which equals `comfort_low`, quoted as "288.0 → 264.1 kWh, 쾌적도 100 % 유지, 불쾌지표 0". The in/out-of-band metric cannot see any setpoint at or above the band floor. The engine's own PMV for occupied 11/20 sessions is already −1.0 to −1.6 at 20 °C. A judge will read this as an LLM gaming a metric, which is exactly what the "appropriateness of generative AI" criterion probes. The copilot also wasted a call simulating `ai_max_early_off_min: 15`, which is already the current value, and it mislabels the Friday-only 19.6 % as "학기 기준".
- **Fix (≈1 h):**
  - Make `what_if` return mean occupied temperature, ΔPMV, and °C·min below the *current* setpoint.
  - Add a required `comfort_tradeoff` field to `propose_policy`. Reject setpoint or band changes unless it gives a nonzero ΔT.
  - Tell the system prompt to prefer schedule-level savings (consolidation, event room choice) over comfort-band changes, and always to give the denominator for any percentage.

### [P1-8] The scripted NL-event examples double-book room 405, and the system does not notice
- **Scope:** `hvac/timetable.py` `sessions_for_date` (an `add` event is appended with no overlap check); `service.add_event`; the UI chips in `Data.tsx`; `docs/demo_script.md` §3.
- **Evidence:**
  - "27일 금 14~17시 405호 졸업작품 발표" overlaps 인공지능세미나특강 (Friday 13:30–16:30).
  - "다음 주 수요일 405호 18~21시 캡스톤 특강" overlaps 공학작문및발표 (Wednesday 16:30–18:30).
  - The before/after card in screenshot `07` shows **AI +0.08 kWh**, because the room was already heated. That makes "real-time recalculation" look like a no-op.
  - The live parse (9.2 s) flagged capacity (70 > 60) but suggested "정원이 더 큰 강의실로 변경". No IT관 room holds more than 60.
- **Fix (≈2–3 h; the best creativity gain per hour):** Add a deterministic `check_event()` called from parse and add. It returns:
  - conflicts in the room
  - whether any room fits the capacity
  - ranked alternatives (free, capacity ≥ n, same room type), each with the marginal kWh from simulating that day (engine reuse, about 0.3 s per day)

  Claude only phrases the result, for example: "405호는 18:30까지 수업이 있습니다. 406호로 잡으면 ODU-4F-A가 이미 가동 중이라 +1.1 kWh, 409호면 +3.4 kWh." This turns the event demo into "consolidate scattered lectures" and "find savings by talking to AI" at once.

### [P2-9] Waits break the 3–4 minute demo
- **Evidence:**
  - `GET /api/consolidation` takes **16.3–16.5 s** on every call. It is not cached server-side, and it is the first load of the Energy page.
  - The copilot took about 60 s for one answer.
  - Image extraction takes 21–27 s (evaluation §3).
  - The demo script gives 30–40 s per section.
- **Fix:**
  - Cache consolidation as a blob keyed on the same day fingerprints used for `daysum`.
  - Start the copilot question during the opening and come back to it.
  - Pre-run the image job.
  - Cap scripted questions at 3 tool calls.

### [P2-10] The baseline is stated as fact but is an assumption
- **Scope:** `docs/demo_script.md` §0 ("IT관 10개 강의실은 평일 08:30~22:30 고정 운전 중입니다"); README headline.
- **Finding:** `design.md` §4 calls this an assumed baseline. Under it all 10 rooms run 14 h on every weekday, including Friday when only 5 lectures are scheduled. That alone gives the calendar's "−80~−91 %" Friday cells. A PNU judge who knows rooms run on wall remotes will discount "55 %" and then everything else.
- **Fix:**
  - Lead with "현장 관행(수동 운영) 대비 22 %".
  - Present the fixed schedule as an upper bound, citing 정기범 2014 (30–60 % for timetable-controlled classroom EHPs) from the team's own literature review.
  - Say "가정" out loud in the opener.

### [P2-11] The architecture slide and README describe a system that is not the one running
- **Scope:** README "구성" diagram (Lambda Function URL plus EventBridge); README deploy table ("external (현재)" = local Mac plus Cloudflare tunnel).
- **Finding:** What actually runs is CloudFront and S3, then EC2 with Caddy on sslip.io, a copied personal SSO session, and a systemd timer. Technical implementation and architecture are worth 30 points. Being caught claiming Lambda is worse than presenting EC2 honestly.
- **Fix:**
  - Draw what runs.
  - Add one line on the IAM constraint.
  - Show `infra/template.yaml` as the ready Lambda target. Presented that way it is a strength: the deployment is portable and the app does not depend on the server choice.

### [P2-12] Image import is tested on images rendered from the same data
- **Scope:** `data/samples/timetable_306.png` and `timetable_405.png`; evaluation §3 ("42/42").
- **Finding:** The test images were drawn from the CSV, and every block prints its time ("09:00~10:30"). So 42/42 proves OCR, not reading a timetable grid. Requirement ① ("이미지") will be judged against a real phone photo or a portal screenshot.
- **Fix:**
  - Run one skewed phone photo, or a 학생지원시스템 screenshot with no time text, and report the result honestly.
  - Add a "휴강 공지 캡처/문자 → cancel event" path by reusing `extract` and `parse_event`. That is a real absence signal for the professor-absent hint, and costs about 1 h.

### [P2-13] Per-IP rate limits will throttle a judging table
- **Scope:** `app/main.py` `_rate_limit` (chat 8/min, extract 3/min, keyed by viewer IP).
- **Finding:** Judges on venue Wi-Fi share one NAT address, so several people trying it at once will get 429 errors.
- **Fix:** Raise the limits for 11/21, or key them on a browser session id.

### [P3-14] Smaller inconsistencies a careful judge will notice
- Strategy name: `meta.strategies.ai` = "AI 최적화", but the UI and README say "AI 예측 제어". The copilot's `get_overview` passes the former.
- The Overview shows two different "current" outdoor temperatures (Open-Meteo 2.3 °C and KMA 실황 4.1 °C @ 11/19 22시) whenever the reference time is not the real time, which will always be true on Saturday. Hide or relabel the 실황 card in that case.
- "관성 정지 · 종료 1분 전 정지" is counted as an AI decision even though the rule already stops 5 minutes early (`saved_min` is negative). This inflates "AI 판단 1,681회". Count only decisions that beat the rule, or show "규칙 대비 ±분".
- Consolidation saves 62 kWh, about ₩7k, for the semester. Present it as ODU-hours (Friday 16.3 h → 9.5 h, "3층 실외기 금요일 무가동") rather than kWh, which looks trivial.

---

## Highest-leverage ~10 hours (one AI coding agent, no new IAM)

| # | Work | Hours | Fixes |
|---|---|---|---|
| 0 | **Demo hardening:** sync-login checklist; `/api/health` with Bedrock status and credential expiry; replay fallback for scripted prompts; `OPERATOR_TOKEN` on destructive writes; `reset-demo.sh`; cache consolidation; `FREEZE_SUMMARY` | 2 | P0-1, P1-6, P2-9, P2-13 |
| 1 | **Savings attribution plus equal-comfort comparison (the one big change).** Add feature flags to `plan_ai`/`compute_day` (predictive start/stop, weather skip/economizer, vacancy auto-off) and compute strategy variants in precompute: rule, rule + vacancy sensor, rule-20, rule-30, AI minus weather, AI. That is about 0.3 s per day-run, under a minute per semester. Energy page main chart becomes a waterfall: fixed → rule (requirement ⑤) → +prediction → +weather → +vacancy → AI, with "추운 상태로 시작한 수업 수" underneath. Add rule-20/30 points to the existing scatter. Overview tile becomes week-to-date at equal comfort. | 3.5 | P1-3, P1-4, ⑥ "visually obvious" hint |
| 2 | Fix the vacancy re-plan and comfort sampling, then recompute | 1.5 | P1-5 |
| 3 | `check_event()`: conflicts, capacity, and ranked alternative rooms with marginal kWh; Claude phrases the result; demo chips switched to a conflicting example | 2 | P1-8, "consolidate", "find savings by talking to AI" |
| 4 | Copilot comfort guardrail (ΔT/ΔPMV in what-if, required trade-off field) | 0.5 | P1-7 |
| 5 | Regenerate every doc number from the API; rewrite the demo script: student cold-start opener → 11/20 cold-morning comfort → 11/18 weather skip → event conflict → waterfall → copilot (started at minute 0); architecture slide as deployed; prepared answer to "how do you know the professor is absent?" | 0.5–1 | P0-2, P2-10, P2-11 |

Why item 1 matters most: it turns the panel's three most likely objections into the strongest slide.
- **The strawman baseline:** the waterfall shows the fixed-to-rule share separately and honestly.
- **"Why AI if a rule does 95 % of it?":** prediction and weather get their own bars, plus the comfort-at-equal-energy frontier.
- **"Is the absence detection real?":** vacancy is its own bar, its sensor is named, and the rule gets the same sensor in a variant.

It is also exactly what the organizers asked for: "solve the problem rather than show off tech" and "make the savings visually obvious". It reuses the engine, the summary pipeline and the existing ECharts components; no new service and no new IAM.
