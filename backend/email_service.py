"""Resend transactional email service.

Used for delivering 2FA OTP codes and all transactional emails (invitations,
password resets, notifications) via the Resend API. Falls back gracefully when
not configured: the OTP-issuing endpoints surface the code inline as a sandbox
fallback.

Production config (iter 43+):
  RESEND_API_KEY      — live production key from https://resend.com
  RESEND_FROM_EMAIL   — must be on a domain verified at resend.com/domains
                        (currently ``noreply@ws.cloudtax.ca`` after the DNS
                        records for SPF/DKIM/Return-Path were added to the
                        ``ws.cloudtax.ca`` subdomain).
  RESEND_FROM_NAME    — display name shown by the client (defaults to
                        "CloudTax"). Produces a ``From: CloudTax
                        <noreply@ws.cloudtax.ca>`` header.
"""
import os
import logging
import asyncio
import resend
from typing import Optional

log = logging.getLogger(__name__)

_initialised = False


def _init():
    global _initialised
    if _initialised:
        return
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        log.warning("RESEND_API_KEY not set; emails will not be delivered")
        return
    resend.api_key = api_key
    _initialised = True


def _from_address() -> str:
    """Build the ``From`` header. Prefers ``Name <email>`` form when a display
    name is configured so the inbox shows a human-readable sender."""
    email = os.environ.get("RESEND_FROM_EMAIL") or "onboarding@resend.dev"
    name = (os.environ.get("RESEND_FROM_NAME") or "").strip()
    if name:
        return f"{name} <{email}>"
    return email


_BRAND_STYLE = """
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #faf9f7; padding: 40px 16px; color: #1a1a1a; margin: 0; }
  .card { background: #fff; border: 1px solid #ebe7e0; border-radius: 16px; padding: 32px; max-width: 520px; margin: 0 auto; }
  .brand { font-family: Georgia, 'Times New Roman', serif; font-size: 22px; letter-spacing: -0.3px; margin-bottom: 4px; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 22px; margin: 16px 0 12px; letter-spacing: -0.3px; }
  p { font-size: 14px; line-height: 1.6; color: #1a1a1a; margin: 8px 0; }
  .muted { color: #8b8685; font-size: 12px; }
  .code-box { display: inline-block; background: #faf9f7; border: 1px solid #ebe7e0; border-radius: 12px; padding: 18px 28px; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1565c0; margin: 18px 0; font-family: 'SF Mono', Menlo, Consolas, monospace; }
  .footer { text-align: center; font-size: 11px; color: #b5b0ab; padding-top: 22px; }
</style>
"""


def _wrap(inner: str) -> str:
    return (
        f"<html><head>{_BRAND_STYLE}</head><body>"
        f"<div class='card'><div class='brand'>CloudTax</div>{inner}</div>"
        f"<div class='footer'>Powered by CloudTax, in partnership with Ownr</div>"
        f"</body></html>"
    )


def _send(to_email: str, subject: str, html: str, text: str) -> dict:
    """Synchronous send. Always returns a dict with `success` bool."""
    _init()
    if not _initialised:
        return {"success": False, "error": "resend_not_configured"}
    try:
        params = {
            "from": _from_address(),
            "to": [to_email],
            "subject": subject,
            "html": html,
            "text": text,
        }
        resp = resend.Emails.send(params)
        msg_id = (resp or {}).get("id") if isinstance(resp, dict) else None
        return {"success": True, "message_id": msg_id}
    except Exception as e:  # pragma: no cover (network-dependent)
        log.warning("Resend send failed (non-fatal): %s", e)
        return {"success": False, "error": str(e)}


async def _send_async(to_email: str, subject: str, html: str, text: str) -> dict:
    """Non-blocking variant — runs the sync SDK in a worker thread."""
    return await asyncio.to_thread(_send, to_email, subject, html, text)


# ---- Public templates ---------------------------------------------------------

def send_otp_code(to_email: str, name: str, code: str, purpose: str = "sign in") -> dict:
    """Send a 6-digit verification code. Synchronous wrapper kept for parity with
    the previous `ses_service.send_otp_code` signature."""
    inner = f"""
    <h1>Your verification code</h1>
    <p>Hi {name},</p>
    <p>Use the code below to {purpose}. It expires in 5 minutes.</p>
    <div class='code-box'>{code}</div>
    <p class='muted'>If you didn't request this code, you can safely ignore this email and consider changing your password.</p>
    """
    return _send(
        to_email,
        f"Your CloudTax verification code: {code}",
        _wrap(inner),
        f"Hi {name}, your CloudTax verification code is {code}. It expires in 5 minutes.",
    )


async def send_otp_code_async(to_email: str, name: str, code: str, purpose: str = "sign in") -> dict:
    return await asyncio.to_thread(send_otp_code, to_email, name, code, purpose)
