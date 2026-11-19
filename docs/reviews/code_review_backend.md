# Code review (Goldfish): backend

Mode: REVIEW. Target: `backend/hvac/`, `backend/app/`, `infra/template.yaml`, with `docs/design.md` §12 as the intent.
Baseline: `pytest -q tests` passes (16 tests). Nothing in this report comes from those tests. Every item marked "verified" was reproduced against a temporary `LOCAL_STORE` with `NOW_OVERRIDE=2026-11-18T10:40` and the cached weather sources. The server on port 8000 was not touched.

Checked with no finding: the KEPCO TOU bands and season months (`config.py:156`), KST handling on UTC Lambda (every "now" goes through `weather.now_kst()` or `service.now_kst()`), 5-minute series indexing (`simulate.py:156`, `session_comfort`, `live_snapshot`), `AwsStore.get_item` for counter items without a `body`, and the origin guard against path-encoding bypass (Mangum and Starlette both use the decoded `scope["path"]`).

Findings are ordered by severity.

---

### 1. [P1] Image/PDF import stores the whole upload in a DynamoDB item, so most real files fail

**Where:** `app/main.py:142-143` puts `data_b64` (up to 5 MB × 4/3) into the job payload. `app/jobs.py:15-17` writes it with `put_item`, and `app/store.py:107` stores the job as one `body` attribute. `app/jobs.py:74` saves the whole job again, payload and result together.

**Failure:** DynamoDB items are capped at 400 KB.
- Any image or PDF over about 300 KB fails in `jobs.create`, and `/api/import` returns a 500.
- An image of about 200–290 KB gets past creation. Sonnet then extracts it. The final `_save` writes the payload (about 270–390 KB) plus `preview`. For an image, preview is `courses` + `added` + `removed`, about 130–150 KB for a full timetable, because every extracted course gets a new ID, so all are "added" and all existing ones are "removed". That save raises `ValidationException` outside the `try`. The job stays `running` forever.
- The Lambda function error triggers async retries. No `EventInvokeConfig` is set, so the default of 2 retries applies. The Sonnet extraction (`max_tokens` 32000) runs and is billed up to 3 times.

**Fix:** Put the upload in S3 (`uploads/{job_id}`) and keep only the key in the payload. Store large job results in S3 as well. Drop `payload` after the run. Wrap the final save so a failure marks the job as `error`. Set `MaximumRetryAttempts: 0` on the function.

### 2. [P1] A failed weather fetch overwrites good weather with a flat 15 °C day for the whole semester

**Where:** `app/service.py:100-106` always runs `put_blob("weather/sources.json", src)`. `hvac/weather.py:279-284` replaces any failed source with `{}`.

**Failure (verified):** I fed `build_weather` the cached sources with `archive`/`prev_day1`/`om_forecast`/`climatology` empty, as happens with an Open-Meteo 429 or outage. All 112 days fell back to `기본값` (15 °C, RH 60 %, no sun). Every day fingerprint changes, so the hourly `precompute` recomputes the semester on that synthetic weather and overwrites `summary/latest.json`. The dashboard shows wrong kWh, comfort and validation until a later fetch succeeds.
- If only the archive fails, about 74 past days are affected.
- Anyone can set this off: `POST /api/weather/refresh` (`main.py:98`) is anonymous and unthrottled, and each call makes 4 Open-Meteo requests, so spamming it can get the egress IP rate-limited.

**Fix:** Merge per source. Keep the previous value of any source listed in `errors`, and do not write if every source failed. Throttle the refresh endpoint the way `_queue_precompute` is throttled, and record per-source `fetched_at`.

### 3. [P1] Settings are saved without validation; a string or fractional minute value breaks every compute endpoint

**Where:** `app/service.py:54-62` (`save_settings`), `app/main.py:202-213`. The same unvalidated path exists in `service.what_if` (`service.py:341`) and in copilot `propose_policy` overrides, which the UI applies through `PUT /api/settings`.

