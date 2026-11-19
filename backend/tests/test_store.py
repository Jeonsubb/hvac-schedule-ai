from app.store import LocalStore, ResilientStore


class Flaky:
    """Stands in for AwsStore; raises once `broken` is set (e.g. expired credentials)."""

    def __init__(self):
        self.broken = False
        self.blobs, self.items = {}, {}

    def _chk(self):
        if self.broken:
            raise RuntimeError("ExpiredToken")

    def get_blob(self, k):
        self._chk()
        return self.blobs.get(k)

    def put_blob(self, k, v):
        self._chk()
        self.blobs[k] = v

    def put_item(self, kind, i, v):
        self._chk()
        self.items.setdefault(kind, {})[i] = v

    def get_item(self, kind, i):
        self._chk()
        return self.items.get(kind, {}).get(i)

    def list_items(self, kind):
        self._chk()
        return list(self.items.get(kind, {}).values())

    def delete_item(self, kind, i):
        self._chk()
        self.items.get(kind, {}).pop(i, None)

    def replace_kind(self, kind, items):
        self._chk()
        self.items[kind] = dict(items)

    def incr(self, kind, i, f, by=1):
        self._chk()
        it = self.items.setdefault(kind, {}).setdefault(i, {})
        it[f] = it.get(f, 0) + by
        return it[f]


def test_resilient_store_serves_mirror_when_primary_fails(tmp_path):
    p = Flaky()
    s = ResilientStore(p, LocalStore(str(tmp_path)))
    s.put_blob("days/x.json", {"a": 1})
    s.put_item("event", "E1", {"id": "E1", "title": "t"})
    p.items.setdefault("course", {})["C1"] = {"id": "C1"}
    assert [c["id"] for c in s.list_items("course")] == ["C1"]  # read-through mirrors it
    p.broken = True
    assert s.get_blob("days/x.json") == {"a": 1}
    assert s.get_item("event", "E1")["title"] == "t"
    assert [c["id"] for c in s.list_items("course")] == ["C1"]
    s.put_item("event", "E2", {"id": "E2"})  # writes keep working locally
    assert {e["id"] for e in s.list_items("event")} == {"E1", "E2"}
    assert s.status()["mode"] == "local-fallback"
