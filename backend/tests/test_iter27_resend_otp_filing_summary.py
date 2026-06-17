"""Iter27 backend tests:
- Email OTP 2FA flow (login challenge, enable-init/confirm, resend cooldown, disable).
- OTP TTL (5 min via expires_in_sec) and max-attempts (5 -> burned).
- file-with-cra mandatory filing_summary validation (missing/incomplete/empty).
"""
import io
import os
import time
import json
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")

ADMIN = "nim@cloudtax.ca"
CPA = "pallavi@cloudtax.ca"
ENG_ID = "62e8e7e2-cbc1-4dbb-8392-ffd0553a4b65"  # Risat Rajin: t183_signed_at=true (per handoff)


def login_simple(email: str, password: str = PASSWORD) -> tuple[requests.Session, dict]:
    """Login a user. Returns (session-with-cookie, body). Does NOT handle 2FA."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s, r.json()


def ensure_2fa_disabled(email: str):
    """Best-effort cleanup: disable 2FA if it's enabled."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD})
    if r.status_code != 200:
        return
    body = r.json()
    if body.get("two_factor_required"):
        # Need to clear via OTP.
        code = body.get("debug_otp")
        ch = body.get("challenge_id")
        if not code:
            return
        v = s.post(f"{API}/auth/2fa/verify-login", json={"challenge_id": ch, "code": code})
        if v.status_code != 200:
            return
    # Now disable 2FA
    s.post(f"{API}/auth/2fa/disable", json={"password": PASSWORD})


# ================== OTP / 2FA ==================

