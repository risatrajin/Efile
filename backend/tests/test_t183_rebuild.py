"""Backend tests for the rebuilt T183 e-signature flow.

Covers: upload (RBAC, validation), position, send, get metadata, file streaming
(variant=auto/original/signed), sign (PyMuPDF merge), legacy fallback.
"""
import io
import os
import time
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")
TPL_PATH = "/app/backend/templates/t183-25e.pdf"

# Real PNG (200x60 transparent with a black horizontal line) generated via PIL
def _make_sig_png_b64() -> str:
    import io as _io
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (200, 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([(10, 30), (190, 30)], fill=(0, 0, 0, 255), width=3)
    buf = _io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()

SIG_DATA_URL = f"data:image/png;base64,{_make_sig_png_b64()}"


# ---------- helpers ----------
def login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def auth_h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def cpa_token():
    return login("terryann@cloudtax.ca")


@pytest.fixture(scope="module")
def client_kaur_token():
    return login("kaur@example.com")


@pytest.fixture(scope="module")
def client_thompson_token():
    return login("thompson@example.com")


@pytest.fixture(scope="module")
def ws_token():
    return login("watson@partner.ca")


@pytest.fixture(scope="module")
def client_liu_token():
    return login("liu@example.com")


@pytest.fixture(scope="module")
def kaur_engagement_id(cpa_token):
    """Liu's engagement (assigned to Terry-Ann) — used as 'fresh' subject for full flow."""
    r = requests.get(f"{API}/engagements", headers=auth_h(cpa_token), timeout=20)
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("items") or r.json().get("data") or []
    for e in items:
        em = ((e.get("client") or {}).get("email") or "").lower()
        if em == "liu@example.com":
            return e["id"]
    pytest.skip("Liu engagement not found")


@pytest.fixture(scope="module")
def thompson_engagement_id():
    return "cc22901b-b6a2-4997-b84a-a7bfc2b307f0"


@pytest.fixture(scope="module")
def pdf_bytes():
    with open(TPL_PATH, "rb") as f:
        return f.read()


# ---------- upload validation + RBAC ----------
class TestT183Upload:
    def test_rbac_client_blocked(self, client_liu_token, kaur_engagement_id, pdf_bytes):
        files = {"file": ("t183.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/upload",
                          headers=auth_h(client_liu_token), files=files, timeout=20)
        assert r.status_code == 403, r.text

    def test_rbac_ws_blocked(self, ws_token, kaur_engagement_id, pdf_bytes):
        files = {"file": ("t183.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/upload",
                          headers=auth_h(ws_token), files=files, timeout=20)
        assert r.status_code == 403, r.text

    def test_empty_file_400(self, cpa_token, kaur_engagement_id):
        files = {"file": ("empty.pdf", b"", "application/pdf")}
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/upload",
                          headers=auth_h(cpa_token), files=files, timeout=20)
        assert r.status_code == 400, r.text

    def test_non_pdf_400(self, cpa_token, kaur_engagement_id):
        files = {"file": ("notes.txt", b"hello world", "text/plain")}
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/upload",
                          headers=auth_h(cpa_token), files=files, timeout=20)
        assert r.status_code == 400, r.text

    def test_upload_success_resets_state(self, cpa_token, kaur_engagement_id, pdf_bytes):
        files = {"file": ("TEST_t183.pdf", pdf_bytes, "application/pdf")}
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/upload",
                          headers=auth_h(cpa_token), files=files, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "draft"
        assert body["file_name"] == "TEST_t183.pdf"
        # Verify metadata via GET
        meta = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183",
                            headers=auth_h(cpa_token), timeout=10).json()
        assert meta["status"] == "draft"
        assert meta["has_original"] is True
        assert meta["has_signed_pdf"] is False
        assert meta["original_file_name"] == "TEST_t183.pdf"
        assert meta["signature_position"] is None
        assert meta["signed_at"] is None
        assert meta["sent_at"] is None


