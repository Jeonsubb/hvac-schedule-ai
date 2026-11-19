import json
import os
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    root = tmp_path_factory.mktemp("store")
    os.environ["LOCAL_STORE"] = str(root)
    os.environ["NOW_OVERRIDE"] = "2026-11-18T10:40:00"
    cache = Path(__file__).resolve().parents[2] / "data" / "cache" / "weather_sources.json"
    if not cache.exists():
        pytest.skip("weather cache missing")
    from app import store

    store._store = None
    store.get_store().put_blob("weather/sources.json", {**json.loads(cache.read_text()), "today": "2026-11-18"})
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_health_meta_live(client):
    assert client.get("/api/health").json()["ok"]
    meta = client.get("/api/meta").json()
    assert meta["counts"]["courses"] == 129
    live = client.get("/api/live").json()
    assert live["now"]["date"] == "2026-11-18" and len(live["rooms"]) == 10


def test_day_and_export(client):
    day = client.get("/api/day/2026-11-18?strategies=ai,rule").json()
    assert set(day["strategies"]) == {"ai", "rule"}
    csv_txt = client.get("/api/export/plan.csv?date=2026-11-18").text
    assert csv_txt.startswith("date,device,room,time,command")


def test_event_roundtrip_recomputes_day(client):
    r = client.post("/api/events", json={"type": "add", "date": "2026-11-18", "room": "408", "start": "18:00",
                                         "end": "21:00", "title": "졸업작품 발표회", "expected_people": 50})
    assert r.status_code == 200
    body = r.json()
    assert body["after"]["sessions"] == body["before"]["sessions"] + 1
    assert client.get("/api/events").json()[0]["title"] == "졸업작품 발표회"
    ev_id = body["event"]["id"]
    assert client.delete(f"/api/events/{ev_id}").json()["deleted"]


def test_csv_import_preview(client):
    data = (Path(__file__).resolve().parents[1] / "seed" / "timetable_3_4.csv").read_bytes()
    r = client.post("/api/import", files={"file": ("timetable.csv", data, "text/csv")})
    p = r.json()["preview"]
    assert p["count"] == 129 and p["unchanged"] == 129


def test_bad_event_rejected(client):
    assert client.post("/api/events", json={"type": "add", "date": "2026-11-18", "room": "999"}).status_code == 400
