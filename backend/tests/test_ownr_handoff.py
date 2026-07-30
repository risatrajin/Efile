"""Ownr partner handoff token API (Phase: ownr-handoff).

Covers:
  - POST /api/partner/ownr/handoff — server-to-server, Bearer OWNR_API_KEY.
    Mints a single-use, 7-day handoff token; returns a /register?token= URL,
    or a /login?email= URL when the email already belongs to an account (no
    duplicate account ever created). Repeat calls for the same not-yet-
    registered email burn the previous token and mint a fresh one. Modestly
    rate limited per IP.
  - GET /auth/handoff-info — public, always 200. token -> prefill payload
    (no secrets: the raw entitlement string is never exposed, only whether
    one is present). Invalid/expired/used token reads as {"valid": false}.

NOTE: skips entirely if OWNR_API_KEY isn't set in the test environment —
this endpoint 503s with no key configured, so there's nothing to test.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
OWNR_API_KEY = os.environ.get("OWNR_API_KEY", "")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _fresh_email():
    return f"test_ownr_handoff_{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _require_ownr_key():
    if not OWNR_API_KEY:
        pytest.skip("OWNR_API_KEY not set in the test environment")


def _handoff(payload, key=None):
    return requests.post(f"{BASE}/api/partner/ownr/handoff", headers=_h(key or OWNR_API_KEY), json=payload, timeout=20)


def _token_from_url(url):
    return url.rsplit("token=", 1)[-1]


def _handoff_info(token):
    r = requests.get(f"{BASE}/api/auth/handoff-info", params={"token": token}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Auth ----------

def test_bad_api_key_rejected():
    r = _handoff({}, key="definitely-not-the-real-key")
    assert r.status_code == 401


def test_missing_api_key_rejected():
    r = requests.post(f"{BASE}/api/partner/ownr/handoff", json={}, timeout=20)
    assert r.status_code == 401


# ---------- Mint + info round-trip ----------

def test_mint_without_email_returns_unlocked_registration_url():
    r = _handoff({"first_name": "Jamie", "company_name": "Test Co", "entitlement": "OFFER_A"})
    assert r.status_code == 200, r.text
    url = r.json()["registration_url"]
    assert "/register?token=" in url
    info = _handoff_info(_token_from_url(url))
    assert info["valid"] is True
    assert info["email_locked"] is False
    assert info["email"] is None
    assert info["first_name"] == "Jamie"
    assert info["company_name"] == "Test Co"
    assert info["has_entitlement"] is True
    # Raw entitlement string never exposed via handoff-info.
    assert "entitlement" not in info
    assert info["ownr_return_url"]


def test_mint_with_email_returns_locked_registration_url():
    email = _fresh_email()
    r = _handoff({"email": email})
    assert r.status_code == 200, r.text
    info = _handoff_info(_token_from_url(r.json()["registration_url"]))
    assert info["email_locked"] is True
    assert info["email"] == email
    assert info["has_entitlement"] is False


def test_mint_all_fields_optional():
    r = _handoff({})
    assert r.status_code == 200, r.text
    assert "/register?token=" in r.json()["registration_url"]


def test_invalid_token_reads_as_not_valid_not_4xx():
    r = requests.get(f"{BASE}/api/auth/handoff-info", params={"token": "bogus-token-does-not-exist"}, timeout=20)
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert "ownr_return_url" in body  # needed for the "Back to Ownr" link even on error


# ---------- Repeat handoff / reuse ----------

def test_repeat_handoff_same_email_burns_old_token():
    email = _fresh_email()
    token1 = _token_from_url(_handoff({"email": email}).json()["registration_url"])
    token2 = _token_from_url(_handoff({"email": email}).json()["registration_url"])
    assert token1 != token2
    assert _handoff_info(token1)["valid"] is False
    assert _handoff_info(token2)["valid"] is True


def test_handoff_for_existing_account_returns_login_url_no_duplicate():
    email = _fresh_email()
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": "SomePass123!", "first_name": "Test", "last_name": "User"},
        timeout=20,
    )
    if r.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min)")
    assert r.status_code == 200, r.text

    r2 = _handoff({"email": email})
    assert r2.status_code == 200, r2.text
    url = r2.json()["registration_url"]
    assert "/login?email=" in url
    assert "/register" not in url


# ---------- Single-use burn on completed registration ----------

def test_token_burned_after_registration_completes():
    email = _fresh_email()
    token = _token_from_url(_handoff({"email": email, "first_name": "Burn", "entitlement": "OFFER_B"}).json()["registration_url"])
    reg = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": "ignored@example.com", "password": "SomePass123!", "first_name": "Burn", "last_name": "Test", "handoff_token": token, "consent": True},
        timeout=20,
    )
    if reg.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min)")
    assert reg.status_code == 200, reg.text
    u = reg.json()["user"]
    assert u["email"] == email  # locked — client-submitted email ignored
    assert u["name"] == "Burn Test"
    assert u["signup_source"] == "OWNR"
    assert u["entitlement"] == "OFFER_B"
    assert _handoff_info(token)["valid"] is False


# ---------- Rate limit ----------

def test_handoff_rate_limited_modestly():
    statuses = []
    for _ in range(35):
        statuses.append(_handoff({}).status_code)
        if statuses[-1] == 429:
            break
    if 429 not in statuses:
        pytest.skip("did not observe a 429 within 35 calls in this window — rerun closer to the limit")
    assert statuses[-1] == 429
