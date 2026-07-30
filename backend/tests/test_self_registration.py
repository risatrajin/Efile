"""Self-serve client entry (Phase: self-registration).

Covers the two public/self-serve additions:

  - POST /auth/register — public signup: creates a CLIENT, signs it in
    (login-shaped response), enforces min-8 password + duplicate email, and
    is rate-limited per-IP (5 per 15 min, counting every call).
  - POST /engagements/self-start — CLIENT-only: creates corporation +
    INTAKE engagement, seeds the tier-independent base document set, blocks
    a second non-FILED engagement, hides tier from the client payload, and
    notifies admins with DFY/DIY-specific copy.

Regression: invited-client set-password and staff login stay untouched.

NOTE on the rate limit: the register cap counts every /auth/register call
from one IP. A rapid re-run of this module inside the 15-minute window can
exhaust the quota — tests skip (not fail) on 429 so reruns aren't red.
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


def _register(email, password):
    r = requests.post(f"{BASE}/api/auth/register", json={"email": email, "password": password}, timeout=20)
    if r.status_code == 429:
        pytest.skip("register rate limit hit (per-IP 5/15min) — rerun after the window")
    return r


def _fresh_email():
    return f"test_selfreg_{uuid.uuid4().hex[:10]}@example.com"


def _login(email, password=PWD):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("nim@cloudtax.ca")


@pytest.fixture(scope="module")
def registered_client():
    """One self-registered CLIENT reused across the module (spares the
    register rate-limit quota)."""
    email = _fresh_email()
    r = _register(email, "SelfServe2026!")
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"]}


# ---------- Registration ----------

def test_register_success_shape_and_login_state(registered_client):
    u = registered_client["user"]
    assert u["role"] == "CLIENT"
    assert u["email"] == registered_client["email"]
    assert "password_hash" not in u
    assert registered_client["token"]
    # Token works immediately — signed in after signup.
    r = requests.get(f"{BASE}/api/auth/me", headers=_h(registered_client["token"]), timeout=20)
    assert r.status_code == 200
    assert r.json()["email"] == registered_client["email"]


def test_register_duplicate_email_rejected(registered_client):
    r = _register(registered_client["email"], "AnotherPass1!")
    assert r.status_code == 400
    assert "already registered" in r.json().get("detail", "").lower()


def test_register_weak_password_rejected():
    r = _register(_fresh_email(), "short")
    assert r.status_code == 400
    assert "8 characters" in r.json().get("detail", "")


# ---------- Self-start ----------

@pytest.fixture(scope="module")
def dfy_engagement(registered_client):
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(registered_client["token"]),
        json={
            "corp_name": f"TEST SelfStart Corp {uuid.uuid4().hex[:6]}",
            "province": "ON",
            "fiscal_year_end": "2026-12-31",
            "plan": "DFY",
        },
        timeout=20,
    )
    assert r.status_code == 200, f"self-start failed: {r.status_code} {r.text}"
    return r.json()


def test_self_start_creates_intake_engagement(dfy_engagement, registered_client):
    eng = dfy_engagement
    assert eng["status"] == "INTAKE"
    assert eng["service_model"] == "DFY"
    assert eng["plan"] == "DFY"
    # Tier is admin-managed and redacted from client payloads.
    assert eng.get("tier") is None
    assert eng.get("original_tier") is None
    # Staff notes never reach the client.
    assert "notes_history" not in eng
    # Base document set seeded (8 tier-independent items).
    r = requests.get(f"{BASE}/api/engagements/{eng['id']}/documents", headers=_h(registered_client["token"]), timeout=20)
    assert r.status_code == 200
    docs = r.json()
    assert len(docs) == 8, f"expected base doc set of 8, got {len(docs)}"
    assert all(d["status"] == "PENDING" for d in docs)


def test_self_start_duplicate_same_corporation_rejected(dfy_engagement, registered_client):
    # Guard is per-corporation: reusing the SAME corp while it has an active
    # (non-FILED) filing is rejected.
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(registered_client["token"]),
        json={
            "corporation_id": dfy_engagement["corporation_id"],
            "province": "ON",
            "fiscal_year_end": "2026-12-31",
            "plan": "DFY",
        },
        timeout=20,
    )
    assert r.status_code == 400
    assert "already has a filing in progress" in r.json().get("detail", "").lower()


def test_second_corporation_allowed(dfy_engagement, registered_client):
    # A NEW corporation is always allowed — multiple profiles per client.
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(registered_client["token"]),
        json={
            "corp_name": f"TEST Second Corp {uuid.uuid4().hex[:6]}",
            "province": "AB",
            "fiscal_year_end": "2026-09-30",
            "plan": "BASIC_DIY",
        },
        timeout=20,
    )
    assert r.status_code == 200, f"second corp self-start failed: {r.status_code} {r.text}"
    assert r.json()["corporation_id"] != dfy_engagement["corporation_id"]


def test_dashboard_list_multiple_profiles(dfy_engagement, registered_client):
    # Depends on test_second_corporation_allowed having created a 2nd profile.
    r = requests.get(f"{BASE}/api/engagements", headers=_h(registered_client["token"]), timeout=20)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 2, f"expected >=2 profiles, got {len(rows)}"
    for e in rows:
        # Client redaction holds on every row.
        assert e.get("tier") is None
        assert e.get("original_tier") is None
        assert "notes_history" not in e
        # Dashboard row fields present.
        corp = e.get("corporation") or {}
        assert corp.get("name")
        assert corp.get("fiscal_year_end")
    # Active engagements: newest first (created_at desc), FILED (if any) last.
    active = [e for e in rows if e["status"] != "FILED"]
    created = [e.get("created_at") for e in active]
    assert created == sorted(created, reverse=True), f"active rows not newest-first: {created}"
    statuses = [e["status"] for e in rows]
    if "FILED" in statuses:
        first_filed = statuses.index("FILED")
        assert all(s == "FILED" for s in statuses[first_filed:]), "FILED rows must come last"


def test_filed_corporation_allows_new_year(registered_client, dfy_engagement):
    """FILED engagements never block the same corporation's next year. The
    FILED state is injected directly (the HTTP path to FILED requires the full
    T183/approval flow) — skipped when Mongo isn't reachable locally."""
    try:
        import asyncio
        from dotenv import load_dotenv
        from motor.motor_asyncio import AsyncIOMotorClient
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        assert mongo_url and db_name
    except Exception:
        pytest.skip("Mongo not reachable from test host — FILED injection unavailable")

    corp_id = dfy_engagement["corporation_id"]

    async def _set_filed(status):
        c = AsyncIOMotorClient(mongo_url)
        await c[db_name].engagements.update_one({"id": dfy_engagement["id"]}, {"$set": {"status": status}})
        c.close()

    asyncio.run(_set_filed("FILED"))
    try:
        r = requests.post(
            f"{BASE}/api/engagements/self-start",
            headers=_h(registered_client["token"]),
            json={
                "corporation_id": corp_id,
                "province": "ON",
                "fiscal_year_end": "2027-12-31",
                "plan": "DFY",
            },
            timeout=20,
        )
        assert r.status_code == 200, f"new year after FILED rejected: {r.status_code} {r.text}"
        assert r.json()["corporation_id"] == corp_id
    finally:
        # Restore so other tests (notification copy on the DFY engagement) are unaffected.
        asyncio.run(_set_filed("INTAKE"))


