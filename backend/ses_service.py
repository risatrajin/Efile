"""Legacy ``ses_service`` surface — now a thin compatibility shim that routes
every public helper to the Resend-backed template dispatcher in
``email_templates.send_email``. AWS SES is not used anymore (sandbox-locked);
this file is kept so existing call-sites in server.py continue to work without
a mass rename.

Each helper is kept synchronous + fire-and-forget to match the old API. The
underlying dispatcher runs the Resend SDK in a worker thread, and any
failure is logged non-fatally.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Optional

from email_service import send_otp_code as _resend_send_otp

log = logging.getLogger(__name__)


def _fire_and_forget(template: str, to_email: str, data: dict) -> dict:
    """Schedule a send on the running event loop. Falls back to a short-lived
    loop when called from a sync context outside the FastAPI app (tests, CLI).
    """
    from email_templates import send_email
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Inside FastAPI — schedule without awaiting.
            loop.create_task(send_email(to_email, template, data))
            return {"success": True, "scheduled": True}
        return loop.run_until_complete(send_email(to_email, template, data))
    except RuntimeError:
        return asyncio.run(send_email(to_email, template, data))
    except Exception as e:
        log.warning("Email send failed (%s -> %s): %s", template, to_email, e)
        return {"success": False, "error": str(e)}


# ---- Public helpers kept for backward compatibility -----------------------

async def send_invite_async(to_email: str, name: str, invite_link: str, role: str) -> dict:
    """Async invite — awaits the actual Resend call so the caller's response
    accurately reflects delivery success. Use this from FastAPI routes so
    admins see a truthful ``email_sent`` flag instead of an always-true
    ``scheduled`` placeholder."""
    from email_templates import send_email
    role_l = (role or "").lower()
    template = (
        "welcome_cpa" if role_l == "cpa"
        else ("welcome_ws" if role_l in ("ws_partner", "partner", "ws") else "welcome_client")
    )
    return await send_email(to_email, template, {"name": name, "link": invite_link})


def send_invite(to_email: str, name: str, invite_link: str, role: str) -> dict:
    """Sync (fire-and-forget) variant. Kept for legacy sync call-sites that
    don't care about delivery status. Returns ``scheduled=True`` without
    awaiting."""
    role_l = (role or "").lower()
    template = (
        "welcome_cpa" if role_l == "cpa"
        else ("welcome_ws" if role_l in ("ws_partner", "partner", "ws") else "welcome_client")
    )
    return _fire_and_forget(template, to_email, {"name": name, "link": invite_link})


def send_password_reset(to_email: str, name: str, reset_link: str) -> dict:
    # Render a minimal inline email — we don't have a template for this (it's
    # its own flow) — so we send a plain Resend message via the low-level path.
    from email_service import _send
    subject = "Reset your CloudTax password"
    html = (
        f"<p style='font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;'>Hi {name},</p>"
        f"<p style='font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;'>You (or someone on your behalf) requested a password reset. Follow the link below to choose a new password. This link expires in 30 minutes.</p>"
        f"<p style='margin:22px 0;'><a href='{reset_link}' style='background:#1a1a1a;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:500;'>Reset password</a></p>"
        f"<p style='font-family:system-ui,sans-serif;font-size:11px;color:#8b8685;'>If you didn't request this, you can safely ignore this message.</p>"
    )
    text = f"Reset your CloudTax password: {reset_link}"
    try:
        return _send(to_email, subject, html, text)
    except Exception as e:
        log.warning("Password reset email failed for %s: %s", to_email, e)
        return {"success": False, "error": str(e)}


def send_otp_code(to_email: str, name: str, code: str, purpose: str = "sign-in") -> dict:
    return _resend_send_otp(to_email, name, code, purpose)


def send_filing_complete(to_email: str, name: str, corp_name: str, portal_link: str) -> dict:
    return _fire_and_forget("t2_filed", to_email, {"link": portal_link})


def send_missing_doc(to_email: str, name: str, doc_name: str, portal_link: str) -> dict:
    return _fire_and_forget("document_reminder", to_email, {"documents": [doc_name], "link": portal_link})


def send_opportunity(to_email: str, client_name: str, opp_title: str, app_link: str) -> dict:
    return _fire_and_forget(
        "ws_opportunity",
        to_email,
        {"client_name": client_name, "opportunity_title": opp_title, "link": app_link},
    )


def send_deferred_reminder(to_email: str, name: str, doc_names: list, portal_link: str) -> dict:
    return _fire_and_forget(
        "document_reminder",
        to_email,
        {"documents": list(doc_names or []), "link": portal_link},
    )
