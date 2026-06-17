"""CloudTax transactional email templates + dispatcher.

Layer above ``email_service.py`` (the thin Resend SDK wrapper). This module
owns the *what* (template catalogue + CloudTax-branded HTML shell) while
``email_service`` owns the *how* (Resend API mechanics).

Design notes
------------
* Warm cream background, generous whitespace, simple left-aligned layout —
  matches the rest of the CloudTax UI.
* Every email uses ONE layout (``_wrap``) so branding changes happen in
  exactly one place.
* Templates are declared as small builder functions returning
  ``(subject, html, text)``; a single ``send_email(to, template, data)`` entry
  point does the lookup + dispatch.
* Plain-text fallback is always provided — critical for deliverability.
* No external templating engine — keep deploy simple, use f-strings.
"""
from __future__ import annotations

import os
import logging
from typing import Callable, Optional

from email_service import _send_async

log = logging.getLogger(__name__)


def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "").rstrip("/") or "https://cloudtax.ca"


def _brand_logo_svg(brand: str = "cloudtax") -> str:
    # CloudTax is the operator on every email; Ownr is the partner. Partner-facing
    # emails pass brand="ownr" to show the Ownr wordmark instead. We serve a
    # retina (@2x) PNG, NOT an SVG — Gmail/Outlook do not reliably render SVG in
    # email. The asset lives under the public FRONTEND_URL so inbox providers
    # (which strip cookies) can fetch it anonymously. The display height is 24px;
    # the @2x PNG is 48px tall so it stays crisp on retina screens.
    asset = "/ownr-logo@2x.png" if brand == "ownr" else "/cloud-tax-logo@2x.png"
    alt = "Ownr" if brand == "ownr" else "CloudTax"
    logo_url = f"{_frontend_url()}{asset}"
    return (
        f"<img src=\"{logo_url}\" alt=\"{alt}\" height=\"24\" "
        "style=\"display:block;border:0;outline:none;text-decoration:none;max-width:240px;height:24px;width:auto;\" />"
    )


def _resolve_first_name(d: dict) -> str:
    """Return the exact first-name string to greet the recipient with.

    Priority:
      1. ``first_name`` if present on the payload — returned VERBATIM, so
         multi-word first-name values like ``"Dr Bala"`` or ``"Van Der"``
         survive intact. This is the path CLIENT invites take because we
         now persist first/last name separately on the user document.
      2. ``name`` field — used only as a last-ditch fallback for staff
         invites that still collect a single "Full name" input. In that
         case we take the first whitespace-separated token, which is the
         best we can do without structured first/last data.
      3. Empty string when neither is usable — callers should then omit
         the comma entirely in the greeting (no "Hi ," trailing commas).
    """
    fn = (d.get("first_name") or "").strip()
    if fn:
        return fn
    raw = (d.get("name") or "").strip()
    if not raw:
        return ""
    return raw.split()[0]


