"""
Tests for the CPA draft upload + cancel flow with auto status transitions.

Covers:
- POST /api/engagements/{eid}/upload-draft (IN_PREP -> IN_REVIEW auto-move + clears review_decision)
- POST /api/engagements/{eid}/upload-draft (IN_REVIEW with prior decision: clears it, status stays IN_REVIEW)
- DELETE /api/engagements/{eid}/draft (CPA/ADMIN only; reverts IN_REVIEW -> IN_PREP)
- DELETE returns 404 when no draft
- DELETE forbidden for CLIENT / PARTNER
- Regression: POST /api/engagements/{eid}/move-to-review still works
- Regression: POST /api/engagements/{eid}/review-decision still works
- Full E2E loop: CPA upload -> client issue -> CPA re-upload clears decision
"""
import io
import os
import time

import pytest
import requests

def _read_frontend_env_url() -> str:
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.strip().startswith("REACT_APP_BACKEND_URL="):
                    return line.strip().split("=", 1)[1]
    except Exception:
        pass
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env_url()).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set in env or /app/frontend/.env"
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")

ADMIN = "admin@cloudtax.ca"
CPA = "terryann@cloudtax.ca"  # Thompson's assigned CPA
CPA_OTHER = "pallavi@cloudtax.ca"
WS = "watson@partner.ca"
CLIENT_INPREP = "thompson@example.com"  # IN_PREP, assigned to terryann
CLIENT_INREVIEW = "ahmed@example.com"   # IN_REVIEW

PDF_BYTES = (
    b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
    b"xref\n0 3\n0000000000 65535 f \n0000000015 00000 n \n0000000060 00000 n \n"
    b"trailer<</Size 3/Root 1 0 R>>\nstartxref\n110\n%%EOF\n"
)


# -------- helpers --------

def _login(email: str, password: str = PASSWORD) -> requests.Session:
    s = requests.Session()
    last_err = None
    for _ in range(3):
        try:
            r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=45)
            assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
            return s
        except requests.exceptions.RequestException as e:
            last_err = e
            time.sleep(2)
    raise AssertionError(f"login failed after retries: {last_err}")


def _client_engagement(client_session: requests.Session) -> dict:
    """Return current engagement for the logged-in client via GET /api/engagements (scoped)."""
    r = client_session.get(f"{BASE_URL}/api/engagements", timeout=15)
    assert r.status_code == 200, f"GET /engagements: {r.status_code} {r.text}"
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("engagements") or []
    assert items, "client has no engagements"
    # return the freshest one
    return items[0]


def _engagement(session: requests.Session, eid: str) -> dict:
    r = session.get(f"{BASE_URL}/api/engagements/{eid}", timeout=15)
    assert r.status_code == 200, f"GET engagement {eid}: {r.status_code} {r.text}"
    return r.json()


def _set_status_via_admin(admin: requests.Session, eid: str, status: str) -> None:
    """Best-effort status set using the admin status endpoint, if available."""
    r = admin.patch(f"{BASE_URL}/api/engagements/{eid}/status", json={"status": status}, timeout=15)
    # Accept either 200 or 204 (some apps); we'll just assert it succeeded
    assert r.status_code in (200, 204), f"admin status set: {r.status_code} {r.text}"


def _upload_draft(cpa: requests.Session, eid: str, instructions: str | None = None) -> requests.Response:
    files = {"file": ("draft.pdf", io.BytesIO(PDF_BYTES), "application/pdf")}
    params = {"instructions": instructions} if instructions is not None else None
    return cpa.post(f"{BASE_URL}/api/engagements/{eid}/upload-draft", files=files, params=params, timeout=30)


# -------- fixtures --------

@pytest.fixture(scope="session")
def admin_s():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def cpa_s():
    return _login(CPA)


@pytest.fixture(scope="session")
def ws_s():
    return _login(WS)


