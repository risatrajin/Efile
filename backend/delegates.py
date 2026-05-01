"""Delegate access for the client portal.

A primary client (the physician) can invite up to **two** delegates per
engagement (assistant / bookkeeper / spouse / accountant / other). Delegates
are regular ``CLIENT``-role users — the ``delegates`` collection is what scopes
which engagement they can see and what they can do inside it.

This module is the single source of truth for delegate auth checks. ``server.py``
imports the helpers and uses them in the engagement gate, the T183 sign route,
and the delegate-context endpoint.

Document shape::

    {
        id: str (uuid),
        engagement_id: str,
        invited_by: str (primary client user_id),
        user_id: str | None (filled when invitee creates account),
        email: str (lowercase),
        name: str,
        relationship: "assistant" | "bookkeeper" | "spouse" | "accountant" | "other",
        status: "INVITED" | "ACTIVE" | "REVOKED",
        invited_at: datetime,
        accepted_at: datetime | None,
        revoked_at: datetime | None,
    }

Indexes (created opportunistically in ``server.py`` startup)::

    - engagement_id
    - email
    - user_id
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from db import get_db

VALID_RELATIONSHIPS = {"assistant", "bookkeeper", "spouse", "accountant", "other"}
MAX_ACTIVE_DELEGATES_PER_ENGAGEMENT = 2

STATUS_INVITED = "INVITED"
STATUS_ACTIVE = "ACTIVE"
STATUS_REVOKED = "REVOKED"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def get_delegate_for_engagement(user_id: str, engagement_id: str) -> Optional[dict]:
    """Return the delegate row for this user on this engagement (active only)."""
    db = get_db()
    return await db.delegates.find_one(
        {
            "user_id": user_id,
            "engagement_id": engagement_id,
            "status": STATUS_ACTIVE,
        },
        {"_id": 0},
    )


async def is_active_delegate(user_id: str, engagement_id: str) -> bool:
    return (await get_delegate_for_engagement(user_id, engagement_id)) is not None


async def list_for_engagement(engagement_id: str, *, include_revoked: bool = False) -> list[dict]:
    db = get_db()
    q: dict = {"engagement_id": engagement_id}
    if not include_revoked:
        q["status"] = {"$in": [STATUS_INVITED, STATUS_ACTIVE]}
    out = []
    async for row in db.delegates.find(q, {"_id": 0}).sort("invited_at", 1):
        out.append(_serialize(row))
    return out


async def count_active(engagement_id: str) -> int:
    db = get_db()
    return await db.delegates.count_documents(
        {"engagement_id": engagement_id, "status": {"$in": [STATUS_INVITED, STATUS_ACTIVE]}}
    )


async def list_engagement_ids_for_delegate(user_id: str) -> list[str]:
    """Every engagement this user has *active* delegate access to."""
    db = get_db()
    rows = db.delegates.find(
        {"user_id": user_id, "status": STATUS_ACTIVE},
        {"_id": 0, "engagement_id": 1},
    )
    return [r["engagement_id"] async for r in rows]


async def find_pending_invites_for_email(email: str) -> list[dict]:
    """Used by the set-password / signup flow to flip pending invites to
    ACTIVE the moment a delegate finishes onboarding."""
    db = get_db()
    rows = []
    async for r in db.delegates.find(
        {"email": email.lower(), "status": STATUS_INVITED},
        {"_id": 0},
    ):
        rows.append(r)
    return rows


async def activate_for_user(email: str, user_id: str) -> int:
    """Promote every INVITED delegate row for this email to ACTIVE and link
    it to the new user_id. Returns number of rows promoted."""
    db = get_db()
    r = await db.delegates.update_many(
        {"email": email.lower(), "status": STATUS_INVITED},
        {"$set": {"status": STATUS_ACTIVE, "user_id": user_id, "accepted_at": _now()}},
    )
    return r.modified_count or 0


def _serialize(row: dict) -> dict:
    """Mongo doc → JSON-friendly dict (ISO datetimes, no _id)."""
    out = dict(row)
    out.pop("_id", None)
    for k in ("invited_at", "accepted_at", "revoked_at"):
        v = out.get(k)
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
    return out
