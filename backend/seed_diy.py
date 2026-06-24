"""Seed 9 "Do it yourself" (DIY) partner clients.

Mirrors seed.py's engagement shape but stamps service_model="DIY" so they land
under the Partner portal's "Do it yourself" tab. Idempotent via seed_marker.

  python seed_diy.py            # dry run (prints what would insert)
  python seed_diy.py --apply    # execute
"""
import asyncio, os, sys, uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
load_dotenv()
from db import get_db
from auth import hash_password
from config import review_checklist_for_tier

APPLY = "--apply" in sys.argv
MARKER = "diy_demo_v1"
PWD = os.environ.get("SEED_PASSWORD") or os.environ.get("ADMIN_PASSWORD") or "CloudTax2026!"

# (name, email, province, corp_name, tier, status, days_offset)
DIY_CLIENTS = [
    ("Olivia Bennett", "olivia@diymail.ca",  "ON", "Bennett Design Studio Inc.",   "STANDARD",       "REFERRED",  2),
    ("Ethan Clarke",   "ethan@diymail.ca",   "MB", "Clarke Plumbing Inc.",         "BOOKS_COMPLETE", "REFERRED",  3),
    ("Liam Foster",    "liam@diymail.ca",    "BC", "Foster Brewing Co. Inc.",      "BOOKS_COMPLETE", "INTAKE",    5),
    ("Mia Sullivan",   "mia@diymail.ca",     "ON", "Sullivan Realty Inc.",         "STANDARD",       "INTAKE",    6),
    ("Sophia Reyes",   "sophia@diymail.ca",  "AB", "Reyes Bookkeeping Inc.",       "STANDARD",       "IN_PREP",   8),
    ("Lucas Brandt",   "lucas@diymail.ca",   "AB", "Brandt Fitness Inc.",          "WHITE_GLOVE",    "IN_PREP",   9),
    ("Noah Kim",       "noah@diymail.ca",    "ON", "Kim Software Labs Inc.",       "WHITE_GLOVE",    "IN_REVIEW", 11),
    ("Ava Morales",    "ava@diymail.ca",     "QC", "Morales Catering Inc.",        "STANDARD",       "FILED",     12),
    ("Emma Davies",    "emma@diymail.ca",    "BC", "Davies Florist Inc.",          "BOOKS_COMPLETE", "FILED",     13),
]


# DIY clients are self-filers — they gather personal tax slips, not the
# CPA-style corporate document checklist. Same record shape as docs_for_tier().
DIY_TAX_SLIPS = [
    {"category": "TAX_SLIP", "name": "T4 — Employment income",                      "description": "Employment income and deductions", "is_required": True,  "sort_order": 0},
    {"category": "TAX_SLIP", "name": "T4A — Pension, retirement & other income",     "description": "Pension, annuity and other income", "is_required": True,  "sort_order": 1},
    {"category": "TAX_SLIP", "name": "T5 — Investment income",                       "description": "Interest and dividend income",      "is_required": True,  "sort_order": 2},
    {"category": "TAX_SLIP", "name": "T3 — Trust income",                            "description": "Income from trusts",                "is_required": True,  "sort_order": 3},
    {"category": "TAX_SLIP", "name": "T5008 — Securities transactions",              "description": "Proceeds from securities dispositions", "is_required": False, "sort_order": 4},
    {"category": "TAX_SLIP", "name": "T4E — Employment insurance benefits",          "description": "EI and other benefits",             "is_required": False, "sort_order": 5},
    {"category": "TAX_SLIP", "name": "T4RSP — RRSP income",                          "description": "RRSP withdrawals and income",       "is_required": False, "sort_order": 6},
    {"category": "TAX_SLIP", "name": "T2202 — Tuition & enrolment",                  "description": "Tuition and enrolment certificate", "is_required": False, "sort_order": 7},
]


