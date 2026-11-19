# Code review (Goldfish): backend v12

Mode: adversarial diff review (EGM-Lite §4).
Target: `git diff 811036e..7ab76ab -- backend` (7ab76ab) plus `git diff 43a9cae~1..HEAD -- backend` (1f42e0d, c2e088f).
Intent: `docs/reviews/product_review.md` (P1-5, P1-6, P1-8, P2-9, and roadmap rows 0–1) and `docs/design.md` §12–13.

Baseline: `.venv/bin/python -m pytest -q tests` gives **28 passed in 30.4 s**.
Items marked "verified" were reproduced with throwaway scripts against a temporary `LOCAL_STORE`, `NOW_OVERRIDE=2026-11-18T10:40`, and `data/cache/weather_sources.json`.
No server was started, Bedrock was not called, and no source file was changed.

Checked with no finding:
- The `ai` and `rule` variants in `variants_day` match `compute_day` exactly (verified: same kWh on 4 days that have failures).
- Waterfall deltas add up to `ai - fixed`.
- The vacancy-resume cases behave correctly:
  - Back-to-back classes suppress the auto-off as intended (74 AI and 86 rule cases this semester).
  - None of the semester's cases end the auto-off early when a separate interval already covers the next class.
  - With no next session (`nxt is None`), no change is made.
- `cold_starts` skips vacant sessions.
- The start-sample guard handles a session starting at 00:00.
- `early_stop` counts a stop only when it beats `early_off_min`.
- Overlap test: `/api/events/check` uses half-open intervals, so a partial overlap is caught.
- `/api/events/check` costs about 0.4 s for at most 11 day-runs (bounded).
- The weather freeze never touches `om_forecast`, and the archive only covers dates up to `today-1`. With no `prev` there is nothing to freeze, which is correct.
- Open-Meteo archive and previous-runs currently return no nulls for recent days (checked with generic coordinates).

---

### 1. [P1] `check_event` never reports a clash with an already-added event (verified)

**Where:** `app/service.py:351-353`. The `busy()` filter has `s.get("course_id") != ev.get("course_id")`.

**Failure:** Added events and imported dated records are `kind: "event"` sessions with no `course_id`. An `add` draft has no `course_id` either, so the test is `None != None`, which is False. Every existing event in the room is filtered out.
- Repro: add 408 18:00–21:00 "발표회", then check add 408 19:00–20:00.
- Result: `conflicts: []`, `ok: true`. Room 408 is even ranked first among the alternatives (`['408','307','409','405']`), because it is already conditioned.

This is the P1-8 failure the check was meant to fix (two NL or image drafts for the same slot).

**Fix:** Exclude only the course being moved: `if ev["type"] == "move" and s.get("course_id") == ev["course_id"]: skip`. Add a test for an add that clashes with an existing add.

### 2. [P1] A copilot draft whose check fails returns a malformed `check` that crashes the SPA

**Where:** `app/ai.py:295-299` sets `ev["check"] = {"ok": False, "error": str(e)}`.

**Failure:** `frontend/src/components/Copilot.tsx` `DraftCard` passes `d.check` to `useEventCheck` as `initial`. When the draft is "complete" by the frontend's rules, `EventCheckPanel` renders it and calls `check.alternatives.find(...)` and `check.conflicts.length`, which are undefined, so it throws a TypeError. There is no ErrorBoundary in `frontend/src`, so the whole app unmounts.

Plausible triggers from a judge:
- A room that is not in IT관 ("201호 세미나 잡아줘").
- A date after 12/18.
- A hallucinated `course_id` on a cancel or move.

**Fix:** On exception, either leave `check` unset (the UI then calls `/api/events/check`, which returns 400 and shows the error) or return the full shape: `{"ok": False, "conflicts": [], "capacity_ok": True, "capacity": None, "alternatives": [], "note": str(e)}`.

### 3. [P2] Cancel and move drafts are marked OK without checking that the session exists (verified)

**Where:** `app/service.py:338-349`.

**Failure:**
- A `cancel` returns `ok: true` immediately. A cancel for a course that does not meet on that date (weekday 0 vs 2) shows a green "겹치는 일정 없음", and the operator saves a cancel that does nothing. This is exactly how the new notice-image → 휴강 path fails when the model picks the wrong course or date.
- A `move` for a course that does not meet that day is checked against its default slot and reports an unrelated conflict.
- A move with only `new_start: "21:00"` (course 09:00–10:30) gives `s0 > e0`, then `ok: true` with no conflicts. Validation (`validation.py:96-105`) never checks that the merged start is before the merged end.

