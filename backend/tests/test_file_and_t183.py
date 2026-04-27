"""
Tests for iteration 9 features:
- POST /api/engagements/{eid}/file-with-cra (CPA/ADMIN)
- GET  /api/engagements/{eid}/t183
- GET  /api/engagements/{eid}/t183/file
- POST /api/engagements/{eid}/t183/sign (CLIENT only)

Uses:
- Thompson (FILED) for regression / RBAC / already-filed 400
- Ahmed (IN_REVIEW, assigned to a CPA) for the happy-path file flow
"""
import io
import os
import time
from datetime import datetime, timezone

import pytest
import requests


def _env_url() -> str:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.strip().startswith("REACT_APP_BACKEND_URL="):
                    return line.strip().split("=", 1)[1]
    except Exception:
        pass
    return ""


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _env_url()).rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL not set"
PW = "CloudTax2026!"

ADMIN = "admin@cloudtax.ca"
CPA_TERRY = "terryann@cloudtax.ca"
CPA_PALLAVI = "pallavi@cloudtax.ca"
WS = "henry.ziegler@wealthsimple.com"
THOMPSON = "thompson@example.com"   # FILED already
AHMED = "ahmed@example.com"         # IN_REVIEW

PDF = (
    b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
    b"xref\n0 3\n0000000000 65535 f \n0000000015 00000 n \n0000000060 00000 n \n"
    b"trailer<</Size 3/Root 1 0 R>>\nstartxref\n110\n%%EOF\n"
)
PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _login(email, pw=PW):
    s = requests.Session()
    last = None
    for _ in range(3):
        try:
            r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=45)
            assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:300]}"
            return s
        except requests.exceptions.RequestException as e:
            last = e
            time.sleep(2)
    raise AssertionError(f"login retries exhausted: {last}")


@pytest.fixture(scope="session")
def admin_s():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def terry_s():
    return _login(CPA_TERRY)


@pytest.fixture(scope="session")
def pallavi_s():
    return _login(CPA_PALLAVI)


@pytest.fixture(scope="session")
def ws_s():
    return _login(WS)


@pytest.fixture(scope="session")
def thompson_s():
    return _login(THOMPSON)


@pytest.fixture(scope="session")
def ahmed_s():
    return _login(AHMED)


