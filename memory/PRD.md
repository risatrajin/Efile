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

### Iter 17 (Feb 2026 — File-with-CRA, Filed celebration, T183 e-signature)
- **Backend `POST /api/engagements/{eid}/file-with-cra`** (CPA/Admin only): accepts `cra_confirmation`, `filing_datetime` (ISO), optional `note` as query params + `file` (PDF) multipart. Validates client has approved + status ∈ {IN_REVIEW, DELIVERY}, persists FILED_RETURN document, sets engagement.status=FILED, filing_confirmation, filing_date, filed_return_doc_id, filing_note, filed_by_id/name. Logs status change + notifies client.
- **Backend `POST /api/engagements/{eid}/t183/sign`** (Client only): accepts JSON `{signature: data:image/png;base64,…, signer_name}`. Persists `t183_signature`, `t183_signed_at`, `t183_signed_name`. Notifies CPA. CPA/ADMIN/WS_PARTNER → 403.
- **Backend `GET /api/engagements/{eid}/t183`** returns sign metadata; **`GET /api/engagements/{eid}/t183/file`** returns the bundled CRA T183CORP PDF (`/app/backend/templates/t183-25e.pdf`).
- **Frontend `<FileWithCRACard>`** (CPA Engagement page, `CpaEngagement.js`): black "File Now" CTA appears once `review_decision.decision='approved'` and status≠FILED; reveals form with CRA confirmation, datetime-local input, PDF dropzone, optional note.
- **Frontend `<SignaturePadModal>`** (`/app/frontend/src/components/shared/SignaturePadModal.js`): HTML5 canvas signature pad with high-DPR scaling, mouse + touch support, Clear button, name input, validation.
- **Frontend `<T183Card>`** (Client Portal): standalone card showing T183 row + Preview + Sign T183 button → opens modal; once signed shows green "Signed" badge + signed-by line + signature image preview. Renders in BOTH Review (phase 3) and Filed (phase 4) so the signature stays visible after filing.
- **Frontend Filed celebration**: 🎉 Congratulations card now powered by real engagement data (`filed_by_name`, `filing_date`, `filing_confirmation`) + black "Download filed return" wired to `filed_return_doc_id` (not the draft).
- **Tests**: 14 NEW tests in `test_file_and_t183.py` — ALL 14/14 PASS (RBAC for both endpoints, validation: empty signature/empty name/invalid data URL, status preconditions, success path, metadata GET reflects sign). Frontend e2e verified on Thompson (FILED): T183 card + signed badge + signature image all render in both Review and Filed phases.

### Iter 18 (Feb 2026 — 6-item batch: corp_name required, file-without-approval, multi-file uploads, notification gaps)
- **corp_name now mandatory**: backend `POST /engagements/onboarding` and `PATCH /engagements/{eid}/onboarding` return 400 when corp_name is missing/blank. Frontend `WsDashboard` Add-Client modal now collects corp_name on **Step 1** (with red `*`); `WsOnboardingDetail` field is also required.
- **CPA can file before client approval**: removed the `review_decision.decision==='approved'` gate from `POST /file-with-cra`. T183 signature is the only legal precondition. The `<FileWithCRACard>` now renders for any engagement in `IN_REVIEW`, regardless of decision.
- **Multi-file uploads per document**: each `POST /documents/{doc_id}/upload` `$push`-es into `doc.files[]` (legacy single-file fields are mirrored from the latest entry). New endpoints `DELETE /documents/{doc_id}/files/{file_id}` and `GET /documents/{doc_id}/files/{file_id}/download`. Legacy docs are normalized into a synthetic `files[]` on read. Client Portal `<DocItem>` now lists every file with its own pill + remove button + an **"Add another file"** CTA.
- **Notification gaps closed**: `notify_admins` helper fans out to every active admin. Admin gets `new_referral_admin` on WS submit-to-CloudTax and `filing_complete_admin` on every filing. CPA gets `cpa_assigned`, WS gets `ws_cpa_assigned`, and the client gets `client_cpa_assigned` whenever `assigned_cpa_id` flips on `PATCH /engagements/{eid}` (no double-fire when unchanged).
- **Tests**: `testing_agent_v3_fork` iter 11 → backend **16/16 PASS** across `test_iter11_corp_uploads_notify.py` (14) + `test_iter11_file_no_approval.py` (2). Frontend e2e green after fixing the WS Step-1 corp-name placement.

### Iter 19 (Feb 2026 — T183 e-signature rebuild end-to-end)
**Backend** — full rewrite of the T183 endpoints with PyMuPDF-powered PDF stamping:
- `POST /api/engagements/{eid}/t183/upload` (CPA): stores pre-filled PDF, status → `draft`, resets any prior cycle state.
- `POST /api/engagements/{eid}/t183/position` (CPA): saves placeholder as page-relative percentages `{page, x_pct, y_pct, w_pct, h_pct}`.
- `POST /api/engagements/{eid}/t183/send` (CPA): status → `sent`, fires `t183_ready` notification to client.
- `POST /api/engagements/{eid}/t183/sign` (Client): merges signature PNG into the PDF using PyMuPDF `page.insert_image` at the saved coordinates → produces a **real signed PDF** with the signature visually embedded. Stores both the original and signed PDFs (S3 with local-disk fallback). Status → `signed`. Sets back-compat fields (`t183_signed_at`, `t183_signed_name`, `t183_signature`).
- `GET /api/engagements/{eid}/t183` returns full metadata + back-compat `signed: bool` for older callers; `GET /t183/file?variant=auto|original|signed` streams the requested PDF with graceful fallback to the bundled CRA template for legacy engagements.

**Frontend**:
- `<T183PlacementModal>` (CPA) — `react-pdf` rendering, `useAuthedPdf` hook to fetch the auth-protected PDF as bytes, draggable yellow `SIGN HERE` placeholder with mouse + touch support.
- `<T183SigningModal>` (Client) — `react-pdf` preview, pulsing blue `SIGN HERE` target at saved coordinates, signature pad with **Draw** (`react-signature-canvas`) and **Type** (rendered into a canvas with handwriting font) tabs. Complete-signing button gated until name + ink/text provided.
- `<T183ManagementCard>` on CPA Engagement page — shows status badge (`draft`/`sent`/`signed`), "Upload T183" / "Place & send" / "Reposition / re-send" / "Download signed PDF" + "Replace T183" CTAs.
- Client Portal Action Required → T183 row now reflects `null → AwaitingCPA badge`, `sent → View & sign`, `signed → green badge` with Download signed.

**Dependencies**: `pymupdf 1.27.2.3` added to backend `requirements.txt`; `react-pdf 10.4.1` + `react-signature-canvas 1.x` added to frontend `package.json`. PDF.js worker loaded from CDN (matching version).

**Tests**: pytest **17/17 PASS** in new `test_t183_rebuild.py` (RBAC, validation, upload-resets-prior-state, position bounds, send preconditions, metadata schema, file streaming variants, legacy fallback, sign validation, sign RBAC, full PyMuPDF merge happy path verifying +1 embedded image on target page). Regression on `test_file_and_t183.py`: **15/15 PASS** after adding back-compat `signed: bool` to the metadata response.

