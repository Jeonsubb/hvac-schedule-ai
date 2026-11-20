"""ON:D voice agent ("온디"): the voice screen behind the logo.

Pipeline (all in the AWS account, Seoul region):
  browser microphone -> Amazon Transcribe streaming (ko-KR, presigned WebSocket made here)
                     -> Claude on Amazon Bedrock with tools (this module; tools call the same service layer as the screens)
                     -> Amazon Polly neural voice (mp3 returned with the answer)

Every tool returns two things: compact data for the model, and a "card" the screen draws next to the orb
(numbers, bars, and the route of the screen that owns the data). Numbers only ever come from the engine.
If Bedrock is unreachable a keyword router answers from the same tools, so the screen still works.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from datetime import date, timedelta

from hvac import config
from hvac.timetable import WEEKDAYS, sessions_for_date

from . import ai, jobs, service

log = logging.getLogger(__name__)

VOICE_MODEL = os.environ.get("MODEL_VOICE", ai.HAIKU)
REGION = os.environ.get("VOICE_REGION", os.environ.get("BEDROCK_REGION", "ap-northeast-2"))
POLLY_VOICES = [v.strip() for v in os.environ.get("POLLY_VOICE", "Jihye,Seoyeon").split(",") if v.strip()]
STT_SAMPLE_RATE = 16000
WAKE_WORD = "온디"
ACK_TEXT = "네"

SCREENS = {
    "home": ("/", "온디"),
    "overview": ("/overview", "운영 현황"),
    "savings": ("/energy", "절감 효과"),
    "comfort": ("/comfort", "쾌적 의견"),
    "data": ("/data", "시간표·일정"),
    "calendar": ("/schedule", "달력"),
    "validation": ("/validation", "정합성 검증"),
    "optimize": ("/plan", "AI 최적화"),
    "debate": ("/plan?tier=3&debate=1", "에이전트 협의"),
    "plan_daily": ("/plan?tier=3", "3차 일일 검증"),
    "plan_weekly": ("/plan?tier=2", "2차 주간 조정"),
    "plan_semester": ("/plan?tier=1", "1차 학기 계획"),
    "settings": ("/settings", "설정"),
}

_aws: dict = {}
_ack_audio: dict = {}


# ---------------------------------------------------------------- AWS speech services

def _boto(name: str):
    if name not in _aws:
        import boto3

        _aws[name] = boto3.client(name, region_name=REGION)
    return _aws[name]


def stt_url(expires: int = 300) -> str:
    """Presigned WebSocket URL for Amazon Transcribe streaming (the browser sends microphone PCM straight to it).
    Needs transcribe:StartStreamTranscriptionWebSocket on the calling role."""
    import boto3
    from botocore.auth import SigV4QueryAuth
    from botocore.awsrequest import AWSRequest

    creds = boto3.Session().get_credentials()
    if creds is None:
        raise RuntimeError("AWS 자격 증명이 없습니다.")
    url = (f"https://transcribestreaming.{REGION}.amazonaws.com:8443/stream-transcription-websocket"
           f"?language-code=ko-KR&media-encoding=pcm&sample-rate={STT_SAMPLE_RATE}")
    req = AWSRequest(method="GET", url=url)
    SigV4QueryAuth(creds.get_frozen_credentials(), "transcribe", REGION, expires=expires).add_auth(req)
    return req.url.replace("https://", "wss://", 1)


_SPOKEN = [
    (r"ON:D", "온디"), (r"kWh", "킬로와트시"), (r"kW\b", "킬로와트"), (r"℃|°C", "도"), (r"%", "퍼센트"),
    (r"CO₂|CO2", "이산화탄소"), (r"ppm", "피피엠"), (r"PMV", "피엠브이"), (r"\bAI\b", "에이아이"),
    (r"(\d)\s*~\s*(\d)", r"\1에서 \2"), (r"[*_`#>|]", " "),
]


def spoken(text: str) -> str:
    """The same sentence written the way it should be read aloud (units and symbols as Korean words)."""
    t = text
    for pat, rep in _SPOKEN:
        t = re.sub(pat, rep, t)
    t = re.sub(r"(\d),(\d{3})", r"\1\2", t)
    return re.sub(r"\s+", " ", t).strip()[:1500]


def tts(text: str, fmt: str = "mp3") -> tuple[bytes, str]:
    """Amazon Polly, Korean neural voice. Returns (audio bytes, voice id)."""
    last: Exception | None = None
    for voice in POLLY_VOICES:
        try:
            resp = _boto("polly").synthesize_speech(
                Engine="neural", VoiceId=voice, LanguageCode="ko-KR", OutputFormat=fmt, Text=spoken(text),
                **({"SampleRate": str(STT_SAMPLE_RATE)} if fmt == "pcm" else {}))
            return resp["AudioStream"].read(), voice
        except Exception as e:  # voice not offered in this region, or no permission: try the next one
            last = e
    raise last or RuntimeError("no Polly voice configured")


def _audio_b64(text: str) -> dict | None:
    try:
        data, voice = tts(text)
        return {"b64": base64.b64encode(data).decode(), "mime": "audio/mpeg", "voice": voice}
    except Exception as e:
        log.warning("polly failed: %s: %s", type(e).__name__, e)
        return None


def session() -> dict:
    """What the browser needs to start listening: a fresh STT URL and the spoken "네"."""
    out: dict = {"wake": WAKE_WORD, "ack": {"text": ACK_TEXT, "audio": None}, "region": REGION,
                 "stt": {"engine": "Amazon Transcribe", "url": None, "sample_rate": STT_SAMPLE_RATE, "language": "ko-KR"},
                 "llm": {"engine": "Amazon Bedrock", "model": VOICE_MODEL.replace("global.anthropic.", "")},
                 "tts": {"engine": "Amazon Polly", "voice": None}}
    try:
        out["stt"]["url"] = stt_url()
    except Exception as e:
        out["stt"]["error"] = f"{type(e).__name__}"
    if "a" not in _ack_audio:
        _ack_audio["a"] = _audio_b64(ACK_TEXT)
    a = _ack_audio["a"]
    if a:
        out["ack"]["audio"] = a
        out["tts"]["voice"] = a["voice"]
    else:
        _ack_audio.pop("a", None)  # try again next time (permissions may have been added)
        out["tts"]["error"] = "unavailable"
    return out


# ---------------------------------------------------------------- cards (what the screen draws)

def _won(v) -> str:
    return f"{round(v):,}원"


def _pct(base: float, val: float) -> float | None:
    return round((base - val) / base * 100, 1) if base else None


def _hm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _date_label(d: date) -> str:
    return f"{d.month}월 {d.day}일({WEEKDAYS[d.weekday()]})"


def _d(s: str | None, default: date) -> date:
    try:
        return date.fromisoformat(str(s)[:10]) if s else default
    except ValueError:
        return default


# ---------------------------------------------------------------- tools

TOOLS = [
    {
        "name": "get_status",
        "description": "지금 건물 냉난방이 어떻게 돌아가고 있는지: 기준 시각, 가동 중인 강의실과 수업, 외기, 오늘 지금까지 전력(고정 스케줄 대비), "
                       "운전 모드, 승인 대기 조정안, 최근 계획 실행 기록. '지금 어때', '작업 어떻게 돌아가', '현황' 질문에 씁니다.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_savings",
        "description": "절감 효과: 고정 스케줄 대비 AI 운전의 전력·요금·CO₂ 절감과 쾌적도, 절감이 어떤 기능에서 나왔는지. scope는 today(오늘), to_date(학기 시작~오늘), semester(학기 전체 예상).",
        "input_schema": {"type": "object", "properties": {"scope": {"type": "string", "enum": ["today", "to_date", "semester"]}},
                         "required": ["scope"], "additionalProperties": False},
    },
    {
        "name": "explain_plan",
        "description": "최적 시나리오 설명: 그날 계산한 설정온도 시나리오 후보들(전력·요금·PMV·점수)과 선택된 안, 두 에이전트(관리자 온디·사용자 온디) 협의 결과와 협의 전후 비교. date를 비우면 다음 운영일.",
        "input_schema": {"type": "object", "properties": {"date": {"type": ["string", "null"], "description": "YYYY-MM-DD 또는 null"}},
                         "required": ["date"], "additionalProperties": False},
    },
    {
        "name": "make_scenario",
        "description": "다른 시나리오를 새로 만들어 열모델로 바로 계산합니다(적용하지 않음). delta는 수업 있는 모든 강의실 설정온도에 더할 값(℃, 예: -0.5), "
                       "rooms는 강의실별 설정온도 지정. 현재 계획 대비 전력·요금·PMV 변화를 돌려줍니다. 정책 범위를 벗어나는 값은 범위 안으로 맞춥니다.",
        "input_schema": {"type": "object", "properties": {
            "name": {"type": "string", "description": "시나리오 이름 (예: 전체 0.5도 절감)"},
            "delta": {"type": ["number", "null"]},
            "rooms": {"type": "array", "items": {"type": "object", "properties": {
                "room": {"type": "string", "enum": list(config.ROOMS)}, "sp": {"type": "number"}},
                "required": ["room", "sp"], "additionalProperties": False}},
            "date": {"type": ["string", "null"]}},
            "required": ["name", "delta", "rooms", "date"], "additionalProperties": False},
    },
    {
        "name": "simulate_rule",
        "description": "운영 규칙(선행 가동 분, 조기 정지 분 등)을 바꾸면 어떻게 되는지 시뮬레이션합니다(적용하지 않음, 최대 3일). "
                       "키: pre_on_min, early_off_min, gap_merge_min, sp_heat, sp_cool, ai_max_early_off_min.",
        "input_schema": {"type": "object", "properties": {
            "overrides": {"type": "object", "additionalProperties": {"type": "number"}},
            "days": {"type": "integer", "minimum": 1, "maximum": 3}},
            "required": ["overrides", "days"], "additionalProperties": False},
    },
    {
        "name": "run_optimization",
        "description": "운영자가 분명히 실행을 요청했을 때만: negotiate는 두 에이전트 설정온도 협의(약 1분), verify는 3차 일일 검증(시나리오 생성·계산·선택)을 "
                       "백그라운드 작업으로 시작합니다. 결과는 승인 대기 조정안으로 올라갑니다.",
        "input_schema": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["negotiate", "verify"]}},
                         "required": ["kind"], "additionalProperties": False},
    },
    {
        "name": "get_room",
        "description": "강의실 하나의 지금 상태(운전, 예측 실내온도, 수업), 오늘 일정, 설정온도, 최근 쾌적 의견.",
        "input_schema": {"type": "object", "properties": {"room": {"type": "string", "enum": list(config.ROOMS)}},
                         "required": ["room"], "additionalProperties": False},
    },
    {
        "name": "get_feedback",
        "description": "재실자 쾌적 의견 요약(최근 14일): 강의실별 건수, 춥다·덥다·답답하다.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_schedule",
        "description": "특정 날짜의 수업·특별 일정 목록. date를 비우면 기준 날짜.",
        "input_schema": {"type": "object", "properties": {"date": {"type": ["string", "null"]}},
                         "required": ["date"], "additionalProperties": False},
    },
    {
        "name": "open_screen",
        "description": "화면을 그쪽으로 이동시킵니다. 운영자가 '보여줘, 열어줘, 가자, 이동해'처럼 화면을 원할 때 씁니다. "
                       "overview=운영 현황 타임라인, savings=절감 효과, comfort=쾌적 의견, data=시간표·일정 등록, calendar=달력, validation=정합성 검증, "
                       "optimize=AI 최적화(협의 전후 비교), debate=에이전트 협의 대화, plan_daily/plan_weekly/plan_semester=단계별 계획, settings=운영 규칙, home=음성 홈.",
        "input_schema": {"type": "object", "properties": {
            "screen": {"type": "string", "enum": list(SCREENS)},
            "room": {"type": ["string", "null"], "description": "overview에서 강조할 강의실"},
            "date": {"type": ["string", "null"], "description": "화면 기준 날짜를 바꿀 때 YYYY-MM-DD"}},
            "required": ["screen", "room", "date"], "additionalProperties": False},
    },
    {
        "name": "handoff_copilot",
        "description": "일정 등록·휴강·강의실 변경, 운영 규칙 변경 제안처럼 확인 버튼이 필요한 작업은 글 코파일럿 패널로 넘깁니다. prompt는 운영자의 요청을 완결된 문장으로.",
        "input_schema": {"type": "object", "properties": {"prompt": {"type": "string"}},
                         "required": ["prompt"], "additionalProperties": False},
    },
]

TOOL_LABEL = {
    "get_status": "운전 현황 조회", "get_savings": "절감 효과 계산", "explain_plan": "시나리오·협의 결과 조회",
    "make_scenario": "새 시나리오 계산", "simulate_rule": "규칙 시뮬레이션", "run_optimization": "최적화 실행",
    "get_room": "강의실 조회", "get_feedback": "쾌적 의견 조회", "get_schedule": "일정 조회",
    "open_screen": "화면 이동", "handoff_copilot": "코파일럿으로 넘김",
}

STATE_LABEL = {"ON": "가동", "FAN": "송풍", "OFF": "꺼짐"}


def _t_status(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import planning

    live = service.live_snapshot(ctx)
    now = live["now"]
    m = now["minute"]
    rooms = live["rooms"]
    on = [r for r in rooms if r["state"] == "ON"]
    in_class = [r for r in rooms if r["session"]]
    k = live["kwh_so_far"]
    mode = planning.mode()
    pending = planning.adjustments("pending")
    runs = planning.tier_runs()["runs"][:3]
    save = _pct(k.get("fixed", 0), k.get("ai", 0))
    rows = []
    for r in rooms:
        s, nx = r["session"], r["next"]
        sub = (f"{s['title']} · {s['end']}까지" if s else f"다음 {nx['start']} {nx['title']}" if nx else "남은 수업 없음")
        rows.append({"label": f"{r['room']}호", "value": f"{STATE_LABEL[r['state']]} · {r['ta']:.1f}℃", "sub": sub,
                     "tone": "on" if r["state"] == "ON" else "fan" if r["state"] == "FAN" else "off"})
    out["cards"].append({
        "kind": "status", "title": "지금 운전 상황", "subtitle": f"{_date_label(date.fromisoformat(now['date']))} {_hm(m)} · {now['reason']}",
        "to": "/overview", "to_label": "운영 현황에서 보기",
        "stats": [
            {"label": "냉난방 가동", "value": f"{len(on)}", "unit": f"/ {len(rooms)}실"},
            {"label": "수업 중", "value": f"{len(in_class)}", "unit": "실"},
            {"label": "오늘 지금까지", "value": f"{k.get('ai', 0):.1f}", "unit": "kWh",
             "delta": f"고정 스케줄 대비 {save:+.0f}%".replace("+", "−") if save is not None and save > 0 else None, "tone": "good"},
            {"label": "외기", "value": f"{live['outdoor']['t']:.1f}", "unit": "℃"},
        ],
        "rows": rows, "note": "실내온도·전력은 시뮬레이션 값입니다.",
    })
    return {
        "now": f"{now['date']} {_hm(m)}", "clock_note": now["reason"], "rooms_total": len(rooms),
        "running": [r["room"] for r in on], "in_class": [{"room": r["room"], "title": r["session"]["title"], "until": r["session"]["end"],
                                                          "indoor_c": r["ta"]} for r in in_class],
        "outdoor_c": live["outdoor"]["t"], "kwh_so_far": {"ai": k.get("ai"), "fixed_schedule": k.get("fixed")},
        "saving_pct_so_far": save, "operation_mode": "자동 운전" if mode["mode"] == "auto" else "추천 모드(담당자 승인 후 적용)",
        "pending_adjustments": [a["title"] for a in pending[:4]], "pending_count": len(pending),
        "recent_runs": [{"what": planning.RUN_LABEL.get(r.get("tier"), ""), "date": r.get("date"), "at": r.get("at"),
                         "result": (r.get("outcome") or {})} for r in runs],
        "all_values_simulated": True,
    }


SCOPE_LABEL = {"today": "오늘", "to_date": "학기 시작부터 오늘까지", "semester": "학기 전체(예상)"}


def _t_savings(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    scope = inp.get("scope") if inp.get("scope") in SCOPE_LABEL else "to_date"
    if scope == "today":
        live = service.live_snapshot(ctx)
        tot = live["date_summary"]["strategies"]
        label = f"{_date_label(date.fromisoformat(live['now']['date']))} 하루"
    else:
        sm = service.semester_summary(ctx, allow_stale=True)
        tot = sm["totals"]["all" if scope == "semester" else "to_date"]
        label = SCOPE_LABEL[scope]
    fx, ai_, rule = tot.get("fixed") or {}, tot.get("ai") or {}, tot.get("rule") or {}
    if not fx or not ai_:
        return {"error": "절감 효과를 계산할 데이터가 아직 없습니다."}
    dk, dc, dco = fx["kwh"] - ai_["kwh"], fx["cost_krw"] - ai_["cost_krw"], fx["co2_kg"] - ai_["co2_kg"]
    pct = _pct(fx["kwh"], ai_["kwh"])
    top = max(fx["kwh"], 1e-9)
    rows = [{"label": n, "value": f"{v['kwh']:,.0f} kWh",
             "sub": f"{_won(v['cost_krw'])} · 쾌적 {v['comfort_pct']}%" if v.get("comfort_pct") is not None else _won(v["cost_krw"]),
             "bar": v["kwh"] / top, "tone": tone}
            for k_, n, v, tone in (("fixed", "고정 스케줄", fx, "off"), ("rule", "규칙 기반", rule, "fan"), ("ai", "AI 예측 제어", ai_, "on")) if v]
    out["cards"].append({
        "kind": "savings", "title": "절감 효과", "subtitle": f"{label} · 고정 스케줄 대비", "to": "/energy", "to_label": "절감 효과 화면에서 보기",
        "stats": [
            {"label": "전력 절감", "value": f"{pct:.0f}" if pct is not None else "-", "unit": "%", "tone": "good"},
            {"label": "줄인 전력", "value": f"{dk:,.0f}", "unit": "kWh"},
            {"label": "줄인 요금", "value": f"{dc / 10000:,.1f}" if abs(dc) >= 10000 else f"{dc:,.0f}", "unit": "만원" if abs(dc) >= 10000 else "원"},
            {"label": "CO₂", "value": f"{dco:,.0f}", "unit": "kg"},
        ],
        "rows": rows, "note": "같은 날씨·같은 시간표로 다시 시뮬레이션해 비교한 값입니다.",
    })
    res = {"scope": label, "baseline": "고정 스케줄(08:30~22:30)", "saving_pct": pct, "saved_kwh": round(dk, 1), "saved_cost_krw": round(dc),
           "saved_co2_kg": round(dco, 1), "ai": {k_: ai_.get(k_) for k_ in ("kwh", "cost_krw", "comfort_pct")},
           "fixed_schedule": {k_: fx.get(k_) for k_ in ("kwh", "cost_krw", "comfort_pct")}, "simulated": True}
    if scope != "today":
        try:
            at = service.attribution(ctx, allow_stale=True)
            wf = (at or {}).get("all" if scope == "semester" else "to_date", {}).get("waterfall") or []
            steps = [w for w in wf if w.get("delta_kwh")]
            if steps:
                big = max(abs(w["delta_kwh"]) for w in steps) or 1
                out["cards"].append({
                    "kind": "attribution", "title": "절감이 나온 곳", "subtitle": "기능을 하나씩 켜서 다시 계산", "to": "/energy", "to_label": "절감 효과 화면에서 보기",
                    "rows": [{"label": w["label"], "value": f"{w['delta_kwh']:+,.0f} kWh", "bar": abs(w["delta_kwh"]) / big,
                              "tone": "on" if w["delta_kwh"] < 0 else "warn"} for w in steps],
                })
                res["where_savings_come_from"] = [{"feature": w["label"], "delta_kwh": w["delta_kwh"]} for w in steps]
        except Exception as e:  # the breakdown is an extra: the totals above stand on their own
            log.warning("attribution failed: %s", e)
    return res


def _plan_day(inp: dict, ctx: service.Ctx) -> date:
    from . import planning

    return _d(inp.get("date"), planning.plan_date(ctx))


def _t_explain(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import agents, planning

    d = _plan_day(inp, ctx)
    res: dict = {"date": d.isoformat()}
    run = next((r for r in planning.tier_runs()["runs"] if r.get("tier") == 3 and r.get("date") == d.isoformat() and r.get("scenarios")), None)
    if run:
        sc = run["scenarios"]
        cands = [c for c in sc.get("scenarios", []) if c.get("eval")]
        keep = next((c for c in cands if c["id"] == "keep"), None)
        top_kwh = max((c["eval"]["kwh"] for c in cands), default=1) or 1
        rows = []
        for c in sorted(cands, key=lambda c: c["score"]):
            e = c["eval"]
            rows.append({"label": c["name"], "value": f"{e['kwh']:.1f} kWh · {_won(e['cost_krw'])}",
                         "sub": f"{c.get('goal', '')} · PMV {e['pmv_mean']} · 점수 {c['score']:,}",
                         "bar": c["eval"]["kwh"] / top_kwh,
                         "tag": "선택" if c["id"] == sc.get("chosen") else ("에이전트" if c.get("source") == "llm" else None),
                         "tone": "on" if c["id"] == sc.get("chosen") else "off"})
        chosen = next((c for c in cands if c["id"] == sc.get("chosen")), None)
        out["cards"].append({
            "kind": "scenarios", "title": "시나리오 비교", "subtitle": f"{_date_label(d)} · 후보 {len(cands)}개를 열모델로 계산",
            "to": "/plan?tier=3", "to_label": "3차 검증 화면에서 보기", "rows": rows,
            "note": "점수 = 전기요금 + 쾌적 가중치 × PMV 악화. 낮을수록 좋습니다." + ("" if sc.get("ai") else " 이번 실행은 규칙 후보만 계산했습니다."),
        })
        res["scenarios"] = {
            "computed_at": run.get("at"), "chosen": chosen and chosen["name"], "chosen_reason": chosen and chosen.get("rationale"),
            "judge": "요금 + 쾌적 가중치 × PMV 악화 점수가 가장 낮은 안",
            "candidates": [{"name": c["name"], "goal": c.get("goal"), "by": "에이전트 제안" if c.get("source") == "llm" else "규칙 후보",
                            "kwh": c["eval"]["kwh"], "cost_krw": c["eval"]["cost_krw"], "pmv": c["eval"]["pmv_mean"], "score": c["score"],
                            "rooms_changed": len(c.get("changes") or [])} for c in cands],
            "vs_current": keep and chosen and {"kwh": round(chosen["eval"]["kwh"] - keep["eval"]["kwh"], 2),
                                               "cost_krw": chosen["eval"]["cost_krw"] - keep["eval"]["cost_krw"]},
        }
    cmp_ = agents.compare(d)
    if cmp_ and cmp_.get("before") and cmp_.get("after"):
        b, a = cmp_["before"], cmp_["after"]
        changed = {r: (cmp_["base_sp"][r], sp) for r, sp in (cmp_.get("final_sp") or {}).items() if abs(sp - cmp_["base_sp"].get(r, sp)) > 1e-6}
        state = {"applied": "적용됨", "pending": "승인 대기", "rejected": "거절됨", "partial": "일부 적용", "stale": "조건이 바뀜"}.get(cmp_.get("state"), "")
        out["cards"].append({
            "kind": "negotiation", "title": "에이전트 협의 결과", "to": "/plan", "to_label": "AI 최적화에서 보기",
            "subtitle": f"{_date_label(d)} · {cmp_.get('rounds', '?')}라운드 · {'합의' if cmp_.get('agreed') else '점수 판정'}{' · ' + state if state else ''}",
            "stats": [
                {"label": "전력", "value": f"{a['kwh']:.1f}", "unit": "kWh", "delta": f"협의 전 {b['kwh']:.1f}"},
                {"label": "요금", "value": f"{a['cost_krw']:,}", "unit": "원", "delta": f"{a['cost_krw'] - b['cost_krw']:+,}원"},
                {"label": "쾌적 범위", "value": f"{a['comfort_pct']:.0f}", "unit": "%", "delta": f"PMV {b['pmv_mean']} → {a['pmv_mean']}"},
            ],
            "rows": [{"label": f"{r}호", "value": f"{o:.1f} → {n:.1f}℃", "tone": "warn" if n > o else "on",
                      "sub": "더 따뜻하게" if (n > o) == (cmp_.get("season") == "heat") else "절감"} for r, (o, n) in sorted(changed.items())][:10],
        })
        res["negotiation"] = {"summary": cmp_.get("summary"), "agreed": cmp_.get("agreed"), "rounds": cmp_.get("rounds"), "status": state,
                              "before": {k_: b.get(k_) for k_ in ("kwh", "cost_krw", "comfort_pct", "pmv_mean")},
                              "after": {k_: a.get(k_) for k_ in ("kwh", "cost_krw", "comfort_pct", "pmv_mean")},
                              "setpoint_changes": {r: f"{o}→{n}" for r, (o, n) in changed.items()}}
    if len(res) == 1:
        res["none"] = "이 날짜에는 아직 시나리오 계산이나 에이전트 협의를 실행하지 않았습니다. 운영자가 원하면 run_optimization으로 실행할 수 있습니다."
    return res


def _t_scenario(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import agents, planning, scenarios

    d = _plan_day(inp, ctx)
    ds = agents.build_dossier(3, d, ctx)
    if not ds["rooms"]:
        return {"error": f"{d.isoformat()}에는 수업이 있는 강의실이 없어 시나리오를 계산할 수 없습니다."}
    key = ds["key"]
    sps = dict(ds["base_sp"])
    delta = inp.get("delta")
    if delta:
        sps = {r: scenarios._snap(ds, v + float(delta)) for r, v in sps.items()}
    skipped = []
    for x in inp.get("rooms") or []:
        r = str(x.get("room", "")).replace("호", "").strip()
        if r in sps:
            sps[r] = scenarios._snap(ds, x.get("sp", sps[r]))
        else:
            skipped.append(r)
    extra = {r: {key: sp} for r, sp in sps.items() if abs(sp - ds["base_sp"][r]) > 1e-6}
    dates = [date.fromisoformat(x) for x in ds["dates"]]
    base = planning.evaluate(dates, ctx, None, ds["feedback"])
    new = planning.evaluate(dates, ctx, extra, ds["feedback"]) if extra else base
    hot = agents.complaint_rooms(ds)

    def score(ev):
        return round(sum(agents._room_score(ds, r, {"kwh": ev["rooms"][r]["kwh"], "pmv": ev["rooms"][r]["pmv"]}, hot, len(dates))
                         for r in ds["rooms"] if r in ev["rooms"]))

    s0, s1 = score(base), score(new)
    lab = "난방" if ds["season"] == "heat" else "냉방"
    name = str(inp.get("name") or "새 시나리오")[:40]
    dk, dc = round(new["kwh"] - base["kwh"], 2), int(new["cost_krw"] - base["cost_krw"])
    out["cards"].append({
        "kind": "scenario", "title": f"새 시나리오 · {name}", "to": "/plan?tier=3", "to_label": "3차 검증 화면에서 비교",
        "subtitle": f"{_date_label(d)} · {lab} 설정온도 {len(extra)}곳 변경 · 계산만 했고 적용하지 않았습니다",
        "stats": [
            {"label": "전력", "value": f"{new['kwh']:.1f}", "unit": "kWh", "delta": f"{dk:+.1f} kWh", "tone": "good" if dk < 0 else "warn" if dk > 0 else None},
            {"label": "요금", "value": f"{new['cost_krw']:,}", "unit": "원", "delta": f"{dc:+,}원"},
            {"label": "평균 PMV", "value": f"{new['pmv_mean']}", "delta": f"현재 {base['pmv_mean']}"},
            {"label": "점수", "value": f"{s1:,}", "delta": f"현재 계획 {s0:,}", "tone": "good" if s1 < s0 else "warn" if s1 > s0 else None},
        ],
        "rows": [{"label": f"{r}호", "value": f"{ds['base_sp'][r]:.1f} → {v[key]:.1f}℃",
                  "sub": f"PMV {base['rooms'].get(r, {}).get('pmv')} → {new['rooms'].get(r, {}).get('pmv')}",
                  "tone": "on" if v[key] < ds["base_sp"][r] else "warn"} for r, v in sorted(extra.items())][:10],
        "note": f"설정 가능 범위 {ds['lo']}~{ds['hi']}℃. 점수는 요금 + 쾌적 가중치 × PMV 악화이며 낮을수록 좋습니다.",
    })
    return {"name": name, "date": d.isoformat(), "applied": False, "season": lab, "allowed_range_c": [ds["lo"], ds["hi"]],
            "rooms_changed": {r: f"{ds['base_sp'][r]}→{v[key]}" for r, v in extra.items()}, "rooms_without_class_skipped": skipped,
            "current_plan": {"kwh": base["kwh"], "cost_krw": base["cost_krw"], "pmv_mean": base["pmv_mean"], "score": s0},
            "this_scenario": {"kwh": new["kwh"], "cost_krw": new["cost_krw"], "pmv_mean": new["pmv_mean"], "score": s1,
                              "cold_rooms": new["cold_rooms"], "hot_rooms": new["hot_rooms"]},
            "delta": {"kwh": dk, "cost_krw": dc}, "better_than_current": s1 < s0,
            "score_meaning": "요금 + 쾌적 가중치 × PMV 악화, 낮을수록 좋음"}


RULE_LABEL = {"pre_on_min": "선행 가동(분)", "early_off_min": "조기 정지(분)", "gap_merge_min": "연속 유지 간격(분)", "sp_heat": "난방 설정(℃)",
              "sp_cool": "냉방 설정(℃)", "ai_max_early_off_min": "AI 최대 조기 정지(분)", "comfort_low": "쾌적 하한(℃)", "comfort_high": "쾌적 상한(℃)"}


def _t_rule(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import planning

    d0 = planning.plan_date(ctx)
    n = max(1, min(int(inp.get("days") or 1), 3))
    res = service.what_if(inp.get("overrides") or {}, [d0 + timedelta(days=i) for i in range(n)])
    b, w = res["base"].get("ai") or {}, res["new"].get("ai") or {}
    if not b or not w:
        return {"error": "시뮬레이션 결과가 없습니다."}
    dk = round(w["kwh"] - b["kwh"], 1)
    out["cards"].append({
        "kind": "rule", "title": "규칙 변경 시뮬레이션", "to": "/settings", "to_label": "설정에서 보기",
        "subtitle": ", ".join(f"{RULE_LABEL.get(k_, k_)} {v}" for k_, v in res["overrides"].items()) + f" · {n}일 · 적용하지 않았습니다",
        "stats": [
            {"label": "전력", "value": f"{w['kwh']:.1f}", "unit": "kWh", "delta": f"{dk:+.1f} kWh", "tone": "good" if dk < 0 else "warn" if dk > 0 else None},
            {"label": "쾌적 범위", "value": f"{w['comfort_pct']}", "unit": "%", "delta": f"현재 {b['comfort_pct']}%"},
            {"label": "수업 시작 저온·고온", "value": f"{w['cold_starts']}", "unit": "회", "delta": f"현재 {b['cold_starts']}회"},
        ],
    })
    return {"overrides": res["overrides"], "days": n, "applied": False, "current": b, "changed": w, "delta_kwh": dk}


def _t_run(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import planning

    d = planning.plan_date(ctx)
    kind = inp.get("kind")
    if kind == "negotiate":
        job = jobs.create("negotiate", {"tier": 3, "date": d.isoformat()})
        title, to, eta = "에이전트 협의 실행 중", "/plan", "약 1분"
    else:
        job = jobs.create("tier_run", {"tier": 3, "date": d.isoformat(), "actor": "운영자(음성)"})
        title, to, eta = "3차 일일 검증 실행 중", "/plan?tier=3", "10~20초"
    out["cards"].append({"kind": "job", "title": title, "subtitle": f"{_date_label(d)} · {eta}", "to": to, "to_label": "진행 화면 보기",
                         "job": {"id": job["id"], "kind": "negotiate" if kind == "negotiate" else "tier_run"}})
    return {"started": True, "job": job["id"], "date": d.isoformat(), "takes": eta,
            "note": "결과는 승인 대기 조정안으로 올라가며, 끝나면 화면 카드가 알려 줍니다."}


def _t_room(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import planning

    r = str(inp.get("room", "")).replace("호", "").strip()
    if r not in config.ROOMS:
        return {"error": f"{r}호는 관리 대상 강의실이 아닙니다. 대상: {', '.join(config.ROOMS)}"}
    live = service.live_snapshot(ctx)
    d = date.fromisoformat(live["now"]["date"])
    lr = next(x for x in live["rooms"] if x["room"] == r)
    day = service.get_day(d, ctx)
    sess = sorted((s for s in day["sessions"] if s["room"] == r), key=lambda s: s["start"])
    rr = day["strategies"]["ai"]["rooms"][r]
    fx = day["strategies"]["fixed"]["rooms"][r]
    fb = planning.feedback_summary(14, r)["by_room"].get(r) or {}
    sp_h, sp_c = planning._base_sp(d, r, ctx)
    season = planning.season_for([d], ctx)
    sp = sp_h if season == "heat" else sp_c
    out["cards"].append({
        "kind": "room", "title": f"{r}호 · {config.ROOMS[r]['type_label']}", "to": f"/overview?room={r}", "to_label": "타임라인에서 보기",
        "subtitle": f"{_date_label(d)} {_hm(live['now']['minute'])} · 정원 {config.ROOMS[r]['capacity']}명",
        "stats": [
            {"label": "운전", "value": STATE_LABEL[lr["state"]], "tone": "good" if lr["state"] == "ON" else None},
            {"label": "예측 실내", "value": f"{lr['ta']:.1f}", "unit": "℃"},
            {"label": "설정", "value": f"{sp:.1f}", "unit": "℃"},
            {"label": "오늘 전력", "value": f"{rr['kwh']:.1f}", "unit": "kWh", "delta": f"고정 {fx['kwh']:.1f}"},
        ],
        "rows": [{"label": f"{s['start']}–{s['end']}", "value": s["title"], "sub": f"{s['expected_people']}명",
                  "tone": "on" if lr["session"] and lr["session"]["start"] == s["start"] else "off"} for s in sess][:8],
        "note": (f"최근 14일 의견 {fb['n']}건 (춥다 {fb['cold']} · 덥다 {fb['hot']} · 답답 {fb['stuffy']})" if fb.get("n") else "최근 14일 쾌적 의견이 없습니다."),
    })
    return {"room": r, "type": config.ROOMS[r]["type_label"], "state": STATE_LABEL[lr["state"]], "indoor_c_simulated": lr["ta"],
            "setpoint_c": sp, "in_class": lr["session"] and lr["session"]["title"], "next": lr["next"] and f"{lr['next']['start']} {lr['next']['title']}",
            "sessions_today": [f"{s['start']}-{s['end']} {s['title']}({s['expected_people']}명)" for s in sess],
            "kwh_today": {"ai": rr["kwh"], "fixed_schedule": fx["kwh"]},
            "feedback_14d": {k_: fb.get(k_) for k_ in ("n", "cold", "hot", "stuffy", "mean")} if fb else None}


def _t_feedback(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    from . import planning

    fs = planning.feedback_summary(14)
    br = fs["by_room"]
    top = max((b["n"] for b in br.values()), default=1)
    order = sorted(br.items(), key=lambda kv: -kv[1]["n"])
    total = sum(b["n"] for b in br.values())
    real = sum(1 for f in fs["items"] if f.get("source") != "simulated")
    out["cards"].append({
        "kind": "feedback", "title": "쾌적 의견", "subtitle": f"최근 14일 · {total}건", "to": "/comfort", "to_label": "쾌적 의견에서 보기",
        "stats": [{"label": "춥다", "value": str(sum(b["cold"] for b in br.values())), "unit": "건"},
                  {"label": "덥다", "value": str(sum(b["hot"] for b in br.values())), "unit": "건"},
                  {"label": "답답하다", "value": str(sum(b["stuffy"] for b in br.values())), "unit": "건"}],
        "rows": [{"label": f"{r}호", "value": f"{b['n']}건", "sub": f"춥다 {b['cold']} · 덥다 {b['hot']} · 답답 {b['stuffy']}", "bar": b["n"] / top,
                  "tone": "fan" if b["cold"] > b["hot"] else "warn" if b["hot"] > b["cold"] else "off"} for r, b in order][:10],
        "note": "시뮬레이션으로 만든 가상 의견이 섞여 있습니다." if real < total else None,
    })
    return {"days": 14, "total": total, "real_votes": real, "simulated_votes": total - real,
            "by_room": {r: {k_: b[k_] for k_ in ("n", "cold", "hot", "stuffy", "mean")} for r, b in order}}


def _t_schedule(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    d = _d(inp.get("date"), date.fromisoformat(service.effective_now(ctx)["date"]))
    sess = sorted(sessions_for_date(d, ctx.courses, ctx.events), key=lambda s: (s["start"], s["room"]))
    evs = [e for e in ctx.events if e.get("date") == d.isoformat()]
    rooms = sorted({s["room"] for s in sess})
    out["cards"].append({
        "kind": "schedule", "title": f"{_date_label(d)} 일정", "subtitle": f"수업 {len(sess)}회 · 강의실 {len(rooms)}곳 · 특별 일정 {len(evs)}건",
        "to": "/schedule", "to_label": "달력에서 보기", "date": d.isoformat(),
        "rows": [{"label": f"{s['start']}–{s['end']}", "value": f"{s['room']}호 {s['title']}", "sub": f"{s['expected_people']}명",
                  "tag": "특별" if s.get("kind") == "event" else None, "tone": "warn" if s.get("kind") == "event" else "off"} for s in sess][:12],
        "note": f"외 {len(sess) - 12}회" if len(sess) > 12 else None,
    })
    return {"date": d.isoformat(), "weekday": WEEKDAYS[d.weekday()], "sessions": len(sess), "rooms": rooms,
            "first": sess[0]["start"] if sess else None, "last": max((s["end"] for s in sess), default=None),
            "special_events": [service.describe_event(e) for e in evs][:6],
            "list": [f"{s['start']}-{s['end']} {s['room']}호 {s['title']}" for s in sess][:30]}


def _t_open(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    path, label = SCREENS.get(inp.get("screen"), SCREENS["overview"])
    room = str(inp.get("room") or "").replace("호", "").strip()
    if inp.get("screen") == "overview" and room in config.ROOMS:
        path += f"?room={room}"
    nav = {"to": path, "label": label}
    if inp.get("date"):
        try:
            nav["date"] = date.fromisoformat(str(inp["date"])[:10]).isoformat()
        except ValueError:
            pass
    out["navigate"] = nav
    return {"opened": label}


def _t_handoff(inp: dict, out: dict, ctx: service.Ctx) -> dict:
    out["copilot"] = str(inp.get("prompt") or "")[:500]
    return {"status": "코파일럿 패널이 열려 요청을 이어받았습니다. 초안은 담당자가 확인을 눌러야 적용됩니다."}


_RUN = {"get_status": _t_status, "get_savings": _t_savings, "explain_plan": _t_explain, "make_scenario": _t_scenario,
        "simulate_rule": _t_rule, "run_optimization": _t_run, "get_room": _t_room, "get_feedback": _t_feedback,
        "get_schedule": _t_schedule, "open_screen": _t_open, "handoff_copilot": _t_handoff}


def run_tool(name: str, inp: dict, out: dict, ctx: service.Ctx | None = None) -> dict:
    fn = _RUN.get(name)
    if not fn:
        return {"error": f"unknown tool {name}"}
    out.setdefault("cards", [])
    return fn(inp or {}, out, ctx or service.Ctx())


# ---------------------------------------------------------------- the agent

def system_prompt(now: dict, page: str | None, day: str | None, memos: list[str] | None = None) -> str:
    screens = ", ".join(f"{k}={v[1]}" for k, v in SCREENS.items())
    evidence = ""
    if memos:
        evidence = ("\n\n앞선 답변들은 그때 도구로 조회한 아래 결과에 근거했습니다. 앞선 답을 의심하거나 정정·사과하지 말고, "
                    "같은 내용을 다시 물으면 아래 값을 그대로 쓰거나 새로 조회합니다.\n" + "\n".join(memos))
    return (
        "당신은 '온디'입니다. 건물 냉난방 운영 서비스 ON:D의 음성 비서이고, 상대는 부산대학교 IT관 시설 담당자입니다. "
        "담당자가 \"온디\"라고 부른 뒤 말로 묻고, 당신의 답은 음성으로 읽힙니다.\n\n"
        "말하는 방식:\n"
        "- 한국어 존댓말로, 사람이 말하듯 짧게 답합니다. 두 문장 이내, 합쳐서 80자 안팎입니다. 더 궁금해하면 그때 이어서 말합니다.\n"
        "- 목록, 표, 마크다운, 이모지, 괄호를 쓰지 않습니다. 화면에 카드가 함께 뜨므로 강의실 번호나 숫자를 나열하지 않고 가장 중요한 숫자 한두 개만 말합니다.\n"
        "- 수치는 반드시 이번 대화의 도구 결과에 있는 값만 말합니다. 도구 없이 수치를 말하지 않습니다. 실내온도·전력·요금은 시뮬레이션 값입니다.\n"
        "- 도구 이름이나 내부 키를 말하지 않습니다. '고정 스케줄', 'AI 예측 제어', '관리자 온디', '사용자 온디'처럼 화면의 이름을 씁니다.\n"
        "- 호출어(\"온디\", \"헤이 온디\")를 답에 넣지 않습니다.\n\n"
        "일하는 방식:\n"
        "- 데이터 질문에는 되묻지 말고 먼저 도구로 조회합니다. 음성 인식이 틀릴 수 있으니('언디', '온 디', 숫자 띄어 읽기) 의도를 너그럽게 해석합니다.\n"
        "- 현황은 get_status, 절감 효과는 get_savings, 최적 시나리오·협의 설명은 explain_plan, 다른 시나리오를 만들어 보라는 요청은 make_scenario를 씁니다.\n"
        "- 담당자가 화면을 보여 달라거나 이동하자고 하면 open_screen을 부릅니다. 설명만 원하면 화면을 옮기지 않습니다. "
        "설명과 화면을 함께 원하면 데이터 도구와 open_screen을 같이 부릅니다.\n"
        "- run_optimization은 담당자가 실행을 분명히 말했을 때만 부릅니다. 계산은 됐지만 적용되지 않은 것은 '적용했다'고 말하지 않습니다.\n"
        "- 일정 등록·휴강·규칙 변경처럼 확인 버튼이 필요한 일은 handoff_copilot으로 넘기고, 넘겼다고 말합니다.\n"
        "- 못 알아들었거나 건물 운영과 무관한 말이면 한 문장으로 다시 묻습니다.\n\n"
        f"기준 시각: {now['date']} {now['minute'] // 60:02d}:{now['minute'] % 60:02d} ({now['reason']}). "
        f"담당자가 보고 있는 화면: {page or '/'}. 화면 기준 날짜: {day or now['date']}. 강의실: {', '.join(config.ROOMS)}.\n"
        f"이동할 수 있는 화면: {screens}." + evidence
    )


def _fallback(text: str, out: dict, ctx: service.Ctx) -> str:
    """No model: route by keyword to one tool and answer from a template (same cards as the model path)."""
    t = text.replace(" ", "")
    m = re.search(r"(\d{3})호?", t)
    if any(k in t for k in ("절감", "아꼈", "아낀", "효과", "요금")):
        r = run_tool("get_savings", {"scope": "today" if "오늘" in t else "semester" if "학기전체" in t else "to_date"}, out, ctx)
        if "error" in r:
            return r["error"]
        return f"{r['scope']} 기준으로 고정 스케줄보다 전력을 {r['saving_pct']}% 줄였고, 요금으로는 {_won(r['saved_cost_krw'])}입니다."
    if any(k in t for k in ("시나리오", "협의", "최적")):
        if any(k in t for k in ("다른", "새", "만들", "생성")):
            r = run_tool("make_scenario", {"name": "전체 0.5도 절감", "delta": -0.5, "rooms": [], "date": None}, out, ctx)
            if "error" in r:
                return r["error"]
            return (f"모든 강의실을 0.5도 아끼는 시나리오를 계산했습니다. 현재 계획보다 전력 {r['delta']['kwh']:+.1f} kWh, "
                    f"평균 PMV는 {r['current_plan']['pmv_mean']}에서 {r['this_scenario']['pmv_mean']}입니다. 적용하지는 않았습니다.")
        r = run_tool("explain_plan", {"date": None}, out, ctx)
        if r.get("scenarios"):
            return f"후보 {len(r['scenarios']['candidates'])}개 가운데 '{r['scenarios']['chosen']}' 안이 요금과 쾌적 점수가 가장 낮아 선택됐습니다."
        if r.get("negotiation"):
            return str(r["negotiation"]["summary"])[:160]
        return "이 날짜에는 아직 시나리오 계산이나 협의를 실행하지 않았습니다."
    if m and m.group(1) in config.ROOMS:
        r = run_tool("get_room", {"room": m.group(1)}, out, ctx)
        return f"{r['room']}호는 지금 {r['state']} 상태이고 예측 실내온도는 {r['indoor_c_simulated']:.1f}도입니다."
    if any(k in t for k in ("의견", "춥", "덥", "민원")):
        r = run_tool("get_feedback", {}, out, ctx)
        return f"최근 14일 동안 쾌적 의견이 {r['total']}건 들어왔습니다."
    if any(k in t for k in ("일정", "시간표", "수업")):
        r = run_tool("get_schedule", {"date": None}, out, ctx)
        return f"{r['date']}에는 수업이 {r['sessions']}회 있습니다."
    r = run_tool("get_status", {}, out, ctx)
    return (f"지금 {r['rooms_total']}개 강의실 가운데 {len(r['running'])}곳에서 냉난방이 돌고 있고, "
            f"오늘 지금까지 {r['kwh_so_far']['ai']:.1f} kWh를 썼습니다.")


def turn(history: list[dict], page: str | None = None, day: str | None = None, speak: bool = True) -> dict:
    """One spoken exchange. history: [{role, content, memo?}], last is the operator's utterance.
    memo is what an earlier answer was based on (returned by that turn, sent back by the client)."""
    ctx = service.Ctx()
    now = service.effective_now(ctx)
    msgs = [{"role": m["role"], "content": m["content"]} for m in history if m.get("content")][-10:]
    memos = [str(m["memo"])[:2500] for m in history if m.get("role") == "assistant" and m.get("memo")][-3:]
    system = system_prompt(now, page, day, memos)
    out: dict = {"steps": [], "cards": [], "navigate": None, "copilot": None, "ai": True}
    evidence: list[str] = []
    say = None
    try:
        for _ in range(4):
            ai._charge()
            resp = ai.client().with_options(timeout=30.0, max_retries=1).messages.create(
                model=VOICE_MODEL, max_tokens=1500, system=system, tools=TOOLS, messages=msgs,
                output_config={"effort": "low"},
            )
            if resp.stop_reason == "refusal":
                say = "그 요청은 도와드릴 수 없습니다."
                break
            uses = [b for b in resp.content if b.type == "tool_use"]
            if not uses:
                say = ai._text(resp).strip()
                break
            msgs.append({"role": "assistant", "content": resp.content})
            results = []
            for tu in uses:
                step = {"tool": tu.name, "label": TOOL_LABEL.get(tu.name, tu.name), "input": tu.input}
                out["steps"].append(step)
                try:
                    res = run_tool(tu.name, tu.input, out, ctx)
                    step["ok"] = "error" not in res
                    if tu.name not in ("open_screen", "handoff_copilot"):
                        evidence.append(f"- {TOOL_LABEL.get(tu.name, tu.name)} {json.dumps(tu.input, ensure_ascii=False)}: "
                                        + json.dumps(res, ensure_ascii=False, default=str)[:1100])
                    results.append({"type": "tool_result", "tool_use_id": tu.id,
                                    "content": json.dumps(res, ensure_ascii=False, default=str)[:20000]})
                except Exception as e:  # tool failures go back to the model
                    log.warning("voice tool %s failed: %s: %s", tu.name, type(e).__name__, e)
                    step["ok"] = False
                    results.append({"type": "tool_result", "tool_use_id": tu.id, "content": f"오류: {e}", "is_error": True})
            msgs.append({"role": "user", "content": results})
        else:
            say = "확인할 것이 많아 한 번에 답하지 못했습니다. 질문을 조금 좁혀 주세요."
        ai.record_status(True)
    except ai.QuotaExceeded:
        raise
    except Exception as e:
        if ai.is_outage(e):
            ai.record_status(False, type(e).__name__)
        log.warning("voice model failed: %s: %s", type(e).__name__, e)
        out.update(ai=False, steps=[], cards=[], navigate=None, copilot=None)
        say = _fallback(msgs[-1]["content"] if msgs and isinstance(msgs[-1]["content"], str) else history[-1]["content"], out, ctx)
        out["steps"] = [{"tool": "fallback", "label": "키워드 응답 (AI 연결 불가)", "ok": True}]
    out["say"] = say or "죄송합니다, 다시 한 번 말씀해 주세요."
    out["memo"] = "\n".join(evidence)[:2500] or None
    out["audio"] = _audio_b64(out["say"]) if speak else None
    return out
