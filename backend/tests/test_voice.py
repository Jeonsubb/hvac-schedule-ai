"""Hey ON:D voice agent: tools build cards from the service layer; without Bedrock the keyword router answers."""
import json
import os
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("store_voice")
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

    def no_bedrock(*a, **k):
        raise RuntimeError("bedrock disabled in tests")

    ai.client = no_bedrock
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_tools_return_cards_with_routes(client):
    from app import service, voice

    ctx = service.Ctx()
    for name, inp, kind, to in [
        ("get_status", {}, "status", "/overview"),
        ("get_savings", {"scope": "today"}, "savings", "/energy"),
        ("get_room", {"room": "306"}, "room", "/overview?room=306"),
        ("get_feedback", {}, "feedback", "/comfort"),
        ("get_schedule", {"date": None}, "schedule", "/schedule"),
    ]:
        out: dict = {}
        res = voice.run_tool(name, inp, out, ctx)
        assert "error" not in res, (name, res)
        card = out["cards"][0]
        assert card["kind"] == kind and card["to"] == to and card["title"]
    out = {}
    assert voice.run_tool("open_screen", {"screen": "overview", "room": "306", "date": "2026-11-19"}, out, ctx) == {"opened": "운영 현황"}
    assert out["navigate"] == {"to": "/overview?room=306", "label": "운영 현황", "date": "2026-11-19"}


def test_new_scenario_is_computed_inside_policy_and_never_applied(client):
    from app import planning, service, voice

    before = len(planning.adjustments())
    out: dict = {}
    res = voice.run_tool("make_scenario", {"name": "전체 5도 절감", "delta": -5, "rooms": [], "date": None}, out, service.Ctx())
    lo, hi = res["allowed_range_c"]
    assert res["applied"] is False and len(planning.adjustments()) == before
    assert all(lo <= float(v.split("→")[1]) <= hi for v in res["rooms_changed"].values())
    assert res["this_scenario"]["kwh"] <= res["current_plan"]["kwh"]
    assert out["cards"][0]["kind"] == "scenario"


def test_turn_falls_back_to_keywords_without_bedrock(client):
    r = client.post("/api/voice/turn", json={"messages": [{"role": "user", "content": "오늘 절감 효과 알려줘"}], "speak": False})
    assert r.status_code == 200
    body = r.json()
    assert body["ai"] is False and body["audio"] is None
    assert body["cards"][0]["kind"] == "savings" and "%" in body["say"]
    assert client.post("/api/voice/turn", json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 400


def test_spoken_text_reads_units_as_words():
    from app import voice

    assert voice.spoken("ON:D가 12.7 kWh, 1,732원, 21.5℃, 79%") == "온디가 12.7 킬로와트시, 1732원, 21.5도, 79퍼센트"
