"""FastAPI application entry point - CloudTax WS Pilot Dashboard."""
from dotenv import load_dotenv
load_dotenv()

import os
import io
import re
import uuid
import secrets
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Any, List

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
import email_service
import trusted_devices
import delegates
from email_templates import send_email as _email_templates_send
import ai_service
from config import (
    docs_for_tier, review_checklist_for_tier, TIER_PRICING,
    CPA_HOURLY_COST, STATUS_LABELS, TIER_LABELS,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cloudtax")

app = FastAPI(title="CloudTax WS Pilot API", version="1.0.0")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# PROD_GUARD: detects deploy environments that are NOT production dev/preview.
# When this flag is on, ``FRONTEND_URL`` must be a clean production URL —
# any value containing vendor-specific substrings (preview / emergent /
# localhost) is treated as a misconfiguration and the service refuses to
# start, so invitation emails and password-reset links can never silently
# ship with preview URLs. Set ``PRODUCTION=true`` in the prod deploy env.
IS_PRODUCTION = os.environ.get("PRODUCTION", "").lower() in ("1", "true", "yes")

# Substrings that are NEVER allowed in a production FRONTEND_URL — these
# would result in invite / reset links pointing at a vendor/preview host.
_VENDOR_HOST_MARKERS = ("emergent", "preview.", "localhost", "127.0.0.1", "0.0.0.0", ".onrender.com", ".vercel.app")


def _frontend_url_has_vendor_leak(url: str) -> str | None:
    """Return the offending marker if ``url`` looks like a vendor / preview
    host rather than a customer-owned production URL. Used by the startup
    guard + the admin health endpoint."""
    lower = (url or "").lower()
    for marker in _VENDOR_HOST_MARKERS:
        if marker in lower:
            return marker
    return None


if IS_PRODUCTION:
    _leak = _frontend_url_has_vendor_leak(FRONTEND_URL)
    if _leak:
        # Log loudly but DO NOT prevent boot — a broken FRONTEND_URL must not
        # take the entire backend offline. The /api/admin/config-health
        # endpoint and the Settings → System UI surface this misconfiguration
        # for admins to fix without losing all login ability in the meantime.
        logging.getLogger("cloudtax").error(
            "PROD_GUARD: PRODUCTION=true but FRONTEND_URL=%r contains %r — "
            "invitation/reset emails will ship with the wrong link until "
            "FRONTEND_URL is fixed in the deploy env.",
            FRONTEND_URL, _leak,
        )
    else:
        logging.getLogger("cloudtax").info("PROD_GUARD: FRONTEND_URL=%s (validated)", FRONTEND_URL)

# When true, auth endpoints that handle email delivery will surface the
# ACTUAL reset/OTP tokens in their response body as a preview-only
# convenience so that dev/QA environments without working SMTP can still
# complete the flow. This MUST be false in production — otherwise anyone
# who knows a user's email can request a reset and read the token off the
# response payload, defeating email verification entirely. Controlled by
# the ``SHOW_DEV_FALLBACK_TOKENS`` env var (defaults to false). Set to
# ``true`` only on dev/preview stacks.
SHOW_DEV_FALLBACK_TOKENS = os.environ.get("SHOW_DEV_FALLBACK_TOKENS", "").lower() in ("1", "true", "yes")
if IS_PRODUCTION and SHOW_DEV_FALLBACK_TOKENS:
    logging.getLogger("cloudtax").error(
        "PROD_GUARD: SHOW_DEV_FALLBACK_TOKENS is enabled in production — "
        "auth endpoints will leak reset/OTP tokens. Disable immediately."
    )

# Comma-separated list of additional CORS origins to allow. Set at deploy
# time so production (custom domain) and the Emergent auto-generated
# `<job>.emergent.host` backend can co-exist: the browser loads the page
# from the custom domain but the frontend bundle calls emergent.host,
# meaning the ``Origin: https://ws.cloudtax.ca`` header must be accepted.
# Defaults below cover the known prod custom domain so login works even if
# the deploy operator forgot to set ALLOWED_ORIGINS.
_DEFAULT_ALLOWED = ["https://ws.cloudtax.ca"]
_raw_extra = os.environ.get("ALLOWED_ORIGINS", "")
_extra_origins = [o.strip() for o in _raw_extra.split(",") if o.strip()]
_cors_origins = list(dict.fromkeys([FRONTEND_URL, "http://localhost:3000", *_DEFAULT_ALLOWED, *_extra_origins]))
logging.getLogger("cloudtax").info("CORS allow_origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
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


class ForgotPasswordIn(BaseModel):
    email: EmailStr


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
    """Lightweight create-or-update used by the Partner during onboarding."""
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
    filing_date: Optional[datetime] = None
    review_instructions: Optional[str] = None


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


async def notify_admins(title: str, message: str, type_: str, engagement_id: str | None = None):
    """Fan-out a notification to every active ADMIN user."""
    db = get_db()
    admins = [u async for u in db.users.find({"role": "ADMIN", "is_active": {"$ne": False}}, {"id": 1, "_id": 0})]
    for a in admins:
        await notify(a["id"], title, message, type_, engagement_id)


async def alert_s3_access_denied_if_needed() -> None:
    """If the most recent S3 mutation failed with ``AccessDenied``, raise an
    in-app admin alert — but rate-limit to once per 24h so a sustained outage
    doesn't flood the bell. The notification deep-links into Admin Settings
    where the IAM JSON snippet lives.
    """
    code, msg = s3_service.last_error_info()
    if code != "AccessDenied":
        return
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent = await db.notifications.find_one({"type": "s3_access_denied", "created_at": {"$gt": cutoff}})
    if recent:
        return
    await notify_admins(
        "S3 upload blocked — IAM permission missing",
        "An upload was saved to local disk because AWS denied s3:PutObject. "
        "Apply the IAM policy at docs/aws-iam-policy.json to restore S3 storage. "
        f"Bucket: {os.environ.get('S3_BUCKET_NAME', '')}.",
        "s3_access_denied",
    )
    log.warning("Surfaced s3_access_denied admin alert (last_error=%s)", msg)


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
    if role == "PARTNER":
        # Ownr partners are view-only. CloudTax (ADMIN) does all onboarding,
        # CPA assignment, stage moves, and settings. The permission KEYS stay
        # intact so ADMIN keeps them; partners just get read access.
        on = {"view_clients", "view_docs"}
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
    if role == "PARTNER" and eng.get("partner_advisor_id") != user["id"]:
        # Partners can see all pilot engagements per spec; relax filter
        pass
    if role == "CLIENT":
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        is_primary = bool(corp and corp.get("client_id") == user["id"])
        if is_primary:
            return strip_id(eng)
        # Delegate access — same engagement, scoped permissions checked at
        # individual route level (T183 sign etc.).
        if await delegates.is_active_delegate(user["id"], engagement_id):
            return strip_id(eng)
        raise HTTPException(403, "Not your engagement")
    return strip_id(eng)


def redact_for_ws(eng: dict) -> dict:
    # Partners never see CPA's internal notes or extracted financial data.
    # They CAN see their own onboarding notes (partner_notes).
    eng = dict(eng)
    eng.pop("notes", None)
    # ``notes_history`` is the internal staff notes feed (CPA/Admin). Strip it
    # from the engagement object — it was leaking the whole feed to partners.
    eng.pop("notes_history", None)
    return eng


def redact_for_client(eng: dict) -> dict:
    eng = dict(eng)
    # Clients never see pricing / tier labels / internal notes
    eng["tier"] = None
    eng["original_tier"] = None
    eng.pop("notes", None)
    eng.pop("partner_notes", None)
    # ``notes_history`` is the staff notes feed ("Not visible to clients"). The
    # old redact only stripped the legacy ``notes`` field, so the newer
    # notes_history array leaked the entire staff feed to the client.
    eng.pop("notes_history", None)
    return eng


# ==================== Auth ====================

OTP_TTL_MIN = 5
OTP_RESEND_COOLDOWN_SEC = 30
OTP_PURPOSE_LOGIN = "login"
OTP_PURPOSE_ENABLE_2FA = "enable_2fa"


def _make_otp_code() -> str:
    """6-digit numeric code suitable for an email-delivered OTP."""
    import secrets as _secrets
    return f"{_secrets.randbelow(1_000_000):06d}"


async def _issue_otp(user_id: str, purpose: str, *, enforce_cooldown: bool = True) -> tuple[str, str]:
    """Insert a fresh OTP challenge and return (challenge_id, plain_code).
    Caller is responsible for emailing the code; we never store it in plaintext.

    When ``enforce_cooldown`` is True (default), a 429 is raised if the most
    recent challenge for this user+purpose (used or not) is younger than
    ``OTP_RESEND_COOLDOWN_SEC`` seconds. This protects users from being spammed
    when they double-tap "send code".
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    if enforce_cooldown:
        recent = await db.otp_challenges.find_one(
            {"user_id": user_id, "purpose": purpose},
            sort=[("created_at", -1)],
        )
        if recent:
            created_at = recent.get("created_at")
            if created_at and created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            if created_at and (now - created_at).total_seconds() < OTP_RESEND_COOLDOWN_SEC:
                wait = int(OTP_RESEND_COOLDOWN_SEC - (now - created_at).total_seconds())
                raise HTTPException(429, f"Please wait {max(wait, 1)}s before requesting another code")
    code = _make_otp_code()
    challenge_id = str(uuid.uuid4())
    code_hash = hash_password(code)
    await db.otp_challenges.insert_one({
        "id": challenge_id,
        "user_id": user_id,
        "purpose": purpose,
        "code_hash": code_hash,
        "used": False,
        "attempts": 0,
        "created_at": now,
        "expires_at": now + timedelta(minutes=OTP_TTL_MIN),
    })
    return challenge_id, code


async def _consume_otp(challenge_id: str, code: str, purpose: str) -> dict | None:
    """Validate and burn an OTP challenge. Returns the user dict on success."""
    db = get_db()
    row = await db.otp_challenges.find_one({"id": challenge_id, "purpose": purpose, "used": False})
    if not row:
        raise HTTPException(400, "Invalid or expired verification code")
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Verification code expired. Request a new one.")
    if row.get("attempts", 0) >= 5:
        await db.otp_challenges.update_one({"id": challenge_id}, {"$set": {"used": True}})
        raise HTTPException(429, "Too many incorrect attempts. Request a new code.")
    if not verify_password(code.strip(), row["code_hash"]):
        await db.otp_challenges.update_one({"id": challenge_id}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Incorrect verification code")
    await db.otp_challenges.update_one({"id": challenge_id}, {"$set": {"used": True}})
    user = await db.users.find_one({"id": row["user_id"]})
    return user


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

    # 2FA gate: when enabled, return a challenge instead of an access token —
    # UNLESS this browser has a valid "trusted device" cookie for the same user.
    if user.get("two_factor_enabled"):
        trusted = await trusted_devices.check_trust_cookie(request, user["id"])
        if trusted:
            log.info("2FA skipped via trusted device: %s", user["email"])
            token = create_access_token(user["id"], user["email"], user["role"])
            set_auth_cookie(response, token)
            return {"user": safe_user(user), "token": token, "trusted_device": True}

        # Cooldown is bypassed here because login is the entry-point — if the
        # user is in a fresh login flow they shouldn't hit a stale 429. The
        # explicit "Resend code" action *does* use the cooldown.
        challenge_id, code = await _issue_otp(user["id"], OTP_PURPOSE_LOGIN, enforce_cooldown=False)
        sent_via_email = False
        try:
            r = email_service.send_otp_code(user["email"], user.get("name") or "there", code, "sign in")
            sent_via_email = bool(r.get("success"))
        except Exception as e:
            log.warning("send_otp_code (login) failed: %s", e)
        log.info("2FA login challenge issued: %s code=%s sent=%s", user["email"], code, sent_via_email)
        resp = {
            "two_factor_required": True,
            "challenge_id": challenge_id,
            "sent_via_email": sent_via_email,
            "email": user["email"],
            "expires_in_sec": OTP_TTL_MIN * 60,
            "resend_after_sec": OTP_RESEND_COOLDOWN_SEC,
        }
        # Dev/preview only: when the env flag is on AND the email didn't
        # actually go out, surface the code so QA on non-SMTP stacks can
        # still sign in. Never enabled in prod.
        if SHOW_DEV_FALLBACK_TOKENS and not sent_via_email:
            resp["debug_otp"] = code
        return resp

    token = create_access_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    return {"user": safe_user(user), "token": token}


@api.post("/auth/2fa/verify-login")
async def verify_login_otp(body: dict, request: Request, response: Response):
    """Complete login by exchanging a valid OTP for a real access token.

    If the caller sets ``trust_device=true`` we also issue a 30-day device token
    so future logins from this browser can skip the 2FA challenge.
    """
    challenge_id = (body or {}).get("challenge_id")
    code = (body or {}).get("code")
    trust_device = bool((body or {}).get("trust_device"))
    if not challenge_id or not code:
        raise HTTPException(400, "Missing challenge_id or code")
    user = await _consume_otp(challenge_id, code, OTP_PURPOSE_LOGIN)
    if not user:
        raise HTTPException(400, "Invalid challenge")
    token = create_access_token(user["id"], user["email"], user["role"])
    set_auth_cookie(response, token)
    trusted_issued = False
    if trust_device:
        ua = request.headers.get("user-agent") or ""
        ip = request.client.host if request.client else ""
        raw = await trusted_devices.issue_trust_token(user["id"], user_agent=ua, ip=ip)
        trusted_devices.set_trust_cookie(response, raw)
        trusted_issued = True
    return {"user": safe_user(user), "token": token, "trusted_device_issued": trusted_issued}


@api.post("/auth/2fa/enable-init")
async def enable_2fa_init(user: dict = Depends(get_current_user)):
    """Send an OTP to the user's email to confirm enabling 2FA."""
    if user.get("two_factor_enabled"):
        return {"ok": True, "already_enabled": True}
    challenge_id, code = await _issue_otp(user["id"], OTP_PURPOSE_ENABLE_2FA, enforce_cooldown=False)
    sent_via_email = False
    try:
        r = email_service.send_otp_code(user["email"], user.get("name") or "there", code, "enable two-factor authentication")
        sent_via_email = bool(r.get("success"))
    except Exception as e:
        log.warning("send_otp_code (enable_2fa) failed: %s", e)
    log.info("2FA enable challenge issued: %s code=%s sent=%s", user["email"], code, sent_via_email)
    resp = {
        "ok": True,
        "challenge_id": challenge_id,
        "sent_via_email": sent_via_email,
        "expires_in_sec": OTP_TTL_MIN * 60,
        "resend_after_sec": OTP_RESEND_COOLDOWN_SEC,
    }
    if SHOW_DEV_FALLBACK_TOKENS and not sent_via_email:
        resp["debug_otp"] = code
    return resp


@api.post("/auth/2fa/resend")
async def resend_otp(body: dict):
    """Re-issue an OTP for an in-flight challenge. Subject to a 30-second
    cooldown to prevent spam. Used by both the login OTP step and the 2FA
    enrolment flow.
    """
    challenge_id = (body or {}).get("challenge_id")
    if not challenge_id:
        raise HTTPException(400, "Missing challenge_id")
    db = get_db()
    row = await db.otp_challenges.find_one({"id": challenge_id})
    if not row:
        raise HTTPException(400, "Invalid challenge")
    purpose = row.get("purpose")
    if purpose not in (OTP_PURPOSE_LOGIN, OTP_PURPOSE_ENABLE_2FA):
        raise HTTPException(400, "Unsupported challenge")
    user = await db.users.find_one({"id": row["user_id"]})
    if not user:
        raise HTTPException(400, "Invalid challenge")
    # Burn the previous (still-valid) challenge so we never have two live codes.
    await db.otp_challenges.update_one({"id": challenge_id}, {"$set": {"used": True}})
    new_challenge_id, code = await _issue_otp(user["id"], purpose, enforce_cooldown=True)
    sent_via_email = False
    try:
        purpose_label = "sign in" if purpose == OTP_PURPOSE_LOGIN else "enable two-factor authentication"
        r = email_service.send_otp_code(user["email"], user.get("name") or "there", code, purpose_label)
        sent_via_email = bool(r.get("success"))
    except Exception as e:
        log.warning("send_otp_code (resend) failed: %s", e)
    log.info("OTP resent: %s purpose=%s code=%s sent=%s", user["email"], purpose, code, sent_via_email)
    return {
        "ok": True,
        "challenge_id": new_challenge_id,
        "sent_via_email": sent_via_email,
        "debug_otp": None if sent_via_email else code,
        "email": user["email"],
        "expires_in_sec": OTP_TTL_MIN * 60,
        "resend_after_sec": OTP_RESEND_COOLDOWN_SEC,
    }


@api.post("/auth/2fa/enable-confirm")
async def enable_2fa_confirm(body: dict, user: dict = Depends(get_current_user)):
    """Validate the OTP and enable 2FA on the current user."""
    challenge_id = (body or {}).get("challenge_id")
    code = (body or {}).get("code")
    if not challenge_id or not code:
        raise HTTPException(400, "Missing challenge_id or code")
    target = await _consume_otp(challenge_id, code, OTP_PURPOSE_ENABLE_2FA)
    if not target or target["id"] != user["id"]:
        raise HTTPException(400, "Verification did not match this account")
    db = get_db()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"two_factor_enabled": True, "two_factor_method": "email", "two_factor_enabled_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "two_factor_enabled": True}


@api.post("/auth/2fa/disable")
async def disable_2fa(body: dict, user: dict = Depends(get_current_user)):
    """Disable 2FA. Requires the current password to prevent session-hijack disables."""
    pwd = (body or {}).get("password") or ""
    db = get_db()
    me = await db.users.find_one({"id": user["id"]})
    if not me or not verify_password(pwd, me["password_hash"]):
        raise HTTPException(401, "Current password is incorrect")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"two_factor_enabled": False, "two_factor_method": None, "two_factor_disabled_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "two_factor_enabled": False}


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
    await db.users.update_one(
        {"id": row["user_id"]},
        {"$set": {
            "password_hash": hash_password(body.password),
            "activated_at": datetime.now(timezone.utc),
        }},
    )
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    # If this user was invited as a delegate, flip every pending row for their
    # email to ACTIVE so they can immediately access the engagement(s).
    user = await db.users.find_one({"id": row["user_id"]}, {"_id": 0, "email": 1})
    if user and user.get("email"):
        try:
            await delegates.activate_for_user(user["email"], row["user_id"])
        except Exception as e:
            log.warning("delegates.activate_for_user failed: %s", e)
    return {"ok": True}


@api.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordIn):
    """Issue a 30-min password-reset token. Always returns ok=True to avoid
    leaking which emails are registered. The reset link is delivered via
    email ONLY — it is NEVER returned in the response body. Exposing the
    token here would defeat email-based verification; anyone who knows a
    user's email could request a reset and read the token off the payload.
    """
    db = get_db()
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("is_active", True):
        # Generic OK so we don't disclose account existence.
        return {"ok": True, "sent_via_email": False}

    token = new_invite_token()
    await db.password_reset_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "token": token,
        "user_id": user["id"],
        "used": False,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=30),
        "created_at": datetime.now(timezone.utc),
        "kind": "password_reset",
    })
    reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
    sent_via_email = False
    try:
        result = ses_service.send_password_reset(user["email"], user.get("name") or "there", reset_link)
        sent_via_email = bool(result.get("success"))
    except Exception as e:
        log.warning("send_password_reset failed: %s", e)
    log.info("Password reset issued: email=%s sent=%s", email, sent_via_email)
    resp = {"ok": True, "sent_via_email": sent_via_email}
    # Dev/preview only: expose the link inline when SMTP is unavailable so
    # QA on non-email stacks can still test the flow. NEVER in prod.
    if SHOW_DEV_FALLBACK_TOKENS and not sent_via_email:
        resp["reset_link"] = reset_link
    return resp


