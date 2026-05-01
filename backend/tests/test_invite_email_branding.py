"""Iter 48: invite email template — CloudTax + Wealthsimple logo + first_name preservation.

Covers:
 - ``_resolve_first_name`` precedence (first_name > name-first-token > empty)
 - multi-word first_name (e.g. "Dr Bala") survives intact in every welcome
   template (client / CPA / WS partner)
 - staff invites (no first_name) fall back to the first whitespace token of ``name``
 - no name at all → greeting omits the trailing comma
 - combined CloudTax+Wealthsimple logo PNG is referenced in the email HTML
"""
from email_templates import (
    _resolve_first_name,
    _tpl_welcome_client,
    _tpl_welcome_cpa,
    _tpl_welcome_ws,
)


def test_resolve_first_name_precedence():
    assert _resolve_first_name({"first_name": "Dr Bala", "name": "Dr Bala Chan"}) == "Dr Bala"
    assert _resolve_first_name({"first_name": "  Van Der  "}) == "Van Der"
    assert _resolve_first_name({"name": "Jane Smith"}) == "Jane"
    assert _resolve_first_name({"name": "Madonna"}) == "Madonna"
    assert _resolve_first_name({"name": "", "first_name": ""}) == ""
    assert _resolve_first_name({}) == ""


def test_client_invite_multiword_firstname_preserved():
    subject, html, text = _tpl_welcome_client({
        "first_name": "Dr Bala",
        "name": "Dr Bala Chan",
        "corporation_name": "Test Medical PC",
        "link": "https://cloudtax.ca/set-password?token=x",
    })
    assert "Dr Bala" in html
    # Ensure the surname didn't leak into the greeting
    # (i.e. title should be "...CloudTax, Dr Bala</h1>", not "Dr Bala Chan")
    assert "Dr Bala Chan" not in html
    assert "Dr Bala" in text


def test_cpa_invite_fallback_to_single_token_of_name():
    subject, html, text = _tpl_welcome_cpa({
        "name": "Jane Smith",
        "link": "https://cloudtax.ca/set-password?token=x",
    })
    assert "Welcome to the CloudTax team, Jane" in html
    # Full name should NOT appear in the greeting
    assert "Welcome to the CloudTax team, Jane Smith" not in html


def test_ws_invite_multiword_firstname_preserved():
    _, html, _ = _tpl_welcome_ws({
        "first_name": "Van Der",
        "link": "https://cloudtax.ca/set-password?token=x",
    })
    assert "Wealthsimple partner, Van Der" in html


def test_invite_greeting_omits_comma_when_no_name():
    # With neither first_name nor name, the greeting should not render a
    # trailing comma (no "Hi ,"/"...CloudTax," orphans).
    _, html_c, text_c = _tpl_welcome_client({
        "corporation_name": "Test Co",
        "link": "https://x/y",
    })
    assert ", <" not in html_c
    assert ", " not in html_c.split("You&rsquo;re invited to join CloudTax")[1][:40]
    # Text variant
    assert "Hi ," not in text_c


def test_combined_logo_is_referenced_in_email_html():
    _, html, _ = _tpl_welcome_client({
        "first_name": "Dr Bala",
        "corporation_name": "X",
        "link": "https://x/y",
    })
    assert "cloudtax-wealthsimple-logo@2x.png" in html
    # alt text carries the partnership branding even for image-blocked clients
    assert 'alt="CloudTax + Wealthsimple"' in html
