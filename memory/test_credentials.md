# CloudTax Test Credentials

> After iter 33 production-prep DB reset (Apr 29, 2026), only the 3 staff accounts below exist.
> All demo clients, WS partners, and engagements were cleared.

## Admin
- `admin@cloudtax.ca` / `CloudTax2026!` (Nim Balachandran)
- Home: `/admin/dashboard`

## CPAs
- `pallavi@cloudtax.ca` / `CloudTax2026!` (Pallavi Sharma)
- `terryann@cloudtax.ca` / `CloudTax2026!` (Terry-Ann Mitchell)
- Home: `/cpa/files`

## WS partners
- None seeded — re-invite via Admin Settings → Roles & Permissions → Add member, or use the invite flow.

## Resend
- `RESEND_API_KEY` in `/app/backend/.env` (trial-mode — only delivers to the verified account email `rajin@cloudtax.ca`)
- To unlock all recipients: verify `cloudtax.ca` at https://resend.com/domains and set `RESEND_FROM_EMAIL=noreply@cloudtax.ca`.
