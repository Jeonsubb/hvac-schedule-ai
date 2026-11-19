"""Timetable ingestion and expansion into dated sessions.

Pipeline:
  raw grid CSV/Excel (30-min slots x weekday columns)  -> course blocks (weekly recurring)
  course blocks + semester calendar + holidays + events -> dated sessions
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, timedelta

from .config import ATTENDANCE_BY_GRADE, HOLIDAYS, ROOMS, SEMESTER

WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]
_CELL_RE = re.compile(r"^(?P<name>.*)\((?P<code>[A-Z]{2}\d{6,8})\)-(?P<section>\w+)$")


def hm_to_min(hm: str) -> int:
    h, m = hm.strip().split(":")[:2]
    return int(h) * 60 + int(m)


def min_to_hm(m: int) -> str:
    m = int(round(m))
    return f"{m // 60:02d}:{m % 60:02d}"


def parse_cell(cell: str) -> dict:
    """`자료구조(CB1501019)-062,조환규,컴퓨터공학전공,2학년` -> fields."""
    parts = [p.strip() for p in cell.split(",")]
    head = parts[0]
    m = _CELL_RE.match(head)
    if m:
        name, code, section = m.group("name"), m.group("code"), m.group("section")
    else:
        name, code, section = head, "", ""
    prof = parts[1] if len(parts) > 1 else ""
    dept = parts[2] if len(parts) > 2 else ""
    grade = parts[3] if len(parts) > 3 else ""
    return {
        "class_name": name.strip(),
        "course_code": code,
        "section": section,
        "professor": prof,
        "dept": dept,
        "grade": grade,
    }


def estimate_people(room: str, grade: str) -> int:
    cap = ROOMS.get(room, {}).get("capacity", 50)
    ratio = ATTENDANCE_BY_GRADE.get(grade, 0.75)
    return max(1, int(round(cap * ratio)))


def _course_id(room: str, weekday: int, start: str, code: str, section: str, name: str) -> str:
    raw = f"{room}|{weekday}|{start}|{code}|{section}|{name}"
    return "C" + hashlib.sha1(raw.encode()).hexdigest()[:10]


def grid_rows_to_courses(rows: list[dict], source: str) -> list[dict]:
    """Merge consecutive identical 30-min slots into weekly course blocks."""
    slots: dict[tuple[str, str, int], list[tuple[int, int, str]]] = {}
    building_of: dict[str, str] = {}
    for r in rows:
        room = str(r.get("강의실번호", "")).strip()
        if not room:
            continue
        building_of[room] = str(r.get("건물", "")).strip()
        s, e = hm_to_min(str(r["시작시간"])), hm_to_min(str(r["종료시간"]))
        for wd, label in enumerate(WEEKDAYS):
            if label not in r:
                continue
            cell = str(r.get(label) or "").strip()
            slots.setdefault((building_of[room], room, wd), []).append((s, e, cell))

    courses: list[dict] = []
    for (bld, room, wd), lst in slots.items():
        lst.sort()
        cur: list | None = None
        blocks = []
        for s, e, cell in lst:
            if cell and cur and cur[2] == cell and cur[1] == s:
                cur[1] = e
            else:
                if cur and cur[2]:
                    blocks.append(tuple(cur))
                cur = [s, e, cell]
        if cur and cur[2]:
            blocks.append(tuple(cur))
        for s, e, cell in blocks:
            f = parse_cell(cell)
            start, end = min_to_hm(s), min_to_hm(e)
            courses.append(
                {
                    "id": _course_id(room, wd, start, f["course_code"], f["section"], f["class_name"]),
                    "building": bld,
                    "room": room,
                    "weekday": wd,
                    "start": start,
                    "end": end,
                    **f,
                    "expected_people": estimate_people(room, f["grade"]),
                    "people_estimated": True,
                    "source": source,
                }
            )
    courses.sort(key=lambda c: (c["room"], c["weekday"], c["start"]))
    return courses


def parse_grid_csv(text: str, source: str = "csv") -> list[dict]:
    text = text.lstrip("﻿")
    rows = list(csv.DictReader(io.StringIO(text)))
    rows = [{(k or "").lstrip("﻿").strip(): v for k, v in r.items()} for r in rows]
    return grid_rows_to_courses(rows, source)


def parse_grid_xlsx(data: bytes, source: str = "excel") -> list[dict]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.active
    it = ws.iter_rows(values_only=True)
    header = [str(h or "").strip() for h in next(it)]
    rows = []
    for vals in it:
        r = {}
        for h, v in zip(header, vals):
            if hasattr(v, "strftime"):
                v = v.strftime("%H:%M")
            r[h] = "" if v is None else str(v)
        rows.append(r)
    if {"시작시간", "종료시간", "강의실번호"} <= set(header):
        return grid_rows_to_courses(rows, source)
    return normalize_records(rows, source)


_FIELD_ALIASES = {
    "building": ["building", "건물"],
    "room": ["room", "강의실", "강의실번호"],
    "weekday": ["weekday", "요일"],
    "date": ["date", "날짜", "일자"],
    "start": ["start", "start_time", "시작", "시작시간"],
    "end": ["end", "end_time", "종료", "종료시간"],
    "class_name": ["class_name", "과목", "과목명", "강의명", "title"],
    "professor": ["professor", "교수", "담당교수"],
    "expected_people": ["expected_people", "인원", "수강인원", "예상인원"],
    "grade": ["grade", "학년"],
}


def _pick(rec: dict, key: str):
    for a in _FIELD_ALIASES[key]:
        if a in rec and rec[a] not in (None, ""):
            return rec[a]
    return None


def normalize_records(records: list[dict], source: str) -> list[dict]:
    """Normalise long-format records (API / DB / LLM extraction) into course blocks.

    Records with a weekday become weekly courses; records with a date are returned
    with `date` set so the caller can register them as one-off events.
    """
    out = []
    for rec in records:
        room = str(_pick(rec, "room") or "").strip()
        room = re.sub(r"[^0-9A-Za-z-]", "", room.replace("호", ""))
        start, end = _pick(rec, "start"), _pick(rec, "end")
        if not room or not start or not end:
            continue
        wd_raw = _pick(rec, "weekday")
        wd = None
        if wd_raw is not None:
            s = str(wd_raw).strip()
            if s and s[0] in WEEKDAYS:
                wd = WEEKDAYS.index(s[0])
            elif s.isdigit():
                wd = int(s)
        d = _pick(rec, "date")
        grade = str(_pick(rec, "grade") or "")
        people = _pick(rec, "expected_people")
        est = people in (None, "")
        name = str(_pick(rec, "class_name") or "수업")
        start_s = min_to_hm(hm_to_min(str(start)))
        end_s = min_to_hm(hm_to_min(str(end)))
        item = {
            "building": str(_pick(rec, "building") or "IT관"),
            "room": room,
            "weekday": wd,
            "date": str(d) if d else None,
            "start": start_s,
            "end": end_s,
            "class_name": name,
            "course_code": str(rec.get("course_code") or ""),
            "section": str(rec.get("section") or ""),
            "professor": str(_pick(rec, "professor") or ""),
            "dept": str(rec.get("dept") or ""),
            "grade": grade,
            "expected_people": int(float(people)) if not est else estimate_people(room, grade),
            "people_estimated": est,
            "source": source,
        }
        item["id"] = _course_id(room, wd if wd is not None else -1, start_s, item["course_code"], item["section"], name + (item["date"] or ""))
        out.append(item)
    return out


# ---------------------------------------------------------------- sessions

def semester_dates(start: date | None = None, end: date | None = None) -> list[date]:
    s = start or SEMESTER["start"]
    e = end or SEMESTER["end"]
    out, d = [], s
    while d <= e:
        out.append(d)
        d += timedelta(days=1)
    return out


def sessions_for_date(d: date, courses: list[dict], events: list[dict], holidays: dict | None = None) -> list[dict]:
    """Dated sessions for one day after applying holidays and events.

    Event types: add | cancel | move | closure.
    """
    holidays = HOLIDAYS if holidays is None else holidays
    iso = d.isoformat()
    sessions: list[dict] = []
    in_semester = SEMESTER["start"] <= d <= SEMESTER["end"]
    day_events = [e for e in events if e.get("date") == iso]
    closure = any(e["type"] == "closure" for e in day_events)

    if in_semester and d not in holidays and not closure:
        wd = d.weekday()
        for c in courses:
            if c.get("weekday") != wd:
                continue
            sessions.append(
                {
                    "id": f"{iso}:{c['id']}",
                    "date": iso,
                    "room": c["room"],
                    "start": c["start"],
                    "end": c["end"],
                    "title": c["class_name"],
                    "professor": c.get("professor", ""),
                    "kind": "lecture",
                    "course_id": c["id"],
                    "expected_people": c["expected_people"],
                    "people_estimated": c.get("people_estimated", False),
                }
            )

    for e in day_events:
        t = e["type"]
        if t == "cancel":
            sessions = [
                s
                for s in sessions
                if not (
                    (e.get("course_id") and s.get("course_id") == e["course_id"])
                    or (
                        not e.get("course_id")
                        and s["room"] == e.get("room")
                        and _overlaps(s, e)
                    )
                )
            ]
        elif t == "move":
            for s in sessions:
                if s.get("course_id") == e.get("course_id"):
                    s["room"] = e.get("new_room") or s["room"]
                    s["start"] = e.get("new_start") or s["start"]
                    s["end"] = e.get("new_end") or s["end"]
                    s["moved_by"] = e["id"]
        elif t == "add":
            sessions.append(
                {
                    "id": f"{iso}:{e['id']}",
                    "date": iso,
                    "room": e["room"],
                    "start": e["start"],
                    "end": e["end"],
                    "title": e.get("title") or "이벤트",
                    "professor": e.get("host", ""),
                    "kind": "event",
                    "event_id": e["id"],
                    "expected_people": int(e.get("expected_people") or estimate_people(e["room"], "")),
                    "people_estimated": not e.get("expected_people"),
                }
            )
    sessions.sort(key=lambda s: (s["room"], s["start"]))
    return sessions


def _overlaps(s: dict, e: dict) -> bool:
    if not e.get("start") or not e.get("end"):
        return True
    return hm_to_min(s["start"]) < hm_to_min(e["end"]) and hm_to_min(e["start"]) < hm_to_min(s["end"])
