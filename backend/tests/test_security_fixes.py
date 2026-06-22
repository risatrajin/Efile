"""Security regressions — B1/B2/B3/M4/M5 from the correctness audit.

Each test exploits the original hole and asserts it's now blocked, plus that
the legitimate path still works. Integration-style over HTTP (matches the
suite); a pymongo handle is used to stage/restore state and is best-effort
(skips cleanly if the DB isn't reachable, e.g. a remote CI backend).
"""
import os
import datetime as dt
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.text}"
    return r.json()["token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": _login("nim@cloudtax.ca"),
        "cpa": _login("pallavi@cloudtax.ca"),
        "cpa2": _login("terryann@cloudtax.ca"),
        "partner": _login("watson@partner.ca"),
        "client": _login("patel@example.com"),
    }


@pytest.fixture(scope="module")
def db():
    try:
        from pymongo import MongoClient
        url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        name = os.environ.get("DB_NAME", "cloudtax_ws_pilot")
        return MongoClient(url).get_database(name)
    except Exception:
        pytest.skip("no direct DB access for state setup")


@pytest.fixture(scope="module")
def client_eid(tokens):
    """An engagement the CLIENT owns (so payload checks are valid)."""
    r = requests.get(f"{BASE}/api/engagements", headers=H(tokens["client"]), timeout=20)
    assert r.status_code == 200
    return r.json()[0]["id"]


# --------------------------------------------------------------------------- B1
def test_b1_notes_history_not_leaked_to_client_or_partner(tokens, db, client_eid):
    eng = db.engagements.find_one({"id": client_eid})
    saved = eng.get("notes_history", [])
    db.engagements.update_one({"id": client_eid}, {"$set": {"notes_history": [
        {"id": "secnote", "text": "INTERNAL staff note must not leak", "author_role": "CPA"}]}})
    try:
        cli = requests.get(f"{BASE}/api/engagements/{client_eid}", headers=H(tokens["client"]), timeout=20)
        assert "notes_history" not in cli.json() and "INTERNAL staff note" not in cli.text
        par = requests.get(f"{BASE}/api/engagements/{client_eid}", headers=H(tokens["partner"]), timeout=20)
        assert "notes_history" not in par.json() and "INTERNAL staff note" not in par.text
        # Staff still see it.
        adm = requests.get(f"{BASE}/api/engagements/{client_eid}", headers=H(tokens["admin"]), timeout=20)
        assert adm.json().get("notes_history") and "INTERNAL staff note" in adm.text
    finally:
        db.engagements.update_one({"id": client_eid}, {"$set": {"notes_history": saved}})


# --------------------------------------------------------------------------- B2
def test_b2_partner_cannot_complete_upload(tokens, db, client_eid):
    doc = db.documents.find_one({"engagement_id": client_eid, "status": "PENDING"})
    assert doc, "need a pending doc"
    body = {"object_key": "k/x.pdf", "file_name": "x.pdf", "file_size": 5, "mime_type": "application/pdf"}
    try:
        r = requests.post(f"{BASE}/api/documents/{doc['id']}/complete-upload", headers=H(tokens["partner"]), json=body, timeout=20)
        assert r.status_code == 403, r.text
        # Client (the legit uploader) still works.
        r = requests.post(f"{BASE}/api/documents/{doc['id']}/complete-upload", headers=H(tokens["client"]), json=body, timeout=20)
        assert r.status_code == 200, r.text
    finally:
        db.documents.update_one({"id": doc["id"]}, {"$set": {"status": "PENDING"}, "$unset": {
            "object_key": "", "file_name": "", "file_size": "", "mime_type": "", "uploaded_at": "",
            "uploaded_by": "", "files": "", "issue_note": "", "deferred_at": ""}})


