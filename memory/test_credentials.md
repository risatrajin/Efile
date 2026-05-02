# CloudTax Test Credentials

## Admin
- `nim@cloudtax.ca` / `CloudTax2026!` (Nim Balachandran) — **2FA enabled**
- Home: `/admin/dashboard`
- Note: test runs require 2FA disabled — handled per-run by devs; production always has 2FA on.

## CPAs
- `pallavi@cloudtax.ca` / `CloudTax2026!` (Pallavi Sharma)
- `terryann@cloudtax.ca` / `CloudTax2026!` (Terry-Ann Mitchell)
- Home: `/cpa/files`

## WS partners
- `rajin@cloudtax.ca` / `CloudTax2026!` — active partner (seeded before iter 33, survived the DB reset).
- Additional partners can be added via Admin Settings → Roles & Permissions.

## Clients (test fixtures used by test suites)
- `drbala@yopmail.com` / `CloudTax2026!` (Dr Bala Chan) — primary client used by delegate test suites (`test_delegates.py`, `test_delegate_upload_and_view.py`, `test_attribution_and_session.py`). Has an IN_PREP engagement at `Bala Medical PC` with a 3-document checklist.
- Re-seed via `/app/backend/tests/_helpers.py` if missing — drbala's user/corp/engagement is the canonical fixture for delegate flows.

## Resend (Production — iter 43)
- `RESEND_API_KEY` in `/app/backend/.env` — **production key**
- `RESEND_FROM_EMAIL=noreply@ws.cloudtax.ca`
- `RESEND_FROM_NAME=CloudTax`
- Domain `ws.cloudtax.ca` verified at resend.com/domains (SPF/DKIM/Return-Path DNS records in place)
- Delivery verified post-setup to `nimalan.ba@gmail.com`
