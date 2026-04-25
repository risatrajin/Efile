"""Migration v4: WS onboarding seed (Marcus Webb ready + Priya Nair draft)."""
import asyncio, uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv()
from db import get_db
from auth import hash_password


async def main():
    db = get_db()
    if await db.seed_marker.find_one({"key": "ws_onboarding_v4"}):
        print("Already applied. Skipping.")
        return
    kris = await db.users.find_one({"email": "kris.kibler@wealthsimple.com"})
    if not kris:
        print("Kris not found"); return
    now = datetime.now(timezone.utc)

    seeds = [
        # (first, last, email, phone, prov, corp, tier, ready)
        ("Marcus", "Webb", "marcus@clinicmail.ca", "+1 (416) 555-0102", "ON",
         "Marcus Webb Medicine Professional Corporation", "WHITE_GLOVE", True),
        ("Priya", "Nair", "priya@clinicmail.ca", None, "BC",
         "Priya Nair Medicine Professional Corporation", "BOOKS_COMPLETE", False),
    ]
    for first, last, email, phone, prov, corp_name, tier, ready in seeds:
        existing = await db.users.find_one({"email": email})
        if existing: continue
        uid = str(uuid.uuid4())
        full = f"Dr. {first} {last}"
        await db.users.insert_one({
            "id": uid, "email": email, "password_hash": hash_password(uuid.uuid4().hex),
            "name": full, "role": "CLIENT", "phone": phone, "is_active": True, "created_at": now,
            "notification_prefs": {"email": {"return_updates": True, "doc_reminders": True, "announcements": True, "tax_tips": False}, "push": {"doc_requests": True, "cpa_messages": True}},
            "two_factor_enabled": False,
        })
        corp_id = str(uuid.uuid4())
        await db.corporations.insert_one({
            "id": corp_id, "name": corp_name, "business_number": None,
            "fiscal_year_start": datetime(2025, 1, 1, tzinfo=timezone.utc) if ready else None,
            "fiscal_year_end": datetime(2025, 12, 31, tzinfo=timezone.utc) if ready else None,
            "province": prov, "practice_type": None, "has_holdco": False, "has_trust": False,
            "address": None, "client_id": uid, "created_at": now,
        })
        await db.engagements.insert_one({
            "id": str(uuid.uuid4()),
            "tier": tier if ready else None,
            "original_tier": tier if ready else None,
            "status": "ONBOARDING", "cra_access_status": "NOT_STARTED",
            "cra_access_method": None, "cra_programs": None, "referral_date": None,
            "notes": None, "corporation_id": corp_id, "assigned_cpa_id": None,
            "ws_advisor_id": kris["id"], "created_at": now, "updated_at": now,
        })
        print(f"Seeded onboarding: {full} ({'READY' if ready else 'DRAFT'})")
    await db.seed_marker.insert_one({"key": "ws_onboarding_v4", "applied_at": now})
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