# --------------------------------------------------------------------------- B3
def test_b3_update_opp_scoped_no_idor_leak(tokens, db):
    cpa = db.users.find_one({"email": "pallavi@cloudtax.ca"})
    cpa_engs = [e["id"] for e in db.engagements.find({"assigned_cpa_id": cpa["id"]})]
    foreign = db.opportunities.find_one({"engagement_id": {"$nin": cpa_engs}})
    mine = db.opportunities.find_one({"engagement_id": {"$in": cpa_engs}})
    assert foreign and mine, "need opps on/off a CPA's engagements"
    # CLIENT poking a foreign opp by id -> blocked, no financial leak in body.
    r = requests.patch(f"{BASE}/api/opportunities/{foreign['id']}", headers=H(tokens["client"]), json={"shared_with_ws": False}, timeout=20)
    assert r.status_code in (403, 404), r.text
    assert "description" not in r.text and "title" not in r.text
    # A CPA not assigned to that engagement -> blocked.
    ta = db.users.find_one({"email": "terryann@cloudtax.ca"})
    ta_engs = [e["id"] for e in db.engagements.find({"assigned_cpa_id": ta["id"]})]
    not_ta = db.opportunities.find_one({"engagement_id": {"$nin": ta_engs}})
    r = requests.patch(f"{BASE}/api/opportunities/{not_ta['id']}", headers=H(tokens["cpa2"]), json={"shared_with_ws": True}, timeout=20)
    assert r.status_code == 403, r.text
    # Legit: the assigned CPA can share + un-share their own engagement's opp.
    was = bool(mine.get("shared_with_ws"))
    try:
        r = requests.patch(f"{BASE}/api/opportunities/{mine['id']}", headers=H(tokens["cpa"]), json={"shared_with_ws": True}, timeout=20)
        assert r.status_code == 200 and r.json()["shared_with_ws"] is True
        r = requests.patch(f"{BASE}/api/opportunities/{mine['id']}", headers=H(tokens["cpa"]), json={"shared_with_ws": False}, timeout=20)
        assert r.status_code == 200 and r.json()["shared_with_ws"] is False
    finally:
        db.opportunities.update_one({"id": mine["id"]}, {"$set": {"shared_with_ws": was}})


# --------------------------------------------------------------------------- M4
def test_m4_status_gate_rejections(tokens, db, client_eid):
    adm = H(tokens["admin"])
    eng = db.engagements.find_one({"id": client_eid})
    assert eng["status"] == "IN_PREP" and not eng.get("t2_draft_doc_id"), "expects an IN_PREP, draft-less engagement"

    def patch(body):
        return requests.patch(f"{BASE}/api/engagements/{client_eid}", headers=adm, json=body, timeout=20)

    assert patch({"status": "BANANA"}).status_code == 400          # junk status
    assert patch({"status": "IN_REVIEW"}).status_code == 400       # no T2 draft
    assert patch({"status": "FILED"}).status_code == 400           # out-of-order skip

    # FILED must require client approval even with T183 + submission info set.
    snap = {k: eng.get(k) for k in ["status", "t183_signed_at", "filing_confirmation", "review_decision",
                                      "review_start_date", "filing_date", "turnaround_days"]}
    try:
        db.engagements.update_one({"id": client_eid}, {"$set": {
            "status": "IN_REVIEW", "t183_signed_at": dt.datetime.now(),
            "filing_confirmation": "CRA-TEST", "review_decision": {"decision": "issue"}}})
        r = patch({"status": "FILED"})
        assert r.status_code == 400 and "approve" in r.json()["detail"].lower(), r.text
    finally:
        unset = {k: "" for k in ["t183_signed_at", "filing_confirmation", "review_decision",
                                  "review_start_date", "filing_date", "turnaround_days"] if snap.get(k) is None}
        db.engagements.update_one({"id": client_eid}, {"$set": {"status": snap["status"]}, "$unset": unset})
        cut = dt.datetime.now() - dt.timedelta(seconds=60)
        db.status_history.delete_many({"engagement_id": client_eid, "created_at": {"$gt": cut}})


def test_m4_legit_forward_move(tokens, db):
    ref = db.engagements.find_one({"status": "REFERRED"})
    assert ref, "need a REFERRED engagement"
    try:
        r = requests.patch(f"{BASE}/api/engagements/{ref['id']}", headers=H(tokens["admin"]), json={"status": "INTAKE"}, timeout=20)
        assert r.status_code == 200, r.text
    finally:
        db.engagements.update_one({"id": ref["id"]}, {"$set": {"status": "REFERRED"}, "$unset": {"intake_complete_date": ""}})
        cut = dt.datetime.now() - dt.timedelta(seconds=60)
        db.status_history.delete_many({"engagement_id": ref["id"], "created_at": {"$gt": cut}})


# --------------------------------------------------------------------------- M5
def test_m5_partner_cannot_write_notes(tokens, db, client_eid):
    r = requests.post(f"{BASE}/api/engagements/{client_eid}/notes", headers=H(tokens["partner"]), json={"text": "x"}, timeout=20)
    assert r.status_code == 403, r.text
    r = requests.post(f"{BASE}/api/engagements/{client_eid}/notes", headers=H(tokens["client"]), json={"text": "x"}, timeout=20)
    assert r.status_code == 403, r.text
    # CPA still can; clean up the note it writes.
    r = requests.post(f"{BASE}/api/engagements/{client_eid}/notes", headers=H(tokens["cpa"]), json={"text": "SECTEST cpa note"}, timeout=20)
    assert r.status_code == 200, r.text
    e = db.engagements.find_one({"id": client_eid})
    nh = [n for n in (e.get("notes_history") or []) if "SECTEST" not in str(n)]
    db.engagements.update_one({"id": client_eid}, {"$set": {"notes_history": nh}})
