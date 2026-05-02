"""Iter 52: File attribution + per-tab session isolation.

Backend coverage:
 - Proxy upload by primary client → file row stamped with role=CLIENT,
   relationship=None, name = the client's name.
 - Proxy upload by an active delegate → file row stamped with role=CLIENT,
   relationship = "bookkeeper" (whatever was set), name = delegate's name.
 - Auth gate now prefers the Authorization header over the cookie (so two
   tabs signed in with different identities don't clobber each other).
"""
import os
import uuid

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PASSWORD = "CloudTax2026!"
PRIMARY_EMAIL = "drbala@yopmail.com"


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD}, verify=False, timeout=15)
    return r.json().get("token") if r.status_code == 200 else None


def _make_delegate(primary_tok, eid, relationship="bookkeeper"):
    email = f"attrib-delg-{uuid.uuid4().hex[:8]}@yopmail.com"
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary_tok}"},
        json={"email": email, "name": "Sam Bookkeeper", "relationship": relationship},
        verify=False, timeout=10,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    if payload.get("invite_link"):
        token = payload["invite_link"].rsplit("token=", 1)[-1]
        requests.post(
            f"{BASE_URL}/api/auth/set-password",
            json={"token": token, "password": PASSWORD},
            verify=False, timeout=10,
        )
    delg_tok = _login(email)
    return delg_tok, payload["delegate"]["id"], email


def _pick_pending_doc(tok, eid):
    docs = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    ).json()
    return next(d for d in docs if d["status"] in ("PENDING", "UPLOADED"))


def _upload(tok, doc_id, body=b"hi", name="x.txt"):
    files = {"file": (name, body, "text/plain")}
    r = requests.post(
        f"{BASE_URL}/api/documents/{doc_id}/upload",
        headers={"Authorization": f"Bearer {tok}"},
        files=files, verify=False, timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_primary_client_upload_attribution():
    primary = _login(PRIMARY_EMAIL)
    eid = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary}"},
        verify=False, timeout=10,
    ).json()[0]["id"]
    doc = _pick_pending_doc(primary, eid)
    res = _upload(primary, doc["id"], b"primary upload")
    fid = res["file_id"]

    docs2 = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers={"Authorization": f"Bearer {primary}"},
        verify=False, timeout=10,
    ).json()
    target = next(d for d in docs2 if d["id"] == doc["id"])
    f = next(f for f in target["files"] if f["id"] == fid)
    assert f.get("uploaded_by"), "uploaded_by must be present"
    assert f["uploaded_by"]["role"] == "CLIENT"
    assert (f["uploaded_by"].get("relationship") in (None, "")), "primary client should NOT have a relationship tag"
    assert f["uploaded_by"]["name"]


def test_delegate_upload_attribution_carries_relationship():
    primary = _login(PRIMARY_EMAIL)
    eid = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary}"},
        verify=False, timeout=10,
    ).json()[0]["id"]

    delg_tok, delg_id, _ = _make_delegate(primary, eid, relationship="bookkeeper")
    try:
        doc = _pick_pending_doc(delg_tok, eid)
        res = _upload(delg_tok, doc["id"], b"delg upload")
        fid = res["file_id"]
        docs = requests.get(
            f"{BASE_URL}/api/engagements/{eid}/documents",
            headers={"Authorization": f"Bearer {delg_tok}"},
            verify=False, timeout=10,
        ).json()
        target = next(d for d in docs if d["id"] == doc["id"])
        f = next(f for f in target["files"] if f["id"] == fid)
        ub = f.get("uploaded_by") or {}
        assert ub.get("role") == "CLIENT"
        assert ub.get("relationship") == "bookkeeper"
        assert ub.get("name") == "Sam Bookkeeper"
    finally:
        requests.delete(
            f"{BASE_URL}/api/delegates/{delg_id}",
            headers={"Authorization": f"Bearer {primary}"},
            verify=False, timeout=5,
        )


def test_auth_header_wins_over_cookie():
    """Two simulated tabs: tab A logs in as the primary client, tab B logs in
    as the WS partner. Tab A's request carries the partner's stale cookie BUT
    the primary client's bearer token in the Authorization header. The
    backend must respect the bearer (per-tab identity), not the shared cookie.
    """
    primary = _login(PRIMARY_EMAIL)
    partner_session = requests.Session()
    r = partner_session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "rajin@cloudtax.ca", "password": PASSWORD},
        verify=False, timeout=15,
    )
    assert r.status_code == 200
    # Mix the partner's cookies with the primary's bearer token
    cookies = partner_session.cookies.get_dict()
    me = requests.get(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {primary}"},
        cookies=cookies,
        verify=False, timeout=10,
    )
    assert me.status_code == 200, me.text
    body = me.json()
    assert body.get("role") == "CLIENT", f"Expected CLIENT (bearer wins), got {body}"
    assert body.get("email") == PRIMARY_EMAIL
