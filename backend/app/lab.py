"""Simulation lab: replay the agent-negotiated schedule day by day and compare its electricity with

- 현재 운영 (as the PNU facility office described it, 2026-11: occupants switch units on, the central controller keeps
  setpoints inside the guideline band and switches everything off at 18:00; see strategies.plan_fixed)
- 시간표 연동 규칙 (rule-based), AI 예측 제어 (AI without agents)
- measured meter data, when the operator uploads it (hourly or daily kWh), with ASHRAE Guideline 14
  calibration metrics (NMBE, CV(RMSE)) of the simulated current operation against the meter.

The lab is a sandbox: it never creates adjustments, sends commands or touches the operating store,
and it ignores applied adjustments so every strategy starts from the same plain settings.
"""
from __future__ import annotations

import csv
import io
import math
import time
from datetime import date, datetime, timedelta

from hvac import config, engine
from hvac.timetable import sessions_for_date

from . import agents, planning, service
from .store import get_store

LABELS = {"current": "현재 운영 (지침 온도 범위·18시 일괄 정지)", "rule": "시간표 연동 규칙", "ai": "AI 예측 제어", "agents": "AI + 에이전트 협의"}
MAX_DAYS = {"rule": 10, "llm": 3}
# ASHRAE Guideline 14-2014 calibration criteria (whole-building, measured vs simulated)
G14 = {"hour": {"nmbe": 10.0, "cvrmse": 30.0}, "month": {"nmbe": 5.0, "cvrmse": 15.0}}


def current_settings(ctx: service.Ctx) -> dict:
    """Current operation: occupants may set anything inside the guideline band and are assumed to sit at its
    comfort end (heating maximum, cooling minimum)."""
    pol = planning.policy()
    return {**ctx.settings, "sp_heat": float(pol["heat_max"]), "sp_cool": float(pol["cool_min"])}


def _metrics(sim: dict, lo: float, hi: float) -> dict:
    pm = [c["pmv"] for r in sim["rooms"].values() for c in r["sessions"] if c.get("pmv") is not None and not c.get("vacant")]
    return {"kwh": round(sim["kwh"], 2), "cost_krw": sim["cost_krw"], "peak_kw": sim["peak_kw"],
            "pmv_mean": round(sum(pm) / len(pm), 2) if pm else None,
            "pmv_ok_pct": round(100.0 * sum(1 for x in pm if abs(x) <= 0.5) / len(pm), 1) if pm else None,
            "discomfort_dm": round(sum(c["discomfort_dm"] for r in sim["rooms"].values() for c in r["sessions"]), 1),
            "cold_starts": engine.cold_starts(sim, lo, hi), "comfort_pct": sim["comfort_pct"],
            "kwh_by_hour": [round(v, 3) for v in sim["kwh_by_hour"]],
            "rooms": {r: round(v["kwh"], 2) for r, v in sim["rooms"].items()},
            "room_pmv": {r: _avg([c["pmv"] for c in v["sessions"] if c.get("pmv") is not None and not c.get("vacant")])
                         for r, v in sim["rooms"].items()}}


def _avg(xs):
    return round(sum(xs) / len(xs), 2) if xs else None


def operating_days(start: date, n: int, ctx: service.Ctx) -> list[date]:
    s0, s1 = service.semester_range()
    out, d = [], max(start, s0)
    while len(out) < n and d <= s1:
        if d.isoformat() in ctx.wx and sessions_for_date(d, ctx.courses, ctx.events):
            out.append(d)
        d += timedelta(days=1)
    return out