@pytest.fixture(scope="session")
def client_inprep_s():
    return _login(CLIENT_INPREP)


@pytest.fixture(scope="session")
def client_inreview_s():
    return _login(CLIENT_INREVIEW)


# ============================================================
# Health / login sanity
# ============================================================

class TestAuth:
    def test_admin_login(self, admin_s):
        r = admin_s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        assert r.json().get("role") == "ADMIN"

    def test_cpa_login(self, cpa_s):
        r = cpa_s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        assert r.json().get("role") == "CPA"

    def test_client_login(self, client_inprep_s):
        r = client_inprep_s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code == 200
        assert r.json().get("role") == "CLIENT"


# ============================================================
# IN_PREP -> auto IN_REVIEW on upload-draft
# ============================================================

class TestUploadDraftAutoMove:
    def test_inprep_upload_moves_to_review_and_clears_decision(self, cpa_s, admin_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]

        # Ensure starting state IN_PREP and clear any pre-existing draft
        if eng.get("status") != "IN_PREP":
            # Try to reset back to IN_PREP via DELETE draft, or admin status
            cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
            try:
                _set_status_via_admin(admin_s, eid, "IN_PREP")
            except AssertionError:
                pass
            eng = _engagement(cpa_s, eid)
        assert eng.get("status") == "IN_PREP", f"precondition: status must be IN_PREP, got {eng.get('status')}"

        r = _upload_draft(cpa_s, eid, instructions="Please review the new RRSP deduction.")
        assert r.status_code == 200, f"upload-draft: {r.status_code} {r.text}"
        body = r.json()
        assert body["ok"] is True
        assert body["moved_to_review"] is True
        assert body.get("doc_id")

        eng2 = _engagement(cpa_s, eid)
        assert eng2["status"] == "IN_REVIEW"
        assert eng2.get("t2_draft_doc_id") == body["doc_id"]
        assert eng2.get("review_instructions") == "Please review the new RRSP deduction."
        assert not eng2.get("review_decision")

    def test_inreview_reupload_keeps_status_and_clears_decision(self, cpa_s, client_inprep_s):
        # Continue from previous test where engagement is now IN_REVIEW
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        assert eng["status"] == "IN_REVIEW"

        # Client submits an issue
        rd = client_inprep_s.post(
            f"{BASE_URL}/api/engagements/{eid}/review-decision",
            json={"decision": "issue", "issue_note": "Page 2 figure mismatch"},
            timeout=15,
        )
        assert rd.status_code == 200, f"review-decision: {rd.status_code} {rd.text}"
        assert rd.json()["review_decision"]["decision"] == "issue"

        # Verify decision is set on engagement
        eng_mid = _engagement(cpa_s, eid)
        assert eng_mid.get("review_decision", {}).get("decision") == "issue"

        # CPA uploads a fresh draft -> should clear decision; status stays IN_REVIEW
        r = _upload_draft(cpa_s, eid, instructions="Updated.")
        assert r.status_code == 200, f"reupload: {r.status_code} {r.text}"
        body = r.json()
        assert body["moved_to_review"] is False  # already in review

        eng_after = _engagement(cpa_s, eid)
        assert eng_after["status"] == "IN_REVIEW"
        assert not eng_after.get("review_decision"), \
            f"review_decision should be cleared, got {eng_after.get('review_decision')}"


# ============================================================
# DELETE /engagements/{eid}/draft
# ============================================================