def _wrap(body_html: str, *, preheader: str = "", brand: str = "cloudtax") -> str:
    """Wrap `body_html` in the standard CloudTax email shell.

    ``brand`` selects the header wordmark: "cloudtax" (default, operator) or
    "ownr" (partner-facing emails)."""
    preheader_html = (
        f"<div style=\"display:none !important;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#faf9f7;\">{preheader}</div>"
        if preheader else ""
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>CloudTax</title>
</head>
<body style="margin:0;padding:0;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  {preheader_html}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr><td align="center" style="padding:4px 4px 20px 4px;">{_brand_logo_svg(brand)}</td></tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #ebe7e0;border-radius:16px;padding:32px 34px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 4px 8px;font-size:11px;color:#8b8685;line-height:1.55;">
              Powered by CloudTax, in partnership with Ownr<br/>
              <a href="https://cloudtax.ca" style="color:#8b8685;text-decoration:underline;">CloudTax</a> &nbsp;·&nbsp; <a href="https://cloudtax.ca" style="color:#8b8685;text-decoration:underline;">www.cloudtax.ca</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def _cta_button(label: str, href: str) -> str:
    return (
        f"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:22px 0 8px 0;\"><tr><td "
        f"style=\"background:#1a1a1a;border-radius:10px;\">"
        f"<a href=\"{href}\" style=\"display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;letter-spacing:0.1px;\">{label}</a>"
        f"</td></tr></table>"
    )


def _h1(text: str) -> str:
    return f"<h1 style=\"font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:22px;letter-spacing:-0.3px;margin:0 0 14px;color:#1a1a1a;\">{text}</h1>"


def _p(text: str) -> str:
    return f"<p style=\"font-size:14px;line-height:1.6;margin:10px 0;color:#1a1a1a;\">{text}</p>"


def _muted(text: str) -> str:
    return f"<p style=\"font-size:12px;line-height:1.55;margin:10px 0;color:#8b8685;\">{text}</p>"


def _key_value(rows: list[tuple[str, str]]) -> str:
    parts = ["<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:14px 0;border-top:1px solid #ebe7e0;\">"]
    for k, v in rows:
        parts.append(
            "<tr>"
            f"<td style=\"padding:10px 14px 10px 0;font-size:12px;color:#8b8685;border-bottom:1px solid #ebe7e0;width:40%;\">{k}</td>"
            f"<td style=\"padding:10px 0;font-size:13px;color:#1a1a1a;border-bottom:1px solid #ebe7e0;font-weight:500;\">{v}</td>"
            "</tr>"
        )
    parts.append("</table>")
    return "".join(parts)


def _bullets(items: list[str]) -> str:
    if not items:
        return ""
    lis = "".join(f"<li style=\"padding:4px 0;font-size:13px;\">{i}</li>" for i in items)
    return f"<ul style=\"margin:10px 0;padding-left:20px;color:#1a1a1a;\">{lis}</ul>"


def _fmt_money(v) -> str:
    try:
        return f"${float(v):,.2f}"
    except Exception:
        return str(v or "—")


# ============================================================================
# Template builders — each returns (subject, html, text)
# ============================================================================

def _tpl_welcome_client(d: dict):
    corp = d.get("corporation_name") or "your corporation"
    cpa = d.get("cpa_name")
    link = d.get("link") or f"{_frontend_url()}/portal"
    first = _resolve_first_name(d)
    # New copy spec (iter 49): personalize with the exact first-name value and
    # suffix the role in parens so the inbox preview answers two questions at a
    # glance — "is this for me?" and "what kind of invite is it?". No trailing
    # comma / role tag when we have no first name on file.
    if first:
        heading = f"You&rsquo;re invited to join CloudTax&rsquo;s Portal, {first} (Client)"
        subject = f"You're invited to CloudTax's Portal, {first} (Client)"
        text_greeting = f"Hi {first},"
    else:
        heading = "You&rsquo;re invited to join CloudTax&rsquo;s Portal"
        subject = "You're invited to CloudTax's Portal"
        text_greeting = "Hi,"
    cpa_line = (
        f"Your dedicated CPA is <strong>{cpa}</strong>, and you&rsquo;ll be able to message them directly from the portal."
        if cpa else
        "A dedicated CPA will be assigned and introduced to you shortly."
    )
    body = (
        _h1(heading)
        + _p(f"CloudTax has been set up to help you file your corporate taxes for <strong>{corp}</strong> — securely, simply, and without the back-and-forth.")
        + _p("Once you join, you can use our secure client portal to upload the documents on your personalized checklist, e-sign your T183 when your return is ready, and track progress end-to-end.")
        + _p(cpa_line)
        + _cta_button("Activate your portal", link)
        + _muted("This invitation link is valid for 7 days. If it expires, ask your CPA or CloudTax admin to resend it.")
    )
    text = (
        f"{text_greeting}\n\nYou're invited to join CloudTax to file your corporate taxes for {corp}.\n"
        "Upload documents, e-sign your T183, and message your CPA — all in one secure place.\n\n"
        f"Activate your portal: {link}\n\n(Link is valid for 7 days.)"
    )
    return (subject, _wrap(body, preheader=f"Secure portal set up for {corp}. Activate in 1 minute."), text)


def _tpl_welcome_cpa(d: dict):
    link = d.get("link") or f"{_frontend_url()}/set-password"
    first = _resolve_first_name(d)
    # CPA keeps a warmer "Welcome to the team" heading — we still tag the role
    # for consistency with client/partner invites.
    if first:
        heading = f"Welcome to the CloudTax team, {first} (CPA)"
        subject = f"Welcome to CloudTax, {first} (CPA)"
        text_greeting = f"Welcome to CloudTax, {first}."
    else:
        heading = "Welcome to the CloudTax team"
        subject = "Welcome to the CloudTax CPA team"
        text_greeting = "Welcome to CloudTax."
    body = (
        _h1(heading)
        + _p("You&rsquo;ve been invited to join CloudTax as a CPA. You&rsquo;ll use the platform to manage your assigned corporate-tax engagements end-to-end: review documents, run our AI-assisted data extraction, collaborate with the Ownr partner team, and deliver filed returns to your clients.")
        + _p("Your workspace gives you a single view of every engagement, a shared review checklist, and a private chat thread per client.")
        + _cta_button("Set your password &amp; sign in", link)
        + _muted("This invitation link is valid for 7 days. After you set your password you&rsquo;ll be prompted to enable 2FA on your first sign-in.")
    )
    text = (
        f"{text_greeting}\n\nYou've been invited to join as a CPA. You'll manage corporate-tax engagements, "
        "run AI extraction on client documents, collaborate with Ownr partners, and deliver filed returns from one place.\n\n"
        f"Set your password and sign in: {link}\n\n(Link is valid for 7 days.)"
    )
    return (subject, _wrap(body, preheader="Your CPA workspace is ready — set your password to begin."), text)


def _tpl_welcome_ws(d: dict):
    link = d.get("link") or f"{_frontend_url()}/set-password"
    first = _resolve_first_name(d)
    if first:
        heading = f"CloudTax invited you to join CloudTax&rsquo;s Portal, {first} (Partner)"
        subject = f"You're invited to CloudTax's Portal, {first} (Partner)"
        text_greeting = f"Hi {first},"
    else:
        heading = "CloudTax invited you to join CloudTax&rsquo;s Portal"
        subject = "You're invited to CloudTax's Portal"
        text_greeting = "Hi,"
    body = (
        _h1(heading)
        + _p("You&rsquo;ll use the partner dashboard to refer physician clients to our done-for-you corporate-tax preparation workflow, track each engagement through intake, prep, review and filing, and see the advisory opportunities our CPAs surface along the way.")
        + _p("Everything is built around a shared pipeline — you see exactly where every client stands and what&rsquo;s outstanding, without chasing anyone over email.")
        + _cta_button("Set your password &amp; enter the dashboard", link)
        + _muted("This invitation link is valid for 7 days. After you set your password you&rsquo;ll be prompted to enable 2FA on your first sign-in.")
    )
    text = (
        f"{text_greeting}\n\nCloudTax invited you to join the platform as an Ownr partner. "
        "Refer physician clients to our done-for-you corporate-tax workflow, track every engagement in one pipeline, "
        "and see advisory opportunities surfaced by our CPAs.\n\n"
        f"Set your password and sign in: {link}\n\n(Link is valid for 7 days.)"
    )
    return (subject, _wrap(body, preheader="Partner dashboard ready — set your password to begin.", brand="ownr"), text)


def _tpl_engagement_started(d: dict):
    corp = d.get("corporation_name") or "your corporation"
    cpa = d.get("cpa_name") or "your CPA"
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("Your tax engagement has started")
        + _p(f"We&rsquo;ve kicked off the T2 engagement for <strong>{corp}</strong>. <strong>{cpa}</strong> will be guiding you through the filing.")
        + _p("The first step is uploading the documents in your intake checklist. Once we have everything we need, your CPA will prepare the return.")
        + _cta_button("Upload documents", link)
    )
    return ("Your tax engagement has started", _wrap(body, preheader=f"Upload your intake documents for {corp}."), f"Your T2 engagement for {corp} has started. Upload documents: {link}")