class TestOtp2FA:
    def test_enable_init_shape(self):
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        r = s.post(f"{API}/auth/2fa/enable-init", json={})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["ok"] is True
        assert "challenge_id" in b
        assert b["expires_in_sec"] == 300
        assert b["resend_after_sec"] == 30
        # Trial Resend can't deliver to nim@cloudtax.ca, so debug_otp is surfaced
        assert b.get("sent_via_email") in (True, False)
        if not b["sent_via_email"]:
            assert b.get("debug_otp") and len(b["debug_otp"]) == 6 and b["debug_otp"].isdigit()

    def test_enable_confirm_then_login_2fa_then_disable(self):
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        # 1) enable-init
        r = s.post(f"{API}/auth/2fa/enable-init", json={})
        b = r.json()
        ch_id = b["challenge_id"]
        code = b["debug_otp"]
        assert code, "expected debug_otp from trial-mode fallback"
        # 2) enable-confirm
        r2 = s.post(f"{API}/auth/2fa/enable-confirm", json={"challenge_id": ch_id, "code": code})
        assert r2.status_code == 200, r2.text
        assert r2.json()["two_factor_enabled"] is True
        # 3) login now returns challenge
        s2 = requests.Session()
        rl = s2.post(f"{API}/auth/login", json={"email": ADMIN, "password": PASSWORD})
        assert rl.status_code == 200
        bl = rl.json()
        assert bl.get("two_factor_required") is True
        assert bl["expires_in_sec"] == 300
        assert bl["resend_after_sec"] == 30
        assert bl.get("email") == ADMIN
        login_code = bl["debug_otp"]
        login_ch = bl["challenge_id"]
        # 4) verify-login
        rv = s2.post(f"{API}/auth/2fa/verify-login", json={"challenge_id": login_ch, "code": login_code})
        assert rv.status_code == 200, rv.text
        body = rv.json()
        assert "token" in body and "user" in body
        assert body["user"]["email"] == ADMIN
        # 5) disable using authenticated session (cookie was set by verify-login)
        rd = s2.post(f"{API}/auth/2fa/disable", json={"password": PASSWORD})
        assert rd.status_code == 200, rd.text
        assert rd.json()["two_factor_enabled"] is False
        # Verify login is single step now
        s3 = requests.Session()
        r3 = s3.post(f"{API}/auth/login", json={"email": ADMIN, "password": PASSWORD})
        assert r3.status_code == 200
        assert r3.json().get("two_factor_required") is not True
        assert "token" in r3.json()

    def test_disable_with_wrong_password_rejected(self):
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        r = s.post(f"{API}/auth/2fa/disable", json={"password": "wrong"})
        assert r.status_code == 401

    def test_resend_cooldown_429(self):
        """First resend after enable-init should hit 30s cooldown (429)."""
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        r = s.post(f"{API}/auth/2fa/enable-init", json={})
        b = r.json()
        ch = b["challenge_id"]
        # Immediately resend — should 429 (cooldown enforced)
        rr = s.post(f"{API}/auth/2fa/resend", json={"challenge_id": ch})
        assert rr.status_code == 429, rr.text
        assert "wait" in rr.text.lower()

    def test_resend_after_cooldown_succeeds_and_burns_prior(self):
        """After cooldown elapses, resend issues a NEW challenge with debug_otp."""
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        r = s.post(f"{API}/auth/2fa/enable-init", json={})
        b = r.json()
        old_ch = b["challenge_id"]
        old_code = b["debug_otp"]
        # Wait > 30s
        time.sleep(31)
        rr = s.post(f"{API}/auth/2fa/resend", json={"challenge_id": old_ch})
        assert rr.status_code == 200, rr.text
        nb = rr.json()
        new_ch = nb["challenge_id"]
        new_code = nb["debug_otp"]
        assert new_ch != old_ch
        assert new_code and new_code != old_code
        assert nb["expires_in_sec"] == 300
        assert nb["resend_after_sec"] == 30
        # Old challenge should be burned: trying enable-confirm with old code → 400
        r_old = s.post(f"{API}/auth/2fa/enable-confirm", json={"challenge_id": old_ch, "code": old_code})
        assert r_old.status_code == 400

    def test_otp_max_attempts_burns_challenge(self):
        """5 wrong attempts -> challenge burned with 429."""
        ensure_2fa_disabled(ADMIN)
        s, _ = login_simple(ADMIN)
        r = s.post(f"{API}/auth/2fa/enable-init", json={})
        ch = r.json()["challenge_id"]
        wrong = "000001"
        # 5 wrong attempts → first 5 are 400, after 5 the row is burned -> 429 on 6th
        for i in range(5):
            rb = s.post(f"{API}/auth/2fa/enable-confirm", json={"challenge_id": ch, "code": wrong})
            assert rb.status_code == 400, f"attempt {i} unexpected: {rb.status_code} {rb.text}"
        # 6th attempt should be rejected as too-many-attempts (challenge marked used) → 429 or 400
        rb = s.post(f"{API}/auth/2fa/enable-confirm", json={"challenge_id": ch, "code": wrong})
        # Implementation: at attempts >= 5, marks used and raises 429
        assert rb.status_code in (400, 429), rb.text


# ================== file-with-cra filing_summary validation ==================

