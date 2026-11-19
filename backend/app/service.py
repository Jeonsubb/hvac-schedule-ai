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

ENGINE_VERSION = "v12"
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
    from .validation import settings_patch

    cur = settings()
    clean = settings_patch({k: v for k, v in new.items() if k in config.DEFAULT_SETTINGS}, cur)
    changes = {k: v for k, v in clean.items() if cur.get(k) != v}
    merged = {**cur, **changes}
    get_store().put_item("settings", "active", merged)
    if changes:
        audit("settings", f"운영 규칙 변경: {', '.join(f'{k}={v}' for k, v in changes.items())}", actor, {"changes": changes})
    return merged


def courses() -> list[dict]:
    items = get_store().list_items("course")
    if not items and not get_store().get_item("meta", "seeded"):
        # first run only: seed the bundled PNU timetable
        items = timetable.parse_grid_csv(RAW_CSV.read_text(encoding="utf-8-sig"), source="부산대 시간표 CSV")
        get_store().replace_kind("course", {c["id"]: c for c in items})
        get_store().put_item("meta", "seeded", {"at": now_kst().isoformat(timespec="seconds")})
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
    # a failed source keeps its last good value instead of degrading the whole semester
    prev = get_store().get_blob("weather/sources.json") or {}
    for name in ("archive", "prev_day1", "om_forecast", "climatology", "kma_forecast", "kma_nowcast"):
        if name in src.get("errors", {}) and prev.get(name):
            src[name] = prev[name]
            src.setdefault("stale_sources", []).append(name)
    if not src.get("archive") and not src.get("om_forecast") and prev:
        return prev  # nothing usable fetched: keep the previous snapshot untouched
    # Freeze settled history: weather for dates two or more days ago keeps the values that were
    # first used, so past results (and every number quoted from them) stay stable across refreshes.
    cutoff = (now_kst().date() - timedelta(days=2)).isoformat()
    for name in ("archive", "prev_day1"):
        old = prev.get(name) or {}
        new = src.get(name) or {}
        for k, v in old.items():
            if k[:10] <= cutoff:
                new[k] = v
        src[name] = new
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
        parts.append(_h([(s["id"], s["room"], s["start"], s["end"], s["expected_people"], s["title"]) for s in ss]))
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
    key_all = _h([now_kst().date().isoformat()] + [day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings) for d in dates])
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
    from .validation import event as validate_event

    ev = validate_event(ev, {c["id"] for c in courses()})
    if len(get_store().list_items("event")) >= 500:
        raise ValueError("이벤트는 최대 500개까지 등록할 수 있습니다.")
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


