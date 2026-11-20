"""v5: per-room setpoints, 1·2·3차 tiers, feedback → adjustments, operation mode, agents, onboarding."""
import json
import os
from datetime import date
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("store_v5")
    os.environ["LOCAL_STORE"] = str(root)
    os.environ["NOW_OVERRIDE"] = "2026-11-18T10:40:00"
    cache = Path(__file__).resolve().parents[2] / "data" / "cache" / "weather_sources.json"
    if not cache.exists():
        pytest.skip("weather cache missing")
    from app import ai, planning, store

    store._store = None
    planning.clear_cache()
    planning._eval_cache.clear()
    store.get_store().put_blob("weather/sources.json", {**json.loads(cache.read_text()), "today": "2026-11-18"})

    def no_bedrock(*a, **k):  # tests never call Bedrock: AI features must fall back
        raise RuntimeError("bedrock disabled in tests")

    ai.client = no_bedrock
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_room_setpoint_changes_only_that_room_and_only_ai(client):
    from hvac import engine

    from app import service

    ctx = service.Ctx()
    d = date(2026, 11, 18)
    base = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, ctx.settings, detail=False)
    st = {**ctx.settings, "room_sp": {"306": {"sp_heat": 22.0}}}
    alt = engine.compute_day(d, ctx.courses, ctx.events, ctx.wx, st, detail=False)
    assert alt["strategies"]["fixed"]["kwh"] == base["strategies"]["fixed"]["kwh"]
    assert alt["strategies"]["ai"]["rooms"]["306"]["kwh"] > base["strategies"]["ai"]["rooms"]["306"]["kwh"]
    # a room on another outdoor unit is untouched
    assert alt["strategies"]["ai"]["rooms"]["410"]["kwh"] == base["strategies"]["ai"]["rooms"]["410"]["kwh"]


def test_tiers_cover_the_ideas(client):
    ideas = set()
    for t in (1, 2, 3):
        p = client.get(f"/api/plan/tier/{t}?date=2026-11-18").json()
        assert p["tier"] == t and p["checks"] and p["sources"]
        assert all(c["verdict"] in ("ok", "adjust", "review") for c in p["checks"])
        ideas |= {c["idea"] for c in p["checks"] if c.get("idea")}
    assert {11, 12, 13, 14, 15} <= ideas
    t3 = client.get("/api/plan/tier/3?date=2026-11-18").json()
    assert len(t3["hourly"]["t_forecast"]) == 24 and all(len(v) == 96 for v in t3["hourly"]["co2"].values())
    assert client.get("/api/plan/tier/4").status_code == 400


def test_feedback_creates_proposal_and_approval_applies_it(client):
    # a room with classes that day and no broader (weekly) proposal open
    for a in client.get("/api/adjustments?status=pending").json():
        client.post(f"/api/adjustments/{a['id']}/reject")
    t3 = client.get("/api/plan/tier/3?date=2026-11-18").json()
    room = next(x["room"] for x in t3["rooms"] if x["sessions"] > 0)
    r = client.post("/api/feedback", json={"room": room, "vote": -3, "text": "너무 추워요"})
    assert r.status_code == 200 and r.json()["reply"]["message"]
    assert client.post("/api/feedback", json={"room": "999", "vote": 0}).status_code == 400
    t3 = client.get("/api/plan/tier/3?date=2026-11-18").json()
    adj = next(a for a in t3["adjustments"] if a["origin"] == "feedback" and a["rooms"] == [room])
    assert adj["status"] == "pending" and adj["change"]["sp_heat"] == 20.5
    done = client.post(f"/api/adjustments/{adj['id']}/approve").json()
    assert done["status"] == "applied"
    cmds = client.get("/api/commands?limit=10").json()
    assert any(c["adjustment_id"] == adj["id"] and c["point"].endswith("HeatSetpoint") for c in cmds)
    day = client.get("/api/day/2026-11-18").json()
    assert day["room_sp"][room]["sp_heat"] == 20.5