**Failure (verified):**
- `PUT /api/settings {"pre_on_min":"10"}`, which is what an HTML input sends unless the frontend coerces it, returns 200. After that, `/api/day/*` and `/api/live` return 500 and precompute fails.
- Float minutes crash `range()` in `plan_to_cmd`/`simulate_day`. `pre_on_min=7.5` or `early_off_min=2.5` crashed 20 of 20 days. `auto_off_after_min=7.5` crashed 6 of 20 days, only on days that have an override anomaly, so it looks intermittent.
- Malformed `fixed_on`, a non-dict `tariff`, `sp_heat >= sp_cool`, or `comfort_low >= comfort_high` also either crash or produce nonsense.

**Fix:** Use a typed schema (Pydantic) with integer minute fields and bounds, HH:MM checks, `sp_heat < sp_cool`, `comfort_low < comfort_high`, and tariff structure checks. Reject bad input with 400. Apply the same validator to `what_if` overrides.

### 4. [P1] Event input is not validated or canonicalised; a bad event is saved before the 500, and the cache then poisons three days

**Where:** `app/main.py:168-177`. `app/service.py:294` (`put_item`) runs before the "after" compute at `service.py:296`. Date matching is plain string equality at `hvac/timetable.py:234`.

**Failure (verified):**
- `add` with `start:"9시"` returns 500, but the event is already stored. After that, `/api/day/2026-11-18`, `11-19` and `11-20` all return 500 (the warm-up uses d-2 and d-1), and every semester precompute fails, so `/api/summary` stays stale. This is easy to trigger from a form typo, or from a parse result where the LLM ignores the "HH:MM" hint, because the schema has no `pattern`.
- `date:"20261118"` passes `_date()`, because Python 3.11+ `fromisoformat` accepts the basic format. The event is stored but never matches, and the sessions count stays 30 → 30.
- `move` with `new_room:"4O5"` returns 200. The class stays in `sessions` but disappears from the simulation and validation (29 of 30 validated).
- `cancel`/`move` without a valid `course_id` is a silent no-op.
- A client-supplied `id` overwrites any existing event.

**Fix:** Canonicalise `date` with `_date(...).isoformat()`. Require HH:MM with `start < end`. Require `room`/`new_room` in `config.ROOMS` and `course_id` among existing courses. Cast `expected_people` to an int within bounds. Ignore any client `id`. Compute "after" before persisting, or roll back on exception.

### 5. [P1] One-off events created by import can never be deleted

**Where:** `app/service.py:332` calls `uuid4()` twice, once for the DynamoDB sort key and once for the `id` field in the body.

**Failure (verified):** `POST /api/import/api {"commit":true, records:[{date:"2026-11-19",...}]}`. `GET /api/events` then shows `E466208d6`, and `DELETE /api/events/E466208d6` returns `{"deleted": false}`. The event cannot be removed through the API. Committing the same file again adds another copy, which doubles the sessions.

**Fix:** Generate the ID once. Derive it from the record (for example the course ID plus the date) so re-imports stay idempotent.

### 6. [P2] Import commit trusts raw client data, and a dated-only commit silently restores the seed timetable

**Where:** `app/main.py:147-151` → `service.commit_courses` (`service.py:325-334`); `service.courses` (`service.py:66-69`).

**Failure:**
- `/api/import/commit` stores `body["courses"]` exactly as the client sent it. A missing `id` or `expected_people`, a bad time, or a room outside the building causes the same 500 poisoning as finding 4, but for every weekday.
- A commit with only dated records calls `replace_kind("course", {})`. The next `courses()` call sees an empty table and re-seeds `timetable_3_4.csv`, so a previously imported custom timetable is replaced with no warning (verified: the course sources went back to "부산대 시간표 CSV").

**Fix:** Re-run `normalize_records` and the validation server-side on commit. Replace weekly courses only when the commit contains some. Re-seed only on first boot, using a `meta/seeded` flag.

### 7. [P2] The day cache key misses inputs that change the result, so stale results are served

