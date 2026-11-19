# Implementation Readiness Review — docs/design.md

- Persona: Implementation Readiness Goldfish (EGM), Mode: REVIEW
- Target: `docs/design.md`, "Detailed Implementation Plan" (L122–129) plus every section it depends on (§2–§10)
- Constraint assumed: one AI coding agent, ~36 h, AWS ap-northeast-2, Lambda Python 3.13 arm64, local Python 3.14
- Verdict: **Not implementable as written.** 1 × P0, 8 × P1, 6 × P2, 3 × P3.

## Facts checked before review (so findings don't re-litigate them)

- CSV claims hold: 310 rows, 10 rooms × 31 slots, 129 merged blocks (Mon 31 / Tue 33 / Wed 30 / Thu 30 / **Fri 5** / Sat 0), earliest 09:00, latest end 22:30, same-room gaps 0 min ×52, 30 min ×3. Every cell has exactly 3 commas. The file has a UTF-8 BOM.
- KMA grid for (35.2316, 129.0825) → nx=98, ny=77: correct (LCC formula recomputed).
- Calendar: 2026-09-01 is Tue, 2026-12-18 is Fri, 10/3 is Sat (so 10/5 substitute is right), 9/26 is Sat (no Chuseok substitute). That gives 109 calendar days, 75 class days, and **1,962 timetable sessions** before events.
- Open-Meteo archive today returns non-null hourly values up to 2026-11-19T23:00. So the archive's "today" values are model output, not observations.
- A bare 2R2C Euler step in CPython runs at about 0.25 µs locally. Raw engine CPU is not the bottleneck. The real risks are state coupling, payload size, and request-path timeouts.

## Findings

### [P0 | Blocker] F1 — Day-to-day thermal state coupling contradicts per-day recompute and the cache key
- **Scope**: §5 "초기 상태: 학기 시작 7일 전부터 냉난방 없이 워밍업"; §8 "계산과 캐시"; §3⑤ "해당 날짜 즉시 재계산"; Plan item 1 (`simulate.py`, `strategies.py`).
- **Finding**: Warming up from the semester start implies one continuous simulation. Under that reading, day D's 00:00 state (Ta, Tm) is day D−1's 24:00 state for that strategy, and each of the 4 strategies diverges. Three consequences follow. (a) An event on day D invalidates D through 12-18, which contradicts "해당 날짜만 즉시 재계산". (b) The semester precompute has to run strictly in order. (c) `results/{설정해시}/{날짜}.json` silently depends on every earlier day. The core engine signature (`simulate_day(date, ..., initial_state?)`) can't be written until this is decided.
- **Fix**: Make days independent. `simulate_day(date, inputs, strategy) -> DayResult` starts at 00:00 from a state produced by a free-running (no HVAC) warm-up over D−3 00:00 → D 00:00 on actual weather. The warm-up is identical for all strategies and costs about 4.3k steps per room. Document the small error from dropping inter-day HVAC carry-over as an accepted simplification. Per-day recompute, any-order or parallel precompute, and per-day caching then all become valid. If chaining is kept instead, the doc must specify an async forward recompute from D to the semester end, plus its UI state.

### [P1 | Major] F2 — The validation rule marks the system's own plans as non-compliant
- **Scope**: §6 vs §4.3 and §4.4; Plan `validate.py`.
- **Finding**: "수업 중 가동률 ≥ 95%" is measured over the lecture window.
  - Rule strategy: off 5 min early on a 90-min block (98 of the 129 blocks are 90 min) gives 85/90 = 94.4%, which is flagged as `수업 중 꺼짐`.
  - AI early stop of up to 15 min gives 83%.
  - "가동 생략" sessions have 0% runtime.

  The sentence "켜져 있거나(…), 가동률 ≥ 95%" also leaves AND/OR open, and the doc never says which strategy is validated. The headline 일치율 KPI would come out wrong by construction.
- **Fix**: Validate the applied strategy only. A session is 정상 iff all of the following hold:
  1. No command failure.
  2. At lecture start the IDU is ON or Ta is within the comfort range.
  3. The actual ON-state matches the **planned** ON-state for ≥95% of the planned window (plan vs actual, not lecture window).
  4. Ta stays within comfort for ≥95% of lecture minutes.

  A planned early-off or skip is compliant when (4) holds. Define "가동" as IDU power ON, including fan mode. Baselines get KPIs only, no validation.

