import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import EngagementTable, { ViewToggle } from "../components/shared/EngagementTable";
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

function clientName(name) {
  if (!name) return "—";
  // Show the stored name as-is. Strip a stray leading "Dr." defensively —
  // clients are general small businesses, not physicians.
  return name.replace(/^dr\.?\s+/i, "");
}

function ReadOnlyCard({ eng, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`pipeline-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--bg-subtle)" }} />
      <div style={{ fontWeight: 600, fontSize: 13, paddingRight: 16 }}>{clientName(client.name)}</div>
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
          const map = {
            REFERRED: { bg: "#e3f2fd", fg: "#1565c0", label: "Referred" },
            INTAKE: { bg: "#e3f2fd", fg: "#1565c0", label: "Intake" },
            IN_PREP: { bg: "#fff3e0", fg: "#ef6c00", label: "In Prep" },
            IN_REVIEW: { bg: "#fffde7", fg: "#f57f17", label: "Review" },
            FILED: { bg: "#e8f5e9", fg: "#2e7d32", label: "Filed" },
          };
          const s = map[eng.status] || { bg: "var(--bg-subtle)", fg: "var(--text-secondary)", label: eng.status };
          return <span style={{ background: s.bg, color: s.fg, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500 }}>{s.label}</span>;
        })()}
      </div>
    </div>
  );
}

// Active (not-yet-filed) pipeline stages shown to the partner.
const IN_PROGRESS_STATUSES = ["REFERRED", "INTAKE", "IN_PREP", "IN_REVIEW"];

export default function WsDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [engs, setEngs] = useState([]);
  const [err, setErr] = useState("");
  // Read the new key first, fall back to the legacy key so a partner mid-session
  // keeps their view toggle through the rename. Writes go to the new key only.
  const [view, setView] = useState(() => localStorage.getItem("ct_partner_dash_view") || localStorage.getItem("ct_ws_dash_view") || "kanban");
  // Service-model tab: "DFY" (Done for you — full CPA pipeline) vs "DIY"
  // (Do it yourself). Same UI under each, just a different slice of clients.
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

  // Slice to the active service-model tab. Legacy engagements with no field
  // count as DFY. Stats + kanban + table all read from `shown`.
  const shown = engs.filter((e) => (e.service_model || "DFY") === model);
  const counts = {
    DFY: engs.filter((e) => (e.service_model || "DFY") === "DFY").length,
    DIY: engs.filter((e) => e.service_model === "DIY").length,
  };

  // Stats derived entirely from the active-tab engagement slice.
  const thisYear = new Date().getFullYear();
  const filedEngs = shown.filter((e) => e.status === "FILED");
  const stats = [
    { key: "total", label: "Total clients", value: shown.length },
    { key: "in_progress", label: "In progress", value: shown.filter((e) => IN_PROGRESS_STATUSES.includes(e.status)).length },
    { key: "filed", label: "Filed", value: filedEngs.length },
    { key: "filed_year", label: "Filed this year", value: filedEngs.filter((e) => e.filing_date && new Date(e.filing_date).getFullYear() === thisYear).length },
  ];

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
        {/* Service-model tabs — text-only pill segmented control, same styling
            as the Kanban/Table ViewToggle. Same pipeline UI under each; just a
            different slice of clients (Done for you vs Do it yourself). */}
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
          <ViewToggle value={view} onChange={setViewPersist} testid="partner-view-toggle" />
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
        {view === "kanban" ? (
          <div className="kanban" style={{ gridTemplateColumns: "repeat(5, minmax(220px, 1fr))" }} data-testid="partner-kanban">
            {COLUMNS.map((col) => {
              const items = shown.filter((e) => e.status === col.key);
              const isReferred = col.key === "REFERRED";
              const isEmpty = items.length === 0;
              return (
                <div className="kanban-col" key={col.key} data-testid={`kanban-col-${col.key}`}>
                  <div className="kanban-col-header">
                    <div>
                      <div className="kanban-col-title">{col.label}</div>
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
                      {items.map((e) => <ReadOnlyCard key={e.id} eng={e} onOpen={() => openFile(e.id)} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EngagementTable
            engagements={shown}
            role="PARTNER"
            onRowClick={(e) => openFile(e.id)}
            testid="partner-engagement-table"
            stageOptions={[
              { key: "all", label: "All stages" },
              { key: "REFERRED", label: "Referred" },
              { key: "INTAKE", label: "Intake" },
              { key: "IN_PREP", label: "In Prep" },
              { key: "IN_REVIEW", label: "In Review" },
              { key: "DELIVERY", label: "Delivery" },
              { key: "FILED", label: "Filed" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
