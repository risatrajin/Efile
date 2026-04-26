"""Migration v5: backfill pre_filing_checklist on existing ONBOARDING engagements."""
import asyncio, uuid
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()
from db import get_db

DEFAULTS = [
    "Corporation info confirmed",
    "Fiscal year-end verified",
    "Prior year T2 on file?",
    "CRA access requested",
    "Client signed engagement letter",
    "WS advisor notified",
]


async def main():
    db = get_db()
    if await db.seed_marker.find_one({"key": "checklist_v5"}):
        print("Already applied."); return
    n = 0
    async for e in db.engagements.find({"status": "ONBOARDING", "pre_filing_checklist": {"$exists": False}}):
        cl = [{"id": str(uuid.uuid4()), "item": x, "is_completed": False, "sort_order": i} for i, x in enumerate(DEFAULTS)]
        await db.engagements.update_one({"id": e["id"]}, {"$set": {"pre_filing_checklist": cl}})
        n += 1
    # Mark Priya 2/6 done so demo screenshot matches
    priya = await db.users.find_one({"email": "priya@clinicmail.ca"})
    if priya:
        corp = await db.corporations.find_one({"client_id": priya["id"]})
        if corp:
            eng = await db.engagements.find_one({"corporation_id": corp["id"]})
            if eng and eng.get("pre_filing_checklist"):
                cl = eng["pre_filing_checklist"]
                for i in range(min(2, len(cl))):
                    cl[i]["is_completed"] = True
                await db.engagements.update_one({"id": eng["id"]}, {"$set": {"pre_filing_checklist": cl}})
    # Marcus all 6 done so Ready
    marcus = await db.users.find_one({"email": "marcus@clinicmail.ca"})
    if marcus:
        corp = await db.corporations.find_one({"client_id": marcus["id"]})
        if corp:
            eng = await db.engagements.find_one({"corporation_id": corp["id"]})
            if eng and eng.get("pre_filing_checklist"):
                cl = eng["pre_filing_checklist"]
                for c in cl: c["is_completed"] = True
                await db.engagements.update_one({"id": eng["id"]}, {"$set": {"pre_filing_checklist": cl}})
    # Strip "Dr. " prefix from existing client names (request: don't auto-add Dr.)
    async for u in db.users.find({"role": "CLIENT", "name": {"$regex": "^Dr\\.\\s+"}}):
        new_name = u["name"].replace("Dr. ", "", 1)
        await db.users.update_one({"id": u["id"]}, {"$set": {"name": new_name}})
    await db.seed_marker.insert_one({"key": "checklist_v5", "applied_at": datetime.now(timezone.utc)})
    print(f"Migrated {n} engagements + name prefixes")


if __name__ == "__main__":
    asyncio.run(main())