def test_auto_mode_applies_pending(client):
    client.put("/api/mode", json={"mode": "recommend"})
    client.get("/api/plan/tier/2?date=2026-11-18")
    assert client.put("/api/mode", json={"mode": "auto"}).json()["pending"] == 0
    assert client.put("/api/mode", json={"mode": "nope"}).status_code == 400
    client.put("/api/mode", json={"mode": "recommend"})


def test_rule_based_negotiation_stays_in_policy(client):
    from app import agents, planning

    res = agents.negotiate(3, date(2026, 11, 18), use_ai=False)
    pol = planning.policy()
    assert res["ai"] is False and res["turns"][-1]["agent"] == "arbiter"
    for v in res["final"]["proposal"].values():
        assert pol["heat_min"] <= v["sp_heat"] <= pol["heat_max"]
    assert agents.latest(3, date(2026, 11, 18))["final"]["summary"]
    for aid in res["adjustment_ids"]:
        a = next(x for x in planning.adjustments() if x["id"] == aid)
        assert a["origin"] == "agents" and a["date_from"] >= "2026-11-18"


def test_onboarding(client):
    assert client.post("/api/onboarding/connect", json={"method": "direct", "protocol": "bacnet", "host": "bad host!"}).status_code == 400
    res = client.post("/api/onboarding/connect", json={"method": "gateway", "protocol": "bacnet", "host": "10.21.3.40", "port": 47808}).json()
    assert res["ok"] and res["summary"]["rooms"] == 10 and len(res["steps"]) >= 5
    prof = client.post("/api/onboarding/profile", json={"text": "부산대학교 IT관, 4층 건물"}).json()
    assert prof["ai"] is False and prof["type"] == "school"
    col = client.get("/api/onboarding/collect").json()
    assert {"policy_heat", "hours", "attendance"} <= {q["id"] for q in col["questions"]}
    out = client.post("/api/onboarding/answers", json={"answers": {"policy_heat": [18, 21.5], "attendance": 80}}).json()
    assert out["policy"]["heat_max"] == 21.5 and abs(out["policy"]["attendance"] - 0.8) < 1e-9
    assert client.get("/api/building").json()["connection"]["host"] == "10.21.3.40"


def test_lab_sandbox_and_calibration(client):
    from app import lab, planning

    before = len(planning.adjustments())
    res = lab.run(date(2026, 11, 16), 2, "rule")
    assert len(res["days"]) == 2 and set(res["totals"]) == {"current", "rule", "ai", "agents"}
    assert res["totals"]["current"]["kwh"] > res["totals"]["agents"]["kwh"] > 0
    assert len(planning.adjustments()) == before  # sandbox: no adjustments created
    # hourly meter CSV → Guideline 14 metrics against the simulated current operation
    day = res["days"][0]
    rows = "\n".join(f"{day['date']} {h:02d}:00,{v:.3f}" for h, v in enumerate(day["strategies"]["current"]["kwh_by_hour"]))
    m = client.post("/api/lab/measured", files={"file": ("m.csv", "timestamp,kwh\n" + rows, "text/csv")}).json()
    assert m["granularity"] == "hour" and m["count"] == 24
    cal = lab.calibration(res["days"])
    assert cal["overlap"] == 24 and abs(cal["nmbe_pct"]) < 0.01 and cal["calibrated"]
    assert client.post("/api/lab/measured", files={"file": ("bad.csv", "a,b\n1,2", "text/csv")}).status_code == 400
    assert client.delete("/api/lab/measured").json()["cleared"]


def test_evaluation_helpers(client):
    from app import agents, evaluation, service

    assert evaluation.numbers_in("전력 1,234.5 kWh, PMV −0.62, 306호 20.5℃") == [1234.5, -0.62, 306.0, 20.5]
    ctx = service.Ctx()
    ctx.adjustments = []
    d = date(2026, 11, 18)
    neg = agents.negotiate(3, d, use_ai=False, sandbox=True, ctx=ctx, fb_until=d)
    ds = agents.build_dossier(3, d, ctx, fb_until=d)
    g = evaluation.grounding(neg, ds)
    assert g["checked"] > 0 and g["direct_rate"] >= 80  # rule-based agents quote the dossier
    c = evaluation.consistency([neg, neg])
    assert c["identical_rooms_pct"] == 100.0 and c["max_setpoint_spread_c"] == 0.0
