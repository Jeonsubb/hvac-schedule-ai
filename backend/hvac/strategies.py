"""Operating strategies -> per-room plans (intervals in minutes from 00:00).

fixed  : building-wide fixed hours on weekdays (baseline A)
manual : on at first lecture, off 30 min after last lecture (baseline B)
rule   : requirement 5 rules (pre-on N min, early-off M min, bridge gaps <= G min)
ai     : predictive optimisation with the room thermal model and the weather forecast
         (optimal start, delayed start, skip, economizer, coasting stop, gap bridging)
"""
from __future__ import annotations

from .model import DT, RoomPhys, adjacent_temp, cop_cool, cop_heat, thermostat_q
from .simulate import COND, FAN, OFF, occupancy_array
from .timetable import hm_to_min, min_to_hm


def _sessions_minutes(sessions):
    return sorted((hm_to_min(s["start"]), hm_to_min(s["end"]), s) for s in sessions)


def plan_fixed(sessions_by_room: dict, rooms: dict, is_workday: bool, settings: dict) -> dict:
    if not is_workday:
        return {r: [] for r in rooms}
    a, b = hm_to_min(settings["fixed_on"]), hm_to_min(settings["fixed_off"])
    return {r: [{"s": a, "e": b, "kind": "cond", "reason": "고정 운전 시간"}] for r in rooms}


def plan_manual(sessions_by_room: dict, rooms: dict, settings: dict) -> dict:
    out = {}
    for r in rooms:
        ss = _sessions_minutes(sessions_by_room.get(r, []))
        if not ss:
            out[r] = []
            continue
        a = ss[0][0]
        b = min(max(e for _, e, _ in ss) + settings["manual_off_delay_min"], 1440)
        out[r] = [{"s": a, "e": b, "kind": "cond", "reason": "첫 수업 시작에 수동 가동, 마지막 수업 후 늦게 정지"}]
    return out


def plan_rule(sessions_by_room: dict, rooms: dict, settings: dict) -> dict:
    pre, early, gap = settings["pre_on_min"], settings["early_off_min"], settings["gap_merge_min"]
    out = {}
    for r in rooms:
        ss = _sessions_minutes(sessions_by_room.get(r, []))
        ivs: list[dict] = []
        for s, e, sess in ss:
            if ivs and s - ivs[-1]["_end"] <= gap:
                ivs[-1]["e"] = max(e - early, ivs[-1]["e"])
                ivs[-1]["_end"] = max(e, ivs[-1]["_end"])
                ivs[-1]["sessions"].append(sess["id"])
                ivs[-1]["reason"] = f"연속 강의(공백 {gap}분 이내) 유지"
                continue
            ivs.append({"s": max(s - pre, 0), "e": max(e - early, s), "_end": e, "kind": "cond",
                        "reason": f"시작 {pre}분 전 가동, 종료 {early}분 전 정지", "sessions": [sess["id"]]})
        for iv in ivs:
            iv.pop("_end", None)
        out[r] = ivs
    return out


# ---------------------------------------------------------------- predictive (AI)

class _Ctx:
    __slots__ = ("rp", "to", "ghi", "occ", "sp_h", "sp_c", "t_adj", "cap_frac", "cap_until")

    def __init__(self, rp, to, ghi, occ, sp_h, sp_c, t_adj):
        self.rp, self.to, self.ghi, self.occ, self.sp_h, self.sp_c = rp, to, ghi, occ, sp_h, sp_c
        self.t_adj = t_adj
        self.cap_frac, self.cap_until = 1.0, -1  # soft-start output limit before cap_until


def _forward(ctx: _Ctx, ta: float, tm: float, m0: int, m1: int, mode_at, lo=None, hi=None):
    """Simulate one room from m0 to m1. mode_at(m) -> OFF/FAN/COND.
    Returns (ta, tm, electric_wh, violated, ta_series_at_end)."""
    rp = ctx.rp
    e_wh = 0.0
    violated = False
    for m in range(m0, min(m1, 1440)):
        to = ctx.to[m]
        people = ctx.occ[m]
        c = mode_at(m)
        passive = (rp.gam * (tm - ta) + (rp.gao + rp.vent_g(people, c == FAN)) * (to - ta)
                   + rp.internal_gain(people) + rp.solar_gain(ctx.ghi[m]))
        q = thermostat_q(rp, ta, passive, ctx.sp_h, ctx.sp_c,
                         ctx.cap_frac if m < ctx.cap_until else 1.0) if c == COND else 0.0
        if q > 0:
            e_wh += q / cop_heat(to) / 60.0
        elif q < 0:
            e_wh += -q / cop_cool(to) / 60.0
        if c != OFF:
            e_wh += 60.0 * rp.n_idu / 60.0
        ta_new = ta + DT * (passive + q) / rp.ca
        tm = tm + DT * (rp.gam * (ta - tm) + rp.gmo * (to - tm) + rp.gadj * (ctx.t_adj - tm)) / rp.cm
        ta = ta_new
        if lo is not None and people > 0 and not (lo <= ta <= hi):
            violated = True
    return ta, tm, e_wh, violated


