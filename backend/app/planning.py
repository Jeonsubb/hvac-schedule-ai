"""AI schedule tiers and the operating loop around them.

1차 (monthly)  base plan from the timetable, academic calendar, climate and equipment
2차 (weekly)   re-check with this week's events, forecast, occupant feedback, occupancy and CO2
3차 (daily)    re-check today with the nowcast, indoor sensors, CO2, occupancy and today's feedback

Each tier returns consistency checks (does the plan still fit the data that just arrived?) and
schedule adjustments. Setpoint adjustments change the AI operation in the simulator once applied
(service.day_settings); ventilation adjustments only change the ventilation command and CO2 forecast.
Operation mode decides who applies them: auto (AI applies, commands go to the central controller)
or recommend (the operator approves each one).

Sensors that the demo building does not have (CO2, Wi-Fi occupancy) are simulated from the same
occupancy the thermal simulator uses and are labelled as such.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import random
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

from hvac import config, engine
from hvac.timetable import WEEKDAYS, hm_to_min, min_to_hm, sessions_for_date

from . import service
from .store import get_store

# ---------------------------------------------------------------- policy (operator-confirmed bounds)

ORIENTS = ("남", "북", "동", "서")
DEFAULT_POLICY = {
    # 학교보건법 교실 18~28℃, 에너지이용 합리화법 난방 20℃ 이하·냉방 26℃ 이상, 강의실은 학교가 탄력 운영
    "heat_min": 18.0,
    "heat_max": 22.0,
    "cool_min": 26.0,
    "cool_max": 28.0,
    "co2_max": 1000,  # 학교보건법 시행규칙 교실 CO2 기준
    "weather_jump_c": 2.0,  # 예보 대비 실황 편차가 이 이상이면 재계산
    "attendance": 0.75,  # 수강 인원 정보가 없을 때 정원 대비 출석률 가정
    # arbiter: value of 1 PMV unit for one room for one day (won). Small → savings win, large → comfort wins.
    "comfort_won": 600,
    # assumption: facade orientation of each room (no drawings available)
    "orient": {"306": "남", "307": "남", "309": "북", "310": "북", "405": "남", "406": "남", "407": "남",
               "408": "서", "409": "서", "410": "동"},
}


def policy() -> dict:
    st = get_store().get_item("policy", "active") or {}
    out = {**DEFAULT_POLICY, **{k: v for k, v in st.items() if k in DEFAULT_POLICY}}
    out["orient"] = {**DEFAULT_POLICY["orient"], **(st.get("orient") or {})}
    return out


def save_policy(patch: dict, actor: str = "운영자") -> dict:
    from .validation import InvalidInput

    cur = policy()
    new = {**cur}

    def num(k, lo, hi):
        if k in patch and patch[k] is not None:
            try:
                v = float(patch[k])
            except (TypeError, ValueError):
                raise InvalidInput(f"{k}는 숫자여야 합니다.")
            if not lo <= v <= hi:
                raise InvalidInput(f"{k}는 {lo}~{hi} 사이여야 합니다.")
            new[k] = round(v, 2)

    num("heat_min", 15, 24)
    num("heat_max", 15, 26)
    num("cool_min", 22, 30)
    num("cool_max", 22, 30)
    num("co2_max", 600, 2000)
    num("weather_jump_c", 0.5, 8)
    num("attendance", 0.2, 1.0)
    num("comfort_won", 0, 5000)
    if new["heat_min"] > new["heat_max"] or new["cool_min"] > new["cool_max"]:
        raise InvalidInput("허용 범위의 최소값이 최대값보다 클 수 없습니다.")
    if isinstance(patch.get("orient"), dict):
        o = dict(new["orient"])
        for r, v in patch["orient"].items():
            if r in config.ROOMS and v in ORIENTS:
                o[r] = v
        new["orient"] = o
    new["co2_max"] = int(new["co2_max"])
    changes = {k: v for k, v in new.items() if cur.get(k) != v}
    get_store().put_item("policy", "active", new)
    if changes:
        service.audit("policy", "운영 정책 변경: " + ", ".join(f"{k}={v}" for k, v in changes.items()), actor, {"changes": changes})
        clear_cache()
    return new


# ---------------------------------------------------------------- operation mode

def mode() -> dict:
    it = get_store().get_item("meta", "op_mode") or {"mode": "recommend", "changed_at": None, "by": None}
    pending = sum(1 for a in get_store().list_items("adjustment") if a.get("status") == "pending")
    return {**it, "pending": pending}


def set_mode(m: str, actor: str = "운영자") -> dict:
    from .validation import InvalidInput

    if m not in ("auto", "recommend"):
        raise InvalidInput("mode는 auto 또는 recommend입니다.")
    prev = mode()["mode"]
    get_store().put_item("meta", "op_mode", {"mode": m, "changed_at": service.now_kst().isoformat(timespec="seconds"), "by": actor})
    if prev != m:
        label = "자동 운전" if m == "auto" else "추천 모드"
        service.audit("mode", f"운전 모드 변경: {label}", actor)
        if m == "auto":  # auto mode: proposals waiting for approval are applied now (within the auto limits)
            for a in adjustments("pending"):
                if a.get("auto_ok", True):
                    apply_adjustment(a["id"], "AI 자동 운전")
    clear_cache()
    return mode()


# ---------------------------------------------------------------- adjustments and central-controller commands

def adjustments(status: str | None = None) -> list[dict]:
    items = get_store().list_items("adjustment")
    if status:
        items = [a for a in items if a.get("status") == status]
    return sorted(items, key=lambda a: a.get("created_at", ""), reverse=True)


def upsert_proposal(adj: dict) -> dict:
    """Create or refresh a proposal. Decided ones are never reopened. In auto mode it is applied at once."""
    st = get_store()
    cur = st.get_item("adjustment", adj["id"])
    if cur and cur.get("status") in ("applied", "rejected"):
        return cur
    now = service.now_kst().isoformat(timespec="seconds")
    rec = {**adj, "status": "pending", "created_at": (cur or {}).get("created_at", now), "decided_at": None, "decided_by": None}
    st.put_item("adjustment", rec["id"], rec)
    if not cur:
        service.audit("adjustment", f"조정안 생성: {rec['title']}", "AI", {"id": rec["id"]})
    if (st.get_item("meta", "op_mode") or {}).get("mode") == "auto" and rec.get("auto_ok", True):
        rec = apply_adjustment(rec["id"], "AI 자동 운전")
    return rec


def apply_adjustment(adj_id: str, actor: str = "운영자") -> dict:
    from .validation import InvalidInput

    st = get_store()
    a = st.get_item("adjustment", adj_id)
    if not a:
        raise InvalidInput("조정안을 찾을 수 없습니다.")
    if a["status"] == "applied":
        return a
    a = {**a, "status": "applied", "decided_at": service.now_kst().isoformat(timespec="seconds"), "decided_by": actor}
    st.put_item("adjustment", adj_id, a)
    dispatch_commands(a)
    service.audit("adjustment", f"조정안 적용: {a['title']}", actor, {"id": adj_id})
    clear_cache()
    service._queue_precompute()
    return a


def reject_adjustment(adj_id: str, actor: str = "운영자") -> dict:
    from .validation import InvalidInput

    st = get_store()
    a = st.get_item("adjustment", adj_id)
    if not a:
        raise InvalidInput("조정안을 찾을 수 없습니다.")
    was_applied = a["status"] == "applied"
    a = {**a, "status": "rejected", "decided_at": service.now_kst().isoformat(timespec="seconds"), "decided_by": actor}
    st.put_item("adjustment", adj_id, a)
    service.audit("adjustment", f"조정안 거절: {a['title']}", actor, {"id": adj_id})
    clear_cache()
    if was_applied:
        service._queue_precompute()
    return a


VENT_LABEL = {"low": "약", "mid": "중", "high": "강"}


def dispatch_commands(a: dict) -> list[dict]:
    """Write the adjustment to the central controller through the site gateway (simulated: acked)."""
    st = get_store()
    now = service.now_kst().isoformat(timespec="seconds")
    window = a["date_from"] if a["date_from"] == a["date_to"] else f"{a['date_from']}~{a['date_to']}"
    out = []
    for r in a.get("rooms", []):
        room = config.ROOMS.get(r)
        if not room:
            continue
        ch = a.get("change") or {}
        writes = []
        for idu in room["idus"]:
            if "sp_heat" in ch:
                writes.append((idu["id"], f"AV:{idu['id']}/HeatSetpoint", f"{idu['id']}/HeatSetpoint", float(ch["sp_heat"]), f"{float(ch['sp_heat']):.1f}℃"))
            if "sp_cool" in ch:
                writes.append((idu["id"], f"AV:{idu['id']}/CoolSetpoint", f"{idu['id']}/CoolSetpoint", float(ch["sp_cool"]), f"{float(ch['sp_cool']):.1f}℃"))
        if "vent" in ch:
            lv = {"low": 1, "mid": 2, "high": 3}.get(ch["vent"], 2)
            writes.append((f"ERV-{r}", f"AV:ERV-{r}/FanLevel", f"ERV-{r}/FanLevel", lv, VENT_LABEL.get(ch["vent"], ch["vent"])))
        from . import gateway

        real = gateway.queue_writes(a, writes, f"{window} 수업 시간")
        if real is not None:  # a live edge gateway will write these over BACnet and acknowledge
            out += real
            continue
        for dev, point, _name, _num, value in writes:  # no gateway online: simulated controller
            cid = f"{now}-{uuid.uuid4().hex[:6]}"
            rec = {"id": cid, "ts": now, "device": dev, "room": r, "point": point, "value": value,
                   "window": f"{window} 수업 시간", "adjustment_id": a["id"], "status": "acked", "simulated": True}
            st.put_item("command", cid, rec)
            out.append(rec)
    return out


def commands(limit: int = 50) -> list[dict]:
    return sorted(get_store().list_items("command"), key=lambda c: c["ts"], reverse=True)[:limit]


# ---------------------------------------------------------------- occupant feedback

TAGS = {"stuffy": "답답함", "draft": "바람", "humid": "습함", "dry": "건조", "noise": "소음"}
VOTE_WORD = {-3: "춥다", -2: "서늘하다", -1: "약간 서늘하다", 0: "적당하다", 1: "약간 따뜻하다", 2: "따뜻하다", 3: "덥다"}


def add_feedback(body: dict, source: str = "occupant", client: str | None = None) -> dict:
    from .validation import InvalidInput

    room = str(body.get("room") or "").strip().removesuffix("호")
    if room not in config.ROOMS:
        raise InvalidInput(f"강의실 번호를 확인하세요: {', '.join(config.ROOMS)}")
    try:
        vote = int(body.get("vote"))
    except (TypeError, ValueError):
        raise InvalidInput("vote는 -3(춥다)~+3(덥다) 정수입니다.")
    if not -3 <= vote <= 3:
        raise InvalidInput("vote는 -3(춥다)~+3(덥다) 정수입니다.")
    tags = [t for t in (body.get("tags") or []) if t in TAGS][:5]
    text = str(body.get("text") or "").strip()[:300]
    if source not in ("occupant", "operator"):
        source = "occupant"
    now = service.now_kst()
    if client and source == "occupant":
        # one vote per person per room per 30 minutes (QR pages have no sign-in; repeated votes would skew the average)
        since = (now - timedelta(minutes=30)).isoformat(timespec="seconds")
        if any(f.get("client") == client and f["room"] == room and f["ts"] >= since for f in get_store().list_items("feedback")):
            raise InvalidInput("이 강의실 의견은 30분에 한 번만 받습니다. 잠시 뒤 다시 남겨 주세요.")
    fb = {"id": "F" + uuid.uuid4().hex[:10], "ts": now.isoformat(timespec="seconds"), "date": now.date().isoformat(),
          "minute": now.hour * 60 + now.minute, "room": room, "vote": vote, "tags": tags, "text": text,
          "source": source, "status": "new", "reflected_in": None, "client": client}
    get_store().put_item("feedback", fb["id"], fb)
    clear_cache()
    return {"feedback": fb, "reply": _feedback_reply(fb)}


def _feedback_reply(fb: dict) -> dict:
    ctx = service.Ctx()
    pol = policy()
    try:
        live = service.live_snapshot(ctx)
        lr = next((x for x in live["rooms"] if x["room"] == fb["room"]), None)
        now_min = live["now"]["minute"]
        d = date.fromisoformat(live["now"]["date"])
    except Exception:
        lr, now_min, d = None, fb["minute"], date.fromisoformat(fb["date"])
    rsp = service.room_setpoints(d, ctx).get(fb["room"], {})
    sp_h = rsp.get("sp_heat", ctx.settings["sp_heat"])
    sp_c = rsp.get("sp_cool", ctx.settings["sp_cool"])
    co2 = None
    try:
        co2 = room_iaq(d, fb["room"], ctx)["co2"][min(now_min // 15, 95)]
    except Exception:
        pass
    state = {"ON": "냉난방 가동 중", "FAN": "송풍(외기 냉방) 중", "OFF": "정지"}.get((lr or {}).get("state"), "확인 불가")
    ta = (lr or {}).get("ta")
    sess = ((lr or {}).get("session") or {}).get("title")
    word = VOTE_WORD[fb["vote"]]
    parts = [f"{fb['room']}호 '{word}' 의견을 받았습니다."]
    if ta is not None:
        parts.append(f"지금 실내는 {ta:.1f}℃이고 {state}입니다. 설정온도는 난방 {sp_h:.1f}℃, 냉방 {sp_c:.1f}℃입니다.")
    if "stuffy" in fb["tags"] and co2:
        parts.append(f"이산화탄소 추정치는 {co2:.0f}ppm입니다(기준 {pol['co2_max']}ppm).")
    policy_txt = (f"교실 온도는 학교보건법(18~28℃)과 에너지이용 합리화법(난방 20℃ 이하·냉방 26℃ 이상) 범위에서 정하며, "
                  f"이 건물은 난방 {pol['heat_min']:.0f}~{pol['heat_max']:.0f}℃, 냉방 {pol['cool_min']:.0f}~{pol['cool_max']:.0f}℃ 안에서 "
                  "AI가 수업마다 가장 경제적이면서 쾌적한 온도를 고릅니다.")
    nxt = ("오늘 같은 강의실 의견은 3차(일일) 검증에 바로 반영되어 설정온도 조정안이 만들어지고, "
           "사용자 에이전트가 관리자 에이전트(북항이)와 비용·쾌적을 협의합니다. "
           + ("자동 운전 모드라 조정안은 바로 적용됩니다." if mode()["mode"] == "auto" else "추천 모드라 관리자가 승인하면 적용됩니다."))
    return {"message": " ".join(parts), "room": {"ta": ta, "state": state, "sp_heat": sp_h, "sp_cool": sp_c, "co2": co2, "session": sess},
            "policy": policy_txt, "next": nxt}


def feedback_items(days: int = 14, room: str | None = None, until: date | None = None) -> list[dict]:
    seed_feedback()
    until = until or service.now_kst().date()
    since = (until - timedelta(days=days - 1)).isoformat()
    items = [f for f in get_store().list_items("feedback") if since <= f["date"] <= until.isoformat()]
    if room:
        items = [f for f in items if f["room"] == room]
    return sorted(items, key=lambda f: f["ts"], reverse=True)


def feedback_summary(days: int = 14, room: str | None = None) -> dict:
    items = feedback_items(days, room)
    by_room: dict = {}
    by_hour: dict = {}
    for f in items:
        b = by_room.setdefault(f["room"], {"n": 0, "sum": 0, "cold": 0, "hot": 0, "stuffy": 0, "last_ts": None})
        b["n"] += 1
        b["sum"] += f["vote"]
        b["cold"] += f["vote"] <= -1
        b["hot"] += f["vote"] >= 1
        b["stuffy"] += "stuffy" in f["tags"]
        b["last_ts"] = max(b["last_ts"] or "", f["ts"])
        h = str(f["minute"] // 60)
        hb = by_hour.setdefault(f["room"], {}).setdefault(h, {"n": 0, "sum": 0})
        hb["n"] += 1
        hb["sum"] += f["vote"]
    for b in by_room.values():
        b["mean"] = round(b.pop("sum") / b["n"], 2) if b["n"] else None
    for r in by_hour.values():
        for h, hb in r.items():
            r[h] = {"n": hb["n"], "mean": round(hb["sum"] / hb["n"], 2)}
    return {"items": items[:200], "by_room": by_room, "by_hour": by_hour, "days": days}


_seed_lock = threading.Lock()


def seed_feedback(days: int = 14) -> None:
    """Demo building has no feedback history: derive occupant votes from the simulated comfort (PMV)
    of past AI-operated classes, deterministic per session, labelled source='simulated'."""
    st = get_store()
    if st.get_item("meta", "feedback_seeded"):
        return
    with _seed_lock:
        if st.get_item("meta", "feedback_seeded"):
            return
        ctx = service.Ctx()
        today = service.now_kst().date()
        s0, s1 = service.semester_range()
        made = 0
        for k in range(days, 0, -1):
            d = today - timedelta(days=k)
            if not (s0 <= d <= s1):
                continue
            try:
                day = service.get_day(d, ctx)
            except Exception:
                continue
            ai = day["strategies"]["ai"]
            for r, rr in ai["rooms"].items():
                orient = DEFAULT_POLICY["orient"].get(r, "남")
                bias = {"북": 0.35, "서": 0.28, "동": 0.25, "남": 0.18}[orient]
                for c in rr["sessions"]:
                    if c.get("vacant") or c.get("pmv") is None:
                        continue
                    rng = random.Random(f"fb|{c['id']}")
                    pmv = c["pmv"]
                    sess = next((s for s in day["sessions"] if s["id"] == c["id"]), None)
                    people = (sess or {}).get("expected_people", 30)
                    a, b = hm_to_min(c["start"]), hm_to_min(c["end"])
                    votes = []
                    for _ in range(2):  # two occupants who might speak up
                        if rng.random() < bias * min(1.0, max(0.0, (-pmv - 0.3) * 1.2)):
                            votes.append((max(-3, min(-1, round(pmv * 1.8 + rng.uniform(-0.6, 0.6)))), []))
                    if not votes and rng.random() < 0.3 * min(1.0, max(0.0, pmv - 0.3)):
                        votes.append((max(1, min(3, round(pmv * 1.6 + rng.uniform(-0.5, 0.5)))), []))
                    if people >= 45 and rng.random() < 0.06:  # crowded class: stuffy near the end
                        votes.append((1, ["stuffy"]))
                    for j, (vote, tags) in enumerate(votes):
                        minute = rng.randint(a, max(a, b - 5)) if vote < 0 else max(a, b - rng.randint(10, 30))
                        fid = f"FS{hashlib.sha1(f'{c['id']}|{j}'.encode()).hexdigest()[:9]}"
                        text = ("사람이 많아서 답답해요" if tags else
                                {(-3): "너무 추워요", (-2): "추워서 외투를 입고 있어요", (-1): "조금 서늘해요",
                                 1: "조금 더워요", 2: "더워서 졸려요", 3: "너무 더워요"}[vote])
                        st.put_item("feedback", fid, {
                            "id": fid, "ts": f"{d.isoformat()}T{min_to_hm(minute)}:00+09:00", "date": d.isoformat(),
                            "minute": minute, "room": r, "vote": vote, "tags": tags, "text": text,
                            "source": "simulated", "status": "new", "reflected_in": None})
                        made += 1
        st.put_item("meta", "feedback_seeded", {"at": service.now_kst().isoformat(timespec="seconds"), "count": made})


# ---------------------------------------------------------------- simulated sensors: CO2, occupancy, solar

CO2_OUT = 420.0
CO2_GEN_M3H = 0.016  # per seated student (about 0.0045 L/s)
INFIL_ACH = 0.3
VENT_LEVELS = {"low": 600.0, "mid": 1000.0, "high": 1400.0}  # ERV fan levels for a 99 m2 classroom (m3/h)
BASE_VENT_PP = 25.0  # what the thermal simulator assumes (m3/h per person)
ERV_EFF = 0.6
CEILING_M = 2.7


def _vent_q(room: dict, level: str) -> float:
    return VENT_LEVELS[level] * room["area"] / 99.0


def vent_level_for(room: dict, people: float, co2_max: float) -> tuple[str, float]:
    """Smallest ERV level that keeps steady-state CO2 under the limit; (level, predicted steady ppm)."""
    vol = room["area"] * CEILING_M
    for lv in ("low", "mid", "high"):
        q = _vent_q(room, lv) + INFIL_ACH * vol
        ss = CO2_OUT + people * CO2_GEN_M3H * 1e6 / q
        if ss <= co2_max:
            return lv, ss
    q = _vent_q(room, "high") + INFIL_ACH * vol
    return "high", CO2_OUT + people * CO2_GEN_M3H * 1e6 / q


def co2_series(room: dict, people_min: list[float], level_at) -> list[float]:
    """1-minute CO2 mass balance → 96 values (max of each 15 minutes)."""
    vol = room["area"] * CEILING_M
    c = CO2_OUT + 30.0
    out = []
    mx = 0.0
    for m in range(1440):
        n = people_min[m]
        q = INFIL_ACH * vol + (_vent_q(room, level_at(m)) if n > 0 else 0.0)
        c += (n * CO2_GEN_M3H * 1e6 + q * (CO2_OUT - c)) / vol / 60.0
        mx = max(mx, c)
        if m % 15 == 14:
            out.append(round(mx))
            mx = 0.0
    return out


def orient_factor(o: str, h: float) -> float:
    """Share of global horizontal irradiance reaching the facade by hour (simple clear-sky shape)."""
    if o == "북":
        return 0.15
    peak = {"동": 9.0, "남": 12.5, "서": 15.5}[o]
    width = {"동": 2.6, "남": 3.2, "서": 2.6}[o]
    return 0.15 + 0.75 * math.exp(-((h - peak) / width) ** 2)


def solar_kw(room: dict, o: str, ghi_by_hour: list[float], hours=range(13, 18)) -> float:
    win = 10.0 * room["area"] / 99.0
    return round(max((win * 0.4 * max(ghi_by_hour[h], 0) * orient_factor(o, h + 0.5) for h in hours), default=0.0) / 1000.0, 2)


def vent_kwh_delta(room: dict, level: str, people: float, minutes: float, t_in: float, t_out: float) -> float:
    """Extra (or saved) heating/cooling electricity of a ventilation level vs the simulator default."""
    dq = _vent_q(room, level) - BASE_VENT_PP * people
    g = dq * 1.2 * 1005.0 / 3600.0 * (1 - ERV_EFF)
    dt = abs(t_in - t_out)
    cop = 3.0
    return g * dt * minutes / 60.0 / 1000.0 / cop


def _occupancy(day: dict) -> dict[str, list[float]]:
    by_room = {r: [s for s in day["sessions"] if s["room"] == r] for r in config.ROOMS}
    return engine.actual_occupancy(by_room, day.get("scenario") or {})


def room_iaq(d: date, r: str, ctx: service.Ctx, day: dict | None = None) -> dict:
    day = day or service.get_day(d, ctx)
    pol = policy()
    room = config.ROOMS[r]
    occ = _occupancy(day)[r]
    plan = vent_plan(day, pol)
    lv = plan.get(r, {})

    def level_at(m):
        for blk in lv.get("blocks", []):
            if blk["s"] <= m < blk["e"]:
                return blk["level"]
        return "mid"

    return {"co2": co2_series(room, occ, level_at), "people": [round(sum(occ[k:k + 15]) / 15.0, 1) for k in range(0, 1440, 15)],
            "plan": lv}


def _people(s: dict, pol: dict) -> int:
    """Expected head count; estimated counts follow the operator's attendance answer (default 75 %)."""
    n = s.get("expected_people") or 0
    if s.get("people_estimated"):
        n = round(n * pol["attendance"] / DEFAULT_POLICY["attendance"])
    return int(min(n, config.ROOMS[s["room"]]["capacity"]))


