"""Iter15: Avatar (POST/GET/DELETE) + /messages/inbox tests.

Spec recap:
- POST /api/users/me/avatar (multipart) — accepts PNG/JPEG/WebP/GIF up to 4 MB.
  Rejects unsupported types and oversize. Returns {avatar_url, storage}.
- GET  /api/users/{uid}/avatar — streams image, 404 when none.
- DELETE /api/users/me/avatar — removes; subsequent GET returns 404.
- GET  /api/messages/inbox — Admin: all non-ONBOARDING engagements.
  CPA: only assigned. CLIENT: only own. WS_PARTNER: 403.
"""
import io
import os
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PASSWORD = "CloudTax2026!"


def _png_bytes(width: int = 4, height: int = 4) -> bytes:
    """Return a minimal valid PNG (white square)."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = b""
    for _ in range(height):
        raw += b"\x00" + b"\xff\xff\xff" * width
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _login(email: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login("admin@cloudtax.ca")


@pytest.fixture(scope="module")
def cpa():
    return _login("pallavi@cloudtax.ca")


@pytest.fixture(scope="module")
def ws():
    return _login("henry.ziegler@wealthsimple.com")


@pytest.fixture(scope="module")
def client():
    return _login("chen@example.com")


@pytest.fixture(scope="module")
def kaur():
    # Use kaur — non-admin — for avatar mutation so we don't disturb the admin avatar.
    return _login("kaur@example.com")


# ---------- Avatar tests ----------

class TestAvatar:
    def test_get_no_avatar_returns_404(self, kaur):
        me = kaur.get(f"{BASE_URL}/api/auth/me").json()
        # If there's a stale avatar from a prior run, clean it first
        kaur.delete(f"{BASE_URL}/api/users/me/avatar")
        r = kaur.get(f"{BASE_URL}/api/users/{me['id']}/avatar")
        assert r.status_code == 404

    def test_upload_unsupported_mime_rejected(self, kaur):
        files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
        r = kaur.post(f"{BASE_URL}/api/users/me/avatar", files=files)
        assert r.status_code == 400, r.text
        assert "image" in r.text.lower() or "unsupported" in r.text.lower()

    def test_upload_oversize_rejected(self, kaur):
        # 5 MB of zeros, claiming PNG mime — should be rejected by size check (which runs
        # before mime check actually — but either rejection is acceptable per spec).
        big = b"\x00" * (5 * 1024 * 1024)
        files = {"file": ("big.png", io.BytesIO(big), "image/png")}
        r = kaur.post(f"{BASE_URL}/api/users/me/avatar", files=files)
        assert r.status_code == 400
        assert "large" in r.text.lower() or "max" in r.text.lower()

    def test_upload_png_then_get_then_delete(self, kaur):
        me = kaur.get(f"{BASE_URL}/api/auth/me").json()
        png = _png_bytes()
        files = {"file": ("me.png", io.BytesIO(png), "image/png")}
        r = kaur.post(f"{BASE_URL}/api/users/me/avatar", files=files)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["avatar_url"] == f"/api/users/{me['id']}/avatar"
        assert body["storage"] in ("s3", "local")

        # /auth/me should now report avatar_url
        me2 = kaur.get(f"{BASE_URL}/api/auth/me").json()
        assert me2.get("avatar_url") == body["avatar_url"]

        # GET avatar streams the image
        rg = kaur.get(f"{BASE_URL}/api/users/{me['id']}/avatar")
        assert rg.status_code == 200
        assert rg.headers.get("content-type", "").startswith("image/")
        assert len(rg.content) > 0

        # DELETE then GET → 404
        rd = kaur.delete(f"{BASE_URL}/api/users/me/avatar")
        assert rd.status_code == 200
        rg2 = kaur.get(f"{BASE_URL}/api/users/{me['id']}/avatar")
        assert rg2.status_code == 404

    def test_upload_webp_accepted(self, kaur):
        # We don't bother encoding a real WebP — server only checks the mime header,
        # not the bytes. A stub body with image/webp content-type should be accepted.
        body = b"RIFF\x24\x00\x00\x00WEBPVP8 \x18\x00\x00\x00\x00\x00\x00\x00"
        files = {"file": ("me.webp", io.BytesIO(body), "image/webp")}
        r = kaur.post(f"{BASE_URL}/api/users/me/avatar", files=files)
        assert r.status_code == 200, r.text
        # cleanup
        kaur.delete(f"{BASE_URL}/api/users/me/avatar")


# ---------- Inbox tests ----------

class TestMessagesInbox:
    def test_admin_inbox_lists_engagements(self, admin):
        r = admin.get(f"{BASE_URL}/api/messages/inbox")
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        assert len(rows) >= 1
        sample = rows[0]
        for k in ("engagement_id", "client", "corporation", "assigned_cpa", "last_message", "unread_count", "last_at"):
            assert k in sample, f"missing key {k} in inbox row: {sample}"
        # Admin should NOT see ONBOARDING engagements
        statuses = {r["engagement_status"] for r in rows}
        assert "ONBOARDING" not in statuses

    def test_cpa_inbox_only_assigned(self, cpa):
        r = cpa.get(f"{BASE_URL}/api/messages/inbox")
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        # Every row should have assigned_cpa = the logged-in CPA
        me = cpa.get(f"{BASE_URL}/api/auth/me").json()
        for row in rows:
            ac = row.get("assigned_cpa") or {}
            assert ac.get("id") == me["id"], f"CPA inbox leaked engagement: {row}"

    def test_client_inbox_only_own(self, client):
        r = client.get(f"{BASE_URL}/api/messages/inbox")
        assert r.status_code == 200, r.text
        rows = r.json()
        # chen has exactly one engagement
        assert len(rows) <= 1
        if rows:
            me = client.get(f"{BASE_URL}/api/auth/me").json()
            assert rows[0]["client"]["id"] == me["id"]

    def test_ws_partner_forbidden(self, ws):
        r = ws.get(f"{BASE_URL}/api/messages/inbox")
        assert r.status_code == 403

    def test_admin_send_message_then_inbox_shows_it(self, admin, client):
        # Find chen's engagement
        engs = admin.get(f"{BASE_URL}/api/engagements").json()
        chen_eng = None
        for e in engs:
            corp = admin.get(f"{BASE_URL}/api/corporations/{e['corporation_id']}").json()
            if corp.get("client_id"):
                u = admin.get(f"{BASE_URL}/api/users/{corp['client_id']}").json() if False else None
            if e.get("status") == "FILED":
                chen_eng = e
                break
        # Fallback: just use the first engagement
        if not chen_eng:
            chen_eng = engs[0]
        msg = "TEST_iter15_inbox_check"
        rs = admin.post(f"{BASE_URL}/api/engagements/{chen_eng['id']}/messages", json={"content": msg})
        assert rs.status_code in (200, 201), rs.text

        # Admin inbox should include this engagement with last_message containing our text
        ri = admin.get(f"{BASE_URL}/api/messages/inbox").json()
        match = next((r for r in ri if r["engagement_id"] == chen_eng["id"]), None)
        assert match is not None
        assert match["last_message"] is not None
        assert msg in (match["last_message"].get("content") or "")