def _const(v):
    return lambda m: v


def _switch(t_on: int, v_before: int, v_after: int):
    return lambda m: v_after if m >= t_on else v_before


def _first_exit(ctx, ta, tm, m0, s, e, lo, hi):
    """Free-floating from m0; first minute in [s,e) where Ta leaves [lo,hi] (None if never)."""
    rp = ctx.rp
    for m in range(m0, min(e, 1440)):
        to = ctx.to[m]
        people = ctx.occ[m]
        passive = (rp.gam * (tm - ta) + (rp.gao + rp.vent_g(people, False)) * (to - ta)
                   + rp.internal_gain(people) + rp.solar_gain(ctx.ghi[m]))
        ta_new = ta + DT * passive / rp.ca
        tm = tm + DT * (rp.gam * (ta - tm) + rp.gmo * (to - tm) + rp.gadj * (ctx.t_adj - tm)) / rp.cm
        ta = ta_new
        if m >= s and not (lo <= ta <= hi):
            return m, ta
    return None, ta


def plan_ai_room(room: dict, sessions: list[dict], to_f, rh_f, ghi_f, init: tuple[float, float], settings: dict,
                 odu_share: float = 1.0):
    rp = RoomPhys(room)
    occ = occupancy_array(sessions)
    ctx = _Ctx(rp, to_f, ghi_f, occ, settings["sp_heat"], settings["sp_cool"], adjacent_temp(sum(to_f) / len(to_f)))
    margin = settings.get("ai_margin_k", 0.4)
    lo, hi = settings["comfort_low"] + margin, settings["comfort_high"] - margin
    max_lead = settings["ai_max_lead_min"]
    max_early = settings["ai_max_early_off_min"]
    gap_max = settings["ai_gap_eval_max_min"]
    rule_pre, rule_early = settings["pre_on_min"], settings["early_off_min"]

    # merge back-to-back sessions into blocks
    blocks: list[dict] = []
    for s, e, sess in _sessions_minutes(sessions):
        if blocks and s <= blocks[-1]["e"]:
            blocks[-1]["e"] = max(blocks[-1]["e"], e)
            blocks[-1]["sessions"].append(sess)
        else:
            blocks.append({"s": s, "e": e, "sessions": [sess]})

    intervals: list[dict] = []
    decisions: list[dict] = []
    ta, tm = init
    cursor = 0
    carry_on = False  # unit already running at block start (bridged gap)

    def sid(blk):
        return blk["sessions"][0]["id"]

    def add_dec(blk, **kw):
        decisions.append({"session": sid(blk), "sessions": [x["id"] for x in blk["sessions"]],
                          "room": room["id"], "title": blk["sessions"][0]["title"],
                          "start": min_to_hm(blk["s"]), "end": min_to_hm(blk["e"]), **kw})

    for i, blk in enumerate(blocks):
        s, e = blk["s"], blk["e"]
        label = blk["sessions"][0]["title"]
        humid = any(rh_f[m] >= settings["dehum_rh"] and to_f[m] >= settings["dehum_temp"] for m in range(s, min(e, 1440), 10))

        if carry_on:
            on_t, mode = s, COND
        else:
            td = max(cursor, s - max_lead)
            ta, tm, _, _ = _forward(ctx, ta, tm, cursor, td, _const(OFF))
            cursor = td
            exit_m, ta_exit = _first_exit(ctx, ta, tm, td, s, e, lo, hi)
            if exit_m is None and not humid:
                add_dec(blk, **{"type": "skip", "detail": "냉난방 없이도 수업 내내 쾌적 범위 유지 예측 → 가동 생략",
                                  "saved_min": (e - rule_early) - (s - rule_pre)})
                ta, tm, _, _ = _forward(ctx, ta, tm, td, e, _const(OFF))
                cursor = e
                continue
            # economizer: room overheats while outdoor air is cool and dry
            if exit_m is not None and ta_exit > hi and not humid and min(to_f[s:e] or [99]) < hi - 4:
                ta2, tm2, _, viol = _forward(ctx, ta, tm, td, e, _switch(s, OFF, FAN), lo, hi)
                if not viol:
                    intervals.append({"s": s, "e": e, "kind": "fan", "reason": "외기 냉방(송풍·환기) — 압축기 미가동",
                                      "sessions": [x["id"] for x in blk["sessions"]]})
                    add_dec(blk, **{"type": "economizer", "detail": f"외기 {min(to_f[s:e]):.1f}℃로 실내 과열을 송풍·환기로 해소",
                                      "saved_min": (e - rule_early) - (s - rule_pre)})
                    ta, tm, cursor = ta2, tm2, e
                    continue
            if exit_m is not None and exit_m > s + 10 and not humid:
                on_t = exit_m - 5
                add_dec(blk, **{"type": "late_start", "detail": f"수업 시작 후 {on_t - s}분까지 쾌적 유지 예측 → {min_to_hm(on_t)} 지연 기동",
                                  "saved_min": on_t - (s - rule_pre)})
            else:
                # optimal start: minimal lead so that Ta is in setpoint band at lecture start
                band_lo, band_hi = settings["sp_heat"] - 0.15, settings["sp_cool"] + 0.15

                def ok(lead):
                    t_a, _, _, _ = _forward(ctx, ta, tm, td, s, _switch(s - lead, OFF, COND))
                    return band_lo <= t_a <= band_hi

                def search():
                    lo_l, hi_l = 0, max(0, s - td)
                    if ok(0):
                        return 0, True
                    if not ok(hi_l):
                        return hi_l, False
                    while hi_l - lo_l > 1:
                        mid = (lo_l + hi_l) // 2
                        if ok(mid):
                            hi_l = mid
                        else:
                            lo_l = mid
                    return hi_l, True

                # Pre-conditioning output: the room cannot count on more than its share of the
                # outdoor unit (rooms on one ODU usually pre-heat together). Try a soft start
                # (efficient part-load range) and the ODU share; keep the feasible option with
                # the lower predicted electricity.
                share = odu_share
                options = []
                for frac in sorted({min(settings.get("ai_softstart_frac", 0.6), share), share}):
                    ctx.cap_frac, ctx.cap_until = frac, s
                    ld, feas = search()
                    _, _, e_wh, _ = _forward(ctx, ta, tm, td, s, _switch(s - ld, OFF, COND))
                    options.append((not feas, e_wh, ld, frac))
                options.sort()
                infeasible, _, lead, frac = options[0]
                feasible = not infeasible
                ctx.cap_frac, ctx.cap_until = (frac, s) if frac < 1.0 else (1.0, -1)
                if lead > 0:
                    lead = min(lead + settings.get("ai_lead_buffer_min", 3), max(0, s - td))
                on_t = s - lead
                why = "제습 필요(고습)" if humid else ("난방" if ta < band_lo else "냉방")
                how = f"출력 {round(ctx.cap_frac * 100)}%로 " if ctx.cap_frac < 1.0 and lead > 0 else ""
                add_dec(blk, **{"type": "optimal_start", "detail": f"예측 실내 {ta:.1f}℃ → {why} {how}{lead}분 선행 가동이면 시작 시 설정온도 도달",
                                  "lead_min": lead, "saved_min": rule_pre - lead, "soft": bool(how)})
            mode = COND
            ta, tm, _, _ = _forward(ctx, ta, tm, td, on_t, _const(OFF))
            cursor = on_t

        # run conditioning until the coasting window
        t_check = max(cursor, e - max_early)
        ta, tm, _, _ = _forward(ctx, ta, tm, cursor, t_check, _const(mode))
        cursor = t_check

        nxt = blocks[i + 1] if i + 1 < len(blocks) else None
        gap = (nxt["s"] - e) if nxt else None

        # coasting stop: earliest off time that keeps comfort to the end of the block
        t_off = e
        sa, sm = ta, tm
        for cand in range(t_check, e):
            _, _, _, viol = _forward(ctx, sa, sm, cand, e, _const(OFF), lo, hi)
            if not viol:
                t_off = cand
                break
            sa, sm, _, _ = _forward(ctx, sa, sm, cand, cand + 1, _const(mode))
        ta_off, tm_off = sa, sm

        bridge = False
        if nxt is not None and gap is not None and 0 < gap <= gap_max and mode == COND:
            # option A: keep running through the gap
            ta_a, tm_a, e_a, _ = _forward(ctx, ta_off, tm_off, t_off, nxt["s"], _const(COND))
            # option B: stop at t_off, restart with a quick lead estimate
            best_b = None
            for lead in (0, 5, 10, 15, 20, 30, 45, 60):
                if nxt["s"] - lead < t_off:
                    break
                ta_b, tm_b, e_b, _ = _forward(ctx, ta_off, tm_off, t_off, nxt["s"], _switch(nxt["s"] - lead, OFF, COND))
                if settings["sp_heat"] - 0.15 <= ta_b <= settings["sp_cool"] + 0.15:
                    best_b = e_b
                    break
            if best_b is None or e_a < best_b:
                bridge = True
                add_dec(blk, **{"type": "bridge", "detail": f"공백 {gap}분: 계속 가동({e_a:.0f}Wh)이 재기동({(best_b or 0):.0f}Wh)보다 효율적",
                                  "saved_min": 0})
        if bridge:
            if soft_seg:
                intervals.append(soft_seg)
                on_t = soft_seg["e"]
            # extend through the gap; next block starts with carry_on
            ta, tm, _, _ = _forward(ctx, ta, tm, t_check, e, _const(mode))
            cursor = e
            intervals.append({"s": on_t, "e": e, "kind": "cond", "reason": "예측 최적화 (공백 유지)",
                              "sessions": [x["id"] for x in blk["sessions"]], "_bridge": True})
            ta, tm, _, _ = _forward(ctx, ta, tm, e, nxt["s"], _const(COND))
            intervals.append({"s": e, "e": nxt["s"], "kind": "cond", "reason": "공백 유지 (재기동보다 효율적)", "sessions": []})
            cursor = nxt["s"]
            carry_on = True
            continue

        soft_seg = None
        if ctx.cap_frac < 1.0 and ctx.cap_until > on_t:
            soft_seg = {"s": on_t, "e": min(ctx.cap_until, t_off), "kind": "cond", "cap": ctx.cap_frac,
                        "reason": f"예열 (실내기 출력 {round(ctx.cap_frac * 100)}%, 실외기 용량 분담)", "sessions": []}
        ctx.cap_frac, ctx.cap_until = 1.0, -1
        if t_off < e:
            add_dec(blk, **{"type": "early_stop", "detail": f"건물 열관성으로 종료 {e - t_off}분 전 정지해도 쾌적 유지",
                              "saved_min": (e - t_off) - rule_early})
        if soft_seg:
            intervals.append(soft_seg)
        intervals.append({"s": soft_seg["e"] if soft_seg else on_t, "e": t_off, "kind": "cond",
                          "reason": "예측 최적화 (최적 기동·관성 정지)",
                          "sessions": [x["id"] for x in blk["sessions"]]})
        ta, tm = ta_off, tm_off
        cursor = t_off
        carry_on = False

    # merge adjacent cond intervals
    merged: list[dict] = []
    for iv in sorted(intervals, key=lambda x: x["s"]):
        iv.pop("_bridge", None)
        if (merged and iv["kind"] == merged[-1]["kind"] and iv.get("cap", 1.0) == merged[-1].get("cap", 1.0)
                and iv["s"] <= merged[-1]["e"]):
            merged[-1]["e"] = max(merged[-1]["e"], iv["e"])
            merged[-1]["sessions"] = merged[-1].get("sessions", []) + iv.get("sessions", [])
        else:
            merged.append(iv)
    return merged, decisions


def _odu_share(rooms: dict, r: str) -> float:
    """Fraction of rated IDU output a room can rely on when every room on its ODU runs at once."""
    from .config import ODUS

    odu = rooms[r]["odu"]
    connected = sum(sum(i["heat_kw"] for i in v["idus"]) for v in rooms.values() if v["odu"] == odu)
    return min(1.0, ODUS[odu]["cap_kw"] / connected) if connected else 1.0


def plan_ai(sessions_by_room: dict, rooms: dict, weather_f: dict, init: dict, settings: dict):
    plans, decisions = {}, []
    for r in rooms:
        ss = sessions_by_room.get(r, [])
        if not ss:
            plans[r] = []
            continue
        p, d = plan_ai_room(rooms[r], ss, weather_f["to"], weather_f["rh"], weather_f["ghi"], init[r], settings,
                            odu_share=_odu_share(rooms, r))
        plans[r] = p
        decisions.extend(d)
    return plans, decisions
