# PRD — CloudTax × Wealthsimple T2 Pilot Dashboard

## Problem statement (verbatim)
> Create an enterprise-level, high-security, scalable, fully documented, modern platform for CloudTax. We are partnering with a major fintech Wealthsimple to provide T2 tax services for doctors.

## Personas / roles
| Role | Home | Can see | Cannot see |
|------|------|---------|-----------|
| CLIENT (physician) | `/portal` | Own engagement, docs, CRA status, assigned CPA, messages | Pricing, tier labels, CPA notes, time, WS info, admin metrics |
| WS_PARTNER | `/ws/dashboard` | Pipeline kanban, shared opportunities, metrics | Document PDFs, CPA notes, time entries, extracted financials |
| CPA | `/cpa/files` | Only assigned engagements with full detail | Other CPAs' files, admin metrics, WS view |
| ADMIN | `/admin/dashboard` | Everything | — |

## Tech stack
- **Frontend**: React 18 + React Router 6 + Axios + Lucide icons + Tailwind
- **Backend**: FastAPI + Motor (async Mongo) + PyJWT + bcrypt + boto3 + emergentintegrations
- **Database**: MongoDB 7
- **Storage**: AWS S3 (ca-central-1, presigned PUT direct from browser, SSE-AES256)
- **Email**: AWS SES transactional (invite, filing, missing-docs, deferred-doc reminders)
- **AI**: Claude Sonnet 4.5 via Emergent Universal Key (document parsing)
- **Realtime**: Server-Sent Events (SSE) for chat
- **Auth**: Custom JWT (localStorage Bearer token, NO httpOnly cookie due to ingress CORS)

## Architecture
- `/app/backend/server.py` (~1620 lines) — all routes
- `/app/backend/auth.py` — JWT, bcrypt, brute-force lockout
- `/app/backend/s3_service.py`, `ses_service.py`, `ai_service.py`, `seed.py`
- `/app/frontend/src/App.js` — routes
- `/app/frontend/src/pages/` — role-based pages
- `/app/frontend/src/components/shared/` — AppHeader, ChatThread, StatusHistoryTimeline

## What's implemented

### Iter 1 (Apr 17, 2026)
- JWT auth + Bearer fallback + brute-force lockout
- Seed: 1 admin, 2 CPAs, 2 WS partners, 10 physicians, 10 engagements
- All 4 dashboards (Client portal, WS pipeline, CPA workbench, Admin command center)
- Document upload via S3 presigned PUT, AI extract endpoint
- Opportunities create/share, Time entries, CRA access workflow, Metrics
- Admin invite user → SES email + invite_link → set-password
- 32/32 backend tests passed

### Iter 2-9 (multi-message session)
- Send-reminder button + 48h cooldown for deferred docs
- Status history timeline on CPA engagement page
- CSV pilot debrief export at `/api/metrics/export`
- Real-time SSE messaging system + direct-to-S3 attachment uploads
- Client Account Settings page (notification prefs, password change)
- Unified AppHeader with avatar dropdown
- WS Partner Kanban + 2-step Add Client modal + WS file detail
- Admin Kanban + CPA assignment + WS editable pre-filing checklist
- Client empty state UI

### Iter 11 (Feb 2026 — Admin UI overhaul to match user screenshots)
- **New AppHeader**: cloud logo + brand | avatar+name+email + dropdown | gear icon → /admin/settings | notification bell with red unread badge + dropdown | accessibility icon | inline Sign out
- **NotificationBell** with category icons, timestamps, "Mark all read", 30s auto-poll
- **AdminDashboard simplified**: removed "Pilot command center" title + metrics cards; in-page tabs "Clients" | "CPA's"
- **AdminSettings** at `/admin/settings` with 5 tabs (Profile, Notifications, Documents, Display, Roles & Permissions)
- **Roles & Permissions table**: 14 perm columns + role badge dropdown (Admin/Manager/Other/CPA/Partner — Manager/Other → ADMIN, Partner → WS_PARTNER); Admin row green ✓; non-admin rows toggleable role="checkbox" buttons → PATCH /api/users/{uid}
- **Add Member modal**: full form + permissions + "What happens next" info box → POST /api/users/invite
- **Backend additions**: GET /api/users/team, GET /api/notifications/unread-count, POST /api/notifications/{nid}/read; PATCH /api/users/{uid} accepts permissions + display_role; InviteUserIn accepts display_role + permissions
- **Tests**: pytest 57/57 green (49 existing + 9 new). Frontend Playwright verified all flows.

