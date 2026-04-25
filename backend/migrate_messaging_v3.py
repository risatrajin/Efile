"""Migration v3: messaging + account-settings support.

- Adds default notification_prefs to all users (idempotent)
- Adds default address on corporations (idempotent backfill examples)
- Seeds 4 demo messages on Dr. Patel's engagement
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()
from db import get_db


DEFAULT_PREFS = {
    "email": {
        "return_updates": True,
        "doc_reminders": True,
        "announcements": True,
        "tax_tips": False,
    },
    "push": {
        "doc_requests": True,
        "cpa_messages": True,
    },
}


async def main():
    db = get_db()
    if await db.seed_marker.find_one({"key": "messaging_v3"}):
        print("Migration messaging_v3 already applied. Skipping.")
        return

    # Backfill notification prefs and 2FA flag
    await db.users.update_many(
        {"notification_prefs": {"$exists": False}},
        {"$set": {"notification_prefs": DEFAULT_PREFS, "two_factor_enabled": False}},
    )

    # Sample address backfill on corporations
    await db.corporations.update_many(
        {"address": {"$exists": False}},
        {"$set": {"address": None}},
    )
    samples = {
        "chen@example.com": "123 Medical Ave, Toronto, ON M5H 2R2",
        "patel@example.com": "44 King St W, Toronto, ON M5H 1A1",
        "nguyen@example.com": "200 Bay St, Toronto, ON M5J 2J3",
        "martin@example.com": "1 Stephen Ave, Calgary, AB T2P 0H4",
    }
    for email, addr in samples.items():
        u = await db.users.find_one({"email": email})
        if u:
            await db.corporations.update_one({"client_id": u["id"]}, {"$set": {"address": addr}})

    # Seed Patel messages
    patel = await db.users.find_one({"email": "patel@example.com"})
    pallavi = await db.users.find_one({"email": "pallavi@cloudtax.ca"})
    if patel and pallavi:
        corp = await db.corporations.find_one({"client_id": patel["id"]})
        if corp:
            eng = await db.engagements.find_one({"corporation_id": corp["id"]})
            if eng:
                # Wipe any old test messages
                await db.messages.delete_many({"engagement_id": eng["id"]})
                base = datetime.now(timezone.utc) - timedelta(days=6)
                rows = [
                    (patel["id"], "I uploaded the bank statements. Are there any other documents you need?", base + timedelta(hours=0)),
                    (pallavi["id"], "Thanks for uploading those! Yes, I still need the GST/HST records. Can you send those by tomorrow?", base + timedelta(hours=0, minutes=15)),
                    (patel["id"], "Sure, I'll have them to you by end of day tomorrow.", base + timedelta(hours=0, minutes=30)),
                    (pallavi["id"], "Perfect! That's all I need for now. I'll get started on the calculations.", base + timedelta(hours=0, minutes=45)),
                ]
                docs = [{
                    "id": str(uuid.uuid4()),
                    "engagement_id": eng["id"],
                    "sender_id": sid,
                    "content": content,
                    "attachment_url": None,
                    "attachment_name": None,
                    "is_read": True,  # already read for demo
                    "created_at": ts,
                } for sid, content, ts in rows]
                await db.messages.insert_many(docs)
                print(f"Seeded {len(docs)} messages for Dr. Patel")

    await db.seed_marker.insert_one({"key": "messaging_v3", "applied_at": datetime.now(timezone.utc)})
    print("Migration messaging_v3 complete.")


if __name__ == "__main__":
    asyncio.run(main())
