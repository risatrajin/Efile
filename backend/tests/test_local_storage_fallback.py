"""Regression for the "Could not fetch document bytes" bug (Iter B P1).

Root cause was that ``s3_service.get_object_bytes`` only understood real S3
object keys — when the document was stored on local disk (key prefixed with
``local://`` because the user's AWS IAM blocks S3 uploads and we fall back to
disk), the call bubbled up a 500 with the "Could not fetch document bytes"
error, blocking the Claude Sonnet 4.5 AI Extract flow entirely.

This suite locks in:
1. ``s3_service.get_object_bytes`` reads directly from disk for ``local://``
   keys and returns the bytes.
2. ``POST /documents/{id}/extract`` succeeds for locally-stored documents
   (returns 200 and either an AI result or a graceful parse_error dict —
   NOT the 500 "Could not fetch document bytes").
3. ``GET /documents/{id}/download`` streams the file bytes for locally-stored
   docs.
"""
import os
import pathlib
import tempfile
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "nim@cloudtax.ca", "password": "CloudTax2026!"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


class TestS3ServiceLocalFallback:
    """Unit-ish test that exercises the service function directly so we're
    not over-dependent on full document lifecycle fixtures."""

    def test_local_prefix_reads_from_disk(self, tmp_path):
        # Lazy import so the test can run even when AWS env vars aren't
        # populated.
        import sys
        sys.path.insert(0, "/app/backend")
        import s3_service

        payload = b"hello cloudtax"
        fp = tmp_path / "fixture.bin"
        fp.write_bytes(payload)
        out = s3_service.get_object_bytes(f"local://{fp}")
        assert out == payload

    def test_missing_local_file_returns_none(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import s3_service

        assert s3_service.get_object_bytes("local:///nonexistent/path/file.bin") is None


class TestExtractAndDownloadAgainstLiveDoc:
    """Pick any locally-stored document from the seeded DB and exercise both
    endpoints end-to-end. Skips cleanly if none exist (e.g. fresh CI DB)."""

    @pytest.fixture(scope="class")
    def local_doc_id(self, admin_token):
        # Pull engagement list, drill into one with documents.
        r = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        engs = r.json() if isinstance(r.json(), list) else r.json().get("engagements", [])
        for e in engs:
            r2 = requests.get(f"{BASE}/api/engagements/{e['id']}/documents", headers=_h(admin_token), timeout=20)
            if r2.status_code != 200:
                continue
            for d in r2.json():
                if (d.get("object_key") or "").startswith("local://"):
                    return d["id"]
        pytest.skip("No locally-stored document available to exercise the fallback path")

    def test_download_url_returns_relative_path(self, admin_token, local_doc_id):
        r = requests.get(f"{BASE}/api/documents/{local_doc_id}/download-url", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text
        url = r.json()["download_url"]
        assert url.startswith("/api/")

    def test_download_streams_bytes(self, admin_token, local_doc_id):
        r = requests.get(
            f"{BASE}/api/documents/{local_doc_id}/download",
            headers=_h(admin_token),
            timeout=30,
            stream=True,
        )
        assert r.status_code == 200, r.text
        content = r.raw.read(4096)
        assert len(content) > 0

    def test_extract_does_not_500_on_local(self, admin_token, local_doc_id):
        r = requests.post(
            f"{BASE}/api/documents/{local_doc_id}/extract",
            headers=_h(admin_token),
            timeout=60,
        )
        assert r.status_code == 200, r.text
        # The payload may be a dict of extracted fields OR a graceful
        # parse_error dict — both are fine. The old bug raised 500 before
        # we ever reached the AI layer.
        body = r.json()
        assert isinstance(body, dict)