def check_event(ev: dict) -> dict:
    """Deterministic conflict check for a draft event: double booking and capacity, plus
    alternative rooms ranked by the extra electricity the AI operation would need that day."""
    from .validation import event as validate_event

    ev = validate_event(ev, {c["id"] for c in courses()})
    ctx = Ctx()
    d = date.fromisoformat(ev["date"])
    sessions = timetable.sessions_for_date(d, ctx.courses, ctx.events)
    out = {"event": ev, "conflicts": [], "capacity_ok": True, "alternatives": [], "ok": True}
    if ev["type"] not in ("add", "move"):
        return out
    if ev["type"] == "add":
        room, s0, e0 = ev["room"], hm_to_min(ev["start"]), hm_to_min(ev["end"])
        people = ev.get("expected_people") or timetable.estimate_people(room, "")
        title = ev.get("title", "이벤트")
    else:
        course = next(c for c in ctx.courses if c["id"] == ev["course_id"])
        room = ev["new_room"]
        s0 = hm_to_min(ev.get("new_start") or course["start"])
        e0 = hm_to_min(ev.get("new_end") or course["end"])
        people, title = course["expected_people"], course["class_name"]

    def busy(r: str) -> list[dict]:
        return [s for s in sessions if s["room"] == r and s.get("course_id") != ev.get("course_id")
                and hm_to_min(s["start"]) < e0 and s0 < hm_to_min(s["end"])]

    out["conflicts"] = [{"room": room, "title": s["title"], "start": s["start"], "end": s["end"], "kind": s["kind"]}
                        for s in busy(room)]
    cap = config.ROOMS[room]["capacity"]
    out["capacity_ok"] = people <= cap
    out["capacity"] = {"room": room, "capacity": cap, "expected_people": people}
    out["ok"] = not out["conflicts"] and out["capacity_ok"]

    base = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, ctx.settings, detail=False, strategies=("ai",))
    base_kwh = base["strategies"]["ai"]["kwh"]
    odu_busy = {o: any(iv["s"] < e0 and iv["e"] > s0 for iv in v["actual"]) for o, v in base["strategies"]["ai"]["odus"].items()}
    candidates = [r for r, info in config.ROOMS.items() if info["capacity"] >= people and not busy(r)]
    if not candidates:
        biggest = max(i["capacity"] for i in config.ROOMS.values())
        out["note"] = (f"{people}명을 수용할 수 있는 빈 강의실이 없습니다(IT관 최대 정원 {biggest}명). "
                       "분반하거나 다른 건물 강의실을 확인하세요.")
    alts = []
    for r in candidates:
        trial = {"id": "CHECK", "type": "add", "date": ev["date"], "room": r, "start": timetable.min_to_hm(s0),
                 "end": timetable.min_to_hm(e0), "title": title, "expected_people": people}
        extra_events = list(ctx.events)
        if ev["type"] == "move":
            extra_events.append({"id": "CHECK-C", "type": "cancel", "date": ev["date"], "course_id": ev["course_id"]})
        day = engine.compute_day(d, ctx.courses, extra_events + [trial], ctx.wx, ctx.settings, detail=False, strategies=("ai",))
        alts.append({"room": r, "type": config.ROOMS[r]["type_label"], "capacity": config.ROOMS[r]["capacity"],
                     "odu": config.ROOMS[r]["odu"], "odu_already_on": odu_busy.get(config.ROOMS[r]["odu"], False),
                     "extra_kwh": round(day["strategies"]["ai"]["kwh"] - base_kwh, 2),
                     "requested": r == room})
    alts.sort(key=lambda a: (a["extra_kwh"], not a["odu_already_on"]))
    out["alternatives"] = alts[:4]
    out["alternatives_note"] = ("추가 전력은 그날 AI 운전을 다시 시뮬레이션한 차이입니다. "
                                "음수는 재실자 발열로 난방이 줄거나 이미 가동 중인 실외기를 함께 쓰는 경우입니다.")
    return out


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


def _content_key(c: dict) -> tuple:
    return (c.get("room"), c.get("weekday"), c.get("date"), c.get("start"), c.get("end"), (c.get("class_name") or "").strip())


def preview_courses(new: list[dict]) -> dict:
    """Diff by content (room, day, time, title). Only rooms present in the import are compared,
    because committing replaces just those rooms (scope='rooms')."""
    rooms = sorted({c["room"] for c in new})
    cur = {_content_key(c): c for c in courses() if c["room"] in rooms}
    nw = {_content_key(c): c for c in new}
    return {"count": len(new), "rooms": rooms,
            "added": [c for k, c in nw.items() if k not in cur][:200],
            "removed": [c for k, c in cur.items() if k not in nw][:200],
            "unchanged": sum(1 for k in nw if k in cur), "courses": new}


def commit_courses(new: list[dict], source: str, actor: str = "운영자", scope: str = "rooms") -> dict:
    from .validation import courses as clean_courses

    items = clean_courses(new)
    weekly = [c for c in items if c.get("weekday") is not None]
    dated = [c for c in items if c.get("weekday") is None and c.get("date")]
    if not weekly and not dated:
        raise ValueError("반영할 수 있는 강의가 없습니다(강의실·시간 형식을 확인하세요).")
    if weekly:  # only replace the weekly timetable when the import actually contains one
        keep = []
        if scope == "rooms":  # replace only the rooms present in this import
            rooms = {c["room"] for c in weekly}
            keep = [c for c in courses() if c["room"] not in rooms]
        get_store().replace_kind("course", {c["id"]: c for c in keep + weekly})
    for c in dated:
        if not (config.SEMESTER["start"].isoformat() <= c["date"] <= config.SEMESTER["end"].isoformat()):
            continue
        eid = "E" + uuid.uuid4().hex[:8]
        get_store().put_item("event", eid, {"id": eid, "type": "add", "date": c["date"], "room": c["room"],
                                            "start": c["start"], "end": c["end"], "title": c["class_name"],
                                            "expected_people": c["expected_people"], "source": source})
    audit("import", f"시간표 반영: 주간 강의 {len(weekly)}개, 일회성 일정 {len(dated)}개 ({source})", actor)
    return {"weekly": len(weekly), "dated": len(dated)}


