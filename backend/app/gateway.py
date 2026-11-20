"""Edge gateway link: a program on the building's network talks BACnet/IP to the central controller and
reaches the cloud only through outbound HTTPS (this API, behind CloudFront).

  pair       gateway → cloud   claim key = the pairing code shown in onboarding; returns a token
  telemetry  gateway → cloud   every poll: device info + every mapped point's present value;
                               the reply carries queued setpoint/fan commands for that gateway
  ack        gateway → cloud   result of each command (written + read back, refused, failed)

When a paired gateway is online, onboarding's connection test reports what the gateway actually
discovered and read, and applied adjustments are queued as real BACnet writes (only if the gateway
was started with --allow-write). Without one, both fall back to the simulator and say so.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import time
import uuid

from hvac import config

from . import service
from .store import get_store

ONLINE_S = 90  # a gateway that reported within this many seconds is online
NAME_RE = re.compile(r"^(?P<dev>(IDU|ERV|SENS|AP)-(?P<room>\d{3})(-\d+)?|ODU-[0-9A-Z-]+)/(?P<prop>[A-Za-z0-9]+)$")
KIND = {"OnOff": "onoff", "Mode": "mode", "HeatSetpoint": "setpoint", "CoolSetpoint": "setpoint", "RoomTemp": "room_temp",
        "Power": "power", "CO2": "co2", "Clients": "occupancy", "FanLevel": "fan", "Humidity": "humidity"}
UNIT = {"setpoint": "℃", "room_temp": "℃", "power": "kW", "co2": "ppm", "occupancy": "명", "humidity": "%"}


def _now() -> float:
    return time.time()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def map_point(name: str) -> dict:
    """Naming rule of the controller's objects → room and kind (unmapped names keep room=None)."""
    m = NAME_RE.match(name or "")
    if not m:
        return {"room": None, "device": name.split("/")[0] if name else "", "kind": "other"}
    room = m.group("room")
    return {"room": room if room in config.ROOMS else None, "device": m.group("dev"), "kind": KIND.get(m.group("prop"), "other")}


def pair(body: dict, client: str) -> dict:
    from .validation import InvalidInput

    code = re.sub(r"[^A-Z0-9-]", "", str(body.get("pair_code") or "").upper())[:16]
    if len(code) < 4:
        raise InvalidInput("연결 코드(pair_code)가 필요합니다. 온보딩 2단계에 표시된 코드를 넣으세요.")
    ctl = body.get("controller") or {}
    gid = "GW-" + hashlib.sha1(f"{code}|{ctl.get('host')}|{ctl.get('port')}".encode()).hexdigest()[:6].upper()
    token = secrets.token_urlsafe(24)
    rec = {"id": gid, "code": code, "token_hash": _hash(token), "paired_at": service.now_kst().isoformat(timespec="seconds"),
           "last_seen": 0.0, "version": str(body.get("version") or "")[:20], "allow_write": bool(body.get("allow_write")),
           "controller": {k: ctl.get(k) for k in ("protocol", "host", "port", "device_instance", "device_name", "vendor")},
           "client": client, "n_points": 0}
    get_store().put_item("gateway", gid, rec)
    service.audit("gateway", f"게이트웨이 연결: {gid} (코드 {code}, {rec['controller'].get('host')}:{rec['controller'].get('port')})", "게이트웨이")
    return {"gateway_id": gid, "token": token, "poll_s": 15}


def _auth(gid: str, token: str | None) -> dict:
    from .validation import InvalidInput

    rec = get_store().get_item("gateway", gid or "")
    if not rec or not token or _hash(token) != rec.get("token_hash"):
        raise InvalidInput("게이트웨이 인증에 실패했습니다. 다시 연결(pair)하세요.")
    return rec


