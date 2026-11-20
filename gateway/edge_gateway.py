"""ThermoPlan edge gateway: installed on the building's network next to the central-control PC.

- Inside: talks BACnet/IP to the controller (unicast Who-Is → device, object-list, object-name,
  present-value; WriteProperty at priority 8 for commands).
- Outside: only outbound HTTPS to the ThermoPlan API, so the facility firewall needs no inbound rule.

Safety: read-only unless started with --allow-write. Even then it writes only setpoints within
16–30 ℃ and fan levels 1–3, reads every write back, and reports the result to the cloud.

  python edge_gateway.py --pair ABC-1234 --controller 127.0.0.1:47808               # read-only
  python edge_gateway.py --pair ABC-1234 --controller 127.0.0.1:47808 --allow-write # also apply commands
"""
from __future__ import annotations

import argparse
import asyncio
import time

import httpx
from bacpypes3.app import Application
from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.pdu import Address

VERSION = "1.0.0"
CLOUD = "https://d32ggz3cj7s7bx.cloudfront.net"
WRITABLE_TYPES = ("analog-value", "binary-value", "multi-state-value", "analog-output", "binary-output", "multi-state-output")
LIMITS = {"HeatSetpoint": (16.0, 30.0), "CoolSetpoint": (16.0, 30.0), "FanLevel": (1.0, 3.0)}


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def plain(v):
    """bacpypes3 primitive → JSON value."""
    s = str(v)
    if s in ("active", "inactive"):
        return "ON" if s == "active" else "OFF"
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return s


