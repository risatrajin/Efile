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

### Iter 13 (Feb 2026 — Client Portal full overhaul to match all 5 stage screenshots)
- **Header**: "Client Portal" pill next to logo for CLIENT role; existing tabs (Dashboard / Messages / Account) preserved
- **ClientPortal full rewrite** with stage-aware sections:
  - **Profile (REFERRED)**: success card "Your profile has been created" + 6-field profile grid + Documents-we-need list (all "Not uploaded") + "Start uploading →" button
  - **Documents (INTAKE)**: interactive document list — "Choose option" dropdown for new uploads, "View ✓ Updated" for re-uploaded, red "Re-upload now" issue cards
  - **Preparation (IN_PREP)**: documents (Uploaded badges) + **Questions from your CPA** section with pending/answered states, helper text, "X pending" counter
  - **Review (IN_REVIEW)**: blue CPA message bubble, Tax Summary card with PDF Preview button, Documents Submitted, **Authorize filing** checklist (5 items) + "Authorize filing with CRA" button
  - **Filed (FILED)**: green "T2 return filed with CRA" card with confirmation #, **Filed return summary** (Net income, Total tax, Instalments, Balance owing in orange, Payment due in orange), Download/View CRA buttons, **What's Next** (3 items: Pay balance, Notice of Assessment, Plan instalments)
- **5-stage Stepper** with connecting lines (Profile → Documents → Preparation → Review → Filed)
- **Stage badge pill** on engagement card (top-right) indicating current phase
- **Backend additions**:
  - `GET /api/engagements/{eid}/cpa-questions` (CPA, CLIENT, ADMIN)
  - `POST /api/engagements/{eid}/cpa-questions` (CPA, ADMIN)
  - `PATCH /api/engagements/{eid}/cpa-questions/{qid}` (CLIENT submits answer)
  - `PUT /api/engagements/{eid}/tax-summary` (CPA sets net_income/total_tax/instalments_paid/balance_owing/payment_due_date/t2_draft_doc_id)
  - `POST /api/engagements/{eid}/authorize-filing` (CLIENT confirms 5 statements, sets `authorized_at`)
  - SES + in-app notifications wired for new question / answer / authorization events
- Visually validated against user screenshots: Filed (Emily Chen) ✅, Preparation (Wei Liu) ✅; remaining stages render with same primitives.

### Iter 12 (Feb 2026 — WS Partner workspace overhaul to match user screenshots)
- **AppHeader**: workspace pill ("Partner workspace" for WS_PARTNER, "CPA workspace" for CPA) shown next to logo
- **WsOnboardingDetail full rewrite**: Save changes (gray, top-right), avatar+name+badges header, two-column layout (Client info + Engagement | Pre-filing checklist + Submission details), Tax situation/Notes full-width at bottom with right-aligned blue Save notes button
- **Pre-filing checklist** is now read-only inline (toggle + line-through) with a gear icon → opens `ChecklistSettingsModal` for global template editing; "Move to CloudTax →" + "CPA assigned within 1–2 business days" caption
- **WS Advisor** field is locked input with lock icon
- **ChecklistSettingsModal**: drag-handle reorder + edit + delete + "Add new item" + "X items" footer + Cancel/Save
- **Backend**: new `GET/PUT /api/partner/checklist-template` (admin+WS), `_checklist_from_template()` async helper now used by `POST /api/engagements/onboarding` so new engagements seed from current template; existing engagements unchanged on template update
- **Tests**: pytest 68/68 (10 new template tests + 58 regression). Frontend Playwright 100% on iter-5 flows.

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

### Iter 14 (Feb 2026 — CPA draft + Client review polish, 4-pt UX feedback)
- **CPA UploadDraftCard**: submit button renamed to **"Send and Move to Review"**; removed separate "Save instructions" button (instructions auto-save on upload); added **✕ cancel icon** next to Download on the existing-draft strip → `DELETE /api/engagements/{eid}/draft` endpoint removes the doc, clears `t2_draft_doc_id` + `review_decision`, and reverts `IN_REVIEW` → `IN_PREP`.
- **Backend `POST /api/engagements/{eid}/upload-draft`** now (a) auto-transitions `IN_PREP` → `IN_REVIEW`, (b) `$unset`s `review_decision` on every upload so the client always sees a fresh review prompt for the new draft, and (c) emits the appropriate `draft_ready` notification.
- **Client ReviewDecisionCard simplified**: removed 👍 emoji, switched to single-color Lucide line icons (`ThumbsUp`, `Flag`), neutral gray border baseline, green/red accent only on hover; "I found an issue" textarea is now neutral (no red tint); submit uses standard primary blue.
- **Client Portal Profile dropdowns**: removed the "Start uploading" button so the per-document "Choose option" dropdown is active by default (Iter 14 part 1).
- **Tests**: pytest 13/13 in `test_draft_review_flow.py` (auto-move, decision clear, DELETE RBAC, regression on `review-decision` + `move-to-review`). Frontend live-verified.

