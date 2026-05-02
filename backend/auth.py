"""JWT auth, password hashing, role-based access control."""
import os
import uuid
import secrets
import bcrypt
import jwt as pyjwt
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Request, Depends
from typing import Optional

from db import get_db

JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60 * 12  # 12 hours for convenience in pilot
BRUTE_FORCE_THRESHOLD = 5
BRUTE_FORCE_LOCK_MIN = 15


def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
        "type": "access",
    }
    return pyjwt.encode(payload, _jwt_secret(), algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    return pyjwt.decode(token, _jwt_secret(), algorithms=[JWT_ALG])


async def get_current_user(request: Request) -> dict:
    # Per-tab token first, fallback to cookie. The Authorization header is
    # populated from sessionStorage on the frontend (lib/tokenStorage.js) so it
    # uniquely identifies the *tab* rather than the shared browser session.
    # Reading the cookie first would let one tab's login leak into another tab
    # that's signed in as a different role (regression reported in iter 52).
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        db = get_db()
        user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0, "_id": 0})
        if not user or not user.get("is_active", True):
            raise HTTPException(status_code=401, detail="User not found or inactive")
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(*roles: str):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return user
    return dep


async def check_brute_force(identifier: str):
    db = get_db()
    window_start = datetime.now(timezone.utc) - timedelta(minutes=BRUTE_FORCE_LOCK_MIN)
    count = await db.login_attempts.count_documents(
        {"identifier": identifier, "at": {"$gte": window_start}, "success": False}
    )
    if count >= BRUTE_FORCE_THRESHOLD:
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")


async def record_attempt(identifier: str, success: bool):
    db = get_db()
    await db.login_attempts.insert_one({
        "identifier": identifier,
        "at": datetime.now(timezone.utc),
        "success": success,
    })
    if success:
        # Clear previous failed attempts
        await db.login_attempts.delete_many({"identifier": identifier, "success": False})


async def seed_admin():
    """Idempotently seed admin user from env."""
    db = get_db()
    email = os.environ["ADMIN_EMAIL"].lower()
    password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(password),
            "name": "Nim Balachandran",
            "role": "ADMIN",
            "is_active": True,
            "phone": None,
            "created_at": datetime.now(timezone.utc),
        })
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(password)}})


def new_invite_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookie(response, token: str):
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=ACCESS_TTL_MIN * 60,
        path="/",
    )


def clear_auth_cookie(response):
    response.delete_cookie("access_token", path="/")