### Iter 20 (Feb 2026 — T183 + Filing polish: signature trim, signature display removal, filing summary)
- **Signature canvas crash fix**: `react-signature-canvas`'s bundled `getTrimmedCanvas()` is broken in `trim-canvas` v0.1.4 (`is not a function`). Replaced with a manual `manualTrimCanvas()` helper inside `T183SigningModal.js` — walks pixel `imageData` to find the bounding box of non-transparent pixels and crops to that with a 2px pad. Both **Draw** (uses `padRef.current.getCanvas()`) and **Type** (uses the typed canvas) paths now flow through the helper before `.toDataURL("image/png")`.
- **Signature image removed from FILED view**: stripped the "Your signature" preview block from both the standalone `<T183Card>` (Filed phase) and the Action Required T183 row (Review phase). Signed state shows only `Signed by [Name] · [Date]` + Preview + green Signed badge. Verified live: zero `<img data-testid="t183-signature-image">` on Thompson FILED.
- **Filed Return Summary end-to-end**:
  - Backend `POST /file-with-cra` now accepts an optional `filing_summary` query param (JSON). Whitelist parses to exactly `{net_income, total_tax_assessed, instalments_paid, balance_owing, payment_due_date}` — extras silently dropped, invalid JSON → 400.
  - CPA `<FileWithCRACard>` extended with a "FILED RETURN SUMMARY" sub-card containing 4 currency inputs + 1 date picker; balance_owing is auto-calculated = total_tax − instalments and shown disabled. The form serializes only when at least one field is non-empty.
  - Client Portal "FILED RETURN SUMMARY" reads `eng.filing_summary` (preferred) with fallback to legacy `eng.tax_summary`. All 5 rows render `—` when missing, formatted currency/date when present. Verified live: Thompson with summary = `{285000, 75000, 50000, 25000, 2026-08-31}` shows correct values; Nguyen without summary shows em-dash on every row.
- Backend `/t183` metadata response retains both `status` (enum) and back-compat `signed` (boolean) — iter 12 regression resolved.
- **Tests**: testing_agent_v3_fork iter 13 — backend filing_summary suite **3/3 PASS** (1 env-skip due to no IN_REVIEW engagement on hand). Regression on `test_t183_rebuild.py` + `test_file_and_t183.py` → **30/33 PASS** (3 env-skips due to seed data being in FILED state). Frontend Client Portal verified on Thompson + Nguyen; CPA file-with-CRA form testids verified by code review.

### Iter 21 (Feb 2026 — Wave B + C of Message 660: Forgot password, Admin expanded caps, Dashboard table toggle)
**Backend** — added password recovery without leaving SES sandbox:
- `POST /api/auth/forgot-password` ({email}) — issues a 30-min token in `password_reset_tokens` (kind=password_reset). Always returns `{ok:true, sent_via_email, reset_link}`; for unknown emails `reset_link` is `null` so no email-existence enumeration. SES is attempted via the new `ses_service.send_password_reset` helper; on sandbox failure the link is surfaced inline in the response so the UI can render it as a fallback.
- `POST /api/auth/reset-password` ({token, password>=8}) — validates+expires token, updates `password_hash`, marks token used. Reuse → 400.

**Frontend**:
- `/forgot-password` and `/reset-password` routes (new `pages/ForgotPassword.js`). Login page now has a "Forgot your password?" link. Forgot page shows the inline fallback block (`forgot-fallback`) with an Open-reset-page CTA + raw link when the API surfaces one.
- `AdminClientDetail` rewrite: parsed `notes` into per-row entries with edit/remove buttons (`tax-note-{i}` testids) + new "Add note" textarea; "Message client" now opens a modal embedding `<ChatThread>` for the engagement (reuses the existing CPA↔Client SSE thread); added `<StatusHistoryTimeline>` and a Documents card so Admin sees the same pipeline detail as WS Partners.
- `AdminDashboard` + `WsDashboard`: new shared `<EngagementTable>` + `<ViewToggle>` (`/components/shared/EngagementTable.js`). Right-aligned Kanban ⇄ Table toggle next to the page title; preference persists in `localStorage` (`ct_admin_dash_view`, `ct_ws_dash_view`). Row click navigates to the right detail page.
- `ses_service.send_password_reset` template added (warm CloudTax email body with reset CTA + 30-min expiry note).

**Tests**: testing_agent_v3_fork iter 14 — backend `test_forgot_reset_password.py` **6/6 PASS** (valid email, unknown-email no-leak, case-insensitive lookup, full reset+revert cycle, used-token rejection, short-password rejection). Regression `test_t183_rebuild.py` + `test_admin_overhaul.py` **26/26 PASS**. Frontend Playwright e2e **100% on all listed flows** (forgot link → fallback rendering → reset confirmation → admin dashboard table toggle → AdminClientDetail tax-notes/message-modal/status-history/documents → WS dashboard table toggle). Admin password NOT touched; `kaur@example.com` reset-password test cycle reverted password back to seeded value.

### Iter 22 (Feb 2026 — 5-item batch: Admin messages icon, Accessibility dropdown, Notification deep-links, FILED return view, Profile picture)
**Backend**:
- `POST /api/users/me/avatar` (multipart) + `DELETE /api/users/me/avatar` + `GET /api/users/{uid}/avatar` — 4 MB cap, mime allowlist (PNG/JPEG/WebP/GIF), S3 with local-disk fallback (`avatar_object_key` prefixed `local://…`). `avatar_url` is versioned (`?v={timestamp}`) so the URL itself busts client caches on every upload.
- `GET /api/messages/inbox` — single aggregation pipeline returns one row per engagement with `{client, corporation, assigned_cpa, last_message, unread_count}`. ADMIN sees all non-ONBOARDING engagements (incl. empty conversations so they can pro-actively start chats); CPA sees only assigned engagements; CLIENT sees own; WS_PARTNER → 403.

**Frontend**:
- `<UserAvatar>` (NEW shared) — image-first with deterministic gradient-initials fallback (9-colour palette by name hash). Resets `errored` state on URL change so re-uploads always re-render fresh.
- `<MessagesInboxButton>` (NEW shared) — chat-bubble icon in AppHeader (ADMIN/CPA/CLIENT only; WS_PARTNER hidden). Popover with search, 30s auto-poll, conversation rows with unread badge → click opens an embedded `<ChatThread>` with full attachment support, back button returns to the list.
- `<AccessibilityMenu>` (NEW shared) — replaces full-screen `<AccessibilityPanel>` modal with a compact dropdown anchored to the icon. All 7 controls (text size, page zoom, high contrast, highlight links, underline links, bigger cursor, reduce motion) + Reset.
- AppHeader rewired: `[Messages] [Settings] [Bell] [A11y] | [Avatar pill]` with `<UserAvatar>` everywhere.
- `<NotificationBell>` deep-link bug fix — ADMIN now correctly navigates to `/admin/client/{eid}` (was incorrectly `/admin/clients/`, returning 404). WS_PARTNER `new_referral` notifications route to `/ws/onboarding/{eid}`; everything else `/ws/file/{eid}`.
- `AdminClientDetail` — new `<FiledReturnCard>` rendered when `status==='FILED'` showing CRA confirmation, filing date, filing note, the 5-row Filed Return Summary (with the Balance + Payment due emphasized in amber), and a "Download filed return (PDF)" button that uses authenticated `fetch+blob` (not a plain anchor that would 401).
- Account page — new `<AvatarUploadCard>` at the top with live preview, Change photo / Remove buttons, mime + size client-side guard. Updates `setUser({...u, avatar_url})` so AppHeader re-renders the new image without reload.
- `index.css` — extended `.a11y-highlight-links` / `.a11y-underline-links` to also cover `.nav-tab`, `.link-underline`, `[role='link']` so the toggles have visible effect on button-driven nav.

