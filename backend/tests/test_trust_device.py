"""Iter 44: "Trust this device" for 2FA login.

Covers:
 - trust_device=true on verify-login issues a ct_trusted_device cookie
 - subsequent login with the cookie skips the 2FA challenge
 - no cookie when trust_device omitted/false
 - GET /auth/trusted-devices lists (no token_hash leak)
 - DELETE /auth/trusted-devices/{id} revokes a single device
 - POST /auth/trusted-devices/revoke-all blanks out the set
"""
import os
import re
import subprocess
import time

import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-wealth-tax.preview.emergentagent.com").rstrip("/")
EMAIL = os.environ.get("ADMIN_EMAIL", "nim@cloudtax.ca")
PASSWORD = os.environ.get("ADMIN_PASSWORD", "CloudTax2026!")


def _otp_from_logs() -> str:
    out = subprocess.run(
        ["tail", "-n", "120", "/var/log/supervisor/backend.err.log"],
        capture_output=True, text=True, timeout=5,
    ).stdout
    for line in out.splitlines()[::-1]:
        if "2FA login challenge issued" in line and EMAIL in line:
            m = re.search(r"code=(\d{6})", line)
            if m:
                return m.group(1)
    raise RuntimeError("no OTP in logs")


def _login(session: requests.Session) -> dict:
    r = session.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        verify=False,
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _verify(session: requests.Session, challenge: str, code: str, trust: bool) -> dict:
    r = session.post(
        f"{BASE_URL}/api/auth/2fa/verify-login",
        json={"challenge_id": challenge, "code": code, "trust_device": trust},
        verify=False,
        timeout=10,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_trust_device_issued_and_skips_future_2fa():
    s = requests.Session()
    d1 = _login(s)
    assert d1.get("two_factor_required") is True
    time.sleep(0.4)
    code = _otp_from_logs()
    d2 = _verify(s, d1["challenge_id"], code, trust=True)
    assert d2["trusted_device_issued"] is True
    assert "ct_trusted_device" in s.cookies
    # 2nd login with same session (cookie present) should skip 2FA
    d3 = _login(s)
    assert d3.get("two_factor_required") is not True
    assert d3.get("trusted_device") is True
    assert d3.get("token")


def test_no_trust_cookie_when_flag_false():
    s = requests.Session()
    d1 = _login(s)
    time.sleep(0.4)
    code = _otp_from_logs()
    d2 = _verify(s, d1["challenge_id"], code, trust=False)
    assert d2.get("trusted_device_issued") in (False, None)
    assert "ct_trusted_device" not in s.cookies


def test_list_and_delete_trusted_device():
    s = requests.Session()
    d1 = _login(s)
    time.sleep(0.4)
    code = _otp_from_logs()
    d2 = _verify(s, d1["challenge_id"], code, trust=True)
    tok = d2["token"]
    # List
    r = requests.get(
        f"{BASE_URL}/api/auth/trusted-devices",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    )
    assert r.status_code == 200
    devices = r.json()["devices"]
    assert len(devices) >= 1
    dev = devices[0]
    assert "token_hash" not in dev  # hash must not leak
    # Delete
    r2 = requests.delete(
        f"{BASE_URL}/api/auth/trusted-devices/{dev['id']}",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    )
    assert r2.status_code == 200
    # Re-login → 2FA required again
    s2 = requests.Session()
    s2.cookies.update(s.cookies)
    d3 = _login(s2)
    assert d3.get("two_factor_required") is True


def test_revoke_all():
    s = requests.Session()
    d1 = _login(s)
    time.sleep(0.4)
    code = _otp_from_logs()
    d2 = _verify(s, d1["challenge_id"], code, trust=True)
    tok = d2["token"]
    # Revoke all
    r = requests.post(
        f"{BASE_URL}/api/auth/trusted-devices/revoke-all",
        headers={"Authorization": f"Bearer {tok}"},
        verify=False, timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["revoked"] >= 1
    # Next login with the cookie should re-require 2FA
    d3 = _login(s)
    assert d3.get("two_factor_required") is True
