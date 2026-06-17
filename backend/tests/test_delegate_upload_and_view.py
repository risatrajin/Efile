"""Iter 51: Delegate upload + view permission regression test.

The user reported that delegates couldn't upload or view documents. Backend
investigation showed the engagement gate ALREADY accepts delegates and the
upload/view endpoints ONLY block PARTNER. This test locks those guarantees
in place and ensures we never regress them.

Covers:
 - Delegate hits POST /documents/{id}/upload (proxy multipart) → 200
 - Delegate hits POST /documents/{id}/upload-url (presigned S3) → 200
 - Delegate hits GET /documents/{id}/download-url → 200
 - Delegate hits GET /documents/{id}/files/{file_id}/download → 200
 - Delegate hits GET /documents/{id}/download (legacy local) → 200
 - Delegate hits GET /engagements/{eid}/documents/download-all → 200
 - Delegate is STILL blocked from POST /engagements/{eid}/t183/sign → 403
"""
import io
import os
import uuid

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")
PRIMARY_EMAIL = "drbala@yopmail.com"


def _login(email):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD}, timeout=15)
    return r.json().get("token") if r.status_code == 200 else None


def _ensure_delegate():
    """Create a fresh delegate for drbala's engagement and return the
    delegate's auth token + the engagement id + the delegate row id."""
    primary = _login(PRIMARY_EMAIL)
    assert primary

    eid = requests.get(
        f"{BASE_URL}/api/engagements",
        headers={"Authorization": f"Bearer {primary}"}, timeout=10,
    ).json()[0]["id"]

    email = f"delg-perms-{uuid.uuid4().hex[:8]}@yopmail.com"
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/delegates",
        headers={"Authorization": f"Bearer {primary}"},
        json={"email": email, "name": "Perm Tester", "relationship": "bookkeeper"}, timeout=10,
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    delegate_id = payload["delegate"]["id"]
    if payload.get("invite_link"):
        token = payload["invite_link"].rsplit("token=", 1)[-1]
        requests.post(
            f"{BASE_URL}/api/auth/set-password",
            json={"token": token, "password": PASSWORD}, timeout=10,
        )
    delg = _login(email)
    assert delg, "delegate login failed"
    return delg, eid, delegate_id, primary


def test_delegate_can_upload_and_view():
    delg, eid, delegate_id, primary = _ensure_delegate()
    H = {"Authorization": f"Bearer {delg}"}

    # 1) List docs
    docs = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers=H, timeout=10,
    ).json()
    assert isinstance(docs, list) and len(docs) >= 1, docs

    # Pick a document we can re-upload to (any non-deferred row)
    target = next((d for d in docs if d["status"] != "ISSUE"), None)
    assert target

    # 2) Presigned upload-url — must succeed for delegate
    r = requests.post(
        f"{BASE_URL}/api/documents/{target['id']}/upload-url",
        headers={**H, "Content-Type": "application/json"},
        json={"content_type": "text/plain", "file_name": "delg.txt"}, timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("upload_url")

    # 3) Proxy multipart upload — must succeed and return file row
    files = {"file": ("delg.txt", b"delegate upload payload", "text/plain")}
    r = requests.post(
        f"{BASE_URL}/api/documents/{target['id']}/upload",
        headers=H, files=files, timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("file_id")

    # Refetch — confirm the file landed in files[]
    docs2 = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers=H, timeout=10,
    ).json()
    target2 = next(d for d in docs2 if d["id"] == target["id"])
    assert any(f["id"] == body["file_id"] for f in (target2.get("files") or []))

    # 4) download-url — must succeed for delegate
    r = requests.get(
        f"{BASE_URL}/api/documents/{target['id']}/download-url",
        headers=H, timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("download_url")

    # 5) Per-file download — must succeed
    r = requests.get(
        f"{BASE_URL}/api/documents/{target['id']}/files/{body['file_id']}/download",
        headers=H, timeout=15,
    )
    assert r.status_code == 200, r.text

    # 6) Legacy doc-level download (local fallback) — must succeed
    r = requests.get(
        f"{BASE_URL}/api/documents/{target['id']}/download",
        headers=H, timeout=15,
    )
    assert r.status_code == 200, r.text

    # 7) Bulk ZIP download — must succeed
    r = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents/download-all",
        headers=H, timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/zip")

    # 8) Critical: T183 sign STILL blocked for delegate
    r = requests.post(
        f"{BASE_URL}/api/engagements/{eid}/t183/sign",
        headers={**H, "Content-Type": "application/json"},
        json={"signature": "data:image/png;base64,iVBORw0KGgo=", "signer_name": "Perm Tester"}, timeout=10,
    )
    assert r.status_code == 403, r.text

    # Cleanup — revoke the delegate so subsequent runs can re-create
    requests.delete(
        f"{BASE_URL}/api/delegates/{delegate_id}",
        headers={"Authorization": f"Bearer {primary}"}, timeout=5,
    )


def test_primary_client_paths_unchanged_after_delegate_fix():
    """Smoke check that the same endpoints still work for the primary client —
    no accidental regression of the original auth gate."""
    primary = _login(PRIMARY_EMAIL)
    H = {"Authorization": f"Bearer {primary}"}
    eid = requests.get(
        f"{BASE_URL}/api/engagements", headers=H, timeout=10,
    ).json()[0]["id"]
    docs = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents",
        headers=H, timeout=10,
    ).json()
    target = next((d for d in docs if d.get("files")), None)
    assert target
    fid = target["files"][0]["id"]
    r = requests.get(
        f"{BASE_URL}/api/documents/{target['id']}/files/{fid}/download",
        headers=H, timeout=15,
    )
    assert r.status_code == 200, r.text
    r = requests.get(
        f"{BASE_URL}/api/engagements/{eid}/documents/download-all",
        headers=H, timeout=30,
    )
    assert r.status_code == 200