def run(start: date, days: int, mode: str = "rule", progress=None) -> dict:
    mode = "llm" if mode == "llm" else "rule"
    days = max(1, min(int(days), MAX_DAYS[mode]))
    t0 = time.time()
    ctx = service.Ctx()
    ctx.adjustments = []  # sandbox: plain settings for every strategy
    lo, hi = ctx.settings["comfort_low"], ctx.settings["comfort_high"]
    dates = operating_days(start, days, ctx)
    if not dates:
        raise ValueError("선택한 기간에 수업이 있는 날이 없습니다. 학기(9/1~12/18) 안의 평일을 고르세요.")
    cur_st = current_settings(ctx)
    rows = []
    llm_turns = 0

    def emit(phase, i):
        if progress:
            progress({"phase": phase, "done": i, "total": len(dates), "days": rows})

    for i, d in enumerate(dates):
        emit(f"{d.month}/{d.day} 계산 중", i)
        base = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, ctx.settings, detail=False, strategies=("rule", "ai"))
        cur = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, cur_st, detail=False, strategies=("fixed",))
        neg = agents.negotiate(3, d, use_ai=(mode == "llm"), sandbox=True, ctx=ctx, fb_until=d)
        prop = neg["final"]["proposal"]
        ag = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, {**ctx.settings, "room_sp": prop}, detail=False, strategies=("ai",))
        llm_turns += sum(1 for t in neg["turns"] if t["agent"] != "arbiter") if neg["ai"] else 0
        key = "sp_heat" if neg["season"] == "heat" else "sp_cool"
        policy = neg["policy"]
        lo_p, hi_p = (policy["heat_min"], policy["heat_max"]) if key == "sp_heat" else (policy["cool_min"], policy["cool_max"])
        sps = {r: v[key] for r, v in prop.items()}
        rows.append({
            "date": d.isoformat(), "weekday": d.weekday(), "sessions": len(base["sessions"]),
            "t_mean": round(sum(base["weather"]["actual"]["t"]) / 24.0, 1),
            "strategies": {"current": _metrics(cur["strategies"]["fixed"], lo, hi), "rule": _metrics(base["strategies"]["rule"], lo, hi),
                           "ai": _metrics(base["strategies"]["ai"], lo, hi), "agents": _metrics(ag["strategies"]["ai"], lo, hi)},
            "agents": {"setpoints": sps, "base_sp": neg.get("base_sp", {}), "key": key, "agreed": neg["final"]["agreed"],
                       "rounds": max(t["round"] for t in neg["turns"]), "summary": neg["final"]["summary"], "ai": neg["ai"],
                       "complaint_rooms": neg.get("complaint_rooms", []),
                       "optimum": ({"setpoints": {r: v[key] for r, v in (neg.get("optimum") or {}).get("proposal", {}).items()},
                                    "kwh": ((neg.get("optimum") or {}).get("eval") or {}).get("kwh"),
                                    "pmv_mean": ((neg.get("optimum") or {}).get("eval") or {}).get("pmv_mean"),
                                    "comfort_won": (neg.get("optimum") or {}).get("comfort_won")} if neg.get("optimum") else None),
                       "in_policy": all(lo_p - 1e-6 <= v <= hi_p + 1e-6 for v in sps.values()),
                       "turns": [{k: t.get(k) for k in ("round", "agent", "stance", "message", "trace", "accepts")} for t in neg["turns"]]},
        })
    emit("결과 정리 중", len(dates))
    totals = {}
    for k in LABELS:
        xs = [r["strategies"][k] for r in rows]
        pm = [x["pmv_mean"] for x in xs if x["pmv_mean"] is not None]
        ok = [x["pmv_ok_pct"] for x in xs if x["pmv_ok_pct"] is not None]
        totals[k] = {"kwh": round(sum(x["kwh"] for x in xs), 1), "cost_krw": sum(x["cost_krw"] for x in xs),
                     "peak_kw": max(x["peak_kw"] for x in xs), "pmv_mean": round(sum(pm) / len(pm), 2) if pm else None,
                     "pmv_ok_pct": round(sum(ok) / len(ok), 1) if ok else None,
                     "discomfort_dm": round(sum(x["discomfort_dm"] for x in xs), 1),
                     "cold_starts": sum(x["cold_starts"] for x in xs)}

    def pct(a, b):
        return round(100.0 * (a - b) / a, 1) if a else None

    comp_rooms = [(r, d_) for d_ in rows for r in d_["agents"]["complaint_rooms"]]
    # comfort where occupants complained: the agents' target, compared with AI alone and the current operation
    cp = {k: _avg([d_["strategies"][k]["room_pmv"].get(r) for r, d_ in comp_rooms if d_["strategies"][k]["room_pmv"].get(r) is not None])
          for k in LABELS}
    kpis = {
        "saving_vs_current_pct": pct(totals["current"]["kwh"], totals["agents"]["kwh"]),
        "saving_vs_ai_pct": pct(totals["ai"]["kwh"], totals["agents"]["kwh"]),
        "cost_saving_vs_current_krw": totals["current"]["cost_krw"] - totals["agents"]["cost_krw"],
        "pmv_delta_vs_ai": (round(totals["agents"]["pmv_mean"] - totals["ai"]["pmv_mean"], 2)
                            if totals["agents"]["pmv_mean"] is not None and totals["ai"]["pmv_mean"] is not None else None),
        "agreement_rate_pct": round(100.0 * sum(1 for r in rows if r["agents"]["agreed"]) / len(rows), 1),
        "policy_compliance_pct": round(100.0 * sum(1 for r in rows if r["agents"]["in_policy"]) / len(rows), 1),
        "complaint_room_days": len(comp_rooms),
        "complaint_room_pmv": cp,
        "llm_calls": llm_turns, "seconds": round(time.time() - t0, 1),
    }
    res = {"params": {"start": start.isoformat(), "days": days, "mode": mode}, "dates": [r["date"] for r in rows],
           "labels": LABELS, "days": rows, "totals": totals, "kpis": kpis, "measured": calibration(rows),
           "ai_used": any(r["agents"]["ai"] for r in rows), "created_at": service.now_kst().isoformat(timespec="seconds"),
           "notes": [f"현재 운영은 시설 담당자 설명을 재현한 시뮬레이션입니다. 강의실에서 첫 수업 때 켜고 {cur_st['fixed_off']}에 중앙에서 일괄 정지하며, "
                     f"설정온도는 정부 지침 범위의 끝(난방 {cur_st['sp_heat']:g}℃, 냉방 {cur_st['sp_cool']:g}℃)으로 둡니다.",
                     "랩은 격리 실행입니다. 조정안·제어 명령을 만들지 않고, 적용된 조정도 무시합니다.",
                     "실측 전력량을 올리면 현재 운영 시뮬레이션과 비교해 보정 오차(NMBE, CV(RMSE))를 계산합니다."]}
    get_store().put_blob("lab/last.json", res)
    return res


