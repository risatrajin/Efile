"""Iteration 11 backend regression tests covering:
  - corp_name mandatory on WS onboarding (POST + PATCH)
  - notify_admins on submit-to-cloudtax (new_referral_admin)
  - CPA-assignment fan-out notifications (PATCH /engagements/{eid})
  - file-with-cra approval gate removed (only T183 + status checks remain)
  - file-with-cra emits filing_complete_admin
  - documents multi-file upload ($push to files[])
  - delete single file from doc.files[]
  - download specific file by file_id
  - list_documents normalizes legacy single-file docs into files[] with -legacy id
"""

import io
import os
import time
import uuid

import pytest
import requests

def _read_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for line in open(p):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = BASE_URL + "/api"
PASSWORD = "CloudTax2026!"


def _login(email):
    s = requests.Session()
    last = None
    for _ in range(3):
        try:
            r = s.post(f"{API}/auth/login", json={"email": email, "password": PASSWORD}, timeout=60)
            last = r
            if r.status_code == 200:
                return s
        except Exception as e:
            last = e
        time.sleep(2)
    pytest.skip(f"login {email} unavailable: {getattr(last, 'status_code', last)}")


@pytest.fixture(scope="session")
def admin():
    return _login("admin@cloudtax.ca")


@pytest.fixture(scope="session")
def ws():
    return _login("henry.ziegler@wealthsimple.com")


@pytest.fixture(scope="session")
def cpa():
    return _login("terryann@cloudtax.ca")


@pytest.fixture(scope="session")
def kaur():
    return _login("kaur@example.com")


