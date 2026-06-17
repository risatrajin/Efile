"""
Iteration 4 — Admin UI overhaul backend coverage.
New endpoints: GET /users/team, /notifications/unread-count, POST /notifications/{nid}/read,
POST /notifications/read-all, plus PATCH /users/{uid} & /users/invite accepting permissions+display_role.
Regression: messages/unread-count must still work after fn rename.
"""
import os
import time
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("nim@cloudtax.ca")


@pytest.fixture(scope="module")
def cpa_token():
    return _login("pallavi@cloudtax.ca")


@pytest.fixture(scope="module")
def ws_token():
    return _login("watson@partner.ca")


@pytest.fixture(scope="module")
def client_token():
    return _login("chen@example.com")


def H(t):
    return {"Authorization": f"Bearer {t}"}


# -------------------- GET /api/users/team --------------------
class TestUsersTeam:
    def test_team_excludes_clients_and_no_id_leak(self, admin_token):
        r = requests.get(f"{BASE}/api/users/team", headers=H(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        team = r.json()
        assert isinstance(team, list)
        assert len(team) >= 3
        roles = {m.get("role") for m in team}
        assert "CLIENT" not in roles, f"team must exclude CLIENT, got {roles}"
        assert {"ADMIN"} & roles
        for m in team:
            assert "_id" not in m
            assert "id" in m and "email" in m and "role" in m
            # permissions hydrated as dict
            assert "permissions" in m and isinstance(m["permissions"], dict)
            # display_role hydrated (string)
            assert "display_role" in m

    def test_team_admin_only(self, cpa_token, client_token):
        for tok in (cpa_token, client_token):
            r = requests.get(f"{BASE}/api/users/team", headers=H(tok), timeout=20)
            assert r.status_code in (401, 403), f"non-admin got {r.status_code}"


# -------------------- PATCH /api/users/{uid} permissions+display_role --------------------
class TestPatchUserPermissions:
    def test_patch_permissions_and_display_role_persist(self, admin_token):
        # Pick a non-admin team member
        team = requests.get(f"{BASE}/api/users/team", headers=H(admin_token), timeout=20).json()
        target = next((m for m in team if m["role"] != "ADMIN"), None)
        assert target, "no non-admin team member"
        uid = target["id"]
        new_perms = dict(target.get("permissions") or {})
        # flip a known-ish perm to True
        new_perms["view_documents"] = True
        new_perms["edit_documents"] = False
        r = requests.patch(
            f"{BASE}/api/users/{uid}",
            json={"permissions": new_perms, "display_role": "Manager"},
            headers=H(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("display_role") == "Manager"
        assert body.get("permissions", {}).get("view_documents") is True
        assert body.get("permissions", {}).get("edit_documents") is False
        # GET via team listing to confirm persistence
        team2 = requests.get(f"{BASE}/api/users/team", headers=H(admin_token), timeout=20).json()
        m = next((x for x in team2 if x["id"] == uid), None)
        assert m and m["display_role"] == "Manager"
        assert m["permissions"].get("view_documents") is True


# -------------------- Notifications --------------------
class TestNotifications:
    def test_unread_count_shape(self, admin_token):
        r = requests.get(f"{BASE}/api/notifications/unread-count", headers=H(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data
        assert isinstance(data["count"], int)
        assert data["count"] >= 0

    def test_mark_single_read_decrements(self, admin_token):
        before = requests.get(f"{BASE}/api/notifications/unread-count", headers=H(admin_token), timeout=20).json()["count"]
        if before == 0:
            pytest.skip("no unread notifications to mark")
        # find a notification id
        listr = requests.get(f"{BASE}/api/notifications", headers=H(admin_token), timeout=20)
        assert listr.status_code == 200
        items = listr.json()
        unread = next((n for n in items if not n.get("is_read")), None)
        if not unread:
            pytest.skip("no unread item in list")
        nid = unread["id"]
        r = requests.post(f"{BASE}/api/notifications/{nid}/read", headers=H(admin_token), timeout=20)
        assert r.status_code in (200, 204)
        after = requests.get(f"{BASE}/api/notifications/unread-count", headers=H(admin_token), timeout=20).json()["count"]
        assert after == before - 1, f"expected {before-1}, got {after}"

    def test_mark_all_read_zeroes_count(self, admin_token):
        r = requests.post(f"{BASE}/api/notifications/read-all", headers=H(admin_token), timeout=20)
        assert r.status_code in (200, 204), r.text
        after = requests.get(f"{BASE}/api/notifications/unread-count", headers=H(admin_token), timeout=20).json()["count"]
        assert after == 0


# -------------------- POST /api/users/invite with permissions+display_role --------------------
class TestInviteWithPermissions:
    def test_invite_persists_perms_and_display_role(self, admin_token):
        email = f"TEST_invite_{int(time.time())}@example.com"
        perms = {"view_documents": True, "edit_documents": True, "manage_team": False}
        r = requests.post(
            f"{BASE}/api/users/invite",
            json={
                "email": email,
                "name": "TEST Invitee",
                "role": "CPA",
                "display_role": "Manager",
                "permissions": perms,
            },
            headers=H(admin_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user_id" in data
        assert "invite_link" in data
        # confirm via /users/team (backend lowercases emails on store)
        team = requests.get(f"{BASE}/api/users/team", headers=H(admin_token), timeout=20).json()
        m = next((x for x in team if x["email"].lower() == email.lower()), None)
        assert m, "invited user missing from team"
        assert m["display_role"] == "Manager"
        assert m["permissions"].get("view_documents") is True
        assert m["permissions"].get("edit_documents") is True
        assert m["permissions"].get("manage_team") is False


# -------------------- Regression: messages/unread-count must still resolve --------------------
class TestMessagesUnreadCountRegression:
    def test_messages_unread_count_still_works(self, client_token):
        engs = requests.get(f"{BASE}/api/engagements", headers=H(client_token), timeout=20).json()
        if not engs:
            pytest.skip("no engagement")
        eid = engs[0]["id"]
        r = requests.get(
            f"{BASE}/api/engagements/{eid}/messages/unread-count",
            headers=H(client_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data or "unread" in data


# -------------------- PATCH /users/me still works for non-admin --------------------
class TestPatchMeRouteOrder:
    def test_patch_me_client_works(self, client_token):
        r = requests.patch(
            f"{BASE}/api/users/me",
            json={"notification_prefs": {"email_messages": True}},
            headers=H(client_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