def _my_eng(s):
    r = s.get(f"{BASE}/api/engagements", timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items") or items.get("engagements") or []
    assert items, "no engagements"
    return items[0]


def _get_eng(s, eid):
    r = s.get(f"{BASE}/api/engagements/{eid}", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ==================== T183 metadata + file (Thompson already signed) ====================

class TestT183GetThompson:
    def test_t183_file_returns_pdf(self, thompson_s):
        eng = _my_eng(thompson_s)
        r = thompson_s.get(f"{BASE}/api/engagements/{eng['id']}/t183/file", timeout=20)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content.startswith(b"%PDF"), "not a PDF"
        assert len(r.content) > 1000

    def test_t183_metadata_signed_true_for_thompson(self, thompson_s):
        eng = _my_eng(thompson_s)
        r = thompson_s.get(f"{BASE}/api/engagements/{eng['id']}/t183", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["signed"] is True
        assert data["signed_name"]
        assert data["signed_at"]

    def test_t183_file_accessible_by_cpa(self, terry_s, thompson_s):
        eng = _my_eng(thompson_s)
        r = terry_s.get(f"{BASE}/api/engagements/{eng['id']}/t183/file", timeout=20)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")


# ==================== T183 sign RBAC ====================

class TestT183SignRBAC:
    def test_cpa_cannot_sign(self, terry_s, thompson_s):
        eng = _my_eng(thompson_s)
        r = terry_s.post(
            f"{BASE}/api/engagements/{eng['id']}/t183/sign",
            json={"signature": PNG_DATA_URL, "signer_name": "CPA Trying"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"

    def test_admin_cannot_sign(self, admin_s, thompson_s):
        eng = _my_eng(thompson_s)
        r = admin_s.post(
            f"{BASE}/api/engagements/{eng['id']}/t183/sign",
            json={"signature": PNG_DATA_URL, "signer_name": "Admin Trying"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_ws_cannot_sign(self, ws_s, thompson_s):
        eng = _my_eng(thompson_s)
        r = ws_s.post(
            f"{BASE}/api/engagements/{eng['id']}/t183/sign",
            json={"signature": PNG_DATA_URL, "signer_name": "WS Trying"},
            timeout=15,
        )
        # WS may also get 404 (engagement not visible) — but 403 is the expected contract
        assert r.status_code in (403, 404)


# ==================== T183 sign validation (CLIENT) ====================

class TestT183SignValidation:
    def test_invalid_signature_rejected(self, ahmed_s):
        eng = _my_eng(ahmed_s)
        r = ahmed_s.post(
            f"{BASE}/api/engagements/{eng['id']}/t183/sign",
            json={"signature": "not-a-data-url", "signer_name": "Dr Ahmed"},
            timeout=15,
        )
        assert r.status_code == 400

    def test_empty_signer_name_rejected(self, ahmed_s):
        eng = _my_eng(ahmed_s)
        r = ahmed_s.post(
            f"{BASE}/api/engagements/{eng['id']}/t183/sign",
            json={"signature": PNG_DATA_URL, "signer_name": "   "},
            timeout=15,
        )
        assert r.status_code == 400

    def test_valid_client_sign_persists(self, ahmed_s):
        eng = _my_eng(ahmed_s)
        eid = eng["id"]
        r = ahmed_s.post(
            f"{BASE}/api/engagements/{eid}/t183/sign",
            json={"signature": PNG_DATA_URL, "signer_name": "Dr Youssef Ahmed"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["ok"] is True
        assert out["signed_name"] == "Dr Youssef Ahmed"
        # GET to verify persistence
        meta = ahmed_s.get(f"{BASE}/api/engagements/{eid}/t183", timeout=15).json()
        assert meta["signed"] is True
        assert meta["signed_name"] == "Dr Youssef Ahmed"
        assert meta["signed_at"]


# ==================== file-with-cra RBAC ====================

class TestFileWithCRARBAC:
    @staticmethod
    def _post(session, eid, params=None):
        params = params or {
            "cra_confirmation": "CRA-TEST-000",
            "filing_datetime": datetime.now(timezone.utc).isoformat(),
            "note": "rbac test",
        }
        files = {"file": ("filed.pdf", io.BytesIO(PDF), "application/pdf")}
        return session.post(
            f"{BASE}/api/engagements/{eid}/file-with-cra",
            params=params, files=files, timeout=30,
        )

    def test_client_cannot_file(self, thompson_s):
        eng = _my_eng(thompson_s)
        r = self._post(thompson_s, eng["id"])
        assert r.status_code == 403, r.text[:200]

    def test_ws_cannot_file(self, ws_s, thompson_s):
        eng = _my_eng(thompson_s)
        r = self._post(ws_s, eng["id"])
        # WS not assigned -> 403/404 both acceptable. CPA/ADMIN-only guard is primary.
        assert r.status_code in (403, 404)

    def test_already_filed_returns_400(self, terry_s, thompson_s):
        # Thompson is already FILED — CPA should get 400
        eng = _my_eng(thompson_s)
        r = self._post(terry_s, eng["id"])
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"


# ==================== file-with-cra: requires client-approval (Ahmed IN_REVIEW) ====================

class TestFileWithCRANotApproved:
    def test_not_approved_returns_400(self, admin_s, ahmed_s):
        """If review_decision != approved, filing must be blocked with 400."""
        eng = _my_eng(ahmed_s)
        eid = eng["id"]
        # Find a CPA-like session: admin is CPA-equivalent for this endpoint
        # (endpoint allows ADMIN). Ensure Ahmed's engagement currently has NOT been approved.
        cur = _get_eng(admin_s, eid)
        rd = (cur.get("review_decision") or {}).get("decision")
        if rd == "approved":
            pytest.skip("Ahmed has already approved — cannot test 'not approved' path")
        files = {"file": ("filed.pdf", io.BytesIO(PDF), "application/pdf")}
        params = {
            "cra_confirmation": "CRA-TEST-111",
            "filing_datetime": datetime.now(timezone.utc).isoformat(),
        }
        r = admin_s.post(
            f"{BASE}/api/engagements/{eid}/file-with-cra",
            params=params, files=files, timeout=30,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        assert "approve" in r.text.lower()


# ==================== Regression check ====================

def test_endpoints_reachable(admin_s):
    """Sanity: /api/auth/me returns 200 for admin."""
    r = admin_s.get(f"{BASE}/api/auth/me", timeout=15)
    assert r.status_code == 200
    assert r.json().get("role") == "ADMIN"
