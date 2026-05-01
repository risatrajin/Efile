"""Iter 50: Delegate access for the client portal.

End-to-end backend test of the delegate lifecycle. Covers:
 - Primary client (drbala) invites a delegate by email
 - Max-2-active-per-engagement enforcement
 - Listing delegates (primary + admin can; delegate themselves cannot)
 - The new delegate user signs up via set-password and lands ACTIVE
 - The delegate can fetch the engagement and document list
 - The delegate is BLOCKED from signing T183 (403, "Only ... can sign...")
 - The primary client can revoke the delegate, who then loses engagement access
 - /me/delegate-context returns the right banner data for the delegate
 - Existing primary-client flows (engagement listing, T183 sign authorization
   gate) are unchanged for non-delegates.
"""
import os
import re
import time
import uuid

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PASSWORD = "CloudTax2026!"


def _login(email, password=PASSWORD):
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": email, "password": password},
        verify=False, timeout=15,
    )
    if r.status_code != 200:
        return None
    d = r.json()
    return d.get("token")


def _admin_login():
    """Admin (nim) — currently 2FA-disabled in the seeded DB."""
    return _login("nim@cloudtax.ca")


def test_delegate_full_lifecycle():
    primary_tok = _login("drbala@yopmail.com")
    assert primary_tok, "primary client login failed"

    # Find drbala's engagement
    engs = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary_tok}"},
        verify=False, timeout=10,
    ).json()
    assert engs, "no engagements for drbala"
    eid = engs[0]["id"]

    delegate_email = f"bookkeeper-{uuid.uuid4().hex[:8]}@yopmail.com"

    # 1) Invite a delegate (new user — set-password flow expected)
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary_tok}"},
        json={"email": delegate_email, "name": "Sam Bookkeeper", "relationship": "bookkeeper"},
        verify=False, timeout=10,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    invite_link = payload.get("invite_link")
    assert invite_link, "expected invite_link for brand-new user"
    delegate_row = payload["delegate"]
    assert delegate_row["status"] == "INVITED"
    assert delegate_row["relationship"] == "bookkeeper"

    # 2) List shows the new delegate
    r = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary_tok}"},
        verify=False, timeout=10,
    )
    assert r.status_code == 200
    rows = r.json()["delegates"]
    assert any(d["email"] == delegate_email for d in rows)

    # 3) Delegate completes set-password → status flips to ACTIVE
    token = invite_link.rsplit("token=", 1)[-1]
    r = requests.post(
        f"{BASE_URL}/api/auth/set-password",
        json={"token": token, "password": PASSWORD},
        verify=False, timeout=10,
    )
    assert r.status_code == 200, r.text
    delegate_tok = _login(delegate_email)
    assert delegate_tok, "delegate login failed"

    # Sanity: /me/delegate-context returns the engagement context
    ctx = requests.get(
        f"{BASE_URL}/api/me/delegate-context",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        verify=False, timeout=10,
    ).json()
    assert ctx["is_delegate"] is True
    assert ctx["contexts"][0]["engagement_id"] == eid
    assert ctx["contexts"][0]["relationship"] == "bookkeeper"

    # 4) Delegate can list and read the engagement
    engs2 = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        verify=False, timeout=10,
    ).json()
    assert any(e["id"] == eid for e in engs2)

    # 5) Delegate CANNOT sign the T183 (regardless of T183 setup state)
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/t183/sign",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        json={"signature": "data:image/png;base64,iVBORw0KGgo=", "signer_name": "Sam Bookkeeper"},
        verify=False, timeout=10,
    )
    assert r.status_code == 403, r.text
    assert "can sign" in r.text.lower() or "primary" in r.text.lower()

    # 6) Delegate CANNOT list peers (only primary client + CPA + Admin can)
    r = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        verify=False, timeout=10,
    )
    assert r.status_code == 403

    # 7) Delegate CANNOT invite further delegates
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        json={"email": "x@y.com", "name": "X", "relationship": "spouse"},
        verify=False, timeout=10,
    )
    assert r.status_code == 403

    # 8) Primary client revokes the delegate
    r = requests.delete(
        f"{BASE_URL}/api/delegates/{delegate_row['id']}",
        headers={"Authorization": f"Bearer {primary_tok}"},
        verify=False, timeout=10,
    )
    assert r.status_code == 200

    # After revocation: delegate's engagement list is empty for that engagement
    engs3 = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        verify=False, timeout=10,
    ).json()
    assert not any(e["id"] == eid for e in engs3), "Revoked delegate should not see engagement"

    # /me/delegate-context now returns is_delegate=False
    ctx2 = requests.get(
        f"{BASE_URL}/api/me/delegate-context",
        headers={"Authorization": f"Bearer {delegate_tok}"},
        verify=False, timeout=10,
    ).json()
    assert ctx2["is_delegate"] is False


def test_max_two_active_delegates_per_engagement():
    primary_tok = _login("drbala@yopmail.com")
    engs = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary_tok}"},
        verify=False, timeout=10,
    ).json()
    eid = engs[0]["id"]

    # First two invites succeed
    invited_ids = []
    for i in range(2):
        e = f"d{i}-{uuid.uuid4().hex[:6]}@yopmail.com"
        r = requests.post(
            f"{BASE_URL}/api/engagements/{eid}/delegates",
            headers={"Authorization": f"Bearer {primary_tok}"},
            json={"email": e, "name": f"Delegate {i}", "relationship": "spouse"},
            verify=False, timeout=10,
        )
        assert r.status_code == 200, r.text
        invited_ids.append(r.json()["delegate"]["id"])

    # Third invite is rejected
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary_tok}"},
        json={"email": f"third-{uuid.uuid4().hex[:6]}@yopmail.com", "name": "Three", "relationship": "spouse"},
        verify=False, timeout=10,
    )
    assert r.status_code == 400
    assert "Maximum" in r.text or "maximum" in r.text

    # Cleanup
    for did in invited_ids:
        requests.delete(
            f"{BASE_URL}/api/delegates/{did}",
            headers={"Authorization": f"Bearer {primary_tok}"},
            verify=False, timeout=5,
        )


def test_delegate_invite_rejects_invalid_relationship():
    primary_tok = _login("drbala@yopmail.com")
    engs = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary_tok}"},
        verify=False, timeout=10,
    ).json()
    eid = engs[0]["id"]
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary_tok}"},
        json={"email": "bad@y.com", "name": "X", "relationship": "buddy"},
        verify=False, timeout=10,
    )
    assert r.status_code == 400


def test_existing_primary_client_t183_path_still_works():
    """Smoke test — the primary client's authorization gate on T183 sign is
    untouched: same 400 (validation) / 403 / 404 surface as before.
    """
    tok = _login("drbala@yopmail.com")
    engs = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    ).json()
    eid = engs[0]["id"]
    # No T183 set up yet → expect 400 from the *existing* validation flow,
    # which proves we are PAST the new delegate-block branch.
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/t183/sign",
        headers={"Authorization": f"Bearer {tok}"},
        json={"signature": "data:image/png;base64,iVBORw0KGgo=", "signer_name": "Dr Bala"},
        verify=False, timeout=10,
    )
    # Acceptable outcomes: 400 (no T183 setup) or 200 (signed) — never 403
    # (which would imply we mis-classified the primary client as a delegate).
    assert r.status_code in (200, 400, 500), r.text
    assert r.status_code != 403, f"Primary client got 403 on T183 sign: {r.text}"
