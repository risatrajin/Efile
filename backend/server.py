"""FastAPI application entry point - CloudTax WS Pilot Dashboard."""
from dotenv import load_dotenv
load_dotenv()

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Any

from fastapi import FastAPI, HTTPException, Depends, Request, Response, APIRouter, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from db import get_db, create_indexes
import auth
from auth import (
    hash_password, verify_password, create_access_token, get_current_user,
    require_role, check_brute_force, record_attempt, seed_admin,
    set_auth_cookie, clear_auth_cookie, new_invite_token,
)
import s3_service
import ses_service
import ai_service
from config import (
    docs_for_tier, review_checklist_for_tier, TIER_PRICING,
    CPA_HOURLY_COST, STATUS_LABELS, TIER_LABELS,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cloudtax")

app = FastAPI(title="CloudTax WS Pilot API", version="1.0.0")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@app.on_event("startup")
async def on_startup():
    await create_indexes()
    await seed_admin()
    log.info("Startup complete")


# ==================== Pydantic ====================

class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SetPasswordIn(BaseModel):
    token: str
    password: str = Field(min_length=8)


class InviteUserIn(BaseModel):
    email: EmailStr
    name: str
    role: str
    phone: Optional[str] = None
    display_role: Optional[str] = None  # Admin / Manager / Other / CPA / Partner (UI label)
    permissions: Optional[dict] = None  # 14-flag boolean dict


class CreateEngagementIn(BaseModel):
    client_email: EmailStr
    client_name: str
    phone: Optional[str] = None
    corp_name: str
    business_number: Optional[str] = None
    province: str
    fiscal_year_start: datetime
    fiscal_year_end: datetime
    practice_type: Optional[str] = None
    tier: str
    assigned_cpa_id: Optional[str] = None
    notes: Optional[str] = None


class WsOnboardingIn(BaseModel):
    """Lightweight create-or-update used by the WS partner during onboarding."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    client_email: Optional[EmailStr] = None
    phone: Optional[str] = None
    province: Optional[str] = None
    corp_name: Optional[str] = None
    fiscal_year_end: Optional[datetime] = None
    tier: Optional[str] = None
    notes: Optional[str] = None


class UpdateEngagementIn(BaseModel):
    status: Optional[str] = None
    tier: Optional[str] = None
    assigned_cpa_id: Optional[str] = None
    notes: Optional[str] = None
    cra_access_status: Optional[str] = None
    cra_access_method: Optional[str] = None
    cra_programs: Optional[dict] = None
    filing_confirmation: Optional[str] = None


class OpportunityIn(BaseModel):
    category: str
    title: str
    description: str
    severity: str


class UpdateOpportunityIn(BaseModel):
    shared_with_ws: Optional[bool] = None
    ws_followed_up: Optional[bool] = None


class TimeEntryIn(BaseModel):
    category: str
    hours: float
    description: Optional[str] = None
    date: Optional[datetime] = None


class ChecklistToggleIn(BaseModel):
    is_completed: bool


class DocumentCompleteUploadIn(BaseModel):
    object_key: str
    file_name: str
    file_size: int
    mime_type: str


class ExtractedDataUpdateIn(BaseModel):
    field: str
    value: str
    source: Optional[str] = None
    verified_by_cpa: Optional[bool] = None


# ==================== Helpers ====================

def strip_id(doc: dict) -> dict:
    if not doc:
        return doc
    doc = {k: v for k, v in doc.items() if k != "_id"}
    return doc


def safe_user(u: dict) -> dict:
    if not u:
        return u
    out = {k: v for k, v in u.items() if k not in ("password_hash", "_id")}
    return out


async def log_status_change(engagement_id: str, user_id: str, from_status: str | None, to_status: str, note: str | None = None):
    db = get_db()
    await db.status_history.insert_one({
        "id": str(uuid.uuid4()),
        "engagement_id": engagement_id,
        "changed_by_id": user_id,
        "from_status": from_status,
        "to_status": to_status,
        "note": note,
        "created_at": datetime.now(timezone.utc),
    })


async def notify(user_id: str, title: str, message: str, type_: str, engagement_id: str | None = None):
    db = get_db()
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "engagement_id": engagement_id,
        "type": type_,
        "title": title,
        "message": message,
        "is_read": False,
        "created_at": datetime.now(timezone.utc),
    })


PERMISSION_KEYS = [
    "view_clients", "onboard_clients", "assign_cpa", "reassign_cpa",
    "send_reminders", "send_messages", "view_docs", "move_clients",
    "workload", "view_cpa_hours", "export_data", "settings",
    "audit_logs", "manage_roles",
]


def default_permissions_for(role: str) -> dict:
    if role == "ADMIN":
        return {k: True for k in PERMISSION_KEYS}
    if role == "CPA":
        on = {"view_clients", "send_reminders", "send_messages", "view_docs", "view_cpa_hours"}
        return {k: (k in on) for k in PERMISSION_KEYS}
    if role == "WS_PARTNER":
        on = {"view_clients", "onboard_clients", "assign_cpa", "view_docs", "move_clients", "export_data", "settings"}
        return {k: (k in on) for k in PERMISSION_KEYS}
    return {k: False for k in PERMISSION_KEYS}


async def get_engagement_or_404(engagement_id: str, user: dict) -> dict:
    db = get_db()
    eng = await db.engagements.find_one({"id": engagement_id})
    if not eng:
        raise HTTPException(404, "Engagement not found")
    role = user["role"]
    if role == "ADMIN":
        return strip_id(eng)
    if role == "CPA" and eng.get("assigned_cpa_id") != user["id"]:
        raise HTTPException(403, "Not your engagement")
    if role == "WS_PARTNER" and eng.get("ws_advisor_id") != user["id"]:
        # WS partners can see all pilot engagements per spec; relax filter
        pass
    if role == "CLIENT":
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if not corp or corp["client_id"] != user["id"]:
            raise HTTPException(403, "Not your engagement")
    return strip_id(eng)


def redact_for_ws(eng: dict) -> dict:
    # WS partners never see notes or extracted financial data (handled server-side in queries)
    eng = dict(eng)
    eng.pop("notes", None)
    return eng


def redact_for_client(eng: dict) -> dict:
    eng = dict(eng)
    # Clients never see pricing / tier labels / notes
    eng["tier"] = None
    eng["original_tier"] = None
    eng.pop("notes", None)
    return eng


# ==================== Auth ====================

@api.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    db = get_db()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{body.email.lower()}"
    await check_brute_force(identifier)

    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("is_active", True) or not verify_password(body.password, user["password_hash"]):
        await record_attempt(identifier, False)
        raise HTTPException(401, "Invalid email or password")

    await record_attempt(identifier, True)
    token = create_access_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    return {"user": safe_user(user), "token": token}


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return safe_user(user)


@api.post("/auth/set-password")
async def set_password(body: SetPasswordIn):
    db = get_db()
    row = await db.password_reset_tokens.find_one({"token": body.token, "used": False})
    if not row:
        raise HTTPException(400, "Invalid or expired token")
    if row["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise HTTPException(400, "Token expired")
    await db.users.update_one({"id": row["user_id"]}, {"$set": {"password_hash": hash_password(body.password)}})
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    return {"ok": True}


# ==================== Users (Admin) ====================

@api.get("/users")
async def list_users(user: dict = Depends(require_role("ADMIN", "CPA", "WS_PARTNER"))):
    db = get_db()
    role = user["role"]
    q = {}
    if role == "CPA":
        q = {"role": {"$in": ["CLIENT", "CPA", "ADMIN"]}}
    users = []
    async for u in db.users.find(q, {"password_hash": 0, "_id": 0}).sort("name", 1):
        users.append(u)
    return users


@api.post("/users/invite")
async def invite_user(body: InviteUserIn, user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    if body.role not in ("CLIENT", "CPA", "WS_PARTNER", "ADMIN"):
        raise HTTPException(400, "Invalid role")
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(409, "User already exists")
    uid = str(uuid.uuid4())
    temp_pass = uuid.uuid4().hex  # random placeholder
    # Default display_role from canonical role
    default_display = {"ADMIN": "Admin", "CPA": "CPA", "WS_PARTNER": "Partner", "CLIENT": "Client"}.get(body.role, body.role)
    await db.users.insert_one({
        "id": uid,
        "email": body.email.lower(),
        "password_hash": hash_password(temp_pass),
        "name": body.name,
        "role": body.role,
        "phone": body.phone,
        "display_role": body.display_role or default_display,
        "permissions": body.permissions or default_permissions_for(body.role),
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    })
    token = new_invite_token()
    await db.password_reset_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "token": token,
        "user_id": uid,
        "used": False,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })
    invite_link = f"{FRONTEND_URL}/set-password?token={token}"
    ses_service.send_invite(body.email, body.name, invite_link, body.role)
    log.info("Invite issued: %s -> %s", body.email, invite_link)
    return {"user_id": uid, "invite_link": invite_link}


class UpdateProfileIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    notification_prefs: Optional[dict] = None
    corporation: Optional[dict] = None  # name, business_number, address


@api.patch("/users/me")
async def update_me(body: UpdateProfileIn, user: dict = Depends(get_current_user)):
    db = get_db()
    updates = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.phone is not None:
        updates["phone"] = body.phone.strip() or None
    if body.notification_prefs is not None:
        updates["notification_prefs"] = body.notification_prefs
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})

    if body.corporation and user["role"] == "CLIENT":
        corp = await db.corporations.find_one({"client_id": user["id"]})
        if corp:
            corp_updates = {}
            for f in ("name", "business_number", "address"):
                v = body.corporation.get(f)
                if v is not None:
                    corp_updates[f] = v.strip() if isinstance(v, str) else v
            if corp_updates:
                await db.corporations.update_one({"id": corp["id"]}, {"$set": corp_updates})

    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    if me and me["role"] == "CLIENT":
        corp = await db.corporations.find_one({"client_id": user["id"]}, {"_id": 0})
        me["corporation"] = corp
    return me


@api.get("/users/me/full")
async def me_full(user: dict = Depends(get_current_user)):
    db = get_db()
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    if me and me["role"] == "CLIENT":
        corp = await db.corporations.find_one({"client_id": user["id"]}, {"_id": 0})
        me["corporation"] = corp
    return me


@api.patch("/users/{uid}")
async def update_user(uid: str, body: dict, user: dict = Depends(require_role("ADMIN"))):
    if uid == "me":
        raise HTTPException(404, "Not found")
    db = get_db()
    allowed = {"name", "role", "phone", "is_active", "display_role", "permissions"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    await db.users.update_one({"id": uid}, {"$set": updates})
    u = await db.users.find_one({"id": uid}, {"password_hash": 0, "_id": 0})
    return u


@api.get("/users/team")
async def list_team(user: dict = Depends(require_role("ADMIN"))):
    """Members shown in Roles & Permissions table — excludes CLIENT role."""
    db = get_db()
    out = []
    async for u in db.users.find({"role": {"$ne": "CLIENT"}}, {"password_hash": 0, "_id": 0}).sort("name", 1):
        if not u.get("permissions"):
            u["permissions"] = default_permissions_for(u["role"])
        if not u.get("display_role"):
            u["display_role"] = {"ADMIN": "Admin", "CPA": "CPA", "WS_PARTNER": "Partner"}.get(u["role"], u["role"])
        out.append(u)
    return out


# ==================== Engagements ====================

async def _enrich_engagements(engs: list[dict]) -> list[dict]:
    db = get_db()
    corp_ids = list({e["corporation_id"] for e in engs})
    user_ids = set()
    for e in engs:
        user_ids.update(filter(None, [e.get("assigned_cpa_id"), e.get("ws_advisor_id")]))
    corps = {c["id"]: c async for c in db.corporations.find({"id": {"$in": corp_ids}}, {"_id": 0})}
    for c in corps.values():
        user_ids.add(c.get("client_id"))
    users = {}
    async for u in db.users.find({"id": {"$in": list(user_ids)}}, {"password_hash": 0, "_id": 0}):
        users[u["id"]] = u
    enriched = []
    for e in engs:
        corp = corps.get(e["corporation_id"]) or {}
        e = strip_id(e)
        e["corporation"] = corp
        e["client"] = users.get(corp.get("client_id"))
        e["assigned_cpa"] = users.get(e.get("assigned_cpa_id"))
        e["ws_advisor"] = users.get(e.get("ws_advisor_id"))
        # Quick progress
        counts = await db.documents.count_documents({"engagement_id": e["id"]})
        uploaded = await db.documents.count_documents({"engagement_id": e["id"], "status": {"$in": ["UPLOADED", "REVIEWED", "EXTRACTED"]}})
        e["docs_total"] = counts
        e["docs_uploaded"] = uploaded
        hours_agg = await db.time_entries.aggregate([
            {"$match": {"engagement_id": e["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$hours"}}},
        ]).to_list(1)
        e["cpa_hours"] = hours_agg[0]["total"] if hours_agg else 0
        e["opps_count"] = await db.opportunities.count_documents({"engagement_id": e["id"]})
        # Days elapsed
        ref = e.get("referral_date")
        if ref:
            ref_dt = ref if isinstance(ref, datetime) else datetime.fromisoformat(ref)
            if ref_dt.tzinfo is None:
                ref_dt = ref_dt.replace(tzinfo=timezone.utc)
            end_dt = e.get("filing_date") if e.get("filing_date") else datetime.now(timezone.utc)
            if not isinstance(end_dt, datetime):
                end_dt = datetime.fromisoformat(end_dt)
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            e["days_elapsed"] = max(0, (end_dt - ref_dt).days)
        enriched.append(e)
    return enriched


@api.get("/engagements")
async def list_engagements(user: dict = Depends(get_current_user)):
    db = get_db()
    role = user["role"]
    q = {}
    if role == "CPA":
        q = {"assigned_cpa_id": user["id"]}
    elif role == "CLIENT":
        corp = await db.corporations.find_one({"client_id": user["id"]})
        if not corp:
            return []
        q = {"corporation_id": corp["id"]}
    engs = [e async for e in db.engagements.find(q).sort("referral_date", -1)]
    out = await _enrich_engagements(engs)
    if role == "WS_PARTNER":
        out = [redact_for_ws(e) for e in out]
    if role == "CLIENT":
        out = [redact_for_client(e) for e in out]
    return out


@api.post("/engagements")
async def create_engagement(body: CreateEngagementIn, user: dict = Depends(require_role("ADMIN", "WS_PARTNER"))):
    db = get_db()
    # Find or create client user
    client_email = body.client_email.lower()
    client = await db.users.find_one({"email": client_email})
    invite_link = None
    if not client:
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid,
            "email": client_email,
            "password_hash": hash_password(uuid.uuid4().hex),
            "name": body.client_name,
            "role": "CLIENT",
            "phone": body.phone,
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
        })
        client = await db.users.find_one({"id": uid})
        token = new_invite_token()
        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "token": token,
            "user_id": uid,
            "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=14),
            "created_at": datetime.now(timezone.utc),
        })
        invite_link = f"{FRONTEND_URL}/set-password?token={token}"
        ses_service.send_invite(client_email, body.client_name, invite_link, "client")
    corp_id = str(uuid.uuid4())
    await db.corporations.insert_one({
        "id": corp_id,
        "name": body.corp_name,
        "business_number": body.business_number,
        "fiscal_year_start": body.fiscal_year_start,
        "fiscal_year_end": body.fiscal_year_end,
        "province": body.province,
        "practice_type": body.practice_type,
        "has_holdco": False,
        "has_trust": False,
        "client_id": client["id"],
        "created_at": datetime.now(timezone.utc),
    })
    eng_id = str(uuid.uuid4())
    ws_advisor_id = user["id"] if user["role"] == "WS_PARTNER" else None
    eng_doc = {
        "id": eng_id,
        "tier": body.tier,
        "original_tier": body.tier,
        "status": "REFERRED",
        "cra_access_status": "NOT_STARTED",
        "cra_access_method": None,
        "cra_programs": None,
        "referral_date": datetime.now(timezone.utc),
        "notes": body.notes,
        "corporation_id": corp_id,
        "assigned_cpa_id": body.assigned_cpa_id,
        "ws_advisor_id": ws_advisor_id,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.engagements.insert_one(eng_doc)
    # Seed documents and checklist
    docs = [
        {"id": str(uuid.uuid4()), "engagement_id": eng_id, **d, "status": "PENDING", "created_at": datetime.now(timezone.utc)}
        for d in await _docs_for_tier_with_template(body.tier)
    ]
    if docs:
        await db.documents.insert_many(docs)
    cl = [{"id": str(uuid.uuid4()), "engagement_id": eng_id, **c, "completed_at": None, "completed_by_id": None} for c in review_checklist_for_tier(body.tier)]
    if cl:
        await db.checklist.insert_many(cl)
    await log_status_change(eng_id, user["id"], None, "REFERRED", "Engagement created")
    if body.assigned_cpa_id:
        await notify(body.assigned_cpa_id, "New client referred", f"{body.client_name} ({body.corp_name})", "new_referral", eng_id)
    return {"id": eng_id, "invite_link": invite_link}


@api.get("/engagements/{eid}")
async def get_engagement(eid: str, user: dict = Depends(get_current_user)):
    eng = await get_engagement_or_404(eid, user)
    out = await _enrich_engagements([eng])
    e = out[0]
    if user["role"] == "CLIENT":
        e = redact_for_client(e)
    if user["role"] == "WS_PARTNER":
        e = redact_for_ws(e)
    return e


# ---- WS partner onboarding flow ----

DEFAULT_PRE_FILING_CHECKLIST = [
    "Corporation info confirmed",
    "Fiscal year-end verified",
    "Prior year T2 on file?",
    "CRA access requested",
    "Client signed engagement letter",
    "WS advisor notified",
]


def _new_checklist():
    return [{"id": str(uuid.uuid4()), "item": label, "is_completed": False, "sort_order": i}
            for i, label in enumerate(DEFAULT_PRE_FILING_CHECKLIST)]


async def _checklist_from_template():
    """Build a fresh per-engagement checklist from the global partner template, falling back to DEFAULT_PRE_FILING_CHECKLIST."""
    db = get_db()
    doc = await db.settings.find_one({"key": "checklist_template"}, {"_id": 0})
    items = (doc or {}).get("items") or []
    if not items:
        return _new_checklist()
    return [{"id": str(uuid.uuid4()), "item": it["label"], "is_completed": False, "sort_order": i}
            for i, it in enumerate(items)]


ONBOARDING_FIELDS = ["client_name", "client_email", "phone", "province", "corp_name", "fiscal_year_end", "tier"]


def _onboarding_progress(eng: dict, corp: dict, client: dict) -> dict:
    """Pre-filing checklist completion (replaces field-completeness check)."""
    cl = eng.get("pre_filing_checklist") or []
    completed = sum(1 for c in cl if c.get("is_completed"))
    total = len(cl) or 6
    return {"completed": completed, "total": total, "ready": total > 0 and completed >= total, "checklist": cl}


@api.post("/engagements/onboarding")
async def ws_create_onboarding(body: WsOnboardingIn, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    """Create a draft engagement in ONBOARDING status with whatever fields are provided."""
    db = get_db()
    if not body.client_email or not body.first_name:
        raise HTTPException(400, "first_name and client_email required to start a draft")
    full_name = f"{body.first_name.strip()} {body.last_name.strip()}".strip() if body.last_name else body.first_name.strip()
    email = body.client_email.lower()
    invite_link = None
    client = await db.users.find_one({"email": email})
    if not client:
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid,
            "email": email,
            "password_hash": hash_password(uuid.uuid4().hex),
            "name": full_name,
            "role": "CLIENT",
            "phone": body.phone,
            "is_active": True,
            "created_at": datetime.now(timezone.utc),
            "notification_prefs": {"email": {"return_updates": True, "doc_reminders": True, "announcements": True, "tax_tips": False}, "push": {"doc_requests": True, "cpa_messages": True}},
            "two_factor_enabled": False,
        })
        client = await db.users.find_one({"id": uid})
        # Issue a set-password invite for the new client (idempotent — only on first creation)
        token = new_invite_token()
        await db.password_reset_tokens.insert_one({
            "id": str(uuid.uuid4()),
            "token": token,
            "user_id": uid,
            "used": False,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=14),
            "created_at": datetime.now(timezone.utc),
        })
        invite_link = f"{FRONTEND_URL}/set-password?token={token}"
        try:
            ses_service.send_invite(email, full_name, invite_link, "client")
        except Exception as e:
            log.warning("send_invite failed (likely SES sandbox): %s", e)
        log.info("WS onboarding invite issued: %s -> %s", email, invite_link)
    corp_id = str(uuid.uuid4())
    await db.corporations.insert_one({
        "id": corp_id,
        "name": body.corp_name or f"{full_name} Medicine Professional Corporation",
        "business_number": None,
        "fiscal_year_start": None,
        "fiscal_year_end": body.fiscal_year_end,
        "province": body.province,
        "practice_type": None,
        "has_holdco": False,
        "has_trust": False,
        "address": None,
        "client_id": client["id"],
        "created_at": datetime.now(timezone.utc),
    })
    eng_id = str(uuid.uuid4())
    await db.engagements.insert_one({
        "id": eng_id,
        "tier": body.tier,
        "original_tier": body.tier,
        "status": "ONBOARDING",
        "cra_access_status": "NOT_STARTED",
        "cra_access_method": None,
        "cra_programs": None,
        "referral_date": None,
        "notes": body.notes,
        "corporation_id": corp_id,
        "assigned_cpa_id": None,
        "ws_advisor_id": user["id"],
        "pre_filing_checklist": await _checklist_from_template(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    return {"id": eng_id, "invite_link": invite_link}


@api.post("/engagements/{eid}/resend-invite")
async def resend_client_invite(eid: str, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    """Re-issue a fresh set-password invite for the client on this engagement."""
    db = get_db()
    eng = await db.engagements.find_one({"id": eid})
    if not eng:
        raise HTTPException(404, "Engagement not found")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if not corp:
        raise HTTPException(404, "Corporation not found")
    client = await db.users.find_one({"id": corp["client_id"]})
    if not client:
        raise HTTPException(404, "Client not found")
    # Invalidate previous unused tokens for this user
    await db.password_reset_tokens.update_many(
        {"user_id": client["id"], "used": False},
        {"$set": {"used": True}},
    )
    token = new_invite_token()
    await db.password_reset_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "token": token,
        "user_id": client["id"],
        "used": False,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=14),
        "created_at": datetime.now(timezone.utc),
    })
    invite_link = f"{FRONTEND_URL}/set-password?token={token}"
    try:
        ses_service.send_invite(client["email"], client.get("name") or "Client", invite_link, "client")
    except Exception as e:
        log.warning("send_invite failed (likely SES sandbox): %s", e)
    log.info("Invite re-issued: %s -> %s", client["email"], invite_link)
    return {"invite_link": invite_link, "client_email": client["email"]}


@api.patch("/engagements/{eid}/onboarding")
async def ws_update_onboarding(eid: str, body: WsOnboardingIn, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    db = get_db()
    eng = await db.engagements.find_one({"id": eid})
    if not eng:
        raise HTTPException(404, "Engagement not found")
    if eng.get("status") != "ONBOARDING":
        raise HTTPException(400, "Only ONBOARDING engagements can be edited via this route")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    client = await db.users.find_one({"id": corp["client_id"]}) if corp else None

    # Update client name from first/last
    if body.first_name or body.last_name:
        first = (body.first_name or "").strip()
        last = (body.last_name or "").strip()
        full = f"{first} {last}".strip() if last else (first if first else None)
        if full and client:
            await db.users.update_one({"id": client["id"]}, {"$set": {"name": full}})
    if body.client_email and client:
        await db.users.update_one({"id": client["id"]}, {"$set": {"email": body.client_email.lower()}})
    if body.phone is not None and client:
        await db.users.update_one({"id": client["id"]}, {"$set": {"phone": body.phone}})

    if corp:
        corp_updates = {}
        if body.corp_name is not None:
            corp_updates["name"] = body.corp_name
        if body.province is not None:
            corp_updates["province"] = body.province
        if body.fiscal_year_end is not None:
            corp_updates["fiscal_year_end"] = body.fiscal_year_end
            corp_updates["fiscal_year_start"] = body.fiscal_year_end - timedelta(days=364)
        if corp_updates:
            await db.corporations.update_one({"id": corp["id"]}, {"$set": corp_updates})

    eng_updates = {}
    if body.tier is not None:
        eng_updates["tier"] = body.tier
        eng_updates["original_tier"] = body.tier
    if body.notes is not None:
        eng_updates["notes"] = body.notes
    if eng_updates:
        eng_updates["updated_at"] = datetime.now(timezone.utc)
        await db.engagements.update_one({"id": eid}, {"$set": eng_updates})
    return {"ok": True}


@api.post("/engagements/{eid}/submit")
async def ws_submit_to_cloudtax(eid: str, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    """Move ONBOARDING engagement to REFERRED, creating doc + review checklists."""
    db = get_db()
    eng = await db.engagements.find_one({"id": eid})
    if not eng:
        raise HTTPException(404, "Engagement not found")
    if eng.get("status") != "ONBOARDING":
        raise HTTPException(400, "Engagement is not in onboarding")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    client = await db.users.find_one({"id": corp["client_id"]}) if corp else None
    progress = _onboarding_progress(eng, corp or {}, client or {})
    if not progress["ready"]:
        raise HTTPException(400, f"Onboarding incomplete ({progress['completed']}/{progress['total']})")
    now = datetime.now(timezone.utc)
    await db.engagements.update_one({"id": eid}, {"$set": {
        "status": "REFERRED",
        "referral_date": now,
        "updated_at": now,
    }})
    await log_status_change(eid, user["id"], "ONBOARDING", "REFERRED", "Submitted to CloudTax by WS partner")
    # Seed documents + checklist
    docs = [
        {"id": str(uuid.uuid4()), "engagement_id": eid, **d, "status": "PENDING", "is_new_request": False, "issue_note": None, "request_note": None, "deferred_at": None, "created_at": now}
        for d in await _docs_for_tier_with_template(eng["tier"])
    ]
    if docs:
        await db.documents.insert_many(docs)
    cl = [{"id": str(uuid.uuid4()), "engagement_id": eid, **c, "completed_at": None, "completed_by_id": None} for c in review_checklist_for_tier(eng["tier"])]
    if cl:
        await db.checklist.insert_many(cl)
    return {"ok": True}


@api.get("/engagements/{eid}/onboarding-progress")
async def ws_onboarding_progress(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    eng = await db.engagements.find_one({"id": eid})
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    client = await db.users.find_one({"id": corp["client_id"]}) if corp else None
    return _onboarding_progress(eng or {}, corp or {}, client or {})


class ChecklistArrayIn(BaseModel):
    items: list[dict]  # each: {id?, item, is_completed, sort_order?}


@api.patch("/engagements/{eid}/pre-filing-checklist")
async def ws_update_checklist(eid: str, body: ChecklistArrayIn, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    db = get_db()
    eng = await db.engagements.find_one({"id": eid})
    if not eng:
        raise HTTPException(404, "Not found")
    cleaned = []
    for i, c in enumerate(body.items):
        if not c.get("item", "").strip():
            continue
        cleaned.append({
            "id": c.get("id") or str(uuid.uuid4()),
            "item": c["item"].strip(),
            "is_completed": bool(c.get("is_completed")),
            "sort_order": i,
        })
    await db.engagements.update_one({"id": eid}, {"$set": {"pre_filing_checklist": cleaned, "updated_at": datetime.now(timezone.utc)}})
    return {"items": cleaned}


@api.patch("/engagements/{eid}")
async def update_engagement(eid: str, body: UpdateEngagementIn, user: dict = Depends(get_current_user)):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] not in ("ADMIN", "CPA"):
        raise HTTPException(403, "Only admin/cpa can update engagement")
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    now = datetime.now(timezone.utc)
    updates["updated_at"] = now
    # Status transitions
    if "status" in updates and updates["status"] != eng["status"]:
        s = updates["status"]
        await log_status_change(eid, user["id"], eng["status"], s)
        if s == "INTAKE":
            updates["intake_complete_date"] = now
        elif s == "IN_PREP":
            updates["prep_start_date"] = now
        elif s == "IN_REVIEW":
            updates["review_start_date"] = now
        elif s == "DELIVERY":
            updates["delivery_date"] = now
        elif s == "FILED":
            updates["filing_date"] = now
            ref = eng.get("referral_date")
            if ref:
                if not isinstance(ref, datetime):
                    ref = datetime.fromisoformat(str(ref))
                if ref.tzinfo is None:
                    ref = ref.replace(tzinfo=timezone.utc)
                updates["turnaround_days"] = (now - ref).days
            # Notify client + WS
            corp = await db.corporations.find_one({"id": eng["corporation_id"]})
            if corp:
                client = await db.users.find_one({"id": corp["client_id"]})
                if client:
                    await notify(client["id"], "T2 filed with CRA", f"{corp['name']} has been filed", "filing_complete", eid)
                    ses_service.send_filing_complete(client["email"], client["name"], corp["name"], f"{FRONTEND_URL}/portal/{eid}")
            if eng.get("ws_advisor_id"):
                await notify(eng["ws_advisor_id"], "Filing complete", f"{eng['id'][:8]} T2 filed with CRA", "filing_complete", eid)
    if "cra_access_status" in updates and updates["cra_access_status"] == "ACCESS_VERIFIED":
        updates["cra_verified_at"] = now
        updates["cra_verified_by"] = user["id"]
    await db.engagements.update_one({"id": eid}, {"$set": updates})
    eng = await db.engagements.find_one({"id": eid}, {"_id": 0})
    return eng


# ==================== Documents ====================

@api.get("/engagements/{eid}/documents")
async def list_documents(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot view documents")
    db = get_db()
    docs = [d async for d in db.documents.find({"engagement_id": eid}, {"_id": 0}).sort("sort_order", 1)]
    return docs


@api.get("/engagements/{eid}/documents/summary")
async def list_documents_summary(eid: str, user: dict = Depends(get_current_user)):
    """Lightweight name+status list visible to WS partners (no download URLs, no S3 keys)."""
    await get_engagement_or_404(eid, user)
    db = get_db()
    out = []
    async for d in db.documents.find(
        {"engagement_id": eid},
        {"_id": 0, "id": 1, "name": 1, "description": 1, "status": 1, "is_required": 1, "tag": 1, "sort_order": 1, "deferred_at": 1},
    ).sort("sort_order", 1):
        out.append(d)
    return out


@api.post("/documents/{doc_id}/upload-url")
async def doc_upload_url(doc_id: str, body: dict, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot upload documents")
    content_type = body.get("content_type", "application/octet-stream")
    file_name = body.get("file_name", "upload.bin")
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._-")[:80] or "file"
    object_key = f"engagements/{doc['engagement_id']}/{doc_id}/{uuid.uuid4().hex}_{safe_name}"
    res = s3_service.generate_upload_url(object_key, content_type)
    if not res:
        raise HTTPException(500, "Could not generate upload URL")
    return res


@api.post("/documents/{doc_id}/complete-upload")
async def doc_complete_upload(doc_id: str, body: DocumentCompleteUploadIn, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    now = datetime.now(timezone.utc)
    await db.documents.update_one({"id": doc_id}, {"$set": {
        "status": "UPLOADED",
        "object_key": body.object_key,
        "file_name": body.file_name,
        "file_size": body.file_size,
        "mime_type": body.mime_type,
        "uploaded_at": now,
        "issue_note": None,
        "deferred_at": None,
    }})
    # Notify CPA
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Document uploaded", f"{doc['name']} uploaded", "document_uploaded", eng["id"])
    # Auto-advance REFERRED -> INTAKE on first upload
    if eng["status"] == "REFERRED":
        await db.engagements.update_one({"id": eng["id"]}, {"$set": {"status": "INTAKE", "updated_at": now}})
        await log_status_change(eng["id"], user["id"], "REFERRED", "INTAKE", "First document uploaded")
    return {"ok": True}


@api.delete("/documents/{doc_id}/upload")
async def doc_remove_upload(doc_id: str, user: dict = Depends(get_current_user)):
    """Remove an uploaded file (S3 or local) and reset the doc back to PENDING."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot remove documents")
    if doc.get("status") not in ("UPLOADED", "REVIEWED", "EXTRACTED"):
        raise HTTPException(400, "Nothing to remove")

    key = doc.get("object_key") or ""
    if key.startswith("local://"):
        path = key[len("local://"):]
        try:
            if os.path.isfile(path):
                os.remove(path)
        except Exception as e:
            log.warning("Failed to remove local file %s: %s", path, e)
    elif key:
        try:
            s3_service.get_client().delete_object(Bucket=s3_service.bucket_name(), Key=key)
        except Exception as e:
            log.warning("Failed to delete S3 object %s: %s", key, e)

    await db.documents.update_one({"id": doc_id}, {
        "$set": {"status": "PENDING"},
        "$unset": {"object_key": "", "storage": "", "file_name": "", "file_size": "", "mime_type": "", "uploaded_at": "", "extracted_data": ""},
    })
    # Also remove any extracted rows tied to this doc
    await db.extracted_data.delete_many({"document_id": doc_id})
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Document removed", f"{doc['name']} was removed by the client", "document_removed", eng["id"])
    return {"ok": True}


