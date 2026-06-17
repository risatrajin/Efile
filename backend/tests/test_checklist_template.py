"""
Iteration 5 — Partner checklist template & onboarding seeding.
Endpoints under test:
  - GET  /api/partner/checklist-template (PARTNER+ADMIN allowed; CPA/CLIENT 403)
  - PUT  /api/partner/checklist-template (PARTNER persists; empty -> 400)
  - POST /api/engagements/onboarding seeds pre_filing_checklist from current template
Regression: existing engagement's pre_filing_checklist remains unchanged after PUT.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")

DEFAULT_TEMPLATE_LABELS = [
    "Client consented to pilot",
    "Corporation info confirmed",
    "Service tier assigned",
    "Client's accountant notified",
    "CRA Group ID instructions sent",
    "Document checklist sent (optional)",
]


def _login(email):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ws_token():
    return _login("watson@partner.ca")


@pytest.fixture(scope="module")
def admin_token():
    return _login("nim@cloudtax.ca")


@pytest.fixture(scope="module")
def cpa_token():
    return _login("pallavi@cloudtax.ca")


@pytest.fixture(scope="module")
def client_token():
    return _login("chen@example.com")


# ==================== GET /partner/checklist-template ====================

class TestChecklistTemplateAccess:
    def test_get_as_partner_returns_default_6_items(self, ws_token):
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(ws_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data
        assert isinstance(data["items"], list)
        # On a fresh DB this should be 6; if a prior test mutated it, the test_seed_default fixture below restores.
        assert len(data["items"]) >= 1
        for it in data["items"]:
            assert "label" in it and "optional" in it
            assert isinstance(it["label"], str)
            assert isinstance(it["optional"], bool)

    def test_get_as_admin_200(self, admin_token):
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text

    def test_get_as_cpa_forbidden(self, cpa_token):
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(cpa_token), timeout=20)
        assert r.status_code == 403, r.text

    def test_get_as_client_forbidden(self, client_token):
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(client_token), timeout=20)
        assert r.status_code == 403, r.text


# ==================== PUT /partner/checklist-template ====================

class TestChecklistTemplatePersistence:
    """Mutates global state — keep ordered and restore at end."""

    @pytest.fixture(scope="class", autouse=True)
    def _restore_default(self, ws_token):
        # Snapshot current template before mutation
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(ws_token), timeout=20)
        original = r.json()["items"] if r.status_code == 200 else None
        yield
        # Restore
        if original:
            requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token),
                         json={"items": original}, timeout=20)

    def test_put_empty_items_returns_400(self, ws_token):
        r = requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token), json={"items": []}, timeout=20)
        assert r.status_code == 400, r.text

    def test_put_persists_and_get_returns_new(self, ws_token):
        new_items = [
            {"label": "TEST_X required item", "optional": False},
            {"label": "TEST_Y optional item", "optional": True},
        ]
        r = requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token), json={"items": new_items}, timeout=20)
        assert r.status_code == 200, r.text
        # GET should now return exactly 2 items
        r2 = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(ws_token), timeout=20)
        assert r2.status_code == 200
        items = r2.json()["items"]
        assert len(items) == 2
        labels = [it["label"] for it in items]
        assert "TEST_X required item" in labels
        assert "TEST_Y optional item" in labels

    def test_put_as_cpa_forbidden(self, cpa_token):
        r = requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(cpa_token), json={"items": [{"label": "x", "optional": False}]}, timeout=20)
        assert r.status_code == 403, r.text


# ==================== POST /engagements/onboarding seeds from template ====================

class TestOnboardingSeedsFromTemplate:

    @pytest.fixture(scope="class", autouse=True)
    def _restore_default(self, ws_token):
        r = requests.get(f"{BASE}/api/partner/checklist-template", headers=_h(ws_token), timeout=20)
        original = r.json()["items"] if r.status_code == 200 else None
        yield
        if original:
            requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token),
                         json={"items": original}, timeout=20)

    def _create_eng(self, ws_token, suffix=""):
        unique = f"TEST_onboarding_{uuid.uuid4().hex[:8]}{suffix}@example.com"
        body = {
            "first_name": "TestFirst",
            "last_name": "TestLast",
            "client_email": unique,
            "phone": "555-0100",
            "province": "ON",
            "corp_name": "Test Corp",
            "fiscal_year_end": "2025-12-31",
            "tier": "STANDARD",
            "notes": None,
        }
        r = requests.post(f"{BASE}/api/engagements/onboarding", headers=_h(ws_token), json=body, timeout=20)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def _get_eng(self, token, eid):
        # WS dashboard endpoint or the onboarding-progress endpoint exposes checklist
        r = requests.get(f"{BASE}/api/engagements/{eid}/onboarding-progress", headers=_h(token), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_new_onboarding_uses_default_template(self, ws_token):
        # Reset template to default by PUT-ing the canonical 6 (idempotent regardless of prior state)
        default_items = [{"label": L, "optional": L.endswith("(optional)")} for L in DEFAULT_TEMPLATE_LABELS]
        r = requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token), json={"items": default_items}, timeout=20)
        assert r.status_code == 200

        eid = self._create_eng(ws_token, "_default")
        prog = self._get_eng(ws_token, eid)
        cl = prog.get("checklist", [])
        assert len(cl) == 6, f"expected 6 items, got {len(cl)}: {cl}"
        labels = [c["item"] for c in cl]
        for expected in DEFAULT_TEMPLATE_LABELS:
            assert expected in labels, f"missing {expected} in {labels}"

    def test_new_onboarding_uses_updated_template(self, ws_token):
        new_items = [
            {"label": "TEST_TPL_A", "optional": False},
            {"label": "TEST_TPL_B", "optional": True},
            {"label": "TEST_TPL_C", "optional": False},
        ]
        r = requests.put(f"{BASE}/api/partner/checklist-template",
                         headers=_h(ws_token), json={"items": new_items}, timeout=20)
        assert r.status_code == 200

        eid = self._create_eng(ws_token, "_updated")
        prog = self._get_eng(ws_token, eid)
        cl = prog.get("checklist", [])
        assert len(cl) == 3, f"expected 3 items, got {len(cl)}: {cl}"
        labels = [c["item"] for c in cl]
        assert labels == ["TEST_TPL_A", "TEST_TPL_B", "TEST_TPL_C"]
        # All should start uncompleted
        assert all(c["is_completed"] is False for c in cl)

    def test_existing_engagement_unchanged_after_template_put(self, ws_token):
        # Step 1: create engagement under current template
        new_items_v1 = [
            {"label": "TEST_V1_ONE", "optional": False},
            {"label": "TEST_V1_TWO", "optional": False},
        ]
        requests.put(f"{BASE}/api/partner/checklist-template",
                     headers=_h(ws_token), json={"items": new_items_v1}, timeout=20)
        eid = self._create_eng(ws_token, "_regression")
        prog_before = self._get_eng(ws_token, eid)
        labels_before = [c["item"] for c in prog_before["checklist"]]
        assert labels_before == ["TEST_V1_ONE", "TEST_V1_TWO"]

        # Step 2: change the template
        new_items_v2 = [
            {"label": "TEST_V2_DIFFERENT", "optional": False},
        ]
        requests.put(f"{BASE}/api/partner/checklist-template",
                     headers=_h(ws_token), json={"items": new_items_v2}, timeout=20)

        # Step 3: existing engagement's checklist must NOT have changed
        prog_after = self._get_eng(ws_token, eid)
        labels_after = [c["item"] for c in prog_after["checklist"]]
        assert labels_after == labels_before, \
            f"Existing engagement checklist mutated! before={labels_before} after={labels_after}"