### Iter 10 (Feb 2026 — earlier in this fork session)
- **Fixed P0 backend route ordering bug** — PATCH `/users/me` was shadowed by `/users/{uid}` (admin-only). Moved `/users/me` and `/users/me/full` above the admin-only `/users/{uid}` route, added `if uid == "me"` defensive guard.
- **Fixed P1 frontend AppHeader dropdown** — Account Settings link was navigating to non-existent `/account` route. Added top-level `/account` route, made AccountPage embed AppHeader for non-Client roles, made nav target role-aware (`/portal/account` for Client, `/account` for others).
- **Test coverage**: pytest 42/43 + 7/7 retest pass = 100% backend green. Frontend Playwright verified all 4 roles can: login → open dropdown → click Account Settings → see Two-factor section + header → click Sign out → land on /login.

## Backlog (prioritized)

### P0 (ship-blocking for real pilot — user-action required)
- [ ] User must verify SES sender `noreply@cloudtax.ca` in AWS SES console + request production access
- [ ] User must configure S3 bucket `cloudtax-ws-pilot` CORS for PUT/GET from preview + prod URLs

### P1 (useful pilot polish)
- [ ] In-app notification bell (notifications collection populated; needs UI dropdown)
- [ ] Status history collapsible timeline on Admin all-clients table
- [ ] Document re-upload + versioning
- [ ] Search + filters on admin client table
- [ ] Switch brute-force lockout identifier from `ip:email` to email-only (Cloudflare ingress instability)

### P2 (post-pilot)
- [ ] Online presence indicator in chat header (use existing SSE `_subs`)
- [ ] 3-step onboarding tooltip walkthrough for first-time clients
- [ ] WebSocket-based collaboration (typing indicators)
- [ ] Real 2FA backend (currently UI placeholder)
- [ ] Audit log viewer for ADMIN
- [ ] Anthropic Claude native PDF parsing (currently using Gemini for file attachments)
- [ ] Refactor `server.py` (~1620 lines) into route modules (`routes_auth.py`, `routes_engagements.py`, `routes_messages.py`, etc.)
- [ ] CRA EFILE API integration

## Key endpoints
- `POST /api/auth/login` — login
- `GET  /api/auth/me` — current user
- `POST /api/auth/change-password`
- `PATCH /api/users/me` — update profile + notification_prefs (now correctly routed)
- `GET  /api/users/me/full` — current user with corporation embedded
- `PATCH /api/users/{uid}` — admin-only, guards against `uid=="me"`
- `GET  /api/engagements/{eid}/messages/stream?token=...` — SSE realtime chat (token in query because EventSource cannot send Authorization header)
- `POST /api/engagements/{eid}/messages/attach-url` — S3 presigned PUT URL
- `POST /api/engagements/{eid}/remind-deferred` — SES 48h cooldown reminder
- `GET  /api/metrics/export` — admin CSV pilot debrief
- `GET  /api/engagements/{eid}/history` — status history timeline

## Mocked / placeholder
- 2FA toggle in Account Settings is UI-only (no backend logic)
- AWS SES sandbox: emails to unverified recipients return success but don't actually deliver
- AWS S3 CORS pending user action — presigned URL generation works, browser PUT will CORS-fail until configured

## Next action items
1. User: verify SES sender + configure S3 CORS (P0 user-action)
2. P1 polish: notification bell, document re-upload versioning, admin client filters
3. P2: online presence, onboarding tour, refactor server.py into modules