def vent_plan(day: dict, pol: dict) -> dict:
    """Per room: ERV level for each session from expected people (CO2-based ventilation plan)."""
    out = {}
    for r, room in config.ROOMS.items():
        blocks = []
        for s in day["sessions"]:
            if s["room"] != r:
                continue
            people = _people(s, pol)
            lv, ss = vent_level_for(room, people, pol["co2_max"])
            blocks.append({"s": hm_to_min(s["start"]) - 10, "e": hm_to_min(s["end"]), "level": lv, "ppm": round(ss),
                           "people": people, "title": s["title"], "start": s["start"]})
        top = max((b["level"] for b in blocks), key=lambda x: ("low", "mid", "high").index(x), default="mid")
        peak = max((b["ppm"] for b in blocks), default=None)
        out[r] = {"blocks": blocks, "level": top, "peak": peak}
    return out


# ---------------------------------------------------------------- evaluation (simulator) shared with the agents

def season_for(dates: list[date], ctx: service.Ctx) -> str:
    ts = [sum(ctx.wx[d.isoformat()]["forecast"]["t"]) / 24.0 for d in dates if d.isoformat() in ctx.wx]
    tm = sum(ts) / len(ts) if ts else 15.0
    m = dates[0].month
    if m in (11, 12, 1, 2, 3):
        return "heat"
    if m in (6, 7, 8):
        return "cool"
    return "heat" if tm < 17.0 else "cool"