**Tests**: testing_agent_v3_fork iter 15 — backend `test_avatar_inbox.py` **10/10 PASS** (PNG roundtrip, mime/size rejection, WebP accepted, /messages/inbox role matrix incl. WS_PARTNER 403, write-then-list assertion). Frontend e2e: 4/5 fully PASS on first run; the one issue (AppHeader avatar not live-refreshing post-upload) was root-caused to browser caching the prior 404 at the same URL, fixed by versioning `avatar_url` in the backend response. Re-verified live: AppHeader avatar correctly switches to `<img>` after upload and reverts to gradient initials after Remove without page reload.

### Iter 23 (Feb 2026 — 10-item visual + UX polish batch)
**Frontend-only**:
- `<UserAvatar>` — replaced 9-pair gradient palette with 9 single subtle flat colours. Inline style now `background: bg` (no `linear-gradient`).
- Admin/CPA Messages icon now NAVIGATES to a dedicated full-page inbox at `/admin/messages` and `/cpa/messages` (new `pages/MessagesPage.js`, registered as `StaffMessagesPage` in `App.js`). Two-pane layout (filterable list + ChatThread on the right, URL-driven active conversation via `?eid=`). CLIENT keeps the lightweight popover. The `MessagesInboxButton` branches on `isStaff` so staff never see the popover.
- Admin Settings now has the avatar upload card. Extracted the local `AvatarUploadCard` from `Account.js` into a shared `components/shared/AvatarUploadCard.js`. `AdminSettings.ProfileTab` wraps it and passes `onChange={(next)=>setUser({...u, avatar_url: next.avatar_url})}` so the AppHeader avatar updates live without reload. This also fixed the iter15 carry-over live-refresh bug.
- Kanban hover lift — `index.css` `.kanban-card:hover` keeps `background:#fff`, adds layered `box-shadow` + `transform: translateY(-1px)`. Transition list extended to `box-shadow, border-color`.
- CloudTax logo reduced from 28px → 22px in AppHeader.
- CPA `FileWithCRACard` primary button label changed from "File Now" → "Update submission info".
- `CpaEngagement` — added explicit `cpa-back-to-files` link above the page title.
- `CpaEngagement` layout — moved `T183ManagementCard`, `FileWithCRACard`, and `client-approved-callout` / `client-issue-callout` from full-width siblings INTO the LEFT column of the `.two-col` grid. Right column (Review checklist + Time logged) unchanged.
- `T183ManagementCard` — overrode default card padding to `16px 18px`, set `minHeight: 48` and `flexWrap: wrap` on the row so the heading + status badge + action button render compact and vertically centered.
- `UploadDraftCard` — when `eng.review_decision?.decision === 'approved'` the card now hides the dropzone + instructions textarea + submit button + cancel-draft X. Renders `upload-draft-readonly` (green "Approved by client on {date}" callout + locked-state copy) + `upload-draft-instructions-readonly` showing the saved instructions string. Existing-draft Download row stays visible (read-only access preserved).

**Tests**: testing_agent_v3_fork iter 16 — Frontend Playwright e2e **100% PASS on all 10 items + regression**. Avatar live-refresh issue from iter15 is now fully resolved. ReactRouter v7 console warnings are pre-existing/harmless. Backend untouched this batch.

### Iter 24 (Feb 2026 — 11-item batch: hover/spacing polish + FILED gate + a11y fix + header simplify)
**Backend** (one focused gate):
- `PATCH /api/engagements/{eid}` with `{status:"FILED"}` now raises `HTTPException(400)` if `t183_signed_at` is missing OR `filing_confirmation` is missing. Two distinct, user-readable detail strings explain which prerequisite to complete next. Applies to ADMIN and CPA equally.

**Frontend (CSS-heavy polish)**:
- `index.css` — `.kanban-card:hover` keeps default border (no blue-tint); only the elevated box-shadow + 1px translateY remain. `.doc-row .doc-row-hover-actions { opacity: 0; pointer-events: none }` with `:hover` / `:focus-within` flipping to `opacity: 1` so the AI extract / Flag-issue buttons appear only on row hover. Native `.select` got `appearance: none` + custom inline-SVG chevron + `padding-right: 32px` so the chevron never overlaps the value text.
- `AccessibilityContext.js` — text-size toggle now also applies `document.body.style.zoom` (in addition to setting `--a11y-text-scale` and html font-size) so the px-based typography across the app actually scales. Reset clears it back to `''`.
- `AppHeader.js` — added `header-home-icon` (Home from lucide-react) as the FIRST child of the right cluster, navigates via `dashboardPathFor(role)` → `/portal | /ws/dashboard | /cpa/files | /admin/dashboard`. Removed the `header-settings-icon` (the avatar dropdown still has Settings).
- `CpaEngagement.js` — DocIcon pending colour switched from `#b5b0ab` → `#ef6c00` (orange). Doc-checklist row split into a `.doc-row-hover-actions` div for AI-extract/Flag-issue and a separate always-visible Download anchored to the right. `MoveToDropdown` now disables `FILED` whenever t183_signed_at OR filing_confirmation is missing, with a clear explanatory `note` matching the backend gate.
- `AdminClientDetail.js` — same MoveToDropdown FILED gating wired with a parallel note for admins.
- `MessagesPage.js` — outer wrapper `height: 100vh; overflow: hidden; display: flex; flexDirection: column`. Inner grid `flex: 1; minHeight: 0`. Right panel passes `height="100%"` to `<ChatThread>` so the chat input form is naturally pinned to the bottom of the panel (verified gap = 2px in 1080-tall viewport). Conversation header has `flexShrink: 0`.
- `Account.js` — added top-of-page `account-back` Back link; removed the entire "Two-factor authentication" row + ShieldCheck import (item 9: 2FA was always mocked, removed entirely).
- `AdminSettings.js` — back link upgraded to a styled btn-link reading "Back to dashboard" with the ArrowLeft icon.

**Tests**: testing_agent_v3_fork iter 17 — Frontend Playwright + backend pytest **100% PASS on all 11 items + regression**. New `test_iter17_filed_gate.py` 6/6 (single-field block, dual-field block, ADMIN role, CPA role, sanity + GET-after-block confirmation). Zero issues. Visual gap admins/CPAs see between explanatory note and disabled FILED option matches spec.