class Gateway:
    def __init__(self, a: argparse.Namespace):
        self.a = a
        host, _, port = a.controller.partition(":")
        self.host, self.port = host, int(port or 47808)
        self.addr = Address(f"{self.host}:{self.port}")
        self.app: Application | None = None  # created inside the event loop (run)
        self.points: list[dict] = []
        self.by_name: dict[str, dict] = {}
        self.device: dict = {}
        self.stats: dict = {}
        self.gid = None
        self.token = None

    async def discover(self) -> None:
        t0 = time.perf_counter()
        iams = await self.app.who_is(address=self.addr, timeout=3)
        self.stats["whois_ms"] = round((time.perf_counter() - t0) * 1000)
        if not iams:
            raise RuntimeError(f"중앙제어기 {self.host}:{self.port}에서 I-Am 응답이 없습니다")
        dev_id = iams[0].iAmDeviceIdentifier
        inst = int(str(dev_id).split(",")[1])
        name = str(await self.app.read_property(self.addr, f"device,{inst}", "object-name"))
        self.device = {"instance": inst, "name": name, "address": f"{self.host}:{self.port}", "protocol": "BACnet/IP"}
        objs = await self.app.read_property(self.addr, f"device,{inst}", "object-list")
        pts = []
        for oid in objs:
            s = str(oid)
            if s.startswith(("device", "network-port")):
                continue
            nm = str(await self.app.read_property(self.addr, oid, "object-name"))
            pts.append({"objid": s, "name": nm, "writable": s.split(",")[0] in WRITABLE_TYPES})
        self.points = pts
        self.by_name = {p["name"]: p for p in pts}
        log(f"중앙제어기 장치 {inst} '{name}' 발견 (Who-Is {self.stats['whois_ms']}ms), 객체 {len(pts)}개")

    async def read_all(self) -> list[dict]:
        t0 = time.perf_counter()
        sem = asyncio.Semaphore(16)

        async def one(p):
            async with sem:
                try:
                    v = await self.app.read_property(self.addr, p["objid"], "present-value")
                    return {**p, "value": plain(v)}
                except Exception as e:  # one bad point must not stop the poll
                    return {**p, "value": None, "error": str(e)[:80]}

        out = await asyncio.gather(*(one(p) for p in self.points))
        self.stats["read_ms"] = round((time.perf_counter() - t0) * 1000)
        self.stats["points"] = len(out)
        return list(out)

    async def pair(self, http: httpx.AsyncClient) -> None:
        r = await http.post("/api/gateway/pair", json={
            "pair_code": self.a.pair, "version": VERSION, "allow_write": self.a.allow_write,
            "controller": {"protocol": "bacnet", "host": self.host, "port": self.port, "device_instance": self.device.get("instance"),
                           "device_name": self.device.get("name"), "vendor": self.a.vendor}})
        r.raise_for_status()
        d = r.json()
        self.gid, self.token = d["gateway_id"], d["token"]
        log(f"클라우드 연결 완료: {self.gid} (코드 {self.a.pair}, {'쓰기 허용' if self.a.allow_write else '읽기 전용'})")

    async def execute(self, http: httpx.AsyncClient, cmd: dict) -> None:
        name, value = cmd.get("name"), cmd.get("value")
        p = self.by_name.get(name or "")
        body = {"gateway_id": self.gid, "id": cmd["id"]}
        prop = (name or "").split("/")[-1]
        lo, hi = LIMITS.get(prop, (None, None))
        if not self.a.allow_write:
            body.update(ok=False, refused=True, error="읽기 전용 게이트웨이(--allow-write 없음)")
        elif not p or not p["writable"]:
            body.update(ok=False, error=f"쓸 수 없는 포인트: {name}")
        elif lo is None or not isinstance(value, (int, float)) or not lo <= float(value) <= hi:
            body.update(ok=False, refused=True, error=f"허용 범위 밖 값: {name}={value}")
        else:
            try:
                await self.app.write_property(self.addr, p["objid"], "present-value", float(value), priority=8)
                rb = plain(await self.app.read_property(self.addr, p["objid"], "present-value"))
                ok = isinstance(rb, float) and abs(rb - float(value)) < 0.01
                body.update(ok=ok, readback=rb, error=None if ok else f"되읽은 값 {rb}")
                log(f"WRITE {name} = {value} (우선순위 8) → 되읽기 {rb} {'OK' if ok else 'MISMATCH'}")
            except Exception as e:
                body.update(ok=False, error=str(e)[:200])
        await http.post("/api/gateway/ack", json=body, headers={"x-gateway-token": self.token})

    async def run(self) -> None:
        args = SimpleArgumentParser().parse_args(["--name", "ThermoPlan-Gateway", "--instance", str(self.a.instance), "--address", self.a.local])
        self.app = Application.from_args(args)
        await self.discover()
        async with httpx.AsyncClient(base_url=self.a.cloud, timeout=30, headers={"User-Agent": f"ThermoPlan-EdgeGateway/{VERSION}"}) as http:
            await self.pair(http)
            poll = self.a.poll
            while True:
                try:
                    pts = await self.read_all()
                    r = await http.post("/api/gateway/telemetry", headers={"x-gateway-token": self.token}, json={
                        "gateway_id": self.gid, "version": VERSION, "device": self.device, "allow_write": self.a.allow_write,
                        "stats": self.stats, "points": [{k: p.get(k) for k in ("name", "objid", "value", "writable")} for p in pts]})
                    if r.status_code == 400:  # token no longer valid (e.g. demo reset): pair again
                        await self.pair(http)
                        continue
                    r.raise_for_status()
                    d = r.json()
                    poll = int(d.get("poll_s") or poll)
                    cmds = d.get("commands") or []
                    log(f"보고: 포인트 {len(pts)}개, 읽기 {self.stats['read_ms']}ms" + (f", 명령 {len(cmds)}건 수신" if cmds else ""))
                    for c in cmds:
                        await self.execute(http, c)
                except Exception as e:
                    log(f"오류: {type(e).__name__}: {e}")
                await asyncio.sleep(poll)


def main() -> None:
    ap = argparse.ArgumentParser(description="ThermoPlan 현장 게이트웨이")
    ap.add_argument("--pair", required=True, help="온보딩 2단계의 연결 코드")
    ap.add_argument("--controller", default="127.0.0.1:47808", help="중앙제어기 BACnet/IP 주소:포트")
    ap.add_argument("--local", default="127.0.0.1/32:47809", help="게이트웨이 BACnet/IP 바인드 주소 (예: 10.21.3.50/24:47808)")
    ap.add_argument("--instance", type=int, default=3999, help="게이트웨이 BACnet 장치 번호")
    ap.add_argument("--cloud", default=CLOUD)
    ap.add_argument("--vendor", default="BACnet 중앙제어기")
    ap.add_argument("--poll", type=int, default=15)
    ap.add_argument("--allow-write", action="store_true", help="클라우드 명령을 장비에 씁니다 (기본: 읽기 전용)")
    try:
        asyncio.run(Gateway(ap.parse_args()).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