_eval_cache: dict = {}


def simulate_with(d: date, ctx: service.Ctx, extra_sp: dict | None = None) -> dict:
    """AI-only simulation of one day with today's applied setpoints plus extra per-room setpoints."""
    sd = service.day_settings(d, ctx)
    rs = {k: dict(v) for k, v in (sd.get("room_sp") or {}).items()}
    for r, v in (extra_sp or {}).items():
        rs.setdefault(r, {}).update({k: float(x) for k, x in v.items() if k in ("sp_heat", "sp_cool")})
    st = {**ctx.settings, "room_sp": rs} if rs else ctx.settings
    key = service._h([d.isoformat(), service.day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, st)])
    hit = _eval_cache.get(key)
    if hit is not None:
        return hit
    day = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, st, detail=False, strategies=("ai",))
    sim = day["strategies"]["ai"]
    res = {"kwh": sim["kwh"], "cost_krw": sim["cost_krw"],
           "cold_starts": engine.cold_starts(sim, ctx.settings["comfort_low"], ctx.settings["comfort_high"]),
           "rooms": {}}
    for r, rr in sim["rooms"].items():
        pm = [c["pmv"] for c in rr["sessions"] if c.get("pmv") is not None and not c.get("vacant")]
        res["rooms"][r] = {"kwh": rr["kwh"], "pmv": round(sum(pm) / len(pm), 2) if pm else None, "n": len(pm),
                           "discomfort_dm": round(sum(c["discomfort_dm"] for c in rr["sessions"]), 1)}
    if len(_eval_cache) > 600:
        _eval_cache.clear()
    _eval_cache[key] = res
    return res


def evaluate(dates: list[date], ctx: service.Ctx, extra_sp: dict | None = None, feedback: dict | None = None) -> dict:
    """Totals over dates: kWh, cost, mean PMV of occupied classes, cold/hot rooms (PMV beyond ±0.5)."""
    tot_kwh = tot_cost = disc = 0.0
    cs = 0
    rooms: dict = {}
    for d in dates:
        r = simulate_with(d, ctx, extra_sp)
        tot_kwh += r["kwh"]
        tot_cost += r["cost_krw"]
        cs += r["cold_starts"]
        for k, v in r["rooms"].items():
            a = rooms.setdefault(k, {"kwh": 0.0, "pmv_sum": 0.0, "n": 0})
            a["kwh"] += v["kwh"]
            disc += v["discomfort_dm"]
            if v["pmv"] is not None:
                a["pmv_sum"] += v["pmv"] * v["n"]
                a["n"] += v["n"]
    out_rooms = {}
    pm_all = n_all = 0.0
    for k, a in rooms.items():
        pmv = round(a["pmv_sum"] / a["n"], 2) if a["n"] else None
        sp = (extra_sp or {}).get(k, {})
        out_rooms[k] = {"kwh": round(a["kwh"], 2), "pmv": pmv, **({"sp_heat": sp["sp_heat"]} if "sp_heat" in sp else {}),
                        **({"sp_cool": sp["sp_cool"]} if "sp_cool" in sp else {})}
        pm_all += a["pmv_sum"]
        n_all += a["n"]
    cold = sorted(k for k, v in out_rooms.items() if v["pmv"] is not None and v["pmv"] < -0.5)
    hot = sorted(k for k, v in out_rooms.items() if v["pmv"] is not None and v["pmv"] > 0.5)
    addressed = 0
    for k, fb in (feedback or {}).items():
        v = out_rooms.get(k)
        if v and v["pmv"] is not None and fb.get("mean") is not None:
            if (fb["mean"] <= -0.8 and v["pmv"] >= -0.5) or (fb["mean"] >= 0.8 and v["pmv"] <= 0.5):
                addressed += 1
    return {"kwh": round(tot_kwh, 2), "cost_krw": round(tot_cost), "pmv_mean": round(pm_all / n_all, 2) if n_all else None,
            "cold_rooms": cold, "hot_rooms": hot, "discomfort_dm": round(disc, 1), "cold_starts": cs,
            "complaints_addressed": addressed, "rooms": out_rooms}


# ---------------------------------------------------------------- tier helpers

