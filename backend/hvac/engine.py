"""Day / semester orchestration: sessions -> plans (4 strategies) -> simulation -> validation."""
from __future__ import annotations

import random
from datetime import date, timedelta

from .config import HOLIDAYS, ODUS, ROOMS, SEMESTER, STRATEGIES, tou_band
from .model import adjacent_temp, clo_for_month
from .simulate import COND, OFF, history_from_cmds, occupancy_array, simulate_day
from .strategies import plan_ai, plan_fixed, plan_manual, plan_rule
from .timetable import hm_to_min, min_to_hm, sessions_for_date
from .weather import minute_series


def season_of(d: date) -> str:
    if d.month in (6, 7, 8):
        return "summer"
    if d.month in (11, 12, 1, 2):
        return "winter"
    return "spring_fall"


def is_workday(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS and SEMESTER["start"] <= d <= SEMESTER["end"]


def field_scenario(d: date, sessions_by_room: dict, settings: dict) -> dict:
    """Seeded field deviations: unannounced no-show, early dismissal, occupant override,
    command failure. Same seed for every strategy so comparisons stay fair."""
    out = {}
    if not settings.get("anomalies", True):
        return {r: [] for r in sessions_by_room}
    for r, ss in sessions_by_room.items():
        evs = []
        for s in ss:
            rng = random.Random(f"{d.isoformat()}|{r}|{s['start']}|{s['title']}")
            a, b = hm_to_min(s["start"]), hm_to_min(s["end"])
            x = rng.random()
            if x < 0.03:
                evs.append({"type": "no_show", "session": s["id"], "s": a, "e": b})
            elif x < 0.11 and b - a >= 60:
                cut = rng.choice([20, 25, 30])
                evs.append({"type": "early_dismiss", "session": s["id"], "s": b - cut, "e": b})
            y = rng.random()
            if y < settings["override_rate"]:
                evs.append({"type": "override", "session": s["id"], "s": b + 2, "e": b + 2 + settings["auto_off_after_min"]})
            elif y < settings["override_rate"] + settings["failure_rate"]:
                evs.append({"type": "failure", "session": s["id"], "s": None, "e": None})
        out[r] = evs
    return out


def actual_occupancy(sessions_by_room: dict, scenario: dict) -> dict:
    occ = {}
    for r, ss in sessions_by_room.items():
        arr = occupancy_array(ss)
        for ev in scenario.get(r, []):
            if ev["type"] in ("no_show", "early_dismiss"):
                sess = next(s for s in ss if s["id"] == ev["session"])
                for m in range(ev["s"], min(ev["e"], 1440)):
                    arr[m] = max(0.0, arr[m] - sess["expected_people"])
        occ[r] = arr
    return occ


def ai_field_controls(plans: dict, scenario: dict, settings: dict):
    """Turn the scenario into forced commands for the operated (AI) system:
    vacancy detected 10 min after people leave -> off; override auto-off; failure retry."""
    anomalies, causes = {}, {}
    for r, evs in scenario.items():
        lst, cs = [], []
        ivs = plans.get(r, [])
        for ev in evs:
            if ev["type"] in ("no_show", "early_dismiss"):
                t0 = ev["s"] + 10
                covered = [iv for iv in ivs if iv["s"] < ev["e"] and iv["e"] > t0]
                if covered:
                    end = max(iv["e"] for iv in covered)
                    if end > t0:
                        lst.append({"type": "forced_off", "s": t0, "e": min(end, ev["e"])})
                        label = "재실 없음 10분 감지 → 자동 정지" if ev["type"] == "no_show" else "조기 종료 감지 → 자동 정지"
                        cs.append({"s": t0, "e": t0, "label": label, "on": False})
            elif ev["type"] == "override":
                lst.append({"type": "override", "s": ev["s"], "e": ev["e"]})
                cs.append({"s": ev["s"], "e": ev["s"], "label": "재실자 수동 가동(계획 외)", "on": True})
                cs.append({"s": ev["e"], "e": ev["e"], "label": f"빈 강의실 가동 감지 → {settings['auto_off_after_min']}분 후 자동 정지", "on": False})
            elif ev["type"] == "failure":
                sess_iv = next((iv for iv in ivs if ev["session"] in iv.get("sessions", [])), None)
                if sess_iv:
                    ev["s"], ev["e"] = sess_iv["s"], sess_iv["s"] + 5
                    lst.append({"type": "forced_off", "s": ev["s"], "e": ev["e"]})
                    cs.append({"s": ev["e"], "e": ev["e"], "label": "On 명령 응답 없음 → 5분 후 재전송 성공", "on": True})
        anomalies[r], causes[r] = lst, cs
    return anomalies, causes


def plan_causes(plans: dict) -> dict:
    out = {}
    for r, ivs in plans.items():
        cs = []
        for iv in ivs:
            cs.append({"s": iv["s"], "e": iv["s"], "label": iv.get("reason", "스케줄"), "on": True})
            cs.append({"s": iv["e"], "e": iv["e"], "label": "계획 정지", "on": False})
        out[r] = cs
    return out


def validate_day(sessions_by_room: dict, plans: dict, decisions: list, sim: dict, cmds: dict,
                 scenario: dict, anomalies: dict, settings: dict, guard_events: dict | None = None) -> dict:
    """Two-level check for the operated strategy.

    plan check : every session has a planned interval or a justified skip decision
    execution  : >=95 % of planned on-minutes executed (justified vacancy stops excluded),
                 room in comfort band at start, >=90 % of class minutes in band
    """
    lo, hi = settings["comfort_low"], settings["comfort_high"]
    dec_by_session: dict[str, list] = {}
    for dcs in decisions:
        for sid_ in dcs.get("sessions", [dcs["session"]]):
            dec_by_session.setdefault(sid_, []).append(dcs)
    ev_by_session: dict[str, list] = {}
    for evs in scenario.values():
        for ev in evs:
            ev_by_session.setdefault(ev["session"], []).append(ev)
    rows, issues = [], []
    for r, ss in sessions_by_room.items():
        comfort = {c["id"]: c for c in sim["rooms"][r]["sessions"]}
        plan_cmd = [0] * 1440
        for iv in plans.get(r, []):
            for m in range(max(iv["s"], 0), min(iv["e"], 1440)):
                plan_cmd[m] = 1
        justified = [0] * 1440
        for a_ in anomalies.get(r, []):
            if a_["type"] == "forced_off":
                for m in range(max(a_["s"], 0), min(a_["e"], 1440)):
                    justified[m] = 1
        for s in ss:
            a, b = hm_to_min(s["start"]), hm_to_min(s["end"])
            win = range(max(a - settings["ai_max_lead_min"], 0), min(b, 1440))
            planned_min = [m for m in win if plan_cmd[m] and not justified[m]]
            executed = sum(1 for m in planned_min if cmds[r][m] != OFF)
            exec_ratio = executed / len(planned_min) if planned_min else 1.0
            dtypes = [x["type"] for x in dec_by_session.get(s["id"], [])]
            evtypes = [x["type"] for x in ev_by_session.get(s["id"], [])]
            planned = any(plan_cmd[m] for m in range(a, min(b, 1440))) or any(plan_cmd[m] for m in win)
            justified_skip = "skip" in dtypes
            c = comfort.get(s["id"], {})
            ta0 = c.get("ta_start")
            comfort_pct = 100 * c["in_band_minutes"] / c["minutes"] if c.get("minutes") else None
            ready = ta0 is not None and lo - 0.3 <= ta0 <= hi + 0.3
            status, notes = "ok", []
            if not planned and not justified_skip:
                status = "plan_missing"
                notes.append("계획에 없는 수업")
            elif "no_show" in evtypes:
                status = "vacancy"
                notes.append("재실 없음(무단 휴강 추정) → 10분 후 자동 정지")
            else:
                if "early_dismiss" in evtypes:
                    notes.append("조기 종료 감지 → 자동 정지")
                if exec_ratio < 0.95:
                    status = "exec_gap"
                    notes.append(f"계획 대비 실행 {exec_ratio * 100:.0f}%")
                elif not justified_skip and not ready and "late_start" not in dtypes:
                    status = "not_ready"
                    notes.append(f"시작 시 실내 {ta0}℃ (쾌적 범위 밖)")
                elif comfort_pct is not None and comfort_pct < 90 and "early_dismiss" not in evtypes:
                    status = "low_comfort"
                    notes.append(f"수업 중 쾌적 {comfort_pct:.0f}%")
                elif justified_skip:
                    status = "skip_ok"
            g_min = sum(min(g["e"], b) - max(g["s"], a) for g in (guard_events or {}).get(r, [])
                        if g["s"] < b and g["e"] > a)
            if g_min > 0:
                notes.append(f"예보 오차로 실내온도 이탈 → 피드백 보정 {g_min}분")
                if status in ("ok", "skip_ok"):
                    status = "corrected"
            if "failure" in evtypes:
                notes.append("On 명령 응답 없음 → 5분 후 재전송으로 복구")
                if status in ("ok", "exec_gap", "not_ready"):
                    status = "recovered"
            if "override" in evtypes:
                notes.append("수업 후 재실자 수동 가동 → 빈 강의실 감지 후 자동 정지")
                if status == "ok":
                    status = "override"
            row = {
                "session": s["id"], "room": r, "title": s["title"], "start": s["start"], "end": s["end"],
                "kind": s["kind"], "status": status, "notes": notes, "planned": planned or justified_skip,
                "exec_ratio": round(exec_ratio, 3), "ta_start": ta0, "decisions": dtypes,
                "comfort_pct": round(comfort_pct, 1) if comfort_pct is not None else None,
            }
            rows.append(row)
            if status not in ("ok", "skip_ok"):
                issues.append(row)
    matched = sum(1 for x in rows if x["status"] in GOOD_STATUS)
    plan_ok = sum(1 for x in rows if x["planned"])
    return {
        "sessions": rows,
        "issues": issues,
        "total": len(rows),
        "match_rate": round(100 * matched / len(rows), 1) if rows else None,
        "plan_coverage": round(100 * plan_ok / len(rows), 1) if rows else None,
        "auto_actions": sum(1 for x in rows if x["status"] in ("vacancy", "recovered", "override", "corrected")),
        "anomaly_count": sum(1 for x in rows if x["status"] not in ("ok", "skip_ok")),
    }


GOOD_STATUS = ("ok", "skip_ok", "vacancy", "recovered", "override", "corrected")


def warm_state(d: date, courses: list[dict], events: list[dict], weather_by_date: dict, settings: dict) -> dict:
    """Shared start-of-day room state: 2 warm-up days operated by the rule plan on actual weather."""
    days = [d - timedelta(days=2), d - timedelta(days=1)]
    w0 = weather_by_date.get(days[0].isoformat()) or weather_by_date[d.isoformat()]
    state = default_init(w0)
    for wd in days:
        w = weather_by_date.get(wd.isoformat()) or w0
        ss = sessions_for_date(wd, courses, events)
        by_room = {r: [s for s in ss if s["room"] == r] for r in ROOMS}
        # warm-up uses the default rule timing so that editing rule parameters does not shift
        # the shared start-of-day state of the other strategies
        from .config import DEFAULT_SETTINGS
        warm_rules = {**settings, **{k: DEFAULT_SETTINGS[k] for k in ("pre_on_min", "early_off_min", "gap_merge_min")}}
        plan = plan_rule(by_room, ROOMS, warm_rules)
        sim = simulate_day(ROOMS, ODUS, plan, by_room, minute_series(w["actual"]["t"]),
                           minute_series(w["actual"]["rh"]), minute_series(w["actual"]["ghi"]),
                           state, settings, detail=False, clo=clo_for_month(wd.month),
                           t_adj=adjacent_temp(sum(w["actual"]["t"]) / 24.0))
        state = sim["end_state"]
    return state


def compute_day(
    d: date,
    courses: list[dict],
    events: list[dict],
    weather_by_date: dict,
    settings: dict,
    detail: bool = True,
    strategies: tuple = tuple(STRATEGIES),
) -> dict:
    rooms, odus = ROOMS, ODUS
    weather_day = weather_by_date[d.isoformat()]
    init = warm_state(d, courses, events, weather_by_date, settings)
    init_states = {st: init for st in strategies}
    sessions = sessions_for_date(d, courses, events)
    by_room = {r: [s for s in sessions if s["room"] == r] for r in rooms}
    wa, wf = weather_day["actual"], weather_day["forecast"]
    to_a, rh_a, ghi_a = minute_series(wa["t"]), minute_series(wa["rh"]), minute_series(wa["ghi"])
    wf_min = {"to": minute_series(wf["t"]), "rh": minute_series(wf["rh"]), "ghi": minute_series(wf["ghi"])}
    clo = clo_for_month(d.month)
    scenario = field_scenario(d, by_room, settings)
    occ_actual = actual_occupancy(by_room, scenario)

    plans, decisions = {}, []
    if "fixed" in strategies:
        plans["fixed"] = plan_fixed(by_room, rooms, is_workday(d), settings)
    if "manual" in strategies:
        plans["manual"] = plan_manual(by_room, rooms, settings)
    if "rule" in strategies:
        plans["rule"] = plan_rule(by_room, rooms, settings)
    if "ai" in strategies:
        plans["ai"], decisions = plan_ai(by_room, rooms, wf_min, init_states["ai"], settings)

    out = {"date": d.isoformat(), "weekday": d.weekday(), "workday": is_workday(d), "holiday": HOLIDAYS.get(d),
           "sessions": sessions, "weather": weather_day, "strategies": {}, "decisions": decisions,
           "init": {r: [round(v[0], 2), round(v[1], 2)] for r, v in init.items()}, "scenario": scenario}
    season = season_of(d)
    rates = settings["tariff"][season]
    if not isinstance(rates, dict):
        rates = {"light": rates, "mid": rates, "peak": rates}
    for st, plan in plans.items():
        anomalies, extra_causes = ({}, {})
        if st == "ai":
            anomalies, extra_causes = ai_field_controls(plan, scenario, settings)
        sim = simulate_day(rooms, odus, plan, by_room, to_a, rh_a, ghi_a, init_states[st], settings,
                           anomalies=anomalies, clo=clo, detail=detail, occupancy=occ_actual,
                           guard=(st == "ai"), t_adj=adjacent_temp(sum(wa["t"]) / 24.0))
        guard_events = sim.pop("guard_events", {})
        sim.pop("end_state")
        cmds = sim.pop("_cmds")
        sim["plan"] = plan
        sim["cost_krw"] = round(sum(k * rates[tou_band(season, h)] for h, k in enumerate(sim["kwh_by_hour"])))
        sim["co2_kg"] = round(sim["kwh"] * settings["co2_kg_per_kwh"], 2)
        if st == "ai":
            out["validation"] = validate_day(by_room, plan, decisions, sim, cmds, scenario, anomalies, settings,
                                             guard_events)
            causes = plan_causes(plan)
            for r, cs in extra_causes.items():
                causes[r] = cs + causes.get(r, [])
            for r, evs in guard_events.items():
                gc = []
                for g in evs:
                    gc.append({"s": g["s"], "e": g["s"], "label": f"실내 {g['ta']}℃ 쾌적 범위 이탈 감지 → 자동 보정 가동", "on": True})
                causes[r] = gc + causes.get(r, [])
            sim["guard_events"] = guard_events
            out["history"] = history_from_cmds(d.isoformat(), rooms, cmds, causes, sim["odus"])
        out["strategies"][st] = sim
    return out


def default_init(weather_day: dict) -> dict:
    t = sum(weather_day["actual"]["t"]) / 24.0
    base = 0.5 * t + 0.5 * 20.0
    return {r: (base, base) for r in ROOMS}


def warmup_dates(start: date, days: int = 7) -> list[date]:
    return [start - timedelta(days=k) for k in range(days, 0, -1)]


def summarize_day(day: dict) -> dict:
    """Compact per-day summary for calendar / energy charts."""
    out = {"date": day["date"], "weekday": day["weekday"], "workday": day["workday"], "holiday": day["holiday"],
           "sessions": len(day["sessions"]), "events": sum(1 for s in day["sessions"] if s["kind"] == "event"),
           "t_mean": round(sum(day["weather"]["actual"]["t"]) / 24.0, 1),
           "t_min": min(day["weather"]["actual"]["t"]), "t_max": max(day["weather"]["actual"]["t"]),
           "strategies": {}}
    for st, sim in day["strategies"].items():
        out["strategies"][st] = {
            "kwh": sim["kwh"], "cost_krw": sim["cost_krw"], "co2_kg": sim["co2_kg"], "peak_kw": sim["peak_kw"],
            "comfort_pct": sim["comfort_pct"], "on_minutes": sum(x["on_minutes"] for x in sim["rooms"].values()),
            "odu_on_minutes": sum(x["on_minutes"] for x in sim["odus"].values()),
            "discomfort_dm": round(sum(c["discomfort_dm"] for x in sim["rooms"].values() for c in x["sessions"]), 1),
        }
    if "validation" in day:
        v = day["validation"]
        out["match_rate"] = v["match_rate"]
        out["plan_coverage"] = v["plan_coverage"]
        out["anomalies"] = v["anomaly_count"]
        out["auto_actions"] = v["auto_actions"]
        out["needs_review"] = v["anomaly_count"] - v["auto_actions"]
    dec = {}
    for x in day.get("decisions", []):
        dec[x["type"]] = dec.get(x["type"], 0) + 1
    out["decisions"] = dec
    return out
