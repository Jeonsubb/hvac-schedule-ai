"""Change response: show that the plan reacts at once when the day changes.

A preview takes today's (or the next operating day's) AI operation, applies one change, recomputes
the day with the same engine, and returns what the AI does differently, room by room:

  cancel    a class is cancelled           → its preheat and run are dropped
  add       a seminar is added             → preheat is scheduled for the new session
  weather   it turns 3 ℃ colder than forecast from now on
            → compared: keep the old plan vs re-plan with the new forecast (preheat earlier)
  feedback  three 'cold' votes in one room → one +0.5 ℃ step for that room today
  noshow    nobody shows up to a class     → vacancy detection stops the unit after N minutes

Nothing is saved; cancel/add return the event so the operator can register it for real.
"""
from __future__ import annotations

import copy
import time
from datetime import date, timedelta

from hvac import config, engine
from hvac.timetable import hm_to_min, min_to_hm, sessions_for_date

from . import planning, service

KINDS = ("cancel", "add", "weather", "feedback", "noshow")


def _now_minute(d: date, ctx: service.Ctx) -> int:
    now = service.effective_now(ctx)
    if now["date"] == d.isoformat():
        return int(now["minute"])
    return 7 * 60  # a future day: everything is still ahead


def _room_view(day: dict, r: str) -> dict:
    ai = day["strategies"]["ai"]
    rr = ai["rooms"][r]
    pm = [c["pmv"] for c in rr["sessions"] if c.get("pmv") is not None and not c.get("vacant")]
    lo, hi = day.get("comfort_band", [19.5, 26.5])
    cold = sum(1 for c in rr["sessions"] if not c.get("vacant") and c.get("ta_start") is not None and not (lo - 0.3 <= c["ta_start"] <= hi + 0.3))
    return {
        "plan": [{"s": iv["s"], "e": iv["e"], "kind": iv.get("kind", "cond")} for iv in ai["plan"].get(r, [])],
        "actual": [{"s": iv["s"], "e": iv["e"], "kind": iv.get("kind", "cond")} for iv in rr["actual"]],
        "lectures": [{"s": hm_to_min(s["start"]), "e": hm_to_min(s["end"]), "title": s["title"], "people": s["expected_people"]}
                     for s in day["sessions"] if s["room"] == r],
        "kwh": round(rr["kwh"], 2),
        "on_min": rr["on_minutes"],
        "pmv": round(sum(pm) / len(pm), 2) if pm else None,
        "cold_starts": cold,
        "decisions": [{"type": x["type"], "start": x["start"], "lead_min": x.get("lead_min"), "detail": x.get("detail", "")}
                      for x in day["decisions"] if x["room"] == r],
    }


def _totals(day: dict) -> dict:
    sm = engine.summarize_day(day)["strategies"]["ai"]
    return {"kwh": round(sm["kwh"], 2), "cost_krw": sm["cost_krw"], "cold_starts": sm["cold_starts"],
            "on_minutes": sm["on_minutes"], "discomfort_dm": sm["discomfort_dm"]}


def _changed_rooms(a: dict, b: dict) -> list[str]:
    out = []
    for r in config.ROOMS:
        ra, rb = a["strategies"]["ai"]["rooms"][r], b["strategies"]["ai"]["rooms"][r]
        if (a["strategies"]["ai"]["plan"].get(r) != b["strategies"]["ai"]["plan"].get(r) or ra["actual"] != rb["actual"]
                or abs(ra["kwh"] - rb["kwh"]) > 0.05):
            out.append(r)
    return out


