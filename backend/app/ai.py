"""Generative AI features on Amazon Bedrock (Anthropic SDK, AnthropicBedrock client).

- parse_event:        natural language -> event draft            (Claude Haiku 5.5, structured output)
- extract_timetable:  timetable image -> course records           (Claude Sonnet 5.5, structured output)
- copilot:            operator chat with tools (analysis, what-if simulation, proposals)
                                                                  (Claude Sonnet 5.5, manual tool loop)
Numeric control never runs through the LLM; tools call the deterministic engine.
"""
from __future__ import annotations

import base64
import json
import os
from datetime import date, timedelta

from hvac import config
from hvac.timetable import WEEKDAYS

from . import service
from .store import get_store

SONNET = os.environ.get("MODEL_SONNET", "global.anthropic.claude-sonnet-5-5")
HAIKU = os.environ.get("MODEL_HAIKU", "global.anthropic.claude-haiku-5-5")
DAILY_CALL_CAP = int(os.environ.get("LLM_DAILY_CAP", "600"))

_client = None


class QuotaExceeded(Exception):
    pass


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.AnthropicBedrock(aws_region=os.environ.get("BEDROCK_REGION", "ap-northeast-2"), timeout=120.0)
    return _client


def _norm(text: str) -> str:
    import re

    return re.sub(r"\s+", " ", text.strip().lower())[:300]


def record_status(ok: bool, err: str | None = None) -> None:
    try:
        _record_status(ok, err)
    except Exception:
        pass


def _record_status(ok: bool, err: str | None = None) -> None:
    st = get_store().get_item("meta", "ai_status") or {}
    now = service.now_kst().isoformat(timespec="seconds")
    if ok:
        st.update(last_ok=now, ok=True)
    else:
        st.update(last_error=now, error=(err or "")[:200], ok=False)
    get_store().put_item("meta", "ai_status", st)


def _cache_id(text: str) -> str:
    import hashlib

    # same-day only: relative dates ("내일", "다음 주") and live data change from day to day
    return hashlib.sha1(f"{service.now_kst().date().isoformat()}|{_norm(text)}".encode()).hexdigest()[:16]


def cache_put(kind: str, text: str, result: dict) -> None:
    try:
        get_store().put_item(f"aicache-{kind}", _cache_id(text),
                             {"q": _norm(text), "result": result, "at": service.now_kst().isoformat(timespec="seconds")})
    except Exception:
        pass  # a cache write must never discard a paid, successful answer


def cache_get(kind: str, text: str) -> dict | None:
    it = get_store().get_item(f"aicache-{kind}", _cache_id(text))
    return it and {**it["result"], "cached_at": it["at"], "from_cache": True}


def is_outage(e: Exception) -> bool:
    """True for service-side failures (credentials, network, throttling, 5xx); False for bad input."""
    import anthropic

    if isinstance(e, (anthropic.BadRequestError, anthropic.UnprocessableEntityError, anthropic.NotFoundError)):
        return False
    return True


EMPTY_CHECK = {"ok": False, "conflicts": [], "capacity_ok": True, "capacity": None, "alternatives": []}


def _charge():
    n = get_store().incr("usage", service.now_kst().date().isoformat(), "calls")
    if n > DAILY_CALL_CAP:
        raise QuotaExceeded("오늘의 AI 호출 한도를 초과했습니다.")


def _text(resp) -> str:
    if resp.stop_reason == "refusal":
        raise RuntimeError("모델이 요청을 처리하지 않았습니다(refusal).")
    return "".join(b.text for b in resp.content if b.type == "text")


def _course_catalog() -> str:
    lines = []
    for c in service.courses():
        lines.append(f"{c['id']}|{c['room']}|{WEEKDAYS[c['weekday']]}|{c['start']}-{c['end']}|{c['class_name']}|{c.get('professor', '')}")
    return "\n".join(lines)


# ---------------------------------------------------------------- event parsing

EVENT_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["add", "cancel", "move", "closure"]},
        "date": {"type": "string", "description": "YYYY-MM-DD"},
        "room": {"type": ["string", "null"], "description": "강의실 번호, 예: 405"},
        "start": {"type": ["string", "null"], "description": "HH:MM"},
        "end": {"type": ["string", "null"], "description": "HH:MM"},
        "title": {"type": "string"},
        "expected_people": {"type": ["integer", "null"]},
        "course_id": {"type": ["string", "null"], "description": "휴강·강의실 변경 대상 강의 ID"},
        "new_room": {"type": ["string", "null"]},
        "clarification": {"type": ["string", "null"], "description": "모호하면 확인할 질문, 아니면 null"},
    },
    "required": ["type", "date", "room", "start", "end", "title", "expected_people", "course_id", "new_room", "clarification"],
    "additionalProperties": False,
}


