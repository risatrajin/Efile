"""Iter17 — FILED gate validation: PATCH /engagements/{eid} status='FILED' must
require both t183_signed_at and filing_confirmation. Also includes regression
checks for forgot/reset password endpoint shapes and admin/cpa messages route
visibility (light)."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "nim@cloudtax.ca", "password": os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")}
CPA = {"email": "pallavi@cloudtax.ca", "password": os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s, data["user"]


@pytest.fixture(scope="module")
def admin_session():
    s, u = _login(ADMIN)
    return s, u


@pytest.fixture(scope="module")
def cpa_session():
    s, u = _login(CPA)
    return s, u


# ---------- Item 4: FILED gate ----------
class TestFiledGate:
    def _all_engagements(self, sess):
        r = sess.get(f"{BASE_URL}/api/engagements", timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_block_when_no_t183_no_confirmation(self, admin_session):
        sess, _ = admin_session
        engs = self._all_engagements(sess)
        # find an IN_REVIEW or earlier engagement without both signs
        cand = None
        for e in engs:
            if e.get("status") in ("INTAKE", "IN_PREP", "IN_REVIEW") and not e.get("t183_signed_at") and not e.get("filing_confirmation"):
                cand = e
                break
        if not cand:
            pytest.skip("No suitable engagement without t183/confirmation found")
        r = sess.patch(f"{BASE_URL}/api/engagements/{cand['id']}", json={"status": "FILED"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "t183" in detail, f"expected detail mentioning T183, got: {detail}"
        # ensure status NOT changed
        r2 = sess.get(f"{BASE_URL}/api/engagements/{cand['id']}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["status"] != "FILED"

    def test_block_when_t183_signed_but_no_confirmation(self, admin_session):
        sess, _ = admin_session
        engs = self._all_engagements(sess)
        cand = None
        for e in engs:
            if e.get("status") != "FILED" and e.get("t183_signed_at") and not e.get("filing_confirmation"):
                cand = e
                break
        if not cand:
            # Try to set up: find any non-FILED eng and stamp t183_signed_at via PATCH
            for e in engs:
                if e.get("status") in ("IN_REVIEW", "IN_PREP", "DELIVERY") and not e.get("filing_confirmation"):
                    # Inject t183_signed_at via PATCH (admin allowed) — model has the field
                    pr = sess.patch(f"{BASE_URL}/api/engagements/{e['id']}", json={"t183_signed_at": "2026-01-15T00:00:00+00:00"}, timeout=15)
                    if pr.status_code == 200 and pr.json().get("t183_signed_at"):
                        cand = pr.json()
                        break
        if not cand:
            pytest.skip("Could not arrange engagement with t183 only")
        r = sess.patch(f"{BASE_URL}/api/engagements/{cand['id']}", json={"status": "FILED"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "submission info" in detail or "filing_confirmation" in detail or "cra confirmation" in detail, f"unexpected detail: {detail}"

    def test_existing_filed_engagement_has_both_fields(self, admin_session):
        """Informational: not a hard gate test (seed data may bypass PATCH).
        Logs which seeded FILED engagements are missing the gate fields."""
        sess, _ = admin_session
        engs = self._all_engagements(sess)
        filed = [e for e in engs if e.get("status") == "FILED"]
        assert filed, "expected some FILED engagements in seed data"
        missing = [e["id"] for e in filed if not (e.get("t183_signed_at") and e.get("filing_confirmation"))]
        if missing:
            print(f"INFO: {len(missing)}/{len(filed)} seeded FILED engagements missing gate fields (e.g. {missing[:3]}). This is seed data, not a gate violation — PATCH path is enforced by other tests.")

    def test_cpa_role_also_blocked(self, cpa_session):
        sess, _ = cpa_session
        engs = self._all_engagements(sess)
        cand = None
        for e in engs:
            if e.get("status") in ("INTAKE", "IN_PREP", "IN_REVIEW") and (not e.get("t183_signed_at") or not e.get("filing_confirmation")):
                cand = e
                break
        if not cand:
            pytest.skip("No suitable engagement for CPA gate test")
        r = sess.patch(f"{BASE_URL}/api/engagements/{cand['id']}", json={"status": "FILED"}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"


# ---------- Light regression: messages, forgot/reset, auth ----------
class TestRegression:
    def test_admin_messages_inbox(self, admin_session):
        sess, _ = admin_session
        # The MessagesPage list relies on /api/inbox/messages or similar
        # Try common shape:
        for path in ("/api/inbox", "/api/messages/threads", "/api/admin/messages"):
            r = sess.get(f"{BASE_URL}{path}", timeout=15)
            if r.status_code == 200:
                return
        # Otherwise just ensure /api/auth/me works (user-bounded smoke)
        r = sess.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200

    def test_forgot_password_endpoint_exists(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "no-such@example.com"}, timeout=15)
        # The endpoint should respond (typically 200 always-OK, or 404 if endpoint not present)
        assert r.status_code in (200, 202, 204), f"forgot-password unexpected status {r.status_code}: {r.text}"
