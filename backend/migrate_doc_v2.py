"""Migration v2: add issue/new-request/defer fields to documents.

Idempotent: skips if already applied.
- Backfills new fields with defaults on all existing documents.
- For Dr. Patel's engagement, marks one document as ISSUE with issue_note,
  and inserts one new-request document with is_new_request=true + request_note.
"""
import asyncio
import uuid
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()
from db import get_db


async def main():
    db = get_db()

    if await db.seed_marker.find_one({"key": "doc_v2"}):
        print("Migration doc_v2 already applied. Skipping.")
        return

    # 1. Backfill defaults on all docs
    await db.documents.update_many(
        {"is_new_request": {"$exists": False}},
        {"$set": {"is_new_request": False, "issue_note": None, "request_note": None, "deferred_at": None}},
    )

    # 2. Find Dr. Patel's client + engagement
    patel = await db.users.find_one({"email": "patel@example.com"})
    if not patel:
        print("Dr. Patel not found; skipping Patel seed update.")
    else:
        corp = await db.corporations.find_one({"client_id": patel["id"]})
        if corp:
            eng = await db.engagements.find_one({"corporation_id": corp["id"]})
            if eng:
                # 2a. Flag BANK_STATEMENTS doc as ISSUE
                bank = await db.documents.find_one({"engagement_id": eng["id"], "category": "BANK_STATEMENTS"})
                if bank:
                    await db.documents.update_one(
                        {"id": bank["id"]},
                        {"$set": {
                            "status": "ISSUE",
                            "issue_note": "The bank statement provided is incomplete. We have statements for January through May 2025, but we are missing June, July and August 2025. Please upload the remaining three months of statements from your RBC Business account to complete the documentation.",
                            "name": "RBC Business — Missing statements",
                        }},
                    )
                    print(f"Marked Patel BANK_STATEMENTS as ISSUE: {bank['id']}")

                # 2b. Add a NEW REQUEST document (T5 slips)
                already = await db.documents.find_one({"engagement_id": eng["id"], "is_new_request": True})
                if not already:
                    await db.documents.insert_one({
                        "id": str(uuid.uuid4()),
                        "engagement_id": eng["id"],
                        "category": "OTHER",
                        "name": "T5 slips",
                        "description": "Investment income documentation",
                        "status": "PENDING",
                        "is_required": True,
                        "is_new_request": True,
                        "request_note": "Hi Dr. Patel — during preparation we noticed dividend income that needs to be reconciled. Please share any T5 slips you received from your brokerage(s) for fiscal 2025.",
                        "sort_order": -1,
                        "file_url": None,
                        "object_key": None,
                        "file_size": None,
                        "file_name": None,
                        "mime_type": None,
                        "uploaded_at": None,
                        "extracted_data": None,
                        "issue_note": None,
                        "deferred_at": None,
                        "created_at": datetime.now(timezone.utc),
                    })
                    print("Added new-request T5 slips document for Dr. Patel")

    await db.seed_marker.insert_one({"key": "doc_v2", "applied_at": datetime.now(timezone.utc)})
    print("Migration doc_v2 complete.")


if __name__ == "__main__":
    asyncio.run(main())
