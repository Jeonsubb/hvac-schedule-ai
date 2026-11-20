"""Virtual central controller for IT관: a real BACnet/IP device (bacpypes3) that exposes the building's
HVAC points, standing in for the vendor central-control PC until the team gets access to the real one.

Objects (named "<device>/<property>", the naming rule the gateway maps to rooms):
  IDU-306-1/OnOff        binary-input   running state (from the cloud thermal simulator)
  IDU-306-1/RoomTemp     analog-input   indoor temperature ℃ (simulator)
  IDU-306-1/HeatSetpoint analog-value   commandable (priority array), written by the gateway
  IDU-306-1/CoolSetpoint analog-value   commandable
  ERV-306/FanLevel       analog-value   commandable, 1 약 / 2 중 / 3 강
  SENS-306/CO2           analog-input   ppm, from occupancy and the current fan level
  AP-306/Clients         analog-input   Wi-Fi clients (expected people of the running class)
  ODU-3F/Power           analog-input   kW (simulator)

Values follow the cloud simulator (/api/live) every --sync seconds, so the BACnet device is a live
mirror of the digital twin. Writes from the gateway are kept in each object's priority array and logged.

  python virtual_controller.py --address 127.0.0.1/32:47808
"""
from __future__ import annotations

import argparse
import asyncio
import time

import httpx
from bacpypes3.app import Application
from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.local.analog import AnalogInputObject, AnalogValueObjectCmd
from bacpypes3.local.binary import BinaryInputObject

CLOUD = "https://d32ggz3cj7s7bx.cloudfront.net"
FAN_Q = {1: 600.0, 2: 1000.0, 3: 1400.0}  # m3/h, 99 m2 classroom ERV levels (same as the cloud planner)
FLAGS = [0, 0, 0, 0]


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


class Controller:
    def __init__(self, app: Application, meta: dict):
        self.app = app
        self.obj: dict[str, object] = {}
        self.rooms = meta["rooms"]
        self.odus = meta["odus"]
        st = meta.get("settings") or {}
        n = {"ai": 0, "av": 0, "bi": 0}

        def add(kind: str, name: str, **kw):
            n[kind] += 1
            if kind == "ai":
                o = AnalogInputObject(objectIdentifier=("analogInput", n[kind]), objectName=name, statusFlags=FLAGS, covIncrement=0.1, **kw)
            elif kind == "av":
                o = AnalogValueObjectCmd(objectIdentifier=("analogValue", n[kind]), objectName=name, statusFlags=FLAGS, covIncrement=0.1,
                                         relinquishDefault=kw["presentValue"], **kw)
            else:
                o = BinaryInputObject(objectIdentifier=("binaryInput", n[kind]), objectName=name, statusFlags=FLAGS, polarity="normal", **kw)
            app.add_object(o)
            self.obj[name] = o

        for r, room in sorted(self.rooms.items()):
            for idu in room["idus"]:
                i = idu["id"]
                add("bi", f"{i}/OnOff", presentValue="inactive")
                add("ai", f"{i}/RoomTemp", presentValue=20.0, units="degreesCelsius")
                add("av", f"{i}/HeatSetpoint", presentValue=float(st.get("sp_heat", 20.0)), units="degreesCelsius")
                add("av", f"{i}/CoolSetpoint", presentValue=float(st.get("sp_cool", 26.0)), units="degreesCelsius")
            add("av", f"ERV-{r}/FanLevel", presentValue=2.0, units="noUnits")
            add("ai", f"SENS-{r}/CO2", presentValue=450.0, units="partsPerMillion")
            add("ai", f"AP-{r}/Clients", presentValue=0.0, units="noUnits")
        for o in sorted(self.odus):
            add("ai", f"{o}/Power", presentValue=0.0, units="kilowatts")
        self.written = {k: float(v.presentValue) for k, v in self.obj.items() if k.endswith(("Setpoint", "FanLevel"))}
        log(f"BACnet objects: {len(self.obj)} (IDU {sum(len(r['idus']) for r in self.rooms.values())}, rooms {len(self.rooms)}, ODU {len(self.odus)})")

    def apply_live(self, live: dict) -> None:
        for x in live.get("rooms", []):
            r = x["room"]
            on = x.get("state") in ("ON", "FAN")
            people = float(((x.get("session") or {}).get("expected_people")) or 0)
            for idu in self.rooms.get(r, {}).get("idus", []):
                self.obj[f"{idu['id']}/OnOff"].presentValue = "active" if on else "inactive"
                self.obj[f"{idu['id']}/RoomTemp"].presentValue = float(x.get("ta") or 0.0)
            self.obj[f"AP-{r}/Clients"].presentValue = people
            fan = int(round(float(self.obj[f"ERV-{r}/FanLevel"].presentValue)))
            area = float(self.rooms[r].get("area", 99.0))
            q = FAN_Q.get(fan, 1000.0) * area / 99.0 + 0.3 * area * 2.7
            self.obj[f"SENS-{r}/CO2"].presentValue = round(420.0 + people * 0.016e6 / q, 0) if people else 450.0
        for o, v in (live.get("odus") or {}).items():
            if f"{o}/Power" in self.obj:
                self.obj[f"{o}/Power"].presentValue = round(float(v.get("power_w") or 0) / 1000.0, 2)

    def report_writes(self) -> None:
        for k, old in list(self.written.items()):
            v = float(self.obj[k].presentValue)
            if abs(v - old) > 1e-6:
                log(f"WRITE 수신  {k}: {old:g} → {v:g}")
                self.written[k] = v


async def main() -> None:
    ap = argparse.ArgumentParser(description="IT관 가상 중앙제어기 (BACnet/IP)")
    ap.add_argument("--cloud", default=CLOUD)
    ap.add_argument("--address", default="127.0.0.1/32:47808", help="BACnet/IP bind address, e.g. 192.168.0.20/24:47808")
    ap.add_argument("--instance", type=int, default=3001)
    ap.add_argument("--name", default="IT관 중앙제어기(가상)")
    ap.add_argument("--sync", type=int, default=30, help="seconds between simulator syncs")
    a = ap.parse_args()

    args = SimpleArgumentParser().parse_args(["--name", a.name, "--instance", str(a.instance), "--address", a.address])
    app = Application.from_args(args)
    async with httpx.AsyncClient(base_url=a.cloud, timeout=20, headers={"User-Agent": "ThermoPlan-VirtualController/1.0"}) as http:
        meta = (await http.get("/api/meta")).json()
        ctl = Controller(app, meta)
        log(f"BACnet device {a.instance} '{a.name}' listening on {a.address}")
        last = 0.0
        while True:
            if time.time() - last >= a.sync:
                try:
                    live = (await http.get("/api/live")).json()
                    ctl.apply_live(live)
                    on = sum(1 for x in live.get("rooms", []) if x.get("state") != "OFF")
                    log(f"simulator sync: {live['now']['date']} {live['now']['minute'] // 60:02d}:{live['now']['minute'] % 60:02d}, 가동 {on}실")
                except Exception as e:  # keep serving BACnet even if the cloud is unreachable
                    log(f"simulator sync failed: {e}")
                last = time.time()
            ctl.report_writes()
            await asyncio.sleep(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