# ---------------------------------------------------------------- what-if & exports

def what_if(overrides: dict, dates: list[date]) -> dict:
    from .validation import settings_patch

    ctx = Ctx()
    st = {**ctx.settings, **settings_patch({k: v for k, v in overrides.items() if k in config.DEFAULT_SETTINGS}, ctx.settings)}
    res = {"base": {}, "new": {}, "dates": [d.isoformat() for d in dates], "overrides": overrides}
    for label, s in (("base", ctx.settings), ("new", st)):
        tot: dict = {}
        for d in dates:
            day = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, s, detail=False)
            sm = engine.summarize_day(day)
            for stg, v in sm["strategies"].items():
                t = tot.setdefault(stg, {"kwh": 0.0, "discomfort_dm": 0.0, "comfort_num": 0.0, "n": 0, "cold_starts": 0})
                t["kwh"] += v["kwh"]
                t["discomfort_dm"] += v["discomfort_dm"]
                t["cold_starts"] += v.get("cold_starts", 0)
                if v["comfort_pct"] is not None:
                    t["comfort_num"] += v["comfort_pct"]
                    t["n"] += 1
        res[label] = {k: {"kwh": round(v["kwh"], 1), "discomfort_dm": round(v["discomfort_dm"], 1),
                          "cold_starts": v["cold_starts"],
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


def _inputs_key(ctx: Ctx) -> str:
    s, e = semester_range()
    dates = [s + timedelta(days=i) for i in range((e - s).days + 1)]
    return _h([day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings) for d in dates])


def consolidation(weekday: int | None = None, ctx: Ctx | None = None) -> dict:
    """Cached per input fingerprint (re-simulates every semester date of each weekday)."""
    ctx = ctx or Ctx()
    if weekday is not None:
        return recommend(ctx.courses, ctx.events, ctx.wx, ctx.settings, weekday=weekday)
    key = f"analysis/consolidation-{_inputs_key(ctx)}.json"
    res = get_store().get_blob(key)
    if res is None:
        res = recommend(ctx.courses, ctx.events, ctx.wx, ctx.settings)
        get_store().put_blob(key, res)
        get_store().put_blob("analysis/consolidation-latest.json", res)
    return res


def attribution(ctx: Ctx | None = None, allow_stale: bool = False) -> dict | None:
    """Savings attribution + equal-comfort comparison over the whole semester (ablation runs)."""
    from hvac import attribution as attr

    ctx = ctx or Ctx()
    key = f"analysis/attribution-{_inputs_key(ctx)}.json"
    res = get_store().get_blob(key)
    if res is not None:
        return res
    if allow_stale:
        latest = get_store().get_blob("analysis/attribution-latest.json")
        _queue_precompute()
        return {**latest, "stale": True} if latest else None
    s, e = semester_range()
    dates = [s + timedelta(days=i) for i in range((e - s).days + 1)]
    days = [attr.variants_day(d, ctx.courses, ctx.events, ctx.wx, ctx.settings) for d in dates]
    today = now_kst().date().isoformat()
    res = {"all": attr.aggregate(days), "to_date": attr.aggregate([x for x in days if x["date"] <= today]),
           "days": days, "labels": attr.LABELS, "computed_at": now_kst().isoformat(timespec="seconds"),
           "note": "같은 날씨·같은 현장 상황·같은 시작 상태로 기능을 하나씩 켜서 다시 시뮬레이션한 결과입니다. "
                   "재실 감지는 강의실 재실 센서(PIR·CO₂) 또는 출결 시스템 연동을 가정합니다."}
    get_store().put_blob(key, res)
    get_store().put_blob("analysis/attribution-latest.json", res)
    return res


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
    t1 = time.time()
    consolidation(ctx=ctx)
    attribution(ctx)
    log(f"precompute done in {time.time() - t:.1f}s (summary {t1 - t:.1f}s), days={len(sm['days'])}")
    return {"seconds": round(time.time() - t, 1), "days": len(sm["days"])}
