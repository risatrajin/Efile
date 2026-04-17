"""AI document parsing via Claude Sonnet 4.5 through Emergent Universal key."""
import os
import json
import logging
import uuid
import tempfile
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType

log = logging.getLogger(__name__)

EXTRACTION_PROMPTS = {
    "PRIOR_T2": "Extract from this prior-year Canadian T2 corporate tax return: revenue, total_expenses, net_income_before_tax, tax_payable, cda_balance, rdtoh_balance, sbd_claimed, passive_income, net_tax_owing. Return only a JSON object with these keys, using numbers (not strings). Omit fields not present.",
    "PRIOR_NOA": "Extract from this prior-year CRA Notice of Assessment: assessed_tax, cda_balance, rdtoh_balance, any_reassessment_difference. Return only a JSON object.",
    "PRIOR_FINANCIALS": "Extract from these Canadian corporate financial statements: total_assets, total_liabilities, equity, revenue, total_expenses, net_income. Return only a JSON object.",
    "BROKERAGE_STATEMENTS": "Extract from this Canadian brokerage statement: account_number, institution, total_market_value, realized_gains, realized_losses, dividend_income, interest_income. Return only a JSON object.",
    "CURRENT_TRIAL_BALANCE": "Extract totals from this trial balance: total_debits, total_credits, revenue_total, expense_total, net_position. Return only a JSON object.",
    "PERSONAL_T1": "Extract from this Canadian Personal T1 return: total_income, tax_payable, rrsp_deduction, rrsp_room_remaining. Return only a JSON object.",
}


async def extract_from_pdf(file_bytes: bytes, mime_type: str, category: str) -> dict:
    """Use Gemini (supports file attachments) for document parsing.

    Note: While Anthropic is the spec target, emergentintegrations' file-attachment
    support is Gemini-only. Gemini 2.5 Pro is used here via the Emergent LLM key.
    """
    prompt = EXTRACTION_PROMPTS.get(
        category,
        "Extract all key financial figures from this Canadian tax document as a JSON object. Use numbers, not strings.",
    )
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return {"error": "EMERGENT_LLM_KEY not configured"}

    suffix = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "text/csv": ".csv",
    }.get(mime_type, ".bin")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(file_bytes)
        tmp.flush()
        tmp.close()
        chat = LlmChat(
            api_key=key,
            session_id=f"extract-{uuid.uuid4()}",
            system_message="You are a precise Canadian tax data extraction assistant. Reply with ONLY valid JSON, no explanation, no markdown fences.",
        ).with_model("gemini", "gemini-2.5-pro")
        msg = UserMessage(
            text=prompt,
            file_contents=[FileContentWithMimeType(file_path=tmp.name, mime_type=mime_type)],
        )
        resp = await chat.send_message(msg)
        text = resp if isinstance(resp, str) else str(resp)
        # Strip markdown fences if any
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            # Remove leading "json\n"
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].lstrip()
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Best effort: find first { and last }
            i = cleaned.find("{")
            j = cleaned.rfind("}")
            if i >= 0 and j > i:
                try:
                    return json.loads(cleaned[i : j + 1])
                except Exception:
                    pass
            return {"raw": text[:2000], "parse_error": True}
    except Exception as e:
        log.error("AI extraction failed: %s", e)
        return {"error": str(e)}
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass
