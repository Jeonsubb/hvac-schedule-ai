"""Background jobs: job record (DynamoDB/local) + asynchronous self-invocation (Lambda) or a thread (local).

Large payloads (uploaded images) and large results live in the blob store, not in the job item,
because DynamoDB items are capped at 400 KB.
"""
from __future__ import annotations

import json
import os
import threading
import time
import traceback
import uuid

from . import service
from .store import get_store

ITEM_LIMIT = 300_000
STALE_AFTER_S = 660  # Lambda timeout (600 s) + margin


def create(kind: str, payload: dict, blob: dict | None = None) -> dict:
    job_id = "J" + uuid.uuid4().hex[:10]
    if blob is not None:
        get_store().put_blob(f"jobs/{job_id}/input.json", blob)
        payload = {**payload, "blob": f"jobs/{job_id}/input.json"}
    job = {"id": job_id, "kind": kind, "status": "queued", "payload": payload,
           "created_at": service.now_kst().isoformat(timespec="seconds"), "updated": time.time(),
           "progress": {}, "result": None}
    _save(job)
    fn = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    try:
        if fn:
            import boto3

            boto3.client("lambda").invoke(FunctionName=fn, InvocationType="Event",
                                          Payload=json.dumps({"job_id": job_id}).encode())
        else:
            threading.Thread(target=run, args=(job_id,), daemon=True).start()
    except Exception as e:
        job.update(status="error", error=f"작업 시작 실패: {e}")
        _save(job)
    return job


def get(job_id: str) -> dict | None:
    job = get_store().get_item("job", job_id)
    if not job:
        return None
    if job["status"] in ("queued", "running") and time.time() - float(job.get("updated", 0)) > STALE_AFTER_S:
        job = {**job, "status": "error", "error": "작업 시간이 초과되었습니다."}
    if job.get("result_ref"):
        job = {**job, "result": get_store().get_blob(job["result_ref"])}
    return job


def _save(job: dict) -> None:
    job["updated"] = time.time()
    body = json.dumps(job, ensure_ascii=False, default=str)
    if len(body.encode()) > ITEM_LIMIT and job.get("result") is not None:
        ref = f"jobs/{job['id']}/result.json"
        get_store().put_blob(ref, job["result"])
        job = {**job, "result": None, "result_ref": ref}
    get_store().put_item("job", job["id"], job)


def run(job_id: str) -> dict:
    from . import ai

    job = get_store().get_item("job", job_id)
    if not job:
        return {"error": "no job"}
    if job["status"] != "queued":
        return job  # idempotent: async retries must not re-run (and re-bill) a job
    job["status"] = "running"
    _save(job)
    try:
        p = job["payload"]
        if job["kind"] == "chat":
            def progress(out):
                job["progress"] = {"steps": out.get("steps", [])}
                _save(job)
            question = p["messages"][-1]["content"]
            try:
                job["result"] = ai.copilot(p["messages"], progress=progress)
                ai.record_status(True)
                if len(p["messages"]) == 1:
                    ai.cache_put("chat", question, job["result"])
            except ai.QuotaExceeded:
                raise
            except Exception as e:
                ai.record_status(False, f"{type(e).__name__}: {e}")
                cached = ai.cache_get("chat", question)
                if not cached:
                    raise RuntimeError("AI(Bedrock) 호출에 실패했습니다. 잠시 후 다시 시도하세요.") from e
                job["result"] = {**cached, "answer": cached.get("answer", "") +
                                 f"\n\n> 지금은 AI 연결이 불안정해서 {cached['cached_at'][:16].replace('T', ' ')}에 같은 질문으로 받은 답을 보여드립니다."}
        elif job["kind"] == "extract":
            import base64

            blob = get_store().get_blob(p["blob"]) or {}
            data = base64.b64decode(blob["data_b64"])
            raw = ai.extract_timetable(data, p["media_type"], p.get("hint", ""))
            from hvac.timetable import normalize_records

            from .validation import courses as clean_courses

            courses = clean_courses(normalize_records(raw["records"], source=p.get("filename", "이미지")))
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
        job["error"] = f"{type(e).__name__}: {e}"[:500]
        job["trace"] = traceback.format_exc()[-1500:]
    try:
        _save(job)
    except Exception as e:  # last resort: never leave the job "running"
        get_store().put_item("job", job["id"], {"id": job["id"], "kind": job["kind"], "status": "error",
                                                "error": f"결과 저장 실패: {e}"[:300], "updated": time.time()})
    return job
