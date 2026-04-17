# PRD — CloudTax × Wealthsimple T2 Pilot Dashboard

## Problem statement (verbatim)
> Create an enterprise-level, high-security, scalable, fully documented, modern platform for CloudTax. We are partnering with a major fintech Wealthsimple to provide T2 tax services for doctors.

Reference spec: `CLOUDTAX_WS_PILOT_SPEC.md` (user-provided). Four HTML mockups used as design reference.

## Personas / roles
| Role | Home | Can see | Cannot see |
|------|------|---------|-----------|
| CLIENT (physician) | `/portal` | Own engagement, docs, CRA status, assigned CPA | Pricing, tier labels, CPA notes, time, WS info, admin metrics |
| WS_PARTNER | `/ws/dashboard` | Pipeline kanban, shared opportunities, metrics | Document PDFs, CPA notes, time entries, extracted financials |
| CPA | `/cpa/files` | Only assigned engagements with full detail | Other CPAs' files, admin metrics, WS view |
| ADMIN | `/admin/dashboard` | Everything | — |

## Core requirements (static)
1. Multi-tenant with 4-role RBAC, admin-invite flow
2. JWT auth (httpOnly cookie + bcrypt + brute-force lockout, 5/15 min)
3. Presigned-URL S3 uploads (ca-central-1 for PIPEDA residency), SSE-AES256
4. AWS SES transactional email (invite, filing-complete, opportunity-shared, missing-docs)
5. AI document extraction (Claude target; implemented with Gemini 2.5 Pro via Emergent LLM key — emergentintegrations file-attachment support is Gemini-only)
6. Tier system (Books Complete $750, Standard $1,000, White-Glove $2,500) with auto-populated document checklists + review checklists per tier
7. Dual-path CRA access workflow (My Business Account OR EFILE) with RC0001/RZ0001/RP0001 program verification
8. Opportunities (explicitly shared with WS, never automatic)
9. Time tracking by category; per-tier unit economics (margin calc uses $120/hr internal cost)
10. Wealthsimple-inspired warm cream design system: `#faf9f7` / `#1a1a1a`, Georgia serif headings, generous whitespace, no shadows, 16px card radius

## Architecture
- **Stack**: React 18 + React Router 6 + Axios + Lucide icons (frontend); FastAPI + Motor (async Mongo) + PyJWT + bcrypt + boto3 + emergentintegrations (backend); MongoDB 7.
- **Services**: `/app/backend/server.py` (routes) + `auth.py` + `db.py` + `s3_service.py` + `ses_service.py` + `ai_service.py` + `config.py` (tier checklists) + `seed.py`.
- **Frontend pages**: Login + SetPassword, ClientPortal, WsDashboard, CpaFiles, CpaEngagement, AdminDashboard, AdminUsers.
- **Ingress**: all backend routes under `/api/*` on port 8001; frontend on 3000; supervisor-managed; hot reload.

## What's implemented (Iter 1 — Apr 17, 2026)
- [x] JWT auth with httpOnly cookies + Bearer fallback, role dependency (`require_role`), brute-force lockout
- [x] Seed: 1 admin, 2 CPAs, 2 WS partners, 10 physicians, 10 engagements at all lifecycle stages, 6 opportunities, extracted-data samples, tier-aware document + review checklists
- [x] All 4 dashboards fully rendering (Client portal, WS pipeline kanban + opps feed + metrics, CPA files + engagement workbench, Admin command center + users mgmt)
- [x] Engagement enrichment (corporation, client, CPA, WS advisor, docs progress, hours, opps count, days elapsed)
- [x] Document upload via S3 presigned URL (direct PUT from browser) + download URL + AI extract endpoint
- [x] Opportunities create/share with WS (triggers notification + SES email); WS feed shows only shared ones
- [x] Time entries per category, review checklist toggles, CRA access workflow (both paths)
- [x] Metrics: pilot overview, per-tier unit economics with margin %, CPA utilization
- [x] Admin invite user → SES email + fallback invite_link → set-password flow
- [x] Design system CSS variables, warm palette, Georgia serif, progress dots, pills, tables, kanban
- [x] 32/32 backend tests + all frontend flows verified by testing agent

## Deferred / backlog (prioritized)

### P0 (ship-blocking for real pilot)
- [ ] User must verify SES sender `noreply@cloudtax.ca` in AWS SES console and submit production-access request (invite + filing emails need this)
- [ ] S3 bucket `cloudtax-ws-pilot` must have CORS allowing PUT/GET from the preview + production app URLs
- [ ] Bring forward bookkeeping in prod (hook into QuickBooks / Xero webhook)

### P1 (useful pilot polish)
- [ ] In-app notification bell (notifications collection already populated; just needs UI dropdown)
- [ ] Per-tier debrief CSV export (data ready in metrics; add endpoint + button)
- [ ] Client portal accordion collapse for completed phases
- [ ] Status history timeline view on CPA engagement page
- [ ] Support for document re-upload + versioning
- [ ] Search + filters on admin client table
- [ ] Anthropic Claude native PDF parsing (requires PyPDF2-based OCR path since emergentintegrations file-attachments is Gemini-only today)

### P2 (post-pilot)
- [ ] WebSocket-based real-time collaboration (CPA + client typing indicators)
- [ ] Audit log viewer for ADMIN (StatusHistory already captured server-side)
- [ ] CRA EFILE API integration (currently manual verification)
- [ ] Two-factor auth
- [ ] Vercel-style automated preview deploys per PR

## Next action items
1. Verify SES sender email + request SES production access
2. Configure S3 CORS for app URLs
3. Add real-time notification bell (in-app)
4. Phase 2: CSV export + status history timeline + re-upload versioning
