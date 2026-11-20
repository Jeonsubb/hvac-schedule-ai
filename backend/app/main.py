"""HTTP API (FastAPI). Mounted at /api behind CloudFront; Mangum adapts it to Lambda."""
from __future__ import annotations

import base64
import os
from datetime import date, timedelta

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from hvac import config, engine, timetable

from . import jobs, service
from .validation import InvalidInput, in_weather_range

app = FastAPI(title="HVAC Schedule AI", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ORIGIN_SECRET = os.environ.get("ORIGIN_SECRET")


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    # Only CloudFront knows the secret header; blocks direct Function URL calls.
    if ORIGIN_SECRET and request.url.path.startswith("/api") and request.url.path != "/api/health":
        if request.headers.get("x-origin-secret") != ORIGIN_SECRET:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
    return await call_next(request)


def _date(s: str) -> date:
    try:
        d = date.fromisoformat(s)
    except (TypeError, ValueError):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    try:
        in_weather_range(d)
    except InvalidInput as e:
        raise HTTPException(400, str(e))
    return d


@app.exception_handler(InvalidInput)
async def invalid_input(_request: Request, exc: InvalidInput):
    return JSONResponse({"detail": str(exc)}, status_code=400)


AI_PER_MINUTE = int(os.environ.get("AI_PER_MINUTE", "30"))
OPERATOR_KEY = os.environ.get("OPERATOR_KEY")


def _rate_limit(request: Request, bucket: str, limit: int = AI_PER_MINUTE) -> None:
    """Per-client-IP limit for Bedrock-backed endpoints (counter in the item store)."""
    addr = request.headers.get("cloudfront-viewer-address") or request.headers.get("x-forwarded-for") or (
        request.client.host if request.client else "unknown")
    ip = addr.split(",")[0].strip().rsplit(":", 1)[0] if addr.count(":") == 1 else addr.split(",")[0].strip()
    minute = service.now_kst().strftime("%Y%m%d%H%M")
    n = service.get_store().incr("ratelimit", f"{bucket}|{ip}|{minute}", "n")
    if n > limit:
        raise HTTPException(429, "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")


@app.get("/api/health")
def health():
    return {"ok": True, "engine": service.ENGINE_VERSION, "time": service.now_kst().isoformat(timespec="seconds")}


@app.get("/api/meta")
def meta():
    ctx = service.Ctx()
    src = service.weather_sources()
    return {
        "building": config.BUILDING,
        "rooms": config.ROOMS,
        "odus": config.ODUS,
        "semester": {k: str(v) for k, v in config.SEMESTER.items()},
        "holidays": {str(k): v for k, v in config.HOLIDAYS.items()},
        "strategies": config.STRATEGIES,
        "settings": ctx.settings,
        "now": service.effective_now(ctx),
        "counts": {"courses": len(ctx.courses), "events": len(ctx.events)},
        "storage": getattr(service.get_store(), "status", lambda: {"mode": type(service.get_store()).__name__})(),
        "ai": {k: v for k, v in (service.get_store().get_item("meta", "ai_status") or {"ok": None}).items() if k != "error"},
        "weather": {"fetched_at": src.get("fetched_at"), "errors": src.get("errors", {}),
                    "kma_base": (src.get("kma_forecast") or {}).get("base")},
        "models": {"sonnet": os.environ.get("MODEL_SONNET", "global.anthropic.claude-sonnet-5-5"),
                   "haiku": os.environ.get("MODEL_HAIKU", "global.anthropic.claude-haiku-5-5")},
    }


@app.get("/api/live")
def live(at: str | None = None):
    return service.live_snapshot(service.Ctx(), at)


@app.get("/api/day/{d}")
def day(d: str, strategies: str | None = None):
    res = service.get_day(_date(d))
    if strategies:
        keep = set(strategies.split(","))
        res = {**res, "strategies": {k: v for k, v in res["strategies"].items() if k in keep}}
    return res


@app.get("/api/summary")
def summary():
    return service.semester_summary(allow_stale=True)


@app.get("/api/weather")
def weather_now():
    src = service.weather_sources()
    wx = service.weather_by_date()
    today = service.now_kst().date()
    days = [today + timedelta(days=i) for i in range(4)]
    return {
        "nowcast": src.get("kma_nowcast"),
        "kma_base": (src.get("kma_forecast") or {}).get("base"),
        "kma_hourly": (src.get("kma_forecast") or {}).get("hourly", {}),
        "days": {d.isoformat(): wx.get(d.isoformat()) for d in days},
        "fetched_at": src.get("fetched_at"),
    }


@app.post("/api/weather/refresh")
def weather_refresh():
    st = service.get_store()
    last = st.get_item("meta", "refresh_queued") or {}
    import time as _t

    if _t.time() - float(last.get("t", 0)) < 300:
        return {"job": last.get("job"), "throttled": True}
    job = jobs.create("refresh", {})
    st.put_item("meta", "refresh_queued", {"t": _t.time(), "job": job["id"]})
    return {"job": job["id"]}


@app.get("/api/courses")
def courses():
    return service.courses()


@app.post("/api/import")
async def import_file(request: Request, file: UploadFile = File(...), hint: str = Form("")):
    data = await file.read()
    name = file.filename or "upload"
    lower = name.lower()
    if len(data) > 5_000_000:
        raise HTTPException(413, "파일이 너무 큽니다(최대 5MB).")
    if lower.endswith(".csv"):
        try:
            new = timetable.parse_grid_csv(data.decode("utf-8-sig"), source=name)
        except Exception:
            new = []
        if not new:
            import csv
            import io

            rows = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
            new = timetable.normalize_records(rows, source=name)
        return {"mode": "sync", "source": name, "preview": service.preview_courses(new)}
    if lower.endswith((".xlsx", ".xlsm")):
        new = timetable.parse_grid_xlsx(data, source=name)
        return {"mode": "sync", "source": name, "preview": service.preview_courses(new)}
    if lower.endswith(".json"):
        import json

        recs = json.loads(data)
        recs = recs.get("records", recs) if isinstance(recs, dict) else recs
        new = timetable.normalize_records(recs, source=name)
        return {"mode": "sync", "source": name, "preview": service.preview_courses(new)}
    media = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp",
             "gif": "image/gif", "pdf": "application/pdf"}.get(lower.rsplit(".", 1)[-1])
    if not media:
        raise HTTPException(400, "지원 형식: CSV, XLSX, JSON, PNG/JPG/WEBP 이미지, PDF")
    _rate_limit(request, "extract", 10)
    job = jobs.create("extract", {"media_type": media, "filename": name[:120], "hint": hint[:500]},
                      blob={"data_b64": base64.b64encode(data).decode()})
    return {"mode": "job", "job": job["id"], "source": name}