@api.post("/auth/reset-password")
async def reset_password(body: SetPasswordIn):
    """Consume a password reset token and set a new password."""
    db = get_db()
    row = await db.password_reset_tokens.find_one({"token": body.token, "used": False})
    if not row:
        raise HTTPException(400, "Invalid or expired token")
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(400, "Token expired")
    await db.users.update_one({"id": row["user_id"]}, {"$set": {"password_hash": hash_password(body.password)}})
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    # Invalidate every trusted device — a forced password rotation must not
    # leave a stale "remember this browser" hook that bypasses 2FA.
    try:
        await trusted_devices.revoke_all_for_user(row["user_id"])
    except Exception as e:
        log.warning("trusted_devices.revoke_all_for_user failed on reset: %s", e)
    return {"ok": True}


# ==================== Users (Admin) ====================

@api.get("/users")
async def list_users(user: dict = Depends(require_role("ADMIN", "CPA", "PARTNER"))):
    db = get_db()
    role = user["role"]
    # Base filter: exclude soft-deleted / deactivated rows (is_active=False) so
    # downstream UIs like the CPA tab never surface removed members as
    # "active experts". Legacy rows without the is_active field are treated
    # as active by default via ``$ne: False`` semantics.
    q: dict = {"is_active": {"$ne": False}}
    if role == "CPA":
        q["role"] = {"$in": ["CLIENT", "CPA", "ADMIN"]}
    users = []
    async for u in db.users.find(q, {"password_hash": 0, "_id": 0}).sort("name", 1):
        users.append(u)
    return users


@api.post("/users/invite")
async def invite_user(body: InviteUserIn, user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    if body.role not in ("CLIENT", "CPA", "PARTNER", "ADMIN"):
        raise HTTPException(400, "Invalid role")
    email_lc = (body.email or "").strip().lower()
    if not email_lc or "@" not in email_lc:
        raise HTTPException(400, "Please enter a valid email address")

    # Step 1 — active collision on the live email field. The Roles table hides
    # CLIENTs and soft-deleted members, so we must spell out exactly where the
    # conflict lives to avoid the "email already exists but I can't see it"
    # UX confusion.
    existing = await db.users.find_one({"email": email_lc})
    if existing:
        ex_role = existing.get("role")
        ex_name = existing.get("name") or "someone"
        # CLIENT → staff upgrade path. If the admin is adding a non-CLIENT
        # role for an existing client account, upgrade the record instead of
        # rejecting. This supports the real-world case where a referred
        # physician later becomes a CPA / Partner / admin. We preserve
        # their id + engagement history and simply flip role + permissions.
        if ex_role == "CLIENT" and body.role != "CLIENT":
            default_display = {"ADMIN": "Admin", "CPA": "CPA", "PARTNER": "Partner"}.get(body.role, body.role)
            await db.users.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "name": body.name or ex_name,
                    "role": body.role,
                    "display_role": body.display_role or default_display,
                    "permissions": body.permissions or default_permissions_for(body.role),
                    "upgraded_from": "CLIENT",
                    "upgraded_at": datetime.now(timezone.utc),
                    "upgraded_by_id": user["id"],
                }},
            )
            # Issue a fresh invite link so they can set a staff password —
            # existing client portal credentials stay valid but this lets the
            # admin share the set-password flow for the new role.
            token = new_invite_token()
            await db.password_reset_tokens.insert_one({
                "id": str(uuid.uuid4()),
                "token": token,
                "user_id": existing["id"],
                "used": False,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
                "created_at": datetime.now(timezone.utc),
            })
            invite_link = f"{FRONTEND_URL}/set-password?token={token}"
            email_result = await ses_service.send_invite_async(
                email_lc, body.name or ex_name, invite_link, body.role,
                first_name=existing.get("first_name"),
            )
            log.info("Upgraded CLIENT %s to %s (%s) — email_sent=%s", email_lc, body.role, existing["id"], email_result.get("success"))
            return {
                "user_id": existing["id"],
                "invite_link": invite_link,
                "email_sent": bool(email_result.get("success")),
                "email_error": email_result.get("error") if not email_result.get("success") else None,
                "upgraded": True,
            }
        if ex_role == "CLIENT":
            detail = (
                f"This email is already registered as a client account ({ex_name}). "
                "Client accounts are managed from the client record — please use a different email for staff."
            )
        else:
            role_label = {"ADMIN": "Admin", "CPA": "CPA", "PARTNER": "Partner"}.get(ex_role, ex_role or "member")
            detail = (
                f"This email is already in use by an active {role_label} ({ex_name}). "
                "Check the Roles & Permissions table above or use a different address."
            )
        raise HTTPException(409, detail)

    # Step 2 — soft-deleted reactivation. A prior delete stamps ``removed_email``
    # with the original address (the live ``email`` is rotated to
    # deleted+<id8>@cloudtax.invalid so the unique index doesn't fire). When
    # the admin re-invites that same address, reactivate the row with the
    # newly-chosen name/role/permissions and issue a fresh invite link —
    # giving the "add member" flow a smooth, consistent feel.
    reactivate = await db.users.find_one({
        "removed_email": email_lc,
        "is_active": False,
    })
    if reactivate:
        uid = reactivate["id"]
        default_display = {"ADMIN": "Admin", "CPA": "CPA", "PARTNER": "Partner", "CLIENT": "Client"}.get(body.role, body.role)
        temp_pass = uuid.uuid4().hex
        await db.users.update_one(
            {"id": uid},
            {
                "$set": {
                    "email": email_lc,
                    "name": body.name,
                    "role": body.role,
                    "phone": body.phone,
                    "display_role": body.display_role or default_display,
                    "permissions": body.permissions or default_permissions_for(body.role),
                    "is_active": True,
                    "password_hash": hash_password(temp_pass),
                    "reactivated_at": datetime.now(timezone.utc),
                    "reactivated_by_id": user["id"],
                    "reactivated_by_name": user.get("name") or user.get("email"),
                },
                "$unset": {
                    "removed_email": "",
                    "removed_at": "",
                    "removed_by_id": "",
                    "removed_by_name": "",
                    "session_invalidated_at": "",
                },
            },
        )
        # Burn any leftover invite/reset tokens from the prior lifecycle.
        await db.password_reset_tokens.update_many(
            {"user_id": uid, "used": False},
            {"$set": {"used": True, "revoked_at": datetime.now(timezone.utc)}},
        )
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
        email_result = await ses_service.send_invite_async(email_lc, body.name, invite_link, body.role)
        log.info("Reactivated soft-deleted user %s via invite (%s) — email_sent=%s", email_lc, uid, email_result.get("success"))
        return {
            "user_id": uid,
            "invite_link": invite_link,
            "email_sent": bool(email_result.get("success")),
            "email_error": email_result.get("error") if not email_result.get("success") else None,
            "reactivated": True,
        }
    uid = str(uuid.uuid4())
    temp_pass = uuid.uuid4().hex  # random placeholder
    # Default display_role from canonical role
    default_display = {"ADMIN": "Admin", "CPA": "CPA", "PARTNER": "Partner", "CLIENT": "Client"}.get(body.role, body.role)
    await db.users.insert_one({
        "id": uid,
        "email": email_lc,
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
    # Dispatch the welcome email via Resend (welcome_cpa / welcome_ws / welcome_client).
    # We AWAIT the send so the ``email_sent`` flag in our response reflects the
    # real outcome — previously the sync helper returned ``scheduled=True``
    # before the send actually completed, making failures invisible to admins.
    email_result = await ses_service.send_invite_async(body.email, body.name, invite_link, body.role)
    log.info("Invite issued: %s -> %s (email_sent=%s)", body.email, invite_link, email_result.get("success"))
    return {
        "user_id": uid,
        "invite_link": invite_link,
        "email_sent": bool(email_result.get("success")),
        "email_error": email_result.get("error") if not email_result.get("success") else None,
    }


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


# ==================== Avatar (profile picture) ====================

ALLOWED_AVATAR_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_AVATAR_BYTES = 4 * 1024 * 1024  # 4 MB


@api.post("/users/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Upload a profile picture for the current user. S3 with local-disk fallback (mirrors document upload)."""
    db = get_db()
    body = await file.read()
    if len(body) > MAX_AVATAR_BYTES:
        raise HTTPException(400, f"Image too large (max {MAX_AVATAR_BYTES // (1024 * 1024)} MB)")
    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_AVATAR_MIMES:
        raise HTTPException(400, "Unsupported image type. Use PNG, JPEG, WebP or GIF.")

    safe_name = (file.filename or "avatar").replace("/", "_").replace("\\", "_")
    object_key = f"avatars/{user['id']}/{uuid.uuid4().hex}_{safe_name}"
    storage = "s3"
    if not s3_service.put_object_bytes(object_key, body, content_type):
        storage = "local"
        local_dir = os.path.join(os.path.dirname(__file__), "uploads", "avatars", user["id"])
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, f"{uuid.uuid4().hex}_{safe_name}")
        with open(local_path, "wb") as f:
            f.write(body)
        object_key = f"local://{local_path}"
        log.warning("S3 avatar upload failed for %s — stored locally at %s", user["id"], local_path)
        await alert_s3_access_denied_if_needed()

    # Public-ish URL routed through our backend (always served via /api so RBAC stays consistent).
    # Append a version param so client-side caches always see the latest upload as a fresh URL.
    now_dt = datetime.now(timezone.utc)
    version = int(now_dt.timestamp())
    avatar_url = f"/api/users/{user['id']}/avatar?v={version}"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "avatar_object_key": object_key,
            "avatar_storage": storage,
            "avatar_mime": content_type,
            "avatar_url": avatar_url,
            "avatar_updated_at": now_dt,
        }},
    )
    return {"avatar_url": avatar_url, "storage": storage}


@api.delete("/users/me/avatar")
async def delete_my_avatar(user: dict = Depends(get_current_user)):
    """Remove the current user's profile picture (frontend will fall back to initials)."""
    db = get_db()
    me = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    key = (me or {}).get("avatar_object_key")
    if key and key.startswith("local://"):
        try:
            os.remove(key[len("local://"):])
        except OSError:
            pass
    await db.users.update_one(
        {"id": user["id"]},
        {"$unset": {"avatar_object_key": "", "avatar_storage": "", "avatar_mime": "", "avatar_url": "", "avatar_updated_at": ""}},
    )
    return {"ok": True}


@api.get("/users/{uid}/avatar")
async def get_user_avatar(uid: str, user: dict = Depends(get_current_user)):
    """Stream a user's profile picture. All authenticated users can view any avatar."""
    db = get_db()
    target = await db.users.find_one({"id": uid}, {"_id": 0, "avatar_object_key": 1, "avatar_mime": 1})
    key = (target or {}).get("avatar_object_key")
    if not key:
        raise HTTPException(404, "No avatar")
    mime = target.get("avatar_mime") or "image/jpeg"
    from fastapi.responses import FileResponse, Response
    if key.startswith("local://"):
        path = key[len("local://"):]
        if not os.path.exists(path):
            raise HTTPException(404, "Avatar file missing")
        return FileResponse(path, media_type=mime)
    body = s3_service.get_object_bytes(key)
    if body is None:
        raise HTTPException(404, "Avatar unavailable")
    return Response(content=body, media_type=mime)


