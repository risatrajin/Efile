"""Ownr partner dashboard (Phase: ownr-handoff).

Covers the PARTNER-facing view of Ownr-sourced engagements:
  - Visibility: PARTNER sees OWNR + legacy pilot (no `source`) rows, never
    SELF_SERVE rows (data-minimization — self-serve clients have no Ownr
    relationship).
  - Payload: OWNR rows go through the allowlist serializer — id, company_name,
    email, name, t2_filing_state, t2_filing_type, plan_label, tax_year,
    created_at + filing extras, nothing else (no tier, raw plan key,
    nil_amount, notes, extracted data, tax summary).
  - Status mapping: service-model aware. DFY shows "Documents Requested" for
    INTAKE..DELIVERY. DIY is a 3-state signal independent of the raw pipeline
    status: "Started" (default) / "In progress" (diy_engine_opened_at set via
    POST .../diy-engine-open) / "Submitted" (FILED). Filing type labels
    spelled out ("Do it yourself" / "Done for you").
  - Filed rows additionally carry filing_confirmation + filing_date.
  - Single-engagement GET mirrors the same rules (403 on a SELF_SERVE id).
  - Name is required at registration now (single `name` field, matching the
    invited-user storage convention) — never substituted with the email on
    a partner-facing payload even for legacy rows with no name.

NOTE: skips entirely if OWNR_API_KEY isn't set in the test environment.
"""
import os
import uuid
import asyncio
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL must be set"
OWNR_API_KEY = os.environ.get("OWNR_API_KEY", "")
ADMIN_EMAIL = "nim@cloudtax.ca"
ADMIN_PWD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")

ALLOWLIST_KEYS = {"id", "company_name", "email", "name", "t2_filing_state", "t2_filing_type", "plan_label", "tax_year", "created_at", "ownr_customer_ref", "consent_at"}
FILED_EXTRA_KEYS = ALLOWLIST_KEYS | {"filing_confirmation", "filing_date"}
FORBIDDEN_KEYS = {"tier", "original_tier", "plan", "nil_amount", "notes", "notes_history", "partner_advisor_id", "service_model", "status", "corporation", "client", "extracted_data", "tax_summary", "partner_feedback"}


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _fresh_email(tag):
    return f"test_ownr_dash_{tag}_{uuid.uuid4().hex[:8]}@example.com"


@pytest.fixture(scope="module", autouse=True)
def _require_ownr_key():
    if not OWNR_API_KEY:
        pytest.skip("OWNR_API_KEY not set in the test environment")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def partner_token(admin_token):
    """Fresh PARTNER account for this module — invite + set-password, same
    path an admin uses in the UI."""
    email = f"test_ownr_partner_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE}/api/users/invite",
        json={"email": email, "name": "Test Ownr Partner", "role": "PARTNER"},
        headers=_h(admin_token),
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json()["invite_link"].rsplit("token=", 1)[-1]
    password = "PartnerPass2026!"
    r = requests.post(f"{BASE}/api/auth/set-password", json={"token": token, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _mint_and_register_ownr_client(tag, first_name="Test", last_name="User", company_name="Test Ownr Co", entitlement="OFFER_TEST", customer_ref=None):
    email = _fresh_email(tag)
    r = requests.post(
        f"{BASE}/api/partner/ownr/handoff",
        headers=_h(OWNR_API_KEY),
        json={"email": email, "first_name": first_name, "last_name": last_name, "company_name": company_name, "entitlement": entitlement, "customer_ref": customer_ref},
        timeout=20,
    )
    if r.status_code == 429:
        pytest.skip("ownr handoff rate limit hit (shared per-IP 30/5min counter — test_ownr_handoff.py's own rate-limit probe can saturate it)")
    assert r.status_code == 200, r.text
    token = r.json()["registration_url"].rsplit("token=", 1)[-1]
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": "ignored@example.com", "password": "OwnrClient2026!", "first_name": first_name, "last_name": last_name, "handoff_token": token, "consent": True},
        timeout=20,
    )
    if r.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min)")
    assert r.status_code == 200, r.text
    return {"email": email, "token": r.json()["token"], "user": r.json()["user"]}


def _self_start(client_token, plan, corp_name, fiscal_year_end="2026-12-31"):
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(client_token),
        json={"corp_name": corp_name, "province": "ON", "fiscal_year_end": fiscal_year_end, "plan": plan},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _mongo_set(eng_id, fields):
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        pytest.skip("Mongo not reachable from test host — direct status injection unavailable")

    async def _set():
        c = AsyncIOMotorClient(mongo_url)
        await c[db_name].engagements.update_one({"id": eng_id}, {"$set": fields})
        c.close()
    asyncio.run(_set())


def _engagement_field(eng_id, field):
    """Read a single field directly from Mongo (bypasses every serializer —
    used to check idempotency at the storage layer, not the API's view)."""
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        pytest.skip("Mongo not reachable from test host")

    async def _get():
        c = AsyncIOMotorClient(mongo_url)
        doc = await c[db_name].engagements.find_one({"id": eng_id}, {field: 1})
        c.close()
        return doc.get(field) if doc else None
    return asyncio.run(_get())


