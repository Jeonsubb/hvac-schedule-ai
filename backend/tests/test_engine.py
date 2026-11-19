from datetime import date, timedelta
from pathlib import Path

import pytest

from hvac import config, engine, strategies, timetable

CSV = Path(__file__).resolve().parents[1] / "seed" / "timetable_3_4.csv"


@pytest.fixture(scope="module")
def courses():
    return timetable.parse_grid_csv(CSV.read_text(encoding="utf-8-sig"))


def flat_weather(t: float, rh: float = 55.0, ghi_peak: float = 400.0):
    ghi = [max(0.0, ghi_peak * (1 - abs(h - 12) / 6)) for h in range(24)]
    day = {"t": [t] * 24, "rh": [rh] * 24, "ghi": ghi}
    return {"actual": day, "forecast": {k: list(v) for k, v in day.items()}, "src_actual": "test", "src_forecast": "test"}


def weather_for(d: date, t: float):
    return {(d - timedelta(days=i)).isoformat(): flat_weather(t) for i in range(0, 4)}


# ---------------------------------------------------------------- timetable

def test_csv_blocks(courses):
    assert len(courses) == 129
    assert {c["room"] for c in courses} == set(config.ROOMS)
    assert not any(c["weekday"] == 5 for c in courses)  # no Saturday lectures


def test_cell_parsing_handles_parentheses_and_spaces():
    f = timetable.parse_cell("일반물리학(II)(CB1501009)-060,양임정,컴퓨터공학전공,1학년")
    assert f == {"class_name": "일반물리학(II)", "course_code": "CB1501009", "section": "060",
                 "professor": "양임정", "dept": "컴퓨터공학전공", "grade": "1학년"}
    assert timetable.parse_cell("자료구조(CB1501019)-060,안성용 ,컴퓨터공학전공,2학년")["professor"] == "안성용"


def test_holiday_and_out_of_semester(courses):
    assert timetable.sessions_for_date(date(2026, 10, 9), courses, []) == []  # 한글날 (Fri)
    assert timetable.sessions_for_date(date(2026, 8, 31), courses, []) == []
    assert len(timetable.sessions_for_date(date(2026, 11, 18), courses, [])) > 0


def test_events_add_cancel_move(courses):
    d = date(2026, 11, 18)
    base = timetable.sessions_for_date(d, courses, [])
    target = base[0]
    evs = [
        {"id": "E1", "type": "cancel", "date": d.isoformat(), "course_id": target["course_id"]},
        {"id": "E2", "type": "add", "date": d.isoformat(), "room": "408", "start": "18:00", "end": "20:00", "title": "세미나", "expected_people": 40},
    ]
    after = timetable.sessions_for_date(d, courses, evs)
    assert all(s.get("course_id") != target["course_id"] for s in after)
    assert any(s["title"] == "세미나" and s["room"] == "408" for s in after)
    moved = timetable.sessions_for_date(d, courses, [{"id": "E3", "type": "move", "date": d.isoformat(),
                                                    "course_id": target["course_id"], "new_room": "410"}])
    assert next(s for s in moved if s.get("course_id") == target["course_id"])["room"] == "410"
    closed = timetable.sessions_for_date(d, courses, [{"id": "E4", "type": "closure", "date": d.isoformat()}])
    assert closed == []


# ---------------------------------------------------------------- rule strategy (requirement 5)

def _s(room, start, end, sid):
    return {"id": sid, "room": room, "start": start, "end": end, "title": sid, "expected_people": 30}


def test_rule_pre_on_early_off_and_gap_merge():
    st = config.default_settings()
    by_room = {"306": [_s("306", "09:00", "10:30", "a"), _s("306", "10:40", "12:00", "b"), _s("306", "13:30", "15:00", "c")]}
    plan = strategies.plan_rule(by_room, {"306": config.ROOMS["306"]}, st)["306"]
    # a and b are 10 min apart (<=15) -> one interval; c separate
    assert len(plan) == 2
    assert plan[0]["s"] == 9 * 60 - 10  # 10 min before
    assert plan[0]["e"] == 12 * 60 - 5  # 5 min before end of b
    assert plan[1]["s"] == 13 * 60 + 20 and plan[1]["e"] == 15 * 60 - 5


def test_rule_gap_larger_than_threshold_is_split():
    st = config.default_settings()
    by_room = {"306": [_s("306", "09:00", "10:30", "a"), _s("306", "10:50", "12:00", "b")]}  # 20 min gap
    assert len(strategies.plan_rule(by_room, {"306": config.ROOMS["306"]}, st)["306"]) == 2


