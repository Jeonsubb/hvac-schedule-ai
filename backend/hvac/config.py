"""Static configuration: building, rooms, devices, semester and default operating rules.

Values the timetable does not contain are explicit assumptions and are exposed to
the UI with `assumption=True` so operators can see (and later edit) them.
"""
from __future__ import annotations

import copy
from datetime import date

BUILDING = {
    "id": "IT",
    "name": "IT관",
    "campus": "부산대학교 부산캠퍼스",
    "lat": 35.2316,
    "lon": 129.0825,
    "kma_nx": 98,
    "kma_ny": 77,
}

# Room type -> physical defaults (assumptions; timetable has no physical data).
ROOM_TYPES = {
    "lecture": {"label": "학부강의실", "area": 99.0, "capacity": 60, "pcs": 0},
    "lab": {"label": "SW실습실", "area": 99.0, "capacity": 40, "pcs": 40},
    "studio": {"label": "스튜디오", "area": 66.0, "capacity": 30, "pcs": 0},
}

# room number -> (type, ODU id, number of IDUs)
_ROOMS = {
    "306": ("lecture", "ODU-3F", 2),
    "307": ("lecture", "ODU-3F", 2),
    "309": ("lab", "ODU-3F", 2),
    "310": ("lab", "ODU-3F", 2),
    "405": ("lecture", "ODU-4F-A", 2),
    "406": ("lecture", "ODU-4F-A", 2),
    "407": ("lecture", "ODU-4F-A", 2),
    "408": ("lecture", "ODU-4F-B", 2),
    "409": ("lab", "ODU-4F-B", 2),
    "410": ("studio", "ODU-4F-B", 1),
}

IDU_COOL_KW = 7.2
IDU_HEAT_KW = 8.1
STUDIO_IDU_KW = 9.0

ODUS = {
    "ODU-3F": {"id": "ODU-3F", "label": "3층 실외기", "floor": 3, "cap_kw": 45.0},
    "ODU-4F-A": {"id": "ODU-4F-A", "label": "4층 실외기 A", "floor": 4, "cap_kw": 40.0},
    "ODU-4F-B": {"id": "ODU-4F-B", "label": "4층 실외기 B", "floor": 4, "cap_kw": 35.0},
}


def build_rooms() -> dict[str, dict]:
    rooms: dict[str, dict] = {}
    for num, (rtype, odu, n_idu) in _ROOMS.items():
        t = ROOM_TYPES[rtype]
        if rtype == "studio":
            cool = heat = STUDIO_IDU_KW
        else:
            cool, heat = IDU_COOL_KW, IDU_HEAT_KW
        rooms[num] = {
            "id": num,
            "building": BUILDING["name"],
            "floor": int(num[0]),
            "type": rtype,
            "type_label": t["label"],
            "area": t["area"],
            "capacity": t["capacity"],
            "pcs": t["pcs"],
            "odu": odu,
            "idus": [
                {"id": f"IDU-{num}-{i + 1}", "cool_kw": cool, "heat_kw": heat}
                for i in range(n_idu)
            ],
            "assumption": True,
        }
    return rooms


ROOMS = build_rooms()

SEMESTER = {
    "year": 2026,
    "term": "2학기",
    "start": date(2026, 9, 1),
    "end": date(2026, 12, 18),
}

# Public holidays inside the semester (특일정보 API not authorised for this key).
HOLIDAYS = {
    date(2026, 9, 24): "추석 연휴",
    date(2026, 9, 25): "추석",
    date(2026, 10, 5): "개천절 대체공휴일",
    date(2026, 10, 9): "한글날",
}

# Attendance ratio by grade label, used to estimate expected_people (assumption).
ATTENDANCE_BY_GRADE = {
    "1학년": 0.9,
    "2학년": 0.85,
    "3학년": 0.75,
    "4학년": 0.6,
    "대학원": 0.5,
    "전학년": 0.7,
}

DEFAULT_SETTINGS = {
    # requirement 5 rules
    "pre_on_min": 10,
    "early_off_min": 5,
    "gap_merge_min": 15,
    # setpoints / comfort
    "sp_heat": 20.0,
    "sp_cool": 26.0,
    "comfort_low": 19.5,
    "comfort_high": 26.5,
    # baselines
    "fixed_on": "08:30",
    "fixed_off": "22:30",
    "manual_off_delay_min": 30,
    "baseline": "fixed",
    # AI optimiser bounds
    "ai_max_lead_min": 90,
    "ai_max_early_off_min": 15,
    "ai_gap_eval_max_min": 120,
    "dehum_rh": 75.0,
    "dehum_temp": 22.0,
    # field anomaly injection for validation demo
    "anomalies": True,
    "override_rate": 0.02,
    "failure_rate": 0.01,
    "auto_off_after_min": 10,
    # economics (approximate; see docs/research)
    "tariff": {"summer": 140.0, "spring_fall": 100.0, "winter": 125.0},
    "co2_kg_per_kwh": 0.4594,
}

STRATEGIES = {
    "fixed": "고정 스케줄",
    "manual": "수동 운영",
    "rule": "규칙 기반",
    "ai": "AI 최적화",
}


def default_settings() -> dict:
    return copy.deepcopy(DEFAULT_SETTINGS)