def _tpl_document_reminder(d: dict):
    docs = d.get("documents") or []
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("A friendly reminder on outstanding documents")
        + _p("We&rsquo;re still missing a few items for your T2 engagement. Uploading these helps us keep your filing on track.")
        + _bullets(docs)
        + _cta_button("Upload documents", link)
        + _muted("If any of these no longer apply, let your CPA know via the Messages page and we&rsquo;ll mark them as not applicable.")
    )
    text = "Outstanding documents: " + ", ".join(docs) + f". Upload: {link}"
    return ("Document reminder — outstanding items for your T2", _wrap(body, preheader=f"{len(docs)} item(s) still outstanding."), text)


def _tpl_new_document_requested(d: dict):
    name = d.get("document_name") or "a new document"
    note = d.get("note") or ""
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("New document requested")
        + _p(f"Your CPA has requested <strong>{name}</strong> for your T2 engagement.")
        + (f"<div style=\"background:#faf9f7;border-left:3px solid #1a1a1a;padding:12px 14px;border-radius:4px;margin:14px 0;font-size:13px;line-height:1.55;color:#1a1a1a;\"><strong>Why:</strong> {note}</div>" if note else "")
        + _cta_button("Upload the document", link)
    )
    return (f"New document requested: {name}", _wrap(body, preheader=f"Please upload {name}."), f"Your CPA requested: {name}. {note}. Upload: {link}")