_cache: dict = {}


def clear_cache() -> None:
    _cache.clear()


def _cached(key: str, fn, ttl: float = 90.0):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def _src(key, label, origin, detail, status="ok", updated_at=None) -> dict:
    return {"key": key, "label": label, "origin": origin, "status": status, "detail": detail, "updated_at": updated_at}


def _check(cid, title, sources, expected, observed, verdict, action, idea=None, rooms=None) -> dict:
    return {"id": cid, "title": title, "idea": idea, "sources": sources, "expected": expected, "observed": observed,
            "verdict": verdict, "action": action, "rooms": rooms or []}


def fmt_kma_base(base) -> str | None:
    """'202611192300' → '11/19 23:00'."""
    b = str(base or "")
    if len(b) >= 12 and b[:12].isdigit():
        return f"{int(b[4:6])}/{int(b[6:8])} {b[8:10]}:{b[10:12]}"
    return b or None


PROTO_LABEL = {"bacnet": "BACnet/IP", "modbus": "Modbus TCP", "vendor_api": "제조사 API", "opcua": "OPC UA"}


def _weather_source(ctx: service.Ctx) -> list[dict]:
    src = service.weather_sources()
    fa = src.get("fetched_at")
    errs = src.get("errors") or {}
    kma = fmt_kma_base((src.get("kma_forecast") or {}).get("base"))
    now_c = src.get("kma_nowcast") or {}
    out = [
        _src("forecast", "기상청 단기예보", "live", f"{kma} 발표" if kma else "발표 정보 없음 (Open-Meteo 예보로 대체)",
             "ok" if kma else "stale", fa),
        _src("weather", "Open-Meteo 실측·예보", "live", "시간별 기온·습도·일사", "stale" if "archive" in errs else "ok", fa),
    ]
    if now_c:
        out.append(_src("nowcast", "기상청 초단기실황", "live", f"{now_c.get('t', '–')}℃ · 습도 {now_c.get('rh', '–')}%", "ok", fa))
    return out


def _bms_source() -> dict:
    prof = get_store().get_item("meta", "building_profile") or {}
    conn = prof.get("connection") or {}
    n_idu = sum(len(r["idus"]) for r in config.ROOMS.values())
    det = f"실내기 {n_idu}대 · 실외기 {len(config.ODUS)}대"
    if conn.get("host"):
        det = f"{PROTO_LABEL.get(conn.get('protocol'), conn.get('protocol') or '')} {conn['host']}:{conn.get('port')} · " + det
    return _src("bms", "중앙제어기 (게이트웨이 연결)", "simulated", det + " (데모: 시뮬레이터)", "ok", conn.get("connected_at"))


def _sensor_sources(n_feedback: int) -> list[dict]:
    return [
        _src("sensor", "실내 온도 센서 (실내기)", "simulated", "강의실별 5분 간격, 열모델 시뮬레이터"),
        _src("co2", "CO₂ 센서", "simulated", "재실 인원·환기 단계로 계산한 15분 간격 농도"),
        _src("density", "재실 밀도 (Wi-Fi 접속 수)", "simulated", "무단 공강·조기 종료 포함 실제 재실"),
        _src("feedback", "쾌적 의견 (재실자·관리자)", "input", f"최근 의견 {n_feedback}건"),
    ]


def _today() -> date:
    return service.now_kst().date()


def _dates_in(start: date, end: date) -> list[date]:
    s0, s1 = service.semester_range()
    out = []
    d = max(start, s0)
    while d <= min(end, s1):
        out.append(d)
        d += timedelta(days=1)
    return out


def _src_kind(d: date) -> str:
    t = _today()
    if d < t:
        return "actual"
    if d <= t + timedelta(days=7):
        return "forecast"
    return "climatology"


def _day_row(d: date, sm: dict, ctx: service.Ctx) -> dict:
    ai = sm["strategies"].get("ai", {})
    fx = sm["strategies"].get("fixed", {})
    return {"date": d.isoformat(), "weekday": d.weekday(), "workday": sm["workday"], "holiday": sm["holiday"],
            "sessions": sm["sessions"], "events": sm["events"], "kwh": round(ai.get("kwh", 0.0), 1),
            "baseline_kwh": round(fx.get("kwh", 0.0), 1), "on_hours": round(ai.get("on_minutes", 0) / 60.0, 1),
            "t_mean": sm["t_mean"], "t_min": sm["t_min"], "t_max": sm["t_max"], "src": _src_kind(d),
            "adjusted": bool(service.room_setpoints(d, ctx))}


def _summaries(dates: list[date], ctx: service.Ctx) -> list[dict]:
    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(lambda d: service.get_day_summary(d, ctx), dates))


def _sum_pct(rows: list[dict]) -> tuple[float, float, float | None]:
    kwh = sum(r["kwh"] for r in rows)
    base = sum(r["baseline_kwh"] for r in rows)
    return round(kwh, 1), round(base, 1), (round(100.0 * (base - kwh) / base, 1) if base > 0 else None)


def _comfort(sms: list[dict]) -> float | None:
    num = den = 0.0
    for x in sms:
        v = x["strategies"].get("ai", {})
        if v.get("comfort_pct") is not None:
            num += v["comfort_pct"] * x["sessions"]
            den += x["sessions"]
    return round(num / den, 2) if den else None


def _base_sp(d: date, r: str, ctx: service.Ctx) -> tuple[float, float]:
    rs = service.room_setpoints(d, ctx).get(r, {})
    return float(rs.get("sp_heat", ctx.settings["sp_heat"])), float(rs.get("sp_cool", ctx.settings["sp_cool"]))


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _fb_by_room(items: list[dict]) -> dict:
    """Thermal votes per room. Votes tagged 'stuffy' are an air-quality signal (ventilation), not a
    temperature one, so they are counted separately and left out of the setpoint statistics."""
    out: dict = {}
    for f in items:
        b = out.setdefault(f["room"], {"n": 0, "sum": 0, "cold": 0, "hot": 0, "stuffy": 0})
        if "stuffy" in f["tags"]:
            b["stuffy"] += 1
            continue
        b["n"] += 1
        b["sum"] += f["vote"]
        b["cold"] += f["vote"] <= -1
        b["hot"] += f["vote"] >= 1
    for b in out.values():
        b["mean"] = round(b["sum"] / b["n"], 2) if b["n"] else 0.0
    return out


def _rooms_with_classes(dates: list[date], ctx: service.Ctx) -> set:
    return {s["room"] for d in dates for s in sessions_for_date(d, ctx.courses, ctx.events)}


def _covered(room: str, d: date, kind: str, tier: int, items: list[dict]) -> bool:
    """An open or applied proposal of a broader tier already covers this room and date."""
    iso = d.isoformat()
    return any(a.get("kind") == kind and a.get("tier", 9) < tier and a.get("status") in ("pending", "applied")
               and room in a.get("rooms", []) and a["date_from"] <= iso <= a["date_to"]
               for a in items)


def _feedback_proposals(tier: int, dates: list[date], fb: dict, ctx: service.Ctx, pol: dict, season: str,
                        min_n: int, period_key: str, top: int = 3) -> tuple[list[dict], list[str]]:
    """Rooms whose occupants keep saying 'cold' or 'hot' → one setpoint step inside the policy range."""
    fut = [d for d in dates if d >= _today()]
    props, notes = [], []
    if not fut:
        return props, notes
    busy = _rooms_with_classes(fut, ctx)
    items = get_store().list_items("adjustment")
    covered = sorted(r for r in fb if r in busy and _covered(r, fut[0], "setpoint", tier, items))
    if covered:
        notes.append(f"{', '.join(covered)}호는 2차(주간) 조정안이 이미 있어 그 안으로 반영합니다")
    fb = {r: b for r, b in fb.items() if r in busy and r not in covered}
    ranked = sorted(fb.items(), key=lambda kv: -(max(kv[1]["cold"], kv[1]["hot"]) * 10 + abs(kv[1]["mean"])))
    fb = dict(ranked[:top])
    key = "sp_heat" if season == "heat" else "sp_cool"
    lo, hi = (pol["heat_min"], pol["heat_max"]) if season == "heat" else (pol["cool_min"], pol["cool_max"])
    for r, b in sorted(fb.items()):
        if r not in config.ROOMS or b["n"] < min_n:
            continue
        cold = b["cold"] >= min_n and b["mean"] <= -0.8
        hot = b["hot"] >= min_n and b["mean"] >= 0.8
        if not (cold or hot):
            continue
        cur = _base_sp(fut[0], r, ctx)[0 if season == "heat" else 1]
        step = 0.5 if cold else -0.5
        new = _clamp(round(cur + step, 1), lo, hi)
        if new == cur:
            notes.append(f"{r}호는 이미 정책 {'상한' if cold else '하한'}({cur:.1f}℃)이라 설정온도 대신 송풍·환기를 점검합니다")
            continue
        props.append({"room": r, key: new, "cur": cur, "cold": cold, "n": b["n"], "mean": b["mean"]})
    adjs = []
    if not props:
        return adjs, notes
    base = evaluate(fut, ctx)
    extra = {p["room"]: {key: p[key]} for p in props}
    after = evaluate(fut, ctx, extra)
    for p in props:
        r = p["room"]
        b0, b1 = base["rooms"].get(r, {}), after["rooms"].get(r, {})
        dk = round(b1.get("kwh", 0) - b0.get("kwh", 0), 2)
        rate = (after["cost_krw"] - base["cost_krw"]) / (after["kwh"] - base["kwh"]) if abs(after["kwh"] - base["kwh"]) > 0.01 else 110.0
        word = "춥다" if p["cold"] else "덥다"
        label = "난방" if season == "heat" else "냉방"
        auto_ok = p["n"] >= 3
        adjs.append({
            "id": f"T{tier}-{period_key}-fb-{r}",
            "tier": tier, "origin": "feedback", "kind": "setpoint", "auto_ok": auto_ok,
            "title": f"{r}호 {label} 설정온도 {p['cur']:.1f}℃ → {p[key]:.1f}℃",
            "reason": f"최근 의견 {p['n']}건(평균 {p['mean']:+.1f}, '{word}' 위주)을 반영해 정책 범위({lo:.0f}~{hi:.0f}℃) 안에서 한 단계 조정합니다."
                      + ("" if auto_ok else " 의견이 3건 미만이라 자동 운전 모드에서도 담당자 승인을 기다립니다."),
            "rooms": [r], "date_from": fut[0].isoformat(), "date_to": fut[-1].isoformat(),
            "change": {key: p[key]},
            "impact": {"kwh": dk, "cost_krw": round(dk * rate), "pmv_before": b0.get("pmv"), "pmv_after": b1.get("pmv"),
                       "note": f"{len(fut)}일 AI 운전 재시뮬레이션"},
            "evidence": [{"source": "feedback", "text": f"{r}호 의견 {p['n']}건, 평균 {p['mean']:+.1f}"},
                         {"source": "simulator", "text": f"체감(PMV) {b0.get('pmv')} → {b1.get('pmv')}, 전력 {dk:+.2f} kWh"},
                         {"source": "policy", "text": f"{label} 허용 범위 {lo:.0f}~{hi:.0f}℃"}],
        })
    return adjs, notes


