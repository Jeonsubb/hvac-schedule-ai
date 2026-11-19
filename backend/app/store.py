"""Persistence adapters.

Blobs (computed day results, weather caches)  -> S3 or local directory
Items (user/external data: courses, events, settings, audit, jobs, usage) -> DynamoDB or local JSON
"""
from __future__ import annotations

import json
import os
import threading
import time
from decimal import Decimal
from pathlib import Path


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), default=str)


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root)
        (self.root / "blobs").mkdir(parents=True, exist_ok=True)
        self._items_path = self.root / "items.json"
        self._lock = threading.Lock()
        self._items = json.loads(self._items_path.read_text()) if self._items_path.exists() else {}

    # blobs
    def get_blob(self, key: str):
        p = self.root / "blobs" / key
        return json.loads(p.read_text()) if p.exists() else None

    def put_blob(self, key: str, obj) -> None:
        p = self.root / "blobs" / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(_dumps(obj))

    # items
    def _flush(self):
        self._items_path.write_text(_dumps(self._items))

    def put_item(self, kind: str, item_id: str, obj: dict) -> None:
        with self._lock:
            self._items.setdefault(kind, {})[item_id] = obj
            self._flush()

    def get_item(self, kind: str, item_id: str):
        return self._items.get(kind, {}).get(item_id)

    def list_items(self, kind: str) -> list[dict]:
        return list(self._items.get(kind, {}).values())

    def delete_item(self, kind: str, item_id: str) -> None:
        with self._lock:
            self._items.get(kind, {}).pop(item_id, None)
            self._flush()

    def replace_kind(self, kind: str, items: dict[str, dict]) -> None:
        with self._lock:
            self._items[kind] = dict(items)
            self._flush()

    def incr(self, kind: str, item_id: str, field: str, by: int = 1) -> int:
        with self._lock:
            it = self._items.setdefault(kind, {}).setdefault(item_id, {})
            it[field] = int(it.get(field, 0)) + by
            self._flush()
            return it[field]


def _from_ddb(v):
    if isinstance(v, list):
        return [_from_ddb(x) for x in v]
    if isinstance(v, dict):
        return {k: _from_ddb(x) for k, x in v.items()}
    if isinstance(v, Decimal):
        return int(v) if v == int(v) else float(v)
    return v


class AwsStore:
    """S3 for blobs; one DynamoDB table (pk=kind, sk=id, body=JSON string) for items."""

    def __init__(self, bucket: str, table: str, region: str):
        import boto3

        from botocore.config import Config

        cfg = Config(connect_timeout=4, read_timeout=15, retries={"max_attempts": 2, "mode": "standard"})
        self.bucket = bucket
        self.s3 = boto3.client("s3", region_name=region, config=cfg)
        self.table = boto3.resource("dynamodb", region_name=region, config=cfg).Table(table)
        self._cache: dict[str, tuple[float, list]] = {}

    def get_blob(self, key: str):
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=key)
        except self.s3.exceptions.NoSuchKey:
            return None
        except Exception as e:  # AccessDenied on missing keys without ListBucket
            if "NoSuchKey" in str(e) or "AccessDenied" in str(e):
                return None
            raise
        return json.loads(r["Body"].read())

    def put_blob(self, key: str, obj) -> None:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=_dumps(obj).encode(), ContentType="application/json")

    def put_item(self, kind: str, item_id: str, obj: dict) -> None:
        self.table.put_item(Item={"pk": kind, "sk": item_id, "body": _dumps(obj), "ts": int(time.time())})
        self._cache.pop(kind, None)

    def get_item(self, kind: str, item_id: str):
        r = self.table.get_item(Key={"pk": kind, "sk": item_id}, ConsistentRead=True)
        it = r.get("Item")
        return json.loads(it["body"]) if it and "body" in it else (_from_ddb(it) if it else None)

    def list_items(self, kind: str) -> list[dict]:
        from boto3.dynamodb.conditions import Key

        out, kw = [], {"KeyConditionExpression": Key("pk").eq(kind), "ConsistentRead": True}
        while True:
            r = self.table.query(**kw)
            out.extend(json.loads(i["body"]) for i in r["Items"] if "body" in i)
            if "LastEvaluatedKey" not in r:
                break
            kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
        return out

    def delete_item(self, kind: str, item_id: str) -> None:
        self.table.delete_item(Key={"pk": kind, "sk": item_id})

    def replace_kind(self, kind: str, items: dict[str, dict]) -> None:
        from boto3.dynamodb.conditions import Key

        existing = self.table.query(KeyConditionExpression=Key("pk").eq(kind), ProjectionExpression="pk, sk")["Items"]
        with self.table.batch_writer() as bw:
            for it in existing:
                if it["sk"] not in items:
                    bw.delete_item(Key={"pk": kind, "sk": it["sk"]})
            for k, v in items.items():
                bw.put_item(Item={"pk": kind, "sk": k, "body": _dumps(v), "ts": int(time.time())})

    def incr(self, kind: str, item_id: str, field: str, by: int = 1) -> int:
        r = self.table.update_item(
            Key={"pk": kind, "sk": item_id},
            UpdateExpression="ADD #f :b",
            ExpressionAttributeNames={"#f": field},
            ExpressionAttributeValues={":b": by},
            ReturnValues="UPDATED_NEW",
        )
        return int(r["Attributes"][field])


