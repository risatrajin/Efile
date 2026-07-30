"""Admin DFY/DIY split (backend fields) + CPA-queue DIY exclusion.

In-process (no backend / MongoDB) — see admin_dashboard_helpers.py. Frontend
rendering (kanban never showing DIY, tab counts, badges, hidden detail
sections) has no JS test runner in this repo and is verified manually in the
browser instead; these tests cover everything the backend contract promises
the frontend.
"""
import asyncio

from server import list_engagements, partner_status_label

from admin_dashboard_helpers import (
    setup, ADMIN, CPA1, corp, client, diy_engagement, dfy_engagement,
)


def test_admin_sees_t2_filing_state_on_both_service_models(monkeypatch):
    """t2_filing_state used to be PARTNER-only (serialize_for_ownr_partner /
    redact_for_ws). Admin's DIY table depends on the same shared helper."""
    diy = diy_engagement(plan="NIL")
    dfy = dfy_engagement()
    setup(
        monkeypatch,
        engagements=[diy, dfy],
        users=[client()],
        corporations=[corp()],
    )

    out = asyncio.run(list_engagements(user=ADMIN))
    by_id = {e["id"]: e for e in out}
    assert by_id["eng-diy-1"]["t2_filing_state"] == "Started"
    assert by_id["eng-dfy-1"]["t2_filing_state"] == "Started"  # REFERRED -> "Started"


def test_diy_engine_opened_reflected_in_admin_status(monkeypatch):
    diy = diy_engagement(plan="BASIC_DIY")
    diy["diy_engine_opened_at"] = "2026-01-01T00:00:00Z"
    setup(monkeypatch, engagements=[diy], users=[client()], corporations=[corp()])

    out = asyncio.run(list_engagements(user=ADMIN))
    assert out[0]["t2_filing_state"] == "In progress"


def test_diy_filed_status_is_submitted(monkeypatch):
    diy = diy_engagement(plan="NIL")
    diy["status"] = "FILED"
    setup(monkeypatch, engagements=[diy], users=[client()], corporations=[corp()])

    out = asyncio.run(list_engagements(user=ADMIN))
    assert out[0]["t2_filing_state"] == "Submitted"


def test_cpa_queue_excludes_diy_even_with_forced_legacy_assignment(monkeypatch):
    """CPA-facing queues must never contain DIY engagements. The assignment
    guard (test_cpa_assignment_permission.py) should make this impossible in
    practice; this is the defense-in-depth belt for a hand-edited/legacy row
    that somehow carries both fields."""
    rogue_diy = diy_engagement(eid="eng-diy-rogue", assigned_cpa_id="cpa-1", plan="NIL")
    real_dfy = dfy_engagement(eid="eng-dfy-real", assigned_cpa_id="cpa-1")
    setup(
        monkeypatch,
        engagements=[rogue_diy, real_dfy],
        users=[client()],
        corporations=[corp()],
    )

    out = asyncio.run(list_engagements(user=CPA1))
    ids = [e["id"] for e in out]
    assert "eng-diy-rogue" not in ids
    assert "eng-dfy-real" in ids


def test_cpa_queue_normal_case_unaffected(monkeypatch):
    """Regression: a CPA's ordinary DFY assignment list is untouched by the
    new query clause."""
    a = dfy_engagement(eid="eng-a", assigned_cpa_id="cpa-1", corp_id="corp-1")
    b = dfy_engagement(eid="eng-b", assigned_cpa_id="cpa-1", corp_id="corp-2")
    other = dfy_engagement(eid="eng-c", assigned_cpa_id="someone-else", corp_id="corp-3")
    setup(
        monkeypatch,
        engagements=[a, b, other],
        users=[client("client-1"), client("client-2"), client("client-3")],
        corporations=[corp("corp-1", "client-1"), corp("corp-2", "client-2"), corp("corp-3", "client-3")],
    )

    out = asyncio.run(list_engagements(user=CPA1))
    ids = {e["id"] for e in out}
    assert ids == {"eng-a", "eng-b"}


def test_partner_status_label_pure_function_diy_states():
    """Direct unit coverage of the shared helper's three DIY states — the
    single source of truth every role's t2_filing_state now reads from."""
    started = {"service_model": "DIY", "status": "INTAKE", "diy_engine_opened_at": None}
    in_progress = {"service_model": "DIY", "status": "INTAKE", "diy_engine_opened_at": "x"}
    submitted = {"service_model": "DIY", "status": "FILED", "diy_engine_opened_at": "x"}
    assert partner_status_label(started) == "Started"
    assert partner_status_label(in_progress) == "In progress"
    assert partner_status_label(submitted) == "Submitted"