**Fix:**
- Resolve the target session from `sessions` (`course_id` on `ev.date`). If it is missing (wrong weekday, holiday, closure, already cancelled), return `ok: false` with a note.
- Reject merged move times where `start >= end` in `validation.event`.

### 4. [P2] AI fallback caches are keyed on text only, so stale drafts are served without warning

**Where:**
- `app/ai.py:58-69` (key = sha1 of the first 300 normalised characters).
- `app/main.py:249-257` (parse fallback).
- `app/jobs.py:83-97` (chat fallback).

**Failure:**
- **Parse:** "내일 3시 405호 휴강" cached yesterday comes back with yesterday's resolved date when Bedrock is down. `Data.tsx` ignores `from_cache` and `cached_at`, so the operator sees a draft that looks fresh, one day off.
- **Chat:**
  - Only single-turn answers are cached, but the fallback looks up `messages[-1]` in any conversation. A follow-up like "더 자세히" can pick up another context's answer.
  - Replayed `event_drafts` carry their old `check`, which `DraftCard` shows as current.
  - Replayed `proposals` still have a working 적용 button.

**Fix:**
- Put `now_kst().date()` (and, for chat, a hash of settings and events) into the key, or treat entries from another day as a miss.
- Fall back only when `len(messages) == 1`.
- On replay, drop or re-run `check`, and disable proposals.
- Show `from_cache` on the Data page.

### 5. [P2] `parse-image` turns input errors into 503 and marks the AI as down for every viewer

**Where:** `app/main.py:276-288`.

**Failure:** The media type comes from the file extension. Bedrock rejects:
- a JPEG renamed to `.png` (the bytes do not match the declared media type);
- images over its per-image limit, which is below the 4 MB accepted here.

The generic `except` maps these to 503 "AI(Bedrock) 호출에 실패" and calls `record_status(False)`. That turns the header AI chip red for everyone, although Bedrock is healthy.

**Fix:**
- Detect the media type from the magic bytes (`\x89PNG`, `\xff\xd8`, `RIFF....WEBP`).
- Lower the size cap.
- Map `anthropic.BadRequestError` to 422 without calling `record_status`.
- Reserve 503 and the failure status for auth, throttling, timeout and 5xx errors.

### 6. [P2] Precompute dedupe does not stop overlapping full-semester runs

**Where:**
- `app/service.py:270-280` (a 60 s timestamp only).
- `app/service.py:518-521`.
- `app/main.py:126-136`: the hourly refresh job runs `precompute()` without setting `precompute_queued`.
- `frontend/src/components/Attribution.tsx` polls every 10 s while the result is `stale`.

**Failure:** Every hourly refresh changes the inputs key, because forecasts move. For each open Energy page:
1. The next poll sees `stale` and queues a second precompute alongside the refresh job's own.
2. If a run takes more than 60 s on EC2, which is likely now that it covers summary + consolidation + 109 days × 7 attribution variants, the poll queues a third.

These threads share the single uvicorn worker under the GIL, so every API call slows down for minutes each hour. Two writes inside 60 s have the opposite problem: the second write's precompute is dropped.

**Fix:** Keep a `precompute_running` item with a TTL and a generation number:
- Set it in `service.precompute()`, including on the refresh path.
- Skip queueing while it is live.
- Re-queue at the end if the inputs key changed during the run.

### 7. [P2] `/api/consolidation` still blocks about 16 s after every input change, and the "latest" blob is never read

**Where:** `app/service.py:495-506`.

**Failure:** The key is `_inputs_key` over all semester days, so it changes on every hourly forecast refresh. Until the refresh job's precompute gets past the summary step, the first Energy page load recomputes inline. That is the 16 s wait P2-9 asked to remove, and it duplicates the precompute's own work. `analysis/consolidation-latest.json` is written but never read.

**Fix:** Mirror `attribution(allow_stale=True)`: serve the latest result with `stale: true` and queue the recompute.

### 8. [P2] Admin reset leaves visitor timetable imports in place

**Where:** `app/main.py:381-394`.

