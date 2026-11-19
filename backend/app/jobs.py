"""Background jobs: DynamoDB job record + asynchronous self-invocation (Lambda) or a thread (local)."""
from __future__ import annotations

import json
import os
import threading
import traceback
import uuid

from . import service
from .store import get_store


def create(kind: str, payload: dict) -> dict:
    job = {"id": "J" + uuid.uuid4().hex[:10], "kind": kind, "status": "queued", "payload": payload,
           "created_at": service.now_kst().isoformat(timespec="seconds"), "progress": {}, "result": None}
    get_store().put_item("job", job["id"], job)
    fn = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    if fn:
        import boto3

        boto3.client("lambda").invoke(FunctionName=fn, InvocationType="Event",
                                      Payload=json.dumps({"job_id": job["id"]}).encode())
    else:
        threading.Thread(target=run, args=(job["id"],), daemon=True).start()
    return job


def get(job_id: str) -> dict | None:
    return get_store().get_item("job", job_id)


def _save(job: dict) -> None:
    get_store().put_item("job", job["id"], job)


def run(job_id: str) -> dict:
    from . import ai

    job = get(job_id)
    if not job:
        return {"error": "no job"}
    job["status"] = "running"
    _save(job)
    try:
        p = job["payload"]
        if job["kind"] == "chat":
            def progress(out):
                job["progress"] = {"steps": out.get("steps", [])}
                _save(job)
            job["result"] = ai.copilot(p["messages"], progress=progress)
        elif job["kind"] == "extract":
            import base64

            data = base64.b64decode(p["data_b64"])
            raw = ai.extract_timetable(data, p["media_type"], p.get("hint", ""))
            from hvac.timetable import normalize_records

            courses = normalize_records(raw["records"], source=p.get("filename", "이미지"))
            job["result"] = {"raw_count": len(raw["records"]), "notes": raw.get("notes", ""),
                             "preview": service.preview_courses(courses)}
        elif job["kind"] == "precompute":
            job["result"] = service.precompute()
        elif job["kind"] == "refresh":
            service.refresh_weather()
            job["result"] = service.precompute()
        else:
            raise ValueError(f"unknown job kind {job['kind']}")
        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = f"{type(e).__name__}: {e}"
        job["trace"] = traceback.format_exc()[-2000:]
    _save(job)
    return job
