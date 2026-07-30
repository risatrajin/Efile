"""Plan selection + DIY handoff (Phase: plans).

Four client-facing plans (NIL, BASIC_DIY, REVIEW_FILE, DFY) with service_model
derived server-side. NIL requires a no-activity declaration and stores a
Pay-What-You-Want nil_amount (int >= 0). DIY plans seed no documents and the
payload carries diy_engine_url (from backend env DIY_ENGINE_URL, null when
unset). DFY plans seed the 8 base documents and keep the CPA pipeline.

Shares the module-scoped registered user across tests (one /auth/register
call) to stay inside the per-IP register cap alongside the other suite.
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _login(email, password=PWD):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("nim@cloudtax.ca")


@pytest.fixture(scope="module")
def client():
    email = f"test_plans_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{BASE}/api/auth/register", json={"email": email, "password": "SelfServe2026!", "first_name": "Test", "last_name": "Plans"}, timeout=20)
    if r.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min) — rerun after the window")
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return {"email": email, "token": r.json()["token"]}


def _self_start(token, plan, **extra):
    payload = {
        "corp_name": f"TEST Plan {plan} {uuid.uuid4().hex[:6]}",
        "province": "ON",
        "fiscal_year_end": "2026-12-31",
        "plan": plan,
        **extra,
    }
    return requests.post(f"{BASE}/api/engagements/self-start", headers=_h(token), json=payload, timeout=20)


def _docs(token, eid):
    r = requests.get(f"{BASE}/api/engagements/{eid}/documents", headers=_h(token), timeout=20)
    assert r.status_code == 200
    return r.json()


# ---------- NIL ----------

def test_nil_requires_declaration(client):
    r = _self_start(client["token"], "NIL", nil_amount=0)
    assert r.status_code == 400
    assert "declaration" in r.json().get("detail", "").lower()


def test_nil_amount_negative_rejected(client):
    r = _self_start(client["token"], "NIL", nil_declaration=True, nil_amount=-5)
    assert r.status_code == 400


def test_nil_creates_diy_engagement_no_docs(client, admin_token):
    r = _self_start(client["token"], "NIL", nil_declaration=True, nil_amount=25)
    assert r.status_code == 200, r.text
    eng = r.json()
    assert eng["plan"] == "NIL"
    assert eng["service_model"] == "DIY"
    assert eng["nil_amount"] == 25
    assert eng["status"] == "INTAKE"
    # diy_engine_url key present (null while env unset) — the handoff switch.
    assert "diy_engine_url" in eng
    # No documents seeded for DIY plans.
    assert _docs(client["token"], eng["id"]) == []
    # Tier still hidden.
    assert eng.get("tier") is None
    # Admin notification: plan label, no CPA sentence for DIY.
    r = requests.get(f"{BASE}/api/notifications", headers=_h(admin_token), timeout=20)
    mine = [n for n in r.json() if n.get("engagement_id") == eng["id"]]
    assert mine and "started a T2 DIY + Support 365 filing." in mine[0]["message"]
    assert "Assign a CPA" not in mine[0]["message"]


def test_nil_amount_defaults_zero(client):
    r = _self_start(client["token"], "NIL", nil_declaration=True)
    assert r.status_code == 200, r.text
    assert r.json()["nil_amount"] == 0


# ---------- BASIC_DIY ----------

def test_basic_diy_no_docs_no_nil_amount(client):
    r = _self_start(client["token"], "BASIC_DIY", nil_amount=999)
    assert r.status_code == 200, r.text
    eng = r.json()
    assert eng["plan"] == "BASIC_DIY"
    assert eng["service_model"] == "DIY"
    # nil_amount is NIL-only — ignored for other plans.
    assert eng.get("nil_amount") is None
    assert "diy_engine_url" in eng
    assert _docs(client["token"], eng["id"]) == []


# ---------- REVIEW_FILE / DFY ----------

@pytest.mark.parametrize("plan,label", [("REVIEW_FILE", "Full Review & Filing"), ("DFY", "Economy")])
def test_dfy_plans_seed_docs_and_notify(client, admin_token, plan, label):
    r = _self_start(client["token"], plan)
    assert r.status_code == 200, r.text
    eng = r.json()
    assert eng["plan"] == plan
    assert eng["service_model"] == "DFY"
    assert eng["status"] == "INTAKE"
    # DIY handoff key absent for DFY plans.
    assert "diy_engine_url" not in eng
    docs = _docs(client["token"], eng["id"])
    assert len(docs) == 8, f"{plan}: expected 8 base docs, got {len(docs)}"
    r = requests.get(f"{BASE}/api/notifications", headers=_h(admin_token), timeout=20)
    mine = [n for n in r.json() if n.get("engagement_id") == eng["id"]]
    assert mine, f"no admin notification for {plan}"
    article = "an" if label[:1].lower() in "aeiou" else "a"
    assert f"started {article} {label} filing. Assign a CPA to begin intake." in mine[0]["message"]


# ---------- Dashboard payload / legacy ----------

def test_dashboard_rows_expose_plan_never_tier(client):
    r = requests.get(f"{BASE}/api/engagements", headers=_h(client["token"]), timeout=20)
    assert r.status_code == 200
    rows = r.json()
    assert rows, "expected engagements"
    for e in rows:
        assert e.get("tier") is None
        assert e.get("original_tier") is None
        assert e.get("plan") in ("NIL", "BASIC_DIY", "REVIEW_FILE", "DFY")


def test_legacy_engagement_has_no_plan(admin_token):
    """Pilot engagements (seeded demo data) predate plans — no plan key value,
    no nil_amount, portal behavior unchanged. Uses admin list to find a legacy
    (tier-bearing) engagement."""
    r = requests.get(f"{BASE}/api/engagements", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    legacy = [e for e in r.json() if e.get("tier")]
    if not legacy:
        pytest.skip("no legacy tier-bearing engagements in this database")
    for e in legacy:
        assert not e.get("plan"), f"legacy engagement {e['id']} unexpectedly has plan={e.get('plan')}"
