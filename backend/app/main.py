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
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")


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
    job = jobs.create("refresh", {})
    return {"job": job["id"]}


@app.get("/api/courses")
def courses():
    return service.courses()


@app.post("/api/import")
async def import_file(file: UploadFile = File(...), hint: str = Form("")):
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
    job = jobs.create("extract", {"data_b64": base64.b64encode(data).decode(), "media_type": media,
                                  "filename": name, "hint": hint})
    return {"mode": "job", "job": job["id"], "source": name}


@app.post("/api/import/commit")
def import_commit(body: dict = Body(...)):
    res = service.commit_courses(body["courses"], body.get("source", "가져오기"))
    jobs.create("precompute", {})
    return res


@app.post("/api/import/api")
def import_api(body: dict = Body(...)):
    """External system push (API/DB integration): long-format records."""
    new = timetable.normalize_records(body.get("records", []), source=body.get("source", "API"))
    if body.get("commit"):
        return {"committed": service.commit_courses(new, body.get("source", "API"))}
    return {"preview": service.preview_courses(new)}


@app.get("/api/events")
def list_events():
    return service.events()


@app.post("/api/events")
def create_event(ev: dict = Body(...)):
    if ev.get("type") not in ("add", "cancel", "move", "closure") or not ev.get("date"):
        raise HTTPException(400, "type(add|cancel|move|closure)와 date가 필요합니다.")
    _date(ev["date"])
    if ev["type"] == "add" and not (ev.get("room") in config.ROOMS and ev.get("start") and ev.get("end")):
        raise HTTPException(400, "추가 일정은 room(IT관 강의실), start, end가 필요합니다.")
    res = service.add_event({k: v for k, v in ev.items() if k != "clarification"})
    service._queue_precompute()
    return res


@app.delete("/api/events/{event_id}")
def remove_event(event_id: str):
    res = service.delete_event(event_id)
    service._queue_precompute()
    return res


@app.post("/api/events/parse")
def parse_event(body: dict = Body(...)):
    from . import ai

    try:
        return ai.parse_event(body["text"])
    except ai.QuotaExceeded as e:
        raise HTTPException(429, str(e))


@app.get("/api/settings")
def get_settings():
    return service.settings()


@app.put("/api/settings")
def put_settings(body: dict = Body(...)):
    res = service.save_settings(body)
    jobs.create("precompute", {})
    return res


@app.post("/api/settings/reset")
def reset_settings():
    res = service.save_settings(config.default_settings())
    jobs.create("precompute", {})
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
    return service.consolidation(weekday)


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
def chat(body: dict = Body(...)):
    msgs = body.get("messages") or []
    if not msgs or msgs[-1].get("role") != "user":
        raise HTTPException(400, "messages의 마지막은 user 메시지여야 합니다.")
    job = jobs.create("chat", {"messages": msgs[-12:]})
    return {"job": job["id"]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    job = {k: v for k, v in job.items() if k not in ("payload", "trace")}
    return job


@app.post("/api/precompute")
def precompute():
    job = jobs.create("precompute", {})
    return {"job": job["id"]}
