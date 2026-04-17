import React, { useEffect, useState } from "react";
import { api, fmtError } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";

function ExportCsv({ rows }) {
  const doExport = () => {
    const headers = ["client", "corporation", "tier", "status", "days", "cpa_hours", "opps"];
    const csv = [headers.join(",")]
      .concat(rows.map((r) => [
        r.client?.name, r.corporation?.name, r.tier, r.status,
        r.days_elapsed ?? "", r.cpa_hours ?? "", r.opps_count ?? ""
      ].map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pilot-clients.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  return <button className="btn btn-secondary btn-sm" onClick={doExport} data-testid="export-csv">Export CSV</button>;
}

export default function AdminDashboard() {
  const [engs, setEngs] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [econ, setEcon] = useState(null);
  const [util, setUtil] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [a, b, c, d] = await Promise.all([
        api.get("/engagements"),
        api.get("/metrics/pilot"),
        api.get("/metrics/economics"),
        api.get("/metrics/utilization"),
      ]);
      setEngs(a.data); setMetrics(b.data); setEcon(c.data); setUtil(d.data);
    } catch (x) { setErr(fmtError(x)); }
  };
  useEffect(() => { load(); }, []);

  const tabs = [
    { key: "dashboard", to: "/admin/dashboard", label: "Dashboard" },
    { key: "users", to: "/admin/users", label: "Users" },
  ];

  const totalHours = engs.reduce((s, e) => s + (e.cpa_hours || 0), 0);
  const opps = engs.reduce((s, e) => s + (e.opps_count || 0), 0);

  return (
    <div className="app-root">
      <AppHeader tabs={tabs} />
      <div className="page-wide stack-lg">
        <div>
          <h1 className="page-title">Pilot command center</h1>
          <p className="muted" style={{ fontSize: 13 }}>Operational and unit economics for the Wealthsimple T2 pilot</p>
        </div>
        {err && <div className="alert alert-risk">{err}</div>}

        <div className="metrics-row" data-testid="admin-metrics">
          <div className="metric-tile"><div className="val">{metrics?.total_clients ?? "—"}</div><div className="lbl">TOTAL CLIENTS</div></div>
          <div className="metric-tile"><div className="val">{metrics?.filed ?? "—"}/{metrics?.total_clients ?? "—"}</div><div className="lbl">FILED / TOTAL</div></div>
          <div className="metric-tile"><div className="val">{metrics?.avg_turnaround_days ?? "—"}d</div><div className="lbl">AVG TURNAROUND</div></div>
          <div className="metric-tile"><div className="val">{engs.length ? (totalHours / engs.length).toFixed(1) : "—"}h</div><div className="lbl">AVG CPA HOURS</div></div>
        </div>

        <div className="card">
          <div className="flex items-center between">
            <h2 className="card-title">All pilot clients</h2>
            <ExportCsv rows={engs} />
          </div>
          <table className="table mt-3" data-testid="admin-client-table">
            <thead>
              <tr>
                <th>Client</th><th>Corporation</th><th>Tier</th><th>Stage</th><th>CPA</th><th>Days</th><th>Hours</th><th>Opps</th>
              </tr>
            </thead>
            <tbody>
              {engs.map((e) => (
                <tr key={e.id} data-testid={`admin-row-${e.id}`}>
                  <td>{e.client?.name || "—"}</td>
                  <td>{e.corporation?.name || "—"}</td>
                  <td><TierBadge tier={e.tier} /></td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="muted">{e.assigned_cpa?.name || "—"}</td>
                  <td className="muted">{e.days_elapsed ?? "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="mini-bar"><div className="fill" style={{ width: `${Math.min(100, (e.cpa_hours || 0) * 10)}%` }} /></div>
                      <span className="muted">{Number(e.cpa_hours || 0).toFixed(1)}h</span>
                    </div>
                  </td>
                  <td className="muted">{e.opps_count || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid-2">
          <div className="card" data-testid="econ-card">
            <h2 className="card-title">Unit economics</h2>
            <table className="table mt-3">
              <thead><tr><th>Tier</th><th>Revenue</th><th>Avg hours</th><th>Margin</th></tr></thead>
              <tbody>
                {econ && Object.entries(econ).map(([tier, r]) => (
                  <tr key={tier}>
                    <td><TierBadge tier={tier} /></td>
                    <td>${r.price}</td>
                    <td className="muted">{r.avg_hours}h</td>
                    <td>
                      <span className={r.margin >= 0 ? "badge badge-complete" : "badge badge-risk"}>${r.margin} ({r.margin_pct}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" data-testid="util-card">
            <h2 className="card-title">CPA utilization</h2>
            <div className="mt-3 stack-sm">
              {util.map((u) => (
                <div className="list-row" key={u.user.id}>
                  <div className="flex items-center gap-2">
                    <div className="avatar avatar-sm">{(u.user.name || "").split(" ").map((s) => s[0]).join("").slice(0, 2)}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{u.user.name}</div>
                      <div className="tertiary" style={{ fontSize: 11 }}>{u.files} files</div>
                    </div>
                  </div>
                  <div>{u.hours}h</div>
                </div>
              ))}
              {util.length === 0 && <div className="muted">No CPAs yet.</div>}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <div className="card">
            <h2 className="card-title">Pilot debrief</h2>
            <div className="stack-sm mt-3" style={{ fontSize: 13 }}>
              <div className="list-row"><span className="muted">Total opportunities identified</span><span>{opps}</span></div>
              <div className="list-row"><span className="muted">Intake complete</span><span>{metrics?.intake_complete ?? "—"}</span></div>
              <div className="list-row"><span className="muted">Avg turnaround (filed)</span><span>{metrics?.avg_turnaround_days ?? "—"}d</span></div>
            </div>
          </div>
          <div className="card">
            <h2 className="card-title">Active issues</h2>
            <div className="stack-sm mt-3">
              {engs.filter((e) => e.docs_total > 0 && e.docs_uploaded / Math.max(1, e.docs_total) < 0.5 && e.status !== "FILED").map((e) => (
                <div className="list-row" key={e.id}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{e.client?.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{e.docs_uploaded}/{e.docs_total} docs received</div>
                  </div>
                  <span className="badge badge-attention">attention</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