def _mongo_set_user_by_email(email, fields):
    from dotenv import load_dotenv
    from motor.motor_asyncio import AsyncIOMotorClient
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not (mongo_url and db_name):
        pytest.skip("Mongo not reachable from test host — direct user injection unavailable")

    async def _set():
        c = AsyncIOMotorClient(mongo_url)
        await c[db_name].users.update_one({"email": email}, {"$set": fields})
        c.close()
    asyncio.run(_set())


@pytest.fixture(scope="module")
def ownr_dfy_engagement():
    # NOTE: the dashboard's "Company Name" column comes from the corporation
    # created at self-start (corp_name below), NOT from the Ownr handoff
    # payload's company_name — that's only a signup-time hint stored on the
    # user. Deliberately different strings here to make sure the test can't
    # pass by accident.
    client = _mint_and_register_ownr_client("dfy", company_name="Ownr DFY Co (handoff hint)", entitlement="OFFER_DFY", customer_ref="OWNR-CUST-42")
    corp_name = f"TEST Ownr DFY Corp {uuid.uuid4().hex[:6]}"
    eng = _self_start(client["token"], "DFY", corp_name)
    eng["_test_corp_name"] = corp_name
    eng["_test_client_email"] = client["email"]
    return eng


@pytest.fixture(scope="module")
def ownr_diy_engagement():
    client = _mint_and_register_ownr_client("diy", company_name="Ownr DIY Co", entitlement="OFFER_DIY")
    eng = _self_start(client["token"], "BASIC_DIY", f"TEST Ownr DIY Corp {uuid.uuid4().hex[:6]}")
    eng["_test_client_token"] = client["token"]
    return eng


@pytest.fixture(scope="module")
def self_serve_engagement():
    """A plain (non-Ownr) self-serve client + engagement — must NEVER be
    visible to the partner."""
    email = _fresh_email("selfserve")
    r = requests.post(
        f"{BASE}/api/auth/register",
        json={"email": email, "password": "SelfServe2026!", "first_name": "Self", "last_name": "Serve"},
        timeout=20,
    )
    if r.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min)")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return _self_start(token, "BASIC_DIY", f"TEST SelfServe Corp {uuid.uuid4().hex[:6]}")


