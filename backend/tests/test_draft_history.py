"""
Test suite for draft_history array wiring on engagement documents.
Covers iteration 8 features: $push on /upload-draft and /review-decision.
"""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")
THOMPSON_EID = "cc22901b-b6a2-4997-b84a-a7bfc2b307f0"


def _login(email):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PASSWORD}, timeout=60)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def cpa_session():
    return _login("terryann@cloudtax.ca")


@pytest.fixture(scope="module")
def client_session():
    return _login("thompson@example.com")


# ---- GET engagement returns draft_history array ----

def test_get_engagement_returns_draft_history_array(cpa_session):
    r = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    assert r.status_code == 200
    eng = r.json()
    assert "draft_history" in eng, "draft_history key missing on engagement"
    assert isinstance(eng["draft_history"], list), "draft_history must be a list"


def test_thompson_preseeded_history_has_4_events(cpa_session):
    """Per agent-to-agent note, Thompson's engagement has 4 events: upload→issue→upload→approved."""
    r = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    assert r.status_code == 200
    hist = r.json().get("draft_history") or []
    assert len(hist) >= 4, f"expected >=4 pre-seeded events, got {len(hist)}"
    types = [e.get("type") for e in hist[:4]]
    decisions = [e.get("decision") for e in hist[:4]]
    assert types[0] == "upload"
    assert types[1] == "review" and decisions[1] == "issue"
    assert types[2] == "upload"
    assert types[3] == "review" and decisions[3] == "approved"
    for e in hist:
        assert e.get("actor_name"), "each history entry must have actor_name"
        assert e.get("at"), "each history entry must have a timestamp"


def test_client_sees_same_history_with_actor_names(client_session):
    r = client_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    assert r.status_code == 200
    hist = r.json().get("draft_history") or []
    assert len(hist) >= 4
    # No redaction — client must see actor_name as specified
    for e in hist:
        assert e.get("actor_name"), "client should see actor_name (no redaction)"


# ---- No draft_history when engagement has no events (liu = INTAKE) ----

def test_clean_engagement_has_empty_or_missing_history(cpa_session, client_session):
    """Find Liu's or Kaur's engagement (no draft/review yet) and confirm history is empty."""
    # CPA lists all engagements
    r = cpa_session.get(f"{BASE_URL}/api/engagements", timeout=60)
    if r.status_code != 200:
        # admin fallback
        admin = _login("admin@cloudtax.ca")
        r = admin.get(f"{BASE_URL}/api/engagements", timeout=60)
    assert r.status_code == 200
    engs = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    # Find engagement with no draft_history OR empty array (status INTAKE or REFERRED)
    clean = [e for e in engs if not e.get("draft_history")]
    assert len(clean) > 0, "expected at least one engagement with no draft_history"


# ---- New upload appends an entry ----

def _find_client_engagement(session, email):
    r = session.get(f"{BASE_URL}/api/engagements", timeout=60)
    assert r.status_code == 200
    engs = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    return engs


def test_review_decision_push_appends_entry(cpa_session, client_session):
    """E2E: Upload a new draft as CPA, then have client approve → both events appended."""
    # Count current history
    r0 = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    before = r0.json().get("draft_history") or []
    before_count = len(before)

    # Upload a new draft (multipart) — CPA action
    fake_pdf = b"%PDF-1.4\n%fake test pdf\n%%EOF\n"
    files = {"file": ("h3_test.pdf", io.BytesIO(fake_pdf), "application/pdf")}
    # Note: 'instructions' is a query param per the endpoint signature
    r_up = cpa_session.post(
        f"{BASE_URL}/api/engagements/{THOMPSON_EID}/upload-draft",
        params={"instructions": "Test draft for history assertion"},
        files=files,
        timeout=60,
    )
    assert r_up.status_code == 200, f"upload-draft failed: {r_up.status_code} {r_up.text[:200]}"

    r1 = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    hist1 = r1.json().get("draft_history") or []
    assert len(hist1) == before_count + 1, "upload-draft should append exactly 1 entry"
    last_upload = hist1[-1]
    assert last_upload["type"] == "upload"
    assert last_upload.get("file_name") == "h3_test.pdf"
    assert last_upload.get("instructions") == "Test draft for history assertion"
    assert last_upload.get("actor_name"), "upload entry must have actor_name"

    # Client approves
    r_dec = client_session.post(
        f"{BASE_URL}/api/engagements/{THOMPSON_EID}/review-decision",
        json={"decision": "approved"},
        timeout=60,
    )
    assert r_dec.status_code == 200, f"review-decision failed: {r_dec.text[:200]}"

    r2 = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    hist2 = r2.json().get("draft_history") or []
    assert len(hist2) == before_count + 2, "review-decision should append exactly 1 entry"
    last_review = hist2[-1]
    assert last_review["type"] == "review"
    assert last_review.get("decision") == "approved"
    assert last_review.get("actor_name"), "review entry must have actor_name"


def test_issue_decision_stores_note(cpa_session, client_session):
    """Upload another draft, have client raise an issue, verify note is captured."""
    fake_pdf = b"%PDF-1.4\n%fake test pdf 2\n%%EOF\n"
    files = {"file": ("h4_test.pdf", io.BytesIO(fake_pdf), "application/pdf")}
    r_up = cpa_session.post(
        f"{BASE_URL}/api/engagements/{THOMPSON_EID}/upload-draft",
        params={"instructions": "Another test draft"},
        files=files,
        timeout=60,
    )
    assert r_up.status_code == 200

    r_dec = client_session.post(
        f"{BASE_URL}/api/engagements/{THOMPSON_EID}/review-decision",
        json={"decision": "issue", "issue_note": "Test issue: line 101 wrong"},
        timeout=60,
    )
    assert r_dec.status_code == 200

    r = cpa_session.get(f"{BASE_URL}/api/engagements/{THOMPSON_EID}", timeout=60)
    hist = r.json().get("draft_history") or []
    last = hist[-1]
    assert last["type"] == "review"
    assert last["decision"] == "issue"
    assert last["note"] == "Test issue: line 101 wrong"