### Iter 25 (Feb 2026 — 9-item batch: 2FA email OTP, search/filter, FiledReturnCard for CPA, AI extract error surfacing, per-doc reminder)
**Backend**:
- Auth — added OTP-based 2FA with email delivery and SES-sandbox fallback (`debug_otp` in response): `/auth/2fa/enable-init`, `/auth/2fa/enable-confirm`, `/auth/2fa/disable` (password-required), and `/auth/2fa/verify-login`. `/auth/login` now short-circuits with `{two_factor_required, challenge_id, sent_via_email, debug_otp, email}` when `user.two_factor_enabled`. `_make_otp_code` (secrets-backed 6-digit), `_issue_otp` (10-min TTL), `_consume_otp` (max-5 attempts then burn) shared helpers. New collection `otp_challenges` (id, user_id, purpose, code_hash, attempts, expires_at, used).
- `ses_service.send_otp_code` template (subject + warm body with the 6-digit code styled).
- `/documents/{doc_id}/extract` now flips status → `EXTRACTED` ONLY when the LLM result has neither `error` nor `parse_error`. Failures persist `extracted_data` for diagnosis but keep status unchanged.
- `/documents/{doc_id}/remind` — NEW per-doc reminder endpoint (CPA/ADMIN). 6-hour cooldown via `reminder_sent_at`; reuses `ses_service.send_deferred_reminder` + in-app `notify` to client. Returns 429 inside cooldown.

**Frontend**:
- `<TwoFactorCard>` (NEW shared) — embedded enrollment flow (init → fallback display → code entry → confirm) and disable flow (password re-auth). Wired into `Account.js` and `AdminSettings.ProfileTab`.
- `Login.js` split into Password and OTP stages. OTP stage shows the sandbox fallback inline so users can still sign in when SES is sandbox-restricted.
- `AuthContext` — `login()` now returns `{ok:false, twoFactorRequired:true, ...}` on the gate, plus a new `verifyLoginOtp(challengeId, code)` flow.
- `<EngagementTable>` gained an internal toolbar (search across client/corp/CPA + stage filter + tier filter + count summary). `WsDashboard` passes a custom `stageOptions` array to surface ONBOARDING.
- `CpaFiles.js` rewritten with its own search + stage + tier filters above the existing table.
- `MessagesPage.js` — Back button moved ABOVE the title; grid template tightened to `minmax(280,320) minmax(0,1fr)` with `maxWidth: 1100` so the panels feel right at any viewport. `ChatThread` resets its `err` state on engagement change to clear the stale 403 the user reported.
- `Account.js` Help & Support text updated to "Have questions? Contact us at support@cloudtax.ca or call +1 888-953-2112".
- `<FiledReturnCard>` extracted to `components/shared/FiledReturnCard.js`; both `AdminClientDetail` and `CpaEngagement` import it. `CpaEngagement` now renders the card in the left column when `eng.status === 'FILED'`.
- `CpaEngagement` — `runExtract` surfaces backend `error`/`parse_error` strings via the engagement-level `err` alert. New `remindDoc` calls `/documents/{id}/remind`; per-doc Send-reminder button appears on hover for not-yet-uploaded rows (works regardless of `client_approved` state).

**Tests**: testing_agent_v3_fork iter 18 — Backend pytest **100%** (full 2FA enable→login-OTP→verify→disable cycle + per-doc remind 200/429 cooldown). Frontend Playwright **~97%** with the only outstanding finding being a data-shape observation (FiledReturnCard renders all 5 summary rows unconditionally with `—` placeholders; `filed-download-btn` correctly hides when `filed_return_doc_id` is null). Zero blocking issues. All 2FA flags reset to OFF post-test.

### Iter 26 (Feb 2026 — 2-item batch: FILED only via "Update submission info" + Client portal menu cleanup)
**Frontend**:
- `MoveToDropdown.js` — STAGES array no longer contains a `FILED` entry. Comment documents the rationale: the only path to FILED is the CPA's "Update submission info" form (`POST /file-with-cra`), which atomically captures CRA confirmation + filing summary + filed PDF + status flip. Rollback FROM FILED still works because the dropdown renders all targets and FILED is the current status (not a target).
- `CpaEngagement.js` + `AdminClientDetail.js` — simplified `disabledKeys`/`note` since FILED can't be requested from the dropdown anymore. Note now informs CPAs that "Update submission info" is the path to FILED.
- `ClientLayout.js` — rewritten to drop the `tabs` prop. Now renders `<AppHeader />` + `<Outlet />` only. The right-side header cluster (Home, Messages, Bell, Accessibility, Avatar) already provides every destination — the duplicate Dashboard/Messages/Account tab strip is gone. Removed the unread-count polling that drove the now-deleted Messages tab badge (the Messages icon in AppHeader still polls and shows its own badge).

**Backend**: unchanged. The PATCH /engagements/{eid} status=FILED gate from iter 24 stays as defense-in-depth — required since direct DB mutations or future automation could still attempt it.

**Tests**: testing_agent_v3_fork iter 19 — Backend pytest **100%** (2 PASS, 1 SKIP — skip is due to seed-data shape post-1b, not a failure). Frontend Playwright **100%** on every assertion (no FILED in cpa-move-to/admin-move-to, file-with-cra form atomically transitions IN_REVIEW → FILED with all data persisted, FiledReturnCard renders all 5 summary rows on reload, admin rollback FILED→IN_REVIEW still works, `/portal` `nav-tabs` count=0, header cluster intact). Zero issues.

### Iter 27 (Feb 2026 — 5-item Message-664 batch: Resend OTP, password eye toggle, FILED dropdown banner, mandatory filing summary, SECURITY & PRIVACY consolidation)
**Backend**:
- `email_service.py` (NEW) — Resend SDK wrapper used for transactional emails. `send_otp_code()` mirrors the prior SES helper's signature so callers swap cleanly. Resend trial-mode key currently delivers only to the verified account email; the inline `debug_otp` fallback continues to work for arbitrary recipients.
- `_issue_otp()` extended with a 30-second resend cooldown enforced against the most recent challenge for (user_id, purpose) regardless of `used` flag. `enforce_cooldown=False` on `/auth/login` and `/auth/2fa/enable-init` (entry points), `True` on the new `/auth/2fa/resend` endpoint.
- `OTP_TTL_MIN` reduced from 10 → 5 minutes. Both enable-init and login-2FA challenge responses now include `expires_in_sec=300` and `resend_after_sec=30` so the frontend can render an accurate countdown.
- `POST /api/auth/2fa/resend` (NEW) — burns the prior challenge, issues a fresh one with the cooldown check, returns the same shape as enable-init. Used by both the login OTP step and the 2FA enrolment flow.
- `POST /api/engagements/{eid}/file-with-cra` — `filing_summary` is now MANDATORY. Whitelist parses the JSON, treats empty/whitespace-only strings as missing, and rejects with 400 if any of `net_income / total_tax_assessed / instalments_paid / balance_owing` are missing. `payment_due_date` remains optional. Error messages are user-readable and tell the CPA exactly which fields are missing.
- All OTP `ses_service.send_otp_code` callsites swapped to `email_service.send_otp_code`. Other transactional emails (invites, password reset, filing-complete) still use SES — that migration is out of scope for this batch.

