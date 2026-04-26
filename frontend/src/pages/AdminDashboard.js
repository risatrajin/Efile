import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtError, fmtDate } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import { Download, Lock } from "lucide-react";

const COLUMNS = [
  { key: "REFERRED", label: "Referred" },
  { key: "INTAKE", label: "Intake" },
  { key: "IN_PREP", label: "In prep" },
  { key: "IN_REVIEW", label: "Review" },
  { key: "FILED", label: "Filed" },
];

function ExportCsvButton() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onExport = async () => {
    setBusy(true); setErr("");
    try {
      const resp = await api.get("/metrics/export", { responseType: "blob" });
      const cd = resp.headers["content-disposition"] || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m ? m[1] : `cloudtax-pilot-debrief-${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(fmtError(e)); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3">
      {err && <span className="muted" style={{ fontSize: 11, color: "var(--status-risk-text)" }}>{err}</span>}
      <button className="btn btn-primary btn-sm" onClick={onExport} disabled={busy} data-testid="export-csv">
        <Download size={12} /> {busy ? "Exporting…" : "Export pilot debrief CSV"}
      </button>
    </div>
  );
}

function AdminCard({ eng, onClick }) {
  const corp = eng.corporation || {};
  const client = eng.client || {};
  const needsCpa = !eng.assigned_cpa_id && eng.status === "REFERRED";
  return (
    <div className="kanban-card" onClick={onClick} data-testid={`admin-card-${eng.id}`} style={{ cursor: "pointer", position: "relative" }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{client.name || "—"}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{corp.name}</div>
      <div className="flex items-center gap-2 mt-2">
        <TierBadge tier={eng.tier} />
      </div>
      {needsCpa ? (
        <div className="mt-3 flex items-center gap-1" style={{ fontSize: 11 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f57f17" }} />
          <span style={{ color: "#f57f17", fontWeight: 500 }}>Needs CPA assignment</span>
        </div>
      ) : (
        <>
          {eng.assigned_cpa && <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>CPA: {eng.assigned_cpa.name}</div>}
          {eng.status === "FILED" ? (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Filed {fmtDate(eng.filing_date)}</div>
          ) : (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Day {eng.days_elapsed || 0}</div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [engs, setEngs] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b] = await Promise.all([api.get("/engagements"), api.get("/metrics/pilot")]);
      setEngs(a.data); setMetrics(b.data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const tabs = [
    { key: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { key: "users", to: "/admin/users", label: "Users" },
  ];
  const totalHours = engs.reduce((s, e) => s + (e.cpa_hours || 0), 0);

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        <div className="flex between items-center" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="page-title">Pilot command center</h1>
            <p className="muted" style={{ fontSize: 13 }}>Click any client to manage CPA assignment and view full file detail.</p>
          </div>
          <ExportCsvButton />
        </div>
        {err && <div className="alert alert-risk">{err}</div>}

        <div className="metrics-row" data-testid="admin-metrics">
          <div className="metric-tile"><div className="val">{metrics?.total_clients ?? "—"}</div><div className="lbl">TOTAL CLIENTS</div></div>
          <div className="metric-tile"><div className="val">{metrics?.filed ?? "—"}/{metrics?.total_clients ?? "—"}</div><div className="lbl">FILED / TOTAL</div></div>
          <div className="metric-tile"><div className="val">{metrics?.avg_turnaround_days ?? "—"}d</div><div className="lbl">AVG TURNAROUND</div></div>
          <div className="metric-tile"><div className="val">{engs.length ? (totalHours / engs.length).toFixed(1) : "—"}h</div><div className="lbl">AVG CPA HOURS</div></div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="card-title">All pilot clients</h2>
          <p className="muted" style={{ fontSize: 12, marginBottom: 16 }}>Pipeline by stage. Cards with an orange dot need a CPA assigned.</p>
          <div className="kanban" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(220px, 1fr))` }} data-testid="admin-kanban">
            {COLUMNS.map((col) => {
              const items = engs.filter((e) => e.status === col.key);
              return (
                <div className="kanban-col" key={col.key} data-testid={`admin-kanban-col-${col.key}`}>
                  <div className="kanban-col-header">
                    <div>
                      <div className="kanban-col-title">{col.label}</div>
                      <div className="kanban-col-count">{items.length}</div>
                    </div>
                    {col.key === "FILED" && <Lock size={11} style={{ color: "var(--text-tertiary)" }} />}
                  </div>
                  <div className="stack-sm">
                    {items.map((e) => <AdminCard key={e.id} eng={e} onClick={() => navigate(`/admin/client/${e.id}`)} />)}
                    {items.length === 0 && <div className="tertiary" style={{ fontSize: 11, padding: 8 }}>No clients</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
