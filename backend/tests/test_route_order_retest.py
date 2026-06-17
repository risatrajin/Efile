"""Targeted retest of route ordering fix per iteration_3 review request."""
import os
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def tokens():
    return {
        "admin": login("nim@cloudtax.ca"),
        "cpa": login("pallavi@cloudtax.ca"),
        "ws": login("watson@partner.ca"),
        "client": login("chen@example.com"),
    }


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


# PATCH /users/me must return 200 for Client (was 403 before fix)
def test_patch_users_me_as_client_returns_200(tokens):
    r = requests.patch(
        f"{BASE}/api/users/me",
        json={"notification_prefs": {"email_status_change": True, "email_messages": False}},
        headers=hdr(tokens["client"]),
        timeout=20,
    )
    assert r.status_code == 200, f"got {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("notification_prefs", {}).get("email_status_change") is True
    assert body.get("notification_prefs", {}).get("email_messages") is False


# PATCH /users/me must return 200 for CPA
def test_patch_users_me_as_cpa_returns_200(tokens):
    r = requests.patch(
        f"{BASE}/api/users/me",
        json={"notification_prefs": {"email_messages": True}},
        headers=hdr(tokens["cpa"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text


# PATCH /users/me must return 200 for Partner
def test_patch_users_me_as_ws_returns_200(tokens):
    r = requests.patch(
        f"{BASE}/api/users/me",
        json={"notification_prefs": {"email_status_change": True}},
        headers=hdr(tokens["ws"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text


# GET /users/me/full as Client must return 200 with embedded corporation
def test_get_users_me_full_as_client(tokens):
    r = requests.get(f"{BASE}/api/users/me/full", headers=hdr(tokens["client"]), timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "user" in body or "id" in body or "email" in body
    # corporation should be present (None or dict)
    assert "corporation" in body, f"corporation missing in {body.keys()}"


# PATCH /users/{uid} with arbitrary UUID as Client must still 403
def test_patch_users_uid_as_client_still_forbidden(tokens):
    r = requests.patch(
        f"{BASE}/api/users/00000000-0000-0000-0000-000000000000",
        json={"is_active": False},
        headers=hdr(tokens["client"]),
        timeout=20,
    )
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# PATCH /users/me as path 'me' must NOT be intercepted by /users/{uid} admin route — verify 'me' guard
def test_patch_users_me_literal_as_admin_still_works_via_me(tokens):
    # Even admin hitting /users/me should be treated as self-update, not as uid='me'
    r = requests.patch(
        f"{BASE}/api/users/me",
        json={"notification_prefs": {"email_status_change": True}},
        headers=hdr(tokens["admin"]),
        timeout=20,
    )
    assert r.status_code == 200, r.text


# Defensive 'me' guard: PATCH /users/{uid} where uid='me' as admin should NOT match (returns 404 or routed to /me)
def test_patch_users_me_as_admin_not_double_routed(tokens):
    # Hitting /api/users/me as admin should hit the /me handler (200), not fall through
    r = requests.patch(f"{BASE}/api/users/me", json={}, headers=hdr(tokens["admin"]), timeout=20)
    # empty payload should still return 200 (no fields to update)
    assert r.status_code in (200, 422), r.text