@api.patch("/users/{uid}")
async def update_user(uid: str, body: dict, user: dict = Depends(require_role("ADMIN"))):
    if uid == "me":
        raise HTTPException(404, "Not found")
    db = get_db()
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(404, "User not found")
    allowed = {"name", "role", "phone", "is_active", "display_role", "permissions", "email"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    # Guard: admins cannot demote themselves or deactivate themselves via this
    # endpoint. Doing so would brick their session on the very next request
    # (getting a 403 from require_role("ADMIN")). Protect the Roles &
    # Permissions UX from this foot-gun.
    if uid == user["id"]:
        if "role" in updates and updates["role"] != "ADMIN":
            raise HTTPException(400, "You cannot change your own role — ask another admin to do it")
        if "is_active" in updates and not updates["is_active"]:
            raise HTTPException(400, "You cannot deactivate your own account")
    # Email change path: enforce uniqueness + notify the affected user (in-app).
    email_changed = False
    old_email = target.get("email")
    if "email" in updates:
        new_email = (updates["email"] or "").strip().lower()
        if not new_email or "@" not in new_email:
            raise HTTPException(400, "A valid email is required")
        if new_email != (old_email or "").lower():
            existing = await db.users.find_one({"email": new_email, "id": {"$ne": uid}})
            if existing:
                raise HTTPException(409, f"Another user already uses {new_email}")
            updates["email"] = new_email
            email_changed = True
        else:
            # No change — drop to avoid an unnecessary write.
            updates.pop("email")
    if not updates:
        raise HTTPException(400, "No changes to apply")
    await db.users.update_one({"id": uid}, {"$set": updates})
    u = await db.users.find_one({"id": uid}, {"password_hash": 0, "_id": 0})
    if email_changed:
        # In-app notification to the target user so they know their login has changed.
        # Email delivery is not triggered — we surface it in the app; the admin
        # can separately message them outside the system if they want.
        try:
            await notify(uid, "Your sign-in email was updated", f"Your account email was changed to {updates['email']} by an admin. Please use the new address next time you sign in.", "email_changed", None)
        except Exception as e:
            log.warning("Failed to notify user %s of email change: %s", uid, e)
        log.info("Admin %s changed email of user %s from %s -> %s", user.get("email"), uid, old_email, updates["email"])
    return u


@api.post("/users/{uid}/resend-invite")
async def resend_invite(uid: str, user: dict = Depends(require_role("ADMIN"))):
    """Reissue the set-password invitation link for a team member who hasn't
    activated yet (or who wants a fresh link). Invalidates the user's prior
    tokens so the old email's link stops working.

    Works for any non-client staff account. If the user is already active
    (has a password set), this still issues a fresh link — useful as a
    password-reset for team members who can't use the Forgot Password flow.
    """
    db = get_db()
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == "CLIENT":
        raise HTTPException(400, "Client invites are managed from the client record")
    if (target.get("email") or "").endswith("@cloudtax.invalid"):
        raise HTTPException(400, "Cannot resend an invite to a removed member")
    now = datetime.now(timezone.utc)
    # Burn all unused tokens for this user so only the newest link works.
    await db.password_reset_tokens.update_many(
        {"user_id": uid, "used": False},
        {"$set": {"used": True, "revoked_at": now, "revoked_by_id": user["id"]}},
    )
    token = new_invite_token()
    await db.password_reset_tokens.insert_one({
        "id": str(uuid.uuid4()),
        "token": token,
        "user_id": uid,
        "used": False,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    invite_link = f"{FRONTEND_URL}/set-password?token={token}"
    email_result = await ses_service.send_invite_async(
        target["email"],
        target.get("name") or target["email"],
        invite_link,
        target.get("role", "CPA"),
        first_name=target.get("first_name"),
    )
    log.info("Invite resent: %s -> %s (by %s, email_sent=%s)", target.get("email"), invite_link, user.get("email"), email_result.get("success"))
    return {
        "ok": True,
        "invite_link": invite_link,
        "email_sent": bool(email_result.get("success")),
        "email_error": email_result.get("error") if not email_result.get("success") else None,
    }


@api.delete("/users/{uid}")
async def delete_user(uid: str, permanent: bool = False, user: dict = Depends(require_role("ADMIN"))):
    """Remove a member. Protects against self-delete and last-admin-delete.

    Default behaviour is a soft-delete: flips ``is_active=False`` and rewrites
    the email to a placeholder so the address can be re-invited. Pass
    ``permanent=true`` to HARD-DELETE the user record from the database —
    irreversible, used for permanently purging clients who requested data
    removal or scrubbing test data. Hard-delete safeguards: last admin
    protection still applies; CLIENT records with linked engagements are
    blocked unless those engagements are deleted first.
    """
    if uid == user["id"]:
        raise HTTPException(400, "You cannot remove your own account")
    db = get_db()
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(404, "User not found")
    # Permanent delete path — no soft-delete artefacts left behind.
    if permanent:
        if target.get("role") == "ADMIN" and target.get("is_active", True):
            active_admins = await db.users.count_documents({"role": "ADMIN", "is_active": {"$ne": False}})
            if active_admins <= 1:
                raise HTTPException(400, "Cannot permanently delete the last active admin")
        if target.get("role") == "CLIENT":
            # Cascade: a hard-deleted client must also delete their linked
            # corporations + engagements + documents/checklist/etc. Leaving
            # orphans behind makes the pipeline show "phantom" rows against
            # no actual client user.
            corps = [c async for c in db.corporations.find({"client_id": uid}, {"_id": 0})]
            corp_ids = [c["id"] for c in corps]
            eng_ids: list[str] = []
            if corp_ids:
                eng_ids = [e["id"] async for e in db.engagements.find({"corporation_id": {"$in": corp_ids}}, {"_id": 0, "id": 1})]
            if eng_ids:
                await db.documents.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.checklist.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.extracted_data.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.opportunities.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.time_entries.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.engagement_notes.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.status_history.delete_many({"engagement_id": {"$in": eng_ids}})
                await db.engagements.delete_many({"id": {"$in": eng_ids}})
            if corp_ids:
                await db.corporations.delete_many({"id": {"$in": corp_ids}})
            log.info(
                "Cascade-deleted %d corps, %d engagements alongside client %s",
                len(corp_ids), len(eng_ids), uid,
            )
        await db.users.delete_one({"id": uid})
        # Burn any outstanding invite/reset tokens for tidy book-keeping.
        await db.password_reset_tokens.delete_many({"user_id": uid})
        log.info("Admin %s PERMANENTLY deleted user %s (%s)", user.get("email"), uid, target.get("email"))
        return {"ok": True, "id": uid, "permanent": True}
    # CLIENT soft-delete is now ALLOWED (was previously blocked to force use of
    # the engagement record). The Users tab needs full lifecycle control over
    # client accounts. Engagements remain untouched — only the user row is
    # deactivated and the email freed.
    # Prevent removing the last active admin.
    if target.get("role") == "ADMIN":
        active_admins = await db.users.count_documents({"role": "ADMIN", "is_active": {"$ne": False}})
        if active_admins <= 1:
            raise HTTPException(400, "Cannot remove the last active admin")
    # Soft-delete: deactivate + free the email so it can be re-invited. We
    # preserve the ORIGINAL email in ``removed_email`` so a future invite with
    # the same address can reactivate this record cleanly (see invite_user).
    freed_email = f"deleted+{uid[:8]}@cloudtax.invalid"
    live_email = (target.get("email") or "").lower()
    # If the row is already rotated (repeated DELETE), preserve the previously
    # captured ``removed_email`` instead of overwriting it with the placeholder.
    if live_email.endswith("@cloudtax.invalid"):
        original_email = target.get("removed_email") or live_email
    else:
        original_email = live_email
    await db.users.update_one(
        {"id": uid},
        {"$set": {
            "is_active": False,
            "email": freed_email,
            "removed_email": original_email,
            "removed_at": datetime.now(timezone.utc),
            "removed_by_id": user["id"],
            "removed_by_name": user.get("name") or user.get("email"),
            # Invalidate any active sessions — they'll be 401'd on next /me call.
            "session_invalidated_at": datetime.now(timezone.utc),
        }},
    )
    # Lifecycle side-effects to keep the pipeline/table in sync:
    # - CPA soft-delete → unassign their engagements so the pipeline no longer
    #   attributes work to a removed member.
    # - CLIENT soft-delete → the orphan filter in list_engagements already
    #   hides their engagements (because ``client.is_active=False``). We
    #   explicitly leave the corporation+engagement rows intact so an admin
    #   can reactivate the client later and resume where they left off.
    if target.get("role") == "CPA":
        await db.engagements.update_many(
            {"assigned_cpa_id": uid},
            {"$set": {"assigned_cpa_id": None, "updated_at": datetime.now(timezone.utc)}},
        )
    log.info("Admin %s removed user %s (%s)", user.get("email"), uid, target.get("email"))
    return {"ok": True, "id": uid}


@api.get("/users/team")
async def list_team(user: dict = Depends(require_role("ADMIN"))):
    """Members shown in Roles & Permissions table — excludes CLIENT role and
    soft-deleted members (``is_active=false`` with a rotated placeholder email)."""
    db = get_db()
    query = {
        "role": {"$ne": "CLIENT"},
        "$or": [
            {"removed_at": {"$exists": False}},
            {"removed_at": None},
        ],
    }
    out = []
    async for u in db.users.find(query, {"password_hash": 0, "_id": 0}).sort("name", 1):
        # Belt-and-suspenders: also filter rows whose email got rotated to the
        # deleted placeholder (in case an older record pre-dates removed_at).
        if (u.get("email") or "").endswith("@cloudtax.invalid"):
            continue
        if not u.get("permissions"):
            u["permissions"] = default_permissions_for(u["role"])
        if not u.get("display_role"):
            u["display_role"] = {"ADMIN": "Admin", "CPA": "CPA", "PARTNER": "Partner"}.get(u["role"], u["role"])
        # Lifecycle status drives row affordances (e.g. only "invited" members
        # can have their invitation resent).
        u["status"] = await _compute_user_status(db, u)
        out.append(u)
    return out


async def _compute_user_status(db, u: dict) -> str:
    """Derive the lifecycle status shown in the Users tab / autocomplete:
    - ``removed``  → soft-deleted (is_active=false or removed_at set, or the
                      email was rotated to the cloudtax.invalid placeholder).
    - ``invited``  → account exists but the person hasn't finished setting
                      their password yet. Detected via the absence of
                      ``activated_at`` AND the presence of an unused invite
                      token, OR the legacy heuristic that the user has no
                      ``activated_at`` yet.
    - ``active``   → everything else (logged in at least once, or activated).
    """
    if not u.get("is_active", True) or u.get("removed_at") or (u.get("email") or "").endswith("@cloudtax.invalid"):
        return "removed"
    if u.get("activated_at"):
        return "active"
    # A user is "invited" when they haven't completed set-password yet. We
    # detect this by: (a) no activated_at AND (b) created recently (last 90
    # days — beyond that assume the invite lifecycle was completed through
    # some legacy path) AND (c) an unused, unexpired invite token is still on
    # file. Older accounts without activated_at default to ``active`` so
    # seeded users (admin/CPA) aren't miscategorised.
    created_at = u.get("created_at")
    if not created_at:
        return "active"
    if isinstance(created_at, datetime) and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    age_days = (datetime.now(timezone.utc) - created_at).days if isinstance(created_at, datetime) else 999
    if age_days > 90:
        return "active"
    has_pending_token = await db.password_reset_tokens.find_one({
        "user_id": u["id"],
        "used": False,
        "expires_at": {"$gt": datetime.now(timezone.utc)},
    }) is not None
    return "invited" if has_pending_token else "active"


def _sanitize_user_row(u: dict) -> dict:
    u = {k: v for k, v in u.items() if k != "password_hash"}
    u.pop("_id", None)
    return u


@api.get("/users/search")
async def search_users(q: str = "", limit: int = 10, user: dict = Depends(require_role("ADMIN"))):
    """Autocomplete endpoint for the Add Member email field. Matches on email
    or name (case-insensitive, contains). Returns up to ``limit`` rows with
    lifecycle status. Includes CLIENT + soft-deleted records so the admin sees
    the full picture before submitting — preventing "email already exists"
    surprises.
    """
    q = (q or "").strip()
    if len(q) < 2:
        return []
    limit = max(1, min(int(limit or 10), 25))
    db = get_db()
    # Case-insensitive substring on email OR name. Escape regex metacharacters.
    safe = re.escape(q)
    pattern = {"$regex": safe, "$options": "i"}
    cursor = db.users.find(
        {"$or": [{"email": pattern}, {"name": pattern}, {"removed_email": pattern}]},
        {"password_hash": 0, "_id": 0},
    ).limit(limit * 3)  # over-fetch, filter placeholders client-side
    rows: List[dict] = []
    async for u in cursor:
        live_email = u.get("email") or ""
        # Legacy soft-deletes had no ``removed_email`` stamp — surface nothing
        # useful to the admin, so skip them entirely rather than leak the
        # deleted+<id>@cloudtax.invalid placeholder into the dropdown.
        if live_email.endswith("@cloudtax.invalid") and not u.get("removed_email"):
            continue
        displayed_email = u.get("removed_email") if live_email.endswith("@cloudtax.invalid") else live_email
        status = await _compute_user_status(db, u)
        rows.append({
            "id": u.get("id"),
            "email": displayed_email,
            "name": u.get("name"),
            "role": u.get("role"),
            "display_role": u.get("display_role"),
            "avatar_url": u.get("avatar_url"),
            "status": status,
        })
        if len(rows) >= limit:
            break
    # Case-insensitive sort: exact-email matches first, then prefix, then contains.
    q_lc = q.lower()
    def sort_key(r):
        e = (r.get("email") or "").lower()
        if e == q_lc:
            return (0, e)
        if e.startswith(q_lc):
            return (1, e)
        return (2, e)
    rows.sort(key=sort_key)
    return rows


@api.get("/users/all")
async def list_all_users(user: dict = Depends(require_role("ADMIN"))):
    """Comprehensive user list for the Admin → Users tab. Includes every
    account regardless of role or lifecycle state. Each row carries a derived
    ``status`` (active / invited / removed) so the UI can badge appropriately.
    """
    db = get_db()
    out: List[dict] = []
    async for u in db.users.find({}, {"password_hash": 0, "_id": 0}).sort("name", 1):
        displayed_email = u.get("email") or ""
        if displayed_email.endswith("@cloudtax.invalid") and u.get("removed_email"):
            displayed_email = u["removed_email"]
        status = await _compute_user_status(db, u)
        row = _sanitize_user_row(dict(u))
        row["email"] = displayed_email
        row["status"] = status
        # Best-effort last_updated_at: most-recent among stamp fields.
        stamps = [
            row.get("created_at"),
            row.get("activated_at"),
            row.get("reactivated_at"),
            row.get("removed_at"),
            row.get("avatar_updated_at"),
            row.get("two_factor_enabled_at"),
            row.get("two_factor_disabled_at"),
        ]
        stamps = [s for s in stamps if s]
        row["last_updated_at"] = max(stamps) if stamps else None
        out.append(row)
    return out


@api.post("/users/{uid}/deactivate")
async def deactivate_user(uid: str, user: dict = Depends(require_role("ADMIN"))):
    """Flip ``is_active=false`` without rotating the email — reversible via
    /reactivate. Distinct from DELETE which additionally frees the email
    address. Protects against self-deactivation and last-active-admin.
    """
    if uid == user["id"]:
        raise HTTPException(400, "You cannot deactivate your own account")
    db = get_db()
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == "ADMIN" and target.get("is_active", True):
        active_admins = await db.users.count_documents({"role": "ADMIN", "is_active": {"$ne": False}})
        if active_admins <= 1:
            raise HTTPException(400, "Cannot deactivate the last active admin")
    await db.users.update_one(
        {"id": uid},
        {"$set": {
            "is_active": False,
            "deactivated_at": datetime.now(timezone.utc),
            "deactivated_by_id": user["id"],
            "session_invalidated_at": datetime.now(timezone.utc),
        }},
    )
    # CPA safeguard: unassign any engagements that pointed to this CPA so
    # their client list stops surfacing them as "assigned". Admin can later
    # reassign via the Clients pipeline.
    if target.get("role") == "CPA":
        await db.engagements.update_many(
            {"assigned_cpa_id": uid},
            {"$set": {"assigned_cpa_id": None, "updated_at": datetime.now(timezone.utc)}},
        )
    log.info("Admin %s deactivated user %s", user.get("email"), uid)
    return {"ok": True, "id": uid}


@api.post("/users/{uid}/reactivate")
async def reactivate_user(uid: str, user: dict = Depends(require_role("ADMIN"))):
    """Undo deactivate/delete. For deleted users whose email was rotated, we
    restore the original email from ``removed_email`` so they can sign in
    again (assuming no live collision). Fails with 409 if the original email
    now conflicts with another active account.
    """
    db = get_db()
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(404, "User not found")
    updates: dict = {"is_active": True, "reactivated_at": datetime.now(timezone.utc), "reactivated_by_id": user["id"]}
    unset: dict = {
        "removed_at": "",
        "removed_by_id": "",
        "removed_by_name": "",
        "session_invalidated_at": "",
        "deactivated_at": "",
        "deactivated_by_id": "",
    }
    live_email = target.get("email") or ""
    if live_email.endswith("@cloudtax.invalid") and target.get("removed_email"):
        # Restore the original address — but only if nothing else has claimed it.
        original = target["removed_email"]
        collision = await db.users.find_one({"email": original, "id": {"$ne": uid}, "is_active": True})
        if collision:
            raise HTTPException(409, f"Cannot restore {original} — it's in use by another active account")
        updates["email"] = original
        unset["removed_email"] = ""
    await db.users.update_one({"id": uid}, {"$set": updates, "$unset": unset})
    log.info("Admin %s reactivated user %s", user.get("email"), uid)
    return {"ok": True, "id": uid}


@api.get("/auth/invite-info")
async def invite_info(token: str):
    """Public endpoint: return the email + name + role associated with a
    password-set / invite token so the Set-Password screen can display a
    read-only email and hide the token string entirely. Does not expose the
    hashed token or the full user record.
    """
    if not token:
        raise HTTPException(400, "token is required")
    db = get_db()
    row = await db.password_reset_tokens.find_one({"token": token})
    if not row or row.get("used"):
        raise HTTPException(400, "Invalid or expired invite link")
    expires_at = row.get("expires_at")
    if expires_at:
        if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(400, "Invalid or expired invite link")
    u = await db.users.find_one({"id": row["user_id"]}, {"_id": 0, "password_hash": 0})
    if not u or not u.get("is_active", True):
        raise HTTPException(400, "Invalid or expired invite link")
    return {
        "email": u.get("email"),
        "name": u.get("name"),
        "role": u.get("role"),
    }


# ==================== Engagements ====================

async def _enrich_engagements(engs: list[dict]) -> list[dict]:
    db = get_db()
    corp_ids = list({e["corporation_id"] for e in engs})
    user_ids = set()
    for e in engs:
        user_ids.update(filter(None, [e.get("assigned_cpa_id"), e.get("partner_advisor_id")]))
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
        e["partner_advisor"] = users.get(e.get("partner_advisor_id"))
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
        # Engagements where the user is the primary client...
        primary_q = {"corporation_id": corp["id"]} if corp else None
        # ...plus engagements where the user is an active delegate.
        delegate_eids = await delegates.list_engagement_ids_for_delegate(user["id"])
        if primary_q and delegate_eids:
            q = {"$or": [primary_q, {"id": {"$in": delegate_eids}}]}
        elif primary_q:
            q = primary_q
        elif delegate_eids:
            q = {"id": {"$in": delegate_eids}}
        else:
            return []
    engs = [e async for e in db.engagements.find(q).sort("referral_date", -1)]
    out = await _enrich_engagements(engs)
    # Orphan filter — drop engagements whose client user record has been
    # permanently deleted OR deactivated. This keeps the pipeline/table in
    # lock-step with the Users tab even if pre-iter-40 rows left dangling
    # corporation.client_id pointers. CLIENT's own view is already scoped by
    # their own user id so this filter is a no-op for them.
    def _is_valid(e: dict) -> bool:
        client = e.get("client")
        if not client:
            return False
        if client.get("is_active") is False:
            return False
        corp = e.get("corporation") or {}
        if not corp.get("id"):
            return False
        return True
    out = [e for e in out if _is_valid(e)]
    if role == "PARTNER":
        out = [redact_for_ws(e) for e in out]
    if role == "CLIENT":
        out = [redact_for_client(e) for e in out]
    return out


@api.post("/engagements")
async def create_engagement(body: CreateEngagementIn, user: dict = Depends(require_role("ADMIN"))):
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
    partner_advisor_id = user["id"] if user["role"] == "PARTNER" else None
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
        "partner_advisor_id": partner_advisor_id,
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
    if user["role"] == "PARTNER":
        e = redact_for_ws(e)
    return e


# ---- Partner onboarding flow ----

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
async def ws_create_onboarding(body: WsOnboardingIn, user: dict = Depends(require_role("ADMIN"))):
    """Create a draft engagement in ONBOARDING status with whatever fields are provided."""
    db = get_db()
    if not body.client_email or not body.first_name:
        raise HTTPException(400, "first_name and client_email required to start a draft")
    if not (body.corp_name or "").strip():
        raise HTTPException(400, "corp_name is required — please provide the client's corporation name")
    # Preserve the EXACT first/last name the caller typed. Multi-word values like
    # "Dr Bala" must not be split on whitespace — we only use ``full_name`` as a
    # display-friendly concatenation for legacy callers that still read ``name``.
    first_name = body.first_name.strip()
    last_name = (body.last_name or "").strip()
    full_name = (first_name + " " + last_name).strip() if last_name else first_name
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
            "first_name": first_name,
            "last_name": last_name,
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
            ses_service.send_invite(email, full_name, invite_link, "client", first_name=first_name)
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
        # No per-client partner ownership: every partner sees ALL clients
        # (view-only). When ADMIN onboards there is no partner to attribute, so
        # leave this None. The partner read guard in get_engagement_or_404 is a
        # `pass` (partners see all), so None hides nothing from any partner view.
        "partner_advisor_id": None,
        "pre_filing_checklist": await _checklist_from_template(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    })
    return {"id": eng_id, "invite_link": invite_link}


@api.post("/engagements/{eid}/resend-invite")
async def resend_client_invite(eid: str, user: dict = Depends(require_role("ADMIN"))):
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
async def ws_update_onboarding(eid: str, body: WsOnboardingIn, user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    eng = await db.engagements.find_one({"id": eid})
    if not eng:
        raise HTTPException(404, "Engagement not found")
    if eng.get("status") != "ONBOARDING":
        raise HTTPException(400, "Only ONBOARDING engagements can be edited via this route")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    client = await db.users.find_one({"id": corp["client_id"]}) if corp else None

    # Update client name from first/last. Preserve whitespace in multi-word names
    # like "Dr Bala" — the two fields are stored VERBATIM; ``name`` is just a
    # concatenation convenience.
    if body.first_name is not None or body.last_name is not None:
        first = (body.first_name or "").strip()
        last = (body.last_name or "").strip()
        full = (first + " " + last).strip() if last else first
        if client:
            update_set = {}
            if body.first_name is not None:
                update_set["first_name"] = first
            if body.last_name is not None:
                update_set["last_name"] = last
            if full:
                update_set["name"] = full
            if update_set:
                await db.users.update_one({"id": client["id"]}, {"$set": update_set})
    if body.client_email and client:
        await db.users.update_one({"id": client["id"]}, {"$set": {"email": body.client_email.lower()}})
    if body.phone is not None and client:
        await db.users.update_one({"id": client["id"]}, {"$set": {"phone": body.phone}})

    if corp:
        corp_updates = {}
        if body.corp_name is not None:
            if not body.corp_name.strip():
                raise HTTPException(400, "corp_name cannot be empty")
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
        eng_updates["partner_notes"] = body.notes
    if eng_updates:
        eng_updates["updated_at"] = datetime.now(timezone.utc)
        await db.engagements.update_one({"id": eid}, {"$set": eng_updates})
    return {"ok": True}


# ==================== Engagement Notes (shared across roles) ====================
# Free-form notes feed. Partners, CPAs, and Admins can each append a note;
# all three roles see the full history (newest-first). Replaces the old
# single-textarea ``partner_notes`` field with a timeline so context isn't
# clobbered when handed off between roles.

class EngagementNoteIn(BaseModel):
    text: str


def _legacy_partner_note(eng: dict) -> Optional[dict]:
    """Convert a legacy single-string ``partner_notes`` field into a synthetic
    history entry so old engagements don't show empty when the new endpoint
    is consulted."""
    text = (eng.get("partner_notes") or "").strip()
    if not text:
        return None
    when = eng.get("updated_at") or eng.get("created_at") or datetime.now(timezone.utc)
    if isinstance(when, datetime) and when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return {
        "id": f"legacy-{eng['id']}",
        "text": text,
        "at": when.isoformat() if isinstance(when, datetime) else when,
        "author_id": eng.get("partner_id"),
        "author_name": "Ownr partner (legacy)",
        "author_role": "PARTNER",
        "is_legacy": True,
    }


def _serialize_notes(eng: dict) -> list:
    raw = list(eng.get("notes_history") or [])
    out = []
    for n in raw:
        when = n.get("at")
        if isinstance(when, datetime):
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            when = when.isoformat()
        out.append({
            "id": n.get("id"),
            "text": n.get("text") or "",
            "at": when,
            "author_id": n.get("author_id"),
            "author_name": n.get("author_name"),
            "author_role": n.get("author_role"),
            "is_legacy": False,
        })
    legacy = _legacy_partner_note(eng)
    if legacy and not any(n.get("is_legacy") for n in out):
        out.append(legacy)
    # Newest-first ordering. Legacy entries fall to the bottom because their
    # timestamp is the engagement's last updated_at, which is older than any
    # newly-pushed note.
    out.sort(key=lambda n: n.get("at") or "", reverse=True)
    return out


@api.get("/engagements/{eid}/notes")
async def list_engagement_notes(eid: str, user: dict = Depends(get_current_user)):
    eng = await get_engagement_or_404(eid, user)
    if user["role"] not in ("PARTNER", "CPA", "ADMIN"):
        raise HTTPException(403, "Only staff can read engagement notes")
    return {"items": _serialize_notes(eng)}


@api.post("/engagements/{eid}/notes")
async def append_engagement_note(eid: str, body: EngagementNoteIn, user: dict = Depends(get_current_user)):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] not in ("PARTNER", "CPA", "ADMIN"):
        raise HTTPException(403, "Only staff can write engagement notes")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "Note text is required")
    if len(text) > 5000:
        raise HTTPException(400, "Note is too long (max 5000 chars)")
    now = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()),
        "text": text,
        "at": now,
        "author_id": user["id"],
        "author_name": user.get("name") or user.get("email"),
        "author_role": user["role"],
    }
    await db.engagements.update_one(
        {"id": eid},
        {"$push": {"notes_history": entry}, "$set": {"updated_at": now}},
    )
    eng2 = await db.engagements.find_one({"id": eid})
    return {"ok": True, "items": _serialize_notes(eng2 or eng)}


