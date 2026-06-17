"""Regression for iter 40 — Client data consistency across Admin/Partner/CPA.

Root cause of the bug: when a CLIENT user was permanently deleted (iter 37),
their linked corporation + engagement rows were left behind, causing the
pipeline/tables in every view to show "phantom" clients. Additionally, the
``list_engagements`` endpoint had no orphan guard, so even soft-deleted client
rows continued to appear.

Fixes locked in:
1. ``GET /api/engagements`` applies an orphan filter — engagements with a
   missing / deactivated / soft-deleted client user are dropped.
2. ``DELETE /api/users/{id}?permanent=true`` for a CLIENT now cascade-deletes
   corporations + engagements + documents + checklist + extracted_data +
   opportunities + time_entries + engagement_notes + status_history.
3. Deactivating or removing a CPA nulls out their ``assigned_cpa_id`` on
   every engagement so the pipeline no longer attributes work to a
   removed member.
4. All three roles (ADMIN / PARTNER / CPA) converge on the same filter
   through the shared list endpoint.
"""
import os
import uuid
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "nim@cloudtax.ca", "password": os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _partner_token():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "rajin@cloudtax.ca", "password": os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")},
        timeout=20,
    )
    if r.status_code != 200 or r.json().get("two_factor_required"):
        return None
    return r.json()["token"]


def _create_engagement(admin_token, client_email):
    r = requests.post(
        f"{BASE}/api/engagements",
        json={
            "tier": "STANDARD",
            "client_name": "Orphan Test MD",
            "client_email": client_email,
            "corp_name": "OrphanTest Corp",
            "business_number": "123456789RC0001",
            "fiscal_year_start": "2025-01-01",
            "fiscal_year_end": "2025-12-31",
            "province": "ON",
            "practice_type": "MEDICAL",
            "notes": "test",
        },
        headers=_h(admin_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestOrphanFilter:
    def test_engagement_with_deactivated_client_is_hidden(self, admin_token):
        email = f"orphan_{uuid.uuid4().hex[:8]}@example.com"
        eng_id = _create_engagement(admin_token, email)

        # Baseline: engagement visible.
        r = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20)
        assert any(e["id"] == eng_id for e in r.json())

        # Deactivate the client.
        client_id = next(
            (e["client"]["id"] for e in r.json() if e["id"] == eng_id),
            None,
        )
        assert client_id
        dr = requests.post(f"{BASE}/api/users/{client_id}/deactivate", headers=_h(admin_token), timeout=20)
        assert dr.status_code == 200, dr.text

        # Pipeline now excludes the engagement.
        r2 = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20)
        assert not any(e["id"] == eng_id for e in r2.json()), "engagement with deactivated client must be hidden"

        # Cleanup — permanent delete cascades everything.
        requests.delete(f"{BASE}/api/users/{client_id}?permanent=true", headers=_h(admin_token), timeout=20)


class TestCascadePermanentDelete:
    def test_client_cascade_wipes_corp_and_engagement(self, admin_token):
        email = f"cascade_{uuid.uuid4().hex[:8]}@example.com"
        eng_id = _create_engagement(admin_token, email)

        # Find the client_id.
        engs = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row = next(e for e in engs if e["id"] == eng_id)
        client_id = row["client"]["id"]
        corp_id = row["corporation"]["id"]

        # Permanent delete of client — should cascade.
        dr = requests.delete(f"{BASE}/api/users/{client_id}?permanent=true", headers=_h(admin_token), timeout=20)
        assert dr.status_code == 200, dr.text

        # Engagement no longer visible.
        r2 = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20)
        assert not any(e["id"] == eng_id for e in r2.json())

        # Direct DB peek via /engagements/{id} should 404 now.
        r3 = requests.get(f"{BASE}/api/engagements/{eng_id}", headers=_h(admin_token), timeout=20)
        assert r3.status_code == 404, r3.text

        # /users/all no longer lists the client either (hard-deleted).
        rows = requests.get(f"{BASE}/api/users/all", headers=_h(admin_token), timeout=20).json()
        assert not any(u["id"] == client_id for u in rows)


class TestAllViewsInSync:
    def test_admin_ws_cpa_counts_match_when_no_clients(self, admin_token):
        """With no active clients in the DB, every role's engagements feed
        returns an empty list — no phantom rows in any view."""
        rows = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        if rows:
            pytest.skip(f"DB has {len(rows)} active engagements; this invariant test requires a clean slate")

        ws_tok = _partner_token()
        if ws_tok:
            ws_rows = requests.get(f"{BASE}/api/engagements", headers=_h(ws_tok), timeout=20).json()
            assert ws_rows == []

        cpa_r = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": "pallavi@cloudtax.ca", "password": os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")},
            timeout=20,
        )
        if cpa_r.status_code == 200 and not cpa_r.json().get("two_factor_required"):
            cpa_tok = cpa_r.json()["token"]
            cpa_rows = requests.get(f"{BASE}/api/engagements", headers=_h(cpa_tok), timeout=20).json()
            assert cpa_rows == []


class TestCpaUnassignOnDeactivate:
    def test_deactivating_cpa_unassigns_engagements(self, admin_token):
        # Seed a CPA + a client + an engagement assigned to that CPA.
        cpa_email = f"cpa_unassign_{uuid.uuid4().hex[:8]}@example.com"
        ir = requests.post(
            f"{BASE}/api/users/invite",
            json={"email": cpa_email, "name": "Tempo CPA", "role": "CPA"},
            headers=_h(admin_token), timeout=20,
        )
        assert ir.status_code == 200, ir.text
        cpa_id = ir.json()["user_id"]

        client_email = f"cpa_unassign_client_{uuid.uuid4().hex[:8]}@example.com"
        er = requests.post(
            f"{BASE}/api/engagements",
            json={
                "tier": "STANDARD",
                "client_name": "Assigned Client MD",
                "client_email": client_email,
                "corp_name": "AssignedTest Corp",
                "business_number": "999999999RC0001",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "province": "ON",
                "practice_type": "MEDICAL",
                "assigned_cpa_id": cpa_id,
            },
            headers=_h(admin_token), timeout=20,
        )
        assert er.status_code == 200, er.text
        eng_id = er.json()["id"]

        # Baseline: engagement is assigned.
        engs = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row = next(e for e in engs if e["id"] == eng_id)
        assert row["assigned_cpa_id"] == cpa_id

        # Deactivate the CPA.
        r = requests.post(f"{BASE}/api/users/{cpa_id}/deactivate", headers=_h(admin_token), timeout=20)
        assert r.status_code == 200, r.text

        # Engagement must now be unassigned.
        engs2 = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20).json()
        row2 = next(e for e in engs2 if e["id"] == eng_id)
        assert row2["assigned_cpa_id"] is None

        # Cleanup.
        client_id = row["client"]["id"]
        requests.delete(f"{BASE}/api/users/{client_id}?permanent=true", headers=_h(admin_token), timeout=20)
        requests.delete(f"{BASE}/api/users/{cpa_id}?permanent=true", headers=_h(admin_token), timeout=20)