def _vent_proposals(tier: int, dates: list[date], ctx: service.Ctx, pol: dict, period_key: str) -> tuple[list[dict], dict]:
    """CO2-based ventilation: rooms that need the strong ERV level, and rooms that can run on the weak one."""
    fut = [d for d in dates if d >= _today()]
    agg: dict = {}
    items = get_store().list_items("adjustment")
    for d in fut:
        day = service.get_day(d, ctx)
        vp = vent_plan(day, pol)
        to = sum(day["weather"]["forecast"]["t"][9:18]) / 9.0
        for r, v in vp.items():
            if not v["blocks"] or _covered(r, d, "vent", tier, items):
                continue
            a = agg.setdefault(r, {"levels": set(), "peak": 0, "kwh": 0.0, "people": 0, "n": 0, "titles": set()})
            sp_h, sp_c = _base_sp(d, r, ctx)
            for b in v["blocks"]:
                a["levels"].add(b["level"])
                a["peak"] = max(a["peak"], b["ppm"])
                a["people"] = max(a["people"], b["people"])
                a["n"] += 1
                if b["level"] == "high":
                    a["titles"].add(f"{b['title']}({b['people']}명)")
                tin = sp_h if to < sp_h else sp_c
                a["kwh"] += vent_kwh_delta(config.ROOMS[r], b["level"], b["people"], b["e"] - b["s"], tin, to)
    adjs = []
    if not fut:
        return adjs, agg
    for r, a in sorted(agg.items()):
        lv = "high" if "high" in a["levels"] else ("low" if a["levels"] == {"low"} else None)
        if not lv:
            continue
        kwh = round(a["kwh"], 2)
        if lv == "high":
            title = f"{r}호 환기 강 단계 (예상 최고 {a['peak']:.0f}ppm)"
            reason = (f"예상 인원이 많은 수업({', '.join(sorted(a['titles'])[:2])})은 중 단계로는 CO₂ {pol['co2_max']}ppm을 넘습니다. "
                      "수업 10분 전부터 강 단계로 환기합니다.")
        else:
            title = f"{r}호 환기 약 단계 (예상 최고 {a['peak']:.0f}ppm)"
            reason = f"예상 인원이 적어(최대 {a['people']}명) 약 단계로도 CO₂ 기준을 지킵니다. 환기 손실을 줄입니다."
        adjs.append({
            "id": f"T{tier}-{period_key}-vent-{r}", "tier": tier, "origin": "tier", "kind": "vent", "title": title,
            "reason": reason, "rooms": [r], "date_from": fut[0].isoformat(), "date_to": fut[-1].isoformat(),
            "change": {"vent": lv},
            "impact": {"kwh": kwh, "cost_krw": round(kwh * 110), "note": "환기 열손실 추정(전열교환 60%, COP 3), 열모델 밖 계산"},
            "evidence": [{"source": "timetable", "text": f"수업 {a['n']}회, 최대 예상 인원 {a['people']}명"},
                         {"source": "co2", "text": f"예상 최고 {a['peak']:.0f}ppm (기준 {pol['co2_max']}ppm)"}],
        })
    return adjs, agg


def _sync(adjs: list[dict]) -> list[dict]:
    return [upsert_proposal(a) for a in adjs]


def _sentence_pct(p):
    return f"{p:.1f}%" if p is not None else "–"


# ---------------------------------------------------------------- tier 1: monthly base plan

def tier1(anchor: date) -> dict:
    ctx = service.Ctx()
    pol = policy()
    first = anchor.replace(day=1)
    last = anchor.replace(day=calendar.monthrange(anchor.year, anchor.month)[1])
    dates = _dates_in(first, last)
    sms = _summaries(dates, ctx)
    rows = [_day_row(d, sm, ctx) for d, sm in zip(dates, sms)]
    kwh, base, pct = _sum_pct(rows)
    cost = sum(sm["strategies"]["ai"]["cost_krw"] for sm in sms)
    sessions = sum(r["sessions"] for r in rows)
    dec: dict = {}
    for sm in sms:
        for k, v in (sm.get("decisions") or {}).items():
            dec[k] = dec.get(k, 0) + v
    holidays = [(d, n) for d, n in config.HOLIDAYS.items() if first <= d <= last]
    peak = max((sm["strategies"]["ai"]["peak_kw"] for sm in sms), default=0)
    odu_cap = sum(o["cap_kw"] for o in config.ODUS.values())
    over = [c for c in ctx.courses if c["expected_people"] > config.ROOMS[c["room"]]["capacity"]]
    est = sum(1 for c in ctx.courses if c.get("people_estimated"))
    cov = [sm.get("plan_coverage") for sm in sms if sm.get("plan_coverage") is not None and sm["sessions"]]
    coverage = round(sum(cov) / len(cov), 1) if cov else None
    sp_ok = pol["heat_min"] <= ctx.settings["sp_heat"] <= pol["heat_max"] and pol["cool_min"] <= ctx.settings["sp_cool"] <= pol["cool_max"]
    fb = feedback_summary(14)["by_room"]
    ghi = [0.0] * 24
    for d in dates:
        w = ctx.wx.get(d.isoformat())
        if w:
            for h in range(24):
                ghi[h] += w["forecast"]["ghi"][h] / max(len(dates), 1)
    high_courses = [c for c in ctx.courses if vent_level_for(config.ROOMS[c["room"]], c["expected_people"], pol["co2_max"])[0] == "high"]

    rooms = []
    for r, room in config.ROOMS.items():
        cs = [c for c in ctx.courses if c["room"] == r]
        week: dict = {}
        for c in cs:
            week.setdefault(c["weekday"], []).append({"s": hm_to_min(c["start"]), "e": hm_to_min(c["end"]), "kind": "lecture",
                                                      "label": c["class_name"]})
        peak_c = max((vent_level_for(room, c["expected_people"], pol["co2_max"])[1] for c in cs), default=None)
        lv = max((vent_level_for(room, c["expected_people"], pol["co2_max"])[0] for c in cs),
                 key=lambda x: ("low", "mid", "high").index(x), default="mid")
        f = fb.get(r) or {}
        rooms.append({"room": r, "type": room["type_label"], "orient": pol["orient"].get(r, "남"), "sessions": len(cs),
                      "people": sum(c["expected_people"] for c in cs), "kwh": 0.0, "sp_heat": ctx.settings["sp_heat"],
                      "sp_cool": ctx.settings["sp_cool"], "co2_peak": round(peak_c) if peak_c else None, "vent": lv,
                      "feedback": {"n": f.get("n", 0), "mean": f.get("mean")},
                      "solar_index": solar_kw(room, pol["orient"].get(r, "남"), ghi), "week": week})

    checks = [
        _check("t1-timetable", "시간표 반영", ["timetable", "simulator"],
               f"시간표 강의 {len(ctx.courses)}개를 요일별로 펼쳐 이번 달 수업 {sessions}회",
               f"운전 계획이 수업을 덮는 비율 {coverage}%" if coverage is not None else "아직 지난 날짜가 없어 계획만 확인",
               "ok" if coverage is None or coverage >= 99 else "review",
               "모든 수업에 시작 전 예열·예냉과 종료 전 정지가 들어간 계획을 만들었습니다.", idea=1),
        _check("t1-calendar", "학사일정·공휴일", ["calendar"],
               "공휴일·휴관일에는 운전하지 않음",
               (", ".join(f"{d.month}/{d.day} {n}" for d, n in holidays) or "이번 달 공휴일 없음"),
               "ok", "공휴일은 수업을 만들지 않아 운전 계획이 비어 있습니다. 특일정보 API 승인 전이라 설정값으로 관리합니다."),
        _check("t1-capacity", "정원과 예상 인원", ["timetable", "bms"],
               "예상 인원이 강의실 정원 이하",
               f"정원 초과 {len(over)}개 · 수강 인원이 없어 출석률 {pol['attendance'] * 100:.0f}%로 추정한 강의 {est}개",
               "review" if over else "ok",
               "정원 초과 강의는 재배치 권고를 확인하세요." if over else "예상 인원은 정원 안에 있습니다. 추정값은 2차에서 재실 데이터로 보정합니다."),
        _check("t1-odu", "실외기 동시 기동 용량", ["bms", "simulator"],
               f"실외기 합계 용량 {odu_cap:.0f} kW 이내",
               f"이번 달 최대 15분 평균 전력 {peak:.1f} kW",
               "ok" if peak <= odu_cap else "review",
               "동시 기동 때는 실외기 용량을 나눠 쓴다고 보고 예열 시간을 늘려 계산했습니다."),
        _check("t1-policy", "정책 온도 범위", ["policy"],
               f"난방 {pol['heat_min']:.0f}~{pol['heat_max']:.0f}℃, 냉방 {pol['cool_min']:.0f}~{pol['cool_max']:.0f}℃",
               f"기본 설정 난방 {ctx.settings['sp_heat']:.1f}℃, 냉방 {ctx.settings['sp_cool']:.1f}℃",
               "ok" if sp_ok else "review", "기본 설정온도가 정책 범위 안에 있습니다." if sp_ok else "운영 규칙의 설정온도를 정책 범위로 옮기세요."),
        _check("t1-preheat", "기상 예보 기반 예열·예냉", ["weather", "forecast", "simulator"],
               "수업 시작 시각에 설정온도 도달",
               f"최적 기동 {dec.get('optimal_start', 0)}회, 늦은 기동 {dec.get('late_start', 0)}회, 가동 생략 {dec.get('skip', 0)}회, 외기 냉방 {dec.get('economizer', 0)}회",
               "ok", "지난 날짜는 실측, 7일 안은 예보, 그 뒤는 평년 기후로 예열 시작 시각을 정했습니다. 2·3차에서 새 예보로 다시 계산합니다.", idea=11),
        _check("t1-co2", "CO₂ 기반 환기 계획", ["timetable", "co2"],
               f"수업 중 CO₂ {pol['co2_max']}ppm 이하",
               f"강 단계가 필요한 강의 {len(high_courses)}개 / 전체 {len(ctx.courses)}개",
               "ok", "예상 인원으로 강의마다 환기 단계(약·중·강)를 정했습니다. 2차에서 실제 재실로 다시 맞춥니다.", idea=13),
        _check("t1-cost", "월 예상 요금", ["tariff", "simulator"],
               f"현재 운영(고정 08:30~22:30) {base:,.0f} kWh",
               f"AI 계획 {kwh:,.0f} kWh · {cost:,.0f}원", "ok",
               f"한전 교육용(을) 시간대별 요금으로 계산했습니다. 현재 운영 대비 {_sentence_pct(pct)} 절감 예상입니다."),
    ]
    n_wx = sum(1 for d in dates if _src_kind(d) == "climatology")
    sources = [
        _src("timetable", "학사 시스템 강의 시간표", "input", f"강의 {len(ctx.courses)}개 · 강의실 {len(config.ROOMS)}개"),
        _src("calendar", "학사일정·공휴일", "assumption", f"공휴일 {len(config.HOLIDAYS)}일 (특일정보 API 미승인, 설정값)"),
        *_weather_source(ctx),
        _src("climatology", "평년 기후", "live", f"예보 범위 밖 {n_wx}일은 평년값" if n_wx else "이번 달은 실측·예보로 충분"),
        _bms_source(),
        _src("tariff", "한전 교육용(을) 요금", "input", "2023-05-16 게시 시간대별 요금"),
        _src("policy", "운영 정책", "input", f"난방 {pol['heat_min']:.0f}~{pol['heat_max']:.0f}℃ · 냉방 {pol['cool_min']:.0f}~{pol['cool_max']:.0f}℃ · CO₂ {pol['co2_max']}ppm"),
    ]
    sentence = (f"{anchor.month}월 수업 {sessions}회를 시간표·학사일정·날씨로 계획했습니다. "
                f"AI 운전은 현재 운영보다 {_sentence_pct(pct)} 적은 {kwh:,.0f} kWh를 예상합니다.")
    return {"tier": 1, "label": "1차 · 월간 기본 계획",
            "period": {"start": first.isoformat(), "end": last.isoformat(), "label": f"{anchor.year}년 {anchor.month}월"},
            "generated_at": service.now_kst().isoformat(timespec="seconds"), "mode": mode()["mode"],
            "summary": {"sentence": sentence, "kwh": kwh, "baseline_kwh": base, "cost_krw": cost, "saving_pct": pct,
                        "sessions": sessions, "comfort_pct": _comfort(sms)},
            "sources": sources, "checks": checks, "adjustments": [], "days": rows, "rooms": rooms}


