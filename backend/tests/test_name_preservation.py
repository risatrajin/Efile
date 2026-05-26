"""Iter 45: Multi-word first/last name preservation.

Regression: creating a client with first_name="Dr Bala" / last_name="Chan" was
being auto-split on the frontend into first="Dr" / last="Bala Chan". Fix stores
first_name and last_name verbatim on the user document and the frontend reads
them directly.
"""
import os
import uuid

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
PASSWORD = os.environ.get("CT_TEST_PASSWORD", "CloudTax2026!")
WS_EMAIL = "rajin@cloudtax.ca"


def _ws_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": WS_EMAIL, "password": PASSWORD}, timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _delete_engagement(tok, eid):
    try:
        requests.delete(
            f"{BASE_URL}/api/engagements/{eid}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=5,
        )
    except Exception:
        pass


def test_multi_word_first_name_preserved_on_create():
    tok = _ws_token()
    email = f"ml-name-{uuid.uuid4().hex[:6]}@yopmail.com"
    r = requests.post(
        f"{BASE_URL}/api/engagements/onboarding",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "first_name": "Dr Bala",
            "last_name": "Chan",
            "client_email": email,
            "corp_name": "Test Medical PC",
            "province": "ON",
            "tier": "STANDARD",
        }, timeout=10,
    )
    assert r.status_code == 200, r.text
    eid = r.json()["id"]
    try:
        g = requests.get(
            f"{BASE_URL}/api/engagements/{eid}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        ).json()
        c = g.get("client", {})
        assert c.get("first_name") == "Dr Bala", c
        assert c.get("last_name") == "Chan", c
        assert c.get("name") == "Dr Bala Chan", c
    finally:
        _delete_engagement(tok, eid)


def test_patch_preserves_multi_word_names():
    tok = _ws_token()
    email = f"ml-name-{uuid.uuid4().hex[:6]}@yopmail.com"
    # Seed
    r = requests.post(
        f"{BASE_URL}/api/engagements/onboarding",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "first_name": "Jane",
            "last_name": "Smith",
            "client_email": email,
            "corp_name": "Jane MPC",
            "province": "ON",
            "tier": "STANDARD",
        }, timeout=10,
    )
    eid = r.json()["id"]
    try:
        # PATCH to a multi-word first name + hyphenated last
        p = requests.patch(
            f"{BASE_URL}/api/engagements/{eid}/onboarding",
            headers={"Authorization": f"Bearer {tok}"},
            json={
                "first_name": "Van Der",
                "last_name": "Berg-Jones",
                "client_email": email,
                "corp_name": "Jane MPC",
                "province": "ON",
                "tier": "STANDARD",
            }, timeout=10,
        )
        assert p.status_code == 200, p.text
        g = requests.get(
            f"{BASE_URL}/api/engagements/{eid}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        ).json()
        c = g.get("client", {})
        assert c.get("first_name") == "Van Der", c
        assert c.get("last_name") == "Berg-Jones", c
        assert c.get("name") == "Van Der Berg-Jones", c
    finally:
        _delete_engagement(tok, eid)


def test_single_word_name_still_works():
    tok = _ws_token()
    email = f"ml-name-{uuid.uuid4().hex[:6]}@yopmail.com"
    r = requests.post(
        f"{BASE_URL}/api/engagements/onboarding",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "first_name": "Alex",
            "last_name": "Wong",
            "client_email": email,
            "corp_name": "Alex Corp",
            "province": "ON",
            "tier": "STANDARD",
        }, timeout=10,
    )
    eid = r.json()["id"]
    try:
        g = requests.get(
            f"{BASE_URL}/api/engagements/{eid}",
            headers={"Authorization": f"Bearer {tok}"}, timeout=10,
        ).json()
        c = g.get("client", {})
        assert c.get("first_name") == "Alex"
        assert c.get("last_name") == "Wong"
        assert c.get("name") == "Alex Wong"
    finally:
        _delete_engagement(tok, eid)