### Iter 15 (Feb 2026 — Bug-fix batch on iter 14 review-cycle)
- **Cancel-X inline 2-step confirm**: replaced fragile `window.confirm` (suppressed in some embedded/sandbox browsers) with an inline morph — first click shows "Confirm?" with red tint, auto-resets after 4s, second click fires `DELETE /api/engagements/{eid}/draft`. Verified live.
- **2nd-time draft upload reliability**: after each successful upload, `inputRef.current.value = ""` is reset so re-picking the same file (or any new file) reliably fires `onChange`. Eliminates the "submit button stuck disabled / nothing happens" symptom users hit with same-file re-pick.
- **Client portal auto-refresh**: added `setInterval(loadAll, 20000)` polling on `/portal`. When CPA uploads a new draft (which clears `review_decision` server-side), the client's stale "Issue submitted" card is auto-replaced by a fresh `ReviewDecisionCard` within 20–25s without the client manually reloading.
- **Button-size unification**: `.btn { min-height: 36px; justify-content: center; box-sizing: border-box }` and `.btn-sm / .btn-ghost { min-height: 28px }` in `index.css`. All buttons in `UploadDraftCard` (Download, Cancel-X, Send and Move to Review) now render at a uniform 28px height regardless of icon-only vs text-with-icon content.
- **Tests**: pytest **13/13 PASS** (regression on `test_draft_review_flow.py`). Frontend Playwright **3/3 e2e PASS** (inline cancel-confirm + auto-reset, same-file re-upload, 20s polling auto-refresh).

### Iter 16 (Feb 2026 — User feedback batch: history table, button uniformity, scheduled-meeting removal, compact stepper)
- **Backend `draft_history`** (NEW): both `POST /api/engagements/{eid}/upload-draft` and `POST /api/engagements/{eid}/review-decision` now `$push` an entry into `engagements.draft_history` with `{type, at, actor_id, actor_name, file_name | decision, instructions | note}`. Append-only audit trail; visible to CPA, Client, and Admin (no redaction needed).
- **`<DraftHistoryTable>` shared component** (`/app/frontend/src/components/shared/DraftHistoryTable.js`): renders a compact table with Event pill (CPA upload / Approved / Issue raised), By, Detail, Note/Instructions, When. Returns `null` when history is empty so the card is fully hidden for engagements with no events.
- Wired into **CPA Engagement** page (after the Tax Return draft card) and **Client Portal** Review section (under YOUR REVIEW, after the decision card).
- **Compact modern Stepper**: replaced the 22px blue ringed stepper with 10px black filled dots, 1px connector line, active state has a subtle 4px box-shadow ring, 11px uppercase labels. No legacy blue (#1e88e5/#1565c0) on the Client Portal anymore.
- **Removed Scheduled meeting card** (and `meetingDate`, `CalendarDays`, `Video` imports) from `AdminClientDetail`. Global grep confirms zero residual references.
- **Primary CTA uniformity**: all primary action buttons across **Client Portal**, **CPA Engagement**, **Admin Dashboard / Client Detail**, **WS Dashboard / Onboarding Detail** now use `.btn .btn-primary` (= `var(--accent-dark)` = `#1a1a1a` black) with consistent `min-height: 36px` (or `28px` for `.btn-sm`). Inline `background: '#1e88e5'/'#1565c0'` overrides removed everywhere user-facing. Disabled state now uses `var(--accent-dark)` + `opacity: 0.4` for a clean black-family look.
- **Tests**: pytest **19/19 PASS** (6 new in `test_draft_history.py` + 13 regression in `test_draft_review_flow.py`). Frontend Playwright e2e green on history-render, hide-when-empty, stepper visual, primary-CTA color check, no-meeting-strings.

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