# ---------------------------------------------------------------- tier 2: weekly adjustment

def tier2(anchor: date) -> dict:
    ctx = service.Ctx()
    pol = policy()
    mon = anchor - timedelta(days=anchor.weekday())
    week = [mon + timedelta(days=i) for i in range(7)]
    dates = _dates_in(week[0], week[-1])
    if not dates:
        raise ValueError("학기 기간 밖의 주입니다.")
    sms = _summaries(dates, ctx)
    rows = [_day_row(d, sm, ctx) for d, sm in zip(dates, sms)]
    kwh, base, pct = _sum_pct(rows)
    cost = sum(sm["strategies"]["ai"]["cost_krw"] for sm in sms)
    sessions = sum(r["sessions"] for r in rows)
    season = season_for(dates, ctx)
    pkey = mon.isoformat()
    today = _today()

    # feedback over the last 7 days before the week's remaining days
    fb_items = feedback_items(7, until=min(max(today, dates[0]), dates[-1]))
    fb = _fb_by_room(fb_items)
    fb_adjs, fb_notes = _feedback_proposals(2, dates, fb, ctx, pol, season, 3, pkey)
    vent_adjs, vent_agg = _vent_proposals(2, dates, ctx, pol, pkey)
    adjs = _sync(fb_adjs + vent_adjs)

    days = {d: service.get_day(d, ctx) for d in dates}
    # forecast vs the previous week's actual weather
    prev = _dates_in(mon - timedelta(days=7), mon - timedelta(days=1))
    t_this = [sum(ctx.wx[d.isoformat()]["forecast"]["t"][8:20]) / 12.0 for d in dates if d.isoformat() in ctx.wx]
    t_prev = [sum(ctx.wx[d.isoformat()]["actual"]["t"][8:20]) / 12.0 for d in prev if d.isoformat() in ctx.wx]
    dt = (sum(t_this) / len(t_this) - sum(t_prev) / len(t_prev)) if t_this and t_prev else 0.0

    def leads(ds):
        ls = []
        for d in ds:
            try:
                dd = days.get(d) or service.get_day(d, ctx)
            except Exception:
                continue
            ls += [x.get("lead_min", 0) for x in dd["decisions"] if x["type"] == "optimal_start"]
        return round(sum(ls) / len(ls)) if ls else None

    lead_this, lead_prev = leads(dates), leads(prev)
    # occupancy: unannounced no-shows and early dismissals seen by the occupancy feed
    ns = ed = 0
    for d in dates:
        if d > today:
            continue
        for evs in days[d].get("scenario", {}).values():
            ns += sum(1 for e in evs if e["type"] == "no_show")
            ed += sum(1 for e in evs if e["type"] == "early_dismiss")
    early = [x for d in dates for x in days[d]["decisions"] if x["type"] == "early_stop"]
    events_wk = [e for e in ctx.events if dates[0].isoformat() <= e.get("date", "") <= dates[-1].isoformat()]

    rooms = []
    ghi = [sum(ctx.wx[d.isoformat()]["forecast"]["ghi"][h] for d in dates) / len(dates) for h in range(24)]
    fb14 = feedback_summary(7)["by_room"]
    for r, room in config.ROOMS.items():
        ss = [s for d in dates for s in days[d]["sessions"] if s["room"] == r]
        rk = sum(days[d]["strategies"]["ai"]["rooms"][r]["kwh"] for d in dates)
        sp = _base_sp(dates[-1], r, ctx)
        va = vent_agg.get(r) or {}
        lv = "high" if "high" in va.get("levels", set()) else ("low" if va.get("levels") == {"low"} else "mid")
        f = fb14.get(r) or {}
        rooms.append({"room": r, "type": room["type_label"], "orient": pol["orient"].get(r, "남"), "sessions": len(ss),
                      "people": round(sum(s["expected_people"] for s in ss) / len(ss)) if ss else 0, "kwh": round(rk, 1),
                      "sp_heat": sp[0], "sp_cool": sp[1], "co2_peak": va.get("peak") or None, "vent": lv,
                      "feedback": {"n": f.get("n", 0), "mean": f.get("mean")},
                      "solar_index": solar_kw(room, pol["orient"].get(r, "남"), ghi)})
    sunny = sorted([x for x in rooms if x["solar_index"] >= 0.6], key=lambda x: -x["solar_index"])
    fb_rooms = [a["rooms"][0] for a in fb_adjs]
    checks = [
        _check("t2-events", "행사·보강·휴강 반영", ["events", "timetable"],
               "시간표 밖 일정까지 계획에 포함",
               f"이번 주 등록 일정 {len(events_wk)}건" + (f" ({', '.join(e.get('title') or e['type'] for e in events_wk[:3])})" if events_wk else ""),
               "ok", "등록된 일정은 그날 계획에 바로 들어가고, 바뀐 날짜만 다시 계산합니다.", idea=5),
        _check("t2-weather", "주간 예보와 지난주 비교", ["forecast", "weather", "simulator"],
               f"지난주 낮 평균 {sum(t_prev) / len(t_prev):.1f}℃ 기준 계획" if t_prev else "지난주 실측 없음",
               f"이번 주 예보 낮 평균 {sum(t_this) / len(t_this):.1f}℃ ({dt:+.1f}℃)" if t_this else "예보 없음",
               "adjust" if abs(dt) >= pol["weather_jump_c"] else "ok",
               (f"새 예보로 예열 시작을 다시 계산했습니다(이번 주 최적 기동 평균 {lead_this}분 전)." if lead_this is not None
                else "새 예보로 예열 시작을 다시 계산했습니다."), idea=11),
        _check("t2-feedback", "쾌적 의견 패턴", ["feedback", "simulator", "policy"],
               "같은 강의실에서 '춥다/덥다'가 반복되지 않음",
               (f"최근 7일 의견 {len(fb_items)}건, 반복 강의실 {', '.join(fb_rooms)}" if fb_rooms else f"최근 7일 의견 {len(fb_items)}건, 반복되는 강의실 없음"),
               "adjust" if fb_adjs else "ok",
               ("의견이 반복된 강의실의 설정온도를 정책 범위 안에서 한 단계 조정하는 안을 만들었습니다." if fb_adjs else "조정할 강의실이 없습니다.")
               + (" " + "; ".join(fb_notes) if fb_notes else ""), rooms=fb_rooms),
        _check("t2-occupancy", "재실 밀도 추세", ["density", "occupancy"],
               "예상 인원대로 출석",
               f"이번 주 무단 공강 {ns}회 · 조기 종료 {ed}회 감지",
               "ok", "재실이 없으면 10분 뒤 자동 정지하고, 조기 종료는 관성으로 마무리합니다. 반복되면 예상 인원을 낮춥니다."),
        _check("t2-co2", "CO₂ 기반 환기 계획", ["co2", "timetable", "density"],
               f"수업 중 CO₂ {pol['co2_max']}ppm 이하",
               f"강 단계 필요 {sum(1 for a in vent_adjs if a['change']['vent'] == 'high')}개 실, 약 단계로 충분 {sum(1 for a in vent_adjs if a['change']['vent'] == 'low')}개 실",
               "adjust" if vent_adjs else "ok", "예상 인원으로 환기 단계를 정해 중앙제어기에 보냅니다.", idea=13,
               rooms=[a["rooms"][0] for a in vent_adjs]),
        _check("t2-solar", "일사량·방향", ["forecast", "policy"],
               "방향별 오후 일사 부하 반영",
               ("오후 일사가 큰 강의실: " + ", ".join(f"{x['room']}({x['orient']}향 {x['solar_index']:.1f} kW)" for x in sunny[:4])) if sunny else "이번 주는 흐려 일사 영향이 작습니다",
               "ok",
               ("난방철이라 남·서향 강의실의 오후 일사는 난방을 줄여 줍니다. 오후 수업은 관성 정지 여유가 커집니다." if season == "heat"
                else "냉방철이라 서향 강의실은 오후 수업 전 예냉을 앞당깁니다."), idea=12, rooms=[x["room"] for x in sunny[:4]]),
        _check("t2-coast", "잔열·잔냉 활용", ["simulator", "sensor"],
               "수업 종료 전 정지해도 쾌적 유지",
               f"이번 주 관성 정지 {len(early)}회",
               "ok", "종료 전 정지 후에도 실내가 쾌적 범위에 머무는 수업만 일찍 끕니다.", idea=14),
    ]
    sources = [
        _src("events", "행사·예약 일정", "input", f"이번 주 {len(events_wk)}건"),
        *_weather_source(ctx),
        *_sensor_sources(len(fb_items)),
        _src("timetable", "학사 시스템 강의 시간표", "input", f"강의 {len(ctx.courses)}개"),
        _bms_source(),
    ]
    applied = sum(1 for a in adjs if a["status"] == "applied")
    pending = sum(1 for a in adjs if a["status"] == "pending")
    live_n = applied + pending
    sentence = (f"{mon.month}/{mon.day} 주간 수업 {sessions}회를 새 예보·의견·재실·CO₂로 다시 맞췄습니다. "
                + (f"조정안 {live_n}건(적용 {applied}, 승인 대기 {pending}), " if live_n else "")
                + f"AI 운전은 현재 운영보다 {_sentence_pct(pct)} 적게 씁니다.")
    return {"tier": 2, "label": "2차 · 주간 조정",
            "period": {"start": week[0].isoformat(), "end": week[-1].isoformat(), "label": f"{mon.month}/{mon.day}~{week[-1].month}/{week[-1].day}"},
            "generated_at": service.now_kst().isoformat(timespec="seconds"), "mode": mode()["mode"],
            "summary": {"sentence": sentence, "kwh": kwh, "baseline_kwh": base, "cost_krw": cost, "saving_pct": pct,
                        "sessions": sessions, "comfort_pct": _comfort(sms)},
            "sources": sources, "checks": checks, "adjustments": adjs, "days": rows, "rooms": rooms}