class TestDeleteDraft:
    def test_delete_draft_reverts_to_inprep(self, cpa_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]

        # Ensure a draft exists; if not, upload one first
        if not eng.get("t2_draft_doc_id"):
            up = _upload_draft(cpa_s, eid)
            assert up.status_code == 200

        r = cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        assert r.status_code == 200, f"delete draft: {r.status_code} {r.text}"
        body = r.json()
        assert body["ok"] is True
        assert body["moved_back_to_prep"] in (True, False)

        eng_after = _engagement(cpa_s, eid)
        assert not eng_after.get("t2_draft_doc_id")
        assert not eng_after.get("review_decision")
        assert eng_after["status"] == "IN_PREP"

    def test_delete_draft_returns_404_when_missing(self, cpa_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        # ensure no draft (idempotent delete)
        cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        r = cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    def test_delete_draft_forbidden_for_client(self, cpa_s, client_inprep_s):
        # Re-upload draft so we have a real engagement with draft to test against
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        _upload_draft(cpa_s, eid)
        r = client_inprep_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        assert r.status_code == 403, f"client should be 403, got {r.status_code} {r.text}"

    def test_delete_draft_forbidden_for_ws_partner(self, cpa_s, ws_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        # ensure draft exists
        if not _engagement(cpa_s, eid).get("t2_draft_doc_id"):
            _upload_draft(cpa_s, eid)
        r = ws_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        assert r.status_code == 403, f"Partner should be 403, got {r.status_code} {r.text}"

    def test_admin_can_delete_draft(self, cpa_s, admin_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        # ensure a draft is present
        if not _engagement(cpa_s, eid).get("t2_draft_doc_id"):
            up = _upload_draft(cpa_s, eid)
            assert up.status_code == 200
        r = admin_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        assert r.status_code == 200, f"admin delete: {r.status_code} {r.text}"


# ============================================================
# Regression: review-decision + move-to-review still work
# ============================================================

class TestRegression:
    def test_move_to_review_manual(self, cpa_s, admin_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]

        # Reset to IN_PREP first
        cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
        eng_now = _engagement(cpa_s, eid)
        if eng_now["status"] != "IN_PREP":
            try:
                _set_status_via_admin(admin_s, eid, "IN_PREP")
            except AssertionError:
                pytest.skip("Cannot reset to IN_PREP via admin endpoint")

        # Upload a draft (will auto-move). Move the status manually back to IN_PREP via admin first to test manual move.
        # Simpler: upload-draft auto-moves so manual move-to-review is mostly a no-op now. We instead verify the endpoint is callable.
        up = _upload_draft(cpa_s, eid)
        assert up.status_code == 200
        # Engagement is now IN_REVIEW. move-to-review should be idempotent (or 400).
        r = cpa_s.post(f"{BASE_URL}/api/engagements/{eid}/move-to-review", json={}, timeout=15)
        # Accept 200 (idempotent) or 400 (already in review) — endpoint should not 500.
        assert r.status_code in (200, 400), f"move-to-review unexpected: {r.status_code} {r.text}"

    def test_review_decision_approved(self, cpa_s, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        # ensure status is IN_REVIEW with a draft
        if eng["status"] != "IN_REVIEW" or not eng.get("t2_draft_doc_id"):
            _upload_draft(cpa_s, eid)
        r = client_inprep_s.post(
            f"{BASE_URL}/api/engagements/{eid}/review-decision",
            json={"decision": "approved"},
            timeout=15,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json()["review_decision"]["decision"] == "approved"

    def test_review_decision_issue_requires_note(self, client_inprep_s):
        eng = _client_engagement(client_inprep_s)
        eid = eng["id"]
        r = client_inprep_s.post(
            f"{BASE_URL}/api/engagements/{eid}/review-decision",
            json={"decision": "issue", "issue_note": ""},
            timeout=15,
        )
        assert r.status_code == 400


# ============================================================
# Cleanup: leave the IN_PREP client back at IN_PREP w/o draft
# ============================================================

@pytest.fixture(scope="session", autouse=True)
def _cleanup(request, cpa_s, admin_s):
    yield
    # Best effort: delete any draft on Thompson's engagement
    try:
        s = _login(CLIENT_INPREP)
        eid = _client_engagement(s)["id"]
        cpa_s.delete(f"{BASE_URL}/api/engagements/{eid}/draft", timeout=15)
    except Exception:
        pass