### [P1 | Major] F3 — Request-path timeouts: CloudFront origin timeout vs Bedrock and recompute calls
- **Scope**: §7 (copilot with up to 4 tool calls, Sonnet image extraction), §8 diagram (CloudFront → Function URL → FastAPI/Mangum), §8 async recompute.
- **Finding**: The CloudFront origin read timeout defaults to 30 s, and 60 s is the maximum without a quota request. A Sonnet 5.5 copilot turn with up to 4 tool rounds (default effort `high`), or a dense timetable image extraction with thousands of output tokens, will regularly exceed that and return a 504. Mangum can't stream, because Function URL response streaming is native only on Node and Python would need Lambda Web Adapter. The doc says the semester recompute is "비동기" but gives no mechanism.
- **Fix**:
  - Template: `OriginReadTimeout: 60`. Lambda timeout 900 s and memory ≥ 2048 MB (for jobs), but an app-level HTTP deadline of about 50 s.
  - Async job pattern for image extraction, full recompute, consolidation and precompute: `POST` creates a DynamoDB job item (`status=queued`), then `lambda.invoke(InvocationType="Event", Payload={"job":..., "job_id":...})`, and the client polls `GET /api/jobs/{id}`.
  - Self-invoke IAM: give the function a fixed `FunctionName: hvac-ai-api` and grant `lambda:InvokeFunction` on `!Sub arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:hvac-ai-api`. This avoids the GetAtt circular reference.
  - Copilot: effort `low`, cap `max_tokens`, ≤4 tool rounds, and a 45 s wall-clock budget that returns a partial answer.

### [P1 | Major] F4 — Cache invalidation holes and no defined async recompute lifecycle
- **Scope**: §8 "계산과 캐시", §3⑤ "변경 전후 비교", §8 hourly scheduler "오늘·내일 재계획".
- **Finding**:
  - The key `results/{설정해시}/{날짜}.json` leaves out lectures (timetable import), events, and weather version. An import or a weather refresh leaves stale results under the same key.
  - A settings change creates a new hash, so every read misses until the full recompute finishes. The read path for that window is undefined.
  - Event recompute overwrites the day in place. That loses the "before" needed for 전후 비교, and it races with a running full recompute that may have read the events before the change.
  - The hourly replan rewrites today, including hours whose commands already "executed".
