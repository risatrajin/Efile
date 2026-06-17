"""Migration v6 — Phase 1.5 WS_PARTNER -> PARTNER rename.

Renames the partner role and the ws_* engagement fields to the neutral
``partner_*`` naming:

  * db.users:        role "WS_PARTNER" -> "PARTNER"
  * db.engagements:  ws_advisor_id     -> partner_advisor_id
  * db.engagements:  ws_partner_id     -> partner_id   (legacy field, if present)

Idempotent on the way up (guarded by the ``partner_rename_v6`` seed marker) and
fully reversible. Safe to run against a DB that Stage A dual-accept is already
serving, since both role strings resolve to the same canonical role.

Usage:
    python migrate_partner_v6.py          # up (default)
    python migrate_partner_v6.py up
    python migrate_partner_v6.py down     # reverse
"""
import asyncio
import sys
from db import get_db
from dotenv import load_dotenv

load_dotenv()

MARKER = "partner_rename_v6"


async def up():
    db = get_db()
    if await db.seed_marker.find_one({"key": MARKER}):
        print("Already applied (marker present). Skipping up-migration.")
        return
    users = await db.users.update_many(
        {"role": "WS_PARTNER"}, {"$set": {"role": "PARTNER"}}
    )
    advisor = await db.engagements.update_many(
        {"ws_advisor_id": {"$exists": True}},
        {"$rename": {"ws_advisor_id": "partner_advisor_id"}},
    )
    partner = await db.engagements.update_many(
        {"ws_partner_id": {"$exists": True}},
        {"$rename": {"ws_partner_id": "partner_id"}},
    )
    await db.seed_marker.insert_one({"key": MARKER})
    print(
        f"UP applied: users WS_PARTNER->PARTNER={users.modified_count}; "
        f"engagements ws_advisor_id->partner_advisor_id={advisor.modified_count}; "
        f"engagements ws_partner_id->partner_id={partner.modified_count}"
    )


async def down():
    db = get_db()
    users = await db.users.update_many(
        {"role": "PARTNER"}, {"$set": {"role": "WS_PARTNER"}}
    )
    advisor = await db.engagements.update_many(
        {"partner_advisor_id": {"$exists": True}},
        {"$rename": {"partner_advisor_id": "ws_advisor_id"}},
    )
    partner = await db.engagements.update_many(
        {"partner_id": {"$exists": True}},
        {"$rename": {"partner_id": "ws_partner_id"}},
    )
    await db.seed_marker.delete_one({"key": MARKER})
    print(
        f"DOWN reverted: users PARTNER->WS_PARTNER={users.modified_count}; "
        f"engagements partner_advisor_id->ws_advisor_id={advisor.modified_count}; "
        f"engagements partner_id->ws_partner_id={partner.modified_count}"
    )


if __name__ == "__main__":
    direction = sys.argv[1].lower() if len(sys.argv) > 1 else "up"
    if direction not in ("up", "down"):
        print(f"Unknown direction {direction!r}; use 'up' or 'down'.")
        sys.exit(1)
    asyncio.run(down() if direction == "down" else up())
