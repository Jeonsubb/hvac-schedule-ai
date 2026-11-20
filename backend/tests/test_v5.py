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


def test_gateway_pair_telemetry_commands(client):
    from app import gateway

    p = client.post("/api/gateway/pair", json={"pair_code": "TP-TEST-0001", "version": "1.0.0", "allow_write": True,
                                               "controller": {"protocol": "bacnet", "host": "127.0.0.1", "port": 47808}}).json()
    gid, tok = p["gateway_id"], p["token"]
    pts = [{"name": "IDU-306-1/RoomTemp", "objid": "analog-input,1", "value": 18.2, "writable": False},
           {"name": "IDU-306-1/HeatSetpoint", "objid": "analog-value,1", "value": 20.0, "writable": True},
           {"name": "ODU-3F/Power", "objid": "analog-input,2", "value": 3.1, "writable": False}]
    body = {"gateway_id": gid, "device": {"instance": 3001, "name": "test", "address": "127.0.0.1:47808"}, "allow_write": True, "points": pts}
    assert client.post("/api/gateway/telemetry", json=body, headers={"x-gateway-token": "wrong"}).status_code == 400
    assert client.post("/api/gateway/telemetry", json=body, headers={"x-gateway-token": tok}).json()["commands"] == []
    st = client.get("/api/gateway/status").json()
    assert st["live"] and st["gateways"][0]["rooms_mapped"] == 1
    # onboarding connection test now reports what the gateway read
    res = client.post("/api/onboarding/connect", json={"method": "gateway", "protocol": "bacnet", "host": "127.0.0.1",
                                                        "port": 47808, "pair_code": "TP-TEST-0001"}).json()
    assert res["source"] == "gateway" and res["summary"]["points"] == 3
    # an applied adjustment is queued for the gateway, delivered with the next telemetry, then acknowledged
    from app import planning

    adj = planning.upsert_proposal({"id": "T3-test-gw", "tier": 3, "origin": "feedback", "kind": "setpoint", "title": "t", "reason": "t",
                                    "rooms": ["306"], "date_from": "2026-11-18", "date_to": "2026-11-18", "change": {"sp_heat": 20.5},
                                    "impact": {"kwh": 0, "cost_krw": 0}, "evidence": []})
    planning.apply_adjustment(adj["id"])
    cmds = client.post("/api/gateway/telemetry", json=body, headers={"x-gateway-token": tok}).json()["commands"]
    assert {c["name"] for c in cmds} == {"IDU-306-1/HeatSetpoint", "IDU-306-2/HeatSetpoint"} and all(c["value"] == 20.5 for c in cmds)
    for c in cmds:
        client.post("/api/gateway/ack", json={"gateway_id": gid, "id": c["id"], "ok": True, "readback": 20.5}, headers={"x-gateway-token": tok})
    done = [c for c in client.get("/api/commands?limit=50").json() if c.get("adjustment_id") == "T3-test-gw"]
    assert len(done) == 2 and all(c["status"] == "acked" and c["readback"] == 20.5 for c in done)
    assert gateway.map_point("SENS-405/CO2")["kind"] == "co2" and gateway.map_point("weird")["room"] is None


def test_change_response_previews(client):
    for kind in ("cancel", "add", "weather", "feedback", "noshow"):
        r = client.post("/api/respond/preview", json={"kind": kind, "date": "2026-11-18"}).json()
        assert [s["label"] for s in r["steps"]] == ["감지", "다시 계산", "조치"] and r["rooms"], kind
        assert r["elapsed_ms"] < 5000 and "before" in r["totals"] and "after" in r["totals"]
    c = client.post("/api/respond/preview", json={"kind": "cancel", "date": "2026-11-18"}).json()
    room = c["event"]["room"]
    rc = next(x for x in c["rooms"] if x["room"] == room)
    assert c["event"]["type"] == "cancel" and len(rc["after"]["lectures"]) == len(rc["before"]["lectures"]) - 1
    assert c["steps"][2]["text"].startswith(f"{room}호")
    n = client.post("/api/respond/preview", json={"kind": "noshow", "date": "2026-11-18"}).json()
    assert n["rooms"][0]["after"]["on_min"] <= n["rooms"][0]["before"]["on_min"]  # a vacancy stop never lengthens the run
    assert client.post("/api/respond/preview", json={"kind": "nope"}).status_code == 400


def test_negotiation_compare_same_conditions(client):
    """Before/after of a negotiation: same numbers as the negotiation itself, comparable only while the
    day's timetable/weather/rules are unchanged, and the operating plan moves only on approval."""
    from app import agents, planning, service

    d = date(2026, 11, 17)
    assert client.get(f"/api/negotiate/compare?date={d}").json()["state"] == "none"
    planning.set_mode("recommend")
    res = agents.negotiate(3, d, use_ai=False)
    assert res["ai"] is False and res["feedback_sources"]["simulated"] > 0  # seeded votes are counted apart from real ones
    assert "sensor" not in agents.SOURCES and "nowcast" not in agents.SOURCES
    assert "가상 의견" in agents.dossier_text(agents.build_dossier(3, d, service.Ctx()))
    c = client.get(f"/api/negotiate/compare?date={d}").json()
    assert c["same_conditions"] is True and c["ai"] is False
    assert c["before"]["kwh"] == res["baseline"]["kwh"] and c["after"]["kwh"] == res["final"]["eval"]["kwh"]
    assert c["before"]["pmv_mean"] == res["baseline"]["pmv_mean"]
    ai_kwh = lambda: round(service.get_day(d)["strategies"]["ai"]["kwh"], 2)  # noqa: E731
    if c["adjustments"]:
        assert c["state"] == "pending" and ai_kwh() == c["before"]["kwh"]  # a recommendation changes nothing
        for a in c["adjustments"]:
            client.post(f"/api/adjustments/{a['id']}/approve")
        c2 = client.get(f"/api/negotiate/compare?date={d}").json()
        assert c2["state"] == "applied" and c2["same_conditions"] is True
        assert ai_kwh() == c2["after"]["kwh"]  # the operating plan is now the negotiated one
        # negotiating the same day again starts from the plan without the earlier agreement, so it reaches the
        # same setpoints instead of moving them another step, and the agreement in force stays in force
        again = agents.negotiate(3, d, use_ai=False)
        assert again["final"]["proposal"] == res["final"]["proposal"] and again["base_sp"] == res["base_sp"]
        assert set(again["adjustment_ids"]) == {a["id"] for a in c["adjustments"]}
        assert client.get(f"/api/negotiate/compare?date={d}").json()["state"] == "applied" and ai_kwh() == c2["after"]["kwh"]
        # and no proposal ever leaves the comfort band the classes are checked against
        lo = service.settings()["comfort_low"]
        assert all(v["sp_heat"] >= lo for v in again["final"]["proposal"].values())
        assert planning.sp_range("heat", planning.policy(), service.settings())[0] == 19.5
    # the timetable changes: the stored result is no longer comparable
    ev = client.post("/api/events", json={"type": "add", "date": d.isoformat(), "room": "406", "start": "19:00", "end": "20:30",
                                          "title": "특강", "expected_people": 30})
    assert ev.status_code == 200
    c3 = client.get(f"/api/negotiate/compare?date={d}").json()
    assert c3["same_conditions"] is False and "schedule" in c3["changed"]
    q = client.get(f"/api/iaq/{d}").json()
    assert len(q["rooms"]["406"]["co2"]) == 96 and q["source"] == "estimated"
