"""Execution simulator: runs room plans on IDU/ODU models and records history.

Plans are per-room lists of intervals {"s": min, "e": min, "kind": "cond"|"fan", ...}
with minutes from 00:00. The simulator applies field anomalies (occupant override,
command failure), integrates the thermal model every minute, couples rooms through
their ODU part-load ratio and returns time series, energy and device history.
"""
from __future__ import annotations

from .model import (DT, IDU_FAN_W, ODU_BASE_W, RoomPhys, electric_w, indoor_rh, pmv,
                    thermostat_q)
from .timetable import hm_to_min, min_to_hm

OFF, FAN, COND = 0, 1, 2


def occupancy_array(sessions: list[dict]) -> list[float]:
    occ = [0.0] * 1440
    for s in sessions:
        a, b = hm_to_min(s["start"]), min(hm_to_min(s["end"]), 1440)
        for m in range(a, b):
            occ[m] += s["expected_people"]
    return occ


def plan_to_cmd(intervals: list[dict]) -> list[int]:
    cmd = [OFF] * 1440
    for iv in intervals:
        v = COND if iv.get("kind", "cond") == "cond" else FAN
        for m in range(max(0, iv["s"]), min(1440, iv["e"])):
            if v > cmd[m]:
                cmd[m] = v
    return cmd


def cmd_to_intervals(cmd: list[int]) -> list[dict]:
    out = []
    cur, start = OFF, 0
    for m in range(1441):
        v = cmd[m] if m < 1440 else OFF
        if v != cur:
            if cur != OFF:
                out.append({"s": start, "e": m, "kind": "cond" if cur == COND else "fan"})
            cur, start = v, m
    return out


