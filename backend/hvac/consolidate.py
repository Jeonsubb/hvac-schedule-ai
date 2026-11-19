"""Room consolidation recommender (advice for the academic office, not automatic).

Per weekday, greedily move lecture blocks into compatible rooms (same room type,
enough capacity, free time) on other outdoor-unit groups so that whole ODU groups
and rooms stay idle longer. Each proposal is re-simulated with the AI strategy on a
representative date to report the kWh difference.
"""
from __future__ import annotations

from datetime import date, timedelta

from .config import ROOMS, SEMESTER
from .timetable import WEEKDAYS, hm_to_min

PAD = 15  # pre-conditioning / changeover margin in minutes


def _intervals_minutes(ivs):
    ivs = sorted(ivs)
    tot, cur_s, cur_e = 0, None, None
    for s, e in ivs:
        if cur_e is None or s > cur_e:
            if cur_e is not None:
                tot += cur_e - cur_s
            cur_s, cur_e = s, e
        else:
            cur_e = max(cur_e, e)
    if cur_e is not None:
        tot += cur_e - cur_s
    return tot


def _objective(assign: dict[str, str], blocks: dict[str, dict]) -> tuple[int, int]:
    odu_iv: dict[str, list] = {}
    room_iv: dict[str, list] = {}
    for cid, room in assign.items():
        b = blocks[cid]
        iv = (hm_to_min(b["start"]) - PAD, hm_to_min(b["end"]))
        odu_iv.setdefault(ROOMS[room]["odu"], []).append(iv)
        room_iv.setdefault(room, []).append(iv)
    return (sum(_intervals_minutes(v) for v in odu_iv.values()),
            sum(_intervals_minutes(v) for v in room_iv.values()))


def _free(room: str, cid: str, assign: dict, blocks: dict) -> bool:
    b = blocks[cid]
    s, e = hm_to_min(b["start"]) - PAD, hm_to_min(b["end"]) + PAD
    for other, r in assign.items():
        if r != room or other == cid:
            continue
        o = blocks[other]
        if hm_to_min(o["start"]) < e and s < hm_to_min(o["end"]):
            return False
    return True


def plan_moves(courses: list[dict], weekday: int, max_moves: int = 6) -> dict:
    blocks = {c["id"]: c for c in courses if c.get("weekday") == weekday}
    assign = {cid: b["room"] for cid, b in blocks.items()}
    before = _objective(assign, blocks)
    moves = []
    for _ in range(max_moves):
        cur = _objective(assign, blocks)
        best = None
        for cid, b in blocks.items():
            src = assign[cid]
            for room, info in ROOMS.items():
                if room == src or info["type"] != ROOMS[src]["type"] or info["capacity"] < b["expected_people"]:
                    continue
                if not _free(room, cid, assign, blocks):
                    continue
                trial = dict(assign)
                trial[cid] = room
                val = _objective(trial, blocks)
                gain = (cur[0] - val[0]) * 1.0 + (cur[1] - val[1]) * 0.2
                if gain > 0 and (best is None or gain > best[0]):
                    best = (gain, cid, src, room, val)
        if not best:
            break
        _, cid, src, room, val = best
        assign[cid] = room
        b = blocks[cid]
        moves.append({"course_id": cid, "title": b["class_name"], "professor": b.get("professor", ""),
                      "start": b["start"], "end": b["end"], "from_room": src, "to_room": room,
                      "from_odu": ROOMS[src]["odu"], "to_odu": ROOMS[room]["odu"],
                      "expected_people": b["expected_people"], "capacity": ROOMS[room]["capacity"]})
    after = _objective(assign, blocks)
    # collapse chains (A->B then B->C) into final destinations
    final = {}
    for m in moves:
        final.setdefault(m["course_id"], dict(m))["to_room"] = m["to_room"]
        final[m["course_id"]]["to_odu"] = m["to_odu"]
    moves = [m for m in final.values() if m["from_room"] != m["to_room"]]
    return {"weekday": weekday, "weekday_label": WEEKDAYS[weekday], "moves": moves,
            "odu_minutes_before": before[0], "odu_minutes_after": after[0],
            "room_minutes_before": before[1], "room_minutes_after": after[1]}


def _weekday_dates(wd: int, wx: dict) -> list[date]:
    from .config import HOLIDAYS

    d = SEMESTER["start"]
    while d.weekday() != wd:
        d += timedelta(days=1)
    out = []
    while d <= SEMESTER["end"]:
        if d not in HOLIDAYS and d.isoformat() in wx:
            out.append(d)
        d += timedelta(days=7)
    return out


def recommend(courses, events, wx, settings, weekday: int | None = None) -> dict:
    """Moves are kept only if they save energy on a representative date; the kept set is then
    evaluated over every semester date of that weekday (AI strategy, actual weather)."""
    from .engine import compute_day

    def kwh(d, evs):
        return compute_day(d, courses, evs, wx, settings, detail=False, strategies=("ai",))["strategies"]["ai"]

    days = [weekday] if weekday is not None else [0, 1, 2, 3, 4]
    out = []
    for wd in days:
        res = plan_moves(courses, wd)
        dates = _weekday_dates(wd, wx)
        if res["moves"] and dates:
            # representative = coldest date of that weekday (heating dominates the semester's energy)
            rep = min(dates, key=lambda d: sum(wx[d.isoformat()]["actual"]["t"]))
            base_rep = kwh(rep, events)["kwh"]
            kept = []
            for m in res["moves"]:
                ev = [{"id": f"CONS-{m['course_id']}", "type": "move", "date": rep.isoformat(),
                       "course_id": m["course_id"], "new_room": m["to_room"]}]
                gain = base_rep - kwh(rep, events + ev)["kwh"]
                if gain > 0.05:
                    m["kwh_gain_rep"] = round(gain, 2)
                    kept.append(m)
            res["moves"] = kept
        if res["moves"]:
            tb = ta = 0.0
            comfort_b, comfort_a = [], []
            for d in dates:
                evs = [{"id": f"CONS-{m['course_id']}-{d}", "type": "move", "date": d.isoformat(),
                        "course_id": m["course_id"], "new_room": m["to_room"]} for m in res["moves"]]
                b, a = kwh(d, events), kwh(d, events + evs)
                tb += b["kwh"]
                ta += a["kwh"]
                if b["comfort_pct"] is not None:
                    comfort_b.append(b["comfort_pct"])
                if a["comfort_pct"] is not None:
                    comfort_a.append(a["comfort_pct"])
            res.update({"dates": len(dates), "kwh_before": round(tb, 1), "kwh_after": round(ta, 1),
                        "kwh_saving": round(tb - ta, 1), "saving_pct": round(100 * (tb - ta) / tb, 1) if tb else 0.0,
                        "comfort_before": round(sum(comfort_b) / len(comfort_b), 2) if comfort_b else None,
                        "comfort_after": round(sum(comfort_a) / len(comfort_a), 2) if comfort_a else None})
        out.append(res)
    total = round(sum(x.get("kwh_saving", 0) for x in out), 1)
    return {"weekdays": out, "semester_kwh_saving": total,
            "note": "학사 부서 검토용 권고안입니다. 학기 전체 해당 요일(실측·예보 날씨)로 AI 운전을 다시 시뮬레이션한 값이며, 실제 반영은 '강의실 변경' 이벤트로 등록합니다."}
