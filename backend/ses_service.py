"""AWS SES transactional email. Fails gracefully (logs only) if SES not configured."""
import os
import logging
import boto3
from botocore.exceptions import ClientError, EndpointConnectionError

log = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "ses",
            region_name=os.environ["AWS_REGION"],
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        )
    return _client


def send(to_email: str, subject: str, html: str, text: str) -> dict:
    sender = os.environ.get("SES_FROM_EMAIL")
    if not sender:
        log.warning("SES_FROM_EMAIL not set; skipping email to %s", to_email)
        return {"success": False, "error": "sender_not_configured"}
    try:
        resp = _get_client().send_email(
            Source=sender,
            Destination={"ToAddresses": [to_email]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text, "Charset": "UTF-8"},
                    "Html": {"Data": html, "Charset": "UTF-8"},
                },
            },
        )
        return {"success": True, "message_id": resp["MessageId"]}
    except (ClientError, EndpointConnectionError) as e:
        log.warning("SES send failed (non-fatal): %s", e)
        return {"success": False, "error": str(e)}


# ---- Templates (minimal warm, on-brand) ----

_STYLE = """
<style>
  body { font-family: Georgia, serif; background: #faf9f7; padding: 40px; color: #1a1a1a; }
  .card { background: #fff; border: 1px solid #ebe7e0; border-radius: 16px; padding: 32px; max-width: 560px; margin: 0 auto; }
  h1 { font-family: Georgia, serif; font-weight: 400; font-size: 22px; margin: 0 0 16px; letter-spacing: -0.3px; }
  p { font-family: -apple-system, sans-serif; font-size: 13px; line-height: 1.6; color: #1a1a1a; margin: 8px 0; }
  .muted { color: #8b8685; font-size: 11px; }
  .btn { display: inline-block; background: #1a1a1a; color: #faf9f7 !important; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-family: -apple-system, sans-serif; font-size: 12px; font-weight: 500; }
  .footer { text-align: center; font-size: 11px; color: #b5b0ab; padding-top: 24px; }
</style>
"""


def _wrap(inner: str) -> str:
    return f"""<html><head>{_STYLE}</head><body><div class="card">{inner}</div><div class="footer">Powered by CloudTax, in partnership with Wealthsimple</div></body></html>"""


def send_invite(to_email: str, name: str, invite_link: str, role: str) -> dict:
    inner = f"""<h1>Welcome to CloudTax</h1>
    <p>Hi {name},</p>
    <p>You have been invited to the CloudTax and Wealthsimple T2 pilot as a <strong>{role}</strong>. Set your password to get started.</p>
    <p><a class="btn" href="{invite_link}">Set your password</a></p>
    <p class="muted">This link expires in 7 days.</p>"""
    return send(to_email, "Your CloudTax invitation", _wrap(inner), f"Welcome to CloudTax. Set your password: {invite_link}")


def send_filing_complete(to_email: str, name: str, corp_name: str, portal_link: str) -> dict:
    inner = f"""<h1>Your return is filed</h1>
    <p>Hi {name},</p>
    <p>Your T2 return for <strong>{corp_name}</strong> has been filed with CRA. You can download the filed package from your portal.</p>
    <p><a class="btn" href="{portal_link}">Open your portal</a></p>"""
    return send(to_email, f"{corp_name}: T2 filed with CRA", _wrap(inner), f"Your T2 for {corp_name} has been filed. {portal_link}")


def send_missing_doc(to_email: str, name: str, doc_name: str, portal_link: str) -> dict:
    inner = f"""<h1>One document still needed</h1>
    <p>Hi {name},</p>
    <p>We are ready to move your return forward. We still need <strong>{doc_name}</strong>.</p>
    <p><a class="btn" href="{portal_link}">Upload document</a></p>"""
    return send(to_email, "One document still needed for your filing", _wrap(inner), f"We need: {doc_name}. Upload here: {portal_link}")


def send_opportunity(to_email: str, client_name: str, opp_title: str, app_link: str) -> dict:
    inner = f"""<h1>Advisory opportunity</h1>
    <p>A new opportunity has been shared for <strong>{client_name}</strong>:</p>
    <p><em>{opp_title}</em></p>
    <p><a class="btn" href="{app_link}">View in dashboard</a></p>"""
    return send(to_email, f"Advisory opportunity: {client_name}", _wrap(inner), f"{opp_title} — {app_link}")
