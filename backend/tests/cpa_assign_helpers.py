"""Shared in-process test scaffolding for CPA-assignment behaviour.

NOT a test module (no ``test_`` prefix → pytest won't collect it). Provides a
tiny async Mongo double so tests can call the real ``server.update_engagement``
coroutine directly — no running backend or MongoDB required, Resend stays a
no-op. Imported by ``test_cpa_assignment_email`` and
``test_cpa_assignment_permission``.
"""
import copy

import server


def _match(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if isinstance(v, dict):
            # Only ``$ne`` appears on paths these tests don't exercise; ignore
            # other projection/operator dicts to stay minimal.
            if "$ne" in v and doc.get(k) == v["$ne"]:
                return False
            continue
        if doc.get(k) != v:
            return False
    return True


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if _match(d, query):
                return copy.deepcopy(d)   # callers may mutate their copy
        return None

    async def update_one(self, query, update):
        for d in self.docs:
            if _match(d, query):
                d.update(update.get("$set", {}))
                return

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))


class _DB:
    def __init__(self, **colls):
        for name, docs in colls.items():
            setattr(self, name, _Coll(docs))


def setup(monkeypatch, *, eng, users, corps):
    """Patch ``server.get_db`` + ``server._email_templates_send`` and return
    ``(db, sent, notifications)`` where ``sent`` captures email dispatches and
    ``notifications`` captures in-app bell rows."""
    notifications: list = []
    db = _DB(engagements=[eng], users=users, corporations=corps, notifications=notifications)
    monkeypatch.setattr(server, "get_db", lambda: db)
    sent: list = []

    async def fake_send(to, template, data=None):
        sent.append((to, template, data))
        return {"success": True}

    monkeypatch.setattr(server, "_email_templates_send", fake_send)
    return db, sent, notifications


# Canonical actors. NB: ADMIN deliberately has NO "permissions" key — mirrors
# auth.seed_admin, which is the lock-out risk the gate must guard against.
ADMIN = {"id": "admin-1", "role": "ADMIN", "email": "nim@cloudtax.ca", "name": "Nim"}
CPA1 = {"id": "cpa-1", "role": "CPA", "email": "pallavi@cloudtax.ca", "name": "Pallavi Sharma"}
CPA2 = {"id": "cpa-2", "role": "CPA", "email": "terryann@cloudtax.ca", "name": "Terry-Ann Mitchell"}


def engagement(assigned=None):
    return {
        "id": "eng-1",
        "status": "REFERRED",
        "tier": "STANDARD",
        "assigned_cpa_id": assigned,
        "partner_advisor_id": None,
        "corporation_id": "corp-1",
    }


def corp():
    return {"id": "corp-1", "name": "TEST Medical Prof Corp", "client_id": "client-1"}


def client():
    return {"id": "client-1", "role": "CLIENT", "email": "c@example.com",
            "name": "Dr Chen", "password_hash": "x"}