def parse_event(text: str) -> dict:
    _charge()
    today = service.now_kst().date()
    rooms = ", ".join(f"{r}({v['type_label']}, 정원 {v['capacity']})" for r, v in config.ROOMS.items())
    system = (
        "당신은 대학 건물 냉난방 운영 시스템의 일정 입력 도우미입니다. 운영자가 자연어로 적은 일정 변경을 이벤트 하나로 변환합니다.\n"
        f"오늘은 {today.isoformat()} ({WEEKDAYS[today.weekday()]})입니다. 학기: {config.SEMESTER['start']} ~ {config.SEMESTER['end']}.\n"
        f"건물: IT관. 강의실: {rooms}.\n"
        "이벤트 유형: add(시간표 밖 일정 추가: 보강·행사·시험·세미나), cancel(휴강: 해당 날짜의 강의 하나를 course_id로 지정), "
        "move(강의실 변경: course_id와 new_room), closure(건물 휴관: 그날 전체).\n"
        "날짜가 요일만 있으면 오늘 이후 가장 가까운 날짜로 정합니다. 휴강·강의실 변경은 아래 강의 목록에서 요일·강의실·과목명이 맞는 course_id를 고릅니다.\n"
        "정보가 부족해 확정할 수 없으면 clarification에 짧은 질문을 넣고, 나머지는 가능한 만큼 채웁니다.\n\n"
        "강의 목록(id|강의실|요일|시간|과목|교수):\n" + _course_catalog()
    )
    resp = client().with_options(timeout=40.0, max_retries=1).messages.create(
        model=HAIKU,
        max_tokens=2000,
        system=system,
        messages=[{"role": "user", "content": text}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": EVENT_SCHEMA}},
    )
    ev = json.loads(_text(resp))
    return {k: v for k, v in ev.items() if v is not None or k in ("clarification",)}


# ---------------------------------------------------------------- timetable image extraction

TIMETABLE_SCHEMA = {
    "type": "object",
    "properties": {
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "building": {"type": "string"},
                    "room": {"type": "string"},
                    "weekday": {"type": "string", "enum": ["월", "화", "수", "목", "금", "토"]},
                    "start": {"type": "string", "description": "HH:MM"},
                    "end": {"type": "string", "description": "HH:MM"},
                    "class_name": {"type": "string"},
                    "professor": {"type": "string"},
                    "grade": {"type": "string"},
                    "expected_people": {"type": ["integer", "null"]},
                },
                "required": ["building", "room", "weekday", "start", "end", "class_name", "professor", "grade", "expected_people"],
                "additionalProperties": False,
            },
        },
        "notes": {"type": "string"},
    },
    "required": ["records", "notes"],
    "additionalProperties": False,
}


def extract_timetable(data: bytes, media_type: str, hint: str = "") -> dict:
    _charge()
    content = []
    if media_type == "application/pdf":
        content.append({"type": "document", "source": {"type": "base64", "media_type": media_type,
                                                       "data": base64.b64encode(data).decode()}})
    else:
        content.append({"type": "image", "source": {"type": "base64", "media_type": media_type,
                                                    "data": base64.b64encode(data).decode()}})
    content.append({"type": "text", "text": (
        "이 강의 시간표에서 모든 강의를 추출하세요. 같은 강의가 연속된 칸에 걸쳐 있으면 하나의 블록(시작~종료)으로 합칩니다. "
        "요일별로 따로 기록합니다. 시간은 24시간제 HH:MM. 건물이 보이지 않으면 'IT관'. 수강 인원이 없으면 null. "
        "셀 형식이 '과목명(코드)-분반,교수,전공,학년'이면 과목명에 코드와 분반은 넣지 않습니다. " + hint)})
    resp = client().messages.create(
        model=SONNET,
        max_tokens=32000,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": TIMETABLE_SCHEMA}},
    )
    return json.loads(_text(resp))


# ---------------------------------------------------------------- copilot