**Where:** `app/service.py:152-159` hashes only `(room, start, end, expected_people)` per session. `hvac/engine.py:36` seeds the field scenario with `title`. The output also carries `id`, `kind`, `event_id`/`course_id` and `professor`.

**Failure (verified):** Two otherwise identical add-events titled "A" and "F" get the same fingerprint `407974ca8681`. "F" draws an `early_dismiss` and gives a different AI kWh (15.121 vs 15.097), but whichever was computed first is served. Likewise, after delete-and-re-add, the cached day still references the old `event_id`, and renamed courses keep their old titles in the timeline and history.

**Fix:** Hash the full session dicts, sorted. At minimum include `id`, `title`, `kind` and `professor`.

### 8. [P2] Validation reports failed "skip" predictions as matched

**Where:** `hvac/engine.py:170-177` returns `skip_ok` for any session with a skip decision. The guard check at `engine.py:172-177` only upgrades `ok`, and `issues` excludes `skip_ok` (`engine.py:193`).

**Failure (verified over the full semester):** 34 of the 185 skip decisions (18 %) left the comfort band, and the feedback guard had to start conditioning. All 34 are still reported as `skip_ok`. They count toward `match_rate` and never appear in the issues list, which hides the AI's main forecasting error from the validation screen.

**Fix:** When `justified_skip` and `g_min > 0`, set the status to `skip_corrected` (or `corrected`) and add the row to the issues list.

### 9. [P2] Rooms outside the building are accepted, silently dropped by the engine, and crash consolidation

**Where:** `hvac/timetable.py:171-175` accepts any room string. `hvac/engine.py:243` simulates only `config.ROOMS`. `hvac/consolidate.py:39,68` index `ROOMS[room]` directly.

**Failure:** Import a sheet that includes, say, "501" or "IT-205". Those sessions count in `sessions` and in the comfort weights, but use no energy and are never validated. `/api/consolidation` and the copilot `consolidation_advice` tool then fail with `KeyError`.

**Fix:** Flag unknown rooms in the preview and reject them on commit (or map them explicitly). Skip unknown rooms in `plan_moves`.

### 10. [P2] Job lifecycle: jobs can stay stuck forever, and Lambda retries re-run them and re-bill Bedrock

**Where:** `app/jobs.py:17-23` and `jobs.py:37-44`; `infra/template.yaml:94-117`.

**Failure:**
- If `lambda.invoke` fails (throttling), the record stays `queued`.
- A Lambda timeout or OOM leaves it `running`. Six Sonnet calls with `timeout=120` and SDK `max_retries=2` can exceed 600 s.
- Async retries run `jobs.run` again with no status check, so a chat job re-runs and is charged again.
- The frontend has no way to tell any of these from slow progress.

**Fix:** Run only if the status is `queued` (use a conditional update). Store `started_at` and treat a job as failed after N minutes. Mark the job `error` when invoke fails. Set `MaximumRetryAttempts: 0`.

### 11. [P2] Anonymous users can spend the Bedrock budget and Lambda concurrency

**Where:** `app/ai.py:303` forwards client `role`/`content` unchanged. `ai.py:42-45` has a single global daily cap. `main.py:98,150,205,212,266` start jobs without throttling. No reserved concurrency is set in `template.yaml`.

**Failure:**
- `/api/chat` accepts `role:"system"`. Sonnet 5.5 accepts system messages mid-conversation and gives them operator authority. It also accepts forged assistant turns and content-block arrays (images or documents). That lets a caller override the copilot's "numbers only from tools" rule.
- One client can use up the shared 600-call cap in minutes, which turns AI off for everyone, including the judges. The per-IP limit promised in design §7 does not exist.
- A burst of `POST /api/precompute`, `/api/weather/refresh` or `PUT /api/settings` starts unthrottled async invocations of the same function that serves the API. On an account with a low concurrency quota, that throttles the site.
- Events, audit records and jobs have no size limit or TTL, and `events()`/`audit_log()` scan the whole partition on every request.