**Failure:** P1-6 asked for "seed courses, default settings, 0 events, re-run precompute". The reset deletes events and restores settings only. A visitor who commits an image or CSV import (`scope=rooms` replaces those rooms' courses, `scope=all` replaces everything) is still in place after `ec2-deploy.sh demo_reset`. Separately, the reset's `_queue_precompute()` is skipped if another precompute was queued in the previous 60 s.

**Fix:**
- Re-seed with `replace_kind("course", parse_grid_csv(RAW_CSV))`.
- Call `service.precompute()` in a job unconditionally, or with a forced flag.
- Add a test for the authorised path.

### 9. [P3] Attribution variants differ in more than the named feature

**Where:** `hvac/attribution.py:72-75`.

**Failure:** The comment says override and command-failure events stay identical across variants, but the filter keeps only `type == "override"`. Failure retries are `forced_off`, so `ai_predictive` and `ai_weather` drop them, and the "재실 감지" step absorbs the failure effect. Separately, `fixed`, `rule`, `rule30` and `rule_vacancy` get no override events and no guard, so the "예측 기동·관성 정지" step also includes the override energy and the guard. The measured effect is small: 912.7 vs 912.4 kWh over 20 failure days, with the same cold starts.

**Fix:** Drop the filter, since `vacancy=False` already skips no-show and early-dismiss. Either state the asymmetry in `note` or give the rule variants the same override events.

### 10. [P3] The attribution cache key omits today, but `to_date` depends on it

**Where:** `app/service.py:514, 525-526`.

**Failure:** When a weather refresh fails or returns identical data, the key does not change, and `to_date` stays frozen at the computation date. `semester_summary` includes today in its key; attribution does not.

**Fix:** Put `now_kst().date()` into the key, or compute `to_date` at read time from `days`.

### 11. [P3] Float comparison rejects legitimate 0.3 °C margins (verified)

**Where:** `app/validation.py:163`.

**Failure:** `20.4 - 20.1 < 0.3` evaluates to True in floating point. 28 heat-side pairs are rejected, including 19.6/19.9, 20.1/20.4 and 21.1/21.4. 21 cool-side pairs are rejected, including 26.4/26.1 and 25.9/25.6. The error message promises "0.3℃ 이상" is allowed.

**Fix:** `round(sp_heat - comfort_low, 3) < 0.3` (and the same for the cool side).

### 12. [P3] Cache and status writes inside the `try` can discard a successful answer

**Where:** `app/jobs.py:85-88`, `app/main.py:250-251`.

**Failure:** If `record_status` or `cache_put` raises, the paid answer is replaced by "AI(Bedrock) 호출에 실패" and the AI is marked as down. `cache_put` also stores whole copilot results as one DynamoDB item. Above 400 KB, `ResilientStore._try` marks the entire AWS store as degraded for the cooldown.

**Fix:** Move both writes after the `try` and wrap them. Store chat cache entries as blobs.

### 13. [P3] `/api/meta` publishes raw exception text

**Where:** `app/ai.py:48-56`, `app/main.py:84`.

**Failure:** `error` holds `f"{type(e).__name__}: {e}"`. A Bedrock `AccessDeniedException` includes the caller's role ARN and account ID, and this is served to anonymous viewers.

**Fix:** Expose only a category (auth, throttle, timeout, other) and log the raw message.

### 14. [P3] The weather freeze locks in provisional values and has no repair path

**Where:** `app/service.py:118-127`.

**Failure:** The value frozen for date X is whatever `prev` held, which was fetched when X was one day old. That is a provisional, model-based archive value, not one "first used" once settled. `new[k] = v` also copies records with null fields over complete new ones. Once a bad record is frozen, the only fix is deleting `weather/sources.json`, which unfreezes everything at once. The freeze has no tests. Latent today, since no nulls were observed.

**Fix:** Freeze only complete records. Keep frozen history in its own blob (`weather/frozen.json`) with an admin-only repair path. Add a unit test covering the cutoff and missing `prev`.

### 15. [P3] One client can use up the daily AI cap

**Where:** `app/main.py:49, 54-63`.

**Failure:** `AI_PER_MINUTE` went from 8 to 30, and `parse` and `parse-image` share that bucket. The IP is the first `X-Forwarded-For` hop, which the client controls. One client can use up `LLM_DAILY_CAP=600` in about 20 minutes, or immediately by rotating XFF. That disables NL events, image import and the copilot for the rest of the day.

**Fix:**
- Use the last trusted hop, or `cloudfront-viewer-address` only.
- Add a separate, lower bucket for images.
- Reserve part of the cap for operators.

### 16. [P3] Test gaps on new demo paths

No tests cover:
- an add clashing with an existing add (#1);
- cancel and move checks (#3);
- the copilot draft check-error shape (#2);
- the chat and parse cache fallback, and `record_status`;
- `/api/attribution` returning 202 or stale;
- the consolidation cache;
- the weather freeze;
- the authorised admin reset.

**Fix:** Add API tests that monkeypatch `ai.copilot` and `ai.parse_event` to raise, and service-level tests for #1, #3 and the freeze.

---

Out of range (pre-existing in 811036e, latent): `hvac/strategies.py:277` reads `soft_seg` before it is assigned in the bridge branch.
- On a room's first block, this raises UnboundLocalError.
- On later blocks, it reuses the previous block's segment.
- This semester has 0 bridge decisions, so it has not fired.