def simulate_day(
    rooms: dict[str, dict],
    odus: dict[str, dict],
    plans: dict[str, list[dict]],
    sessions_by_room: dict[str, list[dict]],
    to_min: list[float],
    rh_min: list[float],
    ghi_min: list[float],
    init: dict[str, tuple[float, float]],
    settings: dict,
    anomalies: dict[str, list[dict]] | None = None,
    clo: float = 0.9,
    detail: bool = True,
    occupancy: dict[str, list[float]] | None = None,
    guard: bool = False,
) -> dict:
    """guard=True adds closed-loop correction: while people are present and the unit is
    not conditioning, leaving the comfort band starts conditioning until the room empties."""
    sp_h, sp_c = settings["sp_heat"], settings["sp_cool"]
    lo, hi = settings["comfort_low"], settings["comfort_high"]
    ids = sorted(rooms)
    phys = {r: RoomPhys(rooms[r]) for r in ids}
    cmds = {r: plan_to_cmd(plans.get(r, [])) for r in ids}
    anomalies = anomalies or {}
    for r, lst in anomalies.items():
        for a in lst:
            for m in range(max(0, a["s"]), min(1440, a["e"])):
                cmds[r][m] = COND if a["type"] == "override" else OFF
    occ = {r: (occupancy or {}).get(r) or occupancy_array(sessions_by_room.get(r, [])) for r in ids}

    ta = {r: init[r][0] for r in ids}
    tm = {r: init[r][1] for r in ids}
    odu_rooms: dict[str, list[str]] = {}
    for r in ids:
        odu_rooms.setdefault(phys[r].odu, []).append(r)

    guard_on = {r: False for r in ids}
    guard_events: dict[str, list[dict]] = {r: [] for r in ids}
    ta_series = {r: [] for r in ids}
    tm_series = {r: [] for r in ids}
    p_room_5 = {r: [] for r in ids}
    p_odu_5 = {o: [] for o in odu_rooms}
    e_room = {r: 0.0 for r in ids}
    e_odu = {o: 0.0 for o in odu_rooms}
    q_room_heat = {r: 0.0 for r in ids}
    q_room_cool = {r: 0.0 for r in ids}
    kwh_by_hour = [0.0] * 24
    acc_room = {r: 0.0 for r in ids}
    acc_odu = {o: 0.0 for o in odu_rooms}
    odu_on = {o: [False] * 1440 for o in odu_rooms}
    total_w = [0.0] * 1440

    for m in range(1440):
        to = to_min[m]
        ghi = ghi_min[m]
        q = {}
        for r in ids:
            rp = phys[r]
            a, b = ta[r], tm[r]
            c = cmds[r][m]
            people = occ[r][m]
            if guard:
                if people <= 0:
                    guard_on[r] = False
                elif c != COND and (guard_on[r] or a < lo or a > hi):
                    if not guard_on[r]:
                        guard_events[r].append({"s": m, "e": m, "ta": round(a, 2)})
                    guard_on[r] = True
                    c = COND
                    cmds[r][m] = COND
                    guard_events[r][-1]["e"] = m + 1
            passive = (rp.gam * (b - a) + (rp.gao + rp.vent_g(people, c == FAN)) * (to - a)
                       + rp.internal_gain(people) + rp.solar_gain(ghi))
            qq = thermostat_q(rp, a, passive, sp_h, sp_c) if c == COND else 0.0
            q[r] = qq
            ta[r] = a + DT * (passive + qq) / rp.ca
            tm[r] = b + DT * (rp.gam * (a - b) + rp.gmo * (to - b)) / rp.cm
            if qq > 0:
                q_room_heat[r] += qq * DT / 3.6e6
            elif qq < 0:
                q_room_cool[r] += -qq * DT / 3.6e6
        tot = 0.0
        for o, rlist in odu_rooms.items():
            cap = odus[o]["cap_kw"] * 1000.0
            load = sum(abs(q[r]) for r in rlist)
            plr = load / cap if cap else 0.0
            any_on = False
            p_o = 0.0
            on_rooms = []
            for r in rlist:
                if cmds[r][m] != OFF:
                    any_on = True
                    on_rooms.append(r)
            base = ODU_BASE_W if any_on else 0.0
            for r in rlist:
                pr = electric_w(q[r], to, plr)
                if cmds[r][m] != OFF:
                    pr += IDU_FAN_W * phys[r].n_idu + base / len(on_rooms)
                acc_room[r] += pr
                e_room[r] += pr * DT / 3.6e6
                p_o += pr
            odu_on[o][m] = any_on
            acc_odu[o] += p_o
            e_odu[o] += p_o * DT / 3.6e6
            tot += p_o
        total_w[m] = tot
        kwh_by_hour[m // 60] += tot * DT / 3.6e6
        if m % 5 == 4:
            for r in ids:
                ta_series[r].append(round(ta[r], 2))
                tm_series[r].append(round(tm[r], 2))
                p_room_5[r].append(round(acc_room[r] / 5.0))
                acc_room[r] = 0.0
            for o in odu_rooms:
                p_odu_5[o].append(round(acc_odu[o] / 5.0))
                acc_odu[o] = 0.0

    # peak demand as max 15-min average (kW)
    peak = 0.0
    for m in range(0, 1440, 15):
        peak = max(peak, sum(total_w[m:m + 15]) / 15.0 / 1000.0)

    rooms_out = {}
    for r in ids:
        comfort = session_comfort(sessions_by_room.get(r, []), ta_series[r], tm_series[r], rh_min, to_min, lo, hi, clo)
        on_min = sum(1 for v in cmds[r] if v != OFF)
        rooms_out[r] = {
            "kwh": round(e_room[r], 3),
            "heat_kwh_th": round(q_room_heat[r], 2),
            "cool_kwh_th": round(q_room_cool[r], 2),
            "on_minutes": on_min,
            "actual": cmd_to_intervals(cmds[r]),
            "sessions": comfort,
        }
        if detail:
            rooms_out[r]["ta"] = ta_series[r]
            rooms_out[r]["p"] = p_room_5[r]
    odus_out = {}
    for o in odu_rooms:
        odus_out[o] = {
            "kwh": round(e_odu[o], 3),
            "on_minutes": sum(odu_on[o]),
            "actual": cmd_to_intervals([COND if v else OFF for v in odu_on[o]]),
        }
        if detail:
            odus_out[o]["p"] = p_odu_5[o]

    occ_minutes = sum(len(s["sessions"]) and sum(x["minutes"] for x in s["sessions"]) for s in rooms_out.values())
    in_band = sum(sum(x["in_band_minutes"] for x in s["sessions"]) for s in rooms_out.values())
    return {
        "rooms": rooms_out,
        "odus": odus_out,
        "kwh": round(sum(e_room.values()), 3),
        "kwh_by_hour": [round(v, 3) for v in kwh_by_hour],
        "peak_kw": round(peak, 2),
        "comfort_pct": round(100.0 * in_band / occ_minutes, 1) if occ_minutes else None,
        "occupied_minutes": occ_minutes,
        "end_state": {r: (ta[r], tm[r]) for r in ids},
        "guard_events": {r: v for r, v in guard_events.items() if v},
        "_cmds": cmds,
    }


def session_comfort(sessions, ta5, tm5, rh_min, to_min, lo, hi, clo) -> list[dict]:
    out = []
    for s in sessions:
        a, b = hm_to_min(s["start"]), hm_to_min(s["end"])
        idx = [k for k in range(a // 5, min(b // 5, len(ta5)))]
        if not idx:
            continue
        temps = [ta5[k] for k in idx]
        inb = sum(1 for t in temps if lo <= t <= hi)
        dm = sum(max(lo - t, 0.0) + max(t - hi, 0.0) for t in temps) * 5.0
        # PMV every 15 minutes during the session
        pv = []
        for k in idx[::3]:
            m = min(k * 5 + 4, 1439)
            rh_in = indoor_rh(to_min[m], rh_min[m], ta5[k])
            pv.append(pmv(ta5[k], tm5[k], rh_in, clo))
        start_k = max(a // 5 - 1, 0)
        out.append(
            {
                "id": s["id"],
                "start": s["start"],
                "end": s["end"],
                "minutes": b - a,
                "in_band_minutes": inb * 5 if len(temps) * 5 <= b - a else round(inb * (b - a) / len(temps)),
                "ta_start": ta5[start_k] if start_k < len(ta5) else None,
                "ta_min": min(temps),
                "ta_max": max(temps),
                "discomfort_dm": round(dm, 1),
                "pmv": round(sum(pv) / len(pv), 2) if pv else None,
            }
        )
    return out


def history_from_cmds(date_iso: str, rooms: dict, cmds: dict[str, list[int]], causes: dict[str, list[dict]], odus_actual: dict) -> list[dict]:
    """On/Off state transitions per device (IDU per room, ODU) with cause labels."""
    rows = []
    for r, cmd in cmds.items():
        prev = OFF
        for m in range(1441):
            v = cmd[m] if m < 1440 else OFF
            if v != prev:
                cause = _cause_at(causes.get(r, []), m, v)
                state = {OFF: "OFF", FAN: "FAN", COND: "ON"}[v]
                for idu in rooms[r]["idus"]:
                    rows.append({"date": date_iso, "t": min_to_hm(min(m, 1439) if m < 1440 else 1440), "minute": m,
                                 "device": idu["id"], "room": r, "state": state, "cause": cause})
                prev = v
    for o, d in odus_actual.items():
        for iv in d["actual"]:
            rows.append({"date": date_iso, "t": min_to_hm(iv["s"]), "minute": iv["s"], "device": o, "room": None, "state": "ON", "cause": "연결 실내기 가동"})
            rows.append({"date": date_iso, "t": min_to_hm(iv["e"]), "minute": iv["e"], "device": o, "room": None, "state": "OFF", "cause": "연결 실내기 모두 정지"})
    rows.sort(key=lambda x: (x["minute"], x["device"]))
    return rows


def _cause_at(causes: list[dict], m: int, v: int) -> str:
    for c in causes:
        if c["s"] <= m <= c["e"] and (c.get("on") is None or c["on"] == (v != OFF)):
            return c["label"]
    return "스케줄" if v != OFF else "스케줄 종료"