**Fix:** Allow only `user`/`assistant` roles with string content capped at a few KB. Add a per-IP minute counter using `CloudFront-Viewer-Address`. Route every precompute trigger through `_queue_precompute`. Set reserved concurrency. Put a TTL on job items and cap the event count.

### 12. [P3] The in-process `_wx_cache` can pin a stale forecast in one container

**Where:** `app/service.py:106` writes `sources.json` before the snapshot loop at `service.py:115`. The cache key at `service.py:137` is `(fetched_at, len(snaps))`.

**Failure:** A container that reads between those two writes caches the new sources with the old snapshots under the final key. The snapshot count usually does not change, so that container serves an older forecast and builds different fingerprints until the next refresh. Users then see results change between requests depending on which container answers.

**Fix:** Write the snapshots first and `sources.json` last. Alternatively, key the cache on a hash of the snapshot bases.

### 13. [P3] Cached semester summary freezes `today` and the "to date" totals

**Where:** `app/service.py:202-205`. `key_all` does not include `today`, but the `to_date` totals depend on it (`service.py:218`).

**Failure:** If the inputs do not change across midnight (local run, scheduler down, unchanged weather), yesterday's "to date" totals are served.

**Fix:** Add `now_kst().date()` to `key_all`.

### 14. [P3] Out-of-range or malformed inputs return 500 instead of 4xx

**Where:** `hvac/engine.py:239` (`KeyError` for dates outside 2026-08-29..2026-12-18, for example `/api/day/2026-12-19`, the copilot `get_room_week` near the end of term, and `effective_now` after the term); `service.py:267` (bad `?at=`); `service.py:366` (unknown `strategy` in `plan.csv`); `main.py:134` (bad JSON upload); `ai.parse_event` errors other than quota (refusal, or `max_tokens` producing truncated JSON).

**Fix:** Bound-check and map these to 400 or 404.

### 15. [P3] The rule planner loses the block end when one session is nested inside another

**Where:** `hvac/strategies.py:49` sets `ivs[-1]["_end"] = e` instead of `max(_end, e)`.

**Failure:** Take an exam event 10:00–11:00 inside a 09:00–12:00 lecture in the same room. `_end` drops to 11:00, so a class at 12:10 is treated as a 70-minute gap instead of a 10-minute one. The rule plan (also used for the warm-up) then switches off and on again.

**Fix:** Use `max`.

### 16. [P3] The validation "planned" window treats a neighbouring block's run as this session's plan

**Where:** `hvac/engine.py:139-145`. Any plan minute in `[start-90, end)` counts as planned, and `exec_ratio` is computed over that whole window.

**Failure:** Suppose a session has no interval of its own, but an earlier block in the same room ran within 90 minutes before it. It is marked `planned`, so `plan_missing` never fires for it.

**Fix:** For `planned`, use only intervals whose `sessions` include this session (or overlap `[start-lead_i, end)` for this session's own decision).

### 17. [P3] The synchronous `/api/events/parse` can exceed CloudFront's 60 s timeout

**Where:** `app/ai.py:38` (`timeout=120`, default `max_retries=2`).

**Failure:** Under Bedrock throttling the worst case is about 360 s. CloudFront returns 504 while the Lambda keeps running and is billed.

**Fix:** For the synchronous path, use `client().with_options(timeout=20, max_retries=1)`.

### 18. [P3] Local store writes are not atomic, and AccessDenied is treated as a missing key

**Where:** `app/store.py:33-40` and `app/store.py:97-99`.

**Failure:**
- The local precompute thread rewrites `summary/latest.json` or `items.json` in place, so a concurrent request can read half a file and get `JSONDecodeError`. Two local processes sharing `items.json` lose each other's writes.
- On AWS, `ListBucket` is granted, so a missing key already comes back as `NoSuchKey`. Mapping `AccessDenied` to `None` therefore only hides real permission errors. For example, a missing `weather/sources.json` read leads to a full inline refresh on every request, then 504s.

**Fix:** Write to a temp file and `os.replace`. Treat `AccessDenied` as an error.