- **Fix**:
  1. The DynamoDB settings item holds `active_hash` and `pending_hash`. Reads always use `active_hash`. A full recompute writes under `pending_hash`, tracks progress (n/109) in the job item, and flips the pointer when done.
  2. Every day JSON stores `input_fp = sha256(settings_hash, lectures_version, events_for_date, weather_version_for_date)`. On mismatch, the reader recomputes that day synchronously, which is cheap once F1 is applied.
  3. Before overwriting a day for an event change, write a change-log item with before/after summaries: kWh, cost, comfort, and per-room ON windows.
  4. After a full recompute, re-run any day whose `input_fp` changed during the run.
  5. In the hourly job, freeze commands with `ts < now` (an `executed[]` array in today's JSON) and replan only the remainder.

### [P1 | Major] F5 — The source of truth for "이력" is split between DynamoDB and S3
- **Scope**: §3② "이력을 DB에 저장", §8 diagram (DynamoDB: 이력; S3: 결과 캐시), Plan item 2 (storage adapter).
- **Finding**: Device history is a deterministic function of settings and inputs, for 4 strategies × 109 days, which comes to tens of thousands of items. Writing it to DynamoDB duplicates S3, and every settings change or event leaves it stale or inconsistent. There is no rule for which store the UI "IDU/ODU 이력 표" reads from.
- **Fix**: Keep only user-authored and external state in DynamoDB: lectures, events, settings (+ active_hash), change log, weather fetches, jobs, rate-limit counters. Device transitions (`ts, device, state, mode, setpoint, cause`) go inside the S3 day JSON, and the UI reads them there. If a DynamoDB history is wanted for the story, the hourly job writes only today's applied-strategy transitions idempotently (`PK=HIST#{date}`, `SK={ts}#{device}`).

### [P1 | Major] F6 — Result payload size, and no aggregate store for calendar and savings screens
- **Scope**: §8 cache format; §9 screens 2, 4, 5; Plan item 2.
- **Finding**: Per-minute output for 10 rooms × 4 strategies × 1,440 min × about 6 series is roughly 345k numbers per day, or 2–6 MB of JSON. The Function URL response limit is 6 MB. The month calendar would read 30 objects per request, and the semester savings, heatmap and cumulative charts would read 109.
- **Fix**: Write two artifacts per day, plus a semester index:
  - `results/{hash}/day/{date}.json`: 5-min resolution, columnar arrays, gzip.
  - A compact summary row: per date × strategy, with kWh, 원, tCO2, comfort %, match rate, and per-factor savings.
  - A semester index (`results/{hash}/summary.json`, or DynamoDB `PK=SUM#{hash}, SK={date}`), updated after each day write.

  Calendar, validation-heatmap and savings endpoints read only the summary.

### [P1 | Major] F7 — No weather source for most future semester days; KMA has no solar radiation
- **Scope**: §2 weather table, §8 "과거=실측 archive, 오늘·미래=기상청 예보", `weather.py`.
- **Finding**: KMA 단기예보 reaches about +3 days, but the semester runs to 12-18, about 29 days ahead. Calendar and savings for roughly 11-23 to 12-18 have no defined input. The model needs horizontal irradiance for Qsol, and KMA forecasts don't provide it.
- **Fix**: Specify the source by variable and horizon:
  - **To/RH**: past days → Open-Meteo archive. Today to +3 → KMA, with each fetch stored as `WX#{date}` with `issued_at`. +4 to +15 → Open-Meteo forecast. Beyond that → climatology, meaning the same calendar date from the 2025 archive, labeled "기후값" in the UI.
  - **Radiation**: always Open-Meteo `shortwave_radiation`.
  - **"실측" for today**: stored hourly KMA 초단기실황.

  Interpolate hourly data to 1 min linearly.

### [P1 | Major] F8 — No interface contracts: API, entities, event semantics, DynamoDB keys
- **Scope**: Plan items 1, 2 and 4; §3①⑤; §7; §10 "실제 반영은 이벤트(강의실 변경)".
- **Finding**: The doc defines no endpoint list, no request/response schemas, no "표준 스키마" for imports, no `Session`/`Event`/`DayResult` types, and no table keys. Event-type semantics are undefined: what 휴강, 보강, 행사, 시험 and 휴관 each do to sessions, and how an event targets a session. Yet the Haiku NL-parse output schema, recompute, consolidation and the frontend all depend on them. A single agent will invent these inconsistently across backend and frontend.
- **Fix**: Add a contracts appendix. Minimum content:
  - `Lecture{lecture_id="{code}-{section}", name, code, section, professor(strip), major, year_level∈{1..4,전학년,대학원}, room, weekday 0–5, start_min, end_min}`
  - `Session{session_id="{date}:{room}:{start_min}:{lecture_id|event_id}", date, room, start_min, end_min, expected_people, source∈{timetable,event}}`
  - `Event{event_id, type∈{cancel,makeup,extra,exam,closure,room_change}, date, start_min, end_min, room?, to_room?, people?, target_session_id?, note, source∈{form,nl}}`
    - Rules: cancel removes its target session. makeup/extra/exam add a session. closure removes every session in its scope. room_change moves its target session.
  - The `DayResult` JSON layout from F6.
  - Endpoints:
    - Rooms, lectures, events: `GET /api/rooms`, `GET /api/lectures`, `POST /api/import/preview`, `POST /api/import/commit`, `GET|POST|DELETE /api/events`, `POST /api/events/parse`.
    - Results: `GET /api/days/{date}`, `GET /api/calendar?month=`, `GET /api/validation?from&to`, `GET /api/savings?from&to`.
    - System: `GET|PUT /api/settings`, `GET /api/jobs/{id}`, `GET /api/now`, `GET /api/weather`.
    - AI and planning: `POST /api/copilot`, `GET /api/briefing?date=`, `GET /api/consolidation`.
  - A single table `hvac-ai-main` with PK/SK patterns and a `ttl` attribute.

### [P1 | Major] F9 — No sequencing or cut line for a 36-hour single-agent build
- **Scope**: Plan items 1–6 as a whole.
- **Finding**: Scope covers 9 engine modules, 8 screens (including a react-three-fiber 3D view), 4 Bedrock features, PMV, consolidation, anomaly injection and a waterfall. There is no order, MVP definition, or list of cuttable items. That makes "nothing deployed at hour 30" a real outcome.
- **Fix**: Add milestones with exit criteria:
  - **M0 (≤4 h)**: walking skeleton deployed (CFN stack, `/api/health` via CloudFront, SPA from S3).
  - **M1 (≤14 h)**: parser, 4 strategies, precompute, calendar and day Gantt.
  - **M2 (≤22 h)**: validation, savings, form events, settings.
  - **M3 (≤30 h)**: NL events, copilot, briefing, image import.
  - **M4 (stretch)**: 3D view (fallback: 2D SVG floor plan), consolidation, PMV.

### [P2 | Major] F10 — CloudFront ↔ Function URL configuration pitfalls left unspecified
- **Scope**: §8 diagram, §11 "요청 제한", Plan item 5 `template.yaml`.
- **Finding and fix**:
  - The `/api/*` behavior needs the managed `CachingDisabled` cache policy, the `AllViewerExceptHostHeader` origin request policy (forwarding Host to a Function URL returns 403), and all HTTP methods allowed.
  - Do not use distribution-level CustomErrorResponses (403/404 → index.html) for SPA routing. They also rewrite API 403/404 into `index.html` 200. Use a viewer-request CloudFront Function on the default behavior, or HashRouter.
  - Function URL `AuthType: NONE` lets anyone bypass CloudFront and its rate limit. `AWS_IAM` + OAC instead requires the browser to send `x-amz-content-sha256` on every POST/PUT. Choose NONE plus a CloudFront origin custom header `X-Origin-Verify: <random, generated by deploy.sh>` checked by FastAPI middleware.
  - CloudFront forwards `/api/...` unchanged, so mount routers under `/api`.
  - Per-IP rate limiting must read `CloudFront-Viewer-Address` (add it to the origin request policy). Counters go in DynamoDB with TTL, because Lambda instances share no memory.

### [P2 | Major] F11 — One Lambda serves HTTP, Scheduler and jobs, but no dispatch is defined; timezone not stated
- **Scope**: §8 "EventBridge Scheduler → 같은 Lambda", Plan item 2.
- **Finding**: Mangum raises on non-HTTP events (Scheduler payloads, async self-invokes). Lambda runs in UTC, so "오늘·내일" computed naively is wrong from 00:00 to 09:00 KST every day.
- **Fix**:
  - `handler(event, ctx)`: if `"job" in event`, dispatch to `hourly | precompute | recompute_day | consolidate | extract_image`; else `Mangum(app, lifespan="off")(event, ctx)`.
  - Scheduler: `Input: {"job":"hourly"}`, `ScheduleExpressionTimezone: Asia/Seoul`, and a role with `lambda:InvokeFunction`.
  - Use a single `KST = timezone(timedelta(hours=9))` helper everywhere.

### [P2 | Major] F12 — Packaging and deploy-script specifics missing
- **Scope**: Plan item 5 `deploy.sh`, §8 "SSM SecureString".
- **Finding and fix**:
  - (a) Native wheels (pydantic-core; jiter if the anthropic SDK is used) must target the Lambda platform: `pip install --platform manylinux2014_aarch64 --implementation cp --python-version 3.13 --only-binary=:all: -t build/`, or build inside `public.ecr.aws/lambda/python:3.13-arm64` with Docker.
  - (b) Run backend tests on 3.13 (Docker `python:3.13`). Python 3.14 behavior (PEP 649 deferred annotations, PEP 758 unparenthesized `except A, B:`) can hide errors that FastAPI/pydantic raise on 3.13.
  - (c) Put a content hash in the S3 code key (`lambda/{sha256}.zip`). Otherwise CloudFormation won't update the function code.
  - (d) `AWS::SSM::Parameter` can't create a SecureString. `deploy.sh` must run `aws ssm put-parameter --type SecureString --overwrite` from an env var, and the template passes only the parameter name.
  - (e) Bootstrap order: stack deploy → seed lectures from the bundled CSV (read as `utf-8-sig`) and default settings → backfill weather from 09-01 → `aws lambda invoke --invocation-type Event {"job":"precompute"}` → poll the job → frontend sync and invalidation.

### [P2 | Major] F13 — Bedrock integration details that will cause 400s or AccessDenied
- **Scope**: §7, Plan item 2 (Bedrock client).
- **Finding and fix**:
  - **Client choice**: specify either boto3 `bedrock-runtime` (already in the runtime) or the anthropic SDK's `AnthropicBedrockMantle` (extra native dependencies).
  - **Haiku model ID**: missing. Specify `global.anthropic.claude-haiku-5-5`.
  - **IAM for global profiles**: allow `bedrock:InvokeModel` and `InvokeModelWithResponseStream` on the inference-profile ARN in ap-northeast-2, the regional foundation-model ARNs (`arn:aws:bedrock:*::foundation-model/anthropic.claude-*`), and the region-less form (`arn:aws:bedrock:::foundation-model/anthropic.claude-*`). Add a deploy-time smoke invoke.
  - **Sonnet 5.5 and Haiku 5.5 reject a non-default `temperature`** (e.g. `temperature=0`) with a 400.
  - **Sonnet 5.5 rejects forced `tool_choice` (`any`/`tool`)** with a 400. Use structured outputs (`output_config.format` JSON schema) for timetable extraction and NL events, and `tool_choice: auto` for the copilot.
  - **Copilot state**: run the tool loop inside one request and return text only. Otherwise, round-trip raw assistant content (thinking and tool_use) unchanged and append-only. Put dynamic context (today in KST, current screen) in the user turn, not the system prompt.
  - **Image upload**: the Function URL request limit is 6 MB (and base64 adds 33%). Upload via S3 presigned PUT and downscale before the model call.
  - **NL date resolution**: inject today's KST date and the semester range into the prompt.

### [P2 | Major] F14 — Simulator and economics parameters the implementer would have to invent
- **Scope**: §2 equipment, §3④, §5, §6, §9 screen 5; `model.py`, `energy.py`.
- **Finding and fix**:
  - (a) **ODU capacity** is undefined, but PLR depends on it. Define it as the sum of connected IDU ratings per mode: 3F 57.6/64.8 kW, 4F-A 43.2/48.6 kW, 4F-B 37.8/41.4 kW (cool/heat; studio 9 kW both).
  - (b) **Mode conflict**: §3④ sets the mode from the outdoor forecast, while §5 auto-switches on indoor temperature. A non-heat-recovery VRF can't heat and cool at once on one ODU. Define one daily mode per ODU, e.g. cool if forecast max To ≥ 24 °C, heat if daily mean ≤ 16 °C, otherwise the first demand wins and the other IDUs run fan-only. Also define what "설정온도 고정" means for baseline A.
  - (c) **Low load**: PLR < 0.1 → use g(0.1).
  - (d) **PMV inputs**: MRT = Tm, RH = 50%, v = 0.1 m/s, and a clo switch date. Compute PMV at 5-min resolution during sessions only.
  - (e) **Tariff**: 원/kWh and tCO2/MWh need numeric 가정값 values.
  - (f) **Waterfall method**: enable features cumulatively in a fixed order (A → B → rule → +optimal start → +skip → +early stop → +gap → +consolidation). Each bar is the energy delta.

### [P2 | Major] F15 — Consolidation and what-if have no compute budget or placement
- **Scope**: §10, §7 copilot what-if, `consolidate.py`.
- **Finding**: Greedy search over weekdays × time slots, with a weekly simulation per candidate, takes tens of seconds to minutes. It can't run inside an HTTP request.
- **Fix**: Run consolidation as a job after precompute and after any settings or lecture change, and store the result in `consolidation/{hash}.json`. Copilot what-if is limited to ≤1 day of simulation, or week-level answers from summaries only, with a 20 s budget.

### [P3 | Nit] F16 — Test plan has no concrete assertions
- **Scope**: Plan items 3 and 6.
- **Fix**: Pin these values:
  - CSV: 129 blocks with per-weekday counts 31/33/30/30/5/0, earliest 09:00, latest 22:30.
  - Semester: 75 class days and 1,962 timetable sessions.
  - Course code is taken from the **last** `(...)`, e.g. `일반물리학(II)(CB1501009)-060` and `기계학습의원리(B)(CE7500822)-001`.
  - Professor names are stripped (`안성용 ` has a trailing space).
  - Adjacent different sections stay separate blocks.
  - G = 15 behaves correctly for gaps of 0, 30 and ≥60 min.
  - The grid conversion gives (98, 77).
  - Post-deploy: `curl` checks per endpoint with expected status and keys.

### [P3 | Nit] F17 — Anomaly injection seeding scope
- **Scope**: §5 "시드 고정".
- **Fix**: Seed per session (`hash(session_id, seed)`) so that recomputing one day, or adding an event, doesn't reshuffle anomalies on other days. State whether anomalies apply only to the applied strategy or identically to all four.

### [P3 | Nit] F18 — "9장의 화면" is ambiguous
- **Scope**: Plan item 4.
- **Fix**: §9 lists 8 screens. Write "§9의 8개 화면", where the copilot is a side panel rather than a screen.