def _partner_rows(partner_token):
    r = requests.get(f"{BASE}/api/engagements", headers=_h(partner_token), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Visibility ----------

def test_partner_sees_ownr_excludes_self_serve(partner_token, ownr_dfy_engagement, self_serve_engagement):
    rows = _partner_rows(partner_token)
    ids = {r["id"] for r in rows}
    assert ownr_dfy_engagement["id"] in ids
    assert self_serve_engagement["id"] not in ids, "SELF_SERVE engagement leaked to partner dashboard"


def test_partner_single_get_self_serve_forbidden(partner_token, self_serve_engagement):
    r = requests.get(f"{BASE}/api/engagements/{self_serve_engagement['id']}", headers=_h(partner_token), timeout=20)
    assert r.status_code == 403


def test_partner_single_get_ownr_allowed(partner_token, ownr_dfy_engagement):
    r = requests.get(f"{BASE}/api/engagements/{ownr_dfy_engagement['id']}", headers=_h(partner_token), timeout=20)
    assert r.status_code == 200
    assert set(r.json().keys()) == ALLOWLIST_KEYS


# ---------- Payload allowlist ----------

def test_ownr_row_payload_is_allowlist_only(partner_token, ownr_dfy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
    assert set(row.keys()) == ALLOWLIST_KEYS, f"unexpected keys leaked: {set(row.keys()) - ALLOWLIST_KEYS}"
    assert not (set(row.keys()) & FORBIDDEN_KEYS)
    assert row["company_name"] == ownr_dfy_engagement["_test_corp_name"]
    assert row["email"]
    assert row["name"] == "Test User"


# ---------- Status + filing-type labels ----------

def test_dfy_intake_maps_to_documents_requested(partner_token, ownr_dfy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
    assert row["t2_filing_state"] == "Documents Requested"
    assert row["t2_filing_type"] == "Done for you"


def test_dfy_delivery_maps_to_documents_requested(partner_token, ownr_dfy_engagement):
    _mongo_set(ownr_dfy_engagement["id"], {"status": "DELIVERY"})
    try:
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
        assert row["t2_filing_state"] == "Documents Requested"
    finally:
        _mongo_set(ownr_dfy_engagement["id"], {"status": "INTAKE"})


def test_diy_intake_stays_started_no_documents_requested(partner_token, ownr_diy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
    assert row["t2_filing_state"] == "Started"
    assert row["t2_filing_type"] == "Do it yourself"


def test_diy_delivery_still_started_not_documents_requested(partner_token, ownr_diy_engagement):
    # The DIY-status wrinkle: DIY engagements never enter the doc pipeline, so
    # even a DELIVERY-stage row must stay "Started", not "Documents Requested".
    _mongo_set(ownr_diy_engagement["id"], {"status": "DELIVERY"})
    try:
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
        assert row["t2_filing_state"] == "Started"
    finally:
        _mongo_set(ownr_diy_engagement["id"], {"status": "INTAKE"})


# ---------- Filed rows ----------

def test_filed_row_carries_cra_extras(partner_token, ownr_dfy_engagement):
    _mongo_set(ownr_dfy_engagement["id"], {
        "status": "FILED",
        "filing_confirmation": "CRA-TEST-999",
        "filing_date": "2026-06-15T00:00:00",
    })
    try:
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
        assert row["t2_filing_state"] == "Filed with CRA"
        assert set(row.keys()) == FILED_EXTRA_KEYS
        assert row["filing_confirmation"] == "CRA-TEST-999"
        assert row["filing_date"]
    finally:
        _mongo_set(ownr_dfy_engagement["id"], {"status": "INTAKE", "filing_confirmation": None, "filing_date": None})


def test_non_filed_row_has_no_filing_extras(partner_token, ownr_diy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
    assert "filing_confirmation" not in row
    assert "filing_date" not in row


# ---------- DIY 3-state status + engine-open endpoint (Part 4) ----------

def test_diy_status_started_before_engine_opened(partner_token, ownr_diy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
    assert row["t2_filing_state"] == "Started"


def test_diy_engine_open_moves_status_to_in_progress(partner_token, ownr_diy_engagement):
    client_token = ownr_diy_engagement["_test_client_token"]
    try:
        r = requests.post(
            f"{BASE}/api/engagements/{ownr_diy_engagement['id']}/diy-engine-open",
            headers=_h(client_token),
            timeout=20,
        )
        assert r.status_code == 200, r.text
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
        assert row["t2_filing_state"] == "In progress"
    finally:
        _mongo_set(ownr_diy_engagement["id"], {"diy_engine_opened_at": None})


def test_diy_engine_open_is_idempotent(ownr_diy_engagement):
    # First call sets the timestamp; every call after is a no-op — the
    # timestamp must not move on a second click.
    client_token = ownr_diy_engagement["_test_client_token"]
    eid = ownr_diy_engagement["id"]
    try:
        r1 = requests.post(f"{BASE}/api/engagements/{eid}/diy-engine-open", headers=_h(client_token), timeout=20)
        assert r1.status_code == 200
        first = _engagement_field(eid, "diy_engine_opened_at")
        r2 = requests.post(f"{BASE}/api/engagements/{eid}/diy-engine-open", headers=_h(client_token), timeout=20)
        assert r2.status_code == 200
        second = _engagement_field(eid, "diy_engine_opened_at")
        assert first == second, "second engine-open call must not move the timestamp"
    finally:
        _mongo_set(eid, {"diy_engine_opened_at": None})


def test_diy_engine_open_requires_ownership(partner_token, ownr_diy_engagement):
    # A different role entirely (PARTNER token) must not be able to record a
    # click on a client's engagement.
    r = requests.post(
        f"{BASE}/api/engagements/{ownr_diy_engagement['id']}/diy-engine-open",
        headers=_h(partner_token),
        timeout=20,
    )
    assert r.status_code == 403


def test_diy_status_submitted_when_filed(partner_token, ownr_diy_engagement):
    _mongo_set(ownr_diy_engagement["id"], {"status": "FILED"})
    try:
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
        assert row["t2_filing_state"] == "Submitted"
    finally:
        _mongo_set(ownr_diy_engagement["id"], {"status": "INTAKE"})


# ---------- Plan label ----------

def test_diy_plan_label_shown(partner_token, ownr_diy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_diy_engagement["id"])
    assert row["plan_label"] == "T2 Basic DIY"


def test_dfy_plan_label_shown(partner_token, ownr_dfy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
    assert row["plan_label"] == "Done For You"


def test_ownr_customer_ref_and_consent_shown(partner_token, ownr_dfy_engagement):
    rows = _partner_rows(partner_token)
    row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
    assert row["ownr_customer_ref"] == "OWNR-CUST-42"
    assert row["consent_at"]  # recorded at registration time


# ---------- No email-as-name fallback ----------

def test_missing_name_never_falls_back_to_email(partner_token, ownr_dfy_engagement):
    # Name is required at registration now — a null name can only happen on
    # legacy/test data. Confirm the backend passes it through as null rather
    # than ever substituting the email; the frontend renders the "Name not
    # provided" copy for that case, never leaking the email into a name slot.
    email = ownr_dfy_engagement["_test_client_email"]
    _mongo_set_user_by_email(email, {"name": None})
    try:
        rows = _partner_rows(partner_token)
        row = next(r for r in rows if r["id"] == ownr_dfy_engagement["id"])
        assert row["name"] is None
        assert row["email"] == email  # email is still its own field...
        assert row["name"] != row["email"]  # ...but never copied into name
    finally:
        _mongo_set_user_by_email(email, {"name": "Test User"})
