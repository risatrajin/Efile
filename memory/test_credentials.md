# CloudTax WS Pilot — Test Credentials

All seeded users use password: **CloudTax2026!**

## Admin
- Email: `nim@cloudtax.ca` (was `admin@cloudtax.ca` — updated Apr 29, 2026)
- Password: `CloudTax2026!`
- Home: `/admin/dashboard`

## CPAs
- `pallavi@cloudtax.ca` / `CloudTax2026!` (Pallavi Sharma)
- `terryann@cloudtax.ca` / `CloudTax2026!` (Terry-Ann Mitchell)
- Home: `/cpa/files`

## Wealthsimple partners
- `arani@cloudtax.ca` / `CloudTax2026!` (Henry Ziegler — was `henry.ziegler@wealthsimple.com`, updated Apr 29, 2026)
- `risatrajin@gmail.com` / `CloudTax2026!` (Kris Kibler — was `kris.kibler@wealthsimple.com`, updated Apr 29, 2026)
- Home: `/ws/dashboard`

## Physicians (clients)
- `chen@example.com` (Dr. Emily Chen) — BOOKS_COMPLETE, FILED
- `nguyen@example.com` (Dr. Minh Nguyen) — STANDARD, FILED
- `martin@example.com` (Dr. Sarah Martin) — WHITE_GLOVE, FILED
- `ahmed@example.com` (Dr. Youssef Ahmed) — BOOKS_COMPLETE, IN_REVIEW
- `singh@example.com` (Dr. Amrit Singh) — WHITE_GLOVE, IN_REVIEW, 4 opportunities
- `thompson@example.com` (Dr. Rachel Thompson) — STANDARD, IN_PREP
- `patel@example.com` (Dr. Neel Patel) — WHITE_GLOVE, INTAKE
- `liu@example.com` (Dr. Wei Liu) — STANDARD, INTAKE
- `kaur@example.com` (Dr. Manpreet Kaur) — STANDARD, REFERRED
- `okafor@example.com` (Dr. Chinedu Okafor) — BOOKS_COMPLETE, REFERRED
- All use password: `CloudTax2026!`
- Home: `/portal`

## Auth endpoints
- `POST /api/auth/login` → `{email, password}` → sets httpOnly cookie + returns `{user, token}`
- `POST /api/auth/logout`
- `GET  /api/auth/me`
- `POST /api/auth/set-password` → `{token, password}` (from invite)

## Notes
- Brute-force: 5 failed attempts / 15-min lockout per IP+email.
- AWS SES may be in sandbox — invite emails print the invite_link to response (also logged). Sandbox = only verified recipient addresses receive real mail.