@api.post("/engagements/{eid}/submit")
async def ws_submit_to_cloudtax(eid: str, user: dict = Depends(require_role("ADMIN"))):
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
    await log_status_change(eid, user["id"], "ONBOARDING", "REFERRED", "Submitted to CloudTax")
    # Notify all admins so they can assign a CPA
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    client = await db.users.find_one({"id": corp["client_id"]}) if corp else None
    partner_name = user.get("name") or user.get("email") or "CloudTax"
    client_label = (client.get("name") if client else "") or (corp.get("name") if corp else eid[:8])
    await notify_admins(
        "New client referred from Ownr",
        f"{partner_name} referred {client_label}. Assign a CPA to begin intake.",
        "new_referral_admin",
        eid,
    )
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
async def ws_update_checklist(eid: str, body: ChecklistArrayIn, user: dict = Depends(require_role("ADMIN"))):
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
    # Assigning / reassigning a CPA needs the matching permission flag ON TOP of
    # the role gate above. Enforced ONLY when the request actually changes
    # assigned_cpa_id to a real CPA — status moves, CRA updates, etc. keep the
    # role-only gate so existing CPA/admin workflows are untouched.
    if (
        "assigned_cpa_id" in updates
        and updates["assigned_cpa_id"]
        and updates["assigned_cpa_id"] != eng.get("assigned_cpa_id")
    ):
        # Seeded admins (auth.seed_admin) carry no explicit permissions map, so
        # fall back to the role defaults — ADMIN is all-true and never locked out.
        perms = user.get("permissions") or default_permissions_for(user["role"])
        needed = "reassign_cpa" if eng.get("assigned_cpa_id") else "assign_cpa"
        if not perms.get(needed):
            raise HTTPException(403, f"You don't have permission to {needed.replace('_', ' ')}")
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
            # Hard gate: T183 must be signed AND submission info recorded before
            # this engagement can be marked FILED via the Move-to dropdown.
            # (The "Update submission info" form sets both fields atomically.)
            if not eng.get("t183_signed_at"):
                raise HTTPException(400, "Cannot move to Filed: client must sign T183 first.")
            if not eng.get("filing_confirmation"):
                raise HTTPException(400, "Cannot move to Filed: complete 'Update submission info' (CRA confirmation + filed PDF) first.")
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
            if eng.get("partner_advisor_id"):
                await notify(eng["partner_advisor_id"], "Filing complete", f"{eng['id'][:8]} T2 filed with CRA", "filing_complete", eid)
            await notify_admins("T2 filed with CRA", f"{(corp or {}).get('name') or eid[:8]} has been filed.", "filing_complete_admin", eid)
    if "cra_access_status" in updates and updates["cra_access_status"] == "ACCESS_VERIFIED":
        updates["cra_verified_at"] = now
        updates["cra_verified_by"] = user["id"]

    # Detect a CPA assignment / re-assignment so we can notify the right people
    cpa_changed = (
        "assigned_cpa_id" in updates
        and updates["assigned_cpa_id"]
        and updates["assigned_cpa_id"] != eng.get("assigned_cpa_id")
    )

    await db.engagements.update_one({"id": eid}, {"$set": updates})

    if cpa_changed:
        new_cpa_id = updates["assigned_cpa_id"]
        cpa_user = await db.users.find_one({"id": new_cpa_id}, {"_id": 0})
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        client = await db.users.find_one({"id": corp["client_id"]}) if corp else None
        client_label = (client.get("name") if client else "") or (corp.get("name") if corp else eid[:8])
        cpa_label = (cpa_user.get("name") if cpa_user else "your CPA") if cpa_user else "your CPA"
        # Record the (re)assignment in the engagement's status history. A CPA
        # change is not a status transition, so without this it left no trace
        # in the timeline. Tagged kind="cpa_change" so the UI renders it as an
        # assignment event rather than a status badge transition.
        prev_cpa_id = eng.get("assigned_cpa_id")
        if prev_cpa_id:
            prev_cpa = await db.users.find_one({"id": prev_cpa_id}, {"_id": 0, "name": 1})
            cpa_note = f"CPA reassigned: {(prev_cpa or {}).get('name') or 'previous CPA'} → {cpa_label}"
        else:
            cpa_note = f"CPA assigned: {cpa_label}"
        await db.status_history.insert_one({
            "id": str(uuid.uuid4()),
            "engagement_id": eid,
            "changed_by_id": user["id"],
            "kind": "cpa_change",
            "from_status": None,
            "to_status": None,
            "note": cpa_note,
            "created_at": now,
        })
        # Notify the newly-assigned CPA — keep the in-app bell ...
        await notify(
            new_cpa_id,
            "New client assigned to you",
            f"{client_label} — you have been assigned as the CPA on this engagement.",
            "cpa_assigned",
            eid,
        )
        # ... and send the operator "New client assigned" email alongside it
        # (fire-and-forget, non-fatal — mirrors every other email send site).
        # Only the newly-assigned CPA is emailed; on reassignment we do NOT
        # email the previously-assigned CPA.
        if cpa_user and cpa_user.get("email"):
            partner_advisor = (
                await db.users.find_one({"id": eng["partner_advisor_id"]}, {"_id": 0, "name": 1})
                if eng.get("partner_advisor_id") else None
            )
            try:
                await _email_templates_send(cpa_user["email"], "cpa_client_assigned", {
                    "client_name": client_label,
                    "corporation_name": (corp or {}).get("name"),
                    "tier": eng.get("tier"),
                    "partner_advisor_name": (partner_advisor or {}).get("name"),
                    "link": f"{FRONTEND_URL}/cpa/engagement/{eid}",
                })
            except Exception as e:
                log.warning("cpa_client_assigned email failed: %s", e)
        # Notify the Partner so they see progress
        if eng.get("partner_advisor_id"):
            await notify(
                eng["partner_advisor_id"],
                "CPA assigned to your client",
                f"{cpa_label} is now the CPA on {client_label}.",
                "ws_cpa_assigned",
                eid,
            )
        # Notify the client (only if they have already accepted the invite)
        if client and client.get("password_hash"):
            await notify(
                client["id"],
                "Your CPA has been assigned",
                f"{cpa_label} will reach out shortly to start your tax filing.",
                "client_cpa_assigned",
                eid,
            )

    eng = await db.engagements.find_one({"id": eid}, {"_id": 0})
    return eng


# ==================== Documents ====================

@api.get("/engagements/{eid}/documents")
async def list_documents(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot view documents")
    db = get_db()
    docs = [d async for d in db.documents.find({"engagement_id": eid}, {"_id": 0}).sort("sort_order", 1)]
    # Normalize legacy single-file docs into a files[] array for the frontend
    for d in docs:
        if not d.get("files") and d.get("object_key"):
            d["files"] = [{
                "id": d.get("id") + "-legacy",
                "object_key": d.get("object_key"),
                "storage": d.get("storage"),
                "file_name": d.get("file_name"),
                "file_size": d.get("file_size"),
                "mime_type": d.get("mime_type"),
                "uploaded_at": d.get("uploaded_at"),
            }]
    return docs


@api.get("/engagements/{eid}/documents/summary")
async def list_documents_summary(eid: str, user: dict = Depends(get_current_user)):
    """Lightweight name+status list visible to Partners (no download URLs, no S3 keys)."""
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
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot upload documents")
    content_type = body.get("content_type", "application/octet-stream")
    file_name = body.get("file_name", "upload.bin")
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._-")[:80] or "file"
    object_key = f"engagements/{doc['engagement_id']}/{doc_id}/{uuid.uuid4().hex}_{safe_name}"
    res = s3_service.generate_upload_url(object_key, content_type)
    if not res:
        raise HTTPException(500, "Could not generate upload URL")
    return res


async def _attribution_for_user(user: dict, engagement_id: str) -> dict:
    """Compose a serialisable {id, name, role, relationship} attribution
    payload for a file-upload or message event. Looks up the delegate row so
    the UI can render "Uploaded by Sam Patel · Bookkeeper · 2 hours ago" for
    delegate uploads and "Uploaded by Dr Bala Chan · Client · 2 hours ago"
    for primary-client uploads."""
    out = {
        "id": user.get("id"),
        "name": user.get("name") or user.get("email") or "",
        "role": user.get("role"),
        "relationship": None,
    }
    if user.get("role") == "CLIENT":
        try:
            row = await delegates.get_delegate_for_engagement(user["id"], engagement_id)
            if row:
                out["relationship"] = row.get("relationship")
        except Exception as e:
            log.warning("attribution delegate-lookup failed: %s", e)
    return out


@api.post("/documents/{doc_id}/complete-upload")
async def doc_complete_upload(doc_id: str, body: DocumentCompleteUploadIn, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    now = datetime.now(timezone.utc)
    # Re-upload tracking — if the previous state was ISSUE (CPA flagged) the
    # next upload counts as a "re-upload" and we surface a badge in the CPA's
    # checklist so they immediately see the client has addressed the issue.
    was_flagged = doc.get("status") == "ISSUE"
    attribution = await _attribution_for_user(user, doc["engagement_id"])
    file_id = str(uuid.uuid4())
    file_row = {
        "id": file_id,
        "object_key": body.object_key,
        "storage": "s3",
        "file_name": body.file_name,
        "file_size": body.file_size,
        "mime_type": body.mime_type,
        "uploaded_at": now,
        "uploaded_by": attribution,
    }
    set_fields = {
        "status": "UPLOADED",
        "object_key": body.object_key,
        "file_name": body.file_name,
        "file_size": body.file_size,
        "mime_type": body.mime_type,
        "uploaded_at": now,
        "uploaded_by": attribution,
        "issue_note": None,
        "deferred_at": None,
    }
    if was_flagged:
        set_fields["was_reuploaded"] = True
        set_fields["prev_issue_note"] = doc.get("issue_note") or None
        set_fields["reuploaded_at"] = now
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": set_fields, "$push": {"files": file_row}},
    )
    # Notify CPA — distinguish a re-upload from a first-time upload so the
    # heads-up message in the bell is accurate.
    if eng.get("assigned_cpa_id"):
        if was_flagged:
            await notify(eng["assigned_cpa_id"], "Document re-uploaded", f"{doc['name']} re-uploaded after flagged issue", "document_reuploaded", eng["id"])
        else:
            await notify(eng["assigned_cpa_id"], "Document uploaded", f"{doc['name']} uploaded", "document_uploaded", eng["id"])
    # Auto-advance REFERRED -> INTAKE on first upload
    if eng["status"] == "REFERRED":
        await db.engagements.update_one({"id": eng["id"]}, {"$set": {"status": "INTAKE", "updated_at": now}})
        await log_status_change(eng["id"], user["id"], "REFERRED", "INTAKE", "First document uploaded")
    return {"ok": True, "was_reuploaded": was_flagged}


@api.delete("/documents/{doc_id}/upload")
async def doc_remove_upload(doc_id: str, user: dict = Depends(get_current_user)):
    """Remove an uploaded file (S3 or local) and reset the doc back to PENDING."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot remove documents")
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
    Each call APPENDS a new entry into doc.files[] so a single document item (e.g. 'Bank statements')
    can hold many uploaded files (e.g. 12 monthly statements). The legacy single-file fields on the
    document mirror the LATEST uploaded file for backward compatibility with older readers."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot upload documents")

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
        await alert_s3_access_denied_if_needed()

    now = datetime.now(timezone.utc)
    file_id = str(uuid.uuid4())
    attribution = await _attribution_for_user(user, doc["engagement_id"])
    new_file = {
        "id": file_id,
        "object_key": object_key,
        "storage": storage,
        "file_name": file.filename,
        "file_size": len(body),
        "mime_type": content_type,
        "uploaded_at": now,
        "uploaded_by": attribution,
    }
    await db.documents.update_one({"id": doc_id}, {
        "$push": {"files": new_file},
        "$set": {
            # Keep legacy single-file fields synced with the latest upload (back-compat)
            "status": "UPLOADED",
            "object_key": object_key,
            "storage": storage,
            "file_name": file.filename,
            "file_size": len(body),
            "mime_type": content_type,
            "uploaded_at": now,
            "uploaded_by": attribution,
            "issue_note": None,
            "deferred_at": None,
        },
    })
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Document uploaded", f"{doc['name']} uploaded", "document_uploaded", eng["id"])
    if eng["status"] == "REFERRED":
        await db.engagements.update_one({"id": eng["id"]}, {"$set": {"status": "INTAKE", "updated_at": now}})
        await log_status_change(eng["id"], user["id"], "REFERRED", "INTAKE", "First document uploaded")
    return {"ok": True, "file_id": file_id, "file_name": file.filename, "file_size": len(body), "storage": storage}


@api.delete("/documents/{doc_id}/files/{file_id}")
async def doc_delete_one_file(doc_id: str, file_id: str, user: dict = Depends(get_current_user)):
    """Remove a single file from a document's files[] array.
    If it was the last/only file, the document reverts to PENDING and legacy single-file fields are cleared."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eng = await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot delete documents")
    files = list(doc.get("files") or [])
    target = next((f for f in files if f.get("id") == file_id), None)
    if not target:
        raise HTTPException(404, "File not found")
    # Remove from object storage
    key = target.get("object_key") or ""
    if key.startswith("local://"):
        try:
            p = key[len("local://"):]
            if os.path.isfile(p):
                os.remove(p)
        except Exception:
            pass
    elif target.get("storage") == "s3":
        try:
            s3_service.delete_object(key)
        except Exception:
            pass
    remaining = [f for f in files if f.get("id") != file_id]
    if remaining:
        latest = max(remaining, key=lambda f: f.get("uploaded_at") or datetime.min.replace(tzinfo=timezone.utc))
        await db.documents.update_one({"id": doc_id}, {"$set": {
            "files": remaining,
            "object_key": latest.get("object_key"),
            "storage": latest.get("storage"),
            "file_name": latest.get("file_name"),
            "file_size": latest.get("file_size"),
            "mime_type": latest.get("mime_type"),
            "uploaded_at": latest.get("uploaded_at"),
            "status": "UPLOADED",
        }})
    else:
        await db.documents.update_one({"id": doc_id}, {
            "$set": {"files": [], "status": "PENDING"},
            "$unset": {"object_key": "", "storage": "", "file_name": "", "file_size": "", "mime_type": "", "uploaded_at": "", "extracted_data": ""},
        })
    if eng.get("assigned_cpa_id"):
        await notify(eng["assigned_cpa_id"], "Document removed", f"{doc['name']}: a file was removed by the client", "document_removed", eng["id"])
    return {"ok": True, "remaining": len(remaining)}


