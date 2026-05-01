"""Iter 46: 'I'll upload later' — deferred documents remain visible on reload.

Verifies the backend contract relied on by the Client Portal: the GET
endpoint returns a non-empty ``deferred_at`` for any doc the client deferred,
and the row remains in the list (not filtered out).
"""
import os
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")

# This client (drbala) already has 3 deferred docs in the pilot DB — seeded
# by the previous session. Perfect for a read-only regression.
CLIENT_EMAIL = "drbala@yopmail.com"
CLIENT_PASSWORD = "CloudTax2026!"


def test_client_docs_list_returns_deferred_at_for_pending_rows():
    tok_r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": CLIENT_EMAIL, "password": CLIENT_PASSWORD},
        verify=False, timeout=10,
    )
    if tok_r.status_code != 200 or "token" not in tok_r.json():
        import pytest
        pytest.skip(f"drbala login unavailable: {tok_r.status_code}")
    tok = tok_r.json()["token"]

    engs = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    ).json()
    assert engs, "expected at least one engagement for drbala"
    eid = engs[0]["id"]

    docs = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    ).json()
    assert isinstance(docs, list)
    # At least one doc with deferred_at set
    deferred = [d for d in docs if d.get("deferred_at")]
    assert len(deferred) >= 1, "Expected deferred drbala docs from prior session"
    for d in deferred:
        # Crucial: deferred rows must still come back from the API unchanged,
        # with status=PENDING (NOT marked completed).
        assert d["status"] == "PENDING", d
        assert d.get("deferred_at")