**Frontend**:
- `<PasswordField>` (NEW shared) — wraps an input with an Eye/EyeOff toggle. Auto-emits `{testid}-toggle` suffixes for the toggle button. Used by Login, ForgotPassword/ResetPassword, SetPassword, Account.js change-password, and AdminSettings change-password.
- `Login.js` — replaced the inline password input with `<PasswordField>`. OTP step now has a "Resend code" link with a 30-second countdown driven by `resend_after_sec` from the backend; clicks call `/auth/2fa/resend` and reset the cooldown. Description updated to "expires in 5 minutes" to match the new TTL.
- `AuthContext.login()` forwards `expires_in_sec` and `resend_after_sec` from the 2FA challenge response so consumers can hydrate the UI.
- `Account.js` — `<TwoFactorCard>` consolidated INSIDE the existing SECURITY & PRIVACY card (uses new `embedded` prop to skip the wrapper card+label). Standalone TwoFactorCard above the security-card removed. Change-password sub-form upgraded to `<PasswordField>` × 3 with eye toggles.
- `AdminSettings.js` (ProfileTab) — `<TwoFactorCard>` retained as its own card with its label updated from "SECURITY" → "SECURITY & PRIVACY". Change-password form upgraded to `<PasswordField>` × 3.
- `<TwoFactorCard>` — added `embedded` prop, label updated to "SECURITY & PRIVACY".
- `<MoveToDropdown>` — when `current === "FILED"`: trigger renders a blue `CheckCircle2` icon (replacing the dot) and label "Step: Filed"; opening the menu shows a blue banner (`testid='{prefix}-filed-banner'`) reading "**Already filed with CRA.** Move back only to apply corrections — filing data is preserved." and the section label flips to "ROLL BACK TO". The four legacy stage rows (REFERRED..IN_REVIEW) remain clickable for rollback. Non-FILED behaviour unchanged.
- `CpaEngagement.js` `<FileWithCRACard>` — Filed Return Summary fields (Net income / Total tax assessed / Instalments paid / Balance owing) now marked with `*` and validated client-side before submission with a clear "Please complete the Filed Return Summary. Missing: ..." error.

**Tests**: testing_agent_v3_fork iter 20 → backend pytest **11/11 PASS** (`test_iter27_resend_otp_filing_summary.py`: enable-init shape, enable-confirm + login-2FA + verify-login + disable round-trip, disable rejects wrong password, resend immediate=429 cooldown, resend after 31s issues new challenge + burns prior, 5 wrong codes burns the challenge, file-with-cra missing/incomplete/empty filing_summary all return 400 with exact messages, payment_due_date-optional success path returns 200 + filing_summary persisted). Frontend Playwright 100% PASS (login-password-toggle flips type, security-card contains the only TwoFactorCard, password-change form eye toggles ×3 functional on Account + AdminSettings, MoveToDropdown FILED trigger shows CheckCircle2 + "Step: Filed", FiledReturnCard renders payment_due_date='—' when omitted).

## Backlog (prioritized)

### Iter 37 (Apr 30, 2026 — Admin Add Member smart logic + client lifecycle + permanent delete)

**Feature 1 — Existing CLIENT → staff upgrade in Add Member**
- `POST /api/users/invite`: when the admin invites an email that matches an existing active/invited CLIENT AND the target role is non-CLIENT, the endpoint **upgrades** the existing record (preserves id + engagement history, stamps `upgraded_from=CLIENT` + `upgraded_at/by`, flips `role/display_role/permissions` to the new selection, issues a fresh invite link). Response returns `upgraded: true`. No more 409 for this common "referred physician becomes CPA" scenario.
- Active non-CLIENT collisions still return the descriptive 409 from iter 35.
- CLIENT target role for an existing CLIENT email keeps the 409 ("already registered as client") to prevent accidental duplicate client creation.

**Feature 2 — CLIENT lifecycle in Users tab**
- Previously `DELETE /users/{uid}` hard-blocked CLIENT deletion with "managed from engagement record". Dropped that block — Admin can now Deactivate / Reactivate / Soft-delete clients directly from the Users tab, giving the lifecycle parity with staff rows.
- New `?permanent=true` query param on `DELETE /users/{uid}`: performs a HARD delete (removes the user document + burns all password_reset_tokens). Safeguards:
  - Self-delete → 400.
  - Last active admin → 400 ("Cannot permanently delete the last active admin").
  - CLIENT with any linked engagements → 400 with count ("This client has N engagement(s). Delete those first…") to keep data integrity.

**Frontend**
- `AddMemberModal`:
  - `<ExistingUserHint>` now takes `targetRole` and shows a **green "Submit to upgrade this account to a team member — engagement history is preserved"** hint whenever an active/invited CLIENT is selected and the admin's chosen role is non-CLIENT. Submit button label flips to "Upgrade to team member" in that state.
  - New **blue `invite-upgraded`** banner in the success view (parallel to the iter-35 `invite-reactivated` banner).
  - Only active non-CLIENT matches still disable submit.
- `UsersTable`:
  - Kebab menu for CLIENT rows now exposes Deactivate / Reactivate / Remove (soft) / **Delete permanently** (only visible on removed rows) instead of the old "managed from engagement" fallback.
  - New `doDelete(u, permanent)` helper calls `/users/{uid}?permanent=true` when chosen. `users-confirm-permanent` dialog spells out the irreversibility.

**Tests**: `test_client_upgrade_and_permanent_delete.py` — **8/8 PASS** (upgrade-client-to-CPA preserves id + stamps upgraded_from, active-staff still 409, client-target-role still 409, permanent-delete removes from /users/all, cannot self-permanent-delete 400, cannot last-admin-permanent-delete 400, client can be deactivated/reactivated/soft-deleted). Combined regression: **28/28 PASS** across iter 35/36/37 suites. End-to-end verified live: `existing-user-hint-invited-client` testid renders on a fresh CLIENT seed, submit button stays enabled, backend upgrades the row with `upgraded_from=CLIENT`.

### Iter 36.1 (Apr 30, 2026 — Users tab filter bar: single-row 70/15/15 layout)

- `<UsersTable>` filter toolbar refactored from a wrapping flex row to a CSS Grid (`grid-template-columns: 70fr 15fr 15fr`) so search / role / status inputs always render on one horizontal line on desktop, with a responsive `@media (max-width: 720px)` breakpoint that stacks the three controls vertically on mobile.
- All three inputs pinned to a consistent 40px height (was previously mixed ~36px vs ~40px depending on variant) + 12px gap between fields. Search icon positioning re-anchored to the relative wrapper.
- The "N of M" summary row moved below the filter bar to avoid eating horizontal space.
- Verified live at 1920x1080 desktop: Search = 823px (70%), Role = 176px (15%), Status = 176px (15%), all aligned on Y=408. Verified at 500px: controls stack vertically.

### Iter 36 (Apr 30, 2026 — Admin Portal: Email autocomplete in Add Member + new Users tab)

**Feature 1 — Email typeahead in Add Member flow** (prevents duplicates + misclicks):
- Backend `GET /api/users/search?q=<>&limit=<>` (ADMIN-only): case-insensitive contains match on `email` / `name` / `removed_email`. Min query length 2 chars, default limit 10 (max 25). Skips legacy rotated-placeholder rows with no `removed_email`. Returns `{id, email, name, role, display_role, avatar_url, status}` with status derived by new `_compute_user_status()` helper (active / invited / removed).
- Frontend `<EmailAutocomplete>` (`components/shared/EmailAutocomplete.js`): debounced 300ms input, dropdown renders on ≥2 chars, shows avatar + highlighted matched substring + name/role + color-coded status badge. Keyboard nav (↑/↓/Enter/Escape), mouse hover to preview, fixed-position dropdown with `zIndex: 2000` so it's never cut off by modal overflow.
- `AddMemberModal` wiring: new `<ExistingUserHint>` inline alert appears when the admin selects a suggestion. Active → red "already a member" + disabled submit with label "Already a member". Invited → amber "pending invitation — resend or submit for fresh one" + inline "Resend invite" button calling `/users/{uid}/resend-invite`. Removed → blue "previously removed — submit to reactivate with new role". Typing past the selection clears the pin so fresh addresses flow through normally.