TOOLS = [
    {
        "name": "get_overview",
        "description": "학기 전체와 오늘까지의 전략별 전력량(kWh)·요금·CO2·쾌적도, AI 판단 유형별 횟수, 기준 시각을 돌려줍니다.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "get_day",
        "description": "특정 날짜의 강의 세션, 전략별 전력량·쾌적도, AI 판단(최적 기동·생략·외기냉방·관성정지 등)과 정합성 이슈를 돌려줍니다.",
        "input_schema": {"type": "object", "properties": {"date": {"type": "string", "description": "YYYY-MM-DD"}},
                         "required": ["date"], "additionalProperties": False},
    },
    {
        "name": "get_room_week",
        "description": "강의실 하나의 7일간 일별 강의 수, AI/규칙/현재 운영 전력량, 쾌적도를 돌려줍니다.",
        "input_schema": {"type": "object", "properties": {
            "room": {"type": "string", "enum": list(config.ROOMS)},
            "start_date": {"type": "string", "description": "YYYY-MM-DD"}},
            "required": ["room", "start_date"], "additionalProperties": False},
    },
    {
        "name": "simulate_policy",
        "description": "운영 규칙을 바꾸면 어떻게 되는지 시뮬레이터로 검증합니다(최대 7일). 현재 규칙과 변경 규칙의 전략별 kWh·쾌적도·불쾌지표를 비교해서 돌려줍니다.",
        "input_schema": {"type": "object", "properties": {
            "overrides": {"type": "object", "description": "바꿀 규칙. 키: pre_on_min, early_off_min, gap_merge_min, sp_heat, sp_cool, comfort_low, comfort_high, ai_max_early_off_min",
                          "additionalProperties": {"type": "number"}},
            "start_date": {"type": "string"}, "days": {"type": "integer", "minimum": 1, "maximum": 7}},
            "required": ["overrides", "start_date", "days"], "additionalProperties": False},
    },
    {
        "name": "propose_policy",
        "description": "시뮬레이터로 검증한 규칙 변경을 운영자에게 '적용' 버튼과 함께 제안합니다. 직접 적용하지 않습니다.",
        "input_schema": {"type": "object", "properties": {
            "overrides": {"type": "object", "additionalProperties": {"type": "number"}},
            "title": {"type": "string"}, "rationale": {"type": "string"},
            "expected_effect": {"type": "string", "description": "simulate_policy 결과에서 인용한 수치"}},
            "required": ["overrides", "title", "rationale", "expected_effect"], "additionalProperties": False},
    },
    {
        "name": "draft_event",
        "description": "시간표 밖 일정(보강·행사·휴강·강의실 변경·휴관)을 이벤트 초안으로 만들어 운영자 확인을 받습니다.",
        "input_schema": {"type": "object", "properties": {"text": {"type": "string", "description": "일정 설명 원문"}},
                         "required": ["text"], "additionalProperties": False},
    },
    {
        "name": "consolidation_advice",
        "description": "요일별 강의실 재배치 권고(같은 유형·정원 충족·시간 비어 있는 강의실로 옮겨 실외기/강의실 가동을 줄임)와 예상 절감 kWh를 돌려줍니다.",
        "input_schema": {"type": "object", "properties": {"weekday": {"type": ["integer", "null"], "description": "0=월 … 4=금, null=전체"}},
                         "required": ["weekday"], "additionalProperties": False},
    },
    {
        "name": "get_validation_issues",
        "description": "기간 내 정합성 검증에서 정상이 아닌 세션(자동 조치 포함)을 돌려줍니다(최대 14일).",
        "input_schema": {"type": "object", "properties": {"start_date": {"type": "string"}, "end_date": {"type": "string"}},
                         "required": ["start_date", "end_date"], "additionalProperties": False},
    },
]


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def run_tool(name: str, inp: dict, out: dict) -> dict:
    ctx = service.Ctx()
    if name == "get_overview":
        sm = service.semester_summary(ctx)
        return {"totals": sm["totals"], "decisions": sm["decisions"], "now": service.effective_now(ctx),
                "strategy_names": config.STRATEGIES, "settings": {k: ctx.settings[k] for k in (
                    "pre_on_min", "early_off_min", "gap_merge_min", "sp_heat", "sp_cool", "comfort_low", "comfort_high")}}
    if name == "get_day":
        d = _d(inp["date"])
        day = service.get_day(d, ctx)
        sm = service.engine.summarize_day(day)
        return {"summary": sm, "weather": {"t_min": min(day["weather"]["actual"]["t"]), "t_max": max(day["weather"]["actual"]["t"]),
                                           "rh_mean": round(sum(day["weather"]["actual"]["rh"]) / 24, 0),
                                           "source": day["weather"]["src_actual"]},
                "sessions": [{k: s[k] for k in ("room", "start", "end", "title", "expected_people", "kind")} for s in day["sessions"]],
                "ai_decisions": [{k: x.get(k) for k in ("room", "start", "end", "title", "type", "detail")} for x in day["decisions"]][:40],
                "issues": [{k: x[k] for k in ("room", "start", "title", "status", "notes")} for x in day["validation"]["issues"]]}
    if name == "get_room_week":
        d0 = _d(inp["start_date"])
        r = inp["room"]
        rows = []
        for i in range(7):
            day = service.get_day(d0 + timedelta(days=i), ctx)
            rows.append({"date": day["date"], "sessions": sum(1 for s in day["sessions"] if s["room"] == r),
                         **{stg: {"kwh": day["strategies"][stg]["rooms"][r]["kwh"],
                                  "on_min": day["strategies"][stg]["rooms"][r]["on_minutes"]} for stg in ("ai", "rule", "fixed")}})
        return {"room": r, "days": rows}
    if name == "simulate_policy":
        d0 = _d(inp["start_date"])
        n = max(1, min(int(inp.get("days", 3)), 7))
        res = service.what_if(inp["overrides"], [d0 + timedelta(days=i) for i in range(n)])
        out.setdefault("simulations", []).append(res)
        return res
    if name == "propose_policy":
        prop = {"overrides": inp["overrides"], "title": inp["title"], "rationale": inp["rationale"],
                "expected_effect": inp["expected_effect"]}
        out.setdefault("proposals", []).append(prop)
        return {"status": "운영자에게 적용 버튼으로 제안됨"}
    if name == "draft_event":
        ev = parse_event(inp["text"])
        try:
            chk = service.check_event(ev)
            ev["check"] = {k: chk.get(k) for k in ("ok", "conflicts", "capacity_ok", "capacity", "alternatives", "note", "target")}
        except Exception as e:  # incomplete draft: same shape, explained in the note
            ev["check"] = {**EMPTY_CHECK, "note": f"초안을 확인하지 못했습니다: {str(e)[:120]}"}
        out.setdefault("event_drafts", []).append(ev)
        return {"draft": ev, "status": "운영자 확인 대기"}
    if name == "consolidation_advice":
        res = service.consolidation(inp.get("weekday"))
        return res
    if name == "get_validation_issues":
        d0, d1 = _d(inp["start_date"]), _d(inp["end_date"])
        d1 = min(d1, d0 + timedelta(days=13))
        issues = []
        d = d0
        while d <= d1:
            v = service.get_day(d, ctx)["validation"]
            issues += [{"date": d.isoformat(), **{k: x[k] for k in ("room", "start", "title", "status", "notes")}} for x in v["issues"]]
            d += timedelta(days=1)
        return {"issues": issues[:80], "count": len(issues)}
    return {"error": f"unknown tool {name}"}


