import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge } from "../components/shared/Badges";
import EngagementTable, { ViewToggle } from "../components/shared/EngagementTable";
import { Lock, Inbox } from "lucide-react";

const COLUMNS = [
  { key: "ONBOARDING", label: "Onboarding", icon: "lock" },
  { key: "REFERRED", label: "Referred", icon: "lock" },
  { key: "INTAKE", label: "Intake", icon: "lock" },
  { key: "IN_PREP", label: "In Prep", icon: "lock" },
  { key: "IN_REVIEW", label: "Review", icon: "lock" },
  { key: "FILED", label: "Filed", icon: "lock" },
];

function withDrPrefix(name) {
  if (!name) return "—";
  return (/^dr\.?\s/i).test(name) ? name : `Dr. ${name}`;
}

// View-only onboarding card. CloudTax does the onboarding now; partners just
// see progress. No "Move to CloudTax" / "Complete checklist" actions.
function OnboardingCard({ eng, progress, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const ready = progress?.ready;
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`onboarding-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--text-tertiary)" }} />
      <div style={{ flex: 1, paddingRight: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{withDrPrefix(client.name)}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name || "Corporation pending"}</div>
      </div>
      {eng.tier && <div style={{ marginTop: 10 }}><TierBadge tier={eng.tier} /></div>}
      <div className="muted" style={{ fontSize: 11, marginTop: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${client.email || ""}${corp.province ? " · " + corp.province : ""}`}>
        {client.email}{corp.province ? ` · ${corp.province}` : ""}
      </div>
      <div className="mt-3">
        {ready ? (
          <span className="badge badge-complete">Ready</span>
        ) : (
          <div>
            <div className="flex items-center between" style={{ fontSize: 11 }}>
              <span className="muted">Draft</span>
              <span className="muted">{progress?.completed || 0}/{progress?.total || 6} checklist</span>
            </div>
            <div className="mini-bar" style={{ width: "100%", marginTop: 6 }}>
              <div className="fill" style={{ width: `${((progress?.completed || 0) / (progress?.total || 6)) * 100}%`, background: "#1565c0" }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadOnlyCard({ eng, onOpen }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  return (
    <div className="kanban-card" onClick={onOpen} data-testid={`pipeline-card-${eng.id}`} style={{ position: "relative", cursor: "pointer" }}>
      <Lock size={11} style={{ position: "absolute", top: 12, right: 12, color: "var(--text-tertiary)" }} />
      <div style={{ fontWeight: 600, fontSize: 13, paddingRight: 16 }}>{withDrPrefix(client.name)}</div>
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

export default function WsDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [engs, setEngs] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [err, setErr] = useState("");
  const [view, setView] = useState(() => localStorage.getItem("ct_ws_dash_view") || "kanban");

  const load = async () => {
    try {
      const { data } = await api.get("/engagements");
      setEngs(data);
      const onboarding = data.filter((e) => e.status === "ONBOARDING");
      const map = {};
      await Promise.all(onboarding.map(async (e) => {
        try { const { data: p } = await api.get(`/engagements/${e.id}/onboarding-progress`); map[e.id] = p; }
        catch (err) { console.debug("[WsDashboard] onboarding-progress for", e.id, "failed:", err?.response?.status); }
      }));
      setProgressMap(map);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const setViewPersist = (v) => {
    setView(v);
    try { localStorage.setItem("ct_ws_dash_view", v); }
    catch (e) { console.debug("[WsDashboard] persist view failed:", e); }
  };

  const openFile = (eid) => navigate(`/ws/file/${eid}`);

  const tabs = [{ key: "dashboard", to: "/ws/dashboard", label: "Dashboard" }];
  const rootClass = "app-root" + (user?.role === "WS_PARTNER" ? " ownr-portal" : "");

  return (
    <div className={rootClass}>
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 className="page-title">Client pipeline</h1>
            <p className="muted" style={{ fontSize: 13 }}>Track your clients through the filing process</p>
          </div>
          <ViewToggle value={view} onChange={setViewPersist} testid="ws-view-toggle" />
        </div>
        {err && <div className="alert alert-risk">{err}</div>}
        {view === "kanban" ? (
          <div className="kanban" style={{ gridTemplateColumns: "repeat(6, minmax(220px, 1fr))" }} data-testid="ws-kanban">
            {COLUMNS.map((col) => {
              const items = engs.filter((e) => e.status === col.key);
              const isOnboarding = col.key === "ONBOARDING";
              const isReferred = col.key === "REFERRED";
              const isEmpty = items.length === 0;
              return (
                <div className="kanban-col" key={col.key} data-testid={`kanban-col-${col.key}`}>
                  <div className="kanban-col-header">
                    <div>
                      <div className="kanban-col-title">{col.label}</div>
                      <div className="kanban-col-count">{items.length}</div>
                    </div>
                    <Lock size={11} style={{ color: "var(--text-tertiary)" }} />
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
                      {isOnboarding
                        ? items.map((e) => <OnboardingCard key={e.id} eng={e} progress={progressMap[e.id]} onOpen={() => openFile(e.id)} />)
                        : items.map((e) => <ReadOnlyCard key={e.id} eng={e} onOpen={() => openFile(e.id)} />)
                      }
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EngagementTable
            engagements={engs}
            role="WS_PARTNER"
            onRowClick={(e) => openFile(e.id)}
            testid="ws-engagement-table"
            stageOptions={[
              { key: "all", label: "All stages" },
              { key: "ONBOARDING", label: "Onboarding" },
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