class ResilientStore:
    """AWS store with a local disk mirror.

    Writes go to both; reads come from AWS (and refresh the mirror). If AWS calls fail
    (e.g. expired credentials on a host without an IAM role), the store serves and accepts
    data locally and retries AWS after a cool-down, so the site keeps working.
    """

    COOLDOWN_S = 120

    def __init__(self, primary: "AwsStore", local: LocalStore):
        self.primary, self.local = primary, local
        self._down_until = 0.0
        self.last_error: str | None = None

    @property
    def degraded(self) -> bool:
        return time.time() < self._down_until

    def _try(self, fn, *a):
        if self.degraded:
            return False, None
        try:
            return True, fn(*a)
        except Exception as e:  # credentials expired, network, throttling
            self.last_error = f"{type(e).__name__}: {str(e)[:160]}"
            self._down_until = time.time() + self.COOLDOWN_S
            return False, None

    def get_blob(self, key):
        ok, v = self._try(self.primary.get_blob, key)
        if ok:
            if v is not None:
                self.local.put_blob(key, v)
            return v if v is not None else self.local.get_blob(key)
        return self.local.get_blob(key)

    def put_blob(self, key, obj):
        self.local.put_blob(key, obj)
        self._try(self.primary.put_blob, key, obj)

    def put_item(self, kind, item_id, obj):
        self.local.put_item(kind, item_id, obj)
        self._try(self.primary.put_item, kind, item_id, obj)

    def get_item(self, kind, item_id):
        ok, v = self._try(self.primary.get_item, kind, item_id)
        if ok:
            if v is not None and kind not in ("usage", "ratelimit"):
                self.local.put_item(kind, item_id, v)
            return v
        return self.local.get_item(kind, item_id)

    def list_items(self, kind):
        ok, v = self._try(self.primary.list_items, kind)
        if ok:
            self.local.replace_kind(kind, {str(i.get("id") or i.get("date") or n): i for n, i in enumerate(v)})
            return v
        return self.local.list_items(kind)

    def delete_item(self, kind, item_id):
        self.local.delete_item(kind, item_id)
        self._try(self.primary.delete_item, kind, item_id)

    def replace_kind(self, kind, items):
        self.local.replace_kind(kind, items)
        self._try(self.primary.replace_kind, kind, items)

    def incr(self, kind, item_id, field, by=1):
        ok, v = self._try(self.primary.incr, kind, item_id, field, by)
        return v if ok else self.local.incr(kind, item_id, field, by)

    def status(self) -> dict:
        return {"mode": "local-fallback" if self.degraded else "aws", "last_error": self.last_error}


_store = None


def get_store():
    global _store
    if _store is None:
        if os.environ.get("DATA_BUCKET") and os.environ.get("TABLE_NAME") and os.environ.get("LOCAL_MIRROR"):
            from botocore.config import Config  # noqa: F401  (fail fast on expired credentials)

            _store = ResilientStore(
                AwsStore(os.environ["DATA_BUCKET"], os.environ["TABLE_NAME"], os.environ.get("AWS_REGION", "ap-northeast-2")),
                LocalStore(os.environ["LOCAL_MIRROR"]),
            )
        elif os.environ.get("DATA_BUCKET") and os.environ.get("TABLE_NAME"):
            _store = AwsStore(os.environ["DATA_BUCKET"], os.environ["TABLE_NAME"], os.environ.get("AWS_REGION", "ap-northeast-2"))
        else:
            root = os.environ.get("LOCAL_STORE", str(Path(__file__).resolve().parents[2] / "data" / "local"))
            _store = LocalStore(root)
    return _store