def last() -> dict | None:
    return get_store().get_blob("lab/last.json")


# ---------------------------------------------------------------- measured meter data

def parse_measured(text: str, source: str) -> dict:
    """CSV with a timestamp and a kWh column. 'YYYY-MM-DD HH:MM' → hourly, 'YYYY-MM-DD' → daily.
    Also accepts separate date and hour columns."""
    from .validation import InvalidInput

    rows = list(csv.reader(io.StringIO(text.strip())))
    if len(rows) < 2:
        raise InvalidInput("CSV에 머리글과 데이터가 필요합니다.")
    head = [h.strip().lower() for h in rows[0]]

    def col(*names):
        for n in names:
            if n in head:
                return head.index(n)
        return None

    ci_ts = col("timestamp", "datetime", "time", "일시", "시각")
    ci_d = col("date", "날짜", "일자")
    ci_h = col("hour", "시")
    ci_k = col("kwh", "energy_kwh", "전력량", "사용량", "value")
    if ci_k is None or (ci_ts is None and ci_d is None):
        raise InvalidInput("머리글에 timestamp(또는 date[, hour])와 kwh 열이 있어야 합니다.")
    pts: dict = {}
    gran = None
    for r in rows[1:]:
        if not r or len(r) <= ci_k:
            continue
        try:
            v = float(r[ci_k])
        except ValueError:
            continue
        if not math.isfinite(v) or v < 0:
            continue
        try:
            if ci_ts is not None:
                raw = r[ci_ts].strip().replace("/", "-")
                if len(raw) <= 10:
                    k, g = date.fromisoformat(raw).isoformat(), "day"
                else:
                    dt = datetime.fromisoformat(raw.replace(" ", "T")[:16])
                    k, g = dt.strftime("%Y-%m-%dT%H"), "hour"
            else:
                dd = date.fromisoformat(r[ci_d].strip().replace("/", "-"))
                if ci_h is not None and r[ci_h].strip() != "":
                    k, g = f"{dd.isoformat()}T{int(float(r[ci_h])):02d}", "hour"
                else:
                    k, g = dd.isoformat(), "day"
        except (ValueError, IndexError):
            continue
        gran = gran or g
        if g != gran:
            raise InvalidInput("시간 단위와 일 단위가 섞여 있습니다. 한 가지로 맞춰 주세요.")
        pts[k] = pts.get(k, 0.0) + v
    if not pts:
        raise InvalidInput("읽을 수 있는 행이 없습니다. 예: 2026-11-18 09:00,12.4")
    keys = sorted(pts)
    out = {"source": source[:120], "granularity": gran, "points": pts, "start": keys[0][:10], "end": keys[-1][:10],
           "count": len(pts), "uploaded_at": service.now_kst().isoformat(timespec="seconds")}
    get_store().put_blob("lab/measured.json", out)
    return out


