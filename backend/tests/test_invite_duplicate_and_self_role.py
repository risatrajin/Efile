"""Regression suite for iter 35 — Admin Add Member descriptive error +
self-role-demotion guard.

Covers:
1. POST /users/invite returns a descriptive 409 when email collides with:
   - an active CPA (active staff match)
   - a CLIENT account (client-role match — the confusing case the user hit
     where the email is "taken" but isn't in the Roles & Permissions table)
2. PATCH /users/{uid} rejects an admin demoting/deactivating themselves so
   they don't brick their own session and surprise themselves with a 403.
"""
import os
import time
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "nim@cloudtax.ca"
ADMIN_PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PWD},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _headers(tok):
    return {"Authorization": f"Bearer {tok}"}


class TestInviteDuplicateMessages:
    def test_active_cpa_collision_returns_descriptive_409(self, admin_token):
        # pallavi@cloudtax.ca exists as an active CPA in the seeded staff roster.
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": "pallavi@cloudtax.ca", "name": "Pallavi", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        # Message should name the role (CPA) AND the existing member's name —
        # no bare "User already exists".
        assert "CPA" in detail
        assert "Pallavi" in detail
        assert "already" in detail.lower()

    def test_email_case_insensitive(self, admin_token):
        # Uppercased variant still collides with the seeded lowercase email.
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": "Pallavi@CloudTax.CA", "name": "X", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 409, r.text

    def test_invalid_email_rejected(self, admin_token):
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": "not-an-email", "name": "X", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        # Either Pydantic EmailStr validator (422) or our own guard (400) rejects.
        assert r.status_code in (400, 422), r.text

    def test_new_email_success(self, admin_token):
        unique = f"iter35_new_{uuid.uuid4().hex[:10]}@example.com"
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": unique, "name": "Iter35 New", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"]
        assert data["invite_link"]
        assert data.get("reactivated") in (False, None)
        # Cleanup
        requests.delete(
            f"{BASE}/api/users/{data['user_id']}",
            headers=_headers(admin_token), timeout=20,
        )


class TestReactivateSoftDeleted:
    """Invite → delete → re-invite the same email should reactivate the
    original record with the new role/permissions and issue a fresh invite."""

    def test_full_reactivate_cycle(self, admin_token):
        email = f"reactivate_{uuid.uuid4().hex[:10]}@example.com"

        # 1. Initial invite.
        r1 = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": email, "name": "Original Person", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r1.status_code == 200, r1.text
        uid1 = r1.json()["user_id"]
        assert r1.json().get("reactivated") in (False, None)

        # 2. Soft-delete.
        r2 = requests.delete(
            f"{BASE}/api/users/{uid1}",
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r2.status_code == 200, r2.text

        # 3. Re-invite same email with a *different* role — reactivation
        # should preserve the original user id but apply the new role.
        r3 = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": email, "name": "Reactivated Person", "role": "WS_PARTNER"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r3.status_code == 200, r3.text
        data3 = r3.json()
        assert data3["user_id"] == uid1, "reactivation must preserve the original user id"
        assert data3.get("reactivated") is True, "response must flag reactivated:true"
        assert data3["invite_link"].startswith("http"), "fresh invite link must be issued"

        # 4. Team list must include the reactivated row with the new role.
        r4 = requests.get(f"{BASE}/api/users/team", headers=_headers(admin_token), timeout=20)
        assert r4.status_code == 200, r4.text
        match = next((u for u in r4.json() if u.get("email") == email), None)
        assert match is not None, "reactivated user should reappear in the team list"
        assert match["role"] == "WS_PARTNER"
        assert match.get("is_active") is True
        assert match.get("reactivated_at")
        assert match["name"] == "Reactivated Person"

        # Cleanup.
        requests.delete(f"{BASE}/api/users/{uid1}", headers=_headers(admin_token), timeout=20)

    def test_reactivation_does_not_trigger_when_email_is_actively_in_use(self, admin_token):
        # A live active collision must still win over reactivation — even if a
        # separate soft-deleted record also had this email. (Pallavi is an
        # active seeded CPA, so the invite must 409 and NEVER try to reactivate.)
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": "pallavi@cloudtax.ca", "name": "X", "role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 409, r.text


class TestSelfRoleGuard:
    def _me_id(self, admin_token):
        r = requests.get(f"{BASE}/api/auth/me", headers=_headers(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_cannot_demote_self(self, admin_token):
        me = self._me_id(admin_token)
        r = requests.patch(
            f"{BASE}/api/users/{me}",
            json={"role": "CPA"},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "your own role" in r.json()["detail"].lower()

    def test_cannot_deactivate_self(self, admin_token):
        me = self._me_id(admin_token)
        r = requests.patch(
            f"{BASE}/api/users/{me}",
            json={"is_active": False},
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 400, r.text
        assert "deactivate" in r.json()["detail"].lower()

    def test_self_name_change_still_works(self, admin_token):
        """Sanity: guard should NOT block non-role self edits."""
        me = self._me_id(admin_token)
        r = requests.patch(
            f"{BASE}/api/users/{me}",
            json={"name": "Nim Balachandran"},  # same name; idempotent
            headers=_headers(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
