import pytest

from app import notifications
from app.store import LocalStore


@pytest.fixture
def mail(monkeypatch, tmp_path):
    import boto3

    store = LocalStore(tmp_path)
    monkeypatch.setattr(notifications, "get_store", lambda: store)
    from app import onboarding

    monkeypatch.setattr(onboarding, "building", lambda: {"org": "Test", "name": "Building"})
    store.put_item("building_notification", "active", {"email": "manager@example.com", "enabled": True,
                                                       "completed": True, "confirmed": True})
    monkeypatch.setenv("NOTIFICATION_TOPIC_ARN", "arn:aws:sns:ap-northeast-2:123456789012:test")
    calls = []

    class SNS:
        fail = False

        def publish(self, **kwargs):
            calls.append(kwargs)
            if self.fail:
                raise RuntimeError("SNS unavailable")
            return {"MessageId": "message-1"}

        def subscribe(self, **kwargs):
            calls.append(kwargs)
            return {"SubscriptionArn": "arn:subscription:1"}

        def get_subscription_attributes(self, **kwargs):
            return {"Attributes": {"PendingConfirmation": "false"}}

    sns = SNS()
    monkeypatch.setattr(boto3, "client", lambda *a, **kw: sns)
    return store, calls, sns


def test_disabled_does_not_access_aws_or_store(monkeypatch):
    monkeypatch.delenv("NOTIFICATION_TOPIC_ARN", raising=False)
    monkeypatch.setattr(notifications, "get_store", lambda: pytest.fail("storage accessed"))
    assert notifications.publish("e", "subject", "body") == "disabled"
    assert notifications.pending_approvals() == "disabled"


def test_job_terminal_status_and_redaction(mail):
    _, calls, _ = mail
    job = {"id": "J1", "kind": "extract", "status": "running", "error": "secret-value",
           "payload": {"prompt": "private input"}}
    assert notifications.job_finished(job) == "ignored"
    job["status"] = "error"
    assert notifications.job_finished(job) == "published"
    assert notifications.job_finished(job) == "duplicate"
    assert len(calls) == 1
    assert "실패" in calls[0]["Subject"]
    assert "secret-value" not in calls[0]["Message"]
    assert "private input" not in calls[0]["Message"]


def test_recipient_change_is_filtered_and_requires_confirmation(mail):
    store, calls, _ = mail
    result = notifications.save_settings({"email": "new@example.com", "enabled": True})
    assert result["status"] == "pending"
    assert "new@example.com" not in str(result)
    assert calls[0]["Protocol"] == "email"
    assert "recipient" in calls[0]["Attributes"]["FilterPolicy"]
    assert notifications.public_settings(refresh=True)["status"] == "confirmed"
    notifications.save_settings({"email": "other@example.com"})
    assert notifications.public_settings()["status"] == "pending"
    notifications.save_settings({"enabled": False})
    assert notifications.job_finished({"id": "j", "kind": "extract", "status": "error"}) == "disabled"


def test_invalid_recipient_does_not_subscribe(mail):
    _, calls, _ = mail
    with pytest.raises(ValueError):
        notifications.save_settings({"email": "bad\nemail"})
    assert calls == []


def test_unconfirmed_email_does_not_mark_notification_sent(mail, monkeypatch):
    store, calls, sns = mail
    store.put_item("building_notification", "active", {"email": "manager@example.com", "enabled": True,
                                                       "subscription_arn": "arn:pending", "confirmed": False})
    monkeypatch.setattr(sns, "get_subscription_attributes", lambda **kw: {"Attributes": {"PendingConfirmation": "true"}})
    assert notifications.publish("pending-test", "s", "m") == "pending"
    assert calls == []
    assert store.list_items("notification") == []


def test_review_checks_deduped_per_period(mail):
    _, calls, _ = mail
    checks = [{"id": "schedule", "title": "일정 정합", "verdict": "review", "action": "시간표 확인"}]
    assert notifications.inspection_checks(checks, "2026-11-21") == "published"
    assert notifications.inspection_checks(checks, "2026-11-21") == "duplicate"
    assert notifications.inspection_checks(checks, "2026-11-22") == "published"
    assert notifications.inspection_checks([{**checks[0], "verdict": "ok"}], "2026-11-22") == "ignored"


def test_subscription_api_requires_operator_key(mail, monkeypatch):
    from fastapi.testclient import TestClient
    from app import main

    monkeypatch.setattr(main, "OPERATOR_KEY", "test-operator")
    monkeypatch.setattr(main, "ORIGIN_SECRET", None)
    monkeypatch.setattr(main, "_rate_limit", lambda *a: None)
    client = TestClient(main.app)
    body = {"email": "new@example.com", "enabled": True}
    assert client.put("/api/building/notifications", json=body).status_code == 403
    assert client.post("/api/building/notifications/verify").status_code == 403
    response = client.put("/api/building/notifications", json=body, headers={"x-operator-key": "test-operator"})
    assert response.status_code == 200
    assert response.json()["status"] == "pending"


def test_publish_failure_is_nonfatal_and_can_retry(mail):
    _, calls, sns = mail
    sns.fail = True
    assert notifications.publish("e", "s", "m") == "error"
    sns.fail = False
    assert notifications.publish("e", "s", "m") == "published"
    assert len(calls) == 2


def test_approval_dedupes_prose_but_detects_changed_decision(mail):
    store, calls, _ = mail
    assert notifications.pending_approvals() == "ignored"
    adj = {"id": "A1", "status": "pending", "change": {"sp_heat": 21}, "title": "first"}
    store.put_item("adjustment", "A1", adj)
    assert notifications.pending_approvals() == "published"
    store.put_item("adjustment", "A1", {**adj, "title": "different wording"})
    assert notifications.pending_approvals() == "duplicate"
    store.put_item("adjustment", "A1", {**adj, "change": {"sp_heat": 22}})
    assert notifications.pending_approvals() == "published"
    store.put_item("adjustment", "A1", {**adj, "status": "applied"})
    assert notifications.pending_approvals() == "ignored"
    assert len(calls) == 2


def test_job_runner_notifies_after_persisting_failure(mail, monkeypatch):
    from app import jobs

    store, calls, _ = mail
    monkeypatch.setattr(jobs, "get_store", lambda: store)
    store.put_item("job", "J2", {"id": "J2", "kind": "unknown", "status": "queued", "payload": {}})
    assert jobs.run("J2")["status"] == "error"
    assert store.get_item("job", "J2")["status"] == "error"
    assert len(calls) == 1
    jobs.run("J2")
    assert len(calls) == 1
