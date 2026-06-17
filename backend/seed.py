"""Seed pilot data: 10 physicians, 2 CPAs, 2 WS partners, 10 engagements at various stages.

Idempotent on re-run (skips if seed marker already exists).
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone, timedelta
from db import get_db, create_indexes
from auth import hash_password, seed_admin
from config import docs_for_tier, review_checklist_for_tier
from dotenv import load_dotenv

load_dotenv()


def iso(dt):
    return dt.astimezone(timezone.utc)


# The seed password is read from ``ADMIN_PASSWORD`` (or its alias
# ``SEED_PASSWORD``) so production seeds never use the hardcoded sentinel.
# Local dev gets the documented sentinel for convenience.
_SEED_PWD = os.environ.get("SEED_PASSWORD") or os.environ.get("ADMIN_PASSWORD") or "CloudTax2026!"


def mk_user(email, name, role, phone=None, password=None):
    password = password or _SEED_PWD
    return {
        "id": str(uuid.uuid4()),
        "email": email.lower(),
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "is_active": True,
        "phone": phone,
        "created_at": datetime.now(timezone.utc),
    }


CPAS = [
    ("pallavi@cloudtax.ca", "Pallavi Sharma"),
    ("terryann@cloudtax.ca", "Terry-Ann Mitchell"),
]
WS_PARTNERS = [
    ("watson@partner.ca", "Watson Smith"),
    ("kristin@partner.ca", "Kristin Fox"),
]
PHYSICIANS = [
    ("chen@example.com", "Dr. Emily Chen", "BC", "Family medicine"),
    ("nguyen@example.com", "Dr. Minh Nguyen", "ON", "Anesthesiology"),
    ("martin@example.com", "Dr. Sarah Martin", "AB", "Cardiology"),
    ("ahmed@example.com", "Dr. Youssef Ahmed", "ON", "Internal medicine"),
    ("singh@example.com", "Dr. Amrit Singh", "ON", "Radiology"),
    ("thompson@example.com", "Dr. Rachel Thompson", "BC", "Pediatrics"),
    ("patel@example.com", "Dr. Neel Patel", "ON", "Dermatology"),
    ("liu@example.com", "Dr. Wei Liu", "QC", "Family medicine"),
    ("kaur@example.com", "Dr. Manpreet Kaur", "AB", "Psychiatry"),
    ("okafor@example.com", "Dr. Chinedu Okafor", "MB", "Family medicine"),
]

# [tier, original_tier, status, days_offset, cpa_hours, docs_filed, opps]
ENGAGEMENT_MATRIX = [
    ("BOOKS_COMPLETE", "BOOKS_COMPLETE", "FILED", 9, 3.0, 1.0, 0),
    ("STANDARD", "STANDARD", "FILED", 11, 5.2, 1.0, 1),
    ("WHITE_GLOVE", "WHITE_GLOVE", "FILED", 13, 9.2, 1.0, 3),
    ("BOOKS_COMPLETE", "BOOKS_COMPLETE", "IN_REVIEW", 7, 2.5, 1.0, 0),
    ("WHITE_GLOVE", "WHITE_GLOVE", "IN_REVIEW", 8, 6.5, 0.9, 4),
    ("STANDARD", "STANDARD", "IN_PREP", 5, 3.5, 1.0, 0),
    ("WHITE_GLOVE", "WHITE_GLOVE", "INTAKE", 3, 4.0, 0.6, 0),
    ("STANDARD", "STANDARD", "INTAKE", 2, 0.5, 0.85, 0),
    ("STANDARD", "STANDARD", "REFERRED", 1, 0.0, 0.0, 0),
    ("BOOKS_COMPLETE", "BOOKS_COMPLETE", "REFERRED", 0, 0.0, 0.0, 0),
]

OPPS_BANK = {
    1: [("COMPENSATION_STRATEGY", "MEDIUM", "Review salary/dividend mix",
         "Client retains ~$120K post-tax via current mix; holdco structure could defer more.")],
    3: [
        ("COMPENSATION_STRATEGY", "HIGH", "100% dividend strategy leaving $87K RRSP room unused",
         "Switching to a balanced salary/dividend mix would use ~$31K RRSP contribution and generate ~$8K T4 CPP base."),
        ("SBD_CLAWBACK", "HIGH", "Passive income $47.2K approaching clawback threshold",
         "SBD limit reduces by $5 for every $1 over $50K passive income. Consider CCPC reorganization."),
        ("CDA_EXTRACTION", "MEDIUM", "$112K CDA balance untouched",
         "Capital dividend can be extracted tax-free. Suggest declaring a capital dividend before year-end."),
    ],
    4: [
        ("COMPENSATION_STRATEGY", "HIGH", "100% dividend strategy leaving $87K RRSP room unused",
         "Switch to balanced mix; CPP base enables IPP eligibility in 5-7 years."),
        ("SBD_CLAWBACK", "HIGH", "Passive income $47.2K approaching clawback threshold",
         "Consider corporate-class funds to defer passive income recognition."),
        ("CDA_EXTRACTION", "MEDIUM", "$112K CDA balance untouched",
         "Declare capital dividend to shareholder tax-free."),
        ("HOLDCO_STRUCTURE", "MEDIUM", "Operating co holds $420K unrealized gains",
         "Holdco reorganization would crystallize gains and access LCGE."),
    ],
    2: [("HOLDCO_STRUCTURE", "HIGH", "$800K+ retained earnings without holdco",
         "Establishing a holdco would separate investment activity from professional practice.")],
}


async def main():
    await create_indexes()
    await seed_admin()
    db = get_db()

    marker = await db.seed_marker.find_one({"key": "pilot_v1"})
    if marker:
        print("Seed already applied. Skipping.")
        return

    # Users
    admin = await db.users.find_one({"role": "ADMIN"})

    cpa_users = [mk_user(e, n, "CPA") for e, n in CPAS]
    ws_users = [mk_user(e, n, "WS_PARTNER") for e, n in WS_PARTNERS]
    client_users = [mk_user(e, n, "CLIENT") for e, n, _, _ in PHYSICIANS]

    await db.users.insert_many(cpa_users + ws_users + client_users)

    now = datetime.now(timezone.utc)

    for idx, (client, matrix) in enumerate(zip(client_users, ENGAGEMENT_MATRIX)):
        tier, orig_tier, status, days_offset, hours, doc_frac, n_opps = matrix
        physician_info = PHYSICIANS[idx]
        fiscal_end = datetime(2025, 12, 31, tzinfo=timezone.utc)
        fiscal_start = fiscal_end.replace(year=2025) - timedelta(days=364)

        corp_id = str(uuid.uuid4())
        corp_name = client["name"].replace("Dr. ", "") + " Medicine Professional Corporation"
        await db.corporations.insert_one({
            "id": corp_id,
            "name": corp_name,
            "business_number": f"8{1000000 + idx:07d}RC0001",
            "fiscal_year_start": fiscal_start,
            "fiscal_year_end": fiscal_end,
            "province": physician_info[2],
            "practice_type": physician_info[3],
            "has_holdco": tier == "WHITE_GLOVE" and idx % 2 == 0,
            "has_trust": tier == "WHITE_GLOVE" and idx == 4,
            "client_id": client["id"],
            "created_at": now,
        })

        referral_date = now - timedelta(days=days_offset)
        cpa = cpa_users[idx % 2]
        wsp = ws_users[idx % 2]

        eng_id = str(uuid.uuid4())
        eng = {
            "id": eng_id,
            "tier": tier,
            "original_tier": orig_tier,
            "status": status,
            "cra_access_status": "ACCESS_VERIFIED" if status in ("FILED", "IN_REVIEW", "IN_PREP") else ("PENDING_VERIFICATION" if status == "INTAKE" else "NOT_STARTED"),
            "cra_access_method": "my_business_account" if idx % 2 == 0 else "efile",
            "cra_programs": {"RC0001": True, "RZ0001": idx % 3 == 0, "RP0001": idx % 2 == 0} if status in ("FILED", "IN_REVIEW", "IN_PREP") else None,
            "cra_verified_at": referral_date + timedelta(days=2) if status in ("FILED", "IN_REVIEW", "IN_PREP") else None,
            "cra_verified_by": cpa["id"] if status in ("FILED", "IN_REVIEW", "IN_PREP") else None,
            "referral_date": referral_date,
            "intake_complete_date": referral_date + timedelta(days=3) if status not in ("REFERRED", "INTAKE") else None,
            "prep_start_date": referral_date + timedelta(days=4) if status in ("IN_PREP", "IN_REVIEW", "DELIVERY", "FILED") else None,
            "review_start_date": referral_date + timedelta(days=6) if status in ("IN_REVIEW", "DELIVERY", "FILED") else None,
            "delivery_date": referral_date + timedelta(days=8) if status in ("DELIVERY", "FILED") else None,
            "filing_date": referral_date + timedelta(days=days_offset) if status == "FILED" else None,
            "filing_confirmation": f"CRA-FILE-{100000 + idx}" if status == "FILED" else None,
            "turnaround_days": days_offset if status == "FILED" else None,
            "notes": None,
            "corporation_id": corp_id,
            "assigned_cpa_id": cpa["id"] if status != "REFERRED" else None,
            "ws_advisor_id": wsp["id"],
            "created_at": referral_date,
            "updated_at": now,
        }
        await db.engagements.insert_one(eng)

        # Documents
        doc_defs = docs_for_tier(tier)
        docs = []
        cutoff = int(len(doc_defs) * doc_frac)
        for i, d in enumerate(doc_defs):
            doc_status = "REVIEWED" if i < cutoff and status in ("FILED", "IN_REVIEW") else ("UPLOADED" if i < cutoff else "PENDING")
            docs.append({
                "id": str(uuid.uuid4()),
                "engagement_id": eng_id,
                "category": d["category"],
                "name": d["name"],
                "description": d["description"],
                "status": doc_status,
                "is_required": d["is_required"],
                "sort_order": d["sort_order"],
                "file_url": None,
                "object_key": None,
                "file_size": None,
                "file_name": None,
                "mime_type": None,
                "uploaded_at": referral_date + timedelta(days=1) if doc_status != "PENDING" else None,
                "extracted_data": None,
                "created_at": now,
            })
        if docs:
            await db.documents.insert_many(docs)

        # Review checklist
        cl_items = review_checklist_for_tier(tier)
        # Mark done proportionally
        done_frac = {"FILED": 1.0, "DELIVERY": 0.95, "IN_REVIEW": 0.6, "IN_PREP": 0.25}.get(status, 0)
        done_count = int(len(cl_items) * done_frac)
        checklist_docs = []
        for i, item in enumerate(cl_items):
            checklist_docs.append({
                "id": str(uuid.uuid4()),
                "engagement_id": eng_id,
                "item": item["item"],
                "sort_order": item["sort_order"],
                "is_completed": i < done_count,
                "completed_at": now if i < done_count else None,
                "completed_by_id": cpa["id"] if i < done_count else None,
            })
        if checklist_docs:
            await db.checklist.insert_many(checklist_docs)

        # Time entries (spread across categories)
        if hours > 0:
            cats = ["DOCUMENT_REVIEW", "T2_PREPARATION", "REVIEW_QA"]
            if tier != "BOOKS_COMPLETE":
                cats.append("INVESTMENT_RECONCILIATION")
            if tier == "WHITE_GLOVE":
                cats.append("PLANNING_MEMO")
            per = round(hours / len(cats), 2)
            for i, c in enumerate(cats):
                await db.time_entries.insert_one({
                    "id": str(uuid.uuid4()),
                    "engagement_id": eng_id,
                    "cpa_id": cpa["id"],
                    "category": c,
                    "hours": per,
                    "description": None,
                    "date": referral_date + timedelta(days=i + 1),
                })

        # Opportunities
        if n_opps and idx in OPPS_BANK:
            for cat, sev, title, desc in OPPS_BANK[idx][:n_opps]:
                await db.opportunities.insert_one({
                    "id": str(uuid.uuid4()),
                    "engagement_id": eng_id,
                    "category": cat,
                    "title": title,
                    "description": desc,
                    "severity": sev,
                    "shared_with_ws": status == "FILED",
                    "shared_at": referral_date + timedelta(days=days_offset - 1) if status == "FILED" else None,
                    "ws_followed_up": False,
                    "created_at": referral_date + timedelta(days=5),
                })

        # Extracted data samples for engagements with uploaded docs
        if status in ("FILED", "IN_REVIEW", "IN_PREP"):
            sample_extracts = [
                {"field": "Revenue", "value": f"${450000 + idx * 12000:,}", "source": "Prior T2", "confidence": 0.98, "verified_by_cpa": True},
                {"field": "Net income", "value": f"${280000 + idx * 8000:,}", "source": "Prior T2", "confidence": 0.98, "verified_by_cpa": True},
                {"field": "CDA balance", "value": f"${112000 if idx == 4 else 15000 + idx * 3500:,}", "source": "Prior NOA", "confidence": 0.92, "verified_by_cpa": idx != 4},
                {"field": "Passive income", "value": f"${47200 if idx in (3, 4) else 18000 + idx * 1200:,}", "source": "Brokerage", "confidence": 0.89, "verified_by_cpa": False},
            ]
            for e in sample_extracts:
                await db.extracted_data.insert_one({
                    "id": str(uuid.uuid4()),
                    "engagement_id": eng_id,
                    **e,
                    "created_at": now,
                    "updated_at": now,
                })

    await db.seed_marker.insert_one({"key": "pilot_v1", "applied_at": now})
    print("Seed complete.")


if __name__ == "__main__":
    asyncio.run(main())