def _tpl_document_issue(d: dict):
    name = d.get("document_name") or "a document"
    note = d.get("issue_note") or "Please re-upload the document."
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("We found an issue with a document")
        + _p(f"Your CPA flagged an issue with <strong>{name}</strong>:")
        + f"<div style=\"background:#fff3e0;border-left:3px solid #ef6c00;padding:12px 14px;border-radius:4px;margin:14px 0;font-size:13px;line-height:1.55;color:#1a1a1a;\">{note}</div>"
        + _p("Please re-upload a corrected version at your convenience.")
        + _cta_button("Re-upload the document", link)
    )
    return (f"Issue flagged on {name}", _wrap(body, preheader="Please re-upload."), f"Issue with {name}: {note}. Re-upload: {link}")


def _tpl_t183_ready(d: dict):
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("Your T183 is ready for signing")
        + _p("Your CPA has prepared the <strong>T183 authorization</strong>. This form gives CRA permission to accept your electronically-filed T2 return. It takes about a minute to sign from your portal.")
        + _cta_button("Review and sign T183", link)
    )
    return ("Your T183 is ready for signing", _wrap(body, preheader="One-minute signature needed."), f"Your T183 is ready to sign: {link}")


def _tpl_return_ready_review(d: dict):
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("Your return is ready for review")
        + _p("Your CPA has prepared a draft of your T2 return and it&rsquo;s waiting for your review. Take a look, ask any questions you have, and approve when you&rsquo;re ready for us to file.")
        + _cta_button("Review your return", link)
    )
    return ("Your return is ready for review", _wrap(body, preheader="Draft awaiting your approval."), f"Your T2 draft is ready to review: {link}")


def _tpl_t2_filed(d: dict):
    conf = d.get("cra_confirmation") or "—"
    filed_date = d.get("filing_date_display") or ""
    fs = d.get("filing_summary") or {}
    summary_rows = []
    if fs.get("net_income") is not None:
        summary_rows.append(("Net income for tax purposes", _fmt_money(fs.get("net_income"))))
    if fs.get("total_tax_assessed") is not None:
        summary_rows.append(("Total tax assessed", _fmt_money(fs.get("total_tax_assessed"))))
    if fs.get("instalments_paid") is not None:
        summary_rows.append(("Instalments paid", _fmt_money(fs.get("instalments_paid"))))
    if fs.get("balance_owing") is not None:
        summary_rows.append(("Balance owing", _fmt_money(fs.get("balance_owing"))))
    if fs.get("payment_due_date"):
        summary_rows.append(("Payment due date", str(fs.get("payment_due_date"))))
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1("Your T2 has been filed with CRA")
        + _p(f"We filed your T2 return on <strong>{filed_date}</strong>. CRA has acknowledged the submission with confirmation number <strong>{conf}</strong>. A PDF copy is available in your portal for your records.")
        + (_key_value(summary_rows) if summary_rows else "")
        + _cta_button("Download filed return", link)
    )
    return ("Your T2 has been filed with CRA", _wrap(body, preheader=f"CRA confirmation {conf}"), f"Your T2 was filed on {filed_date}. CRA confirmation: {conf}. Download: {link}")


