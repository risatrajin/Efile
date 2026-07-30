import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate, TIER_LABELS } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { PLAN_LABELS } from "./ClientDashboard";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import { paletteFor } from "../components/shared/UserAvatar";
import { ViewToggle } from "../components/shared/EngagementTable";
import { Lock, Inbox } from "lucide-react";

// Partner pipeline starts at Referred — Onboarding is CloudTax-only and is not
// shown in the partner view (partners can't onboard, so the column would always
// be empty). The ONBOARDING stage still exists in the data model and in the
// Admin/CloudTax views.
const COLUMNS = [
  { key: "REFERRED", label: "Referred", icon: "lock" },
  { key: "INTAKE", label: "Intake", icon: "lock" },
  { key: "IN_PREP", label: "In Prep", icon: "lock" },
  { key: "IN_REVIEW", label: "Review", icon: "lock" },
  { key: "FILED", label: "Filed", icon: "lock" },
];

// DFY-only now — DIY has no pipeline stages or kanban (see the DIY tab).
const DFY_STAGE_LABELS = { REFERRED: "Referred", INTAKE: "Intake", IN_PREP: "In Prep", IN_REVIEW: "Review", FILED: "Filed" };

// Ownr rows carry only the collapsed 3-value t2_filing_state, never the raw
// pipeline status (data minimization, deliberate) — so kanban placement is
// necessarily coarse. "Documents Requested" covers 4 real stages but always
// lands in Intake; the label on the card is still the true value.
const OWNR_KANBAN_COLUMN = { "Started": "REFERRED", "Documents Requested": "INTAKE", "Filed with CRA": "FILED" };

function nameOrPlaceholder(name) {
  if (!name) return "Name not provided";
  // Strip a stray leading "Dr." defensively — clients are general small
  // businesses, not physicians.
  return name.replace(/^dr\.?\s+/i, "");
}