@api.get("/documents/{doc_id}/files/{file_id}/download")
async def doc_download_one_file(doc_id: str, file_id: str, user: dict = Depends(get_current_user)):
    """Download a specific file from a document's files[] array."""
    from fastapi.responses import FileResponse, RedirectResponse, Response
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    target = next((f for f in (doc.get("files") or []) if f.get("id") == file_id), None)
    if not target:
        raise HTTPException(404, "File not found")
    key = target.get("object_key") or ""
    if key.startswith("local://"):
        path = key[len("local://"):]
        if not os.path.isfile(path):
            raise HTTPException(404, "File missing on disk")
        return FileResponse(path, media_type=target.get("mime_type") or "application/octet-stream", filename=target.get("file_name"))
    url = s3_service.generate_download_url(key, target.get("file_name"))
    if not url:
        raise HTTPException(500, "Failed to generate download URL")
    return RedirectResponse(url=url, status_code=307)



@api.get("/documents/{doc_id}/download-url")
async def doc_download_url(doc_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    await get_engagement_or_404(doc["engagement_id"], user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot download documents")
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
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot download documents")
    key = doc.get("object_key") or ""
    if not key.startswith("local://"):
        raise HTTPException(404, "Not a local file")
    path = key[len("local://"):]
    if not os.path.isfile(path):
        raise HTTPException(404, "File missing on disk")
    from fastapi.responses import FileResponse
    return FileResponse(path, media_type=doc.get("mime_type") or "application/octet-stream", filename=doc.get("file_name") or "download")


def _safe_zip_path(corp_name: Optional[str], doc_name: str, file_name: str) -> str:
    """Build a ZIP-safe member path grouping each file under its document folder.

    Deduplicates illegal characters for Windows / macOS archive viewers.
    """
    import re as _re

    def sanitize(s: str) -> str:
        s = (s or "").strip().replace("/", "-").replace("\\", "-")
        s = _re.sub(r"[\x00-\x1f<>:\"|?*]", "", s)
        return s[:80] or "file"

    folder = sanitize(doc_name) or "Document"
    name = sanitize(file_name) or "file"
    return f"{folder}/{name}"


@api.get("/engagements/{eid}/documents/download-all")
async def download_all_documents(eid: str, user: dict = Depends(get_current_user)):
    """Bundle every uploaded client file for an engagement into a single ZIP.

    Only documents with at least one uploaded file are included; deferred /
    pending requests are skipped. Each file lands inside a folder named after
    its document request so the CPA's local archive stays organized.
    """
    import io
    import zipfile

    from fastapi.responses import StreamingResponse
    from datetime import datetime as _dt

    eng = await get_engagement_or_404(eid, user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Partners cannot download documents")

    db = get_db()
    corp = await db.corporations.find_one({"id": eng.get("corporation_id")}, {"_id": 0, "name": 1}) if eng.get("corporation_id") else None
    corp_name = (corp or {}).get("name") or "Client"

    docs = [d async for d in db.documents.find(
        {"engagement_id": eid}, {"_id": 0}
    ).sort("sort_order", 1)]

    # Collect every physical file: new multi-file docs use files[] array; older
    # single-file docs still have object_key at the top level.
    to_zip: list[tuple[str, str, Optional[str]]] = []  # (zip_path, object_key, mime_type)
    used_paths: set[str] = set()
    for d in docs:
        files = d.get("files") or []
        if not files and d.get("object_key"):
            files = [{
                "object_key": d["object_key"],
                "file_name": d.get("file_name") or "download",
                "mime_type": d.get("mime_type"),
            }]
        for f in files:
            key = f.get("object_key") or ""
            if not key:
                continue
            zip_path = _safe_zip_path(corp_name, d.get("name") or "Document", f.get("file_name") or "file")
            # Dedupe name collisions (same filename uploaded twice in one doc).
            base = zip_path
            n = 2
            while zip_path in used_paths:
                stem, _, ext = base.rpartition(".")
                if stem:
                    zip_path = f"{stem} ({n}).{ext}"
                else:
                    zip_path = f"{base} ({n})"
                n += 1
            used_paths.add(zip_path)
            to_zip.append((zip_path, key, f.get("mime_type")))

    if not to_zip:
        raise HTTPException(404, "No uploaded files to download")

    # Build the archive in-memory. This is acceptable for the current document
    # volume per engagement (dozens of files, tens of MBs at most). A streaming
    # rewrite can come later if/when we see >500MB archives.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for zip_path, key, _mime in to_zip:
            try:
                if key.startswith("local://"):
                    path = key[len("local://"):]
                    if not os.path.isfile(path):
                        continue
                    zf.write(path, arcname=zip_path)
                else:
                    # S3 object — reuse the sync helper; OK in a ZIP build path
                    # that is itself synchronous.
                    data = s3_service.get_object_bytes(key)
                    if data is None:
                        continue
                    zf.writestr(zip_path, data)
            except Exception as e:
                log.warning("download-all: skipped %s (%s)", key, e)
                continue

    buf.seek(0)
    stamp = _dt.now().strftime("%Y%m%d-%H%M")
    # Only keep ASCII-safe characters in the filename — HTTP header values
    # are latin-1 constrained so an em-dash or fancy unicode would 500 here.
    safe_corp = "".join(c for c in corp_name if (c.isascii() and (c.isalnum() or c in (" ", "-", "_")))).strip() or "client"
    filename = f"{safe_corp} - documents - {stamp}.zip"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
    # Clear the re-uploaded badge once the CPA has actively reviewed (REVIEWED
    # or EXTRACTED). If they re-flag (ISSUE), keep the prior re-upload context.
    unset = {}
    if updates.get("status") in ("REVIEWED", "EXTRACTED"):
        unset = {"was_reuploaded": "", "prev_issue_note": "", "reuploaded_at": ""}
    if updates or unset:
        op = {}
        if updates:
            op["$set"] = updates
        if unset:
            op["$unset"] = unset
        await db.documents.update_one({"id": doc_id}, op)
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
    if user["role"] == "PARTNER":
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


@api.post("/documents/{doc_id}/remind")
async def remind_single_document(doc_id: str, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """Send a one-off reminder email + in-app notification to the client about a
    specific pending document. Reuses the same SES helper as the bulk reminder.
    Cooldown is 6 hours per document so CPAs can't accidentally spam.
    """
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(404, "Document not found")
    eid = doc["engagement_id"]
    eng = await get_engagement_or_404(eid, user)
    last = doc.get("reminder_sent_at")
    if last:
        last_dt = last if isinstance(last, datetime) else datetime.fromisoformat(str(last))
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        next_ok = last_dt + timedelta(hours=6)
        if datetime.now(timezone.utc) < next_ok:
            raise HTTPException(429, f"A reminder for this document was already sent recently. Try again after {next_ok.isoformat()}")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if not corp:
        raise HTTPException(500, "Corporation missing")
    client = await db.users.find_one({"id": corp["client_id"]})
    if not client:
        raise HTTPException(500, "Client missing")
    portal_link = f"{FRONTEND_URL}/portal"
    result = ses_service.send_deferred_reminder(client["email"], client["name"], [doc["name"]], portal_link)
    now = datetime.now(timezone.utc)
    await db.documents.update_one(
        {"id": doc_id},
        {"$set": {"reminder_sent_at": now}, "$inc": {"reminder_count": 1}},
    )
    await notify(client["id"], "Friendly reminder", f"\"{doc['name']}\" is still pending upload", "doc_reminder", eid)
    return {"ok": True, "sent_at": now, "email_sent": result.get("success", False)}


@api.get("/engagements/{eid}/history")
async def engagement_history(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    if user["role"] in ("CLIENT", "PARTNER"):
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
    has_error = isinstance(result, dict) and ("error" in result or "parse_error" in result)
    update = {"extracted_data": result}
    if not has_error:
        # Only flip status to EXTRACTED on a clean parse so the UI accurately
        # reflects whether the data was actually pulled.
        update["status"] = "EXTRACTED"
    await db.documents.update_one({"id": doc_id}, {"$set": update})
    # Store extracted data records (flatten top-level)
    if isinstance(result, dict) and not has_error:
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
    if user["role"] == "PARTNER":
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
    if user["role"] == "PARTNER":
        q["shared_with_ws"] = True
    rows = [r async for r in db.opportunities.find(q, {"_id": 0}).sort("created_at", -1)]
    return rows


@api.get("/opportunities/shared")
async def shared_opps(user: dict = Depends(require_role("PARTNER", "ADMIN"))):
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
        if eng and eng.get("partner_advisor_id"):
            corp = await db.corporations.find_one({"id": eng["corporation_id"]})
            user_row = await db.users.find_one({"id": eng["partner_advisor_id"]}, {"_id": 0, "password_hash": 0})
            if user_row:
                await notify(user_row["id"], "Advisory opportunity", opp["title"], "opportunity_shared", eng["id"])
                ses_service.send_opportunity(user_row["email"], corp["name"] if corp else "client", opp["title"], f"{FRONTEND_URL}/partner/dashboard")
    if "ws_followed_up" in updates and user["role"] not in ("PARTNER", "ADMIN"):
        raise HTTPException(403, "Only Partner can mark followed up")
    await db.opportunities.update_one({"id": oid}, {"$set": updates})
    return await db.opportunities.find_one({"id": oid}, {"_id": 0})


# ==================== Time entries ====================

@api.get("/engagements/{eid}/time-entries")
async def list_time(eid: str, user: dict = Depends(get_current_user)):
    await get_engagement_or_404(eid, user)
    if user["role"] in ("CLIENT", "PARTNER"):
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
    if user["role"] in ("CLIENT", "PARTNER"):
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
async def get_checklist_template(user: dict = Depends(require_role("PARTNER", "ADMIN"))):
    db = get_db()
    doc = await db.settings.find_one({"key": "checklist_template"}, {"_id": 0})
    if not doc:
        return {"items": DEFAULT_CHECKLIST_TEMPLATE}
    return {"items": doc.get("items", DEFAULT_CHECKLIST_TEMPLATE)}


@api.put("/partner/checklist-template")
async def update_checklist_template(body: ChecklistTemplateIn, user: dict = Depends(require_role("ADMIN"))):
    db = get_db()
    items = [{"label": str(it.get("label", "")).strip(), "optional": bool(it.get("optional", False))} for it in body.items if str(it.get("label", "")).strip()]
    if not items:
        raise HTTPException(400, "Template must have at least one item")
    await db.settings.update_one(
        {"key": "checklist_template"},
        {"$set": {"items": items, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Global propagation — the user expects "Changes apply to all clients".
    # Walk every engagement and rebuild its ``pre_filing_checklist`` from the
    # new template, preserving ``is_completed`` for any item whose label
    # still exists (so CPAs/partners don't lose in-flight progress). New
    # items start unchecked; deleted items are dropped outright.
    updated = 0
    async for eng in db.engagements.find({}, {"_id": 0, "id": 1, "pre_filing_checklist": 1}):
        prev = {c.get("item"): bool(c.get("is_completed")) for c in (eng.get("pre_filing_checklist") or [])}
        rebuilt = [{
            "id": str(uuid.uuid4()),
            "item": it["label"],
            "is_completed": prev.get(it["label"], False),
            "sort_order": i,
        } for i, it in enumerate(items)]
        await db.engagements.update_one(
            {"id": eng["id"]},
            {"$set": {"pre_filing_checklist": rebuilt, "updated_at": datetime.now(timezone.utc)}},
        )
        updated += 1
    log.info("Partner checklist template saved; propagated to %d engagements", updated)
    return {"items": items, "propagated_to": updated}


# ==================== CPA-managed global REVIEW checklist template ====================
# This mirrors the partner pre-filing template but drives the CPA-only review
# checklist that lives in the ``db.checklist`` collection (one row per item
# per engagement). Same UX contract: save → propagate across engagements,
# preserve per-item completion state on rename-free edits, remove dropped
# items, add new ones unchecked.

DEFAULT_REVIEW_CHECKLIST_TEMPLATE = [
    {"label": "T2 return complete", "optional": False},
    {"label": "Financial statements (NTR) prepared", "optional": False},
    {"label": "T4/T5 slips generated", "optional": False},
    {"label": "CDA schedule verified against prior year NOA", "optional": False},
    {"label": "SBD calculation with passive income check", "optional": False},
    {"label": "Prior year cross-check", "optional": False},
    {"label": "QA sign-off", "optional": False},
    {"label": "Investment reconciliation complete", "optional": True},
    {"label": "ACB tracking verified", "optional": True},
    {"label": "Passive income threshold assessed", "optional": True},
    {"label": "Compensation summary prepared", "optional": True},
]


@api.get("/cpa/review-checklist-template")
async def get_review_checklist_template(user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    doc = await db.settings.find_one({"key": "review_checklist_template"}, {"_id": 0})
    if not doc:
        return {"items": DEFAULT_REVIEW_CHECKLIST_TEMPLATE}
    return {"items": doc.get("items", DEFAULT_REVIEW_CHECKLIST_TEMPLATE)}


@api.put("/cpa/review-checklist-template")
async def update_review_checklist_template(body: ChecklistTemplateIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    db = get_db()
    items = [{"label": str(it.get("label", "")).strip(), "optional": bool(it.get("optional", False))} for it in body.items if str(it.get("label", "")).strip()]
    if not items:
        raise HTTPException(400, "Template must have at least one item")
    await db.settings.update_one(
        {"key": "review_checklist_template"},
        {"$set": {"items": items, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    # Global propagation to the per-engagement ``checklist`` collection.
    eng_ids = [e["id"] async for e in db.engagements.find({}, {"_id": 0, "id": 1})]
    updated = 0
    for eid in eng_ids:
        existing = {r["item"]: r async for r in db.checklist.find({"engagement_id": eid}, {"_id": 0})}
        # Drop rows that are no longer in the template.
        labels = {it["label"] for it in items}
        to_delete = [r["id"] for label, r in existing.items() if label not in labels]
        if to_delete:
            await db.checklist.delete_many({"id": {"$in": to_delete}})
        # Upsert each item by label so completion state is preserved on
        # non-label changes (e.g. sort_order reshuffles or optional flag).
        for i, it in enumerate(items):
            prev = existing.get(it["label"])
            if prev:
                await db.checklist.update_one(
                    {"id": prev["id"]},
                    {"$set": {"item": it["label"], "sort_order": i}},
                )
            else:
                await db.checklist.insert_one({
                    "id": str(uuid.uuid4()),
                    "engagement_id": eid,
                    "item": it["label"],
                    "sort_order": i,
                    "is_completed": False,
                    "completed_at": None,
                    "completed_by_id": None,
                })
        updated += 1
    log.info("CPA review checklist template saved; propagated to %d engagements", updated)
    return {"items": items, "propagated_to": updated}


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


# ==================== Client review decision (Tax Summary) ====================

class ReviewDecisionIn(BaseModel):
    decision: str  # 'approved' | 'issue'
    issue_note: Optional[str] = None


@api.post("/engagements/{eid}/review-decision")
async def submit_review_decision(eid: str, body: ReviewDecisionIn, user: dict = Depends(get_current_user)):
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] != "CLIENT":
        raise HTTPException(403, "Only the client can submit a review decision")
    if body.decision not in ("approved", "issue"):
        raise HTTPException(400, "decision must be 'approved' or 'issue'")
    if body.decision == "issue" and not (body.issue_note or "").strip():
        raise HTTPException(400, "issue_note required when decision is 'issue'")
    now = datetime.now(timezone.utc)
    issue_note = (body.issue_note or "").strip() if body.decision == "issue" else None
    decision_doc = {
        "decision": body.decision,
        "issue_note": issue_note,
        "submitted_at": now,
    }
    history_entry = {
        "type": "review",
        "at": now,
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "decision": body.decision,
        "note": issue_note,
    }
    await db.engagements.update_one({"id": eid}, {
        "$set": {"review_decision": decision_doc, "updated_at": now},
        "$push": {"draft_history": history_entry},
    })
    if eng.get("assigned_cpa_id"):
        if body.decision == "approved":
            await notify(eng["assigned_cpa_id"], "Client approved the return", "Filing can begin.", "client_approved", eid)
        else:
            await notify(eng["assigned_cpa_id"], "Client flagged an issue", body.issue_note[:120], "client_issue", eid)
    return {"ok": True, "review_decision": decision_doc}


# ==================== CPA: Upload draft + Move to Review ====================

class MoveToReviewIn(BaseModel):
    instructions: Optional[str] = None


@api.post("/engagements/{eid}/upload-draft")
async def upload_draft_pdf(eid: str, file: UploadFile = File(...), instructions: Optional[str] = None, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """CPA uploads the T2 draft PDF. Stored as a normal document with category=T2_DRAFT.
    Stays in IN_PREP — moving to IN_REVIEW is a separate explicit action."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if eng["status"] not in ("IN_PREP", "IN_REVIEW"):
        raise HTTPException(400, "Draft can only be uploaded during IN_PREP or IN_REVIEW")

    body = await file.read()
    if not body:
        raise HTTPException(400, "Empty file")
    if len(body) > 50 * 1024 * 1024:
        raise HTTPException(413, "File exceeds 50 MB limit")

    safe_name = "".join(c for c in (file.filename or "draft.pdf") if c.isalnum() or c in "._-")[:80] or "draft.pdf"
    object_key = f"engagements/{eid}/draft/{uuid.uuid4().hex}_{safe_name}"
    content_type = file.content_type or "application/pdf"

    storage = "s3"
    if not s3_service.put_object_bytes(object_key, body, content_type):
        storage = "local"
        local_dir = os.path.join(os.path.dirname(__file__), "uploads", eid, "draft")
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, f"{uuid.uuid4().hex}_{safe_name}")
        with open(local_path, "wb") as f:
            f.write(body)
        object_key = f"local://{local_path}"
        await alert_s3_access_denied_if_needed()

    # Find or create the T2_DRAFT document for this engagement
    now = datetime.now(timezone.utc)
    draft_doc = await db.documents.find_one({"engagement_id": eid, "category": "T2_DRAFT"})
    if draft_doc:
        # Replace prior draft (delete previous bytes if local)
        prev = draft_doc.get("object_key") or ""
        if prev.startswith("local://"):
            try:
                p = prev[len("local://"):]
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass
        await db.documents.update_one({"id": draft_doc["id"]}, {"$set": {
            "status": "UPLOADED",
            "object_key": object_key, "storage": storage,
            "file_name": file.filename, "file_size": len(body), "mime_type": content_type,
            "uploaded_at": now,
        }})
        draft_id = draft_doc["id"]
    else:
        draft_id = str(uuid.uuid4())
        await db.documents.insert_one({
            "id": draft_id, "engagement_id": eid,
            "category": "T2_DRAFT", "name": "T2 Draft Return",
            "description": "CPA-prepared draft return for client review",
            "is_required": False, "sort_order": 9999,
            "status": "UPLOADED", "object_key": object_key, "storage": storage,
            "file_name": file.filename, "file_size": len(body), "mime_type": content_type,
            "uploaded_at": now, "created_at": now,
        })

    eng_set = {"t2_draft_doc_id": draft_id, "updated_at": now}
    if instructions is not None:
        eng_set["review_instructions"] = instructions.strip()
    # Reset client review decision so a fresh prompt is shown for the new draft
    eng_unset = {"review_decision": ""}
    # Auto-advance IN_PREP -> IN_REVIEW so the client immediately sees the new draft
    moved_to_review = False
    if eng.get("status") == "IN_PREP":
        eng_set["status"] = "IN_REVIEW"
        moved_to_review = True
    history_entry = {
        "type": "upload",
        "at": now,
        "actor_id": user["id"],
        "actor_name": user.get("name") or user.get("email"),
        "file_name": file.filename,
        "instructions": (instructions.strip() if instructions else None),
    }
    await db.engagements.update_one({"id": eid}, {
        "$set": eng_set,
        "$unset": eng_unset,
        "$push": {"draft_history": history_entry},
    })

    if moved_to_review:
        await log_status_change(eid, user["id"], "IN_PREP", "IN_REVIEW", "Draft uploaded; ready for client review")

    # Notify the client about the (re)uploaded draft
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if corp:
        title = "Your draft return is ready for review" if moved_to_review else "Your CPA uploaded an updated draft"
        msg = "Please review and confirm in your portal."
        await notify(corp["client_id"], title, msg, "draft_ready", eid)

    return {"ok": True, "doc_id": draft_id, "file_name": file.filename, "storage": storage, "moved_to_review": moved_to_review}


@api.delete("/engagements/{eid}/draft")
async def delete_draft_pdf(eid: str, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """Remove the current T2 draft document. Reverts IN_REVIEW back to IN_PREP."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    draft_doc = await db.documents.find_one({"engagement_id": eid, "category": "T2_DRAFT"})
    if not draft_doc:
        raise HTTPException(404, "No draft to remove")
    # Delete bytes if local
    obj = draft_doc.get("object_key") or ""
    if obj.startswith("local://"):
        try:
            p = obj[len("local://"):]
            if os.path.isfile(p):
                os.remove(p)
        except Exception:
            pass
    await db.documents.delete_one({"id": draft_doc["id"]})
    now = datetime.now(timezone.utc)
    eng_set = {"updated_at": now}
    eng_unset = {"t2_draft_doc_id": "", "review_decision": ""}
    moved_back = False
    if eng.get("status") == "IN_REVIEW":
        eng_set["status"] = "IN_PREP"
        moved_back = True
    await db.engagements.update_one({"id": eid}, {"$set": eng_set, "$unset": eng_unset})
    if moved_back:
        await log_status_change(eid, user["id"], "IN_REVIEW", "IN_PREP", "Draft removed by CPA")
    return {"ok": True, "moved_back_to_prep": moved_back}


# ==================== File with CRA + T183 Signature ====================

T183_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "templates", "t183-25e.pdf")
T183_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads", "t183")


def _t183_storage_load(object_key: str) -> bytes:
    """Read PDF bytes from local-disk fallback or S3."""
    if not object_key:
        raise FileNotFoundError("missing object key")
    if object_key.startswith("local://"):
        path = object_key[len("local://"):]
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        with open(path, "rb") as f:
            return f.read()
    # S3 path
    body = s3_service.get_object_bytes(object_key) if hasattr(s3_service, "get_object_bytes") else None
    if body is None:
        raise FileNotFoundError(object_key)
    return body


def _t183_storage_save(eid: str, kind: str, body: bytes, filename: str) -> tuple[str, str]:
    """Persist PDF bytes. Returns (object_key, storage)."""
    safe_name = "".join(c for c in (filename or f"{kind}.pdf") if c.isalnum() or c in "._-")[:80] or f"{kind}.pdf"
    object_key = f"engagements/{eid}/t183/{kind}_{uuid.uuid4().hex}_{safe_name}"
    if s3_service.put_object_bytes(object_key, body, "application/pdf"):
        return object_key, "s3"
    # Local fallback
    local_dir = os.path.join(T183_UPLOAD_DIR, eid)
    os.makedirs(local_dir, exist_ok=True)
    local_path = os.path.join(local_dir, f"{kind}_{uuid.uuid4().hex}_{safe_name}")
    with open(local_path, "wb") as f:
        f.write(body)
    return f"local://{local_path}", "local"


def _stamp_signature_on_pdf(pdf_bytes: bytes, signature_data_url: str, position: dict) -> bytes:
    """Use PyMuPDF to overlay the client's signature image onto the PDF at the
    saved percentage coordinates. Returns the new PDF bytes.

    `position` shape: {page: int (0-indexed), x_pct, y_pct, w_pct, h_pct} — all as
    fractions of the page's media-box dimensions. Origin is top-left of the page."""
    import fitz  # PyMuPDF
    import base64 as _b64
    if "," in signature_data_url:
        sig_b64 = signature_data_url.split(",", 1)[1]
    else:
        sig_b64 = signature_data_url
    sig_png = _b64.b64decode(sig_b64)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_idx = max(0, min(int(position.get("page", 0)), doc.page_count - 1))
        page = doc[page_idx]
        rect = page.rect
        x = float(position.get("x_pct", 0)) * rect.width
        y = float(position.get("y_pct", 0)) * rect.height
        w = float(position.get("w_pct", 0.25)) * rect.width
        h = float(position.get("h_pct", 0.06)) * rect.height
        sig_rect = fitz.Rect(x, y, x + w, y + h)
        page.insert_image(sig_rect, stream=sig_png, keep_proportion=True, overlay=True)
        out = io.BytesIO()
        doc.save(out, garbage=4, deflate=True, clean=True)
        return out.getvalue()
    finally:
        doc.close()


@api.post("/engagements/{eid}/t183/upload")
async def upload_t183_pdf(eid: str, file: UploadFile = File(...), user: dict = Depends(require_role("CPA", "ADMIN"))):
    """CPA uploads the pre-filled T183 PDF (status → 'draft'). Existing signed/sent
    state is reset because a new upload starts a fresh signing cycle."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    body = await file.read()
    if not body:
        raise HTTPException(400, "Empty file")
    if len(body) > 25 * 1024 * 1024:
        raise HTTPException(413, "T183 PDF must be ≤ 25 MB")
    if not (file.content_type == "application/pdf" or (file.filename or "").lower().endswith(".pdf")):
        raise HTTPException(400, "T183 must be a PDF")

    # Best-effort cleanup of previous original/signed if they were stored locally
    for key in (eng.get("t183_original_object_key"), eng.get("t183_signed_object_key")):
        if isinstance(key, str) and key.startswith("local://"):
            try:
                p = key[len("local://"):]
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass

    object_key, storage = _t183_storage_save(eid, "original", body, file.filename or "t183.pdf")
    now = datetime.now(timezone.utc)
    await db.engagements.update_one({"id": eid}, {
        "$set": {
            "t183_status": "draft",
            "t183_original_object_key": object_key,
            "t183_original_storage": storage,
            "t183_original_file_name": file.filename or "t183.pdf",
            "t183_uploaded_at": now,
            "t183_uploaded_by": user["id"],
            "updated_at": now,
        },
        "$unset": {
            "t183_signature_position": "",
            "t183_sent_at": "",
            "t183_signature": "",
            "t183_signed_at": "",
            "t183_signed_name": "",
            "t183_signed_object_key": "",
            "t183_signed_storage": "",
        },
    })
    return {"ok": True, "status": "draft", "file_name": file.filename, "storage": storage}


class T183PositionIn(BaseModel):
    page: int = 0
    x_pct: float
    y_pct: float
    w_pct: float = 0.25
    h_pct: float = 0.06


@api.post("/engagements/{eid}/t183/position")
async def set_t183_position(eid: str, body: T183PositionIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """CPA places the signature placeholder. Saved as page-relative percentages so
    the position survives any zoom/render scale on either side."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if not eng.get("t183_original_object_key"):
        raise HTTPException(400, "Upload a T183 PDF first")
    for v, name in ((body.x_pct, "x_pct"), (body.y_pct, "y_pct"), (body.w_pct, "w_pct"), (body.h_pct, "h_pct")):
        if v < 0 or v > 1:
            raise HTTPException(400, f"{name} must be in [0,1]")
    pos = {"page": int(body.page), "x_pct": body.x_pct, "y_pct": body.y_pct, "w_pct": body.w_pct, "h_pct": body.h_pct}
    await db.engagements.update_one({"id": eid}, {"$set": {
        "t183_signature_position": pos,
        "updated_at": datetime.now(timezone.utc),
    }})
    return {"ok": True, "position": pos}


@api.post("/engagements/{eid}/t183/send")
async def send_t183_to_client(eid: str, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """CPA marks the T183 as ready for signing → notifies client."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if not eng.get("t183_original_object_key"):
        raise HTTPException(400, "Upload a T183 PDF first")
    if not eng.get("t183_signature_position"):
        raise HTTPException(400, "Place the signature placeholder before sending")
    now = datetime.now(timezone.utc)
    await db.engagements.update_one({"id": eid}, {"$set": {
        "t183_status": "sent",
        "t183_sent_at": now,
        "t183_sent_by": user["id"],
        "updated_at": now,
    }})
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if corp:
        await notify(
            corp["client_id"],
            "Your T183 is ready for signature",
            "Your CPA has prepared your T183 — sign it to authorize CRA filing.",
            "t183_ready",
            eid,
        )
    return {"ok": True, "status": "sent", "sent_at": now.isoformat()}


@api.get("/engagements/{eid}/t183")
async def get_t183(eid: str, user: dict = Depends(get_current_user)):
    """Returns full T183 metadata + signature placement so the client can render
    the placeholder at the exact position the CPA chose."""
    from fastapi.responses import JSONResponse
    eng = await get_engagement_or_404(eid, user)

    # Backward compatibility: if there's no new flow but legacy signature exists,
    # report 'signed' so older engagements (Thompson/Ahmed) keep their UX.
    has_new = bool(eng.get("t183_original_object_key"))
    legacy_signed = (not has_new) and bool(eng.get("t183_signed_at"))
    status = eng.get("t183_status") or ("signed" if legacy_signed else None)
    meta = {
        "status": status,                                  # null | draft | sent | signed
        "signed": status == "signed",                      # back-compat boolean for older callers
        "has_original": has_new,
        "has_signed_pdf": bool(eng.get("t183_signed_object_key")),
        "original_file_name": eng.get("t183_original_file_name"),
        "uploaded_at": eng.get("t183_uploaded_at").isoformat() if eng.get("t183_uploaded_at") else None,
        "sent_at": eng.get("t183_sent_at").isoformat() if eng.get("t183_sent_at") else None,
        "signed_at": eng.get("t183_signed_at").isoformat() if eng.get("t183_signed_at") else None,
        "signed_name": eng.get("t183_signed_name"),
        "signature_position": eng.get("t183_signature_position"),
        "legacy_signature_image": eng.get("t183_signature") if legacy_signed else None,
    }
    return JSONResponse(meta)


@api.get("/engagements/{eid}/t183/file")
async def get_t183_file(eid: str, variant: str = "auto", user: dict = Depends(get_current_user)):
    """Streams the requested T183 PDF.

    `variant`:
      - `original` → CPA-uploaded unsigned PDF
      - `signed`   → final signed PDF (after merge)
      - `auto`     → signed if available else original; falls back to bundled CRA template
                     for legacy engagements without an upload.
    """
    from fastapi.responses import FileResponse, RedirectResponse, Response
    eng = await get_engagement_or_404(eid, user)

    chosen_key = None
    chosen_filename = "T183CORP.pdf"
    if variant == "signed":
        chosen_key = eng.get("t183_signed_object_key")
        chosen_filename = "T183-signed.pdf"
    elif variant == "original":
        chosen_key = eng.get("t183_original_object_key")
        chosen_filename = eng.get("t183_original_file_name") or "T183-original.pdf"
    else:  # auto
        chosen_key = eng.get("t183_signed_object_key") or eng.get("t183_original_object_key")
        chosen_filename = (
            "T183-signed.pdf" if eng.get("t183_signed_object_key")
            else (eng.get("t183_original_file_name") or "T183.pdf")
        )

    if not chosen_key:
        # Legacy fallback: bundled CRA template
        if not os.path.isfile(T183_TEMPLATE_PATH):
            raise HTTPException(404, "T183 not available")
        return FileResponse(T183_TEMPLATE_PATH, media_type="application/pdf", filename="T183CORP.pdf")

    if chosen_key.startswith("local://"):
        path = chosen_key[len("local://"):]
        if not os.path.isfile(path):
            raise HTTPException(404, "T183 file missing on disk")
        return FileResponse(path, media_type="application/pdf", filename=chosen_filename)
    # S3
    url = s3_service.generate_download_url(chosen_key, chosen_filename)
    if not url:
        raise HTTPException(500, "Failed to generate download URL")
    return RedirectResponse(url=url, status_code=307)


class T183SignIn(BaseModel):
    signature: str  # data URL (image/png base64) of the canvas drawing
    signer_name: str


@api.post("/engagements/{eid}/t183/sign")
async def sign_t183(eid: str, body: T183SignIn, user: dict = Depends(get_current_user)):
    """Client signs the T183. Merges the signature image into the PDF at the saved
    coordinates and stores the resulting signed PDF. Status → 'signed'."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if user["role"] != "CLIENT":
        raise HTTPException(403, "Only the client can sign the T183")
    # Delegates have read access to the engagement but the T183 must be signed
    # by the primary client (the physician) personally — Canada Revenue Agency
    # legal authority to file rests with the taxpayer of record.
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if not corp or corp.get("client_id") != user["id"]:
        primary = await db.users.find_one({"id": (corp or {}).get("client_id")}, {"_id": 0, "name": 1, "first_name": 1, "last_name": 1})
        nm = (primary or {}).get("first_name") or (primary or {}).get("name") or "the primary client"
        raise HTTPException(403, f"Only {nm} can sign this document")
    if not body.signature or "data:image/" not in body.signature:
        raise HTTPException(400, "signature must be a base64 image data URL")
    if not body.signer_name.strip():
        raise HTTPException(400, "signer_name is required")

    original_key = eng.get("t183_original_object_key")
    position = eng.get("t183_signature_position")
    now = datetime.now(timezone.utc)

    signed_object_key = None
    signed_storage = None

    if original_key and position:
        # Modern flow: actually merge the signature into the PDF
        try:
            original_bytes = _t183_storage_load(original_key)
            signed_bytes = _stamp_signature_on_pdf(original_bytes, body.signature, position)
            base = (eng.get("t183_original_file_name") or "T183.pdf").rsplit(".", 1)[0]
            signed_object_key, signed_storage = _t183_storage_save(eid, "signed", signed_bytes, f"{base}-signed.pdf")
        except Exception as exc:  # noqa: BLE001
            log.exception("T183 stamping failed for %s", eid)
            raise HTTPException(500, f"Failed to stamp signature on PDF: {exc}") from exc
    # Legacy / incomplete flow: still record signature even if we can't stamp.
    update = {
        "t183_status": "signed",
        "t183_signature": body.signature,
        "t183_signed_name": body.signer_name.strip(),
        "t183_signed_at": now,
        "updated_at": now,
    }
    if signed_object_key:
        update["t183_signed_object_key"] = signed_object_key
        update["t183_signed_storage"] = signed_storage
    await db.engagements.update_one({"id": eid}, {"$set": update})

    if eng.get("assigned_cpa_id"):
        await notify(
            eng["assigned_cpa_id"],
            "Client signed T183",
            f"{body.signer_name.strip()} signed the T183 form.",
            "t183_signed",
            eid,
        )
    return {"ok": True, "signed_at": now.isoformat(), "signed_name": body.signer_name.strip(), "has_signed_pdf": bool(signed_object_key)}


@api.post("/engagements/{eid}/file-with-cra")
async def file_with_cra(
    eid: str,
    cra_confirmation: str,
    filing_datetime: str,
    note: Optional[str] = None,
    filing_summary: Optional[str] = None,
    files: List[UploadFile] = File(...),
    user: dict = Depends(require_role("CPA", "ADMIN")),
):
    """CPA submits the filed return to CRA: one or more PDF copies + CRA confirmation # + filing datetime + optional note.
    The first file becomes the primary `Filed T2 Return`; any additional files
    are stored as `Filed return attachment` documents and listed alongside it
    on the client/CPA Filed dashboards. Sets engagement status = FILED."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if eng["status"] not in ("IN_REVIEW", "DELIVERY"):
        raise HTTPException(400, f"Cannot file from status {eng['status']}")
    # Note: client approval is NOT a hard precondition — CPA may file as soon as the client has signed T183.
    # T183 is the legal authorization required by CRA.
    if not eng.get("t183_signed_at"):
        raise HTTPException(400, "Client must sign the T183 authorization before the return can be filed")
    # Mandatory client approval gate — the CPA cannot file until the client has
    # explicitly approved the draft (Your Review → "Everything looks good").
    # If the client has flagged an issue ("I found an issue"), the gate stays
    # closed even if the T183 was signed earlier; the CPA must address the
    # issue and re-send a draft, which clears the review_decision.
    review_decision = (eng.get("review_decision") or {}).get("decision")
    if review_decision != "approved":
        if review_decision == "issue":
            raise HTTPException(400, "Client flagged an issue with the draft. Address the issue and re-send the draft for client review before filing.")
        raise HTTPException(400, "Client must approve the draft (Your Review → Everything looks good) before the return can be filed")
    if not cra_confirmation.strip():
        raise HTTPException(400, "CRA confirmation number is required")
    if not files:
        raise HTTPException(400, "At least one PDF copy of the filed return is required")

    try:
        filing_dt = datetime.fromisoformat(filing_datetime.replace("Z", "+00:00"))
        if filing_dt.tzinfo is None:
            filing_dt = filing_dt.replace(tzinfo=timezone.utc)
    except Exception:
        raise HTTPException(400, "filing_datetime must be a valid ISO datetime")

    # Read + persist every uploaded file. The first one becomes the primary
    # "Filed T2 Return"; the rest are saved as attachments.
    persisted_docs: list[dict] = []
    for idx, up in enumerate(files):
        body = await up.read()
        if not body:
            raise HTTPException(400, f"Empty file: {up.filename or 'untitled'}")
        if len(body) > 50 * 1024 * 1024:
            raise HTTPException(413, f"File '{up.filename or 'untitled'}' exceeds 50 MB limit")
        safe_name = "".join(c for c in (up.filename or f"filed-{idx}.pdf") if c.isalnum() or c in "._-")[:80] or f"filed-{idx}.pdf"
        object_key = f"engagements/{eid}/filed/{uuid.uuid4().hex}_{safe_name}"
        content_type = up.content_type or "application/pdf"
        storage = "s3"
        if not s3_service.put_object_bytes(object_key, body, content_type):
            storage = "local"
            local_dir = os.path.join(os.path.dirname(__file__), "uploads", eid, "filed")
            os.makedirs(local_dir, exist_ok=True)
            local_path = os.path.join(local_dir, f"{uuid.uuid4().hex}_{safe_name}")
            with open(local_path, "wb") as f:
                f.write(body)
            object_key = f"local://{local_path}"
            await alert_s3_access_denied_if_needed()
        persisted_docs.append({
            "object_key": object_key,
            "storage": storage,
            "filename": up.filename,
            "size": len(body),
            "content_type": content_type,
            "is_primary": idx == 0,
        })

    now = datetime.now(timezone.utc)
    primary_doc_id: Optional[str] = None
    attachment_doc_ids: list[str] = []
    for idx, p in enumerate(persisted_docs):
        doc_id = str(uuid.uuid4())
        await db.documents.insert_one({
            "id": doc_id, "engagement_id": eid,
            "category": "FILED_RETURN" if p["is_primary"] else "FILED_RETURN_ATTACHMENT",
            "name": "Filed T2 Return" if p["is_primary"] else f"Filed return attachment {idx}",
            "description": "Final T2 return submitted to CRA" if p["is_primary"] else "Supporting document filed alongside the T2",
            "is_required": False, "sort_order": 9998 + idx,
            "status": "UPLOADED", "object_key": p["object_key"], "storage": p["storage"],
            "file_name": p["filename"], "file_size": p["size"], "mime_type": p["content_type"],
            "uploaded_at": now, "created_at": now,
        })
        if p["is_primary"]:
            primary_doc_id = doc_id
        else:
            attachment_doc_ids.append(doc_id)

    eng_set = {
        "status": "FILED",
        "filing_date": filing_dt,
        "filing_confirmation": cra_confirmation.strip(),
        "filed_return_doc_id": primary_doc_id,
        "filed_attachment_doc_ids": attachment_doc_ids,
        "filing_note": (note or "").strip() or None,
        "filed_by_id": user["id"],
        "filed_by_name": user.get("name") or user.get("email"),
        "updated_at": now,
    }
    # Strict validation: filing_summary is mandatory before transitioning to FILED.
    # The CPA's "Update submission info" form must be complete; this prevents
    # accidental filings without the financial summary clients see post-filing.
    if not filing_summary:
        raise HTTPException(400, "Filing summary is required. Please complete the 'Update submission info' form before filing.")
    try:
        import json as _json
        parsed = _json.loads(filing_summary) if isinstance(filing_summary, str) else filing_summary
    except Exception:
        raise HTTPException(400, "filing_summary must be valid JSON")
    if not isinstance(parsed, dict):
        raise HTTPException(400, "filing_summary must be a JSON object")
    allowed = {"net_income", "total_tax_assessed", "instalments_paid", "balance_owing", "payment_due_date"}
    required = {"net_income", "total_tax_assessed", "instalments_paid", "balance_owing"}
    cleaned: dict = {}
    for k in allowed:
        v = parsed.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        cleaned[k] = v
    missing = [k for k in required if k not in cleaned]
    if missing:
        raise HTTPException(
            400,
            f"Filing summary is incomplete. Required fields missing: {', '.join(missing)}",
        )
    eng_set["filing_summary"] = cleaned
    await db.engagements.update_one({"id": eid}, {"$set": eng_set})
    await log_status_change(eid, user["id"], eng["status"], "FILED", f"Filed with CRA — confirmation {cra_confirmation.strip()}")

    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if corp:
        await notify(corp["client_id"], "Your T2 return has been filed", f"CRA confirmation {cra_confirmation.strip()}", "filed", eid)
    if eng.get("partner_advisor_id"):
        await notify(eng["partner_advisor_id"], "Filing complete", f"{(corp or {}).get('name') or eid[:8]} T2 filed with CRA", "filing_complete", eid)
    await notify_admins("T2 filed with CRA", f"{(corp or {}).get('name') or eid[:8]} has been filed.", "filing_complete_admin", eid)
    return {
        "ok": True,
        "filed_return_doc_id": primary_doc_id,
        "filed_attachment_doc_ids": attachment_doc_ids,
        "filing_confirmation": cra_confirmation.strip(),
        "files_count": len(persisted_docs),
    }


@api.post("/engagements/{eid}/move-to-review")
async def move_to_review(eid: str, body: MoveToReviewIn, user: dict = Depends(require_role("CPA", "ADMIN"))):
    """Advance IN_PREP -> IN_REVIEW. Requires a T2 draft to be uploaded first."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    if eng["status"] != "IN_PREP":
        raise HTTPException(400, f"Cannot move to Review from {eng['status']}")
    if not eng.get("t2_draft_doc_id"):
        raise HTTPException(400, "Upload a T2 draft PDF before moving to Review")
    now = datetime.now(timezone.utc)
    eng_set = {"status": "IN_REVIEW", "updated_at": now}
    if body.instructions is not None:
        eng_set["review_instructions"] = body.instructions.strip()
    await db.engagements.update_one({"id": eid}, {"$set": eng_set})
    await log_status_change(eid, user["id"], "IN_PREP", "IN_REVIEW", "Draft uploaded; ready for client review")
    # Notify client
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if corp:
        await notify(corp["client_id"], "Your draft return is ready for review", "Please review and confirm in your portal.", "draft_ready", eid)
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
async def pilot_metrics(user: dict = Depends(require_role("ADMIN", "PARTNER"))):
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


@api.post("/admin/reset-database")
async def admin_reset_database(
    confirm: str,
    user: dict = Depends(require_role("ADMIN")),
):
    """Nuke all demo/seed data to prepare the app for production launch.

    Preserves:
      - The 3 staff accounts kept for the pilot (see PROD_PRESERVE_EMAILS)
      - Global settings (doc templates, tier pricing, etc.)

    Deletes everything else: users, corporations, engagements, documents,
    messages, opportunities, time entries, notifications, OTP challenges,
    status history, password-reset tokens, checklist items, CPA questions,
    and extracted data. Also wipes uploaded files on local disk.

    ``confirm`` MUST be the literal string "RESET" — prevents accidental
    invocation via an open admin session.
    """
    if confirm != "RESET":
        raise HTTPException(400, "Missing or invalid confirmation. Pass confirm=RESET to proceed.")
    db = get_db()
    PROD_PRESERVE_EMAILS = [
        "nim@cloudtax.ca",
        "pallavi@cloudtax.ca",
        "terryann@cloudtax.ca",
    ]
    report: dict = {"preserved_users": [], "deleted": {}, "uploads_cleared": False}

    # Preserve the 3 staff accounts
    preserved_ids: list[str] = []
    async for u in db.users.find({"email": {"$in": PROD_PRESERVE_EMAILS}}, {"_id": 0, "password_hash": 0}):
        preserved_ids.append(u["id"])
        report["preserved_users"].append({"id": u["id"], "email": u.get("email"), "name": u.get("name"), "role": u.get("role")})

    # Collections that get FULLY cleared
    full_wipe = [
        "corporations",
        "engagements",
        "documents",
        "messages",
        "opportunities",
        "time_entries",
        "checklist",
        "notifications",
        "otp_challenges",
        "password_reset_tokens",
        "status_history",
        "cpa_questions",
        "extracted_data",
    ]
    for coll in full_wipe:
        try:
            res = await db[coll].delete_many({})
            report["deleted"][coll] = res.deleted_count
        except Exception as e:
            log.warning("Reset failed for collection %s: %s", coll, e)
            report["deleted"][coll] = f"error: {e}"

    # Users: keep only preserved ids
    try:
        res = await db.users.delete_many({"id": {"$nin": preserved_ids}})
        report["deleted"]["users"] = res.deleted_count
    except Exception as e:
        report["deleted"]["users"] = f"error: {e}"

    # Wipe local upload directory (files saved via the S3 fallback)
    try:
        import shutil
        uploads_root = os.path.join(os.path.dirname(__file__), "uploads")
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
        report["uploads_cleared"] = True
    except Exception as e:
        log.warning("Reset: upload wipe failed: %s", e)
        report["uploads_cleared"] = f"error: {e}"

    # Best-effort S3 cleanup — prefix-delete under engagements/
    try:
        cleared = s3_service.delete_prefix("engagements/")
        report["s3_cleared"] = cleared
    except Exception as e:
        report["s3_cleared"] = f"error: {e}"

    log.warning("DB reset invoked by %s. Preserved %d users. Report: %s", user.get("email"), len(preserved_ids), report["deleted"])
    return {"ok": True, **report}


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
    user_ids = list({uid for e in engs for uid in [e.get("assigned_cpa_id"), e.get("partner_advisor_id")] if uid})
    corps = {c["id"]: c async for c in db.corporations.find({"id": {"$in": corp_ids}}, {"_id": 0})}
    user_ids += [c.get("client_id") for c in corps.values() if c.get("client_id")]
    users = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}):
        users[u["id"]] = u

    columns = [
        "client_name", "corporation", "tier", "original_tier", "tier_changed",
        "current_status", "assigned_cpa", "partner_advisor",
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
        ws = users.get(e.get("partner_advisor_id")) or {}

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


@api.get("/admin/config-health")
async def admin_config_health(user: dict = Depends(get_current_user)):
    """Admin-only config inspection. Returns the URL the backend will bake
    into invite / reset / notification emails right now, plus any vendor-host
    leak that's been detected. Useful for verifying a deploy BEFORE actually
    inviting a real client. Never exposes secrets.
    """
    if user["role"] != "ADMIN":
        raise HTTPException(403, "Admin only")
    leak = _frontend_url_has_vendor_leak(FRONTEND_URL)
    resend_key = os.environ.get("RESEND_API_KEY", "")
    return {
        "frontend_url": FRONTEND_URL,
        "frontend_url_vendor_leak": leak,                    # None means clean; marker string means leak
        "production_mode": IS_PRODUCTION,
        "show_dev_fallback_tokens": SHOW_DEV_FALLBACK_TOKENS,
        "cors_allow_origins": _cors_origins,
        "resend_configured": bool(resend_key),
        "resend_from": os.environ.get("RESEND_FROM_EMAIL", ""),
        "s3_region": os.environ.get("AWS_REGION", ""),
        "s3_bucket": os.environ.get("S3_BUCKET_NAME", ""),
    }


class PrepareForLaunchIn(BaseModel):
    """Body for the launch-cleanup endpoint. Both fields are required and
    checked verbatim — typos block the wipe.
    """
    confirmation: str          # must equal exactly "WIPE EVERYTHING EXCEPT ADMINS"
    preserve_emails: list[str] = []   # extra emails to KEEP alongside all admins
    enforce_2fa_on_admins: bool = True
    wipe_s3_objects: bool = False     # best-effort delete-all under the configured bucket


@api.post("/admin/prepare-for-launch")
async def prepare_for_launch(body: PrepareForLaunchIn, user: dict = Depends(get_current_user)):
    """One-shot admin endpoint to scrub demo/test data before going live.

    Keeps: every user with ``role == "ADMIN"`` plus any explicit emails in
    ``preserve_emails``. Wipes EVERY other user and ALL associated data
    (engagements, documents, messages, delegates, notifications, OTP
    challenges, sessions, status history, etc.).

    Optionally:
      • Forces ``two_factor_enabled=True`` on every surviving admin so the
        next login goes through email-OTP (the existing "trust this device
        for 30 days" cookie remains in effect).
      • Best-effort empties the S3 bucket configured in env so demo files
        don't linger. Pass ``wipe_s3_objects=true`` to enable.

    Safety:
      • Requires the explicit confirmation string in the body
      • Refuses to run if it would result in zero surviving admins
      • Returns a per-collection wipe count so the caller can audit
    """
    if user["role"] != "ADMIN":
        raise HTTPException(403, "Admin only")
    if body.confirmation != "WIPE EVERYTHING EXCEPT ADMINS":
        raise HTTPException(400, "Confirmation string mismatch — see endpoint docs")
    db = get_db()

    # Compute the survivor set first so we can refuse if it would leave us
    # with nobody able to log back in.
    preserve_lower = {e.lower().strip() for e in (body.preserve_emails or []) if e}
    keep_admins = [u async for u in db.users.find({"role": "ADMIN", "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "email": 1, "name": 1})]
    keep_extra = [u async for u in db.users.find({"email": {"$in": list(preserve_lower)}}, {"_id": 0, "id": 1, "email": 1, "name": 1})]
    survivor_ids = list({u["id"] for u in keep_admins} | {u["id"] for u in keep_extra})
    survivor_emails = sorted({u["email"] for u in keep_admins + keep_extra})
    if not survivor_ids:
        raise HTTPException(400, "Refusing to wipe — no admin users would remain")

    counts: dict[str, int] = {}

    async def wipe(collection_name: str, query: dict) -> None:
        r = await db[collection_name].delete_many(query)
        counts[collection_name] = r.deleted_count

    # Order matters: wipe child rows before parents so cascade FK-ish lookups
    # don't surface stale rows mid-wipe.
    await wipe("messages", {})
    await wipe("documents", {})
    await wipe("checklist", {})
    await wipe("extracted_data", {})
    await wipe("cpa_questions", {})
    await wipe("status_history", {})
    await wipe("time_entries", {})
    await wipe("opportunities", {})
    await wipe("delegates", {})
    await wipe("engagements", {})
    await wipe("corporations", {})
    await wipe("notifications", {})
    await wipe("otp_challenges", {})
    await wipe("password_reset_tokens", {})
    await wipe("trusted_devices", {})
    await wipe("login_attempts", {})
    await wipe("users", {"id": {"$nin": survivor_ids}})

    if body.enforce_2fa_on_admins:
        r = await db.users.update_many(
            {"role": "ADMIN"},
            {"$set": {"two_factor_enabled": True}},
        )
        counts["admins_with_2fa_enforced"] = r.modified_count

    s3_result: dict | None = None
    if body.wipe_s3_objects:
        try:
            s3_result = s3_service.delete_prefix("")
        except Exception as e:
            s3_result = {"error": str(e)}

    log.warning("LAUNCH CLEANUP executed by %s — survivors: %s — counts: %s", user["email"], survivor_emails, counts)
    return {
        "ok": True,
        "executed_by": user["email"],
        "survivors": survivor_emails,
        "wiped": counts,
        "s3_wipe": s3_result,
    }


# ==================== Messaging ====================
import asyncio
import json as _json

# Per-engagement subscribers for SSE
_subs: dict[str, list[asyncio.Queue]] = {}
# Parallel map: engagement_id -> {user_id: count}. Used by the email
# notification layer to suppress transactional "new message" emails when the
# recipient is actively watching the conversation.
_subs_users: dict[str, dict[str, int]] = {}


def _sub(eid: str, user_id: str | None = None) -> asyncio.Queue:
    q = asyncio.Queue()
    _subs.setdefault(eid, []).append(q)
    if user_id:
        bucket = _subs_users.setdefault(eid, {})
        bucket[user_id] = bucket.get(user_id, 0) + 1
    return q


def _unsub(eid: str, q: asyncio.Queue, user_id: str | None = None):
    if eid in _subs and q in _subs[eid]:
        _subs[eid].remove(q)
    if user_id and eid in _subs_users:
        bucket = _subs_users[eid]
        if user_id in bucket:
            bucket[user_id] -= 1
            if bucket[user_id] <= 0:
                del bucket[user_id]
        if not bucket:
            del _subs_users[eid]


def has_live_subscriber(eid: str, user_id: str) -> bool:
    """True when the given user currently has the engagement's SSE open."""
    return bool(_subs_users.get(eid, {}).get(user_id, 0))


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
    if user["role"] == "PARTNER":
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
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Not permitted")
    url = s3_service.generate_download_url(msg["attachment_url"], msg.get("attachment_name"))
    if not url:
        raise HTTPException(500, "Could not generate download URL")
    return {"download_url": url}


def _serialize_msg(m: dict, sender: dict | None) -> dict:
    out = {k: v for k, v in m.items() if k != "_id"}
    if isinstance(out.get("created_at"), datetime):
        out["created_at"] = out["created_at"].isoformat()
    if sender:
        out["sender"] = {
            "id": sender["id"],
            "name": sender.get("name"),
            "role": sender.get("role"),
            "email": sender.get("email"),
            # When the sender is a delegate rather than the primary client,
            # surface the relationship ("Bookkeeper" / "Spouse" / …) so the
            # chat UI can label them distinctly in multi-party threads.
            "delegate_relationship": sender.get("delegate_relationship"),
        }
    else:
        out["sender"] = None
    return out


@api.get("/messages/inbox")
async def messages_inbox(user: dict = Depends(get_current_user)):
    """All conversations the user can see, with last-message preview + unread count.

    ADMIN sees every engagement that has at least one message OR every active engagement (so
    they can pro-actively reach out). CPA → only their assigned engagements. CLIENT → their
    own engagement. PARTNER → 403 (partners are messaging-disabled per spec).
    """
    db = get_db()
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Not permitted")

    # Resolve which engagements this user is allowed to see
    if user["role"] == "ADMIN":
        engs = [e async for e in db.engagements.find({"status": {"$ne": "ONBOARDING"}}, {"_id": 0})]
    elif user["role"] == "CPA":
        engs = [e async for e in db.engagements.find({"assigned_cpa_id": user["id"]}, {"_id": 0})]
    elif user["role"] == "CLIENT":
        my_corps = [c async for c in db.corporations.find({"client_id": user["id"]}, {"id": 1, "_id": 0})]
        cids = [c["id"] for c in my_corps]
        engs = [e async for e in db.engagements.find({"corporation_id": {"$in": cids}}, {"_id": 0})]
    else:
        engs = []

    if not engs:
        return []

    eng_ids = [e["id"] for e in engs]
    corp_ids = list({e["corporation_id"] for e in engs if e.get("corporation_id")})
    cpa_ids = list({e["assigned_cpa_id"] for e in engs if e.get("assigned_cpa_id")})

    corps = {}
    async for c in db.corporations.find({"id": {"$in": corp_ids}}, {"_id": 0}):
        corps[c["id"]] = c
    client_ids = list({c.get("client_id") for c in corps.values() if c.get("client_id")})
    user_ids = list({*client_ids, *cpa_ids})
    users_map = {}
    async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}):
        users_map[u["id"]] = u

    # Last message per engagement (single aggregation pipeline)
    last_msgs = {}
    pipeline = [
        {"$match": {"engagement_id": {"$in": eng_ids}}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$engagement_id",
            "msg_id": {"$first": "$id"},
            "content": {"$first": "$content"},
            "attachment_name": {"$first": "$attachment_name"},
            "sender_id": {"$first": "$sender_id"},
            "created_at": {"$first": "$created_at"},
        }},
    ]
    async for row in db.messages.aggregate(pipeline):
        last_msgs[row["_id"]] = row

    # Unread counts per engagement (messages not sent by current user, is_read=False)
    unread_pipeline = [
        {"$match": {"engagement_id": {"$in": eng_ids}, "sender_id": {"$ne": user["id"]}, "is_read": False}},
        {"$group": {"_id": "$engagement_id", "count": {"$sum": 1}}},
    ]
    unread_map = {}
    async for row in db.messages.aggregate(unread_pipeline):
        unread_map[row["_id"]] = row["count"]

    out = []
    for e in engs:
        corp = corps.get(e.get("corporation_id")) or {}
        client = users_map.get(corp.get("client_id")) or {}
        cpa = users_map.get(e.get("assigned_cpa_id")) if e.get("assigned_cpa_id") else None
        last = last_msgs.get(e["id"])
        last_at = last["created_at"] if last else e.get("updated_at") or e.get("created_at")
        if isinstance(last_at, datetime):
            last_at = last_at.isoformat()
        if not last and user["role"] == "CLIENT":
            # Skip empty conversations for clients (their own empty thread is noise).
            continue
        # ADMIN + CPA: always include assigned/permitted engagements (with or
        # without messages) so staff can start new conversations from search.
        out.append({
            "engagement_id": e["id"],
            "engagement_status": e.get("status"),
            "client": {
                "id": client.get("id"),
                "name": client.get("name") or "—",
                "email": client.get("email"),
                "avatar_url": client.get("avatar_url"),
            } if client else None,
            "corporation": {"name": corp.get("name") or "—"} if corp else None,
            "assigned_cpa": {"id": cpa.get("id"), "name": cpa.get("name")} if cpa else None,
            "last_message": {
                "content": (last or {}).get("content") or "",
                "attachment_name": (last or {}).get("attachment_name"),
                "sender_id": (last or {}).get("sender_id"),
                "created_at": last_at,
            } if last else None,
            "unread_count": unread_map.get(e["id"], 0),
            "last_at": last_at,
        })
    # Sort: unread first, then most-recent last_at
    out.sort(key=lambda r: (-(1 if r["unread_count"] > 0 else 0), r["last_at"] or ""), reverse=True)
    return out


@api.get("/engagements/{eid}/messages")
async def list_messages(eid: str, user: dict = Depends(get_current_user)):
    db = get_db()
    await get_engagement_or_404(eid, user)
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Not permitted")
    rows = [r async for r in db.messages.find({"engagement_id": eid}, {"_id": 0}).sort("created_at", 1)]
    sender_ids = list({r["sender_id"] for r in rows})
    senders = {}
    async for u in db.users.find({"id": {"$in": sender_ids}}, {"_id": 0, "password_hash": 0}):
        senders[u["id"]] = u
    # Pull delegate relationships for this engagement so non-primary-client
    # participants (bookkeeper / spouse / …) get a distinct sender label
    # in multi-party threads.
    rel_map: dict[str, str] = {}
    async for d in db.delegates.find({"engagement_id": eid, "status": "active"}, {"_id": 0, "user_id": 1, "relationship": 1}):
        if d.get("user_id") and d.get("relationship"):
            rel_map[d["user_id"]] = d["relationship"]
    for uid, u in senders.items():
        if uid in rel_map:
            u["delegate_relationship"] = rel_map[uid]
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
    # Enrich with delegate relationship for this engagement (bookkeeper /
    # spouse / …) so chat UIs can label multi-party senders distinctly.
    if sender:
        d = await db.delegates.find_one({"engagement_id": eid, "user_id": user["id"], "status": "active"}, {"_id": 0, "relationship": 1})
        if d and d.get("relationship"):
            sender["delegate_relationship"] = d["relationship"]
    serialized = _serialize_msg(row, sender)
    # Notify the other party via in-app + email (email suppressed when the
    # recipient is actively watching the conversation over SSE).
    recipient_id: Optional[str] = None
    if user["role"] == "CLIENT" and eng.get("assigned_cpa_id"):
        recipient_id = eng["assigned_cpa_id"]
        await notify(recipient_id, "New client message", body.content[:80], "cpa_message", eid)
    elif user["role"] in ("CPA", "ADMIN"):
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if corp:
            recipient_id = corp["client_id"]
            await notify(recipient_id, "New message from your CPA", body.content[:80], "client_message", eid)
    if recipient_id and not has_live_subscriber(eid, recipient_id):
        try:
            recipient = await db.users.find_one({"id": recipient_id}, {"_id": 0, "password_hash": 0})
            if recipient and recipient.get("email"):
                sender_name = (sender or {}).get("name") or (sender or {}).get("email") or "your contact"
                link_base = f"{FRONTEND_URL}/portal/messages" if user["role"] in ("CPA", "ADMIN") else f"{FRONTEND_URL}/cpa/engagement/{eid}"
                await _email_templates_send(recipient["email"], "new_message", {
                    "sender_name": sender_name,
                    "preview": body.content.strip(),
                    "link": link_base,
                })
        except Exception as e:
            log.warning("new_message email failed: %s", e)
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
    if user["role"] == "PARTNER":
        raise HTTPException(403, "Not permitted")

    from fastapi.responses import StreamingResponse

    async def gen():
        q = _sub(eid, user["id"])
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
            _unsub(eid, q, user["id"])

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
async def change_password(body: ChangePasswordIn, response: Response, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    # Security: clear every trusted device on password change so a stolen
    # browser session can't silently skip 2FA after the legit owner rotates
    # their password.
    try:
        await trusted_devices.revoke_all_for_user(user["id"])
        trusted_devices.clear_trust_cookie(response)
    except Exception as e:
        log.warning("trusted_devices.revoke_all_for_user failed on change: %s", e)
    return {"ok": True}


@api.get("/auth/trusted-devices")
async def list_trusted_devices(user: dict = Depends(get_current_user)):
    """List the caller's active trusted devices (for a future 'manage devices' UI)."""
    rows = await trusted_devices.list_for_user(user["id"])
    # Strip internal _id and serialize datetimes to ISO strings.
    out = []
    for r in rows:
        r = dict(r)
        for k in ("created_at", "last_used_at", "expires_at"):
            v = r.get(k)
            if hasattr(v, "isoformat"):
                r[k] = v.isoformat()
        out.append(r)
    return {"devices": out}


@api.delete("/auth/trusted-devices/{device_id}")
async def revoke_trusted_device(device_id: str, user: dict = Depends(get_current_user)):
    ok = await trusted_devices.revoke_one(user["id"], device_id)
    if not ok:
        raise HTTPException(404, "Device not found")
    return {"ok": True}


@api.post("/auth/trusted-devices/revoke-all")
async def revoke_all_trusted_devices(response: Response, user: dict = Depends(get_current_user)):
    count = await trusted_devices.revoke_all_for_user(user["id"])
    trusted_devices.clear_trust_cookie(response)
    return {"ok": True, "revoked": count}


# ============================================================================
# Delegate access (iter 50)
# ----------------------------------------------------------------------------
# A primary client (the physician — corporation.client_id) can invite up to two
# delegates per engagement. Delegates are regular CLIENT-role users; their
# scoping lives in the ``delegates`` collection. See /app/backend/delegates.py
# for the model + helpers.
# ============================================================================

class DelegateInviteIn(BaseModel):
    email: EmailStr
    name: str
    relationship: str  # one of delegates.VALID_RELATIONSHIPS


async def _ensure_primary_client(eng: dict, user: dict) -> dict:
    """Raise 403 unless ``user`` is the primary client (the physician) for this
    engagement. Used for delegate management (only physicians can invite/revoke
    delegates) and for actions reserved to the taxpayer of record (T183 sign).
    Returns the corporation row on success."""
    db = get_db()
    if user["role"] != "CLIENT":
        raise HTTPException(403, "Only the primary client can manage delegates")
    corp = await db.corporations.find_one({"id": eng["corporation_id"]})
    if not corp or corp.get("client_id") != user["id"]:
        raise HTTPException(403, "Only the primary client can manage delegates")
    return corp


@api.post("/engagements/{eid}/delegates")
async def invite_delegate(eid: str, body: DelegateInviteIn, user: dict = Depends(get_current_user)):
    """Invite up to two delegates per engagement. Idempotent: re-inviting an
    email with a pending row resends the email and refreshes the row's
    ``invited_at``."""
    db = get_db()
    eng = await get_engagement_or_404(eid, user)
    await _ensure_primary_client(eng, user)

    rel = (body.relationship or "").strip().lower()
    if rel not in delegates.VALID_RELATIONSHIPS:
        raise HTTPException(400, f"relationship must be one of {sorted(delegates.VALID_RELATIONSHIPS)}")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    invited_email = body.email.lower()
    if invited_email == user["email"].lower():
        raise HTTPException(400, "You cannot invite yourself as a delegate")

    # Cap at MAX active+pending per engagement.
    active = await delegates.count_active(eid)
    existing = await db.delegates.find_one({"engagement_id": eid, "email": invited_email})
    if not existing and active >= delegates.MAX_ACTIVE_DELEGATES_PER_ENGAGEMENT:
        raise HTTPException(400, f"Maximum of {delegates.MAX_ACTIVE_DELEGATES_PER_ENGAGEMENT} delegates per engagement")

    invited_at = datetime.now(timezone.utc)
    if existing:
        if existing.get("status") == delegates.STATUS_REVOKED:
            # Reactivate from revoked → re-invited
            await db.delegates.update_one(
                {"id": existing["id"]},
                {"$set": {
                    "status": delegates.STATUS_INVITED,
                    "name": name,
                    "relationship": rel,
                    "invited_at": invited_at,
                    "revoked_at": None,
                }},
            )
        else:
            await db.delegates.update_one(
                {"id": existing["id"]},
                {"$set": {"name": name, "relationship": rel, "invited_at": invited_at}},
            )
        delegate_id = existing["id"]
    else:
        delegate_id = str(uuid.uuid4())
        await db.delegates.insert_one({
            "id": delegate_id,
            "engagement_id": eid,
            "invited_by": user["id"],
            "user_id": None,
            "email": invited_email,
            "name": name,
            "relationship": rel,
            "status": delegates.STATUS_INVITED,
            "invited_at": invited_at,
            "accepted_at": None,
            "revoked_at": None,
        })

    # If the invitee already has an account, mark the row ACTIVE immediately —
    # they don't need to set a password again. They simply log in and the
    # engagement appears in their list.
    invitee = await db.users.find_one({"email": invited_email}, {"_id": 0, "id": 1, "name": 1})
    invite_link = None
    if invitee and invitee.get("id"):
        await db.delegates.update_one(
            {"id": delegate_id},
            {"$set": {"status": delegates.STATUS_ACTIVE, "user_id": invitee["id"], "accepted_at": invited_at}},
        )
        # Send a "you've been added as a delegate" notification email rather
        # than an account-creation invite.
        try:
            await _email_templates_send(
                invited_email,
                "delegate_added",
                {
                    "name": name,
                    "relationship": rel,
                    "primary_client_name": user.get("name") or "the primary client",
                    "link": f"{FRONTEND_URL}/portal",
                },
            )
        except Exception as e:
            log.warning("delegate_added email failed: %s", e)
    else:
        # New user → issue a fresh set-password token so they can self-onboard.
        # Reuse the existing password_reset_tokens table for cohesion with the
        # rest of the invite flow. We pre-create the user (CLIENT role) so the
        # token has a real user_id to bind to.
        new_uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": new_uid,
            "email": invited_email,
            "password_hash": hash_password(uuid.uuid4().hex),
            "name": name,
            "first_name": name,
            "last_name": "",
            "role": "CLIENT",
            "is_active": True,
            "two_factor_enabled": False,
            "created_at": datetime.now(timezone.utc),
        })
        # Bind the delegate row to the freshly-created user so set-password can
        # pivot it from INVITED → ACTIVE.
        await db.delegates.update_one(
            {"id": delegate_id},
            {"$set": {"user_id": new_uid}},
        )
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": new_uid,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            "used": False,
            "created_at": datetime.now(timezone.utc),
            "purpose": "delegate_invite",
        })
        invite_link = f"{FRONTEND_URL}/set-password?token={token}"
        try:
            await _email_templates_send(
                invited_email,
                "delegate_invite",
                {
                    "name": name,
                    "first_name": name,
                    "relationship": rel,
                    "primary_client_name": user.get("name") or "your physician",
                    "link": invite_link,
                },
            )
        except Exception as e:
            log.warning("delegate_invite email failed: %s", e)

    # Audit on the engagement timeline so the CPA + admins see the activity.
    await log_status_change(
        eid, user["id"], None, eng.get("status", ""),
        note=f"Delegate invited: {name} <{invited_email}> ({rel})",
    )

    row = await db.delegates.find_one({"id": delegate_id})
    return {"delegate": delegates._serialize(row), "invite_link": invite_link}


@api.get("/engagements/{eid}/delegates")
async def list_delegates(eid: str, user: dict = Depends(get_current_user)):
    eng = await get_engagement_or_404(eid, user)
    # Primary client + CPA + Admin can see the list. Delegates themselves see
    # nothing — they cannot manage other delegates.
    db = get_db()
    if user["role"] == "CLIENT":
        corp = await db.corporations.find_one({"id": eng["corporation_id"]})
        if not corp or corp.get("client_id") != user["id"]:
            raise HTTPException(403, "Delegates cannot list peers")
    return {"delegates": await delegates.list_for_engagement(eid)}


@api.delete("/delegates/{delegate_id}")
async def revoke_delegate(delegate_id: str, user: dict = Depends(get_current_user)):
    db = get_db()
    row = await db.delegates.find_one({"id": delegate_id})
    if not row:
        raise HTTPException(404, "Delegate not found")
    eng = await get_engagement_or_404(row["engagement_id"], user)
    await _ensure_primary_client(eng, user)
    await db.delegates.update_one(
        {"id": delegate_id},
        {"$set": {"status": delegates.STATUS_REVOKED, "revoked_at": datetime.now(timezone.utc)}},
    )
    await log_status_change(
        row["engagement_id"], user["id"], None, eng.get("status", ""),
        note=f"Delegate access revoked: {row.get('name') or row.get('email')}",
    )
    return {"ok": True}


@api.get("/me/delegate-context")
async def my_delegate_context(user: dict = Depends(get_current_user)):
    """For the currently-signed-in user, return the list of engagements they
    have delegate access to (if any) along with the primary client's name and
    the delegate's stated relationship. Used by the frontend to render the
    "You are viewing as <relationship> for Dr. <name>" banner and to gate the
    T183 signing UI."""
    db = get_db()
    rows = []
    async for r in db.delegates.find(
        {"user_id": user["id"], "status": delegates.STATUS_ACTIVE},
        {"_id": 0},
    ):
        eng = await db.engagements.find_one({"id": r["engagement_id"]}, {"_id": 0})
        if not eng:
            continue
        corp = await db.corporations.find_one({"id": eng.get("corporation_id")}, {"_id": 0, "client_id": 1, "name": 1})
        primary = await db.users.find_one(
            {"id": (corp or {}).get("client_id")},
            {"_id": 0, "name": 1, "first_name": 1, "last_name": 1},
        ) if corp else None
        rows.append({
            "engagement_id": r["engagement_id"],
            "relationship": r.get("relationship"),
            "primary_client_name": (primary or {}).get("name") if primary else None,
            "primary_client_first_name": (primary or {}).get("first_name") if primary else None,
            "corporation_name": (corp or {}).get("name") if corp else None,
        })
    return {"contexts": rows, "is_delegate": bool(rows)}


app.include_router(api)