def preview(kind: str, d: date | None = None) -> dict:
    from .validation import InvalidInput

    if kind not in KINDS:
        raise InvalidInput(f"kind는 {', '.join(KINDS)} 중 하나입니다.")
    ctx = service.Ctx()
    d = d or planning.plan_date(ctx)
    now_min = _now_minute(d, ctx)
    sessions = sorted(sessions_for_date(d, ctx.courses, ctx.events), key=lambda s: s["start"])
    if not any(hm_to_min(s["start"]) >= now_min + 20 for s in sessions):
        # today's classes are over: show the next operating day, where everything is still ahead
        s1 = service.semester_range()[1]
        x = d + timedelta(days=1)
        while x <= s1 and not sessions_for_date(x, ctx.courses, ctx.events):
            x += timedelta(days=1)
        if x <= s1:
            d = x
            now_min = _now_minute(d, ctx)
            sessions = sorted(sessions_for_date(d, ctx.courses, ctx.events), key=lambda s: s["start"])
    sd = service.day_settings(d, ctx)
    ahead = [s for s in sessions if hm_to_min(s["start"]) >= now_min + 20] or sessions
    if not sessions:
        raise InvalidInput("이 날은 수업이 없어 보여 줄 변화가 없습니다.")

    def run(events=None, wx=None, settings=None, inject=None):
        return engine.compute_day(d, ctx.courses, ctx.events if events is None else events, wx or ctx.wx, settings or sd,
                                  detail=False, strategies=("ai",), inject=inject)

    t0 = time.perf_counter()
    base = run()
    event = None
    variants: dict = {}
    if kind == "cancel":
        s = ahead[0]
        event = {"type": "cancel", "date": d.isoformat(), "course_id": s["course_id"], "room": s["room"], "start": s["start"],
                 "end": s["end"], "title": f"{s['title']} 휴강"}
        after = run(events=ctx.events + [{**event, "id": "PREVIEW"}])
        detect = f"{s['room']}호 {s['start']} '{s['title']}' 휴강이 등록되었습니다."
        focus = [s["room"]]
    elif kind == "add":
        busy = {(x["room"]) for x in sessions if hm_to_min(x["start"]) < 17 * 60 and hm_to_min(x["end"]) > 15 * 60}
        start_m = max(15 * 60, ((now_min + 90) // 60) * 60)
        room = next((r for r in ("405", "406", "407", "306", "307", "408") if r not in busy and not any(
            x["room"] == r and hm_to_min(x["start"]) < start_m + 120 and hm_to_min(x["end"]) > start_m for x in sessions)), "405")
        event = {"type": "add", "date": d.isoformat(), "room": room, "start": min_to_hm(start_m), "end": min_to_hm(start_m + 120),
                 "title": "특강(보강)", "expected_people": 45}
        after = run(events=ctx.events + [{**event, "id": "PREVIEW"}])
        detect = f"{room}호 {event['start']}~{event['end']} 특강 45명이 새로 잡혔습니다."
        focus = [room]
    elif kind == "weather":
        wx2 = copy.deepcopy(ctx.wx)
        h0 = min(now_min // 60, 23)
        w = wx2[d.isoformat()]
        for h in range(h0, 24):
            w["actual"]["t"][h] -= 3.0
        old_plan = engine.compute_day(d, ctx.courses, ctx.events, wx2, sd, detail=False, strategies=("ai",))  # no re-plan
        w["forecast"]["t"] = [w["forecast"]["t"][h] - (3.0 if h >= h0 else 0.0) for h in range(24)]
        after = run(wx=wx2)  # re-planned with the new forecast
        variants["no_replan"] = _totals(old_plan)
        detect = f"{h0}시 이후 실황이 예보보다 3℃ 낮습니다(기상청 초단기실황)."
        focus = [r for r in config.ROOMS if any(x["room"] == r for x in ahead)]
        base = old_plan  # compare: keep the old plan vs re-plan
    elif kind == "feedback":
        s = ahead[0]
        r = s["room"]
        key = "sp_heat" if planning.season_for([d], ctx) == "heat" else "sp_cool"
        cur = planning._base_sp(d, r, ctx)[0 if key == "sp_heat" else 1]
        pol = planning.policy()
        lo, hi = (pol["heat_min"], pol["heat_max"]) if key == "sp_heat" else (pol["cool_min"], pol["cool_max"])
        new = max(lo, min(hi, cur + (0.5 if key == "sp_heat" else 0.5)))
        rs = {k: dict(v) for k, v in (sd.get("room_sp") or {}).items()}
        rs.setdefault(r, {})[key] = new
        after = run(settings={**sd, "room_sp": rs})
        detect = f"{r}호에서 '춥다' 의견이 3건 들어왔습니다."
        focus = [r]
        variants["setpoint"] = {"room": r, "from": cur, "to": new, "key": key}
    else:  # noshow
        s = ahead[0]
        after = run(inject={"no_show": [s["id"]]})
        detect = f"{s['room']}호 {s['start']} '{s['title']}' 수업에 아무도 오지 않았습니다(재실 센서 0명)."
        focus = [s["room"]]
    elapsed = round((time.perf_counter() - t0) * 1000)

    changed = _changed_rooms(base, after)
    rooms = sorted(set(focus) | set(changed), key=lambda r: list(config.ROOMS).index(r))[:4]
    tb, ta = _totals(base), _totals(after)
    rv = {r: {"before": _room_view(base, r), "after": _room_view(after, r)} for r in rooms}

    def saved(dk: float) -> str:
        return f"{-dk:.2f} kWh 절약" if dk <= -0.05 else (f"전력 {dk:+.2f} kWh, 다음 수업 예열이 조금 늘어남" if dk >= 0.05 else "전력 변화 거의 없음")

    # what the AI did, in the operator's words
    acts = []
    for r in rooms:
        b, a = rv[r]["before"], rv[r]["after"]
        lead_b = next((x["lead_min"] for x in b["decisions"] if x["type"] == "optimal_start"), None)
        lead_a = next((x["lead_min"] for x in a["decisions"] if x["type"] == "optimal_start"), None)
        dk = round(a["kwh"] - b["kwh"], 2)
        if kind == "cancel" and r in focus:
            dmin = a["on_min"] - b["on_min"]
            new_starts = [x for x in a["decisions"] if x["type"] == "optimal_start" and x not in b["decisions"]]
            if dmin < -5:
                acts.append(f"{r}호 그 수업의 예열과 운전을 취소했습니다(가동 {-dmin}분 줄임, {saved(dk)}).")
            elif dmin > 5:
                nxt = f" {new_starts[0]['start']} 수업 전에 {new_starts[0]['lead_min']}분 예열을" if new_starts and new_starts[0].get("lead_min") else " 다음 수업 전에 예열을"
                acts.append(f"{r}호 수업이 빠지면 재실자 발열이 사라져 방이 식습니다. 그래서{nxt} 새로 넣었습니다(가동 +{dmin}분, {saved(dk)}).")
            else:
                acts.append(f"{r}호 이 수업은 원래 재실자 발열만으로 쾌적이 유지돼 가동하지 않던 수업이라, 휴강해도 운전을 바꿀 필요가 없습니다.")
        elif kind == "add" and r in focus:
            st = next((x for x in a["decisions"] if x["start"] == event["start"]), None)
            lead = st.get("lead_min") if st else None
            acts.append(f"{r}호 특강 {lead}분 전부터 예열하도록 넣었습니다(+{dk:.2f} kWh)." if lead else f"{r}호 특강 시간에 맞춰 운전을 넣었습니다(+{dk:.2f} kWh).")
        elif kind == "weather":
            if lead_a is not None and lead_b is not None and lead_a != lead_b:
                acts.append(f"{r}호 예열을 {lead_b}분 전 → {lead_a}분 전으로 앞당겼습니다.")
        elif kind == "feedback" and r in focus:
            v = variants["setpoint"]
            acts.append(f"{r}호 설정온도를 {v['from']:.1f}℃ → {v['to']:.1f}℃로 한 단계 올렸습니다(PMV {b['pmv']} → {a['pmv']}, {dk:+.2f} kWh).")
        elif kind == "noshow" and r in focus:
            dmin = b["on_min"] - a["on_min"]
            if dmin > 5:
                acts.append(f"{r}호 재실이 없어 {sd['auto_off_after_min']}분 뒤 자동 정지했습니다(가동 {dmin}분 줄임, {saved(dk)}).")
            else:
                acts.append(f"{r}호 이 수업은 원래 재실자 발열로 쾌적이 유지돼 가동하지 않던 수업이라 정지할 것이 없습니다. 재실 0명은 기록해 두고 다음 계획의 예상 인원에 반영합니다.")
    if kind == "weather":
        # rooms with the same change read as one sentence
        import re as _re

        groups: dict = {}
        rest = []
        for a in acts:
            m = _re.match(r"^(\d{3})호 (.+)$", a)
            if m:
                groups.setdefault(m.group(2), []).append(m.group(1))
            else:
                rest.append(a)
        acts = [f"{'·'.join(rs)}호 {txt}" for txt, rs in groups.items()] + rest
    others = [r for r in rooms if r not in focus and kind != "weather"]
    if others:
        odus = sorted({config.ROOMS[r]["odu"] for r in others})
        acts.append(f"같은 실외기({', '.join(config.ODUS[o]['label'] for o in odus)})를 나눠 쓰는 {'·'.join(others)}호도 예열을 다시 계산했습니다.")
    if kind == "weather":
        nr = variants["no_replan"]
        if not acts:
            acts.append("남은 수업의 예열 시간은 그대로도 충분해서 계획을 유지했습니다.")
        pb = [rv[r]["before"]["pmv"] for r in rooms if rv[r]["before"]["pmv"] is not None]
        pa = [rv[r]["after"]["pmv"] for r in rooms if rv[r]["after"]["pmv"] is not None]
        if nr["cold_starts"] > ta["cold_starts"]:
            acts.append(f"다시 계획하지 않았다면 수업 시작 때 쾌적 범위를 벗어나는 수업이 {nr['cold_starts']}건이었는데, 다시 계획해서 {ta['cold_starts']}건이 됐습니다.")
        elif pb and pa:
            acts.append(f"다시 계획하지 않아도 피드백 보정으로 시작 이탈은 없지만, 미리 예열해서 수업 중 체감(PMV)이 "
                        f"{sum(pb) / len(pb):.2f} → {sum(pa) / len(pa):.2f}로 덜 춥습니다.")
    if not acts:
        acts.append("계획을 다시 계산했고, 바꿀 필요가 없었습니다.")

    titles = {"cancel": "휴강 등록", "add": "보강·행사 추가", "weather": "날씨 급변", "feedback": "'춥다' 의견", "noshow": "무단 공강"}
    return {
        "kind": kind, "title": titles[kind], "date": d.isoformat(), "now_minute": now_min, "elapsed_ms": elapsed,
        "steps": [{"label": "감지", "text": detect},
                  {"label": "다시 계산", "text": f"같은 열모델로 그날 운전을 다시 계산했습니다({elapsed}ms)."},
                  {"label": "조치", "text": " ".join(acts)}],
        "rooms": [{"room": r, **rv[r]} for r in rooms],
        "totals": {"before": tb, "after": ta}, "variants": variants, "event": event,
        "before_label": "기존 계획 그대로" if kind == "weather" else "변화 전", "after_label": "다시 계획" if kind == "weather" else "변화 후",
    }