# ---------- position validation ----------
class TestT183Position:
    def test_position_out_of_range(self, cpa_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/position",
                          headers=auth_h(cpa_token),
                          json={"page": 0, "x_pct": 1.5, "y_pct": 0.5, "w_pct": 0.25, "h_pct": 0.06},
                          timeout=10)
        assert r.status_code == 400, r.text

    def test_position_success(self, cpa_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/position",
                          headers=auth_h(cpa_token),
                          json={"page": 0, "x_pct": 0.6, "y_pct": 0.8, "w_pct": 0.3, "h_pct": 0.07},
                          timeout=10)
        assert r.status_code == 200, r.text
        pos = r.json()["position"]
        assert pos["page"] == 0 and pos["x_pct"] == 0.6 and pos["y_pct"] == 0.8

    def test_position_requires_upload(self, cpa_token, ws_token):
        # Find a fresh engagement w/o upload (use Liu)
        admin = login("admin@cloudtax.ca")
        items = requests.get(f"{API}/engagements", headers=auth_h(admin), timeout=15).json()
        items = items if isinstance(items, list) else items.get("items") or []
        fresh = None
        for e in items:
            em = ((e.get("client") or {}).get("email") or "").lower()
            if em in ("liu@example.com", "patel@example.com", "okafor@example.com"):
                fresh = e["id"]
                break
        if not fresh:
            pytest.skip("No engagement w/o upload available for negative test")
        # Just verify metadata's has_original status; cannot guarantee no upload.
        meta = requests.get(f"{API}/engagements/{fresh}/t183",
                            headers=auth_h(admin), timeout=10).json()
        if meta.get("has_original"):
            pytest.skip("Cannot find clean engagement w/o original")
        r = requests.post(f"{API}/engagements/{fresh}/t183/position",
                          headers=auth_h(admin),
                          json={"page": 0, "x_pct": 0.5, "y_pct": 0.5, "w_pct": 0.25, "h_pct": 0.06},
                          timeout=10)
        assert r.status_code == 400, r.text


# ---------- send ----------
class TestT183Send:
    def test_send_success(self, cpa_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/send",
                          headers=auth_h(cpa_token), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "sent"
        meta = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183",
                            headers=auth_h(cpa_token), timeout=10).json()
        assert meta["status"] == "sent"
        assert meta["sent_at"] is not None


# ---------- file streaming ----------
class TestT183File:
    def test_file_original(self, cpa_token, kaur_engagement_id):
        r = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183/file?variant=original",
                         headers=auth_h(cpa_token), timeout=20, allow_redirects=True)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF", "expected PDF magic bytes"

    def test_file_auto_returns_original_when_no_signed(self, cpa_token, kaur_engagement_id):
        r = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183/file?variant=auto",
                         headers=auth_h(cpa_token), timeout=20, allow_redirects=True)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"


# ---------- sign + PyMuPDF merge ----------
class TestT183Sign:
    def test_sign_invalid_data_url_400(self, client_liu_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/sign",
                          headers=auth_h(client_liu_token),
                          json={"signature": "not-a-data-url", "signer_name": "Wei Liu"},
                          timeout=15)
        assert r.status_code == 400, r.text

    def test_sign_empty_name_400(self, client_liu_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/sign",
                          headers=auth_h(client_liu_token),
                          json={"signature": SIG_DATA_URL, "signer_name": "  "},
                          timeout=15)
        assert r.status_code == 400, r.text

    def test_sign_cpa_blocked(self, cpa_token, kaur_engagement_id):
        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/sign",
                          headers=auth_h(cpa_token),
                          json={"signature": SIG_DATA_URL, "signer_name": "CPA"},
                          timeout=15)
        assert r.status_code == 403, r.text

    def test_sign_success_pymupdf_merge(self, client_liu_token, kaur_engagement_id, cpa_token, pdf_bytes):
        # Count images in original page 0
        import fitz
        orig = fitz.open(stream=pdf_bytes, filetype="pdf")
        orig_imgs = len(orig[0].get_images())
        orig.close()

        r = requests.post(f"{API}/engagements/{kaur_engagement_id}/t183/sign",
                          headers=auth_h(client_liu_token),
                          json={"signature": SIG_DATA_URL, "signer_name": "Wei Liu"},
                          timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_signed_pdf"] is True
        assert body["signed_name"] == "Wei Liu"

        # Metadata
        meta = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183",
                            headers=auth_h(client_liu_token), timeout=10).json()
        assert meta["status"] == "signed"
        assert meta["has_signed_pdf"] is True
        assert meta["signed_at"] is not None
        assert meta["signed_name"] == "Wei Liu"

        # Download signed → must have +1 image on page 0
        f = requests.get(f"{API}/engagements/{kaur_engagement_id}/t183/file?variant=signed",
                         headers=auth_h(client_liu_token), timeout=30, allow_redirects=True)
        assert f.status_code == 200, f.text
        assert f.content[:4] == b"%PDF"
        signed = fitz.open(stream=f.content, filetype="pdf")
        signed_imgs = len(signed[0].get_images())
        signed.close()
        assert signed_imgs == orig_imgs + 1, f"expected {orig_imgs+1}, got {signed_imgs}"


# ---------- legacy fallback ----------
class TestT183Legacy:
    def test_thompson_signed_metadata(self, client_thompson_token, thompson_engagement_id):
        meta = requests.get(f"{API}/engagements/{thompson_engagement_id}/t183",
                            headers=auth_h(client_thompson_token), timeout=10).json()
        assert meta["status"] == "signed"

    def test_legacy_auto_falls_back(self, client_thompson_token, thompson_engagement_id):
        # Whether modern or legacy, auto must return some PDF (no 404)
        r = requests.get(f"{API}/engagements/{thompson_engagement_id}/t183/file?variant=auto",
                         headers=auth_h(client_thompson_token), timeout=20, allow_redirects=True)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
