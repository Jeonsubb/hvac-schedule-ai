"""Lambda entry point: HTTP (Mangum), async jobs, and the hourly scheduler task."""
from __future__ import annotations

from mangum import Mangum

from . import jobs, service
from .main import app

_asgi = Mangum(app, lifespan="off")


def handler(event, context):
    if isinstance(event, dict) and "job_id" in event:
        return {"status": jobs.run(event["job_id"]).get("status")}
    if isinstance(event, dict) and event.get("task") == "hourly":
        service.refresh_weather()
        return service.precompute()
    if isinstance(event, dict) and event.get("task") == "precompute":
        return service.precompute()
    return _asgi(event, context)
