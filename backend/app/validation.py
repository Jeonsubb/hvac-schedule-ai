"""Input validation for operator-supplied data (settings, events, imported courses).

Everything is normalised and checked *before* it is persisted, so a bad request returns
400 instead of poisoning every later computation.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from hvac import config

_HM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class InvalidInput(ValueError):
    pass


def hm(v, field: str) -> str:
    s = str(v or "").strip()
    m = _HM.match(s)
    if not m:
        raise InvalidInput(f"{field}: HH:MM 형식이어야 합니다 (입력: {v!r})")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def iso_date(v, field: str = "date") -> str:
    s = str(v or "").strip()
    try:
        d = date.fromisoformat(s)
    except ValueError:
        raise InvalidInput(f"{field}: YYYY-MM-DD 형식이어야 합니다 (입력: {v!r})")
    if len(s) != 10:
        raise InvalidInput(f"{field}: YYYY-MM-DD 형식이어야 합니다 (입력: {v!r})")
    return d.isoformat()


def in_semester(d: str) -> None:
    x = date.fromisoformat(d)
    if not (config.SEMESTER["start"] <= x <= config.SEMESTER["end"]):
        raise InvalidInput(f"날짜는 학기 기간({config.SEMESTER['start']} ~ {config.SEMESTER['end']}) 안이어야 합니다.")


def in_weather_range(d: date) -> None:
    lo = config.SEMESTER["start"] - timedelta(days=1)
    if not (lo <= d <= config.SEMESTER["end"]):
        raise InvalidInput(f"조회 가능한 날짜는 {lo} ~ {config.SEMESTER['end']} 입니다.")


def room(v, field: str = "room") -> str:
    s = re.sub(r"[^0-9]", "", str(v or ""))
    if s not in config.ROOMS:
        raise InvalidInput(f"{field}: IT관 강의실({', '.join(config.ROOMS)}) 중 하나여야 합니다 (입력: {v!r})")
    return s


def _minutes(a: str) -> int:
    h, m = a.split(":")
    return int(h) * 60 + int(m)


def event(ev: dict, known_course_ids: set[str]) -> dict:
    t = ev.get("type")
    if t not in ("add", "cancel", "move", "closure"):
        raise InvalidInput("type은 add, cancel, move, closure 중 하나여야 합니다.")
    out = {"type": t, "date": iso_date(ev.get("date"))}
    in_semester(out["date"])
    title = str(ev.get("title") or "").strip()[:80]
    if t == "add":
        out["room"] = room(ev.get("room"))
        out["start"], out["end"] = hm(ev.get("start"), "start"), hm(ev.get("end"), "end")
        if _minutes(out["end"]) <= _minutes(out["start"]):
            raise InvalidInput("종료 시각은 시작 시각보다 늦어야 합니다.")
        out["title"] = title or "이벤트"
        people = ev.get("expected_people")
        if people not in (None, ""):
            try:
                p = int(people)
            except (TypeError, ValueError):
                raise InvalidInput("expected_people는 정수여야 합니다.")
            if not 1 <= p <= 500:
                raise InvalidInput("expected_people는 1~500 사이여야 합니다.")
            out["expected_people"] = p
    elif t == "cancel":
        cid = ev.get("course_id")
        if cid:
            if cid not in known_course_ids:
                raise InvalidInput(f"course_id {cid!r}에 해당하는 강의가 없습니다.")
            out["course_id"] = cid
        else:
            out["room"] = room(ev.get("room"))
            if ev.get("start") or ev.get("end"):
                out["start"], out["end"] = hm(ev.get("start"), "start"), hm(ev.get("end"), "end")
        out["title"] = title or "휴강"
    elif t == "move":
        cid = ev.get("course_id")
        if not cid or cid not in known_course_ids:
            raise InvalidInput("강의실 변경은 존재하는 course_id가 필요합니다.")
        out["course_id"] = cid
        out["new_room"] = room(ev.get("new_room"), "new_room")
        for k in ("new_start", "new_end"):
            if ev.get(k):
                out[k] = hm(ev[k], k)
        out["title"] = title or "강의실 변경"
    else:
        out["title"] = title or "건물 휴관"
    for k in ("source", "note", "host"):
        if ev.get(k):
            out[k] = str(ev[k])[:200]
    return out


_INT_BOUNDS = {
    "pre_on_min": (0, 60), "early_off_min": (0, 30), "gap_merge_min": (0, 120),
    "manual_off_delay_min": (0, 180), "ai_max_lead_min": (0, 180), "ai_max_early_off_min": (0, 60),
    "ai_gap_eval_max_min": (0, 240), "auto_off_after_min": (1, 60),
}
_FLOAT_BOUNDS = {
    "sp_heat": (15.0, 25.0), "sp_cool": (22.0, 30.0), "comfort_low": (14.0, 24.0), "comfort_high": (23.0, 31.0),
    "dehum_rh": (40.0, 100.0), "dehum_temp": (10.0, 35.0), "override_rate": (0.0, 0.3), "failure_rate": (0.0, 0.3),
    "co2_kg_per_kwh": (0.0, 2.0), "ai_margin_k": (0.0, 2.0), "ai_softstart_frac": (0.3, 1.0),
}


def settings_patch(patch: dict, current: dict) -> dict:
    """Validate a partial settings update against bounds and cross-field rules."""
    out = {}
    for k, v in patch.items():
        if k in _INT_BOUNDS:
            try:
                f = float(v)
            except (TypeError, ValueError):
                raise InvalidInput(f"{k}: 숫자여야 합니다.")
            if f != int(f):
                raise InvalidInput(f"{k}: 정수(분)여야 합니다.")
            lo, hi = _INT_BOUNDS[k]
            if not lo <= f <= hi:
                raise InvalidInput(f"{k}: {lo}~{hi} 범위여야 합니다.")
            out[k] = int(f)
        elif k in _FLOAT_BOUNDS:
            try:
                f = float(v)
            except (TypeError, ValueError):
                raise InvalidInput(f"{k}: 숫자여야 합니다.")
            lo, hi = _FLOAT_BOUNDS[k]
            if not lo <= f <= hi:
                raise InvalidInput(f"{k}: {lo}~{hi} 범위여야 합니다.")
            out[k] = round(f, 3)
        elif k in ("fixed_on", "fixed_off"):
            out[k] = hm(v, k)
        elif k == "baseline":
            if v not in ("fixed", "manual"):
                raise InvalidInput("baseline은 fixed 또는 manual이어야 합니다.")
            out[k] = v
        elif k == "anomalies":
            out[k] = bool(v)
        elif k == "tariff":
            continue  # tariff is reference data, not operator-editable
    merged = {**current, **out}
    if merged["sp_heat"] >= merged["sp_cool"]:
        raise InvalidInput("난방 설정온도는 냉방 설정온도보다 낮아야 합니다.")
    if round(merged["sp_heat"] - merged["comfort_low"], 3) < 0.3 or round(merged["comfort_high"] - merged["sp_cool"], 3) < 0.3:
        raise InvalidInput("설정온도는 쾌적 범위 경계에서 0.3℃ 이상 안쪽이어야 합니다 "
                           "(sp_heat ≥ comfort_low + 0.3, sp_cool ≤ comfort_high − 0.3).")
    if _minutes(merged["fixed_off"]) <= _minutes(merged["fixed_on"]):
        raise InvalidInput("고정 스케줄 종료는 시작보다 늦어야 합니다.")
    return out


def courses(items: list[dict]) -> list[dict]:
    """Keep only well-formed course records for this building; normalise times."""
    out = []
    for c in items:
        try:
            r = room(c.get("room"))
            s, e = hm(c.get("start"), "start"), hm(c.get("end"), "end")
        except InvalidInput:
            continue
        if _minutes(e) <= _minutes(s):
            continue
        wd = c.get("weekday")
        if wd is not None:
            try:
                wd = int(wd)
            except (TypeError, ValueError):
                continue
            if not 0 <= wd <= 5:
                continue
        d = c.get("date")
        if wd is None:
            try:
                d = iso_date(d)
            except InvalidInput:
                continue
        try:
            people = max(1, min(int(c.get("expected_people") or 1), 500))
        except (TypeError, ValueError):
            people = 1
        out.append({**c, "room": r, "start": s, "end": e, "weekday": wd, "date": d if wd is None else None,
                    "class_name": str(c.get("class_name") or "수업")[:80], "expected_people": people})
    return out
