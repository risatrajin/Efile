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


def _brand_logo_svg() -> str:
    # Inline cloud-with-wordmark so email clients don't need external image
    # fetches (many block them by default). Kept small & warm.
    return (
        "<span style=\"display:inline-flex;align-items:center;gap:8px;\">"
        "<svg width=\"26\" height=\"20\" viewBox=\"0 0 32 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">"
        "<path d=\"M24.5 10.2c.1-.4.1-.9.1-1.3C24.6 5 21.3 2 17.3 2c-3.1 0-5.8 1.7-6.9 4.2-.4-.1-.9-.2-1.4-.2-3 0-5.4 2.4-5.4 5.3 0 .4 0 .7.1 1.1-1.9.5-3.2 2.1-3.2 4 0 2.3 1.9 4.1 4.3 4.1h19.1c2.9 0 5.2-2.3 5.2-5.1 0-2.4-1.8-4.5-4.6-5.2z\" fill=\"#1a1a1a\"/>"
        "</svg>"
        "<span style=\"font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;letter-spacing:-0.4px;color:#1a1a1a;\">CloudTax</span>"
        "</span>"
    )


def _wrap(body_html: str, *, preheader: str = "") -> str:
    """Wrap `body_html` in the standard CloudTax email shell."""
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
          <tr><td style="padding:4px 4px 18px 4px;">{_brand_logo_svg()}</td></tr>
          <tr>
            <td style="background:#ffffff;border:1px solid #ebe7e0;border-radius:16px;padding:32px 34px;">
              {body_html}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 4px 8px;font-size:11px;color:#8b8685;line-height:1.55;">
              Powered by CloudTax, in partnership with Wealthsimple<br/>
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
    name = d.get("name") or "there"
    corp = d.get("corporation_name") or "your corporation"
    cpa = d.get("cpa_name") or "your CPA"
    link = d.get("link") or f"{_frontend_url()}/portal"
    body = (
        _h1(f"Welcome to CloudTax, {name.split()[0] if name else 'there'}")
        + _p(f"We&rsquo;re glad to have you on board. Your T2 engagement for <strong>{corp}</strong> has been set up, and <strong>{cpa}</strong> will be your dedicated CPA throughout the process.")
        + _p("Your next step is to sign in, upload the documents in your checklist, and ask questions whenever you have them. We&rsquo;ll take care of the rest.")
        + _cta_button("Open your portal", link)
        + _muted("Questions? Reply to this email or send your CPA a message from the portal.")
    )
    text = f"Welcome to CloudTax, {name}. Your T2 engagement for {corp} is ready. Your CPA is {cpa}. Sign in: {link}"
    return ("Welcome to CloudTax", _wrap(body, preheader=f"Your T2 engagement for {corp} is ready."), text)


def _tpl_welcome_cpa(d: dict):
    name = d.get("name") or "there"
    link = d.get("link") or f"{_frontend_url()}/cpa/files"
    body = (
        _h1(f"Welcome, {name.split()[0] if name else 'there'}")
        + _p("Your CloudTax CPA account has been created. You can access your engagement inbox, move clients through the workflow, and collaborate with the Wealthsimple team from a single place.")
        + _cta_button("Open CPA workspace", link)
        + _muted("Your sign-in email is the address this message was sent to. Set your password using the invite link shared separately.")
    )
    return (f"Welcome, {name}", _wrap(body, preheader="Your CloudTax CPA account is ready."), f"Welcome, {name}. Your CPA workspace: {link}")


def _tpl_welcome_ws(d: dict):
    name = d.get("name") or "there"
    link = d.get("link") or f"{_frontend_url()}/ws/dashboard"
    body = (
        _h1(f"Welcome, {name.split()[0] if name else 'there'}")
        + _p("Your Wealthsimple partner account for CloudTax has been created. From the partner dashboard you can refer new physician clients, track their T2 progress, and see opportunities surfaced by our CPAs.")
        + _cta_button("Open partner dashboard", link)
    )
    return (f"Welcome, {name}", _wrap(body, preheader="Your Wealthsimple partner dashboard is ready."), f"Welcome, {name}. Partner dashboard: {link}")


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
    ws = d.get("ws_advisor_name") or "Wealthsimple team"
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
    link = d.get("link") or f"{_frontend_url()}/ws/dashboard"
    body = (
        _h1(f"Intake complete: {client}")
        + _p("All intake documents are in. Your CPA has moved the engagement into preparation.")
        + _key_value([("Client", client), ("Corporation", corp), ("Tier", tier)])
        + _cta_button("Open partner dashboard", link)
    )
    return (f"Intake complete: {client}", _wrap(body, preheader=f"{corp} · {tier}"), f"Intake complete: {client}. Open: {link}")


def _tpl_ws_filing_complete(d: dict):
    client = d.get("client_name") or "a client"
    conf = d.get("cra_confirmation") or "—"
    turnaround = d.get("turnaround_days")
    link = d.get("link") or f"{_frontend_url()}/ws/dashboard"
    rows = [("Client", client), ("CRA confirmation", conf)]
    if turnaround is not None:
        rows.append(("Turnaround", f"{turnaround} day{'s' if turnaround != 1 else ''}"))
    body = (
        _h1(f"Filing complete: {client}")
        + _p("The T2 return has been filed and acknowledged by CRA.")
        + _key_value(rows)
        + _cta_button("Open partner dashboard", link)
    )
    return (f"Filing complete: {client}", _wrap(body, preheader=f"CRA confirmation {conf}"), f"Filing complete: {client}. CRA confirmation: {conf}. Open: {link}")


def _tpl_ws_opportunity(d: dict):
    client = d.get("client_name") or "a client"
    title = d.get("opportunity_title") or "Advisory opportunity"
    cat = d.get("category") or "Opportunity"
    desc = d.get("description") or ""
    link = d.get("link") or f"{_frontend_url()}/ws/dashboard"
    body = (
        _h1(f"Advisory opportunity: {client}")
        + _p("Our CPA identified an opportunity worth sharing with the Wealthsimple advisory team.")
        + _key_value([("Client", client), ("Category", cat), ("Title", title)])
        + (f"<div style=\"background:#faf9f7;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.6;margin:14px 0;color:#1a1a1a;\">{desc}</div>" if desc else "")
        + _cta_button("View in partner dashboard", link)
    )
    return (f"Advisory opportunity: {client}", _wrap(body, preheader=title), f"Advisory opportunity for {client}: {title} ({cat}). {desc}. Open: {link}")


def _tpl_admin_new_referral(d: dict):
    client = d.get("client_name") or "a client"
    corp = d.get("corporation_name") or "—"
    tier = d.get("tier") or "Standard"
    ws = d.get("ws_advisor_name") or "Wealthsimple"
    link = d.get("link") or f"{_frontend_url()}/admin/dashboard"
    body = (
        _h1(f"New client referred by Wealthsimple: {client}")
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


# Registry — template_key -> (builder, recipient_role_hint_for_logs)
TEMPLATES: dict[str, Callable[[dict], tuple[str, str, str]]] = {
    "welcome_client": _tpl_welcome_client,
    "welcome_cpa": _tpl_welcome_cpa,
    "welcome_ws": _tpl_welcome_ws,
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
