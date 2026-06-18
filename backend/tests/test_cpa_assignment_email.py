"""The "New client assigned" email fires when an admin assigns a CPA.

In-process (no backend / MongoDB needed — Resend is a no-op in dev, so the live
integration suite cannot observe this). Calls the real
``server.update_engagement`` via ``asyncio.run`` with a Mongo double.

Run: ``REACT_APP_BACKEND_URL=http://localhost:8001 \
        backend/.venv/bin/python -m pytest tests/test_cpa_assignment_email.py``
(the URL is only needed because the shared conftest reads it at import; these
tests never make a network call.)
"""
import asyncio

from server import update_engagement, UpdateEngagementIn
from cpa_assign_helpers import setup, engagement, corp, client, ADMIN, CPA1


def test_assign_fires_email_and_keeps_bell(monkeypatch):
    """Admin assigns a CPA to an unassigned (REFERRED) engagement → the
    cpa_client_assigned email fires to that CPA, ALONGSIDE the in-app bell."""
    eng = engagement(assigned=None)
    _db, sent, notifications = setup(
        monkeypatch, eng=eng, users=[ADMIN, CPA1, client()], corps=[corp()]
    )

    out = asyncio.run(update_engagement(
        "eng-1", UpdateEngagementIn(assigned_cpa_id="cpa-1"), user=ADMIN
    ))

    assert out["assigned_cpa_id"] == "cpa-1"

    assigned_emails = [s for s in sent if s[1] == "cpa_client_assigned"]
    assert len(assigned_emails) == 1, f"expected exactly one assignment email, got {sent}"
    to, _, data = assigned_emails[0]
    assert to == "pallavi@cloudtax.ca"
    assert data["client_name"] == "Dr Chen"
    assert data["corporation_name"] == "TEST Medical Prof Corp"
    assert data["tier"] == "STANDARD"
    assert data["link"].endswith("/cpa/engagement/eng-1")

    # The bell notification is kept alongside the email (not replaced).
    assert any(n["user_id"] == "cpa-1" and n["type"] == "cpa_assigned" for n in notifications), \
        "in-app cpa_assigned notification must still fire"


def test_unrelated_update_sends_no_assignment_email(monkeypatch):
    """Updating a non-assignment field never sends the assignment email."""
    eng = engagement(assigned="cpa-1")
    _db, sent, _notes = setup(monkeypatch, eng=eng, users=[ADMIN, CPA1], corps=[corp()])

    asyncio.run(update_engagement(
        "eng-1", UpdateEngagementIn(notes="internal note"), user=ADMIN
    ))
    assert not [s for s in sent if s[1] == "cpa_client_assigned"]


def test_reassigning_same_cpa_sends_no_email(monkeypatch):
    """PATCHing assigned_cpa_id to the value it already holds is not a change —
    no email, no duplicate bell."""
    eng = engagement(assigned="cpa-1")
    _db, sent, notifications = setup(
        monkeypatch, eng=eng, users=[ADMIN, CPA1, client()], corps=[corp()]
    )

    asyncio.run(update_engagement(
        "eng-1", UpdateEngagementIn(assigned_cpa_id="cpa-1"), user=ADMIN
    ))
    assert not [s for s in sent if s[1] == "cpa_client_assigned"]
    assert not [n for n in notifications if n.get("type") == "cpa_assigned"]