def telemetry(body: dict, token: str | None) -> dict:
    rec = _auth(str(body.get("gateway_id") or ""), token)
    pts = []
    for p in (body.get("points") or [])[:2000]:
        name = str(p.get("name") or "")[:80]
        mp = map_point(name)
        v = p.get("value")
        if isinstance(v, float):
            v = round(v, 2)
        pts.append({"point": name, "objid": str(p.get("objid") or "")[:40], "room": mp["room"], "device": mp["device"],
                    "kind": mp["kind"], "unit": UNIT.get(mp["kind"], ""), "value": v, "writable": bool(p.get("writable"))})
    now = _now()
    snap = {"gateway_id": rec["id"], "ts": service.now_kst().isoformat(timespec="seconds"), "device": body.get("device") or {},
            "points": pts, "allow_write": bool(body.get("allow_write")), "stats": body.get("stats") or {}}
    get_store().put_blob(f"gateway/{rec['id']}/latest.json", snap)
    rec = {**rec, "last_seen": now, "n_points": len(pts), "allow_write": bool(body.get("allow_write")),
           "device": body.get("device") or {}, "version": str(body.get("version") or rec.get("version") or "")[:20]}
    get_store().put_item("gateway", rec["id"], rec)
    # deliver queued commands for this gateway
    out = []
    for c in get_store().list_items("command"):
        if c.get("gateway_id") == rec["id"] and c.get("status") == "queued":
            c = {**c, "status": "sent", "sent_at": service.now_kst().isoformat(timespec="seconds")}
            get_store().put_item("command", c["id"], c)
            out.append({"id": c["id"], "name": c.get("name"), "value": c.get("value_num"), "room": c.get("room")})
    return {"commands": out[:50], "poll_s": 15}


def ack(body: dict, token: str | None) -> dict:
    from .validation import InvalidInput

    rec = _auth(str(body.get("gateway_id") or ""), token)
    c = get_store().get_item("command", str(body.get("id") or ""))
    if not c or c.get("gateway_id") != rec["id"]:
        raise InvalidInput("알 수 없는 명령입니다.")
    status = "acked" if body.get("ok") else ("refused" if body.get("refused") else "failed")
    c = {**c, "status": status, "acked_at": service.now_kst().isoformat(timespec="seconds"),
         "readback": body.get("readback"), "error": str(body.get("error") or "")[:200] or None}
    get_store().put_item("command", c["id"], c)
    return {"ok": True, "status": status}


def gateways() -> list[dict]:
    now = _now()
    out = []
    for g in get_store().list_items("gateway"):
        g = {k: v for k, v in g.items() if k not in ("token_hash", "client")}
        g["online"] = now - float(g.get("last_seen") or 0) <= ONLINE_S
        g["seen_s_ago"] = round(now - float(g["last_seen"])) if g.get("last_seen") else None
        out.append(g)
    return sorted(out, key=lambda g: -(g.get("last_seen") or 0))


def online(code: str | None = None) -> dict | None:
    for g in gateways():
        if g["online"] and (not code or g.get("code") == code):
            return g
    return None


def latest(gid: str) -> dict | None:
    return get_store().get_blob(f"gateway/{gid}/latest.json")


def status() -> dict:
    gs = gateways()
    for g in gs[:5]:
        snap = latest(g["id"]) or {}
        pts = snap.get("points") or []
        g["rooms_mapped"] = len({p["room"] for p in pts if p.get("room")})
        g["unmapped"] = sum(1 for p in pts if not p.get("room") and p.get("kind") not in ("power",))
        g["sample"] = [p for p in pts if p["kind"] in ("room_temp", "setpoint", "onoff", "co2", "fan")][:40]
        g["snapshot_ts"] = snap.get("ts")
    return {"gateways": gs[:5], "live": any(g["online"] for g in gs)}


# ---------------------------------------------------------------- commands

def queue_writes(adj: dict, writes: list[tuple[str, str, str, float | int, str]], window: str) -> list[dict] | None:
    """If a gateway is online, queue real writes: (device, point, name, numeric value, label).
    Returns the command records, or None when no gateway is online (caller simulates)."""
    g = online()
    if not g:
        return None
    now = service.now_kst().isoformat(timespec="seconds")
    out = []
    for dev, point, name, num, label in writes:
        cid = f"{now}-{uuid.uuid4().hex[:6]}"
        rec = {"id": cid, "ts": now, "device": dev, "room": _room_of(dev), "point": point, "name": name, "value": label,
               "value_num": num, "window": window, "adjustment_id": adj["id"], "gateway_id": g["id"],
               "status": "queued" if g.get("allow_write") else "blocked",
               "error": None if g.get("allow_write") else "게이트웨이가 읽기 전용(--allow-write 없음)이라 쓰지 않았습니다."}
        get_store().put_item("command", cid, rec)
        out.append(rec)
    return out