def measured() -> dict | None:
    return get_store().get_blob("lab/measured.json")


def clear_measured() -> None:
    get_store().put_blob("lab/measured.json", None)


def calibration(rows: list[dict]) -> dict | None:
    """Measured vs simulated current operation over the overlapping hours/days."""
    m = measured()
    if not m:
        return None
    pts = m["points"]
    pairs = []  # (label, measured, simulated current, agents)
    for r in rows:
        cur, ag = r["strategies"]["current"], r["strategies"]["agents"]
        if m["granularity"] == "hour":
            for h in range(24):
                k = f"{r['date']}T{h:02d}"
                if k in pts:
                    pairs.append((k, pts[k], cur["kwh_by_hour"][h], ag["kwh_by_hour"][h]))
        elif r["date"] in pts:
            pairs.append((r["date"], pts[r["date"]], cur["kwh"], ag["kwh"]))
    for r in rows:
        r["measured_kwh"] = (sum(pts.get(f"{r['date']}T{h:02d}", 0.0) for h in range(24)) if m["granularity"] == "hour"
                             else pts.get(r["date"]))
    base = {k: m[k] for k in ("source", "granularity", "start", "end", "count", "uploaded_at")}
    if len(pairs) < 2:
        return {**base, "overlap": len(pairs), "note": "랩 기간과 겹치는 실측값이 부족합니다."}
    meas = [p[1] for p in pairs]
    sim = [p[2] for p in pairs]
    n = len(pairs)
    mean = sum(meas) / n
    nmbe = 100.0 * sum(a - b for a, b in zip(meas, sim)) / ((n - 1) * mean) if mean else None
    cvrmse = 100.0 * math.sqrt(sum((a - b) ** 2 for a, b in zip(meas, sim)) / (n - 1)) / mean if mean else None
    th = G14["hour"] if m["granularity"] == "hour" else G14["month"]
    return {**base, "overlap": n, "nmbe_pct": round(nmbe, 1) if nmbe is not None else None,
            "cvrmse_pct": round(cvrmse, 1) if cvrmse is not None else None, "threshold": th,
            "calibrated": nmbe is not None and abs(nmbe) <= th["nmbe"] and cvrmse <= th["cvrmse"],
            "measured_kwh": round(sum(meas), 1), "current_sim_kwh": round(sum(sim), 1),
            "agents_sim_kwh": round(sum(p[3] for p in pairs), 1),
            "saving_vs_measured_pct": round(100.0 * (sum(meas) - sum(p[3] for p in pairs)) / sum(meas), 1) if sum(meas) else None,
            "series": [{"t": p[0], "measured": round(p[1], 3), "current": round(p[2], 3), "agents": round(p[3], 3)} for p in pairs[:2000]],
            "note": ("시간 단위 기준(NMBE ±10%, CV(RMSE) 30%)으로 판정했습니다." if m["granularity"] == "hour" else
                     "일 단위는 Guideline 14 기준이 없어 월 기준(NMBE ±5%, CV(RMSE) 15%)을 참고로 표시합니다.")
                    + " 실측 대비 절감률에는 시뮬레이터의 편향(NMBE)이 섞여 있습니다. 절감은 보정된 '현재 운영' 시뮬레이션과 비교한 값이 더 공정합니다."}