@api.post("/documents/{doc_id}/upload")
async def doc_upload_proxy(doc_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Server-side proxy upload — tries S3, falls back to local disk if S3 unavailable.
    Used because direct browser PUT to S3 requires CORS + IAM s3:PutObject which may not be configured yet."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot upload documents")

    body = await file.read()
    if not body:
        raise HTTPException(400, "Empty file")
    if len(body) > 50 * 1024 * 1024:
        raise HTTPException(413, "File exceeds 50 MB limit")

    safe_name = "".join(c for c in (file.filename or "upload.bin") if c.isalnum() or c in "._-")[:80] or "file"
    object_key = f"engagements/{doc['engagement_id']}/{doc_id}/{uuid.uuid4().hex}_{safe_name}"
    content_type = file.content_type or "application/octet-stream"

    # Try S3 first; fall back to local disk if it fails (e.g. CORS, IAM perms not set up yet)
    storage = "s3"
    if not s3_service.put_object_bytes(object_key, body, content_type):
        storage = "local"
        local_dir = os.path.join(os.path.dirname(__file__), "uploads", doc["engagement_id"], doc_id)
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, f"{uuid.uuid4().hex}_{safe_name}")
        with open(local_path, "wb") as f:
            f.write(body)
        object_key = f"local://{local_path}"
        log.warning("S3 upload failed for %s — stored locally at %s", doc_id, local_path)

    now = datetime.now(timezone.utc)
    await db.documents.update_one({"id": doc_id}, {"$set": {
        "status": "UPLOADED",
        "object_key": object_key,
        "storage": storage,
        "file_name": file.filename,
        "file_size": len(body),
        "mime_type": content_type,
        "uploaded_at": now,
        "issue_note": None,
        "deferred_at": None,
    }})
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Document uploaded", f"{doc['name']} uploaded", "document_uploaded", eng["id"])
    if eng["status"] == "REFERRED":
        await db.engagements.update_one({"id": eng["id"]}, {"$set": {"status": "INTAKE", "updated_at": now}})
        await log_status_change(eng["id"], user["id"], "REFERRED", "INTAKE", "First document uploaded")
    return {"ok": True, "file_name": file.filename, "file_size": len(body), "storage": storage}