function taxYearFromFYE(fye) {
  if (!fye) return null;
  const d = new Date(fye);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

// Ownr-sourced rows come back from the allowlist serializer (server.py
// serialize_for_ownr_partner) — a flat shape with no `.corporation`. Legacy
// pilot rows always have one (every engagement has a corporation). Reliable
// structural discriminator; no explicit field needed.
function isOwnrRow(e) {
  return !e.corporation;
}

function isFiled(e) {
  return isOwnrRow(e) ? e.t2_filing_state === "Filed with CRA" : e.status === "FILED";
}

function ReadOnlyCard({ eng, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`pipeline-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--bg-subtle)" }} />
      <div style={{ fontWeight: 600, fontSize: 13, paddingRight: 16 }}>{nameOrPlaceholder(client.name)}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name}</div>
      {eng.tier && <div style={{ marginTop: 8 }}><TierBadge tier={eng.tier} /></div>}
      {eng.status === "REFERRED" && (
        <div className="mt-2 flex items-center gap-1" style={{ fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f57f17" }} />
          <span className="muted">CloudTax reviewing</span>
        </div>
      )}
      {eng.status === "REFERRED" && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>CPA assignment in progress</div>}
      {eng.status !== "REFERRED" && eng.status !== "FILED" && eng.assigned_cpa && (
        <>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Day {eng.days_elapsed || 0}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>CPA: {eng.assigned_cpa.name}</div>
        </>
      )}
      {eng.status === "FILED" && (
        <>
          {eng.filing_confirmation && <div style={{ marginTop: 8 }}><span style={{ background: "#fff3e0", color: "#ef6c00", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{eng.filing_confirmation}</span></div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Filed {fmtDate(eng.filing_date)}</div>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        {(() => {
          const colors = {
            REFERRED: { bg: "#e3f2fd", fg: "#1565c0" },
            INTAKE: { bg: "#e3f2fd", fg: "#1565c0" },
            IN_PREP: { bg: "#fff3e0", fg: "#ef6c00" },
            IN_REVIEW: { bg: "#fffde7", fg: "#f57f17" },
            FILED: { bg: "#e8f5e9", fg: "#2e7d32" },
          };
          const c = colors[eng.status] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)" };
          return <span style={{ background: c.bg, color: c.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{DFY_STAGE_LABELS[eng.status] || eng.status}</span>;
        })()}
      </div>
    </div>
  );
}

const OWNR_PILL_COLORS = { "Started": { bg: "#e3f2fd", fg: "#1565c0" }, "Documents Requested": { bg: "#fff3e0", fg: "#ef6c00" }, "Filed with CRA": { bg: "#e8f5e9", fg: "#2e7d32" } };

function OwnrReadOnlyCard({ eng, onOpen }) {
  const c = OWNR_PILL_COLORS[eng.t2_filing_state] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)" };
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`pipeline-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--bg-subtle)" }} />
      <div className="flex items-center" style={{ gap: 6, paddingRight: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{nameOrPlaceholder(eng.name)}</div>
        <span style={{ background: "#f5f0ff", color: "#4c30a0", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999, letterSpacing: 0.3 }}>OWNR</span>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{eng.company_name}</div>
      {eng.tax_year && <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Tax year {eng.tax_year}</div>}
      {eng.t2_filing_state === "Filed with CRA" && (
        <>
          {eng.filing_confirmation && <div style={{ marginTop: 8 }}><span style={{ background: "#fff3e0", color: "#ef6c00", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{eng.filing_confirmation}</span></div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Filed {fmtDate(eng.filing_date)}</div>
        </>
      )}
      <div style={{ marginTop: 10 }}>
        <span style={{ background: c.bg, color: c.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{eng.t2_filing_state}</span>
      </div>
    </div>
  );
}

// Unified list view for the DFY tab — pilot rows keep their richer columns
// (Tier); Ownr rows populate what the allowlist gives them and leave Tier
// blank. Single table, single row source — this (plus the kanban above) is
// what makes toggle counts and rendered rows structurally impossible to
// disagree: both read `rows`, nothing else.
const DFY_STAGE_OPTIONS = [
  { key: "all", label: "All stages" },
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In Prep" },
  { key: "IN_REVIEW", label: "Review" },
  { key: "FILED", label: "Filed" },
];
const DFY_TIER_OPTIONS = [{ key: "all", label: "All tiers" }, ...Object.entries(TIER_LABELS).map(([key, label]) => ({ key, label }))];

function DfyListTable({ rows, onRowClick }) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [tier, setTier] = useState("all");
  const q = query.trim().toLowerCase();
  // Ownr rows never carry a raw status (data minimization) — bucket them
  // through the same coarse mapping the kanban uses so the stage filter
  // still applies (Ownr rows just never match In Prep/Review, same as there).
  const stageOf = (e) => (isOwnrRow(e) ? OWNR_KANBAN_COLUMN[e.t2_filing_state] : e.status);
  let filtered = rows;
  if (stage !== "all") filtered = filtered.filter((e) => stageOf(e) === stage);
  if (tier !== "all") filtered = filtered.filter((e) => !isOwnrRow(e) && e.tier === tier);
  if (q) {
    filtered = filtered.filter((e) => {
      const name = (isOwnrRow(e) ? e.name : e.client?.name) || "";
      const company = (isOwnrRow(e) ? e.company_name : e.corporation?.name) || "";
      return name.toLowerCase().includes(q) || company.toLowerCase().includes(q);
    });
  }
  const cellHeader = { textAlign: "left", padding: "12px 18px", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: 0.5, textTransform: "uppercase", whiteSpace: "nowrap" };
  const cellBody = { padding: "14px 18px", fontSize: 13, verticalAlign: "middle" };
  return (
    <div data-testid="partner-dfy-list">
      <div className="flex items-center" style={{ gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input className="input" placeholder="Search by client or company…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="partner-dfy-list-search" style={{ height: 36, fontSize: 12, flex: "1 1 280px", maxWidth: 320 }} />
        <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} data-testid="partner-dfy-list-stage-filter" style={{ height: 36, fontSize: 12, width: "auto", minWidth: 150 }}>
          {DFY_STAGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select className="select" value={tier} onChange={(e) => setTier(e.target.value)} data-testid="partner-dfy-list-tier-filter" style={{ height: 36, fontSize: 12, width: "auto", minWidth: 130 }}>
          {DFY_TIER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <span className="tertiary" style={{ fontSize: 11, marginLeft: "auto" }}>{filtered.length} of {rows.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-secondary)" }} data-testid="partner-dfy-list-empty">
          {rows.length === 0 ? "No clients to show" : "No clients match the current filters"}
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  <th style={cellHeader}>Client</th>
                  <th style={cellHeader}>Company</th>
                  <th style={cellHeader}>Email</th>
                  <th style={cellHeader}>T2 filing state</th>
                  <th style={cellHeader}>T2 filing type</th>
                  <th style={cellHeader}>Tax year</th>
                  <th style={cellHeader}>Creation date</th>
                  <th style={cellHeader}>Tier</th>
                  <th style={cellHeader}>Last update</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const ownr = isOwnrRow(e);
                  const client = e.client || {};
                  const corp = e.corporation || {};
                  const name = ownr ? e.name : client.name;
                  const company = ownr ? e.company_name : corp.name;
                  const email = ownr ? e.email : client.email;
                  const taxYear = ownr ? e.tax_year : taxYearFromFYE(corp.fiscal_year_end);
                  const lastUpdate = ownr ? e.created_at : (e.updated_at || e.filing_date || e.created_at);
                  return (
                    <tr
                      key={e.id}
                      onClick={() => onRowClick(e)}
                      data-testid={`partner-dfy-list-row-${e.id}`}
                      style={{ borderTop: "1px solid var(--border-default)", cursor: "pointer", transition: "background-color 120ms ease" }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--bg-subtle)"; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ ...cellBody, fontWeight: 600 }}>
                        {nameOrPlaceholder(name)}
                        {ownr && <span style={{ marginLeft: 6, background: "#f5f0ff", color: "#4c30a0", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 999, letterSpacing: 0.3 }}>OWNR</span>}
                      </td>
                      <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{company || "—"}</td>
                      <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{email || "—"}</td>
                      <td style={cellBody}>{ownr ? e.t2_filing_state : (DFY_STAGE_LABELS[e.status] || e.status)}</td>
                      <td style={cellBody}>{ownr ? e.t2_filing_type : "Done for you"}</td>
                      <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{taxYear || "Not yet set"}</td>
                      <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{fmtDate(e.created_at)}</td>
                      <td style={cellBody}>{ownr ? "—" : <TierBadge tier={e.tier} />}</td>
                      <td style={{ ...cellBody, color: "var(--text-secondary)" }}>{fmtDate(lastUpdate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// DIY tab: no pipeline stages, no kanban, ever — just the seven-plus-one
// columns. Pilot and Ownr DIY rows share one status vocabulary now
// (t2_filing_state is attached by the backend to both shapes uniformly), so
// this table needs no per-row-kind branching for the Status column at all.
const DIY_STATUS_COLORS = {
  "Started": { bg: "#e3f2fd", fg: "#1565c0" },
  "In progress": { bg: "#fff3e0", fg: "#ef6c00" },
  "Submitted": { bg: "#e8f5e9", fg: "#2e7d32" },
};

function DiyClientsTable({ rows, onRowClick }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const cols = ["Company Name", "Email", "First/Last name", "Plan", "Status", "Tax year", "Creation date"];
  const filtered = q
    ? rows.filter((e) => {
        const ownr = isOwnrRow(e);
        const name = (ownr ? e.name : e.client?.name) || "";
        const company = (ownr ? e.company_name : e.corporation?.name) || "";
        return name.toLowerCase().includes(q) || company.toLowerCase().includes(q);
      })
    : rows;
  return (
    <div data-testid="partner-diy-table">
      <div style={{ marginBottom: 16, maxWidth: 320 }}>
        <input className="input" placeholder="Search by client or company…" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="partner-diy-table-search" style={{ height: 38, fontSize: 12 }} />
      </div>
      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "56px 24px", color: "var(--text-secondary)" }} data-testid="partner-diy-table-empty">
          {rows.length === 0 ? "No clients to show" : "No clients match your search"}
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid var(--border-default)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle)" }}>
                  {cols.map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "16px 22px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const ownr = isOwnrRow(e);
                  const client = e.client || {};
                  const corp = e.corporation || {};
                  const name = ownr ? e.name : client.name;
                  const company = ownr ? e.company_name : corp.name;
                  const email = ownr ? e.email : client.email;
                  const taxYear = ownr ? e.tax_year : taxYearFromFYE(corp.fiscal_year_end);
                  const planLabel = ownr ? e.plan_label : (e.plan ? PLAN_LABELS[e.plan] : null);
                  const statusColor = DIY_STATUS_COLORS[e.t2_filing_state] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)" };
                  return (
                    <tr
                      key={e.id}
                      onClick={() => onRowClick(e)}
                      data-testid={`partner-diy-row-${e.id}`}
                      style={{ borderTop: "1px solid var(--border-default)", cursor: "pointer", transition: "background-color 120ms ease" }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = "var(--bg-subtle)"; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ padding: "18px 22px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                        <div className="flex items-center" style={{ gap: 12 }}>
                          <span className="avatar" aria-hidden style={{ background: paletteFor(company || "?"), color: "#1a1a1a" }}>{(company || "?").charAt(0)}</span>
                          {company || "—"}
                        </div>
                      </td>
                      <td style={{ padding: "18px 22px", fontSize: 13, color: "var(--text-secondary)" }}>{email || "—"}</td>
                      <td style={{ padding: "18px 22px", fontSize: 13, whiteSpace: "nowrap" }}>{nameOrPlaceholder(name)}</td>
                      <td style={{ padding: "18px 22px", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{planLabel || "—"}</td>
                      <td style={{ padding: "18px 22px", whiteSpace: "nowrap" }}>
                        <span style={{ background: statusColor.bg, color: statusColor.fg, fontSize: 12, fontWeight: 500, padding: "4px 12px", borderRadius: 999 }}>{e.t2_filing_state}</span>
                      </td>
                      <td style={{ padding: "18px 22px", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{taxYear || "Not yet set"}</td>
                      <td style={{ padding: "18px 22px", fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{fmtDate(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WsDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");
  // Read the new key first, fall back to the legacy key so a partner mid-session
  // keeps their view toggle through the rename. Writes go to the new key only.
  const [view, setView] = useState(() => localStorage.getItem("ct_partner_dash_view") || localStorage.getItem("ct_ws_dash_view") || "kanban");
  // Service-model tab: "DFY" (Done for you — full CPA pipeline) vs "DIY"
  // (Do it yourself). Top-level split of the whole page — every visible
  // client (pilot or Ownr) belongs to exactly one side via service_model.
  const [model, setModel] = useState(() => localStorage.getItem("ct_partner_model") || "DFY");
  const setModelPersist = (m) => {
    setModel(m);
    try { localStorage.setItem("ct_partner_model", m); }
    catch (e) { console.debug("[WsDashboard] persist model failed:", e); }
  };

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem("ct_partner_dash_view", v); }
    catch (e) { console.debug("[WsDashboard] persist view failed:", e); }
  };

  const openFile = (eid) => navigate(`/partner/file/${eid}`);

  // Split by service_model — the ONE filtered set both the summary cards and
  // whichever view mode is active read from. Legacy engagements with no
  // service_model field count as DFY. No other array feeds either tab.
  const serviceModelOf = (e) => (isOwnrRow(e) ? (e.t2_filing_type === "Do it yourself" ? "DIY" : "DFY") : (e.service_model || "DFY"));
  const dfyRows = engs.filter((e) => serviceModelOf(e) === "DFY");
  const diyRows = engs.filter((e) => serviceModelOf(e) === "DIY");
  const shown = model === "DFY" ? dfyRows : diyRows;
  const isDIY = model === "DIY";

  const counts = { DFY: dfyRows.length, DIY: diyRows.length };

  // Stats derived entirely from the active tab's row set — same array the
  // tab renders, so a count/row mismatch is impossible by construction.
  const thisYear = new Date().getFullYear();
  const filedThisYear = (e) => e.filing_date && new Date(e.filing_date).getFullYear() === thisYear;
  const dfyStats = [
    { key: "total", label: "Total clients", value: dfyRows.length },
    { key: "in_progress", label: "In progress", value: dfyRows.filter((e) => !isFiled(e)).length },
    { key: "filed", label: "Filed", value: dfyRows.filter(isFiled).length },
    { key: "filed_year", label: "Filed this year", value: dfyRows.filter((e) => isFiled(e) && filedThisYear(e)).length },
  ];
  const diyStats = [
    { key: "total", label: "Total", value: diyRows.length },
    { key: "started", label: "Started", value: diyRows.filter((e) => e.t2_filing_state === "Started").length },
    { key: "in_progress", label: "In progress", value: diyRows.filter((e) => e.t2_filing_state === "In progress").length },
    { key: "submitted", label: "Submitted", value: diyRows.filter((e) => e.t2_filing_state === "Submitted").length },
  ];
  const stats = isDIY ? diyStats : dfyStats;

  const MODEL_TABS = [
    { key: "DFY", label: "Done for you" },
    { key: "DIY", label: "Do it yourself" },
  ];

  const tabs = [{ key: "dashboard", to: "/partner/dashboard", label: "Dashboard" }];
  const rootClass = "app-root" + (user?.role === "PARTNER" ? " ownr-portal" : "");

  return (
    <div className={rootClass}>
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        {/* Service-model tabs — text-only pill segmented control. Top-level
            split of the whole page: every visible client is on exactly one
            side, via service_model. */}
        <div role="tablist" aria-label="Service model" data-testid="partner-model-tabs"
             style={{ display: "inline-flex", background: "var(--bg-subtle)", border: "1px solid var(--border-default)", borderRadius: 999, padding: 3 }}>
          {MODEL_TABS.map((t) => {
            const active = model === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`model-tab-${t.key}`}
                onClick={() => setModelPersist(t.key)}
                style={{
                  position: "relative", zIndex: 1, border: "none", cursor: "pointer",
                  padding: "7px 16px", fontSize: 14, fontFamily: "inherit",
                  fontWeight: active ? 600 : 500, borderRadius: 999, whiteSpace: "nowrap",
                  background: active ? "var(--accent-dark)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  transition: "color 200ms ease, background 200ms ease",
                }}
              >
                {t.label} <span style={{ fontWeight: 400, opacity: 0.85 }}>({counts[t.key]})</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 className="page-title">Client pipeline</h1>
            <p className="muted" style={{ fontSize: 13 }}>Track your clients through the filing process</p>
          </div>
          {/* DIY has no kanban in any view-mode state, so the toggle would be
              a dead control there — hide it entirely rather than show one
              that does nothing. */}
          {!isDIY && <ViewToggle value={view} onChange={setViewPersist} testid="partner-view-toggle" />}
        </div>

        <div className="partner-stats" data-testid="partner-stats">
          {stats.map((s) => (
            <div className="stat-card" key={s.key} data-testid={`stat-${s.key}`}>
              <div className="stat-num">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {err && <div className="alert alert-risk">{err}</div>}
        {isDIY ? (
          <DiyClientsTable rows={diyRows} onRowClick={(e) => openFile(e.id)} />
        ) : view === "kanban" ? (
          <div className="kanban" style={{ gridTemplateColumns: "repeat(5, minmax(220px, 1fr))" }} data-testid="partner-kanban">
            {COLUMNS.map((col) => {
              const items = shown.filter((e) => (isOwnrRow(e) ? OWNR_KANBAN_COLUMN[e.t2_filing_state] === col.key : e.status === col.key));
              const isReferred = col.key === "REFERRED";
              const isEmpty = items.length === 0;
              return (
                <div className="kanban-col" key={col.key} data-testid={`kanban-col-${col.key}`}>
                  <div className="kanban-col-header">
                    <div>
                      <div className="kanban-col-title">{DFY_STAGE_LABELS[col.key] || col.label}</div>
                      <div className="kanban-col-count">{items.length}</div>
                    </div>
                    <Lock size={11} style={{ color: "var(--bg-subtle)" }} />
                  </div>
                  {/* Empty state UI is intentionally kept ONLY on the Referred
                      column — that's the handoff pocket where it helps partners
                      understand why it's quiet (CloudTax picks up from here).
                      Every other column stays visually clean when empty. */}
                  {isEmpty && isReferred && (
                    <div className="kanban-col-empty" data-testid={`kanban-empty-${col.key}`}>
                      <div className="kanban-col-empty-icon"><Inbox size={20} /></div>
                      <div className="kanban-col-empty-title">No clients referred yet</div>
                      <div className="kanban-col-empty-sub">Clients CloudTax onboards will land here while a CPA is assigned.</div>
                    </div>
                  )}
                  {!isEmpty && (
                    <div className="stack-sm">
                      {items.map((e) => (isOwnrRow(e)
                        ? <OwnrReadOnlyCard key={e.id} eng={e} onOpen={() => openFile(e.id)} />
                        : <ReadOnlyCard key={e.id} eng={e} onOpen={() => openFile(e.id)} />))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <DfyListTable rows={shown} onRowClick={(e) => openFile(e.id)} />
        )}
      </div>
    </div>
  );
}
