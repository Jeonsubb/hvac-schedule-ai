"""Physics: 2R2C room thermal model, VRF heat-pump performance and PMV comfort.

Room model (per room, 1-minute explicit Euler):
  Ca dTa/dt = Gam (Tm - Ta) + Gao (To - Ta) + Qint + Qsol + Qhvac
  Cm dTm/dt = Gam (Ta - Tm) + Gmo (To - Tm)
Ta: indoor air node, Tm: structure/surface node (also used as mean radiant temp).
"""
from __future__ import annotations

import math

DT = 60.0  # seconds per step

PERSON_W = 75.0  # sensible heat per seated person
LIGHT_W_M2 = 10.0
PC_W = 100.0
SHGC = 0.4
VERT_FACTOR = 0.5  # vertical facade irradiance as a share of global horizontal
IDU_FAN_W = 60.0
ODU_BASE_W = 300.0
VENT_M3H_PP = 25.0  # outdoor air per person (classroom)
ERV_EFF = 0.6  # energy recovery ventilator sensible effectiveness


class RoomPhys:
    __slots__ = ("id", "ca", "cm", "gam", "gao", "gmo", "gadj", "win", "cap_heat", "cap_cool",
                 "n_idu", "area", "pcs", "odu")

    def __init__(self, room: dict):
        s = room["area"] / 99.0
        self.id = room["id"]
        self.ca = 1.5e6 * s
        self.cm = 20.0e6 * s
        self.gam = 1050.0 * s
        self.gao = 80.0 * s
        self.gmo = 60.0 * s
        self.gadj = 80.0 * s  # partitions / slabs to neighbouring rooms and corridors
        self.win = 10.0 * s
        self.cap_heat = sum(i["heat_kw"] for i in room["idus"]) * 1000.0
        self.cap_cool = sum(i["cool_kw"] for i in room["idus"]) * 1000.0
        self.n_idu = len(room["idus"])
        self.area = room["area"]
        self.pcs = room["pcs"]
        self.odu = room["odu"]

    def internal_gain(self, people: float) -> float:
        if people <= 0:
            return 0.0
        return people * PERSON_W + LIGHT_W_M2 * self.area + self.pcs * PC_W

    def solar_gain(self, ghi: float) -> float:
        return self.win * SHGC * VERT_FACTOR * max(ghi, 0.0)

    @staticmethod
    def vent_g(people: float, economizer: bool) -> float:
        """Outdoor-air conductance (W/K). ERV (60 % recovery) at 25 m3/h/person while
        occupied; economizer (FAN mode) bypasses recovery and doubles the flow."""
        if people <= 0:
            return 0.0
        g = people * VENT_M3H_PP * 1.2 * 1005.0 / 3600.0
        return g * 2.0 if economizer else g * (1.0 - ERV_EFF)


def thermostat_q(rp: RoomPhys, ta: float, passive: float, sp_heat: float, sp_cool: float,
                 cap_frac: float = 1.0) -> float:
    """Ideal capacity-limited thermostat: heat/cool just enough to stay inside [sp_heat, sp_cool].
    cap_frac limits IDU output (soft start)."""
    ta_free = ta + DT * passive / rp.ca
    if ta_free < sp_heat:
        q = rp.ca * (sp_heat - ta) / DT - passive
        return min(max(q, 0.0), rp.cap_heat * cap_frac)
    if ta_free > sp_cool:
        q = rp.ca * (sp_cool - ta) / DT - passive
        return max(min(q, 0.0), -rp.cap_cool * cap_frac)
    return 0.0


def cop_cool(to: float) -> float:
    return 3.8 * min(max(1.0 + 0.03 * (35.0 - to), 0.8), 1.6)


def cop_heat(to: float) -> float:
    return 3.4 * min(max(1.0 + 0.025 * (to - 7.0), 0.55), 1.3)


def plr_factor(plr: float) -> float:
    """Electric input per unit heat vs. full load, shaped after the EnergyPlus
    VariableRefrigerantFlow_5Zone example curves: ~1.2x more efficient at 50-60 %
    part load than at full load; below 25 % the compressor cycles and efficiency drops."""
    p = min(max(plr, 0.02), 1.2)
    if p >= 0.25:
        return 1.037 * p * p - 1.2296 * p + 1.1926
    return 0.95 * (0.25 / p) ** 0.35


def electric_w(q: float, to: float, plr: float) -> float:
    if q > 0:
        return q / cop_heat(to) * plr_factor(plr)
    if q < 0:
        return -q / cop_cool(to) * plr_factor(plr)
    return 0.0


def psat_kpa(t: float) -> float:
    return 0.61094 * math.exp(17.625 * t / (t + 243.04))


def indoor_rh(to: float, rh_out: float, ta: float) -> float:
    pv = psat_kpa(to) * rh_out / 100.0
    return min(max(100.0 * pv / psat_kpa(ta), 15.0), 90.0)


def pmv(ta: float, tr: float, rh: float, clo: float, met: float = 1.1, vel: float = 0.1) -> float:
    """ISO 7730 PMV (Fanger)."""
    pa = rh * 10.0 * math.exp(16.6536 - 4030.183 / (ta + 235.0))
    icl = 0.155 * clo
    m = met * 58.15
    w = 0.0
    mw = m - w
    fcl = 1.0 + 1.29 * icl if icl <= 0.078 else 1.05 + 0.645 * icl
    hcf = 12.1 * math.sqrt(vel)
    taa = ta + 273.0
    tra = tr + 273.0
    tcla = taa + (35.5 - ta) / (3.5 * icl + 0.1)
    p1 = icl * fcl
    p2 = p1 * 3.96
    p3 = p1 * 100.0
    p4 = p1 * taa
    p5 = 308.7 - 0.028 * mw + p2 * (tra / 100.0) ** 4
    xn = tcla / 100.0
    xf = tcla / 50.0
    hc = hcf
    n = 0
    while abs(xn - xf) > 0.00015 and n < 150:
        xf = (xf + xn) / 2.0
        hcn = 2.38 * abs(100.0 * xf - taa) ** 0.25
        hc = max(hcf, hcn)
        xn = (p5 + p4 * hc - p2 * xf ** 4) / (100.0 + p3 * hc)
        n += 1
    tcl = 100.0 * xn - 273.0
    hl1 = 3.05 * 0.001 * (5733.0 - 6.99 * mw - pa)
    hl2 = 0.42 * (mw - 58.15) if mw > 58.15 else 0.0
    hl3 = 1.7 * 0.00001 * m * (5867.0 - pa)
    hl4 = 0.0014 * m * (34.0 - ta)
    hl5 = 3.96 * fcl * (xn ** 4 - (tra / 100.0) ** 4)
    hl6 = fcl * hc * (tcl - ta)
    ts = 0.303 * math.exp(-0.036 * m) + 0.028
    return ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6)


def clo_for_month(month: int) -> float:
    return {6: 0.5, 7: 0.5, 8: 0.5, 9: 0.55, 10: 0.75, 11: 0.95, 12: 1.0}.get(month, 0.9)


def adjacent_temp(to_daily_mean: float) -> float:
    """Temperature of neighbouring spaces (corridors, other rooms) seen by the structure node."""
    return min(max(0.5 * to_daily_mean + 10.0, 17.0), 26.0)
