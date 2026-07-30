"""Shared in-process test scaffolding for Admin/CPA dashboard behaviour.

NOT a test module (no ``test_`` prefix -> pytest won't collect it). Fuller
Mongo double than cpa_assign_helpers.py's — adds ``find`` (with a chainable,
async-iterable cursor), ``count_documents`` and ``aggregate`` so
``server.list_engagements`` / ``server._enrich_engagements`` can run
end-to-end against fixture data, no running backend or MongoDB required.
"""
import copy

import server


def _match(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if isinstance(v, dict):
            if "$ne" in v and doc.get(k) == v["$ne"]:
                return False
            if "$in" in v and doc.get(k) not in v["$in"]:
                return False
            continue
        if doc.get(k) != v:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    def __aiter__(self):
        docs = self._docs

        async def gen():
            for d in docs:
                yield copy.deepcopy(d)
        return gen()

    async def to_list(self, length=None):
        docs = self._docs if length is None else self._docs[:length]
        return [copy.deepcopy(d) for d in docs]


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if _match(d, query):
                return copy.deepcopy(d)
        return None

    def find(self, query=None, projection=None):
        query = query or {}
        return _Cursor([d for d in self.docs if _match(d, query)])

    async def count_documents(self, query):
        return len([d for d in self.docs if _match(d, query)])

    def aggregate(self, pipeline):
        # Only used for the time_entries hours sum in _enrich_engagements —
        # no fixture data exercises it, an empty result is correct.
        return _Cursor([])

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


def setup(monkeypatch, *, engagements=None, users=None, corporations=None,
          documents=None, time_entries=None, opportunities=None):
    db = _DB(
        engagements=engagements or [],
        users=users or [],
        corporations=corporations or [],
        documents=documents or [],
        time_entries=time_entries or [],
        opportunities=opportunities or [],
    )
    monkeypatch.setattr(server, "get_db", lambda: db)
    return db


ADMIN = {"id": "admin-1", "role": "ADMIN", "email": "nim@cloudtax.ca", "name": "Nim"}
CPA1 = {"id": "cpa-1", "role": "CPA", "email": "pallavi@cloudtax.ca", "name": "Pallavi Sharma"}


def corp(cid="corp-1", client_id="client-1"):
    return {"id": cid, "name": "TEST Medical Prof Corp", "client_id": client_id}


def client(cid="client-1"):
    return {"id": cid, "role": "CLIENT", "email": "c@example.com",
            "name": "Dr Chen", "password_hash": "x", "is_active": True}


def diy_engagement(eid="eng-diy-1", *, assigned_cpa_id=None, plan="NIL", corp_id="corp-1"):
    return {
        "id": eid,
        "status": "INTAKE",
        "tier": None,
        "service_model": "DIY",
        "plan": plan,
        "nil_amount": 0 if plan == "NIL" else None,
        "assigned_cpa_id": assigned_cpa_id,
        "partner_advisor_id": None,
        "corporation_id": corp_id,
        "source": "SELF_SERVE",
        "diy_engine_opened_at": None,
        "referral_date": None,
        "created_at": None,
    }


def dfy_engagement(eid="eng-dfy-1", *, assigned_cpa_id=None, corp_id="corp-1"):
    return {
        "id": eid,
        "status": "REFERRED",
        "tier": "STANDARD",
        "service_model": "DFY",
        "plan": None,
        "assigned_cpa_id": assigned_cpa_id,
        "partner_advisor_id": None,
        "corporation_id": corp_id,
        "source": None,
        "referral_date": None,
        "created_at": None,
    }
