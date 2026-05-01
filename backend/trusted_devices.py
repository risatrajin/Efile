"""Trusted-device (remember-this-browser) helpers for 2FA.

Stores hashed device tokens in Mongo `trusted_devices` collection. Browser holds
only the raw token inside a HttpOnly, Secure, SameSite=None cookie so it rides
over the cross-origin Kubernetes ingress to FastAPI.

Lifecycle:
 - issued at successful 2FA verification when user opts in
 - consumed as a 2FA-skip on subsequent logins (if the same user_id + raw token
   present and not expired)
 - invalidated on: password change, password reset, manual revoke, expiry
"""
import os
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Request, Response

from db import get_db

TRUST_COOKIE_NAME = "ct_trusted_device"
TRUST_TTL_DAYS = 30


def _hash_token(raw: str) -> str:
    """SHA-256 at rest. Raw token entropy is 256 bits so plain digest is fine."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _new_raw_token() -> str:
    return secrets.token_urlsafe(32)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def issue_trust_token(
    user_id: str,
    *,
    user_agent: Optional[str] = None,
    ip: Optional[str] = None,
) -> str:
    """Persist a new trusted device row, return the RAW token for the cookie."""
    raw = _new_raw_token()
    now = _now()
    db = get_db()
    await db.trusted_devices.insert_one({
        "id": secrets.token_hex(8),
        "user_id": user_id,
        "token_hash": _hash_token(raw),
        "user_agent": (user_agent or "")[:400],
        "ip": ip or "",
        "created_at": now,
        "last_used_at": now,
        "expires_at": now + timedelta(days=TRUST_TTL_DAYS),
        "revoked": False,
    })
    return raw


async def check_trust_cookie(request: Request, user_id: str) -> bool:
    """Return True if this request carries a valid (non-expired, non-revoked)
    trust cookie owned by the given user. Also bumps ``last_used_at``."""
    raw = request.cookies.get(TRUST_COOKIE_NAME)
    if not raw:
        return False
    db = get_db()
    row = await db.trusted_devices.find_one({
        "user_id": user_id,
        "token_hash": _hash_token(raw),
        "revoked": {"$ne": True},
    })
    if not row:
        return False
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < _now():
        # Lazy cleanup of the expired row.
        await db.trusted_devices.delete_one({"_id": row["_id"]})
        return False
    await db.trusted_devices.update_one(
        {"_id": row["_id"]}, {"$set": {"last_used_at": _now()}}
    )
    return True


def set_trust_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        key=TRUST_COOKIE_NAME,
        value=raw,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=TRUST_TTL_DAYS * 24 * 60 * 60,
        path="/",
    )


def clear_trust_cookie(response: Response) -> None:
    response.delete_cookie(TRUST_COOKIE_NAME, path="/")


async def revoke_all_for_user(user_id: str) -> int:
    """Revoke every trusted device for the user. Called on password change /
    reset. Returns the number of rows removed."""
    db = get_db()
    r = await db.trusted_devices.delete_many({"user_id": user_id})
    return r.deleted_count or 0


async def revoke_one(user_id: str, device_id: str) -> bool:
    db = get_db()
    r = await db.trusted_devices.delete_one({"user_id": user_id, "id": device_id})
    return (r.deleted_count or 0) > 0


async def list_for_user(user_id: str) -> list[dict]:
    db = get_db()
    now = _now()
    out = []
    async for row in db.trusted_devices.find(
        {"user_id": user_id},
        {"_id": 0, "token_hash": 0},
    ).sort("created_at", -1):
        exp = row.get("expires_at")
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp and exp < now:
            continue  # skip expired
        out.append(row)
    return out
