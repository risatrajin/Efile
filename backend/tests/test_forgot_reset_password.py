"""Backend tests for Wave B forgot/reset password endpoints (Iteration 14)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback only in test execution to avoid hard crash if env missing.
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@cloudtax.ca"
ADMIN_PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")
NON_ADMIN_EMAIL = "kaur@example.com"  # REFERRED, low impact
NON_ADMIN_PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- forgot-password endpoint -----
class TestForgotPassword:
    def test_valid_email_returns_link(self, session):
        r = session.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert "reset_link" in data
        assert data["reset_link"] is not None
        assert "/reset-password?token=" in data["reset_link"]
        assert "sent_via_email" in data
        assert isinstance(data["sent_via_email"], bool)

    def test_unknown_email_returns_no_link(self, session):
        r = session.post(
            f"{BASE_URL}/api/auth/forgot-password",
            json={"email": "nobody-xyz-12345@nowhere.example"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data.get("reset_link") is None
        assert data.get("sent_via_email") is False

    def test_email_case_insensitive(self, session):
        r = session.post(
            f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL.upper()}
        )
        assert r.status_code == 200
        assert r.json().get("reset_link") is not None


# ----- reset-password full cycle (uses kaur to keep admin pwd intact) -----
class TestResetPasswordCycle:
    def test_full_reset_then_login_then_revert(self, session):
        # 1) request reset for non-admin user
        r1 = session.post(
            f"{BASE_URL}/api/auth/forgot-password", json={"email": NON_ADMIN_EMAIL}
        )
        assert r1.status_code == 200
        link = r1.json().get("reset_link")
        assert link
        token = link.split("token=")[-1]

        # 2) reset to a new password
        new_pwd = "TempPass2026!"
        r2 = session.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token, "password": new_pwd},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("ok") is True

        # 3) reuse same token must fail (400)
        r3 = session.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token, "password": new_pwd},
        )
        assert r3.status_code == 400

        # 4) login with new password
        login = requests.Session()
        login.headers.update({"Content-Type": "application/json"})
        r4 = login.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": NON_ADMIN_EMAIL, "password": new_pwd},
        )
        assert r4.status_code == 200, r4.text
        body = r4.json()
        assert body.get("user", {}).get("email") == NON_ADMIN_EMAIL

        # 5) revert: ask for another reset, set back to original pwd
        r5 = session.post(
            f"{BASE_URL}/api/auth/forgot-password", json={"email": NON_ADMIN_EMAIL}
        )
        link2 = r5.json().get("reset_link")
        token2 = link2.split("token=")[-1]
        r6 = session.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token2, "password": NON_ADMIN_PWD},
        )
        assert r6.status_code == 200

        # 6) verify revert works
        r7 = login.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": NON_ADMIN_EMAIL, "password": NON_ADMIN_PWD},
        )
        assert r7.status_code == 200

    def test_invalid_token_rejected(self, session):
        r = session.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": "garbage-token-does-not-exist", "password": "WhateverPwd1!"},
        )
        assert r.status_code == 400

    def test_short_password_rejected(self, session):
        r1 = session.post(
            f"{BASE_URL}/api/auth/forgot-password", json={"email": NON_ADMIN_EMAIL}
        )
        token = r1.json()["reset_link"].split("token=")[-1]
        r2 = session.post(
            f"{BASE_URL}/api/auth/reset-password",
            json={"token": token, "password": "short"},
        )
        # Pydantic min_length=8 → 422
        assert r2.status_code in (400, 422)