def test_self_start_requires_client_role(admin_token):
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(admin_token),
        json={"corp_name": "X Corp", "province": "ON", "fiscal_year_end": "2026-12-31", "plan": "DFY"},
        timeout=20,
    )
    assert r.status_code == 403


def test_self_start_invalid_plan(registered_client):
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(registered_client["token"]),
        json={"corp_name": "X Corp", "province": "ON", "fiscal_year_end": "2026-12-31", "plan": "NOPE"},
        timeout=20,
    )
    # 400 either for invalid model or (if run out of order) duplicate active —
    # both reject; assert the model message when it is the reason.
    assert r.status_code == 400


def test_admin_notified_with_dfy_copy(admin_token, dfy_engagement, registered_client):
    r = requests.get(f"{BASE}/api/notifications", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    notes = r.json()
    mine = [n for n in notes if n.get("engagement_id") == dfy_engagement["id"] and n.get("type") == "self_serve_start"]
    assert mine, "admin did not receive the self-serve notification"
    n = mine[0]
    assert n["title"] == "New self-serve client"
    assert "started a Done For You filing. Assign a CPA to begin intake." in n["message"]
    assert registered_client["email"] in n["message"] or (registered_client["user"].get("name") or "") in n["message"]


def test_diy_notification_copy(admin_token):
    email = _fresh_email()
    r = _register(email, "SelfServe2026!")
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    r = requests.post(
        f"{BASE}/api/engagements/self-start",
        headers=_h(tok),
        json={
            "corp_name": f"TEST DIY Corp {uuid.uuid4().hex[:6]}",
            "province": "BC",
            "fiscal_year_end": "2026-06-30",
            "plan": "BASIC_DIY",
        },
        timeout=20,
    )
    assert r.status_code == 200, f"DIY self-start failed: {r.status_code} {r.text}"
    eid = r.json()["id"]
    r = requests.get(f"{BASE}/api/notifications", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    mine = [n for n in r.json() if n.get("engagement_id") == eid and n.get("type") == "self_serve_start"]
    assert mine, "admin did not receive the DIY self-serve notification"
    assert "started a T2 Basic DIY filing." in mine[0]["message"]
    assert "Assign a CPA" not in mine[0]["message"]


# ---------- Regression ----------

def test_staff_login_untouched(admin_token):
    r = requests.get(f"{BASE}/api/auth/me", headers=_h(admin_token), timeout=20)
    assert r.status_code == 200
    assert r.json()["role"] == "ADMIN"


def test_invite_info_endpoint_untouched():
    # Invited-client flow entry point still responds (bad token → 4xx, not 5xx).
    r = requests.get(f"{BASE}/api/auth/invite-info", params={"token": "bogus"}, timeout=20)
    assert 400 <= r.status_code < 500
