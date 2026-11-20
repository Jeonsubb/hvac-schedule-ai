"""Optional operator notifications via SNS. Publishing must never fail a job.

Successful event IDs are recorded to suppress ordinary repeated notifications.
This is best-effort delivery, not exactly-once: concurrent publishers or a crash
after SNS accepts a message can produce duplicates. SNS acceptance is not proof
that a subscriber confirmed their address or that the mail reached their inbox.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re

from .store import get_store

log = logging.getLogger(__name__)

DEFAULTS = {"email": "", "enabled": False, "approvals": True, "checks": True,
            "failures": True, "completed": False}
# Confirmation mails per day for the whole building. The settings screen has no key
# (sign-in is still a mock), so this keeps the topic from being used to mail strangers.
DAILY_ADDRESS_CHANGES = 5


class LimitExceeded(Exception):
    pass


def settings() -> dict:
    return {**DEFAULTS, **(get_store().get_item("building_notification", "active") or {})}


def _sns():
    import boto3
    from botocore.config import Config

    return boto3.client("sns", config=Config(connect_timeout=2, read_timeout=3,
                                            retries={"max_attempts": 1}))


def save_settings(patch: dict) -> dict:
    cur = settings()
    new = {**cur}
    for key in ("enabled", "approvals", "checks", "failures", "completed"):
        if key in patch:
            if not isinstance(patch[key], bool):
                raise ValueError("알림 설정은 켜짐 또는 꺼짐으로 지정하세요.")
            new[key] = patch[key]
    if "email" in patch:
        email = str(patch["email"]).strip()
        if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError("올바른 운영자 이메일 주소를 입력하세요.")
        new["email"] = email
    if new["enabled"] and not new["email"]:
        raise ValueError("알림을 받을 운영자 이메일을 입력하세요.")
    topic = os.environ.get("NOTIFICATION_TOPIC_ARN", "")
    if new["enabled"] and not topic:
        raise ValueError("이메일 전송 서비스가 아직 배포되지 않았습니다.")
    if new["email"] != cur["email"]:
        new.pop("subscription_arn", None)
        new.pop("confirmed", None)
    if new["enabled"] and not new.get("subscription_arn"):
        # Each recipient has a filter so previous addresses cannot receive the
        # current building's messages after the operator changes the address.
        from . import service

        day = service.now_kst().strftime("%Y%m%d")
        if get_store().incr("ratelimit", f"notification_subscribe|{day}", "n") > DAILY_ADDRESS_CHANGES:
            raise LimitExceeded("오늘은 수신 주소를 더 바꿀 수 없습니다. 내일 다시 시도하세요.")
        recipient = hashlib.sha256(new["email"].encode()).hexdigest()
        result = _sns().subscribe(TopicArn=topic, Protocol="email", Endpoint=new["email"],
                                 ReturnSubscriptionArn=True,
                                 Attributes={"FilterPolicy": json.dumps({"recipient": [recipient]})})
        new["subscription_arn"] = result["SubscriptionArn"]
    get_store().put_item("building_notification", "active", new)
    return public_settings()


def public_settings(refresh: bool = False) -> dict:
    cfg = settings()
    email = cfg["email"]
    status = "disabled" if not cfg["enabled"] else "pending"
    if cfg["enabled"] and cfg.get("subscription_arn"):
        if refresh and not cfg.get("confirmed"):
            attrs = _sns().get_subscription_attributes(SubscriptionArn=cfg["subscription_arn"])["Attributes"]
            cfg["confirmed"] = attrs.get("PendingConfirmation") == "false"
            get_store().put_item("building_notification", "active", cfg)
        status = "confirmed" if cfg.get("confirmed") else "pending"
    return {**{k: cfg[k] for k in DEFAULTS if k != "email"},
            "email_masked": email[:1] + "***@" + email.split("@")[-1] if email else "",
            "status": status, "available": bool(os.environ.get("NOTIFICATION_TOPIC_ARN"))}


def publish(event_id: str, subject: str, message: str, category: str = "failures") -> str:
    topic = os.environ.get("NOTIFICATION_TOPIC_ARN", "")
    if not topic:
        return "disabled"
    try:
        store = get_store()
        cfg = settings()
        if not cfg["enabled"] or not cfg.get(category) or not cfg["email"]:
            return "disabled"
        if not cfg.get("confirmed"):
            if not cfg.get("subscription_arn") or public_settings(refresh=True)["status"] != "confirmed":
                return "pending"
        recipient = hashlib.sha256(cfg["email"].encode()).hexdigest()
        event_id = f"{recipient[:16]}:{event_id}"
        if store.get_item("notification", event_id):
            return "duplicate"
        from . import onboarding

        building = onboarding.building()
        message = f"건물: {building.get('org', '')} {building.get('name', '')}\n\n" + message
        result = _sns().publish(TopicArn=topic, Subject=subject[:100], Message=message,
                               MessageAttributes={"recipient": {"DataType": "String", "StringValue": recipient}})
        store.put_item("notification", event_id, {"id": event_id, "message_id": result["MessageId"]})
        return "published"
    except Exception:
        log.exception("operator notification failed: %s", event_id)
        return "error"


def job_finished(job: dict) -> str:
    if job.get("status") not in ("done", "error"):
        return "ignored"
    label = {"chat": "코파일럿", "extract": "시간표 추출", "negotiate": "에이전트 협의",
             "lab": "시뮬레이션", "tier_run": "계획 검증", "refresh": "날씨 갱신",
             "precompute": "계획 계산"}.get(job.get("kind"), "백그라운드 작업")
    state = "완료" if job["status"] == "done" else "실패"
    # Do not email prompts, uploaded documents, stack traces or raw AWS errors.
    return publish(f"job:{job['id']}:{job['status']}", f"[ON:D] {label} {state}",
                   f"{label} 작업이 {state}되었습니다.\n작업 ID: {job['id']}\n"
                   "ON:D 운영 화면에서 결과 또는 오류를 확인하세요.",
                   "completed" if job["status"] == "done" else "failures")


def pending_approvals() -> str:
    if not os.environ.get("NOTIFICATION_TOPIC_ARN"):
        return "disabled"
    try:
        pending = [a for a in get_store().list_items("adjustment") if a.get("status") == "pending"]
        if not pending:
            return "ignored"
        # Hash only decision-relevant fields: changing generated prose should not
        # send another message for the same adjustment.
        values = [{k: a.get(k) for k in ("id", "change", "rooms", "date_from", "date_to")}
                  for a in sorted(pending, key=lambda a: a["id"])]
        digest = hashlib.sha256(json.dumps(values, sort_keys=True, default=str).encode()).hexdigest()[:24]
        return publish(f"approval:{digest}", "[ON:D] 운전 조정안 승인 요청",
                       f"승인 대기 조정안 {len(pending)}건이 있습니다.\n"
                       "ON:D 운영 화면에서 근거와 예상 효과를 확인한 뒤 승인해 주세요.\n"
                       "이메일 수신이나 회신으로 조정안이 적용되지는 않습니다.", "approvals")
    except Exception:
        log.exception("approval notification failed")
        return "error"


def inspection_checks(checks: list[dict], period: str) -> str:
    issues = [c for c in checks if c.get("verdict") in ("review", "warn", "fail", "error", "crit")]
    if not issues:
        return "ignored"
    digest = hashlib.sha256(json.dumps([(c.get("id"), c.get("verdict")) for c in issues],
                                     sort_keys=True).encode()).hexdigest()[:24]
    lines = [f"- {c.get('title', '점검 항목')}: {c.get('action', '운영 화면에서 확인하세요.')}" for c in issues[:10]]
    return publish(f"check:{period}:{digest}", "[ON:D] 운영 점검 필요",
                   "다음 항목을 확인해 주세요.\n" + "\n".join(lines), "checks")
