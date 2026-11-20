"""Savings attribution and equal-comfort comparison (ablation runs of the same day).

Variants (same day, same weather, same seeded field scenario, same start-of-day state):
  fixed            current operation (on at first class, batch switch-off at 18:00)
  rule             requirement-5 rule (10 min before / 5 min before end / 15 min bridge)
  rule30           the rule with a 30-minute lead: what the rule needs to approach AI comfort
  rule_vacancy     the rule plus the same occupancy-sensor auto-off the AI uses
  ai_predictive    AI start/stop from the thermal model only (no weather decisions, no vacancy)
  ai_weather       + weather decisions (skip, economizer, delayed start)
  ai               + occupancy-sensor auto-off = the operated AI strategy
"""
from __future__ import annotations

from datetime import date

from .config import ODUS, ROOMS
from .engine import (actual_occupancy, ai_field_controls, cold_starts, field_scenario, is_workday,
                     warm_state)
from .model import adjacent_temp, clo_for_month
from .simulate import simulate_day
from .strategies import plan_ai, plan_fixed, plan_rule
from .timetable import sessions_for_date
from .weather import minute_series

VARIANTS = ["fixed", "rule", "rule30", "rule_vacancy", "ai_predictive", "ai_weather", "ai"]
LABELS = {
    "fixed": "현재 운영",
    "rule": "규칙 기반(10분 전)",
    "rule30": "규칙 기반(30분 전)",
    "rule_vacancy": "규칙 기반 + 재실 감지",
    "ai_predictive": "AI: 예측 기동·관성 정지",
    "ai_weather": "AI: + 날씨 판단",
    "ai": "AI: + 재실 감지 (운영)",
}


def variants_day(d: date, courses: list, events: list, wx: dict, settings: dict) -> dict:
    sessions = sessions_for_date(d, courses, events)
    by_room = {r: [s for s in sessions if s["room"] == r] for r in ROOMS}
    w = wx[d.isoformat()]
    wa, wf = w["actual"], w["forecast"]
    to_a, rh_a, ghi_a = minute_series(wa["t"]), minute_series(wa["rh"]), minute_series(wa["ghi"])
    wf_min = {"to": minute_series(wf["t"]), "rh": minute_series(wf["rh"]), "ghi": minute_series(wf["ghi"])}
    init = warm_state(d, courses, events, wx, settings)
    scenario = field_scenario(d, by_room, settings)
    occ = actual_occupancy(by_room, scenario)
    t_adj = adjacent_temp(sum(wa["t"]) / 24.0)
    clo = clo_for_month(d.month)
    lo, hi = settings["comfort_low"], settings["comfort_high"]

    def run(plan, anomalies=None, guard=False):
        sim = simulate_day(ROOMS, ODUS, plan, by_room, to_a, rh_a, ghi_a, init, settings, anomalies=anomalies or {},
                           clo=clo, detail=False, occupancy=occ, guard=guard, t_adj=t_adj)
        disc = sum(c["discomfort_dm"] for x in sim["rooms"].values() for c in x["sessions"])
        return {"kwh": sim["kwh"], "comfort_pct": sim["comfort_pct"], "discomfort_dm": round(disc, 1),
                "cold_starts": cold_starts(sim, lo, hi), "peak_kw": sim["peak_kw"],
                "occupied_minutes": sim["occupied_minutes"]}

    out = {}
    out["fixed"] = run(plan_fixed(by_room, ROOMS, is_workday(d), settings))
    rule_plan = plan_rule(by_room, ROOMS, settings)
    out["rule"] = run(rule_plan)
    out["rule30"] = run(plan_rule(by_room, ROOMS, {**settings, "pre_on_min": 30}))
    vac, _ = ai_field_controls(rule_plan, {r: [e for e in evs if e["type"] in ("no_show", "early_dismiss")]
                                           for r, evs in scenario.items()}, settings, by_room)
    out["rule_vacancy"] = run(rule_plan, vac)
    for name, st in (("ai_predictive", {"ai_use_weather": False}), ("ai_weather", {}), ("ai", {})):
        s2 = {**settings, **st}
        plan, _ = plan_ai(by_room, ROOMS, wf_min, init, s2)
        use_vac = name == "ai"
        # override / command-failure events are kept in every AI variant; only vacancy differs
        anomalies, _ = ai_field_controls(plan, scenario, s2, by_room, vacancy=use_vac)
        out[name] = run(plan, anomalies, guard=True)
    return {"date": d.isoformat(), "sessions": len(sessions), "variants": out}


def aggregate(days: list[dict]) -> dict:
    tot = {v: {"kwh": 0.0, "discomfort_dm": 0.0, "cold_starts": 0, "in_band": 0.0, "occ": 0.0, "peak_kw": 0.0}
           for v in VARIANTS}
    for d in days:
        for v, x in d["variants"].items():
            t = tot[v]
            t["kwh"] += x["kwh"]
            t["discomfort_dm"] += x["discomfort_dm"]
            t["cold_starts"] += x["cold_starts"]
            t["peak_kw"] = max(t["peak_kw"], x["peak_kw"])
            if x["comfort_pct"] is not None and x["occupied_minutes"]:
                t["in_band"] += x["comfort_pct"] * x["occupied_minutes"] / 100
                t["occ"] += x["occupied_minutes"]
    res = {}
    for v, t in tot.items():
        res[v] = {"label": LABELS[v], "kwh": round(t["kwh"], 1), "discomfort_dm": round(t["discomfort_dm"], 1),
                  "cold_starts": t["cold_starts"], "peak_kw": round(t["peak_kw"], 1),
                  "comfort_pct": round(100 * t["in_band"] / t["occ"], 2) if t["occ"] else None}
    steps = [("현재 운영", "fixed", None),
             ("수업 시간에만 운전 (규칙 ⑤)", "rule", "fixed"),
             ("예측 기동·관성 정지", "ai_predictive", "rule"),
             ("날씨 판단 (생략·외기 냉방·지연 기동)", "ai_weather", "ai_predictive"),
             ("재실 감지 자동 정지", "ai", "ai_weather")]
    waterfall = []
    for label, cur, prev in steps:
        waterfall.append({"label": label, "variant": cur, "kwh": res[cur]["kwh"],
                          "delta_kwh": round(res[cur]["kwh"] - res[prev]["kwh"], 1) if prev else None,
                          "cold_starts": res[cur]["cold_starts"], "comfort_pct": res[cur]["comfort_pct"]})
    return {"variants": res, "waterfall": waterfall}
