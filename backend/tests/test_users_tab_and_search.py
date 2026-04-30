"""Regression suite for iter 36 — Users tab + email autocomplete backend.

Covers:
- GET /api/users/search?q= — autocomplete endpoint (2+ char requirement,
  returns active/invited/removed status, includes soft-deleted rows via
  removed_email match).
- GET /api/users/all — comprehensive list with status + last_updated_at.
- POST /users/{uid}/deactivate + /reactivate — lifecycle toggles.
- RBAC: non-admin roles get 403 on all four endpoints.
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "nim@cloudtax.ca"
CPA_EMAIL = "pallavi@cloudtax.ca"
PWD = "CloudTax2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": PWD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def cpa_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": CPA_EMAIL, "password": PWD}, timeout=20)
    if r.status_code != 200:
        pytest.skip("CPA seed user not available")
    if r.json().get("two_factor_required"):
        pytest.skip("CPA has 2FA enabled; skipping RBAC test")
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


class TestUsersSearch:
    def test_short_query_returns_empty(self, admin_token):
        r = requests.get(f"{BASE}/api/users/search?q=n", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert r.json() == []

    def test_2char_query_returns_matches(self, admin_token):
        r = requests.get(f"{BASE}/api/users/search?q=nim", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert any(row["email"] == ADMIN_EMAIL for row in rows)
        # Every row has the expected shape.
        for row in rows:
            assert "id" in row and "email" in row and "status" in row
            assert row["status"] in ("active", "invited", "removed")

    def test_case_insensitive(self, admin_token):
        r = requests.get(f"{BASE}/api/users/search?q=NIM", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        emails = [row["email"] for row in r.json()]
        assert ADMIN_EMAIL in emails

    def test_limit_honoured(self, admin_token):
        r = requests.get(f"{BASE}/api/users/search?q=a&limit=3", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        # q too short → empty
        assert r.json() == []
        r = requests.get(f"{BASE}/api/users/search?q=ca&limit=3", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        assert len(r.json()) <= 3

    def test_soft_deleted_surfaced_by_original_email(self, admin_token):
        # Invite → delete → search for the original email ⇒ must appear with status=removed.
        email = f"search_softdel_{uuid.uuid4().hex[:8]}@example.com"
        r1 = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": email, "name": "Search SoftDel", "role": "CPA"},
            headers=_h(admin_token), timeout=20,
        )
        assert r1.status_code == 200, r1.text
        uid = r1.json()["user_id"]
        requests.delete(f"{BASE}/api/users/{uid}", headers=_h(admin_token), timeout=20)
        r3 = requests.get(f"{BASE}/api/users/search?q={email[:12]}", headers=_h(admin_token), timeout=20)
        assert r3.status_code == 200
        rows = r3.json()
        hit = next((x for x in rows if x["email"] == email), None)
        assert hit is not None, f"soft-deleted email should surface in search: {rows}"
        assert hit["status"] == "removed"
        # Cleanup: final hard delete
        requests.delete(f"{BASE}/api/users/{uid}", headers=_h(admin_token), timeout=20)

    def test_rbac_cpa_blocked(self, cpa_token):
        r = requests.get(f"{BASE}/api/users/search?q=nim", headers=_h(cpa_token), timeout=20)
        assert r.status_code == 403


class TestUsersAll:
    def test_returns_status_and_last_updated(self, admin_token):
        r = requests.get(f"{BASE}/api/users/all", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        for row in rows:
            assert "status" in row
            assert "last_updated_at" in row
            assert row["status"] in ("active", "invited", "removed")
            # password_hash never leaks
            assert "password_hash" not in row
            assert "_id" not in row

    def test_rbac_cpa_blocked(self, cpa_token):
        r = requests.get(f"{BASE}/api/users/all", headers=_h(cpa_token), timeout=20)
        assert r.status_code == 403


class TestDeactivateReactivate:
    def test_full_cycle(self, admin_token):
        email = f"toggle_{uuid.uuid4().hex[:8]}@example.com"
        r1 = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": email, "name": "Toggle Test", "role": "CPA"},
            headers=_h(admin_token), timeout=20,
        )
        assert r1.status_code == 200
        uid = r1.json()["user_id"]

        # Deactivate.
        r2 = requests.post(f"{BASE}/api/users/{uid}/deactivate", headers=_h(admin_token), timeout=20)
        assert r2.status_code == 200, r2.text

        # /users/all now reports status=removed for this id.
        rows = requests.get(f"{BASE}/api/users/all", headers=_h(admin_token), timeout=20).json()
        hit = next((x for x in rows if x["id"] == uid), None)
        assert hit and hit["status"] == "removed"

        # Reactivate.
        r3 = requests.post(f"{BASE}/api/users/{uid}/reactivate", headers=_h(admin_token), timeout=20)
        assert r3.status_code == 200, r3.text

        rows = requests.get(f"{BASE}/api/users/all", headers=_h(admin_token), timeout=20).json()
        hit = next((x for x in rows if x["id"] == uid), None)
        assert hit and hit["status"] in ("active", "invited")

        # Cleanup.
        requests.delete(f"{BASE}/api/users/{uid}", headers=_h(admin_token), timeout=20)

    def test_cannot_deactivate_self(self, admin_token):
        me = requests.get(f"{BASE}/api/auth/me", headers=_h(admin_token), timeout=20).json()
        r = requests.post(f"{BASE}/api/users/{me['id']}/deactivate", headers=_h(admin_token), timeout=20)
        assert r.status_code == 400

    def test_rbac_cpa_blocked(self, cpa_token, admin_token):
        me = requests.get(f"{BASE}/api/auth/me", headers=_h(admin_token), timeout=20).json()
        r1 = requests.post(f"{BASE}/api/users/{me['id']}/deactivate", headers=_h(cpa_token), timeout=20)
        assert r1.status_code == 403
        r2 = requests.post(f"{BASE}/api/users/{me['id']}/reactivate", headers=_h(cpa_token), timeout=20)
        assert r2.status_code == 403
