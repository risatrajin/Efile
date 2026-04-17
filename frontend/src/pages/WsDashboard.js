import React, { useEffect, useState } from "react";
import { api, fmtError, fmtDate } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, SeverityDot, OppCategoryLabel } from "../components/shared/Badges";

const COLUMNS = [
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In prep" },
  { key: "IN_REVIEW", label: "Review" },
  { key: "FILED", label: "Filed" },
];

function PipelineCard({ eng }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const info = eng.status === "INTAKE" || eng.status === "REFERRED"
    ? `${eng.docs_uploaded || 0}/${eng.docs_total || 0} docs`
    : eng.status === "FILED"
      ? `Filed in ${eng.turnaround_days || eng.days_elapsed || "—"}d`
      : `Day ${eng.days_elapsed || 0}`;
  return (
    <div className={`kanban-card ${eng.status === "FILED" ? "dimmed" : ""}`} data-testid={`pipeline-card-${eng.id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{client.name || "Client"}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name}</div>
        </div>
        <TierBadge tier={eng.tier} />
      </div>
      <div className="flex items-center between mt-3" style={{ fontSize: 11 }}>
        <span className="tertiary">{info}</span>
        {eng.opps_count > 0 && <span className="badge badge-advisory">{eng.opps_count} opp{eng.opps_count > 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}

function PipelineTab({ engs }) {
  return (
    <div className="kanban" data-testid="pipeline-kanban">
      {COLUMNS.map((col) => {
        const items = engs.filter((e) => e.status === col.key);
        return (
          <div className="kanban-col" key={col.key} data-testid={`kanban-col-${col.key}`}>
            <div className="kanban-col-header">
              <div className="kanban-col-title">{col.label}</div>
              <div className="kanban-col-count">{items.length}</div>
            </div>
            <div className="stack-sm">
              {items.map((e) => <PipelineCard key={e.id} eng={e} />)}
              {items.length === 0 && <div className="tertiary" style={{ fontSize: 11 }}>No clients</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpportunitiesTab({ items, onFollowUp }) {
  if (items.length === 0) return <div className="card muted">No advisory opportunities have been shared yet.</div>;
  return (
    <div className="stack-md" data-testid="opportunities-feed">
      {items.map((o) => (
        <div className="card" key={o.id} style={{ borderLeft: `4px solid ${o.severity === "HIGH" ? "#c62828" : o.severity === "MEDIUM" ? "#f57f17" : "#b5b0ab"}` }} data-testid={`opp-card-${o.id}`}>
          <div className="flex items-center between gap-3">
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{o.client_name || "Client"} · {o.corporation_name}</div>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: 17, marginTop: 4 }}>{o.title}</div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>{o.description}</p>
              <div className="flex items-center gap-3 mt-3">
                <SeverityDot severity={o.severity} />
                <OppCategoryLabel category={o.category} />
                <span className="tertiary" style={{ fontSize: 11 }}>Shared {fmtDate(o.shared_at)}</span>
              </div>
            </div>
            <button
              className={`btn ${o.ws_followed_up ? "btn-secondary" : "btn-primary"} btn-sm`}
              onClick={() => onFollowUp(o)}
              data-testid={`followup-${o.id}`}
            >
              {o.ws_followed_up ? "Followed up ✓" : "Mark followed up"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricsTab({ metrics }) {
  if (!metrics) return <div className="card">Loading metrics...</div>;
  return (
    <div className="stack-lg">
      <div className="metrics-row" data-testid="metrics-row">
        <div className="metric-tile"><div className="val">{metrics.total_clients}</div><div className="lbl">TOTAL CLIENTS</div></div>
        <div className="metric-tile"><div className="val">{metrics.intake_complete}</div><div className="lbl">INTAKE COMPLETE</div></div>
        <div className="metric-tile"><div className="val">{metrics.filed}</div><div className="lbl">FILED</div></div>
        <div className="metric-tile"><div className="val">{metrics.avg_turnaround_days}d</div><div className="lbl">AVG TURNAROUND</div></div>
      </div>
      <div className="card">
        <h2 className="card-title">Pipeline distribution</h2>
        <div className="stack-sm mt-3">
          {Object.entries(metrics.pipeline).map(([k, v]) => (
            <div className="list-row" key={k}>
              <span>{k.replace("_", " ")}</span>
              <span className="muted">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WsDashboard() {
  const [engs, setEngs] = useState([]);
  const [opps, setOpps] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [tab, setTab] = useState("pipeline");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([
        api.get("/engagements"),
        api.get("/opportunities/shared"),
        api.get("/metrics/pilot"),
      ]);
      setEngs(a.data); setOpps(b.data); setMetrics(c.data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const followUp = async (opp) => {
    try {
      await api.patch(`/opportunities/${opp.id}`, { ws_followed_up: !opp.ws_followed_up });
      await load();
    } catch (x) { setErr(fmtError(x)); }
  };

  return (
    <div className="app-root">
      <AppHeader />
      <div className="page-wide stack-lg">
        <div>
          <h1 className="page-title">Wealthsimple pilot</h1>
          <p className="muted" style={{ fontSize: 13 }}>Pipeline, advisory opportunities, and pilot metrics</p>
        </div>

        <div className="nav-tabs" role="tablist">
          <button className={`nav-tab ${tab === "pipeline" ? "active" : ""}`} onClick={() => setTab("pipeline")} data-testid="tab-pipeline">Pipeline</button>
          <button className={`nav-tab ${tab === "opportunities" ? "active" : ""}`} onClick={() => setTab("opportunities")} data-testid="tab-opportunities">Opportunities</button>
          <button className={`nav-tab ${tab === "metrics" ? "active" : ""}`} onClick={() => setTab("metrics")} data-testid="tab-metrics">Metrics</button>
        </div>

        {err && <div className="alert alert-risk">{err}</div>}

        {tab === "pipeline" && <PipelineTab engs={engs} />}
        {tab === "opportunities" && <OpportunitiesTab items={opps} onFollowUp={followUp} />}
        {tab === "metrics" && <MetricsTab metrics={metrics} />}
      </div>
    </div>
  );
}