@api.get("/documents/{doc_id}/download-url")
async def doc_download_url(doc_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot download documents")
    if not doc.get("object_key"):
        raise HTTPException(404, "No file uploaded for this document")
    # Local-fallback storage: hand back our own download endpoint
    if doc.get("storage") == "local" or str(doc.get("object_key", "")).startswith("local://"):
        return {"download_url": f"/api/documents/{doc_id}/download"}
    url = s3_service.generate_download_url(doc["object_key"], doc.get("file_name"))
    if not url:
        raise HTTPException(500, "Could not generate download URL")
    return {"download_url": url}


@api.get("/documents/{doc_id}/download")
async def doc_download_local(doc_id: str, token: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Serve a locally-stored file (used when S3 upload fell back to local disk)."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "WS partners cannot download documents")
    key = doc.get("object_key") or ""
    if not key.startswith("local://"):
        raise HTTPException(404, "Not a local file")
    path = key[len("local://"):]
    if not os.path.isfile(path):
        raise HTTPException(404, "File missing on disk")
    from fastapi.responses import FileResponse
    return FileResponse(path, media_type=doc.get("mime_type") or "application/octet-stream", filename=doc.get("file_name") or "download")


@api.patch("/documents/{doc_id}")
async def update_document(doc_id: str, body: dict, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    allowed = {"status", "issue_note", "request_note"}
    updates = {k: v for k, v in body.items() if k in allowed}
    # Clear issue_note when moving away from ISSUE
    if updates.get("status") and updates["status"] != "ISSUE":
        updates["issue_note"] = None
    if updates:
        await db.documents.update_one({"id": doc_id}, {"$set": updates})
    # Notify client when CPA flags an issue
    if updates.get("status") == "ISSUE":
        eng = await db.engagements.find_one({"id": doc["engagement_id"]})
        if eng:
            corp = await db.corporations.find_one({"id": eng["corporation_id"]})
            if corp:
                await notify(corp["client_id"], "Document needs attention", f"{doc['name']}: {updates.get('issue_note', 'Please review')}", "document_issue", eng["id"])
    d = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    return d


class NewDocRequestIn(BaseModel):
    category: str = "OTHER"
    name: str
    description: Optional[str] = None
    request_note: str
    is_required: bool = True


@api.post("/engagements/{eid}/documents/request")
async def request_new_document(eid: str, body: NewDocRequestIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    await get_engagement_or_404(eid, user)
    # Place new request at the top (negative sort_order)
    new_doc = {
        "id": str(uuid.uuid4()),
        "engagement_id": eid,
        "category": body.category,
        "name": body.name,
        "description": body.description,
        "status": "PENDING",
        "is_required": body.is_required,
        "is_new_request": True,
        "request_note": body.request_note,
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
    }
    await db.documents.insert_one(new_doc)
    eng = await db.engagements.find_one({"id": eid})
    if eng:
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if corp:
            await notify(corp["client_id"], "New document requested", f"{body.name}: {body.request_note}", "new_doc_request", eid)
    return {k: v for k, v in new_doc.items() if k != "_id"}


@api.post("/documents/{doc_id}/defer")
async def defer_document(doc_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")
    await db.documents.update_one({"id": doc_id}, {"$set": {"deferred_at": datetime.now(timezone.utc)}})
    return {"ok": True}


REMINDER_COOLDOWN_HOURS = 48


@api.post("/engagements/{eid}/remind-deferred")
async def remind_deferred(eid: str, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    # Cooldown
    last = eng.get("deferred_reminder_sent_at")
    if last:
        last_dt = last if isinstance(last, datetime) else datetime.fromisoformat(str(last))
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        next_ok = last_dt + timedelta(hours=REMINDER_COOLDOWN_HOURS)
        if datetime.now(timezone.utc) < next_ok:
            raise HTTPException(429, f"Reminder already sent. Try again after {next_ok.isoformat()}")
    deferred_docs = [d async for d in db.documents.find({"engagement_id": eid, "deferred_at": {"$ne": None}}, {"_id": 0, "name": 1})]
    if not deferred_docs:
        raise HTTPException(400, "No deferred documents to remind about")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if not corp:
        raise HTTPException(500, "Corporation missing")
    client = await db.users.find_one({"id": corp["client_id"]})
    if not client:
        raise HTTPException(500, "Client missing")
    portal_link = f"{FRONTEND_URL}/portal"
    result = ses_service.send_deferred_reminder(client["email"], client["name"], [d["name"] for d in deferred_docs], portal_link)
    now = datetime.now(timezone.utc)
    await db.engagements.update_one(
        {"id": eid},
        {"$set": {"deferred_reminder_sent_at": now}, "$inc": {"deferred_reminder_count": 1}},
    )
    await notify(client["id"], "Friendly reminder", f"{len(deferred_docs)} documents still pending upload", "deferred_reminder", eid)
    return {"ok": True, "sent_at": now, "doc_count": len(deferred_docs), "email_sent": result.get("success", False)}


@api.get("/engagements/{eid}/history")
async def engagement_history(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    if user["role"] in ("CLIENT", "WS_PARTNER"):
        raise HTTPException(403, "Not permitted")
    rows = [r async for r in db.status_history.find({"engagement_id": eid}, {"_id": 0}).sort("created_at", -1)]
    user_ids = list({r["changed_by_id"] for r in rows if r.get("changed_by_id")})
    users = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"password_hash": 0, "_id": 0}):
        users[u["id"]] = u
    for r in rows:
        r["changed_by"] = users.get(r.get("changed_by_id"))
    return rows


@api.post("/documents/{doc_id}/extract")
async def extract_document(doc_id: str, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc or not doc.get("object_key"):
        raise HTTPException(404, "Document not uploaded")
    blob = s3_service.get_object_bytes(doc["object_key"])
    if not blob:
        raise HTTPException(500, "Could not fetch document bytes")
    result = await ai_service.extract_from_pdf(blob, doc.get("mime_type") or "application/pdf", doc["category"])
    await db.documents.update_one({"id": doc_id}, {"$set": {"extracted_data": result, "status": "EXTRACTED"}})
    # Store extracted data records (flatten top-level)
    if isinstance(result, dict) and "error" not in result and "parse_error" not in result:
        for field, value in result.items():
            if value is None:
                continue
            await db.extracted_data.insert_one({
                "id": str(uuid.uuid4()),
                "engagement_id": doc["engagement_id"],
                "field": field.replace("_", " ").title(),
                "value": str(value),
                "source": doc["name"],
                "confidence": 0.9,
                "verified_by_cpa": False,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            })
    return result


# ==================== Extracted data ====================

@api.get("/engagements/{eid}/extracted-data")
async def list_extracted(eid: str, user: dict = Depends(get_current_user)):
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")
    await get_engagement_or_404(eid, user)
    db = get_db()
    rows = [r async for r in db.extracted_data.find({"engagement_id": eid}, {"_id": 0}).sort("created_at", 1)]
    return rows


@api.patch("/extracted-data/{rid}")
async def update_extracted(rid: str, body: ExtractedDataUpdateIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.extracted_data.update_one({"id": rid}, {"$set": updates})
    r = await db.extracted_data.find_one({"id": rid}, {"_id": 0})
    return r


# ==================== Opportunities ====================

@api.get("/engagements/{eid}/opportunities")
async def list_opps(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    db = get_db()
    q = {"engagement_id": eid}
    if user["role"] == "WS_PARTNER":
        q["shared_with_ws"] = True
    rows = [r async for r in db.opportunities.find(q, {"_id": 0}).sort("created_at", -1)]
    return rows


@api.get("/opportunities/shared")
async def shared_opps(user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    db = get_db()
    rows = [r async for r in db.opportunities.find({"shared_with_ws": True}, {"_id": 0}).sort("shared_at", -1)]
    # Attach client name + engagement id
    eng_ids = list({r["engagement_id"] for r in rows})
    engs = {e["id"]: e async for e in db.engagements.find({"id": {"$in": eng_ids}}, {"_id": 0})}
    corp_ids = list({e["corporation_id"] for e in engs.values()})
    corps = {c["id"]: c async for c in db.corporations.find({"id": {"$in": corp_ids}}, {"_id": 0})}
    users_map = {}
    for c in corps.values():
        u = await db.users.find_one({"id": c["client_id"]}, {"password_hash": 0, "_id": 0})
        if u:
            users_map[c["client_id"]] = u
    for r in rows:
        e = engs.get(r["engagement_id"]) or {}
        c = corps.get(e.get("corporation_id")) or {}
        u = users_map.get(c.get("client_id")) or {}
        r["engagement"] = {"id": e.get("id"), "tier": e.get("tier")}
        r["corporation_name"] = c.get("name")
        r["client_name"] = u.get("name")
    return rows


@api.post("/engagements/{eid}/opportunities")
async def create_opp(eid: str, body: OpportunityIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    await get_engagement_or_404(eid, user)
    row = {
        "id": str(uuid.uuid4()),
        "engagement_id": eid,
        "category": body.category,
        "title": body.title,
        "description": body.description,
        "severity": body.severity,
        "shared_with_ws": False,
        "shared_at": None,
        "ws_followed_up": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.opportunities.insert_one(row)
    return strip_id(row)


@api.patch("/opportunities/{oid}")
async def update_opp(oid: str, body: UpdateOpportunityIn, user: dict = Depends(get_current_user)):
    db = get_db()
    opp = await db.opportunities.find_one({"id": oid})
    if not opp:
        raise HTTPException(404, "Not found")
    updates = body.dict(exclude_unset=True)
    if "shared_with_ws" in updates and updates["shared_with_ws"] and not opp.get("shared_with_ws"):
        if user["role"] not in ("CPA", "ADMIN"):
            raise HTTPException(403, "Only CPA/Admin can share opportunities")
        updates["shared_at"] = datetime.now(timezone.utc)
        eng = await db.engagements.find_one({"id": opp["engagement_id"]})
        if eng and eng.get("ws_advisor_id"):
            corp = await db.corporations.find_one({"id": eng["corporation_id"]})
            user_row = await db.users.find_one({"id": eng["ws_advisor_id"]}, {"_id": 0, "password_hash": 0})
            if user_row:
                await notify(user_row["id"], "Advisory opportunity", opp["title"], "opportunity_shared", eng["id"])
                ses_service.send_opportunity(user_row["email"], corp["name"] if corp else "client", opp["title"], f"{FRONTEND_URL}/ws/dashboard")
    if "ws_followed_up" in updates and user["role"] not in ("WS_PARTNER", "ADMIN"):
        raise HTTPException(403, "Only WS partner can mark followed up")
    await db.opportunities.update_one({"id": oid}, {"$set": updates})
    return await db.opportunities.find_one({"id": oid}, {"_id": 0})


# ==================== Time entries ====================

@api.get("/engagements/{eid}/time-entries")
async def list_time(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] in ("CLIENT", "WS_PARTNER"):
        raise HTTPException(403, "Not permitted")
    db = get_db()
    rows = [r async for r in db.time_entries.find({"engagement_id": eid}, {"_id": 0}).sort("date", -1)]
    return rows


@api.post("/engagements/{eid}/time-entries")
async def add_time(eid: str, body: TimeEntryIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    await get_engagement_or_404(eid, user)
    row = {
        "id": str(uuid.uuid4()),
        "engagement_id": eid,
        "cpa_id": user["id"],
        "category": body.category,
        "hours": body.hours,
        "description": body.description,
        "date": body.date or datetime.now(timezone.utc),
    }
    await db.time_entries.insert_one(row)
    return strip_id(row)


# ==================== Checklist ====================

@api.get("/engagements/{eid}/checklist")
async def list_checklist(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] in ("CLIENT", "WS_PARTNER"):
        raise HTTPException(403, "Not permitted")
    db = get_db()
    rows = [r async for r in db.checklist.find({"engagement_id": eid}, {"_id": 0}).sort("sort_order", 1)]
    return rows


@api.patch("/checklist/{cid}")
async def toggle_checklist(cid: str, body: ChecklistToggleIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    updates = {
        "is_completed": body.is_completed,
        "completed_at": datetime.now(timezone.utc) if body.is_completed else None,
        "completed_by_id": user["id"] if body.is_completed else None,
    }
    await db.checklist.update_one({"id": cid}, {"$set": updates})
    return await db.checklist.find_one({"id": cid}, {"_id": 0})


# ==================== Notifications ====================

@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    db = get_db()
    rows = [r async for r in db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(30)]
    return rows


# ==================== Partner-managed global checklist template ====================

DEFAULT_CHECKLIST_TEMPLATE = [
    {"label": "Client consented to pilot", "optional": False},
    {"label": "Corporation info confirmed", "optional": False},
    {"label": "Service tier assigned", "optional": False},
    {"label": "Client's accountant notified", "optional": False},
    {"label": "CRA Group ID instructions sent", "optional": False},
    {"label": "Document checklist sent (optional)", "optional": True},
]


class ChecklistTemplateIn(BaseModel):
    items: list[dict]


@api.get("/partner/checklist-template")
async def get_checklist_template(user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    db = get_db()
    doc = await db.settings.find_one({"key": "checklist_template"}, {"_id": 0})
    if not doc:
        return {"items": DEFAULT_CHECKLIST_TEMPLATE}
    return {"items": doc.get("items", DEFAULT_CHECKLIST_TEMPLATE)}


@api.put("/partner/checklist-template")
async def update_checklist_template(body: ChecklistTemplateIn, user: dict = Depends(require_role("WS_PARTNER", "ADMIN"))):
    db = get_db()
    items = [{"label": str(it.get("label", "")).strip(), "optional": bool(it.get("optional", False))} for it in body.items if str(it.get("label", "")).strip()]
    if not items:
        raise HTTPException(400, "Template must have at least one item")
    await db.settings.update_one(
        {"key": "checklist_template"},
        {"$set": {"items": items, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"items": items}


# ==================== Per-tier document templates (admin-managed) ====================

DOC_CATEGORIES = ["Income", "Expenses", "Banking", "Compliance", "Other"]
TIER_KEYS = ["STANDARD", "BOOKS_COMPLETE", "WHITE_GLOVE"]

# Categorize existing config defaults so they have meaningful tags out-of-the-box
DEFAULT_DOC_CATEGORY_MAP = {
    "PRIOR_T2": "Compliance", "PRIOR_FINANCIALS": "Compliance", "PRIOR_NOA": "Compliance",
    "CURRENT_TRIAL_BALANCE": "Compliance", "ARTICLES_OF_INCORP": "Compliance",
    "PAYROLL_RECORDS": "Compliance", "SHAREHOLDER_LOAN": "Compliance",
    "BOOKKEEPING_RECORDS": "Compliance", "PERSONAL_T1": "Compliance",
    "RRSP_ROOM": "Compliance", "HOLDCO_FINANCIALS": "Compliance",
    "TRUST_DOCUMENTS": "Compliance", "SHAREHOLDER_AGREEMENT": "Compliance",
    "CRA_CORRESPONDENCE": "Compliance",
    "BANK_STATEMENTS": "Banking", "BROKERAGE_STATEMENTS": "Banking",
    "REGISTERED_ACCOUNTS": "Banking", "CORPORATE_LOANS": "Banking",
    "TRADE_CONFIRMATIONS": "Income", "ACB_RECORDS": "Income",
    "CREDIT_CARD_STATEMENTS": "Expenses",
    "INSURANCE_POLICIES": "Other", "ESTATE_DOCUMENTS": "Other", "OTHER": "Other",
}


def _seed_doc_template(tier: str):
    """Build a default template by hydrating docs_for_tier() with categories."""
    items = []
    for d in docs_for_tier(tier):
        items.append({
            "category": d["category"],
            "name": d["name"],
            "description": d["description"],
            "is_required": bool(d["is_required"]),
            "tag": DEFAULT_DOC_CATEGORY_MAP.get(d["category"], "Other"),
        })
    return items


class DocTemplateItemIn(BaseModel):
    category: Optional[str] = None  # internal slug (legacy, optional)
    name: str
    description: Optional[str] = ""
    is_required: bool = False
    tag: str = "Other"  # one of DOC_CATEGORIES


class DocTemplateIn(BaseModel):
    items: list[DocTemplateItemIn]


@api.get("/admin/document-templates/{tier}")
async def get_doc_template(tier: str, user: dict = Depends(require_role("ADMIN"))):
    if tier not in TIER_KEYS:
        raise HTTPException(400, f"tier must be one of {TIER_KEYS}")
    db = get_db()
    doc = await db.settings.find_one({"key": f"doc_template_{tier}"}, {"_id": 0})
    if not doc:
        return {"tier": tier, "items": _seed_doc_template(tier), "categories": DOC_CATEGORIES}
    return {"tier": tier, "items": doc.get("items", []), "categories": DOC_CATEGORIES}


@api.put("/admin/document-templates/{tier}")
async def update_doc_template(tier: str, body: DocTemplateIn, user: dict = Depends(require_role("ADMIN"))):
    if tier not in TIER_KEYS:
        raise HTTPException(400, f"tier must be one of {TIER_KEYS}")
    items = []
    for i, it in enumerate(body.items):
        name = (it.name or "").strip()
        if not name:
            continue
        tag = it.tag if it.tag in DOC_CATEGORIES else "Other"
        items.append({
            "category": it.category or f"CUSTOM_{i}",
            "name": name,
            "description": (it.description or "").strip(),
            "is_required": bool(it.is_required),
            "tag": tag,
        })
    if not items:
        raise HTTPException(400, "Template must have at least one item")
    db = get_db()
    await db.settings.update_one(
        {"key": f"doc_template_{tier}"},
        {"$set": {"items": items, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return {"tier": tier, "items": items, "categories": DOC_CATEGORIES}


async def _docs_for_tier_with_template(tier: str):
    """Return the document list for a new engagement: admin-managed template if set, else config defaults."""
    db = get_db()
    doc = await db.settings.find_one({"key": f"doc_template_{tier}"}, {"_id": 0})
    if doc and doc.get("items"):
        out = []
        for i, it in enumerate(doc["items"]):
            out.append({
                "category": it.get("category") or f"CUSTOM_{i}",
                "name": it["name"],
                "description": it.get("description", ""),
                "is_required": bool(it.get("is_required", False)),
                "sort_order": i,
                "tag": it.get("tag", "Other"),
            })
        return out
    # fallback to legacy config (annotated with default tag)
    out = []
    for i, d in enumerate(docs_for_tier(tier)):
        out.append({**d, "tag": DEFAULT_DOC_CATEGORY_MAP.get(d["category"], "Other")})
    return out


# ==================== CPA Questions (preparation stage) ====================

class CpaQuestionIn(BaseModel):
    question: str
    helper_text: Optional[str] = None


class AnswerIn(BaseModel):
    answer: str


@api.get("/engagements/{eid}/cpa-questions")
async def list_cpa_questions(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    rows = [r async for r in db.cpa_questions.find({"engagement_id": eid}, {"_id": 0}).sort("created_at", 1)]
    return rows


@api.post("/engagements/{eid}/cpa-questions")
async def create_cpa_question(eid: str, body: CpaQuestionIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    await get_engagement_or_404(eid, user)
    qid = str(uuid.uuid4())
    doc = {
        "id": qid,
        "engagement_id": eid,
        "question": body.question.strip(),
        "helper_text": (body.helper_text or "").strip() or None,
        "answer": None,
        "status": "pending",
        "created_by": user["id"],
        "created_at": datetime.now(timezone.utc),
        "answered_at": None,
    }
    await db.cpa_questions.insert_one(doc)
    # notify client
    eng = await db.engagements.find_one({"id": eid})
    if eng:
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if corp:
            await notify(corp["client_id"], "New question from your CPA", body.question[:80], "cpa_question", eid)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.patch("/engagements/{eid}/cpa-questions/{qid}")
async def answer_cpa_question(eid: str, qid: str, body: AnswerIn, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    if user["role"] not in ("CLIENT", "ADMIN"):
        raise HTTPException(403, "Only the client can answer")
    res = await db.cpa_questions.update_one(
        {"id": qid, "engagement_id": eid},
        {"$set": {"answer": body.answer.strip(), "status": "answered", "answered_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Question not found")
    q = await db.cpa_questions.find_one({"id": qid}, {"_id": 0})
    eng = await db.engagements.find_one({"id": eid})
    if eng and eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Client answered a question", body.answer[:80], "client_answer", eid)
    return q


# ==================== Tax summary + authorization (review/filed stages) ====================

class TaxSummaryIn(BaseModel):
    net_income: Optional[float] = None
    total_tax: Optional[float] = None
    instalments_paid: Optional[float] = None
    balance_owing: Optional[float] = None
    payment_due_date: Optional[str] = None  # ISO date
    t2_draft_doc_id: Optional[str] = None


@api.put("/engagements/{eid}/tax-summary")
async def set_tax_summary(eid: str, body: TaxSummaryIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    summary = eng.get("tax_summary") or {}
    for k in ("net_income", "total_tax", "instalments_paid", "balance_owing", "payment_due_date"):
        v = getattr(body, k)
        if v is not None:
            summary[k] = v
    updates = {"tax_summary": summary, "updated_at": datetime.now(timezone.utc)}
    if body.t2_draft_doc_id is not None:
        updates["t2_draft_doc_id"] = body.t2_draft_doc_id
    await db.engagements.update_one({"id": eid}, {"$set": updates})
    return {"tax_summary": summary, "t2_draft_doc_id": updates.get("t2_draft_doc_id", eng.get("t2_draft_doc_id"))}


class AuthorizeFilingIn(BaseModel):
    confirmations: dict  # keys → bool


@api.post("/engagements/{eid}/authorize-filing")
async def authorize_filing(eid: str, body: AuthorizeFilingIn, user: dict = Depends(get_current_user)):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] != "CLIENT":
        raise HTTPException(403, "Only the client can authorize")
    confs = {k: bool(v) for k, v in (body.confirmations or {}).items()}
    if not all(confs.values()):
        raise HTTPException(400, "All confirmations are required")
    await db.engagements.update_one({"id": eid}, {"$set": {
        "authorization_confirmations": confs,
        "authorized_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }})
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Client authorized filing", "Ready to submit to CRA", "authorized", eid)
    return {"ok": True}


@api.get("/notifications/unread-count")
async def unread_count(user: dict = Depends(get_current_user)):
    db = get_db()
    n = await db.notifications.count_documents({"user_id": user["id"], "is_read": False})
    return {"count": n}


@api.post("/notifications/{nid}/read")
async def read_one(nid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one({"id": nid, "user_id": user["id"]}, {"$set": {"is_read": True}})
    return {"ok": True}


@api.post("/notifications/read-all")
async def read_all(user: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_many({"user_id": user["id"], "is_read": False}, {"$set": {"is_read": True}})
    return {"ok": True}


# ==================== Metrics ====================

@api.get("/metrics/pilot")
async def pilot_metrics(user: dict = Depends(require_role("ADMIN", "WS_PARTNER"))):
    db = get_db()
    total = await db.engagements.count_documents({})
    filed = await db.engagements.count_documents({"status": "FILED"})
    intake_complete = await db.engagements.count_documents({"status": {"$in": ["INTAKE", "IN_PREP", "IN_REVIEW", "DELIVERY", "FILED"]}})
    pipeline = {s: await db.engagements.count_documents({"status": s}) for s in ["REFERRED", "INTAKE", "IN_PREP", "IN_REVIEW", "DELIVERY", "FILED"]}
    filed_cursor = db.engagements.find({"status": "FILED", "turnaround_days": {"$ne": None}}, {"_id": 0})
    tds = [e["turnaround_days"] async for e in filed_cursor]
    avg_td = round(sum(tds) / len(tds), 1) if tds else 0
    opps = await db.opportunities.count_documents({})
    return {
        "total_clients": total,
        "filed": filed,
        "intake_complete": intake_complete,
        "pipeline": pipeline,
        "avg_turnaround_days": avg_td,
        "opportunities_count": opps,
    }


@api.get("/metrics/economics")
async def economics(user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    engs = [e async for e in db.engagements.find({"status": "FILED"}, {"_id": 0})]
    tiers = {}
    for tier, price in TIER_PRICING.items():
        tier_engs = [e for e in engs if e["tier"] == tier]
        if not tier_engs:
            tiers[tier] = {"price": price, "count": 0, "avg_hours": 0, "avg_cost": 0, "margin": 0, "margin_pct": 0}
            continue
        total_hours = 0
        for e in tier_engs:
            hours_agg = await db.time_entries.aggregate([
                {"$match": {"engagement_id": e["id"]}},
                {"$group": {"_id": None, "total": {"$sum": "$hours"}}},
            ]).to_list(1)
            total_hours += (hours_agg[0]["total"] if hours_agg else 0)
        avg_hours = round(total_hours / len(tier_engs), 2)
        avg_cost = round(avg_hours * CPA_HOURLY_COST, 2)
        margin = round(price - avg_cost, 2)
        margin_pct = round((margin / price) * 100, 1) if price > 0 else 0
        tiers[tier] = {"price": price, "count": len(tier_engs), "avg_hours": avg_hours, "avg_cost": avg_cost, "margin": margin, "margin_pct": margin_pct}
    return tiers


@api.get("/metrics/utilization")
async def utilization(user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    cpas = [u async for u in db.users.find({"role": "CPA"}, {"password_hash": 0, "_id": 0})]
    out = []
    for c in cpas:
        files = await db.engagements.count_documents({"assigned_cpa_id": c["id"]})
        hours_agg = await db.time_entries.aggregate([
            {"$match": {"cpa_id": c["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$hours"}}},
        ]).to_list(1)
        total_hours = hours_agg[0]["total"] if hours_agg else 0
        out.append({"user": c, "files": files, "hours": round(total_hours, 2)})
    return out


@api.get("/metrics/export")
async def export_csv(user: dict = Depends(require_role("ADMIN"))):
    """Pilot debrief CSV export — one row per engagement, all relevant columns."""
    import csv
    from io import StringIO
    from fastapi.responses import StreamingResponse

    db = get_db()

    def fmt_dt(v):
        if not v:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%Y-%m-%d")
        return str(v)[:10]

    def fmt_dt_full(v):
        if not v:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%Y-%m-%dT%H:%M")
        return str(v)[:16]

    engs = [e async for e in db.engagements.find({}, {"_id": 0}).sort("referral_date", 1)]
    corp_ids = list({e["corporation_id"] for e in engs})
    user_ids = list({uid for e in engs for uid in [e.get("assigned_cpa_id"), e.get("ws_advisor_id")] if uid})
    corps = {c["id"]: c async for c in db.corporations.find({"id": {"$in": corp_ids}}, {"_id": 0})}
    user_ids += [c.get("client_id") for c in corps.values() if c.get("client_id")]
    users = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}):
        users[u["id"]] = u

    columns = [
        "client_name", "corporation", "tier", "original_tier", "tier_changed",
        "current_status", "assigned_cpa", "ws_advisor",
        "referral_date", "filing_date", "turnaround_days",
        "total_cpa_hours", "hours_by_category",
        "documents_requested", "documents_received", "documents_deferred",
        "reminders_sent", "opportunities_identified", "opportunities_shared_with_ws",
        "status_transitions",
    ]

    buf = StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(columns)

    for e in engs:
        corp = corps.get(e["corporation_id"]) or {}
        client = users.get(corp.get("client_id")) or {}
        cpa = users.get(e.get("assigned_cpa_id")) or {}
        ws = users.get(e.get("ws_advisor_id")) or {}

        # Hours
        hours_pipeline = [
            {"$match": {"engagement_id": e["id"]}},
            {"$group": {"_id": "$category", "total": {"$sum": "$hours"}}},
        ]
        hours_rows = await db.time_entries.aggregate(hours_pipeline).to_list(50)
        total_hours = round(sum(r["total"] for r in hours_rows), 2)
        by_cat = " | ".join(f"{r['_id']}:{round(r['total'], 2)}h" for r in sorted(hours_rows, key=lambda x: x["_id"]))

        # Docs
        docs_total = await db.documents.count_documents({"engagement_id": e["id"]})
        docs_received = await db.documents.count_documents(
            {"engagement_id": e["id"], "status": {"$in": ["UPLOADED", "REVIEWED", "EXTRACTED"]}}
        )
        docs_deferred = await db.documents.count_documents(
            {"engagement_id": e["id"], "deferred_at": {"$ne": None}}
        )

        # Opps
        opps_total = await db.opportunities.count_documents({"engagement_id": e["id"]})
        opps_shared = await db.opportunities.count_documents(
            {"engagement_id": e["id"], "shared_with_ws": True}
        )

        # Status history (oldest first for the export)
        history = [
            h async for h in db.status_history.find(
                {"engagement_id": e["id"]}, {"_id": 0}
            ).sort("created_at", 1)
        ]
        transitions = " | ".join(
            f"{(h.get('from_status') or 'NEW')}->{h['to_status']}@{fmt_dt_full(h.get('created_at'))}"
            for h in history
        )

        writer.writerow([
            client.get("name", ""),
            corp.get("name", ""),
            e.get("tier", "") or "",
            e.get("original_tier", "") or "",
            "yes" if (e.get("original_tier") and e.get("tier") != e.get("original_tier")) else "no",
            e.get("status", ""),
            cpa.get("name", ""),
            ws.get("name", ""),
            fmt_dt(e.get("referral_date")),
            fmt_dt(e.get("filing_date")),
            e.get("turnaround_days") if e.get("turnaround_days") is not None else "",
            total_hours,
            by_cat,
            docs_total,
            docs_received,
            docs_deferred,
            e.get("deferred_reminder_count", 0),
            opps_total,
            opps_shared,
            transitions,
        ])

    output = buf.getvalue()
    buf.close()
    filename = f"cloudtax-pilot-debrief-{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ==================== Health ====================

@api.get("/health")
async def health():
    return {"ok": True, "service": "cloudtax-pilot"}


# ==================== Messaging ====================
import asyncio
import json as _json

# Per-engagement subscribers for SSE
_subs: dict[str, list[asyncio.Queue]] = {}


def _sub(eid: str) -> asyncio.Queue:
    q = asyncio.Queue()
    _subs.setdefault(eid, []).append(q)
    return q


def _unsub(eid: str, q: asyncio.Queue):
    if eid in _subs and q in _subs[eid]:
        _subs[eid].remove(q)


async def _publish(eid: str, event: str, payload: dict):
    if eid not in _subs:
        return
    msg = {"event": event, "data": payload}
    for q in list(_subs[eid]):
        try:
            q.put_nowait(msg)
        except Exception:
            pass


class MessageIn(BaseModel):
    content: str
    attachment_url: Optional[str] = None
    attachment_name: Optional[str] = None


class AttachUrlIn(BaseModel):
    file_name: str
    content_type: str


@api.post("/engagements/{eid}/messages/attach-url")
async def message_attach_url(eid: str, body: AttachUrlIn, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")
    safe = "".join(c for c in body.file_name if c.isalnum() or c in "._-")[:80] or "file"
    object_key = f"engagements/{eid}/messages/{uuid.uuid4().hex}_{safe}"
    res = s3_service.generate_upload_url(object_key, body.content_type)
    if not res:
        raise HTTPException(500, "Could not generate upload URL")
    return res


@api.get("/messages/{mid}/attachment-url")
async def message_attach_download(mid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    msg = await db.messages.find_one({"id": mid})
    if not msg or not msg.get("attachment_url"):
        raise HTTPException(404, "Attachment not found")
    await get_engagement_or_404(msg["engagement_id"], user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")
    url = s3_service.generate_download_url(msg["attachment_url"], msg.get("attachment_name"))
    if not url:
        raise HTTPException(500, "Could not generate download URL")
    return {"download_url": url}


def _serialize_msg(m: dict, sender: dict | None) -> dict:
    out = {k: v for k, v in m.items() if k != "_id"}
    if isinstance(out.get("created_at"), datetime):
        out["created_at"] = out["created_at"].isoformat()
    out["sender"] = {"id": sender["id"], "name": sender["name"], "role": sender["role"]} if sender else None
    return out


@api.get("/engagements/{eid}/messages")
async def list_messages(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")
    rows = [r async for r in db.messages.find({"engagement_id": eid}, {"_id": 0}).sort("created_at", 1)]
    sender_ids = list({r["sender_id"] for r in rows})
    senders = {}
    async for u in db.users.find({"id": {"$in": sender_ids}}, {"_id": 0, "password_hash": 0}):
        senders[u["id"]] = u
    return [_serialize_msg(r, senders.get(r["sender_id"])) for r in rows]


@api.get("/engagements/{eid}/messages/unread-count")
async def messages_unread_count(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    n = await db.messages.count_documents({
        "engagement_id": eid,
        "is_read": False,
        "sender_id": {"$ne": user["id"]},
    })
    return {"count": n}


@api.post("/engagements/{eid}/messages")
async def send_message(eid: str, body: MessageIn, user: dict = Depends(get_current_user)):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] not in ("CLIENT", "CPA", "ADMIN"):
        raise HTTPException(403, "Not permitted")
    if not body.content.strip() and not body.attachment_url:
        raise HTTPException(400, "Empty message")
    row = {
        "id": str(uuid.uuid4()),
        "engagement_id": eid,
        "sender_id": user["id"],
        "content": body.content.strip(),
        "attachment_url": body.attachment_url,
        "attachment_name": body.attachment_name,
        "is_read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.messages.insert_one(row)
    sender = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    serialized = _serialize_msg(row, sender)
    # Notify the other party via in-app
    if user["role"] == "CLIENT" and eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "New client message", body.content[:80], "cpa_message", eid)
    elif user["role"] in ("CPA", "ADMIN"):
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if corp:
            await notify(corp["client_id"], "New message from your CPA", body.content[:80], "client_message", eid)
    # Publish over SSE
    await _publish(eid, "message", serialized)
    return serialized


class MarkReadIn(BaseModel):
    engagement_id: str


@api.patch("/messages/read")
async def mark_read(body: MarkReadIn, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(body.engagement_id, user)
    res = await db.messages.update_many(
        {"engagement_id": body.engagement_id, "sender_id": {"$ne": user["id"]}, "is_read": False},
        {"$set": {"is_read": True}},
    )
    await _publish(body.engagement_id, "read", {"by_user_id": user["id"]})
    return {"updated": res.modified_count}


@api.get("/engagements/{eid}/messages/stream")
async def stream_messages(eid: str, request: Request, token: Optional[str] = None):
    """Server-Sent Events for real-time message delivery.

    Auth via ?token= query param (EventSource cannot send custom headers).
    """
    import jwt as pyjwt
    db = get_db()
    if not token:
        raise HTTPException(401, "Missing token")
    try:
        payload = pyjwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
    except pyjwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0, "_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    await get_engagement_or_404(eid, user)
    if user["role"] == "WS_PARTNER":
        raise HTTPException(403, "Not permitted")

    from fastapi.responses import StreamingResponse

    async def gen():
        q = _sub(eid)
        try:
            # Initial heartbeat
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield f"event: {msg['event']}\ndata: {_json.dumps(msg['data'])}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            _unsub(eid, q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


# ==================== Profile / settings ====================


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


@api.post("/auth/change-password")
async def change_password(body: ChangePasswordIn, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}


app.include_router(api)