def _tpl_new_message(d: dict):
    sender = d.get("sender_name") or "your CPA"
    preview = d.get("preview") or ""
    preview = preview[:100] + ("…" if len(preview) > 100 else "")
    link = d.get("link") or f"{_frontend_url()}/portal/messages"
    body = (
        _h1(f"New message from {sender}")
        + (f"<div style=\"background:#faf9f7;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.55;margin:14px 0;color:#1a1a1a;\">{preview}</div>" if preview else "")
        + _cta_button("Open Messages", link)
    )
    return (f"New message from {sender}", _wrap(body, preheader=preview or "You have a new message in CloudTax."), f"New message from {sender}: {preview}. Open: {link}")


def _tpl_cpa_client_assigned(d: dict):
    name = d.get("client_name") or "a client"
    corp = d.get("corporation_name") or "—"
    tier = d.get("tier") or "Standard"
    ws = d.get("partner_advisor_name") or "Ownr team"
    link = d.get("link") or f"{_frontend_url()}/cpa/files"
    body = (
        _h1(f"New client assigned: {name}")
        + _p("You&rsquo;ve been assigned a new engagement. Here&rsquo;s a quick overview:")
        + _key_value([
            ("Client", name),
            ("Corporation", corp),
            ("Tier", tier),
            ("Referring advisor", ws),
        ])
        + _cta_button("Open engagement", link)
    )
    return (f"New client assigned: {name}", _wrap(body, preheader=f"{corp} · {tier}"), f"New client assigned: {name} ({corp}, {tier}). Open: {link}")


def _tpl_cpa_doc_uploaded(d: dict):
    client = d.get("client_name") or "a client"
    doc = d.get("document_name") or "a document"
    link = d.get("link") or f"{_frontend_url()}/cpa/files"
    body = (
        _h1(f"{client} uploaded a document")
        + _p(f"<strong>{doc}</strong> is ready for your review.")
        + _cta_button("Review the document", link)
    )
    return (f"{client} uploaded {doc}", _wrap(body, preheader="Document ready for review"), f"{client} uploaded {doc}. Review: {link}")


def _tpl_cpa_t183_signed(d: dict):
    client = d.get("client_name") or "a client"
    link = d.get("link") or f"{_frontend_url()}/cpa/files"
    body = (
        _h1(f"{client} signed the T183")
        + _p("You&rsquo;re cleared to proceed to filing once the draft has been approved by the client.")
        + _cta_button("Open engagement", link)
    )
    return (f"{client} signed the T183", _wrap(body, preheader="Ready for filing"), f"{client} signed the T183. Open: {link}")


def _tpl_ws_intake_complete(d: dict):
    client = d.get("client_name") or "a client"
    corp = d.get("corporation_name") or "—"
    tier = d.get("tier") or "Standard"
    link = d.get("link") or f"{_frontend_url()}/partner/dashboard"
    body = (
        _h1(f"Intake complete: {client}")
        + _p("All intake documents are in. Your CPA has moved the engagement into preparation.")
        + _key_value([("Client", client), ("Corporation", corp), ("Tier", tier)])
        + _cta_button("Open partner dashboard", link)
    )
    return (f"Intake complete: {client}", _wrap(body, preheader=f"{corp} · {tier}", brand="ownr"), f"Intake complete: {client}. Open: {link}")


def _tpl_ws_filing_complete(d: dict):
    client = d.get("client_name") or "a client"
    conf = d.get("cra_confirmation") or "—"
    turnaround = d.get("turnaround_days")
    link = d.get("link") or f"{_frontend_url()}/partner/dashboard"
    rows = [("Client", client), ("CRA confirmation", conf)]
    if turnaround is not None:
        rows.append(("Turnaround", f"{turnaround} day{'s' if turnaround != 1 else ''}"))
    body = (
        _h1(f"Filing complete: {client}")
        + _p("The T2 return has been filed and acknowledged by CRA.")
        + _key_value(rows)
        + _cta_button("Open partner dashboard", link)
    )
    return (f"Filing complete: {client}", _wrap(body, preheader=f"CRA confirmation {conf}", brand="ownr"), f"Filing complete: {client}. CRA confirmation: {conf}. Open: {link}")