# ---------------------------------------------------------------- simulation & validation

def test_no_anomaly_day_validates_fully(courses):
    st = config.default_settings()
    st["anomalies"] = False
    d = date(2026, 11, 18)
    day = engine.compute_day(d, courses, [], weather_for(d, 12.0), st)
    v = day["validation"]
    assert v["total"] == len(day["sessions"]) > 0
    assert v["plan_coverage"] == 100.0
    assert v["match_rate"] == 100.0


def test_cold_day_needs_more_energy_and_ai_keeps_comfort(courses):
    st = config.default_settings()
    st["anomalies"] = False
    d = date(2026, 12, 9)
    cold = engine.compute_day(d, courses, [], weather_for(d, 0.0), st)
    mild = engine.compute_day(d, courses, [], weather_for(d, 15.0), st)
    for stg in ("fixed", "rule", "ai"):
        assert cold["strategies"][stg]["kwh"] > mild["strategies"][stg]["kwh"]
    assert cold["strategies"]["ai"]["comfort_pct"] >= cold["strategies"]["rule"]["comfort_pct"]
    assert cold["strategies"]["fixed"]["kwh"] > cold["strategies"]["ai"]["kwh"]


def test_mild_day_ai_skips_or_uses_economizer(courses):
    st = config.default_settings()
    st["anomalies"] = False
    d = date(2026, 10, 14)
    day = engine.compute_day(d, courses, [], weather_for(d, 17.0), st)
    kinds = {x["type"] for x in day["decisions"]}
    assert kinds & {"skip", "economizer", "late_start"}
    assert day["strategies"]["ai"]["kwh"] < day["strategies"]["rule"]["kwh"]


def test_anomalies_are_detected_and_auto_handled(courses):
    st = config.default_settings()
    st.update(override_rate=0.5, failure_rate=0.0)
    d = date(2026, 11, 18)
    day = engine.compute_day(d, courses, [], weather_for(d, 8.0), st)
    statuses = {x["status"] for x in day["validation"]["sessions"]}
    assert "override" in statuses
    causes = {h["cause"] for h in day["history"]}
    assert any("자동 정지" in c for c in causes)


def test_history_has_on_off_pairs(courses):
    st = config.default_settings()
    d = date(2026, 11, 18)
    day = engine.compute_day(d, courses, [], weather_for(d, 8.0), st)
    for dev in {h["device"] for h in day["history"]}:
        states = [h["state"] for h in day["history"] if h["device"] == dev]
        assert states[0] in ("ON", "FAN")
        assert states[-1] == "OFF"


# ---------------------------------------------------------------- product-review regressions

def test_vacancy_stop_keeps_next_class_preheat(courses):
    from hvac.engine import ai_field_controls

    plans = {"306": [{"s": 13 * 60 + 20, "e": 18 * 60, "kind": "cond", "sessions": ["a", "b"]}]}
    sessions = {"306": [_s("306", "13:30", "15:00", "a"), _s("306", "15:00", "16:30", "b")]}
    scenario = {"306": [{"type": "no_show", "session": "a", "s": 13 * 60 + 30, "e": 15 * 60}]}
    st = config.default_settings()
    anomalies, _ = ai_field_controls(plans, scenario, st, sessions)
    off = anomalies["306"][0]
    assert off["s"] == 13 * 60 + 40
    assert off["e"] <= 15 * 60 - st.get("vacancy_resume_lead_min", 30)  # unit back on before class b


def test_attribution_variants_and_waterfall(courses):
    from hvac import attribution

    st = config.default_settings()
    d = date(2026, 12, 9)
    day = attribution.variants_day(d, courses, [], weather_for(d, 1.0), st)
    assert set(day["variants"]) == set(attribution.VARIANTS)
    v = day["variants"]
    assert v["fixed"]["kwh"] > v["rule"]["kwh"]
    assert v["ai"]["cold_starts"] <= v["rule"]["cold_starts"]
    agg = attribution.aggregate([day])
    assert [w["variant"] for w in agg["waterfall"]] == ["fixed", "rule", "ai_predictive", "ai_weather", "ai"]
    assert abs(sum(w["delta_kwh"] or 0 for w in agg["waterfall"]) - (v["ai"]["kwh"] - v["fixed"]["kwh"])) < 0.5