@app.get("/api/import/sample.csv")
def import_sample():
    """The PNU IT관 2026-2 timetable as delivered (grid CSV), for trying the timetable upload."""
    return PlainTextResponse(service.RAW_CSV.read_text(encoding="utf-8-sig"), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": "attachment; filename=\"pnu_it_timetable_2026_2.csv\""})


@app.post("/api/import/commit")
def import_commit(body: dict = Body(...)):
    try:
        res = service.commit_courses(body.get("courses") or [], str(body.get("source", "가져오기"))[:120],
                                     scope="all" if body.get("scope") == "all" else "rooms")
    except ValueError as e:
        raise HTTPException(400, str(e))
    service._queue_precompute()
    return res


@app.post("/api/import/api")
def import_api(body: dict = Body(...)):
    """External system push (API/DB integration): long-format records."""
    new = timetable.normalize_records(body.get("records", []), source=str(body.get("source", "API"))[:120])
    if body.get("commit"):
        try:
            res = service.commit_courses(new, str(body.get("source", "API"))[:120])
        except ValueError as e:
            raise HTTPException(400, str(e))
        service._queue_precompute()
        return {"committed": res}
    return {"preview": service.preview_courses(new)}


@app.get("/api/events")
def list_events():
    return service.events()


@app.post("/api/events")
def create_event(ev: dict = Body(...)):
    try:
        res = service.add_event(ev)
    except InvalidInput as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    service._queue_precompute()
    return res


@app.delete("/api/events/{event_id}")
def remove_event(event_id: str):
    res = service.delete_event(event_id)
    service._queue_precompute()
    return res


