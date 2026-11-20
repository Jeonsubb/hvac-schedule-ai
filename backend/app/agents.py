"""Two agents negotiate the per-room setpoints: cost vs comfort, grounded by the simulator.

- 관리자(건물) 에이전트 '관리자 온디' (agent='building'): proposes the cheapest setpoints the policy allows
- 사용자 에이전트 (agent='occupant'): speaks for the occupants (feedback, PMV, CO2) and pushes back
- 시뮬레이터: every proposal is re-simulated (AI operation, same weather and occupancy) before the
  next turn, so the agents argue over computed numbers, like a generator and a discriminator
- 판정 (agent='arbiter'): deterministic — picks the consensus, or the best compromise when they disagree

Each LLM turn returns structured output: stance, message, a trace of the data it checked (source →
query → finding) and a proposal. Numbers in messages must come from the dossier or the simulator.
When Bedrock is unavailable the same loop runs with rule-based agents (ai=False).
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta

from hvac import config, engine
from hvac.timetable import WEEKDAYS, hm_to_min, sessions_for_date

from . import planning, service
from .store import get_store

AGENT_MODEL = os.environ.get("MODEL_AGENTS", os.environ.get("MODEL_HAIKU", "global.anthropic.claude-haiku-5-5"))

SOURCES = ["weather", "forecast", "co2", "density", "occupancy", "feedback", "tariff", "policy",
           "simulator", "timetable", "events"]

# where each source in the dossier comes from (shown to the agents and stored with the result)
PROVENANCE = {
    "timetable": "실제 시간표(학교 제공)와 관리자가 등록한 일정",
    "events": "관리자가 등록한 일정",
    "weather": "외부 기상예보",
    "forecast": "외부 기상예보",
    "policy": "정책·기준값(관리자 설정온도 범위, CO₂ 기준)",
    "tariff": "기준값(한전 교육용(을) 요금표, 2023년 게시)",
    "density": "추정(정원×출석률 가정)",
    "occupancy": "추정(정원×출석률 가정)",
    "co2": "추정 계산(추정 인원·환기 단계 기반, 센서 아님)",
    "simulator": "물리 시뮬레이션(실측 아님)",
    "feedback": "재실자 의견",
}

TURN_SCHEMA = {
    "type": "object",
    "properties": {
        "stance": {"type": "string", "description": "한 줄 입장, 25자 이내"},
        "message": {"type": "string", "description": "상대 에이전트에게 하는 말. 2~4문장, 300자 이내, 수치는 자료에서만 인용"},
        "trace": {
            "type": "array",
            "description": "판단 전에 확인한 자료를 확인한 순서대로 3~6개",
            "items": {
                "type": "object",
                "properties": {
                    "source": {"type": "string", "enum": SOURCES},
                    "query": {"type": "string", "description": "무엇을 확인했는지"},
                    "finding": {"type": "string", "description": "확인한 사실(자료의 수치 인용)"},
                },
                "required": ["source", "query", "finding"],
                "additionalProperties": False,
            },
        },
        "proposal": {
            "type": "array",
            "description": "수업이 있는 모든 강의실의 설정온도 제안",
            "items": {
                "type": "object",
                "properties": {"room": {"type": "string"}, "setpoint": {"type": "number"}},
                "required": ["room", "setpoint"],
                "additionalProperties": False,
            },
        },
        "accepts": {"type": "boolean", "description": "상대의 직전 제안을 그대로 받아들이면 true"},
    },
    "required": ["stance", "message", "trace", "proposal", "accepts"],
    "additionalProperties": False,
}

PERSONA = {
    "building": (
        "당신은 '관리자 온디'입니다. 이 건물 관리자 쪽 에이전트입니다. "
        "목표는 전기요금과 에너지를 줄이는 것입니다. 재실자 의견이 없는 강의실은 설정을 0.5℃씩 아끼는 쪽으로 제안하고, "
        "의견이 반복된 강의실은 현재 설정에서 시작해 시뮬레이터가 보여 준 쾌적 악화를 근거로 꼭 필요한 만큼만 양보합니다. "
        "말투는 차분하고 숫자로 설득합니다."
    ),
    "occupant": (
        "당신은 '사용자 온디'입니다. 강의실을 쓰는 학생·교수의 쾌적을 대변합니다. "
        "목표는 수업 중 체감 쾌적(PMV -0.5~+0.5)과 공기질(CO₂ 기준)을 지키는 것입니다. "
        "재실자 의견이 반복된 강의실은 쾌적 쪽으로 0.5~1℃ 조정을 요구하고, 의견이 없는 강의실은 PMV 하락이 0.1 이내이면 절감에 양보합니다. "
        "말투는 친근하지만 근거를 분명히 댑니다."
    ),
}


# The simulator as a tool: an agent may test whole-building setpoint plans before it commits to a proposal.
MAX_SIMS = 2
SIM_TOOL = {
    "name": "simulate",
    "description": ("강의실별 설정온도 안을 물리 시뮬레이터(열모델)로 계산해 기간 전력·요금·수업 중 PMV를 돌려줍니다. "
                    "자료의 후보표는 강의실 하나만 바꿨을 때의 값이므로, 여러 강의실을 함께 바꾸는 안은 이 도구로 확인합니다. "
                    "적지 않은 강의실은 직전 제안(없으면 현재 계획)의 설정을 유지합니다."),
    "input_schema": {
        "type": "object",
        "properties": {
            "why": {"type": "string", "description": "무엇을 확인하려는지 한 구절"},
            "setpoints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"room": {"type": "string"}, "setpoint": {"type": "number"}},
                    "required": ["room", "setpoint"],
                },
            },
        },
        "required": ["why", "setpoints"],
    },
}


# ---------------------------------------------------------------- dossier (what both agents may cite)

def _dates_for(tier: int, d: date, ctx: service.Ctx) -> list[date]:
    if tier == 3:
        return [d]
    mon = d - timedelta(days=d.weekday())
    s0, s1 = service.semester_range()
    out = [x for x in (mon + timedelta(days=i) for i in range(5)) if s0 <= x <= s1 and x >= planning._today()
           and sessions_for_date(x, ctx.courses, ctx.events)]
    return out[:5] or [d]


def build_dossier(tier: int, d: date, ctx: service.Ctx, fb_until: date | None = None) -> dict:
    pol = planning.policy()
    dates = _dates_for(tier, d, ctx)
    season = planning.season_for(dates, ctx)
    key = "sp_heat" if season == "heat" else "sp_cool"
    lo, hi = (pol["heat_min"], pol["heat_max"]) if season == "heat" else (pol["cool_min"], pol["cool_max"])
    busy = sorted(planning._rooms_with_classes(dates, ctx))
    base_sp = {r: planning._base_sp(dates[0], r, ctx)[0 if season == "heat" else 1] for r in busy}
    baseline = planning.evaluate(dates, ctx, feedback=None)
    for r in busy:  # the screens compare proposals against the current setpoint of each room
        baseline["rooms"].setdefault(r, {})[key] = base_sp[r]
    # candidate grid: same setpoint everywhere (rooms barely interact), read per room
    grid: dict = {}
    steps = []
    v = lo
    while v <= hi + 1e-6:
        steps.append(round(v, 1))
        v += 0.5
    for sp in steps:
        ev = planning.evaluate(dates, ctx, {r: {key: sp} for r in busy})
        for r in busy:
            rr = ev["rooms"].get(r, {})
            grid.setdefault(r, []).append({"sp": sp, "kwh": rr.get("kwh"), "pmv": rr.get("pmv")})
    fb_items = planning.feedback_items(7, until=fb_until or max(dates[0], planning._today()))
    fb = planning._fb_by_room(fb_items)
    # votes derived from the simulated comfort (source='simulated') are not real complaints: count them apart
    fb_sim = sum(1 for f in fb_items if f.get("source") == "simulated")
    for r, b in fb.items():
        b["simulated"] = sum(1 for f in fb_items if f["room"] == r and f.get("source") == "simulated" and "stuffy" not in f["tags"])
    fb_sources = {"simulated": fb_sim, "real": len(fb_items) - fb_sim}
    wx = []
    for x in dates:
        w = ctx.wx.get(x.isoformat())
        if w:
            wx.append({"date": x.isoformat(), "t_min": min(w["forecast"]["t"]), "t_max": max(w["forecast"]["t"]),
                       "ghi_max": round(max(w["forecast"]["ghi"]))})
    people: dict = {}
    co2: dict = {}
    for x in dates:
        day = service.get_day(x, ctx)
        vp = planning.vent_plan(day, pol)
        for s in day["sessions"]:
            people.setdefault(s["room"], []).append(s["expected_people"])
        for r, v2 in vp.items():
            if v2["peak"]:
                co2[r] = max(co2.get(r, 0), v2["peak"])
    season_tariff = ctx.settings["tariff"]["winter" if season == "heat" else "summer"]
    rate = (baseline["cost_krw"] / baseline["kwh"]) if baseline["kwh"] else 110.0
    return {
        "tier": tier, "dates": [x.isoformat() for x in dates], "season": season, "key": key, "lo": lo, "hi": hi,
        "rooms": busy, "base_sp": base_sp, "baseline": baseline, "grid": grid, "rate": round(rate, 1),
        "feedback": fb, "feedback_sources": fb_sources, "weather": wx, "people": {r: max(v) for r, v in people.items()}, "co2": co2,
        "orient": {r: pol["orient"].get(r, "남") for r in busy}, "tariff": season_tariff, "co2_max": pol["co2_max"],
        "comfort_won": float(pol.get("comfort_won", COMFORT_WON)),
        "policy": {"heat_min": pol["heat_min"], "heat_max": pol["heat_max"], "cool_min": pol["cool_min"], "cool_max": pol["cool_max"]},
    }


def _fb_kind(ds: dict) -> str:
    src = ds.get("feedback_sources") or {}
    if src.get("simulated") and not src.get("real"):
        return "시뮬레이션 기반 가상 의견(실제 민원 아님)"
    if src.get("simulated"):
        return f"실제 접수 {src['real']}건 + 시뮬레이션 기반 가상 의견 {src['simulated']}건"
    return "실제 접수 의견"


def _fb_word(ds: dict) -> str:
    """How to call the occupant votes in generated text: simulated-only votes are never called complaints."""
    src = ds.get("feedback_sources") or {}
    return "가상 의견" if src.get("simulated") and not src.get("real") else "의견"


def dossier_text(ds: dict) -> str:
    """Every line names where its numbers come from. Nothing here is measured by a room sensor."""
    label = "난방" if ds["season"] == "heat" else "냉방"
    lines = [
        "[자료 출처 안내] 실내온도·PMV·CO₂·전력은 모두 시뮬레이션 또는 추정값이며 실제 건물 센서 값이 아닙니다.",
        f"[대상·실제 시간표] {', '.join(ds['dates'])} ({'일일' if ds['tier'] == 3 else '주간'}), {label} 계절, 수업 있는 강의실 {', '.join(ds['rooms'])}",
        f"[policy·정책 기준] {label} 설정온도 허용 범위 {ds['lo']}~{ds['hi']}℃ (학교보건법 교실 18~28℃, 에너지이용 합리화법), CO₂ 기준 {ds['co2_max']}ppm",
        f"[tariff·기준값(2023년 게시 요금표)] 한전 교육용(을) {label}철 경부하 {ds['tariff']['light']}원·중간 {ds['tariff']['mid']}원·최대 {ds['tariff']['peak']}원/kWh, 이 기간 평균 {ds['rate']}원/kWh",
        "[weather/forecast·외부 기상예보] " + "; ".join(f"{w['date']} 최저 {w['t_min']}℃ 최고 {w['t_max']}℃ 일사 최대 {w['ghi_max']}W/㎡" for w in ds["weather"]),
        f"[simulator·시뮬레이션] 현재 계획: 전력 {ds['baseline']['kwh']} kWh, 요금 {ds['baseline']['cost_krw']}원, 수업 중 평균 PMV {ds['baseline']['pmv_mean']}, "
        f"추운 강의실(PMV<-0.5) {', '.join(ds['baseline']['cold_rooms']) or '없음'}, 더운 강의실 {', '.join(ds['baseline']['hot_rooms']) or '없음'}",
        "[simulator·시뮬레이션] 강의실별 설정온도 후보 → 기간 전력(kWh)·수업 중 평균 PMV:",
    ]
    for r in ds["rooms"]:
        cells = ", ".join(f"{g['sp']}℃→{g['kwh']}kWh/PMV {g['pmv']}" for g in ds["grid"].get(r, []))
        lines.append(f"  {r}호(현재 {ds['base_sp'][r]}℃, {ds['orient'][r]}향·방향은 가정): {cells}")
    fb = ds["feedback"]
    lines.append(f"[feedback·{_fb_kind(ds)}] 최근 7일 의견(-3 춥다~+3 덥다): " + (
        "; ".join(f"{r}호 {b['n']}건 평균 {b['mean']:+.1f}(춥다 {b['cold']}·덥다 {b['hot']}·답답 {b['stuffy']})" for r, b in sorted(fb.items())) or "없음"))
    lines.append("[density/occupancy·추정(정원×출석률)] 예상 최대 인원: " + ", ".join(f"{r}호 {n}명" for r, n in sorted(ds["people"].items())))
    lines.append("[co2·추정 계산(센서 아님)] 계획 환기 단계로 예상 최고 CO₂: " + ", ".join(f"{r}호 {v}ppm" for r, v in sorted(ds["co2"].items())))
    return "\n".join(lines)


# ---------------------------------------------------------------- one LLM turn

def _llm_turn(agent: str, ds: dict, history: list[dict], round_no: int, sim=None, current: dict | None = None,
              on_sim=None) -> dict:
    """One agent turn. With `sim` (proposal -> engine evaluation) the agent works as a tool-using agent: it may
    call the simulator up to MAX_SIMS times, read the results and only then answer. The calls it made are
    returned in `sims` (engine numbers, not the model's words)."""
    from . import ai

    ai._charge()
    label = "난방" if ds["season"] == "heat" else "냉방"
    system = (
        PERSONA[agent] + "\n\n"
        "당신은 상대 에이전트와 강의실별 " + label + " 설정온도를 협의합니다. 관리자가 볼 수 있게 한국어로 말합니다.\n"
        "규칙:\n"
        f"- 제안 설정온도는 {ds['lo']}~{ds['hi']}℃ 안, 0.5℃ 단위입니다. 수업 있는 모든 강의실({', '.join(ds['rooms'])})을 제안에 넣습니다.\n"
        "- 수치(kWh, 원, PMV, ppm, 건수)는 아래 자료나 시뮬레이터 결과에 있는 값만 씁니다. 지어내지 않습니다.\n"
        "- trace에는 판단 전에 확인한 자료를 확인한 순서대로 적습니다(자료 이름은 source 값).\n"
        "- 상대의 직전 제안이 받아들일 만하면 accepts=true로 하고 그 제안을 그대로 proposal에 넣습니다.\n"
        "- 내부 키(sp_heat 등)나 영어 변수명을 메시지에 쓰지 않습니다.\n"
        "- 협의 대상은 설정온도뿐입니다. 켜고 끄는 시각은 물리 계산 엔진이 정하므로 제안하지 않습니다.\n"
        "- 자료의 수치는 모두 예보·정책 기준·추정·시뮬레이션 값입니다. '실측', '센서 측정', '현재 실내온도'라고 쓰지 않습니다.\n"
        + ("- 재실자 의견 자료는 시뮬레이션으로 만든 가상 의견입니다. 실제 민원처럼 말하지 말고 '가상 의견'이라고 부릅니다.\n"
           if (ds.get("feedback_sources") or {}).get("simulated") else "")
        + (f"- 제안하기 전에 simulate 도구로 생각한 안을 직접 계산해 볼 수 있습니다(최대 {MAX_SIMS}회). 결과를 보고 안을 고친 뒤, "
           "도구 호출 없이 최종 답을 냅니다. 도구로 확인한 수치는 trace에 source='simulator'로 적습니다.\n" if sim else "")
        + "\n"
        "자료:\n" + dossier_text(ds)
    )
    convo = []
    for t in history:
        who = "관리자 온디(관리자 에이전트)" if t["agent"] == "building" else "사용자 온디(사용자 에이전트)" if t["agent"] == "occupant" else "판정"
        ev = t.get("eval") or {}
        props = ", ".join(f"{r} {v.get(ds['key'])}℃" for r, v in sorted(t["proposal"].items()))
        convo.append(f"[{t['round']}라운드 {who}] {t['message']}\n제안: {props}\n시뮬레이터 결과: 전력 {ev.get('kwh')} kWh, 요금 {ev.get('cost_krw')}원, "
                     f"평균 PMV {ev.get('pmv_mean')}, 추운 강의실 {', '.join(ev.get('cold_rooms') or []) or '없음'}, "
                     f"더운 강의실 {', '.join(ev.get('hot_rooms') or []) or '없음'}, 의견 해소 강의실 {ev.get('complaints_addressed')}")
    ask = (f"{round_no}라운드입니다. " + ("첫 제안을 하세요." if not history else "상대의 마지막 제안과 시뮬레이터 결과를 보고 답하세요."))
    user = ("\n\n".join(convo) + "\n\n" if convo else "") + ask
    cli = ai.client().with_options(timeout=60.0, max_retries=1)
    base = dict(model=AGENT_MODEL, max_tokens=3000, system=system,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": TURN_SCHEMA}})
    sims: list[dict] = []
    if sim:
        try:
            msgs: list = [{"role": "user", "content": user}]
            for _ in range(MAX_SIMS + 1):
                done = len(sims) >= MAX_SIMS
                resp = cli.messages.create(messages=msgs, tools=[SIM_TOOL],
                                           tool_choice={"type": "none"} if done else {"type": "auto"}, **base)
                uses = [b for b in resp.content if b.type == "tool_use"]
                if not uses:
                    out = json.loads(ai._text(resp))
                    out["sims"] = sims
                    return out
                msgs.append({"role": "assistant", "content": resp.content})
                results = []
                for tu in uses:
                    if len(sims) >= MAX_SIMS:
                        results.append({"type": "tool_result", "tool_use_id": tu.id, "is_error": True,
                                        "content": "시뮬레이션 호출 한도를 넘었습니다. 지금까지의 결과로 최종 답을 내세요."})
                        continue
                    prop = _clean_proposal((tu.input or {}).get("setpoints"), ds, current or {})
                    ev = sim(prop)
                    changed = {r: v[ds["key"]] for r, v in sorted(prop.items()) if abs(v[ds["key"]] - ds["base_sp"][r]) > 1e-6}
                    rec = {"why": str((tu.input or {}).get("why", ""))[:80], "changed": changed, "kwh": ev["kwh"],
                           "cost_krw": ev["cost_krw"], "pmv_mean": ev["pmv_mean"], "cold_rooms": ev["cold_rooms"],
                           "hot_rooms": ev["hot_rooms"]}
                    sims.append(rec)
                    if on_sim:
                        on_sim(len(sims))
                    results.append({"type": "tool_result", "tool_use_id": tu.id, "content": json.dumps({
                        **rec, "complaints_addressed": ev.get("complaints_addressed"),
                        "baseline": {"kwh": ds["baseline"]["kwh"], "cost_krw": ds["baseline"]["cost_krw"], "pmv_mean": ds["baseline"]["pmv_mean"]},
                        "rooms": {r: {"sp": prop[r][ds["key"]], "kwh": v.get("kwh"), "pmv": v.get("pmv")} for r, v in ev["rooms"].items() if r in prop},
                    }, ensure_ascii=False)})
                msgs.append({"role": "user", "content": results})
        except Exception as e:
            import anthropic

            if isinstance(e, anthropic.APIError) and ai.is_outage(e):
                raise
            # the tool loop itself failed (bad JSON, API shape): answer from the dossier alone, as before
            print(f"agent tool loop failed ({agent}, round {round_no}): {type(e).__name__}: {str(e)[:300]}")
    resp = cli.messages.create(messages=[{"role": "user", "content": user}], **base)
    out = json.loads(ai._text(resp))
    out["sims"] = sims
    return out


def _clean_proposal(raw: list, ds: dict, fallback: dict) -> dict:
    prop = {}
    for it in raw or []:
        r = str(it.get("room", "")).removesuffix("호")
        if r not in ds["rooms"]:
            continue
        try:
            v = float(it.get("setpoint"))
        except (TypeError, ValueError):
            continue
        v = round(max(ds["lo"], min(ds["hi"], v)) * 2) / 2
        prop[r] = {ds["key"]: v}
    for r in ds["rooms"]:
        prop.setdefault(r, {ds["key"]: fallback.get(r, ds["base_sp"][r])})
    return prop


def _clean_trace(raw: list) -> list[dict]:
    out = []
    for t in (raw or [])[:6]:
        src = t.get("source") if t.get("source") in SOURCES else "simulator"
        src = "forecast" if src == "weather" else src  # the dossier carries forecasts only, never observations
        out.append({"source": src, "query": str(t.get("query", ""))[:120], "finding": str(t.get("finding", ""))[:200]})
    return out


# ---------------------------------------------------------------- rule-based agents (fallback, also used offline)

def complaint_rooms(ds: dict) -> set:
    """Rooms whose occupants repeatedly said it is cold (heating) / hot (cooling)."""
    out = set()
    for r, b in ds["feedback"].items():
        if r not in ds["rooms"] or b.get("n", 0) < 2:
            continue
        if (ds["season"] == "heat" and b["mean"] <= -0.8) or (ds["season"] == "cool" and b["mean"] >= 0.8):
            out.add(r)
    return out


def _grid(ds: dict, r: str, sp: float) -> dict | None:
    return next((g for g in ds["grid"].get(r, []) if abs(g["sp"] - sp) < 1e-6), None)


def _step(ds: dict, r: str, steps: float) -> float:
    """Move a room's setpoint toward comfort (+) or savings (-) by n half-degree steps, inside the policy."""
    sign = 1 if ds["season"] == "heat" else -1
    v = ds["base_sp"][r] + sign * 0.5 * steps
    return max(ds["lo"], min(ds["hi"], round(v * 2) / 2))


def _pmv_drop(ds: dict, r: str, sp: float) -> float | None:
    a, b = _grid(ds, r, ds["base_sp"][r]), _grid(ds, r, sp)
    if not a or not b or a["pmv"] is None or b["pmv"] is None:
        return None
    return round((a["pmv"] - b["pmv"]) if ds["season"] == "heat" else (b["pmv"] - a["pmv"]), 2)


def _rule_turn(agent: str, ds: dict, history: list[dict], round_no: int) -> dict:
    key, lab = ds["key"], ("난방" if ds["season"] == "heat" else "냉방")
    op = _fb_word(ds)
    fb = ds["feedback"]
    hot = complaint_rooms(ds)
    quiet = [r for r in ds["rooms"] if r not in hot]
    last = history[-1] if history else None
    top_fb = sorted(((r, b) for r, b in fb.items() if b.get("n")), key=lambda kv: -kv[1]["n"])[:3]
    if agent == "building":
        if round_no == 1:
            prop = {r: {key: (_step(ds, r, -1) if r in quiet else ds["base_sp"][r])} for r in ds["rooms"]}
            saved = sum((_grid(ds, r, ds["base_sp"][r]) or {}).get("kwh", 0) - (_grid(ds, r, prop[r][key]) or {}).get("kwh", 0) for r in quiet)
            msg = (f"{op}이 없는 강의실 {len(quiet)}곳은 {lab} 설정을 0.5℃ 낮추겠습니다. 시뮬레이터 기준 약 {saved:.1f} kWh를 아낍니다. "
                   + (f"{op}이 반복된 {', '.join(sorted(hot))}호는 지금 설정을 유지합니다. " if hot else "")
                   + f"모두 정책 범위 {ds['lo']}~{ds['hi']}℃ 안입니다.")
            accepts = False
        else:
            # concede half the occupant's ask on complaint rooms, accept the rest of its proposal
            prev = last["proposal"] if last else {}
            prop = {}
            for r in ds["rooms"]:
                want = prev.get(r, {key: ds["base_sp"][r]})[key]
                prop[r] = {key: (_step(ds, r, 1) if r in hot and abs(want - ds["base_sp"][r]) > 0.5 else want)}
            accepts = all(prop[r] == prev.get(r) for r in ds["rooms"])
            msg = ("요구를 그대로 받아들이겠습니다. " if accepts else
                   f"{op}이 반복된 {', '.join(sorted(hot))}호는 1℃ 대신 0.5℃만 올리는 절충안을 드립니다. ") + \
                  "PMV 하락이 작은 강의실의 절감은 유지하겠습니다."
        trace = [{"source": "tariff", "query": "이 기간 평균 단가", "finding": f"{ds['rate']}원/kWh"},
                 {"source": "feedback", "query": f"{op}이 반복된 강의실", "finding": ", ".join(f"{r}호 {b['n']}건(평균 {b['mean']:+.1f})" for r, b in top_fb) or "없음"},
                 {"source": "simulator", "query": "0.5℃ 낮출 때 강의실별 전력·PMV", "finding": "; ".join(
                     f"{r}호 {(_grid(ds, r, ds['base_sp'][r]) or {}).get('kwh')}→{(_grid(ds, r, _step(ds, r, -1)) or {}).get('kwh')} kWh" for r in quiet[:3]) or "대상 없음"},
                 {"source": "policy", "query": f"{lab} 허용 범위", "finding": f"{ds['lo']}~{ds['hi']}℃"}]
        return {"stance": f"{op} 없는 강의실에서 아끼기" if round_no == 1 else "절반 양보", "message": msg, "trace": trace,
                "proposal": prop, "accepts": accepts}
    # occupant
    prev = last["proposal"] if last else {}
    prop = {}
    refused = []
    for r in ds["rooms"]:
        offered = prev.get(r, {key: ds["base_sp"][r]})[key]
        if r in hot:
            want = _step(ds, r, 2) if round_no == 1 else max(offered, _step(ds, r, 1)) if ds["season"] == "heat" else min(offered, _step(ds, r, 1))
            prop[r] = {key: want}
        else:
            drop = _pmv_drop(ds, r, offered)
            if drop is not None and drop > 0.1:
                refused.append(r)
                prop[r] = {key: ds["base_sp"][r]}
            else:
                prop[r] = {key: offered}
    accepts = bool(last) and all(prop[r] == prev.get(r) for r in ds["rooms"])
    ev = (last or {}).get("eval") or ds["baseline"]
    msg = ((f"{', '.join(sorted(hot))}호는 '춥다' {op}이 반복되어 1℃ 올려 주세요. " if hot and round_no == 1 else "")
           + (f"{', '.join(refused)}호는 체감(PMV)이 0.1 넘게 떨어져 지금 설정을 지켜 주세요. " if refused else "")
           + ("나머지 강의실의 절감은 받아들이겠습니다." if not accepts else f"이 안이면 {op}이 반복된 강의실도 나아져서 동의합니다."))
    trace = [{"source": "feedback", "query": f"최근 7일 '춥다/덥다' {op}", "finding": "; ".join(f"{r}호 {b['n']}건 평균 {b['mean']:+.1f}" for r, b in top_fb) or "없음"},
             {"source": "simulator", "query": "상대 제안의 수업 중 PMV", "finding": f"평균 {ev.get('pmv_mean')} (현재 {ds['baseline']['pmv_mean']})"},
             {"source": "density", "query": "예상 최대 인원", "finding": ", ".join(f"{r}호 {n}명" for r, n in sorted(ds['people'].items(), key=lambda kv: -kv[1])[:3])},
             {"source": "co2", "query": "예상 최고 CO₂", "finding": ", ".join(f"{r}호 {v}ppm" for r, v in sorted(ds['co2'].items(), key=lambda kv: -kv[1])[:3]) or "자료 없음"}]
    return {"stance": f"{op}이 반복된 강의실부터 지키기" if not accepts else "합의", "message": msg, "trace": trace, "proposal": prop,
            "accepts": accepts}


# ---------------------------------------------------------------- the negotiation loop

COMFORT_WON = 600.0  # value of 1 PMV unit for one room for one day (won), used only by the arbiter


def _room_score(ds: dict, r: str, g: dict, complaints: set, days: int) -> float:
    """Cost of the room's electricity + comfort penalty relative to the current plan. Rooms with repeated
    complaints are scored against a target 0.3 PMV warmer (heating) than now and weigh three times more."""
    base = _grid(ds, r, ds["base_sp"][r]) or g
    if g["pmv"] is None or base["pmv"] is None:
        return g["kwh"] * ds["rate"]
    sign = 1 if ds["season"] == "heat" else -1
    if r in complaints:
        target, w = base["pmv"] + sign * 0.3, 3.0
    else:
        target, w = base["pmv"], 1.0
    gap = max(0.0, sign * (target - g["pmv"]))
    return g["kwh"] * ds["rate"] + w * gap * ds.get("comfort_won", COMFORT_WON) * days


def negotiate(tier: int, d: date, progress=None, use_ai: bool = True, sandbox: bool = False,
              ctx: service.Ctx | None = None, fb_until: date | None = None) -> dict:
    """sandbox=True (simulation lab): same negotiation, but no adjustments, no stored result, no audit."""
    ctx = ctx or service.Ctx()
    ds = build_dossier(tier, d, ctx, fb_until)
    dates = [date.fromisoformat(x) for x in ds["dates"]]
    turns: list[dict] = []
    ai_ok = use_ai
    note = None
    if not ds["rooms"]:
        raise ValueError("이 기간에는 수업이 있는 강의실이 없어 협의할 대상이 없습니다.")

    def emit(phase):
        if progress:
            progress({"phase": phase, "turns": turns})

    order = ["building", "occupant", "building", "occupant"]
    current = {r: {ds["key"]: ds["base_sp"][r]} for r in ds["rooms"]}
    emit("자료를 모으는 중")
    for i, agent in enumerate(order):
        rnd = i // 2 + 1
        emit(f"{'관리자 온디' if agent == 'building' else '사용자 온디'}가 자료를 확인하는 중")
        raw = None
        if ai_ok:
            try:
                who = "관리자 온디" if agent == "building" else "사용자 온디"
                raw = _llm_turn(agent, ds, turns, rnd,
                                sim=lambda p: planning.evaluate(dates, ctx, p, ds["feedback"]),
                                current={r: v[ds["key"]] for r, v in current.items()},
                                on_sim=lambda n, who=who: emit(f"{who}가 시뮬레이터로 안을 직접 계산하는 중 ({n}번째)"))
            except Exception as e:  # Bedrock outage or quota: continue with the rule-based agents
                from . import ai

                print(f"agent LLM turn failed ({agent}, round {rnd}): {type(e).__name__}: {str(e)[:300]}")
                if ai.is_outage(e):
                    ai.record_status(False, type(e).__name__)
                ai_ok = False
                note = None  # the screen explains the rule-based fallback (ai=False)
        if raw is None:
            raw = _rule_turn(agent, ds, turns, rnd)
            prop = raw["proposal"]
        else:
            from . import ai

            ai.record_status(True)
            prop = _clean_proposal(raw.get("proposal"), ds, {r: v[ds["key"]] for r, v in current.items()})
        ev = planning.evaluate(dates, ctx, prop, ds["feedback"])
        turn = {"round": rnd, "agent": agent, "stance": str(raw.get("stance", ""))[:80], "message": str(raw.get("message", ""))[:900],
                "trace": _clean_trace(raw.get("trace")), "proposal": prop, "eval": ev, "accepts": bool(raw.get("accepts")),
                "sims": raw.get("sims") or []}
        turns.append(turn)
        current = prop
        emit("시뮬레이터로 제안을 검증하는 중")
        if i >= 1 and turn["accepts"]:
            break
    # arbiter
    last_two = turns[-2:]
    agreed = len(turns) >= 2 and turns[-1]["accepts"] and turns[-1]["proposal"] == turns[-2]["proposal"]
    if agreed:
        final_prop, final_ev = turns[-1]["proposal"], turns[-1]["eval"]
        how = "두 에이전트가 같은 안에 합의했습니다."
    else:
        # compromise: per room, the candidate between the two last proposals with the best score
        cand = {}
        a = last_two[0]["proposal"] if len(last_two) == 2 else current
        b = last_two[-1]["proposal"]
        for r in ds["rooms"]:
            lo_v = min(a[r][ds["key"]], b[r][ds["key"]])
            hi_v = max(a[r][ds["key"]], b[r][ds["key"]])
            opts = [g for g in ds["grid"].get(r, []) if lo_v - 1e-6 <= g["sp"] <= hi_v + 1e-6 and g["kwh"] is not None]
            if not opts:
                cand[r] = {ds["key"]: b[r][ds["key"]]}
                continue
            hot = complaint_rooms(ds)
            cand[r] = {ds["key"]: min(opts, key=lambda g: _room_score(ds, r, g, hot, len(dates)))["sp"]}
        final_prop = cand
        final_ev = planning.evaluate(dates, ctx, final_prop, ds["feedback"])
        how = "두 안이 달라 판정이 두 제안 사이에서 강의실마다 전기요금과 쾌적 벌점의 합이 가장 작은 설정온도를 골랐습니다."
    base = ds["baseline"]
    dk = round(final_ev["kwh"] - base["kwh"], 2)
    dc = final_ev["cost_krw"] - base["cost_krw"]
    changed = {r: v for r, v in final_prop.items() if abs(v[ds["key"]] - ds["base_sp"][r]) > 1e-6}
    hot = sorted(complaint_rooms(ds))

    def avg_pmv(ev, rooms):
        v = [ev["rooms"][r]["pmv"] for r in rooms if ev["rooms"].get(r, {}).get("pmv") is not None]
        return round(sum(v) / len(v), 2) if v else None

    op = _fb_word(ds)
    fb_txt = (f" {op}이 반복된 {'·'.join(hot)}호의 평균 PMV는 {avg_pmv(base, hot)} → {avg_pmv(final_ev, hot)}입니다." if hot else "")
    summary = (f"{how} 현재 계획 대비 전력 {dk:+.2f} kWh, 요금 {dc:+,}원, 전체 평균 PMV {base['pmv_mean']} → {final_ev['pmv_mean']}."
               + fb_txt + f" 설정을 바꾸는 강의실은 {len(changed)}곳입니다.")
    arb = {"round": turns[-1]["round"] + (0 if agreed else 1), "agent": "arbiter",
           "stance": "합의 확인" if agreed else "절충안 판정", "message": summary,
           "trace": [{"source": "simulator", "query": "최종안 재시뮬레이션", "finding": f"{final_ev['kwh']} kWh, {final_ev['cost_krw']:,}원, PMV {final_ev['pmv_mean']}"},
                     {"source": "policy", "query": "정책 범위 확인", "finding": f"모든 제안이 {ds['lo']}~{ds['hi']}℃ 안"}],
           "proposal": final_prop, "eval": final_ev, "accepts": True}
    turns.append(arb)
    # what the arbiter's own objective would pick over the whole grid (not only between the last two
    # proposals): shows how far the negotiation is from the cost + comfort optimum
    hot_all = complaint_rooms(ds)
    opt_prop = {}
    for r in ds["rooms"]:
        g = [x for x in ds["grid"].get(r, []) if x["kwh"] is not None]
        if g:
            opt_prop[r] = {ds["key"]: min(g, key=lambda x: _room_score(ds, r, x, hot_all, len(dates)))["sp"]}
    opt_ev = planning.evaluate(dates, ctx, opt_prop, ds["feedback"]) if opt_prop else None
    optimum = {"proposal": opt_prop, "eval": opt_ev, "comfort_won": ds.get("comfort_won", COMFORT_WON)}
    if opt_ev:
        arb["trace"].append({"source": "simulator", "query": "판정 기준 전체 최적안(비교용)",
                             "finding": f"{opt_ev['kwh']} kWh, {opt_ev['cost_krw']:,}원, PMV {opt_ev['pmv_mean']} (쾌적 가중치 {ds.get('comfort_won', COMFORT_WON):.0f}원)"})
    if sandbox:
        return {"optimum": optimum, **{"tier": tier, "date": d.isoformat(), "dates": ds["dates"], "season": ds["season"], "policy": ds["policy"],
                "baseline": base, "turns": turns, "base_sp": ds["base_sp"], "complaint_rooms": hot,
                "final": {"proposal": final_prop, "eval": final_ev, "summary": summary, "agreed": agreed},
                "adjustment_ids": [], "ai": ai_ok, "note": note, "created_at": service.now_kst().isoformat(timespec="seconds")}}
    emit("조정안을 만드는 중")

    # adjustments: rooms that move to the same setpoint form one adjustment
    adj_ids = []
    lab = "난방" if ds["season"] == "heat" else "냉방"
    groups: dict = {}
    for r, v in sorted(changed.items()):
        groups.setdefault(v[ds["key"]], []).append(r)
    st = get_store()
    for a in st.list_items("adjustment"):
        if (a.get("status") == "pending" and a.get("kind") == "setpoint" and a.get("origin") != "agents"
                and set(a.get("rooms", [])) & set(changed) and a["date_from"] <= ds["dates"][-1] and a["date_to"] >= ds["dates"][0]):
            st.put_item("adjustment", a["id"], {**a, "status": "rejected", "decided_at": service.now_kst().isoformat(timespec="seconds"),
                                                "decided_by": "에이전트 협의안으로 대체"})
    # one id per negotiation run: a decided adjustment of an earlier run (same setpoint, maybe other rooms)
    # must never swallow this run's proposal
    run_tag = service.now_kst().strftime("%H%M%S")
    adj_id = lambda sp: f"T{tier}-{ds['dates'][0]}-agents-{str(sp).replace('.', '_')}-{run_tag}"  # noqa: E731
    new_ids = {adj_id(sp) for sp in groups}
    for a in st.list_items("adjustment"):
        if (a.get("status") == "pending" and a.get("origin") == "agents" and a.get("tier") == tier
                and a.get("date_from") == ds["dates"][0] and a["id"] not in new_ids):
            st.put_item("adjustment", a["id"], {**a, "status": "rejected", "decided_at": service.now_kst().isoformat(timespec="seconds"),
                                                "decided_by": "새 협의안으로 대체"})
    for sp, rooms in sorted(groups.items()):
        kb = sum(base["rooms"].get(r, {}).get("kwh", 0) for r in rooms)
        ka = sum(final_ev["rooms"].get(r, {}).get("kwh", 0) for r in rooms)
        dkr = round(ka - kb, 2)
        pb, pa = avg_pmv(base, rooms), avg_pmv(final_ev, rooms)
        olds = sorted({ds["base_sp"][r] for r in rooms})
        warmer = (sp > olds[0]) == (ds["season"] == "heat")
        auto_ok = all(abs(sp - ds["base_sp"][r]) <= 0.5 + 1e-6 for r in rooms)
        adj = {
            "id": adj_id(sp), "tier": tier, "origin": "agents", "kind": "setpoint",
            "auto_ok": auto_ok,
            "title": f"{'·'.join(rooms)}호 {lab} {'/'.join(f'{x:.1f}' for x in olds)}℃ → {sp:.1f}℃ (에이전트 합의)",
            "reason": (f"{op}이 반복된 강의실이라 쾌적 Agent(사용자 온디)의 요구를 반영했습니다. " if warmer else
                       f"{op}이 없고 체감 변화가 작아 비용 Agent(관리자 온디)의 절감안을 반영했습니다. ") + how
                      + ("" if auto_ok else " 한 번에 0.5℃를 넘게 바꾸므로 자동 운전 모드에서도 담당자 승인을 기다립니다."),
            "rooms": rooms, "date_from": ds["dates"][0], "date_to": ds["dates"][-1], "change": {ds["key"]: sp},
            "impact": {"kwh": dkr, "cost_krw": round(dkr * ds["rate"]), "pmv_before": pb, "pmv_after": pa,
                       "note": f"{len(dates)}일 예측 제어 재시뮬레이션(실측 아님)"},
            "evidence": [{"source": "simulator", "text": f"평균 PMV {pb} → {pa}, 전력 {dkr:+.2f} kWh"}]
                        + [{"source": "feedback", "text": f"{r}호 최근 {op} {ds['feedback'][r]['n']}건, 평균 {ds['feedback'][r]['mean']:+.1f}"}
                           for r in rooms if ds["feedback"].get(r, {}).get("n")][:3],
        }
        adj_ids.append(planning.upsert_proposal(adj)["id"])
    res = {"tier": tier, "date": d.isoformat(), "dates": ds["dates"], "season": ds["season"], "policy": ds["policy"],
           "baseline": base, "turns": turns, "optimum": optimum,
           "final": {"proposal": final_prop, "eval": final_ev, "summary": summary, "agreed": agreed},
           "adjustment_ids": adj_ids, "ai": ai_ok, "note": note,
           "base_sp": ds["base_sp"], "key": ds["key"], "complaint_rooms": hot,
           "feedback_sources": ds.get("feedback_sources"), "provenance": PROVENANCE,
           "inputs": inputs_of(dates[0], ctx),
           "created_at": service.now_kst().isoformat(timespec="seconds")}
    if tier == 3:
        # the two plans the screens compare: same day, same timetable, same weather, same initial state;
        # only the per-room setpoints differ (before = current plan, after = the negotiated setpoints)
        emit("협의 전후 운전계획을 계산하는 중")
        get_store().put_blob(f"negotiation/{tier}/{d.isoformat()}.plans.json",
                             {"before": plan_view(dates[0], ctx, None), "after": plan_view(dates[0], ctx, final_prop)})
    get_store().put_blob(f"negotiation/{tier}/{d.isoformat()}.json", res)
    service.audit("agents", f"에이전트 협의({tier}차 {d.isoformat()}): {summary}", "AI")
    return res


def latest(tier: int, d: date) -> dict | None:
    return get_store().get_blob(f"negotiation/{tier}/{d.isoformat()}.json")


# ---------------------------------------------------------------- before / after comparison (same conditions)

def inputs_of(d: date, ctx: service.Ctx) -> dict:
    """Identity of what a negotiation was computed from: timetable (with events), weather and operating rules
    of that day. Applied per-room setpoints are not part of it: they are what the negotiation changes."""
    ss = sessions_for_date(d, ctx.courses, ctx.events)
    w = ctx.wx.get(d.isoformat()) or {}
    return {
        "day_fp": service.day_fingerprint(d, ctx.courses, ctx.events, ctx.wx, ctx.settings),
        "schedule": service._h([(x["id"], x["room"], x["start"], x["end"], x["expected_people"], x["title"]) for x in ss]),
        "weather": service._h(w), "settings": service._h(ctx.settings),
        "sessions": len(ss), "events": sum(1 for x in ss if x.get("kind") == "event"),
        "weather_src": w.get("src_forecast"), "engine": service.ENGINE_VERSION,
    }


def plan_view(d: date, ctx: service.Ctx, extra_sp: dict | None) -> dict:
    """One day of predictive control with the applied setpoints plus extra_sp: ON/OFF plan, energy, comfort."""
    sd = service.day_settings(d, ctx)
    rs = {k: dict(v) for k, v in (sd.get("room_sp") or {}).items()}
    for r, v in (extra_sp or {}).items():
        rs.setdefault(r, {}).update({k: float(x) for k, x in v.items() if k in ("sp_heat", "sp_cool")})
    st = {**ctx.settings, "room_sp": rs} if rs else ctx.settings
    day = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, st, detail=True, strategies=("ai",))
    sim = day["strategies"]["ai"]
    rooms: dict = {}
    pm_sum = pm_n = 0.0
    for r, rr in sim["rooms"].items():
        occ = [c for c in rr["sessions"] if not c.get("vacant")]
        pm = [c["pmv"] for c in occ if c.get("pmv") is not None]
        pm_sum += sum(pm)
        pm_n += len(pm)
        plan = [{"s": iv["s"], "e": iv["e"], "kind": iv.get("kind", "cond")} for iv in sim["plan"].get(r, [])]
        rooms[r] = {
            "plan": plan, "plan_minutes": sum(iv["e"] - iv["s"] for iv in plan), "kwh": round(rr["kwh"], 2),
            "pmv": round(sum(pm) / len(pm), 2) if pm else None,
            "class_min": sum(c["minutes"] for c in occ),
            "out_band_min": sum(c["minutes"] - c["in_band_minutes"] for c in occ),
            "sp_heat": float(rs.get(r, {}).get("sp_heat", ctx.settings["sp_heat"])),
            "sp_cool": float(rs.get(r, {}).get("sp_cool", ctx.settings["sp_cool"])),
            "ta": rr.get("ta"),
        }
    return {"kwh": round(sim["kwh"], 2), "cost_krw": sim["cost_krw"], "comfort_pct": sim.get("comfort_pct"),
            "pmv_mean": round(pm_sum / pm_n, 2) if pm_n else None,
            "plan_minutes": sum(v["plan_minutes"] for v in rooms.values()),
            "class_min": sum(v["class_min"] for v in rooms.values()),
            "out_band_min": sum(v["out_band_min"] for v in rooms.values()),
            "comfort_band": day.get("comfort_band"), "rooms": rooms}


def compare(d: date) -> dict | None:
    """Latest daily negotiation of d with what the screens need to compare before and after: both plans,
    whether today's inputs still match the ones it was computed from, and the live status of its adjustments."""
    res = latest(3, d)
    if not res:
        return None
    st = get_store()
    plans = st.get_blob(f"negotiation/3/{d.isoformat()}.plans.json") or {}
    cur = inputs_of(d, service.Ctx())
    then = res.get("inputs")
    changed = [k for k in ("schedule", "weather", "settings") if then and then.get(k) != cur.get(k)]
    adjs = []
    for i in res.get("adjustment_ids") or []:
        a = st.get_item("adjustment", i)
        if a:
            adjs.append({k: a.get(k) for k in ("id", "title", "status", "rooms", "change", "auto_ok", "impact", "reason",
                                               "decided_at", "decided_by", "date_from", "date_to")})
    sts = {a["status"] for a in adjs}
    state = ("no_change" if not adjs else "applied" if sts == {"applied"} else "pending" if sts == {"pending"}
             else "rejected" if sts == {"rejected"} else "partial")
    key = res.get("key") or ("sp_heat" if res.get("season") == "heat" else "sp_cool")
    return {
        "date": d.isoformat(), "created_at": res.get("created_at"), "ai": bool(res.get("ai")), "season": res.get("season"),
        "key": key, "summary": res["final"].get("summary"), "agreed": res["final"].get("agreed"),
        "rounds": max((t.get("round", 1) for t in res.get("turns", []) if t.get("agent") != "arbiter"), default=0),
        "base_sp": res.get("base_sp") or {r: v.get(key) for r, v in res["baseline"]["rooms"].items() if v.get(key) is not None},
        "final_sp": {r: v.get(key) for r, v in res["final"]["proposal"].items()},
        "baseline": {k: v for k, v in res["baseline"].items() if k != "rooms"},
        "final": {k: v for k, v in res["final"]["eval"].items() if k != "rooms"},
        "before": plans.get("before"), "after": plans.get("after"),
        "inputs": then, "current_inputs": cur,
        # None: negotiated before the inputs were recorded, so it cannot be verified
        "same_conditions": (then.get("day_fp") == cur["day_fp"]) if then else None, "changed": changed,
        "adjustments": adjs, "state": state, "mode": planning.mode()["mode"],
        "feedback_sources": res.get("feedback_sources"), "provenance": res.get("provenance"),
    }
