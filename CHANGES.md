# Changes — CloudTax × Ownr Portal

Summary of work layered on top of `main`. Three branches, stacked off `admin-onboarding`:

```
main
 └── admin-onboarding      QA fixes + admin-onboarding feature + Ownr rebrand foundation
      ├── partner-feedback  feature: partner leaves feedback on a client (CloudTax-staff-only read)
      └── security-fixes    access-control hardening (B1/B2/B3/M4/M5)
```

`partner-feedback` and `security-fixes` each branch from `admin-onboarding`, so their diffs include its commits. Suggested merge order: `admin-onboarding → main` first, then rebase the other two onto updated `main`.

---

## `admin-onboarding` — QA fixes, admin onboarding, rebrand foundation

New capability and a pass of interactive-QA fixes across all four portals (Admin, CPA, Client, Partner).

**Features**
- Admin can create clients directly from the Admin portal (admin onboarding flow).
- "New client assigned" email fires to the CPA on assignment.
- `assign_cpa` / `reassign_cpa` permission flags enforced on engagement endpoints.
- Success toasts on refer / assign / reassign (admin) and doc / engagement actions (CPA).
- Reassign panel polish — CPA changes logged in status history.

**Fixes (by portal)**
- **Admin** — "Client not found" instead of infinite spinner on 404; CPA email shown in assign dropdown + junk seed CPAs deduped; robust checklist saves (race fix), read-only hint, a11y/control polish.
- **CPA** — 403/404 on engagement detail handled (no infinite spinner); "Share with WS" → "Share with the partner" + feedback and double-share guard.
- **Client** — friendly upload error instead of raw axios string; delegate-invite **Send** disabled until name + email filled; upload falls back to local disk when S3 unconfigured (was a 500), without breaking the real-S3 path.
- **Partner** — 404 on file detail handled; disabled "Message CloudTax team" placeholder hidden.
- **Branding cleanup** — stray "Ownr" labels in client chat, shared notes feed, and admin role dropdown reworded to "Partner" / "the partner".

**Rebrand foundation (Phase 1 / Phase 1.5)**
- Partner portal rebranded to Ownr (#5F3DC8 + Ownr logo), set view-only; kanban/layout/typography polish (Inter font).
- Role rename `WS_PARTNER → PARTNER` rolled out in stages: dual-accept → data migration (`migrate_partner_v6`) → flip primaries → drop aliases.

---

## `partner-feedback` — partner feedback on a client

A PARTNER (Ownr) can leave feedback on a client. Read access is **CloudTax staff only** (ADMIN + CPA). Clients never see it.

- Backend model + role-gated endpoints (separate from the notes endpoint).
- Stripped in `redact_for_client` (and partner redaction) so it can never leak to a client.
- Partner can edit and remove their **own** feedback; edits tracked, removals tombstoned.
- Role-adaptive `PartnerFeedbackCard`, wired into 3 pages.
- Tests cover role rules + edited/removed markers.

---

## `security-fixes` — access-control hardening

Each fix is its own commit; each was exploited then confirmed blocked, with regression tests.

| Tag | Issue | Fix |
|-----|-------|-----|
| **B1** | `notes_history` leaked to client / partner payloads | Strip it in `redact_for_client` + `redact_for_ws` |
| **B2** | PARTNER could mark a document complete | Block PARTNER on `doc_complete_upload` |
| **B3** | Opportunity update / un-share not scoped to engagement | Scope `update_opp` to its engagement; gate un-share |
| **M4** | Unguarded status transitions on `PATCH /engagements` | Gate status transitions |
| **M5** | PARTNER on engagement-notes write allow-list | Remove PARTNER from the write allow-list |

Regression tests for B1/B2/B3/M4/M5 added in one commit.