@app.post("/api/events/check")
def check_event(ev: dict = Body(...)):
    try:
        return service.check_event(ev)
    except (InvalidInput, ValueError) as e:
        raise HTTPException(400, str(e))


@app.post("/api/events/parse")
def parse_event(request: Request, body: dict = Body(...)):
    from . import ai

    text = str(body.get("text") or "").strip()
    if not text or len(text) > 500:
        raise HTTPException(400, "text는 1~500자여야 합니다.")
    _rate_limit(request, "parse")
    try:
        ev = ai.parse_event(text)
    except ai.QuotaExceeded as e:
        raise HTTPException(429, str(e))
    except Exception as e:
        if not ai.is_outage(e):
            raise HTTPException(422, "문장을 일정으로 해석하지 못했습니다. 날짜·시간·강의실을 넣어 다시 써 주세요.")
        ai.record_status(False, type(e).__name__)
        ev = ai.cache_get("parse", text)
        if not ev:
            raise HTTPException(503, "AI(Bedrock) 호출에 실패했습니다. 아래 양식에 직접 입력하거나 잠시 후 다시 시도하세요.")
    else:
        ai.record_status(True)
        ai.cache_put("parse", text, ev)
    try:
        chk = service.check_event(ev)
        ev = {**ev, "check": {k: chk.get(k) for k in ("ok", "conflicts", "capacity_ok", "capacity", "alternatives", "note", "target")}}
    except Exception:
        pass  # incomplete draft: the form shows what is missing
    return ev


