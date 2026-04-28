"""file-with-cra now requires only T183 (no client approval).
This test toggles a Mongo engagement so we can run a clean happy path: status=IN_REVIEW,
review_decision absent, t183_signed_at present → file-with-cra succeeds and emits
filing_complete_admin notification."""
import asyncio
import io
import os
import time
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = BASE_URL + "/api"
PASSWORD = "CloudTax2026!"
MONGO_URL = open("/app/backend/.env").read().split("MONGO_URL=")[1].split()[0].strip().strip('"')
DB_NAME = open("/app/backend/.env").read().split("DB_NAME=")[1].split()[0].strip().strip('"')


def login(email):
    s = requests.Session()
    last = None
    for _ in range(3):
        try:
            r = s.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=60)
            last = r
            if r.status_code == 200:
                return s
        except Exception as e:
            last = e
        time.sleep(2)
    pytest.skip(f"login {email} unavailable: {last}")


@pytest.fixture(scope="module")
def db():
    cli = AsyncIOMotorClient(MONGO_URL)
    return cli[DB_NAME]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_file_with_cra_succeeds_without_client_approval(db):
    cpa = login("terryann@cloudtax.ca")
    admin = login("admin@cloudtax.ca")

    # Find Ahmed engagement (IN_REVIEW + approved + t183 signed) — we'll temporarily strip approval
    eng = _run(db.engagements.find_one({"id": "d81902dc-5262-4435-8af1-19065ad1a3cc"}))
    if not eng:
        # Fallback: any IN_REVIEW eng with t183 signed
        eng = _run(db.engagements.find_one({"status": "IN_REVIEW", "t183_signed_at": {"$ne": None}}))
        if not eng:
            pytest.skip("No suitable IN_REVIEW eng with t183 signed found")

    eid = eng["id"]
    # Save state for restoration
    saved_status = eng.get("status")
    saved_review_decision = eng.get("review_decision")
    saved_filing_date = eng.get("filing_date")
    saved_filing_confirmation = eng.get("filing_confirmation")
    saved_filed_return_doc_id = eng.get("filed_return_doc_id")
    saved_filing_note = eng.get("filing_note")
    saved_filed_by_id = eng.get("filed_by_id")
    saved_filed_by_name = eng.get("filed_by_name")
    saved_t183 = eng.get("t183_signed_at")

    # Force IN_REVIEW + remove review_decision so we exercise the "no client approval" branch
    _run(db.engagements.update_one({"id": eid}, {
        "$set": {"status": "IN_REVIEW"},
        "$unset": {"review_decision": ""},
    }))
    if not saved_t183:
        # ensure t183 is signed
        _run(db.engagements.update_one({"id": eid}, {"$set": {"t183_signed_at": datetime.now(timezone.utc)}}))

    # Capture admin notifications baseline
    nb = admin.get(f"{API}/notifications", timeout=30).json()
    nb_ids = {n.get("id") for n in nb}

    # Submit file-with-cra
    files = {"file": ("iter11_filed.pdf", io.BytesIO(b"%PDF-iter11"), "application/pdf")}
    params = {"cra_confirmation": f"CRA-ITER11-{int(time.time())}", "filing_datetime": "2026-01-15T10:00:00Z"}
    r = cpa.post(f"{API}/engagements/{eid}/file-with-cra", params=params, files=files, timeout=60)
    try:
        assert r.status_code == 200, f"file-with-cra failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert data.get("filing_confirmation") == params["cra_confirmation"]

        # Verify status is FILED in mongo
        eng_after = _run(db.engagements.find_one({"id": eid}))
        assert eng_after["status"] == "FILED"
        assert "review_decision" not in eng_after  # never approved

        # Admin should get filing_complete_admin notification
        time.sleep(1)
        na = admin.get(f"{API}/notifications", timeout=30).json()
        new_admin_notes = [n for n in na if n.get("id") not in nb_ids and n.get("type") == "filing_complete_admin" and n.get("engagement_id") == eid]
        assert new_admin_notes, "expected filing_complete_admin notification for admin"
    finally:
        # Restore original engagement state
        restore_set = {
            "status": saved_status or "IN_REVIEW",
        }
        restore_unset = {}
        if saved_review_decision is not None:
            restore_set["review_decision"] = saved_review_decision
        if saved_filing_date is not None:
            restore_set["filing_date"] = saved_filing_date
        else:
            restore_unset["filing_date"] = ""
        if saved_filing_confirmation is not None:
            restore_set["filing_confirmation"] = saved_filing_confirmation
        else:
            restore_unset["filing_confirmation"] = ""
        if saved_filed_return_doc_id is not None:
            restore_set["filed_return_doc_id"] = saved_filed_return_doc_id
        else:
            restore_unset["filed_return_doc_id"] = ""
        if saved_filing_note is not None:
            restore_set["filing_note"] = saved_filing_note
        else:
            restore_unset["filing_note"] = ""
        if saved_filed_by_id is not None:
            restore_set["filed_by_id"] = saved_filed_by_id
        if saved_filed_by_name is not None:
            restore_set["filed_by_name"] = saved_filed_by_name
        update = {"$set": restore_set}
        if restore_unset:
            update["$unset"] = restore_unset
        _run(db.engagements.update_one({"id": eid}, update))


def test_file_with_cra_blocked_without_t183(db):
    cpa = login("terryann@cloudtax.ca")
    eng = _run(db.engagements.find_one({"status": "IN_REVIEW"}))
    if not eng:
        pytest.skip("no IN_REVIEW eng available")
    eid = eng["id"]
    saved_t183 = eng.get("t183_signed_at")
    # Strip t183
    _run(db.engagements.update_one({"id": eid}, {"$unset": {"t183_signed_at": ""}}))
    try:
        files = {"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")}
        params = {"cra_confirmation": "CRA-NOT", "filing_datetime": "2026-01-15T10:00:00Z"}
        r = cpa.post(f"{API}/engagements/{eid}/file-with-cra", params=params, files=files, timeout=60)
        assert r.status_code == 400
        assert "T183" in r.text or "t183" in r.text.lower()
    finally:
        if saved_t183:
            _run(db.engagements.update_one({"id": eid}, {"$set": {"t183_signed_at": saved_t183}}))