async def main():
    db = get_db()
    if await db.seed_marker.find_one({"key": MARKER}):
        print(f"Marker '{MARKER}' present — already seeded. Skipping."); return

    partners = [u async for u in db.users.find({"role": "PARTNER", "email": {"$regex": "@partner.ca$"}})]
    partners = [p for p in partners if not p["email"].startswith("deleted")]
    if not partners:
        print("No partner advisor found — aborting."); return
    now = datetime.now(timezone.utc)

    print(f"{'APPLY (writing)' if APPLY else 'DRY-RUN (no writes)'}  partner advisors: {[p['email'] for p in partners]}\n")
    inserted = 0
    for idx, (name, email, prov, corp_name, tier, status, days) in enumerate(DIY_CLIENTS):
        if await db.users.find_one({"email": email}):
            print(f"  skip (exists): {email}"); continue
        print(f"  + {name:16} {corp_name:30} {tier:14} {status}")
        if not APPLY:
            inserted += 1; continue

        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "email": email.lower(), "password_hash": hash_password(PWD),
            "name": name, "role": "CLIENT", "phone": None, "is_active": True, "created_at": now,
            "two_factor_enabled": False,
        })
        corp_id = str(uuid.uuid4())
        ref = now - timedelta(days=days)
        await db.corporations.insert_one({
            "id": corp_id, "name": corp_name, "business_number": f"9{2000000 + idx:07d}RC0001",
            "fiscal_year_start": datetime(2025, 1, 1, tzinfo=timezone.utc),
            "fiscal_year_end": datetime(2025, 12, 31, tzinfo=timezone.utc),
            "province": prov, "practice_type": None, "has_holdco": False, "has_trust": False,
            "client_id": uid, "created_at": now,
        })
        eng_id = str(uuid.uuid4())
        done = status in ("IN_REVIEW", "FILED")
        await db.engagements.insert_one({
            "id": eng_id, "tier": tier, "original_tier": tier, "status": status,
            "service_model": "DIY",
            "cra_access_status": "ACCESS_VERIFIED" if done or status == "IN_PREP" else ("PENDING_VERIFICATION" if status == "INTAKE" else "NOT_STARTED"),
            "cra_access_method": "my_business_account", "cra_programs": None,
            "cra_verified_at": None, "cra_verified_by": None,
            "referral_date": ref,
            "intake_complete_date": ref + timedelta(days=3) if status not in ("REFERRED", "INTAKE") else None,
            "prep_start_date": ref + timedelta(days=4) if status in ("IN_PREP", "IN_REVIEW", "FILED") else None,
            "review_start_date": ref + timedelta(days=6) if status in ("IN_REVIEW", "FILED") else None,
            "delivery_date": None,
            "filing_date": ref + timedelta(days=days) if status == "FILED" else None,
            "filing_confirmation": f"CRA-DIY-{200000 + idx}" if status == "FILED" else None,
            "turnaround_days": days if status == "FILED" else None,
            "notes": None, "corporation_id": corp_id,
            "assigned_cpa_id": None,                       # self-serve: no CPA
            "partner_advisor_id": partners[idx % len(partners)]["id"],
            "created_at": ref, "updated_at": now,
        })
        # tax slips (self-filers gather slips, not the corporate doc checklist)
        docs = [{"id": str(uuid.uuid4()), "engagement_id": eng_id, "category": d["category"],
                 "name": d["name"], "description": d["description"],
                 "status": "PENDING", "is_required": d["is_required"], "sort_order": d["sort_order"],
                 "file_url": None, "object_key": None, "file_size": None, "file_name": None,
                 "created_at": ref} for d in DIY_TAX_SLIPS]
        if docs:
            await db.documents.insert_many(docs)
        cl = [{"id": str(uuid.uuid4()), "engagement_id": eng_id, **c, "completed_at": None, "completed_by_id": None}
              for c in review_checklist_for_tier(tier)]
        if cl:
            await db.checklist.insert_many(cl)
        inserted += 1

    if APPLY and inserted:
        await db.seed_marker.insert_one({"key": MARKER, "applied_at": now})
    print(f"\n{'inserted' if APPLY else 'would insert'}: {inserted} DIY clients")
    print("DONE." if APPLY else "DRY-RUN — re-run with --apply to write.")


if __name__ == "__main__":
    asyncio.run(main())
