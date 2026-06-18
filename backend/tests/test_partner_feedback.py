"""Partner feedback — role rules + edit/remove audit markers.

Covers the contract for the partner-feedback feature:
  * PARTNER (any pilot client they can view) creates; only the AUTHOR may
    edit/remove their own item.
  * ADMIN + CPA read everyone's (read-only) and never see it stripped.
  * CLIENT is blocked from the endpoint AND never sees it in the engagement
    payload (the notes_history-class leak we explicitly guard against).
  * Edits set the "edited" marker + keep an edit_history audit trail (staff see
    the previous text — the partner can't silently change it).
  * Removal is a soft-delete tombstone that staff still see (it never silently
    vanishes); the partner's own list drops it.

Integration-style (live backend over HTTP), matching the rest of the suite.
A best-effort pymongo teardown hard-deletes the rows this module creates so it
doesn't leave tombstones in the dev DB.
"""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")

PARTNER_EMAIL = "watson@partner.ca"
PARTNER2_EMAIL = "kristin@partner.ca"   # a second PARTNER (not the author)
CPA_EMAIL = "pallavi@cloudtax.ca"
ADMIN_EMAIL = "nim@cloudtax.ca"
CLIENT_EMAIL = "patel@example.com"


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.text}"
    return r.json()["token"]


def H(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def partner(): return _login(PARTNER_EMAIL)


@pytest.fixture(scope="module")
def partner2(): return _login(PARTNER2_EMAIL)


@pytest.fixture(scope="module")
def cpa(): return _login(CPA_EMAIL)


@pytest.fixture(scope="module")
def admin(): return _login(ADMIN_EMAIL)


@pytest.fixture(scope="module")
def client(): return _login(CLIENT_EMAIL)


@pytest.fixture(scope="module")
def eid(client):
    """A client-owned engagement: the CLIENT can read it (so the payload-leak
    check is valid) and the PARTNER can also reach it (partners see all)."""
    r = requests.get(f"{BASE}/api/engagements", headers=H(client), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "client has no engagement to test against"
    return rows[0]["id"]


@pytest.fixture(scope="module", autouse=True)
def _cleanup(eid):
    """Best-effort hard-delete of rows this module creates (no hard-delete API
    by design — removal is a tombstone — so reach the DB directly for tests)."""
    yield
    try:
        from pymongo import MongoClient
        dbn = os.environ.get("DB_NAME", "cloudtax_ws_pilot")
        url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        MongoClient(url).get_database(dbn).partner_feedback.delete_many({"engagement_id": eid})
    except Exception:
        pass  # CI without DB access — leave the tombstones rather than fail


def _create(partner, eid, text="Audit test feedback"):
    r = requests.post(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(partner), json={"text": text}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# --------------------------------------------------------------------------- #

def test_partner_creates_and_staff_read(partner, cpa, admin, eid):
    fb = _create(partner, eid, "Strong client, clean books.")
    assert fb["edited"] is False and fb["removed"] is False
    fid = fb["id"]
    for tok, who in ((cpa, "cpa"), (admin, "admin")):
        r = requests.get(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(tok), timeout=20)
        assert r.status_code == 200, f"{who}: {r.text}"
        assert any(f["id"] == fid and f["text"] == "Strong client, clean books." for f in r.json()), who


def test_partner_only_create(client, eid):
    # A CLIENT may not create partner feedback.
    r = requests.post(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(client), json={"text": "nope"}, timeout=20)
    assert r.status_code == 403, r.text


def test_client_cannot_read_endpoint(client, eid):
    r = requests.get(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(client), timeout=20)
    assert r.status_code == 403, r.text


def test_client_engagement_payload_has_no_feedback(partner, client, eid):
    secret = "CONFIDENTIAL partner-only remark do-not-leak"
    _create(partner, eid, secret)
    r = requests.get(f"{BASE}/api/engagements/{eid}", headers=H(client), timeout=20)
    assert r.status_code == 200, r.text
    assert "partner_feedback" not in r.json()
    assert secret not in r.text  # never leaks via the engagement object


def test_only_author_can_edit(partner, partner2, cpa, eid):
    fid = _create(partner, eid, "v1 text")["id"]
    # A different partner cannot edit it.
    r = requests.patch(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner2), json={"text": "hijack"}, timeout=20)
    assert r.status_code == 403, r.text
    # Staff (read-only) cannot edit it.
    r = requests.patch(f"{BASE}/api/partner-feedback/{fid}", headers=H(cpa), json={"text": "staff edit"}, timeout=20)
    assert r.status_code == 403, r.text
    # The author can.
    r = requests.patch(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner), json={"text": "v2 text"}, timeout=20)
    assert r.status_code == 200, r.text


def test_edit_sets_marker_and_history(partner, admin, eid):
    fid = _create(partner, eid, "original wording")["id"]
    r = requests.patch(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner), json={"text": "revised wording"}, timeout=20)
    assert r.status_code == 200 and r.json()["edited"] is True and r.json()["edited_at"], r.text
    # Staff see the edited marker AND the previous text in the audit trail.
    r = requests.get(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(admin), timeout=20)
    item = next(f for f in r.json() if f["id"] == fid)
    assert item["edited"] is True
    assert any(h["text"] == "original wording" for h in item.get("edit_history", [])), item.get("edit_history")


def test_remove_is_tombstone_visible_to_staff(partner, partner2, cpa, admin, eid):
    fid = _create(partner, eid, "to be removed")["id"]
    # Non-author / staff cannot remove.
    assert requests.delete(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner2), timeout=20).status_code == 403
    assert requests.delete(f"{BASE}/api/partner-feedback/{fid}", headers=H(cpa), timeout=20).status_code == 403
    # Author removes -> soft-delete.
    r = requests.delete(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner), timeout=20)
    assert r.status_code == 200 and r.json().get("removed") is True, r.text
    # Staff STILL see it as a removed tombstone (not silently gone).
    r = requests.get(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(admin), timeout=20)
    tomb = [f for f in r.json() if f["id"] == fid]
    assert len(tomb) == 1 and tomb[0]["removed"] is True and tomb[0]["removed_at"], tomb
    # The partner's own list drops the removed item.
    r = requests.get(f"{BASE}/api/engagements/{eid}/partner-feedback", headers=H(partner), timeout=20)
    assert not any(f["id"] == fid for f in r.json())
    # Editing a removed item is rejected.
    assert requests.patch(f"{BASE}/api/partner-feedback/{fid}", headers=H(partner), json={"text": "x"}, timeout=20).status_code == 400
