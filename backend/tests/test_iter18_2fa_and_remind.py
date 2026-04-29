"""Iter18 backend tests:
- 2FA email OTP enable/confirm/login/verify-login/disable round-trip on kaur@
- Per-doc Send reminder (POST /api/documents/{id}/remind) success + 6h cooldown 429
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

KAUR_EMAIL = "kaur@example.com"
KAUR_PWD = "CloudTax2026!"
PALLAVI_EMAIL = "pallavi@cloudtax.ca"
PALLAVI_PWD = "CloudTax2026!"


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    body = r.json()
    return s, body


class TestTwoFactorRoundtrip:
    """Full enable → challenge-on-login → verify → disable, on kaur@."""

    def test_full_2fa_roundtrip(self):
        s, body = _login(KAUR_EMAIL, KAUR_PWD)
        # If somehow enabled already from a previous failed run, disable first
        if body.get("two_factor_required"):
            cid = body["challenge_id"]
            code = body["debug_otp"]
            r = s.post(f"{API}/auth/2fa/verify-login", json={"challenge_id": cid, "code": code})
            assert r.status_code == 200
            r = s.post(f"{API}/auth/2fa/disable", json={"password": KAUR_PWD})
            assert r.status_code == 200
            s, body = _login(KAUR_EMAIL, KAUR_PWD)
        # login shouldn't require 2FA yet
        assert "token" in body and body.get("user"), f"unexpected login body: {body}"

        # enable-init
        r = s.post(f"{API}/auth/2fa/enable-init")
        assert r.status_code == 200, r.text
        init = r.json()
        assert init["ok"] is True
        assert "challenge_id" in init
        cid = init["challenge_id"]
        # sandbox → debug_otp surfaced
        assert init.get("debug_otp"), f"expected debug_otp in sandbox, got {init}"
        code = init["debug_otp"]

        # enable-confirm
        r = s.post(f"{API}/auth/2fa/enable-confirm", json={"challenge_id": cid, "code": code})
        assert r.status_code == 200, r.text
        assert r.json().get("two_factor_enabled") is True

        # fresh login should now return two_factor_required
        r = requests.post(f"{API}/auth/login", json={"email": KAUR_EMAIL, "password": KAUR_PWD})
        assert r.status_code == 200
        b2 = r.json()
        assert b2.get("two_factor_required") is True
        assert "challenge_id" in b2
        assert b2.get("debug_otp"), "sandbox fallback missing debug_otp"

        # verify-login with the challenge — use a new session for cookie
        s2 = requests.Session()
        r = s2.post(f"{API}/auth/2fa/verify-login", json={"challenge_id": b2["challenge_id"], "code": b2["debug_otp"]})
        assert r.status_code == 200, r.text
        assert r.json().get("user", {}).get("email") == KAUR_EMAIL

        # disable with WRONG password → 401
        r = s2.post(f"{API}/auth/2fa/disable", json={"password": "wrong"})
        assert r.status_code == 401, r.text

        # disable with correct password → 200
        r = s2.post(f"{API}/auth/2fa/disable", json={"password": KAUR_PWD})
        assert r.status_code == 200, r.text
        assert r.json().get("two_factor_enabled") is False

        # confirm subsequent login no longer challenges
        r = requests.post(f"{API}/auth/login", json={"email": KAUR_EMAIL, "password": KAUR_PWD})
        assert r.status_code == 200
        b3 = r.json()
        assert "token" in b3 and not b3.get("two_factor_required"), f"2FA not disabled: {b3}"


class TestPerDocReminder:
    """POST /documents/{id}/remind — success + 6h cooldown."""

    def test_remind_single_doc_and_cooldown(self):
        s, _ = _login(PALLAVI_EMAIL, PALLAVI_PWD)
        # Find a PENDING (not uploaded) doc assigned to any engagement
        r = s.get(f"{API}/engagements")
        assert r.status_code == 200
        engs = r.json()
        assert isinstance(engs, list) and engs

        target_doc = None
        chosen_eid = None
        for e in engs:
            eid = e["id"]
            r = s.get(f"{API}/engagements/{eid}/documents")
            if r.status_code != 200:
                continue
            for d in r.json():
                if not d.get("object_key"):
                    target_doc = d
                    chosen_eid = eid
                    break
            if target_doc:
                break
        if not target_doc:
            pytest.skip("No PENDING (unuploaded) doc found across Pallavi's engagements.")

        # Clear any prior reminder_sent_at so cooldown isn't already active
        # Can't access DB here — just accept either 200 or 429 on first shot, then assert cooldown.
        r1 = s.post(f"{API}/documents/{target_doc['id']}/remind")
        assert r1.status_code in (200, 429), r1.text
        if r1.status_code == 200:
            assert "sent_at" in r1.json()
        # Second immediate call must be 429
        r2 = s.post(f"{API}/documents/{target_doc['id']}/remind")
        assert r2.status_code == 429, f"expected cooldown 429, got {r2.status_code}: {r2.text}"