# ---------------------------------------------------------------- tier 3: daily verification

def tier3(d: date) -> dict:
    ctx = service.Ctx()
    pol = policy()
    now = service.effective_now(ctx)
    day = service.get_day(d, ctx)
    sm = engine.summarize_day(day)
    season = season_for([d], ctx)
    today = _today()
    if d.isoformat() == now["date"]:
        now_min = now["minute"]
    elif d < today:
        now_min = 1440
    else:
        now_min = None
    hcur = min((now_min or 0) // 60, 23)
    wf, wa = day["weather"]["forecast"], day["weather"]["actual"]
    t_actual = [wa["t"][h] if now_min is not None and h <= hcur else None for h in range(24)]
    # weather jump: plan forecast vs observed so far (operating hours)
    obs_h = [h for h in range(7, 23) if t_actual[h] is not None]
    dev = [(h, wa["t"][h] - wf["t"][h]) for h in obs_h]
    worst = max(dev, key=lambda x: abs(x[1]), default=(None, 0.0))
    jump = abs(worst[1]) >= pol["weather_jump_c"]
    recalc_txt = ""
    if jump:
        # recompute the AI plan as if the observed weather had been the forecast
        wx2 = {**ctx.wx, d.isoformat(): {**ctx.wx[d.isoformat()], "forecast": ctx.wx[d.isoformat()]["actual"]}}
        alt = engine.compute_day(d, ctx.courses, ctx.events, wx2, service.day_settings(d, ctx), detail=False, strategies=("ai",))
        a0 = {x["session"]: x.get("lead_min", 0) for x in day["decisions"] if x["type"] == "optimal_start"}
        a1 = {x["session"]: (x.get("lead_min", 0), x["room"], x["start"]) for x in alt["decisions"] if x["type"] == "optimal_start"}
        changed = [(k, a0.get(k, 0), v) for k, v in a1.items() if abs(v[0] - a0.get(k, 0)) >= 3
                   and (now_min is None or hm_to_min(v[2]) > now_min)]
        if changed:
            k, old, (new, room, st) = changed[0]
            recalc_txt = f" 남은 수업 {len(changed)}개의 예열 시작을 다시 계산했습니다(예: {room}호 {st} 수업 {old}분 → {new}분 전)."
        else:
            recalc_txt = " 남은 수업의 예열 시작은 그대로 충분합니다."

    occ = _occupancy(day)
    vp = vent_plan(day, pol)
    co2, people, rooms = {}, {}, []
    fb_today_items = feedback_items(2) if d >= today else feedback_items(1, until=d)
    fb_today = _fb_by_room(fb_today_items)
    ai = day["strategies"]["ai"]
    for r, room in config.ROOMS.items():
        blocks = vp[r]["blocks"]

        def level_at(m, blocks=blocks):
            for b in blocks:
                if b["s"] <= m < b["e"]:
                    return b["level"]
            return "mid"

        co2[r] = co2_series(room, occ[r], level_at)
        people[r] = [round(sum(occ[r][k:k + 15]) / 15.0, 1) for k in range(0, 1440, 15)]
        sp = _base_sp(d, r, ctx)
        rr = ai["rooms"][r]
        k5 = min((now_min or 0) // 5, len(rr["ta"]) - 1)
        lect = [{"s": hm_to_min(s["start"]), "e": hm_to_min(s["end"]), "kind": s["kind"], "label": s["title"]}
                for s in day["sessions"] if s["room"] == r]
        wins = [{"s": iv["s"], "e": iv["e"], "kind": iv.get("kind", "cond"), "label": iv.get("reason", "")} for iv in ai["plan"].get(r, [])]
        f = fb_today.get(r) or {}
        rooms.append({"room": r, "type": room["type_label"], "orient": pol["orient"].get(r, "남"), "sessions": len(lect),
                      "people": max((s["expected_people"] for s in day["sessions"] if s["room"] == r), default=0),
                      "kwh": round(rr["kwh"], 2), "sp_heat": sp[0], "sp_cool": sp[1],
                      "co2_peak": max(co2[r]) if lect else None, "vent": vp[r]["level"],
                      "feedback": {"n": f.get("n", 0), "mean": f.get("mean")},
                      "solar_index": solar_kw(room, pol["orient"].get(r, "남"), wa["ghi"]),
                      "ta_now": rr["ta"][k5] if now_min is not None else None, "windows": wins, "lectures": lect})

    pkey = d.isoformat()
    fb_adjs, fb_notes = _feedback_proposals(3, [d], dict(fb_today), ctx, pol, season, 1, pkey, top=4) if d >= today else ([], [])
    vent_adjs = [a for a in _vent_proposals(3, [d], ctx, pol, pkey)[0] if a["change"]["vent"] == "high"] if d >= today else []
    adjs = _sync(fb_adjs + vent_adjs)

    val = day["validation"]
    occupied_now = [x for x in rooms if now_min is not None and any(l["s"] <= now_min < l["e"] for l in x["lectures"])]
    off_band = [x for x in occupied_now if x["ta_now"] is not None and not (ctx.settings["comfort_low"] <= x["ta_now"] <= ctx.settings["comfort_high"])]
    co2_now = {x["room"]: co2[x["room"]][min((now_min or 0) // 15, 95)] for x in rooms} if now_min is not None else {}
    co2_hi = [r for r, v in co2_now.items() if v > pol["co2_max"]]
    co2_peak_hi = sorted([x for x in rooms if (x["co2_peak"] or 0) > pol["co2_max"]], key=lambda x: -(x["co2_peak"] or 0))
    starts = [x for x in day["decisions"] if x["type"] == "optimal_start"]
    early = [x for x in day["decisions"] if x["type"] == "early_stop"]
    vac = [s for s in val["sessions"] if s["status"] == "vacancy"] if val.get("sessions") else []
    scen = [e for evs in day.get("scenario", {}).values() for e in evs if e["type"] in ("no_show", "early_dismiss")]
    tomorrow = d + timedelta(days=1)
    tmw_txt = ""
    if tomorrow.isoformat() in ctx.wx:
        tw = ctx.wx[tomorrow.isoformat()]["forecast"]
        tmw_txt = f" 내일은 최저 {min(tw['t']):.1f}℃ · 최고 {max(tw['t']):.1f}℃ 예보로 내일 계획을 미리 만들어 두었습니다."
    sunny = sorted([x for x in rooms if x["solar_index"] >= 0.6 and x["lectures"]], key=lambda x: -x["solar_index"])
    events_today = [s for s in day["sessions"] if s["kind"] == "event"]

    checks = [
        _check("t3-weather", "날씨 급변 대응", ["nowcast", "forecast", "simulator"],
               f"계획에 쓴 예보 {wf['t'][worst[0]]:.1f}℃ ({worst[0]}시)" if worst[0] is not None else "계획에 쓴 예보",
               (f"실황 {wa['t'][worst[0]]:.1f}℃, 편차 {worst[1]:+.1f}℃" if worst[0] is not None else "아직 관측 전"),
               "adjust" if jump else "ok",
               (f"편차가 기준({pol['weather_jump_c']:.1f}℃) 이상이라 재계산했습니다." + recalc_txt) if jump
               else f"예보와 실황 차이가 기준({pol['weather_jump_c']:.1f}℃) 안이라 계획을 유지합니다.", idea=15),
        _check("t3-preheat", "예보 기반 예열·예냉", ["forecast", "simulator"],
               "첫 수업 시작 시 설정온도 도달",
               (f"오늘 최적 기동 {len(starts)}회, 평균 선행 {round(sum(x.get('lead_min', 0) for x in starts) / len(starts))}분" if starts else "오늘은 예열이 필요 없는 날입니다"),
               "ok", "열모델과 예보로 강의실마다 켜는 시각을 정했습니다." + tmw_txt, idea=11),
        _check("t3-schedule", "일정 정합", ["timetable", "events", "simulator"],
               f"오늘 수업 {sm['sessions']}회" + (f" + 행사 {len(events_today)}건" if events_today else ""),
               (f"계획 커버 {val.get('plan_coverage')}% · 실행 일치 {val.get('match_rate')}% · 확인 필요 {max(val.get('anomaly_count', 0) - val.get('auto_actions', 0), 0)}건"
                if val.get("plan_coverage") is not None else "오늘은 수업이 없습니다"),
               "ok" if (val.get("plan_coverage") or 100) >= 99 else "review",
               "수업 시간에 맞춰 켜고 끄는지 실행 이력으로 확인합니다. 자세한 내용은 정합성 검증 탭에 있습니다.", idea=3),
        _check("t3-sensor", "실내 온도 센서", ["sensor"],
               f"수업 중 {ctx.settings['comfort_low']}~{ctx.settings['comfort_high']}℃",
               (f"지금 수업 중 {len(occupied_now)}개 실, 범위 밖 {len(off_band)}개" + (f" ({', '.join(x['room'] for x in off_band)})" if off_band else ""))
               if now_min is not None else "아직 시작 전",
               "adjust" if off_band else "ok",
               "범위를 벗어나면 피드백 보정으로 바로 가동합니다." if off_band else "수업 중인 강의실이 모두 쾌적 범위 안에 있습니다.",
               rooms=[x["room"] for x in off_band]),
        _check("t3-co2", "CO₂ 환기", ["co2", "density"],
               f"CO₂ {pol['co2_max']}ppm 이하",
               (f"지금 기준 초과 {len(co2_hi)}개 실 · 오늘 예상 최고 " + (f"{co2_peak_hi[0]['room']}호 {co2_peak_hi[0]['co2_peak']:.0f}ppm" if co2_peak_hi else f"{max((x['co2_peak'] or 0) for x in rooms):.0f}ppm")),
               "adjust" if (co2_hi or vent_adjs) else "ok",
               "인원이 많은 수업은 10분 전부터 강 단계로 환기합니다." if (co2_hi or vent_adjs) else "오늘 수업은 계획한 환기 단계로 기준을 지킵니다.",
               idea=13, rooms=sorted(set(co2_hi + [a["rooms"][0] for a in vent_adjs]))),
        _check("t3-occupancy", "재실 감지", ["density", "sensor"],
               "예상 인원대로 재실",
               f"무단 공강·조기 종료 {len(scen)}건 감지" + (f", 빈 강의실 자동 정지 {len(vac)}건" if vac else ""),
               "ok", "재실이 없으면 자동 정지하고 다음 수업 예열은 그대로 둡니다."),
        _check("t3-coast", "잔열·잔냉 활용", ["simulator", "sensor"],
               "종료 전 정지 후에도 쾌적 유지",
               (f"관성 정지 {len(early)}회 (예: {early[0]['room']}호 {early[0]['title']})" if early else "오늘은 관성 정지할 수업이 없습니다"),
               "ok", "종료 전 정지해도 실내가 쾌적 범위에 남는 수업만 일찍 끕니다.", idea=14),
        _check("t3-solar", "일사량·방향", ["nowcast", "policy"],
               "오후 일사가 큰 강의실 부하 반영",
               ("오후 일사 큰 강의실: " + ", ".join(f"{x['room']}({x['orient']}향 {x['solar_index']:.1f} kW)" for x in sunny[:3])) if sunny else "오후 일사 영향이 작습니다",
               "ok", "난방철에는 일사가 난방을 줄여 주고, 냉방철에는 예냉을 앞당깁니다.", idea=12, rooms=[x["room"] for x in sunny[:3]]),
        _check("t3-feedback", "최근 쾌적 의견", ["feedback", "simulator", "policy"],
               "최근 '춥다/덥다' 의견 없음",
               (f"어제·오늘 의견 {len(fb_today_items)}건 · " + ", ".join(f"{r}호 {b['n']}건(평균 {b['mean']:+.1f})" for r, b in sorted(fb_today.items())[:4])) if fb_today_items else "어제·오늘 받은 의견이 없습니다",
               "adjust" if fb_adjs else "ok",
               ("의견을 반영한 설정온도 조정안을 만들었습니다. 에이전트 협의로 비용과 쾌적을 함께 확인할 수 있습니다." if fb_adjs else "조정이 필요한 의견이 없습니다.")
               + (" " + "; ".join(fb_notes) if fb_notes else ""), rooms=[a["rooms"][0] for a in fb_adjs]),
    ]
    fa = service.weather_sources().get("fetched_at")
    sources = [*_weather_source(ctx), *_sensor_sources(len(fb_today_items)),
               _src("events", "오늘 일정", "input", f"행사·보강 {len(events_today)}건"), _bms_source()]
    fx = sm["strategies"]["fixed"]["kwh"]
    aik = sm["strategies"]["ai"]["kwh"]
    pct = round(100.0 * (fx - aik) / fx, 1) if fx else None
    n_adj = sum(1 for c in checks if c["verdict"] != "ok")
    sentence = (f"{d.month}/{d.day} 계획을 실황·센서·의견으로 다시 확인했습니다. 점검 {len(checks)}개 중 {n_adj}개에서 조정이 필요했고"
                + (f" 조정안 {sum(1 for a in adjs if a['status'] != 'rejected')}건을 만들었습니다."
                   if any(a["status"] != "rejected" for a in adjs) else " 계획은 그대로 유효합니다."))
    return {"tier": 3, "label": "3차 · 일일 검증",
            "period": {"start": d.isoformat(), "end": d.isoformat(), "label": f"{d.month}/{d.day} ({WEEKDAYS[d.weekday()]})"},
            "generated_at": service.now_kst().isoformat(timespec="seconds"), "mode": mode()["mode"],
            "summary": {"sentence": sentence, "kwh": round(aik, 1), "baseline_kwh": round(fx, 1),
                        "cost_krw": sm["strategies"]["ai"]["cost_krw"], "saving_pct": pct, "sessions": sm["sessions"],
                        "comfort_pct": sm["strategies"]["ai"]["comfort_pct"]},
            "sources": sources, "checks": checks, "adjustments": adjs, "rooms": rooms,
            "hourly": {"step_min": 15, "t_forecast": wf["t"], "t_actual": t_actual, "ghi": wa["ghi"], "co2": co2, "people": people},
            "now_minute": now_min, "weather_fetched_at": fa}


def plan_date(ctx: service.Ctx | None = None) -> date:
    """Today if it has classes, otherwise the next operating day (weekends verify Monday's plan)."""
    ctx = ctx or service.Ctx()
    t = _today()
    s0, s1 = service.semester_range()
    for k in range(0, 10):
        d = t + timedelta(days=k)
        if d > s1:
            break
        if d >= s0 and sessions_for_date(d, ctx.courses, ctx.events):
            return d
    return date.fromisoformat(service.effective_now(ctx)["date"])


def tier_plan(tier: int, d: date | None = None) -> dict:
    d = d or (_today() if tier == 1 else plan_date())
    s0, s1 = service.semester_range()
    d = min(max(d, s0), s1)
    fb_n = len(get_store().list_items("feedback"))
    adj_key = service._h([(a["id"], a["status"]) for a in get_store().list_items("adjustment")])
    key = f"{tier}|{d.isoformat()}|{fb_n}|{adj_key}|{mode()['mode']}|{service._h(policy())}|{service.now_kst().strftime('%Y%m%d%H')}"
    fn = {1: tier1, 2: tier2, 3: tier3}[tier]
    return _cached(key, lambda: fn(d))


def run_daily(log=print) -> dict:
    """Hourly scheduler hook: re-verify today (3차) and this week (2차) with the newest data."""
    out = {}
    for t in (3, 2):
        try:
            p = tier_plan(t)
            out[t] = {"checks": len(p["checks"]), "adjustments": len(p["adjustments"])}
        except Exception as e:  # never break the weather refresh
            out[t] = {"error": str(e)[:200]}
    log(f"tier re-check: {json.dumps(out, ensure_ascii=False)}")
    return out