def _tpl_ws_opportunity(d: dict):
    client = d.get("client_name") or "a client"
    title = d.get("opportunity_title") or "Advisory opportunity"
    cat = d.get("category") or "Opportunity"
    desc = d.get("description") or ""
    link = d.get("link") or f"{_frontend_url()}/partner/dashboard"
    body = (
        _h1(f"Advisory opportunity: {client}")
        + _p("Our CPA identified an opportunity worth sharing with the Ownr advisory team.")
        + _key_value([("Client", client), ("Category", cat), ("Title", title)])
        + (f"<div style=\"background:#faf9f7;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.6;margin:14px 0;color:#1a1a1a;\">{desc}</div>" if desc else "")
        + _cta_button("View in partner dashboard", link)
    )
    return (f"Advisory opportunity: {client}", _wrap(body, preheader=title, brand="ownr"), f"Advisory opportunity for {client}: {title} ({cat}). {desc}. Open: {link}")


def _tpl_admin_new_referral(d: dict):
    client = d.get("client_name") or "a client"
    corp = d.get("corporation_name") or "—"
    tier = d.get("tier") or "Standard"
    ws = d.get("partner_advisor_name") or "Ownr"
    link = d.get("link") or f"{_frontend_url()}/admin/dashboard"
    body = (
        _h1(f"New client referred by Ownr: {client}")
        + _key_value([
            ("Client", client),
            ("Corporation", corp),
            ("Tier", tier),
            ("Referring advisor", ws),
        ])
        + _cta_button("View in admin dashboard", link)
    )
    return (f"New referral: {client}", _wrap(body, preheader=f"{corp} · {tier}"), f"New referral: {client} ({corp}, {tier}) from {ws}. Open: {link}")


def _tpl_admin_tier_changed(d: dict):
    client = d.get("client_name") or "a client"
    old = d.get("old_tier") or "—"
    new = d.get("new_tier") or "—"
    reason = d.get("reason") or ""
    link = d.get("link") or f"{_frontend_url()}/admin/dashboard"
    body = (
        _h1(f"Engagement tier changed: {client}")
        + _key_value([
            ("Client", client),
            ("From", old),
            ("To", new),
        ])
        + (f"<div style=\"background:#faf9f7;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.6;margin:14px 0;color:#1a1a1a;\"><strong>Reason:</strong> {reason}</div>" if reason else "")
        + _cta_button("View in admin dashboard", link)
    )
    return (f"Tier changed: {client} ({old} → {new})", _wrap(body, preheader=reason or "Tier change logged"), f"Tier changed for {client}: {old} -> {new}. {reason}. Open: {link}")


# ----- Delegate access (iter 50) -------------------------------------------

def _tpl_delegate_invite(d: dict):
    """Sent to a brand-new delegate who needs to set up an account before
    they can access the engagement."""
    link = d.get("link") or f"{_frontend_url()}/set-password"
    rel = (d.get("relationship") or "delegate").lower()
    primary = d.get("primary_client_name") or "your physician"
    first = _resolve_first_name(d)
    if first:
        heading = f"You&rsquo;ve been invited to CloudTax&rsquo;s Portal, {first} ({rel.title()})"
        subject = f"You're invited to CloudTax's Portal as {primary}'s {rel}"
        text_greeting = f"Hi {first},"
    else:
        heading = "You&rsquo;ve been invited to CloudTax&rsquo;s Portal"
        subject = f"You're invited to CloudTax's Portal as {primary}'s {rel}"
        text_greeting = "Hi,"
    body = (
        _h1(heading)
        + _p(f"<strong>{primary}</strong> has invited you to access their CloudTax engagement as their <strong>{rel}</strong>. You&rsquo;ll be able to upload documents, message the CPA, and track progress on the corporate-tax filing.")
        + _p("Some actions stay reserved for the primary client &mdash; you won&rsquo;t be able to sign the T183 or change account settings on their behalf.")
        + _cta_button("Set your password &amp; sign in", link)
        + _muted("This invitation link is valid for 7 days. After you set your password you&rsquo;ll be prompted to enable 2FA on your first sign-in.")
    )
    text = (
        f"{text_greeting}\n\n{primary} has invited you to access their CloudTax engagement as their {rel}.\n"
        "Upload documents, message the CPA, and track progress on the corporate-tax filing.\n"
        "(The primary client retains exclusive control of T183 signing and account settings.)\n\n"
        f"Set your password and sign in: {link}\n\n(Link is valid for 7 days.)"
    )
    return (subject, _wrap(body, preheader=f"{primary} has added you as their {rel} on CloudTax."), text)


