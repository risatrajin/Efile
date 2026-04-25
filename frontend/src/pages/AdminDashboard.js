import React, { useEffect, useState } from "react";
import { api, fmtError } from "../lib/api";
import AppHeader from "../components/shared/AppHeader";
import { TierBadge, StatusBadge } from "../components/shared/Badges";
import StatusHistoryTimeline from "../components/shared/StatusHistoryTimeline";
import { Download, ChevronRight, ChevronDown } from "lucide-react";

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

function ClientRow({ e, isOpen, onToggle, history, loadingHistory }) {
  return (
    <>
      <tr data-testid={`admin-row-${e.id}`} onClick={onToggle} style={{ cursor: "pointer" }}>
        <td style={{ width: 24 }}>
          {isOpen ? <ChevronDown size={14} style={{ color: "var(--text-secondary)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
        </td>
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
      {isOpen && (
        <tr data-testid={`history-expand-${e.id}`}>
          <td colSpan={9} style={{ background: "var(--bg-subtle)", padding: 24 }}>
            {loadingHistory ? (
              <span className="spinner" />
            ) : (
              <StatusHistoryTimeline rows={history} compact />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AdminDashboard() {
  const [engs, setEngs] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [econ, setEcon] = useState(null);
  const [util, setUtil] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [historyMap, setHistoryMap] = useState({});
  const [loadingId, setLoadingId] = useState(null);
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

  const toggle = async (eid) => {
    if (openId === eid) {
      setOpenId(null);
      return;
    }
    setOpenId(eid);
    if (!historyMap[eid]) {
      setLoadingId(eid);
      try {
        const { data } = await api.get(`/engagements/${eid}/history`);
        setHistoryMap((m) => ({ ...m, [eid]: data }));
      } catch (x) { setErr(fmtError(x)); }
      finally { setLoadingId(null); }
    }
  };

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
        <div className="flex between items-center" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 className="page-title">Pilot command center</h1>
            <p className="muted" style={{ fontSize: 13 }}>Operational and unit economics for the Wealthsimple T2 pilot</p>
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

        <div className="card">
          <h2 className="card-title">All pilot clients</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Click any row to view the engagement&apos;s status timeline.</p>
          <table className="table mt-3" data-testid="admin-client-table">
            <thead>
              <tr>
                <th></th>
                <th>Client</th><th>Corporation</th><th>Tier</th><th>Stage</th><th>CPA</th><th>Days</th><th>Hours</th><th>Opps</th>
              </tr>
            </thead>
            <tbody>
              {engs.map((e) => (
                <ClientRow
                  key={e.id}
                  e={e}
                  isOpen={openId === e.id}
                  onToggle={() => toggle(e.id)}
                  history={historyMap[e.id] || []}
                  loadingHistory={loadingId === e.id}
                />
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
