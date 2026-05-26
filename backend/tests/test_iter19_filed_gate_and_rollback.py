"""Iter19 — FILED gate (defense-in-depth) + rollback from FILED.

Item 1c: PATCH /api/engagements/{eid} {status: 'FILED'} requires t183_signed_at AND filing_confirmation.
Item 1d: Rolling back from FILED -> IN_REVIEW (or earlier) is still allowed.
"""

import os
import requests
import pytest

def _read_frontend_env():
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@cloudtax.ca"
CPA_EMAIL = "pallavi@cloudtax.ca"
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def _login(session: requests.Session, email: str) -> dict:
    r = session.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    _login(s, ADMIN_EMAIL)
    return s


@pytest.fixture(scope="module")
def cpa_session():
    s = requests.Session()
    _login(s, CPA_EMAIL)
    return s


# ---------- Item 1c: backend defense-in-depth gate -------------------------

class TestFiledGate:

    def test_patch_to_filed_without_t183_returns_400(self, cpa_session):
        # Find an engagement without t183_signed_at and not yet FILED.
        r = cpa_session.get(f"{API}/engagements", timeout=15)
        assert r.status_code == 200
        engs = r.json()
        target = next(
            (e for e in engs if not e.get("t183_signed_at") and e.get("status") != "FILED"),
            None,
        )
        if not target:
            pytest.skip("No engagement without t183_signed_at available")
        r2 = cpa_session.patch(
            f"{API}/engagements/{target['id']}", json={"status": "FILED"}, timeout=15
        )
        assert r2.status_code == 400, f"expected 400, got {r2.status_code} body={r2.text}"
        body = r2.json()
        msg = (body.get("detail") or body.get("message") or "").lower()
        assert "t183" in msg, f"expected T183 wording, got: {msg}"

    def test_patch_to_filed_with_t183_but_no_confirmation_returns_400(self, cpa_session):
        # Find an engagement WITH t183_signed_at but WITHOUT filing_confirmation, status != FILED
        r = cpa_session.get(f"{API}/engagements", timeout=15)
        assert r.status_code == 200
        engs = r.json()
        target = next(
            (
                e for e in engs
                if e.get("t183_signed_at")
                and not e.get("filing_confirmation")
                and e.get("status") != "FILED"
            ),
            None,
        )
        if not target:
            pytest.skip("No engagement with t183 but without filing_confirmation available")
        r2 = cpa_session.patch(
            f"{API}/engagements/{target['id']}", json={"status": "FILED"}, timeout=15
        )
        assert r2.status_code == 400, f"expected 400, got {r2.status_code} body={r2.text}"
        body = r2.json()
        msg = (body.get("detail") or body.get("message") or "").lower()
        assert "update submission info" in msg or "filing_confirmation" in msg or "cra" in msg, (
            f"expected 'Update submission info' wording, got: {msg}"
        )


# ---------- Item 1d: rollback from FILED -----------------------------------

class TestRollbackFromFiled:

    def test_admin_can_rollback_filed_to_in_review_then_restore(self, admin_session):
        # Find a FILED engagement
        r = admin_session.get(f"{API}/engagements", timeout=15)
        assert r.status_code == 200
        engs = r.json()
        target = next((e for e in engs if e.get("status") == "FILED"), None)
        if not target:
            pytest.skip("No FILED engagement available")
        eid = target["id"]
        original = {
            "status": target.get("status"),
            "filing_confirmation": target.get("filing_confirmation"),
            "filing_date": target.get("filing_date"),
            "filed_return_doc_id": target.get("filed_return_doc_id"),
            "filing_summary": target.get("filing_summary"),
        }

        # Roll back to IN_REVIEW
        r2 = admin_session.patch(
            f"{API}/engagements/{eid}", json={"status": "IN_REVIEW"}, timeout=15
        )
        assert r2.status_code == 200, f"rollback failed: {r2.status_code} {r2.text}"

        # Verify GET shows IN_REVIEW
        r3 = admin_session.get(f"{API}/engagements/{eid}", timeout=15)
        assert r3.status_code == 200
        assert r3.json().get("status") == "IN_REVIEW"

        # Restore back to FILED — only safe if filing_confirmation is still present
        # The PATCH gate requires both t183 + filing_confirmation. Since we did NOT clear
        # those fields on rollback, restoring should succeed.
        if original["filing_confirmation"]:
            r4 = admin_session.patch(
                f"{API}/engagements/{eid}", json={"status": "FILED"}, timeout=15
            )
            assert r4.status_code == 200, f"restore to FILED failed: {r4.status_code} {r4.text}"
            r5 = admin_session.get(f"{API}/engagements/{eid}", timeout=15)
            assert r5.status_code == 200
            assert r5.json().get("status") == "FILED"
        else:
            # Best-effort: leave as IN_REVIEW (no clean restore path without filing data)
            pass