def copilot_system(ctx_now: dict) -> str:
    st = service.settings()
    return (
        "당신은 부산대학교 IT관 냉난방(HVAC) 운영 코파일럿입니다. 사용자는 시설 담당자입니다.\n"
        "시스템 구성: 강의 시간표·이벤트·기상청/Open-Meteo 날씨로 강의실별 운전 계획을 만들고, 실내기(IDU)/실외기(ODU) 시뮬레이터로 실행합니다. "
        f"비교 전략: fixed(현재 운영: 중앙은 정부 지침 온도 범위만 지키게 하고 {st['fixed_off']}에 전체 일괄 차단하고 그 뒤에는 다시 켤 수 없음, 강의실은 첫 수업 때 켜서 차단 시각까지 운전), manual(수동 운영), rule(시작 10분 전 On·종료 5분 전 Off·15분 이내 연속 유지), "
        "ai(AI 예측 제어: 열모델+예보로 최적 기동·가동 생략·외기 냉방·관성 정지·재실 감지 정지·피드백 보정).\n"
        f"기준 시각: {ctx_now['date']} {ctx_now['minute'] // 60:02d}:{ctx_now['minute'] % 60:02d} ({ctx_now['reason']}).\n"
        "규칙:\n"
        "- 수치(kWh, %, 원, 온도)는 반드시 이번 대화의 도구 결과에서만 인용합니다. 추측한 수치를 쓰지 않습니다.\n"
        "- 운영 규칙 변경을 권할 때는 먼저 simulate_policy로 검증하고, 효과가 있으면 propose_policy로 제안합니다. 직접 적용했다고 말하지 않습니다.\n"
        "- 일정 추가·휴강·강의실 변경 요청은 draft_event로 초안을 만들고 운영자 확인을 요청합니다.\n"
        "- 쾌적도를 희생하는 절감은 그 대가를 함께 밝힙니다. 규칙 변경을 제안할 때는 시뮬레이션 결과의 전력량과 함께 "
        "불쾌 지표(discomfort_dm)와 수업 시작 시 저온·고온 횟수(cold_starts) 변화를 반드시 적습니다. "
        "쾌적 범위 경계에 설정온도를 맞추는 식으로 지표만 좋아 보이게 하는 제안은 하지 않습니다.\n"
        "- 원인을 더 확인할 수 있는 도구가 있으면 사용자에게 되묻지 말고 먼저 조회한 뒤 결론을 냅니다(도구 호출은 최대 5회).\n"
        "- 도구·함수 이름(get_day 등)이나 내부 키(ai, rule 등)를 답변에 쓰지 않습니다. 'AI 예측 제어', '규칙 기반', '현재 운영', '수동 운영'처럼 화면의 이름을 씁니다.\n"
        "- 답변은 한국어로, 시설 담당자가 바로 행동할 수 있게 짧고 구체적으로 씁니다. 표가 도움이 되면 마크다운 표를 씁니다."
    )