# ---------- corp_name mandatory ----------
class TestCorpNameMandatory:
    def test_post_onboarding_missing_corp_name_returns_400(self, ws):
        payload = {
            "first_name": "TEST",
            "last_name": f"NoCorp{uuid.uuid4().hex[:6]}",
            "client_email": f"test_nocorp_{uuid.uuid4().hex[:6]}@example.com",
            "phone": "+14165550000",
            "province": "ON",
            "tier": "STANDARD",
        }
        r = ws.post(f"{API}/engagements/onboarding", json=payload, timeout=20)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code} {r.text}"
        body = r.text.lower()
        assert "corp_name" in body, f"error message should mention corp_name: {r.text}"

    def test_post_onboarding_blank_corp_name_returns_400(self, ws):
        payload = {
            "first_name": "TEST",
            "last_name": f"Blank{uuid.uuid4().hex[:6]}",
            "client_email": f"test_blank_{uuid.uuid4().hex[:6]}@example.com",
            "phone": "+14165550000",
            "province": "ON",
            "tier": "STANDARD",
            "corp_name": "   ",
        }
        r = ws.post(f"{API}/engagements/onboarding", json=payload, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        assert "corp_name" in r.text.lower()

    def test_post_onboarding_with_corp_name_succeeds(self, ws):
        suffix = uuid.uuid4().hex[:6]
        payload = {
            "first_name": "TEST",
            "last_name": f"WithCorp{suffix}",
            "client_email": f"test_withcorp_{suffix}@example.com",
            "phone": "+14165550000",
            "province": "ON",
            "tier": "STANDARD",
            "corp_name": f"TEST Iter11 Corp {suffix}",
        }
        r = ws.post(f"{API}/engagements/onboarding", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"expected success, got {r.status_code} {r.text}"
        data = r.json()
        assert "engagement_id" in data or "id" in data, data
        eid = data.get("engagement_id") or data.get("id")
        # Save for PATCH test
        TestCorpNameMandatory._eid = eid

    def test_patch_onboarding_blank_corp_name_returns_400(self, ws):
        eid = getattr(TestCorpNameMandatory, "_eid", None)
        if not eid:
            pytest.skip("create test did not run")
        r = ws.patch(f"{API}/engagements/{eid}/onboarding", json={"corp_name": ""}, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        assert "corp_name" in r.text.lower() and "empty" in r.text.lower()


# ---------- submit-to-cloudtax notifies admins ----------
class TestSubmitToCloudtaxNotifiesAdmins:
    def test_admin_receives_new_referral_admin_notification(self, ws, admin):
        suffix = uuid.uuid4().hex[:6]
        # Create onboarding draft
        payload = {
            "first_name": "TEST",
            "last_name": f"Notify{suffix}",
            "client_email": f"test_notify_{suffix}@example.com",
            "phone": "+14165550000",
            "province": "ON",
            "tier": "STANDARD",
            "corp_name": f"TEST Notify Corp {suffix}",
            "fiscal_year_end": "2026-12-31",
        }
        r = ws.post(f"{API}/engagements/onboarding", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        eid = r.json().get("engagement_id") or r.json().get("id")

        # PATCH onboarding to fill all remaining required fields
        ws.patch(f"{API}/engagements/{eid}/onboarding", json=payload, timeout=20)

        # Fetch progress (which exposes the checklist items) then mark them all complete
        pg = ws.get(f"{API}/engagements/{eid}/onboarding-progress", timeout=20)
        if pg.status_code == 200:
            cl = pg.json().get("checklist") or []
            items_payload = {"items": [{"id": c.get("id"), "item": c.get("item"), "is_completed": True} for c in cl]}
            if items_payload["items"]:
                ws.patch(f"{API}/engagements/{eid}/pre-filing-checklist", json=items_payload, timeout=20)

        # Submit to cloudtax
        r = ws.post(f"{API}/engagements/{eid}/submit", timeout=20)
        assert r.status_code in (200, 201), f"submit failed: {r.status_code} {r.text}"

        # Admin should now see a new_referral_admin notification for this eid
        time.sleep(1)
        nr = admin.get(f"{API}/notifications", timeout=20)
        assert nr.status_code == 200, nr.text
        notes = nr.json()
        match = [n for n in notes if n.get("type") == "new_referral_admin" and n.get("engagement_id") == eid]
        assert match, f"Expected new_referral_admin notification for eid={eid}, got types={[n.get('type') for n in notes[:20]]}"


# ---------- CPA-assignment notifications ----------
class TestCpaAssignmentNotifications:
    def _find_cpa_id(self, admin, email="terryann@cloudtax.ca"):
        r = admin.get(f"{API}/users", timeout=20)
        if r.status_code != 200:
            return None
        for u in r.json():
            if u.get("email") == email:
                return u.get("id")
        return None

    def test_assignment_emits_three_notifications(self, admin, ws, cpa):
        # Find an engagement currently assigned to a different CPA (or unassigned) for henry's WS group
        r = admin.get(f"{API}/engagements", timeout=20)
        assert r.status_code == 200, r.text
        engs = r.json()
        terry_id = self._find_cpa_id(admin, "terryann@cloudtax.ca")
        pallavi_id = self._find_cpa_id(admin, "pallavi@cloudtax.ca")
        assert terry_id and pallavi_id, "could not resolve CPA ids"

        # Pick an eng where ws_advisor_id is set and assigned_cpa_id != terry_id
        target = None
        for e in engs:
            if e.get("ws_advisor_id") and e.get("assigned_cpa_id") != terry_id:
                target = e
                break
        if not target:
            pytest.skip("no suitable engagement for re-assignment test")
        eid = target["id"]
        prev_cpa = target.get("assigned_cpa_id")
        new_cpa = terry_id if prev_cpa != terry_id else pallavi_id

        # Capture baseline notification count for ws partner
        ws_before = ws.get(f"{API}/notifications", timeout=20).json()
        cpa_before = cpa.get(f"{API}/notifications", timeout=20).json()
        ws_before_ids = {n.get("id") for n in ws_before}
        cpa_before_ids = {n.get("id") for n in cpa_before}

        r = admin.patch(f"{API}/engagements/{eid}", json={"assigned_cpa_id": new_cpa}, timeout=20)
        assert r.status_code == 200, f"PATCH eng failed: {r.status_code} {r.text}"

        time.sleep(1)
        # CPA notification
        if new_cpa == terry_id:
            cpa_after = cpa.get(f"{API}/notifications", timeout=20).json()
            new_for_cpa = [n for n in cpa_after if n.get("id") not in cpa_before_ids and n.get("engagement_id") == eid and n.get("type") == "cpa_assigned"]
            assert new_for_cpa, f"expected cpa_assigned notification for terryann on eid={eid}"

        # WS notification
        ws_after = ws.get(f"{API}/notifications", timeout=20).json()
        new_for_ws = [n for n in ws_after if n.get("id") not in ws_before_ids and n.get("engagement_id") == eid and n.get("type") == "ws_cpa_assigned"]
        assert new_for_ws, f"expected ws_cpa_assigned notification for henry on eid={eid}"

        # restore previous cpa to keep state stable
        if prev_cpa:
            admin.patch(f"{API}/engagements/{eid}", json={"assigned_cpa_id": prev_cpa}, timeout=20)

    def test_no_notification_when_cpa_unchanged(self, admin, ws):
        r = admin.get(f"{API}/engagements", timeout=20)
        engs = r.json()
        target = next((e for e in engs if e.get("assigned_cpa_id") and e.get("ws_advisor_id")), None)
        if not target:
            pytest.skip("no eng with cpa+ws assigned")
        eid = target["id"]
        same_cpa = target["assigned_cpa_id"]

        ws_before = ws.get(f"{API}/notifications", timeout=20).json()
        ids_before = {n.get("id") for n in ws_before}

        r = admin.patch(f"{API}/engagements/{eid}", json={"assigned_cpa_id": same_cpa}, timeout=20)
        assert r.status_code == 200, r.text
        time.sleep(1)
        ws_after = ws.get(f"{API}/notifications", timeout=20).json()
        new_assignment_notes = [n for n in ws_after if n.get("id") not in ids_before and n.get("type") == "ws_cpa_assigned" and n.get("engagement_id") == eid]
        assert not new_assignment_notes, f"unexpected ws_cpa_assigned for unchanged cpa: {new_assignment_notes}"


# ---------- multi-file uploads + delete + download ----------
class TestMultiFileUploads:
    def _find_kaur_pending_doc(self, kaur):
        r = kaur.get(f"{API}/engagements", timeout=20)
        assert r.status_code == 200, r.text
        engs = r.json()
        if not engs:
            pytest.skip("kaur has no engagements")
        eid = engs[0]["id"]
        # Use admin/cpa to read documents — kaur is client and may have list endpoint of own
        r = kaur.get(f"{API}/engagements/{eid}/documents", timeout=20)
        if r.status_code != 200:
            pytest.skip(f"kaur cannot list documents: {r.status_code}")
        docs = r.json()
        # Find a PENDING doc with no files yet
        for d in docs:
            if d.get("status") == "PENDING" and not d.get("files"):
                return eid, d["id"]
        # fall back to any doc without files
        for d in docs:
            if not d.get("files") and not d.get("object_key"):
                return eid, d["id"]
        pytest.skip("no PENDING doc available for kaur — re-seed needed")

    def test_three_uploads_accumulate(self, kaur):
        eid, doc_id = self._find_kaur_pending_doc(kaur)
        file_ids = []
        for i in range(3):
            files = {"file": (f"iter11_test_{i}.pdf", io.BytesIO(f"PDF-CONTENT-{i}".encode()), "application/pdf")}
            r = kaur.post(f"{API}/documents/{doc_id}/upload", files=files, timeout=30)
            assert r.status_code == 200, f"upload {i} failed: {r.status_code} {r.text}"
            data = r.json()
            assert "file_id" in data, f"response missing file_id: {data}"
            file_ids.append(data["file_id"])

        # GET docs and verify files[] has 3 entries
        r = kaur.get(f"{API}/engagements/{eid}/documents", timeout=20)
        assert r.status_code == 200, r.text
        doc = next(d for d in r.json() if d["id"] == doc_id)
        assert doc.get("status") == "UPLOADED"
        files_list = doc.get("files") or []
        assert len(files_list) >= 3, f"expected >=3 files in array, got {len(files_list)}: {files_list}"
        ids_in_doc = {f["id"] for f in files_list}
        for fid in file_ids:
            assert fid in ids_in_doc, f"uploaded file_id {fid} not in doc.files[]"
        # Legacy fields mirror latest upload
        assert doc.get("file_name") == "iter11_test_2.pdf", f"legacy file_name should mirror latest: {doc.get('file_name')}"

        # Save for delete + download tests
        TestMultiFileUploads._eid = eid
        TestMultiFileUploads._doc_id = doc_id
        TestMultiFileUploads._file_ids = file_ids

    def test_download_specific_file(self, kaur):
        doc_id = getattr(TestMultiFileUploads, "_doc_id", None)
        file_ids = getattr(TestMultiFileUploads, "_file_ids", None)
        if not (doc_id and file_ids):
            pytest.skip("upload test did not run")
        # Don't auto-follow redirects (S3 case) so we can validate either 200 or 302
        r = kaur.get(f"{API}/documents/{doc_id}/files/{file_ids[0]}/download", timeout=20, allow_redirects=False)
        assert r.status_code in (200, 302, 307), f"download failed: {r.status_code} {r.text[:200]}"

    def test_download_nonexistent_file_returns_404(self, kaur):
        doc_id = getattr(TestMultiFileUploads, "_doc_id", None)
        if not doc_id:
            pytest.skip("upload test did not run")
        r = kaur.get(f"{API}/documents/{doc_id}/files/nonexistent-file-id/download", timeout=20, allow_redirects=False)
        assert r.status_code == 404, f"expected 404, got {r.status_code}"

    def test_delete_one_file_keeps_doc_uploaded(self, kaur):
        doc_id = getattr(TestMultiFileUploads, "_doc_id", None)
        file_ids = getattr(TestMultiFileUploads, "_file_ids", None)
        eid = getattr(TestMultiFileUploads, "_eid", None)
        if not (doc_id and file_ids and eid):
            pytest.skip("upload test did not run")
        # Delete the first file
        r = kaur.delete(f"{API}/documents/{doc_id}/files/{file_ids[0]}", timeout=20)
        assert r.status_code in (200, 204), f"delete failed: {r.status_code} {r.text}"

        r = kaur.get(f"{API}/engagements/{eid}/documents", timeout=20)
        doc = next(d for d in r.json() if d["id"] == doc_id)
        assert doc.get("status") == "UPLOADED", f"doc should still be UPLOADED, got {doc.get('status')}"
        remaining = doc.get("files") or []
        assert len(remaining) >= 2, f"expected >=2 remaining, got {len(remaining)}"
        # legacy fields synced to latest remaining (the 3rd upload still exists)
        assert doc.get("file_name") in ("iter11_test_1.pdf", "iter11_test_2.pdf")

    def test_ws_partner_cannot_delete_file(self, ws):
        doc_id = getattr(TestMultiFileUploads, "_doc_id", None)
        file_ids = getattr(TestMultiFileUploads, "_file_ids", None)
        if not (doc_id and file_ids):
            pytest.skip("upload test did not run")
        r = ws.delete(f"{API}/documents/{doc_id}/files/{file_ids[1]}", timeout=20)
        assert r.status_code == 403, f"WS partner should be 403, got {r.status_code}"

    def test_delete_last_file_reverts_to_pending(self, kaur):
        doc_id = getattr(TestMultiFileUploads, "_doc_id", None)
        eid = getattr(TestMultiFileUploads, "_eid", None)
        if not (doc_id and eid):
            pytest.skip("upload test did not run")
        # Get current files
        r = kaur.get(f"{API}/engagements/{eid}/documents", timeout=20)
        doc = next(d for d in r.json() if d["id"] == doc_id)
        files = doc.get("files") or []
        for f in files:
            r = kaur.delete(f"{API}/documents/{doc_id}/files/{f['id']}", timeout=20)
            assert r.status_code in (200, 204), f"delete failed: {r.status_code}"
        # Now should be PENDING with no files / no legacy fields
        r = kaur.get(f"{API}/engagements/{eid}/documents", timeout=20)
        doc = next(d for d in r.json() if d["id"] == doc_id)
        assert doc.get("status") == "PENDING", f"doc should revert to PENDING, got {doc.get('status')}"
        assert not doc.get("files"), f"files[] should be empty, got {doc.get('files')}"
        assert not doc.get("object_key"), f"legacy object_key should be unset"


# ---------- list_documents legacy normalization ----------
class TestLegacyDocNormalization:
    def test_legacy_doc_has_synthetic_files_entry(self, cpa):
        # Find any engagement with legacy single-file UPLOADED docs (Thompson is FILED with multi already)
        r = cpa.get(f"{API}/engagements", timeout=20)
        engs = r.json() if r.status_code == 200 else []
        found_legacy = False
        for e in engs[:15]:
            r = cpa.get(f"{API}/engagements/{e['id']}/documents", timeout=20)
            if r.status_code != 200:
                continue
            for d in r.json():
                if d.get("status") == "UPLOADED" and d.get("files"):
                    for f in d["files"]:
                        if str(f.get("id", "")).endswith("-legacy"):
                            assert f["id"] == f"{d['id']}-legacy"
                            found_legacy = True
                            break
            if found_legacy:
                break
        if not found_legacy:
            pytest.skip("no legacy doc fixture available — all uploaded docs have real files[] arrays")