def _sniff_image(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


@app.post("/api/events/parse-image")
async def parse_event_image(request: Request, file: UploadFile = File(...)):
    """휴강·보강 공지 캡처(이미지) -> event draft + conflict check."""
    from . import ai

    data = await file.read()
    if len(data) > 4_000_000:
        raise HTTPException(413, "이미지가 너무 큽니다(최대 4MB).")
    media = _sniff_image(data)  # by content, not by file name
    if not media:
        raise HTTPException(400, "PNG, JPG, WEBP 이미지만 받을 수 있습니다.")
    _rate_limit(request, "parse")
    try:
        ev = ai.parse_event_image(data, media)
    except ai.QuotaExceeded as e:
        raise HTTPException(429, str(e))
    except Exception as e:
        if not ai.is_outage(e):
            raise HTTPException(422, "이미지에서 일정을 읽지 못했습니다. 공지 부분만 잘라서 올리거나 글로 입력해 주세요.")
        ai.record_status(False, type(e).__name__)
        raise HTTPException(503, "AI(Bedrock) 호출에 실패했습니다. 공지 내용을 글로 입력해 주세요.")
    ai.record_status(True)
    try:
        chk = service.check_event(ev)
        ev = {**ev, "check": {k: chk.get(k) for k in ("ok", "conflicts", "capacity_ok", "capacity", "alternatives", "note", "target")}}
    except Exception:
        pass
    return ev


@app.get("/api/settings")
def get_settings():
    return service.settings()


@app.put("/api/settings")
def put_settings(body: dict = Body(...)):
    res = service.save_settings(body)
    service._queue_precompute()
    return res


@app.post("/api/settings/reset")
def reset_settings():
    res = service.save_settings(config.default_settings())
    service._queue_precompute()
    return res


@app.post("/api/whatif")
def whatif(body: dict = Body(...)):
    d0 = _date(body["start_date"])
    n = max(1, min(int(body.get("days", 3)), 7))
    return service.what_if(body.get("overrides", {}), [d0 + timedelta(days=i) for i in range(n)])


@app.get("/api/audit")
def audit(limit: int = 100):
    return service.audit_log(limit)


@app.get("/api/consolidation")
def consolidation(weekday: int | None = None):
    if weekday is not None and not 0 <= weekday <= 5:
        raise HTTPException(400, "weekday는 0(월)~5(토)입니다.")
    return service.consolidation(weekday, allow_stale=weekday is None)


@app.get("/api/attribution")
def attribution(days: bool = False):
    res = service.attribution(allow_stale=True)
    if res is None:
        return JSONResponse({"status": "computing", "detail": "절감 요인 분석을 계산 중입니다. 1~2분 뒤 다시 확인하세요."}, status_code=202)
    return res if days else {k: v for k, v in res.items() if k != "days"}


@app.get("/api/export/plan.csv")
def export_plan(date: str, strategy: str = "ai"):
    txt = service.plan_csv(_date(date), strategy)
    return PlainTextResponse(txt, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="hvac_plan_{date}.csv"'})


@app.get("/api/history")
def history(d: str, device: str | None = None):
    rows = service.get_day(_date(d))["history"]
    if device:
        rows = [r for r in rows if r["device"] == device or r.get("room") == device]
    return rows


@app.post("/api/chat")
def chat(request: Request, body: dict = Body(...)):
    raw = body.get("messages") or []
    # only plain user/assistant text turns are accepted (no client-injected system/tool content)
    msgs = [{"role": m.get("role"), "content": str(m.get("content"))[:4000]}
            for m in raw if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")]
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(400, "messages의 마지막은 user 메시지여야 합니다.")
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    _rate_limit(request, "chat")
    job = jobs.create("chat", {"messages": msgs[-12:]})
    return {"job": job["id"]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    job = {k: v for k, v in job.items() if k not in ("payload", "trace")}
    return job


@app.post("/api/admin/reset")
def admin_reset(request: Request):
    """Demo reset (operator only): remove all events, restore default rules."""
    if not OPERATOR_KEY or request.headers.get("x-operator-key") != OPERATOR_KEY:
        raise HTTPException(403, "운영자 키가 필요합니다.")
    st = service.get_store()
    removed = 0
    for ev in service.events():
        st.delete_item("event", ev["id"])
        removed += 1
    st.put_item("settings", "active", config.default_settings())
    seed = timetable.parse_grid_csv(service.RAW_CSV.read_text(encoding="utf-8-sig"), source="부산대 시간표 CSV")
    st.replace_kind("course", {c["id"]: c for c in seed})
    # v5 state: schedule adjustments, controller commands, occupant/operator feedback (simulated history kept),
    # operation mode, policy and building profile back to their defaults
    from . import planning

    st.replace_kind("adjustment", {})
    st.replace_kind("command", {})
    st.replace_kind("tier_run", {})
    kept = {f["id"]: f for f in st.list_items("feedback") if f.get("source") == "simulated"}
    st.replace_kind("feedback", kept)
    st.put_item("meta", "op_mode", {"mode": "recommend", "changed_at": None, "by": None})
    st.put_item("policy", "active", {})
    st.delete_item("meta", "building_profile")
    planning.clear_cache()
    service.audit("admin", f"데모 초기화: 이벤트 {removed}개 삭제, 운영 규칙 기본값·시간표 원본 복원, 조정안·제어 명령·의견 초기화, 추천 모드", "운영자")
    service._queue_precompute(force=True)
    return {"events_removed": removed, "settings": "default", "courses": len(seed)}


# ---------------------------------------------------------------- v5: onboarding, tiers, feedback, agents, mode

@app.get("/api/building")
def get_building():
    from . import onboarding

    return onboarding.building()


@app.put("/api/building")
def put_building(body: dict = Body(...)):
    from . import onboarding

    return onboarding.save_building(body)


@app.post("/api/onboarding/profile")
def onboarding_profile(request: Request, body: dict = Body(...)):
    from . import onboarding

    text = str(body.get("text") or "").strip()
    if not text or len(text) > 500:
        raise HTTPException(400, "건물 설명은 1~500자여야 합니다.")
    _rate_limit(request, "parse")
    return onboarding.parse_profile(text)


@app.post("/api/onboarding/connect")
def onboarding_connect(body: dict = Body(...)):
    from . import onboarding

    return onboarding.connect(body)


@app.get("/api/onboarding/collect")
def onboarding_collect():
    from . import onboarding

    return onboarding.collect()


@app.post("/api/onboarding/answers")
def onboarding_answers(body: dict = Body(...)):
    from . import onboarding

    ans = body.get("answers")
    if not isinstance(ans, dict):
        raise HTTPException(400, "answers는 객체여야 합니다.")
    return onboarding.apply_answers(ans)


@app.get("/api/policy")
def get_policy():
    from . import planning

    return planning.policy()


@app.put("/api/policy")
def put_policy(body: dict = Body(...)):
    from . import planning

    return planning.save_policy(body)


@app.get("/api/mode")
def get_mode():
    from . import planning

    return planning.mode()


@app.put("/api/mode")
def put_mode(body: dict = Body(...)):
    from . import planning

    return planning.set_mode(str(body.get("mode")))


@app.get("/api/plan/tier/{tier}")
def plan_tier(tier: int, date: str | None = None):
    from . import planning

    if tier not in (1, 2, 3):
        raise HTTPException(400, "tier는 1, 2, 3 중 하나입니다.")
    try:
        return planning.tier_plan(tier, _date(date) if date else None)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/plan/runs")
def plan_runs():
    from . import planning

    return planning.tier_runs()


@app.post("/api/plan/tier/{tier}/run")
def plan_tier_run(tier: int, request: Request, body: dict = Body(default={})):
    """Compute this tier now, step by step, as a job the screen can watch."""
    if tier not in (1, 2, 3):
        raise HTTPException(400, "tier는 1, 2, 3 중 하나입니다.")
    _rate_limit(request, "tier_run", 20)
    d = body.get("date")
    if d:
        _date(str(d))
    job = jobs.create("tier_run", {"tier": tier, "date": d, "actor": "운영자"})
    return {"job": job["id"]}


@app.get("/api/adjustments")
def list_adjustments(status: str | None = None):
    from . import planning

    return planning.adjustments(status)


@app.post("/api/adjustments/{adj_id}/approve")
def approve_adjustment(adj_id: str):
    from . import planning

    return planning.apply_adjustment(adj_id, "운영자")


@app.post("/api/adjustments/{adj_id}/reject")
def reject_adjustment(adj_id: str):
    from . import planning

    return planning.reject_adjustment(adj_id, "운영자")


@app.get("/api/commands")
def list_commands(limit: int = 50):
    from . import planning

    return planning.commands(max(1, min(limit, 500)))


@app.post("/api/feedback")
def post_feedback(request: Request, body: dict = Body(...)):
    from . import planning

    import hashlib

    _rate_limit(request, "feedback", 20)
    addr = request.headers.get("cloudfront-viewer-address") or request.headers.get("x-forwarded-for") or (
        request.client.host if request.client else "")
    ua = request.headers.get("user-agent", "")
    client = hashlib.sha1(f"{addr.split(',')[0].rsplit(':', 1)[0]}|{ua}".encode()).hexdigest()[:12]  # not stored raw
    return planning.add_feedback(body, str(body.get("source") or "occupant"), client)


@app.get("/api/feedback")
def get_feedback(days: int = 14, room: str | None = None):
    from . import planning

    return planning.feedback_summary(max(1, min(days, 60)), room)


@app.post("/api/negotiate")
def start_negotiation(request: Request, body: dict = Body(...)):
    from . import planning

    tier = int(body.get("tier") or 3)
    if tier not in (2, 3):
        raise HTTPException(400, "협의는 2차(주간) 또는 3차(일일)에서 할 수 있습니다.")
    d = _date(body["date"]) if body.get("date") else planning.plan_date()
    _rate_limit(request, "negotiate", 6)
    job = jobs.create("negotiate", {"tier": tier, "date": d.isoformat()})
    return {"job": job["id"]}


@app.get("/api/negotiate/latest")
def latest_negotiation(tier: int = 3, date: str | None = None):
    from . import agents, planning

    d = _date(date) if date else planning.plan_date()
    res = agents.latest(tier, d)
    if not res:
        raise HTTPException(404, "아직 이 날짜의 협의 기록이 없습니다.")
    return res


@app.get("/api/negotiate/compare")
def negotiation_compare(date: str | None = None):
    """Before/after of the latest daily negotiation: both ON/OFF plans, energy, comfort, and whether the
    timetable/weather/rules it was computed from are still the current ones. state='none' when never negotiated."""
    from . import agents, planning

    d = _date(date) if date else planning.plan_date()
    res = agents.compare(d)
    if not res:
        return {"date": d.isoformat(), "state": "none", "mode": planning.mode()["mode"],
                "current_inputs": agents.inputs_of(d, service.Ctx())}
    return res


@app.get("/api/iaq/{d}")
def day_iaq(d: str):
    """Estimated CO2 and head count per room (15-minute steps): computed from expected people and the
    ventilation plan, not measured by a sensor."""
    from . import planning

    dd = _date(d)
    ctx = service.Ctx()
    day = service.get_day(dd, ctx)
    rooms = {}
    for r in config.ROOMS:
        q = planning.room_iaq(dd, r, ctx, day)
        rooms[r] = {"co2": q["co2"], "people": q["people"]}
    return {"date": dd.isoformat(), "step_min": 15, "source": "estimated", "co2_max": planning.policy()["co2_max"], "rooms": rooms}


# ---------------------------------------------------------------- simulation lab (sandbox)

@app.post("/api/lab/run")
def lab_run(request: Request, body: dict = Body(...)):
    from . import lab

    mode = "llm" if body.get("mode") == "llm" else "rule"
    start = _date(body.get("start") or service.now_kst().date().isoformat())
    days = max(1, min(int(body.get("days") or 5), lab.MAX_DAYS[mode]))
    _rate_limit(request, "lab", 6 if mode == "rule" else 3)
    job = jobs.create("lab", {"start": start.isoformat(), "days": days, "mode": mode})
    return {"job": job["id"], "days": days, "mode": mode}


@app.get("/api/lab/last")
def lab_last():
    from . import lab

    res = lab.last()
    if not res:
        raise HTTPException(404, "아직 실행한 시뮬레이션이 없습니다.")
    return res


@app.get("/api/lab/evaluation")
def lab_evaluation():
    """Offline agent evaluation (scripts/eval_agents.py): period outcomes, grounding, consistency."""
    import json as _json

    from .service import DATA_DIR

    p = DATA_DIR / "evaluation_agents.json"
    if not p.exists():
        raise HTTPException(404, "평가 결과가 없습니다. scripts/eval_agents.py를 실행하세요.")
    return _json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/lab/measured")
def lab_measured():
    from . import lab

    m = lab.measured()
    return {k: v for k, v in m.items() if k != "points"} if m else None


@app.post("/api/lab/measured")
async def lab_measured_upload(file: UploadFile = File(...)):
    from . import lab

    data = await file.read()
    if len(data) > 3_000_000:
        raise HTTPException(413, "파일이 너무 큽니다(최대 3MB).")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp949", errors="replace")
    m = lab.parse_measured(text, file.filename or "measured.csv")
    return {k: v for k, v in m.items() if k != "points"}


@app.delete("/api/lab/measured")
def lab_measured_clear():
    from . import lab

    lab.clear_measured()
    return {"cleared": True}


@app.post("/api/respond/preview")
def respond_preview(request: Request, body: dict = Body(...)):
    """Change response: apply one change to the day and show how the AI operation reacts (nothing saved)."""
    from . import respond

    _rate_limit(request, "respond", 30)
    d = _date(body["date"]) if body.get("date") else None
    return respond.preview(str(body.get("kind") or ""), d)


# ---------------------------------------------------------------- edge gateway (outbound HTTPS from the building)

@app.post("/api/gateway/pair")
def gateway_pair(request: Request, body: dict = Body(...)):
    from . import gateway

    _rate_limit(request, "gwpair", 10)
    addr = request.headers.get("cloudfront-viewer-address") or (request.client.host if request.client else "")
    return gateway.pair(body, addr.split(",")[0][:60])


@app.post("/api/gateway/telemetry")
def gateway_telemetry(request: Request, body: dict = Body(...)):
    from . import gateway

    return gateway.telemetry(body, request.headers.get("x-gateway-token"))


@app.post("/api/gateway/ack")
def gateway_ack(request: Request, body: dict = Body(...)):
    from . import gateway

    return gateway.ack(body, request.headers.get("x-gateway-token"))


@app.get("/api/gateway/status")
def gateway_status():
    from . import gateway

    return gateway.status()


@app.post("/api/precompute")
def precompute():
    service._queue_precompute()
    return {"queued": True}
