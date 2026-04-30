"""One-time production cleanup script — CLI form of POST /admin/reset-database.

Usage (from inside the backend container):
    cd /app/backend && python -m migrations.reset_for_production --confirm RESET

Preserves the 3 staff accounts (Nim / Pallavi / Terry-Ann) and global settings;
deletes everything else. The server endpoint is the preferred path (audit-logged,
authenticated); this script is a break-glass fallback when the web app can't
be reached.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import shutil

# Make ``backend/`` importable when this module is run as a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient

log = logging.getLogger("reset_for_production")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

PROD_PRESERVE_EMAILS = [
    "nim@cloudtax.ca",
    "pallavi@cloudtax.ca",
    "terryann@cloudtax.ca",
]

FULL_WIPE = [
    "corporations", "engagements", "documents", "messages",
    "opportunities", "time_entries", "checklist", "notifications",
    "otp_challenges", "password_reset_tokens", "status_history",
    "cpa_questions", "extracted_data",
]


async def run(confirm: str) -> int:
    if confirm != "RESET":
        log.error("Refusing to reset without --confirm RESET")
        return 2
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME", "cloudtax")
    if not mongo_url:
        log.error("MONGO_URL not set")
        return 3
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    preserved_ids: list[str] = []
    async for u in db.users.find({"email": {"$in": PROD_PRESERVE_EMAILS}}, {"_id": 0}):
        preserved_ids.append(u["id"])
        log.info("Preserving user %s (%s, %s)", u.get("email"), u.get("name"), u.get("role"))
    if len(preserved_ids) < 1:
        log.error("No staff accounts matched the preserve list; aborting for safety.")
        return 4

    for coll in FULL_WIPE:
        res = await db[coll].delete_many({})
        log.info("Cleared %s: %d docs", coll, res.deleted_count)
    res = await db.users.delete_many({"id": {"$nin": preserved_ids}})
    log.info("Cleared users (non-preserved): %d", res.deleted_count)

    uploads_root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
    if os.path.isdir(uploads_root):
        for entry in os.listdir(uploads_root):
            p = os.path.join(uploads_root, entry)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                try:
                    os.remove(p)
                except Exception:
                    pass
        log.info("Local uploads dir cleared: %s", uploads_root)

    try:
        import s3_service
        report = s3_service.delete_prefix("engagements/")
        log.info("S3 cleanup: %s", report)
    except Exception as e:
        log.warning("S3 cleanup skipped: %s", e)

    log.info("DB reset complete. Preserved %d users.", len(preserved_ids))
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirm", required=True, help="must be the literal word 'RESET'")
    args = ap.parse_args()
    sys.exit(asyncio.run(run(args.confirm)))