def _tpl_delegate_added(d: dict):
    """Sent when an existing CloudTax user is added as a delegate to an
    engagement — no account-creation step required, just a heads-up."""
    link = d.get("link") or f"{_frontend_url()}/portal"
    rel = (d.get("relationship") or "delegate").lower()
    primary = d.get("primary_client_name") or "the primary client"
    first = _resolve_first_name(d)
    greeting = f"Hi {first}," if first else "Hello,"
    body = (
        _h1(f"You&rsquo;ve been added as {primary}&rsquo;s {rel}")
        + _p(f"The next time you sign in to CloudTax you&rsquo;ll see <strong>{primary}</strong>&rsquo;s engagement in your portal alongside your own. You can upload documents, send messages to the CPA, and track filing progress.")
        + _cta_button("Open your portal", link)
        + _muted("If you weren&rsquo;t expecting this, you can ask the primary client to revoke your access at any time from their account settings.")
    )
    text = (
        f"{greeting}\n\nYou've been added as {primary}'s {rel} on CloudTax.\n"
        f"Open your portal: {link}"
    )
    return (f"You're now {primary}'s {rel} on CloudTax", _wrap(body, preheader=f"{primary} added you as their {rel}."), text)


# ----------------------------------------------------------------------------
# Registry — template_key -> (builder, recipient_role_hint_for_logs)
TEMPLATES: dict[str, Callable[[dict], tuple[str, str, str]]] = {
    "welcome_client": _tpl_welcome_client,
    "welcome_cpa": _tpl_welcome_cpa,
    "welcome_ws": _tpl_welcome_ws,
    "delegate_invite": _tpl_delegate_invite,
    "delegate_added": _tpl_delegate_added,
    "engagement_started": _tpl_engagement_started,
    "document_reminder": _tpl_document_reminder,
    "new_document_requested": _tpl_new_document_requested,
    "document_issue": _tpl_document_issue,
    "t183_ready": _tpl_t183_ready,
    "return_ready_review": _tpl_return_ready_review,
    "t2_filed": _tpl_t2_filed,
    "new_message": _tpl_new_message,
    "cpa_client_assigned": _tpl_cpa_client_assigned,
    "cpa_doc_uploaded": _tpl_cpa_doc_uploaded,
    "cpa_t183_signed": _tpl_cpa_t183_signed,
    "ws_intake_complete": _tpl_ws_intake_complete,
    "ws_filing_complete": _tpl_ws_filing_complete,
    "ws_opportunity": _tpl_ws_opportunity,
    "admin_new_referral": _tpl_admin_new_referral,
    "admin_tier_changed": _tpl_admin_tier_changed,
}


async def send_email(to: str, template: str, data: Optional[dict] = None) -> dict:
    """Render the given template and send via Resend. Never raises — email
    delivery failures are non-fatal from the caller's perspective.
    """
    if not to:
        return {"success": False, "error": "no_recipient"}
    builder = TEMPLATES.get(template)
    if not builder:
        log.warning("Unknown email template: %s", template)
        return {"success": False, "error": f"unknown_template:{template}"}
    try:
        subject, html, text = builder(data or {})
    except Exception as e:
        log.exception("Template render failed for %s: %s", template, e)
        return {"success": False, "error": "render_failed"}
    try:
        result = await _send_async(to, subject, html, text)
    except Exception as e:
        log.warning("Email dispatch failed for template %s -> %s: %s", template, to, e)
        return {"success": False, "error": str(e)}
    log.info("Email sent: template=%s to=%s success=%s", template, to, result.get("success"))
    return result
