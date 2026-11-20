"""B2B onboarding: building profile, central-controller connection, data collection, missing-info questions.

The central control PC of a campus building sits on a closed facility network, so the realistic path is
an edge gateway installed on that network (BACnet/IP, Modbus TCP, vendor HTTP API or OPC UA toward the
controller; outbound TLS toward the cloud). In this demo the gateway handshake is simulated and the
IT관 thermal simulator answers as the central controller; every value read back is the simulator's.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re

from hvac import config

from . import planning, service
from .store import get_store

PNU_DEFAULT = {
    "name": "IT관",
    "org": "부산대학교",
    "type": "school",
    "address": "부산광역시 금정구 부산대학로63번길 2",
    "onboarded_at": "2026-09-01T09:00:00+09:00",
    "connection": {"method": "gateway", "vendor": "시스템 에어컨 중앙제어기", "protocol": "bacnet", "host": "10.21.3.40",
                   "port": 47808, "gateway_id": "GW-PNU-IT-01", "connected_at": "2026-09-01T09:12:00+09:00", "points": 0},
    "demo": True,
}

TYPES = ("school", "mall", "hotel", "office", "hospital", "etc")
PROTOCOL_PORT = {"bacnet": 47808, "modbus": 502, "vendor_api": 443, "opcua": 4840}


def building() -> dict:
    it = get_store().get_item("meta", "building_profile")
    out = {**PNU_DEFAULT, **(it or {})}
    if out.get("connection") and not out["connection"].get("points"):
        out["connection"] = {**out["connection"], "points": len(_points())}
    return out


def save_building(patch: dict, actor: str = "운영자") -> dict:
    cur = building()
    new = {**cur}
    for k in ("name", "org", "address"):
        if k in patch and patch[k] is not None:
            new[k] = str(patch[k]).strip()[:80]
    if patch.get("type") in TYPES:
        new["type"] = patch["type"]
    if "onboarded_at" in patch:
        new["onboarded_at"] = patch["onboarded_at"] or service.now_kst().isoformat(timespec="seconds")
    if isinstance(patch.get("connection"), dict):
        c = patch["connection"]
        new["connection"] = {**(cur.get("connection") or {}), **{k: c[k] for k in (
            "method", "vendor", "protocol", "host", "port", "gateway_id", "connected_at", "points") if k in c}}
    new["demo"] = True  # data always comes from the IT관 simulator in this build
    get_store().put_item("meta", "building_profile", new)
    service.audit("building", f"건물 정보 저장: {new['org']} {new['name']}", actor)
    return new


# ---------------------------------------------------------------- 1) natural-language building description

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "건물 이름 (예: IT관)"},
        "org": {"type": "string", "description": "기관·회사 이름 (예: 부산대학교)"},
        "type": {"type": "string", "enum": list(TYPES)},
        "address": {"type": "string", "description": "주소나 지역, 모르면 빈 문자열"},
        "floors": {"type": ["integer", "null"]},
        "note": {"type": "string", "description": "운영 특성 요약 한 문장 (일정 출처, 공간 구성)"},
        "clarification": {"type": ["string", "null"], "description": "꼭 필요한데 빠진 정보가 있으면 짧은 질문, 없으면 null"},
    },
    "required": ["name", "org", "type", "address", "floors", "note", "clarification"],
    "additionalProperties": False,
}


def _rule_profile(text: str) -> dict:
    t = text.strip()
    typ = "etc"
    for k, v in (("대학", "school"), ("학교", "school"), ("몰", "mall"), ("백화점", "mall"), ("쇼핑", "mall"),
                 ("호텔", "hotel"), ("리조트", "hotel"), ("병원", "hospital"), ("오피스", "office"), ("사옥", "office"), ("빌딩", "office")):
        if k in t:
            typ = v
            break
    org = (re.search(r"([가-힣A-Za-z0-9]+(?:대학교|대학|학교|병원|호텔|백화점|몰))", t) or [None, ""])[1]
    name = (re.search(r"([가-힣A-Za-z0-9]+(?:관|동|센터|빌딩|타워|홀))", t) or [None, ""])[1]
    floors = re.search(r"(\d+)\s*층", t)
    return {"name": name or t[:20], "org": org or "", "type": typ, "address": "", "floors": int(floors[1]) if floors else None,
            "note": t[:120], "clarification": None if name else "건물 이름(예: IT관)을 알려 주세요.", "ai": False}


def parse_profile(text: str) -> dict:
    from . import ai

    text = text.strip()[:500]
    try:
        ai._charge()
        resp = ai.client().with_options(timeout=30.0, max_retries=1).messages.create(
            model=ai.HAIKU, max_tokens=1200,
            system=("당신은 건물 냉난방 자동 운전 서비스의 온보딩 도우미입니다. 운영자가 자기 건물을 자유롭게 설명하면 "
                    "건물 프로필로 정리합니다. 학교는 school, 쇼핑몰·백화점은 mall, 호텔은 hotel, 사무 건물은 office, 병원은 hospital입니다."),
            messages=[{"role": "user", "content": text}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": PROFILE_SCHEMA}},
        )
        out = json.loads(ai._text(resp))
        ai.record_status(True)
        return {**out, "ai": True}
    except Exception as e:
        if ai.is_outage(e):
            ai.record_status(False, type(e).__name__)
        return _rule_profile(text)


# ---------------------------------------------------------------- 2) central controller connection (simulated gateway)

HOST_RE = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}$")


def _points() -> list[dict]:
    """Object list the gateway reads from the controller, mapped to rooms by naming rule."""
    ctx = service.Ctx()
    try:
        live = service.live_snapshot(ctx)
        lr = {x["room"]: x for x in live["rooms"]}
        odu = live["odus"]
    except Exception:
        lr, odu = {}, {}
    pts = []
    for r, room in config.ROOMS.items():
        x = lr.get(r, {})
        for idu in room["idus"]:
            n = idu["id"]
            pts += [
                {"point": f"BV:{n}/OnOff", "room": r, "device": n, "kind": "onoff", "unit": "", "value": "ON" if x.get("state") in ("ON", "FAN") else "OFF", "writable": True},
                {"point": f"MV:{n}/Mode", "room": r, "device": n, "kind": "mode", "unit": "", "value": {"ON": "난방" if (x.get("ta") or 20) < 22 else "냉방", "FAN": "송풍"}.get(x.get("state"), "-"), "writable": True},
                {"point": f"AV:{n}/HeatSetpoint", "room": r, "device": n, "kind": "setpoint", "unit": "℃", "value": ctx.settings["sp_heat"], "writable": True},
                {"point": f"AI:{n}/RoomTemp", "room": r, "device": n, "kind": "room_temp", "unit": "℃", "value": round(x.get("ta") or 0, 1), "writable": False},
            ]
        pts.append({"point": f"AI:SENS-{r}/CO2", "room": r, "device": f"SENS-{r}", "kind": "co2", "unit": "ppm", "value": 0, "writable": False})
        pts.append({"point": f"AI:WIFI-{r}/Clients", "room": r, "device": f"AP-{r}", "kind": "occupancy", "unit": "명",
                    "value": int((x.get("session") or {}).get("expected_people") or 0), "writable": False})
    for o, meta in config.ODUS.items():
        pts.append({"point": f"AI:{o}/Power", "room": None, "device": o, "kind": "power", "unit": "kW",
                    "value": round((odu.get(o) or {}).get("power_w", 0) / 1000, 2), "writable": False})
    return pts


def connect(body: dict) -> dict:
    from .validation import InvalidInput

    method = body.get("method") if body.get("method") in ("gateway", "direct", "file") else "gateway"
    protocol = body.get("protocol") if body.get("protocol") in PROTOCOL_PORT else "bacnet"
    host = str(body.get("host") or "").strip()
    try:
        port = int(body.get("port") or PROTOCOL_PORT[protocol])
    except (TypeError, ValueError):
        raise InvalidInput("포트는 숫자여야 합니다.")
    if method != "file":
        if not host:
            raise InvalidInput("중앙제어 PC의 IP 주소나 호스트 이름을 입력하세요.")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if not HOST_RE.match(host):
                raise InvalidInput("주소 형식이 올바르지 않습니다. 예: 10.21.3.40 또는 bms.example.ac.kr")
        if not 1 <= port <= 65535:
            raise InvalidInput("포트는 1~65535 사이여야 합니다.")
    vendor = str(body.get("vendor") or "중앙제어기")[:40]
    from . import gateway

    code = re.sub(r"[^A-Z0-9-]", "", str(body.get("pair_code") or "").upper())
    live = gateway.online(code or None) if method == "gateway" else None
    if live:  # a real edge gateway is reporting: show what it discovered over BACnet
        res = gateway.connect_result(live, method, protocol, host, port)
        save_building({"connection": {"method": method, "vendor": vendor, "protocol": protocol, "host": host, "port": port,
                                      "gateway_id": live["id"], "connected_at": service.now_kst().isoformat(timespec="seconds"),
                                      "points": res["summary"]["points"]}}, "온보딩")
        return res
    seed = hashlib.sha1(f"{host}|{port}|{protocol}".encode()).hexdigest()
    gw = f"GW-{seed[:6].upper()}"
    pts = _points()
    n_idu = sum(len(r["idus"]) for r in config.ROOMS.values())
    proto_label = {"bacnet": "BACnet/IP", "modbus": "Modbus TCP", "vendor_api": "제조사 API(HTTPS)", "opcua": "OPC UA"}[protocol]
    private = False
    try:
        private = ipaddress.ip_address(host).is_private
    except ValueError:
        pass
    steps = []
    if method == "gateway":
        steps.append({"key": "gateway", "label": "현장 게이트웨이 확인", "ok": True,
                      "detail": f"{gw} 온라인 · 클라우드로 아웃바운드 TLS(8883) 연결, 버전 1.4.2", "ms": 420})
    elif method == "direct":
        steps.append({"key": "tunnel", "label": "VPN·허용 IP 경로 확인", "ok": True,
                      "detail": "사설망 주소라 VPN 터널로 접속합니다" if private else "공인 주소: 방화벽에서 ThermoPlan 고정 IP만 허용하세요", "ms": 380})
    else:
        steps.append({"key": "file", "label": "운전 이력 파일 확인", "ok": True, "detail": "CSV 내보내기 형식(장치·시각·상태·설정온도)", "ms": 200})
    if method != "file":
        steps.append({"key": "reach", "label": f"중앙제어기 응답 ({proto_label})", "ok": True,
                      "detail": f"{host}:{port} 응답 {12 + int(seed[6:8], 16) % 30}ms · 장치 인스턴스 {3000 + int(seed[8:10], 16) % 900}", "ms": 650})
    steps += [
        {"key": "discover", "label": "포인트 탐색", "ok": True,
         "detail": f"실내기 {n_idu}대 · 실외기 {len(config.ODUS)}대 · 센서 {len(config.ROOMS) * 2}개, 포인트 {len(pts)}개", "ms": 1200},
        {"key": "map", "label": "강의실 자동 매핑", "ok": True,
         "detail": f"포인트 이름 규칙(장치-강의실-번호)으로 강의실 {len(config.ROOMS)}곳에 매핑", "ms": 540},
        {"key": "read", "label": "현재값 읽기", "ok": True, "detail": "운전 상태·설정온도·실내온도·실외기 전력을 읽었습니다", "ms": 480},
        {"key": "write", "label": "쓰기 권한 확인 (시험 모드)", "ok": True,
         "detail": "설정온도·운전 명령 쓰기 가능 · 실제 값은 바꾸지 않았습니다", "ms": 520},
    ]
    res = {"ok": True, "source": "simulated", "steps": steps, "points": pts,
           "summary": {"rooms": len(config.ROOMS), "idus": n_idu, "odus": len(config.ODUS), "sensors": len(config.ROOMS) * 2, "points": len(pts)},
           "gateway": {"id": gw, "version": "1.4.2", "latency_ms": 12 + int(seed[6:8], 16) % 30},
           "note": ("연결 코드로 접속한 게이트웨이가 없어 시뮬레이터로 시험했습니다. 설치 명령으로 게이트웨이를 실행한 뒤 다시 시험하면 실제 값을 읽습니다."
                    if method == "gateway" else "데모 환경에서는 IT관 열모델 시뮬레이터가 중앙제어기 역할을 합니다.")}
    save_building({"connection": {"method": method, "vendor": vendor, "protocol": protocol, "host": host, "port": port,
                                  "gateway_id": gw if method == "gateway" else None,
                                  "connected_at": service.now_kst().isoformat(timespec="seconds"), "points": len(pts)}}, "온보딩")
    return res


# ---------------------------------------------------------------- 3) data collection + 4) questions

def collect() -> dict:
    ctx = service.Ctx()
    pol = planning.policy()
    src = service.weather_sources()
    est = sum(1 for c in ctx.courses if c.get("people_estimated"))
    fb = planning.feedback_items(14)
    kma = planning.fmt_kma_base((src.get("kma_forecast") or {}).get("base"))
    sources = [
        planning._src("timetable", "학사 시스템 강의 시간표", "input", f"강의 {len(ctx.courses)}개 · {len({c['room'] for c in ctx.courses})}개 강의실"),
        planning._src("calendar", "학사일정·공휴일", "assumption", f"학기 {config.SEMESTER['start']}~{config.SEMESTER['end']} · 공휴일 {len(config.HOLIDAYS)}일"),
        planning._src("events", "행사·예약 일정", "input", f"등록된 일정 {len(ctx.events)}건"),
        planning._bms_source(),
        planning._src("forecast", "기상청 단기예보·초단기실황", "live", f"{kma} 발표" if kma else "Open-Meteo 예보로 대체", "ok" if kma else "stale", src.get("fetched_at")),
        planning._src("weather", "Open-Meteo 실측·평년", "live", f"{len(ctx.wx)}일치 시간별 기온·습도·일사", "ok", src.get("fetched_at")),
        planning._src("co2", "CO₂ 센서", "simulated", f"강의실 {len(config.ROOMS)}곳 (데모: 재실 기반 계산)"),
        planning._src("density", "재실 밀도 (Wi-Fi 접속 수)", "simulated", f"AP {len(config.ROOMS)}대 (데모: 시뮬레이션)"),
        planning._src("feedback", "쾌적 의견 (QR·관리자 입력)", "input", f"최근 14일 {len(fb)}건"),
        planning._src("tariff", "한전 교육용(을) 요금", "input", "시간대별 요금표"),
    ]
    counts = {"courses": len(ctx.courses), "rooms": len(config.ROOMS), "idus": sum(len(r["idus"]) for r in config.ROOMS.values()),
              "odus": len(config.ODUS), "events": len(ctx.events), "holidays": len(config.HOLIDAYS), "feedback": len(fb),
              "weather_days": len(ctx.wx), "estimated_people": est}
    hol = ", ".join(f"{d.month}/{d.day} {n}" for d, n in sorted(config.HOLIDAYS.items()))
    s = ctx.settings
    questions = [
        {"id": "policy_heat", "title": "난방 설정온도를 어느 범위에서 정할까요?",
         "why": "중앙제어기는 지금 22℃ 고정입니다. 학교보건법(18℃ 이상)과 에너지이용 합리화법(난방 20℃ 이하, 강의실은 학교가 탄력 운영) 사이에서 AI가 수업마다 온도를 고릅니다.",
         "kind": "temp_range", "unit": "℃", "default": [pol["heat_min"], pol["heat_max"]], "min": 15, "max": 26, "step": 0.5,
         "source": "policy", "affects": "1·2·3차 설정온도와 에이전트 협의 범위"},
        {"id": "policy_cool", "title": "냉방 설정온도를 어느 범위에서 정할까요?",
         "why": "정부 권장은 냉방 26℃ 이상, 학교보건법 상한은 28℃입니다.",
         "kind": "temp_range", "unit": "℃", "default": [pol["cool_min"], pol["cool_max"]], "min": 22, "max": 30, "step": 0.5,
         "source": "policy", "affects": "냉방철 설정온도와 에이전트 협의 범위"},
        {"id": "hours", "title": "지금 중앙제어기는 몇 시부터 몇 시까지 켜 두나요?",
         "why": "중앙제어기 운전 이력에 일정한 가동 시간이 보이지만 확정 값이 없습니다. 절감 효과를 비교하는 '현재 운영' 기준이 됩니다.",
         "kind": "time_range", "default": [s["fixed_on"], s["fixed_off"]], "source": "bms", "affects": "현재 운영과의 절감 비교"},
        {"id": "attendance", "title": "수강 인원이 없는 강의는 정원의 몇 %가 출석한다고 볼까요?",
         "why": f"시간표에 수강 인원이 없는 강의가 {est}개 있습니다. 예상 인원은 발열과 CO₂ 환기 단계 계산에 쓰입니다.",
         "kind": "number", "unit": "%", "default": round(pol["attendance"] * 100), "min": 30, "max": 100, "step": 5,
         "source": "timetable", "affects": "CO₂ 환기 계획과 예상 재실 인원"},
        {"id": "pre_on_min", "title": "수업 시작 몇 분 전에는 쾌적해야 하나요?",
         "why": "AI는 열모델로 켜는 시각을 정하지만, 비교 기준인 규칙 운전과 정합성 검증은 이 값을 씁니다.",
         "kind": "number", "unit": "분", "default": s["pre_on_min"], "min": 0, "max": 60, "step": 5,
         "source": "policy", "affects": "규칙 운전 비교·정합성 검증"},
        {"id": "gap_merge_min", "title": "수업 사이 공백이 몇 분 이내면 계속 켜 둘까요?",
         "why": "짧은 공백에 껐다 켜면 오히려 에너지가 더 듭니다.",
         "kind": "number", "unit": "분", "default": s["gap_merge_min"], "min": 0, "max": 60, "step": 5,
         "source": "policy", "affects": "연속 강의 운전"},
        {"id": "holidays", "title": f"학기 중 공휴일을 이렇게 등록했습니다: {hol}. 맞나요?",
         "why": "공공데이터포털 특일정보 API 사용 승인 전이라 설정값으로 넣었습니다. 휴관일은 일정·데이터에서 추가할 수 있습니다.",
         "kind": "confirm", "default": True, "source": "calendar", "affects": "1차 월간 계획"},
    ]
    return {"building": {"name": config.BUILDING["name"], "campus": config.BUILDING["campus"]}, "sources": sources,
            "counts": counts, "questions": questions}


def apply_answers(answers: dict, actor: str = "온보딩") -> dict:
    from .validation import InvalidInput

    applied = []
    pol_patch = {}

    def rng(key, lo_k, hi_k, label):
        v = answers.get(key)
        if isinstance(v, (list, tuple)) and len(v) == 2:
            try:
                a, b = float(v[0]), float(v[1])
            except (TypeError, ValueError):
                raise InvalidInput(f"{label} 범위는 숫자 두 개여야 합니다.")
            pol_patch[lo_k], pol_patch[hi_k] = min(a, b), max(a, b)
            applied.append(f"{label} 허용 범위 {min(a, b):g}~{max(a, b):g}℃")

    rng("policy_heat", "heat_min", "heat_max", "난방")
    rng("policy_cool", "cool_min", "cool_max", "냉방")
    if answers.get("attendance") is not None:
        try:
            a = float(answers["attendance"])
        except (TypeError, ValueError):
            raise InvalidInput("출석률은 숫자여야 합니다.")
        a = a / 100.0 if a > 1 else a  # the question asks in percent
        pol_patch["attendance"] = a
        applied.append(f"출석률 가정 {a * 100:.0f}%")
    if isinstance(answers.get("orient"), dict):
        pol_patch["orient"] = answers["orient"]
        applied.append("강의실 방향")
    pol = planning.save_policy(pol_patch, actor) if pol_patch else planning.policy()
    st_patch = {}
    h = answers.get("hours")
    if isinstance(h, (list, tuple)) and len(h) == 2:
        st_patch["fixed_on"], st_patch["fixed_off"] = str(h[0]), str(h[1])
    for k in ("pre_on_min", "gap_merge_min"):
        if answers.get(k) is not None:
            st_patch[k] = answers[k]
    cur = service.settings()
    changes = {k: v for k, v in st_patch.items() if str(cur.get(k)) != str(v)}
    settings = service.save_settings(changes, actor) if changes else cur
    if changes:
        service._queue_precompute()
        applied.append("운영 규칙 " + ", ".join(f"{k}={v}" for k, v in changes.items()))
    if answers.get("mode") in ("auto", "recommend"):
        planning.set_mode(answers["mode"], actor)
        applied.append("운전 모드 " + ("자동 운전" if answers["mode"] == "auto" else "추천 모드"))
    planning.clear_cache()
    return {"policy": pol, "settings": settings, "applied": applied}