**Feature 2 — Admin Dashboard "Users" tab** (centralized user management, positioned after CPA's):
- Backend `GET /api/users/all` (ADMIN-only): comprehensive roster including every lifecycle state (active / invited / removed) + computed `last_updated_at` (max of created/activated/reactivated/removed/avatar/2fa timestamps). `password_hash` and `_id` sanitized out.
- Backend `POST /api/users/{uid}/deactivate` (soft suspend without rotating email — reversible) + `POST /api/users/{uid}/reactivate` (restores `removed_email` back to `email` if rotated; 409 if the original address now collides with another active user). Both guard self-target and last-active-admin.
- Frontend `<UsersTable>` (`components/shared/UsersTable.js`): 4 stat cards (Total / Active / Invited / Removed), search by name/email/role, role + status filters, full table with `[Avatar, Name]` / Email / Role badge / Status badge / Created / Updated / Actions columns. Empty state with Users icon. Actions kebab menu (fixed-position overlay, scroll-aware): Resend invitation (staff + non-removed), Deactivate (active staff), Reactivate (removed), Delete (staff + non-removed); clients carry an informational "managed from engagement record" line. Confirmation dialogs for Delete / Deactivate / Reactivate. Resend result modal surfaces the fresh invite link with email-sent indicator.
- Global `.menu-item` / `.menu-item-danger` CSS classes extracted so the kebab menu styling is reusable.

**Backend lifecycle polish:**
- `/auth/set-password` now stamps `activated_at` on the user so the status computation can reliably distinguish "invited" from "active" going forward.
- `DELETE /api/users/{uid}` captures the original email in `removed_email` (iter-35) and, on repeat-delete, preserves the previously-captured original rather than overwriting with the placeholder.

**Tests**: `test_users_tab_and_search.py` — **11/11 PASS** (search min-length, 2-char match, case-insensitive, limit honoured, soft-deleted surfaced via original email, RBAC CPA→403; /users/all status + last_updated_at + no password_hash leak + RBAC; deactivate→/users/all status=removed→reactivate→status=active cycle; cannot-deactivate-self 400; CPA RBAC on both toggles). Plus regression on iter-35 suite: **20/20 PASS** total.

### Iter 35 (Apr 30, 2026 — Admin Add Member: descriptive duplicate errors + soft-delete reactivation + self-role guard + 401 redirect)

**Bug report**: "A member is deleted and no longer visible in the table. When trying to add the same email again, the system shows 'email already exists'. Sometimes also 'Request failed with status code 403'."

**Root cause 1 (duplicate confusion)**: The Roles & Permissions table hides CLIENT rows and soft-deleted users; a generic 409 `"User already exists"` left admins unable to tell *where* the collision was. Leftover CLIENT records (e.g. `john@mail.com`, `test@mail.com`) in the DB would block a staff invite on that email without the admin ever seeing why. Additionally, legacy soft-deleted rows kept the original email (pre iter-32) and would collide on re-invite.

**Root cause 2 (403)**: `require_role("ADMIN")` returns 403 whenever `user.role != "ADMIN"`. The foot-gun: an admin could PATCH their own role to `CPA` or `is_active=false` via the Edit Member modal, bricking their own session — the very next POST to `/users/invite` would then 403.

**Backend** (`server.py`):
- `DELETE /api/users/{uid}` now preserves the original email in a new `removed_email` field (alongside rotating the live `email` to the `deleted+<id8>@cloudtax.invalid` placeholder that frees the unique index). This enables reactivation-on-invite going forward without breaking legacy behaviour.
- `POST /api/users/invite` now does three-stage resolution:
  1. **Active live collision** → descriptive 409 naming the role + the existing member:
     - CLIENT match → "This email is already registered as a client account (<Name>). Client accounts are managed from the client record — please use a different email for staff."
     - Active staff match → "This email is already in use by an active <Role> (<Name>). Check the Roles & Permissions table above or use a different address."
  2. **Soft-deleted match via `removed_email`** → **reactivate** the original user id with the newly-chosen name/role/permissions, clear the soft-delete stamps (`removed_email/removed_at/removed_by_*/session_invalidated_at`), rotate live email back to the real address, burn any stale invite tokens, issue a fresh 7-day invite link, and fire the Resend welcome email. Response includes `reactivated: true`.
  3. **Fresh email** → normal create flow.
- Email normalization: lowercase trim + basic `@` check returning 400 before DB lookup.
- `PATCH /api/users/{uid}` now rejects `uid == current_user.id` attempts to (a) change own role to anything other than ADMIN, or (b) set `is_active=false`. Returns 400 with a human message explaining to ask another admin.

**Frontend** (`lib/api.js`, `pages/Login.js`, `pages/AdminSettings.js`):
- Axios global response interceptor on 401 clears the local token and redirects to `/login?session=expired` (skipping the auth pages themselves to avoid loops). 403 is intentionally NOT globalised so legitimate admin-only endpoint responses can surface contextually.
- Login page renders a `login-session-expired` amber banner when the `?session=expired` query param is present.
- `AddMemberModal`: new `invite-reactivated` blue banner (with `Check` icon) shown above the "Invitation email sent" card when the backend responds with `reactivated: true`. Wording: "Previously removed member reactivated. Their account has been restored with the new role & permissions. A fresh invitation has been issued."
- `AddMemberModal.submit()` catches 403 specifically with the "session expired" copy.

**Tests**: `test_invite_duplicate_and_self_role.py` — **9/9 PASS** (active CPA collision → descriptive 409, case-insensitive lookup, invalid email rejected, fresh invite success, **full reactivate cycle: invite → delete → re-invite with different role → same user_id + reactivated:true + team list shows new role**, reactivation never triggers when email is actively in use, self-role-demote 400, self-deactivate 400, self name-change 200). Live end-to-end verified via Playwright screenshot showing both the blue reactivation banner and the green email-sent banner in the modal.

### Iter 34 (Feb 2026 — Roles & Permissions polish: dedupe, role-based presets, invite-info, copy-link, modal overlays)

**Item 1 — Email uniqueness, dedupe, and hiding soft-deleted users:**
- Root cause of the duplicate Nim: `ADMIN_EMAIL` in `backend/.env` still pointed to `admin@cloudtax.ca`, so `seed_admin` re-created that account on every restart even after iter 32 renamed the active admin to `nim@cloudtax.ca`. Fixed by updating the env to `ADMIN_EMAIL="nim@cloudtax.ca"` (now idempotent with the renamed record).
- Nuked the stale duplicate + a few leftover demo users directly in Mongo. Roles & Permissions now reads 3 rows.
- Backend `list_team` now filters out any row with `removed_at` set OR an email ending in `@cloudtax.invalid` (our soft-delete placeholder) so "zombie" records never leak into the Roles UI.
- Uniqueness was already enforced by the `users.email` unique index (db.py:24) and the duplicate check in `invite_user`; PATCH uniqueness was added in iter 32. Verified live — inviting a pre-existing email now returns 409 `"User already exists"`.

**Item 2 — Role-based permission presets:**
- `ROLE_PRESETS` map in AdminSettings pairs every display role (Admin / Manager / Other / CPA / Partner) with its canonical backend role + a sensible default permission mask. Selecting a role in the Add-Member dropdown **auto-populates** the checkbox grid with that role's preset; admins can still fine-tune individual boxes after. Caption under the dropdown reads "Permissions below are the default set for this role. You can fine-tune them."
- Verified live: picking **Partner** flips `move_clients=true`/`workload=false`; picking **Admin** flips `workload=true`; etc.

**Item 3 — Hide invite token, show read-only email on Set Password:**
- New backend endpoint `GET /api/auth/invite-info?token=…` — public, returns `{email, name, role}` for a valid unused non-expired token; 400 otherwise.
- Frontend `<SetPassword>` resolves the invite on mount. When resolved, renders a disabled/read-only email field (`setpwd-email-readonly`) + a "You're setting a password for {name}." helper line. The raw token is NEVER shown.
- Fallback path: if the token resolution fails (expired/used/missing), the manual entry field is shown with an explanatory note so recovery is still possible.

**Item 4 — "Copy" button on invitation link:**
- After Add-Member succeeds, the invitation link renders inside a `<code>` block with an overlaid **Copy** button (`invite-link-copy`) using `navigator.clipboard` (with an `execCommand` fallback for sandboxed iframes). Successful copy flips the button to a green "Copied" pill for 2s.

**Item 5 — Modal backdrop overlay for Edit / Remove Member:**
- Added `.modal-panel` to `index.css` as a shared card-style class (matches `.modal`). Both `EditMemberModal` and the `confirmRemove` dialog already use `.modal-overlay` (backdrop) + `.modal-panel` (card). Verified live via screenshot: the Edit Admin member dialog renders with the full dimmed backdrop correctly.

### Iter 33 (Feb 2026 — Production launch prep: DB reset + 20-template Resend email system)

**Task 1 — Database reset (EXECUTED in preview):**
- New endpoint `POST /api/admin/reset-database?confirm=RESET` (admin-only) clears every demo collection and the local `uploads/` directory while preserving **3 staff accounts** (Nim Balachandran, Pallavi Sharma, Terry-Ann Mitchell) and global settings (doc templates, tier pricing). Attempts an S3 prefix delete but continues cleanly if the IAM policy lacks `s3:ListBucket` / `s3:DeleteObject`.
- Standalone CLI script at `/app/backend/migrations/reset_for_production.py` mirrors the endpoint for break-glass use (`python -m migrations.reset_for_production --confirm RESET`).
- New `s3_service.delete_prefix(prefix)` helper — paginated `list_objects_v2` + batched `delete_objects`.
- Verified live: curl to `/admin/dashboard` metrics returns 0 clients, engagements array empty, team list shows only the 3 preserved users, admin dashboard body reads `Referred 0 / Intake 0 / In prep 0 / Review 0 / Filed 0 — No clients` across every column.

**Task 2 — Email templates (20 templates, Resend):**
- New module `/app/backend/email_templates.py`:
  - One shared HTML shell (`_wrap`) with cream background, inline CloudTax logo SVG, 560px card, footer "Powered by CloudTax, in partnership with Wealthsimple"
  - 20 template builders returning `(subject, html, text)`: `welcome_client`, `welcome_cpa`, `welcome_ws`, `engagement_started`, `document_reminder`, `new_document_requested`, `document_issue`, `t183_ready`, `return_ready_review`, `t2_filed`, `new_message`, `cpa_client_assigned`, `cpa_doc_uploaded`, `cpa_t183_signed`, `ws_intake_complete`, `ws_filing_complete`, `ws_opportunity`, `admin_new_referral`, `admin_tier_changed`
  - Single async dispatcher `send_email(to, template, data)` — never raises; logs failures non-fatally.
- **Compatibility:** `ses_service.py` rewritten as a proxy — every legacy `send_invite / send_filing_complete / send_missing_doc / send_opportunity / send_deferred_reminder` call at existing call-sites now routes through the Resend-backed templates. Zero mass edits needed; existing triggers auto-upgrade.
- **New trigger — "New message from your CPA / client" (with SSE suppression):** `send_message` endpoint now checks the new `has_live_subscriber(eid, recipient_id)` helper against a `_subs_users` map populated when a user connects to `/messages/stream`. If the recipient is actively watching the thread, the email is skipped (in-app notification still fires). Otherwise a clean transactional email is sent with a 100-char preview + CTA to the messages page. Ref-counted per user so multiple open tabs don't short-circuit each other.
- Resend domain reminder: sender still `onboarding@resend.dev` (trial-mode, delivers to the verified `rajin@cloudtax.ca` only). To unlock all recipients, verify `cloudtax.ca` at https://resend.com/domains and update `RESEND_FROM_EMAIL` in `/app/backend/.env` — zero code change needed.

### Iter 32 (Feb 2026 — targeted email updates + Roles & Permissions member management)

**Operational (DB updates applied):**
- Henry Ziegler: `henry.ziegler@wealthsimple.com` → `arani@cloudtax.ca`
- Kris Kibler: `kris.kibler@wealthsimple.com` → `risatrajin@gmail.com`
- Nim Balachandran (admin): `admin@cloudtax.ca` → `nim@cloudtax.ca`
- **No external email was triggered** by these updates — only an in-app `email_changed` notification was recorded for each user. Resend / SES are only used for OTPs and the existing invite / filing-complete flows; the admin email-change path deliberately does NOT blast a transactional email.
- `/app/memory/test_credentials.md` updated to reflect the new sign-in addresses.

**Backend:**
- `PATCH /users/{uid}` extended: `email` is now a writable field. Enforces lowercase, presence of `@`, and uniqueness (409 if another user already uses it). On change, writes an in-app `email_changed` notification to the affected user ("Your sign-in email was updated"). Audit log line `Admin X changed email of user Y from A -> B`.
- `DELETE /users/{uid}` (NEW, admin-only): soft-deletes a non-client member by setting `is_active=false`, rotating the email to `deleted+<id8>@cloudtax.invalid` so the original address can be re-invited, stamps `removed_at / removed_by_id / removed_by_name` and `session_invalidated_at`. Rejects self-delete (400), last-admin-delete (400), and CLIENT deletes (400 with guidance to manage clients from the client record).

**Frontend:**
- `RolesTab` (AdminSettings) gained an **ACTIONS** column + a three-dot menu per row (`role-actions-trigger-{uid}` → menu `role-actions-menu-{uid}`) with two items:
  - **Edit member** → opens `EditMemberModal` (name + sign-in email). Email-change field surfaces a clear callout that an in-app notification will be emitted and the current session stays valid.
  - **Remove member** → opens a confirmation dialog (`remove-member-modal`) explaining the side-effects (engagement history preserved, email freed for re-invite), then calls `DELETE /users/{uid}`.
- Outside-click closes the menu. Esc/backdrop close the modals.

### Iter 31 (Feb 2026 — Ready-to-file polish: heading rename, multi-file uploads + remove, button rename, client visibility into CPA's filing note)

**Item 1 — Card heading:** the form heading inside the file-with-CRA modal renamed from "File with CRA" → "**Ready to file with CRA**" so it matches the trigger card.

**Item 2 — Multi-file upload with remove/re-upload:**
- Backend `POST /engagements/{eid}/file-with-cra` parameter changed from `file: UploadFile = File(...)` to `files: List[UploadFile] = File(...)`. Persists every file: index 0 becomes the primary `FILED_RETURN` document; the rest are saved as `FILED_RETURN_ATTACHMENT` docs. New `engagement.filed_attachment_doc_ids: list[str]` records the secondary file ids. Returns `files_count` to the caller.
- Frontend: `pickedFiles` state replaces single `pickedFile`. Drop zone accepts `multiple`; selecting more files appends (deduped by name+size). New picked-files list with `data-testid="filed-pdf-list"` showing each file with a `PRIMARY` badge on the first, file size, and an X remove button (`filed-pdf-remove-{i}`). Re-upload is a remove + add combo since selection is purely client-side until submit.
- "Note (optional)" copy clarified that it's shown to the client.

**Item 3 — Submit button:** "Submit filing" → "**Send and move to Filed**".

**Item 4 — Client visibility into CPA's filing note:** the client's Filed dashboard now shows a green callout (`client-filing-note`) titled "**Note from {filed_by_name}**" right under the "Filed by … on …. CRA has acknowledged the submission." sentence. Rendered only when `eng.filing_note` is present. White-space preserved so multi-line notes ("how to pay your balance, next steps") survive verbatim.

### Iter 30 (Feb 2026 — 8-item batch from msg #768, Iteration A)
**Item 1 — ResizeObserver overlay (truly fixed):** moved the noise-suppressor into an inline `<script>` in `public/index.html` `<head>` so it executes BEFORE webpack runtime / react-error-overlay attach their listeners. Now intercepts via capture-phase `error` + `unhandledrejection`, overrides `window.onerror`, mutes matching `console.error`, and adds a CSS rule hiding `iframe#webpack-dev-server-client-overlay`. Verified live on the Set-Password page that triggered it.

**Item 11 — T183 + approval gate (P0 correctness):** the "Update submission info" button is now disabled in BOTH frontend and backend until: (a) `eng.review_decision.decision === "approved"` (client picked "Everything looks good"), AND (b) `eng.t183_signed_at` exists. If the client picked "I found an issue" (review_decision.decision === "issue"), the gate stays closed even with T183 — CPA must address the issue and re-send a draft. Tooltip + inline copy explain which precondition is missing. Backend `POST /file-with-cra` rejects with the same logic so a malicious or stale UI cannot bypass it.

**Items 2 & 5 — Notes feed (newest-first, shared across portals):** new `notes_history` array on engagement + `GET/POST /engagements/{eid}/notes` endpoints. New shared `<EngagementNotes>` React component (compose at top, list below, newest-first ordering, role-tinted bubbles WS=blue/CPA=green/Admin=amber). Legacy `partner_notes` strings are surfaced as a single `LEGACY` entry at the bottom so historical context is preserved. Wired into WsOnboardingDetail (replacing the old single textarea), AdminClientDetail (alongside the legacy TaxSituationCard), and CpaEngagement (sidebar at the bottom).

**Items 3 & 4 — WS Save changes button:** swapped the custom inline-styled button for `.btn .btn-secondary .btn-sm` (default size, matches the rest of the UI). Wrapped the button + "Saved HH:MM:SS" timestamp into a single flex row so the timestamp now sits BEFORE (to the left of) the button.

**Item 8 — Re-uploaded badge:** when a client re-uploads a previously-flagged document (status: ISSUE → UPLOADED), the backend now stamps `was_reuploaded=true`, `prev_issue_note=…`, `reuploaded_at=now`, and emits a "Document re-uploaded" notification (instead of the generic "Document uploaded"). Frontend CPA checklist shows a blue **Re-uploaded** badge with an Upload icon and an inline alert showing the previous issue note. The badge is automatically cleared once the CPA marks the doc REVIEWED or EXTRACTED (acknowledged).

**Item 12 — Client message icon → page (not modal):** rewrote `<MessagesInboxButton>` — every role now navigates to a dedicated messages page (`/portal/messages` for clients, matching the existing routes for staff). Removed the legacy popover entirely (~170 LOC of dead code). The bottom-of-portal "Message" CPA-card button already navigated to the page, so the experience is now consistent end-to-end.

### Iter 29 (Feb 2026 — WS Add-Client P0 fix + ResizeObserver overlay suppression)
**Frontend**:
- `WsDashboard.AddClientModal.goNext()` — Step 1 → Step 2 transition was POST/PATCHing `/engagements/onboarding` WITHOUT the `corp_name` field, even though the user had filled it in. The backend's mandatory-corp_name guard (iter 18) consequently rejected with 400 "corp_name is required". Fix: include `corp_name: form.corp_name` in both the create-POST and update-PATCH bodies. Verified live: typed "Kristin Medical Corp" → Next button now advances to Step 2 with the invite banner shown and no error.
- `index.js` — hardened the existing ResizeObserver-noise suppressor by registering window error / unhandledrejection listeners with `{capture:true}` (so they fire BEFORE `react-error-overlay`'s listeners) and additionally muting `console.error` for the same message + hiding the dev-overlay iframe if it slips through. Verified live: with the WS Add-Client modal open, no "Uncaught runtime errors" overlay appears.

### Iter 28 (Feb 2026 — Messages page width fix + start-new-conversation search)
**Backend**:
- `GET /api/messages/inbox` — CPA + ADMIN now both receive ALL permitted engagements (with or without messages). Previously only ADMIN got empty conversations; CPA was filtered down to assigned engagements with at least one message. CLIENT continues to skip empty rows.

**Frontend**:
- `MessagesPage.js` — left/right two-pane layout switched from `.page-wide` (max 1280px) to a custom 1600px container so the chat thread can breathe. Default view hides empty conversations to keep the inbox focused. When the search input is non-empty, ALL matching engagements appear (incl. clients with zero messages) so CPA/Admin can pick any client to start a new chat.
- New "**N client(s) with no messages yet — click any to start a new conversation.**" hint under the search box (testid `messages-page-new-chat-hint`) when search reveals empty rows.
- New blue **NEW** badge on rows with no messages (testid `messages-page-row-newchat-badge`); preview shows italic "No messages yet — click to start". Clicking opens an empty `<ChatThread>` ready for the first message — sending it persists via the existing `/messages` endpoint and the row promotes to a normal conversation on the next 30s poll.
- Search now also matches against client `email` (in addition to name / corporation / message content).

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
- `POST /api/auth/forgot-password` — issue 30-min reset token (always returns ok=true; reset_link surfaced inline as SES-sandbox fallback)
- `POST /api/auth/reset-password` — consume token + set new password (≥8 chars)
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
- AWS SES sandbox: emails to unverified recipients return success but don't actually deliver — forgot-password endpoint surfaces the reset_link inline as a UI fallback so the flow remains usable
- AWS S3 CORS pending user action — presigned URL generation works, browser PUT will CORS-fail until configured (local-disk fallback active in `s3_service.py`)

## Next action items
1. User: verify SES sender + grant `s3:PutObject` IAM (P0 user-action)
2. CPA workspace: add "Extract data with AI" button + auto-extract toggle (P2)
3. Online presence indicator in chat header using existing SSE `_subs` (P2)
4. Refactor `server.py` (~2960 lines) into route modules (P2)
5. P1 polish: notification bell UI (notifications collection already populated), document re-upload versioning, admin client filters
