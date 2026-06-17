"""Admin onboarding (Phase: admin-onboarding).

Onboarding moved from the partner side to CloudTax Admin in Phase 1; the backend
endpoints are ADMIN-gated. These cover the admin-create path and the
no-partner-ownership semantic:

  - ADMIN can create an onboarding draft (POST /engagements/onboarding) -> 200,
    returning an id + a set-password invite_link (the client invite email fires
    server-side as before).
  - Admin-created engagements carry ``partner_advisor_id = None``. There is no
    per-client partner ownership: every partner sees ALL clients (view-only), so
    when ADMIN onboards there is no partner to attribute.
  - PARTNER is view-only: POST onboarding -> 403.
  - The new None-advisor client is still visible to the partner via the
    all-clients list (nothing disappears from any partner view).

Auth uses Bearer tokens (Authorization header) rather than the login cookie —
the backend sets a Secure cookie that a plain-HTTP test client won't echo back.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("nim@cloudtax.ca")


@pytest.fixture(scope="module")
def partner_token():
    return _login("watson@partner.ca")


def _payload():
    suffix = uuid.uuid4().hex[:8]
    return {
        "first_name": "TEST_Admin",
        "last_name": f"Onboard{suffix}",
        "client_email": f"test_admin_onboard_{suffix}@example.com",
        "phone": "+1 (416) 555-0100",
        "province": "ON",
        "corp_name": f"TEST Admin Onboard Corp {suffix}",
        "fiscal_year_end": "2025-12-31",
        "tier": "STANDARD",
    }


class TestAdminOnboardingCreate:
    def test_admin_can_create_onboarding(self, admin_token):
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(admin_token), json=_payload(), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("id"), data
        # A brand-new client gets a set-password invite link (the invite email is
        # dispatched server-side; this asserts the link contract, not delivery).
        assert data.get("invite_link"), "expected an invite_link for the new client"

    def test_admin_created_engagement_has_no_partner_advisor(self, admin_token):
        # No per-client partner ownership: an admin-created engagement must NOT be
        # stamped with the admin's id — partner_advisor_id stays null.
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(admin_token), json=_payload(), timeout=20)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        g = requests.get(f"{BASE}/api/engagements/{eid}", headers=_h(admin_token), timeout=20)
        assert g.status_code == 200, g.text
        eng = g.json()
        assert eng.get("partner_advisor_id") is None, \
            f"admin-created engagement should have partner_advisor_id=None, got {eng.get('partner_advisor_id')!r}"
        assert eng.get("status") == "ONBOARDING"

    def test_create_requires_corp_name(self, admin_token):
        body = _payload()
        body.pop("corp_name")
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(admin_token), json=body, timeout=20)
        assert r.status_code == 400, r.text
        assert "corp_name" in r.text.lower()


class TestPartnerViewOnly:
    def test_partner_cannot_create_onboarding(self, partner_token):
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(partner_token), json=_payload(), timeout=20)
        assert r.status_code == 403, r.text

    def test_partner_sees_admin_created_client(self, admin_token, partner_token):
        # Admin onboards a client (partner_advisor_id=None) ...
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(admin_token), json=_payload(), timeout=20)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        # ... and the partner still sees it in their all-clients (view-only) list,
        # even though it has no partner attributed.
        lst = requests.get(f"{BASE}/api/engagements", headers=_h(partner_token), timeout=20)
        assert lst.status_code == 200, lst.text
        ids = [e.get("id") for e in lst.json()]
        assert eid in ids, "partner should see the admin-created (None-advisor) client"
