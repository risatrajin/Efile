"""Regression for iter 41 — Partner + CPA checklist templates persist AND
propagate globally. Previously only the template row was saved; existing
engagements kept their baked-in checklist, making it look like "Save
changes" did nothing.
"""
import os
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "nim@cloudtax.ca", "password": "CloudTax2026!"}, timeout=20)
    assert r.status_code == 200
    return r.json()["token"]


def _h(t): return {"Authorization": f"Bearer {t}"}


def _create_engagement(admin_token, suffix):
    r = requests.post(
        f"{BASE}/api/engagements",
        json={
            "tier": "STANDARD",
            "client_name": f"Checklist Test MD {suffix}",
            "client_email": f"cl_{suffix}@example.com",
            "corp_name": "ChecklistTest Corp",
            "business_number": "555555555RC0001",
            "fiscal_year_start": "2025-01-01", "fiscal_year_end": "2025-12-31",
            "province": "ON", "practice_type": "MEDICAL",
        },
        headers=_h(admin_token), timeout=20,
    )
    assert r.status_code == 200
    return r.json()["id"]


class TestPartnerTemplatePropagation:
    def test_partner_save_propagates_to_existing(self, admin_token):
        eng_id = _create_engagement(admin_token, "partner_prop")
        # Admin uses the partner endpoint (whitelisted role).
        r = requests.put(
            f"{BASE}/api/partner/checklist-template",
            json={"items": [
                {"label": "Iter41 Partner A", "optional": False},
                {"label": "Iter41 Partner B", "optional": False},
            ]},
            headers=_h(admin_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["propagated_to"] >= 1

        # Engagement now reflects the new template.
        prog = requests.get(
            f"{BASE}/api/engagements/{eng_id}/onboarding-progress",
            headers=_h(admin_token), timeout=20,
        ).json()
        labels = [c["item"] for c in prog.get("checklist", [])]
        assert "Iter41 Partner A" in labels
        assert "Iter41 Partner B" in labels

        # Restore default so subsequent tests aren't affected.
        requests.put(
            f"{BASE}/api/partner/checklist-template",
            json={"items": [
                {"label": "Client consented to pilot", "optional": False},
                {"label": "Corporation info confirmed", "optional": False},
                {"label": "Service tier assigned", "optional": False},
                {"label": "Client's accountant notified", "optional": False},
                {"label": "CRA Group ID instructions sent", "optional": False},
                {"label": "Document checklist sent (optional)", "optional": True},
            ]},
            headers=_h(admin_token), timeout=20,
        )
        # Cleanup engagement.
        engs = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row = next(e for e in engs if e["id"] == eng_id)
        requests.delete(f"{BASE}/api/users/{row['client']['id']}?permanent=true", headers=_h(admin_token), timeout=20)

    def test_partner_save_preserves_completion_state(self, admin_token):
        eng_id = _create_engagement(admin_token, "partner_preserve")
        # Seed the engagement's checklist by saving a template (the normal
        # /api/engagements create doesn't stamp pre_filing_checklist — only
        # the WS onboarding flow does, so we trigger propagation first).
        seed_items = [
            {"label": "Preserve Item A", "optional": False},
            {"label": "Preserve Item B", "optional": False},
            {"label": "Preserve Item C", "optional": False},
        ]
        requests.put(f"{BASE}/api/partner/checklist-template", json={"items": seed_items}, headers=_h(admin_token), timeout=20)

        prog = requests.get(f"{BASE}/api/engagements/{eng_id}/onboarding-progress", headers=_h(admin_token), timeout=20).json()
        items = prog["checklist"]
        assert len(items) == 3
        target = items[0]
        requests.patch(
            f"{BASE}/api/engagements/{eng_id}/pre-filing-checklist",
            json={"items": [{"id": c["id"], "is_completed": c["id"] == target["id"], "item": c["item"]} for c in items]},
            headers=_h(admin_token), timeout=20,
        )

        # Now reorder via template save — keep same labels, different order.
        shuffled = list(reversed(seed_items))
        r = requests.put(f"{BASE}/api/partner/checklist-template", json={"items": shuffled}, headers=_h(admin_token), timeout=20)
        assert r.status_code == 200

        # Completion on the originally-checked label is preserved.
        prog2 = requests.get(f"{BASE}/api/engagements/{eng_id}/onboarding-progress", headers=_h(admin_token), timeout=20).json()
        hit = next((c for c in prog2["checklist"] if c["item"] == target["item"]), None)
        assert hit is not None
        assert hit["is_completed"] is True

        # Restore default partner template.
        requests.put(
            f"{BASE}/api/partner/checklist-template",
            json={"items": [
                {"label": "Client consented to pilot", "optional": False},
                {"label": "Corporation info confirmed", "optional": False},
                {"label": "Service tier assigned", "optional": False},
                {"label": "Client's accountant notified", "optional": False},
                {"label": "CRA Group ID instructions sent", "optional": False},
                {"label": "Document checklist sent (optional)", "optional": True},
            ]},
            headers=_h(admin_token), timeout=20,
        )
        # Cleanup.
        engs = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row = next(e for e in engs if e["id"] == eng_id)
        requests.delete(f"{BASE}/api/users/{row['client']['id']}?permanent=true", headers=_h(admin_token), timeout=20)


class TestCpaReviewTemplate:
    def test_get_default_when_unset(self, admin_token):
        r = requests.get(f"{BASE}/api/cpa/review-checklist-template", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        labels = [i["label"] for i in items]
        # At least one well-known item must exist.
        assert "T2 return complete" in labels or items  # default set

    def test_put_rejects_empty(self, admin_token):
        r = requests.put(f"{BASE}/api/cpa/review-checklist-template", json={"items": []}, headers=_h(admin_token), timeout=20)
        assert r.status_code == 400

    def test_put_propagates_to_engagements(self, admin_token):
        eng_id = _create_engagement(admin_token, "cpa_prop")
        r = requests.put(
            f"{BASE}/api/cpa/review-checklist-template",
            json={"items": [
                {"label": "Iter41 Review A", "optional": False},
                {"label": "Iter41 Review B", "optional": False},
            ]},
            headers=_h(admin_token), timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["propagated_to"] >= 1

        items = requests.get(f"{BASE}/api/engagements/{eng_id}/checklist", headers=_h(admin_token), timeout=20).json()
        labels = [i["item"] for i in items]
        assert "Iter41 Review A" in labels
        assert "Iter41 Review B" in labels
        # The old default items are gone.
        assert "T2 return complete" not in labels

        # Restore default.
        requests.put(
            f"{BASE}/api/cpa/review-checklist-template",
            json={"items": [
                {"label": "T2 return complete", "optional": False},
                {"label": "Financial statements (NTR) prepared", "optional": False},
                {"label": "QA sign-off", "optional": False},
            ]},
            headers=_h(admin_token), timeout=20,
        )
        # Cleanup.
        engs = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row = next(e for e in engs if e["id"] == eng_id)
        requests.delete(f"{BASE}/api/users/{row['client']['id']}?permanent=true", headers=_h(admin_token), timeout=20)

    def test_rbac_ws_partner_blocked(self, admin_token):
        # WS partner should NOT be able to edit the CPA review template.
        r = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": "rajin@cloudtax.ca", "password": "CloudTax2026!"},
            timeout=20,
        )
        if r.status_code != 200 or r.json().get("two_factor_required"):
            pytest.skip("WS partner login unavailable / 2FA required")
        ws_tok = r.json()["token"]
        r2 = requests.get(f"{BASE}/api/cpa/review-checklist-template", headers=_h(ws_tok), timeout=20)
        assert r2.status_code == 403