def _room_of(dev: str) -> str | None:
    m = re.search(r"-(\d{3})", dev or "")
    return m.group(1) if m else None


def connect_result(g: dict, method: str, protocol: str, host: str, port: int) -> dict:
    """Onboarding connection test from what the live gateway actually discovered and read."""
    snap = latest(g["id"]) or {}
    pts = snap.get("points") or []
    dev = snap.get("device") or g.get("device") or {}
    idus = sorted({p["device"] for p in pts if p["device"].startswith("IDU-")})
    odus = sorted({p["device"] for p in pts if p["device"].startswith("ODU-")})
    sensors = sorted({p["device"] for p in pts if p["device"].startswith(("SENS-", "AP-"))})
    rooms = sorted({p["room"] for p in pts if p.get("room")})
    unmapped = [p["point"] for p in pts if not p.get("room") and not p["device"].startswith("ODU-")]
    temps = [p for p in pts if p["kind"] == "room_temp" and isinstance(p.get("value"), (int, float))]
    st = snap.get("stats") or {}
    steps = [
        {"key": "gateway", "label": "현장 게이트웨이 확인", "ok": True,
         "detail": f"{g['id']} 온라인 · {g.get('seen_s_ago', 0)}초 전 보고 · 버전 {g.get('version') or '-'} · 클라우드로 나가는 HTTPS만 사용", "ms": 300},
        {"key": "reach", "label": f"중앙제어기 응답 ({'BACnet/IP' if protocol == 'bacnet' else protocol})", "ok": bool(dev),
         "detail": (f"{dev.get('address', f'{host}:{port}')} · 장치 {dev.get('instance', '-')} '{dev.get('name', '-')}' · "
                    f"Who-Is 응답 {st.get('whois_ms', '-')}ms") if dev else "장치 정보가 아직 없습니다", "ms": 500},
        {"key": "discover", "label": "포인트 탐색 (object-list)", "ok": bool(pts),
         "detail": f"객체 {len(pts)}개: 실내기 {len(idus)}대 · 실외기 {len(odus)}대 · 센서 {len(sensors)}개", "ms": 900},
        {"key": "map", "label": "강의실 자동 매핑", "ok": bool(rooms),
         "detail": f"이름 규칙(장치-강의실-번호/속성)으로 강의실 {len(rooms)}곳에 매핑" + (f", 매핑 안 됨 {len(unmapped)}개" if unmapped else ""), "ms": 400},
        {"key": "read", "label": "현재값 읽기 (ReadProperty)", "ok": bool(temps),
         "detail": (", ".join(f"{p['point'].split('/')[0]} {p['value']}℃" for p in temps[:3]) + f" 등 {len(pts)}개, 읽기 {st.get('read_ms', '-')}ms")
         if temps else "읽은 값이 없습니다", "ms": 500},
        {"key": "write", "label": "쓰기 권한", "ok": True,
         "detail": "쓰기 허용(--allow-write): 조정안은 우선순위 8로 쓰고 되읽어 확인합니다" if snap.get("allow_write")
         else "읽기 전용으로 실행 중입니다. 조정안은 기록만 하고 장비에 쓰지 않습니다", "ms": 300},
    ]
    points = [{"point": p["point"], "room": p.get("room"), "device": p["device"], "kind": p["kind"] if p["kind"] in (
        "onoff", "mode", "setpoint", "room_temp", "power", "co2", "occupancy", "humidity") else "mode",
        "unit": p.get("unit", ""), "value": p.get("value"), "writable": p.get("writable", False)} for p in pts]
    return {"ok": True, "source": "gateway", "steps": steps, "points": points,
            "summary": {"rooms": len(rooms), "idus": len(idus), "odus": len(odus), "sensors": len(sensors), "points": len(pts)},
            "gateway": {"id": g["id"], "version": g.get("version") or "", "latency_ms": int(st.get("whois_ms") or 0)},
            "note": f"실제 게이트웨이 {g['id']}가 {dev.get('address', host)}의 중앙제어기에서 BACnet으로 읽은 값입니다."}
