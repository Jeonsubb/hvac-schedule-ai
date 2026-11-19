"""Application service: data loading, caching by input fingerprint, recomputation, audit."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

from hvac import config, engine, timetable, weather
from hvac.consolidate import recommend
from hvac.timetable import hm_to_min, min_to_hm

from .store import get_store

ENGINE_VERSION = "v8"
DATA_DIR = Path(__file__).resolve().parents[1] / "seed"
RAW_CSV = DATA_DIR / "timetable_3_4.csv"
KST = weather.KST


def now_kst() -> datetime:
    override = os.environ.get("NOW_OVERRIDE")
    if override:
        return datetime.fromisoformat(override).replace(tzinfo=KST)
    return weather.now_kst()


def semester_range() -> tuple[date, date]:
    return config.SEMESTER["start"], config.SEMESTER["end"]


def weather_range() -> list[date]:
    s, e = semester_range()
    s = s - timedelta(days=3)
    return [s + timedelta(days=i) for i in range((e - s).days + 1)]


# ---------------------------------------------------------------- inputs

def settings() -> dict:
    st = get_store().get_item("settings", "active")
    base = config.default_settings()
    if st:
        base.update(st)
    return base


def save_settings(new: dict, actor: str = "운영자") -> dict:
    cur = settings()
    allowed = set(config.DEFAULT_SETTINGS)
    changes = {k: v for k, v in new.items() if k in allowed and cur.get(k) != v}
    merged = {**cur, **changes}
    get_store().put_item("settings", "active", merged)
    if changes:
        audit("settings", f"운영 규칙 변경: {', '.join(f'{k}={v}' for k, v in changes.items())}", actor, {"changes": changes})
    return merged


def courses() -> list[dict]:
    items = get_store().list_items("course")
    if not items:
        items = timetable.parse_grid_csv(RAW_CSV.read_text(encoding="utf-8-sig"), source="부산대 시간표 CSV")
        get_store().replace_kind("course", {c["id"]: c for c in items})
    return sorted(items, key=lambda c: (c["room"], c["weekday"], c["start"]))


def events() -> list[dict]:
    return sorted(get_store().list_items("event"), key=lambda e: (e.get("date", ""), e.get("start") or ""))


def audit(kind: str, message: str, actor: str = "시스템", data: dict | None = None) -> dict:
    ts = now_kst().isoformat(timespec="seconds")
    rec = {"id": f"{ts}-{uuid.uuid4().hex[:6]}", "ts": ts, "kind": kind, "message": message, "actor": actor, "data": data or {}}
    get_store().put_item("audit", rec["id"], rec)
    return rec


def audit_log(limit: int = 100) -> list[dict]:
    return sorted(get_store().list_items("audit"), key=lambda a: a["ts"], reverse=True)[:limit]


# ---------------------------------------------------------------- weather

_wx_cache: dict = {"key": None, "data": None, "src": None}


def weather_sources() -> dict:
    src = get_store().get_blob("weather/sources.json")
    if not src:
        src = refresh_weather(save_snapshots=False)
    return src


def refresh_weather(save_snapshots: bool = True) -> dict:
    s = weather_range()
    key = os.environ.get("KMA_KEY") or _ssm_kma_key()
    src = weather.fetch_sources(now_kst().date(), s[0], s[-1], config.BUILDING["lat"], config.BUILDING["lon"],
                                config.BUILDING["kma_nx"], config.BUILDING["kma_ny"], key)
    src["today"] = now_kst().date().isoformat()
    get_store().put_blob("weather/sources.json", src)
    if save_snapshots and src.get("kma_forecast", {}).get("hourly"):
        # keep the KMA forecast that was valid before each future day started (planner view)
        today = now_kst().date()
        by_day: dict[str, dict] = {}
        for k, v in src["kma_forecast"]["hourly"].items():
            if k[:10] > today.isoformat():
                by_day.setdefault(k[:10], {})[k[11:13]] = v
        for d, hours in by_day.items():
            get_store().put_item("kma_snapshot", d, {"date": d, "base": src["kma_forecast"]["base"], "hours": hours})
    _wx_cache["key"] = None
    return src


def _ssm_kma_key() -> str | None:
    name = os.environ.get("KMA_KEY_PARAM")
    if not name:
        return None
    try:
        import boto3

        r = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)
        os.environ["KMA_KEY"] = r["Parameter"]["Value"]
        return os.environ["KMA_KEY"]
    except Exception:
        return None


def weather_by_date() -> dict:
    src = weather_sources()
    snaps = {s["date"]: s["hours"] for s in get_store().list_items("kma_snapshot")}
    key = (src.get("fetched_at"), len(snaps))
    if _wx_cache["key"] != key:
        today = date.fromisoformat(src.get("today") or now_kst().date().isoformat())
        _wx_cache["data"] = weather.build_weather(src, weather_range(), today, kma_snapshots=snaps)
        _wx_cache["key"] = key
        _wx_cache["src"] = src
    return _wx_cache["data"]


# ---------------------------------------------------------------- fingerprints & cache

def _h(obj) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:12]


def day_fingerprint(d: date, cs: list, evs: list, wx: dict, st: dict) -> str:
    days = [d - timedelta(days=2), d - timedelta(days=1), d]
    parts = [ENGINE_VERSION, _h(st)]
    for x in days:
        ss = timetable.sessions_for_date(x, cs, evs)
        parts.append(_h([(s["room"], s["start"], s["end"], s["expected_people"]) for s in ss]))
        parts.append(_h(wx.get(x.isoformat())))
    return _h(parts)


class Ctx:
    """Inputs loaded once per request."""

    def __init__(self):
        self.settings = settings()
        self.courses = courses()
        self.events = events()
        self.wx = weather_by_date()


def get_day(d: date, ctx: Ctx | None = None, persist: bool = True) -> dict:
    ctx = ctx or Ctx()
    fp = day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings)
    key = f"days/{d.isoformat()}/{fp}.json"
    st = get_store()
    day = st.get_blob(key)
    if day is None:
        day = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, ctx.settings)
        day["fingerprint"] = fp
        day["computed_at"] = now_kst().isoformat(timespec="seconds")
        if persist:
            st.put_blob(key, day)
            st.put_blob(f"daysum/{d.isoformat()}/{fp}.json", engine.summarize_day(day))
    return day


def get_day_summary(d: date, ctx: Ctx) -> dict:
    fp = day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings)
    sm = get_store().get_blob(f"daysum/{d.isoformat()}/{fp}.json")
    if sm is None:
        sm = engine.summarize_day(get_day(d, ctx))
    return sm


def semester_summary(ctx: Ctx | None = None, allow_stale: bool = False) -> dict:
    """Semester index. With allow_stale, a request never computes the whole semester inline:
    it returns the latest summary (flagged stale) and queues a background precompute."""
    ctx = ctx or Ctx()
    s, e = semester_range()
    dates = [s + timedelta(days=i) for i in range((e - s).days + 1)]
    key_all = _h([day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings) for d in dates])
    cached = get_store().get_blob(f"summary/{key_all}.json")
    if cached:
        return cached
    if allow_stale:
        latest = get_store().get_blob("summary/latest.json")
        if latest:
            _queue_precompute()
            return {**latest, "stale": True}
    # fetch existing per-day summaries in parallel, compute the rest
    with ThreadPoolExecutor(max_workers=16) as ex:
        days = list(ex.map(lambda d: get_day_summary(d, ctx), dates))
    today = now_kst().date().isoformat()
    totals = {}
    for stg in config.STRATEGIES:
        for scope in ("all", "to_date"):
            sel = [x for x in days if scope == "all" or x["date"] <= today]
            agg = {"kwh": 0.0, "cost_krw": 0, "co2_kg": 0.0, "on_minutes": 0, "odu_on_minutes": 0, "discomfort_dm": 0.0}
            comfort_num = comfort_den = 0.0
            peak = 0.0
            for x in sel:
                v = x["strategies"].get(stg)
                if not v:
                    continue
                for k in agg:
                    agg[k] += v[k]
                peak = max(peak, v["peak_kw"])
                if v["comfort_pct"] is not None:
                    comfort_num += v["comfort_pct"] * x["sessions"]
                    comfort_den += x["sessions"]
            agg = {k: round(v, 1) for k, v in agg.items()}
            agg["peak_kw"] = round(peak, 1)
            agg["comfort_pct"] = round(comfort_num / comfort_den, 2) if comfort_den else None
            totals.setdefault(scope, {})[stg] = agg
    dec = {}
    for x in days:
        for k, v in x.get("decisions", {}).items():
            dec[k] = dec.get(k, 0) + v
    out = {"days": days, "totals": totals, "decisions": dec, "today": today,
           "computed_at": now_kst().isoformat(timespec="seconds"),
           "weather_sources": sorted({(ctx.wx[x['date']]['src_actual'], ctx.wx[x['date']]['src_forecast']) for x in days})}
    get_store().put_blob(f"summary/{key_all}.json", out)
    get_store().put_blob("summary/latest.json", out)
    return out


def _queue_precompute() -> None:
    """Start at most one background precompute per minute."""
    st = get_store()
    last = st.get_item("meta", "precompute_queued") or {}
    now = time.time()
    if now - float(last.get("t", 0)) < 60:
        return
    st.put_item("meta", "precompute_queued", {"t": now})
    from . import jobs

    jobs.create("precompute", {})


# ---------------------------------------------------------------- "now" (demo clock)

def effective_now(ctx: Ctx, at: str | None = None) -> dict:
    """Live clock; on days without lectures fall back to the latest lecture day, same time."""
    real = now_kst()
    if at:
        dt = datetime.fromisoformat(at)
        return {"date": dt.date().isoformat(), "minute": dt.hour * 60 + dt.minute, "live": False,
                "reason": "선택한 기준 시각", "real": real.isoformat(timespec="minutes")}
    d = real.date()
    minute = real.hour * 60 + real.minute
    reason = "실시간"
    probe = d
    for _ in range(14):
        if timetable.sessions_for_date(probe, ctx.courses, ctx.events):
            break
        probe -= timedelta(days=1)
    if probe != d:
        reason = f"오늘({d.strftime('%m/%d')})은 강의가 없어 최근 강의일 기준으로 표시"
        minute = min(max(minute, 9 * 60), 18 * 60)
    return {"date": probe.isoformat(), "minute": minute, "live": probe == d, "reason": reason,
            "real": real.isoformat(timespec="minutes")}


# ---------------------------------------------------------------- events & imports

def add_event(ev: dict, actor: str = "운영자") -> dict:
    ctx = Ctx()
    d = date.fromisoformat(ev["date"])
    before = engine.summarize_day(get_day(d, ctx))
    ev = {**ev}
    ev.setdefault("id", "E" + uuid.uuid4().hex[:8])
    ev.setdefault("created_at", now_kst().isoformat(timespec="seconds"))
    get_store().put_item("event", ev["id"], ev)
    ctx2 = Ctx()
    after = engine.summarize_day(get_day(d, ctx2))
    audit("event", f"이벤트 등록: {describe_event(ev)}", actor, {"event": ev, "before": before, "after": after})
    return {"event": ev, "before": before, "after": after}


def delete_event(event_id: str, actor: str = "운영자") -> dict:
    ev = get_store().get_item("event", event_id)
    if not ev:
        return {"deleted": False}
    get_store().delete_item("event", event_id)
    audit("event", f"이벤트 삭제: {describe_event(ev)}", actor, {"event": ev})
    return {"deleted": True}


def describe_event(ev: dict) -> str:
    t = {"add": "추가", "cancel": "휴강", "move": "강의실 변경", "closure": "휴관"}.get(ev["type"], ev["type"])
    room = ev.get("room") or ev.get("new_room") or "전체"
    tm = f"{ev.get('start', '')}~{ev.get('end', '')}" if ev.get("start") else ""
    return f"{ev['date']} {room}호 {tm} {ev.get('title', '')} ({t})".replace("  ", " ")


def preview_courses(new: list[dict]) -> dict:
    cur = {c["id"]: c for c in courses()}
    nw = {c["id"]: c for c in new}
    return {"count": len(new), "added": [c for k, c in nw.items() if k not in cur][:200],
            "removed": [c for k, c in cur.items() if k not in nw][:200],
            "unchanged": sum(1 for k in nw if k in cur), "courses": new}


def commit_courses(new: list[dict], source: str, actor: str = "운영자") -> dict:
    weekly = [c for c in new if c.get("weekday") is not None]
    dated = [c for c in new if c.get("weekday") is None and c.get("date")]
    get_store().replace_kind("course", {c["id"]: c for c in weekly})
    for c in dated:
        add_ev = {"type": "add", "date": c["date"], "room": c["room"], "start": c["start"], "end": c["end"],
                  "title": c["class_name"], "expected_people": c["expected_people"], "source": source}
        get_store().put_item("event", "E" + uuid.uuid4().hex[:8], {**add_ev, "id": "E" + uuid.uuid4().hex[:8]})
    audit("import", f"시간표 반영: 주간 강의 {len(weekly)}개, 일회성 일정 {len(dated)}개 ({source})", actor)
    return {"weekly": len(weekly), "dated": len(dated)}


# ---------------------------------------------------------------- what-if & exports

def what_if(overrides: dict, dates: list[date]) -> dict:
    ctx = Ctx()
    st = {**ctx.settings, **{k: v for k, v in overrides.items() if k in config.DEFAULT_SETTINGS}}
    res = {"base": {}, "new": {}, "dates": [d.isoformat() for d in dates], "overrides": overrides}
    for label, s in (("base", ctx.settings), ("new", st)):
        tot: dict = {}
        for d in dates:
            day = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, s, detail=False)
            sm = engine.summarize_day(day)
            for stg, v in sm["strategies"].items():
                t = tot.setdefault(stg, {"kwh": 0.0, "discomfort_dm": 0.0, "comfort_num": 0.0, "n": 0})
                t["kwh"] += v["kwh"]
                t["discomfort_dm"] += v["discomfort_dm"]
                if v["comfort_pct"] is not None:
                    t["comfort_num"] += v["comfort_pct"]
                    t["n"] += 1
        res[label] = {k: {"kwh": round(v["kwh"], 1), "discomfort_dm": round(v["discomfort_dm"], 1),
                          "comfort_pct": round(v["comfort_num"] / v["n"], 2) if v["n"] else None} for k, v in tot.items()}
    return res


def plan_csv(d: date, strategy: str = "ai") -> str:
    day = get_day(d)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "device", "room", "time", "command", "mode", "heat_setpoint", "cool_setpoint", "reason"])
    st = settings()
    plan = day["strategies"][strategy]["plan"]
    for r, ivs in sorted(plan.items()):
        for iv in ivs:
            for idu in config.ROOMS[r]["idus"]:
                mode = "AUTO" if iv.get("kind") == "cond" else "FAN"
                w.writerow([d.isoformat(), idu["id"], r, min_to_hm(iv["s"]), "ON", mode, st["sp_heat"], st["sp_cool"], iv.get("reason", "")])
                w.writerow([d.isoformat(), idu["id"], r, min_to_hm(iv["e"]), "OFF", "", "", "", "계획 정지"])
    return buf.getvalue()


def consolidation(weekday: int | None = None) -> dict:
    ctx = Ctx()
    return recommend(ctx.courses, ctx.events, ctx.wx, ctx.settings, weekday=weekday)


def live_snapshot(ctx: Ctx, at: str | None = None) -> dict:
    now = effective_now(ctx, at)
    d = date.fromisoformat(now["date"])
    day = get_day(d, ctx)
    m = now["minute"]
    k = min(m // 5, 287)
    ai = day["strategies"]["ai"]
    rooms = []
    for r, room in config.ROOMS.items():
        rr = ai["rooms"][r]
        on = next((iv for iv in rr["actual"] if iv["s"] <= m < iv["e"]), None)
        cur = next((s for s in day["sessions"] if s["room"] == r and hm_to_min(s["start"]) <= m < hm_to_min(s["end"])), None)
        nxt = next((s for s in sorted(day["sessions"], key=lambda s: s["start"]) if s["room"] == r and hm_to_min(s["start"]) > m), None)
        rooms.append({"room": r, "type": room["type_label"], "floor": room["floor"], "odu": room["odu"],
                      "state": ("ON" if on["kind"] == "cond" else "FAN") if on else "OFF",
                      "ta": rr["ta"][k], "power_w": rr["p"][k], "session": cur, "next": nxt})
    odus = {o: {"on": any(iv["s"] <= m < iv["e"] for iv in v["actual"]), "power_w": v["p"][k]} for o, v in ai["odus"].items()}
    wx = day["weather"]["actual"]
    h = min(m // 60, 23)
    return {"now": now, "rooms": rooms, "odus": odus,
            "outdoor": {"t": wx["t"][h], "rh": wx["rh"][h], "src": day["weather"]["src_actual"]},
            "kwh_so_far": {stg: round(sum(v["kwh_by_hour"][:h]) + v["kwh_by_hour"][h] * (m % 60) / 60, 2)
                           for stg, v in day["strategies"].items()},
            "date_summary": engine.summarize_day(day)}


def precompute(log=print) -> dict:
    t = time.time()
    ctx = Ctx()
    sm = semester_summary(ctx)
    log(f"precompute done in {time.time() - t:.1f}s, days={len(sm['days'])}")
    return {"seconds": round(time.time() - t, 1), "days": len(sm["days"])}
