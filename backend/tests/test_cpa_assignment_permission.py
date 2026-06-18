"""The assign_cpa / reassign_cpa permission gate on PATCH /engagements/{eid}.

In-process (no backend / MongoDB). Calls the real ``server.update_engagement``
via ``asyncio.run`` with a Mongo double.

Run: ``REACT_APP_BACKEND_URL=http://localhost:8001 \
        backend/.venv/bin/python -m pytest tests/test_cpa_assignment_permission.py``
(the URL is only needed because the shared conftest reads it at import; these
tests never make a network call.)
"""
import asyncio

import pytest
from fastapi import HTTPException

from server import update_engagement, UpdateEngagementIn
from cpa_assign_helpers import setup, engagement, corp, client, ADMIN, CPA1, CPA2


def test_seeded_admin_without_permissions_map_can_assign(monkeypatch):
    """ADMIN carries no explicit permissions map (auth.seed_admin) — the gate
    must fall back to role defaults (all-true) and NOT lock the admin out."""
    eng = engagement(assigned=None)
    _db, sent, _notes = setup(
        monkeypatch, eng=eng, users=[ADMIN, CPA1, client()], corps=[corp()]
    )
    assert "permissions" not in ADMIN  # precondition: mirrors the seeded admin

    out = asyncio.run(update_engagement(
        "eng-1", UpdateEngagementIn(assigned_cpa_id="cpa-1"), user=ADMIN
    ))
    assert out["assigned_cpa_id"] == "cpa-1"


def test_cpa_without_reassign_permission_is_blocked(monkeypatch):
    """A CPA (no permissions map → default reassign_cpa=False) cannot reassign
    an already-assigned engagement. 403, no email, assignment unchanged."""
    eng = engagement(assigned="cpa-1")
    _db, sent, _notes = setup(
        monkeypatch, eng=eng, users=[ADMIN, CPA1, CPA2], corps=[corp()]
    )

    with pytest.raises(HTTPException) as ei:
        asyncio.run(update_engagement(
            "eng-1", UpdateEngagementIn(assigned_cpa_id="cpa-2"), user=CPA1
        ))
    assert ei.value.status_code == 403
    assert "reassign" in str(ei.value.detail).lower()
    assert not [s for s in sent if s[1] == "cpa_client_assigned"]
    assert eng["assigned_cpa_id"] == "cpa-1"  # untouched


def test_non_assignment_update_keeps_role_only_gate(monkeypatch):
    """A non-assignment field update is NOT subject to the permission gate — it
    keeps the existing role-only authorization so CPA/admin workflows are
    unaffected."""
    eng = engagement(assigned="cpa-1")
    _db, _sent, _notes = setup(monkeypatch, eng=eng, users=[ADMIN, CPA1], corps=[corp()])

    out = asyncio.run(update_engagement(
        "eng-1", UpdateEngagementIn(notes="ok"), user=CPA1
    ))
    assert out["notes"] == "ok"