def copilot(history: list[dict], progress=None) -> dict:
    """history: [{role: user|assistant, content: str}], last item is the new user message."""
    ctx = service.Ctx()
    now = service.effective_now(ctx)
    msgs = [{"role": m["role"], "content": m["content"]} for m in history if m.get("content")][-12:]
    out: dict = {"steps": []}
    for _ in range(6):
        _charge()
        resp = client().messages.create(
            model=SONNET,
            max_tokens=8000,
            system=copilot_system(now),
            tools=TOOLS,
            messages=msgs,
            output_config={"effort": "low"},
        )
        if resp.stop_reason == "refusal":
            out["answer"] = "이 요청은 처리할 수 없습니다."
            break
        tool_uses = [b for b in resp.content if b.type == "tool_use"]
        if not tool_uses:
            out["answer"] = _text(resp)
            break
        msgs.append({"role": "assistant", "content": resp.content})
        results = []
        for tu in tool_uses:
            step = {"tool": tu.name, "input": tu.input}
            out["steps"].append(step)
            if progress:
                progress(out)
            try:
                res = run_tool(tu.name, tu.input, out)
                results.append({"type": "tool_result", "tool_use_id": tu.id,
                                "content": json.dumps(res, ensure_ascii=False, default=str)[:60000]})
                step["ok"] = True
            except Exception as e:  # tool failures go back to the model
                results.append({"type": "tool_result", "tool_use_id": tu.id, "content": f"오류: {e}", "is_error": True})
                step["ok"] = False
        msgs.append({"role": "user", "content": results})
    else:
        out["answer"] = out.get("answer") or "분석 단계가 너무 길어 중단했습니다. 질문을 좁혀 주세요."
    return out


def parse_event_image(data: bytes, media_type: str) -> dict:
    """A notice screenshot or photo (e.g. LMS 휴강 공지) -> event draft (same schema as parse_event)."""
    _charge()
    text = (
        "이 이미지는 강의 휴강·보강·행사·강의실 변경 공지입니다. 공지 내용을 일정 이벤트 하나로 변환하세요. "
        "이미지에 적힌 날짜·시간·강의실·과목명만 근거로 쓰고, 강의 목록에서 맞는 course_id를 고릅니다."
    )
    content = [{"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode()}},
               {"type": "text", "text": text}]
    today = service.now_kst().date()
    system = (
        f"당신은 대학 건물 냉난방 운영 시스템의 일정 입력 도우미입니다. 오늘은 {today.isoformat()}입니다. "
        "이벤트 유형: add(보강·행사·시험), cancel(휴강: course_id 지정), move(강의실 변경), closure(휴관). "
        "확실하지 않으면 clarification에 질문을 넣습니다.\n\n강의 목록(id|강의실|요일|시간|과목|교수):\n" + _course_catalog()
    )
    resp = client().with_options(timeout=50.0, max_retries=1).messages.create(
        model=HAIKU, max_tokens=2000, system=system, messages=[{"role": "user", "content": content}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": EVENT_SCHEMA}},
    )
    ev = json.loads(_text(resp))
    return {k: v for k, v in ev.items() if v is not None or k == "clarification"}