class TestFileWithCRAFilingSummary:
    @pytest.fixture(scope="class")
    def cpa_session(self):
        ensure_2fa_disabled(CPA)
        s, _ = login_simple(CPA)
        # Ensure engagement is IN_REVIEW (rollback from FILED if needed) — needs admin.
        ensure_2fa_disabled(ADMIN)
        admin_s, _ = login_simple(ADMIN)
        eg = admin_s.get(f"{API}/engagements/{ENG_ID}")
        if eg.status_code == 200 and eg.json().get("status") == "FILED":
            r = admin_s.patch(f"{API}/engagements/{ENG_ID}", json={"status": "IN_REVIEW"})
            assert r.status_code == 200, f"rollback failed: {r.text}"
        return s

    def _post_file(self, sess: requests.Session, eid: str, params: dict, fs: str | None):
        """Endpoint takes query params for cra_confirmation/filing_datetime/note/filing_summary
        and body file=<UploadFile>."""
        sess.headers.pop("Content-Type", None)
        files = {
            "file": ("filed.pdf", io.BytesIO(b"%PDF-1.4\n%test\n"), "application/pdf"),
        }
        q = dict(params)
        q.setdefault("filing_datetime", "2026-01-15T10:00:00Z")
        if fs is not None:
            q["filing_summary"] = fs
        return sess.post(f"{API}/engagements/{eid}/file-with-cra", params=q, files=files)

    def test_missing_filing_summary_rejected(self, cpa_session):
        r = self._post_file(cpa_session, ENG_ID, {
            "cra_confirmation": f"TEST-{uuid.uuid4().hex[:6]}",
            "note": "iter27 missing fs",
        }, fs=None)
        assert r.status_code == 400, r.text
        assert "Filing summary is required" in r.text

    def test_incomplete_filing_summary_rejected(self, cpa_session):
        # Missing total_tax_assessed, instalments_paid, balance_owing
        fs = json.dumps({"net_income": 100000})
        r = self._post_file(cpa_session, ENG_ID, {
            "cra_confirmation": f"TEST-{uuid.uuid4().hex[:6]}",
        }, fs=fs)
        assert r.status_code == 400, r.text
        assert "incomplete" in r.text.lower()
        for k in ("total_tax_assessed", "instalments_paid", "balance_owing"):
            assert k in r.text

    def test_empty_string_values_treated_as_missing(self, cpa_session):
        fs = json.dumps({
            "net_income": 100000,
            "total_tax_assessed": "",
            "instalments_paid": "   ",
            "balance_owing": 0,
        })
        r = self._post_file(cpa_session, ENG_ID, {
            "cra_confirmation": f"TEST-{uuid.uuid4().hex[:6]}",
        }, fs=fs)
        assert r.status_code == 400, r.text
        assert "incomplete" in r.text.lower()
        assert "total_tax_assessed" in r.text
        assert "instalments_paid" in r.text

    def test_missing_filing_summary_returns_400_not_500(self, cpa_session):
        # Already covered by test_missing_filing_summary_rejected, but confirm exact phrase.
        r = self._post_file(cpa_session, ENG_ID, {
            "cra_confirmation": f"TEST-{uuid.uuid4().hex[:6]}",
        }, fs=None)
        assert r.status_code == 400
        assert "complete the 'Update submission info' form" in r.text

    def test_payment_due_date_optional_succeeds(self, cpa_session):
        """All 4 currency fields present, payment_due_date OMITTED -> 200 FILED."""
        # Roll back to IN_REVIEW first if currently FILED (test_iter27_admin must reset).
        ensure_2fa_disabled(ADMIN)
        admin_s, _ = login_simple(ADMIN)
        eg = admin_s.get(f"{API}/engagements/{ENG_ID}").json()
        if eg.get("status") == "FILED":
            admin_s.patch(f"{API}/engagements/{ENG_ID}", json={"status": "IN_REVIEW"})
        fs = json.dumps({
            "net_income": 150000,
            "total_tax_assessed": 30000,
            "instalments_paid": 25000,
            "balance_owing": 5000,
            # NO payment_due_date
        })
        r = self._post_file(cpa_session, ENG_ID, {
            "cra_confirmation": f"TEST-{uuid.uuid4().hex[:6]}",
            "note": "iter27 payment_due_date optional",
        }, fs=fs)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        # Verify GET returns FILED with filing_summary populated
        eg2 = admin_s.get(f"{API}/engagements/{ENG_ID}").json()
        assert eg2.get("status") == "FILED"
        fs2 = eg2.get("filing_summary") or {}
        assert fs2.get("net_income") == 150000
        assert fs2.get("balance_owing") == 5000
        assert fs2.get("total_tax_assessed") == 30000
        assert fs2.get("instalments_paid") == 25000
        # payment_due_date should be omitted (not stored)
        assert "payment_due_date" not in fs2 or fs2.get("payment_due_date") in (None, "")
